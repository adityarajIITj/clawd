// Procedural mesh library. Every model in the game is generated here in code.
import { m4, mulberry } from './math.js';

const L = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
export const hex = (h) => {
  if (Array.isArray(h)) return h;
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

export const PALETTE = {
  clawd: hex('#d97757'),
  clawdDark: hex('#b85c3f'),
  clawdLight: hex('#e8936f'),
  ink: hex('#1f1a17'),
  cream: hex('#f4efe4'),
  blush: hex('#f2a08a'),
  spark: hex('#ffb37a'),
  gold: hex('#f2c14e'),
  goldDark: hex('#c98f2e'),
};

export class MB {
  constructor() { this.p = []; this.n = []; this.c = []; }

  static xf(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  }
  static xn(m, n) {
    const r = [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]];
    const l = Math.hypot(r[0], r[1], r[2]) || 1;
    return [r[0] / l, r[1] / l, r[2] / l];
  }

  vert(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); }

  // flat triangle (srgb colour)
  tri(a, b, c, col, na, nb, nc) {
    const lc = L(col);
    if (!na) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      na = nb = nc = n;
    }
    this.vert(a, na, lc); this.vert(b, nb, lc); this.vert(c, nc, lc);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }

  // generic parametric surface; f(u,v) -> {p, n}; colour fn(u,v,p) -> srgb
  grid(m, nu, nv, f, colFn, smooth = true, wrapU = false) {
    const P = [], N = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const r = f(i / nu, j / nv);
        P.push(MB.xf(m, r.p)); N.push(MB.xn(m, r.n || [0, 1, 0]));
      }
    }
    const idx = (i, j) => j * (nu + 1) + i;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
        const col = colFn((i + 0.5) / nu, (j + 0.5) / nv, P[a]);
        if (smooth) {
          const lc = L(col);
          this.vert(P[a], N[a], lc); this.vert(P[c], N[c], lc); this.vert(P[b], N[b], lc);
          this.vert(P[a], N[a], lc); this.vert(P[d], N[d], lc); this.vert(P[c], N[c], lc);
        } else {
          this.tri(P[a], P[c], P[b], col);
          this.tri(P[a], P[d], P[c], col);
        }
      }
    }
    return this;
  }

  roundedBox(m, size, r, col, seg = 5, colFn = null) {
    const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    const ix = Math.max(0, hx - r), iy = Math.max(0, hy - r), iz = Math.max(0, hz - r);
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [nrm, V, U] of faces) { // swapped so U x V = -n matches grid winding
      this.grid(m, seg, seg, (u, v) => {
        const a = u * 2 - 1, b = v * 2 - 1;
        const q = [nrm[0] * hx + U[0] * a * hx + V[0] * b * hx, 0, 0];
        // point on box surface
        const s = [nrm[0] + U[0] * a + V[0] * b, nrm[1] + U[1] * a + V[1] * b, nrm[2] + U[2] * a + V[2] * b];
        const pb = [s[0] * hx, s[1] * hy, s[2] * hz];
        const inner = [Math.max(-ix, Math.min(ix, pb[0])), Math.max(-iy, Math.min(iy, pb[1])), Math.max(-iz, Math.min(iz, pb[2]))];
        let d = [pb[0] - inner[0], pb[1] - inner[1], pb[2] - inner[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        d = [d[0] / l, d[1] / l, d[2] / l];
        void q;
        return { p: [inner[0] + d[0] * r, inner[1] + d[1] * r, inner[2] + d[2] * r], n: d };
      }, colFn ? (u, v, p) => colFn(p) : () => col, true);
    }
    return this;
  }

  // lathe around Y: profile = [[radius, y], ...]
  lathe(m, profile, seg, colFn, smooth = true) {
    // compute profile normals
    const pn = profile.map((p, i) => {
      const a = profile[Math.max(0, i - 1)], b = profile[Math.min(profile.length - 1, i + 1)];
      const dy = b[1] - a[1], dr = b[0] - a[0];
      const l = Math.hypot(dy, dr) || 1;
      return [dy / l, -dr / l];
    });
    return this.grid(m, seg, profile.length - 1, (u, v) => {
      const k = Math.round(v * (profile.length - 1));
      const th = u * Math.PI * 2;
      const [r, y] = profile[k];
      const [nr, ny] = pn[k];
      return { p: [Math.cos(th) * r, y, Math.sin(th) * r], n: [Math.cos(th) * nr, ny, Math.sin(th) * nr] };
    }, (u, v, p) => (typeof colFn === 'function' ? colFn(v, u, p) : colFn), smooth);
  }

  cylinder(m, r0, r1, h, seg, col, flat = false, caps = true) {
    this.lathe(m, [[0.0001, 0], [r0, 0], [r0, 0], [r1, h], [r1, h], [0.0001, h]].filter((_, i) => caps || (i > 1 && i < 4)), seg, col, !flat);
    return this;
  }

  sphere(m, r, seg, col, flat = false, deform = null) {
    return this.grid(m, seg, Math.ceil(seg / 2), (u, v) => {
      const th = u * Math.PI * 2, ph = v * Math.PI;
      const n = [Math.cos(th) * Math.sin(ph), -Math.cos(ph), Math.sin(th) * Math.sin(ph)];
      let rr = r;
      if (deform) rr *= deform(n);
      return { p: [n[0] * rr, n[1] * rr, n[2] * rr], n };
    }, typeof col === 'function' ? col : () => col, !flat);
  }

  // faceted jittered blob (rocks, foliage)
  blob(m, r, col, seed, rough = 0.25, seg = 8, squash = 1) {
    const rnd = mulberry(seed);
    const offs = Array.from({ length: 6 }, () => [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]);
    const tint = (p) => {
      const k = 0.9 + rnd() * 0.2;
      return typeof col === 'function' ? col(p) : mulc(col, k);
    };
    return this.grid(m, seg, Math.ceil(seg * 0.6), (u, v) => {
      const th = u * Math.PI * 2, ph = v * Math.PI;
      const n = [Math.cos(th) * Math.sin(ph), -Math.cos(ph), Math.sin(th) * Math.sin(ph)];
      let d = 1;
      for (let i = 0; i < 3; i++) d += Math.sin(n[0] * (2 + i) + offs[i][0]) * Math.sin(n[1] * (2 + i) + offs[i][1]) * Math.sin(n[2] * (2 + i) + offs[i][2]) * rough / (i + 1);
      if (u === 0 || u === 1) d = d; // seam stays consistent via sin periodicity
      return { p: [n[0] * r * d, n[1] * r * d * squash, n[2] * r * d], n };
    }, (u, v, p) => tint(p), false);
  }

  // Claude-style radial starburst, extruded
  starburst(m, rays, rIn, rOut, thick, col, colTip = null, alt = 0.72) {
    const steps = rays * 2;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const isRay = i % 2 === 0;
      const len = isRay ? rOut * ((i / 2) % 2 === 0 ? 1 : alt) : rIn;
      pts.push([Math.cos(a) * len, Math.sin(a) * len]);
    }
    const ct = colTip || col;
    for (let i = 0; i < steps; i++) {
      const a = pts[i], b = pts[(i + 1) % steps];
      const ca = i % 2 === 0 ? ct : col, cb = (i + 1) % 2 === 0 ? ct : col;
      const f0 = MB.xf(m, [0, 0, thick]), b0 = MB.xf(m, [0, 0, -thick]);
      const fa = MB.xf(m, [a[0], a[1], thick * 0.3]), fb = MB.xf(m, [b[0], b[1], thick * 0.3]);
      const ba = MB.xf(m, [a[0], a[1], -thick * 0.3]), bb = MB.xf(m, [b[0], b[1], -thick * 0.3]);
      this.tri(f0, fa, fb, mix3(ca, cb, 0.5));
      this.tri(b0, bb, ba, mix3(ca, cb, 0.5));
      this.quad(fa, ba, bb, fb, mulc(mix3(ca, cb, 0.5), 0.85));
    }
    return this;
  }

  torus(m, R, r, segU, segV, col) {
    return this.grid(m, segU, segV, (u, v) => {
      const a = u * Math.PI * 2, b = v * Math.PI * 2;
      const n = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)];
      return { p: [Math.cos(a) * (R + r * Math.cos(b)), r * Math.sin(b), Math.sin(a) * (R + r * Math.cos(b))], n };
    }, typeof col === 'function' ? col : () => col, true);
  }

  // UV quad for fx shaders (uv packed into colour)
  fxQuad(m, w, h, alignBottom = true) {
    const y0 = alignBottom ? 0 : -h / 2, y1 = alignBottom ? h : h / 2;
    const a = MB.xf(m, [-w / 2, y0, 0]), b = MB.xf(m, [w / 2, y0, 0]), c = MB.xf(m, [w / 2, y1, 0]), d = MB.xf(m, [-w / 2, y1, 0]);
    const n = [0, 0, 1];
    this.vert(a, n, [0, 0, 0]); this.vert(b, n, [1, 0, 0]); this.vert(c, n, [1, 1, 0]);
    this.vert(a, n, [0, 0, 0]); this.vert(c, n, [1, 1, 0]); this.vert(d, n, [0, 1, 0]);
    return this;
  }

  build(r) {
    return r.createMesh({ pos: new Float32Array(this.p), nrm: new Float32Array(this.n), col: new Float32Array(this.c) });
  }
}

const T = (x, y, z, yaw = 0, pitch = 0, roll = 0, s = [1, 1, 1]) => m4.trs([x, y, z], yaw, pitch, roll, s);

// ===========================================================================
//  CLAWD — the hero
// ===========================================================================
export function buildClawd(r, body = PALETTE.clawd) {
  const P = PALETTE;
  const parts = {};
  const shade = (p) => mix3(mulc(body, 0.86), mix3(body, P.clawdLight, 0.4), Math.max(0, Math.min(1, (p[1] - 0.2) / 0.6)));
  parts.body = new MB().roundedBox(T(0, 0, 0), [1.0, 0.72, 0.8], 0.2, body, 7, shade).build(r);
  const eye = new MB();
  eye.roundedBox(T(0, 0, 0), [0.12, 0.24, 0.06], 0.05, P.ink, 3);
  eye.roundedBox(T(0.015, 0.06, 0.035), [0.04, 0.06, 0.02], 0.01, [1, 1, 1], 2);
  parts.eye = eye.build(r);
  const cheek = new MB();
  cheek.sphere(T(0, 0, 0, 0, 0, 0, [1, 0.6, 0.25]), 0.06, 10, P.blush);
  parts.cheek = cheek.build(r);
  parts.arm = new MB().roundedBox(T(0, 0, 0), [0.2, 0.24, 0.26], 0.08, body, 4, (p) => mix3(body, P.clawdDark, 0.15 - p[1] * 0.3)).build(r);
  parts.leg = new MB().roundedBox(T(0, -0.12, 0), [0.17, 0.26, 0.18], 0.07, mulc(body, 0.85), 3).build(r);
  const ant = new MB();
  ant.cylinder(T(0, 0, 0), 0.025, 0.02, 0.18, 8, mulc(body, 0.8));
  parts.stem = ant.build(r);
  parts.spark = new MB().starburst(T(0, 0, 0), 6, 0.05, 0.16, 0.035, P.spark, [1, 0.93, 0.8]).build(r);
  return parts;
}

// ===========================================================================
//  Collectibles & gameplay props
// ===========================================================================
export function buildSpark(r) {
  const mb = new MB();
  mb.starburst(T(0, 0, 0), 6, 0.12, 0.5, 0.09, hex('#ff7438'), hex('#ffc890'));
  mb.sphere(T(0, 0, 0), 0.13, 10, hex('#ffe2b8'));
  return mb.build(r);
}

export function buildToken(r) {
  const mb = new MB();
  const g = PALETTE.gold, gd = PALETTE.goldDark;
  mb.lathe(T(0, 0, 0, 0, Math.PI / 2, 0), [[0.0001, -0.09], [0.5, -0.09], [0.58, -0.05], [0.58, 0.05], [0.5, 0.09], [0.0001, 0.09]], 28,
    (v) => (v > 0.2 && v < 0.8 ? gd : g), true);
  mb.starburst(T(0, 0, 0.1), 6, 0.08, 0.34, 0.03, hex('#fff0b0'), hex('#fff7dc'));
  mb.starburst(T(0, 0, -0.1, Math.PI), 6, 0.08, 0.34, 0.03, hex('#fff0b0'), hex('#fff7dc'));
  return mb.build(r);
}

export function buildCheckpoint(r, accent) {
  const mb = new MB();
  const cream = hex('#f6efe2'), terra = hex('#d97757'), stone = hex('#a89f92');
  mb.cylinder(T(0, 0, 0), 0.7, 0.6, 0.3, 12, stone, true);
  // striped tower
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const y0 = 0.3 + i * 0.36, r0 = 0.45 - i * 0.04, r1 = 0.45 - (i + 1) * 0.04;
    mb.cylinder(T(0, y0, 0), r0, r1, 0.36, 14, i % 2 ? terra : cream, false, false);
  }
  mb.cylinder(T(0, 2.1, 0), 0.38, 0.38, 0.06, 14, stone, true);
  mb.cylinder(T(0, 2.66, 0), 0.4, 0.0, 0.45, 14, terra, true);
  const tower = mb.build(r);
  const lamp = new MB().cylinder(T(0, 2.16, 0), 0.26, 0.26, 0.5, 12, [1, 0.95, 0.85]).build(r);
  return { tower, lamp };
}

export function buildPortal(r) {
  const ring = new MB();
  ring.torus(T(0, 2.2, 0, 0, Math.PI / 2, 0), 1.9, 0.2, 40, 10, PALETTE.gold);
  // orbiting starburst crown
  ring.starburst(T(0, 4.35, 0), 6, 0.1, 0.42, 0.08, hex('#ffcf86'), hex('#fff3d8'));
  const base = new MB();
  base.lathe(T(0, 0, 0), [[0.0001, 0], [2.6, 0], [2.6, 0.25], [2.3, 0.4], [0.0001, 0.4]], 32, (v) => (v > 0.5 ? hex('#ece2cf') : hex('#b8ab96')), false);
  base.cylinder(T(-2.0, 0.4, 0), 0.25, 0.22, 1.2, 10, hex('#ece2cf'));
  base.cylinder(T(2.0, 0.4, 0), 0.25, 0.22, 1.2, 10, hex('#ece2cf'));
  const disc = new MB().fxQuad(T(0, 2.2, 0), 3.7, 3.7, false).build(r);
  return { ring: ring.build(r), base: base.build(r), disc };
}

export function buildBouncer(r, col) {
  const stem = new MB();
  stem.cylinder(T(0, 0, 0), 0.5, 0.35, 0.25, 12, hex('#7a9a5a'));
  const cap = new MB();
  const petals = 7;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    cap.sphere(T(Math.cos(a) * 0.72, 0.18, Math.sin(a) * 0.72, -a, 0, 0, [1.0, 0.32, 0.65]), 0.5, 10, mix3(col, [1, 1, 1], 0.15));
  }
  cap.sphere(T(0, 0.3, 0, 0, 0, 0, [1, 0.45, 1]), 0.62, 14, mix3(col, [1, 0.95, 0.7], 0.55));
  return { stem: stem.build(r), cap: cap.build(r) };
}

export function buildGlitchling(r) {
  const body = new MB();
  const c1 = hex('#7b4bd6'), c2 = hex('#c04bd6');
  body.roundedBox(T(0, 0.45, 0), [0.85, 0.75, 0.85], 0.12, c1, 4, (p) => mix3(c1, c2, Math.max(0, Math.min(1, p[1] / 0.9))));
  // pixel horns
  body.roundedBox(T(-0.25, 0.92, 0), [0.14, 0.2, 0.14], 0.03, c2, 2);
  body.roundedBox(T(0.25, 0.92, 0), [0.14, 0.2, 0.14], 0.03, c2, 2);
  const eyes = new MB();
  for (const s of [-1, 1]) {
    eyes.roundedBox(T(s * 0.19, 0.52, 0.43), [0.2, 0.2, 0.04], 0.04, [1, 1, 1], 2);
    eyes.roundedBox(T(s * 0.17, 0.5, 0.46), [0.09, 0.11, 0.03], 0.02, hex('#1a0f24'), 2);
    // angry brow
    eyes.roundedBox(T(s * 0.19, 0.67, 0.44, 0, 0, s * 0.35), [0.24, 0.05, 0.04], 0.015, hex('#1a0f24'), 2);
  }
  const bit = new MB().roundedBox(T(0, 0, 0), [0.12, 0.12, 0.12], 0.02, hex('#ff6ad5'), 2).build(r);
  return { body: body.build(r), eyes: eyes.build(r), bit };
}

export function buildWisp(r) {
  const mb = new MB();
  const c = hex('#bff4ff');
  mb.sphere(T(0, 0, 0), 0.45, 16, c);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    mb.cylinder(T(Math.cos(a) * 0.15, -0.25, Math.sin(a) * 0.15, 0, Math.PI, 0), 0.22, 0.0, 0.7, 8, c);
  }
  const eyes = new MB();
  eyes.sphere(T(-0.15, 0.06, 0.38, 0, 0, 0, [1, 1.4, 0.5]), 0.07, 8, hex('#20184a'));
  eyes.sphere(T(0.15, 0.06, 0.38, 0, 0, 0, [1, 1.4, 0.5]), 0.07, 8, hex('#20184a'));
  return { body: mb.build(r), eyes: eyes.build(r) };
}

export function buildLaserPost(r) {
  const mb = new MB();
  mb.cylinder(T(0, 0, 0), 0.55, 0.45, 0.3, 12, hex('#4a3a40'), true);
  mb.cylinder(T(0, 0.3, 0), 0.25, 0.22, 0.4, 10, hex('#d8c8a8'));
  mb.sphere(T(0, 0.75, 0), 0.24, 12, hex('#ff8a5a'));
  const beam = new MB();
  beam.fxQuad(T(0, 0, 0, 0, 0, 0), 1, 0.35, false);
  beam.fxQuad(T(0, 0, 0, 0, 0, Math.PI / 2), 1, 0.35, false);
  // beams extend along +x: rebuild as horizontal quads
  const b2 = new MB();
  const quadX = (roll) => {
    const m = T(0, 0, 0, 0, roll, 0);
    const pts = [[0, -0.17, 0], [1, -0.17, 0], [1, 0.17, 0], [0, 0.17, 0]].map((p) => MB.xf(m, p));
    const n = [0, 0, 1];
    b2.vert(pts[0], n, [0, 0, 0]); b2.vert(pts[1], n, [1, 0, 0]); b2.vert(pts[2], n, [1, 1, 0]);
    b2.vert(pts[0], n, [0, 0, 0]); b2.vert(pts[2], n, [1, 1, 0]); b2.vert(pts[3], n, [0, 1, 0]);
  };
  quadX(0); quadX(Math.PI / 2);
  return { post: mb.build(r), beam: b2.build(r) };
}

export function buildShadowDisc(r) {
  const mb = new MB();
  const m = T(0, 0, 0, 0, -Math.PI / 2, 0);
  mb.fxQuad(m, 1, 1, false);
  return mb.build(r);
}

export function buildHalo(r) {
  return new MB().fxQuad(T(0, 0, 0), 1, 1, false).build(r);
}

// ===========================================================================
//  Platforms
// ===========================================================================
export function buildBlock(r, size, colors, seed) {
  const [top, side, rock] = colors;
  const rnd = mulberry(seed);
  const mb = new MB();
  const [hx, hy, hz] = size;
  const bev = Math.min(0.18, hy * 0.4, hx * 0.3, hz * 0.3);
  mb.roundedBox(T(0, 0, 0), [hx * 2, hy * 2, hz * 2], bev, top, 3, (p) => {
    const k = 0.94 + rnd() * 0.1;
    if (p[1] > hy - bev * 0.6) return mulc(top, k);
    return mulc(mix3(side, rock, Math.max(0, Math.min(1, (hy - p[1]) / (hy * 2)))), k);
  });
  return mb.build(r);
}

export function buildDisc(r, radius, half, colors, seed) {
  const [top, side, rock] = colors;
  const rnd = mulberry(seed);
  const mb = new MB();
  const h = half * 2;
  const prof = [[0.0001, -half - 0.25], [radius * 0.55, -half - 0.12], [radius * 0.92, -half], [radius, -half * 0.3], [radius, half - 0.1], [radius * 0.96, half], [0.0001, half]];
  mb.lathe(T(0, 0, 0), prof, Math.max(10, Math.round(radius * 9)), (v) => {
    const k = 0.93 + rnd() * 0.12;
    if (v > 0.8) return mulc(top, k);
    if (v > 0.35) return mulc(side, k);
    return mulc(rock, k);
  }, false);
  void h;
  return mb.build(r);
}

// ===========================================================================
//  Decor — each returns a mesh built at the origin (instanced at runtime)
// ===========================================================================
export function buildDecor(r, kind, variant, pal) {
  const rnd = mulberry(1000 + variant * 77 + kind.length * 13);
  const mb = new MB();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  switch (kind) {
    case 'tree': {
      const trunk = hex('#8a5a3c');
      mb.cylinder(T(0, 0, 0), 0.26, 0.16, 1.6, 7, trunk, true);
      mb.cylinder(T(0.0, 1.1, 0, 0.6, 0, 0.7), 0.08, 0.05, 0.6, 5, trunk, true);
      const leaf = pick(pal.foliage);
      const bloom = rnd() < pal.blossomChance ? pick(pal.blossom) : null;
      const n = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.28, d = i === 0 ? 0 : 0.45 + rnd() * 0.2;
        const s = i === 0 ? 1.05 : 0.65 + rnd() * 0.25;
        const c = bloom && i % 2 ? bloom : leaf;
        mb.blob(T(Math.cos(a) * d, 2.0 + rnd() * 0.5 + (i === 0 ? 0.3 : 0), Math.sin(a) * d), s, (p) => mix3(mulc(c, 0.8), mix3(c, [1, 1, 0.9], 0.25), Math.max(0, Math.min(1, (p[1] - 1.6) / 1.4))), Math.floor(rnd() * 1e6), 0.22, 9, 0.85);
      }
      break;
    }
    case 'palm': {
      const trunk = hex('#a77b52');
      let x = 0, y = 0, lean = (rnd() - 0.5) * 0.5;
      for (let i = 0; i < 6; i++) {
        mb.cylinder(T(x, y, 0, 0, 0, -lean), 0.2 - i * 0.015, 0.18 - i * 0.015, 0.55, 7, i % 2 ? trunk : mulc(trunk, 0.85), true);
        x += Math.sin(lean) * 0.55; y += Math.cos(lean) * 0.55;
        lean *= 1.15;
      }
      const leaf = pick(pal.foliage);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
        const m = T(x, y, 0, a, 0.35 + rnd() * 0.3, 0);
        for (let k = 0; k < 4; k++) {
          const z0 = k * 0.45, z1 = (k + 1) * 0.45, w0 = 0.32 - k * 0.06, w1 = 0.32 - (k + 1) * 0.06;
          const d0 = -k * k * 0.07, d1 = -(k + 1) * (k + 1) * 0.07;
          const p = [[-w0, d0, z0], [w0, d0, z0], [w1, d1, z1], [-w1, d1, z1]].map((q) => MB.xf(m, q));
          const c = mulc(leaf, 0.85 + k * 0.06);
          mb.quad(p[0], p[1], p[2], p[3], c);
          mb.quad(p[0], p[3], p[2], p[1], mulc(c, 0.8));
        }
      }
      mb.sphere(T(x, y - 0.05, 0), 0.22, 8, hex('#6b4a2a'), true);
      break;
    }
    case 'bush': {
      const c = pick(pal.foliage);
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28;
        mb.blob(T(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3), 0.45 + rnd() * 0.15, mulc(c, 0.9 + rnd() * 0.15), Math.floor(rnd() * 1e6), 0.2, 8, 0.8);
      }
      if (rnd() < 0.5) {
        const f = pick(pal.flowers);
        for (let i = 0; i < 5; i++) {
          const a = rnd() * 6.28;
          mb.sphere(T(Math.cos(a) * 0.5, 0.55 + rnd() * 0.25, Math.sin(a) * 0.5), 0.07, 6, f, true);
        }
      }
      break;
    }
    case 'flower': {
      const stem = hex('#5f8f3a');
      for (let k = 0; k < 3; k++) {
        const ox = (rnd() - 0.5) * 0.5, oz = (rnd() - 0.5) * 0.5, h = 0.3 + rnd() * 0.3;
        mb.cylinder(T(ox, 0, oz), 0.02, 0.015, h, 4, stem, true);
        const f = pick(pal.flowers);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          mb.sphere(T(ox + Math.cos(a) * 0.07, h, oz + Math.sin(a) * 0.07, -a, 0, 0, [1, 0.35, 0.6]), 0.07, 6, f, true);
        }
        mb.sphere(T(ox, h + 0.02, oz), 0.04, 6, hex('#ffd65a'), true);
      }
      break;
    }
    case 'rock': {
      const c = pal.rock;
      mb.blob(T(0, 0.15, 0), 0.5, mulc(c, 0.95 + rnd() * 0.1), Math.floor(rnd() * 1e6), 0.35, 7, 0.7);
      if (rnd() < 0.5) mb.blob(T(0.45, 0.05, 0.2), 0.25, mulc(c, 0.85), Math.floor(rnd() * 1e6), 0.35, 6, 0.7);
      break;
    }
    case 'cactus': {
      const c = hex('#5f9a5a'), cl = hex('#79b56e');
      mb.lathe(T(0, 0, 0), [[0.0001, 0], [0.3, 0], [0.32, 0.1], [0.3, 1.5], [0.22, 1.75], [0.0001, 1.85]], 10, (v) => mix3(c, cl, v), false);
      for (const s of [-1, 1]) {
        if (rnd() < 0.8) {
          const y = 0.6 + rnd() * 0.5;
          mb.cylinder(T(s * 0.25, y, 0, 0, 0, s * Math.PI / 2), 0.13, 0.13, 0.35, 8, c, true);
          mb.lathe(T(s * 0.55, y, 0), [[0.0001, 0], [0.13, 0], [0.13, 0.5], [0.08, 0.62], [0.0001, 0.65]], 8, cl, false);
        }
      }
      if (rnd() < 0.6) mb.sphere(T(0, 1.86, 0), 0.1, 6, pick(pal.flowers), true);
      break;
    }
    case 'crystal': {
      const c = pick(pal.crystal);
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.28, d = i === 0 ? 0 : 0.25 + rnd() * 0.2;
        const h = i === 0 ? 1.6 : 0.6 + rnd() * 0.7, w = i === 0 ? 0.28 : 0.14 + rnd() * 0.1;
        mb.lathe(T(Math.cos(a) * d, 0, Math.sin(a) * d, rnd() * 6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6),
          [[0.0001, -0.1], [w, 0], [w, h * 0.75], [0.0001, h]], 6, (v) => mix3(mulc(c, 0.7), mix3(c, [1, 1, 1], 0.4), v), false);
      }
      break;
    }
    case 'shroom': {
      const c = pick(pal.crystal);
      for (let i = 0; i < 3; i++) {
        const ox = (rnd() - 0.5) * 0.6, oz = (rnd() - 0.5) * 0.6, h = 0.25 + rnd() * 0.35, s = 0.15 + rnd() * 0.15;
        mb.cylinder(T(ox, 0, oz), 0.05, 0.04, h, 6, hex('#e8e0f0'), true);
        mb.sphere(T(ox, h, oz, 0, 0, 0, [1, 0.55, 1]), s, 10, c);
      }
      break;
    }
    case 'column': {
      const st = pal.stone, gold = PALETTE.gold;
      mb.cylinder(T(0, 0, 0), 0.6, 0.6, 0.3, 10, mulc(st, 0.9), true);
      mb.lathe(T(0, 0.3, 0), [[0.45, 0], [0.42, 1.2], [0.44, 2.4], [0.4, 2.6]], 12, st, false);
      mb.cylinder(T(0, 2.9, 0), 0.62, 0.55, 0.25, 10, gold, true);
      break;
    }
    case 'brazier': {
      const dark = hex('#2a2228'), gold = PALETTE.gold;
      mb.cylinder(T(0, 0, 0), 0.35, 0.18, 0.9, 8, dark, true);
      mb.lathe(T(0, 0.9, 0), [[0.0001, 0], [0.2, 0], [0.55, 0.3], [0.6, 0.4], [0.5, 0.4]], 10, gold, false);
      break;
    }
    case 'lamp': {
      const post = hex('#4a3a34');
      mb.cylinder(T(0, 0, 0), 0.08, 0.06, 1.7, 6, post, true);
      mb.cylinder(T(0, 1.7, 0), 0.22, 0.2, 0.35, 6, hex('#ffd9a0'), false);
      mb.cylinder(T(0, 2.05, 0), 0.28, 0.0, 0.22, 6, post, true);
      break;
    }
    default:
      mb.sphere(T(0, 0.5, 0), 0.5, 8, [1, 0, 1]);
  }
  return mb.build(r);
}

export function buildArch(r, pal) {
  const mb = new MB();
  const st = pal.stone;
  for (const s of [-1, 1]) {
    mb.roundedBox(T(s * 2.2, 2.0, 0), [0.9, 4.0, 0.9], 0.12, st, 3, (p) => mulc(st, 0.85 + (p[1] / 4) * 0.2));
  }
  mb.roundedBox(T(0, 4.3, 0), [5.6, 0.7, 1.1], 0.12, mulc(st, 1.05), 3);
  mb.starburst(T(0, 4.3, 0.6), 6, 0.1, 0.45, 0.06, PALETTE.clawd, PALETTE.spark);
  return mb.build(r);
}

export function buildWaterfall(r, w, h) {
  return new MB().fxQuad(T(0, -h, 0), w, h, true).build(r);
}

// grass: a single tapered blade with gradient colour (instanced in thousands)
export function buildGrassBlade(r, base, tip) {
  const mb = new MB();
  const segs = 3, w = 0.045, h = 0.34;
  for (let i = 0; i < segs; i++) {
    const y0 = (i / segs) * h, y1 = ((i + 1) / segs) * h;
    const w0 = w * (1 - i / segs), w1 = w * (1 - (i + 1) / segs);
    const b0 = (i / segs) ** 2 * 0.12, b1 = ((i + 1) / segs) ** 2 * 0.12;
    const c = mix3(base, tip, (i + 0.5) / segs);
    const n = [0, 0.3, 1];
    const lc = L(c);
    const P = [[-w0, y0, b0], [w0, y0, b0], [w1, y1, b1], [-w1, y1, b1]];
    mb.vert(P[0], n, lc); mb.vert(P[1], n, lc); mb.vert(P[2], n, lc);
    mb.vert(P[0], n, lc); mb.vert(P[2], n, lc); mb.vert(P[3], n, lc);
  }
  return mb.build(r);
}
