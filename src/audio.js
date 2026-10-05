// Car sound, synthesised in the browser with Web Audio. No audio files.
//
// This module only READS the car (rpm, gear, throttle, slip, wheelSurf, bump,
// events) and never changes it. All the nodes are made once, when the first
// key press, click or touch unlocks audio; after that each frame only writes
// parameters with setTargetAtTime, so nothing is created per frame.
//
//   engine   a flat-six (firing frequency = rpm / 60 * 3): two detuned saws, a
//            square and a sub sine, through a waveshaper and a low-pass filter
//            that opens with rpm and throttle, plus filtered intake noise and
//            overrun crackle.
//   tyres    band-passed noise, front and rear, from slip angle, lock and spin.
//   surfaces kerb / rumble buzz at speed / spacing, gravel crunch, grass hiss,
//            drag whoosh, road and wind noise, and a thump on barrier contact.

import { SURF } from './track.js';

// ---- Tuning constants: adjust these by ear ---------------------------------
export const TUNE = {
  master: 0.8,           // overall level before the player's volume slider
  engineLevel: 0.34,     // engine body loudness
  subLevel: 0.55,        // the sub oscillator, relative to the saws
  squareLevel: 0.35,     // the square (hollow, pipe-like) layer
  detuneCents: 11,       // detune of the second saw; more = more beating and "roughness"
  shaperDrive: 2.6,      // waveshaper grit; 1 = clean, 5 = fuzzy
  cutoffBase: 450,       // engine low-pass cutoff (Hz) at idle, off throttle
  cutoffRpm: 3200,       // added at the redline
  cutoffThrottle: 2800,  // added at full throttle
  rpmEase: 0.05,         // seconds the pitch takes to follow rpm (higher hides shifts, lower is more twitchy)
  offThrottleLevel: 0.3, // engine level at zero throttle, relative to full throttle
  intakeLevel: 0.2,      // intake roar under throttle
  shiftDipSec: 0.12,     // length of the dip on each gear change
  shiftDipTo: 0.35,      // engine level during that dip
  limiterAt: 0.985,      // share of redline where the limiter stutter starts (throttle held)
  limiterHz: 13,         // stutter rate
  limiterDip: 0.25,      // level in the quiet half of each stutter
  crackleMinRpm: 4500,   // lift-off crackle only above this rpm
  crackleSec: 0.9,       // how long the crackle lasts after a lift
  crackleChance: 0.3,    // chance per frame of a pop while it lasts
  crackleLevel: 0.55,    // pop loudness
  squealLevel: 0.34,     // tyre squeal overall
  squealStart: 0.9,      // slip angle (as a share of the grip peak) where squeal starts
  squealFull: 2.4,       // and where it is at full strength
  squealFrontHz: 1500,   // front tyre pitch
  squealRearHz: 1050,    // rear tyre pitch
  lockLevel: 0.85,       // squeal level under lock-up (front) and wheelspin (rear), 0 to 1
  buzzLevel: 0.34,       // kerb / rumble / sausage buzz
  buzzMinHz: 14,         // lowest and highest buzz pitch
  buzzMaxHz: 230,
  gravelLevel: 0.5,      // gravel crunch
  grassLevel: 0.22,      // grass hiss
  whooshLevel: 0.3,      // drag whoosh when ploughing through gravel or grass
  roadLevel: 0.11,       // road rumble with speed
  windLevel: 0.42,       // wind noise, rises with speed squared
  topSpeed: 75,          // m/s that counts as full speed for road and wind
  hitLevel: 0.9,         // barrier thump
  hitFullSpeed: 12,      // impact speed (m/s) that gives the full thump
};

const HARD = new Set([SURF.TARMAC, SURF.PAINT, SURF.KERB, SURF.RUNOFF, SURF.PIT, SURF.RUMBLE, SURF.RUNOFF_ROUGH]);
// how much each surface shakes the buzz layer
const BUZZ = { [SURF.KERB]: 0.55, [SURF.SAUSAGE]: 1, [SURF.RUMBLE]: 1, [SURF.RUNOFF_ROUGH]: 0.3, [SURF.RUNOFF]: 0.12 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class CarAudio {
  // opts: ctor (AudioContext class, default the browser's), muted (the ?mute switch), rand (for tests)
  constructor(settings = {}, opts = {}) {
    this.settings = settings;
    this.disabled = !!opts.muted;
    this.Ctor = opts.ctor || (typeof globalThis !== 'undefined' ? (globalThis.AudioContext || globalThis.webkitAudioContext) : undefined);
    this.rand = opts.rand || Math.random;
    this.ctx = null; this.n = null; this.all = [];
    this.hidden = false; this.quiet = 0; this.listeners = [];
    this.pending = { shift: 0, hit: 0 };
    this.rpmS = 0; this.prevThr = 0; this.dip = 0; this.limPhase = 0; this.overrun = 0; this.hitCool = 0;
    if (!this.Ctor) this.disabled = true;
  }

  // Unlock on the first key press, click or touch, and pause when the tab is hidden.
  attach(target, doc) {
    if (this.disabled || !target) return;
    const go = () => this.unlock();
    for (const t of ['keydown', 'pointerdown', 'touchstart', 'mousedown']) { target.addEventListener(t, go, { passive: true }); this.listeners.push([target, t, go]); }
    if (doc) {
      const vis = () => {
        this.hidden = !!doc.hidden;
        if (this.hidden && this.ctx && this.ctx.state === 'running') this.safe(() => this.ctx.suspend());
      };
      doc.addEventListener('visibilitychange', vis); this.listeners.push([doc, 'visibilitychange', vis]);
      this.hidden = !!doc.hidden;
    }
  }

  // Call after every physics step: events are cleared by the next step, so latch them here.
  latch(car) {
    const e = car && car.events;
    if (!e) return;
    if (e.shift) this.pending.shift = e.shift;
    if (e.hit > this.pending.hit) this.pending.hit = e.hit;
  }

  safe(fn) {
    try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { /* audio is optional */ }
  }

  unlock() {
    if (this.disabled) return;
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this.hidden) this.safe(() => this.ctx.resume()); return; }
    try {
      this.ctx = new this.Ctor({ latencyHint: 'interactive' });
      this.build();
      if (this.ctx.state === 'suspended') this.safe(() => this.ctx.resume());
    } catch (e) { this.disable(); }
  }

  disable() { this.disabled = true; this.dispose(); this.disabled = true; }

  mk(type, ...args) {
    const node = this.ctx[type](...args);
    this.all.push(node);
    return node;
  }

  build() {
    const c = this.ctx, T = TUNE, n = this.n = {};
    const gain = (v = 0) => { const g = this.mk('createGain'); g.gain.value = v; return g; };
    const filter = (type, f, q = 1) => { const b = this.mk('createBiquadFilter'); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const osc = (type, f = 100) => { const o = this.mk('createOscillator'); o.type = type; o.frequency.value = f; return o; };

    n.comp = this.mk('createDynamicsCompressor');
    n.master = gain(0);
    n.master.connect(n.comp); n.comp.connect(c.destination);

    // two seconds of white noise, shared by every noise layer
    const len = Math.max(1, Math.floor(c.sampleRate * 2)), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rand() * 2 - 1;
    const noise = (offset) => { const s = this.mk('createBufferSource'); s.buffer = buf; s.loop = true; n.sources.push([s, offset]); return s; };
    n.sources = [];
    n.noiseA = noise(0); n.noiseB = noise(0.9);
    n.oscs = [];
    const startOsc = o => { n.oscs.push(o); return o; };

    // --- engine ---
    n.saw1 = startOsc(osc('sawtooth')); n.saw2 = startOsc(osc('sawtooth')); n.sq = startOsc(osc('square')); n.sub = startOsc(osc('sine'));
    n.saw2.detune.value = T.detuneCents;
    n.shaper = this.mk('createWaveShaper');
    const curve = new Float32Array(257);
    for (let i = 0; i < curve.length; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * T.shaperDrive) / Math.tanh(T.shaperDrive); }
    n.shaper.curve = curve;
    n.engLP = filter('lowpass', T.cutoffBase, 0.8);
    n.engGain = gain(0);
    for (const [o, lvl] of [[n.saw1, 0.5], [n.saw2, 0.5], [n.sq, T.squareLevel], [n.sub, T.subLevel]]) { const g = gain(lvl); o.connect(g); g.connect(n.shaper); }
    n.shaper.connect(n.engLP); n.engLP.connect(n.engGain); n.engGain.connect(n.master);
    n.intakeBP = filter('bandpass', 600, 0.9); n.intakeGain = gain(0);
    n.noiseA.connect(n.intakeBP); n.intakeBP.connect(n.intakeGain); n.intakeGain.connect(n.master);
    n.crackBP = filter('bandpass', 1500, 1.2); n.crackGain = gain(0);
    n.noiseA.connect(n.crackBP); n.crackBP.connect(n.crackGain); n.crackGain.connect(n.master);

    // --- tyres ---
    n.sqFBP = filter('bandpass', T.squealFrontHz, 9); n.sqFGain = gain(0);
    n.sqRBP = filter('bandpass', T.squealRearHz, 6); n.sqRGain = gain(0);
    n.noiseB.connect(n.sqFBP); n.sqFBP.connect(n.sqFGain); n.sqFGain.connect(n.master);
    n.noiseB.connect(n.sqRBP); n.sqRBP.connect(n.sqRGain); n.sqRGain.connect(n.master);

    // --- surfaces ---
    n.buzz = startOsc(osc('sawtooth', 60)); n.buzzLP = filter('lowpass', 700, 0.7); n.buzzGain = gain(0);
    n.buzz.connect(n.buzzLP); n.buzzLP.connect(n.buzzGain); n.buzzGain.connect(n.master);
    n.gravelBP = filter('bandpass', 2200, 0.7); n.gravelGain = gain(0);
    n.lfo = startOsc(osc('square', 20)); n.lfoGain = gain(0);
    n.noiseB.connect(n.gravelBP); n.gravelBP.connect(n.gravelGain); n.gravelGain.connect(n.master);
    n.lfo.connect(n.lfoGain); n.lfoGain.connect(n.gravelGain.gain);      // crunch: the level chops at a rate that follows speed
    n.grassLP = filter('lowpass', 700, 0.5); n.grassGain = gain(0);
    n.noiseA.connect(n.grassLP); n.grassLP.connect(n.grassGain); n.grassGain.connect(n.master);
    n.whooshBP = filter('bandpass', 400, 0.6); n.whooshGain = gain(0);
    n.noiseA.connect(n.whooshBP); n.whooshBP.connect(n.whooshGain); n.whooshGain.connect(n.master);
    n.roadLP = filter('lowpass', 350, 0.5); n.roadGain = gain(0);
    n.noiseB.connect(n.roadLP); n.roadLP.connect(n.roadGain); n.roadGain.connect(n.master);
    n.windBP = filter('bandpass', 1200, 0.5); n.windGain = gain(0);
    n.noiseA.connect(n.windBP); n.windBP.connect(n.windGain); n.windGain.connect(n.master);

    // --- barrier thump: a falling sine and a puff of low noise ---
    n.thump = startOsc(osc('sine', 50)); n.thumpGain = gain(0);
    n.thump.connect(n.thumpGain); n.thumpGain.connect(n.master);
    n.thumpLP = filter('lowpass', 800, 0.7); n.thumpNoise = gain(0);
    n.noiseB.connect(n.thumpLP); n.thumpLP.connect(n.thumpNoise); n.thumpNoise.connect(n.master);

    // --- thunder: low noise with a gain that thunder() shapes (nothing is created per clap) ---
    n.thLP = filter('lowpass', 150, 0.7); n.thGain = gain(0);
    n.noiseA.connect(n.thLP); n.thLP.connect(n.thGain); n.thGain.connect(n.master);

    for (const o of n.oscs) o.start();
    for (const [s, off] of n.sources) s.start(0, off);
    this.nodeCount = this.all.length;
  }

  // A clap of thunder `delay` seconds from now (the time the sound takes to arrive after the flash), strength 0..1. A rolling
  // rumble: a sharp rise, two lesser bursts and a long fall, with the low-pass sweeping down. Only changes parameters of nodes made at setup.
  thunder(delay = 1, strength = 0.7) {
    if (this.disabled || !this.ctx || !this.n) return;
    try {
      const c = this.ctx, n = this.n, k = clamp(num(strength, 0.7), 0, 1), t0 = c.currentTime + clamp(num(delay, 1), 0, 8), lvl = 0.35 + 0.75 * k;
      const g = n.thGain.gain, f = n.thLP.frequency;
      g.cancelScheduledValues(t0); f.cancelScheduledValues(t0);
      f.setTargetAtTime(380 + 200 * k, t0, 0.05);
      f.setTargetAtTime(95, t0 + 0.5, 0.9);
      g.setTargetAtTime(lvl, t0, 0.07);
      g.setTargetAtTime(lvl * 0.45, t0 + 0.45, 0.12);
      g.setTargetAtTime(lvl * 0.8, t0 + 0.95, 0.1);
      g.setTargetAtTime(lvl * 0.35, t0 + 1.35, 0.2);
      g.setTargetAtTime(0, t0 + 1.8, 0.8 + 1.2 * k);
    } catch (e) { this.disable(); }
  }

  // Once a frame. car is read only. paused = settings panel or report screen open.
  update(car, dt, paused = false) {
    if (this.disabled || !this.ctx || !this.n || !car) return;
    try { this.run(car, clamp(num(dt, 1 / 60), 0.001, 0.1), paused); } catch (e) { this.disable(); }
  }

  run(car, dt, paused) {
    const c = this.ctx, n = this.n, T = TUNE, S = this.settings;
    const wantOn = !paused && !this.hidden && S.sound !== false && num(S.volume, 0.7) > 0;
    if (!wantOn) {
      this.quiet += dt;
      n.master.gain.setTargetAtTime(0, c.currentTime, 0.03);
      if (this.quiet > 0.25 && c.state === 'running') this.safe(() => c.suspend());
      this.pending.shift = 0; this.pending.hit = 0;
      return;
    }
    this.quiet = 0;
    if (c.state === 'suspended') this.safe(() => c.resume());
    const now = c.currentTime, tc = (p, v, k) => p.setTargetAtTime(v, now, k);
    const vol = clamp(num(S.volume, 0.7), 0, 1);
    tc(n.master.gain, T.master * vol * vol, 0.04);

    const cfgIdle = 1100, cfgRed = 8500;
    const rpm = clamp(num(car.rpm, cfgIdle), 300, 12000);
    const thr = clamp(num(car.throttle, 0), 0, 1), sp = clamp(num(car.speed, 0), 0, 200);
    const spN = clamp(sp / T.topSpeed, 0, 1.3);
    const red = num(car.cfg && car.cfg.redline, cfgRed), idle = num(car.cfg && car.cfg.idleRpm, cfgIdle);

    // --- engine ---
    if (!this.rpmS) this.rpmS = rpm;
    this.rpmS += (rpm - this.rpmS) * (1 - Math.exp(-dt / T.rpmEase));
    const rpmN = clamp((this.rpmS - idle) / (red - idle), 0, 1.1);
    const f = this.rpmS / 60 * 3;                       // flat-six: 3 firings per revolution
    tc(n.saw1.frequency, f, 0.03); tc(n.saw2.frequency, f, 0.03); tc(n.sq.frequency, f, 0.03); tc(n.sub.frequency, f * 0.5, 0.03);
    if (this.pending.shift) { this.dip = T.shiftDipSec; this.pending.shift = 0; }
    let mult = 1;
    if (this.dip > 0) { this.dip -= dt; mult *= T.shiftDipTo; }
    if (thr > 0.6 && rpm >= red * T.limiterAt) { this.limPhase = (this.limPhase + dt * T.limiterHz) % 1; if (this.limPhase > 0.5) mult *= T.limiterDip; }
    else this.limPhase = 0;
    const load = T.offThrottleLevel + (1 - T.offThrottleLevel) * Math.pow(thr, 0.7);
    tc(n.engGain.gain, T.engineLevel * load * (0.55 + 0.45 * rpmN) * mult, 0.025);
    tc(n.engLP.frequency, T.cutoffBase + T.cutoffRpm * rpmN + T.cutoffThrottle * thr, 0.05);
    tc(n.intakeGain.gain, T.intakeLevel * Math.pow(thr, 1.5) * (0.3 + 0.7 * rpmN), 0.05);
    tc(n.intakeBP.frequency, 400 + 1700 * rpmN, 0.08);

    // lift-off crackle: random short pops while the overrun lasts
    if (this.prevThr > 0.5 && thr < 0.15 && rpm > T.crackleMinRpm) this.overrun = T.crackleSec;
    this.prevThr = thr;
    if (this.overrun > 0) {
      this.overrun -= dt;
      if (thr > 0.2) this.overrun = 0;
      else if (this.rand() < T.crackleChance) {
        n.crackBP.frequency.setValueAtTime(900 + 1800 * this.rand(), now);
        n.crackGain.gain.cancelScheduledValues(now);
        n.crackGain.gain.setValueAtTime(T.crackleLevel * (0.35 + 0.65 * this.rand()), now);
        n.crackGain.gain.setTargetAtTime(0, now + 0.003, 0.012);
      }
    }

    // --- what the wheels are on ---
    const ws = car.wheelSurf || [0, 0, 0, 0];
    let buzzW = 0, gravel = 0, grass = 0, hardF = 0, hardR = 0, sausage = 0;
    for (let w = 0; w < 4; w++) {
      const sf = ws[w];
      buzzW += (BUZZ[sf] || 0) / 4;
      if (sf === SURF.GRAVEL) gravel += 0.25;
      else if (sf === SURF.GRASS) grass += 0.25;
      else if (sf === SURF.SAUSAGE) sausage += 0.25;
      if (HARD.has(sf)) { if (w < 2) hardF += 0.5; else hardR += 0.5; }
    }

    // --- tyre squeal ---
    const slipF = num(car.slipF), slipR = num(car.slipR);
    let qf = smooth(T.squealStart, T.squealFull, slipF), qr = smooth(T.squealStart, T.squealFull, slipR);
    if (car.lock) { qf = Math.max(qf, T.lockLevel); qr = Math.max(qr, T.lockLevel * 0.55); }
    if (car.spin) qr = Math.max(qr, T.lockLevel);
    const sq = smooth(2, 12, sp);
    tc(n.sqFGain.gain, T.squealLevel * qf * hardF * sq, 0.03);
    tc(n.sqRGain.gain, T.squealLevel * qr * hardR * sq, 0.03);
    tc(n.sqFBP.frequency, T.squealFrontHz * (0.88 + 0.07 * Math.min(3, slipF)) * (car.lock ? 0.9 : 1), 0.05);
    tc(n.sqRBP.frequency, T.squealRearHz * (0.88 + 0.07 * Math.min(3, slipR)) * (car.spin ? 1.1 : 1), 0.05);

    // --- kerb and rumble buzz ---
    const spacing = clamp(num(car.bumpSpacing, 4), 0.2, 8);
    const bumpK = clamp(0.4 + num(car.bump, 0) * 1.2, 0.4, 1.4);
    const buzz = T.buzzLevel * clamp(buzzW * bumpK, 0, 1.2) * smooth(1, 12, sp);
    tc(n.buzz.frequency, clamp(sp / spacing, T.buzzMinHz, T.buzzMaxHz), 0.03);
    tc(n.buzzGain.gain, buzz, 0.03);
    tc(n.buzzLP.frequency, clamp(500 + sp * 10 - sausage * 300, 250, 1800), 0.05);

    // --- gravel, grass, drag whoosh ---
    const sN = smooth(1, 25, sp);
    const gv = T.gravelLevel * gravel * sN;
    tc(n.gravelGain.gain, gv * 0.55, 0.05);
    tc(n.lfoGain.gain, gv * 0.45, 0.05);
    tc(n.lfo.frequency, clamp(sp * 1.6, 6, 90), 0.05);
    tc(n.gravelBP.frequency, 1600 + 1200 * sN, 0.1);
    tc(n.grassGain.gain, T.grassLevel * grass * sN, 0.06);
    tc(n.grassLP.frequency, 400 + sp * 10, 0.1);
    tc(n.whooshGain.gain, T.whooshLevel * (gravel + 0.4 * grass) * Math.pow(clamp(sp / 40, 0, 1), 1.2), 0.08);
    tc(n.whooshBP.frequency, 250 + sp * 7, 0.1);

    // --- road and wind ---
    tc(n.roadGain.gain, T.roadLevel * spN * (hardF + hardR) / 2, 0.1);
    tc(n.roadLP.frequency, 200 + 500 * spN, 0.1);
    tc(n.windGain.gain, T.windLevel * spN * spN, 0.1);
    tc(n.windBP.frequency, 700 + 1600 * spN, 0.1);

    // --- barrier thump ---
    this.hitCool -= dt;
    const hit = this.pending.hit; this.pending.hit = 0;
    if (hit > 1 && this.hitCool <= 0) {
      this.hitCool = 0.15;
      const lvl = T.hitLevel * clamp(hit / T.hitFullSpeed, 0.15, 1);
      n.thump.frequency.cancelScheduledValues(now);
      n.thump.frequency.setValueAtTime(120, now);
      n.thump.frequency.setTargetAtTime(38, now, 0.06);
      n.thumpGain.gain.cancelScheduledValues(now);
      n.thumpGain.gain.setValueAtTime(lvl, now);
      n.thumpGain.gain.setTargetAtTime(0, now + 0.01, 0.12);
      n.thumpNoise.gain.cancelScheduledValues(now);
      n.thumpNoise.gain.setValueAtTime(lvl * 0.8, now);
      n.thumpNoise.gain.setTargetAtTime(0, now + 0.01, 0.09);
    }
  }

  // Stop and disconnect everything.
  dispose() {
    for (const [t, ev, fn] of this.listeners) { try { t.removeEventListener(ev, fn); } catch (e) { /* ignore */ } }
    this.listeners = [];
    if (this.n) {
      for (const o of this.n.oscs) this.safe(() => o.stop());
      for (const [s] of this.n.sources) this.safe(() => s.stop());
    }
    for (const node of this.all) this.safe(() => node.disconnect());
    this.all = []; this.n = null;
    const c = this.ctx; this.ctx = null;
    if (c) this.safe(() => c.close());
  }
}
