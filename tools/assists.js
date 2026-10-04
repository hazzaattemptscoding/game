// Assists test. Run with `npm run assists` (also part of `npm run check`). No browser needed.
// Each assist must act on its own:
//   traction control only cuts drive when the rear tyres spin, ABS only the brake force that would lock a wheel,
//   stability control only the yaw (and a little drive) when the car rotates faster than its path.
// Three short manoeuvres on an endless flat car park, with each assist on alone, all on and all off.
// The GOLD figures were measured with the old single `assists` switch before it was split in three, so
// all on and all off must still match the old behaviour.
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { SURF } from '../src/track.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

function padCar() {
  const N = 10, flat = new Float64Array(N);
  const pad = {
    N, ds: 1, length: N, halfWidth: 1e6, x: flat, z: flat, h: flat, tx: new Float64Array(N).fill(1), tz: flat,
    nx: flat, nz: new Float64Array(N).fill(1), wall: [new Float64Array(N).fill(1e9), new Float64Array(N).fill(1e9)],
    locate: (x, z, h, o) => Object.assign(o, { i: 0, s: 0, d: 0, h: 0, grade: 0, vcurv: 0, tx: 1, tz: 0, nx: 0, nz: 1 }),
    surfaceAt: () => SURF.TARMAC, inDRS: () => false, pitWallIn: flat, inPitLimiter: () => false, pitSpeed: 99,
  };
  return new Car(GT, pad);
}

// each returns the inputs for one step; speeds in m/s
const MANOEUVRES = {
  launch: { speed: 6, time: 3, input: () => ({ steer: 0, throttle: 1, brake: 0 }) },                        // floor it in first gear: wheelspin
  brake: { speed: 60, time: 4, input: () => ({ steer: 0, throttle: 0, brake: 1 }) },                        // stamp on the brake: lock-up
  corner: { speed: 35, time: 7, input: (t, car) => ({ steer: t > 0.5 ? 1 : 0, throttle: t > 3 ? 1 : Math.max(0, Math.min(1, 0.4 + (35 - car.fwdSpeed) * 0.5)), brake: 0 }) },   // full lock, then gas: the tail steps out
};

function run(name, setup) {
  const m = MANOEUVRES[name], car = padCar();
  setup(car);
  car.vx = m.speed;
  const seen = { tc: 0, abs: 0, esc: 0, spin: 0, lock: 0 };
  for (let k = 0; k < m.time / STEP; k++) {
    car.step(m.input(k * STEP, car));
    for (const f in seen) if (car[f]) seen[f]++;
  }
  return { x: car.x, z: car.z, vx: car.vx, seen };
}
const same = (a, b) => a.x === b.x && a.z === b.z && a.vx === b.vx;
const near6 = (r, g) => Math.abs(r.x - g[0]) < 2e-6 && Math.abs(r.z - g[1]) < 2e-6 && Math.abs(r.vx - g[2]) < 2e-6;

const SETUPS = {
  none: c => c.setAssists(false), tc: c => c.setAssists({ tc: true, abs: false, esc: false }),
  abs: c => c.setAssists({ tc: false, abs: true, esc: false }), esc: c => c.setAssists({ tc: false, abs: false, esc: true }), all: c => c.setAssists(true),
};
const GOLD = {   // [x, z, vx] from the old physics, assists on and off
  launch: { on: [63.673212, 0, 34.269425], off: [63.437162, 0, 34.213149] },
  brake: { on: [91.664528, 0, -1.108057], off: [101.584503, 0, -0.109023] },
  corner: { on: [8.686142, 160.133524, -41.962398], off: [2.100368, 177.10098, -47.599139] },
};

console.log('ASSISTS');
const R = {};
for (const m in MANOEUVRES) {
  R[m] = {};
  for (const s in SETUPS) R[m][s] = run(m, SETUPS[s]);
  const r = R[m];
  console.log(`  ${m.padEnd(7)} ` + Object.keys(SETUPS).map(s => `${s} x ${r[s].x.toFixed(1)} vx ${r[s].vx.toFixed(1)}`).join('  |  '));
  check(near6(r.all, GOLD[m].on), `${m}: all on does not match the old assists-on result`);
  check(near6(r.none, GOLD[m].off), `${m}: all off does not match the old assists-off result`);
  // an assist that is off never lights its flag, and never shows another assist's flag
  for (const s of ['tc', 'abs', 'esc']) for (const f of ['tc', 'abs', 'esc']) if (f !== s) check(r[s].seen[f] === 0, `${m}: ${s} alone showed the ${f} flag`);
}
// traction control: more drive under wheelspin, no wheelspin left; ABS and stability control do nothing in a straight launch
check(R.launch.none.seen.spin > 0 && R.launch.tc.seen.tc > 0 && R.launch.tc.seen.spin === 0 && R.launch.tc.x > R.launch.none.x, 'launch: traction control alone should stop the wheelspin and gain distance');
check(same(R.launch.abs, R.launch.none) && same(R.launch.esc, R.launch.none), 'launch: ABS or stability control alone changed a straight launch');
// ABS: stops shorter without locking; traction control and stability control do nothing under straight braking
check(R.brake.none.seen.lock > 0 && R.brake.abs.seen.abs > 0 && R.brake.abs.seen.lock === 0 && R.brake.abs.x < R.brake.none.x, 'brake: ABS alone should stop the lock-up and the car should stop shorter');
check(same(R.brake.tc, R.brake.none) && same(R.brake.esc, R.brake.none), 'brake: traction control or stability control alone changed straight braking');
// stability control: corrects the yaw in the corner; ABS does nothing there (no brake), and its flag stays off
check(R.corner.esc.seen.esc > 0 && !same(R.corner.esc, R.corner.none), 'corner: stability control alone should step in and change the path');
check(same(R.corner.abs, R.corner.none), 'corner: ABS alone changed a corner with no braking');
// the helper and the old property
{
  const c = padCar();
  check(c.assistTc && c.assistAbs && c.assistEsc, 'a new car has all assists on');
  c.setAssists(false); check(!c.assistTc && !c.assistAbs && !c.assistEsc, 'setAssists(false)');
  c.setAssists({ abs: true }); check(!c.assistTc && c.assistAbs && !c.assistEsc, 'setAssists({abs}) leaves the others as they were');
  c.setAssists(true); check(c.assistTc && c.assistAbs && c.assistEsc, 'setAssists(true)');
  c.assists = false; check(!c.assistTc && !c.assistAbs && !c.assistEsc, 'old car.assists = false still works');
}

if (fails.length) { console.log('\nFAILED'); for (const f of fails) console.log('  ' + f); process.exit(1); }
console.log('  all passed');
