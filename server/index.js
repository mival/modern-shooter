#!/usr/bin/env node
// The dedicated server. It runs the game, accepts WebSocket clients,
// and serves the built web client over HTTP.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameHost } from '../shared/host.js';
import { TICK_RATE, DEFAULT_PORT } from '../shared/constants.js';
import { MAPS, MAP_IDS } from '../shared/map.js';
import { encodeSnapshot, decodeCmds } from '../shared/codec.js';

const OPTIONS = {
  port: { env: 'PORT', def: DEFAULT_PORT, help: 'TCP port for HTTP and WebSocket' },
  host: { env: 'HOST', def: '0.0.0.0', help: 'Network address to listen on' },
  name: { env: 'SERVER_NAME', def: 'Slipstream Arena server', help: 'Server name' },
  maxclients: { env: 'MAX_CLIENTS', def: 12, help: 'Maximum number of human players' },
  bots: { env: 'BOTS', def: 4, help: 'Number of bots. 0 sets the bots to off' },
  botskill: { env: 'BOT_SKILL', def: 3, help: 'Bot skill from 1 to 5' },
  botfill: { env: 'BOT_FILL', def: 'on', help: 'on: a bot leaves when a player joins. off: the bot count is constant' },
  doublejump: { env: 'DOUBLE_JUMP', def: 'off', help: 'on: a player can jump one more time in the air' },
  instakill: { env: 'INSTAKILL', def: 'off', help: 'on: each player has only the Hammer and the Railgun, and a Railgun hit kills at once' },
  fraglimit: { env: 'FRAG_LIMIT', def: 20, help: 'Frags that end a match. 0 sets no limit' },
  timelimit: { env: 'TIME_LIMIT', def: 10, help: 'Match time in minutes. 0 sets no limit' },
  maps: { env: 'MAPS', def: MAP_IDS.join(','), help: `Map rotation, a list with commas. The first map starts. Maps: ${MAP_IDS.join(', ')}` },
  votes: { env: 'VOTES', def: 'on', help: 'on: players can vote to change the map and other settings' },
  spawnprotect: { env: 'SPAWN_PROTECT', def: 2, help: 'Seconds without damage after a spawn. 0 sets it to off' },
  config: { env: 'CONFIG_FILE', def: '', help: 'File that keeps the settings that change during a game. Empty: the server does not save them' },
  rconpassword: { env: 'RCON_PASSWORD', def: '', help: 'Password for the remote console, 8 characters or more. Empty sets the remote console to off' },
};

function readOptions() {
  const o = {};
  for (const [k, d] of Object.entries(OPTIONS)) o[k] = process.env[d.env] ?? d.def;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (key === 'help' || !(key in OPTIONS) || i + 1 >= args.length) {
      console.log('Usage: node server/index.js [options]\n');
      for (const [k, d] of Object.entries(OPTIONS)) {
        console.log(`  --${k.padEnd(13)} ${d.help} (default: ${d.def === '' ? 'empty' : d.def}, environment: ${d.env})`);
      }
      process.exit(key === 'help' ? 0 : 1);
    }
    o[key] = args[++i];
  }
  const num = (k, lo, hi) => {
    const v = Number(o[k]);
    if (!Number.isInteger(v) || v < lo || v > hi) {
      console.error(`Option --${k} must be an integer from ${lo} to ${hi}.`);
      process.exit(1);
    }
    return v;
  };
  const maps = String(o.maps).split(',').map((s) => s.trim()).filter(Boolean);
  if (!maps.length || maps.some((id) => !Object.hasOwn(MAPS, id))) {
    console.error(`Option --maps must be a list of these maps: ${MAP_IDS.join(', ')}.`);
    process.exit(1);
  }
  const rconPassword = String(o.rconpassword);
  if (rconPassword && rconPassword.length < 8) {
    console.error('Option --rconpassword must have 8 characters or more.');
    process.exit(1);
  }
  return {
    rconPassword, maps, configFile: String(o.config),
    port: num('port', 1, 65535), host: String(o.host), name: String(o.name),
    maxClients: num('maxclients', 1, 32), bots: num('bots', 0, 15), botSkill: num('botskill', 1, 5),
    botFill: !/^(off|0|false|no)$/i.test(String(o.botfill)),
    doubleJump: /^(on|1|true|yes)$/i.test(String(o.doublejump)),
    instakill: /^(on|1|true|yes)$/i.test(String(o.instakill)),
    votes: !/^(off|0|false|no)$/i.test(String(o.votes)),
    fragLimit: num('fraglimit', 0, 1000), timeLimit: num('timelimit', 0, 600), spawnProtect: num('spawnprotect', 0, 10),
  };
}

const opts = readOptions();
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const game = new GameHost({ ...opts, rconPassword: undefined, configFile: undefined, log });

// ---------- Saved settings ----------
// A change from the console, the remote console, or a vote goes into the config file.
// At the start, a saved setting is stronger than a start option.
function loadSettings() {
  if (!opts.configFile || !fs.existsSync(opts.configFile)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(opts.configFile, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('the content is not an object');
    game.applySettings(saved, false);
    if (!game.rotation.includes(game.mapId)) game.changeMap(game.rotation[0]);
    log(`Settings loaded from ${opts.configFile}: ${JSON.stringify(game.getSettings())}`);
  } catch (e) {
    log(`Could not read ${opts.configFile}: ${e.message}. The server uses the start options.`);
  }
}

function saveSettings(settings) {
  if (!opts.configFile) return;
  // Write a temporary file, then rename it. Then a stop during the write does not damage the file.
  const tmp = `${opts.configFile}.tmp`;
  try {
    fs.mkdirSync(path.dirname(path.resolve(opts.configFile)), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmp, opts.configFile);
  } catch (e) {
    log(`Could not save the settings to ${opts.configFile}: ${e.message}`);
  }
}

loadSettings();
game.onSettings = saveSettings;

// ---------- HTTP ----------
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(game.status()));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  // Do not serve files outside the client directory.
  if (!file.startsWith(DIST + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(fs.existsSync(DIST) ? 'Not found.' : 'The web client is not built. Run "npm run build".');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': rel.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const MAX_BUFFER = 1 << 20;
const MAX_SOCKETS = opts.maxClients + 8;

wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_SOCKETS) { ws.close(1013, 'The server is full.'); return; }
  const addr = req.socket.remoteAddress;
  const handle = game.connect({
    send(m) {
      if (ws.readyState !== ws.OPEN) return;
      // Stop a client that does not read its data.
      if (ws.bufferedAmount > MAX_BUFFER) { ws.terminate(); return; }
      // Snapshots go as binary data. All other messages are JSON text.
      if (m.t === 's') ws.send(encodeSnapshot(m), { binary: true });
      else ws.send(JSON.stringify(m));
    },
    close() { ws.close(); },
  });
  let joined = false;
  // Close a connection that does not join in 10 seconds.
  const timer = setTimeout(() => { if (!joined) ws.close(); }, 10000);
  ws.on('message', (data, binary) => {
    if (binary) {
      // Binary data from a client is a list of input commands.
      const list = decodeCmds(data);
      if (list) handle.message({ t: 'c', c: list });
      return;
    }
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m && m.t === 'rcon') {
      rcon(m, addr, (text) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'print', text })); });
      return;
    }
    if (m && m.t === 'join' && !joined) { joined = true; log(`Connection from ${addr}`); }
    handle.message(m);
  });
  ws.on('close', () => { clearTimeout(timer); handle.close(); });
  ws.on('error', () => ws.terminate());
});

// ---------- Game loop ----------
// Tick time statistics. A tick must take less than 16.7 ms.
const tickStats = { at: performance.now(), n: 0, sum: 0, max: 0, slow: 0, dropped: 0 };
function resetTickStats(now) { Object.assign(tickStats, { at: now, n: 0, sum: 0, max: 0, slow: 0, dropped: 0 }); }
function tickLine() {
  const s = tickStats;
  return `ticks: ${s.n}, average ${(s.sum / Math.max(1, s.n)).toFixed(2)} ms, longest ${s.max.toFixed(1)} ms, slow ${s.slow}, dropped ${s.dropped}`;
}
const STEP_MS = 1000 / TICK_RATE;
let last = performance.now(), acc = 0, idle = false;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  // The simulation stops when no human player is connected.
  const nowIdle = game.humanCount() === 0;
  if (nowIdle !== idle) { idle = nowIdle; log(idle ? 'No players. The simulation stops.' : 'The simulation runs.'); }
  if (idle) { acc = 0; return; }
  if (acc > STEP_MS * 10) { tickStats.dropped += Math.floor(acc / STEP_MS) - 10; acc = STEP_MS * 10; }
  while (acc >= STEP_MS) {
    const t = performance.now();
    game.step();
    const ms = performance.now() - t;
    tickStats.n++; tickStats.sum += ms;
    if (ms > tickStats.max) tickStats.max = ms;
    if (ms > STEP_MS) tickStats.slow++;
    acc -= STEP_MS;
  }
  // Write the tick times to the log one time each minute.
  if (now - tickStats.at >= 60000) { if (tickStats.n) log(tickLine()); resetTickStats(now); }
}, 4);

// ---------- Commands ----------
// The local console and the remote console (rcon) use the same commands.
// "out" is a function that writes one line of the answer.
const HELP = 'status | bots <count> [skill 1-5] | botfill <on|off> | doublejump <on|off> | instakill <on|off> | fraglimit <n> | timelimit <minutes> | spawnprotect <seconds> | map <id> | nextmap | maps [id,id] | votes <on|off> | resetconfig | restart | kick <player id> | say <text> | quit';
const COMMANDS = {
  help(out) { out(HELP); },
  status(out) {
    const s = game.status();
    out(`This minute: ${tickLine()}`);
    out(`${s.name} | map ${s.map} (${s.mapId}), rotation ${game.rotation.join(',')} | players ${s.players}/${s.maxClients} | bots ${s.bots} (${game.botFill ? `fill on: ${game.botCount} players in total` : 'fill off'}, skill ${game.botSkill}) | double jump ${s.doubleJump ? 'on' : 'off'} | instakill ${s.instakill ? 'on' : 'off'} | frag limit ${game.game.fragLimit} | time limit ${game.game.timeLimit / 60} min | spawn protection ${game.game.spawnProtect} s`);
    for (const p of game.game.scores()) out(`  ${String(p.id).padStart(3)} ${p.name.padEnd(16)} ${p.bot ? 'bot  ' : 'human'} frags ${p.frags} deaths ${p.deaths}`);
  },
  bots(out, count, skill) {
    const n = Number(count), s = skill === undefined ? undefined : Number(skill);
    if (!Number.isInteger(n) || n < 0 || n > 15 || (s !== undefined && !(Number.isInteger(s) && s >= 1 && s <= 5))) return out('Usage: bots <0-15> [skill 1-5]');
    // This command sets the exact number of bots. Thus it sets the bot fill to off.
    const hadFill = game.botFill;
    game.applySettings({ bots: n, botSkill: s, botFill: false });
    out(`Bots: ${game.bots.size}, skill ${game.botSkill}.${hadFill ? ' Bot fill is now off.' : ''}`);
  },
  botfill(out, v) {
    if (v === 'on' || v === 'off') game.applySettings({ botFill: v === 'on' });
    out(game.botFill
      ? `Bot fill: on. The server keeps ${game.botCount} players in total. A bot leaves when a player joins. Active bots: ${game.bots.size}`
      : `Bot fill: off. The number of bots is constant. Active bots: ${game.bots.size}`);
  },
  doublejump(out, v) {
    if (v === 'on' || v === 'off') game.applySettings({ doubleJump: v === 'on' });
    out(`Double jump: ${game.game.world.doubleJump ? 'on' : 'off'}`);
  },
  instakill(out, v) {
    if (v === 'on' || v === 'off') game.applySettings({ instakill: v === 'on' });
    out(`Instakill mode: ${game.game.instakill ? 'on' : 'off'}`);
  },
  fraglimit(out, v) {
    const n = Number(v);
    if (v !== undefined) game.applySettings({ fragLimit: n });
    out(`Frag limit: ${game.game.fragLimit}`);
  },
  timelimit(out, v) {
    const n = Number(v);
    if (v !== undefined) game.applySettings({ timeLimit: n });
    out(`Time limit: ${game.game.timeLimit / 60} minutes`);
  },
  spawnprotect(out, v) {
    if (v !== undefined) game.applySettings({ spawnProtect: Number(v) });
    out(`Spawn protection: ${game.game.spawnProtect ? game.game.spawnProtect + ' seconds' : 'off'}`);
  },
  map(out, id) {
    if (id === undefined) return out(`Map: ${game.mapId}. Maps: ${MAP_IDS.join(', ')}`);
    out(game.changeMap(id) ? `Map: ${game.mapId}` : `Unknown map "${id}". Maps: ${MAP_IDS.join(', ')}`);
  },
  nextmap(out) { game.changeMap(game.nextMapId()); out(`Map: ${game.mapId}`); },
  maps(out, list) {
    if (list !== undefined) {
      const ids = list.split(',').filter(Boolean);
      if (!ids.length || ids.some((id) => !Object.hasOwn(MAPS, id))) return out(`Usage: maps <id,id>. Maps: ${MAP_IDS.join(', ')}`);
      game.applySettings({ maps: ids });
    }
    out(`Map rotation: ${game.rotation.join(', ')}`);
  },
  votes(out, v) {
    if (v === 'on' || v === 'off') game.applySettings({ votes: v === 'on' });
    out(`Votes: ${game.votesOn ? 'on' : 'off'}`);
  },
  resetconfig(out) {
    if (!opts.configFile) return out('The server has no config file.');
    try { fs.rmSync(opts.configFile, { force: true }); } catch (e) { return out(`Could not remove ${opts.configFile}: ${e.message}`); }
    out(`Removed ${opts.configFile}. The server uses its start options after the next start.`);
  },
  restart(out) { game.game.restart(); out('The match starts again.'); },
  kick(out, id) {
    const name = game.kick(Number(id));
    out(name ? `Removed ${name}.` : 'Usage: kick <player id>. The "status" command shows the ids of the human players.');
  },
  say(out, ...words) {
    const text = words.join(' ').slice(0, 120);
    if (text) game.broadcast({ t: 'chat', name: 'server', text });
    out(text ? 'Sent.' : 'Usage: say <text>');
  },
  quit(out) { out('The server stops.'); shutdown(); },
};

function runCommand(line, out) {
  const [name, ...args] = line.trim().split(/\s+/);
  if (!name) return;
  if (Object.hasOwn(COMMANDS, name)) COMMANDS[name](out, ...args);
  else out(`Unknown command "${name}". Type "help".`);
}

if (process.stdin.isTTY || process.env.SERVER_CONSOLE === '1') {
  readline.createInterface({ input: process.stdin }).on('line', (line) => runCommand(line, (text) => console.log(text)));
}

// ---------- Remote console (rcon) ----------
// A client sends { t: 'rcon', pw: <password>, cmd: <command> }.
const RCON_MAX_FAILS = 5;
const RCON_BLOCK_MS = 60000;
const rconHash = opts.rconPassword ? crypto.createHash('sha256').update(opts.rconPassword).digest() : null;
const rconFails = new Map();

function rcon(m, addr, reply) {
  if (!rconHash) { reply('The remote console is off on this server.'); return; }
  const now = Date.now();
  let f = rconFails.get(addr);
  if (f && f.until && now >= f.until) { rconFails.delete(addr); f = undefined; }
  if (f && f.until) { reply('Too many incorrect passwords. Try again in one minute.'); return; }
  // Compare the hashes in constant time. Then the time of the answer does not show the password.
  const given = crypto.createHash('sha256').update(typeof m.pw === 'string' ? m.pw : '').digest();
  if (!crypto.timingSafeEqual(given, rconHash)) {
    f = f || { n: 0, until: 0 };
    f.n++;
    if (f.n >= RCON_MAX_FAILS) { f.until = now + RCON_BLOCK_MS; log(`rcon: ${addr} is blocked for one minute after ${f.n} incorrect passwords`); }
    else log(`rcon: incorrect password from ${addr}`);
    rconFails.set(addr, f);
    if (rconFails.size > 1000) rconFails.delete(rconFails.keys().next().value);
    reply('The remote console password is not correct.');
    return;
  }
  rconFails.delete(addr);
  const cmd = typeof m.cmd === 'string' ? m.cmd.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) : '';
  if (!cmd) { reply('The password is correct. ' + HELP); return; }
  log(`rcon from ${addr}: ${cmd}`);
  let lines = 0;
  runCommand(cmd, (text) => { if (lines++ < 40) reply(text); });
}

function shutdown() {
  log('The server stops.');
  game.print('The server stops.');
  for (const ws of wss.clients) ws.close(1001);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(opts.port, opts.host, () => {
  log(`${opts.name}: listening on http://${opts.host}:${opts.port}`);
  log(`Bots ${opts.bots} (skill ${opts.botSkill}, fill ${opts.botFill ? 'on' : 'off'}), frag limit ${opts.fragLimit}, time limit ${opts.timeLimit} min, max clients ${opts.maxClients}, maps ${opts.maps.join(',')}, double jump ${opts.doubleJump ? 'on' : 'off'}, instakill ${opts.instakill ? 'on' : 'off'}, remote console ${opts.rconPassword ? 'on' : 'off'}, config file ${opts.configFile || 'none'}`);
});
