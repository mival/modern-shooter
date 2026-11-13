#!/usr/bin/env node
// The dedicated server. It runs the game, accepts WebSocket clients,
// and serves the built web client over HTTP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameHost } from '../shared/host.js';
import { TICK_RATE, DEFAULT_PORT } from '../shared/constants.js';

const OPTIONS = {
  port: { env: 'PORT', def: DEFAULT_PORT, help: 'TCP port for HTTP and WebSocket' },
  host: { env: 'HOST', def: '0.0.0.0', help: 'Network address to listen on' },
  name: { env: 'SERVER_NAME', def: 'Slipstream Arena server', help: 'Server name' },
  maxclients: { env: 'MAX_CLIENTS', def: 12, help: 'Maximum number of human players' },
  bots: { env: 'BOTS', def: 4, help: 'Number of bots. 0 sets the bots to off' },
  botskill: { env: 'BOT_SKILL', def: 3, help: 'Bot skill from 1 to 5' },
  botfill: { env: 'BOT_FILL', def: 'on', help: 'on: a bot leaves when a player joins. off: the bot count is constant' },
  doublejump: { env: 'DOUBLE_JUMP', def: 'off', help: 'on: a player can jump one more time in the air' },
  fraglimit: { env: 'FRAG_LIMIT', def: 20, help: 'Frags that end a match. 0 sets no limit' },
  timelimit: { env: 'TIME_LIMIT', def: 10, help: 'Match time in minutes. 0 sets no limit' },
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
        console.log(`  --${k.padEnd(11)} ${d.help} (default: ${d.def}, environment: ${d.env})`);
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
  return {
    port: num('port', 1, 65535), host: String(o.host), name: String(o.name),
    maxClients: num('maxclients', 1, 32), bots: num('bots', 0, 15), botSkill: num('botskill', 1, 5),
    botFill: !/^(off|0|false|no)$/i.test(String(o.botfill)),
    doubleJump: /^(on|1|true|yes)$/i.test(String(o.doublejump)),
    fragLimit: num('fraglimit', 0, 1000), timeLimit: num('timelimit', 0, 600),
  };
}

const opts = readOptions();
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const game = new GameHost({ ...opts, log });

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
      ws.send(JSON.stringify(m));
    },
    close() { ws.close(); },
  });
  let joined = false;
  // Close a connection that does not join in 10 seconds.
  const timer = setTimeout(() => { if (!joined) ws.close(); }, 10000);
  ws.on('message', (data, binary) => {
    if (binary) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
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

// ---------- Console ----------
const COMMANDS = {
  help() {
    console.log('status | bots <count> [skill 1-5] | botfill <on|off> | doublejump <on|off> | fraglimit <n> | timelimit <minutes> | restart | say <text> | quit');
  },
  status() {
    const s = game.status();
    console.log(`This minute: ${tickLine()}`);
    console.log(`${s.name} | map ${s.map} | players ${s.players}/${s.maxClients} | bots ${s.bots} (target ${game.botCount}, skill ${game.botSkill}, fill ${game.botFill ? 'on' : 'off'}) | double jump ${s.doubleJump ? 'on' : 'off'}`);
    for (const p of game.game.scores()) console.log(`  ${String(p.id).padStart(3)} ${p.name.padEnd(16)} ${p.bot ? 'bot  ' : 'human'} frags ${p.frags} deaths ${p.deaths}`);
  },
  bots(count, skill) {
    const n = Number(count), s = skill === undefined ? undefined : Number(skill);
    if (!Number.isInteger(n) || n < 0 || n > 15 || (s !== undefined && !(s >= 1 && s <= 5))) return console.log('Usage: bots <0-15> [skill 1-5]');
    game.setBots(n, s);
    console.log(`Bots: target ${game.botCount}, skill ${game.botSkill}, active ${game.bots.size}`);
  },
  botfill(v) {
    game.setBots(game.botCount, undefined, v === 'on');
    console.log(`Bot fill: ${game.botFill ? 'on' : 'off'}`);
  },
  doublejump(v) {
    if (v === 'on' || v === 'off') game.setDoubleJump(v === 'on');
    console.log(`Double jump: ${game.game.world.doubleJump ? 'on' : 'off'}`);
  },
  fraglimit(v) { if (Number(v) >= 0) game.game.fragLimit = Number(v) | 0; console.log(`Frag limit: ${game.game.fragLimit}`); },
  timelimit(v) { if (Number(v) >= 0) game.game.timeLimit = (Number(v) | 0) * 60; console.log(`Time limit: ${game.game.timeLimit / 60} minutes`); },
  restart() { game.game.restart(); console.log('The match starts again.'); },
  say(...words) { game.broadcast({ t: 'chat', name: 'server', text: words.join(' ').slice(0, 120) }); },
  quit() { shutdown(); },
};

if (process.stdin.isTTY || process.env.SERVER_CONSOLE === '1') {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const [name, ...args] = line.trim().split(/\s+/);
    if (!name) return;
    if (COMMANDS[name]) COMMANDS[name](...args);
    else console.log(`Unknown command "${name}". Type "help".`);
  });
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
  log(`Bots ${opts.bots} (skill ${opts.botSkill}, fill ${opts.botFill ? 'on' : 'off'}), frag limit ${opts.fragLimit}, time limit ${opts.timeLimit} min, max clients ${opts.maxClients}, double jump ${opts.doubleJump ? 'on' : 'off'}`);
});
