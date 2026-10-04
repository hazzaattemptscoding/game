// Track geometry and queries.
//
// buildTrack() turns the layout control points into a centreline sampled
// every metre, then answers "where is this point on the track, and what is
// it driving on?" for physics, AI, timing and rendering.
//
// Conventions used everywhere in the game:
//   x, z  ground plane in metres, y is up (three.js style)
//   s     distance along the lap from the start line, metres
//   d     sideways offset from the centreline, metres, positive = right
//         of the direction of travel
//   side  0 = left, 1 = right

import { LAYOUT } from './layout.js';
import { CORNERS } from './corners.js';

export const SURF = {
  TARMAC: 0,
  PAINT: 1,      // white edge lines
  KERB: 2,       // flat rumble strip
  SAUSAGE: 3,    // raised kerb, unsettles the car
  RUNOFF: 4,     // tarmac run-off, no penalty
  GRASS: 5,
  GRAVEL: 6,
  PIT: 7,        // pit lane tarmac
  CONCRETE: 8,   // old runway concrete used as paved run-off (the Sebring look): no penalty, mild rumble
};

// Barrier types. Each barrier is a placed section (a polyline), used for
// looks, collisions and the checks in tools/laptest.js.
export const BARRIER = {
  ARMCO: 0,      // single armco, set back where two parts of the track need separating
  TYRES: 1,      // impact zone: conveyor-faced tyre wall in front of double armco, catch fence behind
  CONCRETE: 2,   // tall concrete wall at the edge, street section
  PARAPET: 3,    // bridge parapet
  PITWALL: 4,    // pit wall between the track and the pit lane (hit from either side)
  PITOUTER: 5,   // low wall on the far side of the pit lane
};

const DS = 1;              // sample spacing, metres
const KERB_WIDTH = 1.0;    // flat kerbs, metres
const STREET_KERB = 0.7;   // narrower kerbs in the walled street section
const SAUSAGE_WIDTH = 0.45; // raised kerb behind the flat kerb
const LINE_WIDTH = 0.15;   // painted edge line, metres
const PLAIN_RUNOFF = 22;   // flat grass beside the track where no corner needs more, metres
const GRAVEL_APRON = 3;    // a gravel trap always has at least this much paved apron in front of it
const STREET_GAP = 0.4;    // gap between the kerb and a street-section wall, metres
const BRIDGE_RUNOFF = 1.2;
const MIN_BARRIER = 4;     // no barrier closer than this to the track edge (street, pit and bridge excepted)
const SEPARATION = 70;     // single armco goes in only where another part of the track is closer than this

// Pit lane design (reference/LAKESIDE_SAFETY_LAYOUT.md 3.7)
const PIT_ENTRY_ANGLE = 6;  // degrees the pit road splits away from the track
const PIT_EXIT_ANGLE = 5;   // degrees it merges back
const PIT_GROW = 60;        // metres for the pit road to grow to full width
const PIT_WALL = 0.6;       // pit wall thickness, metres
const PIT_WALL_CLEAR = 6;   // pit wall face at least this far from the track edge
const PIT_ISLAND = 25;      // painted chevron island at the entry, metres long
const PIT_APRON = 2;        // apron between the pit lane and the garage doors, metres

export function buildTrack(layout = LAYOUT, corners = CORNERS) {
  const nPts = layout.points.length;

  // 1. Control points to metres, centred on the origin.
  let cx = 0, cy = 0;
  for (const p of layout.points) { cx += p[0]; cy += p[1]; }
  cx /= nPts; cy /= nPts;
  const toWorld = p => ({ x: (p[0] - cx) * layout.scale, z: (p[1] - cy) * layout.scale, h: (p[2] || 0) * layout.heightScale });
  const ctrl = layout.points.map(toWorld);

  // 2. Smooth curve through the points, sampled evenly, tight corners opened up.
  let c = catmullRom(ctrl, 40);
  c = resample(c, DS, nPts);
  c = openTightCorners(c, layout.minRadius, nPts);

  const N = c.x.length;
  const ds = c.length / N;
  const { x, z } = c;
  const u = c.u;

  // 3. Heights: smooth so there are no kinks in the road.
  const h = c.h;
  for (let pass = 0; pass < 4; pass++) boxSmooth(h, 18);

  // 4. Directions, curvature and gradients per sample.
  const tx = new Float64Array(N), tz = new Float64Array(N);
  const nx = new Float64Array(N), nz = new Float64Array(N);
  const curv = new Float64Array(N), grade = new Float64Array(N), vcurv = new Float64Array(N);
  const s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 1, N), b = wrap(i + 1, N);
    const dx = x[b] - x[a], dz = z[b] - z[a], m = Math.hypot(dx, dz);
    tx[i] = dx / m; tz[i] = dz / m;
    nx[i] = -tz[i]; nz[i] = tx[i];
    s[i] = i * ds;
    grade[i] = (h[b] - h[a]) / (2 * ds);
  }
  for (let i = 0; i < N; i++) {
    curv[i] = menger(x, z, wrap(i - 4, N), i, wrap(i + 4, N));
    vcurv[i] = (grade[wrap(i + 1, N)] - grade[wrap(i - 1, N)]) / (2 * ds);
  }
  boxSmooth(curv, 3);
  boxSmooth(vcurv, 10);

  const track = {
    N, ds, length: N * ds, width: layout.width, halfWidth: layout.width / 2,
    x, z, h, tx, tz, nx, nz, s, curv, grade, vcurv, u,
    layout, ctrl,
  };

  // 5. Named places along the lap.
  track.sAtPoint = p => sAtParam(track, p, nPts);
  track.sectors = [0, ...layout.sectors.map(track.sAtPoint)];
  track.drs = layout.drs.map(([a, b]) => [track.sAtPoint(a), track.sAtPoint(b)]);
  track.bridge = [track.sAtPoint(layout.bridge[0]), track.sAtPoint(layout.bridge[1])];
  track.sAtPointRaw = p => sAtParam(track, p, nPts);
  track.fromSketch = (px, py) => ({ x: (px - cx) * layout.scale, z: (py - cy) * layout.scale });

  // 6. What is either side of the tarmac: kerbs, run-off, gravel, the pit
  // lane, and the placed barriers and boards.
  track.corners = corners;
  buildSides(track, corners);
  buildBarriers(track, corners);
  buildFurniture(track, corners);

  track.locate = (px, pz, hint, out) => locate(track, px, pz, hint, out);
  track.surfaceAt = (i, d) => surfaceAt(track, i, d);
  track.inDRS = sv => track.drs.some(([a, b]) => inRange(sv, a, b, track.length));
  track.onBridge = sv => inRange(sv, track.bridge[0], track.bridge[1], track.length);
  track.findNearest = (px, pz, py) => findNearest(track, px, pz, py);
  track.inPitLimiter = (i, d) => !!track.pitLimiter[i] && -d > track.pitIn[i] - 0.5;
  track.collide = (px, pz, cx, cz, py) => collide(track, px, pz, cx, cz, py);
  return track;
}

// ---------------------------------------------------------------------------
// Queries

// Find the car's place on the track. Searches near `hint` (last known sample
// index) so the crossover bridge never gets confused with the straight under it.
function locate(T, px, pz, hint, out) {
  const { N, x, z } = T;
  let bi = hint, best = Infinity;
  for (let k = -12; k <= 24; k++) {
    const i = wrap(hint + k, N), dx = px - x[i], dz = pz - z[i], q = dx * dx + dz * dz;
    if (q < best) { best = q; bi = i; }
  }
  if (best > 70 * 70) bi = findNearest(T, px, pz, out.h ?? T.h[hint]);

  // project onto the segment either side of the closest sample
  let i = bi, j = wrap(bi + 1, N);
  let t = segT(T, i, j, px, pz);
  if (t < 0) { j = i; i = wrap(i - 1, N); t = segT(T, i, j, px, pz); }
  t = Math.min(1, Math.max(0, t));

  const lx = lerp(x[i], x[j], t), lz = lerp(z[i], z[j], t);
  let nxv = lerp(T.nx[i], T.nx[j], t), nzv = lerp(T.nz[i], T.nz[j], t);
  const m = Math.hypot(nxv, nzv); nxv /= m; nzv /= m;

  out.i = i;
  out.t = t;
  out.s = (i + t) * T.ds;
  out.d = (px - lx) * nxv + (pz - lz) * nzv;
  out.h = lerp(T.h[i], T.h[j], t);
  out.grade = lerp(T.grade[i], T.grade[j], t);
  out.vcurv = lerp(T.vcurv[i], T.vcurv[j], t);
  out.tx = -nzv; out.tz = nxv;
  out.nx = nxv; out.nz = nzv;
  return out;
}

function segT(T, i, j, px, pz) {
  const ax = T.x[j] - T.x[i], az = T.z[j] - T.z[i];
  return ((px - T.x[i]) * ax + (pz - T.z[i]) * az) / (ax * ax + az * az);
}

function surfaceAt(T, i, d) {
  const side = d < 0 ? 0 : 1, a = Math.abs(d), hw = T.halfWidth;
  if (a <= hw - LINE_WIDTH) return SURF.TARMAC;
  if (a <= hw) return SURF.PAINT;
  if (side === 0 && T.pitOut[i] && a >= T.pitIn[i] && a <= T.pitOut[i]) return SURF.PIT;
  if (side === 0 && T.pitIsland[i] && a < T.pitIn[i]) return SURF.RUNOFF;
  let edge = hw + T.kerb[side][i];
  if (a <= edge) return SURF.KERB;
  edge += T.sausage[side][i];
  if (a <= edge) return SURF.SAUSAGE;
  edge += T.runoff[side][i];
  if (a <= edge) return T.concrete[side][i] ? SURF.CONCRETE : SURF.RUNOFF;
  if (T.gravelOut[side][i] > 0 && a >= T.gravelIn[side][i] && a <= T.gravelOut[side][i]) return SURF.GRAVEL;
  if (T.street[side][i] && a <= T.wall[side][i]) return SURF.RUNOFF;   // the paved gap between a street kerb and its wall
  return SURF.GRASS;
}

function findNearest(T, px, pz, py) {
  const cell = T.grid.cell, gx = Math.floor(px / cell), gz = Math.floor(pz / cell);
  let best = Infinity, bi = 0;
  for (let r = 1; r <= 4 && best === Infinity; r++) {
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const list = T.grid.map.get(gx + a + ',' + (gz + b));
      if (!list) continue;
      for (const i of list) {
        const dy = Math.abs(T.h[i] - py);
        const q = (px - T.x[i]) ** 2 + (pz - T.z[i]) ** 2 + (dy > 5 ? 1e6 : 0);
        if (q < best) { best = q; bi = i; }
      }
    }
  }
  if (best === Infinity) {
    for (let i = 0; i < T.N; i++) {
      const q = (px - T.x[i]) ** 2 + (pz - T.z[i]) ** 2;
      if (q < best) { best = q; bi = i; }
    }
  }
  return bi;
}

// ---------------------------------------------------------------------------
// Sides of the track

// Run-off on each side. Each corner in corners.js decides its own kerbs and
// the run-off on its outside (paved apron, gravel, then grass out to the
// barrier). The colour-map zones in layout.js are applied on top and can only
// make a zone bigger.
function buildSides(T, corners) {
  const { N, layout } = T, hw = T.halfWidth;
  const pair = () => [new Float64Array(N), new Float64Array(N)];
  T.kerb = pair(); T.sausage = pair(); T.runoff = pair();
  T.gravelIn = pair(); T.gravelOut = pair(); T.wall = pair();
  T.concrete = [new Uint8Array(N), new Uint8Array(N)];
  T.street = [new Uint8Array(N), new Uint8Array(N)];
  T.isBridge = new Uint8Array(N);
  for (let i = 0; i < N; i++) T.isBridge[i] = inRange(T.s[i], T.bridge[0], T.bridge[1], T.length) ? 1 : 0;
  buildGrid(T);
  buildRoom(T);
  buildPit(T);

  const sides = code => (code === 'both' ? [0, 1] : code === 'L' ? [0] : [1]);
  const sideOf = c => (c === 'L' ? 0 : 1);
  // run fn(side, i, weight) from s0 to s1; weight eases 0 to 1 over `taper` metres at each end
  const forRange = (s0, s1, taper, fn) => {
    const len = ((s1 - s0) % T.length + T.length) % T.length;
    const tp = Math.max(1, Math.min(taper, len / 3));
    for (let k = 0; k <= len; k += T.ds) {
      const i = wrap(Math.round((s0 + k) / T.ds), N);
      const e = Math.min(k, len - k) / tp, w = e >= 1 ? 1 : e * e * (3 - 2 * e);
      fn(i, w);
    }
  };
  const forZone = (from, to, code, taper, fn) => {
    for (const sd of sides(code)) forRange(T.sAtPointRaw(from), T.sAtPointRaw(to), taper, (i, w) => fn(sd, i, w));
  };
  const kerbOK = (sd, i) => !T.isBridge[i] && !(sd === 0 && T.pitOut[i] && T.pitIn[i] - hw < KERB_WIDTH + 1.5);

  // 1. Corners: kerbs where the car uses the edge, run-off on the outside
  const gravelW = pair(), reach = pair();
  for (const c of corners) {
    for (const [side, list] of [[c.inside, c.kerbs.inside], [c.outside, c.kerbs.outside]]) {
      for (const [a, b] of list) forRange(a, b, 1, i => { const sd = sideOf(side); if (kerbOK(sd, i)) T.kerb[sd][i] = KERB_WIDTH; });
    }
    if (c.class === 'street') continue;
    const o = sideOf(c.outside);
    forRange(c.zone[0], c.zone[1], 25, (i, w) => {
      T.runoff[o][i] = Math.max(T.runoff[o][i], c.apron * w);
      gravelW[o][i] = Math.max(gravelW[o][i], c.gravel * w);
      reach[o][i] = Math.max(reach[o][i], c.barrier * w);
      if (c.sebring && w > 0.2) T.concrete[o][i] = 1;
    });
  }

  // 2. Colour-map zones: street walls, extra run-off, sausage kerbs, gravel
  const streetW = pair();
  for (const [a, b, code] of layout.walls || []) forZone(a, b, code, 12, (sd, i, w) => {
    streetW[sd][i] = Math.max(streetW[sd][i], w);
    T.street[sd][i] = 1;
    if (T.kerb[sd][i]) T.kerb[sd][i] = STREET_KERB;
  });
  for (const [a, b, code, width] of layout.runoff || []) forZone(a, b, code, 10, (sd, i, w) => {
    T.runoff[sd][i] = Math.max(T.runoff[sd][i], width * w);
  });
  for (const [a, b, code] of layout.sausage || []) forZone(a, b, code, 3, (sd, i) => {
    T.sausage[sd][i] = SAUSAGE_WIDTH;
    if (!T.kerb[sd][i]) T.kerb[sd][i] = KERB_WIDTH;
  });
  for (const [a, b, code, width] of layout.gravel || []) forZone(a, b, code, 30, (sd, i, w) => {
    gravelW[sd][i] = Math.max(gravelW[sd][i], width * w);
  });

  // 3. Lay the bands out from the edge: kerb, apron, gravel, grass, and how
  // far the flat ground reaches (out to the barrier, or the plain run-off)
  for (let sd = 0; sd < 2; sd++) {
    for (let i = 0; i < N; i++) {
      if (T.isBridge[i]) { T.kerb[sd][i] = 0; T.runoff[sd][i] = 0; T.wall[sd][i] = hw + BRIDGE_RUNOFF; continue; }
      if (sd === 0 && T.pitOut[i]) { T.runoff[sd][i] = 0; gravelW[sd][i] = 0; }
      if (gravelW[sd][i] > 0.5) T.runoff[sd][i] = Math.max(T.runoff[sd][i], GRAVEL_APRON * Math.min(1, gravelW[sd][i] / 5));
      const edge = hw + T.kerb[sd][i] + T.sausage[sd][i] + T.runoff[sd][i];
      if (gravelW[sd][i] > 0.5) { T.gravelIn[sd][i] = edge; T.gravelOut[sd][i] = edge + gravelW[sd][i]; }
      let flat = Math.max(hw + PLAIN_RUNOFF, hw + reach[sd][i], T.gravelOut[sd][i] + 3);
      if (streetW[sd][i] > 0) flat = flat + (edge + STREET_GAP - flat) * streetW[sd][i];
      if (sd === 0 && T.pitOut[i]) flat = Math.max(flat, T.pitOut[i] + PIT_APRON);
      T.wall[sd][i] = Math.min(flat, Math.max(hw + 2, T.room[sd][i]));
      if (T.gravelOut[sd][i] > T.wall[sd][i] - 1) T.gravelOut[sd][i] = Math.max(0, T.wall[sd][i] - 1);
      if (T.gravelOut[sd][i] <= T.gravelIn[sd][i] + 0.5) T.gravelOut[sd][i] = 0;
    }
  }
}

// Free distance from the centreline on each side before running into the
// halfway line to another part of the track (Infinity where the land is open).
function buildRoom(T) {
  const { N } = T, hw = T.halfWidth;
  T.room = [new Float64Array(N).fill(Infinity), new Float64Array(N).fill(Infinity)];
  for (let sd = 0; sd < 2; sd++) {
    const sg = sd ? 1 : -1, r = T.room[sd];
    for (let i = 0; i < N; i += 2) {
      for (let d = hw + 1; d <= hw + 110; d += 1.5) {
        const qx = T.x[i] + T.nx[i] * d * sg, qz = T.z[i] + T.nz[i] * d * sg;
        if (otherSectionCloser(T, i, qx, qz, d)) { r[i] = d - 1; break; }
      }
      if (i + 1 < N) r[i + 1] = r[i];
    }
    // the tightest value nearby, so a gap between probes is never missed
    const src = Float64Array.from(r);
    for (let i = 0; i < N; i++) {
      let m = Infinity;
      for (let k = -6; k <= 6; k++) m = Math.min(m, src[wrap(i + k, N)]);
      r[i] = m;
    }
  }
}

// The pit lane: a deceleration lane that splits from the left of the track at
// PIT_ENTRY_ANGLE, grows to full width, runs behind a pit wall that starts only
// once it is PIT_WALL_CLEAR from the track edge, and merges back at
// PIT_EXIT_ANGLE. It never overlaps the racing surface.
function buildPit(T) {
  const { N } = T, P = T.layout.pit, hw = T.halfWidth;
  T.pitIn = new Float64Array(N);      // |d| of the pit road's track-side edge, 0 = no pit road here
  T.pitOut = new Float64Array(N);     // |d| of its far edge
  T.pitWall = new Uint8Array(N);      // 1 where the pit wall stands, from pitIn - PIT_WALL to pitIn
  T.pitIsland = new Uint8Array(N);    // painted chevron island between the two roads at the entry
  T.pitLimiter = new Uint8Array(N);
  T.pitGarage = new Uint8Array(N);    // full-width stretch where the garages can go
  T.pitWidth = P.width;
  T.pitSpeed = P.speedLimit / 3.6;
  const a = T.sAtPointRaw(P.entry), b = T.sAtPointRaw(P.exit);
  const len = ((b - a) % T.length + T.length) % T.length;
  T.pitRange = [a, b];
  const full = hw + PIT_WALL_CLEAR + PIT_WALL + 0.6;          // pit road inner edge once fully separated (a little spare for the eased curve)
  const tIn = Math.tan(PIT_ENTRY_ANGLE * Math.PI / 180), tOut = Math.tan(PIT_EXIT_ANGLE * Math.PI / 180);
  const smin = (p, q, k = 6) => -k * Math.log(Math.exp(-p / k) + Math.exp(-q / k));   // smooth minimum
  for (let u = 0; u <= len; u += T.ds) {
    const i = wrap(Math.round((a + u) / T.ds), N);
    const inner = Math.max(hw, smin(smin(hw + tIn * u, full, 1.5), hw + tOut * (len - u), 1.5));
    const g = Math.min(1, Math.min(u, len - u) / PIT_GROW), grow = g * g * (3 - 2 * g);
    T.pitIn[i] = inner;
    T.pitOut[i] = inner + Math.max(0.01, P.width * grow);
    if (inner - PIT_WALL >= hw + PIT_WALL_CLEAR) T.pitWall[i] = 1;
    if (u < PIT_ISLAND && inner > hw + 0.3) T.pitIsland[i] = 1;
    if (T.pitWall[i] && grow > 0.999) T.pitLimiter[i] = 1;
    if (T.pitLimiter[i]) T.pitGarage[i] = 1;
  }
}

// ---------------------------------------------------------------------------
// Barriers: placed sections, each a polyline with a face towards the track.

function buildBarriers(T, corners) {
  const { N } = T, hw = T.halfWidth;
  T.barriers = [];
  // points are [x, y, z, sample index the point was laid out from]
  const P = (i, d) => [T.x[i] + T.nx[i] * d, T.h[i], T.z[i] + T.nz[i] * d, i];
  const add = (type, side, pts, extra = {}) => { if (pts.length > 1) T.barriers.push({ type, side, pts, ...extra }); };
  // a polyline following the track, one point every `step` samples
  const follow = (type, side, run, dFn, step = 3, extra) => {
    const pts = [];
    for (let k = 0; k < run.length; k += step) pts.push(P(run[k], dFn(run[k])));
    if ((run.length - 1) % step) pts.push(P(run[run.length - 1], dFn(run[run.length - 1])));
    add(type, side, pts, extra);
  };

  // 1. Impact sections from corners.js: a tyre wall in front of double armco,
  // centred where cars that leave the road would arrive, turned to meet them.
  const covered = [new Uint8Array(N), new Uint8Array(N)];
  for (const c of corners) {
    for (const sec of c.sections || []) {
      const sd = (sec.side || c.outside) === 'L' ? 0 : 1, g = sd ? 1 : -1;
      const i = wrap(Math.round(sec.s / T.ds), N);
      const off = c.class === 'street' ? T.wall[sd][i] : hw + sec.offset;
      const cx = T.x[i] + T.nx[i] * off * g, cz = T.z[i] + T.nz[i] * off * g;
      // the face runs along the track, turned outwards by `angle` so the car meets it at a glancing angle
      const ang = (sec.angle || 0) * Math.PI / 180 * g;
      const dx = T.tx[i] * Math.cos(ang) - T.tz[i] * Math.sin(ang), dz = T.tx[i] * Math.sin(ang) + T.tz[i] * Math.cos(ang);
      const half = sec.length / 2, flare = 3, fa = 20 * Math.PI / 180;
      // flared terminals: the last 3 m at each end bend away from the track
      const ox = T.nx[i] * g, oz = T.nz[i] * g;
      const end = sgn => [cx + dx * half * sgn + (dx * Math.cos(fa) * sgn + ox * Math.sin(fa)) * flare,
        cz + dz * half * sgn + (dz * Math.cos(fa) * sgn + oz * Math.sin(fa)) * flare];
      const a = end(-1), b = end(1);
      const pts = [[a[0], T.h[i], a[1], i], [cx - dx * half, T.h[i], cz - dz * half, i], [cx + dx * half, T.h[i], cz + dz * half, i], [b[0], T.h[i], b[1], i]];
      add(c.class === 'street' ? BARRIER.CONCRETE : BARRIER.TYRES, sd, pts, { corner: c.name, fence: c.class !== 'street', impact: true });
      for (let k = -Math.ceil(half + flare); k <= half + flare; k++) covered[sd][wrap(i + k, N)] = 1;
    }
  }

  for (let sd = 0; sd < 2; sd++) {
    const g = sd ? 1 : -1;
    // 2. street section walls, right at the edge
    for (const run of runsOf(N, i => T.street[sd][i] && !T.isBridge[i])) follow(BARRIER.CONCRETE, sd, run, i => g * T.wall[sd][i], 3, { fence: true });
    // 3. bridge parapets
    for (const run of runsOf(N, i => T.isBridge[i])) follow(BARRIER.PARAPET, sd, run, i => g * T.wall[sd][i]);
    // 4. single armco, set back, only where another part of the track is close
    const needs = i => T.room[sd][i] < SEPARATION && !T.street[sd][i] && !T.isBridge[i] && !covered[sd][i] && !(sd === 0 && T.pitOut[i]);
    for (const run of runsOf(N, needs)) if (run.length > 8) follow(BARRIER.ARMCO, sd, run, i => g * Math.max(T.wall[sd][i], hw + MIN_BARRIER), 3);
  }

  // 5. pit wall (two faces) and the low wall on the far side of the pit lane
  for (const run of runsOf(N, i => T.pitWall[i])) {
    follow(BARRIER.PITWALL, 0, run, i => -(T.pitIn[i] - PIT_WALL), 3);
  }
  for (const run of runsOf(N, i => T.pitOut[i] && T.pitOut[i] > hw + PIT_WALL_CLEAR)) {
    follow(BARRIER.PITOUTER, 0, run, i => -(T.pitOut[i] + (T.pitGarage[i] ? PIT_APRON : 0.5)), 3);
  }

  // collision segments, each with a face normal pointing back towards the track
  T.segs = [];
  for (const b of T.barriers) {
    const faces = [{ pts: b.pts, towards: 1 }];
    if (b.type === BARRIER.PITWALL) {
      // the pit side of the pit wall is its own face, facing the pit lane
      faces.push({ pts: b.pts.map(([x, y, z, i]) => [x - T.nx[i] * PIT_WALL, y, z - T.nz[i] * PIT_WALL, i]), towards: -1 });
    }
    for (const f of faces) {
      for (let k = 0; k < f.pts.length - 1; k++) {
        const [ax, ay, az, i] = f.pts[k], [bx, , bz] = f.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) continue;
        let nx = -(bz - az) / len, nz = (bx - ax) / len;
        // face the track this barrier was laid out from (or the pit lane, for the pit side of the pit wall)
        const g = b.side ? 1 : -1, inx = -g * T.nx[i], inz = -g * T.nz[i];
        if ((nx * inx + nz * inz) * f.towards < 0) { nx = -nx; nz = -nz; }
        T.segs.push({ ax, az, bx, bz, nx, nz, len, y: ay, type: b.type });
      }
    }
  }
  const cell = 10, map = new Map();
  T.segs.forEach((sg, n) => {
    const steps = Math.ceil(sg.len / cell) + 1;
    for (let k = 0; k <= steps; k++) {
      const x = sg.ax + (sg.bx - sg.ax) * k / steps, z = sg.az + (sg.bz - sg.az) * k / steps;
      const key = Math.floor(x / cell) + ',' + Math.floor(z / cell);
      let l = map.get(key); if (!l) map.set(key, l = []);
      if (l[l.length - 1] !== n) l.push(n);
    }
  });
  T.segGrid = { cell, map };
}

// Deepest barrier penetration for one corner of a car (px, pz) at height py,
// with the car's centre at (cx, cz). A face only pushes back a car whose centre is in front of it.
function collide(T, px, pz, cx, cz, py) {
  const { cell, map } = T.segGrid, gx = Math.floor(px / cell), gz = Math.floor(pz / cell);
  let best = null;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const list = map.get(gx + a + ',' + (gz + b));
    if (!list) continue;
    for (const n of list) {
      const sg = T.segs[n];
      if (Math.abs(sg.y - py) > 3) continue;   // a barrier on the bridge above, or the road below
      const t = ((px - sg.ax) * (sg.bx - sg.ax) + (pz - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len);
      if (t < -0.02 || t > 1.02) continue;
      const dn = (px - sg.ax) * sg.nx + (pz - sg.az) * sg.nz;
      const dc = (cx - sg.ax) * sg.nx + (cz - sg.az) * sg.nz;
      if (dn >= 0 || dc <= 0 || dn < -3) continue;
      if (!best || -dn > best.pen) best = { pen: -dn, nx: sg.nx, nz: sg.nz };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Trackside furniture: distance boards and signs, placed by the rules in
// reference/LAKESIDE_SAFETY_LAYOUT.md 3.6.

export const BOARD_SETS = [[150, [300, 200, 100]], [80, [200, 100]], [30, [100]]];

function buildFurniture(T, corners) {
  const { N } = T, hw = T.halfWidth;
  T.furniture = [];
  const place = (type, value, i, d, extra = {}) => {
    const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    return { type, value, i, s: T.s[i], d, x, z, y: T.h[i], ...extra };
  };
  const SPACED = ['board', 'post', 'panel'];   // these keep 30 m apart; signs only need 6 m
  const nearOther = (x, z, r, types) => T.furniture.some(f => (!types || types.includes(f.type)) && (f.x - x) ** 2 + (f.z - z) ** 2 < r * r);
  const nearBarrier = (x, z, r) => T.segs.some(sg => {
    const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
    return (x - sg.ax - t * (sg.bx - sg.ax)) ** 2 + (z - sg.az - t * (sg.bz - sg.az)) ** 2 < r * r;
  });

  // pit lane speed signs: at the start of the limiter, then every 100 m, on the pit wall
  const lim = runsOf(N, i => T.pitLimiter[i])[0] || [];
  for (let k = 0; k < lim.length; k += 100) {
    const i = lim[k];
    T.furniture.push(place('sign', T.layout.pit.speedLimit, i, -(T.pitIn[i] - PIT_WALL / 2), { faces: 'pit' }));
  }

  // distance boards: the biggest set that fits, counting down to where braking ends
  for (const c of corners) {
    if (!c.brakeDistance) continue;
    const sd = c.outside === 'L' ? 0 : 1, g = sd ? 1 : -1;
    const entry = BOARD_SETS.find(([min]) => c.brakeDistance > min);
    if (!entry) continue;
    const options = [entry[1], ...BOARD_SETS.map(e => e[1]).filter(set => set.length < entry[1].length)];
    for (const set of options) {
      const boards = [];
      let ok = true;
      for (const n of set) {
        const i = wrap(Math.round((c.brakeEnd - n) / T.ds), N);
        const d = g * (hw + Math.max(3, T.kerb[sd][i] + T.sausage[sd][i] + 1.5));   // 3 m or more beyond the white line, clear of the kerb
        const b = place('board', n, i, d, { corner: c.name });
        const inGravel = T.gravelOut[sd][i] > 0 && Math.abs(d) >= T.gravelIn[sd][i] - 1;
        const inPit = sd === 0 && T.pitOut[i] > 0;
        if (T.isBridge[i] || inPit || inGravel || T.street[sd][i] || nearBarrier(b.x, b.z, 6) ||
            nearOther(b.x, b.z, 30, SPACED) || nearOther(b.x, b.z, 6) || boards.some(o => (o.x - b.x) ** 2 + (o.z - b.z) ** 2 < 900)) { ok = false; break; }
        boards.push(b);
      }
      if (ok) { T.furniture.push(...boards); break; }
    }
  }
}

function runsOf(N, test) {
  const out = [];
  let start = 0;
  while (start < N && test(start)) start++;
  if (start === N) { const all = []; for (let i = 0; i <= N; i++) all.push(i % N); return [all]; }
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (test(i)) { if (!cur) cur = []; cur.push(i); }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

function otherSectionCloser(T, i, qx, qz, d) {
  const cell = T.grid.cell, gx = Math.floor(qx / cell), gz = Math.floor(qz / cell);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const list = T.grid.map.get(gx + a + ',' + (gz + b));
    if (!list) continue;
    for (const j of list) {
      let gap = Math.abs(T.s[j] - T.s[i]);
      gap = Math.min(gap, T.length - gap);
      if (gap < 80 || Math.abs(T.h[j] - T.h[i]) > 5) continue;
      if ((qx - T.x[j]) ** 2 + (qz - T.z[j]) ** 2 < d * d) return true;
    }
  }
  return false;
}

function buildGrid(T) {
  const cell = 25, map = new Map();
  for (let i = 0; i < T.N; i++) {
    const key = Math.floor(T.x[i] / cell) + ',' + Math.floor(T.z[i] / cell);
    let l = map.get(key); if (!l) map.set(key, l = []);
    l.push(i);
  }
  T.grid = { cell, map };
}

// ---------------------------------------------------------------------------
// Curve construction

// Centripetal Catmull-Rom through closed control points. Centripetal
// spacing avoids loops and overshoot where points are bunched up.
function catmullRom(P, sub) {
  const n = P.length, x = [], z = [], h = [], u = [];
  const g = i => P[wrap(i, n)];
  for (let i = 0; i < n; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1.x - p0.x, p1.z - p0.z));
    const t2 = t1 + Math.sqrt(Math.hypot(p2.x - p1.x, p2.z - p1.z));
    const t3 = t2 + Math.sqrt(Math.hypot(p3.x - p2.x, p3.z - p2.z));
    for (let k = 0; k < sub; k++) {
      const t = t1 + (t2 - t1) * k / sub;
      const v = ['x', 'z', 'h'].map(f => {
        const A1 = (t1 - t) / (t1 - t0) * p0[f] + (t - t0) / (t1 - t0) * p1[f];
        const A2 = (t2 - t) / (t2 - t1) * p1[f] + (t - t1) / (t2 - t1) * p2[f];
        const A3 = (t3 - t) / (t3 - t2) * p2[f] + (t - t2) / (t3 - t2) * p3[f];
        const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
        const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        return (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
      });
      x.push(v[0]); z.push(v[1]); h.push(v[2]); u.push(i + k / sub);
    }
  }
  return { x, z, h, u };
}

// Resample a closed polyline at even spacing. `u` (control point parameter)
// is carried along unwrapped so it rises steadily from 0 to nPts.
function resample(c, ds, nPts) {
  const n = c.x.length, cum = [0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum.push(cum[i] + Math.hypot(c.x[j] - c.x[i], c.z[j] - c.z[i]));
  }
  const L = cum[n], N = Math.round(L / ds), step = L / N;
  const x = new Float64Array(N), z = new Float64Array(N), h = new Float64Array(N), u = new Float64Array(N);
  let seg = 0;
  for (let k = 0; k < N; k++) {
    const target = k * step;
    while (cum[seg + 1] < target) seg++;
    const j = (seg + 1) % n, t = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    x[k] = lerp(c.x[seg], c.x[j], t);
    z[k] = lerp(c.z[seg], c.z[j], t);
    h[k] = lerp(c.h[seg], c.h[j], t);
    const uj = j === 0 ? c.u[0] + nPts : c.u[j];
    u[k] = lerp(c.u[seg], uj, t);
  }
  return { x, z, h, u, length: L };
}

// Repeatedly smooth only the parts of the curve that are tighter than
// minRadius until every corner is at least that wide.
function openTightCorners(c, minRadius, nPts) {
  for (let round = 0; round < 80; round++) {
    const N = c.x.length, mask = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(menger(c.x, c.z, wrap(i - 4, N), i, wrap(i + 4, N)));
      if (k > 1 / minRadius) { any = true; for (let d = -14; d <= 14; d++) mask[wrap(i + d, N)] = 1; }
    }
    if (!any) break;
    for (let pass = 0; pass < 6; pass++) {
      const x = Float64Array.from(c.x), z = Float64Array.from(c.z);
      for (let i = 0; i < N; i++) {
        if (!mask[i]) continue;
        const a = wrap(i - 2, N), b = wrap(i + 2, N);
        x[i] = 0.5 * c.x[i] + 0.25 * (c.x[a] + c.x[b]);
        z[i] = 0.5 * c.z[i] + 0.25 * (c.z[a] + c.z[b]);
      }
      c.x = x; c.z = z;
    }
    c = resample({ x: [...c.x], z: [...c.z], h: [...c.h], u: [...c.u] }, DS, nPts);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Helpers

function sAtParam(T, p, nPts) {
  p = ((p % nPts) + nPts) % nPts;
  const u = T.u;
  let lo = 0, hi = T.N - 1;
  if (p <= u[0]) return 0;
  if (p >= u[hi]) return u[hi] === p ? hi * T.ds : (hi + (p - u[hi]) / (nPts - u[hi])) * T.ds;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (u[m] <= p) lo = m; else hi = m; }
  return (lo + (p - u[lo]) / (u[hi] - u[lo])) * T.ds;
}

// signed curvature through three points, positive = turning right
function menger(x, z, a, b, c) {
  const abx = x[b] - x[a], abz = z[b] - z[a], acx = x[c] - x[a], acz = z[c] - z[a];
  const cross = abx * acz - abz * acx;
  const AB = Math.hypot(abx, abz), BC = Math.hypot(x[c] - x[b], z[c] - z[b]), CA = Math.hypot(acx, acz);
  return 2 * cross / (AB * BC * CA || 1);
}

function boxSmooth(arr, r) {
  const N = arr.length, src = Float64Array.from(arr);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += src[wrap(k, N)];
  for (let i = 0; i < N; i++) {
    arr[i] = sum / (2 * r + 1);
    sum += src[wrap(i + r + 1, N)] - src[wrap(i - r, N)];
  }
}

function dilate(m, r) {
  const N = m.length, o = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (m[i]) for (let k = -r; k <= r; k++) o[wrap(i + k, N)] = 1;
  return o;
}

function dropShortRuns(m, minLen) {
  const N = m.length;
  let start = m.indexOf(0);
  if (start < 0) return;
  for (let k = 0; k < N;) {
    const i = wrap(start + k, N);
    if (!m[i]) { k++; continue; }
    let len = 0;
    while (len < N && m[wrap(i + len, N)]) len++;
    if (len < minLen) for (let q = 0; q < len; q++) m[wrap(i + q, N)] = 0;
    k += len;
  }
}

export function inRange(v, a, b, L) {
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
}

export const wrap = (i, n) => ((i % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;
