// Frame time measurement: a graph on the screen and a log of slow frames.
// The time between two frames has three parts:
// - sim: input, prediction, and (offline) the game simulation with the bots.
// - draw: the time that the client code uses to prepare and send the picture.
// - other: the remaining time. The browser and the GPU use it. The client code cannot measure it in more detail.

const HISTORY = 360;
const LOG_MAX = 400;
const W = 360, H = 96;
// The graph shows frame times up to this value, in milliseconds.
const SCALE_MS = 50;

export class Perf {
  constructor(canvas, text) {
    this.canvas = canvas; this.text = text;
    canvas.width = W; canvas.height = H;
    this.g = canvas.getContext('2d');
    this.dt = new Float32Array(HISTORY); this.sim = new Float32Array(HISTORY); this.draw = new Float32Array(HISTORY);
    this.n = 0;
    this.visible = false;
    this.started = performance.now();
    this.log = [];
    this.windows = [];
    this.win = this.newWindow();
    this.prev = null;
    this.refresh = 16.7;
    this.textAt = 0;
  }

  newWindow() {
    return { at: performance.now(), frames: 0, slow: 0, max: 0, times: [], shots: 0, effects: 0, paused: 0, scale: 1 };
  }

  setVisible(v) {
    this.visible = v;
    this.canvas.hidden = this.text.hidden = !v;
  }

  // A frame is slow if it takes more than 1.5 times the normal frame time.
  slowLimit() {
    return Math.max(this.refresh * 1.5, 12);
  }

  // Call one time for each frame. "dt" is the time from the previous frame in milliseconds.
  // "work" has the measured times of this frame. They explain the time to the next frame.
  frame(dt, work) {
    const i = this.n % HISTORY;
    const p = this.prev || work;
    this.dt[i] = dt; this.sim[i] = p.sim; this.draw[i] = p.draw;
    this.n++;
    this.prev = work;
    // The first frames after the start are not normal. Ignore them.
    if (this.n < 30 || dt > 2000) return;

    const w = this.win;
    w.frames++; w.times.push(dt);
    // These values show if a window had a fight, and if the game was paused.
    w.shots += (p.events.match(/shot|boom/g) || []).length;
    if (p.effects > w.effects) w.effects = p.effects;
    if (p.ticks === 0) w.paused++;
    if (p.scale) w.scale = p.scale;
    if (dt > w.max) w.max = dt;
    const limit = this.slowLimit();
    if (dt > limit) {
      w.slow++;
      const other = Math.max(0, dt - p.sim - p.draw);
      const cause = p.sim >= p.draw && p.sim >= other ? 'simulation' : p.draw >= other ? 'draw' : 'browser or GPU';
      if (this.log.length >= LOG_MAX) this.log.shift();
      this.log.push({
        time: +((performance.now() - this.started) / 1000).toFixed(2), frameMs: +dt.toFixed(1),
        simMs: +p.sim.toFixed(1), drawMs: +p.draw.toFixed(1), otherMs: +other.toFixed(1), cause,
        ticks: p.ticks, effects: p.effects, events: p.events, scale: p.scale,
      });
    }
    if (performance.now() - w.at >= 10000) this.closeWindow();
  }

  closeWindow() {
    const w = this.win;
    this.win = this.newWindow();
    if (w.frames < 10) return null;
    const t = w.times.sort((a, b) => a - b);
    this.refresh = t[t.length >> 1];
    const worst = t.slice(Math.floor(t.length * 0.99));
    const s = {
      time: +((w.at - this.started) / 1000).toFixed(0),
      fps: Math.round(w.frames * 1000 / (performance.now() - w.at)),
      low: Math.round(1000 / (worst.reduce((a, b) => a + b, 0) / worst.length)),
      max: Math.round(w.max), slow: w.slow,
      shots: w.shots, maxEffects: w.effects, pausedFrames: w.paused, scale: w.scale,
    };
    this.windows.push(s);
    if (this.windows.length > 180) this.windows.shift();
    this.lastSummary = s;
    return s;
  }

  // Returns the summary of the last 10 seconds one time, or null.
  takeSummary() {
    const s = this.lastSummary;
    this.lastSummary = null;
    return s || null;
  }

  render(now) {
    if (!this.visible) return;
    const g = this.g, count = Math.min(this.n, HISTORY), y = (ms) => H - Math.min(H, (ms / SCALE_MS) * H);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8, 11, 20, 0.78)';
    g.fillRect(0, 0, W, H);
    const limit = this.slowLimit();
    for (let k = 0; k < count; k++) {
      const i = (this.n - count + k) % HISTORY, x = W - count + k;
      const dt = this.dt[i], sim = this.sim[i], draw = this.draw[i];
      g.fillStyle = dt > limit ? '#ff5a4a' : '#56617a';
      g.fillRect(x, y(dt), 1, H - y(dt));
      g.fillStyle = '#35ffd0';
      g.fillRect(x, y(sim + draw), 1, y(sim) - y(sim + draw));
      g.fillStyle = '#ffb347';
      g.fillRect(x, y(sim), 1, H - y(sim));
    }
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.font = '10px sans-serif';
    for (const ms of [16.7, 33.3]) {
      g.fillRect(0, y(ms), W, 1);
      g.fillText(ms + ' ms', 3, y(ms) - 2);
    }
    if (now - this.textAt < 500) return;
    this.textAt = now;
    let max = 0, slow = 0, sum = 0;
    for (let k = 0; k < count; k++) {
      const d = this.dt[(this.n - count + k) % HISTORY];
      sum += d; if (d > max) max = d; if (d > limit) slow++;
    }
    this.text.textContent = `frame time, last ${count} frames: average ${(sum / Math.max(1, count)).toFixed(1)} ms, longest ${max.toFixed(0)} ms, slow ${slow}\n` +
      `orange: simulation   green: draw   grey: browser and GPU   red: slow frame\nslow frames in the log: ${this.log.length}`;
  }

  // Returns all data for a file that the player can save.
  report(info) {
    return { ...info, slowLimitMs: +this.slowLimit().toFixed(1), normalFrameMs: +this.refresh.toFixed(1), windows: this.windows, slowFrames: this.log };
  }
}
