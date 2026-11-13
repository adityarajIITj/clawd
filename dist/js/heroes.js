// The four heroes. Everything hero-specific (names, collectibles, colours, art) lives here.

const star = (size, fill) => {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? (i % 4 === 0 ? 50 : 38) : 12;
    pts.push(`${50 + Math.cos(a) * r},${50 + Math.sin(a) * r}`);
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><polygon points="${pts.join(' ')}" fill="${fill}" stroke-linejoin="round" stroke="${fill}" stroke-width="6"/></svg>`;
};
const lizard = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><g fill="${fill}"><ellipse cx="50" cy="52" rx="13" ry="22"/><ellipse cx="50" cy="24" rx="10" ry="12"/><path d="M50 70 Q44 86 56 92 Q70 98 74 86 Q66 92 60 86 Q56 80 57 70Z"/><path d="M38 40 L22 30 L20 36 L36 46Z M62 40 L78 30 L80 36 L64 46Z M38 62 L22 74 L26 78 L40 68Z M62 62 L78 74 L74 78 L60 68Z"/></g><circle cx="45" cy="20" r="2.6" fill="#10200f"/><circle cx="55" cy="20" r="2.6" fill="#10200f"/></svg>`;
const kamal = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><g fill="${fill}">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<ellipse cx="50" cy="30" rx="10" ry="24" transform="rotate(${i * 51.4} 50 56)"/>`).join('')}</g><circle cx="50" cy="56" r="9" fill="#f2d66a"/></svg>`;
const bird = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><g fill="${fill}"><ellipse cx="46" cy="58" rx="26" ry="18"/><circle cx="70" cy="34" r="13"/><path d="M22 58 L2 70 L6 54 L0 44 L22 50Z"/><path d="M80 32 L94 36 L80 40Z"/><path d="M68 20 L64 6 M72 20 L74 6 M76 22 L82 10" stroke="${fill}" stroke-width="4"/></g></svg>`;
const sweet = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><path d="M10 64 Q50 96 90 64 Z" fill="#5a8a3a"/><circle cx="50" cy="48" r="28" fill="${fill}"/><ellipse cx="40" cy="38" rx="8" ry="5" fill="rgba(255,255,255,.7)"/></svg>`;
const wheel = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><g fill="none" stroke="${fill}"><circle cx="50" cy="50" r="40" stroke-width="10"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<line x1="50" y1="50" x2="${50 + Math.cos(i * Math.PI / 4) * 38}" y2="${50 + Math.sin(i * Math.PI / 4) * 38}" stroke-width="${i % 2 ? 4 : 7}"/>`).join('')}</g><circle cx="50" cy="50" r="10" fill="${fill}"/></svg>`;

export const HEROES = {
  clawd: {
    id: 'clawd', name: 'Clawd', from: 'The Workshop', home: 'clawd', color: '#d97757',
    blurb: 'A small, helpful terracotta critter with a spark on his head.',
    words: { spark: 'Spark', sparks: 'Sparks', token: 'Golden Token', tokens: 'Tokens' },
    spark: { mesh: 'spark', scale: 0.9, y: 0, spin: 2.2, emis: 0.75, burst: [2.4, 1.2, 0.5], ring: [2.0, 1.4, 0.7] },
    token: { mesh: 'token', scale: 1.25, y: 0, spin: 2.5, emis: [0.35, 0.3, 0.12], spec: 0.8, halo: [2.0, 1.5, 0.5] },
    dash: [2.2, 1.3, 0.7],
    icons: { spark: (s) => star(s, '#ffb37a'), token: (s, on) => star(s * 0.9, on ? '#7a4a10' : 'rgba(255,255,255,0.35)') },
    coin: 'gold',
  },
  manus: {
    id: 'manus', name: 'Marathi Manus', from: 'Maharashtra', home: 'manus', color: '#4cc26a',
    blurb: 'Man bun, neckband, phone always out. Fixes his bun, then takes a selfie.',
    words: { spark: 'Lizard', sparks: 'Lizards', token: 'Komodo Dragon', tokens: 'Komodo dragons' },
    spark: { mesh: 'lizard', scale: 0.8, y: -0.15, spin: 1.3, emis: 0.12, burst: [0.6, 2.2, 0.8], ring: [0.9, 2.0, 1.0] },
    token: { mesh: 'komodo', scale: 1.0, y: -0.3, spin: 1.2, emis: [0.05, 0.05, 0.04], spec: 0.3, halo: [1.0, 1.6, 0.8] },
    dash: [1.2, 2.0, 1.2],
    icons: { spark: (s) => lizard(s * 1.1, '#4cc26a'), token: (s, on) => lizard(s * 1.15, on ? '#4a3c2a' : 'rgba(255,255,255,0.4)') },
    coin: 'komodo',
  },
  mahak: {
    id: 'mahak', name: 'Mahak', from: 'Uttarakhand', home: 'pahadi', color: '#c84a6a',
    blurb: 'A mountain girl with a long braid and a nose ring. Shades her eyes to look across the valleys.',
    words: { spark: 'Brahma Kamal', sparks: 'Brahma Kamals', token: 'Monal', tokens: 'Monals' },
    spark: { mesh: 'kamal', scale: 1.0, y: -0.15, spin: 1.0, emis: 0.3, burst: [2.2, 1.9, 2.4], ring: [1.6, 1.3, 2.2] },
    token: { mesh: 'monal', scale: 1.15, y: -0.25, spin: 1.4, emis: [0.1, 0.14, 0.2], spec: 0.8, halo: [0.6, 1.2, 2.0] },
    dash: [2.0, 1.0, 1.6],
    icons: { spark: (s) => kamal(s * 1.05, '#e8d8f0'), token: (s, on) => bird(s * 1.15, on ? '#1f3a8a' : 'rgba(255,255,255,0.4)') },
    coin: 'monal',
  },
  lingraj: {
    id: 'lingraj', name: 'Lingraj', from: 'Odisha', home: 'odisha', color: '#e0a050',
    blurb: 'Kurta with an ikat border, dhoti and a checked gamucha. Greets everyone with a namaskar.',
    words: { spark: 'Rasagola', sparks: 'Rasagolas', token: 'Konark Wheel', tokens: 'Konark Wheels' },
    spark: { mesh: 'rasagola', scale: 1.0, y: -0.1, spin: 0.8, emis: 0.22, burst: [2.4, 2.2, 1.6], ring: [2.2, 1.8, 1.0] },
    token: { mesh: 'konark', scale: 1.2, y: 0, spin: 1.5, emis: [0.3, 0.22, 0.1], spec: 0.8, halo: [2.2, 1.5, 0.6] },
    dash: [2.4, 1.6, 0.6],
    icons: { spark: (s) => sweet(s * 1.05, '#f6efe0'), token: (s, on) => wheel(s, on ? '#7a4a10' : 'rgba(255,255,255,0.4)') },
    coin: 'gold',
  },
};

export const HERO_ORDER = ['clawd', 'manus', 'mahak', 'lingraj'];

// Map sets (campaigns): display name, and which hero calls it home.
export const SETS = {
  clawd: { name: 'The Spark Realms' },
  manus: { name: 'Maharashtra Tales' },
  pahadi: { name: 'Himalayan Trails' },
  odisha: { name: 'Odisha Shores' },
  bonus: { name: 'Bonus' },
};

// ---------------------------------------------------------------------------
// Hero portraits for the hero-select cards (inline SVG)
// ---------------------------------------------------------------------------
export const HERO_ART = {
  clawd: `<svg viewBox="0 0 200 150" class="char-svg"><ellipse cx="100" cy="132" rx="60" ry="8" fill="rgba(0,0,0,.18)"/>
  <rect x="48" y="40" width="104" height="78" rx="22" fill="#d97757" stroke="#3a1f16" stroke-width="4"/>
  <rect x="36" y="70" width="18" height="24" rx="7" fill="#d97757" stroke="#3a1f16" stroke-width="4"/><rect x="146" y="70" width="18" height="24" rx="7" fill="#d97757" stroke="#3a1f16" stroke-width="4"/>
  <rect x="78" y="62" width="11" height="24" rx="5" fill="#1f1a17"/><rect x="111" y="62" width="11" height="24" rx="5" fill="#1f1a17"/>
  <ellipse cx="68" cy="94" rx="7" ry="4" fill="#f2a08a"/><ellipse cx="132" cy="94" rx="7" ry="4" fill="#f2a08a"/>
  <rect x="64" y="116" width="16" height="16" rx="5" fill="#b85c3f"/><rect x="120" y="116" width="16" height="16" rx="5" fill="#b85c3f"/>
  <line x1="100" y1="40" x2="100" y2="24" stroke="#b85c3f" stroke-width="4"/><polygon points="100,8 104,19 115,20 106,26 109,37 100,30 91,37 94,26 85,20 96,19" fill="#ffb37a"/></svg>`,
  manus: `<svg viewBox="0 0 200 150" class="char-svg"><ellipse cx="100" cy="146" rx="58" ry="6" fill="rgba(0,0,0,.18)"/>
  <path d="M52 150 Q54 110 100 104 Q146 110 148 150Z" fill="#e6e3dc" stroke="#2a2220" stroke-width="3"/>
  <circle cx="112" cy="130" r="8" fill="#d8484a"/><circle cx="112" cy="130" r="5" fill="#e6e3dc"/>
  <path d="M72 108 Q100 124 128 108" fill="none" stroke="#222226" stroke-width="5"/>
  <ellipse cx="100" cy="66" rx="34" ry="38" fill="#94664c" stroke="#2a2220" stroke-width="3"/>
  <path d="M65 62 Q62 26 100 26 Q138 26 135 62 Q128 40 100 38 Q72 40 65 62Z" fill="#17110f"/>
  <circle cx="100" cy="18" r="11" fill="#17110f"/><rect x="94" y="25" width="12" height="5" rx="2" fill="#3a3236"/>
  <ellipse cx="87" cy="64" rx="4" ry="5" fill="#120c0a"/><ellipse cx="113" cy="64" rx="4" ry="5" fill="#120c0a"/>
  <path d="M80 54 L93 52 M107 52 L120 54" stroke="#17110f" stroke-width="3" stroke-linecap="round"/>
  <path d="M90 86 Q100 82 110 86" stroke="#241814" stroke-width="4" fill="none" stroke-linecap="round"/>
  <ellipse cx="100" cy="93" rx="6" ry="5" fill="#e0707a"/>
  <rect x="150" y="62" width="20" height="36" rx="4" fill="#16161a" transform="rotate(12 160 80)"/></svg>`,
  mahak: `<svg viewBox="0 0 200 150" class="char-svg"><ellipse cx="100" cy="146" rx="58" ry="6" fill="rgba(0,0,0,.18)"/>
  <path d="M128 70 Q146 100 138 142" stroke="#1a1210" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M134 136 L146 150 L128 150Z" fill="#d8283a"/>
  <path d="M52 150 Q54 110 100 104 Q146 110 148 150Z" fill="#8e2f3a" stroke="#2a2220" stroke-width="3"/>
  <path d="M60 128 L140 128" stroke="#e0a63a" stroke-width="7" stroke-dasharray="7 4"/>
  <path d="M74 108 Q100 120 126 108" fill="none" stroke="#e0a63a" stroke-width="6"/>
  <ellipse cx="100" cy="66" rx="33" ry="37" fill="#c48a66" stroke="#2a2220" stroke-width="3"/>
  <path d="M66 64 Q60 24 100 26 Q140 24 134 64 Q130 40 100 36 Q70 40 66 64Z" fill="#1a1210"/>
  <line x1="100" y1="27" x2="100" y2="38" stroke="#a8704e" stroke-width="2"/>
  <circle cx="100" cy="48" r="3" fill="#c8202e"/>
  <ellipse cx="87" cy="62" rx="4" ry="5.5" fill="#140d0a"/><ellipse cx="113" cy="62" rx="4" ry="5.5" fill="#140d0a"/>
  <ellipse cx="80" cy="78" rx="7" ry="4" fill="#e8857a" opacity=".6"/><ellipse cx="120" cy="78" rx="7" ry="4" fill="#e8857a" opacity=".6"/>
  <circle cx="106" cy="77" r="6" fill="none" stroke="#e8b84a" stroke-width="2.5"/>
  <path d="M91 88 Q100 94 109 88" stroke="#7a2a2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <circle cx="66" cy="76" r="3.5" fill="#e8b84a"/><circle cx="134" cy="76" r="3.5" fill="#e8b84a"/></svg>`,
  lingraj: `<svg viewBox="0 0 200 150" class="char-svg"><ellipse cx="100" cy="146" rx="58" ry="6" fill="rgba(0,0,0,.18)"/>
  <path d="M52 150 Q54 110 100 104 Q146 110 148 150Z" fill="#efe6d2" stroke="#2a2220" stroke-width="3"/>
  <path d="M60 140 L140 140" stroke="#b8323a" stroke-width="8"/><path d="M62 140 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5" stroke="#2a1e22" stroke-width="2" fill="none"/>
  <rect x="64" y="104" width="22" height="46" fill="#c8283a" transform="rotate(-8 75 120)"/>
  <path d="M64 112 h22 M64 122 h22 M64 132 h22 M70 104 v46 M78 104 v46" stroke="#f2ece0" stroke-width="3" transform="rotate(-8 75 120)"/>
  <ellipse cx="100" cy="66" rx="34" ry="38" fill="#8a5a3e" stroke="#2a2220" stroke-width="3"/>
  <path d="M66 58 Q64 24 104 26 Q138 28 134 58 Q126 40 108 38 Q84 38 66 58Z" fill="#141010"/>
  <ellipse cx="87" cy="64" rx="4" ry="5" fill="#140d0a"/><ellipse cx="113" cy="64" rx="4" ry="5" fill="#140d0a"/>
  <path d="M80 54 L93 52 M107 52 L120 54" stroke="#141010" stroke-width="3" stroke-linecap="round"/>
  <rect x="88" y="82" width="24" height="5" rx="2.5" fill="#1e1612"/>
  <path d="M92 92 Q100 97 108 92" stroke="#5a1a1e" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`,
};
