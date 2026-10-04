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

export const SURF = {
  TARMAC: 0,
  PAINT: 1,      // white edge lines
  KERB: 2,       // flat rumble strip
  SAUSAGE: 3,    // raised kerb, unsettles the car
  RUNOFF: 4,     // tarmac run-off, no penalty
  GRASS: 5,
  GRAVEL: 6,
};

const DS = 1;            // sample spacing, metres
const KERB_WIDTH = 1.1;  // metres
const LINE_WIDTH = 0.25; // painted edge line, metres
const MAX_RUNOFF = 24;   // default distance from track edge to the barrier, metres
const BRIDGE_RUNOFF = 1.2;

export function buildTrack(layout = LAYOUT) {
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
  track.pit = layout.pit.map(toWorld);

  // 6. What is either side of the tarmac: kerbs, run-off type, barriers.
  buildSides(track);

  track.locate = (px, pz, hint, out) => locate(track, px, pz, hint, out);
  track.surfaceAt = (i, d) => surfaceAt(track, i, d);
  track.inDRS = sv => track.drs.some(([a, b]) => inRange(sv, a, b, track.length));
  track.onBridge = sv => inRange(sv, track.bridge[0], track.bridge[1], track.length);
  track.findNearest = (px, pz, py) => findNearest(track, px, pz, py);
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
  if (a <= hw + T.kerb[side][i]) return T.kerbType[side][i];
  return T.outer[side][i];
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

function buildSides(T) {
  const { N } = T;
  T.kerb = [new Float64Array(N), new Float64Array(N)];
  T.kerbType = [new Uint8Array(N).fill(SURF.KERB), new Uint8Array(N).fill(SURF.KERB)];
  T.outer = [new Uint8Array(N).fill(SURF.GRASS), new Uint8Array(N).fill(SURF.GRASS)];
  T.wall = [new Float64Array(N), new Float64Array(N)];
  T.isBridge = new Uint8Array(N);
  for (let i = 0; i < N; i++) T.isBridge[i] = inRange(T.s[i], T.bridge[0], T.bridge[1], T.length) ? 1 : 0;

  // Kerbs: inside of any real corner, and the outside of tighter ones.
  const want = [new Uint8Array(N), new Uint8Array(N)];
  for (let i = 0; i < N; i++) {
    const k = T.curv[i], inside = k > 0 ? 1 : 0;
    if (Math.abs(k) > 1 / 220) want[inside][i] = 1;
    if (Math.abs(k) > 1 / 110) want[1 - inside][i] = 1;
  }
  for (let side = 0; side < 2; side++) {
    const grown = dilate(want[side], 14);
    dropShortRuns(grown, 14);
    for (let i = 0; i < N; i++) if (grown[i] && !T.isBridge[i]) T.kerb[side][i] = KERB_WIDTH;
  }

  // Barriers: a fixed distance out, but pulled in where two parts of the
  // track run close together so the run-off never overlaps.
  buildGrid(T);
  const hw = T.halfWidth;
  for (let side = 0; side < 2; side++) {
    const sg = side ? 1 : -1, w = T.wall[side];
    for (let i = 0; i < N; i++) {
      if (T.isBridge[i]) { w[i] = hw + BRIDGE_RUNOFF; continue; }
      let lim = hw + MAX_RUNOFF;
      if (i % 2 === 0) {
        for (let d = hw + 1; d <= hw + MAX_RUNOFF; d += 1.5) {
          const qx = T.x[i] + T.nx[i] * d * sg, qz = T.z[i] + T.nz[i] * d * sg;
          if (otherSectionCloser(T, i, qx, qz, d)) { lim = Math.max(hw + 2, d - 1.5); break; }
        }
      } else lim = w[i - 1];
      w[i] = lim;
    }
    // smooth: take the tightest nearby value, then round off the steps
    const tight = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let m = Infinity;
      for (let k = -8; k <= 8; k++) m = Math.min(m, w[wrap(i + k, N)]);
      tight[i] = m;
    }
    for (let i = 0; i < N; i++) w[i] = T.isBridge[i] ? w[i] : tight[i];
    boxSmooth(w, 6);
  }
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
