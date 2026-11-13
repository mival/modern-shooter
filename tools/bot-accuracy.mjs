// Measures how often a bot hits a target with the Machine Gun.
// Usage: node tools/bot-accuracy.mjs
import { Game } from '../shared/game.js';
import { buildMap } from '../shared/map.js';
import { Bot, buildNav } from '../shared/bot.js';
import { W_MG, WEAPONS } from '../shared/constants.js';

function run(skill, mode, seed) {
  const g = new Game(buildMap(), { seed, fragLimit: 0, timeLimit: 0 });
  const nav = buildNav(g);
  const b = g.addPlayer(1, 'bot', true), t = g.addPlayer(2, 'target');
  const bot = new Bot(g, nav, b, skill);
  let shots = 0, damage = 0, dir = 1, turnAt = 0, seen = 0;
  const cmd = { seq: 0, fwd: 0, side: 0, buttons: 0, yaw: 0, pitch: 0, weapon: -1 };
  t.x = 200; t.y = 24; t.z = 150;
  for (let i = 0; i < 60 * 40; i++) {
    // Keep the bot in one place with only the Machine Gun. The test measures the aim, not the movement.
    b.x = 200; b.y = 24; b.z = 620; b.vx = b.vz = 0; b.weapons = 1 << W_MG; b.ammo[W_MG] = 100; b.health = 100;
    t.health = 1000; t.armor = 0; t.z = 150;
    if (mode === 'dodge' && g.time >= turnAt) { dir = -dir; turnAt = g.time + 0.35 + g.rng() * 0.6; }
    if (t.x > 520) dir = -1;
    if (t.x < -120) dir = 1;
    cmd.side = mode === 'still' ? 0 : dir;
    g.runCmd(t, cmd);
    g.runCmd(b, bot.think());
    g.tick();
    for (const e of g.events) {
      if (e.t === 'shot' && e.id === 1) shots++;
      if (e.t === 'pain' && e.id === 2) damage += e.d;
    }
    g.events = [];
    if (bot.enemy) seen++;
  }
  return { shots, hits: damage / WEAPONS[W_MG].damage, seen: seen / 60 };
}

console.log('skill | target stands | target runs straight | target dodges   (hit rate, damage each second while the bot sees the target)');
for (let skill = 1; skill <= 5; skill++) {
  const cells = ['still', 'run', 'dodge'].map((mode) => {
    let shots = 0, hits = 0, seen = 0;
    for (let seed = 1; seed <= 4; seed++) { const r = run(skill, mode, seed); shots += r.shots; hits += r.hits; seen += r.seen; }
    return `${String(Math.round(100 * hits / Math.max(1, shots))).padStart(3)}% ${String(Math.round(hits * WEAPONS[W_MG].damage / Math.max(1, seen))).padStart(3)} dps`;
  });
  console.log(`  ${skill}   | ${cells.join('      | ')}`);
}
