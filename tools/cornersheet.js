// Corner sheet: measures every corner with the real car, then decides its
// kerbs, run-off, barriers and distance boards. Run with `npm run cornersheet`.
//
// 1. Drives three flying laps with the average keyboard driver
//    (tools/drivers.js, assists on) and records speed, brake and position at
//    every metre. Keyboard is the baseline most players drive with.
// 2. For each corner in layout.js: entry, minimum and exit speed, the braking
//    zone, and where the car comes within 1 m of each track edge.
// 3. Departure tests with the real physics and surface drag
//    (reference/LAKESIDE_SAFETY_LAYOUT.md 3.1):
//      straight on: from the braking point, brakes locked, wheel straight
//      tangent: from the apex and the exit, heading along the track and
//               10 degrees either side, reaction time + 0.3 s, then brakes locked
//    Each test runs for the average and the new keyboard driver, at their
//    own speeds; the deeper one sizes the run-off.
//    The barrier goes at the deepest stopping point plus 30%.
// 4. Writes src/corners.js (read by the game) and docs/corner-sheet.md.
//
// To hand-tune a corner, edit it in src/corners.js and set `locked: true`;
// re-running this tool then keeps your numbers for that corner.

import { writeFileSync } from 'node:fs';
import { buildTrack, wrap } from '../src/track.js';
import { LAYOUT } from '../src/layout.js';
import { CORNERS as PREVIOUS } from '../src/corners.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { PROFILES, runLaps } from './drivers.js';

const MARGIN = 1.3;   // barrier distance = deepest stopping point x this
const KMH = 3.6;

// Starting sizes by class (rulebook 3.3). The departure tests override the barrier.
const CLASSES = {
  A: { apron: 16, gravel: 34, barrier: 60, note: 'end of a straight, 200 km/h or more' },
  B: { apron: 10, gravel: 22, barrier: 40, note: 'medium speed' },
  C: { apron: 11, gravel: 25, barrier: 40, note: 'quick sweep' },
  slow: { apron: 8, gravel: 12, barrier: 22, note: 'slow hairpin, under 90 km/h' },
  street: { apron: 0, gravel: 0, barrier: 0, note: 'street section, walls at the edge' },
};
const SEBRING = ['Scramble', 'Windsock Hairpin', 'Boundary Loop'];   // old runway concrete aprons

// ---------------------------------------------------------------------------
// 1. Telemetry lap

const base = buildTrack();
const hw = base.halfWidth;
// Keyboard is the baseline: speeds, braking, kerb contacts and the apex and
// exit come from the average keyboard driver; the run-off is sized for the
// worse of the average and the new keyboard driver.
const LAPS = 3;
const tel = lapTelemetry(base, 'average');
const telNew = lapTelemetry(base, 'new');

// Speed and brake averaged over LAPS flying laps, and every lap's line kept
// so a kerb goes wherever any lap touched the edge.
function lapTelemetry(T, profile) {
  const speed = new Float64Array(T.N), brake = new Float64Array(T.N), count = new Float64Array(T.N);
  const lines = [];
  let cur = null, lap = -1;
  const r = runLaps(T, GT, profile, { assists: true, laps: LAPS, onStep: (car, inp, timer) => {
    if (timer.lap !== lap) { lap = timer.lap; if (lap > LAPS) return; cur = new Float64Array(T.N).fill(NaN); lines.push(cur); }
    const i = car.loc.i;
    speed[i] += car.fwdSpeed; brake[i] += inp.brake; count[i]++;
    if (Number.isNaN(cur[i])) cur[i] = car.loc.d;
  } });
  for (let i = 0; i < T.N; i++) if (count[i]) { speed[i] /= count[i]; brake[i] /= count[i]; }
  // fill any samples the car skipped over
  for (let i = 0; i < T.N; i++) if (!count[i]) { const j = wrap(i - 1, T.N); speed[i] = speed[j]; brake[i] = brake[j]; }
  return { speed, brake, lines, lap: r.times.reduce((a, b) => a + b, 0) / r.times.length, profile: PROFILES[profile] };
}

// ---------------------------------------------------------------------------
// 2. Measure each corner

const at = s => wrap(Math.round(s / base.ds), base.N);
const between = (s, a, b) => { const L = base.length; const x = ((s - a) % L + L) % L, y = ((b - a) % L + L) % L; return x <= y; };
const streetZones = (LAYOUT.walls || []).map(([a, b]) => [base.sAtPointRaw(a), base.sAtPointRaw(b)]);

const measured = [];
let lastBrakeEnd = null, prevS1 = null;
for (const [p0, p1, name] of LAYOUT.corners) {
  if (/Straight|Bridge/.test(name)) continue;
  const s0 = base.sAtPointRaw(p0), s1 = base.sAtPointRaw(p1);
  const len = ((s1 - s0) % base.length + base.length) % base.length;
  let turn = 0;
  for (let k = 0; k <= len; k++) turn += base.curv[at(s0 + k)];
  const inside = turn > 0 ? 'R' : 'L', outside = turn > 0 ? 'L' : 'R';
  const street = streetZones.some(([a, b]) => between(s0 + len / 2, a, b));

  // braking zone: the longest run of braking (gaps under 25 m bridged, as
  // keyboard drivers brake in taps) that ends between 80 m before the corner
  // and its end
  let brakeStart = null, brakeEnd = null, run = null;
  const brakeRuns = [];
  for (let k = -450; k <= Math.round(len); k++) {
    if (tel.brake[at(s0 + k)] > 0.2) {
      if (run && k - run[1] < 25) run[1] = k; else brakeRuns.push(run = [k, k]);
    }
  }
  // a run that started before the previous corner ended belongs to that corner (the S-bend shares one)
  const prevEnd = prevS1 === null ? -Infinity : -(((s0 - prevS1) % base.length + base.length) % base.length);
  const mine = brakeRuns.filter(([a, b]) => b >= -80 && a > prevEnd).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
  if (mine && mine[1] - mine[0] >= 5) { brakeStart = s0 + mine[0]; brakeEnd = s0 + mine[1]; }
  // a braking zone belongs to the first corner that uses it (the S-bend shares one)
  if (brakeEnd !== null && lastBrakeEnd !== null && Math.abs(norm(brakeEnd) - norm(lastBrakeEnd)) < 1) { brakeStart = null; brakeEnd = null; }
  if (brakeEnd !== null) lastBrakeEnd = brakeEnd;
  prevS1 = s1;
  const from = brakeStart ?? s0;
  let minV = Infinity, apexS = s0;
  for (let k = 0; k <= ((s1 + 30 - from) % base.length + base.length) % base.length; k++) {
    const v = tel.speed[at(from + k)];
    if (v < minV) { minV = v; apexS = from + k; }
  }
  const entryV = tel.speed[at(from)];
  const exitS = apexS + Math.max(40, ((s1 - apexS) % base.length + base.length) % base.length);
  const exitV = tel.speed[at(exitS)];
  const brakeDistance = brakeStart === null ? 0 : ((brakeEnd - brakeStart) % base.length + base.length) % base.length;

  // where the car's body comes within 1 m of each edge (its half width is 1 m) on any lap
  const contacts = { L: [], R: [] };
  for (const side of ['L', 'R']) {
    let run = null;
    for (let k = -60; k <= len + 80; k++) {
      const s = s0 + k;
      const touch = tel.lines.some(line => { const d = line[at(s)]; return side === 'L' ? d < -(hw - 2) : d > hw - 2; });
      if (touch && !run) run = [s, s];
      else if (touch) run[1] = s;
      else if (run) { contacts[side].push(run); run = null; }
    }
    if (run) contacts[side].push(run);
  }

  // class
  const flat = brakeStart === null && minV > 0.95 * entryV;
  let cls = street ? 'street' : entryV * KMH >= 200 && brakeDistance > 0 ? 'A' : minV * KMH < 90 ? 'slow' : minV * KMH >= 130 ? 'C' : 'B';

  // kerbs: apex on the inside, plus 10 m either side; exit kerb on the outside only if the exit is fast
  const kerbs = { inside: [], outside: [] };
  if (!flat) {
    for (const [a, b] of contacts[inside]) if (between(a, s0 - 30, s0 + len + 30) || between(b, s0 - 30, s0 + len + 30)) kerbs.inside.push([a - 10, b + 10]);
    if (exitV * KMH > 110) for (const [a, b] of contacts[outside]) if (between(a, apexS, apexS + 200)) kerbs.outside.push([a - 5, b + 10]);
  }

  measured.push({
    name, points: [p0, p1], class: cls, inside, outside,
    entryKmh: round(entryV * KMH), minKmh: round(minV * KMH), exitKmh: round(exitV * KMH),
    brakeStart: brakeStart === null ? null : round(norm(brakeStart)), brakeEnd: brakeEnd === null ? null : round(norm(brakeEnd)),
    brakeDistance: round(brakeDistance), apexS: round(norm(apexS)), exitS: round(norm(exitS)),
    contacts: { inside: contacts[inside].map(r => r.map(v => round(norm(v)))), outside: contacts[outside].map(r => r.map(v => round(norm(v)))) },
    kerbs: { inside: kerbs.inside.map(r => r.map(v => round(norm(v)))), outside: kerbs.outside.map(r => r.map(v => round(norm(v)))) },
    zone: [round(norm(from - 20)), round(norm(exitS + 60))],
    flat,
    _s0: s0, _s1: s1, _from: from, _entryV: entryV, _minV: minV, _exitV: exitV, _apexS: apexS, _exitS: exitS,
  });
}

// ---------------------------------------------------------------------------
// 3. Sizes, departure tests, barriers

const colourGravel = (LAYOUT.gravel || []).map(([a, b, side, w]) => ({ a: base.sAtPointRaw(a), b: base.sAtPointRaw(b), side, w }));
for (const c of measured) {
  const start = CLASSES[c.class];
  c.apron = start.apron;
  c.gravel = start.gravel;
  // a colour-map gravel zone on this corner's outside only ever makes it deeper
  for (const z of colourGravel) if (z.side === c.outside && (between(c._apexS, z.a, z.b) || between(c._from, z.a, z.b))) c.gravel = Math.max(c.gravel, z.w);
  c.barrier = start.barrier;
  c.sebring = SEBRING.includes(c.name);
  c.sections = [];
}

// two passes: if a corner runs out of room, give it more gravel and test again
for (let pass = 0; pass < 2; pass++) {
  const T = buildTrack(LAYOUT, measured.map(publicFields));
  T.collide = () => null;            // the departure tests ignore barriers
  for (const c of measured) {
    if (c.class === 'street') { c.departures = streetDepartures(T, c); continue; }
    c.departures = departures(T, c);
    const deepest = Math.max(...c.departures.map(d => d.depth));
    c.needed = round(deepest * MARGIN);
    const room = roomAt(T, c);
    c.room = round(room.free);
    // the class size where it fits, never less than the departure tests need
    c.barrier = round(Math.max(c.needed, Math.min(CLASSES[c.class].barrier, room.free - 1)));
    c.constrained = false; c.reason = '';
    if (c.needed > room.free - 1) {
      if (pass === 0) c.gravel = Math.max(c.gravel, Math.round(room.free - c.apron - 4));
      c.barrier = Math.max(4, Math.floor(room.free - 1));
      c.constrained = true;
      c.reason = `needs ${c.needed} m of run-off, only ${round(room.free)} m before ${room.near}`;
    }
    c.gravel = Math.max(0, Math.min(c.gravel, c.barrier - c.apron - 3));
  }
}

// impact sections: where the departures reach the barrier line
const T = buildTrack(LAYOUT, measured.map(publicFields));
for (const c of measured) c.sections = sections(T, c);

// keep hand-tuned corners
const out = measured.map(c => {
  const prev = PREVIOUS.find(p => p.name === c.name);
  return prev && prev.locked ? prev : publicFields(c);
});

writeCorners(out);
writeDoc(out);
console.log(`Lap ${tel.lap.toFixed(3)} s. Wrote src/corners.js and docs/corner-sheet.md for ${out.length} corners.`);
for (const c of out) {
  console.log(`  ${c.name.padEnd(18)} ${c.class.padEnd(6)} entry ${String(c.entryKmh).padStart(3)} min ${String(c.minKmh).padStart(3)} brake ${String(c.brakeDistance).padStart(3)} m  barrier ${String(c.barrier).padStart(3)} m${c.constrained ? '  CONSTRAINED: ' + c.reason : ''}`);
}

// ---------------------------------------------------------------------------

function publicFields(c) {
  const keep = ['name', 'points', 'class', 'inside', 'outside', 'entryKmh', 'minKmh', 'exitKmh', 'brakeStart', 'brakeEnd', 'brakeDistance',
    'apexS', 'exitS', 'contacts', 'kerbs', 'zone', 'flat', 'apron', 'gravel', 'barrier', 'needed', 'room', 'sebring', 'departures',
    'sections', 'constrained', 'reason'];
  const o = {};
  for (const k of keep) if (c[k] !== undefined) o[k] = c[k];
  return o;
}

// Run one departure: start at s with sideways offset d, heading turned `angle`
// degrees outwards from the track, speed v. Returns the deepest point the car
// reached beyond the outside edge.
function depart(T, c, s, d, v, angle, reaction) {
  const car = new Car(GT, T);
  car.assists = false;
  car.placeAt(s, d);
  const g = c.outside === 'L' ? -1 : 1;
  car.heading += g * angle * Math.PI / 180;
  car.vx = v * Math.cos(car.heading); car.vz = v * Math.sin(car.heading);
  car.speed = v;
  const near = window(T, c);
  let depth = 0, deepS = s, deepAngle = 0, deepX = car.x, deepZ = car.z, t = 0;
  while (car.speed > 0.3 && t < 25) {
    car.step({ steer: 0, throttle: 0, brake: t < reaction ? 0 : 1, drs: false });
    t += STEP;
    const { i, dd } = near(car.x, car.z);
    const beyond = g * dd - hw;
    if (beyond > depth) {
      depth = beyond; deepS = T.s[i]; deepX = car.x; deepZ = car.z;
      const th = Math.atan2(car.vz, car.vx), tr = Math.atan2(T.tz[i], T.tx[i]);
      deepAngle = Math.abs(Math.atan2(Math.sin(th - tr), Math.cos(th - tr))) * 180 / Math.PI;
    }
  }
  return { depth: round(depth), s: round(deepS), angle: round(deepAngle) };
}

// The departure tests, run for the average and the new keyboard driver at
// their own speeds. Straight on starts where this driver would brake if they
// left it as late as they ever do; the tangent tests give them their
// reaction time plus 0.3 s to realise they are off before braking.
function departures(T, c) {
  const res = [];
  const start = c.brakeStart ?? norm(c._s0 - 20);
  for (const t of [tel, telNew]) {
    const p = t.profile, who = p.label.replace('Keyboard, ', '');
    const late = Math.max(0, 2 * p.brakeSpread - p.brakeEarly);
    const v0 = t.speed[at(start)];
    res.push({ test: `${who}: straight on`, ...depart(T, c, start, line0(start), v0, 0, late / Math.max(v0, 1)) });
    for (const [label, s] of [['apex', c._apexS], ['exit', c._exitS]]) {
      for (const angle of [-10, 0, 10]) res.push({ test: `${who}: ${label} ${angle > 0 ? '+' : ''}${angle}°`, ...depart(T, c, s, line0(s), t.speed[at(s)], angle, p.reaction + 0.3) });
    }
  }
  return res;
}

// where the average driver's first flying lap was across the track
function line0(s) { const d = tel.lines[0][at(s)]; return Number.isNaN(d) ? 0 : d; }

// Street corners have walls at the edge: just record where a car would hit them.
function streetDepartures(T, c) {
  return [{ test: 'straight on', depth: 0, s: c.brakeEnd ?? round(norm(c._s0)), angle: 0 }, { test: 'apex 0°', depth: 0, s: c.apexS, angle: 0 }];
}

// nearest centreline sample to a point, searching only this corner's stretch of track
function window(T, c) {
  const from = c._from - 400, len = ((c._exitS + 400 - from) % T.length + T.length) % T.length;
  const idx = [];
  for (let k = 0; k <= len; k += 2) idx.push(wrap(Math.round((from + k) / T.ds), T.N));
  return (x, z) => {
    let best = Infinity, bi = idx[0];
    for (const i of idx) { const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2; if (q < best) { best = q; bi = i; } }
    return { i: bi, dd: (x - T.x[bi]) * T.nx[bi] + (z - T.z[bi]) * T.nz[bi] };
  };
}

// how much room the outside of the corner has (from the track edge), and what is in the way
function roomAt(T, c) {
  const sd = c.outside === 'L' ? 0 : 1;
  let free = Infinity, at_i = 0;
  for (const dep of c.departures) {
    const i = at(dep.s);
    for (let k = -15; k <= 15; k++) {
      const j = wrap(i + k, T.N), r = T.room[sd][j] - hw;
      if (r < free) { free = r; at_i = j; }
    }
  }
  if (free === Infinity) return { free: Infinity, near: 'nothing' };
  // which part of the track is in the way
  const g = sd ? 1 : -1, d = hw + free + 2;
  const x = T.x[at_i] + T.nx[at_i] * d * g, z = T.z[at_i] + T.nz[at_i] * d * g;
  let best = Infinity, bj = 0;
  for (let j = 0; j < T.N; j++) {
    let gap = Math.abs(T.s[j] - T.s[at_i]); gap = Math.min(gap, T.length - gap);
    if (gap < 80) continue;
    const q = (x - T.x[j]) ** 2 + (z - T.z[j]) ** 2;
    if (q < best) { best = q; bj = j; }
  }
  const p = T.u[bj];
  const named = LAYOUT.corners.find(([a, b]) => a <= b ? p >= a && p <= b : p >= a || p <= b);
  return { free, near: named ? named[2] : `point ${p.toFixed(1)}` };
}

// group the impact points into barrier sections 20 to 40 m long, staggered and overlapped
function sections(T, c) {
  const out = [];
  if (c.class === 'street') {
    // tyre walls in front of the street walls where a car would arrive
    for (const s of [c.brakeEnd, c.apexS].filter(v => v != null)) out.push({ s, side: c.outside, offset: 0, length: 20, angle: 0 });
    return dedupe(out);
  }
  const length = Math.round(Math.min(40, Math.max(20, c.entryKmh / 7)));
  const pts = c.departures.filter(d => d.depth > 0.5).map(d => ({ s: d.s, angle: Math.min(25, d.angle / 2) }));
  pts.sort((a, b) => a.s - b.s);
  const groups = [];
  for (const p of pts) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(p.s - g[g.length - 1].s) < length * 0.75) g.push(p); else groups.push([p]);
  }
  groups.forEach((g, n) => {
    const s = g.reduce((a, p) => a + p.s, 0) / g.length;
    const angle = g.reduce((a, p) => a + p.angle, 0) / g.length;
    const span = g[g.length - 1].s - g[0].s;
    out.push({ s: round(norm(s)), side: c.outside, offset: round(c.barrier + (n % 2) * 1.0), length: Math.min(40, round(length + span)), angle: round(angle) });
  });
  // overlap neighbouring sections by 5 m
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1], b = out[k];
    const gap = (b.s - b.length / 2) - (a.s + a.length / 2);
    if (gap > -5 && gap < 30) { const grow = Math.min((gap + 5) / 2, 40 - a.length, 40 - b.length); if (grow > 0) { a.length = round(a.length + grow); b.length = round(b.length + grow); a.s = round(a.s + grow / 2); b.s = round(b.s - grow / 2); } }
  }
  return out;
}

function dedupe(list) {
  return list.filter((x, k) => !list.slice(0, k).some(y => Math.abs(y.s - x.s) < 15)).map(x => ({ ...x, s: round(x.s) }));
}

function norm(s) { const L = base.length; return ((s % L) + L) % L; }
function round(v) { return Math.round(v * 10) / 10; }

// ---------------------------------------------------------------------------
// Output

function writeCorners(list) {
  const header = `// Per-corner decisions for Lakeside. GENERATED by \`npm run cornersheet\`
// (tools/cornersheet.js) from three flying laps with the average keyboard driver
// (tools/drivers.js) and the real car. Read by
// src/track.js to build kerbs, run-off, gravel, barriers and distance boards.
//
// To tune a corner by hand: change its numbers here and add \`locked: true\`.
// Re-running the corner sheet then leaves that corner alone.
//
// Distances along the lap (s, brakeStart, apexS, ...) are metres from the
// start line. Distances to the side (apron, gravel, barrier, offset) are
// metres from the track edge.
//
//   class          A: end of a straight at 200 km/h or more; B: medium;
//                  C: quick sweep; slow: hairpin under 90 km/h; street: walls at the edge
//   inside/outside which side ('L' or 'R') is the inside of the corner
//   entryKmh       speed where braking starts (or at the corner if there is no braking)
//   minKmh         slowest point; apexS is where it happens
//   exitKmh        speed at exitS, on the way out
//   brakeStart/End the braking zone from the lap; brakeDistance is its length
//   contacts       where the car's body comes within 1 m of the edge, inside and outside
//   kerbs          kerbs placed from those contacts: apex kerbs inside, exit kerbs outside
//   zone           the stretch of track whose outside gets this corner's run-off
//   apron          paved run-off next to the kerb (no penalty)
//   gravel         gravel bed after the apron
//   barrier        how far from the edge the barrier stands
//   needed         deepest departure test stopping point x 1.3
//   room           space before the halfway line to another part of the track
//   sebring        true: the apron is old runway concrete with a mild rumble
//   departures     each departure test: how deep beyond the edge the car got, where, at what angle
//   sections       barrier sections: centre s, side, offset from edge, length, and angle (degrees
//                  the face is turned to meet the car)
//   constrained    true when the run-off cannot fit; reason says why
`;
  const body = list.map(c => '  ' + JSON.stringify(c).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+: )/g, ', ')).join(',\n');
  writeFileSync(new URL('../src/corners.js', import.meta.url), `${header}\nexport const CORNERS = [\n${body},\n];\n`);
}

function writeDoc(list) {
  const rows = list.map(c => `| ${c.name} | ${c.points.join(' to ')} | ${c.class} | ${c.entryKmh} | ${c.minKmh} | ${c.exitKmh} | ${c.brakeDistance || '-'} | ${c.apron} | ${c.gravel} | ${c.barrier}${c.constrained ? ' *' : ''} | ${c.needed ?? '-'} | ${c.sections.length} |`);
  const deps = list.filter(c => c.departures).map(c => `**${c.name}**: ` + c.departures.map(d => `${d.test} ${d.depth} m`).join(', '));
  const cons = list.filter(c => c.constrained).map(c => `- **${c.name}**: ${c.reason}.`);
  const md = `# Lakeside corner sheet

Generated by \`npm run cornersheet\` from three flying laps with the average keyboard driver, assists on (average lap ${tel.lap.toFixed(3)} s). Run-off is sized for the worse of the average and the new keyboard driver. Do not edit by hand: change \`src/corners.js\` and lock the corner instead.

Speeds in km/h, distances in metres. Apron, gravel and barrier are measured from the track edge on the outside of the corner.

| Corner | Points | Class | Entry | Min | Exit | Braking | Apron | Gravel | Barrier | Needed | Barrier sections |
|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

\\* constrained: the run-off cannot fit, see below.

## Departure tests

How far beyond the outside edge the car got before stopping. Each test is run for the average and the new keyboard driver at their own speeds. Straight on: from the braking point, braking as late as that driver ever does, then brakes locked. Apex and exit: heading along the track and 10 degrees either side, the driver's reaction time plus 0.3 s, then brakes locked.

${deps.join('\n\n')}

## Constrained corners

${cons.length ? cons.join('\n') : 'None.'}
`;
  writeFileSync(new URL('../docs/corner-sheet.md', import.meta.url), md);
}
