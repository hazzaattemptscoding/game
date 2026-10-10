// The menu tree, walked in headless Chromium with real clicks and keys: every entry of the main menu and every card of the Race
// screen starts or opens the right thing, Continue repeats the last mode, Back and Escape go up one level, the pause menu has its
// six actions with their number keys, and the settings tabs are the ones named. Run with `node tools/menuflow.js` (also part of
// `npm run check`). Skips if Chromium or Playwright is not installed (as smoke.mjs does).
// It runs the built game (tools/lib/dist.mjs) with ?norender=1: the game runs but draws nothing, so a click or a key does not wait
// on software GL for a frame. What a click does is tested here, not the picture (tools/smoke.mjs renders every kind of view).
// Waits are for frames (settle), not for fixed times.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { startDist } from './lib/dist.mjs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('menuflow: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);

const PORT = +process.env.MENUFLOW_PORT || 5196;
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const eq = (got, want, msg) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const server = await startDist(PORT);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });   // the layout the checks were written for; nothing is drawn, so its size costs nothing
await page.addInitScript(() => { try { localStorage.setItem('lakeside-settings', JSON.stringify({ quality: 'low' })); } catch (e) { /* no storage */ } });   // a light scene: the test drives the menu, not the picture
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// wait for the game to run n frames (a key or a click is acted on in the next frame, a menu is built before it)
const settle = (n = 4) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// what the menu shows now
const where = () => page.evaluate(() => {
  const m = document.getElementById('menu');
  return { screen: m.hidden ? null : m.dataset.screen, title: (document.getElementById('m-title') || {}).textContent || '', backShown: !!document.querySelector('#menu .m-back') && !document.querySelector('#menu .m-back').hidden };
});
const session = () => page.evaluate(() => { const s = window.lakeside.dir.session; return s ? { mode: s.mode, laps: s.laps, start: s.start, reverse: !!s.reverse } : null; });
const texts = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(e => (e.querySelector('.nav-text > span, .card-title') || e).textContent), sel);
// a click on the first visible match. It is sent from the page (el.click()): with the 3D scene rendering in software GL a pointer click
// from the driver can wait on a busy frame for a long time, and what is tested here is what the click does, not where it lands.
const click = async sel => {
  const ok = await page.evaluate(s => { const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length > 0); if (el) el.click(); return !!el; }, sel);
  if (!ok) throw new Error(`click ${sel}: nothing visible to click`);
  await settle();
};
const press = async k => { await page.keyboard.press(k); await settle(); };
const toMain = async () => { await page.evaluate(() => window.lakeside.dir.api.toMainMenu()); await settle(); };
const entry = id => `#menu .nav-item[data-entry=${id}]`;
const card = id => `#menu .card[data-mode=${id}]`;

try {
  await page.goto(`http://localhost:${PORT}/?menu=main&norender=1`, { timeout: 120000 });
  await page.waitForSelector('#menu[data-screen=main] .nav-item', { timeout: 120000 });
  await settle(10);

  console.log('MAIN MENU');
  eq(await texts('#menu .nav-item'), ['Race', 'Garage', 'Leaderboard', 'Settings'], 'the main menu entries');
  eq(await page.evaluate(() => [...document.querySelectorAll('#menu .nav-item kbd')].map(k => k.textContent)), ['1', '2', '3', '4'], 'their number keys');
  check((await page.locator('#menu .nav-continue').count()) === 0, 'no Continue button before any mode was started');
  check(await page.evaluate(() => document.activeElement && document.activeElement.dataset.entry === 'race'), 'the focus starts on Race when there is no Continue');
  check(!(await where()).backShown, 'the main menu has no Back button');
  await press('Escape'); eq((await where()).screen, 'main', 'Escape on the main menu stays on it');

  console.log('ENTRIES, BACK AND ESCAPE');
  for (const [id, title, key] of [['race', 'Race', 'Digit1'], ['garage', 'Garage', 'Digit2'], ['times', 'Leaderboard', 'Digit3'], ['settings', 'Settings', 'Digit4']]) {
    await click(entry(id));
    let w = await where(); eq([w.screen, w.title, w.backShown], [id, title, true], `${title} by click`);
    await click('#menu .m-back'); eq((await where()).screen, 'main', `Back from ${title} goes to the main menu`);
    await press(key); w = await where(); eq([w.screen, w.title], [id, title], `${title} by its number key`);
    await press('Escape'); eq((await where()).screen, 'main', `Escape from ${title} goes to the main menu`);
  }

  console.log('RACE CARDS');
  await click(entry('race'));
  eq(await texts('#menu .card'), ['Hot lap', 'Free drive', 'Solo race', 'Online race'], 'the Race cards');
  eq(await page.evaluate(() => [...document.querySelectorAll('#menu .card')].map(c => !!c.querySelector('.card-line').textContent.trim() && c.querySelectorAll('.chips em').length > 0)), [true, true, true, true], 'each card says what happens and carries chips');
  for (const [k, id] of [['Digit1', 'timetrial'], ['Digit2', 'practice'], ['Digit3', 'race'], ['Digit4', 'online']]) {
    await press(k);
    const w = await where();
    if (id === 'timetrial') { eq(await session(), { mode: 'timetrial', laps: 0, start: 'track', reverse: false }, 'key 1 starts a hot lap'); check(w.screen === null, 'the menu closes for a hot lap'); await toMain(); await click(entry('race')); }
    else if (id === 'online') { eq(w.screen, 'online', 'key 4 opens the online race screen'); await press('Escape'); eq((await where()).screen, 'race', 'Escape from the lobby goes up to the Race screen'); }
    else { eq(w.screen, 'setup', `key ${k.slice(-1)} opens the setup`); await press('Escape'); eq((await where()).screen, 'race', 'Escape from a setup goes up to the Race screen'); }
  }
  await click(card('practice')); eq((await where()).title, 'Free drive', 'the free drive setup is titled Free drive');
  await click('#menu .summary .btn.primary'); eq(await session(), { mode: 'practice', laps: 0, start: 'pit', reverse: false }, 'Start free drive starts a free drive from the pit lane');
  await toMain(); await click(entry('race'));
  await click(card('race')); eq((await where()).title, 'Solo race', 'the solo race setup is titled Solo race');
  await click('#menu .summary .btn.primary'); eq(await session(), { mode: 'race', laps: 5, start: 'standing', reverse: false }, 'Start race starts a five lap race from the grid');
  await toMain(); await click(entry('race'));
  await click(card('online')); eq((await where()).screen, 'online', 'the Online race card opens the lobby');
  check((await page.locator('#mp-host').count()) > 0 && (await page.locator('#mp-join').count()) > 0, 'the lobby has Host a room and Join');
  await toMain();

  console.log('CONTINUE');
  for (const [mode, label, want] of [['timetrial', 'Hot lap', { mode: 'timetrial', laps: 0, start: 'track', reverse: false }], ['practice', 'Free drive', { mode: 'practice', laps: 0, start: 'pit', reverse: false }], ['race', 'Solo race', { mode: 'race', laps: 5, start: 'standing', reverse: false }]]) {
    await page.evaluate(m => { window.lakeside.settings.lastMode = m; window.lakeside.dir.menu.open('main', 'main'); }, mode); await settle();
    eq(await page.evaluate(() => document.querySelector('#menu .nav-continue').textContent), `Continue: ${label}`, `Continue is labelled with the last mode (${mode})`);
    check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('nav-continue')), 'the focus starts on Continue');
    await press('Enter'); eq(await session(), want, `Enter on Continue: ${label} starts it`);
    eq(await page.evaluate(() => window.lakeside.settings.lastMode), mode, 'the last mode is kept');
    await toMain();
  }
  await page.evaluate(() => { window.lakeside.settings.lastMode = 'online'; window.lakeside.dir.menu.open('main', 'main'); }); await settle();
  eq(await page.evaluate(() => document.querySelector('#menu .nav-continue').textContent), 'Continue: Online race', 'Continue names the online race');
  await click('#menu .nav-continue'); eq((await where()).screen, 'online', 'Continue: Online race opens the lobby');
  await toMain();

  console.log('PAUSE MENU');
  await click(entry('race')); await click(card('practice')); await click('#menu .summary .btn.primary'); await settle(8);
  await press('Escape');
  eq((await where()).screen, 'pause', 'Escape in a session opens the pause menu');
  // exactly the buttons that are shown, in order. Screen control is among them while the game says the driver may run the gantry screen
  // (api.screen.canControl(): true in a free drive on one's own, in a room only for the host or a driver the host ticked).
  const mayScreen = await page.evaluate(() => !!window.lakeside.dir.api.screen.canControl());
  eq(await page.evaluate(() => [...document.querySelectorAll('#menu .pause-body button')].filter(b => b.offsetParent).map(b => b.querySelector('span').textContent)),
    ['Resume', 'Restart', 'Garage', 'Settings', 'Leaderboard', ...(mayScreen ? ['Screen control'] : []), 'Report a problem', 'Quit to menu'], 'the pause actions');
  eq(await page.evaluate(() => [...document.querySelectorAll('#menu .pause-body kbd')].map(k => k.textContent)), ['1', '2', '3', '4', '5', '6'], 'their number keys');
  for (const [k, id, title] of [['Digit3', 'garage', 'Garage'], ['Digit4', 'settings', 'Settings'], ['Digit5', 'times', 'Leaderboard']]) {
    await press(k); const w = await where(); eq([w.screen, w.title, w.backShown], [id, title, true], `pause key ${k.slice(-1)} opens ${title} with a Back button`);
    await press('Escape'); eq((await where()).screen, 'pause', `Escape from ${title} goes back to the pause menu`);
  }
  await press('Digit2'); eq([(await where()).screen, (await session()).mode], [null, 'practice'], 'Restart restarts the same session and closes the menu');
  await press('Escape'); await press('Digit1'); eq((await where()).screen, null, 'Resume (1) closes the pause menu');
  await press('Escape'); await press('Escape'); eq((await where()).screen, null, 'Escape in the pause menu resumes');
  await press('Escape'); await press('Digit6');
  check(await page.evaluate(() => /Quit to the main menu/.test(document.querySelector('#menu .confirm').textContent) && !document.querySelector('#menu .confirm').hidden), 'Quit to menu asks first');
  await click('#menu .confirm .actions .btn:not(.danger)');
  eq((await where()).screen, 'pause', 'Stay keeps the pause menu'); check((await session()) !== null, 'and the session');
  await press('Digit6'); await click('#menu .confirm .actions .btn.danger');
  eq([(await where()).screen, await session()], ['main', null], 'Quit to menu ends the session and shows the main menu');

  console.log('A CLASS PICKED DURING A SESSION');
  {
    const carNow = () => page.evaluate(() => window.lakeside.car.cfg.id);
    const pickInGarage = label => page.evaluate(l => { const b = [...document.querySelectorAll('.gar .opt')].find(x => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
    await click(entry('race')); await click(card('practice')); await click('#menu .summary .btn.primary'); await settle(8);
    eq(await carNow(), 'GT', 'the free drive starts in the GT');
    await press('Escape'); await press('Digit3');
    check(await pickInGarage('GT1'), 'the garage offers the GT1');
    await settle();
    eq(await carNow(), 'GT', 'a class picked in the garage during a session does not change the car (paused)');
    check(await page.evaluate(() => /next session/.test(document.querySelector('.gar').textContent)), 'the garage says it takes effect at the next session');
    await press('Escape'); await press('Digit1'); await settle(30);
    eq(await carNow(), 'GT', 'and not after the session resumes, the car still moving or not');
    await press('Escape'); await press('Digit2');
    eq([await carNow(), (await session()).mode], ['GT1', 'practice'], 'Restart is a session boundary: the picked class takes effect there');
    await toMain();
    await click(entry('garage'));
    check(await pickInGarage('GT'), 'back in the main menu the garage offers the GT');
    await settle();
    eq(await carNow(), 'GT', 'with no session running a class takes effect at once');
    await toMain();
  }

  console.log('SETTINGS');
  await click(entry('settings'));
  eq(await page.evaluate(() => [...document.querySelectorAll('#menu .sub-item')].map(b => b.textContent)), ['Driving', 'Controls', 'Graphics', 'HUD', 'Weather', 'Sound', 'Online'], 'the settings tabs');
  for (const t of ['Driving', 'Graphics', 'HUD', 'Weather', 'Sound', 'Online']) { await click(`#menu .sub-item[data-tab=${t}]`); check(await page.evaluate(() => document.querySelectorAll('#menu .set-panel .row').length > 0), `the ${t} tab has rows`); }
} catch (e) { errors.push(e.message.split('\n')[0]); }
await browser.close(); server.stop();
for (const e of errors) fails.push('page: ' + e);
if (fails.length) { console.log('\nFAILED'); for (const f of fails) console.log('  ' + f); process.exit(1); }
console.log('menuflow: all checks passed');
