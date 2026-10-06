// Racing line checks. Run with `npm run racingline-test` (also part of `npm run check`). No browser needed.
//   1. the checked in data matches the track and is a gentle, in range, flicker free line
//   2. every big braking corner has a brake zone in front of it
//   3. the ribbon geometry: closed, lap ordered, no NaN, sits on the road
//   4. the visible range, also across the start line
//   5. the colour blend
//   6. the data is exactly what `npm run racingline` makes now (the autopilot lap is deterministic)

import * as THREE from 'three';
import { buildTrack } from '../src/track.js';
import { CORNERS } from '../src/corners.js';
import data from '../src/racingLineData.js';
import { createRacingLine, buildLineGeometry, visibleRange, extraQuads, blendColours, dataMatches, CLASS_COLOURS, RACING_LINE_LEGEND, LINE_WIDTH } from '../src/racingLine.js';
import { generate, EDGE_MARGIN, MIN_RUN, MAX_LATERAL_RATE } from './racingline.js';

const T = buildTrack();
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };
const REGEN = 'regenerate it with `npm run racingline` and commit src/racingLineData.js';

// 1. data
ok(dataMatches(T), `racingLineData.js does not match the track (length ${data.length} vs ${T.length.toFixed(2)}, ${data.d.length} vs ${T.N} samples, ds ${data.ds} vs ${T.ds.toFixed(6)}): ${REGEN}`);
ok(data.d.length === T.N && data.c.length === T.N, `data has ${data.d.length} offsets and ${data.c.length} classes for ${T.N} samples: ${REGEN}`);
const limAt = i => T.hw[i] - EDGE_MARGIN + 1e-9;
let maxStep = 0, bad = 0;
for (let i = 0; i < T.N; i++) {
  const d = data.d[i];
  if (!Number.isFinite(d) || Math.abs(d) > limAt(i)) bad++;
  if (Math.abs(Math.round(d * 20) - d * 20) > 1e-6) bad++;
  maxStep = Math.max(maxStep, Math.abs(data.d[(i + 1) % T.N] - d));
}
ok(bad === 0, `${bad} offsets are out of range (more than ${(T.halfWidth - EDGE_MARGIN).toFixed(2)} m from the centreline, less where the track narrows) or not rounded to 5 cm`);
const stepLimit = MAX_LATERAL_RATE * T.ds + 0.06;   // plus the 5 cm rounding
ok(maxStep <= stepLimit, `offset jumps ${maxStep.toFixed(2)} m between neighbouring samples (limit ${stepLimit.toFixed(2)} m)`);
ok(/^[blt]+$/.test(data.c), 'classes must be b, l or t');
// runs
{
  const c = data.c, n = c.length;
  let start = 0;
  while (start < n && c[start] === c[(start - 1 + n) % n]) start++;
  const minSamples = Math.ceil(MIN_RUN / T.ds);
  let shortest = Infinity, i = 0;
  while (start < n && i < n) {
    let j = i;
    while (j < n && c[(start + j) % n] === c[(start + i) % n]) j++;
    shortest = Math.min(shortest, j - i);
    i = j;
  }
  ok(shortest >= minSamples, `a class lasts only ${shortest} samples (${(shortest * T.ds).toFixed(1)} m), the minimum is ${MIN_RUN} m`);
}
for (const k of 'blt') ok(data.c.includes(k), `no '${k}' class in the data at all`);

// 2. a brake zone before each big corner
for (const k of CORNERS) {
  if (k.brakeStart == null || k.entryKmh - k.minKmh < 40) continue;
  let found = false;
  for (let s = k.apexS - 260; s <= k.apexS; s += T.ds) { const i = ((Math.round(s / T.ds) % T.N) + T.N) % T.N; if (data.c[i] === 'b') { found = true; break; } }
  ok(found, `no brake zone in the 260 m before ${k.name} (apex at ${k.apexS} m)`);
}

// 3. geometry
const geo = buildLineGeometry(T, data.d, data.c);
{
  const pos = geo.getAttribute('position'), col = geo.getAttribute('color'), idx = geo.index.array;
  const n = T.N, extra = extraQuads(n, T.length);
  ok(idx.length === (n + extra) * 18, `index buffer is ${idx.length} long, expected ${(n + extra) * 18}`);
  let nan = 0;
  for (const a of [pos.array, col.array]) for (const v of a) if (!Number.isFinite(v)) nan++;
  ok(nan === 0, `${nan} NaN values in the ribbon vertices`);
  let maxIdx = 0; for (const v of idx) maxIdx = Math.max(maxIdx, v);
  ok(maxIdx === n * 4 - 1, `index points at vertex ${maxIdx}, the last vertex is ${n * 4 - 1}`);
  // lap order: quad q joins sample q % n and (q + 1) % n, and the last real quad closes onto sample 0
  let order = 0;
  for (let q = 0; q < n + extra; q++) {
    const rowA = Math.floor(idx[q * 18] / 4), rowB = Math.floor(idx[q * 18 + 1] / 4);
    if (rowA !== q % n || rowB !== (q + 1) % n) order++;
  }
  ok(order === 0, `${order} quads are not in lap order`);
  ok(Math.floor(idx[(n - 1) * 18 + 1] / 4) === 0, 'the last quad does not close onto the first sample');
  // width, height and no big steps along the line
  let wBad = 0, hBad = 0, gap = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4;
    const w = Math.hypot(pos.getX(a + 3) - pos.getX(a), pos.getZ(a + 3) - pos.getZ(a));
    if (Math.abs(w - LINE_WIDTH) > 0.02) wBad++;
    const y = pos.getY(a + 1) - T.groundAt(pos.getX(a + 1), pos.getZ(a + 1), i);
    if (Math.abs(y - 0.006) > 1e-4) hBad++;
    // a seam or step shows as a sudden change in the line's slope; a steady 8 % hill does not
    const c = ((i + n - 1) % n) * 4, slopeIn = pos.getY(a + 1) - pos.getY(c + 1), slopeOut = pos.getY(b + 1) - pos.getY(a + 1);
    if (Math.abs(slopeOut - slopeIn) > 0.03) gap++;
  }
  ok(wBad === 0, `${wBad} samples where the ribbon is not ${LINE_WIDTH} m wide`);
  ok(hBad === 0, `${hBad} samples where the ribbon is not 6 mm above T.groundAt`);
  ok(gap === 0, `${gap} samples where the ribbon's slope changes by more than 3 cm a metre between neighbouring metres (a seam or step)`);
  ok(col.itemSize === 4, 'vertex colours need an alpha channel for the soft edge');
}
{
  const rl = createRacingLine(T);
  ok(rl.group instanceof THREE.Group && rl.group.children.length === 1 && rl.mesh.userData.debug === 'line', 'the group must hold one mesh tagged debug = line');
  ok(rl.group.visible === false, 'the line must start hidden');
  ok(rl.mesh.material.depthWrite === false && rl.mesh.material.transparent && rl.mesh.material.polygonOffset, 'material must be transparent, not write depth, and use polygonOffset');
  rl.setVisible(true); rl.update(1000);
  const dr = rl.mesh.geometry.drawRange;
  ok(rl.group.visible && dr.count > 0 && dr.start % 18 === 0 && dr.count % 18 === 0, 'update(carS) must set a whole-quad draw range');
  rl.setVisible(false); ok(!rl.group.visible, 'setVisible(false) must hide the group');
  ok(Object.keys(RACING_LINE_LEGEND).join() === 'green,yellow,red' && Object.values(RACING_LINE_LEGEND).every(s => typeof s === 'string' && s.length > 3 && !/[—–]/.test(s)), 'RACING_LINE_LEGEND needs green, yellow and red strings');
}

// 4. visible range
{
  const n = T.N, extra = extraQuads(n, T.length);
  for (const s of [0, 5, 39, 40, 41, 330, 1000, T.length - 5, T.length - 0.5, T.length + 12, -3]) {
    const { first, count } = visibleRange(s, T.length, n);
    const sm = ((s % T.length) + T.length) % T.length;
    ok(first >= 0 && first < n && first + count <= n + extra, `range for s=${s}: first ${first}, count ${count} falls outside the index buffer`);
    // the quad range must cover from 40 m behind to 350 m ahead, across the wrap
    const covers = off => { const k = Math.floor((((sm + off) % T.length) + T.length) % T.length / T.ds), rel = ((k - first) % n + n) % n; return rel < count; };
    ok(covers(-40 + T.ds) && covers(0) && covers(349), `range for s=${s} does not cover 40 m behind to 350 m ahead`);
    ok(!covers(-80) && !covers(400), `range for s=${s} is longer than needed`);
  }
  const wrap = visibleRange(10, T.length, n);
  ok(wrap.first > n - 60 && wrap.first + wrap.count > n, 'a car just past the line must draw a range that crosses the start line in one piece');
}

// 5. colour blend
{
  const c = 'tttttttttttttttttttttttttttttttttttttttttbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'.padEnd(120, 't');
  const rgb = blendColours(c, 1);
  const g = new THREE.Color(CLASS_COLOURS.t), r = new THREE.Color(CLASS_COLOURS.b);
  const at = i => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
  const near = (a, b) => Math.abs(a[0] - b.r) + Math.abs(a[1] - b.g) + Math.abs(a[2] - b.b) < 1e-4;
  ok(near(at(10), g) && near(at(60), r), 'colours away from a boundary must be the pure class colour');
  const mid = at(40);
  ok(mid[0] > g.r + 0.01 && mid[0] < r.r - 0.01, 'the colour at a class boundary must be a blend');
  let blendLen = 0; for (let i = 30; i < 55; i++) if (!near(at(i), g) && !near(at(i), r)) blendLen++;
  ok(blendLen >= 3 && blendLen <= 5, `the blend between classes is ${blendLen} m, expected about 4`);
}

// 6. regenerate
{
  const t0 = Date.now();
  const { data: now, quality } = generate();
  const same = JSON.stringify(now.d) === JSON.stringify(data.d) && now.c === data.c && now.length === data.length && now.ds === data.ds;
  ok(same, `the checked in racingLineData.js is not what the reference lap makes now (the physics, the autopilot or the track changed): ${REGEN}`);
  console.log(`  regenerated in ${((Date.now() - t0) / 1000).toFixed(1)} s: lap ${quality.lap?.toFixed(3)} s, off track ${quality.offTrack}, wall hits ${quality.wallHits}; ${same ? 'identical to the checked in data' : 'DIFFERENT'}`);
}

const cnt = ch => [...data.c].filter(x => x === ch).length;
console.log(`Racing line: ${T.N} samples, brake ${cnt('b')} m, lift ${cnt('l')} m, throttle ${cnt('t')} m, largest offset step ${maxStep.toFixed(2)} m`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
console.log('  racing line checks pass');
