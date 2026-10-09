// The DRS flap on the rear wing (src/car.js): how far it has opened, eased a frame at a time. Plain JavaScript with no DOM or
// WebGL, so tools/drsanim.js runs it in node.
//
// The flap sits angled at rest, the high downforce, high drag position: its trailing edge is raised REST_ANGLE above the main
// plane. When DRS is on the flap flattens to line up with the main plane (the low drag position). f is the flap's position,
// 0 at rest (angled) to 1 open (flat), and flapAngle gives how far the trailing edge is still raised.
//
// The flap opens in 160 ms and shuts in 220 ms. Each is an exponential ease-out: a frame closes the share 1 - exp(-dt / tau) of
// the gap to the target, with tau chosen so the flap is within 1 % of its target at the constant. It never passes the target, the
// result does not depend on the frame rate, and the frame time is clamped so a stall (a background tab) does not jump the flap.

export const REST_ANGLE = 22 * Math.PI / 180;  // the trailing edge's lift above the main plane at rest, radians
export const OPEN_MS = 160;                    // time to 99 % open
export const CLOSE_MS = 220;                   // time to 99 % shut (back to the angled rest position)
export const MAX_DT = 0.1;                     // longest frame time believed, seconds

const TAU_OPEN = OPEN_MS / 1000 / Math.log(100);
const TAU_CLOSE = CLOSE_MS / 1000 / Math.log(100);

// f: the flap now, 0 at rest to 1 open. target: 0 or 1 (drs ? 1 : 0). dt: the frame time in seconds. Returns the new f.
export function stepFlap(f, target, dt) {
  const now = Number.isFinite(f) ? f : 0;
  const d = dt > 0 ? Math.min(dt, MAX_DT) : 0;       // NaN and negative times count as no time
  const tau = target > now ? TAU_OPEN : TAU_CLOSE;
  return now + (target - now) * (1 - Math.exp(-d / tau));      // dt of 0 returns f exactly
}

// How far the trailing edge is still lifted above the main plane for a given f, radians (REST_ANGLE at rest, 0 when open).
export const flapAngle = f => REST_ANGLE * (1 - Math.min(1, Math.max(0, f)));
