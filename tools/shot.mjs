// Screenshots the game from a track position, for checking the look by eye.
// node tools/shot.mjs out.png "viewat=s,d,height,ahead" [topdown] [blockout]
// The menu is skipped (menu=0) unless the view string names a menu: "menu=race", "menu=garage", "menu=settings", "menu=online", "menu=times", "menu=main" (main menu is the default with no viewat) or "start=race" for the lights.
// Add &line=1 to the view string to switch the racing line on, and &at=S to put the car at s=S (the line is drawn around the car): "viewat=330,0,1.8,40&line=1&at=300"
// Env: VIEWPORT=WxH (default 1280x640; a phone is 390x760). CLICK="Settings,Controls" clicks the visible button or tab with each
// of those texts in turn, after the page has loaded (a settings tab, a rail entry). KEYS="Escape" presses keys in turn.
// HOLD=Tab holds one key for the shot. SEED='{"key":value}' sets localStorage first (the saved best laps).
// EVAL='js' runs a line of JavaScript in the page before the shot (window.lakeside is the game); EVAL_WAIT=ms waits after it.
// SCROLL=1 scrolls the menu pane to its end before the shot. TAP=1 taps the left half once first, so the touch layout shows.
import { createRequire } from 'node:module';
import { startVite } from './lib/vite.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const [out, viewArg = 'viewat=100,0,2,40', ...flags] = process.argv.slice(2);
const view = /(^|&)(menu|start)=/.test(viewArg) ? viewArg : `${viewArg}&menu=0`;
const [vw, vh] = (process.env.VIEWPORT || '1280x640').split('x').map(Number);
const server = await startVite(5199);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: vw, height: vh }, hasTouch: !!process.env.TAP });
// SEED='{"lakeside.best":[...]}' puts these localStorage entries in place before the page loads (the Tab board's saved laps)
if (process.env.SEED) { const seed = JSON.parse(process.env.SEED); await page.addInitScript(seed => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); }, seed); }
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto(`http://localhost:5199/?${view}${flags.includes('topdown') ? '&topdown' : ''}`);
await page.waitForTimeout(+(process.env.SHOT_WAIT || 6000));
for (const text of (process.env.CLICK || '').split(',').map(s => s.trim()).filter(Boolean)) {
  await page.locator('#menu button:visible', { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first().click();
  await page.waitForTimeout(600);
}
for (const k of (process.env.KEYS || '').split(',').map(s => s.trim()).filter(Boolean)) {
  await page.keyboard.press(k);
  await page.waitForTimeout(600);
}
if (process.env.TAP) { await page.touchscreen.tap(vw * 0.25, vh * 0.5); await page.waitForTimeout(500); }   // a touch turns the touch layout on (body.touch)
if (process.env.EVAL) { await page.evaluate(code => new Function(code)(), process.env.EVAL); await page.waitForTimeout(+(process.env.EVAL_WAIT || 700)); }   // EVAL='js' runs in the page first (e.g. lakeside.lobby.mp.phase)
if (process.env.SCROLL) { await page.evaluate(() => { const b = document.querySelector('#menu .m-body'); if (b) b.scrollTop = 99999; }); await page.waitForTimeout(300); }
if (process.env.CLICK || process.env.KEYS) await page.waitForTimeout(400);
// HOLD=Tab holds a key for the shot (the Tab board shows while Tab is down)
if (process.env.HOLD) { await page.keyboard.down(process.env.HOLD); await page.waitForTimeout(500); }
await page.screenshot({ path: out });
if (process.env.HOLD) await page.keyboard.up(process.env.HOLD);
await browser.close(); server.stop();
