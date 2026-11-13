// Browser test: starts the server and a headless browser, then plays for a short time.
// It finds errors in the client that the simulation tests cannot find.
// Usage: npm run build && BROWSER_PATH=/path/to/chrome npm run test:browser
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const list = [process.env.BROWSER_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = list.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('No browser found. Set BROWSER_PATH to a Chrome or Chromium program.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startServer(port) {
  const child = spawn(process.execPath, ['server/index.js', '--port', String(port), '--host', '127.0.0.1', '--bots', '3', '--maps', 'yard,deck'], { cwd: ROOT });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50 && !out.includes('listening'); i++) await sleep(100);
  if (!out.includes('listening')) { child.kill(); throw new Error('The server did not start:\n' + out); }
  return { child, log: () => out };
}

async function waitFor(page, what, fn, arg, timeout = 30000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 }, arg);
  } catch {
    throw new Error(`Timeout: ${what}`);
  }
}

async function openGame(browser, url, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => errors.push(`${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await waitFor(page, 'the game did not start', () => !document.getElementById('hud').hidden && window.game && window.game.pos !== null);
  return page;
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
}

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('The client is not built. Run "npm run build" first.');
const port = await freePort();
const server = await startServer(port);
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const base = `http://127.0.0.1:${port}/`;

  // ----- Online game -----
  let page = await openGame(browser, `${base}?connect=ws://127.0.0.1:${port}&nolock&debug&quality=low`, errors);
  const start = await page.evaluate(() => ({ ...window.game.pos, map: window.game.mapId, id: window.game.myId }));
  check('online: the client joined the server', start.id > 0 && start.map === 'yard', `player id ${start.id}, map ${start.map}`);
  await page.keyboard.down('KeyW');
  await sleep(2500);
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => ({ ...window.game.pos, rows: document.getElementById('scorerows').children.length, net: document.getElementById('net').textContent }));
  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  check('online: the player moves with the W key', moved > 50, `${Math.round(moved)} units`);
  check('online: the score table shows the player and the bots', end.rows === 3, `${end.rows} rows`);
  check('online: the HUD shows the ping', /ping \d+ ms/.test(end.net));

  // One player is more than half of the players, thus the vote passes immediately.
  await page.evaluate(() => window.game.conn.send({ t: 'vote', cmd: 'map deck' }));
  await waitFor(page, 'the map did not change after the vote', () => window.game.mapId === 'deck' && window.game.pos !== null);
  await sleep(1500);
  const deck = await page.evaluate(() => ({ health: Number(document.querySelector('#health b').textContent), rows: document.getElementById('scorerows').children.length }));
  check('online: a vote changes the map and the game continues', Number.isFinite(deck.health) && deck.rows === 3, `health ${deck.health}, ${deck.rows} rows`);
  await page.close();

  // ----- Offline game -----
  page = await openGame(browser, `${base}?offline&nolock&debug&quality=low`, errors);
  await sleep(2500);
  const off = await page.evaluate(() => ({ rows: document.getElementById('scorerows').children.length, net: document.getElementById('net').textContent, pos: window.game.pos }));
  check('offline: the game runs with bots', off.rows >= 2 && off.net.startsWith('offline') && off.pos !== null, `${off.rows} rows`);
  await page.close();

  check('no script errors in the browser', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check(e.message, false, errors.slice(0, 3).join(' | '));
  console.log('--- server log ---\n' + server.log());
} finally {
  await browser.close();
  server.child.kill();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `${failed} of ${checks.length} checks failed.` : `All ${checks.length} checks passed.`);
process.exit(failed ? 1 : 0);
