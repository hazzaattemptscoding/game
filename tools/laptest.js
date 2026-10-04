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

import { buildTrack, SURF } from '../src/track.js';
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

// Constant-radius test on an endless flat car park.
function stability(speed, mode, assists) {
  const N = 10, flat = new Float64Array(N);
  const pad = {
    N, ds: 1, length: N, halfWidth: 1e6, x: flat, z: flat, h: flat, tx: new Float64Array(N).fill(1), tz: flat,
    nx: flat, nz: new Float64Array(N).fill(1), wall: [new Float64Array(N).fill(1e9), new Float64Array(N).fill(1e9)],
    locate: (x, z, h, o) => Object.assign(o, { i: 0, s: 0, d: 0, h: 0, grade: 0, vcurv: 0, tx: 1, tz: 0, nx: 0, nz: 1 }),
    surfaceAt: () => SURF.TARMAC, inDRS: () => false,
  };
  const car = new Car(GT, pad);
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
