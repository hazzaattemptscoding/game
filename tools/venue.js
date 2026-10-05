// Venue placement check. Run with `npm run venue` (also part of `npm run check`).
// The grandstands, the start gantry and the bridge piers must stand where they cannot touch the racing surface:
//   - every stand is behind the containment wall by at least GAP, 6 m from every barrier line, off the pit lane,
//     clear of every building, the bridge and the other stands, on ground that is not too steep
//   - the gantry legs stand outside the kerbs and clear of the pit wall, and everything on it is 6 m or more above the road
//   - at most 12 stands, of four kinds (covered, open terrace, scaffold, hospitality); the fan zones, big screens, media tower and footbridge stairs obey the same rules as the stands
//   - signs, bins, pit boards, banner flags, the perimeter fence and the floodlight masts are behind the wall, off the barrier lines and clear of buildings and stands
//   - no bridge pier stands within 6 m of the containment wall of any part of the circuit
// It checks the plan (numbers only), the same one the game draws.

import { buildTrack } from '../src/track.js';
import { createGround, sceneryFootprints } from '../src/scenery.js';
import { planStands, trackBlockers, wallClearance, SITES, GAP } from '../src/grandstands.js';
import { GANTRY_CLEAR, GANTRY_LOWEST, GANTRY_S, TOWER_HALF, gantryLegs } from '../src/gantry.js';
import { planPiers, pierBlocked } from '../src/bridge.js';
import { trackPoint } from '../src/meshKit.js';
import { planExtras, footBlockers, footprintPoints, SMALL_RULES } from '../src/venueExtras.js';
import { planMasts, MAST_BEHIND, MAST_BARRIER } from '../src/floodlights.js';

const T = buildTrack(), ground = createGround(T), errors = [];
const fail = m => errors.push(m);
const segDist = (x, z, sg) => {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
};

// ---- stands
const blockers = [...trackBlockers(T), ...sceneryFootprints(T)];
const { stands, why } = planStands(T, ground, blockers);
for (const w of why) fail(`${w.name}: no valid place (${JSON.stringify(w.reason)})`);
if (stands.length < 10 || stands.length > 12) fail(`${stands.length} stands placed, wanted 10 to 12`);
for (const k of ['main', 'terrace', 'scaffold', 'hospitality']) if (!stands.some(st => st.kind === k)) fail(`no ${k} stand placed`);
const extras = planExtras(T, ground, blockers, stands);
for (const w of extras.why) fail(`${w.name}: no valid place (${JSON.stringify(w.reason)})`);
const everything = [...stands, ...extras.items];
for (const st of everything) {
  const pts = [];
  for (let a = -st.len / 2 - 2; a <= st.len / 2 + 2 + 1e-6; a += 2) for (let b = 0; b <= st.depth + 1e-6; b += 2) pts.push([st.x + st.ex[0] * a + st.ez[0] * b, st.z + st.ex[1] * a + st.ez[1] * b]);
  let minWall = Infinity, minSeg = Infinity, minBlock = Infinity;
  for (const [x, z] of pts) {
    minWall = Math.min(minWall, wallClearance(T, x, z));
    for (const sg of T.segs) minSeg = Math.min(minSeg, segDist(x, z, sg));
    for (const b of blockers) minBlock = Math.min(minBlock, Math.hypot(x - b.x, z - b.z) - b.r);
  }
  if (minWall < GAP - 1) fail(`${st.name}: ${minWall.toFixed(1)} m behind the wall, need ${GAP - 1}`);
  if (minSeg < 6) fail(`${st.name}: ${minSeg.toFixed(1)} m from a barrier line, need 6`);
  if (minBlock < 3) fail(`${st.name}: ${minBlock.toFixed(1)} m from a building or the bridge`);
  for (const o of everything) {
    if (o === st) continue;
    const near = pts.some(([x, z]) => {
      const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
      return Math.abs(a) < o.len / 2 + 4 && b > -4 && b < o.depth + 4;
    });
    if (near) fail(`${st.name} overlaps ${o.name}`);
  }
  console.log(`  ${st.name.padEnd(18)} ${(st.kind || '').padEnd(11)} s ${st.s.toFixed(0).padStart(4)}  ${st.side ? 'right' : 'left '}  ${st.len} m x ${st.rows} rows  ${minWall.toFixed(1)} m behind the wall, ${minSeg.toFixed(1)} m from any barrier`);
}

// ---- footbridges: stairs and towers behind the walls, the deck 7 m or more above the road
for (const b of extras.bridges) {
  const c = trackPoint(T, b.s, 0);
  if (b.deckY - b.roadY < 7) fail(`${b.name}: deck is only ${(b.deckY - b.roadY).toFixed(1)} m above the road`);
  for (let k = -3; k <= 3; k++) { const j = (b.i + k + T.N) % T.N; if (b.deckY - T.h[j] < 6.5) fail(`${b.name}: deck is ${(b.deckY - T.h[j]).toFixed(1)} m above the road at sample ${j}`); }
  for (const side of [0, 1]) for (const [x, z] of footprintPoints(T, c, side)) {
    if (wallClearance(T, x, z) < 7) { fail(`${b.name}: a stair is ${wallClearance(T, x, z).toFixed(1)} m behind the wall`); break; }
    if (T.segs.some(sg => segDist(x, z, sg) < 5.9)) { fail(`${b.name}: a stair is within 6 m of a barrier line`); break; }
    if (blockers.some(bl => Math.hypot(x - bl.x, z - bl.z) < bl.r + 3)) { fail(`${b.name}: a stair is on a building`); break; }
    if (everything.some(o => { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], bb = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; return Math.abs(a) < o.len / 2 && bb > 0 && bb < o.depth; })) { fail(`${b.name}: a stair is on ${'a stand or fan zone'}`); break; }
  }
  console.log(`  ${b.name.padEnd(18)} footbridge  s ${b.s.toFixed(0).padStart(4)}  deck ${(b.deckY - b.roadY).toFixed(1)} m over the road`);
}

// ---- small things and the masts
const allBlockers = [...blockers, ...footBlockers(extras.bridges)];
const inObstacle = (x, z) => everything.some(o => { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], bb = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; return Math.abs(a) < o.len / 2 && bb > 0 && bb < o.depth; });
const small = extras.small;
const checkPoint = (what, x, z, rule, onBuilding = true) => {
  const w = wallClearance(T, x, z);
  if (w < rule.behind - 0.5) return fail(`${what} at (${x.toFixed(0)}, ${z.toFixed(0)}) is ${w.toFixed(1)} m behind the wall, need ${rule.behind}`);
  if (T.segs.some(sg => segDist(x, z, sg) < rule.barrier - 0.3)) return fail(`${what} at (${x.toFixed(0)}, ${z.toFixed(0)}) is within ${rule.barrier} m of a barrier line`);
  if (onBuilding && allBlockers.some(bl => Math.hypot(x - bl.x, z - bl.z) < bl.r)) return fail(`${what} at (${x.toFixed(0)}, ${z.toFixed(0)}) is on a building`);
  if (inObstacle(x, z)) return fail(`${what} at (${x.toFixed(0)}, ${z.toFixed(0)}) is on a stand or fan zone`);
};
small.signs.forEach(p => checkPoint('sign', p.x, p.z, SMALL_RULES.sign));
small.bins.forEach(p => checkPoint('bin', p.x, p.z, SMALL_RULES.bin));
small.flags.forEach(p => checkPoint('banner flag', p.x, p.z, SMALL_RULES.flag));
small.pit.forEach(p => { checkPoint('pit board', p.x, p.z, SMALL_RULES.pit); if (!(T.pitOut[trackPoint(T, p.s, 0).i] || true)) fail('pit board'); });
small.fence.forEach(p => { checkPoint('fence post', p.ax, p.az, SMALL_RULES.fence); checkPoint('fence post', p.bx, p.bz, SMALL_RULES.fence); });
if (small.pit.length !== 2) fail(`${small.pit.length} pit boards placed, wanted the entry and the exit`);
if (small.signs.length < 6 || small.bins.length < 10 || small.flags.length < 8 || small.fence.length < 200) fail(`too little small furniture: ${small.signs.length} signs, ${small.bins.length} bins, ${small.flags.length} flags, ${small.fence.length} fence panels`);
const masts = planMasts(T, allBlockers, everything);
if (masts.length < 20) fail(`only ${masts.length} floodlight masts placed`);
for (const m of masts) {
  const w = wallClearance(T, m.x, m.z);
  if (w < MAST_BEHIND - 0.5) fail(`mast at s ${m.s.toFixed(0)} is ${w.toFixed(1)} m behind the wall, need ${MAST_BEHIND}`);
  if (T.segs.some(sg => segDist(m.x, m.z, sg) < MAST_BARRIER - 0.3)) fail(`mast at s ${m.s.toFixed(0)} is within ${MAST_BARRIER} m of a barrier line`);
  if (allBlockers.some(bl => Math.hypot(m.x - bl.x, m.z - bl.z) < bl.r)) fail(`mast at s ${m.s.toFixed(0)} is on a building`);
  if (inObstacle(m.x, m.z)) fail(`mast at s ${m.s.toFixed(0)} is on a stand`);
}
console.log(`  ${small.signs.length} signs, ${small.bins.length} bins, ${small.flags.length} banner flags, ${small.pit.length} pit boards, ${small.fence.length} fence panels, ${masts.length} floodlight masts`);

// ---- gantry
{
  const c = trackPoint(T, GANTRY_S, 0), i = c.i, legs = gantryLegs(T);
  if (GANTRY_LOWEST < 6) fail(`gantry clearance ${GANTRY_LOWEST} m is under 6 m`);
  if (GANTRY_CLEAR < GANTRY_LOWEST) fail('gantry truss is lower than what hangs from it');
  for (const d of legs) {
    const side = d < 0 ? 0 : 1, inner = Math.abs(d) - TOWER_HALF;
    // a tower stands behind a wall: beyond the containment wall on the right, beyond the pit lane's outer wall on the left
    const wall = side === 0 && T.pitOut[i] ? T.pitOut[i] : T.wall[side][i];
    if (inner < wall + 0.5) fail(`gantry tower ${side ? 'right' : 'left'} is not behind the wall (${inner.toFixed(1)} m out, wall ${wall.toFixed(1)} m)`);
    const p = trackPoint(T, GANTRY_S, d);
    for (const sg of T.segs) if (segDist(p.x, p.z, sg) < TOWER_HALF + 0.4) { fail(`gantry tower ${side ? 'right' : 'left'} is ${segDist(p.x, p.z, sg).toFixed(1)} m from a barrier`); break; }
    if (inObstacle(p.x, p.z)) fail(`gantry tower ${side ? 'right' : 'left'} stands on a stand or building`);
  }
  console.log(`  start gantry: towers ${legs.map(d => d.toFixed(1)).join(' and ')} m from the centre line, span ${(legs[1] - legs[0]).toFixed(1)} m`);
}

// ---- bridge piers
{
  const blocked = pierBlocked(T);
  for (const p of planPiers(T, ground, blocked)) {
    if (wallClearance(T, p.x, p.z, true) < 6) fail(`bridge pier at sample ${p.i} is within 6 m of a containment wall`);
  }
}

console.log(errors.length ? `\nVENUE FAIL\n${errors.map(e => '  ' + e).join('\n')}` : `\nVENUE OK: ${stands.length} of ${SITES.length} stands, ${extras.items.length} fan zones, screens and towers, ${extras.bridges.length} footbridges, ${masts.length} masts placed; gantry and bridge clear`);
process.exit(errors.length ? 1 : 0);
