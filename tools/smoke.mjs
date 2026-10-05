// Smoke test: opens the game in headless Chromium and fails on any page error. Skips if Chromium is not installed.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('smoke: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);
const server = spawn('npx', ['vite', '--port', '5198', '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errors = [];
for (const q of ['?menu=0', '?menu=0&topdown', '?viewat=3800,-8,1.8,40&menu=0', '?menu=0&mute', '', '?menu=race', '?menu=settings', '?menu=garage', '?menu=online', '?start=race&mute', '?start=timetrial&mute']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 480 } });
  page.on('pageerror', e => errors.push(`${q || '/'}: ${e.message}`));
  await page.goto('http://localhost:5198/' + q);
  await page.keyboard.down('ArrowUp');   // a key press unlocks the audio (it may stay suspended with no sound device)
  await page.waitForTimeout(3500);
  await page.keyboard.up('ArrowUp');
  await page.close();
}
await browser.close(); server.kill();
console.log(errors.length ? 'smoke FAILED:\n  ' + errors.join('\n  ') : 'smoke: no page errors in 11 views (drive, top-down, fixed view, menus, race start)');
process.exitCode = errors.length ? 1 : 0;
