// Track limits test. Run with `npm run limits` (also part of `npm run check`). No browser needed.
// For each bollard corner the autopilot drives the corner twice: once on a line pushed over the kerb on the
// inside (a cut), once on the racing line. The cut must raise a warning at that corner, the racing line none.
import { buildTrack } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { limitZones, LIMIT_CORNERS, COOLDOWN } from '../src/trackLimits.js';

const track = buildTrack();
const racingLine = computeRacingLine(track);
const zones = limitZones();
const fails = [];
const wrap = (i, n) => ((i % n) + n) % n;

// a copy of the racing line pushed to `offset` metres from the centre over [from, to], eased in and out over 40 m
function cutLine(zone, offset) {
  const T = track, N = T.N, x = Float64Array.from(racingLine.x), z = Float64Array.from(racingLine.z);
  const ease = Math.round(40 / T.ds);
  const i0 = Math.round(zone.from / T.ds), i1 = Math.round(zone.to / T.ds);
  for (let i = i0 - ease; i <= i1 + ease; i++) {
    const k = wrap(i, N), w = Math.min(1, (i - (i0 - ease)) / ease, (i1 + ease - i) / ease);
    const f = w * w * (3 - 2 * w), d = racingLine.off[k] + (zone.side * offset - racingLine.off[k]) * f;
    x[k] = T.x[k] + T.nx[k] * d; z[k] = T.z[k] + T.nz[k] * d;
  }
  return { ...racingLine, x, z };
}

// drive from 150 m before the zone to 60 m after it; returns the warnings on that corner
function drive(zone, line) {
  const car = new Car(GT, track);
  car.setAssists(true);
  const timer = new LapTimer(track);
  car.placeAt(zone.from - 150, 0);
  const ap = new Autopilot(track, GT, { skill: 0.8, line });
  let t = 0;
  // start at speed so the run is short
  car.vx = Math.cos(car.heading) * 40; car.vz = Math.sin(car.heading) * 40; car.fwdSpeed = 40; car.speed = 40;
  while (car.loc.s < zone.to + 60 && t < 60) {
    car.step(ap.drive(car));
    t += STEP;
    timer.update(car.loc.s, t);
    timer.checkLimits(car, t);
  }
  return timer.limits.events.filter(e => e.corner === zone.name);
}

console.log('TRACK LIMITS (autopilot through each bollard corner)');
for (const name of LIMIT_CORNERS) {
  const zone = zones.find(z => z.name === name);
  if (!zone) { fails.push(`${name}: no zone`); continue; }
  const cut = drive(zone, cutLine(zone, track.halfWidth + 3));
  const clean = drive(zone, racingLine);
  console.log(`  ${name.padEnd(18)} cutting: ${cut.length} warning(s)${cut[0] ? ` at s ${cut[0].s.toFixed(0)}` : ''}   racing line: ${clean.length}`);
  if (cut.length < 1) fails.push(`${name}: cutting the inside gave no warning`);
  if (cut.length > 1 + Math.floor(40 / COOLDOWN)) fails.push(`${name}: cutting gave ${cut.length} warnings, expected about one per cut`);
  if (clean.length) fails.push(`${name}: the racing line gave ${clean.length} warning(s)`);
}

if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nPASS');
