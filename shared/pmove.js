// Player movement. The client and the server use the same code.
// The client uses it to predict the movement of the local player.
import { PM, BTN_JUMP } from './constants.js';
import { traceBox, newTrace } from './collision.js';

export const PMF_JUMPED = 1;
export const PMF_PAD = 2;
export const PMF_LANDED = 4;

const tr = newTrace();

export function newMoveState() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: false, jumpHeld: false, jumps: 0 };
}

export function copyMoveState(to, from) {
  to.x = from.x; to.y = from.y; to.z = from.z;
  to.vx = from.vx; to.vy = from.vy; to.vz = from.vz;
  to.ground = from.ground; to.jumpHeld = from.jumpHeld; to.jumps = from.jumps;
  return to;
}

function trace(w, p, ex, ey, ez) {
  return traceBox(w, p.x, p.y, p.z, ex, ey, ez, PM.hx, PM.minY, PM.maxY, tr);
}

function groundCheck(p, w) {
  // An upward push lifts the player from the ground.
  if (p.vy > 10) { p.ground = false; return; }
  trace(w, p, p.x, p.y - 0.25, p.z);
  p.ground = tr.f < 1 && tr.ny > 0;
}

function friction(p, dt) {
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < 1) { p.vx = 0; p.vz = 0; return; }
  const control = speed < PM.stopSpeed ? PM.stopSpeed : speed;
  let ns = speed - control * PM.friction * dt;
  if (ns < 0) ns = 0;
  ns /= speed;
  p.vx *= ns; p.vz *= ns;
}

// This function gives the speed gain of an air strafe.
// It limits only the speed along the wish direction.
function accelerate(p, wx, wz, wishSpeed, accel, dt) {
  const add = wishSpeed - (p.vx * wx + p.vz * wz);
  if (add <= 0) return;
  let as = accel * dt * wishSpeed;
  if (as > add) as = add;
  p.vx += as * wx; p.vz += as * wz;
}

// Returns true if a wall stopped the move.
function slide(p, w, dt) {
  let left = dt, blocked = false;
  for (let i = 0; i < 4 && left > 0; i++) {
    if (p.vx === 0 && p.vy === 0 && p.vz === 0) break;
    trace(w, p, p.x + p.vx * left, p.y + p.vy * left, p.z + p.vz * left);
    p.x = tr.x; p.y = tr.y; p.z = tr.z;
    if (tr.f >= 1) break;
    left -= left * tr.f;
    if (tr.nx !== 0) { p.vx = 0; blocked = true; }
    else if (tr.nz !== 0) { p.vz = 0; blocked = true; }
    else p.vy = 0;
  }
  return blocked;
}

function stepSlide(p, w, dt) {
  const sx = p.x, sy = p.y, sz = p.z, svx = p.vx, svy = p.vy, svz = p.vz;
  if (!slide(p, w, dt)) return;
  if (svy > 0) {
    // Do not step during an upward move, unless the ground is near.
    traceBox(w, sx, sy, sz, sx, sy - PM.stepSize, sz, PM.hx, PM.minY, PM.maxY, tr);
    if (tr.f >= 1) return;
  }
  const dx = p.x, dy = p.y, dz = p.z, dvx = p.vx, dvy = p.vy, dvz = p.vz;
  traceBox(w, sx, sy, sz, sx, sy + PM.stepSize, sz, PM.hx, PM.minY, PM.maxY, tr);
  const up = tr.y - sy;
  if (up > 0.01) {
    p.x = sx; p.y = tr.y; p.z = sz; p.vx = svx; p.vy = svy; p.vz = svz;
    slide(p, w, dt);
    trace(w, p, p.x, p.y - up, p.z);
    p.y = tr.y;
    if (tr.f < 1 && p.vy < 0) p.vy = 0;
    const d1 = (dx - sx) * (dx - sx) + (dz - sz) * (dz - sz);
    const d2 = (p.x - sx) * (p.x - sx) + (p.z - sz) * (p.z - sz);
    if (d2 > d1 + 1e-6) return;
  }
  p.x = dx; p.y = dy; p.z = dz; p.vx = dvx; p.vy = dvy; p.vz = dvz;
}

// Moves the player for one command. Returns PMF_* flags.
export function pmove(p, cmd, w, dt) {
  let flags = 0;
  const sn = Math.sin(cmd.yaw), cs = Math.cos(cmd.yaw);
  let wx = -sn * cmd.fwd + cs * cmd.side;
  let wz = -cs * cmd.fwd - sn * cmd.side;
  const wl = Math.hypot(wx, wz);
  let wishSpeed = 0;
  if (wl > 1e-6) { wx /= wl; wz /= wl; wishSpeed = PM.speed * (wl < 1 ? wl : 1); }

  const wasGround = p.ground;
  groundCheck(p, w);
  const jump = (cmd.buttons & BTN_JUMP) !== 0;
  if (!jump) p.jumpHeld = false;
  if (p.ground) p.jumps = 0;
  if (jump && !p.jumpHeld) {
    if (p.ground) {
      p.vy = PM.jumpVel; p.ground = false; p.jumpHeld = true;
      flags |= PMF_JUMPED;
    } else if (w.doubleJump && p.jumps < 1) {
      // Double jump: one more jump in the air. The server option sets "w.doubleJump".
      p.vy = (p.vy > 0 ? p.vy : 0) + PM.jumpVel; p.jumps++; p.jumpHeld = true;
      flags |= PMF_JUMPED;
    }
  }
  if (p.ground) {
    friction(p, dt);
    accelerate(p, wx, wz, wishSpeed, PM.accel, dt);
    p.vy = 0;
  } else {
    accelerate(p, wx, wz, wishSpeed, PM.airAccel, dt);
    p.vy -= PM.gravity * dt;
  }
  stepSlide(p, w, dt);
  groundCheck(p, w);
  if (!wasGround && p.ground) flags |= PMF_LANDED;

  for (const pad of w.pads) {
    if (p.x + PM.hx > pad.min[0] && p.x - PM.hx < pad.max[0] &&
        p.z + PM.hx > pad.min[2] && p.z - PM.hx < pad.max[2] &&
        p.y + PM.minY < pad.max[1] && p.y + PM.maxY > pad.min[1]) {
      if (p.vy !== pad.vel[1]) flags |= PMF_PAD;
      p.vx = pad.vel[0]; p.vy = pad.vel[1]; p.vz = pad.vel[2];
      p.ground = false;
    }
  }
  return flags;
}
