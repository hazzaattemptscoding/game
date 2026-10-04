// Bump scan: raycasts down the real geometry along both wheel tracks, the centreline and the
// kerb edge, every 0.25 m around the lap, and reports the surface height relative to the road.
//   pass: on tarmac and pit road the height varies by under 8 mm along a wheel track, and
//         there is no step over 1 cm anywhere except at a real kerb or sausage.
// Run with `npm run bumps`. BUMPS_VERBOSE=1 lists every finding.
import { buildWorld, surfaceIndex } from './lib/headless.js';
import { CARS } from '../src/cars.js';

const WOBBLE = 0.008;
const STEP = 0.25, WHEEL_D = (CARS?.GT?.trackWidth ?? 1.6) / 2;
const PAINT = new Set(['line', 'rumble', 'island']);           // paint, not height: the wheels ignore it
const { T, root } = await buildWorld();
const idx = surfaceIndex(root, ['road', 'line', 'kerb', 'sausage', 'apron', 'concrete', 'rumble', 'gravel', 'grass', 'pit', 'island']);

const tracks = [['left wheel', -WHEEL_D], ['right wheel', WHEEL_D], ['centreline', 0]];
const findings = [];
const spread = [];
let worstSpread = 0;

for (const [name, d] of tracks) {
  let prev = null, lo = Infinity, hi = -Infinity;
  const flush = (s) => { if (hi - lo > WOBBLE && isFinite(lo)) findings.push({ kind: 'wobble', name, s, v: hi - lo }); worstSpread = Math.max(worstSpread, isFinite(lo) ? hi - lo : 0); lo = Infinity; hi = -Infinity; };
  for (let s = 0; s < T.length; s += STEP) {
    // a point between two samples, so the quads between the vertices are tested too
    const i = Math.min(T.N - 1, Math.floor(s / T.ds)), j = (i + 1) % T.N, t = s / T.ds - i, L = (a, b) => a + (b - a) * t;
    const x = L(T.x[i], T.x[j]) + L(T.nx[i], T.nx[j]) * d, z = L(T.z[i], T.z[j]) + L(T.nz[i], T.nz[j]) * d, hRoad = L(T.h[i], T.h[j]);
    if (T.isBridge[i]) { prev = null; continue; }
    const hit = idx.at(x, z).filter(q => !PAINT.has(q.cat) && Math.abs(q.y - hRoad) < 1)[0];
    if (!hit) { prev = null; continue; }
    const rel = hit.y - hRoad, onTarmac = hit.cat === 'road' || hit.cat === 'pit';
    if (prev && Math.abs(rel - prev.rel) > 0.01 && !(prev.cat === 'kerb' || prev.cat === 'sausage' || hit.cat === 'kerb' || hit.cat === 'sausage')) {
      findings.push({ kind: 'step', name, s, v: rel - prev.rel, from: prev.cat, to: hit.cat });
    }
    if (onTarmac) { lo = Math.min(lo, rel); hi = Math.max(hi, rel); } else if (isFinite(lo)) flush(s);
    // a window of 25 m: the height may not wander by more than 8 mm inside it (flat quads on a tight bend twist by 6 mm at most)
    if (onTarmac && Math.round(s / STEP) % 100 === 99) flush(s);
    prev = { rel, cat: hit.cat };
  }
}

// the elevation profile itself
let minR = Infinity, minAt = 0;
for (let i = 5; i < T.N - 5; i++) {
  const k = Math.abs(T.vcurv[i]);
  if (k > 1e-9 && 1 / k < minR) { minR = 1 / k; minAt = T.s[i]; }
}

const by = k => findings.filter(f => f.kind === k);
console.log(`BUMP SCAN: wheel tracks at ±${WHEEL_D.toFixed(2)} m and the centreline, every ${STEP} m`);
console.log(`  steps over 1 cm off the kerbs: ${by('step').length}${by('step').length ? '   e.g. ' + by('step').slice(0, 3).map(f => `s=${f.s.toFixed(0)} ${f.name} ${(f.v * 1000).toFixed(0)} mm ${f.from}->${f.to}`).join('; ') : ''}`);
console.log(`  25 m windows on tarmac wobbling over 8 mm: ${by('wobble').length}   worst ${(worstSpread * 1000).toFixed(1)} mm`);
console.log(`  tightest vertical curve in the elevation data: radius ${minR.toFixed(0)} m at s=${minAt.toFixed(0)} (limit 300 m)`);
if (process.env.BUMPS_VERBOSE) for (const f of findings) console.log('   ', f.kind, f.name, `s=${f.s.toFixed(1)}`, (f.v * 1000).toFixed(1) + ' mm', f.from ? `${f.from}->${f.to}` : '');
const fails = [];
if (by('step').length) fails.push(`${by('step').length} steps over 1 cm`);
if (by('wobble').length) fails.push(`${by('wobble').length} windows over 8 mm`);
if (minR < 300) fails.push(`vertical curve radius ${minR.toFixed(0)} m is under 300 m`);
if (fails.length) { console.log('  FAILED:'); for (const f of fails) console.log('   - ' + f); process.exitCode = 1; } else console.log('  all clear');
