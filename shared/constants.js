// Shared constants for the client and the server.

export const GAME_ID = 'slipstream-arena';
export const TICK_RATE = 60;
export const TICK = 1 / TICK_RATE;
// The server sends one snapshot each SNAP_EVERY ticks.
export const SNAP_EVERY = 2;
export const DEFAULT_PORT = 27960;

// Movement values. One unit is approximately 2.5 cm.
export const PM = {
  speed: 320,
  gravity: 800,
  jumpVel: 270,
  friction: 6,
  stopSpeed: 100,
  accel: 10,
  airAccel: 1,
  stepSize: 18,
  hx: 15, // Half of the player box width.
  minY: -24, // Box bottom, relative to the player origin.
  maxY: 32, // Box top, relative to the player origin.
  eye: 26, // Eye height, relative to the player origin.
};

export const BTN_FIRE = 1;
export const BTN_JUMP = 2;

export const W_MG = 0;
export const W_SG = 1;
export const W_RL = 2;
export const W_ARC = 3;
export const W_RAIL = 4;
export const W_PG = 5;

export const AMMO_MAX = 200;

export const WEAPONS = [
  { id: 'mg', name: 'Machine Gun', kind: 'bullet', damage: 7, reload: 0.1, spread: 0.025, pellets: 1, ammoGive: 50, ammoBox: 50, color: 0xffd24a },
  { id: 'sg', name: 'Shotgun', kind: 'bullet', damage: 10, reload: 1.0, spread: 0.085, pellets: 11, ammoGive: 10, ammoBox: 10, color: 0xff8a3c },
  { id: 'rl', name: 'Rocket Launcher', kind: 'projectile', damage: 100, splash: 100, radius: 120, speed: 900, reload: 0.8, ammoGive: 10, ammoBox: 5, color: 0xff4444 },
  { id: 'arc', name: 'Arc Gun', kind: 'beam', damage: 8, reload: 0.05, range: 768, ammoGive: 100, ammoBox: 60, color: 0x9ad8ff },
  { id: 'rail', name: 'Railgun', kind: 'rail', damage: 100, reload: 1.5, ammoGive: 10, ammoBox: 10, color: 0x4dff88 },
  { id: 'pg', name: 'Plasma Rifle', kind: 'projectile', damage: 20, splash: 15, radius: 20, speed: 2000, reload: 0.1, ammoGive: 50, ammoBox: 30, color: 0x7a8cff },
];

export const SPAWN_HEALTH = 125;
export const SPAWN_AMMO = 100;
export const ARMOR_ABSORB = 0.66;
export const AMP_FACTOR = 3;
export const KNOCKBACK = 5;
export const HITSCAN_RANGE = 8192;
export const RESPAWN_DELAY = 1.7;
export const RESPAWN_FORCE = 5;
export const INTERMISSION_TIME = 10;

// Item types. "respawn" is the time in seconds until the item comes back.
export const ITEMS = {
  health5: { kind: 'health', amount: 5, max: 200, respawn: 35, label: '+5 Health' },
  health25: { kind: 'health', amount: 25, max: 100, respawn: 35, label: '+25 Health' },
  health50: { kind: 'health', amount: 50, max: 100, respawn: 35, label: '+50 Health' },
  mega: { kind: 'health', amount: 100, max: 200, respawn: 60, label: 'Mega Health' },
  shard: { kind: 'armor', amount: 5, respawn: 25, label: '+5 Armor' },
  armor50: { kind: 'armor', amount: 50, respawn: 25, label: 'Armor' },
  armor100: { kind: 'armor', amount: 100, respawn: 25, label: 'Heavy Armor' },
  amp: { kind: 'amp', duration: 30, respawn: 120, firstSpawn: 30, label: 'Amplifier' },
};
WEAPONS.forEach((w, i) => {
  ITEMS['weapon_' + w.id] = { kind: 'weapon', weapon: i, respawn: 5, label: w.name };
  ITEMS['ammo_' + w.id] = { kind: 'ammo', weapon: i, respawn: 40, label: w.name + ' ammo' };
});

export const BOT_NAMES = ['Vex', 'Ohm', 'Kilo', 'Tessa', 'Brink', 'Nova', 'Quill', 'Rook', 'Sable', 'Juno', 'Pike', 'Echo'];
