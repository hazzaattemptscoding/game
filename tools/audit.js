// Geometry and containment audit. Run with `npm run audit`.

import { buildTrack, BARRIER } from '../src/track.js';
import { Car } from '../src/physics.js';
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
    best = Math.min(best, Math.abs(d) - T.halfWidth - T.kerb[side][i] - T.sausage[side][i]);
  }
  return best;
}

const coverage = [new Uint8Array(T.N), new Uint8Array(T.N)];
for (const b of T.barriers) {
  if (b.impact && !b.span) continue;
  const isContainment = [BARRIER.ARMCO, BARRIER.PARAPET, BARRIER.CONCRETE, BARRIER.PITWALL, BARRIER.PITOUTER].includes(b.type) || b.span;
  if (!isContainment) continue;
  const mask = coverage[b.side];
  if (b.span) { for (let k = b.span[0]; k !== wrap(b.span[1] + 1, T.N); k = wrap(k + 1, T.N)) mask[k] = 1; continue; }   // an impact wall standing on the line covers its span
  for (let p = 1; p < b.pts.length; p++) {
    const a = b.pts[p - 1][3], end = b.pts[p][3];
    let length = wrap(end - a, T.N);
    if (length > T.N / 2) length = 0;
    for (let k = 0; k <= length; k++) mask[wrap(a + k, T.N)] = 1;
  }
}

let closest = Infinity, closestStreet = Infinity, barrierPoints = 0;
for (const b of T.barriers) {
  if (b.type === BARRIER.PARAPET || b.type === BARRIER.PITWALL) continue;
  for (const [x, y, z] of b.pts) {
    const gap = edgeGap(x, z, y);
    if (!Number.isFinite(gap)) continue;
    barrierPoints++;
    if (b.type === BARRIER.CONCRETE) {
      closestStreet = Math.min(closestStreet, gap);
      if (gap < 0.3) errors.push(`street wall ${gap.toFixed(2)} m from edge at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    } else {
      closest = Math.min(closest, gap);
      if (gap < 4) errors.push(`barrier ${gap.toFixed(2)} m from edge at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
}

for (let i = 0; i < T.N; i++) {
  const s = T.s[i];
  for (let side = 0; side < 2; side++) {
    const pitException = side === 0 && T.pitOut[i] > 0;
    if (T.isBridge[i] || T.street[side][i] || pitException) continue;
    if (!coverage[side][i]) errors.push(`containment gap side ${side ? 'R' : 'L'} s=${s.toFixed(1)} at (${T.x[i].toFixed(1)}, ${T.z[i].toFixed(1)})`);
    const next = wrap(i + 1, T.N), delta = Math.abs(T.wall[side][next] - T.wall[side][i]);
    if (delta > 0.25001) errors.push(`barrier offset changes ${delta.toFixed(2)} m/m side ${side ? 'R' : 'L'} s=${s.toFixed(1)} at (${T.x[i].toFixed(1)}, ${T.z[i].toFixed(1)})`);
  }
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
  const [a, b] = T.pitRange, hw = T.halfWidth;
  const at = s => Math.round(((s % T.length) + T.length) % T.length / T.ds) % T.N;
  const lanePath = s => -(Math.max(T.pitIn[at(s)], hw) + 1.2);   // inner wheel 0.35 m inside the lane edge
  const cosine = t => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
  for (const entering of [true, false]) for (const start of [-4, -2, 0, 2, 4]) {
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
  if (width < narrowPit) { narrowPit = width; pitWidthAt = i; }
  if (width < 10) errors.push(`pit road ${width.toFixed(2)} m wide at s=${T.s[i].toFixed(1)} (${T.x[i].toFixed(1)}, ${T.z[i].toFixed(1)})`);
  if (T.pitWall[i]) {
    const clear = T.pitIn[i] - 0.6 - T.halfWidth;
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

console.log(`Lakeside geometry audit: ${T.length.toFixed(0)} m`);
console.log(`  barrier points ${barrierPoints}; closest barrier ${closest.toFixed(2)} m; closest street wall ${closestStreet.toFixed(2)} m`);
console.log(`  max physics/terrain height difference ${maxGroundError.toFixed(3)} m across 2,000 points`);
console.log(`  narrowest pit sample ${Number.isFinite(narrowPit) ? `${narrowPit.toFixed(2)} m at s=${T.s[pitWidthAt].toFixed(1)}` : 'no pit samples'}; pit wall clearance ${pitWallClear.toFixed(2)} m`);
console.log(`  distance boards, posts and panels ${spaced.length}; floating barrier/board bases checked`);
if (errors.length) {
  console.log(`  FAILED (${errors.length} findings):`);
  for (const error of errors.slice(0, 50)) console.log(`   - ${error}`);
  if (errors.length > 50) console.log(`   - ... ${errors.length - 50} more`);
  process.exitCode = 1;
} else console.log('  all checks passed');