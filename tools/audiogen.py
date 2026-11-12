"""
CLAWD: The Spark Odyssey — procedural sound-effect generator.

Synthesises every sound effect from scratch (additive synthesis + FFT
convolution reverb) and writes 16-bit WAV files. The soundtrack is not
generated here: it is the author's own recording in assets/music/.

    python tools/audiogen.py <out_dir>
"""
from __future__ import annotations

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import wave
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
    # dash: airy whoosh with a rising edge
    d = 0.28
    wh = highpass(noise(int(d * SR), 21), 900) * env_adsr(int(d * SR), 0.02, 0.08, 0.35, 0.16)
    s["dash"] = wh * 0.7 + 0.35 * sweep(300, 1400, d, "tri", 0.5) * env_adsr(int(d * SR), 0.01, 0.1, 0.2, 0.15)
    # crate: woody crack + splinters
    t = t_axis(0.35)
    crack = np.sin(2 * np.pi * (140 + 260 * np.exp(-t / 0.015)) * t) * np.exp(-t / 0.05)
    splinter = highpass(noise(len(t), 23), 1800) * np.exp(-t / 0.06) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 37 * t)))
    s["crate"] = crack + 0.7 * splinter + 0.4 * lowpass(noise(len(t), 24), 500) * np.exp(-t / 0.09)
    # quest complete: bright rising triad with a sparkle on top
    q = np.zeros(int(1.4 * SR))
    for k, m in enumerate([76, 80, 83, 88]):
        b = inst_bell(midi_hz(m), 1.0) + 0.5 * inst_pluck(midi_hz(m - 12), 1.0)
        i = int(k * 0.085 * SR)
        q[i:i + len(b)] += b[: len(q) - i] * (0.8 + 0.1 * k)
    s["quest"] = reverb(q, 1.4, 0.3)
    # heart: warm two-note chime
    h = np.zeros(int(0.9 * SR))
    for k, m in enumerate([72, 79]):
        b = inst_bell(midi_hz(m), 0.7, bright=0.5)
        i = int(k * 0.12 * SR)
        h[i:i + len(b)] += b[: len(h) - i]
    s["heart"] = reverb(h, 1.0, 0.3)
    return {k: normalize(v, 0.85) for k, v in s.items()}


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/audio")
    out.mkdir(parents=True, exist_ok=True)
    sfx = sfx_all()
    for name, data in sfx.items():
        write_wav(out / f"sfx_{name}.wav", data)
    print(f"  [audio] {len(sfx)} sound effects")


if __name__ == "__main__":
    main()
