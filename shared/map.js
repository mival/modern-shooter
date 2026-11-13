// The arenas. Axis-aligned boxes make each level.
// The Y axis points up.
import { PM } from './constants.js';

const FLOOR = -PM.minY; // Height of the player origin above a floor.
const signs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Returns the lists of a new map and the functions that add to them.
// The y value of an item, a spawn point and a node is the height of the floor below it.
function newMap(name, size) {
  const m = { name, size, brushes: [], items: [], spawns: [], pads: [], nodes: [] };
  return {
    m,
    box(x1, y1, z1, x2, y2, z2, c, invisible = false) {
      m.brushes.push({
        min: [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)],
        max: [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)],
        c, invisible,
      });
    },
    item(type, x, y, z) { m.items.push({ type, pos: [x, y + FLOOR, z] }); },
    // A new player looks at the center of the arena.
    spawn(x, y, z) { m.spawns.push({ pos: [x, y + FLOOR, z], yaw: Math.atan2(x, z) }); },
    // A jump pad pushes the player up. It does not change the horizontal movement.
    // "top" is the height that the player origin reaches. "land" is where the bots go after the pad.
    pad(x, z, hw, top, land) {
      m.pads.push({
        min: [x - hw, 0, z - hw], max: [x + hw, 32, z + hw],
        pos: [x, FLOOR, z], land,
        up: Math.sqrt(2 * PM.gravity * (top - FLOOR)),
      });
    },
    // A navigation point for the bots.
    node(x, y, z) { m.nodes.push([x, y + FLOOR, z]); },
    // The floor, four walls, and a ceiling that the players do not see.
    shell(height) {
      const s = size, o = size + 64;
      this.box(-s, -64, -s, s, 0, s, 'floor');
      this.box(-o, 0, -o, -s, height, o, 'wall');
      this.box(s, 0, -o, o, height, o, 'wall');
      this.box(-s, 0, -o, s, height, -s, 'wall');
      this.box(-s, 0, s, s, height, o, 'wall');
      this.box(-o, height, -o, o, height + 64, o, 'wall', true);
    },
  };
}

// "Crossfire Yard": a large open arena with four corner platforms.
function buildYard() {
  const { m, box, item, spawn, pad, node, shell } = bind(newMap('Crossfire Yard', 1024));
  const UP = 192; // Height of the top level.
  shell(704);

  // Center pedestal.
  box(-112, 0, -112, 112, 128, 112, 'ped');

  for (const [sx, sz] of signs) {
    // Corner platform.
    box(sx * 640, 0, sz * 640, sx * 1024, UP, sz * 1024, 'plat');
    // Stairs along the east wall and the west wall.
    for (let i = 0; i < 12; i++) {
      box(sx * 864, 0, sz * (256 + 32 * i), sx * 1024, 16 * (i + 1), sz * 640, 'stair');
    }
    // Pillar.
    box(sx * 400, 0, sz * 400, sx * 496, 288, sz * 496, 'pillar');
    // Crate.
    box(sx * 668, 0, sz * 168, sx * 732, 64, sz * 232, 'crate');
  }
  for (const s of [1, -1]) {
    // Walkway along the north wall and the south wall.
    box(-640, UP - 24, s * 864, 640, UP, s * 1024, 'walk');
    // Low cover near the center.
    box(s * 272, 0, -128, s * 336, 40, 128, 'cover');
  }

  item('amp', 0, 128, 0);
  item('weapon_rl', 944, 0, 0);
  item('ammo_rl', 944, 0, 150);
  item('ammo_rl', 944, 0, -150);
  item('armor100', -944, 0, 0);
  item('shard', -944, 0, 150);
  item('shard', -944, 0, -150);
  item('weapon_rail', 0, UP, 944);
  item('ammo_rail', 300, UP, 944);
  item('ammo_rail', -300, UP, 944);
  item('mega', 0, UP, -944);
  item('weapon_pg', 832, UP, 832);
  item('weapon_pg', -832, UP, -832);
  item('ammo_pg', 832, UP, 700);
  item('ammo_pg', -832, UP, -700);
  item('armor50', -832, UP, 832);
  item('armor50', 832, UP, -832);
  item('weapon_sg', -520, 0, 620);
  item('weapon_sg', 520, 0, -620);
  item('ammo_sg', -420, 0, 620);
  item('ammo_sg', 420, 0, -620);
  item('weapon_arc', 520, 0, 620);
  item('weapon_arc', -520, 0, -620);
  item('ammo_arc', 420, 0, 620);
  item('ammo_arc', -420, 0, -620);
  item('ammo_mg', 640, 0, 0);
  item('ammo_mg', -640, 0, 0);
  item('health50', 0, 0, 480);
  item('health50', 0, 0, -480);
  for (const [sx, sz] of signs) item('health25', sx * 448, 0, sz * 300);
  for (const x of [-200, 0, 200]) {
    item('shard', x, 0, 944);
    item('health5', x, 0, -944);
  }

  for (const [sx, sz] of signs) {
    spawn(sx * 760, 0, sz * 500);
    spawn(sx * 960, UP, sz * 720);
  }

  for (const s of [1, -1]) {
    // The pads are near the pedestal and the walkways. A small move in the air is sufficient to land.
    pad(0, s * 162, 40, 185, [0, 128 + FLOOR, 0]);
    pad(0, s * 786, 44, UP + 84, [0, UP + FLOOR, s * 944]);
  }

  // More navigation points for the bots.
  for (const [sx, sz] of signs) {
    node(sx * 944, 0, sz * 200);
    node(sx * 944, UP, sz * 700);
    node(sx * 560, UP, sz * 944);
    node(sx * 560, 0, sz * 120);
    node(sx * 400, 0, sz * 944);
    node(sx * 250, 0, sz * 420);
    node(sx * 580, 0, sz * 420);
  }
  for (const s of [1, -1]) {
    node(s * 300, UP, -944);
    node(s * 180, 0, 0);
  }

  return m;
}

// "Twin Deck": a small arena for 2 to 4 players. A balcony goes around a pit, and a bridge crosses it.
function buildDeck() {
  const { m, box, item, spawn, pad, node, shell } = bind(newMap('Twin Deck', 576));
  const UP = 144; // Height of the balcony and the bridge.
  shell(512);

  // Balcony along the four walls.
  box(-576, 0, 448, 576, UP, 576, 'plat');
  box(-576, 0, -576, 576, UP, -448, 'plat');
  box(448, 0, -448, 576, UP, 448, 'plat');
  box(-576, 0, -448, -448, UP, 448, 'plat');
  // Bridge between the east side and the west side.
  box(-448, UP - 16, -48, 448, UP, 48, 'walk');
  // Low platform below the bridge. A player can walk onto it.
  box(-64, 0, -64, 64, 16, 64, 'ped');
  for (const [sx, sz] of signs) box(sx * 128, 0, sz * 128, sx * 192, 200, sz * 192, 'pillar');
  // Stairs to the north balcony and the south balcony.
  for (let i = 0; i < 9; i++) {
    box(-160 + 32 * i, 0, 320, 192, 16 * (i + 1), 448, 'stair');
    box(160 - 32 * i, 0, -320, -192, 16 * (i + 1), -448, 'stair');
  }
  box(-424, 0, 64, -360, 64, 128, 'crate');
  box(424, 0, -64, 360, 64, -128, 'crate');

  item('weapon_rl', 0, 16, 0);
  item('ammo_rl', 0, 0, 150);
  item('ammo_rl', 0, 0, -150);
  item('weapon_rail', 0, UP, 0);
  item('ammo_rail', 250, UP, 0);
  item('ammo_rail', -250, UP, 0);
  item('armor100', 0, UP, 512);
  item('mega', 0, UP, -512);
  item('weapon_pg', 512, UP, -512);
  item('weapon_pg', -512, UP, 512);
  item('ammo_pg', 512, UP, -380);
  item('ammo_pg', -512, UP, 380);
  item('armor50', 512, UP, 512);
  item('armor50', -512, UP, -512);
  item('weapon_sg', -330, 0, -300);
  item('weapon_sg', 330, 0, 300);
  item('weapon_arc', 330, 0, -300);
  item('weapon_arc', -330, 0, 300);
  item('ammo_sg', -400, 0, -400);
  item('ammo_arc', 400, 0, -400);
  item('ammo_mg', 200, 0, 0);
  item('ammo_mg', -200, 0, 0);
  item('health25', 380, 0, 0);
  item('health25', -380, 0, 0);
  item('health50', 0, 0, 280);
  item('health50', 0, 0, -280);
  for (const s of [1, -1]) {
    item('shard', s * 512, UP, 120);
    item('shard', s * 512, UP, -120);
    item('health5', 250, UP, s * 512);
    item('health5', -250, UP, s * 512);
  }

  spawn(400, 0, -200);
  spawn(-400, 0, 200);
  spawn(-400, 0, -400);
  spawn(400, 0, 400);
  spawn(512, UP, -250);
  spawn(-512, UP, 250);

  pad(390, 200, 40, UP + 84, [512, UP + FLOOR, 200]);
  pad(-390, -200, 40, UP + 84, [-512, UP + FLOOR, -200]);

  node(-200, 0, 384);
  node(144, UP, 384);
  node(200, 0, -384);
  node(-144, UP, -384);
  node(512, UP, 200);
  node(-512, UP, -200);
  node(512, UP, 330);
  node(-512, UP, -330);
  node(420, UP, 0);
  node(-420, UP, 0);
  for (const [sx, sz] of signs) node(sx * 250, 0, sz * 250);

  return m;
}

// The functions of a map builder use "this". This function makes them safe to use alone.
function bind(b) {
  const out = { m: b.m };
  for (const k of ['box', 'item', 'spawn', 'pad', 'node', 'shell']) out[k] = b[k].bind(b);
  return out;
}

export const MAPS = { yard: buildYard, deck: buildDeck };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = MAP_IDS[0];

// Returns the map with the given id. An unknown id gives the first map.
export function buildMap(id = DEFAULT_MAP) {
  const key = Object.hasOwn(MAPS, id) ? id : DEFAULT_MAP;
  const map = MAPS[key]();
  map.id = key;
  return map;
}
