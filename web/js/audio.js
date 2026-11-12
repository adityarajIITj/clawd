// WebAudio engine: buffered SFX with pitch variation + crossfading music.
const SFX = ['jump', 'djump', 'land', 'step', 'spark', 'token', 'stomp', 'hurt', 'pound', 'pound_land', 'bounce',
  'checkpoint', 'win', 'fall', 'click', 'hover', 'portal', 'zap', 'dash', 'crate', 'quest', 'heart'];
// The whole soundtrack is the author's own recording, shipped as looping MP3 parts.
const MUSIC = ['title', 'sahyadri', 'konkan', 'kandil', 'ending'];
const FILES = {
  title: 'music_manus_title.mp3', sahyadri: 'music_sahyadri.mp3', konkan: 'music_konkan.mp3',
  kandil: 'music_kandil.mp3', ending: 'music_ending.mp3',
};
const ONE_SHOT = new Set(['ending']);

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.music = null;
    this.musicName = null;
    this.vol = { master: 0.8, music: 0.55, sfx: 0.8 };
    try {
      const saved = JSON.parse(localStorage.getItem('clawd.audio') || 'null');
      if (saved) Object.assign(this.vol, saved);
    } catch (_) { /* ignore */ }
    this.lastPlay = {};
  }

  async init(onProgress) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.applyVolumes();
    // Only one tab/window plays at a time: the one in use claims audio, the others go quiet.
    this.tabId = Math.random();
    this.chan = 'BroadcastChannel' in window ? new BroadcastChannel('clawd-audio') : null;
    if (this.chan) this.chan.onmessage = (e) => { if (e.data && e.data.claim !== this.tabId) this.ctx.suspend(); };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx.suspend();
      else this.resume();
    });
    // Only SFX block startup; music tracks stream in per world (see loadTrack).
    const names = SFX.map((s) => `sfx_${s}`);
    this.loading = {};
    let done = 0;
    await Promise.all(names.map(async (n) => {
      try {
        const res = await fetch(`audio/${n}.wav`);
        const buf = await res.arrayBuffer();
        this.buffers[n] = await this.ctx.decodeAudioData(buf);
      } catch (e) { console.warn('audio load failed', n, e); }
      done++;
      onProgress && onProgress(done / names.length);
    }));
  }

  // Fetch + decode a music track once; concurrent callers share the promise.
  loadTrack(name) {
    const key = `music_${name}`;
    if (this.buffers[key]) return Promise.resolve(this.buffers[key]);
    if (!MUSIC.includes(name)) return Promise.resolve(null);
    if (!this.loading[key]) {
      this.loading[key] = fetch(`audio/${FILES[name] || `${key}.wav`}`)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => { this.buffers[key] = buf; return buf; })
        .catch((e) => { console.warn('music load failed', name, e); delete this.loading[key]; return null; });
    }
    return this.loading[key];
  }

  resume() {
    if (!this.ctx || document.hidden) return;
    if (this.chan) this.chan.postMessage({ claim: this.tabId });
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.musicBus.gain.value = this.vol.music;
    this.sfxBus.gain.value = this.vol.sfx;
    localStorage.setItem('clawd.audio', JSON.stringify(this.vol));
  }

  play(name, { vol = 1, rate = 1, vary = 0.06, throttle = 0.03 } = {}) {
    if (!this.ctx) return;
    const buf = this.buffers[`sfx_${name}`];
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (this.lastPlay[name] && now - this.lastPlay[name] < throttle) return;
    this.lastPlay[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfxBus);
    src.start();
  }

  playMusic(name, fade = 1.5) {
    if (!this.ctx || this.musicName === name) return;
    this.wantMusic = name;
    const buf = this.buffers[`music_${name}`];
    if (!buf) {
      // start when it arrives, unless the player has moved on to another track
      this.loadTrack(name).then((b) => { if (b && this.wantMusic === name) this.playMusic(name, fade); });
      return;
    }
    const now = this.ctx.currentTime;
    if (this.music) {
      const old = this.music;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.src.stop(now + fade + 0.1);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !ONE_SHOT.has(name);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    src.connect(gain).connect(this.musicBus);
    src.start();
    this.music = { src, gain };
    this.musicName = name;
  }

  duck(amount, time = 0.3) {
    if (!this.music) return;
    const now = this.ctx.currentTime;
    this.music.gain.gain.cancelScheduledValues(now);
    this.music.gain.gain.setValueAtTime(this.music.gain.gain.value, now);
    this.music.gain.gain.linearRampToValueAtTime(amount, now + time);
  }
}
