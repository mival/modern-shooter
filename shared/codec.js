// Binary format for the two messages that the game sends most: snapshots and input commands.
// All other messages are JSON text. The offline mode does not use this file.
// Multi-byte numbers are little-endian.

// The client and the server must use the same version. Change it when the format changes.
export const PROTOCOL = 2;

const MSG_SNAPSHOT = 1;
const MSG_CMDS = 2;
const STATES = ['play', 'intermission'];
const LE = true;
const text = new TextEncoder();
const textIn = new TextDecoder();

// One buffer for all encode calls. Each call returns a copy of the used part.
const buf = new ArrayBuffer(65536);
const view = new DataView(buf);
const bytes = new Uint8Array(buf);

// Changes a snapshot object into bytes. See Game.sharedSnapshot and Game.ownState for the fields.
export function encodeSnapshot(s) {
  let o = 0;
  const u8 = (v) => { view.setUint8(o, v); o += 1; };
  const u16 = (v) => { view.setUint16(o, v, LE); o += 2; };
  const i16 = (v) => { view.setInt16(o, v, LE); o += 2; };
  const u32 = (v) => { view.setUint32(o, v >>> 0, LE); o += 4; };
  const f64 = (v) => { view.setFloat64(o, v, LE); o += 8; };

  u8(MSG_SNAPSHOT);
  f64(s.time);
  u8(Math.max(0, STATES.indexOf(s.st)));
  view.setInt32(o, s.tl, LE); o += 4;
  u32(s.ack);

  // The local player. The prediction needs the exact values.
  const me = s.me;
  f64(me.x); f64(me.y); f64(me.z); f64(me.vx); f64(me.vy); f64(me.vz); f64(me.syaw);
  u8((me.ground ? 1 : 0) | (me.jumpHeld ? 2 : 0) | (me.dead ? 4 : 0) | (me.prot ? 8 : 0));
  u8(me.jumps); i16(me.health); i16(me.armor); u8(me.weapon); u16(me.weapons); u8(me.amp); u32(me.sc);
  u8(me.ammo.length);
  for (const a of me.ammo) u16(a);

  // All players: positions with 0.1 unit, angles with 0.001 radian.
  u8(s.p.length);
  for (const p of s.p) {
    u16(p[0]); i16(Math.round(p[1] * 10)); i16(Math.round(p[2] * 10)); i16(Math.round(p[3] * 10));
    i16(Math.round(p[4] * 1000)); i16(Math.round(p[5] * 1000)); u8(p[6]); u8(p[7]);
  }

  const pr = s.pr.length > 255 ? s.pr.slice(0, 255) : s.pr;
  u8(pr.length);
  for (const q of pr) {
    u32(q[0]); u8(q[1]);
    for (let i = 2; i < 8; i++) i16(Math.round(q[i] * 10));
  }

  // One bit for each item: 1 if the item is available.
  u8(s.it.length);
  for (let i = 0; i < s.it.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8 && i + k < s.it.length; k++) if (s.it[i + k] === '1') b |= 1 << k;
    u8(b);
  }

  // The events are few and have many forms. They stay JSON text.
  let ev = s.ev.length ? text.encode(JSON.stringify(s.ev)) : null;
  if (ev && ev.length > buf.byteLength - o - 2) ev = null;
  u16(ev ? ev.length : 0);
  if (ev) { bytes.set(ev, o); o += ev.length; }
  return bytes.slice(0, o);
}

// Changes the bytes of a snapshot into the object that the client uses.
export function decodeSnapshot(data) {
  const v = data instanceof DataView ? data : new DataView(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
  let o = 0;
  const u8 = () => { const x = v.getUint8(o); o += 1; return x; };
  const u16 = () => { const x = v.getUint16(o, LE); o += 2; return x; };
  const i16 = () => { const x = v.getInt16(o, LE); o += 2; return x; };
  const u32 = () => { const x = v.getUint32(o, LE); o += 4; return x; };
  const f64 = () => { const x = v.getFloat64(o, LE); o += 8; return x; };

  if (u8() !== MSG_SNAPSHOT) return null;
  const s = { t: 's', time: f64(), st: STATES[u8()] || 'play' };
  s.tl = v.getInt32(o, LE); o += 4;
  s.ack = u32();

  const me = { x: f64(), y: f64(), z: f64(), vx: f64(), vy: f64(), vz: f64(), syaw: f64() };
  const flags = u8();
  me.ground = (flags & 1) !== 0; me.jumpHeld = (flags & 2) !== 0; me.dead = (flags & 4) !== 0; me.prot = (flags & 8) !== 0;
  me.jumps = u8(); me.health = i16(); me.armor = i16(); me.weapon = u8(); me.weapons = u16(); me.amp = u8(); me.sc = u32();
  me.ammo = [];
  for (let n = u8(); n > 0; n--) me.ammo.push(u16());
  s.me = me;

  s.p = [];
  for (let n = u8(); n > 0; n--) s.p.push([u16(), i16() / 10, i16() / 10, i16() / 10, i16() / 1000, i16() / 1000, u8(), u8()]);
  s.pr = [];
  for (let n = u8(); n > 0; n--) s.pr.push([u32(), u8(), i16() / 10, i16() / 10, i16() / 10, i16() / 10, i16() / 10, i16() / 10]);

  const items = u8();
  let it = '';
  for (let i = 0; i < items; i += 8) {
    const b = u8();
    for (let k = 0; k < 8 && i + k < items; k++) it += b & (1 << k) ? '1' : '0';
  }
  s.it = it;

  const len = u16();
  s.ev = len ? JSON.parse(textIn.decode(new Uint8Array(v.buffer, v.byteOffset + o, len))) : [];
  return s;
}

const CMD_SIZE = 24;

// Changes a list of input commands into bytes.
// Each command is an array: [seq, fwd, side, buttons, yaw, pitch, weapon, viewTime].
// The angles are 32-bit numbers. The client must use Math.fround on them before the prediction.
export function encodeCmds(list) {
  const n = Math.min(list.length, 8);
  const out = new DataView(new ArrayBuffer(2 + n * CMD_SIZE));
  out.setUint8(0, MSG_CMDS);
  out.setUint8(1, n);
  for (let i = 0, o = 2; i < n; i++, o += CMD_SIZE) {
    const c = list[i];
    out.setUint32(o, c[0] >>> 0, LE);
    out.setInt8(o + 4, Math.round(c[1] * 100));
    out.setInt8(o + 5, Math.round(c[2] * 100));
    out.setUint8(o + 6, c[3]);
    out.setInt8(o + 7, c[6]);
    out.setFloat32(o + 8, c[4], LE);
    out.setFloat32(o + 12, c[5], LE);
    out.setFloat64(o + 16, c[7] ?? 0, LE);
  }
  return out.buffer;
}

// Changes the bytes of input commands into a list of arrays. Returns null if the data is not valid.
export function decodeCmds(data) {
  const v = new DataView(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
  if (v.byteLength < 2 || v.getUint8(0) !== MSG_CMDS) return null;
  const n = v.getUint8(1);
  if (n > 8 || v.byteLength !== 2 + n * CMD_SIZE) return null;
  const list = [];
  for (let i = 0, o = 2; i < n; i++, o += CMD_SIZE) {
    list.push([
      v.getUint32(o, LE), v.getInt8(o + 4) / 100, v.getInt8(o + 5) / 100, v.getUint8(o + 6),
      v.getFloat32(o + 8, LE), v.getFloat32(o + 12, LE), v.getInt8(o + 7), v.getFloat64(o + 16, LE),
    ]);
  }
  return list;
}
