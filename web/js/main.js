// CLAWD: The Spark Odyssey — game bootstrap, state machine and main loop.
import { Renderer, lin } from './gl.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Camera } from './camera.js';
import { Clawd } from './player.js';
import { World } from './level.js';
import { UI, fmtTime, starIcon } from './ui.js';
import { loadNative } from './wasm.js';
import * as M from './meshes.js';
import { v3, clamp } from './math.js';

const STEP = 1 / 120;
const QUALITY = {
  low: { scale: Math.min(window.devicePixelRatio || 1, 1) * 0.85, shadow: 1024, msaa: 0, grass: 0.3, particles: 0.5 },
  medium: { scale: 1.0, shadow: 2048, msaa: 2, grass: 0.7, particles: 0.8 },
  high: { scale: Math.min(window.devicePixelRatio || 1, 1.5), shadow: 2048, msaa: 4, grass: 1.0, particles: 1.0 },
};

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.settings = Object.assign({ quality: 'high', sens: 1, invertY: false, fps: false }, JSON.parse(localStorage.getItem('clawd.settings') || '{}'));
    this.isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
    if (this.isTouch && !localStorage.getItem('clawd.settings')) this.settings.quality = 'low';
    this.applyQualityPreset(false);
    this.save = Object.assign({ unlocked: 1, levels: {} }, JSON.parse(localStorage.getItem('clawd.save') || '{}'));
    this.ui = new UI(this);
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.cam = new Camera();
    this.state = 'boot';
    this.world = null;
    this.time = 0;
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 0;
    this.padNavPrev = 0;
  }

  applyQualityPreset(apply = true) {
    const q = QUALITY[this.settings.quality] || QUALITY.high;
    this.settings.grass = q.grass;
    this.settings.particles = q.particles;
    if (apply && this.renderer) {
      Object.assign(this.renderer.quality, { scale: q.scale, shadow: q.shadow, msaa: q.msaa });
      this.renderer.createShadow();
      this.renderer.targets = null;
      this.renderer.w = 0;
      this.renderer.resize();
    }
    this.qualityPreset = q;
  }

  async boot() {
    try {
      this.ui.setLoading(0.05, 'Waking the renderer…');
      this.renderer = new Renderer(this.canvas);
      Object.assign(this.renderer.quality, { scale: this.qualityPreset.scale, shadow: this.qualityPreset.shadow, msaa: this.qualityPreset.msaa });
      this.renderer.createShadow();
      this.renderer.targets = null;
      this.renderer.resize();
      this.ui.setLoading(0.15, 'Loading native cores (Rust + C++)…');
      this.native = await loadNative();
      this.ui.setLoading(0.3, 'Reading the world atlas…');
      this.manifest = await (await fetch('levels/manifest.json')).json();
      this.levels = {};
      await Promise.all(this.manifest.map(async (m) => { this.levels[m.id] = await (await fetch(`levels/${m.file}`)).json(); }));
      this.ui.setLoading(0.4, 'Sculpting Clawd…');
      const r = this.renderer;
      this.shared = {
        clawd: M.buildClawd(r),
        spark: M.buildSpark(r),
        token: M.buildToken(r),
        checkpoint: M.buildCheckpoint(r),
        portal: M.buildPortal(r),
        glitch: M.buildGlitchling(r),
        wisp: M.buildWisp(r),
        laser: M.buildLaserPost(r),
        shadow: M.buildShadowDisc(r),
        halo: M.buildHalo(r),
      };
      this.player = new Clawd(this.shared.clawd);
      this.ui.setLoading(0.5, 'Composing the soundtrack…');
      await this.audio.init((p) => this.ui.setLoading(0.5 + p * 0.45, 'Tuning the sound effects…'));
      this.audio.loadTrack('title');
      this.ui.setLoading(1, 'Ready');
      this.loadWorld(1);
      this.toTitle();
      this.ui.hideLoading();
    } catch (e) {
      console.error(e);
      document.getElementById('loadlabel').textContent = `Error: ${e.message}`;
      return;
    }
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    addEventListener('pointerdown', () => this.audio.resume(), { once: true });
    addEventListener('keydown', () => this.audio.resume(), { once: true });
  }

  // ---------------------------------------------------------------------------
  // worlds
  // ---------------------------------------------------------------------------
  loadWorld(id) {
    if (this.world) this.world.dispose();
    const data = this.levels[id];
    this.levelId = id;
    this.world = new World(this, data);
    const s = data.spawn;
    this.native.physics.playerParams(data.gravity || 1, 1);
    this.native.physics.playerReset(s[0], s[1], s[2]);
    this.player.snapTo(this.native.physics.state());
    this.player.yaw = 0;
    this.player.dance = false;
    this.cam.mode = 'follow';
    this.cam.snap(s, 0);
    this.hearts = 3;
    this.invuln = 0;
    this.levelTime = 0;
    this.combo = 0; this.comboT = 0;
    this.heartSparks = 0;
    this.renderer.post = { ...this.renderer.post, ...this.world.post, fade: 0, hurt: 0 };
    this.ui.resetHUD();
  }

  toTitle() {
    this.state = 'title';
    if (this.levelId !== 1) this.loadWorld(1);
    this.cam.mode = 'orbit';
    this.ui.showHUD(false);
    this.input.wantLock = false;
    this.input.releaseLock();
    this.audio.playMusic('title');
    this.ui.show('title', `
      <div class="title-wrap">
        <div class="logo">
          <div class="logo-star">${starIcon(92, '#d97757')}</div>
          <h1>CLAWD</h1>
          <div class="tagline">The Spark Odyssey</div>
        </div>
        <div class="menu">
          <button data-act="play">Play</button>
          <button data-act="settings">Settings</button>
          <button data-act="howto">How to Play</button>
          <button data-act="credits">Credits</button>
        </div>
        <div class="foot">Rendered in WebGL2 · Physics in Rust · VFX in C++ · Levels &amp; music generated in Python</div>
      </div>`, 'title');
  }

  showSelect() {
    this.state = 'select';
    const cards = this.manifest.map((m) => {
      const lv = this.levels[m.id];
      const th = lv.theme;
      const rec = this.save.levels[m.id] || {};
      const locked = m.id > this.save.unlocked;
      const toks = rec.tokens || [false, false, false];
      const grad = `linear-gradient(180deg, ${rgb(th.skyTop)} 0%, ${rgb(th.skyHorizon)} 62%, ${rgb(th.floorColor)} 100%)`;
      return `
        <button class="card ${locked ? 'locked' : ''}" data-act="${locked ? 'locked' : 'world'}" data-id="${m.id}">
          <div class="card-art" style="background:${grad}">
            <div class="card-num">${m.id}</div>
            ${artFor(m.id)}
            ${locked ? '<div class="lock">Locked</div>' : ''}
          </div>
          <div class="card-body">
            <div class="card-title">${m.name}</div>
            <div class="card-sub">${m.subtitle}</div>
            <div class="card-stats">
              <span>${starIcon(13, '#d97757')} ${rec.sparks ?? 0}/${m.sparks}</span>
              <span class="tok">${toks.map((t) => `<i class="${t ? 'on' : ''}"></i>`).join('')}</span>
              <span>${rec.best ? fmtTime(rec.best) : '—'}</span>
              ${rec.rank ? `<span class="rank r-${rec.rank}">${rec.rank}</span>` : ''}
            </div>
          </div>
        </button>`;
    }).join('');
    this.ui.show('select', `
      <div class="select-wrap">
        <h2>Choose a World</h2>
        <div class="cards">${cards}</div>
        <div class="row"><button data-act="title" class="ghost">Back</button></div>
      </div>`, 'select');
  }

  startWorld(id) {
    this.loadWorld(id);
    const lv = this.levels[id];
    this.state = 'intro';
    this.ui.showHUD(false);
    this.audio.playMusic(lv.music);
    const goal = lv.goal, s = lv.spawn;
    this.cam.mode = 'cine';
    const behind = () => ({ pos: this.cam.desired(), look: [s[0], s[1] + 1, s[2]] });
    this.cam.startCine({ pos: [goal[0] + 18, goal[1] + 22, goal[2] + 20], look: goal }, behind, 6.5, () => { this.cam.mode = 'hold'; });
    this.ui.show('intro', `
      <div class="intro">
        <div class="kicker">World ${id}</div>
        <h2>${lv.name}</h2>
        <div class="sub">${lv.subtitle}</div>
        <p class="story">${lv.story}</p>
        <div class="row"><button data-act="begin">Begin</button><button data-act="select" class="ghost">Back</button></div>
      </div>`, 'intro');
  }

  begin() {
    const lv = this.levels[this.levelId];
    this.ui.hide();
    this.cam.mode = 'follow';
    this.cam.cine = null;
    this.state = 'play';
    this.ui.showHUD(true);
    this.input.wantLock = true;
    this.ui.showBanner(lv.name, `World ${lv.id}`);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.audio.duck(0.35);
    this.ui.show('pause', `
      <div class="panel">
        <h2>Paused</h2>
        <div class="menu">
          <button data-act="resume">Resume</button>
          <button data-act="restart">Restart World</button>
          <button data-act="settings">Settings</button>
          <button data-act="select">Quit to Worlds</button>
        </div>
      </div>`, 'dim');
  }

  resume() {
    this.ui.hide();
    this.state = 'play';
    this.audio.duck(1);
  }

  action(act, data) {
    switch (act) {
      case 'play': this.showSelect(); break;
      case 'select': this.audio.duck(1); this.showSelect(); if (this.levelId) this.ui.showHUD(false); break;
      case 'title': this.toTitle(); break;
      case 'world': this.startWorld(+data.id); break;
      case 'begin': this.begin(); break;
      case 'resume': this.resume(); break;
      case 'restart': this.audio.duck(1); this.startWorld(this.levelId); break;
      case 'next': {
        const n = this.levelId + 1;
        if (this.levels[n]) this.startWorld(n); else this.showEnding();
        break;
      }
      case 'settings': this.showSettings(); break;
      case 'settings-back': if (this.prevState === 'paused') { this.state = 'play'; this.pause(); } else this.toTitle(); break;
      case 'howto': this.showHowTo(); break;
      case 'credits': this.showCredits(); break;
      case 'setting': this.setSetting(data.key, data.value); break;
      default: break;
    }
  }

  showSettings() {
    this.prevState = this.state;
    const v = this.audio.vol, s = this.settings;
    const slider = (key, label, val, min = 0, max = 1, step = 0.05) =>
      `<label class="set"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-key="${key}"></label>`;
    this.ui.show('settings', `
      <div class="panel wide">
        <h2>Settings</h2>
        <div class="settings">
          ${slider('master', 'Master volume', v.master)}
          ${slider('music', 'Music', v.music)}
          ${slider('sfx', 'Sound effects', v.sfx)}
          ${slider('sens', 'Camera sensitivity', s.sens, 0.3, 2.5, 0.1)}
          <label class="set"><span>Graphics quality</span>
            <select data-key="quality">${['low', 'medium', 'high'].map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></label>
          <label class="set"><span>Invert camera Y</span><input type="checkbox" data-key="invertY" ${s.invertY ? 'checked' : ''}></label>
          <label class="set"><span>Show FPS</span><input type="checkbox" data-key="fps" ${s.fps ? 'checked' : ''}></label>
        </div>
        <div class="row"><button data-act="settings-back">Done</button></div>
      </div>`, this.prevState === 'paused' ? 'dim' : '');
    if (this.prevState === 'paused') this.state = 'paused';
  }

  setSetting(key, value) {
    if (['master', 'music', 'sfx'].includes(key)) { this.audio.vol[key] = +value; this.audio.applyVolumes(); return; }
    if (key === 'sens') this.settings.sens = +value;
    if (key === 'invertY') this.settings.invertY = !!value;
    if (key === 'fps') this.settings.fps = !!value;
    if (key === 'quality') { this.settings.quality = value; this.applyQualityPreset(true); }
    this.cam.sens = this.settings.sens;
    this.cam.invertY = this.settings.invertY;
    localStorage.setItem('clawd.settings', JSON.stringify({ quality: this.settings.quality, sens: this.settings.sens, invertY: this.settings.invertY, fps: this.settings.fps }));
  }

  showHowTo() {
    this.ui.show('howto', `
      <div class="panel wide">
        <h2>How to Play</h2>
        <div class="howto">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Move (camera-relative)</span></div>
          <div><kbd>Space</kbd><span>Jump · press again mid-air to double jump</span></div>
          <div><kbd>Shift</kbd><span>Ground pound (in the air)</span></div>
          <div><kbd>Mouse</kbd><span>Click &amp; drag / pointer-lock to orbit · wheel to zoom</span></div>
          <div><kbd>Q</kbd><kbd>E</kbd><span>Rotate the camera</span></div>
          <div><kbd>Esc</kbd><span>Pause</span></div>
          <div><kbd>📱</kbd><span>Touch: drag left side to move · drag right side to look · Jump &amp; Pound buttons · ❚❚ to pause</span></div>
          <div><kbd>🎮</kbd><span>Gamepad: left stick move · A jump · X / triggers pound · right stick camera</span></div>
        </div>
        <p class="note">Collect <b>Sparks</b> to restore the Great Context Window — every 20 Sparks restores a heart. Find all three golden <b>Tokens</b> hidden in each world. Stomp <b>Glitchlings</b> and <b>Wisps</b>, hop over sunbeam sweepers, and touch <b>Lighthouses</b> to save your progress. Reach the portal to finish the world.</p>
        <div class="row"><button data-act="title">Back</button></div>
      </div>`);
  }

  showCredits() {
    this.ui.show('credits', `
      <div class="panel wide">
        <h2>Credits</h2>
        <p class="note center">A small adventure starring Clawd, Claude's helpful little mascot.</p>
        <div class="credits">
          <div><b>Rendering</b><span>WebGL2 · custom GLSL: soft shadows, HDR bloom, ACES tonemapping, illustrative toon lighting</span></div>
          <div><b>Gameplay core</b><span>Rust → WebAssembly: character controller &amp; procedural island sculpting</span></div>
          <div><b>VFX core</b><span>Freestanding C++ → WebAssembly: 8k-particle simulation</span></div>
          <div><b>Tools</b><span>Python: level compiler &amp; reachability linter, procedural synthesizer for every note and sound</span></div>
          <div><b>Assets</b><span>None. Every mesh, texture, note and level is generated from code.</span></div>
        </div>
        <div class="row"><button data-act="title">Back</button></div>
      </div>`);
  }

  showEnding() {
    this.state = 'ending';
    this.ui.showHUD(false);
    this.audio.playMusic('title');
    const total = Object.values(this.save.levels).reduce((a, l) => a + (l.tokens || []).filter(Boolean).length, 0);
    this.ui.show('ending', `
      <div class="panel wide ending">
        <div class="logo-star small">${starIcon(64, '#d97757')}</div>
        <h2>The Great Context Window is restored</h2>
        <p class="story">Spark by spark, Clawd carried every lost thought home. The Window glows again over the five realms, wide enough to hold every question anyone might ask. Somewhere in the meadows, a new prompt is already being written.</p>
        <p class="note center">Golden Tokens found: <b>${total} / 15</b></p>
        <div class="row"><button data-act="select">World Map</button><button data-act="title" class="ghost">Title</button></div>
      </div>`);
  }

  // ---------------------------------------------------------------------------
  // gameplay events
  // ---------------------------------------------------------------------------
  hurt(from, zap) {
    if (this.invuln > 0 || this.state !== 'play') return;
    this.hearts--;
    this.invuln = 1.6;
    this.player.flash = 0.25;
    this.cam.shake = 0.8;
    this.renderer.post.hurt = 1;
    this.audio.play(zap ? 'zap' : 'hurt');
    const p = this.player.pos;
    const d = v3.norm([p[0] - from[0], 0, p[2] - from[2]]);
    this.native.physics.knock(d[0] * 9, 11, d[2] * 9);
    this.native.fx.emit(this.native.fx.T.BURST, [p[0], p[1] + 0.6, p[2]], 18, [2.4, 0.6, 0.4], 5);
    if (this.hearts <= 0) setTimeout(() => this.gameOver(), 500);
  }

  fell() {
    if (this.state !== 'play') return;
    this.state = 'respawn';
    this.hearts--;
    this.audio.play('fall');
    this.respawnT = 0;
  }

  gameOver() {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.input.releaseLock();
    this.audio.duck(0.3);
    this.ui.show('gameover', `
      <div class="panel">
        <h2>Context Lost</h2>
        <p class="note center">Even the best helpers need a second try.</p>
        <div class="menu">
          <button data-act="restart">Try Again</button>
          <button data-act="select">Quit to Worlds</button>
        </div>
      </div>`, 'dim');
  }

  complete() {
    if (this.state !== 'play') return;
    this.state = 'complete';
    this.completeT = 0;
    this.player.dance = true;
    this.audio.play('portal');
    setTimeout(() => this.audio.play('win'), 400);
    this.audio.duck(0.25, 0.6);
    const fx = this.native.fx;
    const p = this.player.pos;
    fx.emit(fx.T.CONFETTI, [p[0], p[1] + 2, p[2]], 220, [1, 1, 1], 11);
    this.input.releaseLock();
    this.ui.showHUD(false);

    const w = this.world, lv = this.levels[this.levelId];
    const tokens = w.tokenGot;
    const sparkRatio = w.sparkGot / w.sparkTotal;
    const timeScore = clamp(1 - (this.levelTime - lv.parTime) / lv.parTime, 0, 1);
    const score = sparkRatio * 55 + tokens.filter(Boolean).length * 10 + timeScore * 15;
    const rank = score >= 88 ? 'S' : score >= 72 ? 'A' : score >= 52 ? 'B' : 'C';
    const rec = this.save.levels[this.levelId] || {};
    const newBest = !rec.best || this.levelTime < rec.best;
    const ranks = 'CBAS';
    this.save.levels[this.levelId] = {
      best: newBest ? this.levelTime : rec.best,
      sparks: Math.max(rec.sparks || 0, w.sparkGot),
      tokens: [0, 1, 2].map((i) => !!((rec.tokens || [])[i] || tokens[i])),
      rank: !rec.rank || ranks.indexOf(rank) > ranks.indexOf(rec.rank) ? rank : rec.rank,
      done: true,
    };
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(this.manifest.length, this.levelId + 1));
    localStorage.setItem('clawd.save', JSON.stringify(this.save));
    const hasNext = !!this.levels[this.levelId + 1];
    setTimeout(() => {
      this.ui.show('results', `
        <div class="panel results">
          <div class="kicker">World ${this.levelId} complete</div>
          <h2>${lv.name}</h2>
          <div class="rank-big r-${rank}">${rank}</div>
          <div class="res-grid">
            <div><span>Sparks</span><b>${w.sparkGot} / ${w.sparkTotal}</b></div>
            <div><span>Tokens</span><b class="tok">${tokens.map((t) => `<i class="${t ? 'on' : ''}"></i>`).join('')}</b></div>
            <div><span>Time</span><b>${fmtTime(this.levelTime)}${newBest ? ' <em>best!</em>' : ''}</b></div>
          </div>
          <div class="menu">
            <button data-act="next">${hasNext ? 'Next World' : 'Finale'}</button>
            <button data-act="restart" class="ghost">Replay</button>
            <button data-act="select" class="ghost">World Map</button>
          </div>
        </div>`, 'dim-soft');
    }, 1800);
  }

  // ---------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------
  frame(dt) {
    this.time += dt;
    const keys = new Set(this.input.pressed);
    const inp = this.input.poll();
    // gamepad menu navigation
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find(Boolean);
    let navY = 0;
    if (gp) {
      const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
      const v = Math.abs(ay) > 0.6 ? Math.sign(ay) : Math.abs(ax) > 0.6 ? Math.sign(ax) : 0;
      if (v !== this.padNavPrev) navY = v;
      this.padNavPrev = v;
    }
    const menuInp = { navY, padConfirm: inp.confirm && !keys.has('Space') && !keys.has('Enter') };

    if (this.state === 'play') {
      if (inp.pause) this.pause();
      else this.updatePlay(dt, inp);
    } else if (this.state === 'paused') {
      if (inp.pause && this.ui.current === 'pause') this.resume();
      else this.ui.navigate(menuInp, keys);
    } else if (this.state === 'respawn') {
      this.updateRespawn(dt);
    } else if (this.state === 'intro') {
      this.world.step(dt);
      this.ui.navigate(menuInp, keys);
    } else if (this.state === 'complete') {
      this.world.step(dt);
      this.completeT += dt;
      this.player.update(dt, this.native.physics.state());
      if (this.ui.current === 'results') this.ui.navigate(menuInp, keys);
    } else {
      // title / select / menus: idle world in the background
      this.world.step(dt);
      this.player.update(dt, this.native.physics.state());
      this.ui.navigate(menuInp, keys);
    }

    this.input.touch.show(this.state === 'play' || this.state === 'respawn');

    // camera
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    if (this.state === 'title' || this.state === 'select' || this.state === 'ending' || (this.ui.current && ['settings', 'howto', 'credits'].includes(this.ui.current) && this.prevState !== 'paused')) {
      this.cam.mode = 'orbit';
      this.cam.update(dt, { target: this.levels[this.levelId].spawn, dist: 11, height: 3.2, aspect });
    } else if (this.state === 'complete') {
      this.cam.mode = 'orbit';
      this.cam.update(dt * 2.5, { target: this.player.pos, dist: 6.5, height: 2.2, aspect });
    } else if (this.cam.mode === 'cine' || this.cam.mode === 'hold') {
      this.cam.update(this.cam.mode === 'hold' ? 0 : dt, { aspect });
    } else {
      this.cam.update(dt, { player: this.player, input: this.state === 'play' ? inp : null, aspect });
    }

    // post fx easing
    const P = this.renderer.post;
    P.hurt = Math.max(0, P.hurt - dt * 2);

    this.render(dt);

    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    if (this.state === 'play' || this.state === 'respawn') {
      this.ui.updateHUD({ hearts: this.hearts, sparks: this.world.sparkGot, total: this.world.sparkTotal, tokens: this.world.tokenGot, time: this.levelTime, fps: this.settings.fps ? this.fps : 0 });
    }
  }

  updatePlay(dt, inp) {
    const phys = this.native.physics, EV = this.native.EV, fx = this.native.fx;
    this.levelTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    const [ix, iz] = this.cam.moveDir(inp.mx, inp.mz);
    this.acc = (this.acc || 0) + dt;
    let events = 0, first = true;
    let landSpeed = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.world.step(STEP);
      const ev = phys.step(STEP, ix, iz, inp.jumpHeld, first && inp.jump, first && inp.pound);
      if (ev & EV.LAND) landSpeed = phys.state()[11];
      events |= ev;
      first = false;
    }
    if (first && (inp.jump || inp.pound)) {
      // no substep ran this frame: carry the press to the next one
      this.input.pressed.add(inp.jump ? 'Space' : 'ShiftLeft');
    }
    const st = phys.state();
    this.player.onEvents(events, EV, landSpeed);
    this.player.update(dt, st);
    const p = this.player.pos;

    // event-driven audio / vfx
    if (events & EV.JUMP) { this.audio.play('jump', { vol: 0.55 }); fx.emit(fx.T.DUST, p, 6, [1.2, 1.1, 1.0], 2); }
    if (events & EV.DJUMP) { this.audio.play('djump', { vol: 0.6 }); fx.emit(fx.T.RING, [p[0], p[1] + 0.3, p[2]], 14, [2.2, 1.4, 0.8], 4); }
    if (events & EV.POUND) this.audio.play('pound', { vol: 0.6 });
    if (events & EV.POUND_LAND) {
      this.audio.play('pound_land', { vol: 0.9 });
      this.cam.shake = 0.6;
      fx.emit(fx.T.RING, [p[0], p[1] + 0.1, p[2]], 28, [1.6, 1.3, 1.1], 9);
      fx.emit(fx.T.DUST, p, 16, [1.2, 1.1, 1.0], 5);
    } else if (events & EV.LAND) {
      this.audio.play('land', { vol: clamp(landSpeed / 25, 0.15, 0.7) });
      if (landSpeed > 8) fx.emit(fx.T.DUST, p, Math.round(landSpeed / 2), [1.2, 1.1, 1.0], 3);
    }
    if (events & EV.BOUNCE) { this.audio.play('bounce', { vol: 0.8 }); this.world.onBounce(p); fx.emit(fx.T.BURST, p, 20, [2.4, 1.2, 1.4], 6); }

    // footsteps
    const hs = Math.hypot(st[3], st[5]);
    if (this.player.grounded && hs > 2) {
      this.stepT = (this.stepT || 0) + dt * hs;
      if (this.stepT > 2.6) { this.stepT = 0; this.audio.play('step', { vol: 0.25, vary: 0.15 }); fx.emit(fx.T.DUST, p, 1, [1.1, 1.0, 0.95], 1); }
    }

    // world interactions
    const out = this.world.interact(dt, this.player, this.invuln);
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    for (const e of out) {
      if (e.type === 'spark') {
        this.combo++; this.comboT = 1.4;
        this.audio.play('spark', { vol: 0.55, rate: 1 + Math.min(this.combo, 12) * 0.045, vary: 0.01 });
        this.heartSparks++;
        if (this.heartSparks >= 20) {
          this.heartSparks = 0;
          if (this.hearts < 3) { this.hearts++; this.ui.popup('+1 ♥', 'heart'); }
        }
      } else if (e.type === 'token') {
        this.audio.play('token', { vol: 0.9 });
        this.ui.popup(`Golden Token ${this.world.tokenGot.filter(Boolean).length} / 3`, 'token');
        this.cam.shake = 0.3;
      } else if (e.type === 'checkpoint') {
        this.audio.play('checkpoint', { vol: 0.7 });
        this.ui.popup('Lighthouse lit', 'cp');
      } else if (e.type === 'stomp') {
        this.audio.play('stomp', { vol: 0.8 });
        phys.bounce(this.player.pounding ? 9 : 13);
        this.player.sqV += 6;
      } else if (e.type === 'hurt') {
        this.hurt(e.from, e.zap);
      } else if (e.type === 'hint') {
        this.ui.hint(e.text);
      } else if (e.type === 'goal') {
        this.complete();
      }
    }
    if (p[1] < this.world.d.killY) this.fell();
  }

  updateRespawn(dt) {
    this.respawnT += dt;
    this.world.step(dt);
    const P = this.renderer.post;
    if (this.respawnT < 0.6) {
      P.fade = this.respawnT / 0.6;
    } else if (!this.respawned) {
      this.respawned = true;
      if (this.hearts <= 0) { P.fade = 0.4; this.respawned = false; this.gameOver(); return; }
      const sp = this.world.spawnPoint;
      this.native.physics.playerReset(sp[0], sp[1] + 0.2, sp[2]);
      this.player.snapTo(this.native.physics.state());
      this.cam.snap(sp, this.cam.yaw);
      this.invuln = 1.2;
    } else {
      P.fade = Math.max(0, 1 - (this.respawnT - 0.6) / 0.5);
      this.player.update(dt, this.native.physics.state());
      if (this.respawnT > 1.1) { P.fade = 0; this.respawned = false; this.state = 'play'; }
    }
  }

  render(dt) {
    const r = this.renderer;
    const w = this.world;
    w.draw(r, dt, this.cam);
    if (this.state !== 'title' || true) this.player.draw(r, this.state === 'play' ? this.invuln : 0);
    // contact shadow under Clawd
    const p = this.player.pos;
    const gh = this.native.physics.groundHeight(p[0], p[1] + 0.05, p[2], 30);
    if (gh > -1e8) {
      const h = p[1] - gh;
      const s = clamp(1.3 - h * 0.05, 0.4, 1.3);
      r.drawFx({ mesh: this.shared.shadow, model: new Float32Array([s, 0, 0, 0, 0, 1, 0, 0, 0, 0, s, 0, p[0], gh + 0.03, p[2], 1]), mode: 3, alpha: clamp(0.55 - h * 0.02, 0.15, 0.55), depth: 1e4 });
    }
    // particles from the C++ core
    const fxs = this.native.fx.update(dt, this.time, [p[0], p[1], p[2]]);
    r.setParticles(fxs.data, fxs.count);
    r.render(this.cam, w.env, this.time);
  }
}

function rgb(c) { return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; }

// little illustrated vignettes for the world cards (inline SVG)
function artFor(id) {
  const arts = {
    1: `<svg viewBox="0 0 200 110" class="card-svg"><ellipse cx="60" cy="70" rx="46" ry="10" fill="#8fbf5a"/><path d="M14 70 Q60 110 106 70Z" fill="#b9875a"/><ellipse cx="150" cy="52" rx="30" ry="7" fill="#a8c95f"/><path d="M120 52 Q150 85 180 52Z" fill="#c49468"/><circle cx="45" cy="52" r="12" fill="#93c763"/><circle cx="56" cy="46" r="10" fill="#ffb3a0"/><rect x="48" y="56" width="3" height="14" fill="#8a5a3c"/><rect x="140" y="38" width="16" height="12" rx="3" fill="#d97757"/></svg>`,
    2: `<svg viewBox="0 0 200 110" class="card-svg"><rect x="30" y="30" width="34" height="80" rx="4" fill="#5d6b6a"/><rect x="30" y="26" width="34" height="8" rx="3" fill="#4fae6e"/><rect x="120" y="45" width="40" height="65" rx="4" fill="#7c8a86"/><rect x="120" y="41" width="40" height="8" rx="3" fill="#6fbf7a"/><rect x="62" y="34" width="9" height="76" fill="#c4ecf0" opacity=".85"/><rect x="78" y="62" width="30" height="6" rx="3" fill="#c98a55"/></svg>`,
    3: `<svg viewBox="0 0 200 110" class="card-svg"><circle cx="150" cy="48" r="16" fill="#fff0c8"/><rect x="24" y="40" width="40" height="70" fill="#d9895b"/><rect x="24" y="36" width="40" height="7" fill="#f2b880"/><rect x="100" y="60" width="50" height="50" fill="#b0603f"/><rect x="100" y="56" width="50" height="7" fill="#f0c987"/><rect x="40" y="31" width="22" height="2" fill="#ff6a3a"/></svg>`,
    4: `<svg viewBox="0 0 200 110" class="card-svg"><circle cx="30" cy="20" r="1.5" fill="#fff"/><circle cx="90" cy="12" r="1" fill="#fff"/><circle cx="170" cy="25" r="1.5" fill="#fff"/><ellipse cx="60" cy="62" rx="30" ry="7" fill="#8fe3ff"/><path d="M30 62 L60 98 L90 62Z" fill="#5a5fb8"/><ellipse cx="145" cy="45" rx="22" ry="5" fill="#d4a6ff"/><path d="M123 45 L145 75 L167 45Z" fill="#6a4fa8"/><path d="M55 60 L60 40 L65 60Z" fill="#7ae8ff"/></svg>`,
    5: `<svg viewBox="0 0 200 110" class="card-svg"><rect x="86" y="18" width="28" height="92" fill="#2a2530"/><rect x="82" y="14" width="36" height="8" fill="#f2c45a"/><circle cx="100" cy="8" r="5" fill="#ffcf86"/><rect x="20" y="60" width="34" height="50" fill="#3a3440"/><rect x="146" y="50" width="34" height="60" fill="#3a3440"/><rect x="0" y="104" width="200" height="6" fill="#ff5a1a"/></svg>`,
  };
  return arts[id] || '';
}

// expose lin for console tinkering
window.__clawd = { lin };
const game = new Game();
window.game = game;
game.boot();
