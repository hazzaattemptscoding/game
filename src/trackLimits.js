// Track limits, first step: warnings only, no time penalty. A cut is all four wheels beyond the white line
// (anywhere that is not tarmac, edge paint or pit lane) on the INSIDE of one of the corners that have bollards,
// which are the places where cars are tempted to take a short cut. Each cut is recorded as an event so a
// future leaderboard can read them: `timer.limits.events` holds the whole session, `timer.limits.countFor(lap)`
// the count for one lap. Nothing is sent anywhere.

import { SURF } from './track.js';
import { CORNERS } from './corners.js';

// the same corners track.js puts bollards on (BOLLARD_CORNERS there)
export const LIMIT_CORNERS = ['Aileron', 'Rudder', 'Guardroom Chicane', 'Boundary Loop'];
export const COOLDOWN = 3;   // seconds before the same corner can warn again

// the stretch of each corner where a cut counts: its inside kerbs and the bollards (apex +-12 m), nothing on the approach
export function limitZones(corners = CORNERS) {
  const zones = [];
  for (const name of LIMIT_CORNERS) {
    const c = corners.find(k => k.name === name);
    if (!c) continue;
    const apexes = c.apexes || [c.apexS];
    let a = Math.min(...apexes) - 12, b = Math.max(...apexes) + 12;
    for (const [k0, k1] of (c.kerbs && c.kerbs.inside) || []) { a = Math.min(a, k0); b = Math.max(b, k1); }
    zones.push({ name, side: c.inside === 'L' ? -1 : 1, from: a, to: b });   // d is negative on the left, positive on the right
  }
  return zones;
}

const racing = w => w === SURF.TARMAC || w === SURF.PAINT || w === SURF.PIT;

// true when no wheel is on the racing surface
export function allWheelsBeyondLine(car) {
  return !car.wheelSurf.some(racing);
}

// the name of the bollard corner the car is cutting right now, or null
export function cutting(car, zones) {
  if (!allWheelsBeyondLine(car)) return null;
  const { s, d } = car.loc;
  for (const z of zones) if (s >= z.from && s <= z.to && Math.sign(d) === z.side) return z.name;
  return null;
}

export class TrackLimits {
  constructor(zones = limitZones()) {
    this.zones = zones;
    this.reset();
  }

  reset() {
    this.events = [];      // {corner, s, lapTime, lap} for the whole session, in order
    this.byLap = {};       // lap number -> number of warnings; lap 0 is the out lap
    this.last = {};        // corner -> sim time of its last warning
    this.inCut = false;
    this.fresh = [];       // events not yet shown by the HUD
  }

  // call every physics step. `lap` is the lap being driven (0 for the out lap) and `lapTime` the time into it.
  update(car, simTime, lap, lapTime) {
    const corner = cutting(car, this.zones);
    const entered = corner && !this.inCut;
    this.inCut = !!corner;
    if (!entered) return null;
    if (this.last[corner] != null && simTime - this.last[corner] < COOLDOWN) return null;
    this.last[corner] = simTime;
    const ev = { corner, s: car.loc.s, lapTime: lapTime == null ? 0 : lapTime, lap };
    this.events.push(ev);
    this.byLap[lap] = (this.byLap[lap] || 0) + 1;
    this.fresh.push(ev);
    return ev;
  }

  countFor(lap) { return this.byLap[lap] || 0; }
  takeNew() { const e = this.fresh; this.fresh = []; return e; }
}
