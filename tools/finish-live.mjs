// Finish messages between real browser pages through the relay (worker/dev-relay.mjs): a guest's finish reaches the host, the
// finish is kept once (a repeat changes nothing), a bad message is refused, a player who joins after the finish gets it from the
// one who finished, and a player who leaves takes their finish with them. Run with `npm run finish-live`. Needs Chromium and
// Playwright like tools/smoke.mjs; skips if they are missing. Not part of `npm run check` (slow). The rows and the screen are tested
// in tools/session.js and tools/results.mjs.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startRelay } from '../worker/dev-relay.mjs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('finish-live: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);

const VITE = 5196;
const relay = await startRelay({ port: 0 });
const vite = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [], errors = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
const base = `http://localhost:${VITE}/?relay=ws://localhost:${relay.port}/&transport=relay&mute&menu=online`;
async function open(extra) {
  const page = await browser.newPage({ viewport: { width: 760, height: 480 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + extra, { waitUntil: 'commit', timeout: 180000 });
  await page.waitForFunction(() => !!window.lakeside, null, { timeout: 240000 });   // the game is up (the load event can take long with several pages)
  await page.waitForTimeout(4000);
  return page;
}
// the controls are driven through the DOM: the pages render WebGL in software, so a real pointer click can wait a long time
const clickEl = (page, sel) => page.evaluate(q => document.querySelector(q).click(), sel);
const fillEl = (page, sel, v) => page.evaluate(([q, value]) => { const el = document.querySelector(q); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
const until = async (page, fn, arg, ms = 60000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const FIN = { t: 'fin', time: 480.5, laps: 5, best: 92.4, sec: [29.8, 38.1, 24.5], pen: [{ s: 2, why: 'Track limits +2s' }], warn: 1 };
try {
  const A = await open(''), B = await open('');
  await fillEl(A, '#mp-name', 'Alice'); await clickEl(A, '#mp-host');
  check(await until(A, () => /^[A-Z]{5}$/.test(document.getElementById('mp-big').textContent)), 'host sees a room code');
  const code = await A.textContent('#mp-big');
  await fillEl(B, '#mp-name', 'Bob'); await fillEl(B, '#mp-code', code); await clickEl(B, '#mp-join');
  check(await until(A, () => /2 of 8/.test(document.getElementById('mp-who').textContent)), 'host sees 2 players');
  const bId = await B.evaluate(() => lakeside.lobby.mp.selfId);
  check(/^r\d+$/.test(bId), `the guest has a relay id (${bId})`);
  // the guest finishes: the host keeps it, under the guest's id
  await B.evaluate(FIN => lakeside.lobby.announceFinish(FIN), FIN);
  check(await until(A, () => lakeside.lobby.finishes.size === 1), 'the host gets the guest finish');
  const got = await A.evaluate(() => { const [id] = lakeside.lobby.finishes.ids(); return { id, fin: lakeside.lobby.finishes.get(id) }; });
  check(got.id === bId && got.fin.time === 480.5 && got.fin.pen[0].why === 'Track limits +2s' && got.fin.sec[1] === 38.1, `kept under the sender's id with its numbers (${JSON.stringify(got)})`);
  // the same finish again (the re-send after 1.5 s) changes nothing; a bad one is refused
  await A.waitForTimeout(2200);
  check(await A.evaluate(() => lakeside.lobby.finishes.size === 1 && lakeside.lobby.finishes.get(lakeside.lobby.finishes.ids()[0]).time === 480.5), 'the re-send does not add a second entry');
  await B.evaluate(() => lakeside.lobby.mp.sendControl({ t: 'fin', time: 'fast', laps: 5, sec: [1, 2, 3] }));
  await A.waitForTimeout(400);
  check(await A.evaluate(() => lakeside.lobby.finishes.size === 1 && lakeside.lobby.finishes.get(lakeside.lobby.finishes.ids()[0]).time === 480.5), 'a bad finish is refused and the good one stays');
  check(await A.evaluate(() => !lakeside.lobby.finishes.has(lakeside.lobby.mp.selfId)), 'the host never books its own finish');
  // a player who joins after the finish gets it from the one who finished
  const C = await open('');
  await fillEl(C, '#mp-name', 'Cy'); await fillEl(C, '#mp-code', code); await clickEl(C, '#mp-join');
  check(await until(C, () => /Joined/.test(document.getElementById('mp-status').textContent)), 'a late joiner is in the room');
  check(await until(C, () => lakeside.lobby.finishes.size === 1, null, 15000), 'the late joiner gets the finish from the guest who finished');
  // the guest leaves: its finish goes with it
  await clickEl(B, '#mp-leave');
  check(await until(A, () => lakeside.lobby.finishes.size === 0, null, 15000), 'a player who leaves takes their finish with them');
  await clickEl(A, '#mp-leave'); await clickEl(C, '#mp-leave');
  await A.close(); await B.close(); await C.close();
} catch (e) {
  fails.push(`exception: ${e.message}`);
}
check(errors.length === 0, `no page errors: ${errors.join(' | ')}`);
await browser.close();
vite.kill();
relay.close();
console.log(fails.length ? `finish-live FAILED\n  ${fails.join('\n  ')}` : 'finish-live: all checks passed');
process.exitCode = fails.length ? 1 : 0;
