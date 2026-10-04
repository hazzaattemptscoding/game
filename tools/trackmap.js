// Draws the circuit from the game's own track data, in Harry's colour code,
// so it can be compared side by side with reference/lakeside-track-colour-map.png.
// Run with `npm run trackmap`, then open trackmap.svg in a browser.
//
//   yellow  DRS zone        purple  gravel trap      blue  walls at the track edge
//   green   tarmac run-off  red     pit lane         grey  racing surface

import { writeFileSync } from 'node:fs';
import { buildTrack, BARRIER, wrap } from '../src/track.js';

const T = buildTrack();
const out = process.argv[2] || 'trackmap.svg';

let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < T.N; i++) {
  x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]);
  z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]);
}
const pad = 90, W = x1 - x0 + pad * 2, H = z1 - z0 + pad * 2;
const X = x => (x - x0 + pad).toFixed(1), Z = z => (z - z0 + pad).toFixed(1);
const pt = (i, d) => [T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d];

// A filled band between two offsets, for each run where `band(i)` returns [d1, d2].
function bands(band, fill, extra = '') {
  let svg = '', run = [];
  const flush = () => {
    if (run.length > 1) {
      const a = run.map(([i, d1]) => pt(i, d1)), b = run.map(([i, , d2]) => pt(i, d2)).reverse();
      svg += `<path d="M${[...a, ...b].map(([x, z]) => `${X(x)} ${Z(z)}`).join('L')}Z" fill="${fill}" ${extra}/>`;
    }
    run = [];
  };
  for (let i = 0; i <= T.N; i++) {
    const k = wrap(i, T.N), r = band(k);
    if (r) run.push([k, r[0], r[1]]); else flush();
  }
  flush();
  return svg;
}

const hw = T.halfWidth;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${(W * 1.1).toFixed(0)}" height="${(H * 1.1).toFixed(0)}" style="background:#f7f6f2;font-family:Arial,sans-serif">
<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#9b30ff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#6a1fb0" stroke-width="2"/></pattern></defs>`;

for (const sd of [0, 1]) {
  const sg = sd ? 1 : -1;
  svg += bands(i => T.gravelOut[sd][i] > 0 ? [sg * T.gravelIn[sd][i], sg * T.gravelOut[sd][i]] : null, 'url(#hatch)');
  svg += bands(i => {
    const e = hw + T.kerb[sd][i] + T.sausage[sd][i];
    return T.runoff[sd][i] > 0.3 ? [sg * e, sg * (e + T.runoff[sd][i])] : null;
  }, '#3ccf6e');
}
svg += bands(i => T.pitO[i] ? [T.pitO[i] - T.pitHalf, T.pitO[i] + T.pitHalf] : null, '#e3262f');
svg += bands(() => [-hw, hw], '#42454d');
for (const sd of [0, 1]) {
  const sg = sd ? 1 : -1;
  svg += bands(i => (T.barrier[sd][i] === BARRIER.CONCRETE || T.barrier[sd][i] === BARRIER.PARAPET) ? [sg * T.wall[sd][i], sg * (T.wall[sd][i] + 3)] : null, '#2f8cff');
  svg += bands(i => T.sausage[sd][i] ? [sg * (hw + T.kerb[sd][i]), sg * (hw + T.kerb[sd][i] + 2)] : null, '#ff8c1a');
}
svg += bands(i => T.drs.some(([a, b]) => (a <= b ? T.s[i] >= a && T.s[i] <= b : T.s[i] >= a || T.s[i] <= b)) ? [-2, 2] : null, '#ffd21f');

// barriers as thin lines
for (const sd of [0, 1]) {
  const sg = sd ? 1 : -1;
  svg += bands(i => [sg * T.wall[sd][i], sg * (T.wall[sd][i] + 0.8)], '#222', 'opacity="0.5"');
}

// sector and start lines, control point numbers
for (const [n, s] of T.sectors.entries()) {
  const i = Math.round(s / T.ds) % T.N, [ax, az] = pt(i, -hw - 6), [bx, bz] = pt(i, hw + 6);
  svg += `<line x1="${X(ax)}" y1="${Z(az)}" x2="${X(bx)}" y2="${Z(bz)}" stroke="#111" stroke-width="4"/>`;
  svg += `<text x="${X(bx) * 1 + 6}" y="${Z(bz)}" font-size="16" font-weight="bold">${n === 0 ? 'START' : 'S' + n + '|S' + (n + 1)}</text>`;
}
T.layout.points.forEach((_, k) => {
  const i = Math.round(T.sAtPointRaw(k) / T.ds) % T.N;
  svg += `<circle cx="${X(T.x[i])}" cy="${Z(T.z[i])}" r="7" fill="#111"/><text x="${X(T.x[i])}" y="${Z(T.z[i]) * 1 + 3.5}" font-size="9" fill="#fff" text-anchor="middle">${k}</text>`;
});
svg += `<text x="16" y="28" font-size="20" font-weight="bold">Lakeside from game data. ${(T.length / 1000).toFixed(2)} km. Yellow DRS, purple gravel, blue walls, green run-off, red pit lane, orange sausage kerbs.</text></svg>`;

writeFileSync(out, svg);
console.log('wrote', out);
