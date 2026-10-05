// Venue placement check. Run with `npm run venue` (also part of `npm run check`).
// The grandstands, the start gantry and the bridge piers must stand where they cannot touch the racing surface:
//   - every stand is behind the containment wall by at least GAP, 6 m from every barrier line, off the pit lane,
//     clear of every building, the bridge and the other stands, on ground that is not too steep
//   - the gantry legs stand outside the kerbs and clear of the pit wall, and everything on it is 6 m or more above the road
//   - no bridge pier stands within 6 m of the containment wall of any part of the circuit
// It checks the plan (numbers only), the same one the game draws.

import { buildTrack } from '../src/track.js';
import { createGround, sceneryFootprints } from '../src/scenery.js';
import { planStands, trackBlockers, wallClearance, SITES, GAP } from '../src/grandstands.js';
import { GANTRY_CLEAR, GANTRY_LOWEST, GANTRY_LEG, GANTRY_S } from '../src/gantry.js';
import { planPiers, pierBlocked } from '../src/bridge.js';
import { trackPoint } from '../src/meshKit.js';

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
if (stands.length < 3) fail(`only ${stands.length} stands placed, wanted 3 to 5`);
for (const st of stands) {
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
  for (const o of stands) {
    if (o === st) continue;
    const near = pts.some(([x, z]) => {
      const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
      return Math.abs(a) < o.len / 2 + 4 && b > -4 && b < o.depth + 4;
    });
    if (near) fail(`${st.name} overlaps ${o.name}`);
  }
  console.log(`  ${st.name.padEnd(18)} s ${st.s.toFixed(0).padStart(4)}  ${st.side ? 'right' : 'left '}  ${st.len} m x ${st.rows} rows  ${minWall.toFixed(1)} m behind the wall, ${minSeg.toFixed(1)} m from any barrier`);
}

// ---- gantry
{
  const c = trackPoint(T, GANTRY_S, 0), i = c.i, span = T.halfWidth + GANTRY_LEG;
  if (GANTRY_LOWEST < 6) fail(`gantry clearance ${GANTRY_LOWEST} m is under 6 m`);
  if (GANTRY_CLEAR < GANTRY_LOWEST) fail('gantry truss is lower than what hangs from it');
  for (const sd of [-1, 1]) {
    const side = sd < 0 ? 0 : 1, edge = T.halfWidth + T.kerb[side][i] + T.sausage[side][i];
    if (span - 0.9 < edge + 1) fail(`gantry leg ${side ? 'right' : 'left'} is only ${(span - 0.9 - edge).toFixed(1)} m from the kerb`);
    const p = trackPoint(T, GANTRY_S, sd * span);
    for (const sg of T.segs) if (segDist(p.x, p.z, sg) < 1.6 + 0.9) { fail(`gantry leg ${side ? 'right' : 'left'} is ${segDist(p.x, p.z, sg).toFixed(1)} m from a barrier`); break; }
    if (side === 0 && T.pitIn[i] && span + 0.9 > T.pitIn[i] - 0.6 - 1) fail('gantry leg stands too close to the pit wall');
  }
}

// ---- bridge piers
{
  const blocked = pierBlocked(T);
  for (const p of planPiers(T, ground, blocked)) {
    if (wallClearance(T, p.x, p.z, true) < 6) fail(`bridge pier at sample ${p.i} is within 6 m of a containment wall`);
  }
}

console.log(errors.length ? `\nVENUE FAIL\n${errors.map(e => '  ' + e).join('\n')}` : `\nVENUE OK: ${stands.length} of ${SITES.length} stands placed, gantry and bridge clear`);
process.exit(errors.length ? 1 : 0);
