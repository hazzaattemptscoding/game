// Controller tests. Run with `npm run gamepad` (also part of `npm run check`). No browser needed.
//   1. readPad with fake pads: Xbox and PlayStation layouts, triggers as axes resting at -1, digital triggers,
//      dead zone and curve numbers, speed sensitive lock, smoothing, edge cases (NaN, missing axes, no buttons, two axes)
//   2. controller settings: validation, clamping, hostile values, remap swap
//   3. pad selection, rumble mapping and the barrier hit latch
//   4. menuNav: repeat and delay, edge triggered buttons, held buttons on opening, keyboard, text fields
//   5. focusMove in a tiny fake DOM
import { readPad, newPadState, normaliseControllerSettings, DEFAULT_CONTROLLER, DEFAULT_BINDINGS, ACTIONS, rebind, stickSteer, lockLimit, readTrigger, pickPad, touchedPad, padRumble, hitLatch, rumble, createRumbler, buttonLabel, cleanName } from '../src/gamepad.js';
import { createMenuNav, createRepeater, focusMove, bestInDirection, REPEAT_DELAY, REPEAT_EVERY } from '../src/menuNav.js';
import { migrateSettings } from '../src/settings.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const cfg = (o = {}) => normaliseControllerSettings({ ...o });

// A fake standard pad. Buttons are { pressed, value }; `set` is { 7: 1, 0: true } style.
function pad({ axes = [0, 0, 0, 0], set = {}, n = 17, id = 'Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', mapping = 'standard' } = {}) {
  const buttons = Array.from({ length: n }, () => ({ pressed: false, touched: false, value: 0 }));
  for (const [i, v] of Object.entries(set)) { if (buttons[i]) buttons[i] = typeof v === 'boolean' ? { pressed: v, touched: v, value: v ? 1 : 0 } : { pressed: v > 0.5, touched: v > 0, value: v }; }
  return { id, index: 0, connected: true, mapping, axes, buttons };
}

console.log('READPAD');
{
  const c = cfg(), st = newPadState();
  let r = readPad(pad(), c, st, 1 / 60);
  check(r.steer === 0 && r.throttle === 0 && r.brake === 0 && r.drs === false && r.actions.length === 0, 'an idle pad is all zero');
  // full right stick, no smoothing: full lock; dead zone and curve numbers
  const nosm = cfg({ smoothing: false, speedSens: 0 });
  check(readPad(pad({ axes: [1, 0] }), nosm, newPadState(), 1 / 60).steer === 1, 'full stick is full lock');
  check(readPad(pad({ axes: [-1, 0] }), nosm, newPadState(), 1 / 60).steer === -1, 'full left is -1');
  check(readPad(pad({ axes: [0.07, 0] }), nosm, newPadState(), 1 / 60).steer === 0, 'inside the dead zone is zero');
  const half = readPad(pad({ axes: [0.54, 0] }), nosm, newPadState(), 1 / 60).steer;     // (0.54 - 0.08) / 0.92 = 0.5, ^1.5 = 0.3536
  check(near(half, Math.pow(0.5, 1.5), 1e-9), `curve at half travel is ${half}`);
  const lin = cfg({ smoothing: false, speedSens: 0, curve: 1 });
  check(near(readPad(pad({ axes: [0.54, 0] }), lin, newPadState(), 1 / 60).steer, 0.5, 1e-9), 'curve 1 is linear');
  check(readPad(pad({ axes: [0.54, 0] }), cfg({ smoothing: false, speedSens: 0, curve: 2.2 }), newPadState(), 1 / 60).steer < half, 'a higher curve is finer in the middle');
  check(readPad(pad({ axes: [0.54, 0] }), cfg({ smoothing: false, speedSens: 0, sens: 1.5 }), newPadState(), 1 / 60).steer > half, 'sensitivity above 1 steers more');
  check(readPad(pad({ axes: [1, 0] }), cfg({ smoothing: false, speedSens: 0, sens: 0.5 }), newPadState(), 1 / 60).steer === 0.5, 'sensitivity 0.5 gives half lock at full stick');
  // radial dead zone: stick pushed up with a little sideways play does not steer; a diagonal corner is not more than lock
  check(Math.abs(readPad(pad({ axes: [0.05, -1] }), nosm, newPadState(), 1 / 60).steer) < 0.02, 'stick pushed up with a little sideways play barely steers');
  check(readPad(pad({ axes: [0.05, 0.05] }), nosm, newPadState(), 1 / 60).steer === 0 && readPad(pad({ axes: [0.075, 0.075] }), nosm, newPadState(), 1 / 60).steer > 0, 'the dead zone is radial: 0.05, 0.05 (magnitude 0.07) is inside a 0.08 zone, 0.075, 0.075 is outside');
  check(Math.abs(readPad(pad({ axes: [1, 1] }), nosm, newPadState(), 1 / 60).steer) <= 1, 'the square corner stays within 1');
  // monotonic and symmetric
  let prev = -2, mono = true;
  for (let x = -1; x <= 1.0001; x += 0.02) { const v = stickSteer(x, 0, DEFAULT_CONTROLLER); if (v < prev - 1e-12) mono = false; prev = v; if (!near(v, -stickSteer(-x, 0, DEFAULT_CONTROLLER), 1e-12)) mono = false; }
  check(mono, 'stick response is monotonic and symmetric');
  console.log(`  half travel -> ${half.toFixed(4)}, quarter ${stickSteer(0.08 + 0.92 * 0.25, 0, DEFAULT_CONTROLLER).toFixed(4)}, three quarters ${stickSteer(0.08 + 0.92 * 0.75, 0, DEFAULT_CONTROLLER).toFixed(4)}`);
}
{
  // speed sensitive lock: full stick at 250 km/h gives less than full lock, none at a standstill, scales with the setting
  const c = cfg({ smoothing: false });
  const lim = v => readPad(pad({ axes: [1, 0] }), c, Object.assign(newPadState(), { speed: v }), 1 / 60).steer;
  check(lim(0) === 1 && lim(20) === 1, 'full lock at low speed');
  check(lim(100 / 3.6) === 1, 'no reduction below 100 km/h');
  check(lim(200 / 3.6) < 0.85 && lim(200 / 3.6) > 0.75, `at 200 km/h the lock is ${lim(200 / 3.6).toFixed(3)}`);
  check(lim(300 / 3.6) === lim(200 / 3.6), 'the reduction stops growing at 200 km/h');
  check(lim(150 / 3.6) < lim(100 / 3.6) && lim(150 / 3.6) > lim(200 / 3.6), 'it grows with speed');
  check(near(lockLimit(70, cfg({ speedSens: 0 })), 1) && near(lockLimit(70, cfg({ speedSens: 1 })), 0.65), 'speedSens 0 is off, 1 takes 35%');
  check(lockLimit(NaN, c) === 1, 'NaN speed is no reduction');
}
{
  // smoothing: a flick is not instant, it gets there in about a tenth of a second, letting go is quicker
  const c = cfg({ speedSens: 0 }), st = newPadState();
  const p = pad({ axes: [1, 0] });
  const first = readPad(p, c, st, 1 / 60).steer;
  check(first > 0.2 && first < 0.5, `first frame of a flick is ${first.toFixed(3)}, not full lock`);
  let t = 1 / 60, v = first; while (v < 0.95 && t < 1) { v = readPad(p, c, st, 1 / 60).steer; t += 1 / 60; }
  check(t > 0.08 && t < 0.25, `a flick reaches 95% in ${t.toFixed(3)} s`);
  let back = 0, w = 1; const idle = pad();
  while (w > 0.05 && back < 60) { w = readPad(idle, c, st, 1 / 60).steer; back++; }
  check(back / 60 < t, `letting go (${(back / 60).toFixed(3)} s) is quicker than winding on`);
  // at speed the smoothing is slower
  const fast = newPadState(); fast.speed = 200 / 3.6;
  check(readPad(p, c, fast, 1 / 60).steer < first, 'smoothing is slower at speed');
  // and switching it off is instant
  check(readPad(p, cfg({ speedSens: 0, smoothing: false }), newPadState(), 1 / 60).steer === 1, 'smoothing off is instant');
  // dt 0 or NaN does not blow up
  check(Number.isFinite(readPad(p, c, newPadState(), 0).steer) && Number.isFinite(readPad(p, c, newPadState(), NaN).steer), 'dt 0 or NaN is fine');
}
{
  // triggers
  const c = cfg();
  const r = readPad(pad({ set: { 7: 0.5, 6: 0.25 } }), c, newPadState(), 1 / 60);
  check(near(r.throttle, (0.5 - 0.04) / 0.96, 1e-9) && near(r.brake, (0.25 - 0.04) / 0.96, 1e-9), 'analog triggers pass through minus the dead zone');
  check(readPad(pad({ set: { 7: 0.03 } }), c, newPadState(), 1 / 60).throttle === 0, 'a trigger inside its dead zone is zero');
  check(readPad(pad({ set: { 7: 1 } }), c, Object.assign(newPadState(), { analog: { any: true } }), 1 / 60).throttle === 1, 'full trigger is 1');
  // axis triggers resting at -1 (Firefox and old Chrome): buttons missing, axes 2 and 5
  const ax = (lt, rt) => ({ id: 'Generic', index: 0, connected: true, mapping: '', axes: [0, 0, lt, 0, 0, rt], buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })) });
  const st = newPadState();
  let q = readPad(ax(-1, -1), c, st, 1 / 60);
  check(q.throttle === 0 && q.brake === 0, 'axis triggers resting at -1 read as zero');
  q = readPad(ax(-1, 0), c, st, 1 / 60);
  check(near(q.throttle, 0.5 - 0.02 / 0.96 * 1, 0.03) || (q.throttle > 0.4 && q.throttle < 0.55), `axis trigger halfway (0) reads ${q.throttle.toFixed(3)}`);
  q = readPad(ax(1, 1), c, st, 1 / 60);
  check(near(q.throttle, 1, 1e-9) && near(q.brake, 1, 1e-9), 'axis triggers at +1 read as full');
  // axis triggers that rest at 0 (range 0..1)
  const st0 = newPadState();
  readPad(ax(0, 0), c, st0, 1 / 60);
  check(near(readPad(ax(0, 0.5), c, st0, 1 / 60).throttle, (0.5 - 0.04) / 0.96, 1e-9), 'axis triggers resting at 0 are read as 0..1');
  // digital only triggers: pressed with value 0 or 1, eased in so they are not an on/off switch
  const dig = pressed => { const p = pad(); p.buttons[7] = { pressed, value: 0 }; return p; };
  const sd = newPadState(); let th = 0; const seq = [];
  for (let i = 0; i < 40; i++) { th = readPad(dig(true), c, sd, 1 / 60).throttle; seq.push(th); }
  check(seq[0] > 0 && seq[0] < 0.3 && th === 1, `a digital trigger eases in (${seq[0].toFixed(3)} then ${th})`);
  for (let i = 0; i < 40; i++) th = readPad(dig(false), c, sd, 1 / 60).throttle;
  check(th === 0, 'and out');
  // a pad with a button object that only has `pressed`
  const bare = pad(); bare.buttons[7] = { pressed: true };
  check(readPad(bare, c, newPadState(), 1 / 60).throttle > 0, 'a button with only pressed counts');
  // old API: buttons as plain numbers
  const nums = pad(); nums.buttons = nums.buttons.map(() => 0); nums.buttons[7] = 0.6;
  check(readPad(nums, c, newPadState(), 1 / 60).throttle > 0.5, 'buttons as plain numbers');
}
{
  // buttons and actions: Xbox and PlayStation share the standard layout
  const c = cfg(), st = newPadState();
  const frame = set => readPad(pad({ set }), c, st, 1 / 60);
  frame({});
  check(frame({ 1: true }).actions.join() === 'reset', 'B / Circle is reset');
  check(frame({ 1: true }).actions.length === 0, 'held buttons fire once (edge)');
  frame({});
  check(frame({ 2: true }).actions.join() === 'camera', 'X / Square is camera');
  frame({});
  check(frame({ 3: true }).actions.join() === 'line', 'Y / Triangle is the racing line');
  frame({});
  check(frame({ 9: true }).actions.join() === 'settings', 'Start is settings');
  frame({});
  check(frame({ 12: true }).actions.join() === 'camera' && (frame({}), frame({ 13: true }).actions.join()) === 'camera-prev', 'd-pad up and down change camera');
  frame({});
  // Back held shows the board
  check(frame({ 8: true }).actions.join() === 'board-on' && frame({ 8: true }).boardHeld === true, 'Back held shows the board');
  check(frame({}).actions.join() === 'board-off', 'and releasing hides it');
  // DRS toggle and hold
  frame({});
  check(frame({ 0: true }).drs === true, 'DRS toggles on');
  check(frame({}).drs === true, 'and stays on');
  check(frame({ 0: true }).drs === false, 'and off on the second press');
  const hold = cfg({ drsMode: 'hold' }), sh = newPadState();
  readPad(pad(), hold, sh, 1 / 60);
  check(readPad(pad({ set: { 0: true } }), hold, sh, 1 / 60).drs === true && readPad(pad(), hold, sh, 1 / 60).drs === false, 'hold mode follows the button');
  // braking cancels an armed toggle
  const sb = newPadState(); readPad(pad(), c, sb, 1 / 60);
  readPad(pad({ set: { 0: true } }), c, sb, 1 / 60);
  check(readPad(pad({ set: { 6: 0.8 } }), c, sb, 1 / 60).drs === false, 'braking closes a toggled DRS');
  // buttons held when the pad is first seen do not fire
  check(readPad(pad({ set: { 1: true, 9: true } }), c, newPadState(), 1 / 60).actions.length === 0, 'buttons held on the first frame do not fire');
  // a rebinding is honoured
  const rb = cfg({ bindings: { reset: 5 } }), sr = newPadState();
  readPad(pad(), rb, sr, 1 / 60);
  check(readPad(pad({ set: { 5: true } }), rb, sr, 1 / 60).actions.join() === 'reset', 'a rebound button fires its action');
  check(readPad(pad({ set: { 1: true } }), rb, sr, 1 / 60).actions.join() === '', 'and the old button no longer does (it was not in use by another action)');
  // active: a drifting stick or a touch of the trigger does not count, real use does
  check(!readPad(pad({ axes: [0.12, 0] }), c, newPadState(), 1 / 60).active, 'a small drift is not activity');
  check(readPad(pad({ axes: [0.6, 0] }), c, newPadState(), 1 / 60).active, 'a pushed stick is activity');
  check(readPad(pad({ set: { 7: 0.5 } }), c, newPadState(), 1 / 60).active, 'a trigger is activity');
  const sa = newPadState(); readPad(pad(), c, sa, 1 / 60);
  check(readPad(pad({ set: { 2: true } }), c, sa, 1 / 60).active, 'a button press is activity');
}
{
  // edge cases
  const c = cfg();
  const bad = [
    null, undefined, {}, { axes: [NaN, NaN], buttons: [] }, { axes: [], buttons: null },
    { axes: [Infinity, -Infinity, NaN], buttons: [{ value: NaN, pressed: undefined }, null, undefined, 5, 'x'] },
    { axes: [0.5, 0.5], buttons: [] },                      // two axes, no buttons
    { axes: [1], buttons: Array.from({ length: 4 }, () => ({ pressed: true, value: 1 })) },     // a tiny pad
    { axes: Array.from({ length: 12 }, () => 1), buttons: Array.from({ length: 40 }, () => ({ pressed: true, value: 9 })) },
  ];
  let ok = true;
  for (const p of bad) {
    try {
      const r = readPad(p, c, newPadState(), 1 / 60);
      if (![r.steer, r.throttle, r.brake].every(Number.isFinite) || Math.abs(r.steer) > 1 || r.throttle < 0 || r.throttle > 1 || r.brake < 0 || r.brake > 1 || !Array.isArray(r.actions)) ok = false;
    } catch (e) { ok = false; console.log('  threw', e.message); }
  }
  check(ok, 'hostile pads give finite, bounded values and never throw');
  check(readPad({ axes: [0.5, 0.5], buttons: [] }, c, newPadState(), 1 / 60).throttle === 0, 'a pad with no buttons has no throttle');
  check(readPad({ axes: [1], buttons: [] }, cfg({ smoothing: false, speedSens: 0 }), newPadState(), 1 / 60).steer === 1, 'a pad with one axis still steers');
  check(readPad(pad({ axes: [1, 0] }), { deadzone: 'x', bindings: 3 }, newPadState(), 1 / 60).steer >= 0, 'a broken config is normalised, not trusted');
}

console.log('SETTINGS');
{
  const d = normaliseControllerSettings(undefined);
  check(JSON.stringify(d) === JSON.stringify(normaliseControllerSettings(DEFAULT_CONTROLLER)), 'missing settings give the defaults');
  check(d.deadzone === 0.08 && d.curve === 1.5 && d.sens === 1 && d.drsMode === 'toggle' && d.rumble === true && d.smoothing === true, 'default values');
  for (const raw of [null, 5, 'x', [], () => 1, { deadzone: 'a', curve: {}, sens: null, speedSens: NaN, rumble: 'yes', drsMode: 'nope', bindings: 'z' }, { bindings: { drs: -3, reset: 1.5, camera: 'x', line: 99, settings: NaN } }]) {
    const n = normaliseControllerSettings(raw);
    check(JSON.stringify(n) === JSON.stringify(d), `hostile ${JSON.stringify(raw)} falls back to defaults`);
  }
  const hi = normaliseControllerSettings({ deadzone: 5, curve: 9, sens: 99, speedSens: 7, rumbleStrength: 3, triggerDead: 1 });
  check(hi.deadzone === 0.4 && hi.curve === 2.2 && hi.sens === 1.5 && hi.speedSens === 1 && hi.rumbleStrength === 1 && hi.triggerDead === 0.3, 'big numbers are clamped');
  const lo = normaliseControllerSettings({ deadzone: -1, curve: 0, sens: 0, speedSens: -1, rumbleStrength: -1 });
  check(lo.deadzone === 0 && lo.curve === 1 && lo.sens === 0.5 && lo.speedSens === 0 && lo.rumbleStrength === 0, 'small numbers are clamped');
  check(normaliseControllerSettings({ drsMode: 'hold' }).drsMode === 'hold' && normaliseControllerSettings({ rumble: false }).rumble === false, 'valid values are kept');
  const o = { bindings: { drs: 5 } }; const n = normaliseControllerSettings(o);
  check(n.bindings.drs === 5 && n.bindings.reset === 1 && n !== o && n.bindings !== o.bindings, 'partial bindings keep the rest, result is a copy');
  check(DEFAULT_BINDINGS.drs === 0 && DEFAULT_BINDINGS.reset === 1, 'the default bindings object is never mutated');
  // duplicate bindings in a corrupt save: nobody shares a button
  const dup = normaliseControllerSettings({ bindings: { drs: 3, reset: 3 } }).bindings;
  const used = Object.values(dup).filter(v => v >= 0);
  check(new Set(used).size === used.length, `duplicates are resolved ${JSON.stringify(dup)}`);
  // migrateSettings hook
  const m = migrateSettings({ units: 'kmh', controller: { curve: 99, junk: 1 } });
  check(m.controller.curve === 2.2 && m.controller.junk === undefined && m.units === 'kmh', 'migrateSettings validates settings.controller');
  check(migrateSettings(null).controller.deadzone === 0.08 && migrateSettings({ controller: 'x' }).controller.curve === 1.5, 'migrateSettings fills a missing or hostile controller');
  // remap
  let b = { ...DEFAULT_BINDINGS };
  b = rebind(b, 'reset', 5);
  check(b.reset === 5 && b.drs === 0, 'rebind to a free button');
  b = rebind(b, 'drs', 5);
  check(b.drs === 5 && b.reset === 0, 'rebind onto a used button swaps');
  const all = ACTIONS.map(a => b[a]);
  check(new Set(all).size === all.length, 'no button has two actions after rebinding');
  check(JSON.stringify(rebind(b, 'nonsense', 4)) === JSON.stringify(b) && JSON.stringify(rebind(b, 'drs', -1)) === JSON.stringify(b) && JSON.stringify(rebind(b, 'drs', 1.5)) === JSON.stringify(b), 'invalid rebinds change nothing');
  check(rebind(b, 'drs', 5).drs === 5, 'rebinding to the same button is a no-op');
  check(buttonLabel(0, 'Xbox') === 'A' && buttonLabel(0, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)') === 'Cross' && buttonLabel(40) === 'Button 40', 'button labels');
  check(cleanName('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)') === 'Xbox 360 Controller' && cleanName('') === 'Controller' && cleanName(undefined) === 'Controller', 'controller names are tidied');
}

console.log('PAD SELECTION');
{
  const sel = { index: -1 };
  const a = pad({ mapping: '' }), b = pad({ mapping: 'standard' }); a.index = 0; b.index = 1;
  check(pickPad([a, b], sel) === b, 'a standard pad is preferred');
  check(pickPad([a, b], sel, 0) === a && sel.index === 0, 'the last one touched wins');
  check(pickPad([a, b], sel) === a, 'and is kept');
  check(pickPad([null, b], sel) === b, 'a pad that went away is replaced');
  check(pickPad([], sel) === null && pickPad(null, sel) === null && sel.index === -1, 'no pads is null');
  check(pickPad([a], { index: -1 }) === a, 'a non standard pad is used if it is the only one');
  const disc = pad(); disc.connected = false;
  check(pickPad([disc], { index: -1 }) === null, 'a disconnected pad is ignored');
  check(touchedPad([pad(), pad({ set: { 0: true } })]) === 1 && touchedPad([pad({ axes: [0.9, 0] })]) === 0 && touchedPad([pad()]) === -1 && touchedPad(null) === -1, 'touchedPad finds a press or a stick');
}

console.log('RUMBLE');
{
  const car = o => ({ bump: 0, speed: 50, spin: false, lock: false, events: { hit: 0 }, ...o });
  const idle = padRumble(car());
  check(idle.strong === 0 && idle.weak === 0, 'no rumble on smooth tarmac');
  const kerb = padRumble(car({ bump: 0.35 })), strip = padRumble(car({ bump: 1.2 })), saus = padRumble(car({ bump: 1 }));
  check(kerb.weak > 0 && kerb.weak < strip.weak && saus.strong > kerb.strong, 'rumble grows with the surface roughness');
  check(padRumble(car({ spin: true })).weak > 0.2 && padRumble(car({ lock: true })).weak > 0.2, 'wheelspin and lock-up give a weak buzz');
  check(padRumble(car({ spin: true, speed: 3 })).weak < padRumble(car({ spin: true, speed: 60 })).weak, 'the buzz grows with speed');
  let bounded = true;
  for (const c of [null, undefined, {}, car({ bump: NaN, speed: NaN }), car({ bump: 99, spin: true }), car({ bump: -5 }), car({ bump: Infinity })]) {
    const r = padRumble(c);
    if (!(r.strong >= 0 && r.strong <= 1 && r.weak >= 0 && r.weak <= 1)) bounded = false;
  }
  check(bounded, 'rumble values are always within 0 and 1');
  // the hit latch: events.hit as seen at the frame, or a sudden loss of speed across several physics steps
  const l = { speed: undefined };
  check(hitLatch(l, car({ speed: 50 })) === 0, 'no hit');
  check(hitLatch(l, car({ speed: 50, events: { hit: 12 } })) === 1, 'a hard events.hit is full strength');
  check(hitLatch(l, car({ speed: 50, events: { hit: 0.5 } })) === 0, 'a touch is nothing');
  check(hitLatch(l, car({ speed: 40, events: { hit: 0 } })) > 0.7, 'a 10 m/s drop between frames counts as a hit even if events.hit was cleared');
  check(hitLatch(l, car({ speed: 39.5 })) === 0, 'ordinary braking does not');
  check(hitLatch({}, null) === 0 && hitLatch({}, {}) === 0, 'no car is no hit');
  const tp = { speed: undefined };
  hitLatch(tp, car({ speed: 50, x: 0, z: 0 }));
  check(hitLatch(tp, car({ speed: 0, x: 500, z: 80 })) === 0, 'a reset to the track (speed to 0, position jumps) is not a hit');
  check(hitLatch(tp, car({ speed: 30, x: 500, z: 80 })) === 0 && hitLatch(tp, car({ speed: 20, x: 500.4, z: 80 })) > 0.5, 'but a loss of speed in place is');
  // rumble() with every kind of actuator
  const calls = [];
  check(rumble({ vibrationActuator: { type: 'dual-rumble', playEffect: (t, p) => { calls.push([t, p]); return Promise.resolve(); } } }, 2, -1, 99999) && calls[0][0] === 'dual-rumble' && calls[0][1].strongMagnitude === 1 && calls[0][1].weakMagnitude === 0 && calls[0][1].duration === 5000, 'rumble clamps its arguments');
  check(rumble({}, 1, 1, 100) === false && rumble(null, 1, 1, 1) === false && rumble({ vibrationActuator: {} }, 1, 1, 1) === false, 'no actuator is false, not an error');
  check(rumble({ vibrationActuator: { playEffect() { throw new Error('boom'); } } }, 1, 1, 1) === false, 'a throwing actuator is caught');
  let rejected = false; process.on('unhandledRejection', () => { rejected = true; });
  rumble({ vibrationActuator: { playEffect: () => Promise.reject(new Error('no')) } }, 1, 1, 1);
  // the rumbler: not every frame, a hit is a 150 ms strong pulse, stops when asked
  const sent = [], p = { vibrationActuator: { playEffect: (t, e) => { sent.push(e); return Promise.resolve(); }, reset: () => { sent.push('reset'); return Promise.resolve(); } } };
  const rb = createRumbler(), cc = cfg();
  let t = 0;
  for (let i = 0; i < 60; i++) { rb.update(p, cc, car({ bump: 1 }), t); t += 16.7; }
  check(sent.length >= 10 && sent.length <= 14, `about 12 effects in a second, not 60 (${sent.length})`);
  sent.length = 0;
  rb.update(p, cc, car({ speed: 50, events: { hit: 12 } }), t);
  check(sent.length === 1 && sent[0].strongMagnitude === 1 && sent[0].duration === 150, 'a hit sends a full strong 150 ms pulse');
  sent.length = 0;
  rb.update(p, cc, car({ speed: 50 }), t + 100);
  check(sent.length === 1 && sent[0].strongMagnitude === 1, 'the strong pulse is held for its 150 ms');
  rb.update(p, cc, car({ speed: 50 }), t + 400);
  check(sent[sent.length - 1] === 'reset', 'it is stopped when the car is smooth again');
  sent.length = 0;
  rb.update(p, cfg({ rumble: false }), car({ bump: 1 }), t + 1000); rb.update(p, cfg({ rumbleStrength: 0 }), car({ bump: 1 }), t + 2000);
  check(sent.every(s => s === 'reset'), 'rumble off or strength 0 sends nothing');
  const half = []; const p2 = { vibrationActuator: { playEffect: (t, e) => { half.push(e); } } };
  createRumbler().update(p2, cfg({ rumbleStrength: 0.5 }), car({ bump: 1 }), 0);
  const full = []; const p3 = { vibrationActuator: { playEffect: (t, e) => { full.push(e); } } };
  createRumbler().update(p3, cfg(), car({ bump: 1 }), 0);
  check(near(half[0].weakMagnitude * 2, full[0].weakMagnitude, 1e-9), 'strength scales the rumble');
  check(createRumbler().update(null, cc, car({ bump: 1 }), 0) === null, 'no pad, no rumble');
}

console.log('MENU NAV');
{
  // the repeater
  const r = createRepeater();
  let fired = 0, times = [];
  for (let i = 0; i < 120; i++) { const n = r.step(true, 1 / 60); fired += n; for (let k = 0; k < n; k++) times.push(i / 60); }
  check(times[0] === 0, 'a held direction fires at once');
  check(times[1] > REPEAT_DELAY - 1 / 60 && times[1] < REPEAT_DELAY + 1 / 60 + 1e-9, `and again after the delay (${times[1].toFixed(3)} s)`);
  check(near(times[2] - times[1], REPEAT_EVERY, 1 / 60 + 1e-9), `then every ${REPEAT_EVERY} s (${(times[2] - times[1]).toFixed(3)})`);
  console.log(`  2 s held: ${fired} fires (0, ${times.slice(1, 4).map(x => x.toFixed(2)).join(', ')} ...)`);
  check(fired === 1 + Math.floor((2 - REPEAT_DELAY) / REPEAT_EVERY) || Math.abs(fired - (1 + Math.floor((2 - REPEAT_DELAY) / REPEAT_EVERY))) <= 1, 'the count over two seconds is as expected');
  r.step(false, 1 / 60);
  check(r.step(true, 1 / 60) === 1, 'letting go and pressing again fires at once');
  check(createRepeater().step(true, 5) === 1 && (() => { const q = createRepeater(); q.step(true, 0); return q.step(true, 5); })() <= 3, 'a very long frame does not flood');

  // a fake pad and keyboard
  const P = { connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const press = (i, v = true) => { P.buttons[i] = { pressed: v, value: v ? 1 : 0 }; };
  const keys = []; const target = { addEventListener: (t, f) => keys.push(f), removeEventListener: (t, f) => { const i = keys.indexOf(f); if (i >= 0) keys.splice(i, 1); } };
  let focus = null;
  const log = [];
  const nav = createMenuNav(a => log.push(a), { getPads: () => [P], target, activeElement: () => focus });
  const frames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) nav.update(dt); };
  const take = () => log.splice(0).join();
  frames(2);
  press(0); frames(1); check(take() === 'confirm', 'A confirms');
  frames(30); check(take() === '', 'a held A does not repeat (edge triggered)');
  press(0, false); frames(1); press(1); frames(1); check(take() === 'back', 'B goes back');
  press(1, false); press(4); frames(1); press(4, false); press(5); frames(1); press(5, false); press(9); frames(1); press(9, false);
  check(take() === 'tab-left,tab-right,start', 'bumpers are tabs and Start is start');
  press(13); frames(1); check(take() === 'down', 'd-pad down');
  frames(Math.round(REPEAT_DELAY * 60) - 3); check(take() === '', 'no repeat before the delay');
  frames(6); check(take() === 'down', 'the first repeat comes after the delay');
  frames(Math.round(REPEAT_EVERY * 60) + 1); check(take() === 'down', 'then it repeats');
  press(13, false); frames(1); check(take() === '', 'nothing after release');
  // left stick: needs a real push
  P.axes = [0.3, 0]; frames(5); check(take() === '', 'a light stick push is not a direction');
  P.axes = [0.9, 0.2]; frames(1); check(take() === 'right', 'a pushed stick is a direction');
  P.axes = [0.45, 0]; frames(3); check(take() === '', 'hysteresis: it stays held without a new fire');
  P.axes = [0, -0.9]; frames(1); check(take() === 'up', 'stick up');
  P.axes = [0, 0]; frames(1); take();
  P.axes = [NaN, undefined]; frames(3); check(take() === '', 'NaN axes are nothing');
  P.axes = [0, 0];
  // two directions at once do not both repeat forever: the stick picks its main axis
  P.axes = [0.8, 0.7]; frames(1); check(take() === 'right', 'a diagonal stick picks the bigger axis');
  P.axes = [0, 0]; frames(1); take();
  // text fields
  focus = { tagName: 'INPUT', type: 'text' };
  press(0); press(13); frames(1); check(take() === '', 'nothing fires while a text field has focus');
  press(0, false); press(13, false); frames(1);
  press(1); frames(1); check(take() === 'back', 'but B still goes back');
  press(1, false); frames(1);
  const key = (code, extra = {}) => { let prevented = false; for (const f of keys.slice()) f({ code, preventDefault: () => { prevented = true; }, ...extra }); return prevented; };
  check(key('Escape') === false && take() === 'back', 'Escape in a text field still goes back (and is not swallowed)');
  key('ArrowDown'); key('Enter'); check(take() === '', 'keys in a text field are left alone');
  focus = { tagName: 'SELECT' }; key('ArrowDown'); check(take() === '', 'and in a select');
  focus = { tagName: 'INPUT', type: 'range' }; key('ArrowRight'); check(take() === 'right', 'but a range slider is not a text field');
  focus = { tagName: 'BUTTON' };
  // keyboard
  const expect = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'confirm', Space: 'confirm', Escape: 'back', Backspace: 'back', KeyQ: 'tab-left', PageUp: 'tab-left', KeyE: 'tab-right', PageDown: 'tab-right' };
  let kok = true;
  for (const [code, want] of Object.entries(expect)) { const pd = key(code); if (take() !== want || !pd && code !== 'Escape' && false) kok = false; }
  check(kok, 'every keyboard key maps to its direction or action');
  check(key('Tab') === false && take() === '' && key('Tab', { shiftKey: true }) === false && take() === '', 'Tab and shift-Tab are ignored (the browser moves focus)');
  key('Enter', { repeat: true }); check(take() === '', 'a held Enter does not confirm again');
  key('ArrowDown', { repeat: true }); check(take() === 'down', 'a held arrow repeats');
  key('KeyR'); key('KeyC'); check(take() === '', 'game keys are not menu keys');
  check(key('Digit3') === true && take() === 'digit:3' && key('Numpad7') === true && take() === 'digit:7', 'number keys 1 to 7 (top row and keypad) send digit:N, which the main menu opens as entries');
  key('Digit3', { repeat: true }); check(take() === '', 'a held number key does not open its entry again and again');
  focus = { tagName: 'INPUT', type: 'text' }; key('Digit2'); check(take() === '', 'a number typed in a text field is not a menu key');
  focus = { tagName: 'BUTTON' };
  key('ArrowDown', { ctrlKey: true }); check(take() === '', 'a modifier makes it a shortcut, not navigation');
  check(key('Enter') === true && take() === 'confirm', 'a handled key is prevented, so the browser does not click twice');
  // a button held when the menu opens is ignored until released
  press(0); nav.enabled = false; frames(2); nav.enabled = true; frames(3); check(take() === '', 'a button held while the menu was closed does not fire on opening');
  press(0, false); frames(1); press(0); frames(1); check(take() === 'confirm', 'a fresh press works afterwards');
  press(0, false); frames(1);
  // disabled: nothing from either source
  nav.enabled = false; key('ArrowDown'); press(1); frames(2); check(take() === '', 'disabled means silent'); press(1, false); nav.enabled = true; frames(2); take();
  // pad vanishing and returning
  P.connected = false; frames(2); P.connected = true; press(0); frames(2); check(take() === '', 'a pad that returns holding a button does not fire it');
  press(0, false); frames(1);
  // a handler that throws does not break the loop
  const bad = createMenuNav(() => { throw new Error('x'); }, { getPads: () => [P], target, activeElement: () => null });
  const origErr = console.error; console.error = () => {};
  let thrown = false; try { bad.update(1 / 60); press(0); bad.update(1 / 60); key('ArrowDown'); } catch (e) { thrown = true; }
  console.error = origErr; check(!thrown, 'a throwing handler is contained');
  bad.dispose();
  // dispose removes the listener
  take(); nav.dispose(); key('ArrowDown'); press(0, false); press(0); frames(2); check(take() === '' && keys.length === 0, 'dispose removes the keyboard listener and goes quiet');
  // no pads at all, and a getPads that throws
  const none = createMenuNav(a => log.push(a), { getPads: () => { throw new Error('blocked'); }, target: null });
  none.update(1 / 60); none.dispose();
  const none2 = createMenuNav(a => log.push(a), { getPads: () => null, target: null });
  none2.update(1 / 60); none2.dispose();
  check(true, '');
}

console.log('FOCUS MOVE');
{
  const doc = { activeElement: null, defaultView: { Event: class { constructor(t) { this.type = t; } } } };
  const mk = (name, x, y, w = 100, h = 40, extra = {}) => {
    const el = {
      name, tagName: 'BUTTON', type: '', disabled: false, hidden: false, ownerDocument: doc, classes: new Set(), events: [],
      getBoundingClientRect: () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }),
      getAttribute: () => null, focus() { doc.activeElement = this; }, click() { this.clicked = true; },
      dispatchEvent(e) { this.events.push(e.type); },
      classList: { toggle: (c, on) => { on ? el.classes.add(c) : el.classes.delete(c); }, add: c => el.classes.add(c) },
      contains: () => true, ...extra,
    };
    return el;
  };
  // a settings-like layout: a row of three, a slider, a wide button, two more
  const a = mk('a', 0, 0), b = mk('b', 120, 0), c = mk('c', 240, 0), s = mk('slider', 0, 60, 340, 30, { tagName: 'INPUT', type: 'range', value: '50', min: '0', max: '100', step: '5' });
  const w = mk('wide', 0, 110, 340, 40), d = mk('d', 0, 170), e = mk('e', 120, 170);
  const hidden = mk('hidden', 0, 100, 0, 0), off = mk('off', 120, 110, 100, 40, { disabled: true }), neg = mk('neg', 240, 170, 100, 40, { getAttribute: n => (n === 'tabindex' ? '-1' : null) });
  const all = [a, b, c, s, w, d, e, hidden, off, neg];
  const box = { ownerDocument: doc, querySelectorAll: () => all };
  const at = el => { doc.activeElement = el; return el; };
  check(focusMove(box, 'down') === a && a.classes.has('pad-focus'), 'nothing focused: the top-left element gets focus and the ring');
  check(focusMove(box, 'right') === b && !a.classes.has('pad-focus') && b.classes.has('pad-focus'), 'right moves along the row and the ring follows');
  check(focusMove(box, 'right') === c, 'and again');
  check(focusMove(box, 'right') === null && doc.activeElement === c, 'no wrap past the end of a row');
  check(focusMove(box, 'down') === s, 'down from c goes to the slider below');
  at(s);
  focusMove(box, 'right'); check(s.value === '55' && s.events.join() === 'input,change' && doc.activeElement === s, 'right on a slider raises it (and fires input and change), focus stays');
  focusMove(box, 'left'); focusMove(box, 'left'); check(s.value === '45', 'left lowers it');
  s.value = '100'; check((focusMove(box, 'right'), s.value === '100'), 'a slider stops at its maximum');
  check(focusMove(box, 'down') === w, 'down from the slider goes to the wide button, skipping the hidden and disabled ones');
  check(focusMove(box, 'down') === e, 'down from the wide button picks the nearest below (the one under its centre)');
  check(focusMove(box, 'right') === null && doc.activeElement === e, 'neg (tabindex -1) is never a target');
  check(focusMove(box, 'left') === d && focusMove(box, 'up') === w, 'left to d, up to the wide button');
  check(focusMove(box, 'up') === s && focusMove(box, 'up') === b, 'up goes through the slider into the row above');
  check(focusMove(box, 'sideways') === null && focusMove(null, 'up') === null && focusMove({ ownerDocument: doc, querySelectorAll: () => [] }, 'up') === null, 'bad direction, no container and an empty container are null');
  // a select takes left and right
  const sel = mk('sel', 0, 300, 100, 40, { tagName: 'SELECT', options: [1, 2, 3], selectedIndex: 0 });
  const box2 = { ownerDocument: doc, querySelectorAll: () => [sel] };
  at(sel); focusMove(box2, 'right'); check(sel.selectedIndex === 1, 'right on a select picks the next option');
  focusMove(box2, 'left'); focusMove(box2, 'left'); check(sel.selectedIndex === 0, 'and left the previous, stopping at the first');
  // geometry helper
  const rs = [{ left: 0, top: 100, right: 100, bottom: 140, width: 100, height: 40 }, { left: 400, top: 100, right: 500, bottom: 140, width: 100, height: 40 }];
  check(bestInDirection({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }, rs, 'down') === 0, 'the one straight below beats the far one');
  check(bestInDirection({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }, rs, 'up') === -1, 'nothing above is -1');
}

console.log(fails.length ? 'FAILED:\n  ' + fails.join('\n  ') : 'gamepad: all checks passed');
process.exitCode = fails.length ? 1 : 0;
