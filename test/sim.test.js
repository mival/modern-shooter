import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../shared/map.js';
import { makeWorld } from '../shared/collision.js';
import { pmove, newMoveState } from '../shared/pmove.js';
import { Game } from '../shared/game.js';
import { GameHost } from '../shared/host.js';
import { buildNav } from '../shared/bot.js';
import { TICK, PM, BTN_JUMP, BTN_FIRE, W_RL } from '../shared/constants.js';

const map = buildMap();
const world = makeWorld(map);
const cmd = (o = {}) => ({ seq: 0, fwd: 0, side: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 0, ...o });

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
  for (let i = 0; i < 40; i++) pmove(p, cmd({ fwd: 1 }), world, TICK);
  for (let i = 0; i < 120; i++) pmove(p, cmd(), world, TICK);
  assert.ok(p.ground && Math.abs(p.y - 152) < 1, `y ${p.y}`);
});

test('a rocket jump goes higher than a normal jump', () => {
  const g = new Game(buildMap(), { seed: 1 });
  const p = g.addPlayer(1, 'a');
  p.x = 0; p.y = 24; p.z = 600; p.weapons |= 1 << W_RL; p.ammo[W_RL] = 5;
  for (let i = 0; i < 30; i++) { g.runCmd(p, cmd({ weapon: W_RL, pitch: -1.5 })); g.tick(); }
  let top = 0;
  g.runCmd(p, cmd({ weapon: W_RL, pitch: -1.5, buttons: BTN_JUMP | BTN_FIRE })); g.tick();
  for (let i = 0; i < 90; i++) { g.runCmd(p, cmd({ weapon: W_RL, pitch: -1.5 })); g.tick(); top = Math.max(top, p.y); }
  assert.ok(top - 24 > 150, `height ${top - 24}`);
  assert.ok(p.health < 125 && p.health > 0);
});

test('the bots can go from each spawn point to each item', () => {
  const g = new Game(buildMap(), { seed: 1 });
  const nav = buildNav(g);
  const first = map.items.length;
  for (let s = 0; s < map.spawns.length; s++) {
    const seen = new Set([first + s]);
    const todo = [first + s];
    while (todo.length) for (const e of nav.nodes[todo.pop()].edges) if (!seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
    const missing = map.items.map((it, i) => i).filter((i) => !seen.has(i)).map((i) => map.items[i].type + '@' + map.items[i].pos);
    assert.deepEqual(missing, [], `spawn ${s}`);
  }
});

test('a match with bots runs to the frag limit', () => {
  const host = new GameHost({ bots: 6, botFill: false, fragLimit: 10, timeLimit: 0, seed: 7 });
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
