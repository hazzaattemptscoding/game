// The start sequence, the grid, the cameras that go with it, and the clock helpers an online start needs.
// Everything here is plain JavaScript with no page and no WebGL, so tools/session.js tests it in node.
//
// Times are milliseconds on whatever clock the caller passes in (the game uses performance.now()), so a test can inject its own.
//
//   cinematic (3 s)  ->  lights: one red light every 0.9 s, 5 of them  ->  hold: all five lit for a random 0.6 to 2.8 s
//   ->  lights out and GO.  Throttle or movement (above 3 km/h) from the first light until lights out is a jump start: 5 s penalty.

export const START = {
  CINEMATIC_MS: 3000,
  LIGHT_MS: 900,
  LIGHTS: 5,
  HOLD_MIN_MS: 600,
  HOLD_MAX_MS: 2800,
  GO_SHOW_MS: 2200,        // how long GO stays on screen after lights out
  READY_MS: 3000,          // the time trial countdown: 3, 2, 1
  JUMP_KMH: 3,             // movement tolerance before lights out
  JUMP_THROTTLE: 0.1,      // throttle above this before lights out counts as a jump start
  PENALTY_S: 5,
  LEAD_MS: 1200,           // online: the sequence begins this long after the host decides, so the message has time to arrive
};

// a random hold between the two limits (random() returns 0 up to but not including 1)
export const pickHold = (random = Math.random) => START.HOLD_MIN_MS + random() * (START.HOLD_MAX_MS - START.HOLD_MIN_MS);

// ms from the start of the sequence to lights out
export const goOffset = hold => START.CINEMATIC_MS + (START.LIGHTS - 1) * START.LIGHT_MS + hold;

export class StartSequence {
  // o: { t0, hold, kind }. kind 'lights' is the race start, 'ready' the time trial countdown (no lights, no jump start).
  constructor({ t0 = 0, hold = START.HOLD_MIN_MS, kind = 'lights' } = {}) {
    this.kind = kind;
    this.t0 = t0;
    this.hold = hold;
    this.cinematic = kind === 'lights' ? START.CINEMATIC_MS : 0;
    this.goAt = kind === 'lights' ? t0 + goOffset(hold) : t0 + START.READY_MS;
    this.jump = null;          // { at, light, cause } once, if the driver jumped
    this.reaction = null;      // ms from lights out to the first throttle
  }

  // a sequence whose lights go out at `startAt` (an online start: startAt is already on this machine's clock)
  static lightsOut(startAt, hold) { return new StartSequence({ t0: startAt - goOffset(hold), hold, kind: 'lights' }); }

  // where the sequence is at `now`:
  // { phase: 'wait' | 'cinematic' | 'lights' | 'hold' | 'ready' | 'go' | 'done', lit: 0..5, count: 3..1 (ready only), released, el, cam: 0..1 }
  state(now) {
    const el = now - this.t0, released = now >= this.goAt;
    if (this.kind === 'ready') {
      if (el < 0) return { phase: 'wait', lit: 0, released: false, el, cam: 0, count: 3 };
      if (!released) return { phase: 'ready', lit: 0, released: false, el, cam: 0, count: Math.ceil((this.goAt - now) / 1000) };
      return { phase: now - this.goAt < START.GO_SHOW_MS ? 'go' : 'done', lit: 0, released: true, el, cam: 0, count: 0 };
    }
    if (el < 0) return { phase: 'wait', lit: 0, released: false, el, cam: 0 };
    const cam = Math.min(1, el / START.CINEMATIC_MS);
    if (el < START.CINEMATIC_MS) return { phase: 'cinematic', lit: 0, released: false, el, cam };
    const lit = Math.min(START.LIGHTS, Math.floor((el - START.CINEMATIC_MS) / START.LIGHT_MS) + 1);
    if (!released) return { phase: lit < START.LIGHTS ? 'lights' : 'hold', lit, released: false, el, cam: 1 };
    return { phase: now - this.goAt < START.GO_SHOW_MS ? 'go' : 'done', lit: 0, released: true, el, cam: 1 };
  }

  // Call every frame with the driver's raw throttle (0..1, before the lock) and the speed in km/h. Returns the jump start
  // record the first time it happens, otherwise null. Only the time from the first light to lights out counts.
  check(now, throttle, speedKmh) {
    if (this.kind !== 'lights') return null;
    const s = this.state(now);
    if (s.released) {
      if (this.reaction === null && throttle > START.JUMP_THROTTLE) this.reaction = Math.max(0, now - this.goAt);
      return null;
    }
    if (this.jump || s.lit < 1) return null;
    const cause = throttle > START.JUMP_THROTTLE ? 'throttle' : speedKmh > START.JUMP_KMH ? 'moving' : null;
    if (!cause) return null;
    this.jump = { at: now, light: s.lit, cause };
    return this.jump;
  }

  get penalty() { return this.jump ? START.PENALTY_S : 0; }

  // the game was paused for `ms`: the sequence waits (not used online, where the start is on the shared clock)
  shift(ms) { this.t0 += ms; this.goAt += ms; if (this.jump) this.jump.at += ms; }
}

// --- the grid ---

// Slot k on the start straight: staggered pairs, 8 m apart, left and right alternating (the painted slots in trackMesh.js).
// The car sits 2 m behind the painted line. Returns the place for Car.placeAt.
// reverse: the same distances on the other side of the start line, for the lap driven the other way round.
export function gridSlot(track, slot = 0, reverse = false) {
  const k = Math.max(0, Math.floor(slot) || 0);
  const L = track.length;
  const back = 12 + k * 8;
  return { s: ((((reverse ? back : -back)) % L) + L) % L, d: (k % 2 ? 1 : -1) * 3 };
}

// A place in the pit lane just after the garages, where the limiter ends: for the time trial and free practice.
// reverse: the other end of the limiter, for driving out of the pits the other way round (out through the entry road).
export function pitSlot(track, reverse = false) {
  const L = track.length, end = track.pitRange ? track.pitRange[reverse ? 0 : 1] : 0, g = reverse ? -1 : 1;
  let s = end, n = 0;
  while (n++ < 400) {                              // walk back from the exit to the last sample with the pit limiter on, then 6 m on
    const i = Math.floor((((s - g) % L) + L) % L / track.ds) % track.N;
    if (track.pitLimiter[i]) break;
    s -= g;
  }
  s += 6 * g;
  const i = Math.floor((((s) % L) + L) % L / track.ds) % track.N;
  return { s: ((s % L) + L) % L, d: -(track.pitIn[i] + track.pitOut[i]) / 2 };
}

// --- cameras (poses only: the caller turns them into a THREE camera) ---

const smooth = u => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

// The slow orbit behind the menu: round `c` ({x, y, z}) at `radius` and `height`, `rate` radians per second.
export function orbitPose(t, c, { radius = 48, height = 15, rate = 0.07, look = 1.2 } = {}) {
  const a = 0.6 + t * rate;
  return { pos: [c.x + Math.cos(a) * radius, c.y + height + Math.sin(t * 0.2) * 1.5, c.z + Math.sin(a) * radius], look: [c.x, c.y + look, c.z] };
}

// The start camera. u = 0..1 through the 3 s. It begins 60 m up the straight, 8 m up and to the side, looking back over the
// grid at the car, and swings in over the grid to a point 6.2 m behind and 1.9 m above it (the chase camera). `weight` is how
// much of this pose to use against the normal chase camera: 1 at the start, 0 at the end, so the hand-over has no jump.
// car: { x, y, z, heading } with heading in radians (x forward is cos, z forward is sin).
export function cinematicPose(u, car) {
  const e = smooth(u);
  const fx = Math.cos(car.heading), fz = Math.sin(car.heading), rx = -fz, rz = fx;
  const ahead = 60 - 66.2 * e, side = 9 * (1 - e), up = 1.9 + 7 * (1 - e) * (1 - e);
  return {
    pos: [car.x + fx * ahead + rx * side, car.y + up, car.z + fz * ahead + rz * side],
    look: [car.x - fx * 8 * (1 - e) + fx * 4 * e, car.y + 0.9, car.z - fz * 8 * (1 - e) + fz * 4 * e],
    weight: 1 - smooth((u - 0.65) / 0.35),
  };
}

// --- online: one start for everybody ---

// One clock sample. The guest sent its request at c0 (guest clock), the host stamped its reply h (host clock), the guest got
// it back at c1. The host clock reads (guest clock + offset). The host's stamp was taken about half way through the round trip.
export const sampleOffset = (c0, h, c1) => ({ rtt: c1 - c0, offset: h - (c0 + c1) / 2 });

// The best of a few samples: the one with the shortest round trip, because that one has the least room for lopsided delay.
// Returns { offset, rtt, n } or null with no usable sample.
export function estimateOffset(samples) {
  const ok = (samples || []).filter(s => s && Number.isFinite(s.offset) && Number.isFinite(s.rtt) && s.rtt >= 0);
  if (!ok.length) return null;
  const best = ok.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  return { offset: best.offset, rtt: best.rtt, n: ok.length };
}

// host clock -> this machine's clock, and back
export const toLocalTime = (hostTime, offset) => hostTime - offset;
export const toHostTime = (localTime, offset) => localTime + offset;

// The host decides at `hostNow` (its clock): the sequence begins LEAD_MS later and the lights go out at startAt, both in host time.
export function scheduleStart(hostNow, hold, lead = START.LEAD_MS) {
  const t0 = hostNow + lead;
  return { t0, startAt: t0 + goOffset(hold), hold };
}

// What a guest builds from the host's message: the sequence on its own clock. offset is null when no clock sample exists yet
// (then the guest trusts its own clock, which is off by however far the two clocks differ; the lobby measures first).
export function sequenceFromMessage(msg, offset) {
  return StartSequence.lightsOut(toLocalTime(msg.startAt, offset || 0), msg.hold);
}
