// Keyboard and gamepad. Returns one input object per frame:
//   { steer: -1..1 (right positive), throttle: 0..1, brake: 0..1, drs: bool }
// plus one-shot actions (reset, camera, camera-prev, line, settings, board-on and board-off for the Tab times board).

// Keyboard steering and pedals are eased in and out by inputModel.js, the
// same model the test drivers in tools/drivers.js use.
import { keyboardStep, toward, cursorSteer, CURSOR_RATE, KEY_THROTTLE_IN, KEY_BRAKE_IN, KEY_PEDAL_OUT } from './inputModel.js';
// Gamepad reading, rumble and the Controls screen live in gamepad.js (pure and tested by tools/gamepad.js).
import { readPad, newPadState, normaliseControllerSettings, pickPad, touchedPad, createRumbler, padCapture, openControlsOverlay, cleanName } from './gamepad.js';
import { saveSettings } from './settings.js';

const TOUCH_STEER_PX = 70;    // how far your thumb moves for full lock, in screen pixels
const TOUCH_STEER_RATE = 8;   // smoothing on touch steering, per second

// settings.steering is 'keyboard' or 'cursor' (read every frame, so the settings panel changes it live) and
// settings.steerSens the cursor sensitivity. hooks.boardAllowed() says whether Tab may show the times board
// (not while a panel is open, so Tab still moves between its buttons).
export function createInput(settings = {}, hooks = {}) {
  const keys = new Set();
  const actions = [];
  const state = { steer: 0, throttle: 0, brake: 0, drs: false, look: [0, 0] };
  let usingPad = false;
  const padSel = { index: -1 }, rumbler = createRumbler();
  let padState = newPadState(), padName = '', padKey = '';
  // hot plug: a pad that goes away hands the car back to the keyboard. Chrome only lists a pad after a button press.
  addEventListener('gamepaddisconnected', e => {
    const p = e.gamepad;
    if (p && p.index === padSel.index) { usingPad = false; padSel.index = -1; padState = newPadState(); padName = ''; padKey = ''; }
  });
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
      if (e.code === 'KeyL') actions.push('line');
      if (e.code === 'KeyM') actions.push('map');      // track map on or off
      if (e.code === 'KeyH') actions.push('hud');      // HUD preset: full, minimal, off
      if (e.code === 'KeyF') actions.push('fps');      // FPS and frame time readout
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

    // gamepad: left stick steers, triggers are the pedals, buttons as bound in settings.controller (see gamepad.js)
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { /* blocked by a permissions policy */ }
    const pad = pickPad(pads, padSel, touchedPad(pads));
    if (pad) {
      const key = pad.index + pad.id;
      if (key !== padKey) { padKey = key; padName = cleanName(pad.id); padState = newPadState(); }
      const cfg = normaliseControllerSettings(settings.controller);
      padState.speed = speed;
      const r = readPad(pad, cfg, padState, dt);
      if (r.active && !padCapture.active) usingPad = true;
      state.look = [r.axes[2], r.axes[3]];        // the right stick, for free look
      if (usingPad) {
        steer = r.steer; throttle = r.throttle; brake = r.brake;
        drs = drs || r.drs;
      }
      // pad actions are not read while a text field has focus, nor while the Controls screen is binding a button
      const ae = document.activeElement;
      const typingNow = !!ae && (ae.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName));
      if (!typingNow && !padCapture.active) for (const a of r.actions) actions.push(a);
      const car = hooks.car || (globalThis.lakeside && globalThis.lakeside.car);
      if (usingPad && car && !document.hidden && !(hooks.paused && hooks.paused())) rumbler.update(pad, cfg, car, performance.now());
      else rumbler.stop(pad);
    } else { padName = ''; padKey = ''; state.look = [0, 0]; }

    if (touch.active) {
      steer = toward(prev.steer, touch.steer, TOUCH_STEER_RATE, dt);
      throttle = toward(prev.throttle, touch.throttle, touch.throttle ? KEY_THROTTLE_IN : KEY_PEDAL_OUT, dt);
      brake = toward(prev.brake, touch.brake, touch.brake ? KEY_BRAKE_IN : KEY_PEDAL_OUT, dt);
      drs = drs || touch.drs;
    }

    state.steer = steer; state.throttle = throttle; state.brake = brake; state.drs = drs;
    return state;
  }

  // ?controls opens the Controls screen on its own, for testing. Remove this line when the menu has the tab.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('controls')) openControlsOverlay(settings, saveSettings);

  return {
    read,
    takeActions: () => actions.splice(0),
    get usingPad() { return usingPad; },
    get padName() { return padName; },     // the controller in use ('' if none), for the Controls screen
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
