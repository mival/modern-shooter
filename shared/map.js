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
    // "base" is the height of the floor below the pad.
    pad(x, z, hw, top, land, base = 0) {
      m.pads.push({
        min: [x - hw, base, z - hw], max: [x + hw, base + 32, z + hw],
        pos: [x, base + FLOOR, z], land,
        up: Math.sqrt(2 * PM.gravity * (top - base - FLOOR)),
      });
    },
    // A navigation point for the bots.
    node(x, y, z) { m.nodes.push([x, y + FLOOR, z]); },
    // The floor, four walls, and a ceiling that the players do not see.
    // "sx" and "sz" are the half sizes of the arena. The default is a square.
    shell(height, sx = size, sz = size) {
      const ox = sx + 64, oz = sz + 64;
      // The client uses these values for the camera that shows the full arena.
      m.half = [sx, sz]; m.height = height;
      this.box(-sx, -64, -sz, sx, 0, sz, 'floor');
      this.box(-ox, 0, -oz, -sx, height, oz, 'wall');
      this.box(sx, 0, -oz, ox, height, oz, 'wall');
      this.box(-sx, 0, -oz, sx, height, -sz, 'wall');
      this.box(-sx, 0, sz, sx, height, oz, 'wall');
      this.box(-ox, height, -oz, ox, height + 64, oz, 'wall', true);
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

// "Long Hall": a long arena with a gallery on each side and a bridge in the middle. Good for long shots.
function buildHall() {
  const { m, box, item, spawn, pad, node, shell } = bind(newMap('Long Hall', 832));
  const UP = 128; // Height of the galleries and the bridge.
  shell(448, 448, 832);

  // A gallery along each long wall.
  box(320, 0, -832, 448, UP, 832, 'plat');
  box(-448, 0, -832, -320, UP, 832, 'plat');
  // Bridge between the galleries.
  box(-320, UP - 16, -48, 320, UP, 48, 'walk');
  // Stairs at the south end (east gallery) and at the north end (west gallery).
  for (let i = 0; i < 8; i++) {
    box(224, 0, -544 - 32 * i, 320, 16 * (i + 1), -832, 'stair');
    box(-224, 0, 544 + 32 * i, -320, 16 * (i + 1), 832, 'stair');
  }
  // Walls for cover across the hall.
  box(-320, 0, 192, -64, 96, 224, 'cover');
  box(64, 0, -224, 320, 96, -192, 'cover');
  box(40, 0, 470, 104, 64, 534, 'crate');
  box(-40, 0, -470, -104, 64, -534, 'crate');

  item('weapon_rail', 0, UP, 0);
  item('ammo_rail', 150, UP, 0);
  item('ammo_rail', -150, UP, 0);
  item('weapon_rl', 0, 0, 0);
  item('ammo_rl', 0, 0, 120);
  item('ammo_rl', 0, 0, -120);
  item('mega', 0, 0, 760);
  item('armor100', 0, 0, -760);
  item('weapon_pg', 384, UP, 600);
  item('weapon_pg', -384, UP, -600);
  item('ammo_pg', 384, UP, 480);
  item('ammo_pg', -384, UP, -480);
  item('armor50', 384, UP, -300);
  item('armor50', -384, UP, 300);
  item('weapon_sg', -200, 0, 400);
  item('weapon_sg', 200, 0, -400);
  item('weapon_arc', -60, 0, 420);
  item('weapon_arc', 60, 0, -420);
  item('ammo_sg', -200, 0, 300);
  item('ammo_arc', 200, 0, -300);
  item('ammo_mg', 250, 0, 0);
  item('ammo_mg', -250, 0, 0);
  for (const [sx, sz] of signs) item('health25', sx * 180, 0, sz * 640);
  for (const s of [1, -1]) {
    item('health50', s * 384, UP, s * 80);
    item('shard', s * 384, UP, s * -560);
    item('shard', s * 384, UP, s * -660);
  }

  spawn(150, 0, 720);
  spawn(-150, 0, -720);
  spawn(-200, 0, 80);
  spawn(200, 0, -80);
  spawn(384, UP, 770);
  spawn(-384, UP, -770);
  spawn(384, UP, 200);
  spawn(-384, UP, -200);

  pad(270, 400, 40, UP + 84, [384, UP + FLOOR, 400]);
  pad(-270, -400, 40, UP + 84, [-384, UP + FLOOR, -400]);

  node(272, 0, -500);
  node(272, UP, -800);
  node(384, UP, -790);
  node(-272, 0, 500);
  node(-272, UP, 800);
  node(-384, UP, 790);
  node(384, UP, 400);
  node(-384, UP, -400);
  node(0, 0, 600);
  node(0, 0, -600);
  node(160, 0, 250);
  node(-160, 0, -250);
  node(-20, 0, 250);
  node(20, 0, -250);

  return m;
}

// "High Core": a tower with two levels in the middle of an open ring. The Amplifier is on the top.
function buildCore() {
  const { m, box, item, spawn, pad, node, shell } = bind(newMap('High Core', 768));
  const T1 = 128, T2 = 272; // Heights of the two levels of the tower.
  shell(640);

  box(-256, 0, -256, 256, T1, 256, 'plat');
  box(-160, T1, -160, 160, T2, 160, 'ped');
  // Stairs to the first level on the north side and on the south side.
  for (let i = 0; i < 8; i++) {
    box(-224 + 32 * i, 0, 256, 96, 16 * (i + 1), 352, 'stair');
    box(224 - 32 * i, 0, -256, -96, 16 * (i + 1), -352, 'stair');
  }
  for (const [sx, sz] of signs) {
    box(sx * 512, 0, sz * 512, sx * 608, 224, sz * 608, 'pillar');
    box(sx * 380, 0, sz * 40, sx * 444, 64, sz * 104, 'crate');
  }
  for (const s of [1, -1]) box(-160, 0, s * 560, 160, 48, s * 592, 'cover');

  item('amp', 0, T2, 0);
  item('weapon_rail', 0, T1, 208);
  item('ammo_rail', -208, T1, 208);
  item('mega', 0, T1, -208);
  item('armor50', 208, T1, -208);
  item('armor50', -208, T1, 208);
  item('shard', 208, T1, 208);
  item('shard', -208, T1, -208);
  item('weapon_rl', 680, 0, 0);
  item('ammo_rl', 680, 0, 140);
  item('ammo_rl', 680, 0, -140);
  item('armor100', -680, 0, 0);
  item('shard', -680, 0, 140);
  item('shard', -680, 0, -140);
  item('weapon_pg', 0, 0, 680);
  item('weapon_pg', 0, 0, -680);
  item('ammo_pg', 140, 0, 680);
  item('ammo_pg', -140, 0, -680);
  item('weapon_sg', 400, 0, 400);
  item('weapon_sg', -400, 0, -400);
  item('weapon_arc', -400, 0, 400);
  item('weapon_arc', 400, 0, -400);
  item('ammo_sg', 300, 0, 440);
  item('ammo_arc', -300, 0, 440);
  item('ammo_mg', 0, 0, 450);
  item('ammo_mg', 0, 0, -450);
  for (const [sx, sz] of signs) item('health25', sx * 680, 0, sz * 400);
  item('health50', 480, 0, -200);
  item('health50', -480, 0, 200);

  for (const [sx, sz] of signs) spawn(sx * 690, 0, sz * 690);
  spawn(520, 0, 250);
  spawn(-520, 0, -250);
  spawn(-250, 0, 500);
  spawn(250, 0, -500);

  // From the ground to the first level, and from the first level to the top.
  pad(304, 170, 40, T1 + 84, [208, T1 + FLOOR, 208]);
  pad(-304, -170, 40, T1 + 84, [-208, T1 + FLOOR, -208]);
  pad(210, 0, 36, T2 + 64, [0, T2 + FLOOR, 0], T1);
  pad(-210, 0, 36, T2 + 64, [0, T2 + FLOOR, 0], T1);

  node(-270, 0, 304);
  node(48, T1, 304);
  node(48, T1, 208);
  node(270, 0, -304);
  node(-48, T1, -304);
  node(-48, T1, -208);
  node(208, T1, 110);
  node(-208, T1, -110);
  for (const [sx, sz] of signs) node(sx * 440, 0, sz * 640);
  for (const [sx, sz] of signs) node(sx * 640, 0, sz * 440);
  node(540, 0, 0);
  node(-540, 0, 0);

  return m;
}

// "Cross Guard": a cross of thick walls makes four rooms. The players can walk on the top of the walls.
function buildCross() {
  const { m, box, item, spawn, pad, node, shell } = bind(newMap('Cross Guard', 800));
  const UP = 160; // Height of the walls.
  shell(512);

  // The cross. A gap between each arm and the outer wall connects two rooms.
  box(-48, 0, -544, 48, UP, 544, 'plat');
  box(-544, 0, -48, -48, UP, 48, 'plat');
  box(48, 0, -48, 544, UP, 48, 'plat');
  // Stairs to the top of the cross in the north-east room and in the south-west room.
  for (let i = 0; i < 10; i++) {
    box(48, 0, 512 - 32 * i, 144, 16 * (i + 1), 160, 'stair');
    box(-48, 0, -512 + 32 * i, -144, 16 * (i + 1), -160, 'stair');
  }
  for (const [sx, sz] of signs) {
    box(sx * 568, 0, sz * 218, sx * 632, 208, sz * 282, 'pillar');
    box(sx * 218, 0, sz * 568, sx * 282, 64, sz * 632, 'crate');
  }

  item('weapon_rail', 0, UP, 0);
  item('ammo_rail', 0, UP, 120);
  item('ammo_rail', 0, UP, -120);
  item('mega', 500, UP, 0);
  item('armor100', -500, UP, 0);
  item('armor50', 0, UP, 500);
  item('armor50', 0, UP, -500);
  item('shard', 300, UP, 0);
  item('shard', -300, UP, 0);
  item('weapon_rl', 420, 0, 420);
  item('ammo_rl', 420, 0, 300);
  item('weapon_pg', -420, 0, -420);
  item('ammo_pg', -420, 0, -300);
  item('weapon_sg', -420, 0, 420);
  item('ammo_sg', -420, 0, 300);
  item('weapon_arc', 420, 0, -420);
  item('ammo_arc', 420, 0, -300);
  item('weapon_sg', 700, 0, -700);
  item('weapon_arc', -700, 0, 700);
  item('ammo_mg', 700, 0, 700);
  item('ammo_mg', -700, 0, -700);
  // Health in the gaps between the rooms.
  item('health50', 672, 0, 0);
  item('health50', -672, 0, 0);
  item('health25', 0, 0, 672);
  item('health25', 0, 0, -672);
  for (const [sx, sz] of signs) item('health5', sx * 300, 0, sz * 300);

  for (const [sx, sz] of signs) {
    spawn(sx * 660, 0, sz * 500);
    spawn(sx * 400, 0, sz * 710);
  }

  // Pads in the north-west room and in the south-east room.
  pad(-110, 300, 40, UP + 84, [0, UP + FLOOR, 300]);
  pad(110, -300, 40, UP + 84, [0, UP + FLOOR, -300]);

  node(96, 0, 590);
  node(96, UP, 176);
  node(0, UP, 176);
  node(-96, 0, -590);
  node(-96, UP, -176);
  node(0, UP, -176);
  node(0, UP, 300);
  node(0, UP, -300);
  node(150, UP, 0);
  node(-150, UP, 0);
  for (const [sx, sz] of signs) {
    node(sx * 672, 0, sz * 150);
    node(sx * 150, 0, sz * 672);
    node(sx * 250, 0, sz * 450);
  }

  return m;
}

// The functions of a map builder use "this". This function makes them safe to use alone.
function bind(b) {
  const out = { m: b.m };
  for (const k of ['box', 'item', 'spawn', 'pad', 'node', 'shell']) out[k] = b[k].bind(b);
  return out;
}

export const MAPS = { yard: buildYard, deck: buildDeck, hall: buildHall, core: buildCore, cross: buildCross };
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = MAP_IDS[0];

// Returns the map with the given id. An unknown id gives the first map.
export function buildMap(id = DEFAULT_MAP) {
  const key = Object.hasOwn(MAPS, id) ? id : DEFAULT_MAP;
  const map = MAPS[key]();
  map.id = key;
  return map;
}
