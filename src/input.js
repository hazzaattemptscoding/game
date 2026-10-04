// Keyboard and gamepad. Returns one input object per frame:
//   { steer: -1..1 (right positive), throttle: 0..1, brake: 0..1, drs: bool }
// plus one-shot actions (reset, camera, settings).

// Keyboard pedals and steering are digital, so they are eased in and out to
// feel closer to a real wheel and pedals.
const KEY_STEER_IN = 3.2;     // how fast steering winds on, per second
const KEY_STEER_OUT = 6;      // how fast it centres when you let go
const KEY_THROTTLE_IN = 5;
const KEY_BRAKE_IN = 7;
const KEY_PEDAL_OUT = 10;

const TOUCH_STEER_PX = 70;    // how far your thumb moves for full lock, in screen pixels
const TOUCH_STEER_RATE = 8;   // smoothing on touch steering, per second

const PAD_DEADZONE = 0.08;
const PAD_CURVE = 1.4;        // above 1 = finer control near the centre of the stick

export function createInput() {
  const keys = new Set();
  const actions = [];
  const state = { steer: 0, throttle: 0, brake: 0, drs: false };
  let usingPad = false;
  let padButtonsPrev = [];

  addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!e.repeat) {
      if (e.code === 'KeyR') actions.push('reset');
      if (e.code === 'KeyC') actions.push('camera');
      if (e.code === 'Escape' || e.code === 'KeyP') actions.push('settings');
      if (e.code === 'F3' || e.code === 'KeyI') actions.push('debug');
    }
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(e.code)) e.preventDefault();
    usingPad = false;
  });
  addEventListener('keyup', e => keys.delete(e.code));

  // Touch: drag anywhere on the left half to steer, pedals on the right.
  const touch = createTouch(actions);
  addEventListener('blur', () => keys.clear());

  const toward = (v, target, rate, dt) => v + Math.max(-rate * dt, Math.min(rate * dt, target - v));

  function read(dt) {
    // keyboard
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 || Math.sign(target) !== Math.sign(state.steer) ? KEY_STEER_OUT : KEY_STEER_IN;
    let steer = toward(state.steer, target, rate, dt);
    let throttle = toward(state.throttle, up ? 1 : 0, up ? KEY_THROTTLE_IN : KEY_PEDAL_OUT, dt);
    let brake = toward(state.brake, down ? 1 : 0, down ? KEY_BRAKE_IN : KEY_PEDAL_OUT, dt);
    let drs = keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight');

    // gamepad (standard mapping): left stick steers, right trigger throttle, left trigger brake
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find(p => p && p.connected);
    if (pad) {
      const x = pad.axes[0] || 0;
      const stick = Math.abs(x) < PAD_DEADZONE ? 0 : Math.sign(x) * ((Math.abs(x) - PAD_DEADZONE) / (1 - PAD_DEADZONE)) ** PAD_CURVE;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (Math.abs(stick) > 0 || rt > 0.02 || lt > 0.02) usingPad = true;
      if (usingPad) {
        steer = stick; throttle = rt; brake = lt;
        drs = drs || !!(pad.buttons[0] && pad.buttons[0].pressed);
      }
      const pressed = i => pad.buttons[i] && pad.buttons[i].pressed && !padButtonsPrev[i];
      if (pressed(3)) actions.push('reset');      // Y / triangle
      if (pressed(2)) actions.push('camera');     // X / square
      if (pressed(9)) actions.push('settings');   // start / options
      padButtonsPrev = pad.buttons.map(b => b.pressed);
    }

    if (touch.active) {
      steer = toward(state.steer, touch.steer, TOUCH_STEER_RATE, dt);
      throttle = toward(state.throttle, touch.throttle, touch.throttle ? KEY_THROTTLE_IN : KEY_PEDAL_OUT, dt);
      brake = toward(state.brake, touch.brake, touch.brake ? KEY_BRAKE_IN : KEY_PEDAL_OUT, dt);
      drs = drs || touch.drs;
    }

    state.steer = steer; state.throttle = throttle; state.brake = brake; state.drs = drs;
    return state;
  }

  return {
    read,
    takeActions: () => actions.splice(0),
    get usingPad() { return usingPad; },
  };
}

// On-screen controls. Shown once the screen is touched.
function createTouch(actions) {
  const t = { active: false, steer: 0, throttle: 0, brake: 0, drs: false };
  const root = document.getElementById('touch');
  if (!root) return t;
  let steerId = null, steerX = 0;
  const knob = root.querySelector('.t-knob'), zone = root.querySelector('.t-steer');

  addEventListener('touchstart', () => {
    if (!t.active) { t.active = true; document.body.classList.add('touch'); }
  }, { passive: true });

  zone.addEventListener('pointerdown', e => {
    steerId = e.pointerId; steerX = e.clientX;
    zone.setPointerCapture(e.pointerId);
    knob.style.left = e.clientX + 'px'; knob.style.top = e.clientY + 'px';
    knob.classList.add('on');
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== steerId) return;
    t.steer = Math.max(-1, Math.min(1, (e.clientX - steerX) / TOUCH_STEER_PX));
    knob.style.transform = `translate(calc(-50% + ${t.steer * TOUCH_STEER_PX}px), -50%)`;
  });
  const endSteer = e => {
    if (e.pointerId !== steerId) return;
    steerId = null; t.steer = 0;
    knob.classList.remove('on'); knob.style.transform = '';
  };
  zone.addEventListener('pointerup', endSteer);
  zone.addEventListener('pointercancel', endSteer);

  for (const btn of root.querySelectorAll('[data-pedal]')) {
    const key = btn.dataset.pedal;
    const set = v => e => { e.preventDefault(); t[key] = v; btn.classList.toggle('on', !!v); };
    btn.addEventListener('pointerdown', set(key === 'drs' ? true : 1));
    btn.addEventListener('pointerup', set(key === 'drs' ? false : 0));
    btn.addEventListener('pointercancel', set(key === 'drs' ? false : 0));
    btn.addEventListener('pointerleave', set(key === 'drs' ? false : 0));
  }
  for (const btn of document.querySelectorAll('[data-action]')) {
    btn.addEventListener('click', () => actions.push(btn.dataset.action));
  }
  return t;
}
