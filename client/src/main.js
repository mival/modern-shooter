// The game client. It reads the input, predicts the local movement,
// and shows the state that the game host sends.
import { buildMap, MAP_IDS, MAPS } from '../../shared/map.js';
import { makeWorld } from '../../shared/collision.js';
import { pmove, newMoveState, copyMoveState, PMF_JUMPED, PMF_PAD } from '../../shared/pmove.js';
import { TICK, PM, WEAPONS, ITEMS, GAME_ID, DEFAULT_PORT, W_HAMMER, W_RL } from '../../shared/constants.js';
import { Renderer, playerColor } from './render.js';
import { Input } from './input.js';
import { connectLocal, connectRemote } from './net.js';
import { play, unlockAudio, setVolume } from './audio.js';
import { Perf } from './perf.js';
import { PROTOCOL } from '../../shared/codec.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let map = buildMap();
let world = makeWorld(map);
const canvas = $('view');
const renderer = new Renderer(canvas, map, world);
const input = new Input(canvas);

// ---------- Settings ----------
const settings = { name: 'Player', botsOn: true, botCount: 4, botSkill: 3, fragLimit: 20, timeLimit: 10, address: '', sens: 1.5, fov: 100, volume: 0.5, quality: 'medium', renderScale: 1, doubleJump: false, instakill: false, perf: false, map: 'all' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('slipstream') || '{}')); } catch { /* Storage is not available. */ }
function saveSettings() {
  try { localStorage.setItem('slipstream', JSON.stringify(settings)); } catch { /* Storage is not available. */ }
}
const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };

function bindSettings() {
  const text = [['name', 'name'], ['address', 'address']];
  const numbers = [['botcount', 'botCount', 1, 15], ['botskill', 'botSkill', 1, 5], ['fraglimit', 'fragLimit', 0, 1000],
    ['timelimit', 'timeLimit', 0, 600], ['sens', 'sens', 0.1, 6], ['fov', 'fov', 80, 130], ['volume', 'volume', 0, 1]];
  const apply = () => {
    input.sens = settings.sens;
    perf.setVisible(settings.perf);
    renderer.setFov(settings.fov);
    renderer.setQuality(params.get('quality') || settings.quality);
    setVolume(settings.volume);
    $('botskillv').textContent = settings.botSkill;
    $('sensv').textContent = settings.sens.toFixed(2);
    $('fovv').textContent = settings.fov;
    $('volumev').textContent = Math.round(settings.volume * 100) + '%';
    $('botcount').disabled = $('botskill').disabled = !settings.botsOn;
  };
  for (const [id, key] of text) {
    $(id).value = settings[key];
    $(id).addEventListener('input', () => { settings[key] = $(id).value; saveSettings(); });
  }
  for (const [id, key, lo, hi] of numbers) {
    $(id).value = settings[key];
    $(id).addEventListener('input', () => { settings[key] = num($(id).value, lo, hi, settings[key]); saveSettings(); apply(); });
  }
  $('quality').value = settings.quality;
  // A different quality level starts at the full render scale.
  $('quality').addEventListener('change', () => { settings.quality = $('quality').value; apply(); settings.renderScale = renderer.scale; saveSettings(); });
  $('doublejump').checked = settings.doubleJump;
  $('doublejump').addEventListener('change', () => { settings.doubleJump = $('doublejump').checked; saveSettings(); });
  $('instakill').checked = settings.instakill;
  $('instakill').addEventListener('change', () => { settings.instakill = $('instakill').checked; saveSettings(); });
  $('map').replaceChildren(new Option('All maps, in rotation', 'all'), ...MAP_IDS.map((id) => new Option(MAPS[id]().name, id)));
  $('map').value = Object.hasOwn(MAPS, settings.map) ? settings.map : 'all';
  $('map').addEventListener('change', () => { settings.map = $('map').value; saveSettings(); });
  $('perfon').checked = settings.perf;
  $('perfon').addEventListener('change', () => { settings.perf = $('perfon').checked; saveSettings(); apply(); });
  $('botson').checked = settings.botsOn;
  $('botson').addEventListener('change', () => { settings.botsOn = $('botson').checked; saveSettings(); apply(); });
  apply();
  // Use the render scale from the last game, thus the first fight has no slow frames.
  if (!params.get('quality')) renderer.setScale(settings.renderScale);
}

const perf = new Perf($('perfgraph'), $('perftext'));
const frameEvents = [];

// ---------- Session state ----------
let conn = null, joined = false, myId = 0, me = null;
let seq = 0, pending = [], snaps = [];
let matchState = 'play', timeLeft = -1, fragLimit = 0;
let rtt = 0, lastPing = 0, fps = 0, frames = 0, fpsAt = 0;
// The open vote on the server, or null.
let vote = null;
// "protFired" is true after the local player fires during the spawn protection.
let protFired = false;
let stepSmooth = 0, hitUntil = 0, flash = 0, centerUntil = 0, pickupUntil = 0;
const info = new Map();
const local = newMoveState();
const prev = { x: 0, y: 0, z: 0 };
const smooth = { x: 0, y: 0, z: 0 };
const camPos = { x: 0, y: 300, z: 0 };

// Loads a map for the prediction and for the view. All state of the old match goes away.
function loadMap(id) {
  if (id === map.id) return;
  const doubleJump = world.doubleJump;
  map = buildMap(id);
  world = makeWorld(map);
  world.doubleJump = doubleJump;
  renderer.loadMap(map, world);
}

function leaveGame(message = '') {
  if (conn) conn.close();
  conn = null; joined = false; me = null; myId = 0; vote = null;
  pending = []; snaps = []; info.clear();
  renderer.setPlayers([], 0);
  renderer.setProjectiles([]);
  $('hud').hidden = true;
  $('chatlog').replaceChildren();
  $('feed').replaceChildren();
  if (document.pointerLockElement) document.exitPointerLock();
  showMenu(message);
}

function showMenu(message = '') {
  $('menu').hidden = false;
  $('status').textContent = message;
  $('ingame').hidden = !joined;
  $('applybots').hidden = !(joined && conn.local);
  $('offline').textContent = joined ? 'Start new offline game' : 'Play offline';
}

function hideMenu() {
  $('menu').hidden = true;
}

function offlineOptions() {
  return {
    bots: settings.botsOn ? settings.botCount : 0, botSkill: settings.botSkill, botFill: false,
    fragLimit: settings.fragLimit, timeLimit: settings.timeLimit, doubleJump: settings.doubleJump, instakill: settings.instakill,
    // "all" plays all maps, one after the other.
    maps: Object.hasOwn(MAPS, settings.map) ? [settings.map] : MAP_IDS,
  };
}

function startOffline() {
  leaveGame();
  conn = connectLocal(offlineOptions(), { message: onMessage });
  conn.send({ t: 'join', proto: PROTOCOL, name: settings.name });
}

function startOnline(address) {
  let url = address.trim();
  if (!url) { showMenu('Enter a server address.'); return; }
  // An address without a scheme and without a port gets the default game port.
  // An address with ws:// or wss:// stays as it is, because a server behind a proxy uses port 80 or 443.
  if (!/^wss?:\/\//.test(url)) {
    if (!/:\d+(\/|$)/.test(url)) url += ':' + DEFAULT_PORT;
    url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
  }
  leaveGame('Connecting…');
  let c;
  try {
    c = connectRemote(url, {
      open: () => c.send({ t: 'join', proto: PROTOCOL, name: settings.name }),
      message: (m) => { if (conn === c) onMessage(m); },
      close: () => { if (conn === c) leaveGame(joined ? 'The connection closed.' : 'Could not connect to the server.'); },
    });
  } catch {
    showMenu('The server address is not valid.');
    return;
  }
  conn = c;
}

// ---------- Messages from the host ----------
function onMessage(m) {
  if (m.t === 's') onSnapshot(m);
  else if (m.t === 'welcome') {
    if (m.game !== GAME_ID) { leaveGame('This is not a Slipstream Arena server.'); return; }
    myId = m.id; joined = true; fragLimit = m.fragLimit;
    loadMap(m.map);
    world.doubleJump = !!m.doubleJump;
    seq = 0; pending = [];
    $('hud').hidden = false;
    hideMenu();
    buildWeaponBar();
    if (!params.has('nolock')) input.lock();
  } else if (m.t === 'info') {
    info.clear();
    for (const p of m.players) { info.set(p.id, p); renderer.setName(p.id, p.name); }
    updateScores();
  } else if (m.t === 'map') {
    // The server started a new match on a different map.
    loadMap(m.map);
    me = null; snaps = []; pending = [];
    renderer.setPlayers([], 0);
    renderer.setProjectiles([]);
    $('feed').replaceChildren();
    center(map.name, 2500);
  } else if (m.t === 'vote') {
    vote = m.text ? { text: m.text, yes: m.yes, no: m.no, end: performance.now() + m.left * 1000 } : null;
  } else if (m.t === 'chat') addChat(m.name, m.text);
  else if (m.t === 'print') addChat(null, m.text);
  else if (m.t === 'cfg') {
    if (m.doubleJump !== undefined) { world.doubleJump = !!m.doubleJump; addChat(null, `Double jump is ${world.doubleJump ? 'on' : 'off'}`); }
    if (Number.isFinite(m.fragLimit)) { fragLimit = m.fragLimit; updateScores(); addChat(null, `The frag limit is ${fragLimit || 'off'}`); }
  }
  else if (m.t === 'pong') rtt = performance.now() - m.n;
  else if (m.t === 'error') $('status').textContent = String(m.text);
}

function onSnapshot(s) {
  s.rt = performance.now();
  s.pm = new Map(s.p.map((a) => [a[0], a]));
  snaps.push(s);
  if (snaps.length > 30) snaps.shift();
  const wasDead = me ? me.dead : true;
  const respawned = !me || s.me.sc !== me.sc;
  me = s.me;
  matchState = s.st; timeLeft = s.tl;

  // Reconcile: take the server state, then run again the commands that the server did not process.
  const ox = local.x, oy = local.y, oz = local.z;
  copyMoveState(local, me);
  pending = pending.filter((c) => c.seq > s.ack);
  if (!me.dead && matchState === 'play') for (const c of pending) pmove(local, c, world, TICK);
  const ex = ox - local.x, ey = oy - local.y, ez = oz - local.z;
  const err = Math.hypot(ex, ey, ez);
  if (respawned || wasDead || err > 80) {
    smooth.x = smooth.y = smooth.z = 0; stepSmooth = 0;
    prev.x = local.x; prev.y = local.y; prev.z = local.z;
    if (respawned) { input.yaw = me.syaw; input.pitch = 0; }
  } else if (err > 0.01) {
    smooth.x += ex; smooth.y += ey; smooth.z += ez;
    prev.x -= ex; prev.y -= ey; prev.z -= ez;
  }
  for (const e of s.ev) onEvent(e, s);
}

const dist = (x, y, z) => Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
const nameOf = (id) => (info.get(id) ? info.get(id).name : 'Player');

function onEvent(e, s) {
  if (frameEvents.length < 12) frameEvents.push(e.t);
  const a = e.id ? s.pm.get(e.id) : null;
  const d = a ? (e.id === myId ? 0 : dist(a[1], a[2], a[3])) : 0;
  if (e.t === 'shot' && a) {
    play(WEAPONS[e.w].id, d);
    if (e.h) play('smash', d);
    const mine = e.id === myId;
    if (mine) renderer.fireKick();
    if (e.e) {
      const src = mine
        ? { x: local.x, y: local.y, z: local.z, yaw: input.yaw, pitch: input.pitch }
        : { x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5] };
      renderer.shot(renderer.muzzle(src, mine, muzzleOut), e.e, e.w);
    }
  } else if (e.t === 'boom') {
    renderer.explosion(e.p, e.w);
    play(e.w === W_RL ? 'boom' : 'fizz', dist(e.p[0], e.p[1], e.p[2]));
  } else if (e.t === 'pickup' && a) {
    const def = ITEMS[map.items[e.i].type];
    play(def.kind === 'amp' ? 'power' : 'pickup', d);
    if (e.id === myId) { $('pickup').textContent = def.label; pickupUntil = performance.now() + 1800; }
  } else if (e.t === 'pain') {
    if (e.id === myId) { flash = Math.min(1, flash + 0.25 + e.d / 80); play('pain'); }
    else if (e.a === myId) { play('hit'); hitUntil = performance.now() + 120; }
  } else if (e.t === 'kill') {
    const v = s.pm.get(e.v);
    // Do not draw the effect for the local player. It is at the camera position and hides the view.
    if (v) { if (e.v !== myId) renderer.burst(v[1], v[2], v[3], playerColor(e.v)); play('death', e.v === myId ? 0 : dist(v[1], v[2], v[3])); }
    addFeed(e);
    if (e.k === myId && e.v !== myId) { center(`You ${e.w === W_HAMMER ? 'hammered' : 'fragged'} ${nameOf(e.v)}`, 2200); play('frag'); }
    else if (e.v === myId) center(e.k && e.k !== myId ? `Fragged by ${nameOf(e.k)}` : 'You fragged yourself', 2500);
  } else if (e.t === 'jump' && a && e.id !== myId) play('jump', d);
  else if (e.t === 'pad' && a && e.id !== myId) play('pad', d);
  else if (e.t === 'spawn' && a) play('spawn', d);
  else if (e.t === 'end') { play('end'); center('Match complete', 9000); }
  else if (e.t === 'restart') { center('Fight!', 1500); $('feed').replaceChildren(); }
}
const muzzleOut = { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, x: 0, y: 0, z: 0 };

// ---------- HUD ----------
function center(text, ms) {
  $('center').textContent = text;
  centerUntil = performance.now() + ms;
}

function addFeed(e) {
  const row = document.createElement('div');
  if (e.k === myId || e.v === myId) row.className = 'me';
  const who = document.createElement('span'), how = document.createElement('em'), whom = document.createElement('span');
  who.textContent = e.k && e.k !== e.v ? nameOf(e.k) : '';
  how.textContent = e.k && e.k !== e.v ? WEAPONS[e.w].name : 'self';
  whom.textContent = nameOf(e.v);
  row.append(who, how, whom);
  $('feed').append(row);
  while ($('feed').children.length > 5) $('feed').firstChild.remove();
  setTimeout(() => row.remove(), 6000);
}

function addChat(name, text) {
  const row = document.createElement('div');
  if (name) { const b = document.createElement('b'); b.textContent = name; row.append(b); } else row.className = 'sys';
  row.append(text);
  $('chatlog').append(row);
  while ($('chatlog').children.length > 12) $('chatlog').firstChild.remove();
  setTimeout(() => row.remove(), 12000);
}

function buildWeaponBar() {
  $('weapons').replaceChildren(...WEAPONS.map((w, i) => {
    const d = document.createElement('div'), s = document.createElement('span'), b = document.createElement('b');
    d.style.setProperty('--c', '#' + w.color.toString(16).padStart(6, '0'));
    s.textContent = `${i + 1} ${w.id === 'hammer' ? 'ham' : w.id}`;
    d.append(s, b);
    return d;
  }));
}

function updateScores() {
  const rows = [...info.values()].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
  $('scorerows').replaceChildren(...rows.map((p) => {
    const r = document.createElement('tr');
    if (p.id === myId) r.className = 'me';
    const cells = [p.name, p.frags, p.deaths, p.bot ? 'bot' : p.ping];
    cells.forEach((c) => { const td = document.createElement('td'); td.textContent = c; r.append(td); });
    return r;
  }));
  const top = rows[0], mine = info.get(myId);
  $('lead').textContent = top && mine ? `You ${mine.frags} · Leader ${top.frags}${fragLimit ? ' · Limit ' + fragLimit : ''}` : '';
}

function updateHud(now) {
  if (!me) return;
  const set = (id, v) => { const b = $(id).firstElementChild; if (b.textContent !== String(v)) b.textContent = v; };
  set('health', Math.max(0, me.health));
  set('armor', me.armor);
  const melee = (i) => WEAPONS[i].kind === 'melee';
  set('ammo', melee(me.weapon) ? '∞' : me.ammo[me.weapon]);
  $('health').className = 'stat' + (me.health <= 25 ? ' low' : me.health > 100 ? ' over' : '');
  $('armor').className = 'stat' + (me.armor > 100 ? ' over' : '');
  const bar = $('weapons').children;
  for (let i = 0; i < bar.length; i++) {
    const own = (me.weapons & (1 << i)) !== 0;
    bar[i].className = (own ? 'own' : '') + (i === me.weapon ? ' active' : '') + (own && !melee(i) && me.ammo[i] === 0 ? ' empty' : '');
    const t = !own ? '–' : melee(i) ? '∞' : String(me.ammo[i]);
    if (bar[i].lastChild.textContent !== t) bar[i].lastChild.textContent = t;
  }
  $('vote').hidden = !vote;
  if (vote) {
    const text = `Vote: ${vote.text}\nyes ${vote.yes} · no ${vote.no} · ${Math.max(0, Math.ceil((vote.end - now) / 1000))} s\nF1: yes   F2: no`;
    if ($('vote').textContent !== text) $('vote').textContent = text;
  }
  // The protection stops when the player fires. The client hides it at once and does not wait for the server.
  if (!me.prot) protFired = false;
  else if (input.fire || input.down('ControlLeft')) protFired = true;
  const prot = me.prot && !protFired;
  $('shield').classList.toggle('on', prot);
  $('amp').hidden = !(me.amp > 0 || prot);
  if (me.amp > 0 || prot) $('amp').textContent = [me.amp > 0 ? `Amplifier ${me.amp}` : '', prot ? 'Spawn protection: fire to stop it' : ''].filter(Boolean).join(' · ');
  const t = Math.max(0, timeLeft);
  $('clock').textContent = timeLeft < 0 ? '∞' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $('scores').hidden = !(input.down('Tab') || matchState === 'intermission');
  $('scoretitle').textContent = matchState === 'intermission' ? `Match complete · next match in ${t} s` : 'Scores';
  $('crosshair').className = now < hitUntil ? 'hit' : '';
  $('crosshair').hidden = me.dead || matchState !== 'play';
  $('flash').style.opacity = flash.toFixed(2);
  if (now > centerUntil) {
    const idle = me.dead && matchState === 'play' ? 'Press fire to respawn' : '';
    if ($('center').textContent !== idle) $('center').textContent = idle;
  }
  if (now > pickupUntil && $('pickup').textContent) $('pickup').textContent = '';
  const speed = Math.round(Math.hypot(local.vx, local.vz));
  $('net').textContent = `${conn.local ? 'offline' : 'ping ' + Math.round(rtt) + ' ms'}\n${fps} fps\n${speed} ups`;
}

// ---------- Game loop ----------
function clientTick() {
  const cmd = input.sample(++seq);
  if (input.wheel && me) {
    // The mouse wheel selects the next weapon that the player has.
    const dir = Math.sign(input.wheel);
    for (let i = 1, w = me.weapon; i <= WEAPONS.length; i++) {
      w = (me.weapon + dir * i + WEAPONS.length * 2) % WEAPONS.length;
      if (me.weapons & (1 << w)) { cmd.weapon = w; break; }
    }
    input.wheel = 0;
  }
  if (input.typing || !$('menu').hidden) { cmd.fwd = 0; cmd.side = 0; cmd.buttons = 0; cmd.weapon = -1; }
  conn.send({ t: 'c', c: [[cmd.seq, cmd.fwd, cmd.side, cmd.buttons, cmd.yaw, cmd.pitch, cmd.weapon, viewTime]] });
  pending.push(cmd);
  if (pending.length > 120) pending.shift();
  prev.x = local.x; prev.y = local.y; prev.z = local.z;
  if (me && !me.dead && matchState === 'play') {
    const wasGround = local.ground;
    const flags = pmove(local, cmd, world, TICK);
    if (flags & PMF_JUMPED) play('jump');
    if (flags & PMF_PAD) play('pad');
    // Make the camera move smoothly up a step.
    const dy = local.y - prev.y;
    if (wasGround && local.ground && dy > 2 && dy <= PM.stepSize + 1) stepSmooth -= dy;
  }
}

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

let viewTime = 0;

// Finds the positions of the other players for the render time.
function interpolate(now) {
  const rt = now - (conn.local ? 34 : 75);
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].rt <= rt) a = snaps[i];
    else { b = snaps[i]; break; }
  }
  if (a.rt > b.rt) a = b;
  const k = b.rt > a.rt ? Math.max(0, Math.min(1, (rt - a.rt) / (b.rt - a.rt))) : 0;
  // The server uses this time to put the targets where this client sees them.
  viewTime = a.time + (b.time - a.time) * k;
  const list = [];
  for (const q of b.p) {
    const o = a.pm.get(q[0]) || q;
    const far = Math.hypot(q[1] - o[1], q[2] - o[2], q[3] - o[3]) > 300;
    const f = far ? 1 : k;
    const p = {
      id: q[0], x: o[1] + (q[1] - o[1]) * f, y: o[2] + (q[2] - o[2]) * f, z: o[3] + (q[3] - o[3]) * f,
      yaw: lerpAngle(o[4], q[4], f), pitch: o[5] + (q[5] - o[5]) * f, weapon: q[6],
      dead: (q[7] & 1) !== 0, beam: (q[7] & 2) !== 0, amp: (q[7] & 4) !== 0, shield: (q[7] & 8) !== 0,
    };
    if (q[0] === myId) { p.x = camPos.x; p.y = camPos.y - PM.eye; p.z = camPos.z; p.yaw = input.yaw; p.pitch = input.pitch; }
    list.push(p);
  }
  renderer.setPlayers(list, myId);
  const last = snaps[snaps.length - 1];
  const age = Math.min(0.1, (now - last.rt) / 1000);
  renderer.setProjectiles(last.pr.map((q) => ({ id: q[0], w: q[1], x: q[2] + q[5] * age, y: q[3] + q[6] * age, z: q[4] + q[7] * age })));
  renderer.setItems(last.it);
}

// Puts the camera on a path around the arena. The path is inside the walls of each map.
function orbit(view, t) {
  view.x = Math.cos(t) * map.half[0] * 0.84; view.z = Math.sin(t) * map.half[1] * 0.84;
  view.y = Math.min(520, map.height * 0.78);
  view.yaw = Math.atan2(view.x, view.z);
  view.pitch = -Math.atan2(view.y - 90, Math.hypot(view.x, view.z));
}

let lastFrame = performance.now(), acc = 0;
// The zoom amount: 0 is the normal view, and 1 is the full zoom.
let zoom = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = now - lastFrame;
  const dt = Math.min(0.1, rawDt / 1000);
  lastFrame = now;
  const t0 = performance.now();
  let ticks = 0;
  frames++;
  if (now - fpsAt >= 1000) { fps = frames; frames = 0; fpsAt = now; }

  const view = { x: camPos.x, y: camPos.y, z: camPos.z, yaw: input.yaw, pitch: input.pitch, roll: 0, weapon: 0, alive: false, speed: 0, ground: false };
  if (joined) {
    // The offline game stops while the menu is open.
    const paused = conn.local && !$('menu').hidden;
    if (!paused) {
      acc += dt;
      while (acc >= TICK) {
        acc -= TICK;
        clientTick();
        if (conn.local) conn.step();
        ticks++;
      }
    }
    if (!conn.local && now - lastPing > 2000) { lastPing = now; conn.send({ t: 'ping', n: now, rtt }); }
  }
  const t1 = performance.now();
  if (joined && me && snaps.length) {
    const k = Math.exp(-dt * 14);
    smooth.x *= k; smooth.y *= k; smooth.z *= k; stepSmooth *= k;
    flash = Math.max(0, flash - dt * 1.6);
    const al = acc / TICK;
    if (matchState === 'intermission') {
      orbit(view, now / 9000);
    } else if (me.dead) {
      view.x = local.x; view.y = local.y - 10; view.z = local.z; view.roll = 0.5;
    } else {
      view.x = prev.x + (local.x - prev.x) * al + smooth.x;
      view.y = prev.y + (local.y - prev.y) * al + smooth.y + PM.eye + stepSmooth;
      view.z = prev.z + (local.z - prev.z) * al + smooth.z;
      view.alive = true; view.weapon = me.weapon;
      view.speed = Math.hypot(local.vx, local.vz); view.ground = local.ground;
    }
    camPos.x = view.x; camPos.y = view.y; camPos.z = view.z;
    interpolate(now);
    updateHud(now);
  } else {
    // Slow camera flight behind the menu.
    orbit(view, now / 14000);
  }
  // The zoom changes smoothly. A dead player and the menu have no zoom.
  const zoomTarget = view.alive && input.zoomHeld() ? 1 : 0;
  zoom += Math.sign(zoomTarget - zoom) * Math.min(Math.abs(zoomTarget - zoom), dt * 8);
  input.zoomScale = renderer.setZoom(zoom);
  // The renderer decreases the render resolution when many frames are slow during a game.
  // The frames with the open menu do not count, because the menu has its own cost.
  if (view.alive && $('menu').hidden && renderer.adaptScale(rawDt)) {
    settings.renderScale = renderer.scale; saveSettings();
    addChat(null, `The game decreased the render resolution to ${Math.round(renderer.scale * 100)} % to keep the frame rate`);
  }
  renderer.render(dt, view);
  perf.render(now);
  perf.frame(rawDt, { sim: t1 - t0, draw: performance.now() - t1, ticks, effects: renderer.effects.length, events: frameEvents.join(' '), scale: renderer.scale });
  frameEvents.length = 0;
  // An online client sends a summary to the server each 10 seconds. The server writes it to its log.
  const summary = perf.takeSummary();
  if (summary && joined && !conn.local) conn.send({ t: 'perf', fps: summary.fps, low: summary.low, max: summary.max, slow: summary.slow });
}

// Saves the performance data as a JSON file.
function savePerfLog() {
  const gl = renderer.r.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const data = perf.report({
    saved: new Date().toISOString(), mode: conn ? (conn.local ? 'offline' : 'online') : 'menu',
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
    quality: params.get('quality') || settings.quality, renderSize: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    window: `${innerWidth}x${innerHeight}`, fullscreen: !!document.fullscreenElement, pixelRatio: devicePixelRatio, browser: navigator.userAgent,
    bots: conn && conn.local ? conn.host.bots.size : null, pingMs: Math.round(rtt),
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `slipstream-performance-${data.saved.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $('status').textContent = `Saved ${data.slowFrames.length} slow frames to ${a.download}.`;
}

// ---------- User interface events ----------
bindSettings();
$('offline').addEventListener('click', () => { unlockAudio(); startOffline(); });
$('connect').addEventListener('click', () => { unlockAudio(); startOnline(settings.address); });
$('resume').addEventListener('click', () => { hideMenu(); input.lock(); });
$('leave').addEventListener('click', () => leaveGame());
$('perfsave').addEventListener('click', savePerfLog);
$('applybots').addEventListener('click', () => {
  if (!conn || !conn.local) return;
  const o = offlineOptions();
  conn.host.setBots(o.bots, o.botSkill, false);
  $('status').textContent = o.bots ? `Bots: ${o.bots}, skill ${o.botSkill}.` : 'Bots are off.';
});
canvas.addEventListener('mousedown', unlockAudio);
document.addEventListener('pointerlockchange', () => {
  if (!input.locked() && joined && !input.typing) showMenu();
});

// The remote console password stays in memory only. The client does not save it.
let rconPassword = '';

// Handles a chat line that starts with "/". The client does not send such a line as chat.
function chatCommand(text) {
  const [name, ...args] = text.slice(1).split(/\s+/);
  if (name === 'vote') { conn.send({ t: 'vote', cmd: args.join(' ') }); return; }
  if (name === 'yes' || name === 'no') { conn.send({ t: 'vote', v: name === 'yes' ? 1 : 0 }); return; }
  if (name !== 'rcon') { addChat(null, 'Commands: /vote <change>, /yes, /no, /rcon login <password>, /rcon <server command>'); return; }
  if (conn.local) { addChat(null, 'The remote console works only on a server.'); return; }
  if (args[0] === 'login') {
    rconPassword = args.slice(1).join(' ');
    conn.send({ t: 'rcon', pw: rconPassword, cmd: '' });
  } else if (!rconPassword) addChat(null, 'First type: /rcon login <password>');
  else conn.send({ t: 'rcon', pw: rconPassword, cmd: args.join(' ') || 'help' });
}

const chat = $('chatinput');
// Starts or stops the fullscreen mode. The browser permits this only after a key or a click.
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => { /* The browser did not permit the fullscreen mode. */ });
}
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
});

input.onKey = (code) => {
  if (code === 'KeyF') toggleFullscreen();
  if ((code === 'F1' || code === 'F2') && vote && conn) conn.send({ t: 'vote', v: code === 'F1' ? 1 : 0 });
  if (code === 'F3') { settings.perf = !settings.perf; $('perfon').checked = settings.perf; perf.setVisible(settings.perf); saveSettings(); }
  if (code === 'Enter' && joined && $('menu').hidden) {
    input.typing = true;
    input.keys.clear();
    chat.hidden = false;
    chat.value = '';
    chat.focus();
  }
};
chat.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' && e.code !== 'Escape') return;
  e.preventDefault();
  const text = chat.value.trim();
  if (e.code === 'Enter' && text && conn) {
    if (text.startsWith('/')) chatCommand(text);
    else if (conn.local) addChat(settings.name, text);
    else conn.send({ t: 'chat', text });
  }
  chat.hidden = true;
  chat.blur();
  input.typing = false;
});

// If the dedicated server sent this page, offer that server.
fetch('status').then((r) => (r.ok ? r.json() : null)).then((s) => {
  if (!s || s.game !== GAME_ID) return;
  const here = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  if (!settings.address) { settings.address = here; $('address').value = here; }
  $('serverinfo').textContent = `${s.name}: ${s.players}/${s.maxClients} players, ${s.bots} bots, map ${s.map}`;
}).catch(() => {});

// The "debug" parameter gives test scripts access to the input and the renderer.
if (params.has('debug')) {
  window.game = {
    input, renderer,
    get conn() { return conn; }, get myId() { return myId; }, get mapId() { return map.id; },
    // The predicted position of the local player, or null before the first snapshot.
    get pos() { return me ? { x: local.x, y: local.y, z: local.z } : null; },
  };
}
if (params.has('offline')) startOffline();
else if (params.has('connect')) startOnline(params.get('connect'));
requestAnimationFrame(frame);
