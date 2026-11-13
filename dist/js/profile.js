// Gamer tag: made up on first visit, remembered by this browser, editable any time.
// No login. The id stays the same if the tag is renamed (used later by multiplayer).
const KEY = 'clawd.profile';
const ADJ = ['Spicy', 'Chill', 'Turbo', 'Sleepy', 'Mighty', 'Sneaky', 'Jolly', 'Cosmic', 'Masala', 'Pahadi', 'Coastal', 'Filmy',
  'Zippy', 'Brave', 'Sunny', 'Misty', 'Cheeky', 'Rapid', 'Lucky', 'Dizzy'];
const NOUN = ['VadaPav', 'Monal', 'Rasagola', 'Lizard', 'Chaiwala', 'Kandil', 'Dosa', 'Tiger', 'Spark', 'Komodo', 'Samosa', 'Mango',
  'Jalebi', 'Peacock', 'Rickshaw', 'Coconut', 'Laddoo', 'Yak', 'Dolphin', 'Panda'];
export const TAG_RULE = /^[A-Za-z0-9_]{3,16}$/;

export function randomTag() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let t = pick(ADJ) + pick(NOUN);
  if (t.length > 14) t = t.slice(0, 14);
  return t + Math.floor(10 + Math.random() * 90);
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function loadProfile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { p = null; }
  if (!p || !p.id || !TAG_RULE.test(p.tag || '')) {
    p = { id: (p && p.id) || uid(), tag: randomTag(), created: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(p));
  }
  return p;
}

export function saveTag(profile, tag) {
  const t = String(tag || '').trim();
  if (!TAG_RULE.test(t)) return { ok: false, error: '3–16 letters, numbers or _' };
  profile.tag = t;
  localStorage.setItem(KEY, JSON.stringify(profile));
  return { ok: true };
}
