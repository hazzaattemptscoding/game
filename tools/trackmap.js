// Draws the circuit from the game's own track data as a debug map: every
// surface, every placed barrier section by type, catch fences, distance
// boards and signs. Same colours as the in-game top-down debug view.
// Run with `npm run trackmap`, then open trackmap.svg in a browser.

import { writeFileSync } from 'node:fs';
import { buildTrack, BARRIER, wrap } from '../src/track.js';

const T = buildTrack();
const out = process.argv[2] || 'trackmap.svg';
const hex = n => '#' + n.toString(16).padStart(6, '0');
// keep in step with DEBUG_COLOURS in src/trackMesh.js
const C = {
  road: 0x3a3a3a, kerb: 0xe03030, sausage: 0xffcc00, apron: 0x9a9a9a, concrete: 0xd8c99a, gravel: 0xf0b040,
  grass: 0x4f8f3a, pit: 0x8a5cd6, island: 0xc0a8ff, tyres: 0xff2020, armco: 0x1e5bff, armcoSingle: 0x66ccff,
  street: 0x222222, parapet: 0x888888, pitwall: 0xff55ff, fence: 0xffa000, board: 0xd4b000, sign: 0x00b0d0,
};

let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < T.N; i++) {
  x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]);
  z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]);
}
const pad = 120, W = x1 - x0 + pad * 2, H = z1 - z0 + pad * 2;
const X = x => (x - x0 + pad).toFixed(1), Z = z => (z - z0 + pad).toFixed(1);
const pt = (i, d) => [T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d];

// a filled band between two sideways offsets, wherever band(i) returns [d1, d2]
function bands(band, fill) {
  let svg = '', run = [];
  const flush = () => {
    if (run.length > 1) {
      const a = run.map(([i, d1]) => pt(i, d1)), b = run.map(([i, , d2]) => pt(i, d2)).reverse();
      svg += `<path d="M${[...a, ...b].map(([x, z]) => `${X(x)} ${Z(z)}`).join('L')}Z" fill="${fill}"/>`;
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
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${(W * 1.2).toFixed(0)}" height="${(H * 1.2).toFixed(0)}" style="background:#2c4a26;font-family:Arial,sans-serif">`;

for (const sd of [0, 1]) {
  const g = sd ? 1 : -1;
  const kerbOut = i => hw + T.kerb[sd][i], sausOut = i => kerbOut(i) + T.sausage[sd][i], runOut = i => sausOut(i) + T.runoff[sd][i];
  svg += bands(i => [g * hw, g * T.wall[sd][i]], hex(C.grass));
  svg += bands(i => T.gravelOut[sd][i] > 0 ? [g * T.gravelIn[sd][i], g * T.gravelOut[sd][i]] : null, hex(C.gravel));
  svg += bands(i => T.runoff[sd][i] > 0.2 && !T.concrete[sd][i] ? [g * sausOut(i), g * runOut(i)] : null, hex(C.apron));
  svg += bands(i => T.runoff[sd][i] > 0.2 && T.concrete[sd][i] ? [g * sausOut(i), g * runOut(i)] : null, hex(C.concrete));
  svg += bands(i => T.kerb[sd][i] > 0 ? [g * hw, g * kerbOut(i)] : null, hex(C.kerb));
  svg += bands(i => T.sausage[sd][i] > 0 ? [g * kerbOut(i), g * sausOut(i)] : null, hex(C.sausage));
}
svg += bands(i => T.pitOut[i] ? [-T.pitIn[i], -T.pitOut[i]] : null, hex(C.pit));
svg += bands(i => T.pitIsland[i] ? [-hw, -T.pitIn[i]] : null, hex(C.island));
svg += bands(() => [-hw, hw], hex(C.road));

// barriers by type, catch fences dashed behind the impact sections
const style = {
  [BARRIER.TYRES]: [C.tyres, 2.5], [BARRIER.ARMCO]: [C.armcoSingle, 1.4], [BARRIER.CONCRETE]: [C.street, 2],
  [BARRIER.PARAPET]: [C.parapet, 2], [BARRIER.PITWALL]: [C.pitwall, 2], [BARRIER.PITOUTER]: [C.pitwall, 1],
};
for (const b of T.barriers) {
  const [col, w] = style[b.type];
  const colour = b.type === BARRIER.CONCRETE && b.impact ? C.tyres : col;
  svg += `<polyline points="${b.pts.map(p => `${X(p[0])},${Z(p[2])}`).join(' ')}" fill="none" stroke="${hex(colour)}" stroke-width="${w}" stroke-linecap="round"/>`;
  if (b.fence && b.type === BARRIER.TYRES) {
    const g = b.side ? 1 : -1, i = b.pts[0][3];
    const back = b.pts.map(p => [p[0] + g * T.nx[i] * 3.3, p[2] + g * T.nz[i] * 3.3]);
    svg += `<polyline points="${back.map(p => `${X(p[0])},${Z(p[1])}`).join(' ')}" fill="none" stroke="${hex(C.fence)}" stroke-width="1" stroke-dasharray="2 2"/>`;
  }
}
for (const f of T.furniture) {
  if (f.type === 'board') svg += `<rect x="${X(f.x) - 6}" y="${Z(f.z) - 6}" width="12" height="12" fill="${hex(C.board)}" stroke="#000"/><text x="${X(f.x) * 1 + 8}" y="${Z(f.z) * 1 + 4}" font-size="11" fill="#fff">${f.value}</text>`;
  else svg += `<circle cx="${X(f.x)}" cy="${Z(f.z)}" r="4" fill="${hex(C.sign)}" stroke="#000"/>`;
}
// corner names
for (const c of T.corners) {
  const i = wrap(Math.round(c.apexS / T.ds), T.N), g = c.inside === 'L' ? -1 : 1, [x, z] = pt(i, g * 40);
  svg += `<text x="${X(x)}" y="${Z(z)}" font-size="14" fill="#fff" text-anchor="middle" font-weight="bold">${c.name}${c.constrained ? ' *' : ''}</text>`;
}

const legend = [['Track', C.road], ['Kerb', C.kerb], ['Sausage kerb', C.sausage], ['Paved apron', C.apron], ['Old runway apron', C.concrete],
  ['Gravel', C.gravel], ['Pit road', C.pit], ['Pit island', C.island], ['Tyre wall + double armco', C.tyres], ['Single armco', C.armcoSingle],
  ['Street wall', C.street], ['Bridge parapet', C.parapet], ['Pit wall', C.pitwall], ['Catch fence (dashed)', C.fence],
  ['Distance board', C.board], ['Sign', C.sign]];
svg += `<rect x="10" y="10" width="260" height="${legend.length * 20 + 40}" fill="#000" opacity="0.6"/>`;
svg += `<text x="20" y="32" font-size="15" fill="#fff" font-weight="bold">Lakeside debug map, ${(T.length / 1000).toFixed(2)} km</text>`;
legend.forEach(([name, col], k) => {
  svg += `<rect x="20" y="${44 + k * 20}" width="16" height="12" fill="${hex(col)}"/><text x="44" y="${54 + k * 20}" font-size="13" fill="#fff">${name}</text>`;
});
svg += '</svg>';
writeFileSync(out, svg);
console.log('wrote', out);
