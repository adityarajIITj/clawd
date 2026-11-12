// Marathi Manus character, reptile collectibles and Maharashtra decor.
import { m4, mulberry } from './math.js';
import { MB, hex } from './meshes.js';

const T = (x, y, z, yaw = 0, pitch = 0, roll = 0, s = [1, 1, 1]) => m4.trs([x, y, z], yaw, pitch, roll, s);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ===========================================================================
//  MARATHI MANUS — chibi proportions; parts are positioned by the animator
// ===========================================================================
export function buildManus(r) {
  const skin = hex('#94664c'), skinD = hex('#7e543c'), hair = hex('#17110f'), tee = hex('#e6e3dc'),
    jeans = hex('#2f3846'), shoe = hex('#f1efe9'), sole = hex('#3a3434'), band = hex('#222226'), logo = hex('#d8484a');
  const P = {};
  const head = new MB();
  head.sphere(T(0, 0, 0, 0, 0, 0, [1, 1.08, 0.98]), 0.27, 18, skin);
  for (const s of [-1, 1]) {
    head.sphere(T(s * 0.27, -0.01, 0, 0, 0, 0, [0.5, 1, 0.8]), 0.06, 8, skinD);              // ears
  }
  // slicked-back hair cap (face left open) + man bun with tie
  head.sphere(T(0, 0.045, -0.02, 0, -0.18, 0, [1.06, 0.98, 1.06]), 0.27, 18, hair, false,
    (n) => (n[2] > 0.25 && n[1] < 0.55 ? 0.6 : 1));
  head.sphere(T(0, 0.33, -0.06), 0.09, 12, hair);
  head.cylinder(T(0, 0.25, -0.05), 0.055, 0.05, 0.05, 10, hex('#3a3236'));
  P.head = head.build(r);
  // curved plate that carries the photo face (uv packed into the colour channel)
  const plate = new MB();
  const W = 0.47, H = 0.53, N = 10;
  const pt = (u, v) => {
    const x = (u - 0.5) * W, y = (v - 0.5) * H;
    return [x, y - 0.03, 0.3 - x * x * 1.1 - y * y * 0.4];
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
      const q = [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
      for (const [u, v] of q) plate.vert(pt(u, v), [0, 0, 1], [u, v, 0]);
    }
  }
  P.facePlate = plate.build(r);
  const eye = new MB();
  eye.sphere(T(0, 0, 0, 0, 0, 0, [1, 1.25, 0.5]), 0.032, 8, hex('#120c0a'));
  eye.sphere(T(0.01, 0.012, 0.012), 0.009, 6, [1, 1, 1]);
  P.eye = eye.build(r);
  P.mouth = new MB().roundedBox(T(0, 0, 0), [0.09, 0.022, 0.02], 0.009, hex('#5a2424'), 2).build(r);
  P.tongue = new MB().sphere(T(0, 0, 0, 0, 0, 0, [1, 0.7, 1.3]), 0.04, 8, hex('#e0707a')).build(r);

  const torso = new MB();
  torso.roundedBox(T(0, 0, 0), [0.52, 0.5, 0.3], 0.1, tee, 5, (p) => mix3(mulc(tee, 0.88), tee, Math.max(0, Math.min(1, (p[1] + 0.25) / 0.5))));
  torso.cylinder(T(0, 0.22, 0), 0.08, 0.075, 0.1, 10, skin);
  torso.torus(T(0, 0.255, 0.01, 0, 0.25, 0), 0.155, 0.026, 22, 8, band);                     // neckband earphones
  torso.sphere(T(-0.13, 0.2, 0.16), 0.03, 6, band);
  torso.sphere(T(0.13, 0.2, 0.16), 0.03, 6, band);
  torso.cylinder(T(0.06, -0.02, 0.152, 0, Math.PI / 2, 0), 0.07, 0.07, 0.01, 16, logo);       // chest logo
  torso.cylinder(T(0.06, -0.02, 0.161, 0, Math.PI / 2, 0), 0.045, 0.045, 0.006, 16, tee);
  P.torso = torso.build(r);

  const arm = new MB(); // pivot at the shoulder, hangs along -Y
  arm.roundedBox(T(0, -0.07, 0), [0.15, 0.17, 0.15], 0.06, tee, 3);
  arm.cylinder(T(0, -0.36, 0), 0.042, 0.052, 0.22, 8, skin);
  arm.sphere(T(0, -0.39, 0, 0, 0, 0, [0.9, 1.1, 0.8]), 0.06, 8, skin);
  P.arm = arm.build(r);
  P.phone = new MB().roundedBox(T(0, 0, 0), [0.085, 0.16, 0.016], 0.012, hex('#16161a'), 2).build(r);

  const leg = new MB(); // pivot at the hip
  leg.roundedBox(T(0, -0.17, 0), [0.17, 0.36, 0.18], 0.06, jeans, 3);
  leg.roundedBox(T(0, -0.37, 0.04), [0.16, 0.08, 0.25], 0.04, shoe, 3, (p) => (p[1] < -0.395 ? sole : shoe));
  P.leg = leg.build(r);
  return P;
}

// ===========================================================================
//  Reptile collectibles
// ===========================================================================
function reptile(mb, body, belly, spots, s, tongue) {
  mb.sphere(T(0, 0, 0, 0, 0, 0, [0.62 * s, 0.42 * s, 1.0 * s]), 0.3, 14, (u, v) => (v < 0.35 ? belly : body));
  mb.sphere(T(0, 0.04 * s, 0.34 * s, 0, 0, 0, [0.7 * s, 0.55 * s, 0.95 * s]), 0.17, 12, body);
  mb.sphere(T(0, 0.02 * s, 0.45 * s, 0, 0, 0, [0.55 * s, 0.4 * s, 0.7 * s]), 0.12, 10, body);
  for (const x of [-1, 1]) {
    mb.sphere(T(x * 0.075 * s, 0.1 * s, 0.38 * s), 0.035 * s, 8, hex('#f4e27a'));
    mb.sphere(T(x * 0.082 * s, 0.105 * s, 0.395 * s), 0.018 * s, 6, hex('#101010'));
    for (const z of [-1, 1]) {
      mb.cylinder(T(x * 0.15 * s, -0.04 * s, z * 0.17 * s, 0, 0, x * -1.1), 0.04 * s, 0.03 * s, 0.17 * s, 6, body);
      mb.sphere(T(x * 0.29 * s, -0.11 * s, z * 0.19 * s, 0, 0, 0, [1.2, 0.4, 1.3]), 0.05 * s, 6, body);
    }
  }
  for (let i = 0; i < 7; i++) {
    const t = i / 7;
    mb.sphere(T(Math.sin(t * 2.6) * 0.18 * s, -0.01 * s, (-0.27 - t * 0.55) * s), (0.12 * (1 - t) + 0.015) * s, 8, body);
  }
  for (let i = 0; i < 6; i++) mb.sphere(T((i % 2 ? 0.08 : -0.08) * s, 0.11 * s, (0.15 - i * 0.07) * s, 0, 0, 0, [1, 0.35, 1]), 0.045 * s, 6, spots);
  if (tongue) {
    mb.cylinder(T(0, 0, 0.56 * s, 0, Math.PI / 2, 0), 0.012 * s, 0.012 * s, 0.12 * s, 5, hex('#e2556a'));
    for (const x of [-1, 1]) mb.cylinder(T(x * 0.02 * s, 0, 0.68 * s, x * 0.4, Math.PI / 2, 0), 0.01 * s, 0.006 * s, 0.05 * s, 4, hex('#e2556a'));
  }
}
export function buildLizard(r) {
  const mb = new MB();
  reptile(mb, hex('#4cc26a'), hex('#c8f08a'), hex('#2f8f9a'), 0.95, false);
  return mb.build(r);
}
export function buildKomodo(r) {
  const mb = new MB();
  reptile(mb, hex('#7a6a52'), hex('#b8a37c'), hex('#4f4334'), 1.25, true);
  return mb.build(r);
}

// ===========================================================================
//  Maharashtra decor
// ===========================================================================
export function buildDecorMH(r, kind, variant) {
  const rnd = mulberry(5000 + variant * 31 + kind.length * 7);
  const mb = new MB();
  switch (kind) {
    case 'kandil': { // akash kandil: star lantern hanging from a bamboo pole
      const bamboo = hex('#b08a50');
      mb.cylinder(T(0, 0, 0), 0.05, 0.04, 2.2, 6, bamboo, true);
      mb.cylinder(T(0, 2.15, 0, 0, Math.PI / 2, 0), 0.03, 0.03, 0.45, 5, bamboo, true);
      const c = [hex('#ff9a3a'), hex('#ff5a7a'), hex('#ffd35a'), hex('#7ad0ff')][variant % 4];
      mb.starburst(T(0, 1.75, 0.45), 5, 0.16, 0.36, 0.16, c, mix3(c, [1, 1, 0.85], 0.5), 1);
      mb.starburst(T(0, 1.75, 0.45, Math.PI / 2), 5, 0.16, 0.36, 0.16, c, mix3(c, [1, 1, 0.85], 0.5), 1);
      for (let i = 0; i < 3; i++) mb.cylinder(T((i - 1) * 0.08, 1.12, 0.45), 0.012, 0.012, 0.3, 4, c, true);
      break;
    }
    case 'diya': {
      mb.lathe(T(0, 0, 0), [[0.0001, 0], [0.16, 0.02], [0.2, 0.08], [0.15, 0.1]], 10, hex('#b8582e'), false);
      mb.lathe(T(0.06, 0.09, 0), [[0.0001, 0], [0.04, 0.02], [0.025, 0.08], [0.0001, 0.13]], 6, hex('#ffcf5a'), false);
      break;
    }
    case 'boat': {
      const wood = hex('#3d6fb0'), trim = hex('#f2c14e');
      mb.lathe(T(0, 0.3, 0, 0, Math.PI / 2, 0, [0.55, 1, 1]), [[0.0001, -1.6], [0.35, -1.2], [0.5, -0.3], [0.5, 0.6], [0.3, 1.4], [0.0001, 1.8]], 10,
        (v) => (v > 0.45 && v < 0.6 ? trim : wood), false);
      mb.cylinder(T(0, 0.45, 0), 0.04, 0.03, 2.2, 6, hex('#8a6a4a'), true);
      const p = [[0, 2.5, 0.05], [0, 0.8, 0.05], [0.9, 0.9, 0.05]];
      mb.tri(p[0], p[1], p[2], hex('#f6eedc'));
      mb.tri(p[0], p[2], p[1], hex('#e6dcc8'));
      break;
    }
    case 'marigold': {
      for (let k = 0; k < 4; k++) {
        const ox = (rnd() - 0.5) * 0.6, oz = (rnd() - 0.5) * 0.6, h = 0.25 + rnd() * 0.2;
        mb.cylinder(T(ox, 0, oz), 0.02, 0.015, h, 4, hex('#4f8a36'), true);
        mb.blob(T(ox, h, oz), 0.09, rnd() < 0.5 ? hex('#ff9a1a') : hex('#ffc21a'), Math.floor(rnd() * 1e6), 0.3, 7, 0.8);
      }
      break;
    }
    case 'pine': { // snow-dusted conifer
      const trunk = hex('#6a4a34'), green = hex('#2f7a6a'), snow = hex('#f4f9ff');
      mb.cylinder(T(0, 0, 0), 0.2, 0.14, 0.9, 7, trunk, true);
      for (let i = 0; i < 3; i++) {
        const y = 0.7 + i * 0.75, rr = 1.0 - i * 0.26;
        mb.lathe(T(0, y, 0, rnd() * 6), [[0.0001, 0], [rr, 0.05], [rr * 0.55, 0.55], [0.0001, 1.05]], 8,
          (v) => (v > 0.7 ? snow : mix3(mulc(green, 0.75), green, v * 1.4)), false);
      }
      break;
    }
    case 'snowman': {
      const sn = hex('#f6faff');
      mb.sphere(T(0, 0.42, 0), 0.45, 12, sn);
      mb.sphere(T(0, 1.02, 0), 0.33, 12, sn);
      mb.sphere(T(0, 1.5, 0), 0.24, 12, sn);
      mb.lathe(T(0, 1.5, 0.22, 0, Math.PI / 2, 0), [[0.0001, 0], [0.05, 0.0], [0.0001, 0.22]], 6, hex('#ff8a3a'), false);
      for (const x of [-1, 1]) mb.sphere(T(x * 0.09, 1.57, 0.2), 0.03, 6, hex('#1a1a1e'));
      mb.torus(T(0, 1.28, 0), 0.25, 0.06, 14, 6, hex('#d97757'));
      for (const x of [-1, 1]) mb.cylinder(T(x * 0.3, 1.05, 0, 0, 0, x * -1.2), 0.025, 0.015, 0.5, 5, hex('#6a4a34'), true);
      break;
    }
    case 'tank': { // rooftop water tank on a stand
      const black = hex('#1e2026'), leg = hex('#6a6e78');
      for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) mb.cylinder(T(x, 0, z), 0.05, 0.05, 0.7, 5, leg, true);
      mb.cylinder(T(0, 0.68, 0), 0.8, 0.8, 0.06, 12, leg, true);
      const prof = [[0.0001, 0.74]];
      for (let i = 0; i <= 8; i++) prof.push([0.72 + (i % 2 ? 0.05 : 0), 0.74 + i * 0.16]);
      prof.push([0.5, 2.12], [0.22, 2.2], [0.22, 2.3], [0.0001, 2.3]);
      mb.lathe(T(0, 0, 0), prof, 14, (v) => mulc(black, 0.9 + v * 0.5), false);
      break;
    }
    case 'dish': { // satellite dish
      const metal = hex('#c8ccd4');
      mb.cylinder(T(0, 0, 0), 0.06, 0.05, 0.9, 6, hex('#5a5e68'), true);
      const m = T(0, 1.05, 0, 0, -0.9, 0);
      mb.lathe(m, [[0.0001, 0], [0.25, 0.03], [0.45, 0.1], [0.6, 0.22]], 14, metal, false);
      mb.lathe(m, [[0.6, 0.22], [0.45, 0.08], [0.25, 0.0], [0.0001, -0.03]], 14, mulc(metal, 0.7), false);
      mb.cylinder(T(0, 1.05, 0, 0, -0.9, 0), 0.015, 0.015, 0.5, 4, hex('#3a3e48'), true);
      break;
    }
    default:
      mb.sphere(T(0, 0.5, 0), 0.5, 8, [1, 0, 1]);
  }
  return mb.build(r);
}

export const MH_DECOR = new Set(['kandil', 'diya', 'boat', 'marigold', 'pine', 'snowman', 'tank', 'dish']);

// ===========================================================================
//  Smashable crate + lit-window building
// ===========================================================================
export function buildCrate(r) {
  const mb = new MB();
  const wood = hex('#c9925a'), dark = hex('#8a5a34'), band = hex('#6a4426');
  mb.roundedBox(T(0, 0, 0), [1.14, 1.14, 1.14], 0.05, wood, 2, (p) => mulc(wood, 0.86 + 0.14 * (Math.floor((p[1] + 0.6) * 5) % 2)));
  // corner posts and rims
  for (const x of [-1, 1]) for (const z of [-1, 1]) mb.roundedBox(T(x * 0.54, 0, z * 0.54), [0.16, 1.22, 0.16], 0.03, dark, 1);
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) mb.roundedBox(T(0, y * 0.54, z * 0.54), [1.22, 0.16, 0.16], 0.03, band, 1);
    for (const x of [-1, 1]) mb.roundedBox(T(x * 0.54, y * 0.54, 0), [0.16, 0.16, 1.22], 0.03, band, 1);
  }
  // starburst brand on each side
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    mb.starburst(T(Math.sin(a) * 0.585, 0, Math.cos(a) * 0.585, a), 6, 0.06, 0.26, 0.02, hex('#d97757'), hex('#ffb37a'));
  }
  return mb.build(r);
}

export function buildBuilding(r, half, seed) {
  const [hx, hy, hz] = half;
  const rnd = mulberry(seed * 977 + 13);
  const mb = new MB();
  const wall = [hex('#2c3046'), hex('#33304a'), hex('#263244'), hex('#3a3340')][seed % 4];
  const roof = hex('#3e424e');
  const y0 = -hy, y1 = hy;
  // walls (outward-facing quads) + roof
  mb.quad([-hx, y0, hz], [hx, y0, hz], [hx, y1, hz], [-hx, y1, hz], wall);
  mb.quad([hx, y0, -hz], [-hx, y0, -hz], [-hx, y1, -hz], [hx, y1, -hz], mulc(wall, 0.92));
  mb.quad([hx, y0, hz], [hx, y0, -hz], [hx, y1, -hz], [hx, y1, hz], mulc(wall, 0.96));
  mb.quad([-hx, y0, -hz], [-hx, y0, hz], [-hx, y1, hz], [-hx, y1, -hz], mulc(wall, 0.88));
  mb.quad([-hx, y1, hz], [hx, y1, hz], [hx, y1, -hz], [-hx, y1, -hz], roof);
  // windows: warm, cool, or dark
  const lit = [hex('#ffd98a'), hex('#ffc46a'), hex('#bfe0ff'), hex('#fff2c8')];
  const off = hex('#151a2c');
  const rowH = 2.3, colW = 1.7, ww = 0.95, wh = 1.25, e = 0.03;
  const rows = Math.floor((hy * 2 - 1.5) / rowH);
  const sides = [
    [hx, (u, y) => [[u - ww / 2, y, hz + e], [u + ww / 2, y, hz + e], [u + ww / 2, y + wh, hz + e], [u - ww / 2, y + wh, hz + e]]],
    [hx, (u, y) => [[u + ww / 2, y, -hz - e], [u - ww / 2, y, -hz - e], [u - ww / 2, y + wh, -hz - e], [u + ww / 2, y + wh, -hz - e]]],
    [hz, (u, y) => [[hx + e, y, u + ww / 2], [hx + e, y, u - ww / 2], [hx + e, y + wh, u - ww / 2], [hx + e, y + wh, u + ww / 2]]],
    [hz, (u, y) => [[-hx - e, y, u - ww / 2], [-hx - e, y, u + ww / 2], [-hx - e, y + wh, u + ww / 2], [-hx - e, y + wh, u - ww / 2]]],
  ];
  for (const [span, quad] of sides) {
    const cols = Math.max(1, Math.floor((span * 2 - 0.8) / colW));
    for (let rr = 0; rr < rows; rr++) {
      const y = y1 - 1.9 - rr * rowH;
      for (let c = 0; c < cols; c++) {
        const u = (c - (cols - 1) / 2) * colW;
        const col = rnd() < 0.42 ? lit[Math.floor(rnd() * lit.length)] : off;
        const q = quad(u, y);
        mb.quad(q[0], q[1], q[2], q[3], col);
      }
    }
  }
  // parapet around the roof edge
  const pc = mulc(wall, 1.25);
  mb.roundedBox(T(0, y1 + 0.12, hz - 0.12), [hx * 2, 0.24, 0.24], 0.03, pc, 1);
  mb.roundedBox(T(0, y1 + 0.12, -hz + 0.12), [hx * 2, 0.24, 0.24], 0.03, pc, 1);
  mb.roundedBox(T(hx - 0.12, y1 + 0.12, 0), [0.24, 0.24, hz * 2], 0.03, pc, 1);
  mb.roundedBox(T(-hx + 0.12, y1 + 0.12, 0), [0.24, 0.24, hz * 2], 0.03, pc, 1);
  return mb.build(r);
}
