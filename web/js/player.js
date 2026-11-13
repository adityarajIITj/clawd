// Clawd: animation & presentation layer over the Rust character controller.
import { m4, damp, dampAngle, clamp } from './math.js';

const CENTER = 0.62;

export class Clawd {
  constructor(parts) {
    this.parts = parts;
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.grounded = true;
    this.sq = 1; this.sqV = 0;        // squash spring (y scale)
    this.walk = 0;
    this.flip = 0; this.flipT = 0;    // double-jump flip
    this.spin = 0;                    // ground-pound spin
    this.pounding = false;
    this.blinkT = 2; this.blink = 1;
    this.lean = 0;
    this.armLift = 0;
    this.time = 0;
    this.flash = 0;
    this.visible = true;
    this.dance = false;
    this.lookYaw = 0;
  }

  snapTo(st) {
    this.pos = [st[0], st[1], st[2]];
    this.yaw = st[7];
  }

  onEvents(ev, EV, landSpeed) {
    if (ev & EV.JUMP) { this.sqV += 7; }
    if (ev & EV.DASH) { this.dashT = 0.24; this.sqV -= 4; }
    if (ev & EV.DJUMP) { this.flipT = 0.42; this.sqV += 5; }
    if (ev & EV.BOUNCE) { this.sq = 0.6; this.sqV = 14; this.flipT = 0.5; }
    if (ev & EV.LAND) {
      const k = clamp(landSpeed / 30, 0.15, 0.6);
      this.sqV -= 10 * k + 2;
    }
    if (ev & EV.POUND) { this.spin = 0; }
    if (ev & EV.POUND_LAND) { this.sq = 0.55; this.sqV = 0; }
  }

  update(dt, st) {
    this.time += dt;
    const t = this.time;
    this.pos[0] = st[0]; this.pos[1] = st[1]; this.pos[2] = st[2];
    this.vel = [st[3], st[4], st[5]];
    this.grounded = st[6] > 0.5;
    this.pounding = st[9] > 0.5;
    const hs = Math.hypot(st[3], st[5]);
    if (!this.dance) this.yaw = dampAngle(this.yaw, st[7], 14, dt);

    // squash spring
    const k = 180, c = 14;
    const target = this.grounded ? 1 : clamp(1 + st[4] * 0.012, 0.85, 1.15);
    this.sqV += (-(this.sq - target) * k - this.sqV * c) * dt;
    this.sq += this.sqV * dt;
    this.sq = clamp(this.sq, 0.5, 1.5);

    // walk cycle
    if (this.grounded && hs > 0.5) this.walk += dt * (6 + hs * 1.25);
    else this.walk = damp(this.walk, Math.round(this.walk / Math.PI) * Math.PI, 8, dt);
    this.lean = damp(this.lean, this.grounded ? clamp(hs / 9, 0, 1) * 0.16 : clamp(-st[4] / 30, -0.2, 0.25), 8, dt);
    this.armLift = damp(this.armLift, this.grounded ? 0 : 1, 10, dt);

    // flips
    if (this.flipT > 0) {
      this.flipT -= dt;
      this.flip = (1 - Math.max(0, this.flipT) / 0.42) * Math.PI * 2;
      if (this.flipT <= 0) this.flip = 0;
    }
    if (this.pounding) this.spin += dt * 30; else this.spin = damp(this.spin, Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2, 12, dt);

    // blink
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blinkT = 2 + Math.random() * 3.5; }
    this.blink = this.blinkT < 0.12 ? 0.12 : 1;

    if (this.flash > 0) this.flash -= dt;
    this.dashT = Math.max(0, (this.dashT || 0) - dt);
    if (this.dance) {
      this.yaw += dt * 3.0;
      const hop = Math.abs(Math.sin(t * 6));
      this.danceHop = hop * 0.5;
    } else this.danceHop = 0;
  }

  draw(r, invuln) {
    if (invuln > 0 && Math.floor(invuln * 14) % 2 === 0) return;
    const P = this.parts;
    const t = this.time;
    const hs = Math.hypot(this.vel[0], this.vel[2]);
    const breathe = this.grounded && hs < 0.5 ? Math.sin(t * 2.4) * 0.025 : 0;
    const sy = this.sq + breathe;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    const bob = this.grounded ? Math.abs(Math.sin(this.walk)) * 0.07 * clamp(hs / 6, 0, 1) : 0;
    const base = [this.pos[0], this.pos[1] + CENTER * sy + bob + (this.danceHop || 0), this.pos[2]];
    const dashLean = (this.dashT || 0) > 0 ? 0.5 : 0;
    const root = m4.trs(base, this.yaw + this.spin, this.lean + this.flip + dashLean, 0, [sxz, sy, sxz * (1 + dashLean * 0.3)]);
    const flash = Math.max(0, this.flash) * 3;
    const put = (mesh, local, opts = {}) => {
      r.draw({ mesh, model: m4.mul(root, local), outline: opts.outline || 0, emissive: opts.emissive, rim: opts.rim ?? 0.45, flash, spec: opts.spec ?? 0.22 });
    };
    put(P.body, m4.ident(), { outline: 1.2 });
    for (const s of [-1, 1]) {
      put(P.eye, m4.trs([s * 0.2, 0.07, 0.4], 0, 0, 0, [1, this.blink, 1]), { spec: 0.6 });
      put(P.cheek, m4.trs([s * 0.34, -0.06, 0.395], 0, 0, 0, [1, 1, 1]), { rim: 0 });
      const swing = this.grounded ? Math.sin(this.walk + (s > 0 ? Math.PI : 0)) * 0.5 * clamp(hs / 6, 0, 1) : 0;
      const lift = this.armLift * 0.9 + (this.dance ? Math.sin(t * 12 + s) * 0.6 + 0.8 : 0);
      put(P.arm, m4.trs([s * 0.57, -0.06 + this.armLift * 0.08, 0.02], 0, swing, -s * lift), { outline: 1.0 });
    }
    // legs (diagonal gait)
    const legs = [[-0.27, 0.2, 0], [0.27, 0.2, Math.PI], [-0.27, -0.2, Math.PI], [0.27, -0.2, 0]];
    for (const [x, z, ph] of legs) {
      let sw = this.grounded ? Math.sin(this.walk + ph) * 0.75 * clamp(hs / 5, 0, 1) : -0.5;
      if (this.pounding) sw = 0.9;
      put(P.leg, m4.trs([x, -0.34, z], 0, sw, 0), { outline: 1.0 });
    }
    put(P.stem, m4.trs([0, 0.34, 0], 0, Math.sin(t * 3) * 0.08, Math.cos(t * 2.3) * 0.08), {});
    put(P.spark, m4.trs([0, 0.56 + Math.sin(t * 3) * 0.02, 0], t * 2.0, 0, 0, [1, 1, 1]), { emissive: [1.6, 0.9, 0.5], rim: 0 });
  }
}

// ---------------------------------------------------------------------------
// Human heroes (Marathi Manus, Mahak, Lingraj): shared chibi rig on the same
// controller. Body centre sits 0.65 above the feet. Each hero supplies its own
// idle routine through pose(); extras (braid, skirt, phone) via drawExtras().
// ---------------------------------------------------------------------------
class Human extends Clawd {
  constructor(parts) {
    super(parts);
    this.idleT = 0;
  }

  update(dt, st) {
    super.update(dt, st);
    const hs = Math.hypot(st[3], st[5]);
    this.idleT = this.grounded && hs < 0.3 && !this.dance ? this.idleT + dt : 0;
  }

  // Override: { headTilt, headYaw, headRoll, armL, armR, tongue, mouthOpen } where arm = { pitch, roll, yaw }
  pose() { return {}; }
  drawExtras() {}

  draw(r, invuln) {
    if (invuln > 0 && Math.floor(invuln * 14) % 2 === 0) return;
    const P = this.parts;
    const t = this.time;
    const hs = Math.hypot(this.vel[0], this.vel[2]);
    const run = clamp(hs / 7, 0, 1);
    const sy = this.sq;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    const bob = this.grounded ? Math.abs(Math.sin(this.walk)) * 0.06 * run : 0;
    const base = [this.pos[0], this.pos[1] + 0.65 * sy + bob + (this.danceHop || 0), this.pos[2]];
    const dashing = (this.dashT || 0) > 0;
    const root = m4.trs(base, this.yaw + this.spin, this.lean * 0.6 + this.flip + (dashing ? 0.55 : 0), 0, [sxz * 0.95, sy * 0.95, sxz * 0.95]);
    const flash = Math.max(0, this.flash) * 3;
    const put = (mesh, local, opts = {}) => r.draw({ mesh, model: m4.mul(root, local), outline: opts.outline || 0, rim: opts.rim ?? 0.4, flash, spec: opts.spec ?? 0.15 });
    const ctx = { t, hs, run, dashing, idle: this.idleT, root, flash, r };
    const pose = (this.grounded && hs < 0.3 && !this.dance) ? this.pose(ctx) : (this.dance ? this.dancePose(ctx) : {});
    ctx.pose = pose;
    const breathe = this.grounded && hs < 0.3 ? Math.sin(t * 2.2) * 0.012 : 0;

    put(P.torso, m4.trs([0, 0.02 + breathe, 0]), { outline: 1.0 });
    const head = m4.trs([0, 0.55 + breathe, 0.01], pose.headYaw || 0, pose.headTilt || 0, pose.headRoll || 0);
    ctx.head = head;
    put(P.head, head, { outline: 1.1 });
    if (this.faces) {
      // photo face (Marathi Manus): tongue-out photo while dancing or posing
      r.drawFx({ mesh: P.facePlate, model: m4.mul(root, head), mode: 5, tex: pose.tongue ? this.faces.tongue : this.faces.neutral,
        param: this.faceLight ?? 1.2, colA: this.faceTint || [1, 1, 1], alpha: 1, depth: -1, flash });
    } else {
      for (const s of [-1, 1]) put(P.eye, m4.mul(head, m4.trs([s * 0.095, 0.03, 0.247], 0, 0, 0, [1, this.blink, 1])), { spec: 0.6, rim: 0 });
      if (pose.mouthOpen) put(P.mouthOpen, m4.mul(head, m4.trs([0, -0.15, 0.24])), { rim: 0 });
      else put(P.mouth, m4.mul(head, m4.trs([0, -0.15, 0.248])), { rim: 0 });
    }

    // arms (pivot at the shoulder)
    for (const s of [-1, 1]) {
      let pitch = this.grounded ? -Math.sin(this.walk + (s > 0 ? 0 : Math.PI)) * 0.8 * run : -0.4;
      let roll = s * 0.1 - s * this.armLift * 0.9;
      let yaw = 0;
      if (this.pounding) { pitch = -2.6; roll = -s * 0.3; }
      if (dashing) { pitch = 1.25; roll = s * 0.25; }
      const o = s < 0 ? pose.armL : pose.armR;
      if (o) { pitch = o.pitch; roll = o.roll; yaw = o.yaw || 0; }
      const sh = m4.trs([s * 0.355, 0.19 + breathe, 0], yaw, pitch, roll);
      put(P.arm, sh, { outline: 0.9 });
      if (s > 0) ctx.rightShoulder = sh;
    }
    // legs (pivot at the hip)
    for (const s of [-1, 1]) {
      let sw = this.grounded ? Math.sin(this.walk + (s > 0 ? Math.PI : 0)) * 0.85 * run : (s > 0 ? -0.5 : 0.25);
      if (this.pounding) sw = -1.2;
      if (this.dance) sw = Math.sin(t * 12 + (s > 0 ? Math.PI : 0)) * 0.35;
      put(P.leg, m4.trs([s * 0.12, -0.22, 0], 0, sw, 0), { outline: 0.9 });
    }
    this.drawExtras(put, ctx);
  }

  dancePose({ t }) {
    const w = (s) => ({ pitch: -2.4 + Math.sin(t * 9 + s) * 0.5, roll: -s * (0.5 + Math.sin(t * 7 + s) * 0.3) });
    return { armL: w(-1), armR: w(1), mouthOpen: true, tongue: true };
  }
}

// Marathi Manus: fixes his bun, then takes a selfie with his tongue out.
export class Manus extends Human {
  pose({ t, idle }) {
    if (idle > 2.5 && idle < 5.2) return { headTilt: -0.12, armL: { pitch: -2.7, roll: 0.5 + Math.sin(t * 10) * 0.12 } };
    if (idle >= 5.2) return { headTilt: 0.18, headYaw: -0.12, headRoll: -0.12, armR: { pitch: -1.7, roll: 0.35, yaw: -0.4 }, tongue: true, selfie: true };
    return {};
  }
  drawExtras(put, { pose, rightShoulder, hs }) {
    if (this.dance || !rightShoulder) return;
    if (pose.selfie) put(this.parts.phone, m4.mul(rightShoulder, m4.trs([0, -0.44, 0.05], 0, -0.2, 0)), { spec: 0.9, rim: 0.2 });
    else if (this.grounded && hs < 0.3) put(this.parts.phone, m4.mul(rightShoulder, m4.trs([0, -0.44, 0.05], 0, 1.3, 0)), { spec: 0.9, rim: 0.2 });
  }
}

// Mahak: brings her braid over her shoulder, then shades her eyes to look across the valley.
export class Mahak extends Human {
  pose({ t, idle }) {
    if (idle > 2.5 && idle < 5.5) return { headTilt: 0.1, headRoll: 0.12, armL: { pitch: -1.1, roll: 0.95, yaw: 0.4 }, braidFront: true };
    if (idle >= 5.5) return { headTilt: -0.14, headYaw: Math.sin(t * 0.6) * 0.35, armR: { pitch: -2.35, roll: -0.75, yaw: 0.25 } };
    return {};
  }
  dancePose(ctx) {
    const p = super.dancePose(ctx);
    p.tongue = false;
    return p;
  }
  drawExtras(put, { pose, head, run, t, hs }) {
    const P = this.parts;
    // skirt flares when she dances or runs
    const flare = this.dance ? 0.18 + Math.sin(t * 6) * 0.05 : run * 0.06;
    put(P.skirt, m4.trs([0, -0.2, 0], 0, 0, 0, [1 + flare, 1, 1 + flare]), { outline: 0.9 });
    // braid: trails behind while moving, swings when she jumps
    const vy = this.vel[1];
    let braid;
    if (pose.braidFront) braid = m4.mul(head, m4.trs([-0.17, -0.12, 0.12], 0.2, -0.35, 0.15));
    else {
      const swing = clamp(0.15 + run * 0.7 + (this.grounded ? 0 : clamp(-vy * 0.03, -0.3, 0.6)) + Math.sin(t * 2 + hs) * 0.05, -0.2, 1.2);
      braid = m4.mul(head, m4.trs([0, -0.05, -0.22], 0, swing, Math.sin(this.walk) * 0.08 * run));
    }
    put(P.braid, braid, { outline: 0.7 });
  }
}

// Lingraj: wipes his forehead with his gamucha, then greets you with a namaskar.
export class Lingraj extends Human {
  pose({ t, idle }) {
    if (idle > 2.5 && idle < 5.0) return { headTilt: -0.1, armL: { pitch: -2.55, roll: 0.62 + Math.sin(t * 7) * 0.1 } };
    if (idle >= 5.0) return { headTilt: 0.16, armL: { pitch: -1.05, roll: 0.98, yaw: -0.25 }, armR: { pitch: -1.05, roll: -0.98, yaw: 0.25 } };
    return {};
  }
  dancePose({ t }) {
    // arms out and up, rolling at the wrists — a cheerful festival dance
    const a = (s) => ({ pitch: -1.6 + Math.sin(t * 8 + s * 1.5) * 0.6, roll: -s * (1.0 + Math.sin(t * 8 + s) * 0.25) });
    return { armL: a(-1), armR: a(1), mouthOpen: true, headRoll: Math.sin(t * 8) * 0.12 };
  }
}
