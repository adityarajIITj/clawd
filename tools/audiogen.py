"""
CLAWD: The Spark Odyssey — procedural audio generator.

Synthesises every sound effect and the full adaptive soundtrack from scratch
(additive synthesis + FFT convolution reverb) and writes 16-bit WAV files.
No samples, no external assets: the whole score is deterministic code.

    python tools/audiogen.py <out_dir>
"""
from __future__ import annotations

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SR = 22050
rng_global = np.random.default_rng(7)


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n: int, a: float, d: float, s: float, r: float, hold: float | None = None) -> np.ndarray:
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    h_n = max(0, n - a_n - d_n - r_n) if hold is None else int(hold * SR)
    e = np.concatenate([
        np.linspace(0, 1, max(a_n, 1), endpoint=False),
        np.linspace(1, s, max(d_n, 1), endpoint=False),
        np.full(h_n, s),
        np.linspace(s, 0, max(r_n, 1)),
    ])
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e[:n]


def exp_decay(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n) / (tau * SR))


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Gentle FFT low-pass (raised-cosine roll-off)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    roll = np.clip((f - cutoff) / (cutoff * 0.6), 0, 1)
    X *= 0.5 * (1 + np.cos(np.pi * roll))
    return np.fft.irfft(X, len(x))


def highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lowpass(x, cutoff)


def noise(n: int, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-1, 1, n)


def normalize(x: np.ndarray, peak: float = 0.9) -> np.ndarray:
    m = np.max(np.abs(x)) or 1.0
    return x * (peak / m)


def reverb(x: np.ndarray, seconds: float = 2.2, mix: float = 0.3, seed: int = 1, bright: float = 5000) -> np.ndarray:
    """Convolution reverb with a synthetic exponentially decaying noise IR."""
    n = int(seconds * SR)
    ir = noise(n, seed) * np.exp(-np.arange(n) / (seconds * SR / 6.0))
    ir = lowpass(ir, bright)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    L = len(x) + n
    size = 1 << int(np.ceil(np.log2(L)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:L]
    out = np.zeros(L)
    out[: len(x)] += x * (1 - mix)
    out += wet * mix * 1.8
    return out


def write_wav(path: Path, data: np.ndarray) -> None:
    """data: mono (n,) or stereo (n, 2) float in [-1, 1]."""
    data = np.clip(data, -1, 1)
    if data.ndim == 1:
        data = data[:, None]
    pcm = (data * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ----------------------------------------------------------------------------
# instruments (additive)
# ----------------------------------------------------------------------------
def inst_bell(f: float, dur: float, bright: float = 1.0) -> np.ndarray:
    t = t_axis(dur)
    partials = [(1, 1.0, 1.2), (2.0, 0.35, 0.7), (3.01, 0.18 * bright, 0.4), (4.2, 0.1 * bright, 0.25), (5.4, 0.06 * bright, 0.15)]
    y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / tau) for r, a, tau in partials)
    att = np.minimum(1, t / 0.004)
    return y * att


def inst_kalimba(f: float, dur: float) -> np.ndarray:
    t = t_axis(dur)
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.6)
         + 0.3 * np.sin(2 * np.pi * f * 5.95 * t) * np.exp(-t / 0.05)
         + 0.15 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.3))
    return y * np.minimum(1, t / 0.002)


def inst_marimba(f: float, dur: float) -> np.ndarray:
    t = t_axis(dur)
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.35)
         + 0.4 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / 0.08)
         + 0.12 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t / 0.02))
    return y * np.minimum(1, t / 0.002)


def inst_pluck(f: float, dur: float, harm: int = 10, tau: float = 0.5) -> np.ndarray:
    t = t_axis(dur)
    y = np.zeros_like(t)
    for k in range(1, harm + 1):
        y += np.sin(2 * np.pi * f * k * t + k) / k ** 1.3 * np.exp(-t * k / (tau * 4))
    return y * np.exp(-t / tau) * np.minimum(1, t / 0.003)


def inst_pad(f: float, dur: float, detune: float = 0.006, harm: int = 7) -> np.ndarray:
    t = t_axis(dur)
    y = np.zeros_like(t)
    for d in (-detune, 0, detune):
        for k in range(1, harm + 1):
            y += np.sin(2 * np.pi * f * (1 + d) * k * t + k * 1.7 + d * 300) / (k ** 1.6)
    y *= env_adsr(len(t), min(0.6, dur * 0.3), 0.3, 0.8, min(0.8, dur * 0.3))
    lfo = 1 + 0.08 * np.sin(2 * np.pi * 0.3 * t)
    return y * lfo / 3


def inst_brass(f: float, dur: float) -> np.ndarray:
    t = t_axis(dur)
    bright = env_adsr(len(t), 0.06, 0.2, 0.6, 0.1)
    y = np.zeros_like(t)
    for k in range(1, 12):
        y += np.sin(2 * np.pi * f * k * t * (1 + 0.002 * np.sin(2 * np.pi * 5 * t))) / k * (bright ** (k * 0.25))
    return y * env_adsr(len(t), 0.03, 0.1, 0.75, 0.12) * 0.5


def inst_bass(f: float, dur: float, grit: float = 1.2) -> np.ndarray:
    t = t_axis(dur)
    y = np.tanh(grit * np.sin(2 * np.pi * f * t)) + 0.3 * np.sin(2 * np.pi * f * 2 * t)
    return y * env_adsr(len(t), 0.005, 0.15, 0.6, 0.06)


def inst_oud(f: float, dur: float) -> np.ndarray:
    t = t_axis(dur)
    y = np.zeros_like(t)
    for k in range(1, 14):
        y += np.sin(2 * np.pi * f * k * t) / k * np.exp(-t * (0.8 + k * 0.9))
    return y * np.minimum(1, t / 0.002)


def inst_bansuri(f: float, dur: float) -> np.ndarray:
    """Bamboo flute: soft fundamental, delayed vibrato, breath noise."""
    t = t_axis(dur)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.25) / 0.4, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    y = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
    breath = lowpass(noise(len(t), int(f) % 97), 2600) * 0.12
    env = env_adsr(len(t), min(0.12, dur * 0.3), 0.1, 0.85, min(0.25, dur * 0.4))
    return (y + breath) * env


def inst_harmonium(f: float, dur: float) -> np.ndarray:
    """Reed organ: rich harmonics with two slightly detuned reeds."""
    t = t_axis(dur)
    y = np.zeros_like(t)
    for d in (0.0, 0.0035):
        for k in range(1, 9):
            y += np.sin(2 * np.pi * f * (1 + d) * k * t + k) * (1 / k ** 1.1) * (1.0 if k % 2 else 0.7)
    return y * env_adsr(len(t), 0.18, 0.2, 0.85, 0.35) / 5


def inst_santoor(f: float, dur: float) -> np.ndarray:
    """Hammered dulcimer: bright strike with a soft shimmering tail (paired strings)."""
    t = t_axis(dur)
    y = np.zeros_like(t)
    for d in (-0.002, 0.002):
        for k, a in ((1, 1.0), (2, 0.45), (3, 0.25), (4.1, 0.12), (5.3, 0.06)):
            y += a * np.sin(2 * np.pi * f * (1 + d) * k * t) * np.exp(-t * (1.6 + k * 1.4))
    return y * np.minimum(1, t / 0.002) * 0.6


def inst_tanpura(f: float, dur: float) -> np.ndarray:
    """Drone with jawari buzz: many harmonics swelling in and out."""
    t = t_axis(dur)
    y = np.zeros_like(t)
    for k in range(1, 14):
        swell = 0.5 + 0.5 * np.sin(2 * np.pi * (0.15 + k * 0.037) * t + k)
        y += np.sin(2 * np.pi * f * k * t) / k ** 0.9 * swell
    return y * env_adsr(len(t), 0.4, 0.3, 0.8, 0.6) / 6


def drum_kick(dur: float = 0.4, punch: float = 1.0) -> np.ndarray:
    t = t_axis(dur)
    f = 45 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.16) * punch + 0.15 * noise(len(t), 3) * np.exp(-t / 0.004)


def drum_snare(dur: float = 0.25) -> np.ndarray:
    t = t_axis(dur)
    n = highpass(noise(len(t), 5), 1500) * np.exp(-t / 0.07)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    return 0.8 * n + 0.5 * body


def drum_hat(dur: float = 0.06, seed: int = 9) -> np.ndarray:
    t = t_axis(dur)
    return highpass(noise(len(t), seed), 7000) * np.exp(-t / 0.018)


def drum_shaker(dur: float = 0.09, seed: int = 11) -> np.ndarray:
    t = t_axis(dur)
    e = np.minimum(1, t / 0.02) * np.exp(-t / 0.03)
    return highpass(noise(len(t), seed), 5000) * e


def drum_tabla(f: float = 260, dur: float = 0.3) -> np.ndarray:
    t = t_axis(dur)
    fr = f * (1 + 0.4 * np.exp(-t / 0.02))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    return np.sin(ph) * np.exp(-t / 0.12) + 0.2 * np.sin(2 * ph) * np.exp(-t / 0.05)


# ----------------------------------------------------------------------------
# composition engine
# ----------------------------------------------------------------------------
SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "phrygdom": [0, 1, 4, 5, 7, 8, 10],
    "pent": [0, 2, 4, 7, 9],
    "bhupali": [0, 2, 4, 7, 9],
    "megh": [0, 2, 5, 7, 10],
    "yaman": [0, 2, 4, 6, 7, 9, 11],
}


@dataclass
class Track:
    name: str
    bpm: float
    root: int  # midi note of tonic
    scale: str
    progression: list[int]  # scale degrees (0-based) per bar
    lead: str = "bell"
    arp: str | None = "pluck"
    pad: bool = True
    bass: str | None = "bass"
    drums: str = "soft"  # soft | groove | hand | none | drive
    bars: int = 16
    density: float = 0.6
    reverb_s: float = 2.4
    reverb_mix: float = 0.3
    seed: int = 1
    swing: float = 0.0
    lead_oct: int = 12
    extra: dict = field(default_factory=dict)


def scale_note(tr: Track, degree: int, octave: int = 0) -> int:
    sc = SCALES[tr.scale]
    o, d = divmod(degree, len(sc))
    return tr.root + sc[d] + 12 * (o + octave)


def chord(tr: Track, degree: int) -> list[int]:
    return [scale_note(tr, degree), scale_note(tr, degree + 2), scale_note(tr, degree + 4)]


def place(buf: np.ndarray, sig: np.ndarray, start_s: float, gain: float, pan: float = 0.0) -> None:
    i = int(start_s * SR)
    if i >= buf.shape[0]:
        return
    j = min(buf.shape[0], i + len(sig))
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[i:j, 0] += sig[: j - i] * gain * l
    buf[i:j, 1] += sig[: j - i] * gain * r


LEADS = {
    "bell": lambda f, d: inst_bell(f, d + 1.2),
    "kalimba": lambda f, d: inst_kalimba(f, d + 0.8),
    "marimba": lambda f, d: inst_marimba(f, d + 0.6),
    "pluck": lambda f, d: inst_pluck(f, d + 0.6),
    "oud": lambda f, d: inst_oud(f, d + 0.8),
    "brass": lambda f, d: inst_brass(f, d),
    "bansuri": lambda f, d: inst_bansuri(f, d + 0.15),
    "santoor": lambda f, d: inst_santoor(f, d + 1.2),
}


def render_track(tr: Track) -> np.ndarray:
    rng = np.random.default_rng(tr.seed)
    beat = 60.0 / tr.bpm
    bar = beat * 4
    total = tr.bars * bar
    tail = tr.reverb_s + 1.0
    buf = np.zeros((int((total + tail) * SR), 2))
    sc_len = len(SCALES[tr.scale])

    # --- melody motif: generated once per 2 bars and varied for repetition ----
    motif_cache: dict[int, list[tuple[float, int, float]]] = {}

    def motif(seed_bar: int) -> list[tuple[float, int, float]]:
        if seed_bar in motif_cache:
            return motif_cache[seed_bar]
        r = np.random.default_rng(tr.seed * 100 + seed_bar)
        notes = []
        pos = 0.0
        deg = int(r.integers(0, 5))
        while pos < 8:  # 8 beats = 2 bars
            dur = r.choice([0.5, 0.5, 1.0, 1.0, 1.5, 2.0], p=[0.25, 0.15, 0.25, 0.15, 0.1, 0.1])
            if r.random() < tr.density:
                notes.append((pos, deg, dur))
            deg += int(r.choice([-2, -1, -1, 1, 1, 2, 3, -3]))
            deg = int(np.clip(deg, -2, 9))
            pos += dur
        motif_cache[seed_bar] = notes
        return notes

    for b in range(tr.bars):
        t0 = b * bar
        deg = tr.progression[b % len(tr.progression)]
        ch = chord(tr, deg)

        # pad
        if tr.pad:
            pad_fn = inst_harmonium if tr.extra.get("pad_inst") == "harmonium" else inst_pad
            for m in ch:
                place(buf, pad_fn(midi_hz(m), bar + 0.4), t0, 0.07, pan=rng.uniform(-0.4, 0.4))
        if tr.extra.get("drone"):
            place(buf, inst_tanpura(midi_hz(tr.root - 12), bar + 0.8), t0, 0.12, pan=-0.25)
            place(buf, inst_tanpura(midi_hz(tr.root - 5), bar + 0.8), t0 + beat * 2, 0.08, pan=0.25)

        # bass
        if tr.bass:
            pattern = tr.extra.get("bass_pattern", [0, 2.5, 3])
            for k, p in enumerate(pattern):
                note = ch[0] - 24 + (7 if k == 2 and tr.drums == "drive" else 0)
                place(buf, inst_bass(midi_hz(note), beat * 0.9), t0 + p * beat, 0.32)

        # arpeggio
        if tr.arp:
            fn = LEADS[tr.arp]
            step = tr.extra.get("arp_step", 0.5)
            n_steps = int(4 / step)
            order = [0, 1, 2, 1] if tr.extra.get("arp_shape", "updown") == "updown" else [0, 1, 2, 3]
            for k in range(n_steps):
                idx = order[k % len(order)]
                m = ch[idx % 3] + (12 if idx == 3 else 0)
                sw = tr.swing * beat * step if k % 2 else 0
                place(buf, fn(midi_hz(m), step * beat) * 0.9, t0 + k * step * beat + sw, 0.09,
                      pan=0.35 * np.sin(k * 0.9))

        # lead melody (enters after 4 bars, takes a breath every 8)
        if tr.lead and b >= 4 and (b % 8) != 7:
            src_bar = (b // 2) % 2
            notes = motif(src_bar)
            if b % 2 == 0:
                for pos, d, dur in notes:
                    m = scale_note(tr, deg + d - deg % 2, 0) + tr.lead_oct
                    # snap strong beats to chord tones for consonance
                    if pos % 2 == 0:
                        m = min(ch, key=lambda c: abs((c + tr.lead_oct) - m)) + tr.lead_oct
                    place(buf, LEADS[tr.lead](midi_hz(m), dur * beat), t0 + pos * beat, 0.16,
                          pan=rng.uniform(-0.15, 0.15))

        # drums
        if tr.drums != "none" and b >= 2:
            for k in range(16):
                tt = t0 + k * beat / 4 + (tr.swing * beat / 4 if k % 2 else 0)
                if tr.drums == "soft":
                    if k in (0, 10):
                        place(buf, drum_kick(punch=0.8), tt, 0.4)
                    if k % 4 == 2:
                        place(buf, drum_shaker(seed=k), tt, 0.12, pan=0.3)
                    if k == 8:
                        place(buf, drum_snare() * 0.5, tt, 0.18)
                elif tr.drums == "groove":
                    if k in (0, 6, 10):
                        place(buf, drum_kick(), tt, 0.45)
                    if k in (4, 12):
                        place(buf, drum_snare(), tt, 0.25)
                    if k % 2 == 0:
                        place(buf, drum_hat(seed=k), tt, 0.08 if k % 4 else 0.12, pan=-0.3)
                elif tr.drums == "hand":
                    if k in (0, 7, 10):
                        place(buf, drum_tabla(110), tt, 0.4)
                    if k in (3, 6, 11, 14):
                        place(buf, drum_tabla(330 + 40 * (k % 3)), tt, 0.18, pan=0.25)
                    if k % 2 == 1:
                        place(buf, drum_shaker(seed=k), tt, 0.07, pan=-0.3)
                elif tr.drums == "drive":
                    if k % 4 == 0:
                        place(buf, drum_kick(punch=1.1), tt, 0.5)
                    if k in (4, 12):
                        place(buf, drum_snare(), tt, 0.3)
                    place(buf, drum_hat(seed=k), tt, 0.1 if k % 2 else 0.05, pan=0.3)
                elif tr.drums in ("dholki", "dholki_soft"):
                    soft = tr.drums == "dholki_soft"
                    bass = (0, 8) if soft else (0, 6, 8, 14)
                    slap = (6, 12) if soft else (3, 4, 10, 12)
                    if k in bass:
                        place(buf, drum_tabla(115 + (k % 3) * 6), tt, 0.32 if soft else 0.4)
                    if k in slap:
                        place(buf, drum_tabla(390 + 30 * (k % 2)), tt, 0.12 if soft else 0.17, pan=0.25)
                    if not soft and k % 2 == 1:
                        place(buf, drum_shaker(seed=k), tt, 0.05, pan=-0.3)
                elif tr.drums == "dadra":
                    if k in (0, 9):
                        place(buf, drum_tabla(118), tt, 0.36)
                    if k in (3, 6, 12, 14):
                        place(buf, drum_tabla(400 + 25 * (k % 3)), tt, 0.13, pan=0.2)
                    if k in (5, 11):
                        place(buf, drum_shaker(seed=k), tt, 0.05, pan=-0.3)
                elif tr.drums == "sparse":
                    if k == 0 and b % 2 == 0:
                        place(buf, drum_kick(punch=0.6), tt, 0.35)
                    if k in (6, 14):
                        place(buf, drum_shaker(seed=k), tt, 0.06, pan=0.4)

    # mastering: reverb per channel (decorrelated IRs), then wrap tail for seamless loop
    out = np.zeros_like(buf)
    for c in range(2):
        wet = reverb(buf[:, c], tr.reverb_s, tr.reverb_mix, seed=17 + c * 31)
        out[:, c] = wet[: len(buf)]
    loop_n = int(total * SR)
    loop = out[:loop_n].copy()
    tail_part = out[loop_n:]
    loop[: len(tail_part)] += tail_part[: loop_n]
    # gentle glue compression
    loop = np.tanh(loop * 1.6) / 1.6
    return normalize(loop, 0.8)


TRACKS = [
    Track("title", 88, 62, "major", [0, 4, 5, 3, 0, 4, 3, 4], lead="bell", arp="kalimba", drums="soft",
          bars=16, density=0.55, seed=3, reverb_s=3.0, reverb_mix=0.38),
    Track("meadows", 100, 67, "major", [0, 4, 5, 3], lead="kalimba", arp="pluck", drums="soft",
          bars=16, density=0.7, seed=11, swing=0.12),
    Track("falls", 108, 64, "dorian", [0, 5, 3, 6], lead="marimba", arp="marimba", drums="groove",
          bars=16, density=0.65, seed=21, extra={"arp_step": 0.25, "arp_shape": "up"}),
    Track("dunes", 94, 57, "phrygdom", [0, 1, 0, 6], lead="oud", arp="oud", drums="hand",
          bars=16, density=0.75, seed=31, extra={"arp_step": 0.5}),
    Track("nebula", 72, 65, "lydian", [0, 1, 5, 4], lead="bell", arp="bell", drums="sparse",
          bars=12, density=0.45, seed=41, reverb_s=4.0, reverb_mix=0.5, lead_oct=12),
    Track("citadel", 124, 60, "minor", [0, 5, 2, 6], lead="brass", arp="pluck", drums="drive",
          bars=16, density=0.7, seed=51, extra={"bass_pattern": [0, 0.75, 1.5, 2.5, 3.0], "arp_step": 0.25}),
    # ---- Marathi Manus campaign: original folk-inspired, deliberately soothing ----
    Track("manus", 92, 62, "bhupali", [0, 0, 3, 4, 0, 0, 4, 3], lead="bansuri", arp="santoor", drums="dholki",
          bars=16, density=0.6, seed=61, bass=None, extra={"pad_inst": "harmonium", "drone": True, "arp_step": 0.5}),
    Track("sahyadri", 76, 60, "megh", [0, 0, 3, 2], lead="bansuri", arp="santoor", drums="dholki_soft",
          bars=16, density=0.5, seed=71, bass=None, reverb_s=3.4, reverb_mix=0.42, pad=False,
          extra={"drone": True, "arp_step": 1.0}),
    Track("konkan", 84, 65, "bhupali", [0, 3, 0, 4], lead="bansuri", arp="santoor", drums="dadra",
          bars=16, density=0.55, seed=81, bass="bass", extra={"pad_inst": "harmonium", "arp_step": 0.5, "bass_pattern": [0, 2.0]}),
    Track("kandil", 70, 64, "yaman", [0, 1, 4, 0], lead="bell", arp="santoor", drums="dholki_soft",
          bars=12, density=0.45, seed=91, bass=None, reverb_s=4.0, reverb_mix=0.5,
          extra={"drone": True, "pad_inst": "harmonium", "arp_step": 1.0}),
]


# ----------------------------------------------------------------------------
# sound effects
# ----------------------------------------------------------------------------
def sweep(f0: float, f1: float, dur: float, shape: str = "sine", curve: float = 1.0) -> np.ndarray:
    t = t_axis(dur)
    u = (t / dur) ** curve
    f = f0 * (f1 / f0) ** u
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == "square":
        return np.tanh(4 * np.sin(ph))
    if shape == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    return np.sin(ph)


def sfx_all() -> dict[str, np.ndarray]:
    s: dict[str, np.ndarray] = {}
    d = 0.18
    s["jump"] = sweep(320, 720, d, "tri", 0.6) * env_adsr(int(d * SR), 0.005, 0.05, 0.6, 0.1) * 0.7
    d = 0.24
    j2 = sweep(520, 1250, d, "tri", 0.5) * env_adsr(int(d * SR), 0.005, 0.06, 0.5, 0.15)
    j2 += 0.3 * inst_bell(1568, d)[: len(j2)]
    s["djump"] = reverb(j2, 0.6, 0.25)
    t = t_axis(0.16)
    s["land"] = (np.sin(2 * np.pi * (90 + 80 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.05)
                 + 0.4 * lowpass(noise(len(t), 2), 900) * np.exp(-t / 0.03))
    s["step"] = lowpass(noise(int(0.05 * SR), 4), 1400) * exp_decay(int(0.05 * SR), 0.012) * 0.6
    sp = np.zeros(int(0.5 * SR))
    for k, m in enumerate([88, 95]):
        b = inst_bell(midi_hz(m), 0.4)
        i = int(k * 0.06 * SR)
        sp[i:i + len(b)] += b[: len(sp) - i]
    s["spark"] = reverb(sp, 0.9, 0.3)
    tk = np.zeros(int(1.2 * SR))
    for k, m in enumerate([79, 83, 86, 91, 95]):
        b = inst_bell(midi_hz(m), 0.8)
        i = int(k * 0.07 * SR)
        tk[i:i + len(b)] += b[: len(tk) - i] * (0.7 + 0.1 * k)
    s["token"] = reverb(tk, 1.6, 0.35)
    st = sweep(600, 150, 0.15, "square") * exp_decay(int(0.15 * SR), 0.05) * 0.5
    st += 0.5 * sweep(900, 1800, 0.15, "sine") * exp_decay(int(0.15 * SR), 0.04)
    s["stomp"] = st
    s["hurt"] = sweep(500, 140, 0.35, "square", 0.7) * env_adsr(int(0.35 * SR), 0.005, 0.1, 0.5, 0.2) * 0.45
    w = highpass(noise(int(0.25 * SR), 6), 800) * env_adsr(int(0.25 * SR), 0.15, 0.05, 0.3, 0.05)
    s["pound"] = w * 0.5 + 0.3 * sweep(900, 200, 0.25, "tri")
    t = t_axis(0.5)
    pl = (np.sin(2 * np.pi * (50 + 120 * np.exp(-t / 0.03)) * t) * np.exp(-t / 0.18)
          + 0.6 * lowpass(noise(len(t), 8), 1200) * np.exp(-t / 0.08))
    s["pound_land"] = normalize(pl, 0.95)
    t = t_axis(0.45)
    f = 180 + 520 * (t / 0.45) ** 0.5 + 40 * np.sin(2 * np.pi * 28 * t)
    s["bounce"] = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_adsr(len(t), 0.005, 0.1, 0.6, 0.25) * 0.7
    cp = np.zeros(int(1.6 * SR))
    for k, m in enumerate([72, 76, 79, 84]):
        b = inst_bell(midi_hz(m), 1.2)
        i = int(k * 0.09 * SR)
        cp[i:i + len(b)] += b[: len(cp) - i]
    s["checkpoint"] = reverb(cp, 2.0, 0.35)
    win = np.zeros(int(3.0 * SR))
    for k, (m, tt) in enumerate([(72, 0), (76, 0.12), (79, 0.24), (84, 0.36), (88, 0.6), (91, 0.72)]):
        b = inst_bell(midi_hz(m), 1.8) + 0.4 * inst_pluck(midi_hz(m - 12), 1.8)
        i = int(tt * SR)
        win[i:i + len(b)] += b[: len(win) - i]
    for m in (60, 64, 67, 72):
        p = inst_pad(midi_hz(m), 2.2)
        i = int(0.6 * SR)
        win[i:i + len(p)] += p[: len(win) - i] * 0.5
    s["win"] = reverb(win, 2.5, 0.35)
    s["fall"] = sweep(900, 120, 0.9, "tri", 1.4) * env_adsr(int(0.9 * SR), 0.01, 0.2, 0.7, 0.3) * 0.5
    s["click"] = inst_bell(1320, 0.12) * exp_decay(int(0.12 * SR), 0.03)
    s["hover"] = inst_bell(1760, 0.08) * exp_decay(int(0.08 * SR), 0.015) * 0.5
    po = sweep(200, 1200, 1.2, "sine", 0.4) * env_adsr(int(1.2 * SR), 0.6, 0.2, 0.5, 0.4)
    s["portal"] = reverb(po * 0.5, 1.5, 0.4)
    t = t_axis(0.3)
    s["zap"] = sweep(1800, 300, 0.3, "square", 0.5) * np.exp(-t / 0.1) * 0.35
    return {k: normalize(v, 0.85) for k, v in s.items()}


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/audio")
    out.mkdir(parents=True, exist_ok=True)
    sfx = sfx_all()
    for name, data in sfx.items():
        write_wav(out / f"sfx_{name}.wav", data)
    print(f"  [audio] {len(sfx)} sound effects")
    for tr in TRACKS:
        data = render_track(tr)
        write_wav(out / f"music_{tr.name}.wav", data)
        print(f"  [audio] music_{tr.name}.wav  {len(data) / SR:5.1f}s  {tr.bpm:.0f} bpm  {tr.scale}")


if __name__ == "__main__":
    main()
