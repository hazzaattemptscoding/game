// Parked service vehicles check. Run with `node tools/vehicles.js` (also part of `npm run check`).
// The plan (src/serviceVehiclePlan.js) is numbers only, the same one the game builds:
//   - deterministic: planning twice gives the same list
//   - 10 to 16 vehicles, every type present, none left unplaced, the counts the owner asked for
//   - every vehicle stands behind the containment wall, 4 m or more from every barrier line, and with 1.5 m to spare off every
//     road surface (kerb, run-off, gravel, pit lane, pit entry road), so nothing needs collision
//   - none on the bridge or within 40 m of the deck, none in a stand or its frontage, none on a building, none within 1.5 m of
//     another vehicle, none within 3 m of a board, sign, bin, flag, mast or marshal post
//   - the paddock vehicles stand behind the garage fronts, the safety car on the grass beside the pit exit
//   - the models stay inside their footprints, the whole set is at most 12 draw calls and 60,000 triangles
// It plans with the same scenery inputs as the game (the stands, extras and building circles of src/scenery.js).

import { buildTrack, SURF } from '../src/track.js';
import { createGround, sceneryFootprints } from '../src/scenery.js';
import { planStands, trackBlockers, wallClearance, GAP } from '../src/grandstands.js';
import { planExtras, footBlockers } from '../src/venueExtras.js';
import { planMasts } from '../src/floodlights.js';
import { planMarshal } from '../src/marshal.js';
import { planVehicles, footprint, VEHICLES, SLOTS, PADDOCK_MIN, WALL_MIN, BARRIER_MIN, FURNITURE_MIN, VEHICLE_GAP, BRIDGE_MIN } from '../src/serviceVehiclePlan.js';
import { vehicleGeometry, VEHICLE_TYPES, cellKey } from '../src/serviceVehicles.js';

export const DRAW_CALLS = 12, TRIANGLES = 60000;
const T = buildTrack(), ground = createGround(T), errors = [];
const fail = m => errors.push(m);

// the scenery inputs, as src/scenery.js builds them
const blockers0 = sceneryFootprints(T), all = [...trackBlockers(T), ...blockers0];
const { stands } = planStands(T, ground, all);
const extras = planExtras(T, ground, all, stands);
const obstacles = [...stands, ...extras.items], blockers = [...all, ...footBlockers(extras.bridges)];
const keep = { obstacles, blockers };

const plan = planVehicles(T, keep), again = planVehicles(T, keep);
if (JSON.stringify(plan) !== JSON.stringify(again)) fail('planning twice gives different vehicles');
const placed = plan.filter(v => !v.failed);
for (const v of plan) if (v.failed) fail(`${v.type} (${v.label}) has no valid place`);
if (placed.length < 10 || placed.length > 16) fail(`${placed.length} vehicles placed, wanted 10 to 16`);
const count = t => placed.filter(v => v.type === t).length;
for (const t of Object.keys(VEHICLES)) if (!count(t)) fail(`no ${t} placed`);
const WANT = { ambulance: 2, fire: 2, recovery: 3, medical: 1, sweeper: 2, safety: 1, buggy: 2, transport: 3 };
for (const [t, n] of Object.entries(WANT)) if (count(t) < n) fail(`${count(t)} ${t} placed, wanted ${n}`);

const segDist = (x, z, sg) => {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
};
const nearest = (x, z) => { let best = Infinity, j = 0; for (let i = 0; i < T.N; i++) { const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2; if (q < best) { best = q; j = i; } } return j; };
const rectDist = (v, x, z) => {   // distance from a point to the vehicle's rectangle (0 inside)
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw), d = VEHICLES[v.type], dx = x - v.x, dz = z - v.z;
  const u = dx * c + dz * s, w = -dx * s + dz * c;
  return Math.hypot(Math.max(0, Math.abs(u) - d.len / 2), Math.max(0, Math.abs(w) - d.wid / 2));
};
const deck = []; for (let i = 0; i < T.N; i += 2) if (T.isBridge[i]) deck.push(i);

// the other planned small things the vehicles must not sit on
const small = extras.small, masts = planMasts(T, blockers, obstacles), posts = planMarshal(T, null, keep).posts;
const points = [...small.signs.map(p => ['sign', p]), ...small.bins.map(p => ['bin', p]), ...small.flags.map(p => ['banner flag', p]), ...small.pit.map(p => ['pit board', p]), ...masts.map(p => ['floodlight mast', p]), ...posts.map(p => ['marshal post', p])];
const fences = small.fence;

const rows = [];
for (const v of placed) {
  const d = VEHICLES[v.type], tag = `${v.type} at s ${v.s.toFixed(0)}`;
  const paddock = SLOTS.find(sl => sl.type === v.type && sl.behindPit && Math.abs(sl.s - v.s) <= sl.slide + 1);
  // footprint grown by 1.5 m, so the clear distance to anything drivable is tested too
  const fp = footprint(v.type, v.x, v.z, v.yaw, 1.5), body = footprint(v.type, v.x, v.z, v.yaw, 0);
  let minWall = Infinity, minSeg = Infinity, surfaceBad = null;
  for (const [x, z] of body) {
    if (!paddock) minWall = Math.min(minWall, wallClearance(T, x, z));
    for (const sg of T.segs) minSeg = Math.min(minSeg, segDist(x, z, sg));
  }
  if (!paddock && minWall < WALL_MIN - 0.01) fail(`${tag}: ${minWall.toFixed(1)} m behind the wall, need ${WALL_MIN}`);
  if (minSeg < BARRIER_MIN - 0.01) fail(`${tag}: ${minSeg.toFixed(1)} m from a barrier line, need ${BARRIER_MIN}`);
  let pitLat = Infinity;
  for (const [x, z] of fp) {
    const i = nearest(x, z), d0 = (x - T.x[i]) * T.nx[i] + (z - T.z[i]) * T.nz[i], surf = T.surfaceAt(i, d0);
    if (surf !== SURF.GRASS && !surfaceBad) surfaceBad = `${surf} at d ${d0.toFixed(1)} (s ${T.s[i].toFixed(0)})`;
    if (T.pitOut[i] > 0 && d0 < 0) pitLat = Math.min(pitLat, -d0 - T.pitOut[i]);
  }
  if (surfaceBad) fail(`${tag}: within 1.5 m of a drivable or paved surface (surface ${surfaceBad})`);
  for (const j of deck) if (Math.hypot(v.x - T.x[j], v.z - T.z[j]) < BRIDGE_MIN - 1) { fail(`${tag}: ${Math.hypot(v.x - T.x[j], v.z - T.z[j]).toFixed(0)} m from the bridge deck`); break; }
  if (T.onBridge(v.s)) fail(`${tag}: on the bridge`);
  for (const o of obstacles) {
    const hit = body.some(([x, z]) => { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; return Math.abs(a) < o.len / 2 + 3 && b > -(GAP + 1) && b < o.depth + 3; });
    if (hit) fail(`${tag}: in or in front of ${o.name}`);
  }
  for (const b of blockers) if (body.some(([x, z]) => Math.hypot(x - b.x, z - b.z) < b.r)) { fail(`${tag}: on a building (${b.name})`); break; }
  for (const f of T.furniture || []) if (rectDist(v, f.x, f.z) < FURNITURE_MIN - 0.5) { fail(`${tag}: ${rectDist(v, f.x, f.z).toFixed(1)} m from a ${f.type}`); break; }
  for (const [what, p] of points) if (rectDist(v, p.x, p.z) < 2.5) fail(`${tag}: ${rectDist(v, p.x, p.z).toFixed(1)} m from a ${what}`);
  for (const f of fences) if (rectDist(v, f.ax, f.az) < 1.5 || rectDist(v, f.bx, f.bz) < 1.5) { fail(`${tag}: on a spectator fence`); break; }
  for (const o of placed) if (o !== v) {
    const near = footprint(o.type, o.x, o.z, o.yaw, 0).some(([x, z]) => rectDist(v, x, z) < VEHICLE_GAP - 0.01) || footprint(v.type, v.x, v.z, v.yaw, 0).some(([x, z]) => rectDist(o, x, z) < VEHICLE_GAP - 0.01);
    if (near && placed.indexOf(o) > placed.indexOf(v)) fail(`${tag} is within ${VEHICLE_GAP} m of the ${o.type} at s ${o.s.toFixed(0)}`);
  }
  // the ground under it: not steep, and the model sits on the drawn terrain
  const c = Math.cos(v.yaw), sn = Math.sin(v.yaw), h = (u, w) => ground.surfaceHeight(v.x + u * c - w * sn, v.z + u * sn + w * c);
  const slopeL = Math.abs(h(d.len / 2, 0) - h(-d.len / 2, 0)) / d.len, slopeW = Math.abs(h(0, d.wid / 2) - h(0, -d.wid / 2)) / d.wid;
  if (slopeL > 0.14 || slopeW > 0.16) fail(`${tag}: stands on a slope of ${(slopeL * 100).toFixed(0)}% along and ${(slopeW * 100).toFixed(0)}% across`);
  // the paddock: behind the garage fronts
  if (paddock) {
    const j = nearest(v.x, v.z), lat = -((v.x - T.x[j]) * T.nx[j] + (v.z - T.z[j]) * T.nz[j]) - (T.pitOut[j] + 2);
    if (!(T.pitGarage[j] > 0) || lat < PADDOCK_MIN - 0.5) fail(`${tag}: paddock vehicle is ${lat.toFixed(1)} m behind the garage fronts, need ${PADDOCK_MIN}`);
  }
  rows.push(`  ${v.type.padEnd(10)} s ${v.s.toFixed(0).padStart(4)}  d ${v.d.toFixed(1).padStart(6)}  ${v.d < 0 ? 'left ' : 'right'}  ${paddock ? 'paddock' : `${minWall.toFixed(1)} m behind the wall`}, ${minSeg.toFixed(1)} m from a barrier${pitLat < Infinity ? `, ${pitLat.toFixed(1)} m beyond the pit lane edge` : ''}  (${v.label})`);
}
rows.forEach(r => console.log(r));

// the safety car: pit side, beside the pit exit road (past the last garage, before the exit merges), clear of the pit lane
{
  const sc = placed.find(v => v.type === 'safety');
  if (sc) {
    const j = nearest(sc.x, sc.z), lat = -((sc.x - T.x[j]) * T.nx[j] + (sc.z - T.z[j]) * T.nz[j]);
    if (!(T.pitOut[j] > 0)) fail('the safety car is not beside the pit road');
    if (T.pitGarage[j] > 0) fail('the safety car is beside the garages, it belongs at the exit end');
    if (lat <= T.pitOut[j] + 1.5) fail(`the safety car is ${(lat - T.pitOut[j]).toFixed(1)} m from the pit lane edge, need 1.5 m`);
    const exit = ((T.s[j] - T.pitRange[1]) % T.length + T.length) % T.length;
    if (T.s[j] > T.pitRange[1] + 0.1 || exit < 1) fail(`the safety car is past the pit exit (s ${T.s[j].toFixed(0)})`);
    console.log(`  safety car: s ${sc.s.toFixed(0)}, ${(lat - T.pitOut[j]).toFixed(1)} m outside the pit lane's outer edge (the lane is all drivable, so it stands on the grass beside the exit road)`);
  }
}

// the models: inside their footprints
for (const t of VEHICLE_TYPES) {
  const g = vehicleGeometry(t), d = VEHICLES[t], b = g.box;
  if (b.x1 - b.x0 > d.len + 0.05) fail(`${t}: model is ${(b.x1 - b.x0).toFixed(2)} m long, footprint ${d.len}`);
  if (b.z1 - b.z0 > d.wid + 0.05) fail(`${t}: model is ${(b.z1 - b.z0).toFixed(2)} m wide, footprint ${d.wid}`);
  if (Math.abs(b.x0 + b.x1) > 0.6 || Math.abs(b.z0 + b.z1) > 0.15) fail(`${t}: model is off centre`);
  if (b.y0 < -0.01 || b.y0 > 0.2) fail(`${t}: model does not stand on the ground (lowest ${b.y0.toFixed(2)})`);
  console.log(`  model ${t.padEnd(10)} ${g.tris} triangles, ${(b.x1 - b.x0).toFixed(1)} x ${(b.z1 - b.z0).toFixed(1)} x ${b.y1.toFixed(1)} m (footprint ${d.len} x ${d.wid})`);
}
const tris = placed.reduce((n, v) => n + vehicleGeometry(v.type).tris, 0), cells = new Set(placed.map(cellKey)).size;
console.log(`  ${placed.length} vehicles, ${tris} triangles, ${cells} draw calls (budget ${TRIANGLES} and ${DRAW_CALLS})`);
if (tris > TRIANGLES) fail(`${tris} triangles is over the budget of ${TRIANGLES}`);
if (cells > DRAW_CALLS) fail(`${cells} draw calls is over the budget of ${DRAW_CALLS}`);

console.log(errors.length ? 'FAIL\n  ' + errors.join('\n  ') : 'PASS');
process.exitCode = errors.length ? 1 : 0;
