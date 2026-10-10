// Time trial start test. Run with `node tools/ttstart.js`. No browser needed.
//   1. the time trial starts on the circuit, standing, on the racing line, about 175 m before the Final Approach turn-in
//   2. the start pose is on tarmac, not in the pit lane, facing forward
//   3. a lap driven from that spot: the out lap runs through the last corner and over the line without the lap timer running,
//      the first timed lap starts at the line, and the out lap is not counted
//   4. practice and race starts are unchanged (the pit lane and the grid)
import { buildTrack, SURF } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { TT_START, ttSlot, pitSlot, gridSlot } from '../src/start.js';
import { makeSession } from '../src/session.js';
import racingLineData from '../src/racingLineData.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const track = buildTrack();
const L = track.length;
// the Final Approach turn-in: where the heading starts to bend hard after the Guardroom Chicane (the smoothed heading, measured)
const FINAL_TURN_IN = 3525;

console.log('TIME TRIAL START POSE');
const spot = ttSlot(track);
const gap = FINAL_TURN_IN - spot.s;
check(spot.s > 3241 && spot.s < FINAL_TURN_IN, `the start is before the last corner, after the Boundary Loop exit (s ${spot.s})`);
check(gap >= 150 && gap <= 200, `the start is 150 to 200 m before the Final Approach turn-in (${gap.toFixed(0)} m)`);
check(makeSession('timetrial').start === 'track', 'a time trial is started on the track');

const car = new Car(GT, track);
car.placeAt(spot.s, spot.d);
const i0 = car.loc.i;
check(track.pitOut[i0] === 0 && !track.pitLimiter[i0], 'the start is not in the pit lane');
check(track.surfaceAt(i0, car.loc.d) === SURF.TARMAC, `the start is on tarmac (surface ${track.surfaceAt(i0, car.loc.d)}, d ${car.loc.d.toFixed(2)})`);
check(Math.abs(car.loc.s - spot.s) < 0.5, `the car is where it was put (s ${car.loc.s.toFixed(2)})`);
check(car.speed === 0 && car.fwdSpeed === 0, 'the car stands still at the start');
const fwd = Math.atan2(track.tz[i0], track.tx[i0]);
check(Math.abs(Math.atan2(Math.sin(car.heading - fwd), Math.cos(car.heading - fwd))) < 0.01 && !car.reversed, 'the car faces forward, along the lap');
check(Math.abs(spot.d - racingLineData.d[i0]) < 1e-9 || Math.abs(spot.d) < 1, `the start is on the racing line (d ${spot.d.toFixed(2)})`);
console.log(`  start: s ${spot.s} m, d ${spot.d.toFixed(2)} m, ${gap.toFixed(0)} m before the Final Approach turn-in`);

console.log('OUT LAP AND FIRST TIMED LAP');
{
  const ap = new Autopilot(track, GT, { skill: 0.9, line: computeRacingLine(track) });
  car.setAssists(true);
  const timer = new LapTimer(track);
  let t = 0, sawFinal = false, startedAt = null, startedS = null, lapTimerEarly = false;
  timer.update(car.loc.s, t);
  while (t < 260 && timer.history.length < 1) {
    car.step(ap.drive(car));
    t += STEP;
    const s = car.loc.s, was = timer.lapStart;
    if (s >= FINAL_TURN_IN && s < FINAL_TURN_IN + 120 && was === null) sawFinal = true;
    timer.update(s, t);
    if (was === null && timer.lapStart !== null) {
      startedAt = t; startedS = s;
      if (s >= 200) lapTimerEarly = true;   // the timer may only start at the line, never mid-lap
    }
  }
  check(!lapTimerEarly, 'the lap timer does not run before the line');
  check(sawFinal, 'the out lap goes through the last corner (Final Approach) before the line');
  check(startedAt !== null && startedS < 200, `the lap timer starts at the line (crossed at s ${startedS === null ? 'none' : startedS.toFixed(1)})`);
  check(timer.history.length === 1, `the out lap is not counted; the first timed lap is (history ${timer.history.length})`);
  const lap = timer.history[0];
  if (lap) {
    check(lap.lap === 1 && lap.sectors.length === 3, 'the first timed lap is lap 1 with three sectors');
    check(lap.time > 80 && lap.time < 110, `the first timed lap is a full lap (${lap.time.toFixed(3)} s)`);
    check(lap.valid, 'the first timed lap is valid');
    console.log(`  out lap over the line at ${startedAt === null ? '-' : startedAt.toFixed(2)} s; first timed lap ${lap.time.toFixed(3)} s (valid ${lap.valid}, clean ${lap.clean}, sectors ${lap.sectors.map(v => v.toFixed(2)).join(' ')})`);
  }
}

console.log('PRACTICE AND RACE STARTS UNCHANGED');
{
  const T = track;
  const p = makeSession('practice');
  check(p.start === 'pit', 'practice still starts in the pit lane');
  const ps = pitSlot(T);
  const pi = Math.round(ps.s / T.ds) % T.N;
  check(T.pitOut[pi] > 0 && !T.pitLimiter[pi] && ps.d < 0, 'the practice pit slot is in the pit lane past the limiter');
  check(makeSession('race').start === 'standing' && makeSession('online').start === 'standing', 'races start on the grid');
  const g0 = gridSlot(T, 0);
  check(g0.s > T.length - 30 && g0.s < T.length, 'the grid slot is just before the line');
}

console.log(fails.length ? `FAILED\n  ${fails.join('\n  ')}` : 'ttstart: all checks passed');
process.exitCode = fails.length ? 1 : 0;
