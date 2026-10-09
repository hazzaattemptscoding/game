// Touch, keyboard and mouse switching test. Run with `npm run touchinput`. No browser needed.
//   1. mergeTouch (src/inputModel.js): touch counts only while engaged; steering by size, pedals by max, DRS by OR
//   2. createInput with a fake window, document, navigator and clock: the real input.js code, driven by events
//      - a tap on the screen does not lock the keyboard and mouse out any more
//      - touch and keyboard together merge
//      - a real mouse move or click after the quiet period hides the on-screen controls; browser copies do not
//      - cursor steering still works after a touch, and a pad hands the controls back
import { createInput } from '../src/input.js';
import { mergeTouch } from '../src/inputModel.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('MERGE TOUCH');
{
  const kb = (o = {}) => ({ steer: 0, throttle: 0, brake: 0, drs: false, ...o });
  const off = { engaged: false, steer: -1, throttle: 1, brake: 1, drs: true };
  const on = (o = {}) => ({ engaged: true, steer: 0, throttle: 0, brake: 0, drs: false, ...o });
  const same = (a, b) => a.steer === b.steer && a.throttle === b.throttle && a.brake === b.brake && a.drs === b.drs;
  check(same(mergeTouch(kb({ steer: 0.2, throttle: 0.3, brake: 0.1, drs: true }), off), { steer: 0.2, throttle: 0.3, brake: 0.1, drs: true }), 'touch not engaged leaves the keyboard values exactly as they were');
  check(same(mergeTouch(kb({ steer: -0.4 }), null), { steer: -0.4, throttle: 0, brake: 0, drs: false }), 'no touch object is the keyboard unchanged');
  check(mergeTouch(kb({ steer: 0.5 }), on({ steer: 0.3 })).steer === 0.5, 'steering: the bigger keyboard value wins over a smaller touch');
  check(mergeTouch(kb({ steer: 0.2 }), on({ steer: 0.6 })).steer === 0.6, 'steering: a bigger touch wins');
  check(mergeTouch(kb({ steer: -0.9 }), on({ steer: 0.6 })).steer === -0.9, 'steering: a big left from the keys beats a right from touch (larger absolute value)');
  check(mergeTouch(kb({ steer: 0.3 }), on({ steer: -0.8 })).steer === -0.8, 'steering: a big left from touch beats a small right from the keys');
  check(mergeTouch(kb({ steer: 0.5 }), on({ steer: -0.5 })).steer === 0.5, 'steering: an exact tie keeps the keyboard');
  check(mergeTouch(kb({ steer: 0 }), on({ steer: 0 })).steer === 0, 'centred on both is centred');
  check(mergeTouch(kb({ throttle: 0.3 }), on({ throttle: 0.8 })).throttle === 0.8, 'throttle: the max, touch bigger');
  check(mergeTouch(kb({ throttle: 0.9 }), on({ throttle: 0.1 })).throttle === 0.9, 'throttle: the max, keyboard bigger');
  check(mergeTouch(kb({ throttle: 0.6 }), on({ throttle: 0 })).throttle === 0.6, 'a pedal that is not pressed does not pull the keyboard down');
  check(mergeTouch(kb({ brake: 0.2 }), on({ brake: 0.7 })).brake === 0.7 && mergeTouch(kb({ brake: 0.7 }), on({ brake: 0.2 })).brake === 0.7, 'brake: the max either way');
  check(mergeTouch(kb({ drs: false }), on({ drs: true })).drs === true, 'drs: touch alone opens it');
  check(mergeTouch(kb({ drs: true }), on({ drs: false })).drs === true, 'drs: the keys alone open it');
  check(mergeTouch(kb({ drs: false }), on({ drs: false })).drs === false, 'drs: neither, closed');
  check(mergeTouch(kb({ drs: true }), off).drs === true, 'drs: keys still count when touch is not engaged');
  const k = kb({ steer: 0.1 }); mergeTouch(k, on({ steer: 0.9 }));
  check(k.steer === 0.1, 'the keyboard object is not changed');
  check(near(mergeTouch(kb({ throttle: 0.25 }), on({ throttle: 0.5, brake: 0.5 })).throttle, 0.5), 'throttle and brake from touch do not leak into each other');
  check(mergeTouch(kb({ brake: 0 }), on({ throttle: 1 })).brake === 0, 'a throttle from touch does not make brake');
}

// ---- input level: a fake window, document, navigator and clock ----
let winListeners = [], pads = [], now = 1000, root = null, body = null, doc = null;
const classes = () => {
  const s = new Set();
  return { add: c => { s.add(c); }, remove: c => { s.delete(c); }, contains: c => s.has(c), toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; }, set: s };
};
const elm = () => {
  const ls = {};
  return { classList: classes(), style: {}, dataset: {}, addEventListener(t, f) { (ls[t] ||= []).push(f); }, fire(t, ev) { for (const f of ls[t] || []) f({ preventDefault() {}, ...ev }); }, setPointerCapture() {} };
};
const win = (type, ev = {}) => { for (const l of winListeners.slice()) if (l.type === type) l.fn({ preventDefault() {}, ...ev }); };
const padFor = axes => ({ id: 'Test pad', index: 0, connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });

Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true, writable: true });
globalThis.addEventListener = (type, fn) => { winListeners.push({ type, fn }); };
globalThis.innerWidth = 1000;

function setup(settings = {}) {
  winListeners = []; pads = []; now = 1000;
  root = { knob: elm(), zone: elm(), pedals: { throttle: elm(), brake: elm(), drs: elm() } };
  root.pedals.throttle.dataset.pedal = 'throttle';
  root.pedals.brake.dataset.pedal = 'brake';
  root.pedals.drs.dataset.pedal = 'drs';
  body = { classList: classes() };
  doc = {
    body, hidden: false, activeElement: null,
    getElementById: id => (id === 'touch' ? { querySelector: sel => (sel === '.t-knob' ? root.knob : root.zone), querySelectorAll: sel => (sel === '[data-pedal]' ? Object.values(root.pedals) : []) } : null),
    querySelectorAll: () => [],
  };
  globalThis.document = doc;
  const input = createInput({ steering: 'keyboard', steerSens: 1, ...settings }, {});
  const frame = (n = 1) => { let s; for (let i = 0; i < n; i++) s = input.read(1 / 60, 0); return s; };
  const key = (code, down = true) => win(down ? 'keydown' : 'keyup', { code, target: null, repeat: false });
  return { input, frame, key, touchOn: () => body.classList.contains('touch') };
}

console.log('TOUCH AND KEYBOARD');
{
  // a plain keyboard player is untouched
  const { input, frame, key, touchOn } = setup();
  key('ArrowRight');
  const s = frame(30);
  check(s.steer > 0.5 && input.device === 'keyboard' && !touchOn(), 'keyboard only: steers, device keyboard, no touch class');
}
{
  // the bug: one tap used to take the keyboard away for good
  const { input, frame, key, touchOn } = setup();
  win('touchstart', {});
  check(touchOn() && input.device === 'touch', 'a touch shows the controls and the device is touch');
  // a finger on the steer zone, dragged 70 px right: full lock to the right, eased in
  root.zone.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 500 });
  root.zone.fire('pointermove', { pointerId: 1, clientX: 170, clientY: 500 });
  const first = frame(1);
  check(first.steer > 0 && first.steer < 0.3, `touch steering eases in (first frame ${first.steer.toFixed(3)})`);
  check(frame(60).steer > 0.97, 'touch steering reaches full lock while the finger is down');
  root.zone.fire('pointerup', { pointerId: 1, clientX: 170, clientY: 500 });
  frame(60);
  const after = frame(1);
  check(near(after.steer, 0, 1e-9) && after.throttle === 0 && after.brake === 0, 'finger lifted: no steer, throttle or brake from touch');
  // now a keyboard key: the keyboard works again and the controls go
  key('ArrowRight');
  const kbFrames = frame(60);
  check(kbFrames.steer > 0.97, `keyboard steering follows the arrow after a tap (steer ${kbFrames.steer.toFixed(3)})`);
  check(!touchOn() && input.device === 'keyboard', 'a keydown hides the controls: body class gone, device keyboard');
}
{
  // a tap on the throttle pedal, then W: the throttle works (the old code held it at zero forever)
  const { input, frame, key, touchOn } = setup();
  win('touchstart', {});
  root.pedals.throttle.fire('pointerdown', { pointerId: 2 });
  frame(30);
  root.pedals.throttle.fire('pointerup', { pointerId: 2 });
  frame(60);
  key('KeyW');
  const w = frame(60);
  check(w.throttle > 0.97 && input.device === 'keyboard' && !touchOn(), `after a pedal tap, W gives the throttle (${w.throttle.toFixed(3)})`);
  key('KeyW', false);
  check(frame(60).throttle === 0, 'and lets go');
}
{
  // touch engaged and the keyboard at once: they merge, the bigger wins
  const { frame, key } = setup();
  win('touchstart', {});
  root.zone.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 500 });
  root.zone.fire('pointermove', { pointerId: 1, clientX: 135, clientY: 500 });   // half lock right from touch
  key('ArrowLeft');                                                             // full lock left from the keys
  const merged = frame(90);
  check(merged.steer < -0.97, `keys full left beat touch half right (steer ${merged.steer.toFixed(3)})`);
  key('ArrowLeft', false);
  const onlyTouch = frame(90);
  check(onlyTouch.steer > 0.45 && onlyTouch.steer < 0.55, `with the keys let go, touch alone gives half lock (${onlyTouch.steer.toFixed(3)})`);
  root.zone.fire('pointerup', { pointerId: 1, clientX: 135, clientY: 500 });
}
{
  // touch throttle held and W held together: the throttle is the max, and letting go of the pedal keeps W
  const { frame, key } = setup();
  win('touchstart', {});
  root.pedals.throttle.fire('pointerdown', { pointerId: 2 });
  key('KeyW');
  check(frame(60).throttle > 0.97, 'pedal and W together: full throttle');
  root.pedals.throttle.fire('pointerup', { pointerId: 2 });
  check(frame(60).throttle > 0.97, 'the pedal let go, W still gives full throttle');
  key('KeyW', false);
  check(frame(90).throttle === 0, 'nothing held, no throttle');
}
{
  // a pedal held with W, and the brake from the keys: brake from the keys is not lost to the pedal
  const { frame, key } = setup();
  win('touchstart', {});
  root.pedals.throttle.fire('pointerdown', { pointerId: 2 });
  key('KeyS');
  const b = frame(60);
  check(b.brake > 0.97 && b.throttle > 0.97, `keys brake while the pedal is down (brake ${b.brake.toFixed(3)}, throttle ${b.throttle.toFixed(3)})`);
  key('KeyS', false);
  root.pedals.throttle.fire('pointerup', { pointerId: 2 });
}
{
  // a pen does not flip the mode, and a modifier alone does not either; a virtual keyboard's blank code does not
  const { input, frame, key, touchOn } = setup();
  win('touchstart', {});
  now = 3000;
  win('pointermove', { pointerType: 'pen', clientX: 300 });
  win('pointerdown', { pointerType: 'pen' });
  check(touchOn() && input.device === 'touch', 'pen does not flip the controls');
  key('ShiftLeft');
  check(touchOn(), 'a modifier alone does not flip the controls');
  win('keydown', { code: '', target: null, repeat: false });
  check(touchOn(), 'a blank key code (a virtual keyboard) does not flip them');
  key('KeyA');
  check(!touchOn() && input.device === 'keyboard', 'a real key does');
  frame(1);
}

console.log('MOUSE AFTER TOUCH');
{
  // a touch, then mouse events: copies inside 500 ms are ignored, a real move after it hides the controls
  const { input, touchOn } = setup();
  now = 1000; win('touchstart', {});
  now = 1100; win('pointermove', { pointerType: 'mouse', clientX: 500 });
  check(touchOn(), 'a mouse move 100 ms after a touch is ignored');
  now = 1400; win('pointerdown', { pointerType: 'mouse' });
  check(touchOn(), 'a mouse click 400 ms after a touch is ignored');
  now = 1600; win('pointermove', { pointerType: 'mouse', clientX: 520 });
  check(!touchOn() && input.device === 'keyboard', 'a mouse move 600 ms after a touch hides the controls');
}
{
  // quiet period runs from the last touch event, touchend included
  const { input, touchOn } = setup();
  now = 1000; win('touchstart', {});
  now = 1050; win('touchend', {});
  now = 1400; win('pointermove', { pointerType: 'mouse', clientX: 500 });
  check(touchOn(), 'a mouse move 350 ms after the touch ended is still ignored');
  now = 1600; win('pointerdown', { pointerType: 'mouse' });
  check(!touchOn() && input.device === 'keyboard', 'a mouse click 550 ms after the touch ended hides the controls');
}
{
  // a mouse move with no touch before is nothing: the controls are only ever shown by a touch
  const { input, touchOn } = setup();
  now = 5000; win('pointermove', { pointerType: 'mouse', clientX: 500 });
  check(!touchOn() && input.device === 'keyboard', 'a mouse first does not show touch controls');
}
{
  // a mouse steering with the cursor after a touch: the cursor still steers, and the controls are back to the keyboard
  const { input, frame, touchOn } = setup({ steering: 'cursor', steerSens: 1 });
  now = 1000; win('touchstart', {});
  now = 2000; win('pointermove', { pointerType: 'mouse', clientX: 900 });
  const s = frame(120);
  check(!touchOn() && input.device === 'keyboard', 'cursor steering: the mouse hands the controls back');
  check(s.steer > 0.2, `cursor steering still works after a touch (mouse at the right, steer ${s.steer.toFixed(3)})`);
  check(input.cursorValue > 0.2, 'and the cursor value is there');
}
{
  // a pad in use hands the controls back, and a pad pushed on its own steers
  const { input, frame, touchOn } = setup();
  win('touchstart', {});
  pads = [padFor([1, 0])];
  const s = frame(60);
  check(!touchOn() && input.device === 'gamepad' && s.steer > 0.5, `a pad pushed hides the controls and steers (device ${input.device}, steer ${s.steer.toFixed(3)})`);
}

console.log(fails.length ? 'FAILED:\n  ' + fails.join('\n  ') : 'touchinput: all checks passed');
process.exitCode = fails.length ? 1 : 0;
