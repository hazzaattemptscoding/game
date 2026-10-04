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
