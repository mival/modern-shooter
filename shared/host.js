// The game host. It connects clients and bots to the game.
// It does not know the transport. The dedicated server uses WebSocket.
// The offline mode runs the host in the browser.
import { Game } from './game.js';
import { buildMap, MAPS, DEFAULT_MAP } from './map.js';
import { Bot, buildNav } from './bot.js';
import { TICK, TICK_RATE, SNAP_EVERY, GAME_ID, BOT_NAMES, WEAPONS } from './constants.js';
import { PROTOCOL } from './codec.js';

const MAX_QUEUE = 20;
const MAX_CMDS_PER_TICK = 3;
const MAX_BOTS = 15;
// A vote stays open for this time in seconds.
const VOTE_TIME = 30;
// A player must wait this time in seconds between two votes that the player starts.
const VOTE_WAIT = 30;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Returns the valid map ids of a list, or null if the list has none.
function cleanMaps(list) {
  if (!Array.isArray(list)) return null;
  const ids = list.filter((id) => typeof id === 'string' && Object.hasOwn(MAPS, id));
  return ids.length ? ids.slice(0, 32) : null;
}

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
    // The owner of the host can set this function. The host calls it after a setting changed.
    this.onSettings = null;
    // "rotation" is the list of map ids. The host goes to the next map after each match.
    this.rotation = cleanMaps(opts.maps) || [DEFAULT_MAP];
    this.mapId = this.rotation[0];
    this.seed = opts.seed;
    // Players can vote to change settings. "vote" is the open vote, or null.
    this.votesOn = opts.votes ?? true;
    this.vote = null;
    this.game = new Game(buildMap(this.mapId), opts);
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
    const c = { transport, player: null, queue: [], lastSeq: 0, chatAt: -10, ping: 0, voteAt: -VOTE_WAIT };
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
      // A client with a different message format cannot play. The browser has an old copy of the page.
      if (m.proto !== PROTOCOL) {
        c.transport.send({ t: 'error', text: 'The game client is not the same version as the server. Load the page again.' });
        c.transport.close();
        return;
      }
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
        doubleJump: this.game.world.doubleJump, map: this.mapId,
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
    } else if (m.t === 'vote') {
      if (!c.player) return;
      if (typeof m.cmd === 'string') this.callVote(c, cleanText(m.cmd, 60));
      else if (this.vote && (m.v === 0 || m.v === 1)) {
        this.vote.yes.delete(c); this.vote.no.delete(c);
        (m.v ? this.vote.yes : this.vote.no).add(c);
        this.checkVote();
      }
    } else if (m.t === 'perf') {
      // A client reports its frame rate. Accept one report each 5 seconds.
      const v = [m.fps, m.low, m.max, m.slow];
      if (!c.player || !v.every(Number.isFinite) || this.game.time - (c.perfAt ?? -10) < 5) return;
      c.perfAt = this.game.time;
      const [fps, low, max, slow] = v.map((x) => clamp(Math.round(x), 0, 9999));
      this.log(`perf ${c.player.name}: ${fps} fps average, ${low} fps in the worst 1%, longest frame ${max} ms, ${slow} slow frames in 10 s`);
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
      if (this.vote) { this.vote.yes.delete(c); this.vote.no.delete(c); this.checkVote(); }
    }
  }

  broadcast(m) {
    for (const c of this.clients) if (c.player) c.transport.send(m);
  }

  print(text) {
    this.broadcast({ t: 'print', text });
  }

  // Removes a human player from the server. Returns the name, or null if the id is not a human player.
  kick(id) {
    for (const c of this.clients) {
      if (!c.player || c.player.id !== id) continue;
      const name = c.player.name;
      c.transport.send({ t: 'error', text: 'The server removed you from the game.' });
      c.transport.close();
      this.onClose(c);
      return name;
    }
    return null;
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

  // The time of the host in seconds. It does not start again after a map change.
  now() {
    return this.ticks / TICK_RATE;
  }

  // Changes the words of a vote into a label and an action. Returns a text if the words are not valid.
  parseVote(words) {
    const [name, a, b] = words;
    const n = Number(a), onOff = a === 'on' || a === 'off';
    const int = (lo, hi) => a !== undefined && Number.isInteger(n) && n >= lo && n <= hi;
    if (name === 'restart') return { label: 'restart the match', run: () => this.game.restart() };
    if (name === 'nextmap') return { label: 'go to the next map', run: () => this.changeMap(this.nextMapId()) };
    if (name === 'map' && Object.hasOwn(MAPS, a ?? '')) return { label: `change the map to ${a}`, run: () => this.changeMap(a) };
    if (name === 'bots' && int(0, MAX_BOTS) && (b === undefined || (Number.isInteger(Number(b)) && b >= 1 && b <= 5))) {
      const skill = b === undefined ? undefined : Number(b);
      return { label: `set ${n} bots${skill ? ' with skill ' + skill : ''}`, run: () => this.applySettings({ bots: n, botSkill: skill, botFill: false }) };
    }
    if (name === 'doublejump' && onOff) return { label: `set the double jump to ${a}`, run: () => this.applySettings({ doubleJump: a === 'on' }) };
    if (name === 'fraglimit' && int(0, 1000)) return { label: `set the frag limit to ${n}`, run: () => this.applySettings({ fragLimit: n }) };
    if (name === 'timelimit' && int(0, 600)) return { label: `set the time limit to ${n} minutes`, run: () => this.applySettings({ timeLimit: n }) };
    return `Votes: restart, nextmap, map <${Object.keys(MAPS).join('|')}>, bots <0-${MAX_BOTS}> [skill 1-5], doublejump <on|off>, fraglimit <n>, timelimit <minutes>`;
  }

  callVote(c, text) {
    const tell = (t) => c.transport.send({ t: 'print', text: t });
    if (!this.votesOn) return tell('Votes are off on this server.');
    if (this.vote) return tell('A vote is open. Type /yes or /no.');
    const wait = Math.ceil(c.voteAt + VOTE_WAIT - this.now());
    if (wait > 0) return tell(`Wait ${wait} seconds before the next vote.`);
    const action = this.parseVote(text.split(/\s+/).filter(Boolean));
    if (typeof action === 'string') return tell(action);
    c.voteAt = this.now();
    this.vote = { ...action, yes: new Set([c]), no: new Set(), end: this.now() + VOTE_TIME };
    this.log(`${c.player.name} called a vote: ${action.label}`);
    this.print(`${c.player.name} called a vote: ${action.label}. Type /yes or /no (keys F1 and F2).`);
    this.checkVote();
  }

  // Closes the vote if more than half of the human players said yes, or if that is not possible anymore.
  checkVote(timeout = false) {
    const v = this.vote;
    if (!v) return;
    const humans = this.humanCount();
    if (v.yes.size * 2 > humans && humans > 0) {
      this.vote = null;
      this.broadcast({ t: 'vote', text: '' });
      this.log(`The vote passed: ${v.label}`);
      this.print(`The vote passed: ${v.label}`);
      v.run();
    } else if (timeout || v.no.size * 2 >= humans) {
      this.vote = null;
      this.broadcast({ t: 'vote', text: '' });
      this.log(`The vote failed: ${v.label}`);
      this.print(`The vote failed: ${v.label}`);
    } else {
      this.broadcast({ t: 'vote', text: v.label, yes: v.yes.size, no: v.no.size, left: Math.ceil(v.end - this.now()) });
    }
  }

  // Starts a new match on the given map. The players stay connected.
  changeMap(id) {
    if (!Object.hasOwn(MAPS, id)) return false;
    const old = this.game;
    this.mapId = id;
    this.game = new Game(buildMap(id), {
      fragLimit: old.fragLimit, timeLimit: old.timeLimit / 60, spawnProtect: old.spawnProtect,
      doubleJump: old.world.doubleJump, seed: this.seed === undefined ? undefined : this.seed + this.ticks,
    });
    // The navigation graph and the bots belong to the old map.
    this.nav = null;
    this.bots.clear();
    this.broadcast({ t: 'map', map: id });
    for (const c of this.clients) {
      if (!c.player) continue;
      c.player = this.game.addPlayer(c.player.id, c.player.name, false);
      c.queue.length = 0;
      // The game time starts again at zero.
      c.chatAt = -10; c.perfAt = -10;
    }
    this.balanceBots();
    this.log(`Map: ${this.game.map.name} (${id})`);
    this.print(`Map: ${this.game.map.name}`);
    return true;
  }

  nextMapId() {
    const i = this.rotation.indexOf(this.mapId);
    return this.rotation[(i + 1) % this.rotation.length];
  }

  // Returns the settings that an operator can change during a game.
  getSettings() {
    const g = this.game;
    return {
      bots: this.botCount, botSkill: this.botSkill, botFill: this.botFill,
      doubleJump: g.world.doubleJump, fragLimit: g.fragLimit, timeLimit: g.timeLimit / 60,
      spawnProtect: g.spawnProtect, maps: this.rotation.slice(), votes: this.votesOn,
    };
  }

  // Applies new values for some settings. The function ignores a value that is not valid.
  // Returns true if a setting changed.
  applySettings(v, notify = true) {
    const g = this.game, before = JSON.stringify(this.getSettings());
    const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
    const bots = int(v.bots, 0, MAX_BOTS) ? v.bots : this.botCount;
    const skill = int(v.botSkill, 1, 5) && v.botSkill !== this.botSkill ? v.botSkill : undefined;
    const fill = typeof v.botFill === 'boolean' ? v.botFill : this.botFill;
    if (bots !== this.botCount || skill !== undefined || fill !== this.botFill) this.setBots(bots, skill, fill);
    if (typeof v.doubleJump === 'boolean' && v.doubleJump !== g.world.doubleJump) this.setDoubleJump(v.doubleJump);
    if (int(v.fragLimit, 0, 1000) && v.fragLimit !== g.fragLimit) {
      g.fragLimit = v.fragLimit;
      this.broadcast({ t: 'cfg', fragLimit: g.fragLimit });
    }
    if (int(v.timeLimit, 0, 600)) g.timeLimit = v.timeLimit * 60;
    if (Number.isFinite(v.spawnProtect) && v.spawnProtect >= 0 && v.spawnProtect <= 10) g.spawnProtect = v.spawnProtect;
    if (cleanMaps(v.maps)) this.rotation = cleanMaps(v.maps);
    if (typeof v.votes === 'boolean') this.votesOn = v.votes;
    const changed = JSON.stringify(this.getSettings()) !== before;
    if (changed && notify && this.onSettings) this.onSettings(this.getSettings());
    return changed;
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
    if (this.vote && this.now() >= this.vote.end) this.checkVote(true);
    // At the end of the intermission, go to the next map of the rotation.
    if (g.state === 'intermission' && g.time + TICK >= g.stateEnd && this.nextMapId() !== this.mapId) {
      this.changeMap(this.nextMapId());
      this.ticks++;
      return;
    }
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
      game: GAME_ID, name: this.name, map: this.game.map.name, mapId: this.mapId,
      players: this.humanCount(), maxClients: this.maxClients, bots: this.bots.size,
      doubleJump: this.game.world.doubleJump,
    };
  }
}
