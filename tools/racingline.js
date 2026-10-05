// Racing line reference data. Run with `npm run racingline`; writes src/racingLineData.js.
//
// Drives lap 2 (flying) of Lakeside with the quick autopilot, assists on, the same car and driver as laptest's first
// run, and records for every sample (about 1 m) the lateral offset from the centreline, the speed, the longitudinal
// acceleration, the throttle and the brake. The offset is smoothed into a gentle line, clamped inside the track
// edges, and every sample gets one of three classes: b brake, l lift, t throttle, each lasting at least 8 m.
//
// The lap is deterministic (no random numbers anywhere in the car or the autopilot), so the file is reproducible:
// tools/racingline-test.js regenerates it and compares.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTrack, SURF } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';

export const EDGE_MARGIN = 1.2;      // the line stays at least this far inside the track edge (m)
export const MIN_RUN = 8;            // a class lasts at least this long (m)
export const MAX_LATERAL_RATE = 0.2; // metres of offset per metre of track
const SMOOTH_M = 12;                 // offset low-pass length (m)
const ROLL_ON = 12;                  // yellow metres after a brake zone, before full throttle
const SIGNAL_M = 4;                  // low-pass for the speed, throttle and brake signals (m)

const wrap = (i, n) => ((i % n) + n) % n;

// circular moving average over `w` samples, applied `passes` times
function smooth(a, w, passes = 1) {
  const n = a.length;
  let cur = Float64Array.from(a);
  const half = Math.max(1, Math.round(w / 2));
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) sum += cur[wrap(i + k, n)];
      out[i] = sum / (2 * half + 1);
    }
    cur = out;
  }
  return cur;
}

// fill the samples nobody visited by linear interpolation round the lap
function fillGaps(a, seen) {
  const n = a.length;
  const known = [];
  for (let i = 0; i < n; i++) if (seen[i]) known.push(i);
  if (!known.length) return;
  for (let k = 0; k < known.length; k++) {
    const i0 = known[k], i1 = known[(k + 1) % known.length];
    const gap = wrap(i1 - i0, n) || n;
    for (let g = 1; g < gap; g++) a[wrap(i0 + g, n)] = a[i0] + (a[i1] - a[i0]) * g / gap;
  }
}

// limit |d[i+1] - d[i]| to rate * ds, relaxing the whole lap until no step is too big
function limitRate(d, ds, rate) {
  const n = d.length, lim = rate * ds;
  for (let pass = 0; pass < 200; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, diff = d[j] - d[i];
      if (Math.abs(diff) > lim + 1e-9) { const excess = (Math.abs(diff) - lim) / 2 * Math.sign(diff); d[i] += excess; d[j] -= excess; changed = true; }
    }
    if (!changed) break;
  }
}

// Merge every run shorter than `min` samples into a neighbour (the longer one), shortest first, round the lap.
function enforceRuns(c, min) {
  const n = c.length;
  for (;;) {
    // rotate so index 0 starts a run
    let start = 0;
    while (start < n && c[start] === c[wrap(start - 1, n)]) start++;
    if (start === n) return c;   // one class all round
    const runs = [];
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && c[wrap(start + j, n)] === c[wrap(start + i, n)]) j++;
      runs.push({ at: wrap(start + i, n), len: j - i, cls: c[wrap(start + i, n)] });
      i = j;
    }
    let shortest = -1;
    for (let r = 0; r < runs.length; r++) if (runs[r].len < min && (shortest < 0 || runs[r].len < runs[shortest].len)) shortest = r;
    if (shortest < 0) return c;
    const prev = runs[(shortest - 1 + runs.length) % runs.length], next = runs[(shortest + 1) % runs.length];
    const into = prev.len >= next.len ? prev.cls : next.cls;
    for (let k = 0; k < runs[shortest].len; k++) c[wrap(runs[shortest].at + k, n)] = into;
  }
}

export function classify(brake, thr, ax) {
  if (brake > 0.15 || ax < -3) return 'b';
  if (thr >= 0.8) return 't';
  if (thr < 0.05) return 'l';           // coasting: speed falling
  if (ax > 1.5) return 't';             // part throttle but accelerating
  return 'l';
}

export function generate() {
  const T = buildTrack();
  const line = computeRacingLine(T);
  const car = new Car(GT, T);
  car.setAssists(true);
  car.placeAt(-20, 0);
  const ap = new Autopilot(T, GT, { skill: 0.9, line });
  const timer = new LapTimer(T);
  const N = T.N;
  const acc = ['d', 'v', 'ax', 'thr', 'brk'].reduce((o, k) => (o[k] = new Float64Array(N), o), {});
  const cnt = new Float64Array(N);
  let t = 0, offTrack = 0, samples = 0, wallHits = 0;
  while (timer.lap < 2 && t < 400) {
    const inp = ap.drive(car);
    car.step(inp);
    t += STEP;
    timer.update(car.loc.s, t);
    if (timer.lap < 1) continue;
    const i = car.loc.i;
    acc.d[i] += car.loc.d; acc.v[i] += car.fwdSpeed; acc.ax[i] += car.ax; acc.thr[i] += inp.throttle; acc.brk[i] += inp.brake; cnt[i]++;
    samples++;
    if (car.wheelSurf.some(s => s === SURF.GRASS || s === SURF.GRAVEL)) offTrack++;
    if (car.events.hit > 0.5) wallHits++;
  }
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (cnt[i]) { seen[i] = 1; for (const k in acc) acc[k][i] /= cnt[i]; }
  for (const k in acc) fillGaps(acc[k], seen);

  // the offset: low-pass, clamp to the edge, limit the lateral rate, round
  const w = Math.round(SMOOTH_M / T.ds);
  let d = smooth(acc.d, w, 2);
  const limAt = i => T.hw[i] - EDGE_MARGIN;
  let clamped = 0;
  for (let i = 0; i < N; i++) { if (Math.abs(d[i]) > limAt(i)) { d[i] = Math.sign(d[i]) * limAt(i); clamped++; } }
  limitRate(d, T.ds, MAX_LATERAL_RATE);
  d = smooth(d, Math.round(4 / T.ds), 1);
  const dOut = Array.from(d, (v, i) => { const m = Math.floor(limAt(i) * 20 + 1e-9) / 20; return Math.max(-m, Math.min(m, Math.round(v * 20) / 20)); })   // rounded to 5 cm, never past the limit;

  // the classes from the smoothed signals
  const sw = Math.round(SIGNAL_M / T.ds);
  const brk = smooth(acc.brk, sw), thr = smooth(acc.thr, sw), ax = smooth(acc.ax, sw);
  const raw = [];
  for (let i = 0; i < N; i++) raw.push(classify(brk[i], thr[i], ax[i]));
  const minRun = Math.ceil(MIN_RUN / T.ds) + 1;
  const merged = enforceRuns(raw, minRun);
  // The autopilot goes from the brakes to full throttle in about 6 m, so a yellow "roll back on" is added: the first
  // ROLL_ON metres of any throttle run that follows a brake zone directly (when the throttle run is long enough).
  const roll = Math.ceil(ROLL_ON / T.ds);
  for (let i = 0; i < N; i++) {
    if (merged[i] !== 'b' || merged[(i + 1) % N] !== 't') continue;
    let len = 0;
    while (len < N && merged[(i + 1 + len) % N] === 't') len++;
    if (len >= 3 * roll) for (let k = 1; k <= roll; k++) merged[(i + k) % N] = 'l';
  }
  const cls = merged.join('');

  const rawOff = acc.d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const quality = { lap: timer.last, offTrack: (100 * offTrack / Math.max(1, samples)).toFixed(1) + '%', wallHits, clamped, maxRawOffset: +rawOff.toFixed(2), unvisited: N - seen.reduce((a, b) => a + b, 0) };
  const data = { length: +T.length.toFixed(2), ds: +T.ds.toFixed(6), d: dOut, c: cls };
  return { data, quality, N };
}

export function render(data) {
  const rows = [];
  for (let i = 0; i < data.d.length; i += 20) rows.push('  ' + data.d.slice(i, i + 20).join(','));
  const cls = [];
  for (let i = 0; i < data.c.length; i += 100) cls.push(`  '${data.c.slice(i, i + 100)}'`);
  return `// Generated by \`npm run racingline\` (tools/racingline.js). Do not edit by hand.
// The reference lap for the optional racing line: the quick autopilot, assists on, lap 2, one entry per track sample.
//   length  track length in metres when this was generated
//   ds      sample spacing in metres
//   d       sideways offset from the centreline in metres (positive on the side of T.nx), rounded to 5 cm
//   c       class per sample: b brake, l lift, t throttle
export default {
  length: ${data.length},
  ds: ${data.ds},
  d: [
${rows.join(',\n')}
  ],
  c: [
${cls.join(',\n')}
  ].join(''),
};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { data, quality } = generate();
  const file = new URL('../src/racingLineData.js', import.meta.url);
  const text = render(data);
  writeFileSync(file, text);
  const count = ch => [...data.c].filter(x => x === ch).length;
  console.log(`Racing line: ${data.d.length} samples, ${(text.length / 1024).toFixed(1)} KB`);
  console.log(`  reference lap ${quality.lap?.toFixed(3)} s, off track ${quality.offTrack}, wall hits ${quality.wallHits}, samples clamped to the edge margin ${quality.clamped}, largest raw offset ${quality.maxRawOffset} m`);
  console.log(`  brake ${count('b')} m, lift ${count('l')} m, throttle ${count('t')} m`);
}
