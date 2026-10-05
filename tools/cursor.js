// Cursor steering and settings test. Run with `npm run cursor` (also part of `npm run check`). No browser needed.
//   1. cursorSteer: the mouse position to steering mapping (dead zone, curve, clamp, sensitivity)
//   2. the keyboard model is untouched by the cursor code
//   3. settings: the old single `assists` switch becomes the three
import { cursorSteer, CURSOR_DEADZONE, keyboardStep } from '../src/inputModel.js';
import { migrateSettings } from '../src/settings.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const W = 1000;

console.log('CURSOR STEERING');
check(cursorSteer(500, W) === 0, 'centre is zero');
check(cursorSteer(500 + 0.03 * 500, W) === 0 && cursorSteer(500 - 0.03 * 500, W) === 0, 'inside the dead zone is zero');
check(cursorSteer(500 + (CURSOR_DEADZONE + 0.02) * 500, W) > 0, 'just outside the dead zone steers');
check(cursorSteer(W, W) === 1 && cursorSteer(0, W) === -1, 'the edges are full lock');
check(cursorSteer(2 * W, W) === 1 && cursorSteer(-500, W) === -1, 'outside the window clamps');
for (const x of [120, 340, 777]) check(Math.abs(cursorSteer(x, W) + cursorSteer(W - x, W)) < 1e-12, `symmetric at ${x}`);
let mono = true, prev = -2;
for (let x = 0; x <= W; x += 5) { const v = cursorSteer(x, W); if (v < prev - 1e-12) mono = false; prev = v; }
check(mono, 'never goes back as the mouse moves right');
// the curve: the middle is finer than a straight line, so a quarter of the way out is well under a quarter of full lock
const quarter = cursorSteer(500 + 125, W);   // a quarter of the way to the right edge
check(quarter < 0.2 && quarter > 0.05, `middle is fine (a quarter out gives ${quarter.toFixed(3)})`);
check(cursorSteer(500 + 375, W) < 0.7, 'three quarters out is still short of full lock');
check(cursorSteer(500 + 250, W, 2) === 1 || cursorSteer(500 + 250, W, 2) > cursorSteer(500 + 250, W, 1), 'higher sensitivity steers more');
check(cursorSteer(500 + 250, W, 0.5) < cursorSteer(500 + 250, W, 1), 'lower sensitivity steers less');
check(cursorSteer(W, W, 0.5) <= 0.5 + 1e-12 && cursorSteer(W, W, 2) === 1, 'sensitivity scales and clamps');
check(cursorSteer(100, 0) === 0 && cursorSteer(NaN, W) === 0, 'no width or no position is zero');
console.log(`  a quarter out ${quarter.toFixed(3)}, half out ${cursorSteer(750, W).toFixed(3)}, three quarters ${cursorSteer(875, W).toFixed(3)}, edge ${cursorSteer(W, W)}`);

console.log('KEYBOARD MODEL');
{
  // the numbers the keyboard produced before the cursor was added (full lock in about 0.3 s, centres at 6 per second)
  const st = { steer: 0, throttle: 0, brake: 0 };
  for (let k = 0; k < 120; k++) keyboardStep(st, { left: false, right: true, up: true, down: false }, 1 / 120, 0);
  check(Math.abs(st.steer - 1) < 1e-9 && Math.abs(st.throttle - 1) < 1e-9, 'keyboard reaches full lock and throttle in a second');
  for (let k = 0; k < 20; k++) keyboardStep(st, { left: false, right: false, up: false, down: false }, 1 / 120, 0);
  check(Math.abs(st.steer - (1 - 6 * 20 / 120)) < 1e-9, 'keyboard centres at 6 per second');
}

console.log('SETTINGS');
{
  const old = migrateSettings({ units: 'kmh', assists: false, sound: false });
  check(old.assistTc === false && old.assistAbs === false && old.assistEsc === false && !('assists' in old), 'old assists:false sets all three off');
  check(old.units === 'kmh' && old.sound === false, 'other settings are kept');
  const on = migrateSettings({ assists: true });
  check(on.assistTc === true && on.assistAbs === true && on.assistEsc === true, 'old assists:true sets all three on');
  const mixed = migrateSettings({ assists: false, assistAbs: true });
  check(mixed.assistTc === false && mixed.assistAbs === true && mixed.assistEsc === false, 'a new setting wins over the old switch');
  const fresh = migrateSettings({ assistTc: false });
  check(fresh.assistTc === false && !('assistAbs' in fresh), 'new settings pass through, the rest stays at its default');
  // damaged data gives no saved choices; the controller block and the HUD keys (src/hudSettings.js) are always filled in with their defaults
  const onlyController = o => Object.keys(o).every(k => ['controller', 'hud', 'hudScale', 'trackMap'].includes(k));
  check(onlyController(migrateSettings(null)) && onlyController(migrateSettings('x')), 'damaged data gives nothing but the controller and HUD defaults');
  const bad = migrateSettings({ steering: 'mouse', steerSens: 9 });
  check(!('steering' in bad) && !('steerSens' in bad), 'unknown steering and silly sensitivity are dropped');
  const ok = migrateSettings({ steering: 'cursor', steerSens: 1.5 });
  check(ok.steering === 'cursor' && ok.steerSens === 1.5, 'cursor steering and sensitivity are kept');
}

if (fails.length) { console.log('\nFAILED'); for (const f of fails) console.log('  ' + f); process.exit(1); }
console.log('  all passed');
