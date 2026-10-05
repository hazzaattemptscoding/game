// Drives the real game in headless Chromium with a synthetic gamepad (navigator.getGamepads is replaced by a fake whose
// axes and buttons the test changes). Run with `node tools/gamepad-live.mjs [--shots dir]`; part of `npm run check`.
// Skips if Chromium is not installed. A real pad cannot be tested here: see the notes in the final report.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('gamepad-live: Chromium or Playwright not found, skipped'); process.exit(0); }
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const { chromium } = createRequire(import.meta.url)(pw);
const PORT = 5197;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errors = [], fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// the fake pad lives in the page: window.__pad (axes, buttons), window.__padOn, window.__rumble (effects played)
const FAKE = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  window.__pad = { id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0,
    vibrationActuator: { type: 'dual-rumble', playEffect(type, p) { window.__rumble.push(p); return Promise.resolve('complete'); }, reset() { return Promise.resolve('complete'); } } };
  window.__rumble = [];
  window.__padOn = false;
  navigator.getGamepads = () => (window.__padOn ? [window.__pad, null, null, null] : [null, null, null, null]);
  window.__set = ({ axes, buttons: bs }) => {
    if (axes) window.__pad.axes = axes;
    if (bs) for (const [i, v] of Object.entries(bs)) window.__pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v };
  };
};
async function open(q, size = { width: 960, height: 540 }) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', e => errors.push(`${q}: ${e.message}`));
  await page.addInitScript(FAKE);
  await page.goto(`http://localhost:${PORT}/${q}`);
  await page.waitForTimeout(1500);
  return page;
}

// 1. drive with the pad: throttle, steer, device switching, rumble, reset, disconnect
{
  const page = await open('?mute');
  const st = () => page.evaluate(() => ({ speed: window.lakeside.car.speed, steer: window.lakeside.car.steer, device: window.lakeside.input.device, name: window.lakeside.input.padName, heading: window.lakeside.car.heading }));
  const s0 = await st();
  check(s0.device === 'keyboard', 'starts on the keyboard');
  await page.evaluate(() => { window.__padOn = true; window.__set({ buttons: { 7: 1 } }); });
  await page.waitForTimeout(3000);
  const s1 = await st();
  check(s1.speed > 8, `the right trigger accelerates the car (speed ${s1.speed.toFixed(1)} m/s)`);
  check(s1.device === 'gamepad' && /Xbox/.test(s1.name), `device is gamepad (${s1.device}, ${s1.name})`);
  await page.evaluate(() => window.__set({ axes: [0.6, 0] }));
  await page.waitForTimeout(600);
  const s2 = await st();
  check(s2.steer > 0.05, `the stick steers right (car steer ${s2.steer.toFixed(3)})`);
  await page.evaluate(() => window.__set({ axes: [-1, 0] }));
  await page.waitForTimeout(700);
  const s3 = await st();
  check(s3.steer < -0.05, `and left (car steer ${s3.steer.toFixed(3)})`);
  console.log(`  speed ${s1.speed.toFixed(1)} m/s after 3 s of throttle, steer ${s2.steer.toFixed(3)} / ${s3.steer.toFixed(3)} (right, left)`);
  // run it off for a while: kerbs, grass and a barrier make rumble
  await page.waitForTimeout(3500);
  const effects = await page.evaluate(() => window.__rumble.length);
  const strongest = await page.evaluate(() => Math.max(0, ...window.__rumble.map(e => e.strongMagnitude)));
  check(effects > 0, `rumble effects were played (${effects}, strongest ${strongest.toFixed(2)})`);
  check(await page.evaluate(() => window.__rumble.every(e => e.strongMagnitude >= 0 && e.strongMagnitude <= 1 && e.weakMagnitude >= 0 && e.weakMagnitude <= 1 && e.duration > 0)), 'every effect is in range');
  // B resets the car
  await page.evaluate(() => window.__set({ axes: [0, 0], buttons: { 7: 0, 1: 1 } }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__set({ buttons: { 1: 0 } }));
  await page.waitForTimeout(300);
  check((await st()).speed < 3, 'B resets the car');
  // Back held shows the board, released hides it
  await page.evaluate(() => window.__set({ buttons: { 8: 1 } }));
  await page.waitForTimeout(300);
  const boardOn = await page.evaluate(() => !document.getElementById('board').hidden);
  await page.evaluate(() => window.__set({ buttons: { 8: 0 } }));
  await page.waitForTimeout(300);
  const boardOff = await page.evaluate(() => document.getElementById('board').hidden);
  check(boardOn && boardOff, `Back shows the times board while held (${boardOn}, ${boardOff})`);
  // Start opens the settings, and again closes it
  await page.evaluate(() => window.__set({ buttons: { 9: 1 } }));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__set({ buttons: { 9: 0 } }));
  await page.waitForTimeout(250);
  const open1 = await page.evaluate(() => !document.getElementById('settings').hidden);
  await page.evaluate(() => window.__set({ buttons: { 9: 1 } }));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__set({ buttons: { 9: 0 } }));
  await page.waitForTimeout(250);
  const open2 = await page.evaluate(() => !document.getElementById('settings').hidden);
  check(open1 && !open2, `Start opens and closes the settings (${open1}, ${open2})`);
  // a key press goes back to the keyboard
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(200); await page.keyboard.up('ArrowUp');
  check((await st()).device === 'keyboard', 'a key press switches back to the keyboard');
  // the pad is used again when touched
  await page.evaluate(() => window.__set({ buttons: { 7: 1 } }));
  await page.waitForTimeout(300);
  check((await st()).device === 'gamepad', 'and the pad takes over again when used');
  // disconnect
  await page.evaluate(() => { window.__padOn = false; window.dispatchEvent(new Event('gamepaddisconnected')); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__padOn = true; window.__pad.connected = false; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__padOn = false; });
  await page.waitForTimeout(500);
  const s4 = await st();
  check(s4.device === 'keyboard' || s4.name === '', `the pad disconnecting is harmless (device ${s4.device}, name '${s4.name}')`);
  await page.close();
}

// 2. text fields: a pad press while typing in a field does nothing
{
  const page = await open('?mute');
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tf'; i.type = 'text'; document.body.appendChild(i); i.focus(); window.__padOn = true; });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__set({ buttons: { 9: 1 } }));
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.getElementById('settings').hidden), 'Start does nothing while a text field has focus');
  await page.close();
}

// 3. the Controls screen: live bars, remap, swap, persistence, reset
for (const [name, size] of [['tablet', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await open('?controls&mute', size);
  check(await page.evaluate(() => /No controller/.test(document.getElementById('ctl-name').textContent)), `${name}: shows that no controller is found`);
  await page.evaluate(() => { window.__padOn = true; window.__set({ axes: [0.7, -0.2], buttons: { 7: 0.6, 6: 0.25, 0: 1, 5: 1 } }); });
  await page.waitForTimeout(700);
  const name1 = await page.evaluate(() => document.getElementById('ctl-name').textContent);
  check(name1 === 'Xbox 360 Controller', `${name}: shows the pad's name (${name1})`);
  const live = await page.evaluate(() => ({ thr: document.getElementById('ctl-thr-v').textContent, brk: document.getElementById('ctl-brk-v').textContent, steer: document.getElementById('ctl-steer-v').textContent, on: [...document.querySelectorAll('#ctl-btns b.on')].map(b => b.textContent) }));
  check(live.thr === '58%' && live.brk === '22%' && +live.steer > 0.1 && live.on.join() === 'A,RB', `${name}: live values (${JSON.stringify(live)})`);
  if (shots) await page.screenshot({ path: `${shots}/controls-${name}-live.png` });
  await page.evaluate(() => window.__set({ axes: [0, 0], buttons: { 7: 0, 6: 0, 0: 0, 5: 0 } }));
  await page.waitForTimeout(200);
  // remap Racing line to RB
  await page.click('#ctl-map button[data-action=line]');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('#ctl-map button.listen em').textContent) === 'Press a button', `${name}: the action waits for a button`);
  if (shots && name === 'tablet') await page.screenshot({ path: `${shots}/controls-${name}-listen.png` });
  // Esc cancels
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => !document.querySelector('#ctl-map button.listen')), `${name}: Esc cancels the remap`);
  await page.click('#ctl-map button[data-action=line]');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__set({ buttons: { 5: 1 } }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__set({ buttons: { 5: 0 } }));
  await page.waitForTimeout(200);
  let b = await page.evaluate(() => window.lakeside.settings.controller.bindings);
  check(b.line === 5, `${name}: line is now bound to RB (${b.line})`);
  // bind DRS to the button the line had (RB): they swap
  await page.click('#ctl-map button[data-action=drs]');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__set({ buttons: { 5: 1 } }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__set({ buttons: { 5: 0 } }));
  await page.waitForTimeout(200);
  b = await page.evaluate(() => window.lakeside.settings.controller.bindings);
  check(b.drs === 5 && b.line === 0, `${name}: binding a used button swaps (drs ${b.drs}, line ${b.line})`);
  // the settings are saved
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lakeside-settings')).controller.bindings);
  check(saved.drs === 5 && saved.line === 0, `${name}: the bindings are saved`);
  // a slider changes the setting live, and reset puts it back
  await page.evaluate(() => { const i = document.getElementById('ctl-curve'); i.value = '2'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await page.evaluate(() => window.lakeside.settings.controller.curve) === 2, `${name}: a slider changes controller.curve`);
  await page.click('#ctl-drs button[data-v=hold]');
  check(await page.evaluate(() => window.lakeside.settings.controller.drsMode) === 'hold', `${name}: DRS mode hold`);
  if (shots) await page.screenshot({ path: `${shots}/controls-${name}-changed.png`, fullPage: false });
  await page.click('#ctl-reset');
  const d = await page.evaluate(() => window.lakeside.settings.controller);
  check(d.curve === 1.5 && d.drsMode === 'toggle' && d.bindings.drs === 0 && d.bindings.line === 3, `${name}: reset restores the defaults`);
  // Start while binding does not open the settings (the capture flag), and does bind
  await page.click('#ctl-map button[data-action=camera]');
  await page.evaluate(() => window.__set({ buttons: { 9: 1 } }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__set({ buttons: { 9: 0 } }));
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.getElementById('settings').hidden), `${name}: pressing Start to bind it does not open the settings`);
  // scroll the overlay to the bottom for the keyboard list
  if (shots) { await page.evaluate(() => { document.querySelector('.ctl-overlay').scrollTop = 99999; }); await page.screenshot({ path: `${shots}/controls-${name}-bottom.png` }); }
  await page.close();
}

await browser.close(); server.kill();
console.log(errors.length ? 'page errors:\n  ' + errors.join('\n  ') : 'gamepad-live: no page errors');
console.log(fails.length ? 'gamepad-live FAILED:\n  ' + fails.join('\n  ') : 'gamepad-live: all checks passed');
process.exitCode = errors.length || fails.length ? 1 : 0;
