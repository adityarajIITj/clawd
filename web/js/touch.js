// On-screen touch controls: floating joystick (left), camera drag (right),
// jump / ground-pound / pause buttons. Multi-touch via pointer events.
export const isTouchDevice = () =>
  (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export class TouchControls {
  constructor(root) {
    this.enabled = isTouchDevice();
    this.mx = 0; this.mz = 0;
    this.camDX = 0; this.camDY = 0;
    this.jumpHeld = false;
    this.jumpPressed = false;
    this.poundPressed = false;
    this.pausePressed = false;
    this.stick = null;   // { id, ox, oy }
    this.cam = null;     // { id, x, y }
    if (!this.enabled) return;

    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="t-zone t-left"></div>
      <div class="t-zone t-right"></div>
      <div class="t-stick"><div class="t-knob"></div></div>
      <button class="t-btn t-jump" aria-label="Jump">
        <svg viewBox="0 0 24 24"><path d="M12 4 L20 14 H15 V20 H9 V14 H4 Z"/></svg></button>
      <button class="t-btn t-pound" aria-label="Ground pound">
        <svg viewBox="0 0 24 24"><path d="M12 20 L4 10 H9 V4 H15 V10 H20 Z"/></svg></button>
      <button class="t-btn t-pause" aria-label="Pause">
        <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></button>`;
    root.insertBefore(el, root.querySelector('#screen'));
    this.el = el;
    this.stickEl = el.querySelector('.t-stick');
    this.knob = el.querySelector('.t-knob');

    const left = el.querySelector('.t-left'), right = el.querySelector('.t-right');
    left.addEventListener('pointerdown', (e) => this.stickStart(e));
    right.addEventListener('pointerdown', (e) => this.camStart(e));
    addEventListener('pointermove', (e) => this.move(e), { passive: false });
    addEventListener('pointerup', (e) => this.end(e));
    addEventListener('pointercancel', (e) => this.end(e));

    const bindBtn = (sel, down, up) => {
      const b = el.querySelector(sel);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); down(); navigator.vibrate?.(8); });
      const rel = () => { b.classList.remove('on'); up && up(); };
      b.addEventListener('pointerup', rel);
      b.addEventListener('pointercancel', rel);
      b.addEventListener('pointerleave', rel);
    };
    bindBtn('.t-jump', () => { this.jumpHeld = true; this.jumpPressed = true; }, () => { this.jumpHeld = false; });
    bindBtn('.t-pound', () => { this.poundPressed = true; });
    bindBtn('.t-pause', () => { this.pausePressed = true; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(on) {
    if (!this.el) return;
    this.el.classList.toggle('show', on);
    if (!on) this.reset();
  }

  reset() {
    this.stick = this.cam = null;
    this.mx = this.mz = 0;
    this.jumpHeld = false;
    if (this.stickEl) this.stickEl.classList.remove('active');
  }

  stickStart(e) {
    if (this.stick) return;
    e.preventDefault();
    this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    this.stickEl.style.left = `${e.clientX}px`;
    this.stickEl.style.top = `${e.clientY}px`;
    this.stickEl.classList.add('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  camStart(e) {
    if (this.cam) return;
    e.preventDefault();
    this.cam = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  move(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      e.preventDefault();
      const R = 56;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // drag the base along so the stick never "runs out"
        const k = (d - R) / d;
        this.stick.ox += dx * k; this.stick.oy += dy * k;
        dx = e.clientX - this.stick.ox; dy = e.clientY - this.stick.oy;
        this.stickEl.style.left = `${this.stick.ox}px`;
        this.stickEl.style.top = `${this.stick.oy}px`;
      }
      const m = Math.min(1, Math.hypot(dx, dy) / R);
      const dead = 0.12;
      const s = m < dead ? 0 : (m - dead) / (1 - dead);
      const a = Math.atan2(dy, dx);
      this.mx = Math.cos(a) * s;
      this.mz = -Math.sin(a) * s;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (this.cam && e.pointerId === this.cam.id) {
      e.preventDefault();
      this.camDX += (e.clientX - this.cam.x) * 1.6;
      this.camDY += (e.clientY - this.cam.y) * 1.6;
      this.cam.x = e.clientX; this.cam.y = e.clientY;
    }
  }

  end(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null;
      this.mx = this.mz = 0;
      this.stickEl.classList.remove('active');
      this.stickEl.style.left = this.stickEl.style.top = '';
      this.knob.style.transform = 'translate(-50%, -50%)';
    }
    if (this.cam && e.pointerId === this.cam.id) this.cam = null;
  }

  // consume one-shot values for this frame
  take() {
    const out = {
      mx: this.mx, mz: this.mz, jumpHeld: this.jumpHeld, jump: this.jumpPressed,
      pound: this.poundPressed, pause: this.pausePressed, camDX: this.camDX, camDY: this.camDY,
    };
    this.jumpPressed = this.poundPressed = this.pausePressed = false;
    this.camDX = this.camDY = 0;
    return out;
  }
}
