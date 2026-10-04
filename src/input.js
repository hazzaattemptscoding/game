// Keyboard and gamepad. Returns one input object per frame:
//   { steer: -1..1 (right positive), throttle: 0..1, brake: 0..1, drs: bool }
// plus one-shot actions (reset, camera, settings, board-on and board-off for the Tab times board).

// Keyboard steering and pedals are eased in and out by inputModel.js, the
// same model the test drivers in tools/drivers.js use.
import { keyboardStep, toward, cursorSteer, CURSOR_RATE, KEY_THROTTLE_IN, KEY_BRAKE_IN, KEY_PEDAL_OUT } from './inputModel.js';

const TOUCH_STEER_PX = 70;    // how far your thumb moves for full lock, in screen pixels
const TOUCH_STEER_RATE = 8;   // smoothing on touch steering, per second

const PAD_DEADZONE = 0.08;
const PAD_CURVE = 1.4;        // above 1 = finer control near the centre of the stick

// settings.steering is 'keyboard' or 'cursor' (read every frame, so the settings panel changes it live) and
// settings.steerSens the cursor sensitivity. hooks.boardAllowed() says whether Tab may show the times board
// (not while a panel is open, so Tab still moves between its buttons).
export function createInput(settings = {}, hooks = {}) {
  const keys = new Set();
  const actions = [];
  const state = { steer: 0, throttle: 0, brake: 0, drs: false };
  let usingPad = false;
  let padButtonsPrev = [];
  let kbSteer = 0;             // the keyboard's own steering while the cursor is in charge, so the two can be added
  let cursor = { x: 0, inside: false, value: 0 };

  // typing in a note box, a select or any editable field never drives the car or fires a shortcut
  const typing = e => { const t = e.target; return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)); };
  addEventListener('keydown', e => {
    if (typing(e)) { keys.clear(); return; }
    if (!e.repeat) {
      if (e.code === 'KeyR') actions.push('reset');
      if (e.code === 'KeyC') actions.push('camera');
      if (e.code === 'Escape' || e.code === 'KeyP') actions.push('settings');
      if (e.code === 'F3' || e.code === 'KeyI') actions.push('debug');
      if (e.code === 'F2') actions.push('report');
    }
    if (e.code === 'Tab' && (!hooks.boardAllowed || hooks.boardAllowed())) {
      e.preventDefault();       // the browser must not move focus: Tab is the times board
      if (!e.repeat) actions.push('board-on');
      return;
    }
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2', 'F3'].includes(e.code)) e.preventDefault();
    usingPad = false;
  });
  addEventListener('keyup', e => {
    if (e.code === 'Tab') actions.push('board-off');
    if (!typing(e)) keys.delete(e.code);
  });

  // Cursor steering: the mouse position (not touch or pen). Leaving the window lets go of the steering.
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { cursor.x = e.clientX; cursor.inside = true; } });
  addEventListener('mouseout', e => { if (!e.relatedTarget) cursor.inside = false; });   // the pointer left the window

  // Touch: drag anywhere on the left half to steer, pedals on the right.
  const touch = createTouch(actions);
  addEventListener('blur', () => { keys.clear(); cursor.inside = false; actions.push('board-off'); });

  function read(dt, speed = 0) {
    // keyboard
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');
    const cursorMode = settings.steering === 'cursor';
    const prev = { steer: cursorMode ? kbSteer : state.steer, throttle: state.throttle, brake: state.brake };
    let { steer, throttle, brake } = keyboardStep({ ...prev }, { left, right, up, down }, dt, speed);
    if (cursorMode) {
      // the keys wind their own value as usual, the cursor adds to it, the sum is clamped
      kbSteer = steer;
      cursor.value = toward(cursor.value, cursor.inside ? cursorSteer(cursor.x, innerWidth, settings.steerSens || 1) : 0, CURSOR_RATE, dt);
      steer = Math.max(-1, Math.min(1, kbSteer + cursor.value));
    } else { kbSteer = steer; cursor.value = 0; }
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
      steer = toward(prev.steer, touch.steer, TOUCH_STEER_RATE, dt);
      throttle = toward(prev.throttle, touch.throttle, touch.throttle ? KEY_THROTTLE_IN : KEY_PEDAL_OUT, dt);
      brake = toward(prev.brake, touch.brake, touch.brake ? KEY_BRAKE_IN : KEY_PEDAL_OUT, dt);
      drs = drs || touch.drs;
    }

    state.steer = steer; state.throttle = throttle; state.brake = brake; state.drs = drs;
    return state;
  }

  return {
    read,
    takeActions: () => actions.splice(0),
    get usingPad() { return usingPad; },
    get cursorValue() { return cursor.value; },
    get device() { return usingPad ? 'gamepad' : touch.active ? 'touch' : 'keyboard'; },
    pressedKeys: () => [...keys],
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
