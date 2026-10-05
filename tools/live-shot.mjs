// Screenshots of the live page against the dev relay with fake players: the lobby list, then the live view in each camera, then a phone.
// node tools/live-shot.mjs [outdir]   (default /tmp). Needs Chromium and Playwright like tools/shot.mjs. Not part of `npm run check`.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { startRelay } from '../worker/dev-relay.mjs';
import { startBots } from './lib/bots.js';
const out = process.argv[2] || '/tmp';
mkdirSync(out, { recursive: true });
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('live-shot: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);

const VITE = 5197;
const relay = await startRelay({ port: 0 });
const url = `ws://127.0.0.1:${relay.port}`;
const vite = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const fleet = startBots({ url, code: 'LIVEA', count: 4, laps: 3 });
const fleet2 = startBots({ url, code: 'PRACT', count: 2, mode: 'Free practice', started: false, startS: 1200 });
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const errors = [];
const base = `http://localhost:${VITE}/live.html?relay=${encodeURIComponent(url + '/')}`;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}/live-lobbies.png` });
  await page.click('.lob-row:has(.c-code:text-is("LIVEA"))');
  await page.waitForTimeout(25000);
  await page.screenshot({ path: `${out}/live-tv.png` });
  for (const [mode, label] of [['onboard', 'onboard'], ['chase', 'chase'], ['trackside', 'trackside'], ['heli', 'heli'], ['free', 'free']]) {
    await page.click(`#cams button[data-mode="${mode}"]`);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}/live-${label}.png` });
  }
  await page.close();
  const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  phone.on('pageerror', e => errors.push('phone ' + e.message));
  await phone.goto(base);
  await phone.waitForTimeout(3500);
  await phone.screenshot({ path: `${out}/live-phone-lobbies.png` });
  await phone.goto(base + '#LIVEA');
  await phone.reload();
  await phone.waitForTimeout(22000);
  await phone.screenshot({ path: `${out}/live-phone.png` });
  await phone.click('#tabs button[data-tab="tele"]');
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: `${out}/live-phone-tele.png` });
} catch (e) { console.log('exception', e.message); }
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close(); vite.kill(); fleet.stop(); fleet2.stop(); relay.close();
process.exit(0);
