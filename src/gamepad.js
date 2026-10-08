// Controller support: the pure part (readPad, settings, rumble mapping, remap logic) has no DOM and is tested by
// tools/gamepad.js; the Controls screen (mountControls) at the bottom is the only part that touches the page.
//
// Standard mapping (Xbox, PlayStation, Switch Pro, anything the browser maps to the "standard" layout):
//   axes 0/1 left stick, buttons 6/7 triggers (analog value), 0..3 face buttons, 4/5 bumpers, 8 back, 9 start,
//   12..15 d-pad up, down, left, right.

import { KEY_SLOW_FROM, KEY_SLOW_AT, KEY_THROTTLE_IN, KEY_PEDAL_OUT, toward } from './inputModel.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// What the browser is allowed to see while the Controls screen listens for a button to bind: input.js drops the
// pad's actions during that time so pressing Start to bind it does not also open the settings.
export const padCapture = { active: false };

// ---- settings ------------------------------------------------------------------------------------------------------

// Button index for each action. Menu navigation (menuNav.js) is separate and fixed: d-pad, A, B, bumpers, Start.
export const ACTIONS = ['drs', 'reset', 'camera', 'line', 'settings', 'board', 'camera-next', 'camera-prev'];
export const ACTION_LABEL = { drs: 'DRS', reset: 'Back on track', camera: 'Camera', line: 'Racing line', settings: 'Pause / settings', board: 'Times board (hold)', 'camera-next': 'Camera next (d-pad)', 'camera-prev': 'Camera previous (d-pad)' };
export const DEFAULT_BINDINGS = { drs: 0, reset: 1, camera: 2, line: 3, settings: 9, board: 8, 'camera-next': 12, 'camera-prev': 13 };
// 'camera-next' is reported as the plain 'camera' action; 'camera-prev' as 'camera-prev'.

export const DEFAULT_CONTROLLER = {
  deadzone: 0.08,        // radial dead zone of the left stick, 0 to 0.4
  curve: 1.5,            // response exponent, 1 (linear) to 2.2 (very fine in the middle)
  sens: 1,               // multiplies the stick, 0.5 to 1.5 (above 1 reaches full lock before the stick's edge)
  speedSens: 0.5,        // how much lock is taken away at speed, 0 (none) to 1
  smoothing: true,       // low pass on the stick so a thumb flick is not instant lock
  triggerDead: 0.04,     // dead zone of both triggers
  drsMode: 'toggle',     // 'toggle' or 'hold'
  rumble: true,
  rumbleStrength: 1,     // 0 to 1
  bindings: DEFAULT_BINDINGS,
};

// Hostile or missing values fall back to the defaults, numbers are clamped to their range. Always returns a fresh object.
export function normaliseControllerSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CONTROLLER;
  const clampNum = (v, def, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def);
  const bindings = { ...DEFAULT_BINDINGS };
  const rb = r.bindings && typeof r.bindings === 'object' ? r.bindings : {};
  for (const a of ACTIONS) { const b = rb[a]; if (Number.isInteger(b) && b >= 0 && b <= 31) bindings[a] = b; }
  // two actions on one button is a corrupt save: the later one goes back to its default (or is dropped if that is taken too)
  const seen = new Map();
  for (const a of ACTIONS) {
    const b = bindings[a];
    if (!seen.has(b)) { seen.set(b, a); continue; }
    bindings[a] = DEFAULT_BINDINGS[a];
    if (seen.has(bindings[a])) bindings[a] = -1;
    else seen.set(bindings[a], a);
  }
  return {
    deadzone: clampNum(r.deadzone, d.deadzone, 0, 0.4),
    curve: clampNum(r.curve, d.curve, 1, 2.2),
    sens: clampNum(r.sens, d.sens, 0.5, 1.5),
    speedSens: clampNum(r.speedSens, d.speedSens, 0, 1),
    smoothing: typeof r.smoothing === 'boolean' ? r.smoothing : d.smoothing,
    triggerDead: clampNum(r.triggerDead, d.triggerDead, 0, 0.3),
    drsMode: r.drsMode === 'hold' || r.drsMode === 'toggle' ? r.drsMode : d.drsMode,
    rumble: typeof r.rumble === 'boolean' ? r.rumble : d.rumble,
    rumbleStrength: clampNum(r.rumbleStrength, d.rumbleStrength, 0, 1),
    bindings,
  };
}

// Binds `action` to `button`. If another action had that button it takes this action's old one (a swap), so no
// button ever has two jobs. Returns a new bindings object.
export function rebind(bindings, action, button) {
  const b = { ...DEFAULT_BINDINGS, ...bindings };
  if (!ACTIONS.includes(action) || !Number.isInteger(button) || button < 0 || button > 31) return b;
  const old = b[action];
  for (const a of ACTIONS) if (a !== action && b[a] === button) b[a] = old;
  b[action] = button;
  return b;
}

// ---- reading a pad -------------------------------------------------------------------------------------------------

export function newPadState() {
  return { steer: 0, throttle: 0, brake: 0, speed: 0, raw: 0, drsOn: false, prev: [], rest: {}, analog: {}, boardHeld: false, primed: false };
}

const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const buttonDown = b => !!b && (typeof b === 'object' ? !!b.pressed || finite(b.value) > 0.5 : finite(b) > 0.5);

// A trigger as 0..1. Standard pads give buttons[idx].value. Digital-only pads give pressed with value 0 or 1.
// Pads that report a trigger as an axis (Firefox and old Chrome on some drivers; axis 2 and 5 on Xbox style layouts)
// may rest at -1 and rise to +1: if the first value seen is at or below -0.5 the range is mapped from -1..1.
export function readTrigger(pad, idx, axisIdx, state, dead = 0.04) {
  const buttons = pad && pad.buttons ? pad.buttons : [];
  let v = null;
  const b = buttons[idx];
  if (b !== undefined && b !== null) {
    v = typeof b === 'object' ? (finite(b.value) > 0 ? finite(b.value) : b.pressed ? 1 : 0) : finite(b);
    // a few drivers put the -1..1 axis range on the button value: same treatment
    if (v < 0) { state.rest[idx] = true; v = 0; }
  } else if (pad && pad.axes && axisIdx >= 0 && pad.axes.length > axisIdx) {
    const a = finite(pad.axes[axisIdx]);
    const key = 'ax' + axisIdx;
    state.analog.any = true;      // an axis is always analog
    if (state.rest[key] === undefined) state.rest[key] = a <= -0.5;   // decided on the first reading
    v = state.rest[key] ? (a + 1) / 2 : Math.max(0, a);
  }
  if (v === null) return 0;
  v = clamp(v, 0, 1);
  return v <= dead ? 0 : Math.min(1, (v - dead) / (1 - dead));
}

// Left stick X to steering, before smoothing. `y` is used only for the radial dead zone (a stick pushed up with a
// little sideways play does not steer). Returns -1..1.
export function stickSteer(x, y, cfg) {
  x = finite(x); y = finite(y);
  const mag = Math.hypot(x, y);
  const dz = clamp(cfg.deadzone, 0, 0.4);
  if (mag <= dz || mag === 0) return 0;
  const scaled = Math.min(1, (mag - dz) / (1 - dz));      // 0..1 along the stick's travel
  const along = Math.abs(x) / mag * scaled;
  const v = Math.sign(x) * Math.pow(along, cfg.curve) * cfg.sens;
  return clamp(v, -1, 1);
}

// Share of full lock the stick may give at this speed (m/s): 1 at low speed, down to 1 - 0.35 * speedSens at 200 km/h.
export function lockLimit(speed, cfg) {
  const slow = clamp((finite(speed) - KEY_SLOW_FROM) / (KEY_SLOW_AT - KEY_SLOW_FROM), 0, 1);
  return 1 - 0.35 * clamp(cfg.speedSens, 0, 1) * slow;
}

// How fast the smoothed steering follows the stick (per second): quick at low speed, slower at speed;
// letting the stick go back to centre is always quick.
export function smoothRate(speed, returning) {
  const slow = clamp((finite(speed) - KEY_SLOW_FROM) / (KEY_SLOW_AT - KEY_SLOW_FROM), 0, 1);
  const r = 22 - 12 * slow;
  return returning ? r * 1.6 : r;
}

// One frame of a pad. pad: a Gamepad (or a fake with axes[] and buttons[]); cfg: normalised controller settings;
// state: from newPadState(), kept between frames (set state.speed to the car's speed in m/s); dt: seconds.
// Returns { steer, throttle, brake, drs, active, actions: ['reset', ...], boardHeld, buttons: [bool], axes: [..] }.
// actions are edge triggered: one entry the frame a bound button goes down ('board-on' / 'board-off' for the held one).
export function readPad(pad, cfg, state, dt) {
  cfg = cfg && cfg.bindings && typeof cfg.drsMode === 'string' ? cfg : normaliseControllerSettings(cfg);
  dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  const out = { steer: 0, throttle: 0, brake: 0, drs: false, active: false, actions: [], boardHeld: false, buttons: [], axes: [] };
  if (!pad) return out;
  const axes = pad.axes || [], buttons = pad.buttons || [];
  out.axes = [0, 1, 2, 3].map(i => finite(axes[i]));
  const n = Math.max(buttons.length, 17);
  for (let i = 0; i < n; i++) out.buttons.push(buttonDown(buttons[i]));

  // steering
  const target = stickSteer(axes[0], axes[1], cfg) * lockLimit(state.speed, cfg);
  state.raw = target;
  if (cfg.smoothing && dt > 0) {
    const returning = Math.abs(target) < Math.abs(state.steer) || Math.sign(target) !== Math.sign(state.steer);
    const a = 1 - Math.exp(-smoothRate(state.speed, returning) * dt);
    state.steer += (target - state.steer) * a;
    if (Math.abs(state.steer) < 1e-4 && target === 0) state.steer = 0;
  } else state.steer = target;

  // pedals. Triggers: axis 2 / 5 is the fallback only when the pad has no button 6 / 7
  const rt = readTrigger(pad, 7, 5, state, cfg.triggerDead);
  const lt = readTrigger(pad, 6, 2, state, cfg.triggerDead);
  // a digital trigger (never anything between 0 and 1 so far) is eased in like the keyboard, so it is not a switch
  if ((rt > 0.02 && rt < 0.98) || (lt > 0.02 && lt < 0.98)) state.analog.any = true;
  const pedal = (cur, v) => (state.analog.any || !dt ? v : toward(cur, v, v ? KEY_THROTTLE_IN : KEY_PEDAL_OUT, dt));
  state.throttle = pedal(state.throttle, rt);
  state.brake = pedal(state.brake, lt);

  // buttons: edges
  const down = i => out.buttons[i] === true;
  const edge = i => down(i) && !state.prev[i];
  const bind = cfg.bindings;
  if (!state.primed) {
    // buttons already held when the pad is first read (or picked up again) do not count as presses
    state.prev = out.buttons.slice(); state.primed = true;
  }
  const acts = out.actions;
  for (const a of ACTIONS) {
    const i = bind[a];
    if (!(i >= 0)) continue;
    if (a === 'drs') {
      if (cfg.drsMode === 'toggle') { if (edge(i)) state.drsOn = !state.drsOn; }
      else state.drsOn = down(i);
    } else if (a === 'board') {
      if (down(i) !== state.boardHeld) { acts.push(down(i) ? 'board-on' : 'board-off'); state.boardHeld = down(i); }
    } else if (edge(i)) acts.push(a === 'camera-next' ? 'camera' : a);
  }
  if (state.brake > 0.05) state.drsOn = false;      // braking closes the DRS flap, so a toggle does not stay armed
  const anyEdge = out.buttons.some((b, i) => b && !state.prev[i]);
  state.prev = out.buttons.slice();

  out.steer = state.steer; out.throttle = state.throttle; out.brake = state.brake;
  out.drs = state.drsOn; out.boardHeld = state.boardHeld;
  out.active = Math.abs(stickSteer(axes[0], axes[1], { ...cfg, deadzone: Math.max(cfg.deadzone, 0.15) })) > 0 || rt > 0.1 || lt > 0.1 || anyEdge;
  return out;
}

// Which pad to use: the one at state.index if it is still there and nothing else was touched, else the first
// connected one with the standard mapping, else any connected one. `touched` is an index or -1 (the pad that just
// had a press or a stick move). Returns the pad or null; remembers the choice in `sel.index`.
export function pickPad(pads, sel, touched = -1) {
  const list = pads ? Array.from(pads) : [];
  const ok = p => !!p && p.connected !== false;
  if (touched >= 0 && ok(list[touched])) sel.index = touched;
  if (!(sel.index >= 0) || !ok(list[sel.index])) {
    let i = list.findIndex(p => ok(p) && p.mapping === 'standard');
    if (i < 0) i = list.findIndex(ok);
    sel.index = i;
  }
  return sel.index >= 0 ? list[sel.index] : null;
}

// Which connected pad has a stick pushed or a button down right now (for "the last one touched"). -1 if none.
export function touchedPad(pads) {
  const list = pads ? Array.from(pads) : [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.connected === false) continue;
    if ((p.buttons || []).some(buttonDown) || (p.axes || []).slice(0, 2).some(a => Math.abs(finite(a)) > 0.5)) return i;
  }
  return -1;
}

// ---- rumble --------------------------------------------------------------------------------------------------------

// Strong (low frequency) and weak (high frequency) motor strength, 0..1, from the car's state:
// kerbs, rumble strips, gravel and grass (car.bump, already scaled by speed in physics.js), wheelspin and lock-up.
// The barrier pulse is separate (hitPulse), because car.events.hit only lasts one physics step.
export function padRumble(car) {
  if (!car) return { strong: 0, weak: 0 };
  const bump = clamp(finite(car.bump), 0, 1.2);
  const speed = finite(car.speed);
  let strong = bump * 0.55, weak = bump * 0.9;
  if (car.spin || car.lock) weak = Math.max(weak, 0.25 + 0.25 * clamp(speed / 40, 0, 1));
  return { strong: clamp(strong, 0, 1), weak: clamp(weak, 0, 1) };
}

// Reads the barrier hit safely: events are cleared by the next physics step, and several steps can run between two
// frames, so besides car.events.hit a sudden drop of speed in one frame counts too. Call once per frame.
// Returns the hit strength 0..1 (0 when nothing happened this frame).
export function hitLatch(latch, car) {
  if (!car) return 0;
  const v = finite(car.speed);
  let hit = finite(car.events && car.events.hit);
  // a reset to the track (or a respawn) also ends at speed 0 but jumps the car: that is not a crash
  const jumped = latch.x !== undefined && Math.hypot(finite(car.x) - latch.x, finite(car.z) - latch.z) > 12;
  if (latch.speed !== undefined && latch.speed - v > 3 && !jumped) hit = Math.max(hit, latch.speed - v);
  latch.speed = v; latch.x = finite(car.x); latch.z = finite(car.z);
  return hit > 1 ? clamp(hit / 12, 0.4, 1) : 0;
}

// Plays a dual-rumble effect. Safe on every browser: no actuator, no playEffect or a rejected promise all return false.
export function rumble(pad, strong, weak, ms) {
  try {
    const act = pad && pad.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return false;
    const r = act.playEffect(act.type || 'dual-rumble', { startDelay: 0, duration: clamp(finite(ms), 0, 5000), strongMagnitude: clamp(finite(strong), 0, 1), weakMagnitude: clamp(finite(weak), 0, 1) });
    if (r && typeof r.catch === 'function') r.catch(() => {});
    return true;
  } catch (e) { return false; }
}

// Per-frame rumble driver: call with the pad, config, car and the time. Keeps its own pulse timer and sends an effect
// about every 80 ms (not every frame), so it is cheap. Returns what it sent, or null.
export function stopRumble(pad) {
  try { const act = pad && pad.vibrationActuator; if (act && typeof act.reset === 'function') { const r = act.reset(); if (r && r.catch) r.catch(() => {}); } else rumble(pad, 0, 0, 1); } catch (e) { /* optional */ }
}

export function createRumbler() {
  const st = { hit: { speed: undefined }, until: 0, next: 0, on: false };
  return {
    update(pad, cfg, car, nowMs) {
      if (!pad || !cfg || !cfg.rumble || !(cfg.rumbleStrength > 0)) { if (st.on) { st.on = false; stopRumble(pad); } return null; }
      const hit = hitLatch(st.hit, car);
      if (hit > 0) st.until = nowMs + 150;
      const r = padRumble(car);
      if (nowMs < st.until) r.strong = 1;
      const strong = clamp(r.strong * cfg.rumbleStrength, 0, 1), weak = clamp(r.weak * cfg.rumbleStrength, 0, 1);
      if (strong <= 0.02 && weak <= 0.02) { if (st.on) { st.on = false; stopRumble(pad); } return null; }
      if (hit > 0 || nowMs >= st.next) {
        st.next = nowMs + 80; st.on = true;
        rumble(pad, strong, weak, hit > 0 ? 150 : 110);
        return { strong, weak };
      }
      return null;
    },
    stop(pad) { if (st.on) { st.on = false; stopRumble(pad); } },
  };
}

// ---- labels --------------------------------------------------------------------------------------------------------

const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home'];
const PLAY = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'PS'];
export const isPlayStation = id => /054c|playstation|dualshock|dualsense|sony/i.test(String(id || ''));
export function buttonLabel(i, id = '') {
  const t = isPlayStation(id) ? PLAY : XBOX;
  return t[i] || 'Button ' + i;
}

// ---- Controls screen -----------------------------------------------------------------------------------------------

const CSS = `
/* the Controls tab sits in the settings panel: its groups, rows and segmented controls are the menu's own (style.css); this adds the live readout */
.ctl { display: flex; flex-direction: column; gap: var(--s-7); color: var(--text); font-size: 15px; line-height: 1.45; min-width: 0; }
.ctl .ctl-name { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
.ctl .ctl-name.none { color: var(--text-dim); font-weight: 500; }
.ctl .row.live { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--s-4); align-items: center; }
.ctl .stick { position: relative; width: 96px; height: 96px; border-radius: 50%; border: 1px solid var(--line-strong); background: var(--pit-0); }
.ctl .stick i { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: var(--lake); left: 50%; top: 50%; }
.ctl .stick::before, .ctl .stick::after { content: ''; position: absolute; background: var(--pit-3); }
.ctl .stick::before { left: 50%; top: 6px; bottom: 6px; width: 1px; }
.ctl .stick::after { top: 50%; left: 6px; right: 6px; height: 1px; }
.ctl .bars { display: grid; gap: var(--s-2); min-width: 0; }
.ctl .bar { display: grid; grid-template-columns: 64px minmax(0, 1fr) 44px; gap: var(--s-2); align-items: center; font-size: 13px; color: var(--text-dim); }
.ctl .bar span:last-child { text-align: right; font-variant-numeric: tabular-nums; color: var(--text); }
.ctl .bar div { height: 8px; border-radius: 4px; background: var(--pit-3); position: relative; overflow: hidden; }
.ctl .bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--lake); }
.ctl .bar.steer i { background: var(--purple-soft); }
.ctl .bar.brake i { background: var(--text-dim); }
.ctl .btns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; }
.ctl .btns b { min-width: 30px; padding: 2px 6px; border-radius: 4px; background: var(--pit-3); color: var(--text-faint); font-size: 12px; font-weight: 600; text-align: center; }
.ctl .btns b.on { background: var(--lake); color: var(--lake-deep); }
.ctl .map { display: flex; flex-direction: column; }
.ctl .map button { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); width: 100%; min-height: var(--row-h); padding: 0 var(--s-5); border: 0; border-radius: 0; background: none; color: var(--text); font-size: 15px; font-weight: 500; text-align: left; cursor: pointer; }
.ctl .map button + button { border-top: 1px solid var(--line); }
.ctl .map button:hover { background: var(--pit-2); }
.ctl .map button:active { transform: scale(.98); }
.ctl .map button em { font-style: normal; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.ctl .map button.listen { background: var(--purple); color: var(--text); }
.ctl .map button.listen em { color: var(--text); font-weight: 600; }
.ctl .keys { margin: 0; padding: 0; list-style: none; }
.ctl .keys b { font-weight: 500; color: var(--text); }
.ctl .keys span { color: var(--text-dim); }
.ctl button:focus-visible, .ctl button.pad-focus { outline: 2px solid var(--gantry); outline-offset: 2px; }
.ctl-overlay { position: fixed; inset: 0; z-index: 50; overflow-y: auto; background: color-mix(in srgb, var(--pit-0) 92%, transparent); padding: var(--s-4); display: flex; justify-content: center; align-items: flex-start; }
.ctl-overlay .ctl { width: min(440px, 100%); }
.ctl-overlay h2 { font-family: var(--f-display); font-size: 40px; font-style: italic; margin: 0 0 var(--s-2); }
`;

const KEYS = [['Arrows or W A S D', 'steer, throttle, brake'], ['Space or Shift', 'DRS'], ['R', 'back on track'], ['C', 'camera'], ['Tab (hold)', 'times board'], ['Esc or P', 'pause and settings'], ['I or F3', 'handling readout'], ['F2', 'report a problem']];

// Mounts the Controls content inside `container` (settings: the settings object, which gets a `controller` property;
// save(): called after every change). Returns { dispose() }.
export function mountControls(container, { settings, save } = {}) {
  const doc = container.ownerDocument || document;
  if (!doc.getElementById('ctl-style')) { const st = doc.createElement('style'); st.id = 'ctl-style'; st.textContent = CSS; doc.head.appendChild(st); }
  settings.controller = normaliseControllerSettings(settings.controller);
  const persist = () => { try { if (save) save(settings); } catch (e) { /* storage is optional */ } };
  const cfg = () => settings.controller;

  const root = doc.createElement('div');
  root.className = 'ctl';
  const SLIDERS = [
    ['deadzone', 'Stick dead zone', 0, 0.4, 0.01, v => v.toFixed(2)],
    ['curve', 'Steering curve', 1, 2.2, 0.05, v => v.toFixed(2)],
    ['sens', 'Steering sensitivity', 0.5, 1.5, 0.05, v => v.toFixed(2)],
    ['speedSens', 'Less lock at speed', 0, 1, 0.05, v => Math.round(v * 100) + '%'],
    ['rumbleStrength', 'Rumble strength', 0, 1, 0.05, v => Math.round(v * 100) + '%'],
  ];
  root.innerHTML = `
    <section class="group"><div class="gtitle">Controller</div>
      <div class="rows">
        <div class="row"><div class="row-l"><p class="ctl-name none" id="ctl-name">No controller found. Press a button on it.</p></div></div>
        <div class="row live">
          <div class="stick"><i id="ctl-dot"></i></div>
          <div class="bars">
            <div class="bar steer"><span>Steer</span><div><i id="ctl-steer"></i></div><span id="ctl-steer-v">0</span></div>
            <div class="bar"><span>Throttle</span><div><i id="ctl-thr"></i></div><span id="ctl-thr-v">0</span></div>
            <div class="bar brake"><span>Brake</span><div><i id="ctl-brk"></i></div><span id="ctl-brk-v">0</span></div>
          </div>
          <div class="btns" id="ctl-btns"></div>
        </div>
      </div>
    </section>
    <section class="group"><div class="gtitle">Steering and feel</div>
      <div class="rows" id="ctl-sliders"></div>
      <div class="rows">
        <div class="row"><div class="row-l"><b>Steering smoothing</b></div><div class="row-c"><div class="seg" id="ctl-smooth" role="radiogroup" aria-label="Steering smoothing"><button type="button" data-v="true">On</button><button type="button" data-v="false">Off</button></div></div></div>
        <div class="row"><div class="row-l"><b>DRS button</b></div><div class="row-c"><div class="seg" id="ctl-drs" role="radiogroup" aria-label="DRS button"><button type="button" data-v="toggle">Toggle</button><button type="button" data-v="hold">Hold</button></div></div></div>
        <div class="row"><div class="row-l"><b>Rumble</b></div><div class="row-c"><div class="seg" id="ctl-rumble" role="radiogroup" aria-label="Rumble"><button type="button" data-v="true">On</button><button type="button" data-v="false">Off</button></div></div></div>
      </div>
    </section>
    <section class="group"><div class="gtitle">Buttons</div>
      <div class="rows map" id="ctl-map"></div>
      <p class="m-note" id="ctl-hint">Select an action, then press the button you want. Esc cancels. A button already in use swaps.</p>
      <div class="row-c"><button class="btn quiet" id="ctl-reset" type="button">Reset controller to defaults</button></div>
    </section>
    <section class="group"><div class="gtitle">Keyboard</div>
      <div class="rows"><ul class="keys" style="margin:0">${KEYS.map(([k, d]) => `<li class="row"><div class="row-l"><b>${k}</b></div><div class="row-c"><span>${d}</span></div></li>`).join('')}</ul></div>
    </section>`;
  container.appendChild(root);
  const $ = id => root.querySelector('#' + id);

  // sliders
  const sl = $('ctl-sliders');
  const outs = {};
  for (const [key, label, lo, hi, step, fmt] of SLIDERS) {
    const row = doc.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="row-l"><b>${label}</b></div><div class="row-c slider"><input type="range" id="ctl-${key}" aria-label="${label}" min="${lo}" max="${hi}" step="${step}"><output class="val" id="ctl-${key}-o"></output></div>`;
    sl.appendChild(row);
    const input = row.querySelector('input'), out = row.querySelector('output');
    const paint = () => input.style.setProperty('--fill', `${((+input.value - lo) / ((hi - lo) || 1)) * 100}%`);
    outs[key] = () => { input.value = cfg()[key]; paint(); out.textContent = fmt(cfg()[key]); };
    input.addEventListener('input', () => { settings.controller = normaliseControllerSettings({ ...cfg(), [key]: +input.value }); paint(); out.textContent = fmt(cfg()[key]); persist(); });
  }
  const segs = [['ctl-smooth', 'smoothing', v => v === 'true'], ['ctl-drs', 'drsMode', v => v], ['ctl-rumble', 'rumble', v => v === 'true']];
  const syncSegs = () => { for (const [id, key] of segs) for (const b of $(id).querySelectorAll('button')) { const on = String(cfg()[key]) === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } };
  for (const [id, key, conv] of segs) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      settings.controller = normaliseControllerSettings({ ...cfg(), [key]: conv(b.dataset.v) }); syncSegs(); persist();
    });
  }

  // button list and remap
  let listening = null;      // the action waiting for a button
  let primed = false, prevPressed = [], raf = 0, alive = true, lastKey = '';
  const map = $('ctl-map');
  let padId = '';
  const drawMap = () => {
    map.innerHTML = '';
    for (const a of ACTIONS) {
      const b = doc.createElement('button'); b.type = 'button'; b.dataset.action = a;
      const bound = cfg().bindings[a];
      b.innerHTML = `<span>${ACTION_LABEL[a]}</span><em>${listening === a ? 'Press a button' : bound >= 0 ? buttonLabel(bound, padId) : 'none'}</em>`;
      b.classList.toggle('listen', listening === a);
      b.addEventListener('click', () => { listening = listening === a ? null : a; padCapture.active = !!listening; primed = false; drawMap(); });
      map.appendChild(b);
    }
  };
  const stopListening = () => { listening = null; padCapture.active = false; drawMap(); };
  const onKey = e => { if (listening && e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); stopListening(); } };
  doc.addEventListener('keydown', onKey, true);
  $('ctl-reset').addEventListener('click', () => { settings.controller = normaliseControllerSettings(null); stopListening(); syncAll(); persist(); });

  const btnEls = [];
  const btnBox = $('ctl-btns');
  const syncAll = () => { for (const k in outs) outs[k](); syncSegs(); drawMap(); };
  syncAll();

  // live display
  const view = { name: $('ctl-name'), dot: $('ctl-dot'), steer: $('ctl-steer'), steerV: $('ctl-steer-v'), thr: $('ctl-thr'), thrV: $('ctl-thr-v'), brk: $('ctl-brk'), brkV: $('ctl-brk-v') };
  const sel = { index: -1 }, st = newPadState();
  const poll = () => {
    if (!alive) return;
    raf = requestAnimationFrame(poll);
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { /* blocked */ }
    const pad = pickPad(pads, sel, touchedPad(pads));
    const key = pad ? pad.id + pad.index : '';
    if (key !== lastKey) {
      lastKey = key; padId = pad ? pad.id : '';
      view.name.textContent = pad ? cleanName(pad.id) : 'No controller found. Press a button on it.';
      view.name.classList.toggle('none', !pad);
      drawMap();
    }
    if (!pad) { setBars(0, 0, 0, 0, 0); return; }
    const r = readPad(pad, { ...cfg(), smoothing: false }, st, 0);
    st.prev = []; st.primed = false;
    setBars(r.axes[0], r.axes[1], r.steer, r.throttle, r.brake);
    // button chips
    const count = Math.max(pad.buttons ? pad.buttons.length : 0, 16);
    while (btnEls.length < count) { const b = doc.createElement('b'); btnBox.appendChild(b); btnEls.push(b); }
    for (let i = 0; i < count; i++) {
      const on = !!r.buttons[i];
      btnEls[i].textContent = buttonLabel(i, pad.id);
      btnEls[i].classList.toggle('on', on);
    }
    // remap: the first button that goes down while listening
    if (listening) {
      if (!primed) { prevPressed = r.buttons.slice(); primed = true; return; }
      const hit = r.buttons.findIndex((d, i) => d && !prevPressed[i]);
      prevPressed = r.buttons.slice();
      if (hit >= 0 && hit !== 6 && hit !== 7) {       // the triggers are the pedals and are not rebindable
        settings.controller = normaliseControllerSettings({ ...cfg(), bindings: rebind(cfg().bindings, listening, hit) });
        listening = null; padCapture.active = false; drawMap(); persist();
      }
    }
  };
  function setBars(x, y, steer, thr, brk) {
    const px = clamp(x, -1, 1), py = clamp(y, -1, 1), m = Math.hypot(px, py) || 1, k = m > 1 ? 1 / m : 1;
    view.dot.style.left = (50 + px * k * 44) + '%'; view.dot.style.top = (50 + py * k * 44) + '%';
    view.steer.style.left = steer < 0 ? (50 + steer * 50) + '%' : '50%';
    view.steer.style.width = Math.abs(steer) * 50 + '%';
    view.steerV.textContent = steer.toFixed(2);
    view.thr.style.width = thr * 100 + '%'; view.thrV.textContent = Math.round(thr * 100) + '%';
    view.brk.style.width = brk * 100 + '%'; view.brkV.textContent = Math.round(brk * 100) + '%';
  }
  raf = requestAnimationFrame(poll);

  return {
    dispose() {
      alive = false; cancelAnimationFrame(raf); padCapture.active = false;
      doc.removeEventListener('keydown', onKey, true);
      root.remove();
    },
  };
}

// "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)" becomes "Xbox 360 Controller"
export function cleanName(id) {
  return String(id || 'Controller').replace(/\s*\(.*$/, '').replace(/\s*Vendor:.*$/i, '').trim() || 'Controller';
}

// ?controls: the Controls screen as a fixed overlay, for testing. Remove this call (in input.js) when the menu has the tab.
export function openControlsOverlay(settings, save) {
  const ov = document.createElement('div');
  ov.className = 'ctl-overlay';
  ov.innerHTML = '<div><h2>Controls</h2></div>';
  document.body.appendChild(ov);
  return mountControls(ov.firstChild, { settings, save });
}
