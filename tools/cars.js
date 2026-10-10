// Car classes tests (src/cars.js): every class has the numbers the GT has; front drive launches, spins with traction control off
// and holds with it on; the 108 never opens DRS; the lap times of each class are in their ranges on the autopilot; the car id
// goes round the state packet and defaults to the GT; personal bests and global times are kept per class.
// Run with `node tools/cars.js`. No browser needed.

import { buildTrack } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT, GT1, CITY, CARS, CAR_LIST, CAR_IDS, carById } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { encodeState, decodeState, packState, unpackState, stateFromCar, FIELDS, FLAG_DRS, Ghosts, PROTO } from '../src/ghosts.js';
import { migrateSettings } from '../src/settings.js';
import { bestKey } from '../src/board.js';
import { boardKey as gameBoardKey, boardFor, LABELS } from '../src/globalTimes.js';
import * as T from '../worker/src/times.js';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const fmt = t => t == null ? '--' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;

const track = buildTrack();
const line = computeRacingLine(track);

// ---- the classes ----
console.log('CLASSES');
{
  const keys = Object.keys(GT);
  for (const c of [GT1, CITY]) {
    const missing = keys.filter(k => !(k in c));
    check(missing.length === 0, `${c.id} has every field GT has (missing: ${missing.join(', ') || 'none'})`);
    const wrongType = keys.filter(k => typeof GT[k] !== typeof c[k] || Array.isArray(GT[k]) !== Array.isArray(c[k]));
    check(wrongType.length === 0, `${c.id} has the same kinds of values as GT (wrong: ${wrongType.join(', ') || 'none'})`);
    for (const k of keys) if (typeof GT[k] === 'number') check(Number.isFinite(c[k]), `${c.id}.${k} is a finite number`);
    check(typeof c.label === 'string' && c.label.length > 0, `${c.id} has a label`);
    check(c.drive === 'rear' || c.drive === 'front', `${c.id} drives a known axle`);
  }
  check(CITY.drive === 'front' && GT.drive === 'rear' && GT1.drive === 'rear', 'the 108 is front drive, the GT and GT1 rear drive');
  check(GT.hasDRS === true && GT1.hasDRS === true && CITY.hasDRS === false, 'DRS: GT and GT1 yes, the 108 no');
  check(JSON.stringify(CAR_IDS) === '["GT","GT1","CITY"]' && CAR_LIST.length === 3 && CARS.CITY === CITY, 'CARS, CAR_LIST and CAR_IDS list the three classes');
  check(carById('GT1') === GT1 && carById('CITY') === CITY && carById('nope') === GT && carById(undefined) === GT, 'carById: known ids, and unknown or missing is the GT');
  check(GT.id === 'GT' && GT1.id === 'GT1' && CITY.id === 'CITY', 'every class has its id');
  check(GT.yawInertia === 2300 && GT.mass === 1300 && GT.torqueCurve[0][1] === 330, 'the GT is unchanged');
}

// ---- physics: front drive ----
// a car at the start of the lap, straight, with the throttle held (or not) and the assists as given
// wet: the grip of the road (1 is dry). On a dry road the 108's first gear (about 4 kN at the front wheels) does not break the front
// tyres' grip (about 6 kN), so the wheelspin checks run on a wet road, where a small front-drive car does spin.
function launch(cfg, { seconds = 3, assists, throttle = 1, drs = false, s0 = -20, wet = 1 } = {}) {
  const car = new Car(cfg, track);
  car.setAssists(assists);
  car.wetGrip = wet;
  car.placeAt(s0, 0);
  const r = { spinSteps: 0, tcSteps: 0, maxSpeed: 0, drsSteps: 0 };
  for (let t = 0; t < seconds; t += STEP) {
    car.step({ steer: 0, throttle, brake: 0, drs });
    if (car.spin) r.spinSteps++;
    if (car.tc) r.tcSteps++;
    if (car.drs) r.drsSteps++;
    r.maxSpeed = Math.max(r.maxSpeed, car.fwdSpeed);
  }
  r.dist = car.loc.s;
  return r;
}
console.log('FRONT DRIVE');
{
  const front = launch(CITY, { assists: { tc: true, abs: true, esc: true }, seconds: 3 });
  const rearVersion = launch({ ...CITY, drive: 'rear' }, { assists: { tc: true, abs: true, esc: true }, seconds: 3 });
  console.log(`  108 launch, TC on: ${(front.maxSpeed * 3.6).toFixed(0)} km/h after 3 s (same car as rear drive: ${(rearVersion.maxSpeed * 3.6).toFixed(0)} km/h)`);
  check(front.maxSpeed > 8, `a front-drive car accelerates from rest (after 3 s: ${front.maxSpeed.toFixed(1)} m/s)`);
  check(Math.abs(front.maxSpeed - rearVersion.maxSpeed) < 4, 'front and rear drive launch about the same on a straight with the same power');
  const spun = launch(CITY, { assists: { tc: false, abs: true, esc: true }, seconds: 1.5, wet: 0.5 });
  console.log(`  108 full throttle from rest on a wet road, TC off: front wheels spinning for ${(spun.spinSteps * STEP).toFixed(2)} s in 1.5 s`);
  check(spun.spinSteps > 0, 'with traction control off, the front wheels spin on a wet launch');
  const held = launch(CITY, { assists: { tc: true, abs: true, esc: true }, seconds: 3, wet: 0.5 });
  console.log(`  108 full throttle from rest on a wet road, TC on: spinning for ${(held.spinSteps * STEP).toFixed(2)} s, traction control working for ${(held.tcSteps * STEP).toFixed(2)} s`);
  check(held.spinSteps === 0 && held.tcSteps > 0, 'with traction control on, the front tyres keep their grip and it works');
  check(launch(GT, { assists: { tc: true, abs: true, esc: true }, seconds: 3 }).spinSteps === 0, 'the GT still launches without spinning (rear drive unchanged)');
}

// ---- DRS ----
console.log('DRS');
{
  const zone = track.drs[0];
  const drsOpened = cfg => launch(cfg, { assists: true, seconds: 8, drs: true, s0: zone[0] - 20 }).drsSteps > 0;
  check(drsOpened(GT), 'control: the GT opens DRS in the zone');
  check(drsOpened(GT1), 'the GT1 opens DRS in the zone');
  check(!drsOpened(CITY), 'the 108 never opens DRS, even holding the button in the zone');
}

// ---- lap times on the autopilot ----
console.log('LAP TIMES (analog autopilot, lap 2, flying)');
function lapOf(cfg, skill) {
  const car = new Car(cfg, track); car.setAssists(true); car.placeAt(-20, 0);
  const ap = new Autopilot(track, cfg, { skill, line }), timer = new LapTimer(track);
  let t = 0;
  while (timer.lap < 2 && t < 500) { car.step(ap.drive(car)); t += STEP; timer.update(car.loc.s, t); }
  return timer.last;
}
{
  const g = lapOf(GT, 0.9), g1 = [lapOf(GT1, 0.9), lapOf(GT1, 0.8)], c = [lapOf(CITY, 0.9), lapOf(CITY, 0.8)];
  console.log(`  GT 0.9 ${fmt(g)}   GT1 0.9 ${fmt(g1[0])} 0.8 ${fmt(g1[1])}   CITY 0.9 ${fmt(c[0])} 0.8 ${fmt(c[1])}`);
  check(g != null && Math.abs(g - 90.117) < 0.01, `GT quick lap unchanged (${fmt(g)}, 1:30.117)`);
  check(g1.every(t => t != null && t >= 84.5 && t <= 88.5), `GT1 laps 1:24.5 to 1:28.5 (${g1.map(fmt).join(', ')})`);
  check(g1.every(t => t > 72.4), 'GT1 never below the 72.4 s floor');
  check(c.every(t => t != null && t >= 120 && t <= 140), `108 laps 2:00 to 2:20 (${c.map(fmt).join(', ')})`);
  check(g1[0] < g && c[0] > g, 'the GT1 is quicker than the GT, the 108 slower');
}

// ---- the car id on the wire ----
console.log('CAR ID ON THE STATE PACKET');
{
  check(FIELDS.length === 17, 'the state packet keeps its 17 fields');
  const fakeCar = cfg => ({ x: 1, y: 0, z: 2, heading: 0.3, vx: 10, vz: 1, yawRate: 0, steer: 0, wheelSpinAngle: 0, throttle: 1, brake: 0, groundPitch: 0, groundRoll: 0, drs: false, loc: { s: 500 }, cfg });
  for (const cfg of CAR_LIST) {
    const st = stateFromCar(fakeCar(cfg), 2, 'Ann', 1000, 90, 91);
    const back = decodeState(encodeState(st));
    check(back && back.car === cfg.id, `${cfg.id} round-trips through the JSON packet`);
    const bin = decodeState(unpackState(packState(encodeState(st))));
    check(bin && bin.car === cfg.id, `${cfg.id} round-trips through the binary packet`);
    const withDrs = decodeState(encodeState({ ...st, col: st.col | FLAG_DRS }));
    check(withDrs && withDrs.car === cfg.id && withDrs.drs === true, `${cfg.id} keeps its DRS flag beside it`);
  }
  // an old client sends no class bits: the car is a GT; an unknown class (index 3) or a value out of range is a GT too
  const old = decodeState(encodeState(stateFromCar(fakeCar(GT), 2, 'Ann', 1000)).map((v, i, a) => (i === 15 ? 0 : v)));
  check(old && old.car === 'GT', 'a packet with no class reads as a GT');
  check(decodeState(encodeState({ ...stateFromCar(fakeCar(GT), 2, 'Ann', 1000), col: 6 })).car === 'GT', 'class index 3 (not a class) reads as a GT');
  check(decodeState(encodeState({ ...stateFromCar(fakeCar(GT), 2, 'Ann', 1000), col: 9 })).car === 'GT', 'a flags value out of range reads as a GT');

  // a peer that never announced protocol 2 (an old build) sends a random colour 1..7 in col: that must not read as a class or DRS
  const seen = (proto, col) => {
    const g = new Ghosts(null);
    if (proto) g.setProto('p', proto);
    g.receive('p', decodeState(encodeState({ ...stateFromCar(fakeCar(GT), 2, 'Ann', 1000), col })), 0);
    return g.map.get('p');
  };
  for (let col = 1; col <= 7; col++) {
    const legacy = seen(0, col);
    check(legacy.carId === 'GT' && legacy.info.car === 'GT' && legacy.info.drs === false, `an old peer's colour ${col} reads as a GT with the DRS shut`);
  }
  // the same values from a peer that announced protocol 2 are flags
  const v2 = seen(PROTO, FLAG_DRS | (CAR_LIST.findIndex(c => c.id === 'GT1') << 1));
  check(v2.carId === 'GT1' && v2.info.drs === true, 'a v2 peer\'s col is class and DRS flags');
  check(seen(PROTO, CAR_LIST.findIndex(c => c.id === 'CITY') << 1).carId === 'CITY', 'a v2 peer can be a CITY');
  // an announcement made after the first state (the livery repeat) takes over from then on
  const late = new Ghosts(null);
  late.receive('p', decodeState(encodeState({ ...stateFromCar(fakeCar(GT), 2, 'Ann', 1000), col: 3 })), 0);
  late.setProto('p', PROTO);
  late.receive('p', decodeState(encodeState({ ...stateFromCar(fakeCar(GT), 2, 'Ann', 1033), col: 3 })), 33);
  check(late.map.get('p').info.drs === true, 'an announcement after the first state switches that peer to flags');
  late.remove('p');
  check(!late.hasFlags('p'), 'a peer that left forgets its announcement (the id may come back as an old client)');
}

// ---- per class: settings, personal bests, boards, lap limits ----
console.log('PER CLASS STORAGE AND BOARDS');
{
  check(migrateSettings({ car: 'CITY' }).car === 'CITY', 'settings keep a chosen class');
  check(migrateSettings({ car: 'NOPE' }).car === undefined, 'settings drop an unknown class (GT by default)');
  check(bestKey(false) === 'lakeside.best' && bestKey(true) === 'lakeside.best.reverse', 'the GT keeps its personal best keys');
  check(bestKey(false, 'CITY') !== bestKey(false, 'GT') && bestKey(false, 'GT1') !== bestKey(false, 'CITY'), 'each class has its own personal best list');
  const board = { weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'on' };
  check(gameBoardKey({ ...board, car: 'CITY' }) === 'dry-solo-fwd-on-city' && gameBoardKey(board) === 'dry-solo-fwd-on', 'the game names a class board apart from the GT board');
  check(boardFor({ weather: 'clear', online: false, reverse: false, assists: { tc: true }, car: 'CITY' }).car === 'CITY', 'a lap records the class it was driven in');
  check(boardFor({ weather: 'clear', online: false, reverse: false, assists: { tc: true } }).car === 'GT', 'a lap with no class is a GT lap');
  check(JSON.stringify(T.CAR_IDS) === JSON.stringify(CAR_IDS), 'the relay knows the same classes as src/cars.js');
  check(LABELS && T.BOARDS.length === 48 && new Set(T.BOARDS).size === 48, 'the relay has 48 boards, 16 for each class');
  check(T.carMinTime('GT') === T.LAP_MIN_TIME && T.carMinTime('GT1') === T.LAP_MIN_TIME, 'the GT and GT1 share the 72.4 s floor');
  check(T.carMinTime('CITY') > 90, `the 108 floor is well above a GT lap (${T.carMinTime('CITY').toFixed(1)} s)`);
  // the relay's time rules: a 108 at 75 s is refused for speed; a GT1 at 75 s is not (the ghost is checked after)
  const body = (car, time) => ({ name: 'Ann', board: { ...board, car }, car, time, sectors: [time / 3, time / 3, time - 2 * time / 3], token: 'a'.repeat(32), ghost: 'AAAA' });
  check(/too fast/.test(T.validateLap(body('CITY', 75)).error || ''), 'the relay refuses a 108 lap at 75 s as too fast');
  check(!/too fast/.test(T.validateLap(body('GT1', 75)).error || ''), 'the relay does not refuse a GT1 lap at 75 s for speed');
  check(!/too fast/.test(T.validateLap(body('GT', 75)).error || ''), 'the relay does not refuse a GT lap at 75 s for speed');
  check(T.validateLap(body('XX', 90)).error === 'unknown car', 'the relay refuses an unknown class');
}

console.log(fails ? `cars: ${fails} of ${passes + fails} checks FAILED` : `cars: all ${passes} checks passed`);
if (fails) process.exit(1);
