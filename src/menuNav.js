// Menu navigation from the keyboard and a gamepad, so a menu works without a mouse (and with one at the same time).
//
//   const nav = createMenuNav(dir => { ... });   // dir: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tab-left' | 'tab-right' | 'start' | 'digit:1'..'digit:7'
//   each frame: nav.update(dt)                    // polls the gamepad (the keyboard is event driven and needs no update)
//   nav.enabled = false                           // pause it while the game itself is being driven
//   nav.dispose()
//
// focusMove(container, dir) moves focus to the nearest button, input, select or [tabindex] element in that direction
// and gives it the `.pad-focus` class (a visible ring). A focused range slider or select takes left and right itself.
// activateFocused(container) clicks the focused element.

export const REPEAT_DELAY = 0.35;    // seconds a direction is held before it repeats
export const REPEAT_EVERY = 0.12;    // then every this many seconds
const STICK_ON = 0.55;               // stick travel that counts as a push (and 0.35 to let go again)
const STICK_OFF = 0.35;

const PAD_BUTTONS = { 0: 'confirm', 1: 'back', 4: 'tab-left', 5: 'tab-right', 9: 'start' };
const PAD_DIRS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const KEY_DIRS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const KEY_BUTTONS = { Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', Escape: 'back', Backspace: 'back', KeyQ: 'tab-left', PageUp: 'tab-left', KeyE: 'tab-right', PageDown: 'tab-right' };
// number keys 1 to 7 (top row and keypad): emitted as 'digit:1' .. 'digit:7', the main menu opens that entry
const KEY_DIGITS = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad6: 6, Numpad7: 7 };

const isTyping = el => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !(el.tagName === 'INPUT' && ['range', 'button', 'checkbox', 'radio', 'submit'].includes(el.type)));

// A repeating direction: fires at once, again after `delay`, then every `every` seconds while held.
export function createRepeater(delay = REPEAT_DELAY, every = REPEAT_EVERY) {
  let held = false, t = 0, next = delay;
  return {
    // returns how many times to fire this frame (0, 1, or a few after a long frame)
    step(down, dt) {
      if (!down) { held = false; t = 0; next = delay; return 0; }
      if (!held) { held = true; t = 0; next = delay; return 1; }
      t += dt;
      let n = 0;
      while (t >= next && n < 3) { n++; next += every; }
      if (t >= next) next = t + every;      // a very long frame: do not catch up
      return n;
    },
    reset() { held = false; t = 0; next = delay; },
  };
}

// opts (all optional, for tests): getPads(), target (where keydown is listened to), activeElement()
export function createMenuNav(handler, opts = {}) {
  const getPads = opts.getPads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
  const target = opts.target || (typeof window !== 'undefined' ? window : null);
  const active = opts.activeElement || (() => (typeof document !== 'undefined' ? document.activeElement : null));
  const api = { enabled: true, update, dispose };
  const emit = a => { if (api.enabled) { try { handler(a); } catch (e) { console.error(e); } } };

  // ---- keyboard: event driven, so a key press is never missed between frames
  const onKey = e => {
    if (!api.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = KEY_DIRS[e.code], btn = KEY_BUTTONS[e.code], digit = KEY_DIGITS[e.code];
    const el = active();
    if (isTyping(el)) {
      if (e.code === 'Escape') emit('back');     // Escape still leaves a text field
      return;
    }
    if (digit) {
      if (e.preventDefault) e.preventDefault();
      if (!e.repeat) emit('digit:' + digit);
    } else if (dir) {
      if (e.preventDefault) e.preventDefault();
      emit(dir);
    } else if (btn) {
      if (e.repeat && btn !== 'tab-left' && btn !== 'tab-right') return;     // a held Enter does not confirm again and again
      if (e.preventDefault) e.preventDefault();      // the menu handles it: the browser must not also click the focused button
      emit(btn);
    }
  };
  if (target && target.addEventListener) target.addEventListener('keydown', onKey);

  // ---- gamepad: polled
  const dirRep = { up: createRepeater(), down: createRepeater(), left: createRepeater(), right: createRepeater() };
  let prev = null;              // button states last frame (null until the first read, so a button held on opening is ignored)
  let stickDir = { up: false, down: false, left: false, right: false };

  function update(dt = 1 / 60) {
    if (!api.enabled) { prev = null; for (const k in dirRep) dirRep[k].reset(); return; }
    let pads = [];
    try { pads = getPads() || []; } catch (e) { /* blocked */ }
    const pad = Array.from(pads).find(p => p && p.connected !== false);
    if (!pad) { prev = null; return; }
    const b = pad.buttons || [], ax = pad.axes || [];
    const down = i => !!b[i] && (typeof b[i] === 'object' ? !!b[i].pressed || (+b[i].value || 0) > 0.5 : +b[i] > 0.5);
    const cur = [];
    for (let i = 0; i < 17; i++) cur[i] = down(i);
    // stick, with a little hysteresis so a stick resting near the threshold does not flutter
    const x = Number.isFinite(ax[0]) ? ax[0] : 0, y = Number.isFinite(ax[1]) ? ax[1] : 0;
    const horiz = Math.abs(x) >= Math.abs(y);
    const on = (name, v, big) => (stickDir[name] ? v > STICK_OFF && big : v > STICK_ON && big);
    stickDir = { left: on('left', -x, horiz), right: on('right', x, horiz), up: on('up', -y, !horiz), down: on('down', y, !horiz) };
    const typing = isTyping(active());
    if (prev === null) { prev = cur; for (const k in dirRep) dirRep[k].reset(); return; }
    const dirs = { up: cur[12] || stickDir.up, down: cur[13] || stickDir.down, left: cur[14] || stickDir.left, right: cur[15] || stickDir.right };
    for (const k of ['up', 'down', 'left', 'right']) {
      const n = dirRep[k].step(dirs[k] && !typing, dt);
      for (let i = 0; i < n; i++) emit(k);
    }
    for (const i in PAD_BUTTONS) if (cur[i] && !prev[i] && (!typing || PAD_BUTTONS[i] === 'back')) emit(PAD_BUTTONS[i]);
    prev = cur;
  }

  function dispose() {
    if (target && target.removeEventListener) target.removeEventListener('keydown', onKey);
    api.enabled = false;
  }
  return api;
}

// ---- focus movement ----------------------------------------------------------------------------------------------

const FOCUSABLE = 'button, [role=button], input, select, [tabindex]';

function usable(el, doc) {
  if (!el || el.disabled || el.hidden) return false;
  if (el.getAttribute && el.getAttribute('tabindex') === '-1') return false;
  if (el.type === 'hidden') return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  const view = doc && doc.defaultView;
  if (view && view.getComputedStyle) { const cs = view.getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; }
  return true;
}

const centre = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// The best element to move to from `cur` in direction `dir`, among `list`. Pure geometry, exported for tests.
// Candidates must lie in that direction (their centre past the current element's centre along the axis, and not fully
// beside it); the score prefers the closest along the axis and punishes sideways drift twice as hard.
export function bestInDirection(curRect, rects, dir) {
  const c = centre(curRect);
  const vert = dir === 'down' || dir === 'up';
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i], p = centre(r);
    const dx = p.x - c.x, dy = p.y - c.y;
    const along = vert ? (dir === 'down' ? dy : -dy) : (dir === 'right' ? dx : -dx);     // centre to centre, along the move
    const offset = Math.abs(vert ? dx : dy);                                                // centre to centre, across it
    // the gap between the facing edges, and how far the two are from overlapping across the move (0 if they overlap)
    const gap = Math.max(0, vert ? (dir === 'down' ? r.top - curRect.bottom : curRect.top - r.bottom) : (dir === 'right' ? r.left - curRect.right : curRect.left - r.right));
    const apart = Math.max(0, vert ? Math.max(r.left - curRect.right, curRect.left - r.right) : Math.max(r.top - curRect.bottom, curRect.top - r.bottom));
    if (along <= 1) continue;
    if (apart > 0 && offset > along) continue;      // outside a 45 degree cone and not beside it: not in that direction
    const score = gap + 3 * apart + 0.25 * offset + 0.01 * along;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// Moves focus inside `container`. Returns the newly focused element, the element whose value was changed
// (a slider or select given left or right), or null if nothing moved.
export function focusMove(container, dir) {
  if (!container || !['up', 'down', 'left', 'right'].includes(dir)) return null;
  const doc = container.ownerDocument || document;
  const list = Array.from(container.querySelectorAll(FOCUSABLE)).filter(el => usable(el, doc));
  if (!list.length) return null;
  const cur = doc.activeElement && list.includes(doc.activeElement) ? doc.activeElement : null;
  const ring = el => { for (const o of list) if (o.classList) o.classList.toggle('pad-focus', o === el); el.focus(); return el; };
  if (!cur) {
    // nothing focused here yet: the top-left element
    const first = list.slice().sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.top - rb.top || ra.left - rb.left; })[0];
    return ring(first);
  }
  if (dir === 'left' || dir === 'right') {
    const adj = adjustValue(cur, dir === 'right' ? 1 : -1);
    if (adj) return cur;
  }
  const others = list.filter(el => el !== cur);
  const i = bestInDirection(cur.getBoundingClientRect(), others.map(el => el.getBoundingClientRect()), dir);
  if (i < 0) { if (cur.classList) cur.classList.add('pad-focus'); return null; }
  return ring(others[i]);
}

// Left or right on a slider or select changes its value (and fires input / change like a person would).
function adjustValue(el, sign) {
  const fire = () => { for (const t of ['input', 'change']) el.dispatchEvent(new (el.ownerDocument.defaultView.Event)(t, { bubbles: true })); };
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const step = +el.step || 1, min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max;
    const v = Math.min(max, Math.max(min, (+el.value || 0) + sign * step * Math.max(1, Math.round((max - min) / step / 20))));
    if (v === +el.value) return true;
    el.value = String(v); fire(); return true;
  }
  if (el.tagName === 'SELECT') {
    const i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + sign));
    if (i !== el.selectedIndex) { el.selectedIndex = i; fire(); }
    return true;
  }
  return false;
}

// Clicks the focused element inside the container (what 'confirm' means on a button). Returns it, or null.
export function activateFocused(container) {
  const doc = container && (container.ownerDocument || document);
  const el = doc && doc.activeElement;
  if (!el || !container.contains(el)) return null;
  if (el.tagName === 'INPUT' && el.type === 'range') return null;
  el.click();
  return el;
}
