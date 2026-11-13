// Computer-controlled players (bots).
import { PM, BTN_FIRE, BTN_JUMP, WEAPONS, TICK, W_HAMMER, W_MG, W_SG, W_RL, W_ARC, W_RAIL, W_PG, AMMO_MAX } from './constants.js';
import { traceBox, newTrace } from './collision.js';
import { pmove, newMoveState, PMF_PAD } from './pmove.js';

const tr = newTrace();
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Simulates a walk in a straight line from node a to node b.
function walkTest(world, a, b) {
  const p = newMoveState();
  p.x = a.x; p.y = a.y; p.z = a.z;
  const cmd = { fwd: 1, side: 0, buttons: 0, yaw: 0, pitch: 0 };
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const maxTicks = (dist / PM.speed * 1.5 + 1) * 60;
  let best = dist, stall = 0;
  for (let i = 0; i < maxTicks; i++) {
    cmd.yaw = yawTo(b.x - p.x, b.z - p.z);
    const flags = pmove(p, cmd, world, TICK);
    const hd = Math.hypot(b.x - p.x, b.z - p.z);
    if (flags & PMF_PAD) return b.pad >= 0 && hd < 90;
    if (hd < 20 && Math.abs(p.y - b.y) < 30) return true;
    if (hd < best - 0.5) { best = hd; stall = 0; } else if (++stall > 25) return false;
  }
  return false;
}

// Makes the navigation graph. The walk simulation finds the links between the nodes.
export function buildNav(game) {
  const map = game.map;
  const nodes = [];
  const add = (pos, item = -1) => {
    nodes.push({ x: pos[0], y: pos[1], z: pos[2], item, pad: -1, edges: [] });
    return nodes.length - 1;
  };
  map.items.forEach((it, i) => add(it.pos, i));
  map.spawns.forEach((s) => add(s.pos));
  map.nodes.forEach((n) => add(n));
  const nearest = (pos) => {
    let bi = 0, bd = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - pos[0], n.y - pos[1], n.z - pos[2]);
      if (d < bd) { bd = d; bi = i; }
    });
    return bi;
  };
  for (const pad of map.pads) {
    const land = nearest(pad.land);
    const i = add(pad.pos);
    nodes[i].pad = land;
    nodes[i].edges.push({ to: land, cost: 300 });
  }
  nodes.forEach((a, ai) => {
    if (a.pad >= 0) return;
    const near = nodes
      .map((b, bi) => ({ bi, d: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) }))
      .filter((c) => c.bi !== ai && c.d < 760)
      .sort((x, y) => x.d - y.d)
      .slice(0, 12);
    for (const c of near) {
      if (walkTest(game.world, a, nodes[c.bi])) a.edges.push({ to: c.bi, cost: c.d });
    }
  });
  return { nodes };
}

// Returns the cost and the previous node for each node (Dijkstra algorithm).
function shortestPaths(nav, from) {
  const n = nav.nodes.length;
  const cost = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  cost[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || cost[u] === Infinity) break;
    done[u] = true;
    for (const e of nav.nodes[u].edges) {
      if (cost[u] + e.cost < cost[e.to]) { cost[e.to] = cost[u] + e.cost; prev[e.to] = u; }
    }
  }
  return { cost, prev };
}

// Bot skill levels.
// err: aim error in radians. turn: maximum turn rate in radians each second.
// react: time in seconds before the bot fires at a new enemy.
// lag: the bot aims at the position that the enemy had this many seconds before.
// predict: how much of the enemy movement the bot predicts (0 = none, 1 = all).
// track: how fast the aim follows the target. pause: time between bursts of an automatic weapon.
// damage: factor for the damage that the bot does to other players.
const SKILLS = [
  { err: 0.28, turn: 3.5, react: 0.7, lag: 0.4, predict: 0, track: 4, pause: 0.6, damage: 0.4 },
  { err: 0.2, turn: 5, react: 0.5, lag: 0.32, predict: 0.3, track: 6, pause: 0.45, damage: 0.55 },
  { err: 0.125, turn: 7, react: 0.38, lag: 0.24, predict: 0.55, track: 8, pause: 0.3, damage: 0.7 },
  { err: 0.065, turn: 9, react: 0.25, lag: 0.16, predict: 0.8, track: 12, pause: 0.15, damage: 0.85 },
  { err: 0.028, turn: 12, react: 0.15, lag: 0.09, predict: 0.95, track: 18, pause: 0, damage: 1 },
];
// A bot sees an enemy inside this angle from its view direction (cosine of 80 degrees).
const VIEW_COS = 0.17;

export class Bot {
  constructor(game, nav, player, skill = 3) {
    this.game = game; this.nav = nav; this.p = player;
    this.skill = SKILLS[Math.max(1, Math.min(5, skill)) - 1];
    player.damageScale = this.skill.damage;
    this.rand = game.rng;
    this.cmd = { seq: 0, fwd: 0, side: 0, buttons: 0, yaw: player.yaw, pitch: 0, weapon: -1 };
    this.path = []; this.enemy = null; this.seenAt = 0;
    this.errYaw = 0; this.errPitch = 0; this.nextErr = 0;
    this.strafe = 1; this.nextStrafe = 0;
    this.goalUntil = 0; this.checkAt = 0; this.checkX = 0; this.checkZ = 0; this.stuck = 0;
    this.phase = Math.floor(this.rand() * 6); this.ticks = 0; this.padSeen = -1;
    this.spawnCount = -1;
    this.burstEnd = 0; this.pauseEnd = 0;
  }

  nearestNode() {
    const p = this.p, nodes = this.nav.nodes;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.pad >= 0) continue;
      let d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 4;
      if (d > bd) continue;
      traceBox(this.game.world, p.x, p.y, p.z, n.x, n.y, n.z, 0, 0, 0, tr);
      if (tr.f < 1) d += 2000;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  // Gives a value to an item for this bot.
  itemValue(it) {
    const p = this.p, d = it.def;
    if (!it.avail && it.respawnAt - this.game.time > 4) return 0;
    if (d.kind === 'health') return p.health >= d.max ? 0 : d.amount >= 100 ? 90 : (100 - Math.min(100, p.health)) * 0.8 + d.amount * 0.2;
    if (d.kind === 'armor') return p.armor >= 200 ? 0 : d.amount * 0.6 + (p.armor < 50 ? 20 : 0);
    if (d.kind === 'weapon') return (p.weapons & (1 << d.weapon)) ? (p.ammo[d.weapon] < 10 ? 20 : 3) : 70;
    if (d.kind === 'ammo') return (p.weapons & (1 << d.weapon)) && p.ammo[d.weapon] < AMMO_MAX / 4 ? 25 : 2;
    if (d.kind === 'amp') return 120;
    return 0;
  }

  chooseGoal() {
    const from = this.nearestNode();
    this.path = [];
    if (from < 0) return;
    const { cost, prev } = shortestPaths(this.nav, from);
    let best = -1, bestScore = 0;
    this.nav.nodes.forEach((n, i) => {
      if (i === from || cost[i] === Infinity) return;
      const value = n.item >= 0 ? this.itemValue(this.game.items[n.item]) : 4;
      const score = value * (0.6 + this.rand() * 0.8) / (cost[i] + 300);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best < 0) return;
    for (let i = best; i !== -1; i = prev[i]) this.path.unshift(i);
    this.goalUntil = this.game.time + 12;
  }

  findEnemy() {
    const p = this.p;
    let best = null, bd = Infinity;
    for (const q of this.game.players.values()) {
      // Do not attack a player that has spawn protection.
      if (q === p || q.dead || this.game.time < q.protectUntil) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d >= bd || d > 3000) continue;
      // A bot does not see behind its back. It turns to an enemy that is near or that hurt it.
      const facing = (-Math.sin(this.cmd.yaw) * (q.x - p.x) - Math.cos(this.cmd.yaw) * (q.z - p.z)) / (d || 1);
      const hurt = q.id === p.lastHurtBy && this.game.time - p.lastHurtAt < 3;
      if (facing < VIEW_COS && d > 250 && !hurt && q !== this.enemy) continue;
      traceBox(this.game.world, p.x, p.y + PM.eye, p.z, q.x, q.y + PM.eye, q.z, 0, 0, 0, tr);
      if (tr.f >= 1) { best = q; bd = d; }
    }
    if (best !== this.enemy) this.seenAt = this.game.time;
    this.enemy = best;
  }

  chooseWeapon(dist) {
    const p = this.p;
    const score = WEAPONS.map(() => 0);
    // The hammer is the last option. A change to it at close range costs too much time.
    score[W_HAMMER] = 1;
    score[W_MG] = 10;
    score[W_SG] = dist < 300 ? 40 : dist < 600 ? 18 : 5;
    score[W_RL] = dist < 130 ? 4 : dist < 900 ? 45 : 15;
    score[W_ARC] = dist < 700 ? 42 : 0;
    score[W_RAIL] = dist > 700 ? 60 : dist > 350 ? 30 : 12;
    score[W_PG] = dist < 800 ? 35 : 14;
    let best = p.weapon, bs = -1;
    for (let w = 0; w < WEAPONS.length; w++) {
      if (!(p.weapons & (1 << w)) || (WEAPONS[w].kind !== 'melee' && p.ammo[w] <= 0)) continue;
      if (score[w] > bs) { bs = score[w]; best = w; }
    }
    return best;
  }

  // Returns the input command for this tick.
  think() {
    const p = this.p, g = this.game, cmd = this.cmd, now = g.time;
    cmd.seq++; cmd.fwd = 0; cmd.side = 0; cmd.buttons = 0; cmd.weapon = -1;
    this.ticks++;
    if (p.dead) {
      if (this.ticks % 20 === 0) cmd.buttons = BTN_FIRE;
      this.path = []; this.enemy = null;
      return cmd;
    }
    if (p.spawnCount !== this.spawnCount) {
      this.spawnCount = p.spawnCount;
      this.path = []; cmd.yaw = p.yaw; cmd.pitch = 0;
      this.checkAt = now + 1; this.checkX = p.x; this.checkZ = p.z; this.stuck = 0;
    }
    if ((this.ticks + this.phase) % 6 === 0) this.findEnemy();
    if (this.enemy && (this.enemy.dead || !g.players.has(this.enemy.id))) this.enemy = null;

    // A jump pad launched the bot.
    if (p.lastPad !== this.padSeen) {
      this.padSeen = p.lastPad;
      if (this.path.length && this.nav.nodes[this.path[0]].pad >= 0) this.path.shift();
      else this.path = [];
    }
    if (!this.path.length || now > this.goalUntil) {
      if (p.ground || now > this.goalUntil + 2) this.chooseGoal();
    }

    // Movement along the path.
    let mx = 0, mz = 0;
    if (this.path.length) {
      let n = this.nav.nodes[this.path[0]];
      if (Math.hypot(n.x - p.x, n.z - p.z) < 26 && Math.abs(n.y - p.y) < 40) {
        this.path.shift();
        if (this.path.length) n = this.nav.nodes[this.path[0]];
      }
      mx = n.x - p.x; mz = n.z - p.z;
      // In the air, the bot cannot stop quickly. Aim at the point where the bot must start to brake.
      // Then the bot lands on the target and does not fly over it.
      if (!p.ground) { mx -= p.vx * 0.5; mz -= p.vz * 0.5; }
      const l = Math.hypot(mx, mz) || 1;
      mx /= l; mz /= l;
    }

    // Check the progress one time each second.
    if (now >= this.checkAt) {
      const moved = Math.hypot(p.x - this.checkX, p.z - this.checkZ);
      this.stuck = moved < 30 ? this.stuck + 1 : 0;
      this.checkAt = now + 1; this.checkX = p.x; this.checkZ = p.z;
      if (this.stuck >= 3) { this.path = []; this.stuck = 0; }
    }
    if (this.stuck >= 1 && p.ground && this.ticks % 30 === 0) cmd.buttons |= BTN_JUMP;

    let wantYaw = cmd.yaw, wantPitch = 0;
    const e = this.enemy;
    if (e) {
      const def = WEAPONS[p.weapon], s = this.skill;
      // The bot reacts with a delay, as a person does. It aims at an old position of the enemy
      // and predicts the movement from an old velocity. A change of direction makes the bot miss.
      const seen = g.posAt(e, now - s.lag);
      const px = seen.x, py = seen.y, pz = seen.z;
      const before = g.posAt(e, now - s.lag - 0.1);
      const evx = (px - before.x) / 0.1, evz = (pz - before.z) / 0.1;
      const dist = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
      const lead = (s.lag + (def.kind === 'projectile' ? dist / def.speed : 0)) * s.predict;
      const tx = px + evx * lead, tz = pz + evz * lead;
      let ty = py + 8;
      if (p.weapon === W_RL && e.y <= p.y + 40) ty = py - 20;
      if (now >= this.nextErr) {
        this.nextErr = now + 0.25 + this.rand() * 0.25;
        // A target that moves fast is more difficult to follow.
        const k = s.err * (1 + Math.hypot(evx, evz) / PM.speed);
        this.errYaw = (this.rand() - 0.5) * 2 * k;
        this.errPitch = (this.rand() - 0.5) * k;
      }
      const dx = tx - p.x, dy = ty - (p.y + PM.eye), dz = tz - p.z;
      wantYaw = yawTo(dx, dz) + this.errYaw;
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.errPitch;
      if (now - this.seenAt > 0.5 || p.weaponTime <= 0) cmd.weapon = this.chooseWeapon(dist);
      const off = Math.abs(angleDiff(wantYaw, cmd.yaw)) + Math.abs(wantPitch - cmd.pitch);
      const inRange = def.kind === 'beam' ? dist < def.range : def.kind === 'melee' ? dist < def.range + 25 : true;
      if (now - this.seenAt > s.react && off < 0.12 + 20 / (dist + 1) && inRange && now >= this.pauseEnd) {
        cmd.buttons |= BTN_FIRE;
        // An automatic weapon fires in bursts with a pause between them.
        if (def.reload <= 0.1 && s.pause > 0) {
          if (now > this.burstEnd + 0.2) this.burstEnd = now + 0.5 + this.rand() * 0.6;
          else if (now >= this.burstEnd) { this.pauseEnd = now + s.pause * (0.6 + this.rand() * 0.8); this.burstEnd = this.pauseEnd + 0.5 + this.rand() * 0.6; }
        }
      }
      // Move sideways to be a more difficult target.
      if (now >= this.nextStrafe) {
        this.nextStrafe = now + 0.5 + this.rand() * 0.9;
        this.strafe = this.rand() < 0.5 ? -1 : 1;
        if (p.ground && this.rand() < 0.25) cmd.buttons |= BTN_JUMP;
      }
      const sx = -dz, sz = dx, sl = Math.hypot(sx, sz) || 1;
      mx += (sx / sl) * this.strafe * 0.7; mz += (sz / sl) * this.strafe * 0.7;
      // With the hammer, run directly to the enemy.
      if (def.kind === 'melee') { mx = e.x - p.x; mz = e.z - p.z; }
    } else if (mx !== 0 || mz !== 0) {
      wantYaw = yawTo(mx, mz);
    }

    // The aim moves a part of the distance to the target each tick. Thus the aim is behind a fast target.
    const maxTurn = this.skill.turn * TICK, follow = Math.min(1, this.skill.track * TICK);
    const dyaw = angleDiff(wantYaw, cmd.yaw) * follow;
    cmd.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
    cmd.pitch += Math.max(-maxTurn, Math.min(maxTurn, (wantPitch - cmd.pitch) * follow));
    cmd.pitch = Math.max(-1.5, Math.min(1.5, cmd.pitch));

    // Change the world direction into the forward and side inputs.
    const sn = Math.sin(cmd.yaw), cs = Math.cos(cmd.yaw);
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      mx /= ml; mz /= ml;
      cmd.fwd = -sn * mx - cs * mz;
      cmd.side = cs * mx - sn * mz;
    }
    return cmd;
  }
}
