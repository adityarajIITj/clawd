// DOM overlay: menus, HUD, toasts. Keyboard/gamepad navigable.
const $ = (s, el = document) => el.querySelector(s);

const STAR_SVG = (size = 22, fill = 'currentColor') => {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? (i % 4 === 0 ? 50 : 38) : 12;
    pts.push(`${50 + Math.cos(a) * r},${50 + Math.sin(a) * r}`);
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><polygon points="${pts.join(' ')}" fill="${fill}" stroke-linejoin="round" stroke="${fill}" stroke-width="6"/></svg>`;
};
export const starIcon = STAR_SVG;
const LIZARD_SVG = (size = 22, fill = '#4cc26a') => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><g fill="${fill}"><ellipse cx="50" cy="52" rx="13" ry="22"/><ellipse cx="50" cy="24" rx="10" ry="12"/><path d="M50 70 Q44 86 56 92 Q70 98 74 86 Q66 92 60 86 Q56 80 57 70Z"/><path d="M38 40 L22 30 L20 36 L36 46Z M62 40 L78 30 L80 36 L64 46Z M38 62 L22 74 L26 78 L40 68Z M62 62 L78 74 L74 78 L60 68Z"/></g><circle cx="45" cy="20" r="2.6" fill="#10200f"/><circle cx="55" cy="20" r="2.6" fill="#10200f"/></svg>`;
let iconMode = 'clawd';


const HEART = (on) => `<svg class="heart ${on ? 'on' : 'off'}" width="30" height="28" viewBox="0 0 32 30"><path d="M16 28 C 4 19, 1 12, 4 7 C 7 2, 13 2, 16 7 C 19 2, 25 2, 28 7 C 31 12, 28 19, 16 28 Z"/></svg>`;
const COIN = (on) => `<span class="coin ${on ? 'on' : ''} ${iconMode}">${iconMode === 'manus' ? LIZARD_SVG(16, on ? '#4a3c2a' : 'rgba(255,255,255,0.4)') : STAR_SVG(14, on ? '#7a4a10' : 'rgba(255,255,255,0.35)')}</span>`;

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export class UI {
  constructor(game) {
    this.g = game;
    this.root = $('#ui');
    this.screen = $('#screen');
    this.hud = $('#hud');
    this.toast = $('#toast');
    this.banner = $('#banner');
    this.focusIdx = 0;
    this.current = null;
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.hudState = {};
  }

  // ---------------------------------------------------------------------------
  // screen management
  // ---------------------------------------------------------------------------
  show(name, html, cls = '') {
    this.current = name;
    this.clearHint();
    this.screen.className = `screen show ${cls}`;
    this.screen.innerHTML = html;
    this.focusIdx = 0;
    const btns = this.buttons();
    btns.forEach((b, i) => {
      b.addEventListener('mouseenter', () => { this.focus(i); this.g.audio.play('hover', { vol: 0.4 }); });
      b.addEventListener('click', () => {
        if (b.classList.contains('locked')) { this.g.audio.play('hurt', { vol: 0.3 }); return; }
        this.g.audio.resume();
        this.g.audio.play('click', { vol: 0.6 });
        const act = b.dataset.act;
        if (act) this.g.action(act, b.dataset);
      });
    });
    this.screen.querySelectorAll('input[type=range]').forEach((el) => el.addEventListener('input', () => this.g.action('setting', { key: el.dataset.key, value: el.value })));
    this.screen.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', () => this.g.action('setting', { key: el.dataset.key, value: el.type === 'checkbox' ? el.checked : el.value })));
    if (btns.length) this.focus(0, true);
  }

  hide() {
    this.current = null;
    this.screen.className = 'screen';
    this.screen.innerHTML = '';
  }

  buttons() { return [...this.screen.querySelectorAll('[data-act]')]; }

  focus(i, silent) {
    const b = this.buttons();
    if (!b.length) return;
    this.focusIdx = (i + b.length) % b.length;
    b.forEach((x, k) => x.classList.toggle('focus', k === this.focusIdx));
    void silent;
  }

  navigate(inp, keys) {
    if (!this.current) return;
    const b = this.buttons();
    if (!b.length) return;
    const grid = this.screen.querySelector('.cards');
    const horiz = !!grid;
    let delta = 0;
    if (keys.has('ArrowDown') || keys.has('KeyS')) delta = horiz ? 0 : 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) delta = horiz ? 0 : -1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) delta = 1;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) delta = -1;
    if (keys.has('ArrowDown') && horiz) delta = 1;
    if (keys.has('ArrowUp') && horiz) delta = -1;
    if (inp.navY) delta = inp.navY;
    if (delta) { this.focus(this.focusIdx + delta); this.g.audio.play('hover', { vol: 0.4 }); }
    if (keys.has('Enter') || keys.has('Space') || inp.padConfirm) b[this.focusIdx]?.click();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  showHUD(on) { this.hud.classList.toggle('show', on); }

  touchText(text) {
    if (!this.g.input.touch.enabled) return text;
    return text
      .replace(/Move with <b>WASD<\/b> or the left stick · Drag the mouse to look around/, 'Drag on the <b>left</b> side to move · Drag on the <b>right</b> side to look around')
      .replace(/Press <b>SPACE<\/b> again in mid-air/g, 'Tap <b>Jump</b> again in mid-air')
      .replace(/Press <b>SPACE<\/b> to jump — hold it longer/g, 'Tap <b>Jump</b> to jump — hold it longer')
      .replace(/<b>SPACE<\/b>/g, '<b>Jump</b>')
      .replace(/Press <b>SHIFT<\/b> in mid-air/g, 'Tap <b>Pound</b> in mid-air')
      .replace(/Press <b>F<\/b> to <b>dash<\/b>/g, 'Tap <b>Dash</b> to dash')
      .replace(/\(SHIFT\)/g, '(Pound)');
  }

  updateHUD(s) {
    const h = this.hudState;
    if (h.hearts !== s.hearts) {
      $('#hearts').innerHTML = [0, 1, 2].map((i) => HEART(i < s.hearts)).join('');
      if (h.hearts !== undefined && s.hearts < h.hearts) this.pulse('#hearts');
      h.hearts = s.hearts;
    }
    if (h.sparks !== s.sparks || h.total !== s.total) {
      $('#sparkCount').innerHTML = `<b>${s.sparks}</b><span>/ ${s.total}</span>`;
      if (h.sparks !== undefined) this.pulse('#sparks');
      h.sparks = s.sparks; h.total = s.total;
    }
    const tk = s.tokens.join(',');
    if (h.tokens !== tk) {
      $('#tokens').innerHTML = s.tokens.map(COIN).join('');
      if (h.tokens !== undefined) this.pulse('#tokens');
      h.tokens = tk;
    }
    $('#timer').textContent = fmtTime(s.time);
    if (s.fps !== undefined) $('#fps').textContent = s.fps ? `${s.fps} fps` : '';
  }

  resetHUD() { this.hudState = {}; }

  setCollectibleIcons(mode) {
    iconMode = mode;
    const el = $('#sparkIcon');
    if (el) el.innerHTML = mode === 'manus' ? LIZARD_SVG(24) : STAR_SVG(22, '#ffb37a');
    this.hudState = {};
  }

  pulse(sel) {
    const el = $(sel);
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  hint(text) {
    this.toast.innerHTML = this.touchText(text);
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('show'), 5200);
  }

  clearHint() { this.toast.classList.remove('show'); }

  showBanner(title, sub, ms = 3200) {
    this.banner.innerHTML = `<div class="b-kicker">${sub}</div><div class="b-title">${title}</div>`;
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  popup(text, cls = '') {
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.innerHTML = text;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  setLoading(p, label) {
    const bar = $('#loadbar i');
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    if (label) $('#loadlabel').textContent = label;
  }

  hideLoading() {
    const l = $('#loading');
    l.classList.add('done');
    setTimeout(() => l.remove(), 900);
  }
}
