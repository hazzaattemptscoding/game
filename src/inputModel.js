// How key presses become steering and pedal values. Shared by the game
// (input.js) and every tool that drives like a keyboard player
// (tools/drivers.js), so the tests feel the same keys you do.
//
// Keys can only be pressed or released, so each value winds towards its
// target at a fixed rate instead of jumping.

export const KEY_STEER_IN = 3.2;     // how fast steering winds on, per second (full lock in about 0.3 s)
export const KEY_STEER_OUT = 6;      // how fast it centres when you let go, or swaps sides
// At speed a tap would be a lane change, so the steering winds on more slowly:
// full rate up to KEY_SLOW_FROM, falling to KEY_SLOW_SHARE of it at KEY_SLOW_AT.
export const KEY_SLOW_FROM = 100 / 3.6;   // m/s
export const KEY_SLOW_AT = 200 / 3.6;
export const KEY_SLOW_SHARE = 0.8;
export const KEY_THROTTLE_IN = 5;
export const KEY_BRAKE_IN = 7;
export const KEY_PEDAL_OUT = 10;

export const toward = (v, target, rate, dt) => v + Math.max(-rate * dt, Math.min(rate * dt, target - v));

// One step of the keyboard. `keys` is { left, right, up, down } as booleans,
// `speed` the car's speed in m/s. Updates and returns `state` ({ steer, throttle, brake }).
export function keyboardStep(state, keys, dt, speed = 0) {
  const target = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const slow = Math.min(1, Math.max(0, (speed - KEY_SLOW_FROM) / (KEY_SLOW_AT - KEY_SLOW_FROM)));
  const rate = target === 0 || Math.sign(target) !== Math.sign(state.steer) ? KEY_STEER_OUT : KEY_STEER_IN * (1 - (1 - KEY_SLOW_SHARE) * slow);
  state.steer = toward(state.steer, target, rate, dt);
  state.throttle = toward(state.throttle, keys.up ? 1 : 0, keys.up ? KEY_THROTTLE_IN : KEY_PEDAL_OUT, dt);
  state.brake = toward(state.brake, keys.down ? 1 : 0, keys.down ? KEY_BRAKE_IN : KEY_PEDAL_OUT, dt);
  return state;
}

// Cursor steering: the mouse's sideways position in the window is the steering. A small dead zone in the middle
// and a curve (above 1) keep the centre fine; the edges are full lock. `sens` scales it (1 = the edge is full lock,
// 2 = full lock halfway out). Returns -1..1, right positive.
export const CURSOR_DEADZONE = 0.04;   // share of half the window width
export const CURSOR_CURVE = 1.6;
export const CURSOR_RATE = 14;         // how fast the smoothed value follows the mouse, per second (0 to full lock in about 0.07 s)

export function cursorSteer(x, width, sens = 1) {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  const n = Math.max(-1, Math.min(1, (x - width / 2) / (width / 2)));
  const m = Math.abs(n) < CURSOR_DEADZONE ? 0 : (Math.abs(n) - CURSOR_DEADZONE) / (1 - CURSOR_DEADZONE);
  return Math.max(-1, Math.min(1, Math.sign(n) * m ** CURSOR_CURVE * sens));
}

// Touch and keyboard or mouse together. Touch only counts while it is engaged (a finger on the steer zone or a
// pedal). Then, per control, the bigger input wins: steering by size (keyboard wins a tie), throttle and brake by
// max, DRS by OR. When touch is not engaged the keyboard values come back unchanged.
export function mergeTouch(kb, touch) {
  const base = { steer: kb.steer, throttle: kb.throttle, brake: kb.brake, drs: !!kb.drs };
  if (!touch || !touch.engaged) return base;
  return {
    steer: Math.abs(touch.steer) > Math.abs(kb.steer) ? touch.steer : kb.steer,
    throttle: Math.max(kb.throttle, touch.throttle),
    brake: Math.max(kb.brake, touch.brake),
    drs: base.drs || !!touch.drs,
  };
}
