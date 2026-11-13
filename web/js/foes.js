// Enemy AI for Rambot, Spitpod and Shellback, the Glitch King boss, and wind gusts.
import { m4, v3, clamp } from './math.js';

export const FOE_TYPES = new Set(['rambot', 'spitpod', 'shellback']);
const TAU = Math.PI * 2;
const angleTo = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]);
const turn = (a, b, k) => a + ((((b - a + Math.PI * 3) % TAU) - Math.PI) * k);

function billboard(cam, p, s) {
  const r = cam.right, u = cam.up;
  const f = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
  return new Float32Array([r[0] * s, r[1] * s, r[2] * s, 0, u[0] * s, u[1] * s, u[2] * s, 0, f[0], f[1], f[2], 0, p[0], p[1], p[2], 1]);
}

export function makeFoe(e, i) {
  const base = { type: e.type, alive: true, dead: 0, phase: i * 1.9, yaw: e.yaw || 0, flash: 0 };
  if (e.type === 'rambot') return { ...base, home: [...e.pos], pos: [...e.pos], range: e.range || 9, speed: e.speed || 11, state: 'idle', t: 0, dir: [0, 0, 1] };
  if (e.type === 'spitpod') return { ...base, pos: [...e.pos], range: e.range || 14, rate: e.rate || 2.4, cd: 1.5 + (i % 3) * 0.4, headYaw: e.yaw || 0, recoil: 0 };
  return { ...base, a: e.a, b: e.b, pos: [...e.a], speed: e.speed || 1.6, t: 0, dir: 1, clank: 0 };
}

// Shared stomp test. Returns 'kill', 'clank', 'hurt' or null.
function contact(e, p, player, { radius = 1.0, top = 0.5, height = 1.2, armored = false, harmless = false }) {
  const hd = Math.hypot(e.pos[0] - p[0], e.pos[2] - p[2]);
  if (hd > radius || p[1] < e.pos[1] - 0.5 || p[1] > e.pos[1] + height) return null;
  const fromAbove = player.vel[1] < -1 && p[1] > e.pos[1] + top;
  if (player.pounding && p[1] > e.pos[1] + top * 0.6) return 'kill';
  if (fromAbove) return armored ? 'clank' : 'kill';
  return harmless ? null : 'hurt';
}

export function updateFoe(world, e, dt, player, invuln, out) {
  const g = world.g, phys = g.native.physics, fx = g.native.fx;
  const p = player.pos;
  const center = [p[0], p[1] + 0.6, p[2]];
  e.flash = Math.max(0, e.flash - dt);
  const kill = (burst) => {
    e.alive = false;
    world.stomped++;
    fx.emit(fx.T.BURST, [e.pos[0], e.pos[1] + 0.6, e.pos[2]], 30, burst, 8);
    fx.emit(fx.T.DUST, [e.pos[0], e.pos[1] + 0.2, e.pos[2]], 12, [1, 0.9, 0.8], 4);
    out.push({ type: 'stomp', pos: e.pos });
  };

  if (e.type === 'rambot') {
    const toP = Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]);
    const sameLevel = Math.abs(p[1] - e.pos[1]) < 1.6;
    e.t += dt;
    if (e.state === 'idle') {
      if (toP < e.range && sameLevel && invuln <= 0) {
        const want = angleTo(e.pos, p);
        e.yaw = turn(e.yaw, want, Math.min(1, dt * 6));
        if (Math.abs((((want - e.yaw + Math.PI * 3) % TAU) - Math.PI)) < 0.25 && e.t > 0.8) {
          e.state = 'windup'; e.t = 0;
          e.dir = v3.norm([p[0] - e.pos[0], 0, p[2] - e.pos[2]]);
        }
      } else {
        e.yaw += Math.sin(g.time * 0.7 + e.phase) * dt * 0.6;
        // drift back home
        const h = v3.sub(e.home, e.pos); h[1] = 0;
        if (v3.len(h) > 0.2) e.pos = v3.add(e.pos, v3.scale(v3.norm(h), Math.min(v3.len(h), 2 * dt)));
      }
    } else if (e.state === 'windup') {
      if (Math.random() < dt * 25) fx.emit(fx.T.DUST, [e.pos[0] - e.dir[0] * 0.7, e.pos[1] + 0.05, e.pos[2] - e.dir[2] * 0.7], 2, [1.1, 1.0, 0.9], 2);
      if (e.t > 0.6) { e.state = 'charge'; e.t = 0; out.push({ type: 'charge', pos: e.pos }); }
    } else if (e.state === 'charge') {
      const step = e.speed * dt;
      const nx = e.pos[0] + e.dir[0] * step, nz = e.pos[2] + e.dir[2] * step;
      const ahead = phys.groundHeight(nx + e.dir[0] * 0.6, e.pos[1] + 0.3, nz + e.dir[2] * 0.6, 1.0);
      const wall = phys.raycast([e.pos[0], e.pos[1] + 0.5, e.pos[2]], [e.dir[0], 0, e.dir[2]], 0.9);
      if (ahead < e.pos[1] - 0.5 || wall < 0.9 || e.t > 1.4) {
        e.state = 'dizzy'; e.t = 0;
        fx.emit(fx.T.BURST, [e.pos[0] + e.dir[0] * 0.8, e.pos[1] + 0.6, e.pos[2] + e.dir[2] * 0.8], 12, [2, 1.6, 0.8], 4);
        out.push({ type: 'bonk', pos: e.pos });
      } else {
        e.pos = [nx, e.pos[1], nz];
        if (Math.random() < dt * 30) fx.emit(fx.T.DUST, [e.pos[0], e.pos[1] + 0.05, e.pos[2]], 1, [1.1, 1.0, 0.9], 1.5);
      }
    } else if (e.state === 'dizzy') {
      if (e.t > 1.8) { e.state = 'idle'; e.t = 0; }
    }
    const c = contact(e, p, player, { radius: 1.05, top: 0.7, height: 1.3, harmless: e.state === 'dizzy' });
    if (c === 'kill') kill([1.6, 1.2, 0.6]);
    else if (c === 'hurt' && invuln <= 0) out.push({ type: 'hurt', from: e.pos, hard: e.state === 'charge' });
  } else if (e.type === 'spitpod') {
    const d = v3.dist(center, [e.pos[0], e.pos[1] + 0.9, e.pos[2]]);
    e.recoil = Math.max(0, e.recoil - dt * 4);
    if (d < e.range) {
      const want = angleTo(e.pos, p);
      e.headYaw = turn(e.headYaw, want, Math.min(1, dt * 4));
      e.cd -= dt;
      if (e.cd <= 0 && invuln <= 0) {
        e.cd = e.rate;
        const muzzle = [e.pos[0] + Math.sin(e.headYaw) * 0.7, e.pos[1] + 0.95, e.pos[2] + Math.cos(e.headYaw) * 0.7];
        const aim = [center[0] + player.vel[0] * 0.25, center[1], center[2] + player.vel[2] * 0.25];
        const v = v3.scale(v3.norm(v3.sub(aim, muzzle)), 7.5);
        world.orbs.push({ p: muzzle, v, life: 3.5 });
        e.recoil = 1;
        fx.emit(fx.T.BURST, muzzle, 8, [2.4, 0.8, 2.2], 2.5);
        out.push({ type: 'spit', pos: muzzle });
      }
    } else e.cd = Math.max(e.cd, 0.8);
    const c = contact(e, p, player, { radius: 0.85, top: 0.75, height: 1.4 });
    if (c === 'kill') kill([2.0, 0.6, 2.2]);
    else if (c === 'hurt' && invuln <= 0) out.push({ type: 'hurt', from: e.pos });
  } else if (e.type === 'shellback') {
    const len = v3.dist(e.a, e.b) || 1;
    e.t += (e.speed / len) * dt * e.dir;
    if (e.t > 1) { e.t = 1; e.dir = -1; }
    if (e.t < 0) { e.t = 0; e.dir = 1; }
    e.pos = v3.lerp(e.a, e.b, e.t);
    e.yaw = turn(e.yaw, Math.atan2((e.b[0] - e.a[0]) * e.dir, (e.b[2] - e.a[2]) * e.dir), Math.min(1, dt * 5));
    e.clank = Math.max(0, e.clank - dt);
    const c = contact(e, p, player, { radius: 1.05, top: 0.55, height: 1.3, armored: true });
    if (c === 'kill') kill([1.2, 1.8, 0.6]);
    else if (c === 'clank' && e.clank <= 0) {
      e.clank = 0.35; e.flash = 0.2;
      fx.emit(fx.T.BURST, [e.pos[0], e.pos[1] + 0.9, e.pos[2]], 14, [2.6, 2.4, 1.6], 5);
      out.push({ type: 'clank', pos: e.pos });
    } else if (c === 'hurt' && invuln <= 0 && e.clank <= 0) out.push({ type: 'hurt', from: e.pos });
  }
}

// Glowing orbs fired by Spitpods
export function updateOrbs(world, dt, player, invuln, out) {
  const phys = world.g.native.physics, fx = world.g.native.fx;
  const c = [player.pos[0], player.pos[1] + 0.6, player.pos[2]];
  for (const o of world.orbs) {
    const sp = v3.len(o.v);
    const hit = phys.raycast(o.p, v3.scale(o.v, 1 / sp), sp * dt);
    o.p = v3.add(o.p, v3.scale(o.v, dt));
    o.life -= dt;
    if (Math.random() < dt * 30) fx.emit(fx.T.TRAIL, o.p, 1, [2.4, 0.7, 2.2], 0.18);
    if (hit < sp * dt || o.p[1] < world.d.killY) { o.life = 0; fx.emit(fx.T.BURST, o.p, 10, [2.2, 0.7, 2.0], 3); continue; }
    if (v3.dist(o.p, c) < 0.75) {
      o.life = 0;
      fx.emit(fx.T.BURST, o.p, 14, [2.4, 0.8, 2.2], 4);
      if (invuln <= 0) out.push({ type: 'hurt', from: o.p });
    }
  }
  world.orbs = world.orbs.filter((o) => o.life > 0);
}

// ---------------------------------------------------------------------------
// Wind gusts: zones push the player (and blow the ambient particles) in pulses.
// ---------------------------------------------------------------------------
export function windAt(world, p, t) {
  let x = 0, z = 0, active = null;
  for (const w of world.winds) {
    if (Math.hypot(p[0] - w.pos[0], p[2] - w.pos[2]) > w.radius || Math.abs(p[1] - w.pos[1]) > 10) continue;
    const period = w.period || 4;
    const ph = ((t + (w.phase || 0)) % period) / period;
    // 60% of each cycle is a gust that ramps up and down smoothly
    const g = ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) : 0;
    const l = Math.hypot(w.dir[0], w.dir[1]) || 1;
    x += (w.dir[0] / l) * w.strength * g;
    z += (w.dir[1] / l) * w.strength * g;
    if (g > 0.2) active = w;
  }
  return { x, z, active };
}

// ---------------------------------------------------------------------------
// The Glitch King: hops at you, slams out shockwave rings, then gets dizzy.
// Only a ground pound on his head while he's dizzy hurts him.
// ---------------------------------------------------------------------------
export function makeBoss(b) {
  if (!b) return null;
  return { pos: [...b.pos], home: [...b.pos], hp: b.hp || 3, maxHp: b.hp || 3, arena: b.arena || 7, state: 'sleep', t: 0,
    slams: 0, from: null, to: null, rings: [], flash: 0, yaw: 0, name: b.name || 'The Glitch King' };
}

export function updateBoss(world, dt, player, invuln, out) {
  const B = world.boss;
  if (!B || B.state === 'gone') return;
  const fx = world.g.native.fx;
  const p = player.pos;
  const hd = Math.hypot(p[0] - B.pos[0], p[2] - B.pos[2]);
  B.t += dt;
  B.flash = Math.max(0, B.flash - dt);
  const hopTime = [0.55, 0.7, 0.9][Math.min(2, B.hp - 1)] || 0.9;
  const startHop = () => {
    B.state = 'hop'; B.t = 0; B.from = [...B.pos];
    let tx = p[0], tz = p[2];
    const dx = tx - B.home[0], dz = tz - B.home[2], dl = Math.hypot(dx, dz), lim = B.arena - 1.6;
    if (dl > lim) { tx = B.home[0] + dx / dl * lim; tz = B.home[2] + dz / dl * lim; }
    B.to = [tx, B.home[1], tz];
  };

  if (B.state === 'sleep') {
    B.pos[1] = B.home[1] + Math.abs(Math.sin(B.t * 1.5)) * 0.05;
    if (hd < B.arena + 1.5 && Math.abs(p[1] - B.home[1]) < 3) { B.state = 'intro'; B.t = 0; out.push({ type: 'bossstart' }); }
  } else if (B.state === 'intro') {
    B.pos[1] = B.home[1] + Math.abs(Math.sin(B.t * 8)) * 0.6;
    B.yaw = angleTo(B.pos, p);
    if (B.t > 1.4) { B.pos[1] = B.home[1]; startHop(); }
  } else if (B.state === 'hop') {
    const u = clamp(B.t / hopTime, 0, 1);
    B.pos = [B.from[0] + (B.to[0] - B.from[0]) * u, B.home[1] + Math.sin(u * Math.PI) * 3.2, B.from[2] + (B.to[2] - B.from[2]) * u];
    B.yaw = turn(B.yaw, angleTo(B.pos, p), Math.min(1, dt * 8));
    if (u >= 1) {
      B.state = 'slam'; B.t = 0; B.slams++;
      B.rings.push({ c: [B.pos[0], B.home[1], B.pos[2]], r: 0.8 });
      fx.emit(fx.T.RING, [B.pos[0], B.home[1] + 0.1, B.pos[2]], 36, [2.4, 0.6, 2.2], 10);
      fx.emit(fx.T.DUST, B.pos, 20, [1.2, 1.0, 1.1], 6);
      out.push({ type: 'bossslam' });
    }
  } else if (B.state === 'slam') {
    if (B.t > 0.55) {
      if (B.slams % 3 === 0) { B.state = 'dizzy'; B.t = 0; out.push({ type: 'bossdizzy' }); } else startHop();
    }
  } else if (B.state === 'dizzy') {
    if (B.t > 3.4) startHop();
  } else if (B.state === 'hurt') {
    B.pos[1] = B.home[1] + Math.abs(Math.sin(B.t * 14)) * 0.3 * Math.max(0, 1 - B.t);
    if (B.t > 0.9) { B.slams = 0; startHop(); }
  } else if (B.state === 'dead') {
    B.pos[1] -= dt * 0.5;
    if (Math.random() < dt * 30) fx.emit(fx.T.BURST, [B.pos[0] + (Math.random() - 0.5) * 2, B.pos[1] + 1 + Math.random() * 1.5, B.pos[2] + (Math.random() - 0.5) * 2], 6, [2.2, 0.8, 2.4], 5);
    if (B.t > 1.6) { B.state = 'gone'; fx.emit(fx.T.CONFETTI, [B.pos[0], B.home[1] + 2, B.pos[2]], 200, [1, 1, 1], 12); out.push({ type: 'bossdead' }); }
  }

  // shockwave rings
  for (const ring of B.rings) {
    const prev = ring.r;
    ring.r += 7 * dt;
    const d = Math.hypot(p[0] - ring.c[0], p[2] - ring.c[2]);
    const low = p[1] < ring.c[1] + 0.45;
    if (low && invuln <= 0 && d > prev - 0.35 && d < ring.r + 0.35) out.push({ type: 'hurt', from: ring.c, zap: true });
  }
  B.rings = B.rings.filter((ring) => ring.r < B.arena + 2);

  // contact
  if (B.state === 'dead' || B.state === 'gone' || B.state === 'sleep') return;
  const top = B.pos[1] + 1.7;
  if (hd < 1.9 && p[1] > B.pos[1] - 0.4 && p[1] < B.pos[1] + 2.8) {
    const onHead = p[1] > top - 0.6 && player.vel[1] < 0;
    if (B.state === 'dizzy' && onHead && player.pounding) {
      B.hp--; B.flash = 0.4; B.state = B.hp <= 0 ? 'dead' : 'hurt'; B.t = 0; B.rings = [];
      fx.emit(fx.T.BURST, [B.pos[0], top, B.pos[2]], 40, [2.6, 2.2, 0.8], 9);
      out.push({ type: 'bosshit', hp: B.hp });
    } else if (onHead) {
      out.push({ type: 'clank', pos: B.pos, boss: true });
    } else if (invuln <= 0 && B.state !== 'dizzy' && B.state !== 'hurt') {
      out.push({ type: 'hurt', from: B.pos, hard: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
export function drawFoe(world, r, e, t, cam) {
  const sh = world.g.shared;
  const flash = e.flash > 0 ? 0.6 : 0;
  if (e.type === 'rambot') {
    const shake = e.state === 'windup' ? Math.sin(t * 60) * 0.05 : 0;
    const pos = [e.pos[0] + shake, e.pos[1] + (e.state === 'charge' ? Math.abs(Math.sin(t * 24)) * 0.08 : 0), e.pos[2]];
    const model = m4.trs(pos, e.yaw, e.state === 'charge' ? 0.12 : 0, shake * 2);
    r.draw({ mesh: sh.rambot.body, model, rim: 0.5, outline: 1.0, flash });
    const glow = e.state === 'windup' || e.state === 'charge' ? [3, 0.6, 0.4] : [1.2, 0.3, 0.2];
    r.draw({ mesh: sh.rambot.eyes, model, emissive: glow, rim: 0, noShadow: true });
    if (e.state === 'dizzy') drawStars(r, sh, [e.pos[0], e.pos[1] + 1.35, e.pos[2]], t, 0.55);
  } else if (e.type === 'spitpod') {
    r.draw({ mesh: sh.spitpod.base, model: m4.trs(e.pos), rim: 0.4, outline: 0.9, flash });
    const hp = [e.pos[0] - Math.sin(e.headYaw) * e.recoil * 0.12, e.pos[1] + 0.95, e.pos[2] - Math.cos(e.headYaw) * e.recoil * 0.12];
    r.draw({ mesh: sh.spitpod.head, model: m4.trs(hp, e.headYaw, -0.15 - e.recoil * 0.2, 0, [1 + e.recoil * 0.15, 1 - e.recoil * 0.1, 1]), rim: 0.6, outline: 0.9, emissive: [0.12, 0.04, 0.15], flash });
  } else if (e.type === 'shellback') {
    const waddle = Math.sin(t * 9 + e.phase) * 0.06;
    r.draw({ mesh: sh.shellback.body, model: m4.trs(e.pos, e.yaw, 0, waddle), rim: 0.45, outline: 1.0, flash, spec: 0.3 });
  }
  void cam;
}

export function drawOrbs(world, r, cam) {
  const sh = world.g.shared;
  for (const o of world.orbs) {
    r.draw({ mesh: sh.spitpod.orb, model: m4.trs(o.p, 0, 0, 0, [1, 1, 1]), emissive: [2.6, 0.8, 2.4], rim: 0, noShadow: true });
    r.drawFx({ mesh: sh.halo, model: billboard(cam, o.p, 1.6), mode: 4, colA: [2.4, 0.7, 2.2], param: 0.6, additive: true, depth: v3.dist(cam.pos, o.p) });
  }
}

function drawStars(r, sh, c, t, rad) {
  for (let k = 0; k < 3; k++) {
    const a = t * 4 + k * 2.09;
    r.draw({ mesh: sh.spark, model: m4.trs([c[0] + Math.cos(a) * rad, c[1] + Math.sin(a * 2) * 0.08, c[2] + Math.sin(a) * rad], a, 0, 0, [0.35, 0.35, 0.35]), emissive: [1.6, 1.4, 0.4], noShadow: true, rim: 0 });
  }
}

export function drawBoss(world, r, t, cam) {
  const B = world.boss;
  if (!B || B.state === 'gone') return;
  const sh = world.g.shared;
  const s = 2.3;
  const squash = B.state === 'slam' ? 1 - Math.max(0, 0.35 - B.t) * 1.2 : B.state === 'dead' ? Math.max(0.1, 1 - B.t * 0.5) : 1;
  const wob = B.state === 'dizzy' ? Math.sin(t * 7) * 0.15 : 0;
  const model = m4.trs(B.pos, B.yaw, 0, wob, [s / Math.sqrt(squash), s * squash, s / Math.sqrt(squash)]);
  const angry = (B.maxHp - B.hp) / B.maxHp;
  const flash = B.flash > 0 ? 0.7 : 0;
  r.draw({ mesh: sh.glitch.body, model, rim: 0.6, emissive: [0.15 + angry * 0.5, 0.03, 0.18], outline: 1.4, flash });
  r.draw({ mesh: sh.glitch.eyes, model, rim: 0, flash });
  r.draw({ mesh: sh.crown, model: m4.mul(model, m4.trs([0, 1.0, 0], t * 0.5)), rim: 0.8, spec: 0.9, emissive: [0.3, 0.22, 0.05], outline: 0.6 });
  if (B.state === 'dizzy') drawStars(r, sh, [B.pos[0], B.pos[1] + 2.6, B.pos[2]], t, 1.0);
  for (const ring of B.rings) {
    r.draw({ mesh: sh.ring, model: m4.trs([ring.c[0], ring.c[1] + 0.08, ring.c[2]], 0, 0, 0, [ring.r, 1, ring.r]), emissive: [2.6, 0.5, 2.2], rim: 0, noShadow: true });
  }
  void cam;
}
