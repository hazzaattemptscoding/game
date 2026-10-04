// Headless handling test. Run with `npm run laptest`. No browser needed.
//
// 1. Lap times: an autopilot drives Lakeside with the real physics at a few
//    skill levels, with assists on and off.
//      top     top speed
//      maxLat  peak cornering force in g
//      slide   share of the lap the rear tyres were well past their grip peak
//      off     share of the lap with a wheel on grass or gravel
//      hits    barrier contacts
//
// 2. Stability: on a flat open area the car is held at the cornering limit
//    with full lock, then the driver lifts, brakes or floors it without
//    touching the wheel. Prints the biggest body slip angle (how sideways
//    the car got). Under ~15 degrees means the car sorts itself out; a spin
//    shows as 90+. With assists on, everything should stay small.

import { buildTrack, SURF, BARRIER } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';

const fmt = t => t == null ? '--' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
const track = buildTrack();
const line = computeRacingLine(track);

console.log(`Lakeside: ${(track.length / 1000).toFixed(2)} km\n`);
console.log('LAP TIMES (lap 2, flying)');

const runs = [
  { name: 'quick driver, assists on ', skill: 0.9, assists: true },
  { name: 'steady driver, assists on', skill: 0.8, assists: true },
  { name: 'quick driver, assists off', skill: 0.86, assists: false },
];

for (const run of runs) {
  const car = new Car(GT, track);
  car.assists = run.assists;
  car.placeAt(-20, 0);
  const ap = new Autopilot(track, GT, { skill: run.skill, line });
  const timer = new LapTimer(track);
  let t = 0, top = 0, maxLat = 0, slide = 0, off = 0, hits = 0, n = 0;
  while (timer.lap < 2 && t < 400) {
    car.step(ap.drive(car));
    t += STEP;
    timer.update(car.loc.s, t);
    if (timer.lap < 1) continue;
    n++;
    top = Math.max(top, car.fwdSpeed);
    maxLat = Math.max(maxLat, Math.abs(car.ay) / 9.81);
    if (car.slipR > 1.5) slide++;
    if (car.wheelSurf.some(s => s === SURF.GRASS || s === SURF.GRAVEL)) off++;
    if (car.events.hit > 0.5) hits++;
  }
  const s = timer.lastSectors || [];
  const pct = v => (100 * v / Math.max(1, n)).toFixed(1) + '%';
  console.log(`  ${run.name}  ${fmt(timer.last)}  (S1 ${s[0]?.toFixed(2)}  S2 ${s[1]?.toFixed(2)}  S3 ${s[2]?.toFixed(2)})`);
  console.log(`      top ${(top * 2.23694).toFixed(0)} mph   maxLat ${maxLat.toFixed(2)} g   slide ${pct(slide)}   off ${pct(off)}   hits ${hits}`);
}

console.log('\nSTABILITY (biggest body slip after the input, degrees)');
console.log('  speed     lift   brake   floor it      assists');
for (const assists of [true, false]) {
  for (const v of [20, 30, 50, 65]) {
    const r = ['lift', 'brake', 'gas'].map(m => stability(v, m, assists).toFixed(0).padStart(5));
    console.log(`  ${String(Math.round(v * 2.23694)).padStart(3)} mph  ${r.join('   ')}         ${assists ? 'on' : 'off'}`);
  }
}

// Run-off cost: the car runs wide at 70 mph and stays flat out across 60 m
// of each surface. Gravel should cost far more than the green tarmac run-off.
console.log('\nRUNNING WIDE (60 m flat out from 70 mph)');
for (const [name, surf] of [['tarmac run-off', SURF.RUNOFF], ['grass', SURF.GRASS], ['gravel', SURF.GRAVEL]]) {
  const car = makePadCar(surf);
  car.vx = 31.3; car.speed = 31.3;
  let dist = 0, t = 0;
  while (dist < 60 && t < 20) {
    car.step({ steer: 0, throttle: 1, brake: 0, drs: false });
    dist += car.speed * STEP; t += STEP;
  }
  console.log(`  ${name.padEnd(15)} ${t.toFixed(2)} s, out at ${(car.speed * 2.23694).toFixed(0)} mph`);
}

// Safety checks (reference/LAKESIDE_SAFETY_LAYOUT.md). Any failure makes the
// test exit with an error.
console.log('\nSAFETY CHECKS');
const fails = [];
const hw = track.halfWidth;
// how far a point is from the nearest track edge (any part of the track at a similar height), kerbs included
const edgeGap = (x, z, y) => {
  let best = Infinity;
  for (let i = 0; i < track.N; i++) {
    if (Math.abs(track.h[i] - y) > 4) continue;
    const dx = x - track.x[i], dz = z - track.z[i];
    const along = dx * track.tx[i] + dz * track.tz[i];
    if (Math.abs(along) > 0.6) continue;
    const d = dx * track.nx[i] + dz * track.nz[i], sd = d < 0 ? 0 : 1;
    best = Math.min(best, Math.abs(d) - hw - track.kerb[sd][i] - track.sausage[sd][i]);
  }
  return best;
};
// 1. every corner's barrier is beyond the departure stopping points, or the corner says why not
for (const c of track.corners) {
  if (c.class === 'street' || !c.departures) continue;
  const deepest = Math.max(...c.departures.map(d => d.depth));
  if (c.barrier < deepest && !c.constrained) fails.push(`${c.name}: barrier ${c.barrier} m is inside the ${deepest} m stopping distance`);
  if (c.constrained && !c.reason) fails.push(`${c.name}: constrained with no reason given`);
  for (const sec of c.sections) if (sec.offset < deepest && !c.constrained) fails.push(`${c.name}: section at s=${sec.s} is ${sec.offset} m out, cars stop ${deepest} m out`);
}
// 2. no barrier within 4 m of the track edge, except the street section, the pit wall and the bridge
let closest = Infinity, pitClosest = Infinity;
for (const b of track.barriers) {
  if (b.type === BARRIER.CONCRETE || b.type === BARRIER.PARAPET) continue;
  for (const [x, y, z] of b.pts) {
    const gap = edgeGap(x, z, y);
    if (b.type === BARRIER.PITWALL) pitClosest = Math.min(pitClosest, gap);
    else closest = Math.min(closest, gap);
    if (gap < 4) fails.push(`${['armco', 'tyre wall', '', '', 'pit wall', 'pit outer wall'][b.type]} ${gap.toFixed(1)} m from the track edge at (${x.toFixed(0)}, ${z.toFixed(0)})`);
  }
}
// 3. the pit road never overlaps the racing surface
let overlap = 0;
for (let i = 0; i < track.N; i++) if (track.pitOut[i] && track.pitIn[i] < hw - 1e-6) overlap++;
if (overlap) fails.push(`pit road overlaps the track on ${overlap} samples`);
// 4. boards, posts and panels at least 30 m apart
const furn = track.furniture.filter(f => ['board', 'post', 'panel'].includes(f.type));   // signs only need 6 m
let pairs = 0;
for (let a = 0; a < furn.length; a++) for (let b = a + 1; b < furn.length; b++) {
  const dist = Math.hypot(furn[a].x - furn[b].x, furn[a].z - furn[b].z);
  if (dist < 30) { pairs++; fails.push(`${furn[a].type} ${furn[a].value} and ${furn[b].type} ${furn[b].value} are ${dist.toFixed(0)} m apart`); }
}
console.log(`  corners checked ${track.corners.filter(c => c.class !== 'street').length}, constrained ${track.corners.filter(c => c.constrained).length}`);
console.log(`  closest barrier to the track edge ${closest.toFixed(1)} m, closest pit wall ${pitClosest.toFixed(1)} m (both must be 4 m or more)`);
console.log(`  pit road overlap ${overlap} samples, boards ${furn.length} and signs ${track.furniture.length - furn.length}, boards too close together ${pairs}`);
if (fails.length) { console.log('  FAILED:'); for (const f of fails.slice(0, 30)) console.log('   - ' + f); process.exitCode = 1; }
else console.log('  all passed');

// Constant-radius test on an endless flat car park.
function stability(speed, mode, assists) {
  const car = makePadCar(SURF.TARMAC);
  car.assists = assists;
  car.vx = speed;
  let worst = 0;
  for (let k = 0; k < 7 / STEP; k++) {
    const t = k * STEP, v = car.fwdSpeed;
    const inp = { steer: t > 0.5 ? 1 : 0, throttle: Math.max(0, Math.min(1, 0.4 + (speed - v) * 0.5)), brake: 0, drs: false };
    if (t > 3) {
      inp.throttle = mode === 'gas' ? 1 : 0;
      if (mode === 'brake') inp.brake = 0.6;
    }
    car.step(inp);
    if (t > 3 && car.speed > 5) {
      const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
      const beta = Math.atan2(-car.vx * sh + car.vz * ch, car.vx * ch + car.vz * sh);
      worst = Math.max(worst, Math.abs(beta) * 57.3);
    }
  }
  return worst;
}

// A car on an endless flat area of one surface, with no barriers.
function makePadCar(surface) {
  const N = 10, flat = new Float64Array(N);
  const pad = {
    N, ds: 1, length: N, halfWidth: 1e6, x: flat, z: flat, h: flat, tx: new Float64Array(N).fill(1), tz: flat,
    nx: flat, nz: new Float64Array(N).fill(1), wall: [new Float64Array(N).fill(1e9), new Float64Array(N).fill(1e9)],
    locate: (x, z, h, o) => Object.assign(o, { i: 0, s: 0, d: 0, h: 0, grade: 0, vcurv: 0, tx: 1, tz: 0, nx: 0, nz: 1 }),
    surfaceAt: () => surface, inDRS: () => false,
    pitWallIn: flat, inPitLimiter: () => false, pitSpeed: 99,
  };
  return new Car(GT, pad);
}
