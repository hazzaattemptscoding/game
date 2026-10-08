// Screenshots the game from a track position, for checking the look by eye.
// node tools/shot.mjs out.png "viewat=s,d,height,ahead" [topdown] [blockout]
// The menu is skipped (menu=0) unless the view string names a menu: "menu=race", "menu=garage", "menu=settings", "menu=online", "menu=times", "menu=main" (main menu is the default with no viewat) or "start=race" for the lights.
// Add &line=1 to the view string to switch the racing line on, and &at=S to put the car at s=S (the line is drawn around the car): "viewat=330,0,1.8,40&line=1&at=300"
// Env: VIEWPORT=WxH (default 1280x640; a phone is 390x760). CLICK="Settings,Controls" clicks the visible button or tab with each
// of those texts in turn, after the page has loaded (a settings tab, a rail entry). KEYS="Escape" presses keys in turn.
// SCROLL=1 scrolls the menu pane to its end before the shot.
import { createRequire } from 'node:module';
import { startVite } from './lib/vite.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const [out, viewArg = 'viewat=100,0,2,40', ...flags] = process.argv.slice(2);
const view = /(^|&)(menu|start)=/.test(viewArg) ? viewArg : `${viewArg}&menu=0`;
const [vw, vh] = (process.env.VIEWPORT || '1280x640').split('x').map(Number);
const server = await startVite(5199);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
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
if (process.env.SCROLL) { await page.evaluate(() => { const b = document.querySelector('#menu .m-body'); if (b) b.scrollTop = 99999; }); await page.waitForTimeout(300); }
if (process.env.CLICK || process.env.KEYS) await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close(); server.stop();
