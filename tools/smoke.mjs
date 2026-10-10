// Smoke test: opens the built game in headless Chromium and fails on any page error. Skips if Chromium is not installed.
//
// It serves a fresh build (tools/lib/dist.mjs) instead of the dev server, and loads the page as few times as it can: a software GL
// page load costs most of the time (every shader compiles), and what a weather, a time of day, a track map option, a menu or a
// session start does to the page does not need a new load. So one landscape page is loaded and walked through all of them with
// window.lakeside, and each state waits for a few drawn frames (not a fixed time) so its code really runs. Pages are still loaded
// fresh for what only a load can reach: a start=race boot, a fixed camera view (viewat=, at night in heavy rain), the main menu as the first screen, and the phone layouts
// (a touch device context, which the page reads when it loads). Everything is drawn: nothing here uses ?norender.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { startDist } from './lib/dist.mjs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('smoke: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);
const PORT = +process.env.SMOKE_PORT || 5198;
const server = await startDist(PORT);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errors = [];
const PHONE = { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const LAND = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 640, height: 320 } };   // software GL cost follows the pixels; errors do not
let states = 0;

// Wait for n frames to be drawn (requestAnimationFrame runs once per game frame). A page that draws fewer in `ms` is an error:
// a stuck or crashed page must not pass just because nothing threw.
async function frames(page, label, what, n = 5, ms = 60000) {
  states++;
  const ok = await page.evaluate(([n, ms]) => new Promise(resolve => {
    let k = 0; const t = setTimeout(() => resolve(false), ms);
    const f = () => { if (++k >= n) { clearTimeout(t); resolve(true); } else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }), [n, ms]);
  if (!ok) errors.push(`${label}: ${what}: fewer than ${n} frames in ${ms / 1000} s`);
  return ok;
}
// run one state: do something in the page, then draw a few frames of it
async function state(page, label, what, fn, arg, n = 3) {
  const t0 = Date.now();
  try { await page.evaluate(fn, arg); } catch (e) { errors.push(`${label}: ${what}: ${e.message.split('\n')[0]}`); return; }
  await frames(page, label, what, n);
  if (process.env.SMOKE_LOG) console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${label}: ${what}`);
}

async function open(label, q, ctxOptions = DESKTOP) {
  const t0 = Date.now();
  const ctx = await browser.newContext(ctxOptions);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${label}: console ${m.text()}`); });
  await page.goto(`http://localhost:${PORT}/${q}`, { timeout: 240000, waitUntil: 'commit' });   // the load event waits on the first software GL frame; frames() below waits for that
  await page.keyboard.down('ArrowUp');   // a key press unlocks the audio (it may stay suspended with no sound device)
  await frames(page, label, 'first frames', 6, 300000);
  if (process.env.SMOKE_LOG) console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${label}: loaded, 6 frames`);
  return { ctx, page };
}

// --- the pages; each runs on its own and three at a time ---
const jobs = [];
const only = process.env.SMOKE_ONLY || '';       // a part of a page's name: run just those (for looking into one)
const job = (label, fn) => only && !label.includes(only) ? 0 : jobs.push(async () => {
  let h = null;
  try { h = await fn(label); } catch (e) { errors.push(`${label}: ${e.message.split('\n')[0]}`); }
  if (h) { try { await h.page.keyboard.up('ArrowUp'); } catch { /* closed */ } await h.ctx.close().catch(() => {}); }
  if (process.env.SMOKE_LOG) console.log(`${label} done`);
});

// 1. driving on a landscape page, and then every state that does not need a new load
job('drive page', async label => {
  const h = await open(label, '?menu=0');
  const p = h.page;
  await state(p, label, 'top-down camera', () => window.lakeside.dir.api.setTopDown(true));
  await state(p, label, 'normal camera again', () => window.lakeside.dir.api.setTopDown(false));
  // weather and time of day (the same states the old per-URL views had)
  for (const [w, t] of [['fog', 'dusk'], ['heavyrain', 'golden'], ['heavyrain', 'night'], ['lightrain', 'dusk'], ['clear', 'midday']]) {
    await state(p, label, `${w} at ${t}`, ([w, t]) => { const l = window.lakeside; l.settings.weather = w; l.settings.timeOfDay = t; l.env.set({ weather: w, time: t }, { instant: true }); }, [w, t]);
  }
  // track map options
  await state(p, label, 'large rotating map with corner numbers', () => Object.assign(window.lakeside.settings.trackMap, { on: true, size: 'large', position: 'tl', opacity: 0.5, rotate: true, zoom: 'local', labels: 'numbers' }));
  await state(p, label, 'small map at the bottom left', () => Object.assign(window.lakeside.settings.trackMap, { on: true, size: 'small', position: 'bl', rotate: false, zoom: 'circuit', labels: 'numbers' }));
  // the menus, from the main menu: Race, Settings (and its Weather and HUD tabs), Garage, Online
  await state(p, label, 'main menu', () => window.lakeside.dir.api.toMainMenu());
  await state(p, label, 'race menu', () => window.lakeside.dir.menu.push('race'));
  await state(p, label, 'online menu', () => window.lakeside.dir.menu.push('online'));
  await state(p, label, 'garage', () => { window.lakeside.dir.api.toMainMenu(); window.lakeside.dir.menu.push('garage'); }, undefined, 8);
  await state(p, label, 'settings', () => { window.lakeside.dir.api.toMainMenu(); window.lakeside.dir.menu.push('settings'); });
  for (const tab of ['Weather', 'HUD']) {
    const clicked = await p.evaluate(t => { const b = document.querySelector(`#menu .sub-item[data-tab=${t}]`); if (b) b.click(); return !!b; }, tab);
    if (clicked) await frames(p, label, `settings ${tab} tab`); else errors.push(`${label}: no "${tab}" button`);
  }
  // sessions started from the menu
  await state(p, label, 'race start', () => { window.lakeside.dir.api.toMainMenu(); window.lakeside.dir.api.startRace({ laps: 3 }); }, undefined, 8);
  await state(p, label, 'hot lap start', () => { window.lakeside.dir.api.toMainMenu(); window.lakeside.dir.api.startTimeTrial(); }, undefined, 8);
  await state(p, label, 'free drive start', () => { window.lakeside.dir.api.toMainMenu(); window.lakeside.dir.api.startPractice(); }, undefined, 8);
  return h;
});
// 2. what only a load reaches: the main menu as the first screen, the start= boot paths, three fixed camera views
job('main menu page', label => open(label, ''));
job('start=race page', label => open(label, '?start=race&mute'));
job('viewat night page', label => open(label, '?viewat=3800,-8,1.8,40&menu=0&weather=heavyrain&time=night'));
// 3. phones: the on-screen controls, portrait and landscape; the portrait page also takes the night and the map options
job('phone portrait page', async label => {
  const h = await open(label, '?menu=0&mute', PHONE);
  try { await h.page.touchscreen.tap(200, 400); } catch { /* no touch in this context */ }
  await frames(h.page, label, 'touch controls', 5);
  await state(h.page, label, 'heavy rain at night', () => { const l = window.lakeside; l.settings.weather = 'heavyrain'; l.settings.timeOfDay = 'night'; l.env.set({ weather: 'heavyrain', time: 'night' }, { instant: true }); });
  await state(h.page, label, 'large map at the bottom right', () => Object.assign(window.lakeside.settings.trackMap, { on: true, position: 'br', size: 'large' }));
  return h;
});
job('phone landscape page', async label => {
  const h = await open(label, '?menu=0&mute', LAND);
  try { await h.page.touchscreen.tap(200, 200); } catch { /* no touch in this context */ }
  await frames(h.page, label, 'touch controls', 5);
  return h;
});

// three pages at a time
let next = 0;
await Promise.all(Array.from({ length: +process.env.SMOKE_PARALLEL || 2 }, (_, i) => i).map(async () => { while (next < jobs.length) await jobs[next++](); }));
await browser.close(); server.stop();
console.log(errors.length ? 'smoke FAILED:\n  ' + errors.join('\n  ') : `smoke: no page errors in ${jobs.length} page loads and ${states} drawn states (drive, top-down, fixed views, weather and night, track map options, menus, race and hot lap start, phone)`);
process.exitCode = errors.length ? 1 : 0;
