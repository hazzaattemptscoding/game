// Grandstands with a crowd.
//
// planStands() picks the places (pure numbers, no meshes, so tools/venue.js can check them in node): behind the
// containment wall with a clear gap, never on the track, run-off or pit lane, never on a building or another stand.
// buildGrandstands() draws them: a solid concrete body with stepped, seat-textured tiers, a front hoarding, a roof on
// columns, a spectator fence behind the barrier line, and the crowd as one InstancedMesh per stand (src/crowd.js).

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit, metreUV, sponsorPanel, sponsorRow, trackPoint, hash01 } from './meshKit.js';
import { entryRoadAt } from './track.js';
import { lampMaterial, flagMaterial, addFlag } from './lamps.js';
import { crowdMesh } from './crowd.js';
import { vehicleBlockers } from './vehicleBays.js';

export const GAP = 11;          // metres from the containment wall to the front of a stand
export const FENCE_AT = 4.5;    // the spectator fence stands this far behind the wall
const ROW = 0.85, RISE = 0.4;   // tier depth and height
const FIRST = 0.9;              // height of the first tread above the platform (the front hoarding stands here)
const SEAT = 0.55;              // seat spacing along a row

// Where stands are wanted. `s` is the preferred place along the lap and `range` how far the search may drift from it.
// kind: 'main' (covered, concrete), 'terrace' (open concrete terrace, a standing crowd), 'scaffold' (temporary steel scaffold stand with a
// banner screen behind it), 'hospitality' (two storey building with a balcony; `depth` is its footprint depth). Fifteen in all.
export const SITES = [
  { name: 'Main Grandstand', kind: 'main', s: 80, range: 60, sides: [1], len: 110, rows: 14, roof: true },
  { name: 'Scramble Stand', kind: 'main', s: 380, range: 110, sides: [1], len: 70, rows: 10, roof: true },
  { name: 'Windsock Stand', kind: 'main', s: 930, range: 90, sides: [0], len: 64, rows: 10, roof: true },
  { name: 'Street Stand', kind: 'main', s: 1300, range: 130, sides: [0, 1], len: 56, rows: 9, roof: true },
  { name: 'Chicane Stand', kind: 'main', s: 3470, range: 110, sides: [0, 1], len: 56, rows: 9, roof: true },
  { name: 'Paddock Club', kind: 'hospitality', s: 215, range: 70, sides: [1], len: 40, rows: 4, depth: 20, roof: false },
  { name: 'Start Club', kind: 'hospitality', s: 3700, range: 80, sides: [1], len: 34, rows: 4, depth: 20, roof: false },
  { name: 'North Terrace', kind: 'terrace', s: 620, range: 120, sides: [0, 1], len: 60, rows: 12, roof: false },
  { name: 'Hairpin Terrace', kind: 'terrace', s: 2230, range: 120, sides: [0, 1], len: 56, rows: 11, roof: false },
  { name: 'Lakeside Scaffold', kind: 'scaffold', s: 2760, range: 150, sides: [0, 1], len: 40, rows: 8, roof: false },
  { name: 'Esses Scaffold', kind: 'scaffold', s: 3200, range: 150, sides: [0, 1], len: 40, rows: 8, roof: false },
  { name: 'Bridge Viewing', kind: 'terrace', s: 1690, range: 140, sides: [0, 1], len: 40, rows: 8, roof: false },
  // the left of Scramble and Hurricane Sweep, and the run to Windsock Hairpin: a long covered stand, an open terrace and a small hairpin stand
  { name: 'Hurricane Grandstand', kind: 'main', s: 590, range: 80, sides: [0], len: 96, rows: 13, roof: true },
  { name: 'Approach Terrace', kind: 'terrace', s: 770, range: 60, sides: [0], len: 56, rows: 10, roof: false },
  { name: 'Hairpin Stand', kind: 'main', s: 1010, range: 50, sides: [0], len: 34, rows: 8, roof: true },
];

export const standDepth = (site, rows = site.rows) => site.depth || rows * ROW + 3;

const wrapN = (i, n) => ((i % n) + n) % n;

// distance from point to segment
function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

// Everything a stand must keep clear of that is not a barrier line: the pit garages, the bridge, the furniture.
export function trackBlockers(T) {
  const out = [];
  for (let i = 0; i < T.N; i += 8) {
    if (T.pitGarage[i] > 0) out.push({ x: T.x[i] - T.nx[i] * (T.pitOut[i] + 9), z: T.z[i] - T.nz[i] * (T.pitOut[i] + 9), r: 14, name: 'pit garages' });
    if (T.isBridge[i]) out.push({ x: T.x[i], z: T.z[i], r: Math.max(T.wall[0][i], T.wall[1][i]) + 3, name: 'bridge' });
  }
  // the fill objects (track.js FILL_GAP) stand 1.5 m behind a barrier and reach no more than 3.5 m behind it, clear of a stand's
  // walkway (5 m behind the wall at the nearest): a negative radius, so the 4 m margin the checks add leaves 3 m round the spot
  for (const f of T.furniture || []) out.push({ x: f.x, z: f.z, r: f.fill ? -1 : 3, name: 'board' });
  return out;
}

// the frame of a stand: origin on the front edge at the middle, ex along the stand, ez away from the track
export function frame(T, s, side, len) {
  const c = trackPoint(T, s, 0);
  const ex = side ? [c.tx, c.tz] : [-c.tx, -c.tz], ez = [-ex[1], ex[0]];
  let F = 0;
  const half = Math.ceil(len / 2 + 8);
  for (let k = -half; k <= half; k++) {
    const j = wrapN(c.i + k, T.N), sg = side ? 1 : -1, wd = T.wall[side][j];
    const wx = T.x[j] + T.nx[j] * sg * wd - c.x, wz = T.z[j] + T.nz[j] * sg * wd - c.z;
    if (Math.abs(wx * ex[0] + wz * ex[1]) > len / 2 + 4) continue;
    F = Math.max(F, wx * ez[0] + wz * ez[1]);
  }
  F += GAP;
  return { c, ex, ez, F, x: c.x + ez[0] * F, z: c.z + ez[1] * F, yaw: Math.atan2(-ex[1], ex[0]) };
}

// the world position of local (a along, b out) in a stand frame
const local = (f, a, b) => [f.x + f.ex[0] * a + f.ez[0] * b, f.z + f.ex[1] * a + f.ez[1] * b];

// Signed distance from a point to the nearest containment wall (or the pit lane's outer edge) of any part of the circuit:
// positive behind the wall, negative between the wall and the track.
export function wallClearance(T, x, z, ignoreBridge = false) {
  let nearest = -1, nq = Infinity, best = Infinity;
  for (let j = 0; j < T.N; j++) {
    if (ignoreBridge && T.isBridge[j]) continue;
    const dx = x - T.x[j], dz = z - T.z[j], q = dx * dx + dz * dz;
    if (q < nq) { nq = q; nearest = j; }
    if (q > 200 * 200) continue;
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd ? 1 : -1, w = Math.max(T.wall[sd][j], sd === 0 && T.pitOut[j] ? T.pitOut[j] + 2 : 0);
      const wx = dx - T.nx[j] * sg * w, wz = dz - T.nz[j] * sg * w, d = wx * wx + wz * wz;
      if (d < best) best = d;
    }
  }
  const j = nearest, dx = x - T.x[j], dz = z - T.z[j], lat = dx * T.nx[j] + dz * T.nz[j], sd = lat < 0 ? 0 : 1;
  const w = Math.max(T.wall[sd][j], sd === 0 && T.pitOut[j] ? T.pitOut[j] + 2 : 0);
  return Math.abs(lat) < w ? -Math.sqrt(best) : Math.sqrt(best);
}

export function checkStand(T, ground, blockers, others, f, side, len, depth) {
  const pts = [];
  for (let a = -len / 2 - 2; a <= len / 2 + 2 + 1e-6; a += 2) for (let b = -6; b <= depth + 3 + 1e-6; b += 2) pts.push([a, b, ...local(f, a, b)]);   // as fine as the venue check (tools/venue.js), so a place that passes here passes there
  // clearance round the whole footprint, including the walkway in front of the stand
  for (const [, b, x, z] of pts) if (wallClearance(T, x, z) < (b < 0 ? 4 : 8)) return 'too close to the circuit';
  // the structure itself stays 6 m from every barrier line
  for (const [, b, x, z] of pts) {
    if (b < 0) continue;
    for (const sg of T.segs) if (segDist(x, z, sg) < 6) return 'too close to a barrier';
  }
  for (const bl of blockers) for (const [, , x, z] of pts) if (Math.hypot(x - bl.x, z - bl.z) < bl.r + 4) return 'overlaps ' + bl.name;
  for (const o of others) for (const [, , x, z] of pts) {
    const ax = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], bz = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
    if (Math.abs(ax) < o.len / 2 + 10 && bz > -8 && bz < o.depth + 10) return 'overlaps ' + o.name;
  }
  let lo = Infinity, hi = -Infinity;
  for (const [a, b, x, z] of pts) if (b >= 0 && b <= depth && Math.abs(a) <= len / 2) { const y = ground.meshHeight(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  if (hi - lo > 3.6) return 'ground too steep';
  return null;
}

// Choose the places. Returns [{ name, s, side, len, rows, roof, x, z, ex, ez, yaw, F, depth, y0, low }], and `why` for sites that failed.
export function planStands(T, ground, blockers0, sites = SITES) {
  const placed = [], why = [], blockers = [...blockers0, ...vehicleBlockers(T)];   // and the ground kept for the service vehicles
  for (const site of sites) {
    let best = null;
    const reason = {};
    search:
    for (const scale of [1, 0.85, 0.7, 0.55]) {
      const len = Math.round(site.len * scale / 2) * 2, rows = Math.max(site.kind === 'hospitality' ? 4 : 6, Math.round(site.rows * (scale >= 0.7 ? 1 : 0.8)));
      for (let off = 0; off <= site.range; off += 5) for (const sgn of off ? [1, -1] : [1]) for (const side of site.sides) {
        const s = site.s + sgn * off, f = frame(T, s, side, len);
        const bad = checkStand(T, ground, blockers, placed, f, side, len, standDepth(site, rows));
        if (bad) { reason[bad] = (reason[bad] || 0) + 1; continue; }
        const depth = standDepth(site, rows);
        let lo = Infinity, hi = -Infinity;
        for (let a = -len / 2; a <= len / 2; a += 4) for (let b = 0; b <= depth; b += 3) { const [x, z] = local(f, a, b), y = ground.meshHeight(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        best = { name: site.name, kind: site.kind || 'main', s, side, len, rows, roof: site.roof, x: f.x, z: f.z, ex: f.ex, ez: f.ez, yaw: f.yaw, F: f.F, depth, y0: hi + 0.15, low: lo };
        break search;
      }
    }
    if (best) placed.push(best); else why.push({ name: site.name, reason });
  }
  return { stands: placed, why };
}

// ---------------------------------------------------------------------------

const PALETTE = [0xc8102e, 0xf2f2ee, 0x1d4e9e, 0xffd21f, 0x0e7c86, 0xff6a13, 0x2f3136, 0x3f9d4f, 0xd4145a, 0x8a5cd6];

// Draws one stand into `kit` (the stand's own frame: x along the front, y up from the platform, z away from the track) and
// returns the places for its crowd: [x, tread y, z, colour, random, standing].
function buildStand(T, ground, st, kit) {
  const { len, rows } = st;
  const Zb = rows * ROW, top = FIRST + rows * RISE, x0 = -len / 2, x1 = len / 2;
  const low = st.low - 0.7 - st.y0;   // lowest point of the plinth, in the stand's own frame (the platform is y = 0)
  const tread = r => FIRST + r * RISE;   // local y of the tread of row r (y0 is the platform)
  const spots = [];
  const seed = Math.round(st.s * 13 + st.side * 7);
  const standingShare = st.kind === 'terrace' ? 0.5 : 0.1;

  if (st.kind === 'hospitality') { hospitality(kit, st, low, spots); return spots; }

  const scaffold = st.kind === 'scaffold';
  const aisle = [];
  for (let k = 0; ; k++) { const x = x0 + 6 + k * 12; if (x > x1 - 3) break; aisle.push(x); }
  if (!scaffold) {
    // solid body, from below the lowest ground up to the platform
    kit.box('concrete', len + 1, -low, Zb + 3, 0, low / 2, (Zb + 3) / 2 - 0.5, 0, 4);
  }
  // tiers
  for (let r = 0; r < rows; r++) {
    const z0 = r * ROW, y = tread(r) + 0.003;
    kit.quad('seat', [x0, y, z0], [x1, y, z0], [x1, y, z0 + ROW], [x0, y, z0 + ROW], [[0, 0], [len / (SEAT * 8), 0], [len / (SEAT * 8), 1], [0, 1]]);
    const yr = tread(r) - RISE;
    if (scaffold) kit.box('scaff', len, 0.1, ROW, 0, tread(r) - 0.07, z0 + ROW / 2);
    else kit.quad('concrete', [x1, yr, z0], [x0, yr, z0], [x0, y, z0], [x1, y, z0], [[0, 0], [len / 3, 0], [len / 3, RISE / 3], [0, RISE / 3]]);
    for (const ax of aisle) {
      const y2 = y + 0.012;
      kit.quad('aisle', [ax - 0.55, y2, z0], [ax + 0.55, y2, z0], [ax + 0.55, y2, z0 + ROW], [ax - 0.55, y2, z0 + ROW], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  // the first riser is the front wall: from the platform up, carrying a sponsor board per 6 m
  for (let a = x0, k = 0; a < x1 - 1e-6; a += 6, k++) {
    const b = Math.min(x1, a + 6), row = tex.MODERN_SPONSORS[(k + Math.round(st.s)) % tex.MODERN_SPONSORS.length];
    sponsorPanel(kit, 'sponsor', hash01(k, Math.round(st.s)) < 0.25 ? 0 : row, a, -0.02, b, -0.02, -0.0, FIRST - 0.05, -1);
  }
  kit.quad('concrete', [x1, 0.0, -0.02], [x0, 0.0, -0.02], [x0, FIRST, -0.02], [x1, FIRST, -0.02], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  kit.box('white', len + 0.2, 0.08, 0.3, 0, FIRST + 0.02, -0.1);

  if (scaffold) {
    // temporary stand: steel scaffold frame under the tiers, rake beams, cross bracing, a banner screen behind
    const bay = 3.0, n = Math.max(2, Math.round(len / bay)), step = len / n, rake = Math.atan2(top - FIRST, Zb);
    const pole = (x, z, yTop) => kit.box('scaff', 0.1, yTop - low, 0.1, x, (yTop + low) / 2, z);
    for (let k = 0; k <= n; k++) {
      const x = x0 + k * step;
      for (const f of [0, 0.34, 0.67, 1]) pole(x, f * Zb, tread(Math.round(f * (rows - 1))) - 0.1);
      kit.box('scaff', 0.09, 0.09, Math.hypot(Zb, top - FIRST), x, (FIRST + top) / 2 - 0.15, Zb / 2, 0, 0, -rake);   // the rake beam under the tiers
      if (k < n) {
        const xm = x + step / 2;
        for (const [zf, ya, yb] of [[0, low + 0.3, tread(0) - 0.4], [Zb * 0.5, low + 0.3, tread(Math.round(rows / 2)) - 0.4]]) {
          const dy = yb - ya, L = Math.hypot(step, dy);
          kit.box('scaff', L, 0.07, 0.07, xm, (ya + yb) / 2, zf, 0, 0, 0, Math.atan2(dy, step));   // diagonal brace in the frame
        }
        for (const zf of [0.34, 0.67]) kit.box('scaff', step, 0.07, 0.07, xm, tread(Math.round(zf * (rows - 1))) - 0.5, zf * Zb);   // ledgers
      }
    }
    // back screen: a printed banner on the back poles, and a guard rail along the back of the top tier
    for (let a = x0, k = 0; a < x1 - 1e-6; a += 8, k++) {
      const b = Math.min(x1, a + 8);
      sponsorPanel(kit, 'sponsor', tex.MODERN_SPONSORS[(k * 2 + Math.round(st.s)) % tex.MODERN_SPONSORS.length], a, Zb + 0.15, b, Zb + 0.15, top - 0.6, top + 2.6, 1);
    }
    kit.box('scaff', len, 0.06, 0.06, 0, top + 1.0, Zb);
    for (let x = x0; x <= x1 + 0.01; x += 2.4) kit.box('scaff', 0.06, 1.1, 0.06, x, top + 0.5, Zb);
  } else {
    // back wall and its top
    kit.box('concrete', len + 1, top + 1.2 - low, 0.5, 0, (top + 1.2 + low) / 2, Zb + 0.3, 0, 4);
    // side walls, stepped to follow the tiers
    const side = new THREE.Shape();
    side.moveTo(-0.5, low); side.lineTo(Zb + 0.55, low); side.lineTo(Zb + 0.55, top + 1.2);
    for (let r = rows - 1; r >= 0; r--) { side.lineTo(r * ROW + ROW, tread(r) + 0.5); side.lineTo(r * ROW, tread(r) + 0.5); }
    side.lineTo(-0.5, FIRST + 0.1); side.lineTo(-0.5, low);
    for (const sx of [x0 - 0.5, x1 + 0.5]) {
      const sg = new THREE.ShapeGeometry(side);
      sg.rotateY(-Math.PI / 2); sg.translate(sx, 0, 0);
      metreUV(sg, 4);
      kit.push('concrete', sg);
    }
  }

  // roof: a slab parallel to the rake on columns at the back, with a sponsor fascia on its front edge
  if (st.roof) {
    const rf = Math.min(rows - 3, Math.max(1, Math.round(rows * 0.3)));
    const zf = rf * ROW - 0.8, zr = Zb + 1.4, yf = tread(rf) + 3.6, yr = top + 3.6, L = Math.hypot(zr - zf, yr - yf);
    kit.box('roof', len + 2, 0.3, L, 0, (yf + yr) / 2 + 0.15, (zf + zr) / 2, 0, 0, -Math.atan2(yr - yf, zr - zf));
    for (let a = x0 + 2; a <= x1 - 1.9; a += 12) kit.box('steel', 0.45, yr + 0.2 - low, 0.45, a, (yr + 0.2 + low) / 2, Zb + 1.1);
    kit.box('steel', len + 1.6, 0.35, 0.35, 0, yr, zr - 0.2);
    for (let a = x0, k = 0; a < x1 - 1e-6; a += 8, k++) {
      const b = Math.min(x1, a + 8), z = zf - 0.15, y = yf - 0.5;
      sponsorPanel(kit, 'sponsor', k % 3 === 0 ? 0 : tex.MODERN_SPONSORS[(k * 3 + 1) % tex.MODERN_SPONSORS.length], a, z, b, z, y, y + 1.0, -1);
    }
    // a lamp bar under the front edge of the roof: on at dusk and night
    kit.box('lamp', len - 1, 0.12, 0.3, 0, yf - 0.1, zf + 0.5);
    st.roofTop = yr + 0.3;
  }
  // flags on the back corners of an open stand, moving in the wind (key 'flag' is a wind material)
  if (!st.roof) for (const [k, x] of [[0, x0 + 0.5], [1, x1 - 0.5]]) {
    kit.box('steel', 0.1, 5.5, 0.1, x, top + 2.5, Zb + 0.3);
    addFlag(kit, k ? 'flagB' : 'flagR', x + (k ? -0.05 : 0.05), top + 3.4, Zb + 0.3, k ? -1 : 1, 0, 3.0, 2.0, 5);
  }

  // the crowd
  const team = [PALETTE[seed % PALETTE.length], PALETTE[(seed + 3) % PALETTE.length], PALETTE[(seed + 6) % PALETTE.length]];
  const fill = st.name === 'Main Grandstand' ? 0.9 : st.kind === 'terrace' ? 0.85 : 0.72;
  for (let r = 0; r < rows; r++) {
    for (let a = x0 + 0.4; a < x1 - 0.3; a += SEAT) {
      if (aisle.some(ax => Math.abs(a - ax) < 0.75)) continue;
      const h = hash01(Math.round(a * 10), r, seed);
      if (h > fill + (r === rows - 1 ? 0.05 : 0)) continue;
      const block = hash01(Math.floor((a - x0) / 6), Math.floor(r / 4), seed);
      const colour = block < 0.45 ? team[Math.floor(block / 0.45 * 3) % 3] : PALETTE[(hash01(Math.round(a * 10), r, 5) * PALETTE.length) | 0];
      const hh = hash01(r, Math.round(a * 10), 9);
      spots.push([a, tread(r), r * ROW + 0.5, colour, hh, hh < standingShare]);
    }
  }
  return spots;
}

// A two storey hospitality building: glazed front towards the track, a balcony with an awning, lit windows at night, a flat roof with plant.
function hospitality(kit, st, low, spots) {
  const { len, depth } = st, x0 = -len / 2, x1 = len / 2, H1 = 4.2, H2 = 8.2, B = 3.2;   // storey heights, balcony depth
  const z0 = B, z1 = depth - 1;
  kit.box('concrete', len + 1, -low, depth, 0, low / 2, depth / 2 - 0.5, 0, 4);        // plinth
  kit.box('white', len, H2, z1 - z0, 0, H2 / 2, (z0 + z1) / 2);                          // the building
  // glazed front: a facade texture across the whole face, and a lit pane over each window
  kit.quad('glass', [x1, 0.1, z0 - 0.03], [x0, 0.1, z0 - 0.03], [x0, H2 - 0.2, z0 - 0.03], [x1, H2 - 0.2, z0 - 0.03], [[0, 0], [len / 4, 0], [len / 4, 1], [0, 1]]);
  const cols = Math.floor(len / 4);
  for (let k = 0; k < cols; k++) {
    const xa = x1 - (k + 0.5) * (len / cols);
    for (const y of [1.6, H1 + 1.6]) kit.quad('lit', [xa + 0.9, y, z0 - 0.06], [xa - 0.9, y, z0 - 0.06], [xa - 0.9, y + 1.7, z0 - 0.06], [xa + 0.9, y + 1.7, z0 - 0.06]);
  }
  // balcony slab over the ground floor, with a rail, and an awning on posts
  kit.box('white', len + 0.6, 0.25, B, 0, H1 - 0.1, B / 2 - 0.2);
  for (let x = x0; x <= x1 + 0.01; x += 1.4) kit.box('steel', 0.05, 1.0, 0.05, x, H1 + 0.45, -0.1);
  kit.box('steel', len + 0.6, 0.06, 0.06, 0, H1 + 0.98, -0.1);
  for (let x = x0 + 1; x <= x1; x += 8) kit.box('steel', 0.14, H2 - H1 - 0.3, 0.14, x, (H1 + H2 - 0.3) / 2, -0.1);
  kit.box('roof', len + 1.0, 0.18, B + 1.4, 0, H2 - 0.2, B / 2 - 0.2, 0, 0, 0.07);
  kit.box('lamp', len - 1, 0.1, 0.3, 0, H2 - 0.5, 0.4);
  // roof parapet, sponsor board on the front, plant on top
  kit.box('white', len + 0.2, 0.5, 0.25, 0, H2 + 0.25, z0 + 0.1);
  for (let a = x0 + 1, k = 0; a < x1 - 4; a += 9, k++) sponsorPanel(kit, 'sponsor', tex.MODERN_SPONSORS[(k + Math.round(st.s)) % tex.MODERN_SPONSORS.length], a, z0 - 0.1, a + 8, z0 - 0.1, H2 - 1.9, H2 - 0.9, -1);
  for (let k = 0; k < 3; k++) kit.box('steel', 3 + k, 1.4, 2.2, x0 + 6 + k * 9, H2 + 0.7, z1 - 3);
  kit.box('steel', 0.1, 6, 0.1, x1 - 3, H2 + 3, z1 - 2);
  // guests on the balcony
  for (let a = x0 + 1; a < x1 - 1; a += 1.1) {
    const h = hash01(Math.round(a * 10), 3, Math.round(st.s));
    if (h > 0.6) continue;
    spots.push([a, H1 + 0.02, 1.1 + h * 1.4, PALETTE[((h * 40) | 0) % PALETTE.length], h, h < 0.1]);
  }
}

// Spectator fence behind the barrier line, in front of each stand: a diamond mesh 2.5 m high on posts, following the ground.
// The fence stops at the pit entry road: no panel or post stands on the road or its run-off, so the mouth stays open.
export function planFences(T, ground, stands) {
  const runs = [], posts = [];
  const onEntryRoad = (x, z) => { const r = entryRoadAt(T, x, z, 0); return !!r && r.out === 0; };
  for (const st of stands) {
    const sg = st.side ? 1 : -1, c = trackPoint(T, st.s, 0);
    const half = st.len / 2 + 6;
    let prev = null, u = 0;
    for (let k = -Math.ceil(half); k <= Math.ceil(half); k += 2) {
      const j = wrapN(c.i + k, T.N), d = sg * (T.wall[st.side][j] + FENCE_AT);
      const x = T.x[j] + T.nx[j] * d, z = T.z[j] + T.nz[j] * d, y = ground.surfaceHeight(x, z);
      const cur = [x, y, z];
      if (prev) {
        const du = Math.hypot(x - prev[0], z - prev[2]) / 2;
        const cut = onEntryRoad(x, z) || onEntryRoad(prev[0], prev[2]) || onEntryRoad((x + prev[0]) / 2, (z + prev[2]) / 2);
        if (!cut) runs.push({ a: prev, b: cur, u, du });
        u += du;
      }
      if ((!prev || k % 4 === 0) && !onEntryRoad(x, z)) posts.push([x, y, z]);
      prev = cur;
    }
  }
  return { runs, posts };
}

function buildFences(T, ground, stands, fenceMat) {
  const { runs, posts: postAt } = planFences(T, ground, stands);
  const kit = new Kit(), post = new Kit();
  for (const { a, b, u, du } of runs) kit.quad('fence', [a[0], a[1] - 0.3, a[2]], [b[0], b[1] - 0.3, b[2]], [b[0], b[1] + 2.5, b[2]], [a[0], a[1] + 2.5, a[2]], [[u, 0], [u + du, 0], [u + du, 1.4], [u, 1.4]]);
  for (const [x, y, z] of postAt) post.box('post', 0.08, 2.9, 0.08, x, y + 1.15, z);
  const g = kit.build({ fence: fenceMat }, { fence: { cast: false } });
  g.traverse(o => { if (o.isMesh) { o.renderOrder = 2; o.userData.debug = 'fence'; } });
  const posts = post.build({ post: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.5 }) });
  posts.traverse(o => { if (o.isMesh) o.userData.debug = 'fence'; });
  g.add(posts);
  return g;
}

export function buildGrandstands(T, ground, extraBlockers = [], sponsorTex) {
  const group = new THREE.Group();
  const plan = planStands(T, ground, [...trackBlockers(T), ...extraBlockers]);
  const concrete = new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.9, side: THREE.DoubleSide });
  const mats = {
    concrete,
    seat: new THREE.MeshStandardMaterial({ map: tex.seatTexture(), roughness: 0.8 }),
    aisle: new THREE.MeshStandardMaterial({ color: 0xd6d3c8, roughness: 0.9 }),
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex || tex.sharedSponsorAtlas(), roughness: 0.55, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.5 }),
    scaff: new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.45, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ map: tex.facadeTexture({ wall: '#e8e2d2', glass: '#26323c', frame: '#f3f0e6', cols: 1, rows: 2 }), roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide }),
    lit: lampMaterial({ color: 0x26323c, emissive: 0xffd9a0, roughness: 0.3, side: THREE.DoubleSide }, 1.6),
    lamp: lampMaterial({ color: 0xdfe3e6, emissive: 0xfff2cf }, 5),
    flagR: flagMaterial({ color: 0xc8102e }),
    flagB: flagMaterial({ color: 0x1d4e9e }),
  };
  for (const k of ['concrete', 'seat', 'aisle', 'roof']) mats[k].userData.wet = 'surface';   // darker and glossier in the rain (src/environment.js)
  const all = new Kit(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  let people = 0;
  for (const st of plan.stands) {
    const kit = new Kit();
    const spots = buildStand(T, ground, st, kit);
    // the stand's static parts go into one shared kit (in world coordinates): about nine draw calls for every stand together
    E.set(0, st.yaw, 0);
    M.compose(new THREE.Vector3(st.x, st.y0, st.z), Q.setFromEuler(E), new THREE.Vector3(1, 1, 1));
    for (const [key, list] of kit.parts) for (const geo of list) { geo.applyMatrix4(M); all.push(key, geo); }

    const cg = new THREE.Group(), cm = crowdMesh(spots);
    if (cm) cg.add(cm);
    cg.position.set(st.x, st.y0, st.z);
    cg.rotation.y = st.yaw;
    cg.name = st.name;
    people += spots.length;
    group.add(cg);
  }
  const body = all.build(mats);
  body.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  group.add(body);
  const fenceMat = new THREE.MeshStandardMaterial({ map: tex.fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4, depthWrite: false });
  group.add(buildFences(T, ground, plan.stands, fenceMat));
  group.userData.stands = plan.stands;
  group.userData.why = plan.why;
  group.userData.people = people;
  return group;
}
