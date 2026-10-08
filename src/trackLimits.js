// Track limits. A cut is a car on the INSIDE of a corner that is off the racing surface: at least three wheels on grass or
// gravel beyond the white line, or two wheels there with the car's centre on grass or gravel too (half the car off).
// Kerbs, sausage kerbs, run-off and the pit lane are not off the track (layout.js says the run-off is legal and the kerbs
// are placed for the apex), so a car that goes over them does not cut. One wheel hanging on the white line while the other
// three are off is a cut (the old rule let one wheel on the line exempt the whole car).
//
// Every cut is logged and counted: `timer.limits.events` holds the whole session, `timer.limits.countFor(lap)` the count for
// one lap, and a lap with a cut is invalid (src/timing.js). Only the on-screen banner is rate limited (COOLDOWN). Each cut
// also opens an excursion: when the car is back on the racing surface, the excursion is queued in `closed` with its entry
// and exit (time and s). In a race with the 'penalty' setting, session.js compares the time the excursion took with the
// car's best clean lap over the same stretch and penalises the gain (see timeGained and RaceTracker in session.js).
// Nothing is sent anywhere.

import { SURF, inRange } from './track.js';
import { CORNERS } from './corners.js';

// Every corner with an inside side gets a zone (generated from the corner data, so a new corner needs no list here).
// The zone is the apex +-12 m, widened to the inside kerbs. Street corners have walls on the inside, so a car cannot get
// beyond the line there and their zones never fire.
export function limitZones(corners = CORNERS) {
  const zones = [];
  for (const c of corners) {
    if (c.inside !== 'L' && c.inside !== 'R') continue;
    const apexes = c.apexes || [c.apexS];
    let a = Math.min(...apexes) - 12, b = Math.max(...apexes) + 12;
    for (const [k0, k1] of (c.kerbs && c.kerbs.inside) || []) { a = Math.min(a, k0); b = Math.max(b, k1); }
    zones.push({ name: c.name, side: c.inside === 'L' ? -1 : 1, from: a, to: b });   // d is negative on the left, positive on the right
  }
  return zones;
}
export const LIMIT_CORNERS = CORNERS.filter(c => c.inside === 'L' || c.inside === 'R').map(c => c.name);

export const COOLDOWN = 3;      // seconds before the same corner shows another banner (every cut is still counted)
export const TOLERANCE = 0.15;  // seconds: a gain this small or less is not penalised (tunable)
const WHEELS_OFF = 3;           // this many wheels off the racing surface make a cut (one wheel can hang on the line)
const OFF_TRACK = new Set([SURF.GRASS, SURF.GRAVEL]);   // the only surfaces beside the line that are not part of the track

// the cut test for the zone on side `side` (-1 left, 1 right), at the car's place now. Uses the wheel and centre positions
// relative to the white line (track.hw is the half width to the line) and the surface under each wheel (car.wheelSurf, from
// physics). Returns true for a cut (see the top of this file).
export function cutOnSide(car, side) {
  const T = car.track, { loc } = car, hw = car.cfg.trackWidth / 2, line = T.hw[loc.i];
  const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
  const fwdN = ch * loc.nx + sh * loc.nz, rightN = -sh * loc.nx + ch * loc.nz;   // as physics.js places the wheels
  const xs = [car.a, car.a, -car.b, -car.b], ys = [-hw, hw, -hw, hw];
  let off = 0;
  for (let w = 0; w < 4; w++) {
    const d = loc.d + xs[w] * fwdN + ys[w] * rightN;
    if (Math.sign(d) === side && Math.abs(d) > line && OFF_TRACK.has(car.wheelSurf[w])) off++;
  }
  if (off >= WHEELS_OFF) return true;
  // the centre alone is not enough: a centre over a narrow grass gap with every wheel on legal ground is not a cut
  return off >= 2 && Math.sign(loc.d) === side && Math.abs(loc.d) > line && OFF_TRACK.has(T.surfaceAt(loc.i, loc.d));
}

// The name of the corner the car is cutting right now, or null.
export function cutting(car, zones) {
  const s = car.loc.s, L = car.track.length;
  for (const z of zones) if (inRange(s, z.from, z.to, L) && cutOnSide(car, z.side)) return z.name;
  return null;
}

// The old test, kept for src/marshal.js (yellow flag for a car off the track): true when no wheel is on tarmac, paint or pit.
// Track limits use cutting() above instead, which counts run-off and kerbs as legal.
const racing = w => w === SURF.TARMAC || w === SURF.PAINT || w === SURF.PIT;
export function allWheelsBeyondLine(car) {
  return !car.wheelSurf.some(racing);
}

// Seconds the excursion gained against the car's best clean lap over the same stretch, or null when there is no reference
// (no clean lap yet, or the stretch crosses the line or is not a plain cut). Positive is a gain. `timer` is the LapTimer:
// its bestTrace is time into the lap at every metre, in lap order, the same trace the live delta uses. Reverse laps are
// mirrored in lap order, as the timer does.
export function timeGained(ex, timer) {
  const trace = timer.bestTrace, L = timer.track.length;
  if (!trace) return null;
  const lapS = s => timer.reverse ? (L - s) % L : s;
  const a = lapS(ex.s0), b = lapS(ex.s1), took = ex.t1 - ex.t0;
  if (b < a || b - a > 200 || took > 30) return null;   // crossed the line, a reset or a jump: no fair comparison
  const at = s => {
    const k = Math.floor(s), f = s - k, v0 = trace[k], v1 = trace[k + 1] ?? v0;
    return v0 + (v1 - v0) * f;
  };
  const ref = at(b) - at(a);
  return Number.isFinite(ref) ? ref - took : null;
}

export class TrackLimits {
  constructor(zones = limitZones()) {
    this.zones = zones;
    this.reset();
  }

  reset() {
    this.events = [];      // {corner, s, lapTime, lap, t} for the whole session, in order: every cut, none rate limited
    this.byLap = {};       // lap number -> number of cuts; lap 0 is the out lap
    this.lastShown = {};   // corner -> sim time its banner last showed
    this.open = null;      // the excursion under way: {corner, lap, t0, s0}
    this.closed = [];      // excursions that ended, not yet taken: {corner, lap, t0, s0, t1, s1}
    this.fresh = [];       // cuts not yet offered to the HUD
  }

  // call every physics step. `lap` is the lap being driven (0 for the out lap) and `lapTime` the time into it.
  // Returns the new cut when one starts on this step, else null.
  update(car, simTime, lap, lapTime) {
    const corner = cutting(car, this.zones), s = car.loc.s;
    if (corner && !this.open) {
      const ev = { corner, s, lapTime: lapTime == null ? 0 : lapTime, lap, t: simTime };
      this.events.push(ev);
      this.byLap[lap] = (this.byLap[lap] || 0) + 1;
      this.fresh.push(ev);
      this.open = { corner, lap, t0: simTime, s0: s };
      return ev;
    }
    if (!corner && this.open) {
      this.closed.push({ ...this.open, t1: simTime, s1: s });
      this.open = null;
    }
    return null;
  }

  countFor(lap) { return this.byLap[lap] || 0; }

  // the cuts to show as a banner now: at most one per corner every COOLDOWN seconds. The others are still in `events`.
  takeNew() {
    const shown = [];
    for (const ev of this.fresh) {
      const last = this.lastShown[ev.corner];
      if (last != null && ev.t - last < COOLDOWN) continue;
      this.lastShown[ev.corner] = ev.t;
      shown.push(ev);
    }
    this.fresh = [];
    return shown;
  }

  // the excursions that ended since the last call
  takeClosed() { const c = this.closed; this.closed = []; return c; }
}
