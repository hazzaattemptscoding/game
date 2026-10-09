// The DRS flap on the rear wing (src/car.js): how far it has opened, eased a frame at a time. Plain JavaScript with no DOM or
// WebGL, so tools/drsanim.js runs it in node.
//
// The flap opens in 160 ms and shuts in 220 ms. Each is an exponential ease-out: a frame closes the share 1 - exp(-dt / tau) of
// the gap to the target, with tau chosen so the flap is within 1 % of its target at the constant. It never passes the target, the
// result does not depend on the frame rate, and the frame time is clamped so a stall (a background tab) does not jump the flap.

export const OPEN_ANGLE = 28 * Math.PI / 180;   // the flap's angle at full open, radians
export const OPEN_MS = 160;                    // time to 99 % open
export const CLOSE_MS = 220;                   // time to 99 % shut
export const MAX_DT = 0.1;                     // longest frame time believed, seconds

const TAU_OPEN = OPEN_MS / 1000 / Math.log(100);
const TAU_CLOSE = CLOSE_MS / 1000 / Math.log(100);

// f: the flap now, 0 shut to 1 open. target: 0 or 1 (drs ? 1 : 0). dt: the frame time in seconds. Returns the new f.
export function stepFlap(f, target, dt) {
  const now = Number.isFinite(f) ? f : 0;
  const d = dt > 0 ? Math.min(dt, MAX_DT) : 0;       // NaN and negative times count as no time
  const tau = target > now ? TAU_OPEN : TAU_CLOSE;
  return now + (target - now) * (1 - Math.exp(-d / tau));      // dt of 0 returns f exactly
}

// The rotation of the flap about its hinge for a given f, radians (0 shut, OPEN_ANGLE open).
export const flapAngle = f => OPEN_ANGLE * Math.min(1, Math.max(0, f));
