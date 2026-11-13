// New enemies: Rambot (charger), Spitpod (turret), Shellback (armoured), plus the Glitch King's crown.
import { m4 } from './math.js';
import { MB, hex } from './meshes.js';

const T = (x, y, z, yaw = 0, pitch = 0, roll = 0, s = [1, 1, 1]) => m4.trs([x, y, z], yaw, pitch, roll, s);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Rambot: a stocky glitch bull that charges in straight lines.
export function buildRambot(r) {
  const steel = hex('#3e5a6e'), stripe = hex('#f2a23a'), horn = hex('#e8e0d0'), dark = hex('#1e2830');
  const body = new MB();
  body.roundedBox(T(0, 0.55, 0), [1.0, 0.75, 1.25], 0.18, steel, 4, (p) => (Math.abs(p[2] - 0.05) < 0.08 || Math.abs(p[2] + 0.35) < 0.08 ? stripe : mix3(steel, hex('#5a7a90'), Math.max(0, p[1] - 0.4))));
  body.roundedBox(T(0, 0.62, 0.68), [0.72, 0.55, 0.3], 0.12, mix3(steel, dark, 0.3), 3);       // snout plate
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) body.sphere(T(s * (0.38 + i * 0.07), 0.98 + i * 0.05, 0.55 + i * 0.07), 0.09 - i * 0.015, 8, horn); // curved horns
    for (const z of [-0.4, 0.4]) body.roundedBox(T(s * 0.32, 0.16, z), [0.2, 0.32, 0.22], 0.06, dark, 2);  // legs
  }
  body.roundedBox(T(0, 0.5, -0.66), [0.06, 0.06, 0.25], 0.02, dark, 1);                       // tail
  const eyes = new MB();
  for (const s of [-1, 1]) eyes.roundedBox(T(s * 0.18, 0.72, 0.84, 0, 0, s * 0.25), [0.16, 0.06, 0.03], 0.02, hex('#ff4a3a'), 2);
  return { body: body.build(r), eyes: eyes.build(r) };
}

// Spitpod: a potted turret that lobs glowing orbs. The head turns to aim.
export function buildSpitpod(r) {
  const pot = hex('#7a3a8a'), rim = hex('#c84ad8'), leaf = hex('#4aa86a');
  const base = new MB();
  base.lathe(T(0, 0, 0), [[0.0001, 0], [0.42, 0], [0.5, 0.35], [0.56, 0.5], [0.48, 0.55], [0.0001, 0.55]], 14, (v) => (v > 0.6 ? rim : pot), false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    base.sphere(T(Math.cos(a) * 0.42, 0.6, Math.sin(a) * 0.42, -a, 0, 0.5, [0.9, 0.25, 0.45]), 0.3, 8, leaf, true);
  }
  const head = new MB();
  head.sphere(T(0, 0, 0), 0.38, 14, (u, v) => mix3(hex('#9a4ac8'), hex('#d87ae8'), v));
  head.cylinder(T(0, 0.02, 0.25, 0, Math.PI / 2, 0), 0.14, 0.18, 0.38, 12, hex('#5a2a6a'), false, false); // barrel
  head.torus(T(0, 0.02, 0.63, 0, Math.PI / 2, 0), 0.17, 0.04, 14, 6, rim);
  head.sphere(T(0, 0.22, 0.24, 0, 0, 0, [1, 0.8, 0.6]), 0.11, 10, [1, 1, 1]);
  head.sphere(T(0, 0.22, 0.31), 0.055, 8, hex('#1a0f24'));
  const orb = new MB().sphere(T(0, 0, 0), 0.22, 12, hex('#ff7ae8')).build(r);
  return { base: base.build(r), head: head.build(r), orb };
}

// Shellback: an armoured shell. Stomps bounce off; only a ground pound cracks it.
export function buildShellback(r) {
  const shell = hex('#5a6a3a'), plate = hex('#8a9a4a'), skin = hex('#c8b87a'), spike = hex('#e8e0c0');
  const body = new MB();
  body.lathe(T(0, 0.18, 0), [[0.75, 0], [0.78, 0.12], [0.68, 0.38], [0.45, 0.6], [0.0001, 0.7]], 12,
    (v, u) => ((Math.floor(u * 12) + Math.floor(v * 4)) % 2 ? plate : shell), false);
  body.cylinder(T(0, 0.14, 0), 0.8, 0.8, 0.08, 12, hex('#3a4428'), true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    body.lathe(T(Math.cos(a) * 0.42, 0.68, Math.sin(a) * 0.42, 0, Math.cos(a) * 0.5, -Math.sin(a) * 0.5), [[0.0001, 0], [0.09, 0], [0.0001, 0.26]], 6, spike, false);
  }
  body.lathe(T(0, 0.86, 0), [[0.0001, 0], [0.11, 0], [0.0001, 0.32]], 6, spike, false);
  body.sphere(T(0, 0.32, 0.82, 0, 0, 0, [1, 0.85, 1.1]), 0.26, 12, skin);                       // head
  for (const s of [-1, 1]) {
    body.sphere(T(s * 0.11, 0.42, 1.02), 0.06, 8, [1, 1, 1]);
    body.sphere(T(s * 0.11, 0.42, 1.07), 0.032, 6, hex('#1a1410'));
    body.roundedBox(T(s * 0.1, 0.5, 1.02, 0, 0, s * 0.4), [0.12, 0.03, 0.03], 0.01, hex('#3a2a20'), 1); // angry brows
    for (const z of [-0.45, 0.45]) body.roundedBox(T(s * 0.55, 0.1, z), [0.22, 0.2, 0.24], 0.07, skin, 2);
  }
  return { body: body.build(r) };
}

// The Glitch King wears a gold crown on top of a giant glitchling body.
export function buildCrown(r) {
  const mb = new MB();
  const gold = hex('#f2c14e'), gem = hex('#ff4ad8');
  mb.cylinder(T(0, 0, 0), 0.32, 0.34, 0.14, 16, gold, false, false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    mb.lathe(T(Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3), [[0.0001, 0], [0.1, 0], [0.0001, 0.3]], 6, gold, false);
    mb.sphere(T(Math.cos(a) * 0.3, 0.44, Math.sin(a) * 0.3), 0.045, 6, gem);
  }
  return mb.build(r);
}
