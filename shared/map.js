// The arena "Crossfire Yard". Axis-aligned boxes make the full level.
// The Y axis points up.
import { PM } from './constants.js';

const FLOOR = -PM.minY; // Height of the player origin above a floor.
const UP = 192; // Height of the top level.

export function buildMap() {
  const brushes = [];
  const box = (x1, y1, z1, x2, y2, z2, c, invisible = false) => {
    brushes.push({
      min: [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)],
      max: [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)],
      c, invisible,
    });
  };
  const signs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  box(-1024, -64, -1024, 1024, 0, 1024, 'floor');
  box(-1088, 0, -1088, -1024, 704, 1088, 'wall');
  box(1024, 0, -1088, 1088, 704, 1088, 'wall');
  box(-1024, 0, -1088, 1024, 704, -1024, 'wall');
  box(-1024, 0, 1024, 1024, 704, 1088, 'wall');
  box(-1088, 704, -1088, 1088, 768, 1088, 'wall', true);

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

  const items = [];
  const item = (type, x, y, z) => items.push({ type, pos: [x, y + FLOOR, z] });
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

  const spawns = [];
  const spawn = (x, y, z) => spawns.push({ pos: [x, y + FLOOR, z], yaw: Math.atan2(x, z) });
  for (const [sx, sz] of signs) {
    spawn(sx * 760, 0, sz * 500);
    spawn(sx * 960, UP, sz * 720);
  }

  // Jump pads. "target" is the top point of the flight path.
  const pads = [];
  const pad = (x, z, hw, target, land) => {
    const from = [x, FLOOR, z];
    const h = target[1] - from[1];
    const t = Math.sqrt(h / (0.5 * PM.gravity));
    pads.push({
      min: [x - hw, 0, z - hw], max: [x + hw, 32, z + hw],
      pos: from, land,
      vel: [(target[0] - from[0]) / t, t * PM.gravity, (target[2] - from[2]) / t],
    });
  };
  for (const s of [1, -1]) {
    pad(0, s * 272, 40, [0, 200, s * 60], [0, 128 + FLOOR, 0]);
    pad(0, s * 700, 44, [0, UP + 74, s * 900], [0, UP + FLOOR, s * 944]);
  }

  // More navigation points for the bots.
  const nodes = [];
  const node = (x, y, z) => nodes.push([x, y + FLOOR, z]);
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

  return { name: 'Crossfire Yard', brushes, items, spawns, pads, nodes };
}
