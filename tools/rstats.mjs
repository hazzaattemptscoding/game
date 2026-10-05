// Draw calls and triangles of the real page, from renderer.info, at a few camera positions.
// node tools/rstats.mjs [query]   e.g. node tools/rstats.mjs "weather=heavyrain&time=night"
// Also prints `ms`, the average time per frame over 30 frames. That is software GL in headless Chromium: only compare runs with each other.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const PORT = process.env.PORT || '5311';
const extra = process.argv[2] || '';
const server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
const views = ['viewat=100,0,2,40', 'viewat=3800,-8,1.8,40', 'viewat=1200,0,2,40', 'viewat=2300,0,2,40'];
for (const v of views) {
  await page.goto(`http://localhost:${PORT}/?${v}&menu=0${extra ? '&' + extra : ''}`);
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => { const i = window.lakeside.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, progs: i.programs ? i.programs.length : 0 }; });
  r.ms = await page.evaluate(() => new Promise(res => { let n = 0, t0 = 0; const f = t => { if (!t0) t0 = t; if (++n > 30) res(Math.round((t - t0) / 30)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log(v.padEnd(26), JSON.stringify(r));
}
await browser.close(); server.kill();
