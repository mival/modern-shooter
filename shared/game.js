// The game rules. Only the server side runs this code (dedicated or in the browser).
import {
  TICK, PM, BTN_FIRE, BTN_JUMP, WEAPONS, ITEMS, AMMO_MAX, W_MG, SPAWN_HEALTH, SPAWN_AMMO,
  ARMOR_ABSORB, AMP_FACTOR, KNOCKBACK, HITSCAN_RANGE, RESPAWN_DELAY, RESPAWN_FORCE,
  INTERMISSION_TIME,
} from './constants.js';
import { makeWorld, traceBox, rayBox, newTrace } from './collision.js';
import { pmove, PMF_JUMPED, PMF_PAD } from './pmove.js';

const tr = newTrace();
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(map, opts = {}) {
    this.map = map;
    this.world = makeWorld(map);
    this.fragLimit = opts.fragLimit ?? 20;
    this.timeLimit = (opts.timeLimit ?? 10) * 60;
    this.rng = mulberry32(opts.seed ?? (Date.now() & 0x7fffffff));
    this.players = new Map();
    this.projectiles = [];
    this.nextProjectile = 1;
    this.events = [];
    this.time = 0;
    this.matchStart = 0;
    this.state = 'play';
    this.stateEnd = 0;
    this.scoresDirty = true;
    this.items = map.items.map((it) => ({
      type: it.type, def: ITEMS[it.type],
      x: it.pos[0], y: it.pos[1], z: it.pos[2], avail: true, respawnAt: 0,
    }));
    this.resetItems();
  }

  resetItems() {
    for (const it of this.items) {
      it.avail = !it.def.firstSpawn;
      it.respawnAt = this.time + (it.def.firstSpawn || 0);
    }
  }

  addPlayer(id, name, bot = false) {
    const p = {
      id, name, bot,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: false, jumpHeld: false,
      yaw: 0, pitch: 0,
      health: 0, armor: 0, weapon: W_MG, wantWeapon: W_MG, weapons: 1,
      ammo: [0, 0, 0, 0, 0, 0], weaponTime: 0, beam: false, amp: 0,
      dead: false, deadAt: 0, respawnAt: 0, frags: 0, deaths: 0,
      lastPad: -1, lastHurtBy: 0, spawnCount: 0,
    };
    this.players.set(id, p);
    this.spawn(p);
    this.scoresDirty = true;
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.projectiles = this.projectiles.filter((pr) => pr.owner !== id);
    this.scoresDirty = true;
  }

  spawn(p) {
    // Prefer the spawn points that are far from the other players.
    const ranked = this.map.spawns.map((s) => {
      let d = Infinity;
      for (const q of this.players.values()) {
        if (q === p || q.dead) continue;
        d = Math.min(d, Math.hypot(q.x - s.pos[0], q.y - s.pos[1], q.z - s.pos[2]));
      }
      return { s, d };
    }).sort((a, b) => b.d - a.d);
    const pick = ranked[Math.floor(this.rng() * Math.min(3, ranked.length))].s;
    p.x = pick.pos[0]; p.y = pick.pos[1]; p.z = pick.pos[2];
    p.vx = p.vy = p.vz = 0;
    p.ground = false; p.jumpHeld = true;
    p.yaw = p.spawnYaw = pick.yaw; p.pitch = 0;
    p.health = SPAWN_HEALTH; p.armor = 0;
    p.weapons = 1; p.weapon = p.wantWeapon = W_MG;
    p.ammo = [SPAWN_AMMO, 0, 0, 0, 0, 0];
    p.weaponTime = 0; p.beam = false; p.amp = 0;
    p.dead = false;
    p.spawnCount++;
    this.events.push({ t: 'spawn', id: p.id });
  }

  // Runs one input command of a player.
  runCmd(p, cmd) {
    if (this.state !== 'play') return;
    p.yaw = cmd.yaw; p.pitch = cmd.pitch;
    if (p.dead) {
      if (this.time >= p.respawnAt && (cmd.buttons & (BTN_FIRE | BTN_JUMP))) this.spawn(p);
      return;
    }
    const flags = pmove(p, cmd, this.world, TICK);
    if (flags & PMF_JUMPED) this.events.push({ t: 'jump', id: p.id });
    if (flags & PMF_PAD) { p.lastPad = this.time; this.events.push({ t: 'pad', id: p.id }); }

    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.avail && Math.abs(p.x - it.x) < 36 && Math.abs(p.z - it.z) < 36 && Math.abs(p.y - it.y) < 48) {
        this.pickup(p, it, i);
      }
    }

    if (cmd.weapon >= 0 && cmd.weapon < WEAPONS.length && (p.weapons & (1 << cmd.weapon))) {
      p.wantWeapon = cmd.weapon;
    }
    const fire = (cmd.buttons & BTN_FIRE) !== 0;
    if (p.weaponTime > 0) p.weaponTime -= TICK;
    if (p.weaponTime <= 0) {
      if (fire && p.ammo[p.wantWeapon] <= 0) p.wantWeapon = this.bestWeapon(p);
      if (p.wantWeapon !== p.weapon) {
        p.weapon = p.wantWeapon;
        p.weaponTime = 0.3;
      } else if (fire && p.ammo[p.weapon] > 0) {
        p.ammo[p.weapon]--;
        p.weaponTime += WEAPONS[p.weapon].reload;
        this.fire(p);
      } else {
        p.weaponTime = 0;
      }
    }
    p.beam = fire && WEAPONS[p.weapon].kind === 'beam' && p.ammo[p.weapon] > 0 && !p.dead;
  }

  bestWeapon(p) {
    for (const w of [2, 5, 3, 1, 4, 0]) {
      if ((p.weapons & (1 << w)) && p.ammo[w] > 0) return w;
    }
    return p.weapon;
  }

  pickup(p, it, index) {
    const d = it.def;
    if (d.kind === 'health') {
      if (p.health >= d.max) return;
      p.health = Math.min(d.max, p.health + d.amount);
    } else if (d.kind === 'armor') {
      if (p.armor >= 200) return;
      p.armor = Math.min(200, p.armor + d.amount);
    } else if (d.kind === 'weapon') {
      const bit = 1 << d.weapon;
      if (!(p.weapons & bit)) { p.weapons |= bit; p.wantWeapon = d.weapon; }
      p.ammo[d.weapon] = Math.min(AMMO_MAX, p.ammo[d.weapon] + WEAPONS[d.weapon].ammoGive);
    } else if (d.kind === 'ammo') {
      if (p.ammo[d.weapon] >= AMMO_MAX) return;
      p.ammo[d.weapon] = Math.min(AMMO_MAX, p.ammo[d.weapon] + WEAPONS[d.weapon].ammoBox);
    } else if (d.kind === 'amp') {
      p.amp = d.duration;
    }
    it.avail = false;
    it.respawnAt = this.time + d.respawn;
    this.events.push({ t: 'pickup', id: p.id, i: index });
  }

  // Finds what a ray hits. Returns the wall fraction and the players on the ray.
  hitscan(p, ox, oy, oz, dx, dy, dz, range) {
    const ex = dx * range, ey = dy * range, ez = dz * range;
    traceBox(this.world, ox, oy, oz, ox + ex, oy + ey, oz + ez, 0, 0, 0, tr);
    const wall = tr.f;
    const hits = [];
    for (const q of this.players.values()) {
      if (q === p || q.dead) continue;
      const t = rayBox(ox, oy, oz, ex, ey, ez,
        q.x - PM.hx, q.y + PM.minY, q.z - PM.hx, q.x + PM.hx, q.y + PM.maxY, q.z + PM.hx);
      if (t >= 0 && t < wall) hits.push({ q, t });
    }
    hits.sort((a, b) => a.t - b.t);
    return { wall, hits };
  }

  fire(p) {
    const def = WEAPONS[p.weapon];
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const ox = p.x, oy = p.y + PM.eye, oz = p.z;
    const ev = { t: 'shot', id: p.id, w: p.weapon };
    this.events.push(ev);

    if (def.kind === 'bullet') {
      // "right" and "up" are perpendicular to the aim direction.
      const rx = cy, rz = -sy;
      const ux = -sy * -sp, uy = cp, uz = -cy * -sp;
      ev.e = [];
      for (let i = 0; i < def.pellets; i++) {
        const r = Math.sqrt(this.rng()) * def.spread, a = this.rng() * Math.PI * 2;
        const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        let dx = fx + rx * ca + ux * sa, dy = fy + uy * sa, dz = fz + rz * ca + uz * sa;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const res = this.hitscan(p, ox, oy, oz, dx, dy, dz, HITSCAN_RANGE);
        const f = (res.hits.length ? res.hits[0].t : res.wall) * HITSCAN_RANGE;
        ev.e.push(Math.round(ox + dx * f), Math.round(oy + dy * f), Math.round(oz + dz * f));
        if (res.hits.length) this.damage(res.hits[0].q, p, def.damage, dx, dy, dz, p.weapon);
      }
    } else if (def.kind === 'rail') {
      const res = this.hitscan(p, ox, oy, oz, fx, fy, fz, HITSCAN_RANGE);
      const f = res.wall * HITSCAN_RANGE;
      ev.e = [Math.round(ox + fx * f), Math.round(oy + fy * f), Math.round(oz + fz * f)];
      // The slug goes through all players on the line.
      for (const h of res.hits) this.damage(h.q, p, def.damage, fx, fy, fz, p.weapon);
    } else if (def.kind === 'beam') {
      const res = this.hitscan(p, ox, oy, oz, fx, fy, fz, def.range);
      if (res.hits.length) this.damage(res.hits[0].q, p, def.damage, fx, fy, fz, p.weapon);
    } else {
      this.projectiles.push({
        id: this.nextProjectile++, w: p.weapon, owner: p.id,
        x: ox + fx * 14, y: oy + fy * 14 - 4, z: oz + fz * 14,
        vx: fx * def.speed, vy: fy * def.speed, vz: fz * def.speed,
        die: this.time + 10,
      });
    }
  }

  damage(target, attacker, amount, dx, dy, dz, weapon) {
    if (target.dead || this.state !== 'play') return;
    if (attacker && attacker.amp > 0) amount *= AMP_FACTOR;
    const k = Math.min(amount, 200) * KNOCKBACK;
    target.vx += dx * k; target.vy += dy * k; target.vz += dz * k;
    // A player takes half of the damage from the player's own weapon.
    if (attacker === target) amount *= 0.5;
    amount = Math.ceil(amount);
    const save = Math.min(target.armor, Math.ceil(amount * ARMOR_ABSORB));
    target.armor -= save;
    const take = amount - save;
    target.health -= take;
    this.events.push({ t: 'pain', id: target.id, a: attacker ? attacker.id : 0, d: amount });
    if (attacker && attacker !== target) target.lastHurtBy = attacker.id;
    if (target.health <= 0) this.kill(target, attacker, weapon);
  }

  kill(target, attacker, weapon) {
    target.dead = true;
    target.beam = false;
    target.deadAt = this.time;
    target.respawnAt = this.time + RESPAWN_DELAY;
    target.deaths++;
    if (attacker && attacker !== target) attacker.frags++;
    else target.frags--;
    this.scoresDirty = true;
    this.events.push({ t: 'kill', k: attacker ? attacker.id : 0, v: target.id, w: weapon });
    if (attacker && this.fragLimit > 0 && attacker.frags >= this.fragLimit) this.endMatch();
  }

  radiusDamage(x, y, z, attacker, amount, radius, ignore, weapon) {
    for (const q of this.players.values()) {
      if (q.dead || q === ignore) continue;
      // Use the distance to the player box, not to the player origin.
      const cx = Math.max(q.x - PM.hx, Math.min(x, q.x + PM.hx));
      const cy = Math.max(q.y + PM.minY, Math.min(y, q.y + PM.maxY));
      const cz = Math.max(q.z - PM.hx, Math.min(z, q.z + PM.hx));
      const dist = Math.hypot(x - cx, y - cy, z - cz);
      if (dist >= radius) continue;
      traceBox(this.world, x, y, z, q.x, q.y, q.z, 0, 0, 0, tr);
      if (tr.f < 1) {
        traceBox(this.world, x, y, z, q.x, q.y + PM.eye, q.z, 0, 0, 0, tr);
        if (tr.f < 1) continue;
      }
      let dx = q.x - x, dy = q.y - y + 24, dz = q.z - z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      this.damage(q, attacker, amount * (1 - dist / radius), dx, dy, dz, weapon);
    }
  }

  tickProjectiles() {
    const keep = [];
    for (const pr of this.projectiles) {
      const def = WEAPONS[pr.w];
      const mx = pr.vx * TICK, my = pr.vy * TICK, mz = pr.vz * TICK;
      traceBox(this.world, pr.x, pr.y, pr.z, pr.x + mx, pr.y + my, pr.z + mz, 0, 0, 0, tr);
      let f = tr.f, victim = null;
      for (const q of this.players.values()) {
        if (q.dead || q.id === pr.owner) continue;
        const t = rayBox(pr.x, pr.y, pr.z, mx, my, mz,
          q.x - PM.hx - 2, q.y + PM.minY - 2, q.z - PM.hx - 2, q.x + PM.hx + 2, q.y + PM.maxY + 2, q.z + PM.hx + 2);
        if (t >= 0 && t < f) { f = t; victim = q; }
      }
      if (f < 1 || this.time >= pr.die) {
        const x = pr.x + mx * f, y = pr.y + my * f, z = pr.z + mz * f;
        const owner = this.players.get(pr.owner) || null;
        const l = Math.hypot(pr.vx, pr.vy, pr.vz);
        this.events.push({ t: 'boom', w: pr.w, p: [Math.round(x), Math.round(y), Math.round(z)] });
        if (victim) this.damage(victim, owner, def.damage, pr.vx / l, pr.vy / l, pr.vz / l, pr.w);
        this.radiusDamage(x, y, z, owner, def.splash, def.radius, victim, pr.w);
      } else {
        pr.x += mx; pr.y += my; pr.z += mz;
        keep.push(pr);
      }
    }
    this.projectiles = keep;
  }

  // Moves the world one tick forward.
  tick() {
    const before = Math.floor(this.time);
    this.time += TICK;
    if (this.state === 'intermission') {
      if (this.time >= this.stateEnd) this.restart();
      return;
    }
    this.tickProjectiles();
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.avail && this.time >= it.respawnAt) {
        it.avail = true;
        this.events.push({ t: 'itemup', i });
      }
    }
    const second = Math.floor(this.time) !== before;
    for (const p of this.players.values()) {
      if (p.dead) {
        if (this.time >= p.deadAt + RESPAWN_FORCE) this.spawn(p);
        continue;
      }
      if (p.amp > 0) p.amp = Math.max(0, p.amp - TICK);
      if (second) {
        if (p.health > 100) p.health--;
        if (p.armor > 100) p.armor--;
      }
    }
    if (this.timeLimit > 0 && this.time - this.matchStart >= this.timeLimit) this.endMatch();
  }

  endMatch() {
    if (this.state !== 'play') return;
    this.state = 'intermission';
    this.stateEnd = this.time + INTERMISSION_TIME;
    for (const p of this.players.values()) p.beam = false;
    this.events.push({ t: 'end' });
  }

  restart() {
    this.state = 'play';
    this.matchStart = this.time;
    this.projectiles = [];
    this.resetItems();
    for (const p of this.players.values()) {
      p.frags = 0; p.deaths = 0;
      this.spawn(p);
    }
    this.scoresDirty = true;
    this.events.push({ t: 'restart' });
  }

  timeLeft() {
    if (this.state === 'intermission') return this.stateEnd - this.time;
    return this.timeLimit > 0 ? Math.max(0, this.timeLimit - (this.time - this.matchStart)) : -1;
  }

  // The part of a snapshot that is the same for all clients.
  sharedSnapshot() {
    const pl = [];
    for (const p of this.players.values()) {
      pl.push([p.id, r1(p.x), r1(p.y), r1(p.z), r3(p.yaw), r3(p.pitch), p.weapon,
        (p.dead ? 1 : 0) | (p.beam ? 2 : 0) | (p.amp > 0 ? 4 : 0)]);
    }
    const pr = this.projectiles.map((q) => [q.id, q.w, r1(q.x), r1(q.y), r1(q.z), r1(q.vx), r1(q.vy), r1(q.vz)]);
    let it = '';
    for (const i of this.items) it += i.avail ? '1' : '0';
    return { time: r3(this.time), st: this.state, tl: Math.ceil(this.timeLeft()), p: pl, pr, it };
  }

  // The private state of one player. The client uses it for the prediction.
  ownState(p) {
    return {
      x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, ground: p.ground, jumpHeld: p.jumpHeld,
      health: p.health, armor: p.armor, weapon: p.weapon, weapons: p.weapons, ammo: p.ammo.slice(),
      amp: Math.ceil(p.amp), dead: p.dead, sc: p.spawnCount, syaw: p.spawnYaw,
    };
  }

  scores() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, bot: p.bot, frags: p.frags, deaths: p.deaths }));
  }
}
