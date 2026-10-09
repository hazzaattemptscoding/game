// Geometry and containment audit. Run with `npm run audit`.

import { buildTrack, BARRIER } from '../src/track.js';
import { Car, wallFeel } from '../src/physics.js';
import { GT } from '../src/cars.js';

const T = buildTrack(), errors = [];
const wrap = (i, n) => ((i % n) + n) % n;
const random = (() => {
  let seed = 0x4c414b45;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
})();

function edgeGap(x, z, y) {
  let best = Infinity;
  for (let i = 0; i < T.N; i++) {
    if (Math.abs(T.h[i] - y) > 4) continue;
    const dx = x - T.x[i], dz = z - T.z[i];
    if (Math.abs(dx * T.tx[i] + dz * T.tz[i]) > 0.6) continue;
    const d = dx * T.nx[i] + dz * T.nz[i], side = d < 0 ? 0 : 1;
    best = Math.min(best, Math.abs(d) - T.hw[i] - T.kerb[side][i] - T.sausage[side][i]);
  }
  return best;
}

const coverage = [new Uint8Array(T.N), new Uint8Array(T.N)];
for (const b of T.barriers) {
  if (b.impact) continue;
  const isContainment = [BARRIER.ARMCO, BARRIER.PARAPET, BARRIER.CONCRETE, BARRIER.PITWALL, BARRIER.PITOUTER].includes(b.type);
  if (!isContainment) continue;
  const mask = coverage[b.side];
  for (let p = 1; p < b.pts.length; p++) {
    const a = b.pts[p - 1][3], end = b.pts[p][3];
    let length = wrap(end - a, T.N);
    if (length > T.N / 2) length = 0;
    for (let k = 0; k <= length; k++) mask[wrap(a + k, T.N)] = 1;
  }
}

let closest = Infinity, closestStreet = Infinity, barrierPoints = 0;
for (const b of T.barriers) {
  if (b.type === BARRIER.PARAPET || b.type === BARRIER.PITWALL || b.type === BARRIER.PITSEP) continue;
  for (const [x, y, z] of b.pts) {
    const gap = edgeGap(x, z, y);
    if (!Number.isFinite(gap)) continue;
    barrierPoints++;
    if (b.type === BARRIER.CONCRETE) {
      closestStreet = Math.min(closestStreet, gap);
      if (gap < 0.3) errors.push(`street wall ${gap.toFixed(2)} m from edge at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    } else if (b.deckRow) {
      // the row of tyres on the bridge deck margin, like the parapet it stands against (the deck is 2.5 m wide either side)
    } else {
      closest = Math.min(closest, gap);
      if (gap < 4) errors.push(`barrier ${gap.toFixed(2)} m from edge at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
}

for (let i = 0; i < T.N; i++) {
  const s = T.s[i];
  for (let side = 0; side < 2; side++) {
    const zone = j => T.pitEntryZone && T.pitEntryZone[j];   // beside the separate pit entry road the line is the road's edge
    const pitException = side === 0 && (T.pitOut[i] > 0 || zone(i) || zone(wrap(i + 1, T.N)));
    if (T.isBridge[i] || T.street[side][i] || pitException) continue;
    if (!coverage[side][i]) errors.push(`containment gap side ${side ? 'R' : 'L'} s=${s.toFixed(1)} at (${T.x[i].toFixed(1)}, ${T.z[i].toFixed(1)})`);
    const next = wrap(i + 1, T.N), delta = Math.abs(T.wall[side][next] - T.wall[side][i]);
    if (delta > 0.25001) errors.push(`barrier offset changes ${delta.toFixed(2)} m/m side ${side ? 'R' : 'L'} s=${s.toFixed(1)} at (${T.x[i].toFixed(1)}, ${T.z[i].toFixed(1)})`);
  }
}

// The visible line: one containment wall all round the flat ground. Scan every non-street, non-pit, non-bridge barrier
// (the plain and tall pieces of the containment wall) for kinks and for two lines standing close together.
{
  const line = T.barriers.filter(b => b.type === BARRIER.ARMCO);
  const angleAt = (p, q, r) => {
    const a1 = Math.atan2(q[2] - p[2], q[0] - p[0]), a2 = Math.atan2(r[2] - q[2], r[0] - q[0]);
    let d = Math.abs(a2 - a1) * 180 / Math.PI; if (d > 180) d = 360 - d;
    return d;
  };
  const same = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.01;
  let kinks = 0, worst = 0;
  const report = (q, d) => { kinks++; worst = Math.max(worst, d); errors.push(`barrier kink ${d.toFixed(0)} degrees at s=${T.s[q[3]].toFixed(0)} (${q[0].toFixed(1)}, ${q[2].toFixed(1)})`); };
  for (const b of line) {
    for (let k = 1; k < b.pts.length - 1; k++) { const d = angleAt(b.pts[k - 1], b.pts[k], b.pts[k + 1]); if (d > 25) report(b.pts[k], d); }
    // across the joint to the piece that starts where this one ends
    const e = b.pts.at(-1), next = line.find(o => o !== b && o.side === b.side && same(o.pts[0], e));
    if (next && b.pts.length > 1 && next.pts.length > 1) { const d = angleAt(b.pts.at(-2), e, next.pts[1]); if (d > 25) report(e, d); }
  }
  // doubled lines: samples every 1 m; pieces that touch at an end are neighbours, anything else within 3 m is a second line
  const samples = [];
  line.forEach((b, n) => {
    for (let k = 1; k < b.pts.length; k++) {
      const p = b.pts[k - 1], q = b.pts[k], len = Math.hypot(q[0] - p[0], q[2] - p[2]);
      for (let m = 0; m < len; m += 1) samples.push({ n, x: p[0] + (q[0] - p[0]) * m / len, z: p[2] + (q[2] - p[2]) * m / len, i: p[3] });
    }
  });
  const touch = (a, c) => [a.pts[0], a.pts.at(-1)].some(p => [c.pts[0], c.pts.at(-1)].some(q => same(p, q)));
  const grid = new Map(), doubled = new Set();
  for (const sm of samples) {
    const gx = Math.floor(sm.x / 3), gz = Math.floor(sm.z / 3);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const o of grid.get((gx + a) + ',' + (gz + c)) || []) {
      if (o.n === sm.n || Math.hypot(o.x - sm.x, o.z - sm.z) >= 3) continue;
      if (touch(line[o.n], line[sm.n]) && Math.min(Math.abs(o.i - sm.i), T.N - Math.abs(o.i - sm.i)) < 12) continue;
      const key = Math.min(o.n, sm.n) + '/' + Math.max(o.n, sm.n);
      if (!doubled.has(key)) { doubled.add(key); errors.push(`two visible barriers within 3 m at s=${T.s[sm.i].toFixed(0)} and s=${T.s[o.i].toFixed(0)} (${sm.x.toFixed(1)}, ${sm.z.toFixed(1)})`); }
    }
    const key = gx + ',' + gz; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(sm);
  }
  console.log(`  containment line: ${line.length} pieces (${line.filter(b => b.tall).length} tall), ${kinks} kinks over 25 degrees (worst ${worst.toFixed(0)}), ${doubled.size} doubled stretches`);
}

// Wall stretches the player has looked at and accepted although a far-out departure test would stop deeper than the
// wall (the wall is where it is on purpose: lining the track, no barriers out in the fields). Anything else short fails.
// Accepted by the player on 2026-10-04 after seeing the one-line wall (commit 6c81b0d).
const ACCEPTED_SHORT = [
  { corner: 'Hurricane Sweep', sd: 0, s: 590 }, { corner: 'Hurricane Sweep', sd: 0, s: 680 }, { corner: 'Hurricane Sweep', sd: 0, s: 721 },
  { corner: 'Rudder', sd: 1, s: 2700 }, { corner: 'Rudder', sd: 1, s: 2731 },
  { corner: 'Final Approach', sd: 0, s: 21 }, { corner: 'Final Approach', sd: 0, s: 3597 },
];
const shortNotes = [];
// Tall stretches are justified by departures: the wall line at the section must be at least as far out as the deepest
// departure listed for it (corners.js depth is measured from the track edge, as in tools/laptest.js).
for (const t of T.tallStretches) {
  const i = Math.round(t.s / T.ds), off = T.wall[t.sd][i] - T.hw[i];
  if (off < t.need && !t.constrained && ACCEPTED_SHORT.some(a => a.corner === t.corner && a.sd === t.sd && Math.abs(a.s - t.s) < 15)) { shortNotes.push(`${t.corner} s=${t.s.toFixed(0)} ${t.sd ? 'R' : 'L'}: wall ${off.toFixed(1)} m out, a departure stops ${t.need} m out (accepted)`); continue; }
  if (off < t.need && !t.constrained) errors.push(`${t.corner}: the wall line at s=${t.s} side ${t.sd ? 'R' : 'L'} is ${off.toFixed(1)} m out (edge to wall centreline) but a departure stops ${t.need} m out: push the wall out over s ${(t.s - t.length / 2).toFixed(0)} to ${(t.s + t.length / 2).toFixed(0)} (buildSides reach)`);
}

// Every barrier section needs a reason (docs/barrier-log.md), and the same section must not be repeated
// more than twice: a (type, length, offset, angle) combination, rounded to 5%, that turns up three times
// is a template being stamped, not a design.
const bucket = v => Math.round(Math.log(Math.max(v, 0.5)) / Math.log(1.05));
const templates = new Map();
for (const b of T.barriers) {
  if (!b.why) errors.push(`barrier section at s=${T.s[b.pts[0][3]].toFixed(0)} has no reason in the barrier log`);
  if (!b.spec) continue;
  const key = [b.type, bucket(b.spec.length), bucket(b.spec.offset), bucket(Math.abs(b.spec.angle) + 1)].join('/');
  templates.set(key, (templates.get(key) || 0) + 1);
}
for (const [key, n] of templates) if (n > 2) errors.push(`the same barrier section (type/length/offset/angle ${key}) is used ${n} times`);

// Bridge: 200 cars come at the bridge approach from random places and angles at 60 to 200 km/h, coasting. None may
// get past the parapet and off the deck (the drop).
{
  const rnd = random, bridgeStart = T.bridge[0], bridgeEnd = T.bridge[1];
  let escaped = 0, hitWall = 0;
  for (let n = 0; n < 200; n++) {
    const car = new Car(GT, T);
    const fromSide = n % 2 ? 1 : -1, before = n % 4 < 2;
    const s = before ? bridgeStart - 30 - rnd() * 150 : bridgeEnd + 30 + rnd() * 150;   // always driving forward over the bridge, from the near or far side
    car.placeAt(before ? s : s, fromSide * rnd() * 4);
    const speed = (60 + rnd() * 140) / 3.6, angle = (5 + rnd() * 50) * Math.PI / 180 * fromSide;
    car.heading += angle; car.vx = Math.cos(car.heading) * speed; car.vz = Math.sin(car.heading) * speed;
    let hits = 0;
    for (let t = 0; t < 600; t++) {
      car.step({ steer: 0, throttle: 0, brake: 0, drs: false });
      if (car.events.hit > 0.5) hits++;
      const i = car.loc.i;
      if (T.isBridge[i] && Math.abs(car.loc.d) > T.wall[car.loc.d < 0 ? 0 : 1][i] + 0.5) { escaped++; break; }
      if (car.y < T.h[i] - 3 && T.isBridge[i]) { escaped++; break; }
    }
    if (hits) hitWall++;
  }
  console.log(`  bridge: 200 cars at 60 to 200 km/h, ${hitWall} met a barrier, ${escaped} got off the deck`);
  if (escaped) errors.push(`${escaped} of 200 cars got past the bridge parapet`);
}

// Pit road: drive (as a path, wheels 1.7 m apart) from the track into the pit lane from five lateral offsets,
// and from the pit lane back onto the track, merging inside the 15 m mouth (the path follows the inner
// part of the lane, so it never crosses the gore). No wheel may touch grass, gravel or a kerb.
{
  const SURF_OK = new Set([0, 1, 4, 7]);             // tarmac, edge line, paved run-off, pit
  const bad = [];
  const [a, end] = T.pitRange, b = end - (T.pitExitClose || 0), hw = T.halfWidth;   // b: where the exit road has merged, before its lane closes
  const at = s => Math.round(((s % T.length) + T.length) % T.length / T.ds) % T.N;
  const lanePath = s => -(Math.max(T.pitIn[at(s)], hw) + 1.2);   // inner wheel 0.35 m inside the lane edge
  const cosine = t => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
  // a separate entry road (T.pitEntry): the drive-in follows its own direction, a point a metre, then 40 m of the lane
  const E = T.pitEntry;
  const onSample = (x, z, hint) => {
    let i = hint, best = Infinity;
    for (let q = -40; q <= 40; q++) { const j = ((hint + q) % T.N + T.N) % T.N, d2 = (T.x[j] - x) ** 2 + (T.z[j] - z) ** 2; if (d2 < best) { best = d2; i = j; } }
    return [i, (x - T.x[i]) * T.nx[i] + (z - T.z[i]) * T.nz[i]];
  };
  if (E) for (const start of [-4, -2, 0, 2, 4]) {
    const path = [];
    for (let k = 0; k < E.n; k++) { const lx = E.dz[k], lz = -E.dx[k]; for (const w of [0.35, 2.05]) path.push([...onSample(E.x[k] + lx * w, E.z[k] + lz * w, E.i[k]), true]); }
    for (let u = 1; u <= 40; u++) { const i = (E.i[E.n - 1] + u) % T.N; path.push([i, -(T.pitIn[i] + 1.2)]); }
    for (const [i, d, exact] of path) {
      for (const w of exact ? [0] : [-0.85, 0.85]) {
        const sf = T.surfaceAt(i, d + w);
        if (!SURF_OK.has(sf)) { bad.push(`entry road from offset ${start} at s=${T.s[i].toFixed(0)} d=${(d + w).toFixed(1)} surface ${sf}`); break; }
      }
    }
  }
  for (const entering of (E ? [false] : [true, false])) for (const start of [-4, -2, 0, 2, 4]) {
    for (let u = 0; u <= 80; u += 1) {
      const s = entering ? a - 20 + u : b - 60 + u;
      const t = entering ? (s - a) / 15 : (s - (b - 15)) / 15;     // the car follows the lane edge, then merges across the mouth
      const d = entering ? start + (lanePath(s) - start) * cosine(t) : lanePath(s) + (start - lanePath(s)) * cosine(t);
      for (const w of [-0.85, 0.85]) {
        const sf = T.surfaceAt(at(s), d + w);
        if (!SURF_OK.has(sf)) { bad.push(`${entering ? 'entry' : 'exit'} from offset ${start} at s=${s.toFixed(0)} d=${(d + w).toFixed(1)} surface ${sf}`); break; }
      }
    }
  }
  console.log(`  pit road: 10 drive-ins and drive-outs, ${bad.length} wheel samples off the paved surface`);
  if (bad.length) errors.push(...bad.slice(0, 5).map(m => 'pit road: ' + m));
}

let maxGroundError = 0;
for (let n = 0; n < 2000; n++) {
  const i = Math.floor(random() * T.N);
  if (T.isBridge[i]) continue;
  const d = (random() * 2 - 1) * 80;
  const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
  const error = Math.abs(T.groundAt(x, z, i) - T.groundAt(x, z));
  maxGroundError = Math.max(maxGroundError, error);
  if (error > 0.05) errors.push(`physics/terrain ground differs ${error.toFixed(2)} m near s=${T.s[i].toFixed(1)} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
}

let narrowPit = Infinity, pitWidthAt = 0, pitWallClear = Infinity;
for (let i = 0; i < T.N; i++) if (T.pitOut[i] > 0) {
  const width = T.pitOut[i] - T.pitIn[i];
  if (!T.pitMouth[i] && width < narrowPit) { narrowPit = width; pitWidthAt = i; }
  if (!T.pitMouth[i] && width < (T.pitLimiter[i] ? 10 : 6.5)) errors.push(`pit road ${width.toFixed(2)} m wide at s=${T.s[i].toFixed(1)} (${T.x[i].toFixed(1)}, ${T.z[i].toFixed(1)})`);
  if (T.pitWall[i]) {
    const clear = T.pitIn[i] - 0.6 - T.hw[i];
    pitWallClear = Math.min(pitWallClear, clear);
    if (clear < 4) errors.push(`pit wall ${clear.toFixed(2)} m from track edge at s=${T.s[i].toFixed(1)}`);
  }
}

const spaced = T.furniture.filter(f => ['board', 'post', 'panel'].includes(f.type));
for (let a = 0; a < spaced.length; a++) for (let b = a + 1; b < spaced.length; b++) {
  const distance = Math.hypot(spaced[a].x - spaced[b].x, spaced[a].z - spaced[b].z);
  if (distance < 30) errors.push(`${spaced[a].type} ${spaced[a].value} and ${spaced[b].type} ${spaced[b].value} are ${distance.toFixed(1)} m apart`);
}

for (const [label, items] of [['barrier', T.barriers.flatMap(b => b.pts)], ['board', T.furniture]]) {
  for (const item of items) {
    const x = Array.isArray(item) ? item[0] : item.x, y = Array.isArray(item) ? item[1] : item.y;
    const z = Array.isArray(item) ? item[2] : item.z, i = Array.isArray(item) ? item[3] : item.i;
    if (!Number.isInteger(i)) continue;
    const base = T.groundAt(x, z, i);
    if (y - base > 0.3) errors.push(`${label} base floats ${(y - base).toFixed(2)} m at s=${T.s[i].toFixed(1)} (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
}

// Ground around the bridge deck: continuous, no cliff. On a 2 m grid within 90 m of the deck, no two neighbouring points differ by
// more than MAX_SLOPE (rise over run), except on the abutment lines, 8 m either side of the deck ends, where the ground drops from the road.
let bridgeSlope = 0;
{
  const MAX_SLOPE = 1.5, STEP = 2, REACH = 90;
  const deck = []; for (let i = 0; i < T.N; i += 3) if (T.isBridge[i]) deck.push(i);
  const ends = []; for (let i = 0; i < T.N; i++) if (T.isBridge[i] && !(T.isBridge[(i + 1) % T.N] && T.isBridge[(i + T.N - 1) % T.N])) ends.push(i);
  if (deck.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of deck) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
    x0 -= REACH; x1 += REACH; z0 -= REACH; z1 += REACH;
    const nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1, H = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) H[j * nx + k] = T.groundAt(x0 + k * STEP, z0 + j * STEP);
    const nearDeck = (x, z) => deck.some(i => (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2 < REACH * REACH);
    const nearEnd = (x, z) => ends.some(i => (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2 < 14 * 14);
    let reported = 0;
    for (let j = 0; j < nz - 1; j++) for (let k = 0; k < nx - 1; k++) {
      const x = x0 + k * STEP, z = z0 + j * STEP, a = H[j * nx + k];
      const slope = Math.max(Math.abs(a - H[j * nx + k + 1]), Math.abs(a - H[(j + 1) * nx + k])) / STEP;
      if (slope <= MAX_SLOPE || !nearDeck(x, z) || nearEnd(x, z)) { if (slope > bridgeSlope && nearDeck(x, z) && !nearEnd(x, z)) bridgeSlope = slope; continue; }
      bridgeSlope = Math.max(bridgeSlope, slope);
      if (reported++ < 3) errors.push(`ground near the bridge: a cliff of ${(slope * STEP).toFixed(1)} m in ${STEP} m at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    }
    if (reported > 3) errors.push(`ground near the bridge: ${reported - 3} more cliff cells`);
  }
}

// ---- the track fixes from the owner's reports: tyres in front of the exit wall, and softer than concrete
{
  // a tyre wall gives a softer impact than concrete: a gentler rebound, and a glancing rub costs less speed
  const hard = wallFeel(BARRIER.CONCRETE), tyre = wallFeel(BARRIER.TYRES);
  if (!(tyre.bounce < hard.bounce && tyre.friction < hard.friction)) errors.push(`tyre walls are not softer than concrete (bounce ${tyre.bounce} vs ${hard.bounce}, friction ${tyre.friction} vs ${hard.friction})`);
  // speed lost along the wall on a 20 degree hit at unit speed: the wall takes friction x (1 + bounce) x normal speed off the tangential speed
  const lost = f => Math.min(Math.cos(Math.PI / 9), f.friction * (1 + f.bounce) * Math.sin(Math.PI / 9));
  if (lost(tyre) >= lost(hard)) errors.push(`a 20 degree rub costs ${lost(tyre).toFixed(3)} of the speed against tyres, ${lost(hard).toFixed(3)} against concrete`);
  // tyre stacks stand on the track side of the pit wall where the exit run-off is (layout.tyreWall), 4 m or more from the edge
  const L = T.length, [tyreFrom, tyreTo] = T.layout.tyreWall[0], a = T.sAtPoint(tyreFrom), span = ((T.sAtPoint(tyreTo) - a) % L + L) % L;
  // the nearest barrier point to sample i (within 3 samples: the lines are laid every few samples)
  const nearPt = (list, i) => { let best = null, bd = 4; for (const p of list) { const k = Math.abs(((p[3] - i) % T.N + T.N + 1) % T.N - 1); if (k < bd) { bd = k; best = p; } } return best; };
  const tyrePts = [], wallPts = [];
  for (const b of T.barriers) if (b.side === 0) for (const p of b.pts) { if (b.type === BARRIER.TYRES) tyrePts.push(p); else if (b.type === BARRIER.PITWALL) wallPts.push(p); }
  let missing = 0, close = 0, nearEdge = 0, samples = 0;
  for (let i = 0; i < T.N; i++) {
    const along = ((T.s[i] - a) % L + L) % L;
    if (along > span || i % 5) continue;
    samples++;
    const t = nearPt(tyrePts, i), w = nearPt(wallPts, i);
    if (!t) { missing++; continue; }
    const dt = Math.abs((t[0] - T.x[i]) * T.nx[i] + (t[2] - T.z[i]) * T.nz[i]);
    if (dt - T.hw[i] - T.kerb[0][i] - T.sausage[0][i] < 4) nearEdge++;
    if (w) { const dw = Math.abs((w[0] - T.x[i]) * T.nx[i] + (w[2] - T.z[i]) * T.nz[i]); if (dw - dt < 0.5 || dw - dt > 2) close++; }
  }
  if (missing) errors.push(`${missing} of ${samples} samples along the exit wall have no tyre stack in front of the pit wall`);
  if (nearEdge) errors.push(`${nearEdge} tyre stack samples stand under 4 m from the track edge`);
  if (close) errors.push(`${close} tyre stack samples are not 0.5 to 2 m in front of the pit wall`);
}

console.log(`Lakeside geometry audit: ${T.length.toFixed(0)} m`);
console.log(`  barrier points ${barrierPoints}; closest barrier ${closest.toFixed(2)} m; closest street wall ${closestStreet.toFixed(2)} m`);
console.log(`  ground within 90 m of the bridge deck: steepest slope ${bridgeSlope.toFixed(2)} (limit 1.5, deck-end abutments excepted)`);
console.log(`  max physics/terrain height difference ${maxGroundError.toFixed(3)} m across 2,000 points`);
console.log(`  narrowest pit sample ${Number.isFinite(narrowPit) ? `${narrowPit.toFixed(2)} m at s=${T.s[pitWidthAt].toFixed(1)}` : 'no pit samples'}; pit wall clearance ${pitWallClear.toFixed(2)} m`);
console.log(`  distance boards, posts and panels ${spaced.length}; floating barrier/board bases checked`);
if (errors.length) {
  console.log(`  FAILED (${errors.length} findings):`);
  for (const error of errors.slice(0, 50)) console.log(`   - ${error}`);
  if (errors.length > 50) console.log(`   - ... ${errors.length - 50} more`);
  process.exitCode = 1;
} else console.log('  all checks passed');
if (shortNotes.length) console.log(`  ${shortNotes.length} wall stretches shorter than a far departure, accepted by the player:\n    ` + shortNotes.join('\n    '));