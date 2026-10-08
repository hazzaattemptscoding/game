// Two real browser pages playing together through the relay transport, against worker/dev-relay.mjs (same protocol as the
// Cloudflare Worker). Run with `npm run relay-live`. Needs Chromium and Playwright like tools/smoke.mjs; skips if they are missing.
// Not part of `npm run check` (slow). The only difference to tools/multiplayer-live.mjs is the transport: no WebRTC is involved.
// Host opens a room, guest joins with the code; then checks the name tag, the standings, and a real collision: the guest's car
// is pushed at the host's parked car and both must be moved, neither may pass through the other.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startRelay } from '../worker/dev-relay.mjs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('multiplayer-live: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);

const VITE = 5198;
const relay = await startRelay({ port: 0 });
const vite = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const fails = [], errors = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
const base = `http://localhost:${VITE}/?relay=ws://localhost:${relay.port}/&transport=relay&mute`;
async function open(extra) {
  const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + extra);
  await page.waitForTimeout(2500);
  return page;
}
const until = async (page, fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
try {
  const A = await open('&at=250'), B = await open('&at=190');
  await A.keyboard.press('Escape');
  await A.fill('#mp-name', 'Alice'); await A.click('#mp-host');
  check(await until(A, () => /^[A-Z]{5}$/.test(document.getElementById('mp-big').textContent)), 'host sees a 5 letter room code');
  check(await until(A, () => /^Via relay/.test(document.getElementById('mp-via').textContent)), 'lobby says "' + await A.textContent('#mp-via') + '"');
  check(await until(A, () => /\d+ ms/.test(document.getElementById('mp-via').textContent), null, 8000), 'lobby shows the round trip time: ' + await A.textContent('#mp-via'));
  const code = await A.textContent('#mp-big');
  console.log('  room code', code, '|', await A.textContent('#mp-status'));
  await B.keyboard.press('Escape');
  await B.fill('#mp-name', 'Bob'); await B.fill('#mp-code', code); await B.click('#mp-join');
  check(await until(B, () => /Joined/.test(document.getElementById('mp-status').textContent)), 'guest joined: ' + await B.textContent('#mp-status'));
  check(await until(A, () => /2 of 8/.test(document.getElementById('mp-who').textContent)), 'host sees 2 players: ' + await A.textContent('#mp-who'));
  // back to driving; the other car should be there with a name tag and a standings row
  // a guest with a wrong code, and the room's cars appear and move
  const W = await open('&at=120'); await W.keyboard.press('Escape'); await W.fill('#mp-code', 'QQQQQ'); await W.click('#mp-join');
  check(await until(W, () => /No room with the code QQQQQ/.test(document.getElementById('mp-status').textContent), null, 8000), 'a code nobody opened: "' + await W.textContent('#mp-status') + '"');
  await W.close();
  await A.click('#close'); await B.click('#close');
  check(await until(A, () => [...document.querySelectorAll('.mp-tag')].some(t => !t.hidden && t.textContent === 'Bob'), null, 15000) || await until(B, () => [...document.querySelectorAll('.mp-tag')].some(t => t.textContent === 'Alice')), 'a name tag over the other car');
  check(await until(A, () => document.querySelectorAll('.stand-row').length === 2), 'standings list has 2 rows');
  console.log('  standings (host):', (await A.$$eval('.stand-row', rows => rows.map(r => r.textContent))).join(' | '));
  check(await A.evaluate(() => lakeside.lobby.ghosts.delay) === 0.1, 'the relay asks for a 100 ms ceiling; remote cars are drawn 50 to 150 ms behind by their measured jitter');
  // the other car is really moving: sample the remote car of B on host A twice while B drives
  await B.evaluate(() => { const c = lakeside.car; c.placeAt(120, 0); c.contactGrace = 0; const v = 20; c.vx = Math.cos(c.heading) * v; c.vz = Math.sin(c.heading) * v; c.fwdSpeed = c.speed = v; });
  const seen = async () => A.evaluate(() => { const g = [...lakeside.lobby.ghosts.map.values()][0]; return g ? { x: g.info.x, z: g.info.z, t: g.info.t } : null; });
  const m1 = await seen(); let m2 = m1, dist = 0;
  for (let i = 0; i < 40 && !(m1 && m2 && m2.t > m1.t && dist > 1); i++) { await A.waitForTimeout(250); m2 = await seen(); dist = m1 && m2 ? Math.hypot(m2.x - m1.x, m2.z - m1.z) : 0; }   // polled: a slow machine throttles the page
  check(m1 && m2 && m2.t > m1.t && dist > 1, 'the guest car appears on the host and moves (' + (m1 && m2 ? dist.toFixed(1) + ' m' : 'no car') + ')');
  // collision: park both cars (a teleport restarts the 1.5 s grace on the other side), wait it out, then B drives into A
  await A.evaluate(() => { const c = lakeside.car; c.placeAt(250, 0); c.contactGrace = 0; c.vx = c.vz = 0; c.fwdSpeed = c.speed = 0; });
  await B.evaluate(() => { const c = lakeside.car; c.placeAt(190, 0); c.contactGrace = 0; c.vx = c.vz = 0; c.fwdSpeed = c.speed = 0; });
  await A.waitForTimeout(4000);
  await B.evaluate(() => { const c = lakeside.car; const v = 30; c.vx = Math.cos(c.heading) * v; c.vz = Math.sin(c.heading) * v; c.fwdSpeed = c.speed = v; });
  const probe = async (P, tag) => console.log('  ', tag, JSON.stringify(await P.evaluate(() => ({ s: lakeside.car.loc.s, v: Math.hypot(lakeside.car.vx, lakeside.car.vz), grace: lakeside.car.contactGrace, solids: lakeside.lobby.solids(performance.now()).map(o => ({ x: Math.round(o.x), z: Math.round(o.z), age: +o.age.toFixed(1), silent: +o.silent.toFixed(2) })), car: [Math.round(lakeside.car.x), Math.round(lakeside.car.z)] }))));
  await probe(A, 'A before'); await probe(B, 'B before');
  await until(A, () => lakeside.car.loc.s > 255, null, 40000);
  await A.waitForTimeout(3000);
  await probe(A, 'A after'); await probe(B, 'B after');
  const a = await A.evaluate(() => { const c = lakeside.car; return { x: c.x, z: c.z, vx: c.vx, vz: c.vz, s: c.loc.s }; });
  const b = await B.evaluate(() => { const c = lakeside.car; return { x: c.x, z: c.z, vx: c.vx, vz: c.vz, s: c.loc.s }; });
  console.log('  after the hit: host s', a.s.toFixed(1), 'v', Math.hypot(a.vx, a.vz).toFixed(1), '| guest s', b.s.toFixed(1), 'v', Math.hypot(b.vx, b.vz).toFixed(1));
  check(a.s > 250.5, 'host car was pushed forward by the hit (s ' + a.s.toFixed(1) + ')');
  check(b.s < a.s, 'guest car did not pass through the host car (guest s ' + b.s.toFixed(1) + ' behind host s ' + a.s.toFixed(1) + ')');
  // leave
  await B.keyboard.press('Escape'); await B.click('#mp-leave');
  check(await until(A, () => document.querySelectorAll('.stand-row').length === 1, null, 8000), 'after the guest leaves, the host drops them from the standings');
  // a single player page: no room, no extra DOM activity
  const C = await open('&at=100');
  check(await C.evaluate(() => document.getElementById('h-stand').hidden), 'single player: no standings shown');
} catch (e) { fails.push('exception: ' + e.message); console.log(e); }
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
await browser.close(); vite.kill(); relay.close();
console.log(fails.length ? 'FAILED' : 'PASS');
process.exit(fails.length ? 1 : 0);
