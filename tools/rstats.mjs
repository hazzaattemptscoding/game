// Draw calls and triangles of the real page (renderer.info, shadow pass included) at named views, plus the average frame time.
//   node tools/rstats.mjs [query]            the named views below, `query` added to every page URL, e.g. "weather=heavyrain&time=night"
//   node tools/rstats.mjs --sweep [query]    one number per 250 m of the lap: the most draw calls and triangles anywhere
// PORT=5330 picks the dev server port. Add SERVER=http://localhost:5330 to use a server that is already running.
// `ms` is the average time per frame over 20 frames. That is software GL in headless Chromium: only compare runs with each other.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const PORT = process.env.PORT || '5311';
const sweep = process.argv.includes('--sweep');
const extra = process.argv.slice(2).filter(a => a !== '--sweep')[0] || '';
const BASE = process.env.SERVER || `http://localhost:${PORT}`;
const server = process.env.SERVER ? null : spawn('npx', ['vite', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
if (server) await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));

// the remote cars: seven fake players on the track beside the camera, fed states 20 times a second like the relay would
const CARS = `(() => {
  const L = window.lakeside, T = L.track, g = L.lobby.ghosts, t0 = performance.now();
  const base = Math.round(T.N * 100 / T.length);
  const push = () => {
    const now = performance.now();
    for (let k = 0; k < 7; k++) {
      const i = (base + 6 + k * 5) % T.N, j = (i + 1) % T.N, h = Math.atan2(T.z[j] - T.z[i], T.x[j] - T.x[i]);
      const x = T.x[i] + T.nx[i] * (k % 2 ? 3 : -3), z = T.z[i] + T.nz[i] * (k % 2 ? 3 : -3);
      g.receive('bot' + k, { t: now, x, y: T.h[i], z, h, vx: 0, vz: 0, yr: 0, st: 0, w: 0, thr: 0, brk: 0, pz: 0, rx: 0, col: 0, lap: 1, s: i * T.length / T.N, name: 'Bot' + k }, now);
    }
  };
  push(); setInterval(push, 50);
})()`;

const read = () => page.evaluate(() => { const i = window.lakeside.renderer.info; return { calls: i.render.calls, tris: i.render.triangles }; });
const timeFrames = () => page.evaluate(() => new Promise(res => { let n = 0, t0 = 0; const f = t => { if (!t0) t0 = t; if (++n > 20) res(Math.round((t - t0) / 20)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));

if (sweep) {
  await page.goto(`${BASE}/?menu=0&autopilot=1${extra ? '&' + extra : ''}`);
  await page.waitForTimeout(3000);
  const len = await page.evaluate(() => window.lakeside.track.length);
  let worst = { calls: 0 }, worstT = { tris: 0 };
  const rows = [];
  for (let s = 0; s < len; s += 250) {
    await page.evaluate(s => { const L = window.lakeside; L.car.placeAt(s, 0); }, s);
    await page.waitForTimeout(700);
    const r = { s, ...(await read()) };
    rows.push(r);
    if (r.calls > worst.calls) worst = r;
    if (r.tris > worstT.tris) worstT = r;
  }
  console.log('s'.padStart(5), 'calls'.padStart(6), 'tris'.padStart(8));
  for (const r of rows) console.log(String(r.s).padStart(5), String(r.calls).padStart(6), String(r.tris).padStart(8));
  console.log(`most calls ${worst.calls} at s ${worst.s}; most triangles ${worstT.tris} at s ${worstT.s}`);
} else {
  // [name, query, remote cars]
  const views = [
    ['start grid', 'viewat=100,0,2,40'],
    ['bridge', 'viewat=1650,0,2,40'],
    ['stands', 'viewat=1250,0,3,60'],
    ['far stands', 'viewat=2750,0,2,40'],
    ['night and rain', 'viewat=100,0,2,40&weather=heavyrain&time=night'],
    ['seven cars', 'viewat=100,0,2,40', true],
  ];
  for (const [name, v, cars] of views) {
    await page.goto(`${BASE}/?${v}&menu=0${extra ? '&' + extra : ''}`);
    await page.waitForTimeout(3000);
    if (cars) { await page.evaluate(CARS); await page.waitForTimeout(1500); }
    const r = await read();
    r.ms = await timeFrames();
    console.log(name.padEnd(16), JSON.stringify(r));
  }
}
await browser.close(); if (server) server.kill();
