// Tyre closure test. Run with `npm run tyreclosed`. No browser needed.
//   1. the bridge tyre stack (src/bridge.js TYRE_PROFILE): its lathe profile starts and ends on the axis, so the stack has no open
//      hole or end
//   2. the lathe built from it (the same geometry the bridge draws) is closed: every edge of every real triangle is shared by two
//      triangles, so no face is missing and you cannot see inside

import * as THREE from 'three';
import { TYRE_PROFILE } from '../src/bridge.js';

let n = 0, fails = 0;
function check(ok, label) {
  n++;
  if (!ok) { fails++; console.log(`  FAIL ${label}`); }
}

console.log('PROFILE');
{
  const first = TYRE_PROFILE[0], last = TYRE_PROFILE[TYRE_PROFILE.length - 1];
  check(first.x === 0 && last.x === 0, 'the profile starts and ends on the axis (no open hole through the stack)');
  check(TYRE_PROFILE.every(p => p.x >= 0), 'every point of the profile is at or outside the axis');
  check(TYRE_PROFILE.every(p => p.y >= 0 && p.y <= 0.26 + 1e-9), 'the profile stays between the bottom and the top of one tyre');
}

console.log('LATHE');
{
  const geo = new THREE.LatheGeometry(TYRE_PROFILE, 12);
  const pos = geo.attributes.position.array, ind = geo.index ? geo.index.array : null;
  const key = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]].map(v => Math.round(v * 1e6)).join(',');   // merge the seam's duplicate vertices
  const edges = new Map();
  const tris = ind ? ind.length / 3 : pos.length / 9;
  let real = 0;
  for (let t = 0; t < tris; t++) {
    const v = [0, 1, 2].map(k => (ind ? ind[3 * t + k] : 3 * t + k));
    const keys = v.map(key);
    if (new Set(keys).size < 3) continue;                    // a degenerate triangle on the axis has no area
    real++;
    for (let k = 0; k < 3; k++) {
      const a = keys[k], b = keys[(k + 1) % 3], e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  const open = [...edges.values()].filter(c => c !== 2).length;
  check(real > 0, 'the lathe has real triangles');
  check(open === 0, `every edge is shared by two triangles (${open} open edges of ${edges.size})`);
}

console.log(fails ? `tyreclosed: ${fails} of ${n} checks FAILED` : `tyreclosed: all ${n} checks passed`);
if (fails) process.exit(1);
