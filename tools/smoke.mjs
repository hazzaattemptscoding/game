// Smoke test: opens the game in headless Chromium and fails on any page error. Skips if Chromium is not installed.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { startVite } from './lib/vite.mjs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('smoke: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);
const server = await startVite(5198);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errors = [];
const map = o => ({ 'lakeside-settings': JSON.stringify({ trackMap: o }) });
const PHONE = { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const LAND = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
// [query, options]: options.ctx = page options, store = localStorage entries set before the page loads, click = text of a button to press after loading, touch = send a touch so the on-screen controls show
const views = [
  ['?menu=0'], ['?menu=0&topdown'], ['?viewat=3800,-8,1.8,40&menu=0'], ['?menu=0&mute'], [''], ['?menu=race'], ['?menu=settings'], ['?menu=garage'], ['?menu=online'], ['?start=race&mute'], ['?start=timetrial&mute'],
  // weather and time of day
  ['?menu=0&weather=fog&time=dusk'], ['?menu=0&weather=heavyrain&time=golden'], ['?menu=0&weather=heavyrain&time=night'],
  ['?viewat=3800,-8,1.8,40&menu=0&weather=heavyrain&time=night'], ['?viewat=1790,0,6,40&menu=0&weather=lightrain&time=dusk'],
  ['?menu=settings', { click: 'Weather' }],
  // track map options
  ['?menu=0', { store: map({ on: true, size: 'large', position: 'tl', opacity: 0.5, rotate: true, zoom: 'local', labels: 'numbers' }) }],
  ['?menu=0', { store: map({ on: true, size: 'small', position: 'bl', rotate: false, zoom: 'circuit', labels: 'numbers' }) }],
  ['?menu=settings', { click: 'HUD' }],
  // phone: driving with the on-screen controls, portrait and landscape, day and wet night
  ['?menu=0&mute', { ctx: PHONE, touch: true }], ['?menu=0&mute', { ctx: LAND, touch: true }],
  ['?menu=0&mute&weather=heavyrain&time=night', { ctx: PHONE, touch: true }],
  ['?menu=0&mute', { ctx: PHONE, touch: true, store: map({ on: true, position: 'br', size: 'large' }) }],
];
async function run([q, o = {}]) {
  const t0 = Date.now();
  const label = (q || '/') + (o.ctx ? (o.ctx === PHONE ? ' [phone]' : ' [landscape]') : '') + (o.click ? ` [${o.click}]` : '') + (o.store ? ' [map options]' : '');
  const ctx = await browser.newContext(o.ctx || { viewport: { width: 960, height: 480 } });
  try {
    if (o.store) await ctx.addInitScript(st => { for (const k in st) localStorage.setItem(k, st[k]); }, o.store);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${label}: console ${m.text()}`); });
    await page.goto('http://localhost:5198/' + q, { timeout: 90000 });
    await page.keyboard.down('ArrowUp');   // a key press unlocks the audio (it may stay suspended with no sound device)
    await page.waitForTimeout(1500);
    if (o.touch) { try { await page.touchscreen.tap(200, 400); } catch (e) { /* no touch in this context */ } }
    if (o.click) { const b = page.getByText(o.click, { exact: true }).first(); if (await b.count()) await b.click().catch(() => {}); else errors.push(`${label}: no "${o.click}" button`); }
    await page.waitForTimeout(2200);
    await page.keyboard.up('ArrowUp');
  } catch (e) { errors.push(`${label}: ${e.message.split('\n')[0]}`); }
  await ctx.close();
  if (process.env.SMOKE_LOG) console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  ${label}`);
}
// three pages at a time: the page load (shader compile in software GL) dominates
let next = 0;
await Promise.all([0, 1, 2].map(async () => { while (next < views.length) await run(views[next++]); }));
await browser.close(); server.stop();
console.log(errors.length ? 'smoke FAILED:\n  ' + errors.join('\n  ') : `smoke: no page errors in ${views.length} views (drive, top-down, fixed view, menus, race start, weather and night, track map options, phone)`);
process.exitCode = errors.length ? 1 : 0;
