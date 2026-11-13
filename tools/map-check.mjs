// Checks each map: no point is inside a box, and the bots can go from each spawn point to each item.
// Usage: node tools/map-check.mjs
import { buildMap, MAP_IDS } from '../shared/map.js';
import { Game } from '../shared/game.js';
import { buildNav } from '../shared/bot.js';
import { makeWorld } from '../shared/collision.js';
import { PM } from '../shared/constants.js';

export function checkMap(id) {
  const map = buildMap(id);
  const nav = buildNav(new Game(map, { seed: 1 }));
  const w = makeWorld(map);
  const problems = [];
  const points = [...map.items.map((i) => [i.type, i.pos]), ...map.spawns.map((s) => ['spawn', s.pos]), ...map.nodes.map((n) => ['node', n])];
  for (const [label, p] of points) {
    for (let i = 0, o = 0; i < w.n; i++, o += 6) {
      if (p[0] > w.b[o] - PM.hx && p[0] < w.b[o + 3] + PM.hx && p[1] > w.b[o + 1] - PM.maxY && p[1] < w.b[o + 4] - PM.minY &&
          p[2] > w.b[o + 2] - PM.hx && p[2] < w.b[o + 5] + PM.hx) problems.push(`${label} at ${p} is inside a box`);
    }
  }
  const first = map.items.length;
  map.spawns.forEach((sp, s) => {
    const seen = new Set([first + s]), todo = [first + s];
    while (todo.length) for (const e of nav.nodes[todo.pop()].edges) if (!seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
    map.items.forEach((it, i) => { if (!seen.has(i)) problems.push(`no path from spawn ${s} to ${it.type} at ${it.pos}`); });
  });
  return { map, nodes: nav.nodes.length, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of MAP_IDS) {
    const r = checkMap(id);
    console.log(`${id} (${r.map.name}): ${r.map.brushes.length} boxes, ${r.map.items.length} items, ${r.map.spawns.length} spawn points, ${r.nodes} nodes, problems: ${r.problems.length}`);
    for (const p of r.problems) console.log('  ' + p);
  }
}
