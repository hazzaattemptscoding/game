// Audio test, no speakers: drives src/audio.js with a fake AudioContext and a sequence of fake car states.
// Checks: every parameter write is finite and in bounds, engine pitch rises with rpm, no nodes are created
// after setup, nothing sounds before a user gesture, and teardown disconnects everything.
import { CarAudio, TUNE } from '../src/audio.js';
import { SURF } from '../src/track.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// sane bounds for every parameter, by "nodeType.param" (Hz, linear gain, Q, cents)
const BOUNDS = {
  'gain': [0, 2], 'frequency.oscillator': [5, 2000], 'frequency.biquad': [20, 12000], 'Q': [0.1, 30], 'detune': [-100, 100],
};
class Param {
  constructor(owner, name, value) { this.owner = owner; this.name = name; this.value = value; this.writes = 0; this.last = value; }
  check(v, what) {
    const key = this.name === 'frequency' ? 'frequency.' + (this.owner.kind === 'oscillator' ? 'oscillator' : 'biquad') : this.name;
    const [lo, hi] = BOUNDS[key] || [-1e9, 1e9];
    check(typeof v === 'number' && Number.isFinite(v), `${this.owner.kind}.${this.name} ${what} not finite: ${v}`);
    check(v >= lo && v <= hi, `${this.owner.kind}.${this.name} ${what} out of bounds [${lo}, ${hi}]: ${v}`);
    this.writes++;
  }
  set value(v) { if (this._init) this.check(v, 'value'); this._v = v; this._init = true; }
  get value() { return this._v; }
  setTargetAtTime(v, t, k) { this.check(v, 'target'); check(Number.isFinite(t) && Number.isFinite(k) && k > 0, 'bad time constant'); this.last = v; }
  setValueAtTime(v, t) { this.check(v, 'setValueAtTime'); check(Number.isFinite(t), 'bad time'); this.last = v; }
  cancelScheduledValues(t) { check(Number.isFinite(t), 'bad cancel time'); }
}
class Node {
  constructor(ctx, kind, params) {
    this.ctx = ctx; this.kind = kind; this.out = []; this.disconnected = false; this.started = false; this.stopped = false;
    for (const [k, v] of Object.entries(params)) this[k] = new Param(this, k, v);
    ctx.created.push(this);
  }
  connect(dest) { check(dest instanceof Node || dest instanceof Param || dest === this.ctx.destination, 'connect to something that is not a node or param'); this.out.push(dest); return dest; }
  disconnect() { this.disconnected = true; this.out = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class FakeContext {
  static instances = [];
  constructor() {
    FakeContext.instances.push(this);
    this.created = []; this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.closed = false; this.resumes = 0; this.suspends = 0;
    this.destination = { kind: 'destination' };
  }
  createGain() { return new Node(this, 'gain', { gain: 1 }); }
  createOscillator() { return new Node(this, 'oscillator', { frequency: 440, detune: 0 }); }
  createBiquadFilter() { return new Node(this, 'biquad', { frequency: 350, Q: 1, detune: 0 }); }
  createWaveShaper() { return new Node(this, 'shaper', {}); }
  createDynamicsCompressor() { return new Node(this, 'compressor', {}); }
  createBufferSource() { return new Node(this, 'source', {}); }
  createBuffer(ch, len, rate) { check(len > 0 && rate > 0, 'bad buffer'); const d = new Float32Array(len); return { getChannelData: () => d }; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
}
class Target {
  constructor() { this.h = {}; }
  addEventListener(t, f) { (this.h[t] ||= new Set()).add(f); }
  removeEventListener(t, f) { this.h[t]?.delete(f); }
  fire(t) { for (const f of [...(this.h[t] || [])]) f({ type: t }); }
  count() { return Object.values(this.h).reduce((a, s) => a + s.size, 0); }
}

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const cfg = { idleRpm: 1100, redline: 8500 };
const car = (o = {}) => ({
  cfg, rpm: 1100, gear: 1, throttle: 0, brake: 0, speed: 0, fwdSpeed: 0, spin: false, lock: false, slipF: 0, slipR: 0, tc: false, abs: false, esc: false,
  wheelSurf: [0, 0, 0, 0], bump: 0, bumpSpacing: 4, drs: false, events: { shift: 0, hit: 0 }, ...o,
});

// --- no sound before a gesture, no errors without Web Audio ---
{
  const a = new CarAudio({ sound: true, volume: 0.7 }, { ctor: null, rand });
  a.Ctor = undefined; a.disabled = true;   // as if the browser has no Web Audio
  a.attach(new Target(), null); a.latch(car()); a.update(car(), 0.016, false); a.dispose();
  const m = new CarAudio({ sound: true, volume: 0.7 }, { ctor: FakeContext, muted: true, rand });
  const t = new Target(); m.attach(t, null); t.fire('keydown'); m.update(car(), 0.016);
  check(t.count() === 0 && FakeContext.instances.length === 0, '?mute must never create an AudioContext');
}

const settings = { sound: true, volume: 0.7 };
const a = new CarAudio(settings, { ctor: FakeContext, rand });
const win = new Target(), doc = Object.assign(new Target(), { hidden: false });
a.attach(win, doc);
a.update(car({ throttle: 1 }), 0.016);
check(FakeContext.instances.length === 0, 'AudioContext created before a user gesture');
win.fire('keydown');
check(FakeContext.instances.length === 1, 'first key press did not create the AudioContext');
const ctx = FakeContext.instances[0];
win.fire('pointerdown'); win.fire('touchstart');
check(FakeContext.instances.length === 1, 'more than one AudioContext created');
check(ctx.created.every(n => n.kind !== 'oscillator' || n.started), 'oscillator not started');
const setupCount = ctx.created.length;

let frame = 0;
const step = (st, dt = 1 / 60, paused = false) => {
  ctx.currentTime += dt;
  a.latch(st); a.update(st, dt, paused);
  frame++;
};

// --- steady engine pitch: monotonic in rpm ---
const freqs = [];
for (const rpm of [1100, 2000, 3500, 5000, 6500, 8000, 8500]) {
  for (let i = 0; i < 120; i++) step(car({ rpm, throttle: 0.6, speed: 30 }));
  freqs.push(a.n.saw1.frequency.last);
}
for (let i = 1; i < freqs.length; i++) check(freqs[i] > freqs[i - 1], `engine frequency not monotonic in rpm: ${freqs.join(', ')}`);
check(Math.abs(freqs[0] - 55) < 2, `idle firing frequency should be about 55 Hz (flat-six), got ${freqs[0]}`);

// --- scripted run: idle, full throttle through the gears, lift-off, lock-up, kerb, gravel, hit ---
const seqStart = frame;
for (let i = 0; i < 120; i++) step(car());                                              // idle
let gear = 1, rpm = 1100, sp = 0;
for (let i = 0; i < 60 * 24; i++) {                                                     // full throttle up the box
  sp += 0.55; rpm = Math.min(8500, sp * 14 * (1.3 - gear * 0.18) + 1100);
  let shift = 0;
  if (rpm > 8250 && gear < 6) { gear++; shift = 1; rpm *= 0.78; }
  step(car({ rpm, gear, throttle: 1, speed: sp, fwdSpeed: sp, events: { shift, hit: 0 } }));
}
for (let i = 0; i < 90; i++) step(car({ rpm: 8400 - i * 20, gear: 6, throttle: 0, speed: sp }));   // lift-off at high rpm: crackle
for (let i = 0; i < 90; i++) step(car({ rpm: 5000, throttle: 1, speed: 60, spin: true, slipR: 3.5, slipF: 0.5, wheelSurf: [0, 0, 0, 0] }));  // wheelspin
for (let i = 0; i < 90; i++) step(car({ rpm: 4000, brake: 1, speed: 50, lock: true, slipF: 4, slipR: 1, abs: true }));                     // lock-up
for (let i = 0; i < 90; i++) step(car({ rpm: 5000, throttle: 0.5, speed: 40, wheelSurf: [SURF.KERB, SURF.TARMAC, SURF.KERB, SURF.TARMAC], bump: 0.3, bumpSpacing: 0.9 }));
for (let i = 0; i < 60; i++) step(car({ rpm: 5000, throttle: 0.5, speed: 40, wheelSurf: [SURF.SAUSAGE, SURF.SAUSAGE, SURF.RUMBLE, SURF.RUMBLE], bump: 1, bumpSpacing: 0.7 }));
for (const s of [SURF.GRAVEL, SURF.GRASS, SURF.RUNOFF_ROUGH, SURF.RUNOFF]) for (let i = 0; i < 60; i++) step(car({ rpm: 3000, throttle: 0.2, speed: 30, wheelSurf: [s, s, s, s], bump: 0.5, bumpSpacing: 0.35 }));
for (let i = 0; i < 30; i++) step(car({ rpm: 3000, speed: 45, events: { shift: 0, hit: i === 3 ? 14 : 0 } }));                          // barrier hit
check(a.n.thumpGain.gain.writes >= 2 && a.n.thump.frequency.writes >= 2, 'barrier hit did not write the thump envelope');
// hostile values must be absorbed
for (const bad of [NaN, Infinity, -5, undefined, 1e9]) step(car({ rpm: bad, throttle: bad, speed: bad, slipF: bad, slipR: bad, bump: bad, bumpSpacing: bad, events: { shift: 0, hit: bad } }));
check(frame > seqStart + 1000, 'sequence did not run');

// --- shift dip, limiter, crackle actually act ---
{
  const eg = a.n.engGain.gain;
  for (let i = 0; i < 60; i++) step(car({ rpm: 6000, throttle: 1, speed: 60 }));
  const before = eg.last;
  step(car({ rpm: 6000, throttle: 1, speed: 60, events: { shift: 1, hit: 0 } }));
  check(eg.last < before * 0.6, 'gear shift did not dip the engine level');
  for (let i = 0; i < 30; i++) step(car({ rpm: 6000, throttle: 1, speed: 60 }));
  const lim = new Set();
  for (let i = 0; i < 30; i++) { step(car({ rpm: 8500, throttle: 1, speed: 70 })); lim.add(Math.round(eg.last * 1000)); }
  check(lim.size > 1, 'limiter does not stutter near redline');
  for (let i = 0; i < 30; i++) step(car({ rpm: 8000, throttle: 1, speed: 70 }));
  const w0 = a.n.crackGain.gain.writes;
  for (let i = 0; i < 60; i++) step(car({ rpm: 7500, throttle: 0, speed: 70 }));
  check(a.n.crackGain.gain.writes > w0 + 3, 'no crackle on lift-off at high rpm');
  const w1 = a.n.crackGain.gain.writes;
  for (let i = 0; i < 120; i++) step(car({ rpm: 2500, throttle: 0, speed: 20 }));
  check(a.n.crackGain.gain.writes === w1, 'crackle at low rpm');
}

// --- squeal and surfaces respond ---
{
  const lvl = (st) => { for (let i = 0; i < 90; i++) step(st); return a.n; };
  lvl(car({ rpm: 4000, brake: 1, speed: 50, lock: true, slipF: 3, slipR: 1 }));
  check(a.n.sqFGain.gain.last > 0.1, 'lock-up squeal missing');
  lvl(car({ rpm: 5000, throttle: 1, speed: 40, spin: true, slipR: 3 }));
  check(a.n.sqRGain.gain.last > 0.1, 'wheelspin squeal missing');
  lvl(car({ rpm: 3000, speed: 40, wheelSurf: [6, 6, 6, 6] }));
  check(a.n.gravelGain.gain.last > 0.05 && a.n.sqFGain.gain.last < 0.01, 'gravel bed missing or squeal on gravel');
  lvl(car({ rpm: 3000, speed: 40, wheelSurf: [SURF.RUMBLE, SURF.RUMBLE, SURF.RUMBLE, SURF.RUMBLE], bump: 1, bumpSpacing: 0.45 }));
  check(a.n.buzzGain.gain.last > 0.1 && Math.abs(a.n.buzz.frequency.last - 40 / 0.45) < 1, 'rumble buzz level or frequency wrong');
  lvl(car({ rpm: 3000, speed: 40 }));
  check(a.n.buzzGain.gain.last < 0.01 && a.n.gravelGain.gain.last < 0.01, 'surface layers did not fall silent on tarmac');
}

// --- pause, mute, hidden tab ---
{
  for (let i = 0; i < 30; i++) step(car({ rpm: 3000, throttle: 0.5, speed: 30 }), 1 / 60, true);
  check(a.n.master.gain.last === 0 && ctx.state === 'suspended', 'pause did not silence and suspend');
  step(car({ rpm: 3000, throttle: 0.5, speed: 30 }));
  check(ctx.state === 'running' && a.n.master.gain.last > 0, 'did not resume after pause');
  settings.sound = false;
  for (let i = 0; i < 30; i++) step(car({ rpm: 3000, throttle: 0.5, speed: 30 }));
  check(a.n.master.gain.last === 0, 'mute did not silence');
  settings.sound = true; step(car());
  doc.hidden = true; doc.fire('visibilitychange');
  check(ctx.state === 'suspended', 'hidden tab did not suspend');
  step(car());
  check(ctx.state === 'suspended', 'resumed while hidden');
  doc.hidden = false; doc.fire('visibilitychange'); step(car());
  check(ctx.state === 'running', 'did not resume when the tab came back');
}

// --- nothing created per frame ---
// --- thunder: delayed, bounded, nothing created, harmless with garbage and before audio exists ---
{
  const g = a.n.thGain.gain, before = g.writes;
  a.thunder(2.5, 0.8); a.thunder(0.5, 1); a.thunder(-5, 7); a.thunder(NaN, NaN); a.thunder(1e9, -3); a.thunder();
  check(g.writes > before + 20, 'thunder writes the gain envelope');
  check(a.n.thGain.gain.last >= 0 && a.n.thGain.gain.last <= 2, 'thunder gain stays in bounds');
  for (let i = 0; i < 60; i++) step(car({ rpm: 3000, throttle: 0.5, speed: 40 }));
  const off = new CarAudio({ sound: true, volume: 0.7 }, { ctor: FakeContext, muted: true, rand });
  off.thunder(1, 1);   // muted: no context, no error
}
check(ctx.created.length === setupCount, `nodes created after setup: ${setupCount} -> ${ctx.created.length}`);
check(setupCount <= 70, `too many nodes: ${setupCount}`);

// --- teardown ---
const nodes = ctx.created.slice();
a.dispose();
check(nodes.every(n => n.disconnected), 'dispose left a node connected');
check(nodes.filter(n => n.kind === 'oscillator' || n.kind === 'source').every(n => n.stopped), 'dispose left a source running');
check(ctx.closed, 'dispose did not close the context');
check(win.count() === 0 && doc.count() === 0, 'dispose left listeners attached');
a.update(car(), 0.016); a.latch(car());   // harmless after dispose

// --- a context that throws must not break the game ---
{
  class Bad { constructor() { throw new Error('no audio device'); } }
  const b = new CarAudio({ sound: true, volume: 1 }, { ctor: Bad, rand }), t = new Target();
  b.attach(t, null); t.fire('keydown'); b.update(car(), 0.016);
  check(b.disabled, 'a failing AudioContext should disable audio quietly');
}

console.log(fails.length ? 'audio FAILED:\n  ' + [...new Set(fails)].slice(0, 25).join('\n  ') : `audio: ${setupCount} nodes, ${frame} frames, every parameter finite and in bounds, engine pitch monotonic, teardown clean`);
process.exitCode = fails.length ? 1 : 0;
