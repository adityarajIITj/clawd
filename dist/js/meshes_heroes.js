// Mahak (Uttarakhand) and Lingraj (Odisha): models, collectibles and regional decor.
// Same chibi rig as Marathi Manus: body centre 0.65 above the feet, head at +0.55.
import { m4, mulberry } from './math.js';
import { MB, hex } from './meshes.js';

const T = (x, y, z, yaw = 0, pitch = 0, roll = 0, s = [1, 1, 1]) => m4.trs([x, y, z], yaw, pitch, roll, s);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const GOLD = hex('#e8b84a');

function face(mb, skin, skinD, hair, { brows = 0.085 } = {}) {
  mb.sphere(T(0, 0, 0, 0, 0, 0, [1, 1.08, 0.98]), 0.27, 18, skin);
  mb.sphere(T(0, -0.055, 0.258, 0, 0, 0, [0.8, 0.9, 0.8]), 0.04, 8, skinD);                      // nose
  for (const s of [-1, 1]) {
    mb.sphere(T(s * 0.27, -0.01, 0, 0, 0, 0, [0.5, 1, 0.8]), 0.06, 8, skinD);                     // ears
    mb.roundedBox(T(s * 0.095, brows, 0.238, 0, 0, s * -0.1), [0.095, 0.02, 0.03], 0.009, hair, 2); // brows
    mb.sphere(T(s * 0.15, -0.075, 0.22, 0, 0, 0, [1, 0.6, 0.4]), 0.045, 8, mix3(skin, hex('#e8857a'), 0.35)); // cheeks
  }
}

function eyeAndMouth(r, P) {
  const eye = new MB();
  eye.sphere(T(0, 0, 0, 0, 0, 0, [1, 1.3, 0.5]), 0.034, 8, hex('#140d0a'));
  eye.sphere(T(0.011, 0.014, 0.013), 0.01, 6, [1, 1, 1]);
  P.eye = eye.build(r);
  P.mouth = new MB().roundedBox(T(0, 0, 0), [0.075, 0.02, 0.02], 0.009, hex('#7a2a2a'), 2).build(r);
  P.mouthOpen = new MB().sphere(T(0, 0, 0, 0, 0, 0, [1, 0.75, 0.5]), 0.04, 8, hex('#5a1a1e')).build(r);
}

// ===========================================================================
//  MAHAK — a mountain girl from Uttarakhand
// ===========================================================================
export function buildMahak(r) {
  const skin = hex('#c48a66'), skinD = hex('#a8704e'), hair = hex('#1a1210');
  const wool = hex('#8e2f3a'), mustard = hex('#e0a63a'), cream = hex('#f2e6cc');
  const P = {};
  const head = new MB();
  face(head, skin, skinD, hair);
  // hair: centre-parted cap leaving the face open, with a soft fringe line
  head.sphere(T(0, 0.04, -0.02, 0, -0.16, 0, [1.07, 1.0, 1.07]), 0.27, 18, hair, false,
    (n) => (n[2] > 0.45 && n[1] < 0.3 ? 0.55 : 1));
  head.roundedBox(T(0, 0.255, 0.12, 0, -0.85, 0), [0.012, 0.02, 0.12], 0.004, skinD, 1);           // parting
  head.sphere(T(0, 0.115, 0.262), 0.014, 6, hex('#c8202e'));                                        // bindi
  head.torus(T(0.042, -0.085, 0.262, 0, 0, Math.PI / 2), 0.03, 0.0065, 16, 5, GOLD);              // nath (nose ring)
  for (const s of [-1, 1]) head.sphere(T(s * 0.275, -0.085, 0.01), 0.022, 6, GOLD);                // earrings
  P.head = head.build(r);
  eyeAndMouth(r, P);

  // long braid with a red paranda tassel: pivots at the back of the head, hangs down -Y
  const braid = new MB();
  for (let i = 0; i < 8; i++) {
    const y = -i * 0.07, rr = 0.07 - i * 0.004;
    braid.sphere(T((i % 2 ? 0.012 : -0.012), y, 0, 0, 0, 0, [1, 0.85, 1]), rr, 8, mulc(hair, i % 2 ? 1.25 : 1));
  }
  braid.cylinder(T(0, -0.6, 0), 0.03, 0.028, 0.04, 8, GOLD, true);
  braid.cylinder(T(0, -0.6, 0, 0, Math.PI, 0), 0.03, 0.065, 0.16, 8, hex('#d8283a'), true);
  P.braid = braid.build(r);

  // knitted sweater with a pahadi pattern band
  const torso = new MB();
  torso.roundedBox(T(0, 0, 0), [0.52, 0.5, 0.31], 0.11, wool, 5, (p) => {
    if (p[1] > 0.02 && p[1] < 0.12) return (Math.floor((p[0] + p[2]) * 18 + Math.abs(p[1] - 0.07) * 40) % 2) ? mustard : cream;
    if (Math.abs(p[1] - 0.15) < 0.012 || Math.abs(p[1] + 0.01) < 0.012) return mustard;
    return mulc(wool, 0.9 + 0.1 * Math.sin(p[1] * 60));
  });
  torso.cylinder(T(0, 0.22, 0), 0.08, 0.075, 0.1, 10, skin);
  torso.torus(T(0, 0.235, 0), 0.105, 0.03, 18, 6, mustard);                                       // knitted collar
  P.torso = torso.build(r);

  // ghagra (long skirt) — separate so it can flare while she dances
  const skirt = new MB();
  // profile runs hem -> waist (upward) so the faces point outward
  skirt.lathe(T(0, 0, 0), [[0.41, -0.38], [0.41, -0.33], [0.395, -0.3], [0.36, -0.22], [0.3, -0.1], [0.27, 0]], 22, (v) => {
    if (v < 0.2) return hex('#c8323c');
    if (v < 0.4) return GOLD;
    return mix3(hex('#2f7a5a'), hex('#24604a'), v);
  });
  P.skirt = skirt.build(r);

  const arm = new MB();
  arm.roundedBox(T(0, -0.15, 0), [0.14, 0.33, 0.14], 0.06, wool, 3, (p) => (p[1] < -0.27 ? mustard : wool));
  arm.sphere(T(0, -0.37, 0, 0, 0, 0, [0.9, 1.1, 0.8]), 0.058, 8, skin);
  P.arm = arm.build(r);

  const leg = new MB();
  leg.roundedBox(T(0, -0.2, 0), [0.14, 0.32, 0.15], 0.05, hex('#3a2a30'), 3);
  leg.roundedBox(T(0, -0.37, 0.03), [0.16, 0.1, 0.24], 0.045, hex('#6a4430'), 3, (p) => (p[1] < -0.4 ? hex('#3a2418') : hex('#6a4430')));
  P.leg = leg.build(r);
  return P;
}

// ===========================================================================
//  LINGRAJ — from Odisha: kurta with an ikat band, dhoti, checked gamucha
// ===========================================================================
export function buildLingraj(r) {
  const skin = hex('#8a5a3e'), skinD = hex('#724830'), hair = hex('#141010');
  const kurta = hex('#efe6d2'), ikatR = hex('#b8323a'), ikatK = hex('#2a1e22');
  const P = {};
  const head = new MB();
  face(head, skin, skinD, hair, { brows: 0.09 });
  head.sphere(T(0, 0.055, -0.03, 0.25, -0.1, 0, [1.06, 0.92, 1.06]), 0.27, 18, hair, false,
    (n) => (n[2] > 0.25 && n[1] < 0.62 ? 0.6 : 1));                                               // short side-parted hair
  head.roundedBox(T(0, -0.112, 0.25), [0.12, 0.024, 0.03], 0.01, hex('#1e1612'), 2);              // moustache
  P.head = head.build(r);
  eyeAndMouth(r, P);

  const ikat = (p, base) => {
    // Sambalpuri-style diamond band near the hem and around the collar
    const band = (y0, y1) => p[1] > y0 && p[1] < y1;
    if (band(-0.34, -0.22)) {
      const u = Math.abs(((p[0] + p[2]) * 9) % 1 - 0.5) * 2, v = Math.abs((p[1] + 0.28) / 0.06);
      return u + v < 0.45 ? ikatK : (u + v < 0.6 ? hex('#f2ece0') : ikatR);
    }
    if (band(-0.37, -0.355) || band(-0.215, -0.2)) return ikatK;
    return base;
  };
  const torso = new MB();
  torso.roundedBox(T(0, -0.07, 0), [0.52, 0.64, 0.3], 0.1, kurta, 6, (p) => ikat(p, mulc(kurta, 0.93 + 0.07 * (p[1] + 0.4))));
  torso.roundedBox(T(0, 0.08, 0.152), [0.03, 0.2, 0.012], 0.005, ikatR, 1);                         // placket
  for (let i = 0; i < 3; i++) torso.sphere(T(0, 0.15 - i * 0.06, 0.162), 0.012, 5, GOLD);
  torso.cylinder(T(0, 0.22, 0), 0.08, 0.075, 0.1, 10, skin);
  // gamucha: red/white checked cloth draped over the left shoulder
  const check = (p) => ((Math.floor(p[0] * 30) + Math.floor(p[1] * 30) + Math.floor(p[2] * 30)) % 2 ? hex('#f2ece0') : hex('#c8283a'));
  torso.roundedBox(T(-0.19, 0.26, 0), [0.13, 0.05, 0.34], 0.02, ikatR, 2, check);
  torso.roundedBox(T(-0.19, 0.08, 0.17, 0, 0.08, 0), [0.13, 0.36, 0.03], 0.012, ikatR, 2, check);
  torso.roundedBox(T(-0.19, 0.05, -0.17, 0, -0.06, 0), [0.13, 0.42, 0.03], 0.012, ikatR, 2, check);
  P.torso = torso.build(r);

  const arm = new MB();
  arm.roundedBox(T(0, -0.1, 0), [0.15, 0.22, 0.15], 0.06, kurta, 3, (p) => (p[1] < -0.19 ? ikatR : kurta));
  arm.cylinder(T(0, -0.36, 0), 0.042, 0.052, 0.16, 8, skin);
  arm.sphere(T(0, -0.39, 0, 0, 0, 0, [0.9, 1.1, 0.8]), 0.06, 8, skin);
  P.arm = arm.build(r);

  const leg = new MB(); // dhoti: loose white with a red border, flat sandals
  leg.roundedBox(T(0, -0.19, 0), [0.19, 0.36, 0.2], 0.07, hex('#f4efe4'), 3, (p) => (p[1] < -0.34 ? ikatR : hex('#f4efe4')));
  leg.roundedBox(T(0, -0.395, 0.03), [0.13, 0.04, 0.22], 0.015, hex('#7a4a2a'), 2);
  leg.sphere(T(0, -0.37, 0.07, 0, 0, 0, [1, 0.5, 1.4]), 0.05, 8, skin);
  P.leg = leg.build(r);
  return P;
}

// ===========================================================================
//  Collectibles
// ===========================================================================
export function buildBrahmaKamal(r) { // Uttarakhand's state flower: cream petals in purple-tinged bracts
  const mb = new MB();
  const petal = hex('#f6eed2'), bract = hex('#c9a6d8'), base = hex('#7aa05a');
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    mb.sphere(T(Math.cos(a) * 0.17, 0.12, Math.sin(a) * 0.17, -a, 0, 0.55, [0.55, 1.2, 0.3]), 0.17, 8, (u, v) => (v > 0.6 ? mix3(bract, [1, 1, 1], 0.2) : bract));
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    mb.sphere(T(Math.cos(a) * 0.09, 0.2, Math.sin(a) * 0.09, -a, 0, 0.25, [0.45, 1.1, 0.28]), 0.15, 8, petal);
  }
  mb.sphere(T(0, 0.28, 0), 0.06, 8, hex('#f2d66a'));
  mb.sphere(T(0, -0.02, 0, 0, 0, 0, [1, 0.6, 1]), 0.13, 8, base);
  return mb.build(r);
}

export function buildMonal(r) { // Himalayan monal: iridescent pheasant, Uttarakhand's state bird
  const mb = new MB();
  const green = hex('#2aa88a'), blue = hex('#3a5ad8'), copper = hex('#c8642a'), violet = hex('#6a3ab8'), tail = hex('#d8843a');
  mb.sphere(T(0, 0, 0, 0, 0, 0, [0.7, 0.7, 1.0]), 0.3, 14, (u, v) => (v > 0.55 ? mix3(violet, blue, u) : mulc(blue, 0.6)));
  mb.sphere(T(0, 0.2, 0.2, 0, 0, 0, [0.8, 0.9, 0.9]), 0.16, 12, copper);                             // neck
  mb.sphere(T(0, 0.34, 0.28), 0.12, 12, green);                                                     // head
  mb.lathe(T(0, 0.33, 0.39, 0, Math.PI / 2, 0), [[0.0001, 0], [0.035, 0.0], [0.0001, 0.08]], 6, hex('#d8c8a0'), false); // beak
  for (const x of [-1, 1]) {
    mb.sphere(T(x * 0.07, 0.37, 0.36), 0.025, 6, hex('#3ab8e8'));                                    // blue eye patch
    mb.sphere(T(x * 0.075, 0.375, 0.375), 0.012, 5, hex('#101010'));
    mb.cylinder(T(x * 0.08, -0.2, 0.02), 0.018, 0.015, 0.18, 5, hex('#5a5a5a'), true);              // legs
  }
  for (let i = 0; i < 6; i++) mb.cylinder(T((i - 2.5) * 0.02, 0.44, 0.27, 0, -0.3 + (i - 2.5) * 0.08, 0), 0.006, 0.004, 0.14, 4, green, true); // crest
  for (let i = 0; i < 5; i++) mb.sphere(T(0, 0.04 + i * 0.01, -0.3 - i * 0.06, 0, 0.2, 0, [0.9, 0.25, 1]), 0.14 - i * 0.012, 8, tail);
  return mb.build(r);
}

export function buildRasagola(r) { // Odisha rasagola in a little sal-leaf cup
  const mb = new MB();
  mb.lathe(T(0, -0.16, 0), [[0.0001, 0], [0.26, 0.02], [0.33, 0.1], [0.34, 0.12]], 14, hex('#5a8a3a'), false);
  mb.lathe(T(0, -0.155, 0), [[0.0001, 0.02], [0.28, 0.06], [0.0001, 0.06]], 14, hex('#f4d890'), false);   // syrup
  mb.sphere(T(0, 0.04, 0, 0, 0, 0, [1, 0.9, 1]), 0.22, 16, (u, v) => mix3(hex('#f4ecd8'), [1, 1, 1], v * 0.6));
  return mb.build(r);
}

export function buildKonarkWheel(r) { // the stone chariot wheel of the Konark Sun Temple, gilded
  const mb = new MB();
  const stone = hex('#e0a050'), dark = hex('#b8742e');
  const m = T(0, 0, 0, 0, Math.PI / 2, 0);
  mb.torus(m, 0.5, 0.07, 32, 8, stone);
  mb.torus(m, 0.42, 0.03, 32, 6, dark);
  mb.cylinder(T(0, 0, -0.07, 0, Math.PI / 2, 0), 0.11, 0.11, 0.14, 12, stone, false, true);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, thick = i % 2 === 0;
    const w = thick ? 0.06 : 0.03;
    mb.roundedBox(T(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0, 0, 0, a + Math.PI / 2), [w, 0.34, w * 0.8], 0.01, thick ? stone : dark, 1);
    if (thick) mb.sphere(T(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.035, 0, 0, 0, [1, 1, 0.5]), 0.045, 6, mix3(stone, [1, 0.95, 0.8], 0.4));
  }
  return mb.build(r);
}

// ===========================================================================
//  Regional decor (instanced by the level loader)
// ===========================================================================
export function buildDecorHero(r, kind, variant) {
  const rnd = mulberry(7000 + variant * 41 + kind.length * 11);
  const mb = new MB();
  switch (kind) {
    case 'deodar': { // Himalayan cedar: tall layered cone
      mb.cylinder(T(0, 0, 0), 0.2, 0.12, 1.0, 7, hex('#5a3e2c'), true);
      const g = [hex('#2f5a44'), hex('#3a6a4c'), hex('#2a4e3e')][variant % 3];
      for (let i = 0; i < 5; i++) {
        const y = 0.6 + i * 0.62, rr = 1.15 - i * 0.2;
        mb.lathe(T(0, y, 0, rnd() * 6), [[0.0001, 0], [rr, -0.05], [rr * 0.5, 0.45], [0.0001, 0.85]], 8, (v) => mix3(mulc(g, 0.75), g, v), false);
      }
      break;
    }
    case 'buransh': { // rhododendron tree in bloom
      mb.cylinder(T(0, 0, 0), 0.18, 0.12, 1.3, 7, hex('#6a4a3a'), true);
      mb.cylinder(T(0, 0.9, 0, 0.8, 0, 0.6), 0.07, 0.05, 0.6, 5, hex('#6a4a3a'), true);
      for (let i = 0; i < 4; i++) {
        const a = rnd() * 6.28, d = i === 0 ? 0 : 0.45;
        const c = i % 2 ? hex('#d8283a') : hex('#3f6a3a');
        mb.blob(T(Math.cos(a) * d, 1.7 + rnd() * 0.4, Math.sin(a) * d), i === 0 ? 0.85 : 0.6, (p) => (Math.sin(p[0] * 9 + p[2] * 7) > 0.2 ? hex('#e03a4a') : c), Math.floor(rnd() * 1e6), 0.22, 8, 0.85);
      }
      break;
    }
    case 'kamal': { // brahma kamal clump on the ground
      for (let k = 0; k < 3; k++) {
        const ox = (rnd() - 0.5) * 0.6, oz = (rnd() - 0.5) * 0.6, h = 0.2 + rnd() * 0.15;
        mb.cylinder(T(ox, 0, oz), 0.025, 0.02, h, 4, hex('#5a8a3a'), true);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          mb.sphere(T(ox + Math.cos(a) * 0.06, h + 0.05, oz + Math.sin(a) * 0.06, -a, 0, 0.5, [0.5, 1.1, 0.3]), 0.07, 6, i % 2 ? hex('#f6eed2') : hex('#c9a6d8'), true);
        }
      }
      break;
    }
    case 'hut': { // stone hut with a grey slate roof (pahadi kholi)
      const stone = hex('#a89a88'), slate = hex('#6a6e78'), wood = hex('#7a5034');
      mb.roundedBox(T(0, 0.75, 0), [2.4, 1.5, 2.0], 0.06, stone, 2, (p) => mulc(stone, 0.85 + 0.15 * ((Math.floor(p[1] * 4) + Math.floor((p[0] + p[2]) * 3)) % 2)));
      for (const s of [-1, 1]) {
        const a = [-1.45, 1.45, 1.25 * s], b = [1.45, 1.45, 1.25 * s], c = [1.45, 2.4, 0], d = [-1.45, 2.4, 0];
        if (s > 0) mb.quad(a, b, c, d, slate); else mb.quad(b, a, d, c, mulc(slate, 0.85));
      }
      mb.tri([-1.2, 1.5, -1.0], [-1.2, 1.5, 1.0], [-1.2, 2.3, 0], stone);
      mb.tri([1.2, 1.5, 1.0], [1.2, 1.5, -1.0], [1.2, 2.3, 0], stone);
      mb.roundedBox(T(0, 0.55, 1.01), [0.6, 1.1, 0.06], 0.02, wood, 1);
      for (const x of [-0.75, 0.75]) mb.roundedBox(T(x, 0.95, 1.01), [0.38, 0.38, 0.05], 0.02, hex('#3a2a20'), 1);
      break;
    }
    case 'bells': { // temple bells hanging from a wooden beam
      const wood = hex('#6a4430'), brass = hex('#d8a83a');
      for (const x of [-1, 1]) mb.cylinder(T(x * 0.9, 0, 0), 0.07, 0.06, 1.9, 6, wood, true);
      mb.roundedBox(T(0, 1.9, 0), [2.1, 0.12, 0.14], 0.03, wood, 1);
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.38, len = 0.25 + (i % 2) * 0.15;
        mb.cylinder(T(x, 1.84 - len, 0), 0.008, 0.008, len, 4, hex('#3a3a3a'), true);
        mb.lathe(T(x, 1.84 - len - 0.18, 0), [[0.0001, 0.0], [0.09, 0.0], [0.07, 0.07], [0.04, 0.17], [0.0001, 0.18]], 10, brass, false);
      }
      break;
    }
    case 'konark': { // big stone chariot wheel leaning on a plinth
      const stone = hex('#c8885a'), dark = hex('#9a6440');
      mb.roundedBox(T(0, 0.15, 0), [2.6, 0.3, 0.8], 0.05, dark, 1);
      const m = T(0, 1.35, 0, 0, Math.PI / 2, 0);
      mb.torus(m, 1.05, 0.13, 32, 8, stone);
      mb.cylinder(T(0, 1.35, -0.16, 0, Math.PI / 2, 0), 0.22, 0.22, 0.32, 12, stone, false, true);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, thick = i % 2 === 0;
        mb.roundedBox(T(Math.cos(a) * 0.6, 1.35 + Math.sin(a) * 0.6, 0, 0, 0, a + Math.PI / 2), [thick ? 0.12 : 0.06, 0.78, 0.1], 0.02, thick ? stone : dark, 1);
      }
      break;
    }
    case 'deula': { // stone temple tower silhouette (rekha deula style)
      const stone = hex('#c89a6a'), dark = hex('#a8784e');
      mb.roundedBox(T(0, 0.6, 0), [2.2, 1.2, 2.2], 0.05, dark, 2);
      const prof = [];
      for (let i = 0; i <= 12; i++) {
        const y = i / 12;
        prof.push([0.95 * Math.pow(1 - y, 0.55) * (i % 2 ? 0.94 : 1) + 0.05, 1.2 + y * 3.6]);
      }
      prof.push([0.0001, 4.8]);
      mb.lathe(T(0, 0, 0), prof, 8, (v) => (Math.floor(v * 12) % 2 ? stone : dark), false);
      mb.lathe(T(0, 4.72, 0), [[0.0001, 0], [0.38, 0.08], [0.42, 0.18], [0.3, 0.28], [0.0001, 0.3]], 12, stone, false); // amalaka
      mb.cylinder(T(0, 5.0, 0), 0.03, 0.03, 0.5, 4, hex('#5a4a3a'), true);
      mb.tri([0, 5.5, 0], [0, 5.3, 0], [0.3, 5.4, 0], hex('#e86a2a'));
      mb.tri([0, 5.5, 0], [0.3, 5.4, 0], [0, 5.3, 0], hex('#e86a2a'));
      break;
    }
    default:
      mb.sphere(T(0, 0.5, 0), 0.5, 8, [1, 0, 1]);
  }
  return mb.build(r);
}

export const HERO_DECOR = new Set(['deodar', 'buransh', 'kamal', 'hut', 'bells', 'konark', 'deula']);
