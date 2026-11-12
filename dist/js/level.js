// World: builds a playable level from compiled JSON and runs its entities.
import { m4, v3, mulberry, clamp } from './math.js';
import { lin } from './gl.js';
import * as M from './meshes.js';
import * as MH from './meshes_mh.js';

const hex = M.hex;

// Per-world art direction for decor
const PALETTES = {
  1: { foliage: ['#7cb85a', '#93c763', '#5fa352', '#a8cf6a'].map(hex), blossom: ['#ffb3a0', '#ffd0b8', '#f7a6c0'].map(hex), blossomChance: 0.45,
       flowers: ['#ff8a7a', '#ffd166', '#f7f2e8', '#c89cf0', '#ff9fc4'].map(hex), rock: hex('#b4aa9c'), crystal: ['#9fe8ff'].map(hex), stone: hex('#e4dccb'),
       grass: [hex('#5f9a45'), hex('#b8dc78')] },
  2: { foliage: ['#3fa860', '#4fbf70', '#2f9a5a', '#6fc87a'].map(hex), blossom: ['#ffb07a'].map(hex), blossomChance: 0.1,
       flowers: ['#ff6a8a', '#ffd166', '#ffffff', '#7ad8ff'].map(hex), rock: hex('#8a9690'), crystal: ['#9fe8ff'].map(hex), stone: hex('#c8d0c8'),
       grass: [hex('#2f7a4a'), hex('#8fd47a')] },
  3: { foliage: ['#8aa860', '#9ab86a'].map(hex), blossom: ['#ff8a5a'].map(hex), blossomChance: 0,
       flowers: ['#ff5a7a', '#ffb347', '#f2e8ff'].map(hex), rock: hex('#c98a62'), crystal: ['#ffcf8a'].map(hex), stone: hex('#e8c8a0'),
       grass: [hex('#a08a50'), hex('#e8d090')] },
  4: { foliage: ['#6a7ad8', '#8a6ad8'].map(hex), blossom: ['#ff9ae8'].map(hex), blossomChance: 0.3,
       flowers: ['#9ae8ff', '#ff9ae8'].map(hex), rock: hex('#5a5490'), crystal: ['#7ae8ff', '#b48aff', '#ff8ad8', '#8affd0'].map(hex), stone: hex('#9a90d0'),
       grass: [hex('#3a3a8a'), hex('#8ab8ff')] },
  6: { foliage: ['#4f9a4a', '#5fae52', '#3f8a46', '#77b860'].map(hex), blossom: ['#f7d36a'].map(hex), blossomChance: 0.12,
       flowers: ['#ff9a1a', '#ffd35a', '#f2f0ea', '#c87ad8'].map(hex), rock: hex('#6a6c6e'), crystal: ['#9fe8ff'].map(hex), stone: hex('#9a9c98'),
       grass: [hex('#3f7a3a'), hex('#9ad070')] },
  7: { foliage: ['#4f9a3a', '#6aae46', '#3f8a3a'].map(hex), blossom: ['#ff8a5a'].map(hex), blossomChance: 0,
       flowers: ['#ff9a1a', '#ff5a7a', '#ffd35a'].map(hex), rock: hex('#a8553a'), crystal: ['#ffcf8a'].map(hex), stone: hex('#c88a6a'),
       grass: [hex('#5a8a3a'), hex('#c8d88a')] },
  8: { foliage: ['#2f6a4a', '#3f7a5a'].map(hex), blossom: ['#ffb347', '#ff7a9a'].map(hex), blossomChance: 0.5,
       flowers: ['#ff9a1a', '#ffc21a', '#ff7a9a'].map(hex), rock: hex('#5a4a50'), crystal: ['#ffd890'].map(hex), stone: hex('#8a8a90'),
       grass: [hex('#24503a'), hex('#5f9a6a')] },
  5: { foliage: ['#8a4a3a'].map(hex), blossom: ['#ff7a45'].map(hex), blossomChance: 0,
       flowers: ['#ffb060'].map(hex), rock: hex('#3a3238'), crystal: ['#ff7a45'].map(hex), stone: hex('#4a4048'),
       grass: [hex('#4a2a2a'), hex('#a05a3a')] },
};

const WIND = { marigold: 0.3, kandil: 0.04, diya: 0, boat: 0, tree: 0.035, palm: 0.05, bush: 0.07, flower: 0.35, rock: 0, cactus: 0.0, crystal: 0, shroom: 0.05, column: 0, brazier: 0, lamp: 0, flame: 0.2 };
const EMIS = { kandil: 1.6, diya: 2.2, crystal: 0.9, shroom: 1.4, lamp: 0.0, flame: 3.0 };
const FLOOR_TYPES = { clouds: 0, water: 1, sand: 2, nebula: 3, lava: 4 };

export class World {
  constructor(game, data) {
    this.g = game;
    this.d = data;
    const r = (this.r = game.renderer);
    const phys = game.native.physics;
    this.pal = PALETTES[data.id] || PALETTES[1];
    this.meshes = [];
    const keep = (m) => { this.meshes.push(m); return m; };
    const th = data.theme;

    // ---- environment ---------------------------------------------------------
    this.env = {
      sunDir: v3.norm(th.sunDir), sunColor: lin(th.sunColor), sunI: th.sunIntensity ?? 2.4,
      skyTop: lin(th.skyTop), skyHorizon: lin(th.skyHorizon), skyBottom: lin(th.skyBottom),
      fogColor: lin(th.fogColor), fogDensity: th.fogDensity ?? 0.006, floorY: th.floorY ?? -30,
      clouds: th.clouds ?? 0.5, stars: th.stars ?? 0, wind: th.wind || [0.5, 0.3],
      floorA: lin(th.floorColor), floorB: lin(th.floorColor2), floorType: FLOOR_TYPES[th.floor] ?? 0,
      ambSky: lin(th.ambSky), ambGround: lin(th.ambGround),
    };
    this.post = { bloom: th.bloom ?? 0.5, exposure: th.exposure ?? 1, saturation: th.saturation ?? 1.05, contrast: th.contrast ?? 1.04 };
    this.accent = hex(th.accent || '#d97757');

    // ---- solids → physics + meshes ---------------------------------------------
    phys.reset();
    this.solids = [];
    this.bouncers = [];
    const cache = new Map();
    let seedN = 1;
    for (const s of data.solids) {
      const shape = s.shape === 'box' ? 0 : 1;
      const kind = s.kind === 'bounce' ? 1 : 0;
      const id = phys.add(shape, s.pos, s.size, kind, s.power || 0);
      const vis = s.visual?.type || 'block';
      const colors = s.colors;
      let mesh = null, offsetY = 0;
      if (vis === 'island') {
        const top = s.pos[1] + s.size[1];
        offsetY = top - s.pos[1];
        const f32 = phys.island(s.size[0], s.visual.depth, s.visual.seed, s.visual.shape, lin(colors[0]), lin(colors[1]), lin(colors[2]));
        mesh = keep(r.createMeshInterleaved(f32));
      } else if (vis === 'block') {
        const key = `b${s.size.join(',')}${s.style}`;
        if (!cache.has(key)) cache.set(key, keep(M.buildBlock(r, s.size, colors, seedN++)));
        mesh = cache.get(key);
      } else if (vis === 'disc') {
        const key = `d${s.size.join(',')}${s.style}`;
        if (!cache.has(key)) cache.set(key, keep(M.buildDisc(r, s.size[0], s.size[1], colors, seedN++)));
        mesh = cache.get(key);
      } else if (vis === 'bouncer') {
        const key = `bo${colors[0]}`;
        if (!cache.has(key)) cache.set(key, M.buildBouncer(r, colors[0]));
        const bm = cache.get(key);
        this.bouncers.push({ solid: null, mesh: bm, squash: 0, id });
      }
      const so = { s, id, mesh, offsetY, base: [...s.pos], cur: [...s.pos], move: s.move || null };
      if (vis === 'bouncer') this.bouncers[this.bouncers.length - 1].solid = so;
      this.solids.push(so);
    }

    // ---- decor (instanced) ---------------------------------------------------------
    this.decorGroups = [];
    this.braziers = [];
    this.statues = [];
    this.arches = [];
    this.waterfalls = [];
    const groups = new Map();
    const addInst = (key, kind, variant, d, extra = {}) => {
      if (!groups.has(key)) groups.set(key, { kind, variant, list: [] });
      groups.get(key).list.push({ ...d, ...extra });
    };
    for (const d of data.decor) {
      if (d.mesh === 'waterfall') {
        const [w, h] = d.size || [3, 10];
        const mesh = keep(M.buildWaterfall(r, w, h));
        this.waterfalls.push({ mesh, model: m4.trs(d.pos, d.rot || 0), pos: d.pos, w, h, rot: d.rot || 0 });
        continue;
      }
      if (d.mesh === 'statue') { this.statues.push(d); continue; }
      if (d.mesh === 'arch') { this.arches.push(d); continue; }
      const variant = (d.seed || 0) % 3;
      addInst(`${d.mesh}_${variant}`, d.mesh, variant, d);
      if (d.mesh === 'brazier') {
        addInst('flame_0', 'flame', 0, { ...d, pos: [d.pos[0], d.pos[1] + 1.15 * d.scale, d.pos[2]] });
        this.braziers.push([d.pos[0], d.pos[1] + 2.0 * d.scale, d.pos[2]]);
      }
    }
    const rnd = mulberry(data.id * 999);
    for (const [, g] of groups) {
      const mesh = keep(g.kind === 'flame' ? buildFlame(r) : MH.MH_DECOR.has(g.kind) ? MH.buildDecorMH(r, g.kind, g.variant) : M.buildDecor(r, g.kind, g.variant, this.pal));
      const arr = new Float32Array(g.list.length * 8);
      g.list.forEach((d, i) => {
        arr.set([d.pos[0], d.pos[1] - 0.05, d.pos[2], d.scale, d.rot, WIND[g.kind] ?? 0, 0.9 + rnd() * 0.2, 1], i * 8);
      });
      const inst = r.createInstanced(mesh, arr);
      this.meshes.push(inst);
      const em = EMIS[g.kind] || 0;
      this.decorGroups.push({ kind: g.kind, inst, emissive: [em, em, em], noShadow: g.kind === 'flower' || g.kind === 'flame' || g.kind === 'marigold' || g.kind === 'diya', doubleSided: g.kind === 'palm' });
    }
    if (this.arches.length) this.archMesh = keep(M.buildArch(r, this.pal));
    if (this.statues.length) {
      this.statueParts = M.buildClawd(r, hex('#e9dcc4'));
      Object.values(this.statueParts).forEach(keep);
      this.pedestal = keep(new M.MB().lathe(m4.ident(), [[0.0001, 0], [1.1, 0], [1.1, 0.15], [0.95, 0.25], [0.9, 0.9], [1.05, 1.0], [0.0001, 1.0]], 16, hex('#cfc3ad'), false).build(r));
    }

    // ---- grass ------------------------------------------------------------------------
    this.grass = null;
    const q = game.settings.grass;
    if (data.grass.length && q > 0) {
      const g = this.pal.grass;
      const blade = keep(M.buildGrassBlade(r, g[0], g[1]));
      const list = [];
      for (const patch of data.grass) {
        const [x, y, z] = patch.pos;
        const n = Math.floor(Math.PI * patch.radius * patch.radius * 14 * q);
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * patch.radius;
          list.push(x + Math.cos(a) * rr, y - 0.02, z + Math.sin(a) * rr, 0.6 + rnd() * 0.8, rnd() * 6.28, 0.5 + rnd() * 0.4, 0.75 + rnd() * 0.45, 0);
        }
      }
      this.grass = r.createInstanced(blade, new Float32Array(list));
      this.meshes.push(this.grass);
    }

    // ---- collectibles -----------------------------------------------------------------
    this.reptiles = game.character === 'manus';
    const sparkMesh = this.reptiles ? game.shared.lizard : game.shared.spark;
    this.sparks = data.sparks.map((p, i) => ({ p, alive: true, phase: i * 0.7 }));
    this.sparkTotal = this.sparks.length;
    this.sparkBuf = new Float32Array(this.sparks.length * 8);
    this.sparkInst = r.createInstanced(sparkMesh, this.sparkBuf);
    this.meshes.push(this.sparkInst);
    this.tokens = data.tokens.map((p, i) => ({ p, alive: true, i }));
    this.checkpoints = data.checkpoints.map((p) => ({ p, active: false, t: 0 }));
    this.goal = data.goal;
    this.hints = data.hints.map((h) => ({ ...h, shown: false }));

    // ---- enemies & hazards ---------------------------------------------------------------
    this.enemies = data.enemies.map((e, i) => this.makeEnemy(e, i));
    this.lasers = data.lasers.map((l) => ({ ...l, angle: 0 }));

    this.time = 0;
    this.sparkGot = 0;
    this.tokenGot = [false, false, false];
    this.spawnPoint = [...data.spawn];
    this.fxTimer = 0;
    this.updateMovers(0);
    this.setupAmbient();
  }

  setupAmbient() {
    const fx = this.g.native.fx;
    const th = this.d.theme;
    const pc = lin(hex(th.particleColor || '#ffffff')).map((c) => c * 1.6);
    const type = { mote: fx.T.MOTE, snow: fx.T.SNOW, ember: fx.T.EMBER, rain: fx.T.RAIN }[th.particles] ?? fx.T.MOTE;
    fx.clear();
    fx.ambient(type, pc, Math.round(260 * this.g.settings.particles), 34);
    fx.wind(this.env.wind[0] * 1.5, this.env.wind[1] * 1.5);
    fx.gravity(this.d.gravity || 1);
  }

  makeEnemy(e, i) {
    if (e.type === 'wisp') return { type: 'wisp', home: [...e.pos], pos: [...e.pos], range: e.range || 7, speed: e.speed || 3, alive: true, dead: 0, phase: i * 1.7, yaw: 0 };
    return { type: 'glitchling', a: e.a, b: e.b, pos: [...e.a], speed: e.speed || 2.5, t: 0, dir: 1, alive: true, dead: 0, yaw: 0, phase: i * 1.3 };
  }

  resetEnemies() { this.enemies = this.d.enemies.map((e, i) => this.makeEnemy(e, i)); }

  moverOffset(m, t) {
    const a = t * m.speed + m.phase;
    if (m.type === 'circle') return [Math.cos(a) * m.radius, 0, Math.sin(a) * m.radius];
    const s = Math.sin(a) * m.amp;
    return [m.axis[0] * s, m.axis[1] * s, m.axis[2] * s];
  }

  updateMovers(t) {
    const phys = this.g.native.physics;
    for (const so of this.solids) {
      if (!so.move) continue;
      const o = this.moverOffset(so.move, t);
      so.cur = [so.base[0] + o[0], so.base[1] + o[1], so.base[2] + o[2]];
      phys.move(so.id, so.cur[0], so.cur[1], so.cur[2]);
    }
  }

  // ---------------------------------------------------------------------------
  // simulation (called at fixed rate)
  // ---------------------------------------------------------------------------
  step(dt) {
    this.time += dt;
    this.updateMovers(this.time);
  }

  // per-frame gameplay interactions; returns list of events for the game
  interact(dt, player, invuln) {
    const out = [];
    const t = this.time;
    const p = player.pos;
    const fx = this.g.native.fx;
    const center = [p[0], p[1] + 0.6, p[2]];

    // sparks
    for (const s of this.sparks) {
      if (!s.alive) continue;
      const dx = s.p[0] - center[0], dy = s.p[1] - center[1], dz = s.p[2] - center[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1.3) {
        s.alive = false;
        this.sparkGot++;
        const c = this.reptiles ? [0.6, 2.2, 0.8] : [2.4, 1.2, 0.5];
        fx.emit(fx.T.BURST, s.p, 14, c, 6);
        fx.emit(fx.T.RING, s.p, 12, this.reptiles ? [0.9, 2.0, 1.0] : [2.0, 1.4, 0.7], 5);
        out.push({ type: 'spark', pos: s.p });
      } else if (d2 < 6) {
        // gentle magnet
        const k = dt * 6;
        s.p[0] -= dx * k * 0.3; s.p[1] -= dy * k * 0.3; s.p[2] -= dz * k * 0.3;
      }
    }
    // tokens
    for (const tk of this.tokens) {
      if (!tk.alive) continue;
      if (v3.dist(tk.p, center) < 1.4) {
        tk.alive = false;
        this.tokenGot[tk.i] = true;
        fx.emit(fx.T.BURST, tk.p, 40, [2.6, 2.0, 0.6], 9);
        fx.emit(fx.T.RING, tk.p, 24, [2.6, 2.2, 0.9], 7);
        out.push({ type: 'token', idx: tk.i, pos: tk.p });
      }
    }
    // checkpoints
    for (const c of this.checkpoints) {
      if (Math.hypot(c.p[0] - p[0], c.p[2] - p[2]) < 1.8 && Math.abs(c.p[1] - p[1]) < 2.5 && !c.active) {
        this.checkpoints.forEach((o) => { o.active = false; });
        c.active = true; c.t = 0;
        this.spawnPoint = [c.p[0], c.p[1] + 0.3, c.p[2]];
        fx.emit(fx.T.BURST, [c.p[0], c.p[1] + 2.4, c.p[2]], 30, lin(this.accent).map((x) => x * 3), 6);
        out.push({ type: 'checkpoint' });
      }
      c.t += dt;
    }
    // goal
    if (Math.hypot(this.goal[0] - p[0], this.goal[2] - p[2]) < 2.0 && p[1] > this.goal[1] - 1 && p[1] < this.goal[1] + 4) out.push({ type: 'goal' });

    // hints
    for (const h of this.hints) {
      const inside = Math.hypot(h.pos[0] - p[0], h.pos[2] - p[2]) < h.radius && Math.abs(h.pos[1] - p[1]) < 3;
      if (inside && !h.shown) { h.shown = true; out.push({ type: 'hint', text: h.text }); }
      if (!inside && h.shown && Math.hypot(h.pos[0] - p[0], h.pos[2] - p[2]) > h.radius + 4) h.shown = false;
    }

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) { e.dead += dt; continue; }
      if (e.type === 'glitchling') {
        const len = v3.dist(e.a, e.b) || 1;
        e.t += (e.speed / len) * dt * e.dir;
        if (e.t > 1) { e.t = 1; e.dir = -1; }
        if (e.t < 0) { e.t = 0; e.dir = 1; }
        const np = v3.lerp(e.a, e.b, e.t);
        const want = Math.atan2((e.b[0] - e.a[0]) * e.dir, (e.b[2] - e.a[2]) * e.dir);
        e.yaw += (((want - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 8);
        e.pos = np;
        const hd = Math.hypot(np[0] - p[0], np[2] - p[2]);
        if (hd < 0.95 && p[1] > np[1] - 0.5 && p[1] < np[1] + 1.1) {
          if ((player.vel[1] < -1 && p[1] > np[1] + 0.45) || player.pounding) {
            e.alive = false;
            fx.emit(fx.T.BURST, [np[0], np[1] + 0.5, np[2]], 26, [1.6, 0.5, 2.2], 7);
            fx.emit(fx.T.DUST, [np[0], np[1] + 0.2, np[2]], 10, [1, 0.8, 1.2], 3);
            out.push({ type: 'stomp', pos: np });
          } else if (invuln <= 0) {
            out.push({ type: 'hurt', from: np });
          }
        }
      } else {
        // wisp: hover, chase when the player is near
        const toP = v3.sub(center, e.pos);
        const dHome = v3.dist(center, e.home);
        let target;
        if (dHome < e.range && invuln <= 0) target = center;
        else target = [e.home[0] + Math.cos(t * 0.6 + e.phase) * 2, e.home[1] + Math.sin(t * 1.3 + e.phase) * 0.6, e.home[2] + Math.sin(t * 0.6 + e.phase) * 2];
        const dir = v3.sub(target, e.pos);
        const dl = v3.len(dir);
        if (dl > 0.01) {
          const sp = Math.min(dl, e.speed * dt * (target === center ? 1 : 0.6));
          e.pos = v3.add(e.pos, v3.scale(dir, sp / dl));
        }
        e.yaw = Math.atan2(toP[0], toP[2]);
        if (Math.random() < dt * 20) fx.emit(fx.T.TRAIL, [e.pos[0] + (Math.random() - 0.5) * 0.4, e.pos[1] - 0.3, e.pos[2] + (Math.random() - 0.5) * 0.4], 1, [0.8, 1.6, 2.0], 0.16);
        const dd = v3.dist(e.pos, center);
        if (dd < 0.95) {
          if ((player.vel[1] < -1 && center[1] > e.pos[1] + 0.2) || player.pounding) {
            e.alive = false;
            fx.emit(fx.T.BURST, e.pos, 30, [0.8, 1.8, 2.4], 7);
            out.push({ type: 'stomp', pos: e.pos });
          } else if (invuln <= 0) {
            out.push({ type: 'hurt', from: e.pos });
          }
        }
      }
    }

    // sunbeam sweepers
    for (const L of this.lasers) {
      L.angle = t * L.speed;
      const by = L.pos[1] + (L.height ?? 0.55);
      const dx = Math.cos(L.angle), dz = -Math.sin(L.angle);
      const rx = p[0] - L.pos[0], rz = p[2] - L.pos[2];
      const along = clamp(rx * dx + rz * dz, 0, L.length);
      const px = rx - dx * along, pz = rz - dz * along;
      if (Math.hypot(px, pz) < 0.5 && p[1] < by + 0.12 && p[1] + 1.0 > by && invuln <= 0 && along > 0.3) {
        out.push({ type: 'hurt', from: [L.pos[0] + dx * along, by, L.pos[2] + dz * along], zap: true });
      }
    }

    // ambient vfx
    this.fxTimer += dt;
    if (this.fxTimer > 0.12) {
      this.fxTimer = 0;
      for (const b of this.braziers) if (v3.dist(b, p) < 40) fx.emit(fx.T.EMBER, b, 1, [3, 1.2, 0.3], 0.4);
      for (const w of this.waterfalls) {
        if (v3.dist(w.pos, p) > 60) continue;
        const bx = w.pos[0] + Math.cos(w.rot) * 0.0, bz = w.pos[2];
        fx.emit(fx.T.DUST, [bx + Math.sin(w.rot) * 0.6 + (Math.random() - 0.5) * w.w, w.pos[1] - w.h + 0.3, bz + Math.cos(w.rot) * 0.6], 2, [1.4, 1.6, 1.7], 2);
      }
      for (const c of this.checkpoints) if (c.active) fx.emit(fx.T.EMBER, [c.p[0], c.p[1] + 2.4, c.p[2]], 1, lin(this.accent).map((x) => x * 2.5), 0.3);
      // portal motes
      fx.emit(fx.T.EMBER, [this.goal[0] + (Math.random() - 0.5) * 3, this.goal[1] + 0.6, this.goal[2] + (Math.random() - 0.5) * 0.6], 1, [2.4, 1.6, 0.8], 0.4);
    }
    return out;
  }

  onBounce(p) {
    let best = null, bd = 3;
    for (const b of this.bouncers) {
      const d = Math.hypot(b.solid.cur[0] - p[0], b.solid.cur[2] - p[2]);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) best.squash = 1;
  }

  // ---------------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------------
  draw(r, dt, cam) {
    const t = this.time;
    const sh = this.g.shared;
    for (const so of this.solids) {
      if (!so.mesh) continue;
      const pos = so.offsetY ? [so.cur[0], so.cur[1] + so.offsetY, so.cur[2]] : so.cur;
      r.draw({ mesh: so.mesh, model: m4.trs(pos), rim: 0.2, spec: 0.06 });
    }
    for (const b of this.bouncers) {
      b.squash = Math.max(0, b.squash - dt * 3);
      const s = b.squash > 0 ? 1 - Math.sin(b.squash * Math.PI * 3) * 0.35 * b.squash : 1 + Math.sin(t * 3) * 0.03;
      const base = [b.solid.cur[0], b.solid.cur[1] - 0.2, b.solid.cur[2]];
      r.draw({ mesh: b.mesh.stem, model: m4.trs(base) });
      r.draw({ mesh: b.mesh.cap, model: m4.trs([base[0], base[1] + 0.2, base[2]], t * 0.3, 0, 0, [1 / Math.sqrt(s), s, 1 / Math.sqrt(s)]), rim: 0.5, emissive: [0.08, 0.05, 0.05], outline: 0.8 });
    }
    for (const g of this.decorGroups) {
      r.draw({ inst: g.inst, emissive: g.emissive, noShadow: g.noShadow, doubleSided: g.doubleSided, rim: 0.3 });
    }
    if (this.grass) r.draw({ inst: this.grass, noShadow: true, doubleSided: true, rim: 0.15, spec: 0.0 });
    for (const a of this.arches) r.draw({ mesh: this.archMesh, model: m4.trs(a.pos, a.rot, 0, 0, [a.scale, a.scale, a.scale]), rim: 0.25 });
    for (const s of this.statues) this.drawStatue(r, s);

    // sparks (instanced, bobbing + spinning)
    let n = 0;
    for (const s of this.sparks) {
      if (!s.alive) continue;
      this.sparkBuf.set([s.p[0], s.p[1] + Math.sin(t * 2.5 + s.phase) * 0.15 - (this.reptiles ? 0.15 : 0), s.p[2], this.reptiles ? 0.8 : 0.9, t * (this.reptiles ? 1.3 : 2.2) + s.phase, 0, 1, 1], n * 8);
      n++;
    }
    r.updateInstances(this.sparkInst, this.sparkBuf, n);
    r.draw({ inst: this.sparkInst, emissive: this.reptiles ? [0.12, 0.12, 0.12] : [0.75, 0.75, 0.75], rim: 0.6, noShadow: false });

    for (const tk of this.tokens) {
      if (!tk.alive) continue;
      const y = tk.p[1] + Math.sin(t * 2 + tk.i) * 0.2;
      if (this.reptiles) r.draw({ mesh: sh.komodo, model: m4.trs([tk.p[0], y - 0.3, tk.p[2]], t * 1.2 + tk.i, 0, 0, [1.0, 1.0, 1.0]), emissive: [0.05, 0.05, 0.04], rim: 0.7, spec: 0.3, outline: 0.8 });
      else r.draw({ mesh: sh.token, model: m4.trs([tk.p[0], y, tk.p[2]], t * 2.5 + tk.i, 0, 0, [1.25, 1.25, 1.25]), emissive: [0.35, 0.3, 0.12], rim: 0.8, spec: 0.8, outline: 0.8 });
      r.drawFx({ mesh: sh.halo, model: billboard(cam, [tk.p[0], y, tk.p[2]], 3.2), mode: 4, colA: [2.0, 1.5, 0.5], param: 0.5, additive: true, depth: v3.dist(cam.pos, tk.p) });
    }

    for (const c of this.checkpoints) {
      r.draw({ mesh: sh.checkpoint.tower, model: m4.trs(c.p), rim: 0.3, outline: 0.7 });
      const glow = c.active ? 2.5 + Math.sin(t * 4) * 0.5 : 0.25;
      const ac = lin(this.accent);
      r.draw({ mesh: sh.checkpoint.lamp, model: m4.trs(c.p), emissive: c.active ? ac.map((x) => x * glow + 0.3) : [0.25, 0.22, 0.2], rim: 0 });
      if (c.active) r.drawFx({ mesh: sh.halo, model: billboard(cam, [c.p[0], c.p[1] + 2.4, c.p[2]], 4), mode: 4, colA: ac.map((x) => x * 2), param: 0.6, additive: true, depth: v3.dist(cam.pos, c.p) });
    }

    // goal portal
    const gp = this.goal;
    r.draw({ mesh: sh.portal.base, model: m4.trs(gp), rim: 0.3 });
    r.draw({ mesh: sh.portal.ring, model: m4.trs([gp[0], gp[1] + Math.sin(t * 1.5) * 0.08, gp[2]], t * 0.4), emissive: [0.5, 0.35, 0.1], rim: 0.7, spec: 0.7, outline: 0.8 });
    r.drawFx({ mesh: sh.portal.disc, model: m4.trs([gp[0], gp[1], gp[2]], Math.atan2(cam.pos[0] - gp[0], cam.pos[2] - gp[2])), mode: 1, colA: lin(this.accent).map((x) => x * 1.2), colB: [1.0, 0.85, 0.5], param: 1.0, depth: v3.dist(cam.pos, gp) });

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) {
        if (e.dead < 0.35) {
          const s = 1 - e.dead / 0.35;
          const mesh = e.type === 'wisp' ? sh.wisp.body : sh.glitch.body;
          r.draw({ mesh, model: m4.trs(e.pos, e.yaw, 0, 0, [1 + (1 - s), s * 0.3 + 0.05, 1 + (1 - s)]), flash: 0.5 });
        }
        continue;
      }
      if (e.type === 'glitchling') {
        const j = Math.sin(t * 37 + e.phase) > 0.85 ? 0.06 : 0;
        const hop = Math.abs(Math.sin(t * 7 + e.phase)) * 0.12;
        const pos = [e.pos[0] + j, e.pos[1] + hop, e.pos[2]];
        const sq = 1 - hop * 0.6;
        const model = m4.trs(pos, e.yaw, 0, 0, [1 + hop * 0.4, sq, 1 + hop * 0.4]);
        r.draw({ mesh: sh.glitch.body, model, rim: 0.6, emissive: [0.08, 0.02, 0.12], outline: 1.0 });
        r.draw({ mesh: sh.glitch.eyes, model, rim: 0 });
        for (let k = 0; k < 3; k++) {
          const a = t * 2.5 + k * 2.09 + e.phase;
          r.draw({ mesh: sh.glitch.bit, model: m4.trs([pos[0] + Math.cos(a) * 0.75, pos[1] + 0.6 + Math.sin(a * 2) * 0.2, pos[2] + Math.sin(a) * 0.75], a, a), emissive: [1.4, 0.4, 1.1], noShadow: true });
        }
      } else {
        const bob = Math.sin(t * 3 + e.phase) * 0.15;
        const pos = [e.pos[0], e.pos[1] + bob, e.pos[2]];
        const model = m4.trs(pos, e.yaw, 0, 0, [1, 1 + Math.sin(t * 6) * 0.05, 1]);
        r.draw({ mesh: sh.wisp.body, model, emissive: [0.45, 0.9, 1.1], rim: 1.0, noShadow: true });
        r.draw({ mesh: sh.wisp.eyes, model, rim: 0, noShadow: true });
        r.drawFx({ mesh: sh.halo, model: billboard(cam, pos, 2.6), mode: 4, colA: [0.4, 1.0, 1.4], param: 0.45, additive: true, depth: v3.dist(cam.pos, pos) });
      }
    }

    // sweepers
    for (const L of this.lasers) {
      r.draw({ mesh: sh.laser.post, model: m4.trs(L.pos), emissive: [0, 0, 0], rim: 0.3 });
      const by = L.pos[1] + (L.height ?? 0.55);
      r.drawFx({ mesh: sh.laser.beam, model: m4.trs([L.pos[0], by, L.pos[2]], L.angle, 0, 0, [L.length, 1, 1]), mode: 2, colA: [2.4, 0.5, 0.15], additive: true, depth: v3.dist(cam.pos, L.pos) - 1 });
      r.drawFx({ mesh: sh.halo, model: billboard(cam, [L.pos[0], L.pos[1] + 0.75, L.pos[2]], 1.6), mode: 4, colA: [2.5, 0.8, 0.3], param: 0.8, additive: true, depth: v3.dist(cam.pos, L.pos) });
    }

    for (const w of this.waterfalls) {
      r.drawFx({ mesh: w.mesh, model: w.model, mode: 0, colA: lin(this.d.theme.floorColor).map((x) => x * 1.3), param: w.h / 10, depth: v3.dist(cam.pos, w.pos) });
    }
  }

  drawStatue(r, s) {
    const P = this.statueParts;
    const sc = s.scale;
    const base = m4.trs(s.pos, s.rot, 0, 0, [sc, sc, sc]);
    r.draw({ mesh: this.pedestal, model: base, rim: 0.2 });
    const root = m4.mul(base, m4.trs([0, 1.0 + 0.62, 0]));
    const put = (mesh, local) => r.draw({ mesh, model: m4.mul(root, local), rim: 0.3 });
    put(P.body, m4.ident());
    for (const x of [-1, 1]) {
      put(P.eye, m4.trs([x * 0.2, 0.07, 0.4]));
      put(P.arm, m4.trs([x * 0.57, 0.0, 0.02], 0, 0, -x * 0.9));
    }
    for (const [x, z] of [[-0.27, 0.2], [0.27, 0.2], [-0.27, -0.2], [0.27, -0.2]]) put(P.leg, m4.trs([x, -0.34, z]));
    put(P.stem, m4.trs([0, 0.34, 0]));
    put(P.spark, m4.trs([0, 0.56, 0]));
  }

  dispose() {
    for (const m of this.meshes) this.r.deleteMesh(m);
    this.meshes = [];
  }
}

export function billboard(cam, p, s) {
  const r = cam.right, u = cam.up;
  const f = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
  return new Float32Array([r[0] * s, r[1] * s, r[2] * s, 0, u[0] * s, u[1] * s, u[2] * s, 0, f[0], f[1], f[2], 0, p[0], p[1], p[2], 1]);
}

function buildFlame(r) {
  const mb = new M.MB();
  mb.lathe(m4.ident(), [[0.0001, 0], [0.36, 0.06], [0.28, 0.4], [0.12, 0.78], [0.0001, 1.05]], 8, (v) => [1, 0.45 + v * 0.45, 0.12 + v * 0.4], false);
  return mb.build(r);
}
