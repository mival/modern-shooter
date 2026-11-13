// The game host. It connects clients and bots to the game.
// It does not know the transport. The dedicated server uses WebSocket.
// The offline mode runs the host in the browser.
import { Game } from './game.js';
import { buildMap } from './map.js';
import { Bot, buildNav } from './bot.js';
import { TICK_RATE, SNAP_EVERY, GAME_ID, BOT_NAMES, WEAPONS } from './constants.js';

const MAX_QUEUE = 20;
const MAX_CMDS_PER_TICK = 3;
const MAX_BOTS = 15;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export class GameHost {
  constructor(opts = {}) {
    this.name = cleanText(opts.name || 'Slipstream Arena server', 40);
    this.maxClients = opts.maxClients ?? 12;
    // "botCount" is the target number of players. Bots fill the free places.
    this.botCount = clamp(opts.bots ?? 0, 0, MAX_BOTS);
    this.botSkill = clamp(opts.botSkill ?? 3, 1, 5);
    // If "botFill" is true, a bot leaves when a human player joins.
    this.botFill = opts.botFill ?? true;
    this.log = opts.log || (() => {});
    this.game = new Game(buildMap(), opts);
    this.nav = null;
    this.clients = new Set();
    this.bots = new Map();
    this.nextId = 1;
    this.ticks = 0;
    this.balanceBots();
  }

  humanCount() {
    let n = 0;
    for (const c of this.clients) if (c.player) n++;
    return n;
  }

  // A transport calls this function for a new connection.
  // "transport" has the functions send(object) and close().
  connect(transport) {
    const c = { transport, player: null, queue: [], lastSeq: 0, chatAt: -10, ping: 0 };
    this.clients.add(c);
    return {
      message: (m) => this.onMessage(c, m),
      close: () => this.onClose(c),
    };
  }

  onMessage(c, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (c.player) return;
      if (this.humanCount() >= this.maxClients) {
        c.transport.send({ t: 'error', text: 'The server is full.' });
        c.transport.close();
        return;
      }
      const name = cleanText(m.name, 16) || 'Player';
      c.player = this.game.addPlayer(this.nextId++, name, false);
      c.transport.send({
        t: 'welcome', game: GAME_ID, id: c.player.id, server: this.name,
        tickRate: TICK_RATE, snapEvery: SNAP_EVERY,
        fragLimit: this.game.fragLimit, timeLimit: this.game.timeLimit,
        doubleJump: this.game.world.doubleJump,
      });
      this.log(`${name} joined (id ${c.player.id})`);
      this.print(`${name} entered the arena`);
      this.balanceBots();
    } else if (m.t === 'c') {
      if (!c.player || !Array.isArray(m.c) || m.c.length > 8) return;
      for (const a of m.c) {
        if (!Array.isArray(a) || (a.length !== 7 && a.length !== 8) || !a.every(Number.isFinite)) continue;
        c.queue.push({
          seq: a[0] | 0, fwd: clamp(a[1], -1, 1), side: clamp(a[2], -1, 1), buttons: a[3] & 3,
          yaw: a[4] % (Math.PI * 2), pitch: clamp(a[5], -1.55, 1.55), weapon: clamp(a[6] | 0, -1, WEAPONS.length - 1),
          vt: a.length === 8 ? a[7] : 0,
        });
      }
      if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
    } else if (m.t === 'chat') {
      const text = cleanText(m.text, 120);
      if (!c.player || !text || this.game.time - c.chatAt < 1) return;
      c.chatAt = this.game.time;
      this.broadcast({ t: 'chat', name: c.player.name, text });
      this.log(`<${c.player.name}> ${text}`);
    } else if (m.t === 'ping') {
      if (Number.isFinite(m.rtt)) c.ping = clamp(Math.round(m.rtt), 0, 999);
      if (Number.isFinite(m.n)) c.transport.send({ t: 'pong', n: m.n });
    }
  }

  onClose(c) {
    if (!this.clients.delete(c)) return;
    if (c.player) {
      this.game.removePlayer(c.player.id);
      this.log(`${c.player.name} left`);
      this.print(`${c.player.name} left the arena`);
      c.player = null;
      this.balanceBots();
    }
  }

  broadcast(m) {
    for (const c of this.clients) if (c.player) c.transport.send(m);
  }

  print(text) {
    this.broadcast({ t: 'print', text });
  }

  setBots(count, skill, fill) {
    this.botCount = clamp(count | 0, 0, MAX_BOTS);
    if (skill !== undefined) {
      this.botSkill = clamp(skill | 0, 1, 5);
      for (const id of [...this.bots.keys()]) this.removeBot(id);
    }
    if (fill !== undefined) this.botFill = !!fill;
    this.balanceBots();
  }

  setDoubleJump(on) {
    this.game.world.doubleJump = !!on;
    this.broadcast({ t: 'cfg', doubleJump: this.game.world.doubleJump });
  }

  removeBot(id) {
    this.bots.delete(id);
    this.game.removePlayer(id);
  }

  // Adds or removes bots until the bot count agrees with the settings.
  balanceBots() {
    const want = this.botFill ? Math.max(0, this.botCount - this.humanCount()) : this.botCount;
    while (this.bots.size > want) this.removeBot([...this.bots.keys()].pop());
    while (this.bots.size < want) {
      if (!this.nav) this.nav = buildNav(this.game);
      const used = new Set([...this.game.players.values()].map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + this.nextId;
      const p = this.game.addPlayer(this.nextId++, name, true);
      this.bots.set(p.id, new Bot(this.game, this.nav, p, this.botSkill));
    }
  }

  // Runs one tick. The caller calls this function TICK_RATE times each second.
  step() {
    const g = this.game;
    for (const c of this.clients) {
      if (!c.player) continue;
      for (let n = 0; n < MAX_CMDS_PER_TICK && c.queue.length; n++) {
        const cmd = c.queue.shift();
        g.runCmd(c.player, cmd);
        c.lastSeq = cmd.seq;
      }
    }
    for (const bot of this.bots.values()) g.runCmd(bot.p, bot.think());
    g.tick();
    this.ticks++;
    if (this.ticks % SNAP_EVERY === 0) {
      const shared = g.sharedSnapshot();
      const ev = g.events;
      g.events = [];
      for (const c of this.clients) {
        if (!c.player) continue;
        c.transport.send({ t: 's', ...shared, ev, ack: c.lastSeq, me: g.ownState(c.player) });
      }
      if (g.scoresDirty || this.ticks % (TICK_RATE * 2) === 0) {
        g.scoresDirty = false;
        const pings = new Map();
        for (const c of this.clients) if (c.player) pings.set(c.player.id, c.ping);
        this.broadcast({ t: 'info', players: g.scores().map((s) => ({ ...s, ping: pings.get(s.id) ?? 0 })) });
      }
    }
  }

  status() {
    return {
      game: GAME_ID, name: this.name, map: this.game.map.name,
      players: this.humanCount(), maxClients: this.maxClients, bots: this.bots.size,
      doubleJump: this.game.world.doubleJump,
    };
  }
}
