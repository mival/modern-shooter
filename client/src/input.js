// Keyboard and mouse input.
import { BTN_FIRE, BTN_JUMP, WEAPONS } from '../../shared/constants.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.sens = 1.5;
    this.fire = false;
    this.weaponRequest = -1;
    this.wheel = 0;
    this.typing = false;
    this.onKey = () => {};

    document.addEventListener('keydown', (e) => {
      if (this.typing || e.target.tagName === 'INPUT') return;
      if (this.locked() || e.code === 'Tab' || e.code === 'F3' || e.code === 'F1' || e.code === 'F2') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m && Number(m[1]) <= WEAPONS.length) this.weaponRequest = Number(m[1]) - 1;
      this.onKey(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked()) return;
      // Some browsers send one very large movement after the pointer lock starts. Ignore it.
      if (Math.abs(e.movementX) > 2000 || Math.abs(e.movementY) > 2000) return;
      const k = this.sens * 0.001;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * k));
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked()) { this.lock(); return; }
      if (e.button === 0) this.fire = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; });
    canvas.addEventListener('wheel', (e) => { if (this.locked()) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { if (!this.locked()) { this.fire = false; this.keys.clear(); } });
  }

  locked() { return document.pointerLockElement === this.canvas; }

  // Asks for raw mouse data. Then the pointer acceleration of the operating system does not change the aim.
  // If the browser does not support raw data, the function asks for the normal pointer lock.
  lock() {
    let r;
    try { r = this.canvas.requestPointerLock({ unadjustedMovement: true }); } catch { r = null; }
    if (r && r.catch) {
      r.catch(() => {
        const n = this.canvas.requestPointerLock();
        if (n && n.catch) n.catch(() => {});
      });
    }
  }

  down(code) { return this.keys.has(code); }

  // Makes the input command for one tick.
  sample(seq) {
    const k = (a, b) => (this.down(a) || this.down(b) ? 1 : 0);
    const cmd = {
      seq,
      fwd: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      side: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      buttons: (this.fire || this.down('ControlLeft') ? BTN_FIRE : 0) | (this.down('Space') ? BTN_JUMP : 0),
      yaw: this.yaw % (Math.PI * 2), pitch: this.pitch,
      weapon: this.weaponRequest,
    };
    this.weaponRequest = -1;
    return cmd;
  }
}
