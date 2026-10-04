// Surface scan: raycasts (in plan view) every ground surface across the whole lap and reports
//   holes        nothing under a point that should have ground
//   terrain top  the terrain mesh is the highest thing inside the flat corridor
//   on the road  something other than tarmac is the top surface inside the racing width
//   z-fight      two different layers within 3 cm of each other (paint decals excepted)
// Run with `npm run surfaces`. Fails if any count is above its limit.

import { buildWorld, surfaceIndex } from './lib/headless.js';

const DECAL = new Set(['line', 'rumble', 'island']);          // paint: allowed to sit on a surface
const LIMITS = { holes: 0, terrainTop: 0, onRoad: 0, zfight: 0 };
const STEP_S = 2, STEP_D = 0.5;

const { T, root } = await buildWorld();
const idx = surfaceIndex(root);
const found = globalThis.__found = { holes: [], terrainTop: [], onRoad: [], zfight: [] };
const pairs = new Map();

// the whole lap is scanned, the bridge deck and its approaches included: on the deck the road is the top surface
// and the terrain must stay below it (the terrain-above-road check below covers the full road width)
for (let i = 0; i < T.N; i += Math.round(STEP_S / T.ds)) {
  for (const sd of [0, 1]) {
    const g = sd ? 1 : -1, reach = Math.min(T.wall[sd][i], T.reach[sd][i]) - 0.5;     // bands stop where the offset would fold
    const pitSide = sd === 0 && T.pitOut[i] > 0;
    for (let d = 0; d <= reach; d += STEP_D) {
      const dd = g * d, x = T.x[i] + T.nx[i] * dd, z = T.z[i] + T.nz[i] * dd;
      const near = h => Math.abs(h.y - T.h[i]) < 2.5;       // ignore other parts of the circuit passing over or under
      const all = idx.at(x, z), hits = all.filter(h => h.y < T.h[i] + 6), where = `s=${T.s[i].toFixed(0)} ${sd ? 'R' : 'L'} d=${d.toFixed(1)}`;
      if (!all.length) { found.holes.push(where); continue; }
      if (!hits.length) continue;                              // only ground well above the road here: a bank
      const top = hits[0];
      // within the road width, terrain must never be above the road surface (checked on the deck and its approaches too)
      if (d < T.halfWidth + 0.5) {
        const road = hits.find(q => q.cat === 'road'), terr = hits.find(q => q.cat === 'terrain');
        if (terr && terr.y > (road ? road.y : T.h[i]) + 0.005) found.terrainTop.push(`${where} terrain ${(terr.y - (road ? road.y : T.h[i])).toFixed(2)} m above road`);
      }
      if (top.cat === 'terrain') {
        // terrain on top is fine over a grass strip (a bank), and fine when it is far from the road height;
        // it is a fault when it hides tarmac, kerb or gravel, or when nothing is drawn where it sits at road level
        const under = hits.find(q => q.cat !== 'terrain');
        if (under ? under.cat !== 'grass' : Math.abs(top.y - T.h[i]) < 0.5) found.terrainTop.push(`${where} ${under ? 'buries ' + under.cat : 'no strip'}`);
      }
      if (d < T.halfWidth - 0.1 && top.cat !== 'road' && top.cat !== 'line' && !(T.pitMouth[i] && top.cat === 'pit')) found.onRoad.push(`${where} is ${top.cat}`);
      const inner = idx.at(x, z, 1e-4).filter(near);        // clear of shared edges, where two bands touch by design
      for (let k = 1; k < inner.length; k++) {
        const a = inner[k - 1], b = inner[k];
        if (a.cat === b.cat || a.y - b.y > 0.03) continue;
        if (DECAL.has(a.cat) || DECAL.has(b.cat)) continue;
        if (b.cat === 'terrain') continue;                      // terrain below paving is hidden, not a fight
        const name = `${a.cat}/${b.cat}`;
        pairs.set(name, (pairs.get(name) || 0) + 1);
        found.zfight.push(`${where} ${name} ${((a.y - b.y) * 1000).toFixed(0)} mm`);
      }
    }
  }
}

console.log(`SURFACE SCAN: ${idx.count} up-facing triangles, every ${STEP_S} m of the lap, ${STEP_D} m across`);
const fails = [];
for (const [k, list] of Object.entries(found)) {
  console.log(`  ${k}: ${list.length}${list.length ? '   e.g. ' + list.slice(0, 3).join('; ') : ''}`);
  if (list.length > LIMITS[k]) fails.push(`${k}: ${list.length} (limit ${LIMITS[k]})`);
}
if (pairs.size) console.log('  z-fight layer pairs: ' + [...pairs].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
if (fails.length) { console.log('  FAILED:'); for (const f of fails) console.log('   - ' + f); process.exitCode = 1; } else console.log('  all clear');
if (process.env.VERBOSE) for (const [k, list] of Object.entries(found)) console.log(k, list.map(w => w.match(/s=(\d+)/)[1]).filter((v, i, a) => a.indexOf(v) === i).join(' '));
if (process.env.BREAKDOWN) for (const k of ['terrainTop']) {
  const g = new Map();
  for (const w of found[k]) { const m = w.match(/s=(\d+) (\w) d=([\d.]+) (.*)/); const key = `${m[4]} ${Math.floor(m[1] / 50) * 50}${m[2]}`; (g.get(key) || g.set(key, []).get(key)).push(+m[3]); }
  for (const [key, v] of g) console.log(k, key, `d ${Math.min(...v)}..${Math.max(...v)} (${v.length})`);
}
