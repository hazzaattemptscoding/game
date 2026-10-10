// The venue planners' spatial lookups (src/trackNear.js) must give exactly what the plain loops over every barrier segment and
// track sample give. Random points over and around the circuit, near and far, with and without the bridge ignored.
import { buildTrack } from '../src/track.js';
import { wallClearance, nearBarrier } from '../src/trackNear.js';

const T = buildTrack();
function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}
function wallPlain(x, z, ignoreBridge) {
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
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
for (let i = 0; i < T.N; i++) { minx = Math.min(minx, T.x[i]); maxx = Math.max(maxx, T.x[i]); minz = Math.min(minz, T.z[i]); maxz = Math.max(maxz, T.z[i]); }
const fails = [];
for (let k = 0; k < 3000; k++) {
  const x = minx - 150 + rnd() * (maxx - minx + 300), z = minz - 150 + rnd() * (maxz - minz + 300);
  for (const ig of [false, true]) {
    const a = wallPlain(x, z, ig), b = wallClearance(T, x, z, ig);
    if (!Object.is(a, b)) fails.push(`wallClearance ${x.toFixed(1)},${z.toFixed(1)} ignoreBridge ${ig}: ${a} vs ${b}`);
  }
  for (const r of [2.5, 3, 5, 6, 20]) {
    const a = T.segs.some(sg => segDist(x, z, sg) < r), b = nearBarrier(T, x, z, r);
    if (a !== b) fails.push(`nearBarrier ${x.toFixed(1)},${z.toFixed(1)} r ${r}: ${a} vs ${b}`);
  }
}
console.log(fails.length ? 'FAIL\n  ' + fails.slice(0, 10).join('\n  ') : 'PASS near-track lookups match the plain loops (3000 points)');
process.exitCode = fails.length ? 1 : 0;
