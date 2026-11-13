import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, MAP_IDS } from '../shared/map.js';
import { checkMap } from '../tools/map-check.mjs';
import { makeWorld } from '../shared/collision.js';
import { pmove, newMoveState } from '../shared/pmove.js';
import { Game } from '../shared/game.js';
import { GameHost } from '../shared/host.js';
import { buildNav } from '../shared/bot.js';
import { TICK, PM, BTN_JUMP, BTN_FIRE, W_RL, W_HAMMER, W_MG, W_RAIL } from '../shared/constants.js';

const map = buildMap();
const world = makeWorld(map);
const cmd = (o = {}) => ({ seq: 0, fwd: 0, side: 0, buttons: 0, yaw: 0, pitch: 0, weapon: -1, ...o });

function stand(x, z) {
  const p = newMoveState();
  p.x = x; p.y = 24; p.z = z;
  for (let i = 0; i < 30; i++) pmove(p, cmd(), world, TICK);
  return p;
}

test('a player stands on the floor', () => {
  const p = stand(0, 600);
  assert.ok(p.ground);
  assert.ok(Math.abs(p.y - 24) < 0.1);
});

test('the ground speed has a limit', () => {
  const p = stand(-900, 560);
  for (let i = 0; i < 120; i++) pmove(p, cmd({ fwd: 1, yaw: -Math.PI / 2 }), world, TICK);
  const s = Math.hypot(p.vx, p.vz);
  assert.ok(s > 300 && s <= PM.speed + 0.01, `speed ${s}`);
});

test('a jump reaches the correct height', () => {
  const p = stand(0, 600);
  let top = p.y;
  pmove(p, cmd({ buttons: BTN_JUMP }), world, TICK);
  for (let i = 0; i < 60; i++) { pmove(p, cmd(), world, TICK); top = Math.max(top, p.y); }
  assert.ok(top - 24 > 40 && top - 24 < 48, `height ${top - 24}`);
});

test('air strafe jumps increase the speed above the ground limit', () => {
  const p = stand(-600, -200);
  let yaw = -Math.PI / 2;
  let max = 0;
  for (let i = 0; i < 400; i++) {
    const c = cmd({ fwd: 1, yaw });
    if (i > 40) {
      // Hold forward and one strafe key. Turn slowly to the strafe side.
      c.side = 1;
      yaw -= 0.35 * TICK;
      c.yaw = yaw;
      if (p.ground) c.buttons = i % 2 ? BTN_JUMP : 0;
    }
    pmove(p, c, world, TICK);
    max = Math.max(max, Math.hypot(p.vx, p.vz));
    if (Math.abs(p.x) > 950 || Math.abs(p.z) > 950) break;
  }
  assert.ok(max > 400, `maximum speed ${max}`);
});

test('a player walks up the stairs', () => {
  const p = stand(944, 150);
  for (let i = 0; i < 240; i++) pmove(p, cmd({ fwd: 1, yaw: Math.PI }), world, TICK);
  assert.ok(Math.abs(p.y - 216) < 1, `y ${p.y}`);
});

test('a jump pad puts the player on the pedestal', () => {
  const p = stand(0, 400);
  // Run to the pad. In the air, move back when the player is above the pedestal.
  for (let i = 0; i < 150; i++) pmove(p, cmd({ fwd: p.ground && p.y > 100 ? 0 : p.z > 40 ? 1 : -1 }), world, TICK);
  assert.ok(p.ground && Math.abs(p.y - 152) < 1, `y ${p.y}`);
});

test('a jump pad keeps the horizontal movement', () => {
  // Cross the pad along the x axis. The pad must not push the player to the pedestal.
  const p = stand(-200, 162);
  let top = 0, vxOnPad = 0;
  for (let i = 0; i < 120; i++) {
    pmove(p, cmd({ fwd: 1, yaw: -Math.PI / 2 }), world, TICK);
    if (p.y > top) top = p.y;
    if (!vxOnPad && p.vy > 400) vxOnPad = p.vx;
  }
  assert.ok(vxOnPad > 300, `speed on the pad ${vxOnPad}`);
  assert.ok(top > 170 && top < 215, `top ${top}`);
  assert.ok(Math.abs(p.z - 162) < 1 && p.x > 150, `position ${p.x}, ${p.z}`);
});

test('a rocket jump goes higher than a normal jump', () => {
  const g = new Game(buildMap(), { seed: 1, spawnProtect: 0 });
  const p = g.addPlayer(1, 'a');
  p.x = 0; p.y = 24; p.z = 600; p.weapons |= 1 << W_RL; p.ammo[W_RL] = 5;
  for (let i = 0; i < 30; i++) { g.runCmd(p, cmd({ weapon: W_RL, pitch: -1.5 })); g.tick(); }
  let top = 0;
  g.runCmd(p, cmd({ weapon: W_RL, pitch: -1.5, buttons: BTN_JUMP | BTN_FIRE })); g.tick();
  for (let i = 0; i < 90; i++) { g.runCmd(p, cmd({ weapon: W_RL, pitch: -1.5 })); g.tick(); top = Math.max(top, p.y); }
  assert.ok(top - 24 > 150, `height ${top - 24}`);
  assert.ok(p.health < 125 && p.health > 0);
});

test('the double jump works only with the server option', () => {
  const height = (doubleJump) => {
    const w = makeWorld(map);
    w.doubleJump = doubleJump;
    const p = newMoveState();
    p.x = 0; p.y = 24; p.z = 600;
    for (let i = 0; i < 30; i++) pmove(p, cmd(), w, TICK);
    let top = p.y;
    for (let i = 0; i < 120; i++) {
      // Press jump at tick 0, tick 15 and tick 30.
      pmove(p, cmd({ buttons: i === 0 || i === 15 || i === 30 ? BTN_JUMP : 0 }), w, TICK);
      top = Math.max(top, p.y);
    }
    return top - 24;
  };
  const off = height(false), on = height(true);
  assert.ok(off > 40 && off < 48, `off ${off}`);
  assert.ok(on > 75 && on < 130, `on ${on}`);
});

test('the hammer needs no ammo and hits only at close range', () => {
  const g = new Game(buildMap(), { seed: 1, spawnProtect: 0 });
  const a = g.addPlayer(1, 'a'), b = g.addPlayer(2, 'b');
  assert.ok(a.weapons & (1 << W_HAMMER));
  const place = (dist) => {
    a.x = 0; a.y = 24; a.z = 600; b.x = 0; b.y = 24; b.z = 600 - dist;
    a.vx = a.vy = a.vz = b.vx = b.vy = b.vz = 0; b.health = 100; b.armor = 0; a.weaponTime = 0;
  };
  place(50);
  for (let i = 0; i < 30; i++) { g.runCmd(a, cmd({ weapon: W_HAMMER })); g.tick(); }
  assert.equal(a.weapon, W_HAMMER);
  place(50);
  g.runCmd(a, cmd({ buttons: BTN_FIRE })); g.tick();
  assert.equal(b.health, 50);
  place(120);
  g.runCmd(a, cmd({ buttons: BTN_FIRE })); g.tick();
  assert.equal(b.health, 100);
  // With no ammo, the game selects the hammer.
  a.ammo[W_MG] = 0; a.weaponTime = 0;
  g.runCmd(a, cmd({ weapon: W_MG })); for (let i = 0; i < 30; i++) { g.runCmd(a, cmd()); g.tick(); }
  assert.equal(a.weapon, W_MG);
  g.runCmd(a, cmd({ buttons: BTN_FIRE })); g.tick();
  assert.equal(a.weapon, W_HAMMER);
});

test('each map is valid and the bots can go to each item', () => {
  for (const id of MAP_IDS) assert.deepEqual(checkMap(id).problems, [], id);
});

test('the host changes the map after a match and keeps the players', () => {
  const sent = [];
  const host = new GameHost({ bots: 2, botFill: false, fragLimit: 1, timeLimit: 0, seed: 5, maps: ['yard', 'deck'] });
  const c = host.connect({ send: (m) => sent.push(m), close() {} });
  c.message({ t: 'join', name: 'guest' });
  const id = sent.find((m) => m.t === 'welcome').id;
  assert.equal(sent.find((m) => m.t === 'welcome').map, 'yard');
  host.game.endMatch();
  for (let i = 0; i < 60 * 11; i++) host.step();
  assert.equal(host.mapId, 'deck');
  assert.equal(host.game.map.name, 'Twin Deck');
  assert.equal(sent.filter((m) => m.t === 'map').length, 1);
  assert.equal(host.game.players.get(id).name, 'guest');
  assert.equal(host.bots.size, 2);
  assert.equal(host.game.state, 'play');
  const snap = sent.filter((m) => m.t === 's').pop();
  assert.equal(snap.it.length, host.game.items.length);
  // One map in the rotation: the match starts again on the same map.
  host.applySettings({ maps: ['deck'] });
  host.game.endMatch();
  for (let i = 0; i < 60 * 11; i++) host.step();
  assert.equal(host.mapId, 'deck');
  assert.equal(sent.filter((m) => m.t === 'map').length, 1);
  assert.equal(host.changeMap('nothing'), false);
});

test('a match with bots runs to the frag limit', () => {
  const host = new GameHost({ bots: 6, botSkill: 5, botFill: false, fragLimit: 10, timeLimit: 0, seed: 7 });
  const g = host.game;
  let ended = false, picks = 0;
  for (let i = 0; i < 60 * 600 && !ended; i++) {
    host.step();
    for (const e of g.events) { if (e.t === 'end') ended = true; if (e.t === 'pickup') picks++; }
    g.events = [];
    for (const p of g.players.values()) {
      assert.ok(Number.isFinite(p.x + p.y + p.z + p.vx + p.vy + p.vz), 'finite state');
      assert.ok(Math.abs(p.x) < 1024 && Math.abs(p.z) < 1024 && p.y > 0 && p.y < 704, `in the arena: ${p.x},${p.y},${p.z}`);
    }
  }
  assert.ok(ended, 'frags: ' + g.scores().map((s) => s.frags).join(','));
  assert.ok(picks > 20, `pickups ${picks}`);
  console.log(`match time ${Math.round(g.time)} s, pickups ${picks}`);
});

test('the host handles a client and bad messages', () => {
  const sent = [];
  const host = new GameHost({ bots: 2, seed: 3 });
  assert.equal(host.bots.size, 2);
  const c = host.connect({ send: (m) => sent.push(m), close() {} });
  c.message(null); c.message({ t: 'c', c: [[1, 2, 3]] }); c.message({ t: 'join', name: 'x'.repeat(50) + '\n' });
  assert.equal(host.bots.size, 1);
  c.message({ t: 'c', c: [[1, 9, NaN, 3, 0, 0, 0], [2, 9, -9, 3, 0, 99, 77]] });
  for (let i = 0; i < 4; i++) host.step();
  const snap = sent.filter((m) => m.t === 's').pop();
  assert.equal(snap.ack, 2);
  assert.equal(snap.p.length, 2);
  assert.equal(sent.find((m) => m.t === 'info').players.find((p) => !p.bot).name.length, 16);
  host.setBots(4, 2, false);
  assert.equal(host.bots.size, 4);
  host.setBots(0);
  assert.equal(host.bots.size, 0);
  c.close();
  assert.equal(host.game.players.size, 0);
});

test('lag compensation hits a target at its position in the past', () => {
  const run = (useViewTime) => {
    const g = new Game(buildMap(), { seed: 1, spawnProtect: 0 });
    const a = g.addPlayer(1, 'a'), b = g.addPlayer(2, 'b');
    // Player "a" looks along -z. Player "b" crosses the line of fire.
    a.x = 0; a.y = 24; a.z = 700; a.weapons |= 1 << W_RAIL; a.ammo[W_RAIL] = 5; a.weapon = a.wantWeapon = W_RAIL;
    b.x = -100; b.y = 24; b.z = 400;
    let seenAt = 0;
    for (let i = 0; i < 40; i++) {
      g.runCmd(b, cmd({ side: 1, yaw: 0 }));
      g.tick();
      if (!seenAt && Math.abs(b.x) < 2) seenAt = g.time;
    }
    assert.ok(seenAt > 0 && Math.abs(b.x) > 40, `target position ${b.x}`);
    const health = b.health;
    g.runCmd(a, cmd({ buttons: BTN_FIRE, yaw: 0, weapon: -1, vt: useViewTime ? seenAt : 0 }));
    return health - b.health;
  };
  assert.equal(run(false), 0);
  assert.ok(run(true) > 0);
});

test('the host removes a human player with kick', () => {
  const sent = [];
  let closed = false;
  const host = new GameHost({ bots: 1, botFill: false, seed: 4 });
  const c = host.connect({ send: (m) => sent.push(m), close() { closed = true; } });
  c.message({ t: 'join', name: 'guest' });
  const id = sent.find((m) => m.t === 'welcome').id;
  const botId = [...host.bots.keys()][0];
  assert.equal(host.kick(botId), null);
  assert.equal(host.kick(999), null);
  assert.equal(host.kick(id), 'guest');
  assert.ok(closed);
  assert.equal(host.humanCount(), 0);
  assert.equal(host.game.players.has(id), false);
});

test('spawn protection stops damage until the player fires', () => {
  const g = new Game(buildMap(), { seed: 1, spawnProtect: 2 });
  const a = g.addPlayer(1, 'a'), b = g.addPlayer(2, 'b');
  g.damage(b, a, 50, 1, 0, 0, W_MG);
  assert.equal(b.health, 125);
  assert.equal(g.sharedSnapshot().p.find((p) => p[0] === 2)[7] & 8, 8);
  // The protection stops when the player fires.
  g.fire(b);
  g.damage(b, a, 50, 1, 0, 0, W_MG);
  assert.equal(b.health, 75);
  // The protection stops after the time.
  for (let i = 0; i < 130; i++) g.tick();
  assert.equal(g.sharedSnapshot().p.find((p) => p[0] === 1)[7] & 8, 0);
  g.damage(a, b, 50, 1, 0, 0, W_MG);
  assert.equal(a.health, 75 - 2);
});
