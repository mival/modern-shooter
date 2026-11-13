// Runs a match with bots only and prints what the bots did.
// Usage: node tools/bot-match.mjs [seconds] [bots] [skill]
import { GameHost } from '../shared/host.js';

const [seconds = 300, bots = 6, skill = 3] = process.argv.slice(2).map(Number);
for (const seed of [7, 8, 9]) {
  const host = new GameHost({ bots, botSkill: skill, botFill: false, fragLimit: 0, timeLimit: 0, seed });
  const g = host.game;
  const picks = {}, pads = { n: 0 };
  let kills = 0, upper = 0, samples = 0;
  for (let i = 0; i < 60 * seconds; i++) {
    host.step();
    for (const e of g.events) {
      if (e.t === 'pickup') { const k = g.items[e.i].type; picks[k] = (picks[k] || 0) + 1; }
      if (e.t === 'kill') kills++;
      if (e.t === 'pad') pads.n++;
    }
    g.events = [];
    if (i % 30 === 0) for (const p of g.players.values()) { samples++; if (p.y > 150) upper++; }
  }
  const key = ['amp', 'mega', 'weapon_rail', 'armor100', 'weapon_rl'].map((k) => `${k} ${picks[k] || 0}`).join(', ');
  console.log(`seed ${seed}: kills each minute ${(kills * 60 / seconds).toFixed(1)}, pad uses ${pads.n}, time on the top level ${Math.round(100 * upper / samples)}%, ${key}`);
}
