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

// One name, one meaning. These are the names in the debug view and in the reports.
export const SURF = {
  TARMAC: 0,        // the racing surface
  PAINT: 1,         // the 15 cm edge line: still tarmac (named so), but a little slicker, as before
  KERB: 2,          // flat kerb at the track edge, 2 cm high at its outer edge
  SAUSAGE: 3,       // raised kerb, 5 cm, unsettles the car
  RUNOFF: 4,        // paved run-off (tarmac or old runway concrete): full grip, no penalty
  GRASS: 5,
  GRAVEL: 6,
  PIT: 7,           // pit lane tarmac
  RUNOFF_ROUGH: 8,  // the outer part of a concrete apron: grip and smoothness fade away towards the gravel
  RUMBLE: 9,        // a flat grooved band across a concrete apron, 8 mm at most
};
export const SURF_NAMES = { 0: 'tarmac', 1: 'tarmac', 2: 'kerb', 3: 'sausage', 4: 'runoff', 5: 'grass', 6: 'gravel', 7: 'pit', 8: 'runoff-rough', 9: 'rumble' };
const RUMBLE_HALF = 0.275;    // rumble bands are 0.55 m wide
const RUMBLE_RELIEF = 0.006;   // and 6 mm high

// Barrier types. Each barrier is a placed section (a polyline), used for
// looks, collisions and the checks in tools/laptest.js.
export const BARRIER = {
  ARMCO: 0,      // single armco, set back where two parts of the track need separating
  TYRES: 1,      // impact zone: conveyor-faced tyre wall in front of double armco, catch fence behind
  CONCRETE: 2,   // tall concrete wall at the edge, street section
  PARAPET: 3,    // bridge parapet
  PITWALL: 4,    // pit wall between the track and the pit lane (hit from either side)
  PITOUTER: 5,   // low wall on the far side of the pit lane
  PITSEP: 6,     // low wall between the pit exit road and the track, behind the raised kerb (hit from either side)
};

const DS = 1;              // sample spacing, metres
const KERB_WIDTH = 1.0;    // flat kerbs, metres
const STREET_KERB = 0.7;   // narrower kerbs in the walled street section
const SAUSAGE_WIDTH = 0.45; // raised kerb behind the flat kerb
const BANK_TAPER = 30;
const INSIDE_DEPTH = 0.6;   // flat ground on the inside of a curve reaches at most this share of the radius
const LINE_WIDTH = 0.15;   // painted edge line, metres
const PLAIN_RUNOFF = 22;   // flat grass beside the track where no corner needs more, metres
const GRAVEL_APRON = 3;    // a gravel trap always has at least this much paved apron in front of it
const STREET_GAP = 0.8;    // clear space between the kerb and a street-section wall, metres
const BRIDGE_RUNOFF = 2.5;   // the deck is this much wider than the track on each side (a 2.5 m margin), and the parapet stands on its edge
const BRIDGE_TAPER = 20;     // metres after the deck over which the run-off on the far side tapers from the deck margin to the plain width
const DECK_TYRE_TAPER = 8;   // metres at each end of the deck over which the tyre row runs into the parapet
const BOARD_BEYOND_APRON = 5;   // metres past the paved edge a board may stand when the barrier is further out than that
const BOARD_BEHIND = 0.5;    // a distance board stands this far behind the barrier face (never more than 1 m in front of it)
const FILL_GAP = 120;        // no stretch on one side may go longer than this without trackside furniture
const CLUSTER_BEHIND = 1.5;  // fill objects stand this far behind the outer barrier line (out of the run-off, within reach of the barrier)
const BRIDGE_APPROACH = 40; // metres before and after the deck where a parapet funnels in towards it
const MIN_EDGE = 4;        // the 4 m minimum from the track edge to any barrier
const MIN_BARRIER = 5;     // working clearance margin beyond the 4 m minimum (street, pit and bridge excepted)
// Corners that get bollards on the inside kerb at the apex: esses and chicanes, where a car could cut straight across.
// They are markers only: the track limits rule (src/trackLimits.js) checks every corner, bollards or not.
const BOLLARD_CORNERS = ['Aileron', 'Rudder', 'Guardroom Chicane', 'Boundary Loop'];
const TALL_RAMP = 6;        // the tall stretch of the containment wall tapers in height over this many metres at each end
const BRIDGE_SLOPE = 1 / 3;  // the embankment under the ends of the deck falls (and rises) at 1:3
const BRIDGE_ZONE_NEAR = 100, BRIDGE_ZONE_FAR = 170;   // the ground near the deck is blended by hand out to this distance, then fades to the plain terrain
const BRIDGE_END_EASE = 4;   // metres over which the ground drops from the road to the cutting below at each end of the deck
const BRIDGE_BLEND = 36;   // softening (m^2) of the inverse-distance blend that gives the ground its heights there
const SEPARATION = 70;     // single armco goes in only where another part of the track is closer than this

// Pit lane design (reference/LAKESIDE_SAFETY_LAYOUT.md 3.7)
const PIT_ENTRY_ANGLE = 6;  // degrees the pit road splits away from the track
const PIT_EXIT_ANGLE = 5;   // degrees it merges back
const PIT_WALL = 0.6;       // pit wall thickness, metres
const PIT_WALL_CLEAR = 6;   // pit wall face at least this far from the track edge
const PIT_ISLAND = 25;      // painted chevron island at the entry, metres long
const PIT_APRON = 2;        // apron between the pit lane and the garage doors, metres
const PIT_MOUTH_CLEAR = 15; // shared asphalt before either pit-lane island
// Pit exit road (the owner's sketch, docs/pit-exit-sketch.webp): after the pit wall the exit road narrows and
// comes down beside the track, runs alongside it behind a raised kerb with bollards, then joins over a long
// hatched merge where the racing line is on the far side of the track.
const EXIT_SEP = 2.6;       // gap from the track edge to the exit road while alongside: kerb, raised kerb, bollards
const EXIT_ALONGSIDE = 60;  // metres the exit road runs alongside at EXIT_SEP
const EXIT_MERGE = 70;      // metres of hatched merge, the gap easing from EXIT_SEP to nothing
const EXIT_WIDTH = 7;       // exit road width once clear of the garages, metres
const EXIT_SEP_WALL = 0.9;  // thickness of the low wall between the exit road and the track, metres (0.55 m high)
const LIMIT_LEAD = 25;      // the pit limiter starts this far before the first garage, metres
const ENTRY_TANGENT = 0.5; // the entry road's curve: tangent length as a share of its chord (bigger = straighter in the middle)
const ENTRY_FOCAL = 0.8;   // beside the entry road the run-off reaches at most this share of the way to where the normals cross
const ENTRY_FOLD = 0.96;    // on the inside of a bend the entry road's far edge stays within this share of the radius (the offsets fold at 1)
const MOUTH_EASE = 60;     // metres over which the containment line eases into and out of the pit entry road's edge
const APRON_TAPER = 50;    // a paved apron that ends is eased out over this many metres before its end
const EXIT_CLOSE = 60;      // metres after the merge over which the merged exit lane's outer edge eases in to the track edge

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

  // Tarmac half width at every sample: the layout width, narrowed where layout.narrow says (smooth ease in and out).
  track.hw = buildHalfWidths(track, layout);

  // 6. What is either side of the tarmac: kerbs, run-off, gravel, the pit
  // lane, and the placed barriers and boards.
  track.corners = corners;
  // Camber: tan of the road's cross slope at each sample, positive where the road rises towards +d (the right).
  // It tilts the road and its kerbs; the run-off and the pit lane carry on level from the kerb's outer edge.
  const bank = track.bank = new Float64Array(N);
  for (const c of corners) {
    const deg = (layout.bank || {})[c.name];
    if (!deg) continue;
    const t = Math.tan(deg * Math.PI / 180) * (c.outside === 'R' ? 1 : -1);
    const a = track.sAtPoint(c.points[0]), b = track.sAtPoint(c.points[1]);
    const len = ((b - a) % track.length + track.length) % track.length;
    for (let k = -BANK_TAPER; k <= len + BANK_TAPER; k += ds) {
      const i = wrap(Math.round((a + k) / ds), N), e = Math.min(1, Math.max(0, Math.min(k + BANK_TAPER, len + BANK_TAPER - k) / BANK_TAPER));
      bank[i] += t * e * e * (3 - 2 * e);
    }
  }
  buildSides(track, corners);
  smoothKerbs(track);
  settleEntryApron(track);
  buildVRunoff(track);
  buildRumble(track);
  buildReach(track);
  buildBridgeGround(track);

  // the camber's rise at `lat` metres across sample n: the plane of the road out to the kerb's outer edge, level beyond it
  const bankRise = (n, lat) => {
    if (!bank[n] || track.isBridge[n]) return 0;
    const lim = track.hw[n] + track.kerb[lat < 0 ? 0 : 1][n];
    return bank[n] * Math.max(-lim, Math.min(lim, lat));
  };
  track.bankRise = bankRise;
  // the separate pit entry road: level across, at the height of the track beside it, smoothed along
  if (track.pitEntry) {
    const R = track.pitEntry;
    // level with the track's bands where the run-off strip meets them (the camber's rise is level past the kerb)
    for (let k = 0; k < R.n; k++) {
      const a = R.hitA[k], b = R.hitB[k], v = R.hitV[k];
      R.y[k] = (h[a] + bankRise(a, -1e3)) * (1 - v) + (h[b] + bankRise(b, -1e3)) * v;
    }
    for (let pass = 0; pass < 4; pass++) { const y = Float64Array.from(R.y); for (let k = 1; k < R.n - 1; k++) R.y[k] = (y[k - 1] + 2 * y[k] + y[k + 1]) / 4; }
  }
  // Road height under a point beside sample n: that sample's height, carried along the grade, plus the camber.
  const roadAt = (n, px, pz) => h[n] + grade[n] * Math.max(-ds, Math.min(ds, (px - x[n]) * tx[n] + (pz - z[n]) * tz[n]))
    + bankRise(n, (px - x[n]) * nx[n] + (pz - z[n]) * nz[n]);

  // Ground height at (px, pz). With `hint` (a sample index) and a point on that sample's normal that
  // is within the paved width, as every mesh vertex of the tarmac, kerb and apron is, the height
  // belongs to that sample exactly, so a band built from sample i never takes its height from a
  // neighbour (which made the road bumpy on bends). Outside the paved width the ground is the same
  // whatever the hint.
  // on the separate pit entry road its own height; beside it (on the far side) the ground eases to it at most 1 in 4
  const groundBase = (px, pz, hint) => {
    const r = entryRoadAt(track, px, pz);
    if (!r) return groundPlain(px, pz, hint);
    if (!r.out) return r.y;
    const g = groundPlain(px, pz, hint), lim = r.out * 0.25;
    return r.y + Math.max(-lim, Math.min(lim, g - r.y));
  };
  const groundPlain = (px, pz, hint) => {
    let near = 0, best = Infinity;
    if (Number.isInteger(hint) && !track.isBridge[wrap(hint, N)]) {
      const n0 = wrap(hint, N), dx = px - x[n0], dz = pz - z[n0];
      if (Math.abs(dx * tx[n0] + dz * tz[n0]) < 0.02) {
        const lat = dx * nx[n0] + dz * nz[n0], sd = lat < 0 ? 0 : 1, a = Math.abs(lat);
        let pv = track.hw[n0] + track.kerb[sd][n0] + track.sausage[sd][n0] + track.runoff[sd][n0];
        if (sd === 0 && track.pitOut[n0]) pv = Math.max(pv, track.pitOut[n0]);
        if (a <= pv) return h[n0] + bankRise(n0, lat);
      }
    }
    if (Number.isInteger(hint)) near = wrap(hint, N);
    else {
      for (let i = 0; i < N; i += 8) {
        if (track.isBridge[i]) continue;
        const q = (px - x[i]) ** 2 + (pz - z[i]) ** 2;
        if (q < best) { best = q; near = i; }
      }
      for (let d = -8; d <= 8; d++) {
        const i = wrap(near + d, N);
        if (track.isBridge[i]) continue;
        const q = (px - x[i]) ** 2 + (pz - z[i]) ** 2;
        if (q < best) { best = q; near = i; }
      }
    }

    let landNear = 0, landDist2 = Infinity, landSmooth = 0, landWeight = 0;
    for (let i = 0; i < N; i += 8) {
      if (track.isBridge[i]) continue;
      const q = (px - x[i]) ** 2 + (pz - z[i]) ** 2;
      if (q < landDist2) { landDist2 = q; landNear = i; }
      const w = 1 / ((q + 900) * (q + 900));
      landWeight += w; landSmooth += w * h[i];
    }
    for (let d = -8; d <= 8; d++) {
      const i = wrap(landNear + d, N);
      if (track.isBridge[i]) continue;
      const q = (px - x[i]) ** 2 + (pz - z[i]) ** 2;
      if (q < landDist2) { landDist2 = q; landNear = i; }
    }
    const dist = Math.sqrt(landDist2), corridor = Math.max(track.wall[0][landNear] + (track.pitOut[landNear] ? 70 : 0), track.wall[1][landNear]) + 4;
    const far = Math.min(1, Math.max(0, (dist - corridor) / 120));
    const blend = far * far * (3 - 2 * far);
    const hills = 18 * Math.max(0, Math.min(1, (dist - 250) / 400)) * (0.6 + 0.4 * Math.sin(px * 0.004 + 1.3) * Math.cos(pz * 0.005));
    let land = h[landNear] * (1 - blend) + landSmooth / (landWeight || 1) * blend + hills - 0.35;
    if (dist < corridor) land = Math.min(land, h[landNear] - Math.abs(bank[landNear]) * (track.hw[landNear] + 1.5) - 0.35);   // under the low edge of a cambered road too
    const bridgeHint = Number.isInteger(hint) && track.isBridge[near];
    if (!bridgeHint) near = landNear;
    // beside the bridge deck the land comes from the bridge ground blend (buildBridgeGround), which fades in over BRIDGE_ZONE_FAR
    const bg = !bridgeHint && track.bridgeGround, zone = bg ? bg.weight(px, pz) : 0, zoneLand = zone > 0 ? bg.height(px, pz) : 0;
    // `shadow`: 0 where the nearest road sample really is beside the point, easing to 1 over BRIDGE_END_EASE metres past a road END
    // (the point is then beyond the road, under or beside the deck, not on it)
    const alongNear = (px - x[landNear]) * tx[landNear] + (pz - z[landNear]) * tz[landNear];
    const e = Math.min(1, Math.max(0, (Math.abs(alongNear) - 1.5) / BRIDGE_END_EASE)), shadow = zone > 0 && bg.endSample[landNear] ? e * e * (3 - 2 * e) : 0;
    let side = (px - x[near]) * nx[near] + (pz - z[near]) * nz[near] < 0 ? 0 : 1;
    let lateral = Math.abs((px - x[near]) * nx[near] + (pz - z[near]) * nz[near]);
    let paved = track.hw[near] + track.kerb[side][near] + track.sausage[side][near] + track.runoff[side][near];
    if (side === 0 && track.pitOut[near]) paved = Math.max(paved, track.pitOut[near]);
    if (track.isBridge[near]) paved = track.wall[side][near];
    if (lateral <= paved && shadow === 0) return roadAt(near, px, pz);
    if (!bridgeHint) {
      near = landNear;
      side = (px - x[near]) * nx[near] + (pz - z[near]) * nz[near] < 0 ? 0 : 1;
      lateral = Math.abs((px - x[near]) * nx[near] + (pz - z[near]) * nz[near]);
      paved = track.hw[near] + track.kerb[side][near] + track.sausage[side][near] + track.runoff[side][near];
      if (side === 0 && track.pitOut[near]) paved = Math.max(paved, track.pitOut[near]);
      if (lateral <= paved && shadow === 0) return roadAt(near, px, pz);
    }
    const roadHeight = roadAt(near, px, pz);
    const slope = bridgeHint ? 1 / 3 : 0.12;
    const shoulder = ground => roadHeight + Math.sign(ground - roadHeight) * Math.min(Math.abs(ground - roadHeight), Math.max(0, lateral - paved) * slope);
    const plain = shoulder(land);
    if (!zone) return plain;
    // the shoulder rule only holds near a road: a few metres out the ground is the blend alone, so the height never hangs on which road is nearest
    const out = Math.min(1, Math.max(0, (lateral - paved - 3) / 12)), farFromRoad = Math.max(shadow, out * out * (3 - 2 * out));
    return plain * (1 - zone) + (shoulder(zoneLand) * (1 - farFromRoad) + zoneLand * farFromRoad) * zone;
  };
  // Ground under the bridge deck (and 1.5 m beyond its edges) lies below the deck underside. Without this, the
  // nearest non-bridge sample to a point under the deck is the deck end, and the land takes its height (or its
  // "paved" test) from there, which is above the deck's own middle. The outer 3 m of the deck are left alone,
  // so the road just past the ends keeps its height.
  const deckSamples = [];
  for (let i = 0; i < N; i += 2) if (track.isBridge[wrap(i - 3, N)] && track.isBridge[wrap(i + 3, N)] && track.isBridge[i]) deckSamples.push(i);
  track.groundAt = (px, pz, hint) => {
    const y = groundBase(px, pz, hint);
    if (Number.isInteger(hint) && track.isBridge[wrap(hint, N)]) return y;
    let cap = Infinity;
    for (const i of deckSamples) {
      const dx = px - x[i], dz = pz - z[i];
      if (Math.abs(dx * tx[i] + dz * tz[i]) > 1.5) continue;
      const lat = dx * nx[i] + dz * nz[i];
      if (Math.abs(lat) <= track.wall[lat < 0 ? 0 : 1][i] + 1.5) cap = Math.min(cap, h[i] - 1.6);
    }
    return Math.min(y, cap);
  };
  buildBarriers(track, corners);
  buildFurniture(track, corners);

  track.relief = (sd, i, a) => relief(track, sd, i, a);
  track.locate = (px, pz, hint, out) => locate(track, px, pz, hint, out);
  track.surfaceAt = (i, d) => surfaceAt(track, i, d);
  track.concreteProgressAt = (i, d) => {
    const side = d < 0 ? 0 : 1;
    const start = track.hw[i] + track.kerb[side][i] + track.sausage[side][i];
    const out = Math.abs(d) - start, width = track.runoff[side][i];
    return width > 0 ? Math.max(0, Math.min(1, (out - width * 2 / 3) / (width / 3))) : 0;
  };
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
  out.tx = nzv; out.tz = -nxv;     // the direction of travel, as T.tx/T.tz (it once pointed backwards, which turned the hill force round)
  out.nx = nxv; out.nz = nzv;
  return out;
}

function segT(T, i, j, px, pz) {
  const ax = T.x[j] - T.x[i], az = T.z[j] - T.z[i];
  return ((px - T.x[i]) * ax + (pz - T.z[i]) * az) / (ax * ax + az * az);
}

function surfaceAt(T, i, d) {
  const side = d < 0 ? 0 : 1, a = Math.abs(d), hw = T.hw[i];
  if (side === 0 && T.pitMouth[i] && a <= T.pitOut[i]) return a < T.pitIn[i] ? SURF.TARMAC : SURF.PIT;   // the mouth is one surface with the track
  if (a <= hw - LINE_WIDTH) return SURF.TARMAC;
  if (a <= hw) return SURF.PAINT;
  if (side === 0 && T.pitEntryNear && T.pitEntryNear[i]) {
    if (T.pitEntryZone[i] && !T.pitEntryRunoff[i] && a <= T.pitEntryEdge[i]) return SURF.TARMAC;   // the entry road's mouth is one surface with the track
    const r = a > T.hw[i] + T.kerb[0][i] + T.sausage[0][i] + T.runoff[0][i] || !T.pitEntryZone[i] ? entryRoadAt(T, T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d) : null;
    if (r && r.apron) return SURF.RUNOFF;
    if (r && !r.out) return SURF.PIT;
  }
  if (side === 0 && T.pitOut[i] && a >= T.pitIn[i] && a <= T.pitOut[i]) return SURF.PIT;
  if (side === 0 && T.pitIsland[i] && a < T.pitIn[i]) return SURF.RUNOFF;
  let edge = hw + T.kerb[side][i];
  if (a <= edge) return SURF.KERB;
  edge += T.sausage[side][i];
  if (a <= edge) return SURF.SAUSAGE;
  const apronStart = edge;
  edge += T.runoff[side][i];
  if (a <= edge) {
    if (!T.concrete[side][i]) return SURF.RUNOFF;
    const apronOffset = a - apronStart, apronWidth = T.runoff[side][i];
    if ((Math.abs(apronOffset - apronWidth / 3) <= RUMBLE_HALF || Math.abs(apronOffset - apronWidth * 2 / 3) <= RUMBLE_HALF)) return SURF.RUMBLE;
    return apronOffset > apronWidth / 3 ? SURF.RUNOFF_ROUGH : SURF.RUNOFF;
  }
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

function cornerWidths(corner, s, length) {
  const profile = corner.widthProfile;
  if (!profile || profile.length < 2) return { apron: corner.apron, gravel: corner.gravel, barrier: corner.barrier };
  const points = [];
  let lapOffset = 0, previous = profile[0][0];
  for (const point of profile) {
    if (point[0] < previous) lapOffset += length;
    points.push([point[0] + lapOffset, point[1], point[2], point[3]]);
    previous = point[0];
  }
  let target = ((s % length) + length) % length;
  while (target < points[0][0]) target += length;
  while (target > points.at(-1)[0] && target - length >= points[0][0]) target -= length;
  for (let k = 1; k < points.length; k++) if (target <= points[k][0]) {
    const a = points[k - 1], b = points[k], t = (target - a[0]) / (b[0] - a[0] || 1);
    return { apron: a[1] + (b[1] - a[1]) * t, gravel: a[2] + (b[2] - a[2]) * t, barrier: a[3] + (b[3] - a[3]) * t };
  }
  const last = points.at(-1);
  return { apron: last[1], gravel: last[2], barrier: last[3] };
}

// ---------------------------------------------------------------------------
// Track width

// layout.narrow: [from point, to point, width m, ease in m, ease out m]. The tarmac is `width` wide from `from` to `to` and
// eases (smoothstep) back to the full layout width over the ease lengths either side, so there is never a step in the edge.
function buildHalfWidths(T, layout) {
  const hw = new Float64Array(T.N).fill(layout.width / 2);
  for (const [from, to, width, easeIn, easeOut] of layout.narrow || []) {
    const a = T.sAtPointRaw(from), b = T.sAtPointRaw(to);
    for (let i = 0; i < T.N; i++) {
      const s = T.s[i];
      const before = ((a - s) % T.length + T.length) % T.length, after = ((s - b) % T.length + T.length) % T.length;
      let w = 0;   // 0 = full layout width, 1 = fully narrowed
      if (inRange(s, a, b, T.length)) w = 1;
      else if (before <= easeIn) { const e = 1 - before / easeIn; w = e * e * (3 - 2 * e); }
      else if (after <= easeOut) { const e = 1 - after / easeOut; w = e * e * (3 - 2 * e); }
      hw[i] = Math.min(hw[i], layout.width / 2 + (width / 2 - layout.width / 2) * w);
    }
  }
  return hw;
}

// ---------------------------------------------------------------------------
// Sides of the track

// Run-off on each side. Each corner in corners.js decides its own kerbs and
// the run-off on its outside (paved apron, gravel, then grass out to the
// barrier). The colour-map zones in layout.js are applied on top and can only
// make a zone bigger.
function buildSides(T, corners) {
  const { N, layout } = T, HW = T.hw;
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
  const kerbOK = (sd, i) => !T.isBridge[i] && !(sd === 0 && T.pitMouth[i]) && !(sd === 0 && T.pitEntryZone[i] && !T.pitEntryWall[i]) && !(sd === 0 && T.pitOut[i] && T.pitIn[i] - HW[i] < KERB_WIDTH + 1.5);

  // 1. Corners: kerbs where the car uses the edge, run-off on the outside
  const gravelW = pair(), reach = pair();
  for (const c of corners) {
    for (const [side, list] of [[c.inside, c.kerbs.inside], [c.outside, c.kerbs.outside]]) {
      for (const [a, b] of list) forRange(a, b, 1, i => { const sd = sideOf(side); if (kerbOK(sd, i)) T.kerb[sd][i] = KERB_WIDTH; });
    }
    if (c.class === 'street') continue;
    const o = sideOf(c.outside);
    forRange(c.zone[0], c.zone[1], 25, (i, w) => {
      const widths = cornerWidths(c, T.s[i], T.length);
      T.runoff[o][i] = Math.max(T.runoff[o][i], widths.apron * w);
      gravelW[o][i] = Math.max(gravelW[o][i], widths.gravel * w);
      reach[o][i] = Math.max(reach[o][i], widths.barrier * w);
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
  // two street zones with a short gap between them are one wall: the wall holds the street line through the gap
  // (and through the tapers either side of it), so the containment wall never has to bridge them at another offset
  const STREET_JOIN = 40, TAPER = 13;
  for (let sd = 0; sd < 2; sd++) {
    let start = T.street[sd].indexOf(1);
    if (start < 0) continue;
    for (let n = 0; n < N;) {
      const i = wrap(start + n, N);
      if (T.street[sd][i]) { n++; continue; }
      let m = n; while (m < N && !T.street[sd][wrap(start + m, N)]) m++;
      if (m < N && (m - n) * T.ds <= STREET_JOIN) {
        for (let k = n - TAPER; k < m + TAPER; k++) { const j = wrap(start + k, N); streetW[sd][j] = 1; T.street[sd][j] = 1; if (T.kerb[sd][j]) T.kerb[sd][j] = STREET_KERB; }
      }
      n = m;
    }
  }
  for (const [a, b, code, width] of layout.runoff || []) forZone(a, b, code, 10, (sd, i, w) => {
    T.runoff[sd][i] = Math.max(T.runoff[sd][i], width * w);
  });
  for (const [a, b, code] of layout.sausage || []) forZone(a, b, code, 3, (sd, i) => {
    T.sausage[sd][i] = SAUSAGE_WIDTH;
    if (!T.kerb[sd][i]) T.kerb[sd][i] = KERB_WIDTH;
  });
  // the exit road's raised kerb: a flat kerb at the track edge, then the sausage the bollards stand behind
  for (let i = 0; i < N; i++) if (T.pitSep[i]) { T.kerb[0][i] = KERB_WIDTH; T.sausage[0][i] = SAUSAGE_WIDTH; }
  // [from, to, side, width, grassFirst]: grassFirst (0..1) leaves that share of the band nearest the track as grass
  const gravelGrass = pair();
  for (const [a, b, code, width, grassFirst = 0] of layout.gravel || []) forZone(a, b, code, 30, (sd, i, w) => {
    gravelW[sd][i] = Math.max(gravelW[sd][i], width * w);
    if (grassFirst) gravelGrass[sd][i] = Math.max(gravelGrass[sd][i], grassFirst * w);
  });

  // On the inside of a curve an offset line deeper than the radius folds over itself (a zig-zag wall, gravel drawn
  // twice). Cap the flat ground on the inside at INSIDE_DEPTH of the tightest radius within 40 m, eased along the lap.
  const insideCap = pair();
  for (let sd = 0; sd < 2; sd++) {
    const g = sd ? 1 : -1, raw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let r = Infinity;
      for (let k = -40; k <= 40; k++) { const j = wrap(i + k, N), c = T.curv[j]; if (c * g > 1e-4) r = Math.min(r, 1 / Math.abs(c)); }
      raw[i] = Math.max(HW[i] + MIN_EDGE + MIN_BARRIER, INSIDE_DEPTH * r);
    }
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -25; k <= 25; k++) sum += Math.min(raw[wrap(i + k, N)], 1e4);
      insideCap[sd][i] = Math.min(raw[i] * 1.15, sum / 51);
    }
  }

  // 3. Lay the bands out from the edge: kerb, apron, gravel, grass, and how
  // far the flat ground reaches (out to the barrier, or the plain run-off)
  for (let sd = 0; sd < 2; sd++) {
    for (let i = 0; i < N; i++) {
      if (T.isBridge[i]) { T.kerb[sd][i] = 0; T.runoff[sd][i] = BRIDGE_RUNOFF; T.wall[sd][i] = HW[i] + BRIDGE_RUNOFF; continue; }   // the deck margin is paved
      if (sd === 0 && (T.pitOut[i] || T.pitEntryZone[i])) { T.runoff[sd][i] = 0; gravelW[sd][i] = 0; }
      // beside the entry road the run-off is tarmac all the way to the pit wall (the wall stands on its far edge)
      // (at the mouth it is the shared asphalt where the road splits off; the bands draw it as road)
      if (sd === 0 && T.pitEntryEdge[i]) { T.runoff[sd][i] = Math.max(0, T.pitEntryEdge[i] - HW[i] - T.kerb[sd][i] - T.sausage[sd][i]); T.concrete[sd][i] = 0; }
      if (gravelW[sd][i] > 0.5) T.runoff[sd][i] = Math.max(T.runoff[sd][i], GRAVEL_APRON * Math.min(1, gravelW[sd][i] / 5));
      // just past the deck the run-off eases from the deck margin to its plain width (a square end here is a step in the apron)
      const pastDeck = ((T.s[i] - T.bridge[1]) % T.length + T.length) % T.length;
      const tapering = pastDeck < BRIDGE_TAPER;
      if (tapering) T.runoff[sd][i] = Math.max(T.runoff[sd][i], BRIDGE_RUNOFF * (1 - pastDeck / BRIDGE_TAPER));
      const edge = HW[i] + T.kerb[sd][i] + T.sausage[sd][i] + T.runoff[sd][i];
      if (gravelW[sd][i] > 0.5) { T.gravelIn[sd][i] = edge; T.gravelOut[sd][i] = edge + gravelW[sd][i]; }
      let flat = Math.max(HW[i] + PLAIN_RUNOFF, HW[i] + reach[sd][i], T.gravelOut[sd][i] + 3);
      if (streetW[sd][i] > 0) flat = flat + (edge + STREET_GAP - flat) * streetW[sd][i];
      if (sd === 0 && T.pitOut[i]) flat = Math.max(flat, T.pitOut[i] + PIT_APRON);
      // never inside what a departure from the corner needs (reach), nor inside the pit road
      const cap = Math.max(insideCap[sd][i], HW[i] + reach[sd][i], sd === 0 && T.pitOut[i] ? T.pitOut[i] + PIT_APRON : 0);
      T.wall[sd][i] = Math.min(flat, Math.max(HW[i] + 2, T.room[sd][i]), cap);
      if (tapering) T.wall[sd][i] = Math.max(T.wall[sd][i], edge);   // the wall stays outside the tapering apron
      if (T.gravelOut[sd][i] > T.wall[sd][i] - 1) T.gravelOut[sd][i] = Math.max(0, T.wall[sd][i] - 1);
      if (gravelGrass[sd][i] > 0 && T.gravelOut[sd][i] > 0) T.gravelIn[sd][i] = edge + (T.gravelOut[sd][i] - edge) * gravelGrass[sd][i];
      if (T.gravelOut[sd][i] <= T.gravelIn[sd][i] + 0.5) T.gravelOut[sd][i] = 0;
    }
    // beside the pit road mouths the run-off eases away over 60 m instead of ending against the pit road
    if (sd === 0 && T.pitRange) for (let i = 0; i < N; i++) {
      const s = T.s[i], toIn = ((T.pitRange[0] - s) % T.length + T.length) % T.length, fromOut = ((s - T.pitRange[1]) % T.length + T.length) % T.length;
      const d = Math.min(toIn, fromOut);
      if (d < 60 && !T.pitOut[i]) {
        const f = d / 60, w = f * f * (3 - 2 * f);
        T.runoff[0][i] *= w; if (T.gravelOut[0][i] > 0) { T.gravelOut[0][i] = T.gravelIn[0][i] + (T.gravelOut[0][i] - T.gravelIn[0][i]) * w; if (T.gravelOut[0][i] - T.gravelIn[0][i] < 0.5) T.gravelOut[0][i] = 0; }
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < N; i++) T.wall[sd][i] = Math.min(T.wall[sd][i], T.wall[sd][i - 1] + 0.25);
      for (let i = N - 2; i >= 0; i--) T.wall[sd][i] = Math.min(T.wall[sd][i], T.wall[sd][i + 1] + 0.25);
    }
    // beside the separate entry road the flat ground ends at the road's track-side edge, where the pit wall stands
    if (sd === 0) {
      const lap = Float64Array.from(T.wall[0]);
      for (let i = 0; i < N; i++) if (T.pitEntryZone[i]) T.wall[0][i] = T.pitEntryEdge[i];
      // the flat ground eases into the entry road's edge (and back out of it at its join) over MOUTH_EASE metres, so the containment
      // line has no square step at either end: the step is spread over the approach, and it dies away to the lap's own wall
      let zs = -1, ze = -1;
      for (let i = 0; i < N; i++) if (T.pitEntryZone[i] && !T.pitEntryZone[wrap(i - 1, N)]) zs = i;
      for (let i = 0; i < N; i++) if (T.pitEntryZone[i] && !T.pitEntryZone[wrap(i + 1, N)]) ze = i;
      if (zs >= 0) {
        // coming in: the flat ground falls no faster than the wall rule allows, back from the road's edge
        for (let pass = 0; pass < 3; pass++) for (let i = zs - 1; i >= 0; i--) T.wall[0][i] = Math.min(T.wall[0][i], T.wall[0][i + 1] + 0.25);
        // going out: the flat ground rises from the road's edge, the step eased away over MOUTH_EASE metres
        const after = lap[wrap(ze + 1, N)] - T.pitEntryEdge[ze];
        for (let k = 1; k <= MOUTH_EASE; k++) {
          const f = 1 - k / MOUTH_EASE, e = f * f * (3 - 2 * f), i2 = wrap(ze + k, N);
          T.wall[0][i2] = lap[i2] - after * e;
        }
      }
    }
    // the paved bands never reach past the barrier line (matters where the line funnels in to a bridge)
    for (let i = 0; i < N; i++) {
      const room = Math.max(0, T.wall[sd][i] - HW[i] - T.kerb[sd][i] - T.sausage[sd][i]);
      T.runoff[sd][i] = Math.min(T.runoff[sd][i], room);
    }
    // an apron that ends in one metre (no taper) is eased out over APRON_TAPER metres back from its end (Final Approach, s 3668)
    for (let i = 0; i < N; i++) {
      if (T.isBridge[i] || T.runoff[sd][i] < 1.8 || T.runoff[sd][wrap(i + 1, N)] > 0.01) continue;
      for (let k = 0; k <= APRON_TAPER; k++) {
        const f = Math.min(1, k / APRON_TAPER), w = f * f * (3 - 2 * f);
        T.runoff[sd][wrap(i - k, N)] *= w;
      }
    }
  }
}

// Kerb and sausage widths change by at most KERB_SLOPE metres per metre of track, so a kerb
// eases in and out instead of starting with a hard step.
const KERB_SLOPE = 0.2;
// Beside the separate entry road the run-off is the tarmac between the track's own bands and the road's edge. It is worked out
// again here from the kerbs and sausage kerbs as they were smoothed, so the apron ramps with them and has no step where a kerb starts or stops.
function settleEntryApron(T) {
  for (let i = 0; i < T.N; i++) {
    if (!T.pitEntryZone[i]) continue;
    T.runoff[0][i] = Math.max(0, T.pitEntryEdge[i] - T.hw[i] - T.kerb[0][i] - T.sausage[0][i]);
  }
}
function smoothKerbs(T) {
  const { N } = T, step = KERB_SLOPE * T.ds;
  for (let sd = 0; sd < 2; sd++) for (const arr of [T.kerb[sd], T.sausage[sd]]) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < N * 2; i++) arr[i % N] = Math.min(arr[i % N], arr[(i - 1) % N] + step);
      for (let i = N * 2 - 2; i >= 0; i--) arr[i % N] = Math.min(arr[i % N], arr[(i + 1) % N] + step);
    }
  }
}

// V-shaped run-off beside a street wall (layout.vrunoff). The wall steps out square to the track at the start, which is why this
// runs after the wall has been eased and the kerbs smoothed, and comes back to the track limits in a straight line.
// The apron holds its full width for `hold` metres first (layout vrunoff's fifth value, 0 if none), then tapers over `length`.
// It eases out from the street wall over `ramp` metres first (layout vrunoff's sixth value, 0 for a square start), so the wall never steps.
function buildVRunoff(T) {
  for (const [from, side, width, length, hold = 0, ramp = 0] of T.layout.vrunoff || []) {
    const sd = side === 'L' ? 0 : 1, i0 = Math.round(T.sAtPointRaw(from) / T.ds);
    for (let k = 0; k <= hold + length; k++) {
      const i = wrap(i0 + k, T.N);
      const f = ramp ? Math.min(1, k / ramp) : 1, up = f * f * (3 - 2 * f);
      const w = width * up * (1 - Math.max(0, k - hold) / length);
      const edge = T.hw[i] + T.kerb[sd][i] + T.sausage[sd][i];
      T.runoff[sd][i] = Math.max(T.runoff[sd][i], w);
      T.wall[sd][i] = Math.max(T.wall[sd][i], edge + T.runoff[sd][i] + STREET_GAP);
    }
  }
}

// Rumble strips (layout.rumble): the paved apron of the zone becomes concrete, so the rumble bands are painted across it
// (trackMesh.js) and the surface is RUMBLE on the two bands, a third and two thirds of the way out. Runs after the pit road's
// own run-off, which is tarmac, so only the apron that is paved gets bands.
function buildRumble(T) {
  for (const [from, to, side] of T.layout.rumble || []) {
    const sd = side === 'L' ? 0 : 1, i0 = Math.round(T.sAtPointRaw(from) / T.ds), i1 = Math.round(T.sAtPointRaw(to) / T.ds);
    for (let i = i0; i <= i1; i++) { const j = wrap(i, T.N); if (T.runoff[sd][j] > 1.8) T.concrete[sd][j] = 1; }
  }
}

// The ground at and beside the bridge deck. The deck stands well above the land under it (the main straight runs through the
// cutting below), and the plain terrain rule (height of the nearest non-deck sample) flips between the approach embankment and the
// straight part way along the deck, a cliff of several metres. Here the deck samples carry the height of the embankment under
// them instead: it falls from just under the deck at each end at 1:3 down to the level of the road below, and the ground near the
// deck is the inverse-distance blend of those heights and the neighbouring road samples, so it is continuous everywhere.
function buildBridgeGround(T) {
  const { N } = T;
  T.bridgeGround = null;
  const deck = []; for (let i = 0; i < N; i++) if (T.isBridge[i]) deck.push(i);
  if (!deck.length) return;
  const run = runsOf(N, i => T.isBridge[i])[0], first = run[0], last = run[run.length - 1];
  const sa = T.s[first], sb = T.s[last], len = T.length;
  // level of whatever runs underneath: the lowest road sample within 14 m (in plan) that is well below the deck
  let floor = -Infinity;
  for (const i of deck) {
    let low = Infinity;
    for (let j = 0; j < N; j++) {
      if (T.isBridge[j] || T.h[j] > T.h[i] - 3) continue;
      if ((T.x[j] - T.x[i]) ** 2 + (T.z[j] - T.z[i]) ** 2 < 14 * 14) low = Math.min(low, T.h[j] - 0.35);
    }
    if (low < Infinity) floor = floor === -Infinity ? low : Math.min(floor, low);
  }
  const he = new Float64Array(N).fill(NaN);
  for (const i of deck) {
    const fromStart = ((T.s[i] - sa) % len + len) % len, toEnd = ((sb - T.s[i]) % len + len) % len;
    he[i] = Math.max(floor, T.h[first] - 1.7 - fromStart * BRIDGE_SLOPE, T.h[last] - 1.7 - toEnd * BRIDGE_SLOPE);
  }
  // the heights the blend draws on: every second sample within BRIDGE_ZONE_FAR + 60 m of the deck
  const R = BRIDGE_ZONE_FAR + 60;
  const sources = [];
  for (let i = 0; i < N; i += 2) {
    let ok = false;
    for (let k = 0; k < deck.length && !ok; k += 6) ok = (T.x[i] - T.x[deck[k]]) ** 2 + (T.z[i] - T.z[deck[k]]) ** 2 < R * R;
    if (ok) sources.push(i);
  }
  const sx = Float64Array.from(sources, i => T.x[i]), sz = Float64Array.from(sources, i => T.z[i]);
  const sh = Float64Array.from(sources, i => (T.isBridge[i] ? he[i] : T.h[i] - 0.35));
  const dx = Float64Array.from(deck, i => T.x[i]), dz = Float64Array.from(deck, i => T.z[i]);
  // the road samples next to the deck: the only ones that can be the END of a road
  const endSample = new Uint8Array(N);
  for (const i of deck) for (let k = -3; k <= 3; k++) if (!T.isBridge[wrap(i + k, N)]) endSample[wrap(i + k, N)] = 1;
  T.bridgeGround = {
    endSample,
    // 1 within BRIDGE_ZONE_NEAR of the deck, easing to 0 at BRIDGE_ZONE_FAR
    weight(px, pz) {
      let q = Infinity;
      for (let k = 0; k < dx.length; k += 2) q = Math.min(q, (px - dx[k]) ** 2 + (pz - dz[k]) ** 2);
      const f = Math.min(1, Math.max(0, (BRIDGE_ZONE_FAR - Math.sqrt(q)) / (BRIDGE_ZONE_FAR - BRIDGE_ZONE_NEAR)));
      return f * f * (3 - 2 * f);
    },
    height(px, pz) {
      let sw = 0, swh = 0;
      for (let k = 0; k < sx.length; k++) {
        const q = (px - sx[k]) ** 2 + (pz - sz[k]) ** 2, w = 1 / ((q + BRIDGE_BLEND) * (q + BRIDGE_BLEND));
        sw += w; swh += w * sh[k];
      }
      return swh / sw;
    },
  };
}

// How far out each band may go before the offset curve would fold over itself on the inside of a
// bend (a distance past about 90% of the corner radius). Bands are drawn no further out than this.
function buildReach(T) {
  const { N } = T;
  T.reach = [new Float64Array(N).fill(Infinity), new Float64Array(N).fill(Infinity)];
  const k = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 6, N), b = wrap(i + 6, N);
    k[i] = ((T.tx[b] - T.tx[a]) * T.nx[i] + (T.tz[b] - T.tz[a]) * T.nz[i]) / (12 * T.ds);   // + curves towards side 1
  }
  for (let i = 0; i < N; i++) for (const sd of [0, 1]) {
    const inside = sd ? k[i] : -k[i];
    if (inside > 1e-4) T.reach[sd][i] = 0.9 / inside;
  }
  for (let sd = 0; sd < 2; sd++) {
    const r = T.reach[sd], tmp = Float64Array.from(r);
    for (let i = 0; i < N; i++) for (let d = -8; d <= 8; d++) tmp[i] = Math.min(tmp[i], r[wrap(i + d, N)]);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < N * 2; i++) tmp[i % N] = Math.min(tmp[i % N], tmp[(i - 1) % N] + 0.5);
      for (let i = N * 2 - 2; i >= 0; i--) tmp[i % N] = Math.min(tmp[i % N], tmp[(i + 1) % N] + 0.5);
    }
    r.set(tmp);
  }
}

// Real height above the road surface at `a` metres out from the centreline, on side sd at sample i.
// Only the kerb and the sausage have any: a kerb rises to 2 cm, the sausage on to 5 cm and drops
// away at its outer edge. Narrow (tapering) kerbs are lower, so each one ramps in and out.
// The wheels follow this too (physics.js), and the mesh is built from it (trackMesh.js).
const KERB_RISE = 0.02, SAUSAGE_RISE = 0.05;
function relief(T, sd, i, a) {
  const hw = T.hw[i], kw = T.kerb[sd][i], sw = T.sausage[sd][i];
  if (a >= hw + kw + sw) {
    // a grooved rumble band across a concrete apron: flat, 6 mm up
    const rw = T.runoff[sd][i], o = a - (hw + kw + sw);
    if (T.concrete[sd][i] && rw > 1.8 && o <= rw && (Math.abs(o - rw / 3) <= RUMBLE_HALF || Math.abs(o - rw * 2 / 3) <= RUMBLE_HALF)) return RUMBLE_RELIEF;
    return 0;
  }
  if (a <= hw) return 0;
  if (a <= hw + kw) return KERB_RISE * Math.min(1, kw / KERB_WIDTH) * (a - hw) / (kw || 1);
  const t = (a - hw - kw) / (sw || 1), top = SAUSAGE_RISE * Math.min(1, sw / SAUSAGE_WIDTH);
  return t <= 0.5 ? KERB_RISE + (top - KERB_RISE) * 2 * t : top * 2 * (1 - t);
}

// Free distance from the centreline on each side before running into the
// halfway line to another part of the track (Infinity where the land is open).
function buildRoom(T) {
  const { N } = T;
  T.room = [new Float64Array(N).fill(Infinity), new Float64Array(N).fill(Infinity)];
  for (let sd = 0; sd < 2; sd++) {
    const sg = sd ? 1 : -1, r = T.room[sd];
    for (let i = 0; i < N; i += 2) {
      for (let d = T.hw[i] + 1; d <= T.hw[i] + 110; d += 1.5) {
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
  const { N } = T, P = T.layout.pit;
  T.pitIn = new Float64Array(N);      // |d| of the pit road's track-side edge, 0 = no pit road here
  T.pitOut = new Float64Array(N);     // |d| of its far edge
  T.pitWall = new Uint8Array(N);      // 1 where the pit wall stands, from pitIn - PIT_WALL to pitIn
  T.pitIsland = new Uint8Array(N);    // painted chevron island between the two roads at the entry
  T.pitMouth = new Uint8Array(N);
  T.pitLimiter = new Uint8Array(N);
  T.pitGarage = new Uint8Array(N);    // full-width stretch where the garages can go
  T.pitWidth = P.width;
  T.pitSpeed = P.speedLimit / 3.6;
  const a = T.sAtPointRaw(P.entry), b = (T.sAtPointRaw(P.exit) + (P.exitRun || 0)) % T.length;
  const len = ((b - a) % T.length + T.length) % T.length;
  T.pitRange = [a, b];
  T.pitSep = new Uint8Array(N);       // exit road alongside the track: raised kerb and bollards between them
  T.pitSepWall = new Uint8Array(N);   // the low wall on the exit road's track-side edge, from the pit wall to the merge
  T.pitSepWidth = EXIT_SEP_WALL;
  const tIn = Math.tan(PIT_ENTRY_ANGLE * Math.PI / 180), tOut = Math.tan(PIT_EXIT_ANGLE * Math.PI / 180);
  const smin = (p, q, k = 6) => -k * Math.log(Math.exp(-p / k) + Math.exp(-q / k));   // smooth minimum
  const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  // gap between the track edge and the exit road, by distance v before the end of the merge
  const exitGap = v => v < EXIT_MERGE ? EXIT_SEP * ease(v / EXIT_MERGE) : EXIT_SEP + tOut * Math.max(0, v - EXIT_MERGE - EXIT_ALONGSIDE);
  T.pitExitClose = EXIT_CLOSE;
  // The entry road: its track-side edge is pulled straight like a string between the split (at PIT_ENTRY_ANGLE) and the
  // full-width lane, held at least a pit wall's clearance from the track edge. So it cuts across the chicane instead of
  // following it. Its first `entryJoin` metres are a road of their own (T.pitEntry, laid along its own direction), since
  // across the chicane its far edge is further out than the bend's radius, where offsets from the track fold back. After
  // that it is the usual offset lane (pitIn, pitOut), and only its track-side edge has to stay clear of the fold.
  const entryLen = P.entryRoad || 0, ek = Math.round(entryLen / T.ds), jk = Math.min(ek, Math.round((P.entryJoin || 0) / T.ds));
  const fullAt = i => T.hw[i] + PIT_WALL_CLEAR + PIT_WALL + 0.6;
  const entryWidth = u => (P.entryWidth || P.width) + (P.width - (P.entryWidth || P.width)) * ease((u - (entryLen - 60)) / 60);
  const entryEdge = new Float64Array(ek + 1), idx = [];
  if (ek > 0) {
    const lo = [], hi = [], fixed = [];
    for (let k = 0; k <= ek; k++) {
      const u = k * T.ds, i = wrap(Math.round((a + u) / T.ds), N), hw = T.hw[i];
      let c = 0; for (let q = -2; q <= 2; q++) c = Math.min(c, T.curv[wrap(i + q, N)]);   // tightest left turn nearby (left is the pit side)
      idx.push(i);
      lo.push(hw + Math.min(tIn * u, fullAt(i) - hw));
      hi.push(c < 0 ? ENTRY_FOLD / -c - (k < jk ? 0 : entryWidth(u)) : Infinity);
      fixed.push(u < PIT_MOUTH_CLEAR || u > entryLen - 15);
      entryEdge[k] = u < PIT_MOUTH_CLEAR ? hw + tIn * u : u > entryLen - 15 ? fullAt(i) : Math.max(lo[k], Math.min(hi[k], fullAt(i)));
    }
    const px = k => T.x[idx[k]] - T.nx[idx[k]] * entryEdge[k], pz = k => T.z[idx[k]] - T.nz[idx[k]] * entryEdge[k];
    for (let it = 0; it < 4000; it++) {
      for (let k = 1; k < ek; k++) {
        if (fixed[k]) continue;
        // where this sample's normal crosses the chord between its neighbours (the edge there if it were straight)
        const i = idx[k], ax = px(k - 1), az = pz(k - 1), dx = px(k + 1) - ax, dz = pz(k + 1) - az;
        const den = T.nx[i] * dz - T.nz[i] * dx;
        const target = Math.abs(den) > 1e-6 ? ((T.x[i] - ax) * dz - (T.z[i] - az) * dx) / den
          : -(((ax + dx / 2) - T.x[i]) * T.nx[i] + ((az + dz / 2) - T.z[i]) * T.nz[i]);
        entryEdge[k] = Math.max(lo[k], Math.min(hi[k], entryEdge[k] + 1.85 * (target - entryEdge[k])));   // over-relaxed: converges in a few hundred passes
      }
    }
  }
  T.pitEntryZone = new Uint8Array(N);   // samples beside the separate entry road
  T.pitEntryEdge = new Float64Array(N); // |d| of the entry road's track-side edge (the pit wall's pit face), along the whole entry road
  T.pitEntryWall = new Uint8Array(N);   // beside the separate entry road, where the pit wall stands
  T.pitEntryRunoff = new Uint8Array(N); // beside the entry road: tarmac run-off from the track edge to the pit wall
  T.pitEntry = null;
  if (jk > 0) {
    // The separate road. Its track-side edge is a smooth curve in the world (a cubic from the end of the mouth, splitting at
    // PIT_ENTRY_ANGLE, to the join, parallel to the track there), laid out a metre at a time; not an offset from the
    // track, which cannot hold a straight line past the chicane's tight left. R.i is the nearest track sample of each point.
    const k0 = Math.round(PIT_MOUTH_CLEAR / T.ds), iA = idx[k0], iB = idx[jk];
    const pA = [T.x[iA] - T.nx[iA] * entryEdge[k0], T.z[iA] - T.nz[iA] * entryEdge[k0]], pB = [T.x[iB] - T.nx[iB] * entryEdge[jk], T.z[iB] - T.nz[iB] * entryEdge[jk]];
    const ca = Math.cos(PIT_ENTRY_ANGLE * Math.PI / 180), sa = Math.sin(PIT_ENTRY_ANGLE * Math.PI / 180);
    // the track's direction turned PIT_ENTRY_ANGLE to the left (towards -n)
    const tA = [T.tx[iA] * ca + T.nx[iA] * -sa, T.tz[iA] * ca + T.nz[iA] * -sa], tB = [T.tx[iB], T.tz[iB]];
    const chord = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]), m = chord * ENTRY_TANGENT;
    const at = t => { const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      return [h00 * pA[0] + h10 * m * tA[0] + h01 * pB[0] + h11 * m * tB[0], h00 * pA[1] + h10 * m * tA[1] + h01 * pB[1] + h11 * m * tB[1]]; };
    const fine = []; for (let q = 0; q <= 2000; q++) fine.push(at(q / 2000));
    const pts = [];
    for (let k = 0; k < k0; k++) pts.push([T.x[idx[k]] - T.nx[idx[k]] * entryEdge[k], T.z[idx[k]] - T.nz[idx[k]] * entryEdge[k]]);   // the mouth: along the track
    let acc = 0; pts.push(fine[0]);
    for (let q = 1; q <= 2000; q++) { acc += Math.hypot(fine[q][0] - fine[q - 1][0], fine[q][1] - fine[q - 1][1]); if (acc >= T.ds) { pts.push(fine[q]); acc = 0; } }
    if (Math.hypot(pts.at(-1)[0] - pB[0], pts.at(-1)[1] - pB[1]) > 0.3) pts.push(pB); else pts[pts.length - 1] = pB;
    const n = pts.length;
    const R = { n, i: new Int32Array(n), h: new Int32Array(n), e: new Float64Array(n), x: new Float64Array(n), z: new Float64Array(n), dx: new Float64Array(n), dz: new Float64Array(n),
      w: new Float64Array(n), y: new Float64Array(n), apron: new Float64Array(n), u: new Float64Array(n) };
    let near = idx[0];
    for (let k = 0; k < n; k++) {
      R.x[k] = pts[k][0]; R.z[k] = pts[k][1];
      let best = Infinity; for (let q = -6; q <= 30; q++) { const j = wrap(near + q, N), d2 = (T.x[j] - R.x[k]) ** 2 + (T.z[j] - R.z[k]) ** 2; if (d2 < best) { best = d2; R.i[k] = j; } }
      near = R.i[k];
      R.e[k] = -((R.x[k] - T.x[near]) * T.nx[near] + (R.z[k] - T.z[near]) * T.nz[near]);
    }
    // R.h: the track sample each point's wall and barriers take their height from. R.i (the nearest sample) jumps where the road
    // runs far off the track; R.h advances evenly from the mouth to the join instead, so the barrier lines run through every sample.
    for (let k = 0; k < n; k++) R.h[k] = k < k0 ? R.i[k] : Math.round(iA + (iB - iA) * (k - k0) / Math.max(1, n - 1 - k0));
    for (let k = 0; k < n; k++) {
      const p = Math.max(0, k - 2), q = Math.min(n - 1, k + 2), L = Math.hypot(R.x[q] - R.x[p], R.z[q] - R.z[p]) || 1;
      R.dx[k] = (R.x[q] - R.x[p]) / L; R.dz[k] = (R.z[q] - R.z[p]) / L;
      R.u[k] = k ? R.u[k - 1] + Math.hypot(R.x[k] - R.x[k - 1], R.z[k] - R.z[k - 1]) : 0;
    }
    for (let k = 0; k < n; k++) R.w[k] = entryWidth(R.u[k] * entryLen / Math.max(1, R.u[n - 1]) * (jk * T.ds / entryLen));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) for (const f of [-1, 0, 1]) {
      const ox = R.x[k] + R.dz[k] * (f < 0 ? -12 : R.w[k] * f), oz = R.z[k] - R.dx[k] * (f < 0 ? -12 : R.w[k] * f);
      x0 = Math.min(x0, ox); x1 = Math.max(x1, ox); z0 = Math.min(z0, oz); z1 = Math.max(z1, oz);
    }
    R.box = [x0, x1, z0, z1];
    T.pitEntry = R;
    T.pitEntryNear = new Uint8Array(N);   // samples whose side the separate road may be on (the zone and 40 m either side)
    for (let k = 0; k < n; k++) for (let q = -40; q <= 40; q++) T.pitEntryNear[wrap(R.i[k] + q, N)] = 1;
    // where each zone sample's normal meets the road's edge (the run-off reaches it), never past where neighbouring
    // normals cross (the bands would fold): R.apron is the world strip that fills from there to the road
    for (let k = 0; k < jk; k++) {
      const i = idx[k], cx = T.x[i], cz = T.z[i];
      let hit = Infinity;
      for (let j = 0; j < n - 1; j++) {
        const ax = R.x[j], az = R.z[j], bx = R.x[j + 1] - ax, bz = R.z[j + 1] - az, den = -T.nx[i] * bz + T.nz[i] * bx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - cx) * -T.nz[i] - (az - cz) * -T.nx[i]) / den, e = ((ax - cx) * bz - (az - cz) * bx) / den;
        if (t >= -1e-6 && t <= 1 + 1e-6 && e > 0) hit = Math.min(hit, e);
      }
      let focal = Infinity;
      for (let q = -3; q <= 3; q++) {
        const j = wrap(i + q, N), j1 = wrap(j + 1, N), dth = Math.atan2(T.tz[j1], T.tx[j1]) - Math.atan2(T.tz[j], T.tx[j]);
        const turn = Math.atan2(Math.sin(dth), Math.cos(dth));
        if (T.curv[j] < 0) focal = Math.min(focal, T.ds / Math.max(1e-6, Math.abs(turn)));   // a left turn: the normals cross on the pit side
      }
      entryEdge[k] = Math.min(Number.isFinite(hit) ? hit : entryEdge[k], ENTRY_FOCAL * focal);
    }
    // eased into the dips where the normals cross, at most 0.25 m per metre (the road's own run-off strip fills the rest)
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 1; k < jk; k++) entryEdge[k] = Math.min(entryEdge[k], entryEdge[k - 1] + 0.25 * T.ds);
      for (let k = jk - 2; k >= 0; k--) entryEdge[k] = Math.min(entryEdge[k], entryEdge[k + 1] + 0.25 * T.ds);
    }
  }
  for (let u = 0; u <= len; u += T.ds) {
    const i = wrap(Math.round((a + u) / T.ds), N), w = len - u, v = Math.max(0, w - EXIT_CLOSE);   // w: to the very end, v: to the end of the merge
    const hw = T.hw[i], full = hw + PIT_WALL_CLEAR + PIT_WALL + 0.6;   // full: pit road inner edge once fully separated (a little spare for the eased curve)
    const k = Math.round(u / T.ds), onEntry = k <= ek && ek > 0;
    if (onEntry) { T.pitEntryEdge[i] = entryEdge[k]; if (u >= PIT_MOUTH_CLEAR) T.pitEntryRunoff[i] = 1; }
    if (onEntry && k < jk) {
      T.pitEntryZone[i] = 1;
      if (entryEdge[k] - PIT_WALL >= hw + PIT_WALL_CLEAR) T.pitEntryWall[i] = 1;
      continue;
    }
    const inner = onEntry ? Math.max(hw, entryEdge[k]) : Math.max(hw, smin(ek > 0 ? full : smin(hw + tIn * u, full, 1.5), hw + exitGap(v), 1.5));
    // the exit road narrows to EXIT_WIDTH as it comes down from beside the garages
    const narrow = u > len / 2 ? 1 - ease((inner - hw - EXIT_SEP) / (full - hw - EXIT_SEP - 0.3)) : 0;
    T.pitIn[i] = inner;
    // once merged, the lane closes: its outer edge eases in to the track edge over EXIT_CLOSE
    T.pitOut[i] = inner + (onEntry ? entryWidth(u) : P.width - (P.width - EXIT_WIDTH) * narrow) * (w < EXIT_CLOSE ? ease(w / EXIT_CLOSE) : 1);
    if ((!jk && u < PIT_MOUTH_CLEAR) || v < PIT_MOUTH_CLEAR) T.pitMouth[i] = 1;
    if ((jk || u >= PIT_MOUTH_CLEAR) && v > EXIT_MERGE && inner - PIT_WALL >= hw + PIT_WALL_CLEAR) T.pitWall[i] = 1;
    // the painted gore between the two roads: after the mouth at the entry, the whole hatched merge at the exit
    if (!jk && u >= PIT_MOUTH_CLEAR && u < PIT_MOUTH_CLEAR + PIT_ISLAND && inner > hw + 0.3) T.pitIsland[i] = 1;
    if (v >= PIT_MOUTH_CLEAR && v < EXIT_MERGE && inner > hw + 0.3) T.pitIsland[i] = 1;
    if (v >= EXIT_MERGE && !T.pitWall[i] && inner - hw <= EXIT_SEP + 1.5) T.pitSep[i] = 1;
    if (u > len / 2 && v >= EXIT_MERGE && !T.pitWall[i]) T.pitSepWall[i] = 1;
    if (T.pitWall[i] && (!ek || u > entryLen)) T.pitGarage[i] = 1;
  }
  if (T.pitEntry) {
    // R.apron: from the road's track-side edge back to where the track's own bands end (the zone samples' pitEntryEdge),
    // measured square to the road. R.wall: the pit wall stands on the road's edge once it is clear enough of the track.
    const R = T.pitEntry;
    R.apron = new Float64Array(R.n); R.wall = new Uint8Array(R.n);
    R.hitA = Int32Array.from(R.i); R.hitB = Int32Array.from(R.i); R.hitV = new Float64Array(R.n);   // the track samples whose band edge the run-off strip meets
    const zone = []; for (let i = 0; i < N; i++) if (T.pitEntryZone[i]) zone.push(i);
    for (let k = 0; k < R.n; k++) {
      const ox = R.x[k], oz = R.z[k], rx = -R.dz[k], rz = R.dx[k];   // towards the track
      let best = Infinity;
      for (let q = 0; q < zone.length - 1; q++) {
        const i = zone[q], j = zone[q + 1]; if (wrap(j - i, N) !== 1) continue;
        const ax = T.x[i] - T.nx[i] * T.pitEntryEdge[i], az = T.z[i] - T.nz[i] * T.pitEntryEdge[i];
        const bx = T.x[j] - T.nx[j] * T.pitEntryEdge[j] - ax, bz = T.z[j] - T.nz[j] * T.pitEntryEdge[j] - az;
        const den = rx * bz - rz * bx; if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - ox) * bz - (az - oz) * bx) / den, v = ((ax - ox) * rz - (az - oz) * rx) / den;
        if (v >= -1e-6 && v <= 1 + 1e-6 && t >= -0.05 && t < best) { best = t; R.hitA[k] = i; R.hitB[k] = j; R.hitV[k] = Math.max(0, Math.min(1, v)); }   // the nearest crossing towards the track
      }
      R.apron[k] = Number.isFinite(best) ? Math.max(0, best) : 0;
      const i = R.i[k], clear = Math.hypot(ox - T.x[i], oz - T.z[i]) - T.hw[i];
      R.wall[k] = R.u[k] >= PIT_MOUTH_CLEAR && clear - PIT_WALL >= PIT_WALL_CLEAR ? 1 : 0;
    }
  }
  // the limiter: from LIMIT_LEAD before the first garage (the bay is the middle of the garage stretch, see pitBuilding.js garageBay)
  // to the end of the pit wall at the exit
  const garages = [];
  for (let u = 0; u <= len; u += T.ds) { const i = wrap(Math.round((a + u) / T.ds), N); if (T.pitGarage[i]) garages.push(u); }
  const limitFrom = garages.length ? garages[Math.max(0, Math.floor(garages.length / 2) - 63)] - LIMIT_LEAD : 0;
  T.pitLimitFrom = (a + limitFrom) % T.length;
  for (let u = limitFrom; u <= len; u += T.ds) { const i = wrap(Math.round((a + u) / T.ds), N); if (T.pitWall[i]) T.pitLimiter[i] = 1; }
}

// The separate entry road under (px, pz): null when the point is not on or beside it, else { y, out } where `out` is how far
// outside the road's far edge it is (0 on the road). Points on the track side of it are left to the ordinary ground.
const ENTRY_VERGE = 8;   // metres beyond the far edge over which the ground eases from the road's height to its own
export function entryRoadAt(T, px, pz, reach = ENTRY_VERGE) {
  const R = T.pitEntry;
  if (!R) return null;
  const [x0, x1, z0, z1] = R.box, m = reach + 1;
  if (px < x0 - m || px > x1 + m || pz < z0 - m || pz > z1 + m) return null;
  let best = Infinity, k = -1;
  for (let j = 0; j < R.n; j++) {
    const q = (px - R.x[j] - R.dz[j] * R.w[j] / 2) ** 2 + (pz - R.z[j] + R.dx[j] * R.w[j] / 2) ** 2;
    if (q < best) { best = q; k = j; }
  }
  const rx = px - R.x[k], rz = pz - R.z[k];
  const along = rx * R.dx[k] + rz * R.dz[k], lat = rx * R.dz[k] - rz * R.dx[k];   // lat: across the road, away from the track
  if ((k === 0 && along < -0.5) || (k === R.n - 1 && along > 0.5) || lat < -(R.apron ? R.apron[k] : 0) || lat > R.w[k] + reach) return null;
  const kn = Math.max(0, Math.min(R.n - 1, k + Math.sign(along))), t = Math.min(1, Math.abs(along) / T.ds);
  // `apron`: on the run-off strip between the track's bands and the road (level with the road)
  if (lat > R.w[k] + ENTRY_VERGE) return { far: true, out: lat - R.w[k], k, lat };   // only with a longer reach: past the verge, for the terrain's sink
  return { y: R.y[k] + (R.y[kn] - R.y[k]) * t, out: Math.max(0, lat - R.w[k]), k, lat, apron: lat < 0 };
}

// ---------------------------------------------------------------------------
// Barriers: placed sections, each a polyline with a face towards the track.

function buildBarriers(T, corners) {
  const { N } = T, HW = T.hw;
  T.barriers = [];
  // points are [x, y, z, sample index the point was laid out from]
  const P = (i, d) => {
    const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    return [x, T.groundAt(x, z, i), z, i];
  };
  const add = (type, side, pts, extra = {}) => { if (pts.length > 1) T.barriers.push({ type, side, pts, ...extra }); };
  // a polyline following the track, one point every `step` samples
  const follow = (type, side, run, dFn, step = 1, extra) => {
    const pts = [];
    for (let k = 0; k < run.length; k += step) pts.push(P(run[k], dFn(run[k])));
    if ((run.length - 1) % step) pts.push(P(run[run.length - 1], dFn(run[run.length - 1])));
    add(type, side, pts, extra);
  };

  // 1. Tall stretches: where the departure tests say a car arrives (corners.js sections, justified by the departure
  // that leaves nearest), the SAME containment line is 1.9 m high with the bolt-head face, sponsor wrap, white band and
  // catch fence. It runs along the wall line, centred on the section, and tapers in height over TALL_RAMP m at each end.
  const nearBridge = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (T.isBridge[i]) for (let k = -BRIDGE_APPROACH; k <= BRIDGE_APPROACH; k++) nearBridge[wrap(i + k, N)] = 1;
  for (let i = 0; i < N; i++) if (T.isBridge[i]) nearBridge[i] = 0;
  const tall = [new Float32Array(N), new Float32Array(N)], tallOwner = [new Int16Array(N).fill(-1), new Int16Array(N).fill(-1)], tallInfo = [];
  T.tallStretches = tallInfo;
  for (const c of corners) {
    if (c.class === 'street') continue;
    for (const sec of c.sections || []) {
      const sd = (sec.side || c.outside) === 'L' ? 0 : 1;
      const dep = (c.departures || []).filter(d => d.depth > 0).sort((p, q) => Math.abs(p.s - sec.s) - Math.abs(q.s - sec.s))[0];
      if (!(dep && Math.abs(dep.s - sec.s) <= sec.length / 2 + 20)) continue;   // no departure arrives here: no tall wall
      const nearby = c.departures.filter(d => Math.min(Math.abs(d.s - sec.s), T.length - Math.abs(d.s - sec.s)) <= sec.length / 2 + 3);
      const need = Math.max(0, ...nearby.map(d => d.depth));
      const why = `${c.name}: "${dep.test}" leaves at s=${dep.s}, ${dep.depth} m beyond the edge, at ${dep.angle}°: this stretch of the wall is 1.9 m with a catch fence`;
      const id = tallInfo.push({ why, sd, need, s: sec.s, length: sec.length, corner: c.name, constrained: !!c.constrained }) - 1;
      const half = sec.length / 2, centre = Math.round(sec.s / T.ds);
      for (let k = -Math.ceil(half + TALL_RAMP); k <= half + TALL_RAMP; k++) {
        const outside = Math.max(0, Math.abs(k) - half), r = Math.max(0, 1 - outside / TALL_RAMP), i = wrap(centre + k, N);
        if (r > tall[sd][i]) { tall[sd][i] = r; tallOwner[sd][i] = id; }
      }
    }
  }

  for (let sd = 0; sd < 2; sd++) {
    const g = sd ? 1 : -1;
    // the street wall ends where its taper reaches the containment line (4 m beyond the track edge), where the plain tyre wall
    // takes over at the same offset, so the two meet with no step (a bulge inside a street zone stays street wall)
    const streetWall = new Uint8Array(N), edge4 = i => HW[i] + T.kerb[sd][i] + T.sausage[sd][i] + MIN_EDGE, out = i => T.wall[sd][i] > edge4(i);
    for (const run of runsOf(N, i => T.street[sd][i] && !T.isBridge[i])) {
      let a = 0, b = run.length - 1;
      while (a < b && out(run[a])) a++;
      while (b > a && out(run[b])) b--;
      const keep = out(run[a]) ? [] : run.slice(a, b + 1);   // a street zone whose wall is wholly out on the containment line has no street wall
      for (const i of keep) streetWall[i] = 1;
      if (keep.length > 1) {
        // one point every 3 m, plus a square step (two points on one sample's normal) wherever the wall line jumps out or back
        const pts = [];
        for (let k = 0; k < keep.length; k++) {
          const i = keep[k], prev = keep[k - 1];
          if (k > 0 && Math.abs(T.wall[sd][i] - T.wall[sd][prev]) > 3) { pts.push(P(prev, g * T.wall[sd][prev]), P(prev, g * T.wall[sd][i]), P(i, g * T.wall[sd][i])); }
          else if (k % 3 === 0 || k === keep.length - 1) pts.push(P(i, g * T.wall[sd][i]));
        }
        add(BARRIER.CONCRETE, sd, pts, { fence: true, why: 'street section: a wall at the track edge (the walls zones in layout.js)' });
      }
    }
    // 3. bridge parapets
    // the parapet runs BRIDGE_APPROACH metres either side of the deck too, following the barrier line as it
    // funnels in, and ends in a tyre stack, so there is no gap between the barrier and the bridge
    for (const run of runsOf(N, i => T.isBridge[i] || nearBridge[i])) {
      follow(BARRIER.PARAPET, sd, run, i => g * T.wall[sd][i], 1, { why: 'bridge parapet over the main straight and its approach' });
      for (const ends of [run.slice(0, 5), run.slice(-5)]) follow(BARRIER.TYRES, sd, ends, i => g * (T.wall[sd][i] + 0.05), 1, { impact: true, bridgeEnd: true, why: 'tyre stack at the end of the bridge parapet', spec: { length: 4, offset: T.wall[sd][ends[0]], angle: 0 } });
    }
    // the deck: a row of tyre stacks just inside each parapet, over the deck margin. At each end it tapers in to the parapet
    // over DECK_TYRE_TAPER metres, so it never meets the approach square
    for (const deck of runsOf(N, i => T.isBridge[i])) {
      const first = T.s[deck[0]], last = T.s[deck[deck.length - 1]], len = T.length;
      const inward = i => {
        const fromStart = ((T.s[i] - first) % len + len) % len, toEnd = ((last - T.s[i]) % len + len) % len;
        return 0.5 - 0.45 * Math.min(1, Math.min(fromStart, toEnd) / DECK_TYRE_TAPER);   // 0.5 m inside the parapet, 0.05 m at the ends
      };
      follow(BARRIER.TYRES, sd, deck, i => g * (T.wall[sd][i] - inward(i)), 1, { deckRow: true, why: 'tyre stacks just inside the bridge parapet, along the deck margin' });
    }
    // 4. the containment wall: ONE line that keeps a car on the flat ground. A 1.2 m plain sponsored tyre wall, except along
    // the tall stretches above (same line, taller, tapering over TALL_RAMP m), so the eye sees one line of barrier.
    // beside a street wall the containment wall keeps to the same easing line, so it joins the street wall in line
    const nearStreet = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (streetWall[i]) for (let k = -20; k <= 20; k++) nearStreet[wrap(i + k, N)] = 1;
    const needs = i => !streetWall[i] && !T.isBridge[i] && !nearBridge[i] && !(sd === 0 && (T.pitOut[i] || T.pitEntryZone[i]));
    const plainWhy = 'containment: a low sponsored tyre wall all round the flat ground, so a car never meets an unseen wall';
    const base = new Float64Array(N);
    for (let i = 0; i < N; i++) base[i] = nearStreet[i] ? Math.max(T.wall[sd][i], edge4(i)) : Math.max(T.wall[sd][i], HW[i] + MIN_BARRIER);
    // on the inside of a tight bend an offset line folds back on itself once it is further out than the bend's radius
    // (the swallowtail kinks). There the wall line is held to 0.7 of the radius (never closer than the 4 m minimum),
    // eased in and out at 0.25 m per metre, like the wall offset itself.
    const bend = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = wrap(i - 2, N), c = wrap(i + 2, N);
      const kx = (T.tx[c] - T.tx[a]) / 4, kz = (T.tz[c] - T.tz[a]) / 4;       // d(tangent)/ds, towards the centre of the bend
      bend[i] = (kx * T.nx[i] + kz * T.nz[i]) * g;                             // curvature seen from this side (positive: inside)
    }
    for (let i = 0; i < N; i++) {
      let towards = 0;
      for (let k = -5; k <= 5; k++) towards = Math.max(towards, bend[wrap(i + k, N)]);   // the tightest part of the neighbourhood
      if (towards > 1e-4 && !T.isBridge[i]) base[i] = Math.min(base[i], Math.max(edge4(i) + 0.5, 0.6 / towards));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < 2 * N; i++) { const a = (i - 1) % N, b = i % N; base[b] = Math.min(base[b], base[a] + 0.25); }
      for (let i = 2 * N - 2; i >= 0; i--) { const a = (i + 1) % N, b = i % N; base[b] = Math.min(base[b], base[a] + 0.25); }
    }
    // where the wall offset turns from falling to rising (or back) at 0.25 m per metre, the line would bend by up to 28
    // degrees between 3 m segments: round those turns off with a short moving average (a metre at most). Not beside
    // a street wall, a bridge or the pit lane, where the line must stay on the exact line it joins.
    const free = new Uint8Array(N).fill(1);
    for (let i = 0; i < N; i++) if (nearStreet[i] || nearBridge[i] || T.isBridge[i] || (sd === 0 && (T.pitOut[i] || T.pitEntryZone[i]))) for (let k = -3; k <= 3; k++) free[wrap(i + k, N)] = 0;
    for (let pass = 0; pass < 2; pass++) {
      const out = Float64Array.from(base);
      for (let i = 0; i < N; i++) if (free[i]) {
        let sum = 0; for (let k = -4; k <= 4; k++) sum += base[wrap(i + k, N)];
        out[i] = Math.max(sum / 9, edge4(i) + 0.5);
      }
      base.set(out);
    }
    T.lineOffset = T.lineOffset || [null, null]; T.lineOffset[sd] = base;
    const line = i => g * base[i];
    for (const run of runsOf(N, needs)) {
      if (run.length < 2) continue;
      const pts = [];
      for (let k = 0; k < run.length; k += 3) pts.push(P(run[k], line(run[k])));
      if ((run.length - 1) % 3) pts.push(P(run[run.length - 1], line(run[run.length - 1])));
      // cut into plain and tall pieces. A tall piece starts and ends on a plain point (height 1.2 m), where the plain
      // piece next to it ends or starts, so the taper is a ramp and the joint has no step.
      const key = k => tall[sd][pts[k][3]] > 0 ? 't' + tallOwner[sd][pts[k][3]] : 'p';
      let from = 0;
      for (let k = 1; k <= pts.length; k++) {
        if (k < pts.length && key(k) === key(from)) continue;
        if (key(from) === 'p') add(BARRIER.ARMCO, sd, pts.slice(from, Math.min(k + 1, pts.length) - (k < pts.length ? 1 : 0)), { plain: true, why: plainWhy });
        else {
          const piece = pts.slice(from > 0 && key(from - 1) === 'p' ? from - 1 : from, Math.min(k + 1, pts.length)), info = tallInfo[tallOwner[sd][pts[from][3]]];
          add(BARRIER.ARMCO, sd, piece, { plain: true, tall: true, hs: piece.map(p => tall[sd][p[3]]), need: info.need, why: info.why });
        }
        from = k;
      }
    }
  }

  // 5. pit wall (two faces) and the low wall on the far side of the pit lane
  for (const run of runsOf(N, i => T.pitWall[i])) {
    follow(BARRIER.PITWALL, 0, run, i => -(T.pitIn[i] - PIT_WALL), 3, { why: 'pit wall between the track and the pit lane' });
  }
  for (const run of runsOf(N, i => T.pitOut[i] && T.pitOut[i] > HW[i] + PIT_WALL_CLEAR && !T.pitMouth[i])) {
    follow(BARRIER.PITOUTER, 0, run, i => -(T.pitOut[i] + (T.pitGarage[i] ? PIT_APRON : 0.5)), 3, { why: 'low wall on the garage side of the pit lane' });
  }
  // the separate entry road: the pit wall between the run-off and the road, and the low wall along its far edge
  if (T.pitEntry) {
    const R = T.pitEntry;
    // the pit wall: its track-side face PIT_WALL in from the road's edge, its pit face on the edge (pitFace: the offset to it)
    const wk = []; for (let k = 0; k < R.n; k++) if (R.wall[k]) wk.push(k);
    if (wk.length > 1) {
      const pts = [], face = [];
      for (let q = 0; q < wk.length; q += q < wk.length - 3 ? 2 : 1) {
        const k = wk[q], lx = R.dz[k], lz = -R.dx[k], x = R.x[k] - lx * PIT_WALL, z = R.z[k] - lz * PIT_WALL;
        pts.push([x, T.groundAt(x, z, R.h[k]), z, R.h[k]]); face.push([lx * PIT_WALL, lz * PIT_WALL]);
        if (q === wk.length - 1) break;
      }
      add(BARRIER.PITWALL, 0, pts, { pitFace: face, why: 'pit wall between the track and the pit entry road' });
    }
  }
  if (T.pitEntry) {
    const R = T.pitEntry, pts = [];
    for (let k = 0; k < R.n; k += k < R.n - 3 ? 2 : 1) {
      const x = R.x[k] + R.dz[k] * (R.w[k] + 0.5), z = R.z[k] - R.dx[k] * (R.w[k] + 0.5);
      pts.push([x, T.groundAt(x, z, R.h[k]), z, R.h[k]]);
      if (k === R.n - 1) break;
    }
    add(BARRIER.PITOUTER, 0, pts, { why: 'low wall on the far side of the pit entry road' });
  }
  // tyre barriers in front of the pit wall where a car can reach it (layout.tyreWall). Each point is the wall's own sample, moved
  // `gap` metres towards the track along that sample's normal, so the stack stands on the run-off in front of the wall.
  for (const [from, to, side, gap] of T.layout.tyreWall || []) {
    const sd = side === 'L' ? 0 : 1, a = T.sAtPointRaw(from), span = ((T.sAtPointRaw(to) - a) % T.length + T.length) % T.length;
    const inSpan = i => ((T.s[i] - a) % T.length + T.length) % T.length <= span;
    // one stack along the whole span, across the pit wall's pieces (the entry road's wall and the pit lane's own), so it has no
    // end where one piece of the wall meets the next
    const along = p => ((T.s[p[3]] - a) % T.length + T.length) % T.length;
    const all = [];
    for (const b of T.barriers) if (b.type === BARRIER.PITWALL && b.side === sd) for (const p of b.pts) if (inSpan(p[3])) all.push(p);
    all.sort((p, q) => along(p) - along(q));
    const pts = [];
    for (const p of all) {
      const i = p[3];
      if (pts.length && pts[pts.length - 1][3] === i) continue;   // the two pieces meet on one sample
      const d = (p[0] - T.x[i]) * T.nx[i] + (p[2] - T.z[i]) * T.nz[i];
      pts.push(P(i, d + gap * (sd ? -1 : 1)));
    }
    add(BARRIER.TYRES, sd, pts, { impact: true, why: 'tyre barriers in front of the pit wall where the exit run-off is (layout.tyreWall)' });
  }
  for (const run of runsOf(N, i => T.pitSepWall[i])) {
    follow(BARRIER.PITSEP, 0, run, i => -(T.pitIn[i] - EXIT_SEP_WALL), 2, { why: 'low wall between the pit exit road and the track' });
  }

  // smooth the tyre wall lines a little: offsets that change pace (a slope limit starting, an inside cap easing in)
  // leave 10 to 20 degree corners between neighbouring points. A few relaxation passes, ends fixed, round them off
  // without moving the line more than a few centimetres where it was already smooth.
  for (const b of T.barriers) {
    if (b.type !== BARRIER.ARMCO || b.pts.length < 5) continue;
    const P = b.pts;
    for (let pass = 0; pass < 6; pass++) {
      const nx = P.map(p => p[0]), nz = P.map(p => p[2]);
      for (let k = 3; k < P.length - 3; k++) { nx[k] = (P[k - 1][0] + 2 * P[k][0] + P[k + 1][0]) / 4; nz[k] = (P[k - 1][2] + 2 * P[k][2] + P[k + 1][2]) / 4; }
      for (let k = 3; k < P.length - 3; k++) { P[k][0] = nx[k]; P[k][2] = nz[k]; }   // three points held at each end, where it meets the next piece
    }
    for (const p of P) p[1] = T.groundAt(p[0], p[2], p[3]);
  }

  joinBarriers(T);

  // collision segments, each with a face normal pointing back towards the track
  T.segs = [];
  for (const b of T.barriers) {
    const faces = [{ pts: b.pts, towards: 1 }];
    if (b.type === BARRIER.PITWALL || b.type === BARRIER.PITSEP) {
      // the pit side of the pit wall (and of the exit road's low wall) is its own face, facing the pit lane
      const w = b.type === BARRIER.PITWALL ? PIT_WALL : EXIT_SEP_WALL;
      faces.push({ pts: b.pts.map(([x, y, z, i], k) => b.pitFace ? [x + b.pitFace[k][0], y, z + b.pitFace[k][1], i] : [x - T.nx[i] * w, y, z - T.nz[i] * w, i]), towards: -1 });
    }
    for (const f of faces) {
      for (let k = 0; k < f.pts.length - 1; k++) {
        const [ax, ay, az, i] = f.pts[k], [bx, , bz] = f.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) continue;
        let nx = -(bz - az) / len, nz = (bx - ax) / len;
        // face the track this barrier was laid out from (or the pit lane, for the pit side of the pit wall)
        const g = b.side ? 1 : -1, inx = -g * T.nx[i], inz = -g * T.nz[i];
        if (Math.abs(nx * inx + nz * inz) < 0.3 && f.towards > 0) {
          // a step square to the track faces the open side: the side where the wall is further out
          const da = Math.abs((ax - T.x[i]) * T.nx[i] + (az - T.z[i]) * T.nz[i]), db = Math.abs((bx - T.x[i]) * T.nx[i] + (bz - T.z[i]) * T.nz[i]);
          const face = db > da ? 1 : -1;
          nx = face * T.tx[i]; nz = face * T.tz[i];
        } else if ((nx * inx + nz * inz) * f.towards < 0) { nx = -nx; nz = -nz; }
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
// Where two barrier lines meet on the same side, the ends must touch. A lower-priority line (the containment wall, the low
// walls of the pit lane) takes the higher one's end: it gains a point at the partner's sample and the partner's offset, and its
// last JOIN_BLEND metres ease sideways onto that offset, so there is no hole and no sideways step at the join. The structures
// (bridge parapet and its end stacks, street walls, the pit wall) never move. Pit tyre stacks stand in front of the pit wall
// on purpose and take no part.
const JOIN_BLEND = 12;  // metres over which a barrier line eases onto the offset of the line it joins (a gentle slope, no kink)
function joinBarriers(T) {
  const L = T.length, N = T.N;
  const prio = b => b.type === BARRIER.PARAPET ? 5 : b.type === BARRIER.TYRES ? (b.bridgeEnd ? 5 : 0)
    : b.type === BARRIER.CONCRETE || b.type === BARRIER.PITWALL ? 4 : b.type === BARRIER.PITSEP || b.type === BARRIER.PITOUTER ? 2
    : b.type === BARRIER.ARMCO ? 1 : 0;
  const lat = p => (p[0] - T.x[p[3]]) * T.nx[p[3]] + (p[2] - T.z[p[3]]) * T.nz[p[3]];
  const ds = (i, j) => { const d = ((T.s[i] - T.s[j]) % L + L) % L; return d > L / 2 ? d - L : d; };
  const ends = [];
  for (const b of T.barriers) if (prio(b) > 0 && b.pts.length > 1) ends.push({ b, k: 0, p: b.pts[0] }, { b, k: b.pts.length - 1, p: b.pts[b.pts.length - 1] });
  const moves = [];
  for (const E of ends) {
    const pE = E.p, dir = E.k === 0 ? -1 : 1;
    let best = null;
    for (const F of ends) {
      if (F.b === E.b || F.b.side !== E.b.side || prio(F.b) <= prio(E.b)) continue;
      const pF = F.b.pts[F.k], sd = ds(pF[3], pE[3]);
      if (Math.abs(sd) > 3 || sd * dir < 0) continue;     // the partner's end lies beyond this end, within 3 m
      const gap = Math.hypot(pF[0] - pE[0], pF[2] - pE[2]);
      if (gap <= 0.05 || gap > 1.5) continue;
      if (!best || prio(F.b) > prio(best.b) || (prio(F.b) === prio(best.b) && Math.abs(sd) < Math.abs(best.sd))) best = { b: F.b, p: pF, sd };
    }
    if (best) moves.push({ E, best });
  }
  // lines the 4 m rule holds back from the track edge: they cannot ease in past it, so the two lines meet at that offset instead
  const EDGE_RULE = new Set([BARRIER.ARMCO, BARRIER.TYRES, BARRIER.PITOUTER]);
  // the blend moves points sideways; a line held to the 4 m rule is never eased in past it, point by point
  const shift = (b, pE, delta, held) => {
    for (const p of b.pts) {
      const dist = Math.abs(ds(p[3], pE[3]));
      if (dist > JOIN_BLEND || !delta) continue;
      const f = 1 - dist / JOIN_BLEND, w = f * f * (3 - 2 * f), i = p[3];
      let d = lat(p) + delta * w;
      if (held) { const edge = T.hw[i] + T.kerb[b.side][i] + T.sausage[b.side][i] + MIN_EDGE + 0.02; if (Math.abs(d) < edge) d = Math.sign(d || -1) * edge; }
      p[0] = T.x[i] + T.nx[i] * d; p[2] = T.z[i] + T.nz[i] * d; p[1] = T.groundAt(p[0], p[2], i);
    }
  };
  for (const { E, best } of moves) {
    // the end is held by its point, not its index: an earlier join may have added a point at the other end of the same line
    const b = E.b, pE = E.p, dir = E.k === 0 ? -1 : 1, iF = best.p[3], g = b.side ? 1 : -1, at = b.pts.indexOf(pE);
    let dT = lat(best.p);
    if (EDGE_RULE.has(b.type)) {
      const edge = T.hw[iF] + T.kerb[b.side][iF] + T.sausage[b.side][iF] + MIN_EDGE + 0.02;
      dT = g * Math.max(Math.abs(dT), edge);
    }
    const dE = lat(pE), best_p = best.p, partnerD = lat(best_p);
    // the lines near the end ease onto the meeting offset, and so does the partner's end
    shift(b, pE, dT - dE, EDGE_RULE.has(b.type));
    shift(best.b, best_p, dT - partnerD, false);
    const sd = best.sd;
    if (sd !== 0) {
      const q = [T.x[iF] + T.nx[iF] * dT, 0, T.z[iF] + T.nz[iF] * dT, iF];
      q[1] = T.groundAt(q[0], q[2], iF);
      // the end point gives way to the joint when the piece's next point is within 3 m of it (a short last piece would kink); else it is added
      const near = dir > 0 ? b.pts[at - 1] : b.pts[at + 1];
      if (near && Math.abs(ds(iF, near[3])) <= 3) b.pts[at] = q;
      else if (dir > 0) { b.pts.push(q); if (b.hs) b.hs.push(0); }
      else { b.pts.unshift(q); if (b.hs) b.hs.unshift(0); }
    } else { pE[0] = T.x[pE[3]] + T.nx[pE[3]] * dT; pE[2] = T.z[pE[3]] + T.nz[pE[3]] * dT; pE[1] = T.groundAt(pE[0], pE[2], pE[3]); }
  }
}

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
      if (!best || -dn > best.pen) best = { pen: -dn, nx: sg.nx, nz: sg.nz, type: sg.type };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Trackside furniture: distance boards and signs, placed by the rules in
// reference/LAKESIDE_SAFETY_LAYOUT.md 3.6.

export const BOARD_SETS = [[150, [300, 200, 100]], [80, [200, 100]], [30, [100]]];

function buildFurniture(T, corners) {
  const { N } = T, HW = T.hw;
  T.furniture = [];
  const wl = wallLines(T);
  T.wallIn = wl.inner; T.wallOut = wl.outer;
  const place = (type, value, i, d, extra = {}) => {
    const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    return { type, value, i, s: T.s[i], d, x, z, y: T.groundAt(x, z, i), ...extra };
  };
  // bollards between the pit exit road and the track: on the low wall while alongside, then down the
  // middle of the hatched merge while it is still wider than a car's wheel track, every 5 m
  if (T.pitRange) {
    const [a, b] = T.pitRange, len = ((b - a) % T.length + T.length) % T.length;
    for (let u = len / 2, last = -1e9; u <= len; u += T.ds) {
      const i = wrap(Math.round((a + u) / T.ds), N), gap = T.pitIn[i] - HW[i];
      if (T.pitWall[i] || u - last < 5) continue;
      if (T.pitSepWall[i] && T.pitSep[i]) { T.furniture.push(place('bollard', 0, i, -(T.pitIn[i] - EXIT_SEP_WALL / 2), { pit: true, raise: 0.55 })); last = u; }   // on top of the low wall
      else if (T.pitIsland[i] && gap >= 1.2) { T.furniture.push(place('bollard', 0, i, -(HW[i] + gap / 2), { pit: true })); last = u; }
    }
  }
  // bollards on the inside kerb at the apex of the esses and chicanes, every 6 m for 24 m
  for (const c of corners) {
    if (!BOLLARD_CORNERS.includes(c.name)) continue;
    const sd = c.inside === 'L' ? 0 : 1, g = sd ? 1 : -1;
    for (let k = -12; k <= 12; k += 6) {
      const i = wrap(Math.round((c.apexS + k) / T.ds), N);
      T.furniture.push(place('bollard', 0, i, g * (HW[i] + T.kerb[sd][i] + T.sausage[sd][i] + 0.25), { corner: c.name }));
    }
  }
  const SPACED = ['board', 'post', 'panel'];   // these keep 30 m apart; signs only need 6 m
  const nearOther = (x, z, r, types) => T.furniture.some(f => (!types || types.includes(f.type)) && (f.x - x) ** 2 + (f.z - z) ** 2 < r * r);

  // pit lane speed signs: at the start of the limiter, then every 100 m, on the pit wall
  const lim = runsOf(N, i => T.pitLimiter[i])[0] || [];
  for (let k = 0; k < lim.length; k += 100) {
    const i = lim[k];
    T.furniture.push(place('sign', T.layout.pit.speedLimit, i, -(T.pitIn[i] - PIT_WALL / 2), { faces: 'pit' }));
  }

  // distance boards: the biggest set that fits, counting down to where braking ends. Each board stands at the barrier
  // (BOARD_BEHIND outside its face), so the driver reads it against the wall, never out on the apron.
  for (const c of corners) {
    if (!c.brakeDistance) continue;
    const sd = c.outside === 'L' ? 0 : 1;
    const entry = BOARD_SETS.find(([min]) => c.brakeDistance > min);
    if (!entry) continue;
    const options = [entry[1], ...BOARD_SETS.map(e => e[1]).filter(set => set.length < entry[1].length)];
    for (const set of options) {
      const boards = [];
      let ok = true;
      for (const n of set) {
        const i = wrap(Math.round((c.brakeEnd - n) / T.ds), N);
        const d = boardOffset(T, i, sd);
        if (d === null) { ok = false; break; }
        const b = place('board', n, i, d, { corner: c.name });
        const inPit = sd === 0 && T.pitOut[i] > 0;   // (a board behind the barrier is clear of the gravel, which the barrier stops cars short of)
        if (T.isBridge[i] || inPit || T.street[sd][i] ||
            nearOther(b.x, b.z, 30, SPACED) || nearOther(b.x, b.z, 6) || boards.some(o => (o.x - b.x) ** 2 + (o.z - b.z) ** 2 < 900)) { ok = false; break; }
        boards.push(b);
      }
      if (ok) { T.furniture.push(...boards); break; }
    }
  }

  // bare stretches: where a side has no trackside furniture for more than FILL_GAP metres, a cluster goes in at the
  // middle of the gap, just behind the outer barrier line, and the gap is re-checked until none is left
  const kinds = ['marshal', 'tyres', 'cabinet', 'banner', 'tyres', 'mast'];
  let clusters = 0;
  for (const sd of [0, 1]) {
    const skipped = new Set();
    for (let guard = 0; guard < 200; guard++) {
      const ss = T.furniture.filter(f => (f.d < 0 ? 0 : 1) === sd).map(f => f.s).sort((a, b) => a - b);
      let worst = null;
      for (let k = 0; k < ss.length; k++) {
        const next = k + 1 < ss.length ? ss[k + 1] : ss[0] + T.length, len = next - ss[k];
        if (len > FILL_GAP && !skipped.has(Math.round(ss[k])) && (!worst || len > worst.len)) worst = { from: ss[k], len };
      }
      if (!worst) break;
      const mid = worst.from + worst.len / 2;
      const centre = wrap(Math.round(mid / T.ds), N);
      let placed = false;
      const reach = Math.floor(worst.len / 2 / T.ds);   // try the middle of the gap first, then each side of it in turn
      const offs = [0];
      for (let k = 6; k <= reach; k += 6) offs.push(k, -k);
      for (const off of offs) {
        const i0 = wrap(centre + off, N);
        const spots = [0, 7, 14].map(k => wrap(i0 + k, N));   // three objects, a few metres apart, so it does not read as a fence
        if (!spots.every(i => clusterSpot(T, i, sd, wl))) continue;
        const cluster = spots.map((i, k) => place(kinds[(clusters * 3 + k) % kinds.length], 0, i, (sd ? 1 : -1) * (wl.outer[sd][i] + CLUSTER_BEHIND), { fill: true }));
        if (cluster.some(f => nearOther(f.x, f.z, 6))) continue;
        T.furniture.push(...cluster);
        clusters++;
        placed = true;
        break;
      }
      if (!placed) skipped.add(Math.round(worst.from));
    }
  }
  T.fillClusters = clusters;
}

// The barrier line on each side at every sample: the nearest barrier point on that side (inner) and the furthest within a
// few samples (outer), measured out from the track centre line. Boards and trackside objects are placed against these.
function wallLines(T) {
  const N = T.N;
  const inner = [0, 1].map(() => new Float64Array(N).fill(Infinity)), outer = [0, 1].map(() => new Float64Array(N).fill(-Infinity));
  for (const b of T.barriers) {
    const g = b.side ? 1 : -1;
    for (const p of b.pts) {
      for (let k = -3; k <= 3; k++) {
        const i = wrap(p[3] + k, N);
        const a = ((p[0] - T.x[i]) * T.nx[i] + (p[2] - T.z[i]) * T.nz[i]) * g;
        if (a <= 0) continue;
        inner[b.side][i] = Math.min(inner[b.side][i], a);
        outer[b.side][i] = Math.max(outer[b.side][i], a);
      }
    }
  }
  return { inner, outer };
}

// the signed offset (d) of a distance board on side sd at sample i: BOARD_BEHIND outside the barrier face, or null if
// there is no barrier there (so the board is not placed at all)
export function boardOffset(T, i, sd) {
  const a = T.wallIn[sd][i];
  // where the barrier is far out (wide run-off corners) the board stands just past the paved apron instead, so a driver can still read it
  return Number.isFinite(a) ? (sd ? 1 : -1) * Math.min(a + BOARD_BEHIND, HW_OF(T, i, sd) + BOARD_BEYOND_APRON) : null;
}

// the paved width on a side at sample i, from the centre line: track half width, kerbs and the run-off
const HW_OF = (T, i, sd) => T.hw[i] + T.kerb[sd][i] + T.sausage[sd][i] + T.runoff[sd][i];

// samples where a fill object may stand: outside the barrier line, off the bridge, and (on the pit side only) off the pit road
function clusterSpot(T, i, sd, wl) {
  if (!Number.isFinite(wl.outer[sd][i]) || T.isBridge[i]) return false;
  if (wl.outer[sd][i] + CLUSTER_BEHIND < HW_OF(T, i, sd) + 0.5) return false;   // never on the paved apron
  if (sd === 0 && (T.pitOut[i] || T.pitEntryZone[i])) return false;
  if (sd === 0 && T.pitRange) {
    const [a, b] = T.pitRange, rel = ((T.s[i] - a) % T.length + T.length) % T.length, span = ((b - a) % T.length + T.length) % T.length;
    if (rel <= span + 40 || rel >= T.length - 40) return false;   // the pit road and 40 m either side of it
  }
  for (let k = -40; k <= 40; k += 4) if (T.isBridge[wrap(i + k, T.N)]) return false;   // and the bridge approach
  return true;
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
