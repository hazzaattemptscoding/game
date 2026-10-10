// Draws a learned line against the racing line, top-down, for the three corners where they differ most.
// node tools/learnplot.mjs genome.json out.png [GT|GT1|CITY]     (the car class is read from the genome)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildTrack } from '../src/track.js';
import { CARS } from '../src/cars.js';
import * as L from '../src/learn.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const [file, out] = process.argv.slice(2);
const rec = JSON.parse(readFileSync(file, 'utf8'));
const T = buildTrack(), ctx = L.makeContext(T, CARS[rec.car], { light: true });
const g = L.genomeFromJSON(ctx, rec);
const drv = L.makeDriver(ctx, g.x);
const base = ctx.baseLine, line = drv.line, N = T.N;
const diff = c => { let m = 0; for (let i = c.from; ; i = (i + 1) % N) { m = Math.max(m, Math.abs(line.x[i] - base.x[i]) + Math.abs(line.z[i] - base.z[i])); if (i === c.to) break; } return m; };
// under the map: how far the learned line sits from the racing line (m, positive to the right) and the change in target speed (km/h)
function strip(idx, base, line, v, bv) {
  const y0 = MAP + 4, h = 90, n = idx.length;
  const d = idx.map(i => (line.off[i] - base.off[i]));
  const dv = idx.map(i => (v[i] - bv[i]) * 3.6);
  const m = Math.max(1, ...d.map(Math.abs)), mv = Math.max(10, ...dv.map(Math.abs));
  const poly = (a, mm, col) => `<polyline fill="none" stroke="${col}" stroke-width="1.8" points="${a.map((q, k) => `${(15 + k / (n - 1) * (W - 30)).toFixed(1)},${(y0 + h / 2 - q / mm * h / 2).toFixed(1)}`).join(' ')}"/>`;
  return `<line x1="15" x2="${W - 15}" y1="${y0 + h / 2}" y2="${y0 + h / 2}" stroke="#3a3454"/>${poly(d, m, '#19c8b9')}${poly(dv, mv, '#b9a4ff')}
    <text x="15" y="${y0 + 10}" fill="#19c8b9" font-size="11" font-family="sans-serif">line offset vs racing line, +-${m.toFixed(1)} m</text>
    <text x="15" y="${y0 + 24}" fill="#b9a4ff" font-size="11" font-family="sans-serif">target speed change, +-${mv.toFixed(0)} km/h</text>`;
}
const picks = ctx.corners.map(c => ({ c, d: diff(c) })).sort((a, b) => b.d - a.d).slice(0, 3);
const W = 420, H = 560, MAP = 420, panels = [];
for (const { c } of picks) {
  const idx = []; for (let k = -60; k <= 60 + ((c.to - c.from + N) % N); k++) idx.push((c.from + k + N) % N);
  const side = s => idx.map(i => [T.x[i] + T.nx[i] * s * T.hw[i], T.z[i] + T.nz[i] * s * T.hw[i]]);
  const all = [...side(-1), ...side(1)];
  const xs = all.map(p => p[0]), zs = all.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), sc = (MAP - 30) / Math.max(x1 - x0, z1 - z0);
  const P = (x, z) => `${(15 + (x - x0) * sc).toFixed(1)},${(15 + (z - z0) * sc).toFixed(1)}`;
  const path = (pts, col, w, dash = '') => `<polyline fill="none" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts.map(p => P(p[0], p[1])).join(' ')}"/>`;
  const v = drv.vmax, bv = ctx.baseVmax;
  panels.push(`<svg width="${W}" height="${H}" style="background:#141120">
    ${path(side(-1), '#8a86a0', 1.5)}${path(side(1), '#8a86a0', 1.5)}
    ${path(idx.map(i => [base.x[i], base.z[i]]), '#e8c04a', 2)}${path(idx.map(i => [line.x[i], line.z[i]]), '#19c8b9', 2.5)}
    ${strip(idx, base, line, drv.vmax, bv)}
    <text x="12" y="${H - 28}" fill="#ebe9f3" font-size="13" font-family="sans-serif">${c.name || 'corner'} at s=${c.valley} m: apex speed ${(bv[c.valley] * 3.6).toFixed(0)} to ${(v[c.valley] * 3.6).toFixed(0)} km/h</text>
    <text x="12" y="${H - 10}" fill="#aaa6bd" font-size="12" font-family="sans-serif"><tspan fill="#e8c04a">yellow</tspan> racing line, <tspan fill="#19c8b9">teal</tspan> learned, grey track limits</text></svg>`);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W * 3 + 8, height: H } });
await page.setContent(`<body style="margin:0;display:flex;gap:4px;background:#0d0b14">${panels.join('')}</body>`);
await page.screenshot({ path: out });
await browser.close();
console.log('written ' + out);
