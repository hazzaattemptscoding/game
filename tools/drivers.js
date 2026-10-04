// Test drivers. Every tool that drives the car (laptest, cornersheet, audit)
// picks one of these profiles so the numbers match how people really play.
//
// The analog driver hands the autopilot's smooth steering straight to the
// car, like a wheel or a good pad player. The keyboard drivers (the Tapper)
// take what the autopilot wants and press or release keys the way a person
// does: late, in taps, a little off line, and braking in the wrong place. The
// key presses then go through src/inputModel.js, the same easing the game
// uses, before they reach car.step().

import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { keyboardStep } from '../src/inputModel.js';
import { Car, STEP } from '../src/physics.js';
import { SURF } from '../src/track.js';
import { LapTimer } from '../src/timing.js';

export const PROFILES = {
  analog: {
    label: 'Wheel or pad',
    keyboard: false,
  },
  good: {
    label: 'Keyboard, good',
    keyboard: true,
    reaction: 0.12,     // seconds between seeing something and pressing a key
    minHold: 0.06,      // shortest key press, seconds
    tapRate: 9,         // most new presses per second on one key
    steerBand: 0.12,    // steering this far from what you want before you press or let go
    aim: 0.3,           // steering wobble: how far the spot you aim at wanders, metres (small)
    brakeEarly: 0,      // metres before the ideal braking point, on average
    brakeSpread: 5,     // and the scatter either way, metres
    margin: 1.8,        // metres the racing line keeps from the white line (the analog driver keeps 1.4)
    skill: 0.88,        // share of the grip they dare to use (the analog driver uses 0.9)
  },
  average: {
    label: 'Keyboard, average',
    keyboard: true,
    reaction: 0.2,
    minHold: 0.09,
    tapRate: 7,
    steerBand: 0.12,
    aim: 0.6,           // medium
    brakeEarly: 8,
    brakeSpread: 15,
    margin: 2.2,        // metres the racing line keeps from the white line (the analog driver keeps 1.4)
    skill: 0.85,        // share of the grip they dare to use (the analog driver uses 0.9)
  },
  new: {
    label: 'Keyboard, new',
    keyboard: true,
    reaction: 0.28,
    minHold: 0.12,
    tapRate: 5,
    steerBand: 0.15,
    aim: 1.0,           // large
    brakeEarly: 25,
    brakeSpread: 15,
    margin: 2.6,        // metres the racing line keeps from the white line (the analog driver keeps 1.4)
    skill: 0.8,        // share of the grip they dare to use (the analog driver uses 0.9)
  },
};

const PEDAL_BAND = 0.2;   // pedals: press or release once the eased value is this far from what you want
const NOISE_TIME = 0.6;   // seconds the steering wobble takes to wander
const LINE_PULL = 1.4;    // how hard a driver steers back to the line, per metre off it (m/s2)
const LINE_DAMP = 2.2;    // and how much they check a drift towards it (per m/s)

const LINES = new WeakMap();   // racing lines by track and edge margin, worked out once

// Small seeded random numbers, so every run of a tool gives the same answer.
export function random(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
  return next;
}

// A driver for one car. drive(car) returns the input for car.step().
// `log` (optional) gets the key and pedal timeline.
export class Driver {
  constructor(track, cfg, profile = 'analog', { skill = 0.9, line, seed = 1 } = {}) {
    this.p = typeof profile === 'string' ? PROFILES[profile] : profile;
    // keyboard drivers keep further from the edges, so they get their own line
    if (this.p.keyboard) line = (LINES.get(track) || LINES.set(track, {}).get(track))[this.p.margin] ||= computeRacingLine(track, this.p.margin);
    this.ap = new Autopilot(track, cfg, { skill: this.p.skill ?? skill, line });
    this.rand = random(seed);
    this.t = 0;
    this.out = { steer: 0, throttle: 0, brake: 0, drs: true };
    this.keys = { left: false, right: false, up: false, down: false };
    this.since = { steer: -1, up: -1, down: -1 };          // when each key last changed
    this.pressedAt = { steer: -1, up: -1, down: -1 };      // when each key was last pressed
    this.queue = [];                                     // what the driver wanted, waiting out the reaction time
    this.noise = 0;
    this.braking = false;
    this.rollBrakePoint();
  }

  rollBrakePoint() {
    if (this.p.keyboard) this.ap.brakeEarly = this.p.brakeEarly + this.p.brakeSpread * Math.max(-2, Math.min(2, this.rand.normal()));
  }

  drive(car) {
    const want = this.ap.drive(car);
    if (!this.p.keyboard) return want;
    const p = this.p, dt = STEP;
    this.t += dt;

    // a new brake point error for every braking zone
    if (want.brake > 0.05 && !this.braking) this.braking = true;
    else if (want.brake === 0 && this.braking && want.throttle > 0.3) { this.braking = false; this.rollBrakePoint(); }

    // steering wobble: the spot the driver aims at wanders slowly from the line
    const k = dt / NOISE_TIME;
    this.noise += -this.noise * k + p.aim * Math.sqrt(2 * k) * this.rand.normal();

    // The bend ahead is seen coming, so the steering it needs is on time.
    // Getting back onto the line is a gentle correction, acted on
    // `reaction` seconds late (a person does not chase the line the way the
    // autopilot does).
    const ahead = this.planned(car);
    this.queue.push({ fix: this.correction(car, this.noise), throttle: want.throttle, brake: want.brake });
    const lag = Math.round(p.reaction / dt);
    const w = this.queue.length > lag ? this.queue.shift() : this.queue[0];
    const steer = Math.max(-1, Math.min(1, ahead + w.fix));

    // steering keys: press when the wheel is clearly short of where you want
    // it, hold until it goes a little past, then let go
    const cur = this.keys.right ? 1 : this.keys.left ? -1 : 0;
    const err = steer - this.out.steer, band = p.steerBand;
    let dir = cur;
    if (cur === 0) dir = err > band ? 1 : err < -band ? -1 : 0;
    else if (cur * err < -band / 2) dir = cur * err < -band ? -cur : 0;
    if (Math.abs(steer) > 0.97) dir = Math.sign(steer);          // asked for full lock: hold the key
    if (dir !== cur && this.canChange('steer', dir !== 0)) {
      this.keys.left = dir < 0; this.keys.right = dir > 0;
    }
    // pedals: on or off
    this.pedal('up', 'throttle', w.throttle);
    this.pedal('down', 'brake', w.brake);

    keyboardStep(this.out, this.keys, dt, car.speed);
    this.out.drs = want.drs;
    return this.out;
  }

  // the steering the racing line ahead asks for, before any correction
  planned(car) {
    const ap = this.ap, T = ap.track, cfg = ap.cfg, v = Math.max(car.fwdSpeed, 0);
    if (v < 8) return 0;
    const j = (car.loc.i + Math.round((6 + v * 0.4) / 2 / T.ds)) % T.N;
    const grip = cfg.grip * (9.81 + 0.5 * 1.225 * cfg.downforceArea * v * v / cfg.mass);
    return Math.max(-1, Math.min(1, 1.15 * ap.line.curv[j] * v * v / grip));
  }

  // steering that pulls the car back towards the racing line: a sideways
  // push in proportion to how far off it is and how fast it is drifting
  correction(car, wobble) {
    const ap = this.ap, T = ap.track, cfg = ap.cfg, L = ap.line, i = car.loc.i;
    const v = Math.max(car.fwdSpeed, 8);
    const offRate = (L.off[(i + 1) % T.N] - L.off[i]) / T.ds * v;
    const drift = car.vx * car.loc.nx + car.vz * car.loc.nz;
    const e = L.off[i] + wobble - car.loc.d, eRate = offRate - drift;
    const grip = cfg.grip * (9.81 + 0.5 * 1.225 * cfg.downforceArea * v * v / cfg.mass);
    const push = Math.max(-0.6 * grip, Math.min(0.6 * grip, LINE_PULL * e + LINE_DAMP * eRate));
    return 1.15 * push / grip;
  }

  pedal(key, name, wanted) {
    const err = wanted - this.out[name];
    let on = this.keys[key];
    if (wanted > 0.97 || err > PEDAL_BAND) on = true;
    else if (wanted < 0.03 || err < -PEDAL_BAND) on = false;
    if (on !== this.keys[key] && this.canChange(key, on)) this.keys[key] = on;
  }

  // a key can change once it has been held (or released) long enough, and
  // a new press has to wait for the tap rate
  canChange(key, pressing) {
    const t = this.t;
    if (t - this.since[key] < this.p.minHold) return false;
    if (pressing && t - this.pressedAt[key] < 1 / this.p.tapRate) return false;
    this.since[key] = t;
    if (pressing) this.pressedAt[key] = t;
    return true;
  }
}

// Drive `laps` flying laps (after an out lap) with one profile and count
// what happened. A car stopped for 3 s is put back on track, as a player
// would press R. `onStep(car, input, timer)` sees every step of the flying laps.
export function runLaps(track, cfg, profile, { assists = true, laps = 1, seed = 7, line, onStep } = {}) {
  const car = new Car(cfg, track);
  car.setAssists(assists);
  car.placeAt(-20, 0);
  const driver = new Driver(track, cfg, profile, { line, seed });
  const timer = new LapTimer(track);
  const r = { times: [], steps: 0, off: 0, wheelOff: 0, excursions: 0, hits: 0, slide: 0, resets: 0, top: 0, maxLat: 0, sectors: null };
  let t = 0, stopped = 0, onFor = 99, inFor = 99, hitGap = 99;
  while (timer.lap < laps + 1 && t < 300 * (laps + 1)) {
    const inp = driver.drive(car);
    car.step(inp);
    t += STEP;
    const before = timer.lap;
    timer.update(car.loc.s, t);
    if (timer.lap > before && timer.lap > 1) { r.times.push(timer.last); r.sectors = timer.lastSectors; }
    stopped = car.speed < 1 ? stopped + STEP : 0;
    if (stopped > 3) { car.resetToTrack(); r.resets++; stopped = 0; }
    if (timer.lap < 1) continue;
    r.steps++;
    r.top = Math.max(r.top, car.fwdSpeed);
    r.maxLat = Math.max(r.maxLat, Math.abs(car.ay) / 9.81);
    if (car.slipR > 1.5) r.slide++;
    // a wheel off: any wheel on grass or gravel after at least a second with
    // all four on. An excursion (leaving the track): both wheels on one side
    // on grass or gravel after at least a second without that.
    const offW = w => car.wheelSurf[w] === SURF.GRASS || car.wheelSurf[w] === SURF.GRAVEL;
    const off = offW(0) || offW(1) || offW(2) || offW(3), left = (offW(0) && offW(2)) || (offW(1) && offW(3));
    if (off) { r.off++; if (onFor > 1) r.wheelOff++; onFor = 0; } else onFor += STEP;
    if (left) { if (inFor > 1) { r.excursions++; (r.where ||= []).push(Math.round(car.loc.s / 10) * 10); } inFor = 0; } else inFor += STEP;
    // a hit: barrier contact after at least a second clear of one
    if (car.events.hit > 0.5) { if (hitGap > 1) r.hits++; hitGap = 0; } else hitGap += STEP;
    if (onStep) onStep(car, inp, timer, driver);
  }
  r.offShare = r.off / Math.max(1, r.steps);
  r.slideShare = r.slide / Math.max(1, r.steps);
  r.lap = r.times.length ? r.times[r.times.length - 1] : null;
  return r;
}
