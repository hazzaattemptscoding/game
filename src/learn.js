// The learning autopilot (experimental): an evolution strategy that searches for a faster way round the lap than the geometric racing
// line of src/autopilot.js. Pure logic, no DOM: it runs in a Web Worker in the game (src/learnWorker.js) and in node (tools/learn.js).
//
// A genome is a flat vector of numbers in -1..1 (all zeros = today's autopilot, exactly). It holds
//   - 80 lateral offsets of the line, spread round the lap and interpolated smoothly (added to the racing line, kept inside the edges),
//   - per corner: a brake point shift (metres, + brakes earlier) and a factor on the cornering speed,
//   - three global knobs: throttle ramp, brake ramp, steering look-ahead,
//   - the driver assists: per segment of the lap (24) and per assist (TC, ABS, ESC) off / keep the player's setting / on.
// The assists use the player's own on/off switches (Car.setAssists); the strengths are the class values and never change, so a learned
// lap can be repeated by a person with the assists menu.
//
// Fitness is the lap time of a flying lap in the real physics (Car, 120 Hz, assists as set), driven from the state at the start of lap 2
// of the plain autopilot. A lap with a cut (src/trackLimits.js), 3 wheels on grass or gravel, a barrier hit, a spin or a stop is invalid
// and gets a large penalty that shrinks with how far the car got, so the search learns to stay legal.

import { SURF } from './track.js';
import { Car, STEP } from './physics.js';
import { LapTimer } from './timing.js';
import { TrackLimits, limitZones } from './trackLimits.js';
import { Autopilot, computeRacingLine, lineFromOffsets, speedProfile } from './autopilot.js';

export const NCTRL = 80;          // line offset control points round the lap
export const NSEG = 24;           // assist segments round the lap
export const OFFSET_RANGE = 5;    // metres a control point may move the line (the track edge limit still applies)
export const BRAKE_RANGE = 20;    // metres of brake point shift
export const SPEED_RANGE = 0.15;  // share of cornering speed
const SKILL = 0.9;                // the in-game autopilot
const PENALTY = 1000;
const wrapI = (i, n) => ((i % n) + n) % n;

// ---- random numbers (seeded, so a run can be repeated) ----
export function rng(seed) {
  let a = seed >>> 0 || 1;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.normal = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  next.state = () => a;
  return next;
}

// A short signature of the track build, so a saved genome is only used on the track it was learned on.
export function trackSig(T) {
  let h = 0;
  for (let k = 0; k < 64; k++) { const i = Math.floor(k * T.N / 64); h = (Math.imul(h, 31) + Math.round(T.x[i] * 10) + Math.imul(Math.round(T.z[i] * 10), 7)) | 0; }
  return `${T.N}-${Math.round(T.length)}-${(h >>> 0).toString(36)}`;
}

// ---- corners, found in the plain autopilot's target speeds ----
// Returns [{ valley, from, to }]: the slowest sample of each corner and the samples where its zone starts and ends (halfway to the
// neighbouring corner when they touch, else the end of the stretch below 80 m/s).
export function findCorners(T, vmax, limit = 80, prominence = 4) {
  const N = T.N;
  let start = 0;
  let fastest = 0;
  for (let i = 0; i < N; i++) if (vmax[i] > vmax[fastest]) fastest = i;
  start = fastest;
  const corners = [];
  let run = null;
  const closeRun = () => {
    if (!run) return;
    const idx = run.idx, valleys = [];
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      let isMin = true;
      for (let d = -5; d <= 5 && isMin; d++) { const j = wrapI(i + d, N); if (vmax[j] < vmax[i] || (vmax[j] === vmax[i] && d < 0)) isMin = false; }
      if (isMin) valleys.push(k);
    }
    // merge valleys that are not separated by a rise of `prominence`
    const kept = [];
    for (const k of valleys) {
      const last = kept[kept.length - 1];
      if (last === undefined) { kept.push(k); continue; }
      let peak = 0;
      for (let m = last; m <= k; m++) peak = Math.max(peak, vmax[idx[m]]);
      if (peak - Math.max(vmax[idx[last]], vmax[idx[k]]) < prominence) { if (vmax[idx[k]] < vmax[idx[last]]) kept[kept.length - 1] = k; } else kept.push(k);
    }
    for (let q = 0; q < kept.length; q++) {
      const k = kept[q];
      let from = idx[0], to = idx[idx.length - 1];
      if (q > 0) { let b = kept[q - 1], best = b; for (let m = b; m <= k; m++) if (vmax[idx[m]] > vmax[idx[best]]) best = m; from = idx[best]; }
      if (q < kept.length - 1) { let b = kept[q + 1], best = k; for (let m = k; m <= b; m++) if (vmax[idx[m]] > vmax[idx[best]]) best = m; to = idx[best]; }
      corners.push({ valley: idx[k], from, to });
    }
    run = null;
  };
  for (let n = 0; n < N; n++) {
    const i = wrapI(start + n, N);
    if (vmax[i] < limit) { if (!run) run = { idx: [] }; run.idx.push(i); } else closeRun();
  }
  closeRun();
  return corners;
}

// ---- the genome layout ----
export function layoutFor(nCorners) {
  const off = 0, brake = off + NCTRL, speed = brake + nCorners, glob = speed + nCorners, assist = glob + 3;
  return { nCorners, off, brake, speed, glob, assist, dim: assist + NSEG * 3 };
}

// periodic cubic (Catmull-Rom) through the control points, one value per track sample
export function interpolate(ctrl, N) {
  const n = ctrl.length, out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const f = i * n / N, k = Math.floor(f), t = f - k;
    const p0 = ctrl[wrapI(k - 1, n)], p1 = ctrl[wrapI(k, n)], p2 = ctrl[wrapI(k + 1, n)], p3 = ctrl[wrapI(k + 2, n)];
    out[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }
  return out;
}

const clamp1 = v => (v < -1 ? -1 : v > 1 ? 1 : v);

// ---- a context: everything that depends on the track and the car class, built once ----
export function makeContext(T, cfg, { skill = SKILL, light = false, baseLine: given } = {}) {
  const baseLine = given || computeRacingLine(T);
  const baseVmax = speedProfile(T, baseLine, cfg, skill);
  const corners = findCorners(T, baseVmax);
  const layout = layoutFor(corners.length);
  const ctx = { T, cfg, skill, baseLine, baseVmax, corners, layout, zones: limitZones(), sig: trackSig(T), carId: cfg.id };
  if (light) return ctx;   // enough to decode a genome into a driver (the game's main thread); no training state
  // drive the plain autopilot from the standing start to the start of lap 2 and keep the car there
  const car = new Car(cfg, T);
  car.setAssists(true);
  car.placeAt(-20, 0);
  const ap = new Autopilot(T, cfg, { skill, line: baseLine, vmax: baseVmax });
  const timer = new LapTimer(T);
  let t = 0;
  while (timer.lap < 1 && t < 400) { car.step(ap.drive(car)); t += STEP; timer.update(car.loc.s, t); }
  ctx.snap = snapshotCar(car);
  ctx.baseTime = null;
  ctx.baseTime = evaluate(ctx, zeros(layout.dim)).time;
  return ctx;
}

export const zeros = n => new Float64Array(n);

export function snapshotCar(car) {
  const s = {};
  for (const k of Object.keys(car)) {
    if (k === 'track' || k === 'cfg') continue;
    const v = car[k];
    s[k] = Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? { ...v } : v;
  }
  return s;
}
export function restoreCar(snap, cfg, T) {
  const car = new Car(cfg, T);
  for (const k of Object.keys(snap)) { const v = snap[k]; car[k] = Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? { ...v } : v; }
  return car;
}

// ---- decoding a genome into a driver ----
// x: the genome. base: the player's assists { tc, abs, esc } (all on when missing).
export function decode(ctx, x, base) {
  const { T, cfg, layout: L, baseLine, baseVmax, corners } = ctx, N = T.N;
  let line = baseLine;
  let moved = false;
  for (let k = 0; k < NCTRL; k++) if (x[L.off + k] !== 0) { moved = true; break; }
  if (moved) {
    const ctrl = new Float64Array(NCTRL);
    for (let k = 0; k < NCTRL; k++) ctrl[k] = clamp1(x[L.off + k]) * OFFSET_RANGE;
    const delta = interpolate(ctrl, N), off = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const lim = (T.hw ? T.hw[i] : T.halfWidth) - 1.4;   // the same edge margin as computeRacingLine
      off[i] = Math.max(-lim, Math.min(lim, baseLine.off[i] + delta[i]));
    }
    line = lineFromOffsets(T, off);
  }
  let scale = null, anySpeed = false, anyBrake = false;
  for (let c = 0; c < corners.length; c++) { if (x[L.speed + c] !== 0) anySpeed = true; if (x[L.brake + c] !== 0) anyBrake = true; }
  if (anySpeed) {
    scale = new Float64Array(N).fill(1);
    corners.forEach((c, k) => {
      const f = 1 + clamp1(x[L.speed + k]) * SPEED_RANGE;
      for (let i = c.from; ; i = (i + 1) % N) { scale[i] = f; if (i === c.to) break; }
    });
  }
  let vmax = baseVmax;
  if (moved || anySpeed) vmax = speedProfile(T, line, cfg, ctx.skill, scale);
  if (anyBrake) {
    const src = vmax, out = Float64Array.from(src);
    corners.forEach((c, k) => {
      const sh = Math.round(clamp1(x[L.brake + k]) * BRAKE_RANGE / T.ds);
      if (!sh) return;
      let i0 = c.from;
      if (sh > 0) i0 = wrapI(c.from - sh, N);
      for (let i = i0; i !== c.valley; i = (i + 1) % N) {
        const ahead = (c.valley - i + N) % N;   // samples to the valley
        out[i] = src[sh > 0 && sh >= ahead ? c.valley : (i + sh + N) % N];
      }
    });
    vmax = out;
  }
  const tune = { throttle: 1 + 0.5 * clamp1(x[L.glob]), brake: 1 + 0.6 * clamp1(x[L.glob + 1]), look: 1 + 0.3 * clamp1(x[L.glob + 2]) };
  let plan = null;
  for (let k = 0; k < NSEG * 3; k++) {
    const g = x[L.assist + k];
    if (g <= -0.5 || g >= 0.5) { plan = plan || new Uint8Array(NSEG * 3); plan[k] = g < 0 ? 1 : 2; }
  }
  return { line, vmax, tune, assistPlan: plan, baseAssists: base || { tc: true, abs: true, esc: true } };
}

export function makeDriver(ctx, x, base) {
  return new Autopilot(ctx.T, ctx.cfg, { skill: ctx.skill, ...decode(ctx, x, base) });
}

// ---- evaluating a genome ----
const OFF_SURF = new Set([SURF.GRASS, SURF.GRAVEL]);
const CHECK_M = 100;    // metres between the checkpoints that the early stop compares

// One flying lap from the saved state. opts: { ref: { trace, total }, slack } stops early (fitness above the reference) when the car
// is `slack` seconds behind the reference at a checkpoint. Returns { fitness, time, valid, reason, progress, trace }.
export function evaluate(ctx, x, opts = {}) {
  const { T } = ctx, L = T.length;
  const car = restoreCar(ctx.snap, ctx.cfg, T);
  const drv = makeDriver(ctx, x, { tc: true, abs: true, esc: true });
  const limits = new TrackLimits(ctx.zones);
  const trace = new Float32Array(Math.ceil(L / CHECK_M) + 1);
  const ref = opts.ref, slack = opts.slack ?? 3, maxSteps = Math.round((ctx.baseTime ? ctx.baseTime * 1.5 : 200) / STEP);
  let steps = 0, dist = 0, prevS = car.loc.s, reason = null, cp = 0, aborted = false;
  while (true) {
    car.step(drv.drive(car));
    steps++;
    const t = steps * STEP, s = car.loc.s;
    let ds = s - prevS;
    if (ds < -L / 2) ds += L;
    dist += ds;
    const crossed = prevS > L - 200 && s < 200 && dist > L / 2;
    prevS = s;
    if (crossed) break;
    if (limits.update(car, t, 1, t)) { reason = 'cut'; break; }
    const ws = car.wheelSurf;
    if ((OFF_SURF.has(ws[0]) ? 1 : 0) + (OFF_SURF.has(ws[1]) ? 1 : 0) + (OFF_SURF.has(ws[2]) ? 1 : 0) + (OFF_SURF.has(ws[3]) ? 1 : 0) >= 3) { reason = 'off'; break; }
    if (car.events.hit > 0.5) { reason = 'hit'; break; }
    if (car.speed > 8) {
      let b = Math.atan2(-car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading), car.vx * Math.cos(car.heading) + car.vz * Math.sin(car.heading));
      if (Math.abs(b) > 0.7) { reason = 'spin'; break; }
    }
    if (t > 5 && car.speed < 1.5) { reason = 'stop'; break; }
    if (steps > maxSteps) { reason = 'slow'; break; }
    while (cp < trace.length - 1 && dist >= (cp + 1) * CHECK_M) { cp++; trace[cp] = t; if (ref && t > ref.trace[cp] + slack) { aborted = true; break; } }
    if (aborted) break;
  }
  const progress = Math.max(0, Math.min(1, dist / L));
  if (reason) return { fitness: PENALTY + (1 - progress) * 500, time: null, valid: false, reason, progress, trace };
  if (aborted) return { fitness: (ref.total || 1000) + slack + (1 - progress) * 20, time: null, valid: true, reason: 'behind', progress, trace };
  const time = steps * STEP;
  trace[trace.length - 1] = time;
  return { fitness: time, time, valid: true, reason: null, progress: 1, trace };
}

// The honest check: the lap the player would see. Standing start, two laps with the real LapTimer and track limits; lap 2 must be clean.
// base: the assists the player has set. Returns { time (lap 2), lap1, valid, reason }.
export function fullLap(ctx, x, base) {
  const { T, cfg } = ctx;
  const car = new Car(cfg, T);
  car.setAssists(base || true);
  car.placeAt(-20, 0);
  const drv = makeDriver(ctx, x, base);
  const timer = new LapTimer(T);
  let t = 0, reason = null;
  while (timer.lap < 2 && t < 400) {
    car.step(drv.drive(car));
    t += STEP;
    timer.update(car.loc.s, t);
    timer.checkLimits(car, t);
    if (timer.lap >= 1 && !reason) {
      if (car.events.hit > 0.5) reason = 'hit';
      const ws = car.wheelSurf;
      if (ws.filter(w => OFF_SURF.has(w)).length >= 3) reason = 'off';
    }
  }
  const h = timer.history;
  const lap2 = h[1];
  if (!lap2) return { time: null, lap1: h[0]?.time ?? null, valid: false, reason: 'unfinished' };
  if (!reason && !lap2.valid) reason = 'cut';
  return { time: lap2.time, lap1: h[0].time, valid: !reason, reason };
}

// ---- the evolution strategy ----
// Elitist (mu + lambda): the best genome always survives, so the best lap time never gets worse. Children come from localised
// changes (a bump in the line, one corner's brake point or speed, a stretch of assist switches), because a lap time is mostly the sum of
// what happens in different places. After each generation the changes that helped are also tried together.
export class Learner {
  constructor(ctx, { seed = 1, mu = 3, lambda = 10, state } = {}) {
    this.ctx = ctx;
    this.mu = mu; this.lambda = lambda;
    this.rand = rng(seed);
    this.gen = 0; this.evals = 0; this.sigma = 0.3;
    this.history = [];   // best lap time after every generation
    const zero = zeros(ctx.layout.dim);
    this.pop = [{ x: zero, fit: ctx.baseTime, trace: null }];
    if (state && state.x && state.x.length === ctx.layout.dim) {
      this.pop = [{ x: Float64Array.from(state.x), fit: state.fit, trace: null }, { x: zero, fit: ctx.baseTime, trace: null }].sort((a, b) => a.fit - b.fit);
      this.gen = state.gen || 0; this.evals = state.evals || 0;
    }
    this.needTrace = true;
  }
  get best() { return this.pop[0]; }

  mutate(parentX) {
    const { layout: L } = this.ctx, r = this.rand, s = this.sigma, x = Float64Array.from(parentX);
    const ops = r() < 0.3 ? 2 : 1;
    for (let o = 0; o < ops; o++) {
      const p = r();
      if (p < 0.35) {
        const c = Math.floor(r() * NCTRL), w = [2, 4, 8][Math.floor(r() * 3)], a = r.normal() * s * 1.5;
        for (let d = -2 * w; d <= 2 * w; d++) { const k = L.off + wrapI(c + d, NCTRL); x[k] = clamp1(x[k] + a * Math.exp(-(d * d) / (w * w))); }
      } else if (p < 0.65) {
        const n = 1 + Math.floor(r() * 3);
        for (let q = 0; q < n; q++) {
          const c = Math.floor(r() * L.nCorners);
          if (r() < 0.6) x[L.brake + c] = clamp1(x[L.brake + c] + r.normal() * s * 1.5);
          if (r() < 0.6) x[L.speed + c] = clamp1(x[L.speed + c] + r.normal() * s);
        }
      } else if (p < 0.75) {
        const k = L.glob + Math.floor(r() * 3);
        x[k] = clamp1(x[k] + r.normal() * s);
      } else if (p < 0.95) {
        const a = Math.floor(r() * 3), c = Math.floor(r() * NSEG), w = 1 + Math.floor(r() * 3), v = [-1, 0, 1][Math.floor(r() * 3)];
        for (let d = 0; d < w; d++) x[L.assist + wrapI(c + d, NSEG) * 3 + a] = v;
      } else {
        for (let k = 0; k < x.length; k++) if (r() < 0.2) x[k] = clamp1(x[k] + r.normal() * s * 0.3);
      }
    }
    return x;
  }

  // One generation. evalBatch(xs, ref) -> Promise of the evaluate() results, in order (it may run them in parallel).
  async generation(evalBatch) {
    const best = this.best, r = this.rand;
    if (!best.trace) {   // the first generation needs the reference lap's checkpoint times
      const [first] = await evalBatch([best.x], null);
      best.trace = first.trace; best.fit = first.fitness; this.evals++;
    }
    const ref = { trace: best.trace, total: best.fit };
    const kids = [];
    for (let k = 0; k < this.lambda; k++) {
      const parent = this.pop[Math.min(this.pop.length - 1, Math.floor(r() * r() * this.pop.length))];
      kids.push({ parent, x: this.mutate(parent.x) });
    }
    const res = await evalBatch(kids.map(k => k.x), ref);
    this.evals += kids.length;
    let wins = 0;
    const cand = [...this.pop];
    kids.forEach((k, i) => { k.res = res[i]; if (res[i].valid && res[i].time != null) { cand.push({ x: k.x, fit: res[i].fitness, trace: res[i].trace }); if (res[i].fitness < k.parent.fit - 1e-9) wins++; } });
    // the changes that helped, tried together
    const good = kids.filter(k => k.res.time != null && k.res.fitness < k.parent.fit - 1e-9 && k.parent === best);
    if (good.length >= 2) {
      const combo = Float64Array.from(best.x);
      for (const k of good) for (let j = 0; j < combo.length; j++) combo[j] = clamp1(combo[j] + (k.x[j] - best.x[j]));
      const [cr] = await evalBatch([combo], ref);
      this.evals++;
      if (cr.time != null) cand.push({ x: combo, fit: cr.fitness, trace: cr.trace });
    }
    cand.sort((a, b) => a.fit - b.fit);
    const next = [];
    for (const c of cand) { if (next.length >= this.mu) break; if (!next.some(n => n === c || n.fit === c.fit)) next.push(c); }
    this.pop = next;
    this.sigma = Math.max(0.12, Math.min(0.8, this.sigma * (wins / kids.length > 0.2 ? 1.15 : 0.92)));
    this.gen++;
    this.history.push(this.best.fit);
    return { gen: this.gen, best: this.best.fit, evals: this.evals, wins };
  }
}

// evaluate in this thread
export const localEvaluator = ctx => async (xs, ref) => xs.map(x => evaluate(ctx, x, ref ? { ref } : {}));

// ---- saving ----
export const genomeKey = (T, carId) => `lakeside-learn-${carId}-${trackSig(T)}`;
export function genomeToJSON(ctx, x, extra = {}) {
  return JSON.stringify({ v: 1, car: ctx.carId, track: ctx.sig, corners: ctx.layout.nCorners, x: Array.from(x, v => Math.round(v * 1e6) / 1e6), ...extra });
}
// Returns { x: Float64Array, ...extra } or null when the text is not a genome for this car and track.
export function genomeFromJSON(ctx, text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  if (!o || o.v !== 1 || o.car !== ctx.carId || o.track !== ctx.sig || o.corners !== ctx.layout.nCorners || !Array.isArray(o.x) || o.x.length !== ctx.layout.dim) return null;
  if (!o.x.every(v => Number.isFinite(v) && v >= -1 && v <= 1)) return null;
  return { ...o, x: Float64Array.from(o.x) };
}

export const fmtLap = t => (t == null ? '--' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);
