// Keyboard + mouse + gamepad + touch input, normalised into a per-frame snapshot.
import { TouchControls } from './touch.js';
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.dragging = false;
    this.locked = false;
    this.canvas = canvas;
    this.padPrev = {};
    this.lastDevice = 'kb';

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.lastDevice = 'kb';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) { this.pressed.add('MouseRight'); e.preventDefault(); return; }
      this.dragging = true;
      if (this.wantLock && !this.locked && !this.touch?.enabled) canvas.requestPointerLock?.();
      e.preventDefault();
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    this.wantLock = false;
    this.touch = new TouchControls(document.getElementById('ui'));
    if (this.touch.enabled) this.lastDevice = 'touch';
  }

  releaseLock() { if (this.locked) document.exitPointerLock?.(); }

  // Build the snapshot consumed by the game this frame.
  poll() {
    const k = this.keys, p = this.pressed;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    let jumpHeld = k.has('Space');
    let jump = p.has('Space');
    let pound = p.has('ShiftLeft') || p.has('ShiftRight') || p.has('KeyC');
    let dash = p.has('KeyF') || p.has('MouseRight');
    let pause = p.has('Escape') || p.has('KeyP');
    let confirm = p.has('Enter') || p.has('Space');
    let camX = 0, camY = 0;
    if (k.has('KeyQ')) camX -= 1;
    if (k.has('KeyE')) camX += 1;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
      const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
      if (lx || ly || rx || ry) this.lastDevice = 'pad';
      mx += lx; mz -= ly;
      camX += rx * 1.4; camY += ry * 1.0;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const edge = (i) => b(i) && !this.padPrev[i];
      if (b(0)) jumpHeld = true;
      if (edge(0)) { jump = true; confirm = true; this.lastDevice = 'pad'; }
      if (edge(2) || edge(6) || edge(7)) pound = true;
      if (edge(1) || edge(5)) dash = true;
      if (edge(9)) pause = true;
      for (let i = 0; i < gp.buttons.length; i++) this.padPrev[i] = b(i);
      break;
    }
    if (this.touch.enabled) {
      const t = this.touch.take();
      mx += t.mx; mz += t.mz;
      if (t.jumpHeld) jumpHeld = true;
      if (t.jump) jump = true;
      if (t.pound) pound = true;
      if (t.dash) dash = true;
      if (t.pause) pause = true;
      this.mouseDX += t.camDX; this.mouseDY += t.camDY;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const snap = {
      mx, mz, jump, jumpHeld, pound, dash, pause, confirm,
      camX, camY,
      mouseDX: this.mouseDX, mouseDY: this.mouseDY, wheel: this.wheel,
    };
    this.pressed.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    return snap;
  }
}
