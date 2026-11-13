// Third-person platformer camera with orbit, auto-follow and cinematic modes.
import { m4, v3, damp, clamp, smooth } from './math.js';

export class Camera {
  constructor() {
    this.yaw = 0;
    this.pitch = 0.32;
    this.dist = 8.5;
    this.distTarget = 8.5;
    this.target = [0, 0, 0];
    this.pos = [0, 5, -10];
    this.look = [0, 0, 0];
    this.fov = 55 * Math.PI / 180;
    this.idle = 0;
    this.mode = 'follow';
    this.cine = null;
    this.shake = 0;
    this.invertY = false;
    this.sens = 1;
    this.update(0, null);
  }

  forward() { return [Math.sin(this.yaw), 0, Math.cos(this.yaw)]; }
  rightDir() { return [-Math.cos(this.yaw), 0, Math.sin(this.yaw)]; }

  snap(p, yaw = 0) {
    this.yaw = yaw;
    this.target = [p[0], p[1] + 1.0, p[2]];
    this.pos = this.desired();
    this.look = [...this.target];
  }

  desired() {
    const f = this.forward();
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [this.target[0] - f[0] * this.dist * cp, this.target[1] + this.dist * sp + 0.6, this.target[2] - f[2] * this.dist * cp];
  }

  // cinematic path: list of {pos, look} keys over duration
  startCine(from, to, duration, onDone) {
    this.mode = 'cine';
    this.cine = { from, to, t: 0, duration, onDone };
  }

  update(dt, ctx) {
    if (this.mode === 'cine' && this.cine) {
      const c = this.cine;
      c.t += dt;
      const u = smooth(clamp(c.t / c.duration, 0, 1));
      const to = typeof c.to === 'function' ? c.to() : c.to;
      // arc the camera up through the middle of the move
      const mid = v3.lerp(c.from.pos, to.pos, u);
      mid[1] += Math.sin(u * Math.PI) * 6;
      this.pos = mid;
      this.look = v3.lerp(c.from.look, to.look, u);
      if (c.t >= c.duration) { this.mode = 'follow'; const done = c.onDone; this.cine = null; done && done(); }
    } else if (this.mode === 'orbit' && ctx) {
      this.yaw += dt * 0.12;
      const f = this.forward();
      const tgt = ctx.target;
      this.pos = [tgt[0] - f[0] * ctx.dist, tgt[1] + ctx.height, tgt[2] - f[2] * ctx.dist];
      this.look = [tgt[0], tgt[1] + 1, tgt[2]];
    } else if (ctx && ctx.player) {
      const inp = ctx.input;
      const p = ctx.player.pos;
      let manual = false;
      if (inp) {
        const ys = this.invertY ? -1 : 1;
        if (inp.mouseDX || inp.mouseDY) {
          this.yaw -= inp.mouseDX * 0.0032 * this.sens;
          this.pitch = clamp(this.pitch + inp.mouseDY * 0.0026 * this.sens * ys, -0.25, 1.25);
          manual = true;
        }
        if (inp.camX || inp.camY) {
          this.yaw -= inp.camX * dt * 2.4 * this.sens;
          this.pitch = clamp(this.pitch + inp.camY * dt * 1.6 * this.sens * ys, -0.25, 1.25);
          manual = true;
        }
        if (inp.wheel) this.distTarget = clamp(this.distTarget + inp.wheel * 1.0, 5, 16);
      }
      this.idle = manual ? 0 : this.idle + dt;
      // gentle auto-follow behind the direction of travel
      const v = ctx.player.vel;
      const hs = Math.hypot(v[0], v[2]);
      if (this.idle > 1.2 && hs > 3) {
        const want = Math.atan2(v[0], v[2]);
        let d = want - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 2.3) this.yaw += d * (1 - Math.exp(-0.9 * dt)) * clamp(hs / 9, 0, 1);
      }
      this.dist = damp(this.dist, this.distTarget, 4, dt);
      this.target[0] = damp(this.target[0], p[0], 9, dt);
      this.target[2] = damp(this.target[2], p[2], 9, dt);
      const ty = p[1] + 1.0;
      this.target[1] = damp(this.target[1], ty, ctx.player.grounded ? 5 : (ty < this.target[1] - 1.5 ? 6 : 2.2), dt);
      const want = this.desired();
      // keep walls and islands from getting between the camera and the player
      if (ctx.raycast) {
        const from = [this.target[0], this.target[1] + 0.2, this.target[2]];
        const d = [want[0] - from[0], want[1] - from[1], want[2] - from[2]];
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        const hit = ctx.raycast(from, [d[0] / len, d[1] / len, d[2] / len], len);
        const allowed = hit < len ? Math.max(1.2, hit - 0.45) : len;
        this.clip = allowed < (this.clip ?? len) ? allowed : damp(this.clip ?? len, allowed, 2.5, dt);
        if (this.clip < len - 0.01) {
          const k = this.clip / len;
          want[0] = from[0] + d[0] * k; want[1] = from[1] + d[1] * k; want[2] = from[2] + d[2] * k;
          this.pos = [damp(this.pos[0], want[0], 30, dt), damp(this.pos[1], want[1], 30, dt), damp(this.pos[2], want[2], 30, dt)];
        }
      }
      this.pos = [damp(this.pos[0], want[0], 14, dt), damp(this.pos[1], want[1], 10, dt), damp(this.pos[2], want[2], 14, dt)];
      this.look = [...this.target];
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.35;
      this.pos = [this.pos[0] + (Math.random() - 0.5) * s, this.pos[1] + (Math.random() - 0.5) * s, this.pos[2] + (Math.random() - 0.5) * s];
    }
    this.view = m4.lookAt(this.pos, this.look, [0, 1, 0]);
    const aspect = (ctx && ctx.aspect) || 16 / 9;
    this.proj = m4.perspective(this.fov, aspect, 0.15, 1800);
    this.right = [this.view[0], this.view[4], this.view[8]];
    this.up = [this.view[1], this.view[5], this.view[9]];
    this.shadowFocus = ctx && ctx.player ? [ctx.player.pos[0], ctx.player.pos[1], ctx.player.pos[2]] : this.look;
  }

  // world-space move vector from stick/keys relative to the camera
  moveDir(mx, mz) {
    const f = this.forward(), r = this.rightDir();
    return [f[0] * mz + r[0] * mx, f[2] * mz + r[2] * mx];
  }
}
