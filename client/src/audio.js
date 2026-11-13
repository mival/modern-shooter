// Sound effects. The Web Audio API makes all sounds. The game has no sound files.
let ctx = null, master = null, noiseBuf = null;
let volume = 0.5;

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

// A browser lets audio start only after a user action.
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function envelope(vol, dur) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  return g;
}

function tone(type, f0, f1, dur, vol) {
  const o = ctx.createOscillator();
  const t = ctx.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(envelope(vol, dur));
  o.start(t); o.stop(t + dur);
}

function noise(filter, f0, f1, dur, vol) {
  const s = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const t = ctx.currentTime;
  s.buffer = noiseBuf;
  f.type = filter;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  s.connect(f); f.connect(envelope(vol, dur));
  s.start(t, Math.random() * 0.5, dur);
}

const SOUNDS = {
  hammer: (v) => { noise('bandpass', 500, 1600, 0.16, v * 0.45); },
  smash: (v) => { noise('lowpass', 900, 120, 0.2, v * 0.9); tone('square', 150, 50, 0.14, v * 0.5); },
  mg: (v) => { noise('highpass', 1800, 900, 0.07, v * 0.5); tone('square', 220, 90, 0.06, v * 0.25); },
  sg: (v) => { noise('lowpass', 2600, 300, 0.28, v * 0.9); tone('sawtooth', 140, 50, 0.2, v * 0.4); },
  rl: (v) => { noise('bandpass', 500, 1500, 0.35, v * 0.7); tone('sine', 120, 60, 0.3, v * 0.5); },
  arc: (v) => { tone('sawtooth', 95 + Math.random() * 40, 80, 0.07, v * 0.22); noise('highpass', 5000, 3000, 0.05, v * 0.12); },
  rail: (v) => { tone('sawtooth', 2200, 180, 0.55, v * 0.45); tone('sine', 900, 90, 0.5, v * 0.5); },
  pg: (v) => { tone('sine', 1100, 320, 0.09, v * 0.4); },
  boom: (v) => { noise('lowpass', 1400, 80, 0.7, v * 1.2); tone('sine', 90, 30, 0.5, v * 0.9); },
  fizz: (v) => { noise('bandpass', 2400, 800, 0.1, v * 0.3); },
  jump: (v) => { tone('sine', 190, 300, 0.09, v * 0.25); },
  pad: (v) => { tone('triangle', 200, 900, 0.3, v * 0.4); },
  pickup: (v) => { tone('triangle', 660, 660, 0.07, v * 0.35); setTimeout(() => ctx && tone('triangle', 990, 990, 0.1, v * 0.35), 60); },
  power: (v) => { tone('sawtooth', 110, 880, 0.9, v * 0.5); tone('sine', 220, 1760, 0.9, v * 0.4); },
  hit: (v) => { tone('sine', 1250, 1250, 0.07, v * 0.45); },
  pain: (v) => { tone('sawtooth', 160, 70, 0.16, v * 0.4); },
  frag: (v) => { tone('triangle', 520, 520, 0.12, v * 0.4); setTimeout(() => ctx && tone('triangle', 780, 780, 0.2, v * 0.4), 90); },
  death: (v) => { tone('sawtooth', 300, 40, 0.6, v * 0.5); noise('lowpass', 900, 100, 0.5, v * 0.5); },
  spawn: (v) => { tone('sine', 300, 1200, 0.25, v * 0.3); },
  end: (v) => { tone('triangle', 392, 392, 0.5, v * 0.4); setTimeout(() => ctx && tone('triangle', 523, 523, 0.8, v * 0.4), 250); },
};

// Plays a sound. "dist" is the distance to the listener in game units.
export function play(name, dist = 0) {
  if (!ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
  const v = 1 / (1 + (dist / 350) ** 2);
  if (v < 0.02) return;
  SOUNDS[name](v);
}
