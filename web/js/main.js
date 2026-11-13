// CLAWD: The Spark Odyssey — game bootstrap, state machine and main loop.
import { Renderer, lin } from './gl.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Camera } from './camera.js';
import { Clawd, Manus, Mahak, Lingraj } from './player.js';
import { HEROES, HERO_ORDER, SETS, HERO_ART } from './heroes.js';
import { buildMahak, buildLingraj, buildBrahmaKamal, buildMonal, buildRasagola, buildKonarkWheel } from './meshes_heroes.js';
import { buildManus, buildLizard, buildKomodo } from './meshes_mh.js';
import { World } from './level.js';
import { UI, fmtTime, starIcon } from './ui.js';
import { QUESTS, BONUS_STARS, questList, countStars } from './quests.js';
import { loadNative } from './wasm.js';
import * as M from './meshes.js';
import { v3, clamp, m4 } from './math.js';
import { buildRambot, buildSpitpod, buildShellback, buildCrown } from './meshes_foes.js';

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
    const savedHero = localStorage.getItem('clawd.character');
    this.character = HEROES[savedHero] ? savedHero : 'clawd';
    localStorage.removeItem('clawd.profile'); // the old gamer-tag record, no longer used
    this.mapSet = null;
    this.settingsTab = 'sound';
    this.resetArmed = false;
    this.save = Object.assign({ unlocked: 1, unlockedManus: 6, levels: {} }, JSON.parse(localStorage.getItem('clawd.save') || '{}'));
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
        manus: buildManus(r),
        lizard: buildLizard(r),
        komodo: buildKomodo(r),
        mahak: buildMahak(r),
        lingraj: buildLingraj(r),
        kamal: buildBrahmaKamal(r),
        monal: buildMonal(r),
        rasagola: buildRasagola(r),
        konark: buildKonarkWheel(r),
        rambot: buildRambot(r),
        spitpod: buildSpitpod(r),
        shellback: buildShellback(r),
        crown: buildCrown(r),
        ring: new M.MB().torus(m4.ident(), 1, 0.07, 64, 6, [1, 0.6, 0.95]).build(r),
      };
      this.players = { clawd: new Clawd(this.shared.clawd), manus: new Manus(this.shared.manus), mahak: new Mahak(this.shared.mahak), lingraj: new Lingraj(this.shared.lingraj) };
      this.player = this.players[this.character];
      this.players.manus.faces = { neutral: r.loadTexture('img/manus_face.png'), tongue: r.loadTexture('img/manus_face_tongue.png') };
      this.ui.setLoading(0.5, 'Composing the soundtrack…');
      await this.audio.init((p) => this.ui.setLoading(0.5 + p * 0.45, 'Tuning the sound effects…'));
      this.audio.loadTrack('title');
      this.ui.setLoading(1, 'Ready');
      this.loadWorld(this.homeWorld());
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
    try { indexedDB.deleteDatabase('clawd-audio'); } catch (_) { /* old song-upload storage */ }
    addEventListener('pointerdown', () => this.audio.resume());
    addEventListener('keydown', () => this.audio.resume());
    addEventListener('focus', () => this.audio.resume());
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
    this.heartsLost = 0;
    this.questDone = new Set();
    this.renderer.post = { ...this.renderer.post, ...this.world.post, fade: 0, hurt: 0 };
    // photo face brightness follows the world's light so it sits in the scene
    const env = this.world.env;
    const lum = (c) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
    this.players.manus.faceLight = Math.min(1.6, Math.max(0.55, 0.45 + lum(env.sunColor) * env.sunI * 0.3 + lum(env.ambSky) * 0.5));
    this.players.manus.faceTint = env.sunColor.map((x) => Math.min(1.2, x * 1.1));
    this.ui.resetHUD();
    this.ui.hideBoss();
    this.hitStop = 0;
    this.seen = {};
    this.audio.playAmbience(ambienceFor(data));
  }

  hero() { return HEROES[this.character]; }
  // Where "Continue" goes: the last world if unfinished, else the next open, unfinished world.
  continueTarget() {
    const last = this.save.last;
    if (last && this.levels[last] && !this.save.levels[last]?.done && !this.isLocked(last)) return last;
    for (const set of this.setOrder()) {
      for (const m of this.campaignList(set)) if (!this.isLocked(m.id) && !this.save.levels[m.id]?.done) return m.id;
    }
    return last && this.levels[last] ? last : null;
  }
  homeWorld() { return this.campaignList(this.hero().home)[0]?.id || 1; }
  setOrder() {
    const all = ['clawd', 'manus', 'pahadi', 'odisha', 'bonus'].filter((c) => this.campaignList(c).length);
    const home = this.hero().home;
    return [home, ...all.filter((c) => c !== home)];
  }
  campaignOf(id) { return this.levels[id]?.campaign || 'clawd'; }
  campaignList(c) { return this.manifest.filter((m) => (m.campaign || 'clawd') === c).sort((a, b) => a.id - b.id); }
  worldIndex(id) { return this.campaignList(this.campaignOf(id)).findIndex((m) => m.id === id); }
  worldLabel(id) {
    const c = this.campaignOf(id), n = this.worldIndex(id) + 1;
    if (c === 'bonus') return 'Bonus World';
    return c === 'clawd' ? `World ${n}` : `${SETS[c]?.name || c} · World ${n}`;
  }
  nextWorld(id) { const l = this.campaignList(this.campaignOf(id)); return l[this.worldIndex(id) + 1]?.id || null; }
  questStars() { return countStars(this.save); }
  totalStars() { return this.manifest.length * 3; }
  // A world opens when the one before it in its set is finished; the bonus world opens with quest stars.
  isLocked(id) {
    if (this.campaignOf(id) === 'bonus') return this.questStars() < BONUS_STARS;
    const i = this.worldIndex(id);
    if (i <= 0) return false;
    const prev = this.campaignList(this.campaignOf(id))[i - 1].id;
    return !(this.save.levels[prev] && this.save.levels[prev].done);
  }
  stats(finished = false) {
    const w = this.world, lv = this.levels[this.levelId];
    return {
      sparks: w.sparkGot, sparkTotal: w.sparkTotal, tokens: w.tokenGot.filter(Boolean).length,
      heartsLost: this.heartsLost, time: this.levelTime, par: lv.parTime,
      stomped: w.stomped, enemyTotal: w.enemyTotal, crates: w.cratesSmashed, crateTotal: w.crates.length, finished,
    };
  }
  words() { return this.hero().words; }

  setCharacter(c) {
    if (!HEROES[c]) return;
    this.character = c;
    this.mapSet = null;
    localStorage.setItem('clawd.character', c);
    this.player = this.players[c];
    this.ui.setCollectibleIcons(c);
    this.levelId = 0;
    this.toTitle();
  }

  showCharacters() {
    this.state = 'select';
    const card = (id) => {
      const h = HEROES[id];
      return `
      <button class="card char ${this.character === id ? 'picked' : ''}" data-act="pick-char" data-id="${id}">
        <div class="card-art char-art ${id}">${HERO_ART[id]}${this.character === id ? '<div class="picked-tag">Selected</div>' : ''}</div>
        <div class="card-body">
          <div class="card-title">${h.name}</div>
          <div class="card-from">${h.from}</div>
          <div class="card-sub">${h.blurb}</div>
          <div class="collects"><span>${h.icons.spark(18)} ${h.words.sparks}</span><span>${h.icons.token(18, true)} ${h.words.tokens}</span></div>
        </div>
      </button>`;
    };
    this.ui.show('characters', `
      <div class="select-wrap chars">
        <h2>Choose your hero</h2>
        <div class="cards four">${HERO_ORDER.map(card).join('')}</div>
        <p class="hero-note">Every hero can play every world. Progress and quest stars are shared.</p>
        <div class="row"><button data-act="title" class="ghost">Back</button></div>
      </div>`, 'select');
  }

  toTitle() {
    this.state = 'title';
    if (this.levelId !== this.homeWorld()) this.loadWorld(this.homeWorld());
    this.ui.setCollectibleIcons(this.character);
    this.cam.mode = 'orbit';
    this.ui.showHUD(false);
    this.input.wantLock = false;
    this.input.releaseLock();
    this.audio.playMusic('title');
    const done = this.manifest.filter((m) => this.save.levels[m.id]?.done).length;
    const h = this.hero();
    const cont = this.continueTarget();
    this.ui.show('title', `
      <div class="title-wrap">
        <div class="logo">
          <div class="logo-star">${starIcon(92, '#d97757')}</div>
          <h1>CLAWD</h1>
          <div class="tagline">The Spark Odyssey</div>
          <div class="byline">by Aditya</div>
        </div>
        <div class="home-menu">
          <div class="tiles">
            <button class="tile primary" data-act="play"><b>Play Solo</b><span>${done} / ${this.manifest.length} worlds · ${this.questStars()} ★</span></button>
            ${cont ? `<button class="tile cont" data-act="continue"><b>Continue</b><span>${this.levels[cont].name}</span></button>` : `<button class="tile cont" data-act="howto"><b>How to Play</b><span>Controls &amp; tips</span></button>`}
          </div>
          <div class="subrow">
            <button class="pill hero-pill" data-act="characters"><span class="mini-art">${HERO_ART[this.character]}</span><span>${h.name}</span></button>
            <button class="pill" data-act="settings">Settings</button>
            <button class="pill" data-act="howto">How to Play</button>
            <button class="pill" data-act="credits">Credits</button>
          </div>
        </div>
        <div class="foot">Rendered in WebGL2 · Physics in Rust · VFX in C++ · Levels built in Python</div>
      </div>`, 'title');
  }

  showSelect() {
    this.state = 'select';
    const card = (m) => {
      const lv = this.levels[m.id];
      const th = lv.theme;
      const rec = this.save.levels[m.id] || {};
      const locked = this.isLocked(m.id);
      const toks = rec.tokens || [false, false, false];
      const grad = `linear-gradient(180deg, ${rgb(th.skyTop)} 0%, ${rgb(th.skyHorizon)} 62%, ${rgb(th.floorColor)} 100%)`;
      return `
        <button class="card ${locked ? 'locked' : ''}" data-act="${locked ? 'locked' : 'world'}" data-id="${m.id}">
          <div class="card-art" style="background:${grad}">
            <div class="card-num">${m.campaign === 'bonus' ? '★' : this.worldIndex(m.id) + 1}</div>
            ${artFor(m.id)}
            ${locked ? `<div class="lock">${m.campaign === 'bonus' ? `${BONUS_STARS} quest stars` : 'Locked'}</div>` : ''}
          </div>
          <div class="card-body">
            <div class="card-title">${m.name}</div>
            <div class="card-sub">${m.subtitle}</div>
            <div class="card-stats">
              <span>${this.hero().icons.spark(15)} ${rec.sparks ?? 0}/${m.sparks}</span>
              <span class="tok">${toks.map((t) => `<i class="${t ? 'on' : ''}"></i>`).join('')}</span>
              <span>${rec.best ? fmtTime(rec.best) : '—'}</span>
              ${rec.rank ? `<span class="rank r-${rec.rank}">${rec.rank}</span>` : ''}
            </div>
            <div class="card-quests">${(m.quests || []).map((q) => `<i class="${rec.quests && rec.quests[q] ? 'on' : ''}">★</i>`).join('')}<span>quests</span></div>
          </div>
        </button>`;
    };
    const order = this.setOrder();
    if (!this.mapSet || !order.includes(this.mapSet)) this.mapSet = order[0];
    const cur = this.mapSet;
    const list = this.campaignList(cur);
    const tabs = order.map((c) => {
      const l = this.campaignList(c);
      const d = l.filter((m) => this.save.levels[m.id]?.done).length;
      return `<button class="set-tab ${c === cur ? 'on' : ''}" data-act="map-tab" data-set="${c}">${SETS[c]?.name || c}<small>${d}/${l.length}</small></button>`;
    }).join('');
    const stars = this.questStars();
    this.ui.show('select', `
      <div class="select-wrap">
        <h2>Choose a World</h2>
        <div class="star-total">${starIcon(15, '#ffd98a')} <b>${stars}</b> / ${this.totalStars()} quest stars${stars < BONUS_STARS ? ` · bonus world opens at ${BONUS_STARS}` : ''}</div>
        <div class="set-tabs">${tabs}</div>
        <div class="cards n${Math.min(list.length, 6)}">${list.map(card).join('')}</div>
        <div class="row"><button data-act="title" class="ghost">Back</button></div>
      </div>`, 'select');
    const btns = this.ui.buttons();
    const first = btns.findIndex((b) => b.classList.contains('card') && !b.classList.contains('locked'));
    if (first >= 0) this.ui.focus(first, true);
  }

  startWorld(id) {
    this.loadWorld(id);
    this.save.last = id;
    localStorage.setItem('clawd.save', JSON.stringify(this.save));
    this.fadeT = 0.7;
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
        <div class="kicker">${this.worldLabel(id)}</div>
        <h2>${lv.name}</h2>
        <div class="sub">${lv.subtitle}</div>
        <p class="story">${lv.story}</p>
        ${questList(lv.quests, this.words(), this.stats(), (this.save.levels[id] || {}).quests, { showProgress: false })}
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
    this.ui.showBanner(lv.name, this.worldLabel(lv.id));
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.releaseLock();
    this.audio.duck(0.35);
    this.ui.show('pause', `
      <div class="panel">
        <h2>Paused</h2>
        ${questList(this.levels[this.levelId].quests, this.words(), this.stats(), (this.save.levels[this.levelId] || {}).quests)}
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
      case 'characters': this.showCharacters(); break;
      case 'continue': { const c = this.continueTarget(); if (c) this.startWorld(c); else this.showSelect(); break; }
      case 'map-tab': this.mapSet = data.set; this.showSelect(); break;
      case 'settings-tab': this.settingsTab = data.tab; this.resetArmed = false; this.showSettings(); break;
      case 'reset-progress': this.resetProgress(); break;
      case 'pick-char': this.setCharacter(data.id); break;
      case 'select': this.audio.duck(1); this.showSelect(); if (this.levelId) this.ui.showHUD(false); break;
      case 'title': this.toTitle(); break;
      case 'world': this.startWorld(+data.id); break;
      case 'begin': this.begin(); break;
      case 'resume': this.resume(); break;
      case 'restart': this.audio.duck(1); this.startWorld(this.levelId); break;
      case 'next': {
        const n = this.nextWorld(this.levelId);
        if (n) this.startWorld(n);
        else if (this.campaignOf(this.levelId) === 'bonus') { this.audio.duck(1); this.showSelect(); }
        else this.showEnding();
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
    const tabs = [['sound', 'Sound'], ['graphics', 'Graphics'], ['controls', 'Controls'], ['progress', 'Progress']];
    const cur = this.settingsTab;
    const qHint = { low: 'Fastest. Best for older phones.', medium: 'Balanced for most phones and laptops.', high: 'Sharpest image and softest shadows.' };
    let body = '';
    if (cur === 'sound') {
      body = `${slider('master', 'Master volume', v.master)}${slider('music', 'Music', v.music)}${slider('sfx', 'Sound effects', v.sfx)}${slider('amb', 'Ambience (wind, rain, waves)', v.amb ?? 0.6)}`;
    } else if (cur === 'graphics') {
      body = `<label class="set"><span>Quality<small>${qHint[s.quality] || ''}</small></span>
          <select data-key="quality">${['low', 'medium', 'high'].map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></label>
        <label class="set"><span>Show FPS</span><input type="checkbox" data-key="fps" ${s.fps ? 'checked' : ''}></label>`;
    } else if (cur === 'controls') {
      body = `${slider('sens', 'Camera sensitivity', s.sens, 0.3, 2.5, 0.1)}
        <label class="set"><span>Invert camera Y</span><input type="checkbox" data-key="invertY" ${s.invertY ? 'checked' : ''}></label>
        <p class="note small">${this.input.touch.enabled ? 'Touch: drag the left side to move, the right side to look. Jump, Pound and Dash buttons sit on the right.' : 'Keyboard: WASD move · Space jump · Shift pound · F dash · Esc pause. Gamepads work too.'}</p>`;
    } else {
      body = `<div class="set"><span>Hero<small>${this.hero().from}</small></span><button data-act="characters" class="mini">${this.hero().name}</button></div>
        <div class="set"><span>Progress<small>${this.manifest.filter((m) => this.save.levels[m.id]?.done).length} worlds done · ${this.questStars()} quest stars</small></span>
          <button data-act="reset-progress" class="mini danger">${this.resetArmed ? 'Tap again to erase' : 'Reset progress'}</button></div>
        <div id="setMsg" class="set-msg"></div>`;
    }
    this.ui.show('settings', `
      <div class="panel wide settings-panel">
        <h2>Settings</h2>
        <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === cur ? 'on' : ''}" data-act="settings-tab" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="settings">${body}</div>
        <div class="row"><button data-act="settings-back">Done</button></div>
      </div>`, this.prevState === 'paused' ? 'dim' : '');
    if (this.prevState === 'paused') this.state = 'paused';
    const tabIdx = this.ui.buttons().findIndex((b) => b.dataset.tab === cur);
    if (tabIdx >= 0) this.ui.focus(tabIdx, true);
  }

  resetProgress() {
    if (!this.resetArmed) { this.resetArmed = true; this.showSettings(); return; }
    this.resetArmed = false;
    this.save = { unlocked: 1, levels: {} };
    localStorage.setItem('clawd.save', JSON.stringify(this.save));
    this.showSettings();
    const m = document.getElementById('setMsg');
    if (m) m.textContent = 'Progress erased. Fresh start!';
  }

  setSetting(key, value) {
    if (['master', 'music', 'sfx', 'amb'].includes(key)) { this.audio.vol[key] = +value; this.audio.applyVolumes(); return; }
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
          <div><kbd>Shift</kbd><span>Ground pound (in the air) · smashes crates</span></div>
          <div><kbd>F</kbd><span>Dash · on the ground or once per jump (right-click also works)</span></div>
          <div><kbd>Mouse</kbd><span>Click &amp; drag / pointer-lock to orbit · wheel to zoom</span></div>
          <div><kbd>Q</kbd><kbd>E</kbd><span>Rotate the camera</span></div>
          <div><kbd>Esc</kbd><span>Pause</span></div>
          <div><kbd>📱</kbd><span>Touch: drag left side to move · drag right side to look · Jump, Pound &amp; Dash buttons · ❚❚ to pause</span></div>
          <div><kbd>🎮</kbd><span>Gamepad: left stick move · A jump · X / triggers pound · B / RB dash · right stick camera</span></div>
        </div>
        <p class="note">Each hero collects their own version of Sparks and Tokens: Marathi Manus finds lizards and Komodo dragons, Mahak finds Brahma Kamal flowers and Monals, and Lingraj finds rasagolas and Konark wheels. Collect <b>Sparks</b> to restore the Great Context Window — every 20 Sparks restores a heart. Find all three golden <b>Tokens</b> hidden in each world. Stomp <b>Glitchlings</b> and <b>Wisps</b>, hop over sunbeam sweepers, and touch <b>Lighthouses</b> to save your progress. Reach the portal to finish the world. Each world also has <b>three quests</b>; every quest earns a star, and 12 stars open the bonus world.</p>
        <div class="row"><button data-act="title">Back</button></div>
      </div>`);
  }

  showCredits() {
    this.ui.show('credits', `
      <div class="panel wide">
        <h2>Credits</h2>
        <p class="note center"><b>CLAWD: The Spark Odyssey</b><br>Created by <b>Aditya</b></p>
        <p class="note center">A fan-made meme game starring Clawd, Claude's helpful little mascot. Made for fun — not for commercial use.</p>
        <p class="note center">Inspired by the song <b>“Vaat Majhi”</b> — sung by Reshma Sonawane, featuring Sara Shrawan. All rights belong to the original artists.</p>
        <div class="credits">
          <div><b>Rendering</b><span>WebGL2 · custom GLSL: soft shadows, HDR bloom, ACES tonemapping, illustrative toon lighting</span></div>
          <div><b>Heroes</b><span>Clawd · Marathi Manus · Mahak from Uttarakhand · Lingraj from Odisha</span></div>
          <div><b>Gameplay core</b><span>Rust → WebAssembly: character controller &amp; procedural island sculpting</span></div>
          <div><b>VFX core</b><span>Freestanding C++ → WebAssembly: 8k-particle simulation</span></div>
          <div><b>Tools</b><span>Python: level compiler &amp; reachability linter, procedural sound-effect synthesizer</span></div>
          <div><b>Music</b><span>Soundtrack provided by Aditya</span></div>
          <div><b>Assets</b><span>Every mesh, sound effect and level is generated from code. Only the soundtrack and the photo face are files.</span></div>
        </div>
        <div class="row"><button data-act="title">Back</button></div>
      </div>`);
  }

  showEnding() {
    const set = this.campaignOf(this.levelId);
    const E = ENDINGS[set] || ENDINGS.clawd;
    this.state = 'ending';
    this.ui.showHUD(false);
    this.audio.playMusic('ending', 1.0);
    const ids = this.campaignList(set).map((m) => m.id);
    const total = ids.reduce((a, id) => a + ((this.save.levels[id] || {}).tokens || []).filter(Boolean).length, 0);
    this.ui.show('ending', `
      <div class="panel wide ending">
        <div class="logo-star small">${starIcon(64, '#d97757')}</div>
        <h2>${E.title}</h2>
        <p class="story">${E.story}</p>
        <p class="note center">${this.words().tokens} found: <b>${total} / ${ids.length * 3}</b> · Quest stars: <b>${this.questStars()} / ${this.totalStars()}</b></p>
        <div class="row"><button data-act="select">World Map</button><button data-act="title" class="ghost">Title</button></div>
      </div>`);
  }

  // ---------------------------------------------------------------------------
  // gameplay events
  // ---------------------------------------------------------------------------
  hurt(from, zap, hard) {
    if (this.invuln > 0 || this.state !== 'play') return;
    this.hearts--;
    this.heartsLost++;
    this.invuln = 1.6;
    this.player.flash = 0.25;
    this.cam.shake = 0.8;
    this.renderer.post.hurt = 1;
    this.audio.play(zap ? 'zap' : 'hurt');
    const p = this.player.pos;
    const d = v3.norm([p[0] - from[0], 0, p[2] - from[2]]);
    const k = hard ? 14 : 9;
    this.native.physics.knock(d[0] * k, hard ? 13 : 11, d[2] * k);
    this.native.fx.emit(this.native.fx.T.BURST, [p[0], p[1] + 0.6, p[2]], 18, [2.4, 0.6, 0.4], 5);
    if (this.hearts <= 0) setTimeout(() => this.gameOver(), 500);
  }

  fell() {
    if (this.state !== 'play') return;
    this.state = 'respawn';
    this.hearts--;
    this.heartsLost++;
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
    const finalStats = this.stats(true);
    const quests = { ...(rec.quests || {}) };
    const fresh = [];
    for (const q of lv.quests) {
      if (QUESTS[q] && QUESTS[q].done(finalStats) && !quests[q]) { quests[q] = true; fresh.push(q); }
    }
    const starsBefore = this.questStars();
    const ranks = 'CBAS';
    this.save.levels[this.levelId] = {
      best: newBest ? this.levelTime : rec.best,
      sparks: Math.max(rec.sparks || 0, w.sparkGot),
      tokens: [0, 1, 2].map((i) => !!((rec.tokens || [])[i] || tokens[i])),
      rank: !rec.rank || ranks.indexOf(rank) > ranks.indexOf(rec.rank) ? rank : rec.rank,
      done: true,
      quests,
    };
    const camp = this.campaignOf(this.levelId);
    localStorage.setItem('clawd.save', JSON.stringify(this.save));
    const hasNext = !!this.nextWorld(this.levelId);
    const bonusOpened = starsBefore < BONUS_STARS && this.questStars() >= BONUS_STARS;
    const W = this.words();
    setTimeout(() => {
      if (this.state !== 'complete') return;
      this.ui.show('results', `
        <div class="panel results">
          <div class="kicker">${this.worldLabel(this.levelId)} complete</div>
          <h2>${lv.name}</h2>
          <div class="rank-big r-${rank}">${rank}</div>
          <div class="res-grid">
            <div><span>${W.sparks}</span><b>${w.sparkGot} / ${w.sparkTotal}</b></div>
            <div><span>${W.tokens}</span><b class="tok">${tokens.map((t) => `<i class="${t ? 'on' : ''}"></i>`).join('')}</b></div>
            <div><span>Time</span><b>${fmtTime(this.levelTime)}${newBest ? ' <em>best!</em>' : ''}</b></div>
          </div>
          ${questList(lv.quests, W, finalStats, quests, { showProgress: false, justNow: fresh })}
          ${bonusOpened ? '<div class="bonus-open">★ Bonus world unlocked!</div>' : ''}
          <div class="menu">
            <button data-act="next">${hasNext ? 'Next World' : camp === 'bonus' ? 'World Map' : 'Finale'}</button>
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
      this.cam.update(dt, { player: this.player, input: this.state === 'play' ? inp : null, aspect, raycast: (o, d, m) => this.native.physics.raycast(o, d, m, 0.75) });
    }

    // post fx easing
    const P = this.renderer.post;
    P.hurt = Math.max(0, P.hurt - dt * 2);
    if (this.fadeT > 0 && this.state !== 'respawn') { this.fadeT -= dt; P.fade = Math.max(0, this.fadeT / 0.7); }

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
    if (this.hitStop > 0) { this.hitStop -= dt; return; }   // a tiny freeze sells big hits
    this.levelTime += dt;
    const wp = this.world.windPush;
    phys.push(wp[0], wp[1]);
    const bw = this.world.env.wind;
    fx.wind(bw[0] * 1.5 + wp[0] * 0.9, bw[1] * 1.5 + wp[1] * 0.9);
    this.invuln = Math.max(0, this.invuln - dt);
    const [ix, iz] = this.cam.moveDir(inp.mx, inp.mz);
    this.acc = (this.acc || 0) + dt;
    let events = 0, first = true;
    let landSpeed = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.world.step(STEP);
      const ev = phys.step(STEP, ix, iz, inp.jumpHeld, first && inp.jump, first && inp.pound, first && inp.dash);
      if (ev & EV.LAND) landSpeed = phys.state()[11];
      events |= ev;
      first = false;
    }
    if (first && (inp.jump || inp.pound || inp.dash)) {
      // no substep ran this frame: carry the press to the next one
      this.input.pressed.add(inp.jump ? 'Space' : inp.pound ? 'ShiftLeft' : 'KeyF');
    }
    const st = phys.state();
    this.player.onEvents(events, EV, landSpeed);
    this.player.update(dt, st);
    const p = this.player.pos;

    // event-driven audio / vfx
    if (events & EV.JUMP) { this.audio.play('jump', { vol: 0.55 }); fx.emit(fx.T.DUST, p, 6, [1.2, 1.1, 1.0], 2); }
    if (events & EV.DJUMP) { this.audio.play('djump', { vol: 0.6 }); fx.emit(fx.T.RING, [p[0], p[1] + 0.3, p[2]], 14, [2.2, 1.4, 0.8], 4); }
    if (events & EV.POUND) this.audio.play('pound', { vol: 0.6 });
    if (events & EV.DASH) {
      this.audio.play('dash', { vol: 0.7 });
      const c = this.hero().dash;
      for (let k = 0; k < 6; k++) fx.emit(fx.T.TRAIL, [p[0] - st[3] * 0.012 * k, p[1] + 0.3 + Math.random() * 0.5, p[2] - st[5] * 0.012 * k], 2, c, 0.22);
      fx.emit(fx.T.RING, [p[0], p[1] + 0.5, p[2]], 10, c, 3);
    }
    if (events & EV.POUND_LAND) {
      this.audio.play('pound_land', { vol: 0.9 });
      this.cam.shake = 0.6;
      const smashed = this.world.smashCrate(st[10]);
      if (smashed) {
        this.audio.play('crate', { vol: 0.9 });
        phys.bounce(7);
        this.hitStop = 0.06;
        if (smashed.contains === 'heart') {
          if (this.hearts < 3) { this.hearts++; this.ui.popup('+1 ♥', 'heart'); } else this.ui.popup('♥ already full', 'heart');
          this.audio.play('heart', { vol: 0.8 });
        }
      }
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
        if (this.combo >= 5 && this.combo % 5 === 0) this.ui.popup(`×${this.combo} combo!`, 'combo');
        this.audio.play('spark', { vol: 0.55, rate: 1 + Math.min(this.combo, 12) * 0.045, vary: 0.01 });
        this.heartSparks++;
        if (this.heartSparks >= 20) {
          this.heartSparks = 0;
          if (this.hearts < 3) { this.hearts++; this.ui.popup('+1 ♥', 'heart'); }
        }
      } else if (e.type === 'token') {
        this.audio.play('token', { vol: 0.9 });
        this.ui.popup(`${this.words().token} ${this.world.tokenGot.filter(Boolean).length} / 3`, 'token');
        this.cam.shake = 0.3;
      } else if (e.type === 'checkpoint') {
        this.audio.play('checkpoint', { vol: 0.7 });
        this.ui.popup('Lighthouse lit', 'cp');
      } else if (e.type === 'stomp') {
        this.audio.play('stomp', { vol: 0.8 });
        phys.bounce(this.player.pounding ? 9 : 13);
        this.player.sqV += 6;
        this.hitStop = 0.05;
        this.cam.shake = Math.max(this.cam.shake, 0.25);
      } else if (e.type === 'hurt') {
        this.hurt(e.from, e.zap, e.hard);
      } else if (e.type === 'clank') {
        this.audio.play('zap', { vol: 0.45, rate: 1.6 });
        phys.bounce(11);
        this.cam.shake = Math.max(this.cam.shake, 0.2);
        if (!this.seen.clank) { this.seen.clank = true; this.ui.hint(e.boss ? 'Only a <b>ground pound</b> hurts him — and only while he\'s dizzy' : 'Too tough to stomp! <b>Ground pound</b> it instead (SHIFT in mid-air)'); }
      } else if (e.type === 'charge') {
        this.audio.play('dash', { vol: 0.55, rate: 0.7 });
      } else if (e.type === 'bonk') {
        this.audio.play('land', { vol: 0.8, rate: 0.7 });
        this.cam.shake = Math.max(this.cam.shake, 0.3);
      } else if (e.type === 'spit') {
        this.audio.play('pound', { vol: 0.3, rate: 1.7 });
      } else if (e.type === 'wind') {
        this.audio.play('dash', { vol: 0.35, rate: 0.5 });
        if (!this.seen.wind) { this.seen.wind = true; this.ui.hint('Strong gusts here! Watch the sand and time your jumps between them'); }
      } else if (e.type === 'bossstart') {
        const B = this.world.boss;
        this.audio.play('portal', { vol: 0.8, rate: 0.7 });
        this.cam.shake = 0.6;
        this.ui.showBanner(B.name, 'Boss');
        this.ui.showBoss(B.name, B.hp, B.maxHp);
        this.ui.hint('Jump over his shockwaves. When he gets dizzy, <b>ground pound</b> his head!');
      } else if (e.type === 'bossslam') {
        this.audio.play('pound_land', { vol: 0.9, rate: 0.8 });
        this.cam.shake = 0.7;
      } else if (e.type === 'bossdizzy') {
        this.audio.play('bounce', { vol: 0.5, rate: 0.7 });
      } else if (e.type === 'bosshit') {
        this.audio.play('token', { vol: 0.9, rate: 0.8 });
        phys.bounce(15);
        this.hitStop = 0.14;
        this.cam.shake = 0.8;
        this.ui.showBoss(this.world.boss.name, e.hp, this.world.boss.maxHp);
      } else if (e.type === 'bossdead') {
        this.audio.play('win', { vol: 0.9 });
        this.ui.hideBoss();
        this.ui.popup('The Glitch King is defeated!', 'token');
        setTimeout(() => this.state === 'play' && this.ui.hint('The portal is open. Step through to finish!'), 1600);
      } else if (e.type === 'hint') {
        this.ui.hint(e.text);
      } else if (e.type === 'goal') {
        this.complete();
      }
    }
    // quests that can be finished mid-run announce themselves once
    const lvq = this.levels[this.levelId].quests || [];
    if (lvq.length) {
      const s = this.stats();
      for (const q of lvq) {
        const def = QUESTS[q];
        if (def && def.live && !this.questDone.has(q) && def.done(s)) {
          this.questDone.add(q);
          this.audio.play('quest', { vol: 0.8 });
          this.ui.popup(`★ ${def.label(this.words(), s)}`, 'quest');
        }
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
      this.native.fx.emit(this.native.fx.T.RING, [sp[0], sp[1] + 0.4, sp[2]], 18, this.hero().dash, 5);
      this.native.fx.emit(this.native.fx.T.BURST, [sp[0], sp[1] + 0.8, sp[2]], 16, this.hero().dash, 4);
      this.audio.play('checkpoint', { vol: 0.35, rate: 1.4 });
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

function ambienceFor(lv) {
  const th = lv.theme || {};
  if (th.ambience) return th.ambience;
  return { water: 'waves', clouds: 'wind', sand: 'wind', nebula: 'space', lava: 'lava' }[th.floor] || 'wind';
}

const ENDINGS = {
  clawd: { title: 'The Great Context Window is restored', story: 'Spark by spark, every lost thought came home. The Window glows again over all six realms, wide enough to hold every question anyone might ask. Somewhere in the meadows, a new prompt is already being written.' },
  manus: { title: 'Ghari aalo! — Home at last', story: 'From the misty Sahyadri forts to the Konkan pier, the lantern-lit lake and the rooftops of Mumbai, the slow road turned out to be the best one. The kandils are glowing, the chai is hot, and the lizards are fast asleep.' },
  pahadi: { title: 'The valley is in bloom', story: 'High in the Himalaya the Brahma Kamal has opened, the monals are calling from the ridge, and the temple bells ring out over the valley. The trail home winds down through the deodars, and the stars come out early up here.' },
  odisha: { title: 'The sun wheel turns', story: 'Morning breaks over the Odisha coast. The great stone wheels catch the first light, the fishing boats head out, and somebody has saved you one last rasagola. Not a bad way to end a journey.' },
  bonus: { title: 'Victory lap complete', story: 'Nothing left to prove. Go and beat your best time.' },
};

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function rgb(c) { return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; }

// little illustrated vignettes for the world cards (inline SVG)
function artFor(id) {
  const arts = {
    1: `<svg viewBox="0 0 200 110" class="card-svg"><ellipse cx="60" cy="70" rx="46" ry="10" fill="#8fbf5a"/><path d="M14 70 Q60 110 106 70Z" fill="#b9875a"/><ellipse cx="150" cy="52" rx="30" ry="7" fill="#a8c95f"/><path d="M120 52 Q150 85 180 52Z" fill="#c49468"/><circle cx="45" cy="52" r="12" fill="#93c763"/><circle cx="56" cy="46" r="10" fill="#ffb3a0"/><rect x="48" y="56" width="3" height="14" fill="#8a5a3c"/><rect x="140" y="38" width="16" height="12" rx="3" fill="#d97757"/></svg>`,
    2: `<svg viewBox="0 0 200 110" class="card-svg"><rect x="30" y="30" width="34" height="80" rx="4" fill="#5d6b6a"/><rect x="30" y="26" width="34" height="8" rx="3" fill="#4fae6e"/><rect x="120" y="45" width="40" height="65" rx="4" fill="#7c8a86"/><rect x="120" y="41" width="40" height="8" rx="3" fill="#6fbf7a"/><rect x="62" y="34" width="9" height="76" fill="#c4ecf0" opacity=".85"/><rect x="78" y="62" width="30" height="6" rx="3" fill="#c98a55"/></svg>`,
    3: `<svg viewBox="0 0 200 110" class="card-svg"><circle cx="150" cy="48" r="16" fill="#fff0c8"/><rect x="24" y="40" width="40" height="70" fill="#d9895b"/><rect x="24" y="36" width="40" height="7" fill="#f2b880"/><rect x="100" y="60" width="50" height="50" fill="#b0603f"/><rect x="100" y="56" width="50" height="7" fill="#f0c987"/><rect x="40" y="31" width="22" height="2" fill="#ff6a3a"/></svg>`,
    4: `<svg viewBox="0 0 200 110" class="card-svg"><circle cx="30" cy="20" r="1.5" fill="#fff"/><circle cx="90" cy="12" r="1" fill="#fff"/><circle cx="170" cy="25" r="1.5" fill="#fff"/><ellipse cx="60" cy="62" rx="30" ry="7" fill="#8fe3ff"/><path d="M30 62 L60 98 L90 62Z" fill="#5a5fb8"/><ellipse cx="145" cy="45" rx="22" ry="5" fill="#d4a6ff"/><path d="M123 45 L145 75 L167 45Z" fill="#6a4fa8"/><path d="M55 60 L60 40 L65 60Z" fill="#7ae8ff"/></svg>`,
    6: `<svg viewBox="0 0 200 110" class="card-svg"><path d="M0 110 L0 60 Q40 30 70 55 Q100 25 140 50 Q170 35 200 55 L200 110Z" fill="#4f7a52"/><rect x="60" y="58" width="60" height="22" fill="#6e7276"/><rect x="60" y="52" width="8" height="8" fill="#6e7276"/><rect x="80" y="52" width="8" height="8" fill="#6e7276"/><rect x="100" y="52" width="8" height="8" fill="#6e7276"/><rect x="130" y="50" width="6" height="60" fill="#e8f0f2" opacity=".85"/><g stroke="#cfe4f0" stroke-width="1.5" opacity=".8"><line x1="20" y1="5" x2="16" y2="18"/><line x1="60" y1="10" x2="56" y2="23"/><line x1="110" y1="2" x2="106" y2="15"/><line x1="170" y1="8" x2="166" y2="21"/></g></svg>`,
    7: `<svg viewBox="0 0 200 110" class="card-svg"><circle cx="150" cy="58" r="14" fill="#ffe0a0"/><rect x="0" y="80" width="200" height="30" fill="#2aa0b0"/><rect x="20" y="50" width="40" height="60" fill="#b4553a"/><rect x="20" y="46" width="40" height="7" fill="#f2d9a8"/><path d="M40 46 Q42 20 46 14" stroke="#7a5a3a" stroke-width="3" fill="none"/><path d="M46 14 q-14 -2 -20 6 M46 14 q12 -4 18 4 M46 14 q-4 -10 -12 -12 M46 14 q8 -8 14 -8" stroke="#4f9a3a" stroke-width="4" fill="none"/><path d="M110 84 L150 84 L144 92 L116 92Z" fill="#3d6fb0"/><path d="M130 84 L130 62 L142 82Z" fill="#f6eedc"/></svg>`,
    8: `<svg viewBox="0 0 200 110" class="card-svg"><rect x="0" y="80" width="200" height="30" fill="#1a2a5a"/><circle cx="30" cy="12" r="1.5" fill="#fff"/><circle cx="160" cy="20" r="1.5" fill="#fff"/><rect x="40" y="30" width="3" height="52" fill="#b08a50"/><polygon points="52,40 56,50 66,50 58,56 61,66 52,60 43,66 46,56 38,50 48,50" fill="#ff9a3a"/><rect x="140" y="34" width="3" height="48" fill="#b08a50"/><polygon points="152,44 156,54 166,54 158,60 161,70 152,64 143,70 146,60 138,54 148,54" fill="#ff5a7a"/><ellipse cx="90" cy="92" rx="6" ry="2.5" fill="#b8582e"/><circle cx="90" cy="88" r="2.5" fill="#ffcf5a"/><ellipse cx="115" cy="98" rx="6" ry="2.5" fill="#b8582e"/><circle cx="115" cy="94" r="2.5" fill="#ffcf5a"/></svg>`,
    12: `<svg viewBox="0 0 200 110" class="card-svg"><path d="M0 70 L40 30 L70 55 L110 18 L150 50 L200 28 L200 110 L0 110Z" fill="#8aa8c8"/><path d="M110 18 L98 30 L106 28 L112 34 L118 27 L124 30Z M40 30 L32 40 L40 37 L46 42Z" fill="#fff"/><path d="M0 84 Q100 60 200 84 L200 110 L0 110Z" fill="#5f9a52"/><g fill="#e03a4a"><circle cx="30" cy="88" r="3"/><circle cx="60" cy="94" r="2.5"/><circle cx="150" cy="90" r="3"/></g><g fill="#f6eed2"><circle cx="90" cy="96" r="3"/><circle cx="120" cy="92" r="2.5"/><circle cx="170" cy="98" r="3"/></g><path d="M20 84 l7 -22 l7 22Z M180 86 l6 -20 l6 20Z" fill="#2f5a44"/></svg>`,
    13: `<svg viewBox="0 0 200 110" class="card-svg"><circle cx="160" cy="44" r="16" fill="#ffd890"/><rect x="0" y="82" width="200" height="28" fill="#2a9ab0"/><path d="M0 86 Q100 74 200 86 L200 96 L0 96Z" fill="#f2d9a8"/><path d="M30 82 L30 50 Q44 20 58 50 L58 82Z" fill="#c89a6a"/><circle cx="44" cy="22" r="4" fill="#c89a6a"/><g fill="none" stroke="#a8784e" stroke-width="4"><circle cx="110" cy="66" r="14"/></g><g stroke="#a8784e" stroke-width="2"><line x1="96" y1="66" x2="124" y2="66"/><line x1="110" y1="52" x2="110" y2="80"/><line x1="100" y1="56" x2="120" y2="76"/><line x1="120" y1="56" x2="100" y2="76"/></g><path d="M150 92 L182 92 L176 98 L156 98Z" fill="#3d6fb0"/></svg>`,
    9: `<svg viewBox="0 0 200 110" class="card-svg"><path d="M10 110 L60 40 L110 110Z" fill="#bcd8f0"/><path d="M60 40 L44 62 L54 58 L60 66 L68 57 L76 62Z" fill="#fff"/><path d="M90 110 L145 55 L200 110Z" fill="#9fc4e8"/><path d="M145 55 L130 70 L140 67 L146 74 L153 66 L160 70Z" fill="#fff"/><g fill="#fff"><circle cx="30" cy="20" r="2"/><circle cx="90" cy="30" r="1.6"/><circle cx="170" cy="18" r="2"/><circle cx="120" cy="12" r="1.4"/></g><path d="M20 96 l8 -18 l8 18Z" fill="#2f7a6a"/><path d="M170 100 l7 -16 l7 16Z" fill="#2f7a6a"/></svg>`,
    10: `<svg viewBox="0 0 200 110" class="card-svg"><rect x="0" y="92" width="200" height="18" fill="#12204a"/><g fill="#2c3046"><rect x="14" y="40" width="34" height="60"/><rect x="60" y="24" width="30" height="76"/><rect x="104" y="46" width="38" height="54"/><rect x="152" y="30" width="32" height="70"/></g><g fill="#ffd98a"><rect x="20" y="48" width="5" height="6"/><rect x="34" y="60" width="5" height="6"/><rect x="66" y="32" width="5" height="6"/><rect x="78" y="46" width="5" height="6"/><rect x="66" y="62" width="5" height="6"/><rect x="112" y="54" width="5" height="6"/><rect x="128" y="70" width="5" height="6"/><rect x="160" y="40" width="5" height="6"/><rect x="172" y="56" width="5" height="6"/></g><rect x="66" y="16" width="14" height="8" rx="3" fill="#1e2026"/><rect x="92" y="84" width="16" height="7" rx="2" fill="#f2c230"/><rect x="92" y="88" width="16" height="4" fill="#1c1c20"/></svg>`,
    11: `<svg viewBox="0 0 200 110" class="card-svg"><ellipse cx="50" cy="78" rx="34" ry="8" fill="#ffe1ee"/><path d="M16 78 Q50 108 84 78Z" fill="#ff9ac0"/><ellipse cx="150" cy="56" rx="30" ry="7" fill="#fff6ea"/><path d="M120 56 Q150 84 180 56Z" fill="#f2c9dc"/><g fill="#ffb37a"><polygon points="100,20 103,30 113,31 105,37 108,47 100,41 92,47 95,37 87,31 97,30"/><polygon points="60,40 62,46 68,47 63,51 65,57 60,53 55,57 57,51 52,47 58,46"/><polygon points="140,24 142,30 148,31 143,35 145,41 140,37 135,41 137,35 132,31 138,30"/></g><path d="M40 70 q10 -30 60 -34" stroke="#fff" stroke-width="2" stroke-dasharray="3 5" fill="none"/></svg>`,
    5: `<svg viewBox="0 0 200 110" class="card-svg"><rect x="86" y="18" width="28" height="92" fill="#2a2530"/><rect x="82" y="14" width="36" height="8" fill="#f2c45a"/><circle cx="100" cy="8" r="5" fill="#ffcf86"/><rect x="20" y="60" width="34" height="50" fill="#3a3440"/><rect x="146" y="50" width="34" height="60" fill="#3a3440"/><rect x="0" y="104" width="200" height="6" fill="#ff5a1a"/></svg>`,
  };
  return arts[id] || '';
}

// expose lin for console tinkering
window.__clawd = { lin };
const game = new Game();
window.game = game;
game.boot();
