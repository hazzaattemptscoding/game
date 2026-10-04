// Geometry and containment audit. Run with `npm run audit`.

import { buildTrack, BARRIER } from '../src/track.js';

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