// More trackside furniture: fan zones, big screens, a media tower, pedestrian footbridges, spectator signs and bins, pit entry and
// exit boards, banner flags along the start straight and a perimeter fence. Planned as numbers first (planExtras, checked by
// tools/venue.js with the same rules as the stands: behind the containment wall, off every barrier line, clear of buildings and of each
// other), then drawn into a handful of merged meshes (Kit) and instanced meshes.

import * as THREE from 'three';
import { bannerVideo } from './bannerVideo.js';
import * as tex from './textures.js';
import { Kit, metreUV, sponsorPanel, trackPoint, hash01, beam } from './meshKit.js';
import { frame, checkStand, wallClearance, standDepth, GAP } from './grandstands.js';
import { lampMaterial, flagMaterial, addFlag, onLampLevel } from './lamps.js';


const wrapN = (i, n) => ((i % n) + n) % n;
const PALETTE = [0xc8102e, 0xf2f2ee, 0x1d4e9e, 0xffd21f, 0x0e7c86, 0xff6a13, 0x2f3136, 0x3f9d4f, 0xd4145a, 0x8a5cd6];
const SKIN = [0xf1c9a5, 0xe0ac88, 0xc68a62, 0x9a6540, 0x6b4328, 0xf6d6bd];

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}
const local = (f, a, b) => [f.x + f.ex[0] * a + f.ez[0] * b, f.z + f.ex[1] * a + f.ez[1] * b];

// ---- places ------------------------------------------------------------------------------------------------------
// Boxes in a stand frame (len along the track, depth away from it), searched the same way as the stands.
export const EXTRA_SITES = [
  { kind: 'tower', name: 'Media Tower', s: 3770, range: 70, sides: [1], len: 12, depth: 12 },
  { kind: 'fanzone', name: 'Fan Zone Main', s: 760, range: 160, sides: [1, 0], len: 40, depth: 30 },
  { kind: 'fanzone', name: 'Fan Zone Lake', s: 2560, range: 150, sides: [0, 1], len: 36, depth: 28 },
  { kind: 'fanzone', name: 'Fan Zone Bridge', s: 1620, range: 150, sides: [1, 0], len: 36, depth: 28 },
  { kind: 'screen', name: 'Big Screen Start', s: 520, range: 150, sides: [1], len: 14, depth: 7 },
  { kind: 'screen', name: 'Big Screen Hairpin', s: 2420, range: 120, sides: [0, 1], len: 14, depth: 7 },
  { kind: 'screen', name: 'Big Screen Chicane', s: 3340, range: 120, sides: [0, 1], len: 14, depth: 7 },
];

export function planSites(T, ground, blockers, placed, sites = EXTRA_SITES) {
  const out = [], why = [], all = [...placed];
  for (const site of sites) {
    let best = null;
    const reason = {};
    search:
    for (let off = 0; off <= site.range; off += 5) for (const sgn of off ? [1, -1] : [1]) for (const side of site.sides) {
      const s = site.s + sgn * off, f = frame(T, s, side, site.len), depth = standDepth(site);
      const bad = checkStand(T, ground, blockers, all, f, side, site.len, depth);
      if (bad) { reason[bad] = (reason[bad] || 0) + 1; continue; }
      let near = false;   // the same 10 m the venue check wants behind the wall, over the whole footprint
      for (let a = -site.len / 2 - 2; a <= site.len / 2 + 2 && !near; a += 2) for (let b = 0; b <= depth && !near; b += 2) { const [x, z] = local(f, a, b); if (wallClearance(T, x, z) < GAP - 0.5) near = true; }
      if (near) { reason['too close to the wall'] = (reason['too close to the wall'] || 0) + 1; continue; }
      let lo = Infinity, hi = -Infinity;
      for (let a = -site.len / 2; a <= site.len / 2; a += 4) for (let b = 0; b <= depth; b += 3) { const [x, z] = local(f, a, b), y = ground.meshHeight(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      best = { name: site.name, kind: site.kind, s, side, len: site.len, rows: 0, x: f.x, z: f.z, ex: f.ex, ez: f.ez, yaw: f.yaw, F: f.F, depth, y0: hi + 0.15, low: lo };
      break search;
    }
    if (best) { out.push(best); all.push(best); } else why.push({ name: site.name, reason });
  }
  return { items: out, why };
}

// Pedestrian footbridges across the circuit. A candidate is a position along the lap; the two stair towers stand beyond the
// containment walls on the far side of each wall and have to pass the same checks as the stands.
export const FOOT_SITES = [{ name: 'Footbridge West', s: 830 }, { name: 'Footbridge East', s: 2900 }];
const STAIR = 14, TOWER_GAP = 11, DECK_W = 3.2;   // stair run, metres from the wall to the tower, deck width

export function footprintPoints(T, c, side) {
  // the stair run on one side: from the wall outwards, DECK_W wide, in world coordinates
  const i = c.i, sg = side ? 1 : -1, wall = Math.max(T.wall[side][i], side === 0 && T.pitOut[i] ? T.pitOut[i] + 2 : 0), pts = [];
  for (let d = wall + TOWER_GAP - 2; d <= wall + TOWER_GAP + STAIR + 2; d += 2) for (let w = -DECK_W / 2 - 1; w <= DECK_W / 2 + 1; w += 1.6) pts.push([c.x + c.nx * sg * d + c.tx * w, c.z + c.nz * sg * d + c.tz * w]);
  return pts;
}

export function planFootbridges(T, ground, blockers, placed) {
  const out = [], why = [];
  for (const site of FOOT_SITES) {
    let best = null;
    const reason = {};
    for (let off = 0; off <= 260 && !best; off += 10) for (const sgn of off ? [1, -1] : [1]) {
      const s = site.s + sgn * off, c = trackPoint(T, s, 0), i = c.i;
      let bad = null;
      for (let k = -40; k <= 40 && !bad; k += 10) { const j = wrapN(i + k, T.N); if (T.isBridge[j] || T.street[0][j] || T.street[1][j] || T.pitOut[j] || T.pitMouth[j]) bad = 'near the bridge, street or pit lane'; }
      if (!bad && (s % T.length < 120 || s % T.length > T.length - 120)) bad = 'near the gantry';
      if (!bad && Math.abs(T.curv[i]) > 0.004) bad = 'in a corner';
      const sides = [];
      for (const side of [0, 1]) {
        if (bad) break;
        const pts = footprintPoints(T, c, side);
        let lo = Infinity, hi = -Infinity;
        for (const [x, z] of pts) {
          if (wallClearance(T, x, z) < 8) { bad = 'too close to the circuit'; break; }
          if (T.segs.some(sg => segDist(x, z, sg) < 6)) { bad = 'too close to a barrier'; break; }
          if (blockers.some(b => Math.hypot(x - b.x, z - b.z) < b.r + 4)) { bad = 'overlaps a building'; break; }
          if (placed.some(o => { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; return Math.abs(a) < o.len / 2 + 8 && b > -8 && b < o.depth + 8; })) { bad = 'overlaps a stand'; break; }
          const y = ground.meshHeight(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y);
        }
        if (!bad && hi - lo > 5) bad = 'ground too steep';
        sides.push({ side, pts, lo, hi });
      }
      if (bad) { reason[bad] = (reason[bad] || 0) + 1; continue; }
      const roadY = T.h[i], deckY = Math.max(roadY + 7.4, sides[0].hi + 5, sides[1].hi + 5);
      best = { name: site.name, s, i, c: { x: c.x, z: c.z, nx: c.nx, nz: c.nz, tx: c.tx, tz: c.tz }, sides, deckY, roadY, halfSpan: [0, 1].map(side => Math.max(T.wall[side][i], side === 0 && T.pitOut[i] ? T.pitOut[i] + 2 : 0) + TOWER_GAP) };
    }
    if (best) { out.push(best); } else why.push({ name: site.name, reason });
  }
  return { bridges: out, why };
}

// Obstacles other things must keep off (circles), for the footbridge stairs.
export const footBlockers = bridges => bridges.flatMap(b => b.sides.flatMap(s => s.pts.filter((_, k) => k % 3 === 0).map(([x, z]) => ({ x, z, r: 2.5, name: 'footbridge' }))));

// ---- small things: signs, bins, banner flags, pit boards and the perimeter fence ---------------------------------------
export const SIGN_LABELS = ['GRANDSTAND', 'GATE', 'FIRST AID', 'TOILETS', 'FAN ZONE', 'CAR PARK', 'MEDIA', 'EXIT', 'PIT ENTRY', 'PIT EXIT', 'HOSPITALITY', 'VIEWING AREA'];
// Arrows on the pit boards, as [right, up] on the face the approaching driver reads. The entry board stands 40 m before the
// mouth on the pit side, so its arrow points ahead and to the left (up and left: the way the car goes, not sideways across the road).
export const PIT_ARROWS = { entry: [-1, 1], exit: [1, 0] };
export const SMALL_RULES = { sign: { behind: 2.5, barrier: 3 }, bin: { behind: 3, barrier: 3 }, flag: { behind: 6, barrier: 5 }, pit: { behind: 2.2, barrier: 2.5 }, fence: { behind: 30, barrier: 20 } };

export function planSmall(T, ground, blockers, obstacles) {
  const free = (x, z, r) => {
    if (wallClearance(T, x, z) < r.behind) return false;
    for (const sg of T.segs) if (segDist(x, z, sg) < r.barrier) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 2) return false;
    for (const o of obstacles) { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; if (Math.abs(a) < o.len / 2 + 2 && b > -3 && b < o.depth + 2) return false; }
    return true;
  };
  const out = { signs: [], bins: [], flags: [], pit: [], fence: [] };
  const tile = { grandstand: 0, gate: 1, aid: 2, toilets: 3, fan: 4, car: 5, media: 6, exit: 7, hosp: 10, view: 11 };
  // signs and bins at the ends of every stand, fan zone and tower
  obstacles.forEach((o, k) => {
    const label = o.kind === 'fanzone' ? tile.fan : o.kind === 'tower' ? tile.media : o.kind === 'hospitality' ? tile.hosp : o.name === 'Bridge Viewing' ? tile.view : o.kind === 'screen' ? tile.gate : [tile.grandstand, tile.gate, tile.aid, tile.toilets][k % 4];
    if (o.kind === 'screen') return;
    for (const sd of [-1, 1]) {
      const a = sd * (o.len / 2 + 5), b = 2.5, x = o.x + o.ex[0] * a + o.ez[0] * b, z = o.z + o.ex[1] * a + o.ez[1] * b;
      if (sd > 0 && free(x, z, SMALL_RULES.sign)) out.signs.push({ x, z, yaw: Math.atan2(-o.ex[1], o.ex[0]), tile: label });
      const bx = o.x + o.ex[0] * (sd * (o.len / 2 + 2.5)) + o.ez[0] * 1.2, bz = o.z + o.ex[1] * (sd * (o.len / 2 + 2.5)) + o.ez[1] * 1.2;
      if (free(bx, bz, SMALL_RULES.bin)) out.bins.push({ x: bx, z: bz });
    }
  });
  // pit boards: before the entry, after the exit, on the pit side behind the wall, facing the oncoming cars
  const [pa, pb] = T.pitRange;
  for (const [s0, tl] of [[pa - 40, 8], [pb + 18, 9]]) {
    for (const off of [0, -10, 10, -20, 20, 30]) {
      const s = s0 + off, c = trackPoint(T, s, 0), i = c.i, wall = Math.max(T.wall[0][i], T.pitOut[i] ? T.pitOut[i] + 2 : 0), p = trackPoint(T, s, -(wall + 3.4));
      if (T.isBridge[i] || !free(p.x, p.z, SMALL_RULES.pit)) continue;
      out.pit.push({ x: p.x, z: p.z, tx: c.tx, tz: c.tz, nx: c.nx, nz: c.nz, tile: tl, s });
      break;
    }
  }
  // banner flags along the start straight, right side, behind the barrier
  for (let s = T.length - 120; s < T.length + 260; s += 16) {
    const c = trackPoint(T, s, 0), i = c.i;
    if (T.isBridge[i]) continue;
    const p = trackPoint(T, s, T.wall[1][i] + 8);
    // not in front of the media tower: a banner there hides the cabins from the track
    if (obstacles.some(o => o.kind === 'tower' && Math.abs((p.x - o.x) * o.ex[0] + (p.z - o.z) * o.ex[1]) < o.len / 2 + 3 && (p.x - o.x) * o.ez[0] + (p.z - o.z) * o.ez[1] > -30)) continue;
    if (free(p.x, p.z, SMALL_RULES.flag)) out.flags.push({ x: p.x, z: p.z, tx: c.tx, tz: c.tz, s });
  }
  // perimeter fence: far behind the wall, in 6 m panels, broken wherever the line meets something
  for (const side of [0, 1]) {
    for (let s = 0; s < T.length; s += 6) {
      const i = Math.round(s / T.ds) % T.N, j = Math.round((s + 6) / T.ds) % T.N, sg = side ? 1 : -1;
      if (T.isBridge[i] || T.street[side][i]) continue;
      const wi = Math.max(T.wall[side][i], side === 0 && T.pitOut[i] ? T.pitOut[i] + 2 : 0) + 36, wj = Math.max(T.wall[side][j], side === 0 && T.pitOut[j] ? T.pitOut[j] + 2 : 0) + 36;
      const a = trackPoint(T, s, sg * wi), b = trackPoint(T, s + 6, sg * wj), m = [(a.x + b.x) / 2, (a.z + b.z) / 2];
      if (free(a.x, a.z, SMALL_RULES.fence) && free(b.x, b.z, SMALL_RULES.fence) && free(m[0], m[1], SMALL_RULES.fence)) out.fence.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, side });
    }
  }
  return out;
}

// ---- drawing ----------------------------------------------------------------------------------------------------------

// a box from point A to point B (any direction), `t` and `t2` thick
// a solid arrow centred on (cx, cy) on the canvas, pointing along [right, up] (canvas y runs down, so up is -y)
function drawArrow(x, cx, cy, [dx, dy], colour) {
  const L = Math.hypot(dx, dy), ux = dx / L, uy = -dy / L;
  const tipX = cx + ux * 36, tipY = cy + uy * 36;
  x.strokeStyle = colour; x.fillStyle = colour; x.lineWidth = 12; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx - ux * 30, cy - uy * 30); x.lineTo(tipX - ux * 12, tipY - uy * 12); x.stroke();
  x.beginPath(); x.moveTo(tipX, tipY);
  for (const sgn of [1, -1]) { const a = Math.atan2(uy, ux) + Math.PI + sgn * 0.55; x.lineTo(tipX + Math.cos(a) * 24, tipY + Math.sin(a) * 24); }
  x.closePath(); x.fill();
}
let signAtlas = null;
function signTexture() {
  if (signAtlas) return signAtlas;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 384;
  const x = c.getContext('2d');
  SIGN_LABELS.forEach((label, k) => {
    const col = k % 4, row = Math.floor(k / 4), px = col * 256, py = row * 128, pit = k === 8 || k === 9;
    x.fillStyle = pit ? '#0b3d91' : k === 2 ? '#1c7c3a' : '#17212b'; x.fillRect(px, py, 256, 128);
    x.strokeStyle = '#f2f2ee'; x.lineWidth = 5; x.strokeRect(px + 5, py + 5, 246, 118);
    x.fillStyle = pit ? '#ffd21f' : '#f2f2ee';
    x.font = `bold ${label.length > 9 ? 34 : 44}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, px + 128, py + (pit ? 48 : 64));
    if (k === 8) drawArrow(x, px + 128, py + 100, PIT_ARROWS.entry, '#ffd21f');
    else if (pit) { x.font = 'bold 40px sans-serif'; x.fillStyle = '#ffd21f'; x.fillText('>>>>', px + 128, py + 94); }
  });
  signAtlas = new THREE.CanvasTexture(c);
  signAtlas.colorSpace = THREE.SRGBColorSpace; signAtlas.anisotropy = 4;
  return signAtlas;
}
const tileUV = k => { const col = k % 4, row = Math.floor(k / 4); return [[col / 4, 1 - (row + 1) / 3], [(col + 1) / 4, 1 - (row + 1) / 3], [(col + 1) / 4, 1 - row / 3], [col / 4, 1 - row / 3]]; };

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 512, 288);
  g.addColorStop(0, '#0b2a66'); g.addColorStop(1, '#101a33');
  x.fillStyle = g; x.fillRect(0, 0, 512, 288);
  x.fillStyle = '#ffd21f'; x.fillRect(0, 0, 512, 28); x.fillRect(0, 260, 512, 28);
  x.fillStyle = '#ffffff'; x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('LAKESIDE', 256, 100);
  x.fillStyle = '#ffd21f'; x.font = 'bold 34px sans-serif'; x.fillText('LIVE TIMING', 256, 150);
  x.fillStyle = '#9fc2ff'; x.font = '24px sans-serif';
  ['1  Veyra          1:30.4', '2  Norrland       +0.3', '3  Corvane        +0.9'].forEach((t, k) => x.fillText(t, 256, 196 + k * 22));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function fanZone(kit, st, spots) {
  const { len, depth } = st, x0 = -len / 2, low = st.low - 0.7 - st.y0, key = hash01(Math.round(st.s), 5);
  kit.box('concrete', len, -low, depth, 0, low / 2, depth / 2, 0, 4);
  kit.box('white', len + 0.4, 0.12, 0.3, 0, 0.08, 0.1);
  const tents = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const x = x0 + (i + 0.5) * len / 4, z = 9 + j * 8.5;
    if (hash01(i, j, Math.round(st.s)) < 0.18) continue;
    tents.push([x, z]);
    const k = (i + j * 2 + Math.floor(key * 4)) % 4, w = 2.2;
    for (const [dx, dz] of [[-w, -w], [w, -w], [-w, w], [w, w]]) kit.box('steel', 0.08, 2.5, 0.08, x + dx, 1.25, z + dz);
    kit.box('tent' + k, 5.2, 0.12, 5.2, x, 2.52, z);
    const cone = new THREE.ConeGeometry(3.7, 1.1, 4, 1); cone.rotateY(Math.PI / 4); cone.translate(x, 3.1, z); metreUV(cone, 4); kit.push('tent' + k, cone);
    kit.box('white', 3.2, 0.9, 0.9, x, 0.45, z - 0.8);   // a table or counter under it
  }
  // entrance arch with a sponsor banner, flag poles, bins
  for (const sx of [-6, 6]) kit.box('steel', 0.25, 5.2, 0.25, sx, 2.6, 1.2);
  kit.box('steel', 12.4, 0.3, 0.3, 0, 5.2, 1.2);
  sponsorPanel(kit, 'sponsor', tex.MODERN_SPONSORS[Math.round(st.s) % tex.MODERN_SPONSORS.length], -6, 1.05, 6, 1.05, 3.9, 5.1, -1);
  [['flagR', -len / 2 + 1.5], ['flagB', len / 2 - 1.5], ['flagY', -len / 4], ['flagW', len / 4]].forEach(([fk, x], k) => {
    kit.box('steel', 0.12, 9, 0.12, x, 4.5, depth - 1.8);
    addFlag(kit, fk, x + (k % 2 ? -0.06 : 0.06), 6.6, depth - 1.8, k % 2 ? -1 : 1, 0, 3.2, 2.2, 5);
  });
  for (let k = 0; k < 90; k++) {
    const x = x0 + 1.5 + hash01(k, Math.round(st.s), 1) * (len - 3), z = 3 + hash01(k, Math.round(st.s), 2) * (depth - 6);
    if (tents.some(([tx, tz]) => Math.abs(x - tx) < 2.8 && Math.abs(z - tz) < 2.8)) continue;
    const h = hash01(k, 7, Math.round(st.s));
    spots.push([x, 0.02, z, PALETTE[(h * 97 | 0) % PALETTE.length], h, true]);
  }
}

function bigScreen(kit, st) {
  const { len } = st, low = st.low - 0.7 - st.y0, W = len, Hs = 7.6, y0 = 4.2;
  kit.box('concrete', 5, -low, 4, 0, low / 2, 2.5, 0, 4);
  for (const sx of [-W / 2 + 2, W / 2 - 2]) { kit.box('steel', 0.6, y0 + 1.5, 0.6, sx, (y0 - 0.5) / 2, 3.2); beam(kit, 'steel', [sx, -0.4, 3.2], [sx * 0.55, y0 + Hs * 0.8, 5.6], 0.25); }   // the legs run a metre into the ground, so a slope never leaves them hanging
  kit.box('steel', W + 0.6, Hs + 0.6, 0.4, 0, y0 + Hs / 2, 3.9);                               // the frame
  kit.quad('screen', [W / 2, y0, 3.65], [-W / 2, y0, 3.65], [-W / 2, y0 + Hs, 3.65], [W / 2, y0 + Hs, 3.65], [[0, 0], [1, 0], [1, 1], [0, 1]]);   // the picture faces the track; seen from the track +x is on the left, so u runs 0 to 1 from +x to -x
  kit.box('steel', W + 0.6, 0.15, 0.7, 0, y0 + Hs + 0.35, 3.9);
  kit.box('lamp', W - 1, 0.1, 0.25, 0, y0 - 0.25, 3.5);
}

function mediaTower(kit, st, spots) {
  const { len } = st, low = st.low - 0.7 - st.y0, h = [0, 6.5, 10.6, 14.4];
  kit.box('concrete', len, -low, st.depth, 0, low / 2, st.depth / 2, 0, 4);
  for (const [sx, sz] of [[-4.2, 2.4], [4.2, 2.4], [-4.2, 9], [4.2, 9]]) kit.box('steel', 0.45, 14.4, 0.45, sx, 7.2, sz);
  for (let k = 0; k < 3; k++) for (const sx of [-4.2, 4.2]) beam(kit, 'steel', [sx, h[k] + 0.3, 2.4], [sx, h[k] + 3.2, 9], 0.14);   // diagonal bracing, both sides
  for (let k = 1; k <= 3; k++) { kit.box('concrete', 9.6, 0.3, 8, 0, h[k], 5.7, 0, 4); }
  for (const [y, hh] of [[h[1], 3.3], [h[2], 3.3]]) {
    kit.box('white', 9, hh, 6.5, 0, y + hh / 2 + 0.15, 6.4);                                  // the cabins
    kit.quad('glass', [4.5, y + 0.4, 3.12], [-4.5, y + 0.4, 3.12], [-4.5, y + hh, 3.12], [4.5, y + hh, 3.12], [[0, 0], [2.2, 0], [2.2, 1], [0, 1]]);
    for (let k = 0; k < 4; k++) kit.quad('lit', [4.1 - k * 2.2, y + 0.7, 3.07], [2.5 - k * 2.2, y + 0.7, 3.07], [2.5 - k * 2.2, y + hh - 0.4, 3.07], [4.1 - k * 2.2, y + hh - 0.4, 3.07]);
  }
  // open camera platform on top: rail, camera stands, a dish and a mast
  for (let x = -4.6; x <= 4.65; x += 1.15) { kit.box('steel', 0.05, 1.1, 0.05, x, h[3] + 0.7, 1.8); }
  kit.box('steel', 9.4, 0.06, 0.06, 0, h[3] + 1.2, 1.8);
  kit.box('white', 9.2, 0.4, 7.6, 0, h[3] + 3.8, 6.2);
  kit.box('white', 3, 1.0, 2.4, -2.5, h[3] + 0.7, 5);
  const dish = new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4); dish.rotateX(-Math.PI / 2.6); dish.translate(2.6, h[3] + 1.6, 6); metreUV(dish, 2); kit.push('white', dish);
  kit.box('steel', 0.1, 7, 0.1, -3.8, h[3] + 3.5, 8.4);
  kit.box('lamp', 8, 0.1, 0.3, 0, h[2] - 0.3, 3.0);
  sponsorPanel(kit, 'sponsor', 0, 4, 3.0, -4, 3.0, h[2] + 3.4, h[2] + 4.2, -1);
  for (let k = 0; k < 6; k++) spots.push([-4 + k * 1.5, h[3] + 0.02, 2.4 + (k % 2) * 0.7, PALETTE[(k * 3) % PALETTE.length], hash01(k, 2, 3), false]);
}

function footbridge(kit, b, videoGroup) {
  const { c, deckY } = b, P = (u, t, y) => [c.x + c.nx * u + c.tx * t, y, c.z + c.nz * u + c.tz * t];
  const uL = -b.halfSpan[0], uR = b.halfSpan[1], hw = DECK_W / 2;
  const yaw = Math.atan2(-c.nz, c.nx);
  const mid = (uL + uR) / 2, span = uR - uL, mp = P(mid, 0, deckY);
  kit.box('concrete', span, 0.35, DECK_W, mp[0], deckY - 0.2, mp[2], yaw);                                  // deck
  // Warren truss on both sides: top and bottom chords, posts and diagonals
  const bay = 3.0, n = Math.round(span / bay), step = span / n, H = 1.7;
  for (const t of [-hw, hw]) {
    beam(kit, 'steel', P(uL, t, deckY + H), P(uR, t, deckY + H), 0.16);
    beam(kit, 'steel', P(uL, t, deckY - 0.3), P(uR, t, deckY - 0.3), 0.16);
    for (let k = 0; k <= n; k++) {
      const u = uL + k * step;
      beam(kit, 'steel', P(u, t, deckY - 0.3), P(u, t, deckY + H), 0.12);
      if (k < n) beam(kit, 'steel', P(u, t, k % 2 ? deckY + H : deckY - 0.3), P(u + step, t, k % 2 ? deckY - 0.3 : deckY + H), 0.1);
    }
  }
  for (let k = 0; k <= n; k += 2) beam(kit, 'steel', P(uL + k * step, -hw, deckY + H), P(uL + k * step, hw, deckY + H), 0.1);   // cross ties
  kit.box('roof', span, 0.08, DECK_W + 0.6, mp[0], deckY + H + 0.2, mp[2], yaw);                              // a light roof

  // PowerMedia video fascia hung under the deck edge, one facing the cars coming towards the bridge and one facing the
  // way they go. rotation.y = yaw turns a plane to face back along the track (c.tx, c.tz from trackPoint is the driving
  // direction), towards the cars at -t; yaw + PI faces the cars that have gone under, at +t.
  if (videoGroup) {
    const vw = span - 0.4, vh = vw / 30, vy = deckY - 0.38 - vh / 2;
    const stillMat = new THREE.MeshStandardMaterial({ map: tex.gantryBannerTexture(), roughness: 0.4, toneMapped: false });
    const videoMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const geo = new THREE.PlaneGeometry(vw, vh), stills = [], videos = [];
    for (const sg of [-1, 1]) {
      const p = P(mid, sg * (hw + 0.06), vy);
      for (const [list, m] of [[stills, stillMat], [videos, videoMat]]) {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(p[0], vy, p[2]);
        mesh.rotation.y = yaw + (sg > 0 ? Math.PI : 0);
        mesh.userData.debug = 'building';
        mesh.userData.noMerge = true;   // cull.js must not batch the still: it is hidden once the video plays
        list.push(mesh); videoGroup.add(mesh);
      }
      kit.box('steel', vw + 0.3, vh + 0.2, 0.1, p[0] - c.tx * sg * 0.06, vy, p[2] - c.tz * sg * 0.06, yaw);   // the screen housing
    }
    for (const v of videos) v.visible = false;
    videoMat.map = bannerVideo(() => { for (const v of videos) v.visible = true; for (const st of stills) st.visible = false; }) || null;
  }

  // sponsor banners on the truss sides
  for (let k = 0; k < 3; k++) {
    const u0 = uL + (k + 0.2) * span / 3, u1 = u0 + span / 3 * 0.8, a = P(u0, -hw - 0.1, deckY + 0.2), z = P(u1, -hw - 0.1, deckY + 0.2), row = tex.MODERN_SPONSORS[(k + Math.round(b.s)) % tex.MODERN_SPONSORS.length];
    sponsorPanel(kit, 'sponsor', row, a[0], a[2], z[0], z[2], deckY + 0.15, deckY + 1.5, 1);
  }

  // stairs on each side, going down away from the circuit: stringers, handrails, treads and posts
  for (const [side, sg] of [[0, -1], [1, 1]]) {
    const ua = sg < 0 ? uL : uR, ub = ua + sg * STAIR, top = deckY, g0 = b.sides[side].lo;
    for (const t of [-hw, hw]) {
      beam(kit, 'steel', P(ua, t, top - 0.1), P(ub, t, g0 + 0.2), 0.14, 0.2);
      beam(kit, 'steel', P(ua, t, top + 1.0), P(ub, t, g0 + 1.2), 0.07);
      for (const f of [0, 0.5, 1]) { const q = P(ua + (ub - ua) * f, t, 0), yt = top - (top - g0) * f - 0.1; kit.box('steel', 0.25, yt - g0 + 0.5, 0.25, q[0], (yt + g0 - 0.5) / 2, q[2]); }
    }
    const nSteps = Math.max(6, Math.round((top - g0) / 0.19));
    for (let k = 0; k < nSteps; k++) {
      const f = (k + 0.5) / nSteps, p = P(ua + (ub - ua) * f, 0, top - (top - g0) * f - 0.03);
      kit.box('steel', STAIR / nSteps + 0.02, 0.06, DECK_W - 0.3, p[0], p[1], p[2], yaw);
    }
    for (const t of [-hw, hw]) { const q = P(sg < 0 ? uL : uR, t, 0); kit.box('steel', 0.4, top - g0 + 0.6, 0.4, q[0], (top + g0) / 2, q[2]); }   // pier at the deck end
  }
}

export function buildExtras(T, ground, plan) {
  const group = new THREE.Group();
  const lampScreen = new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: 0xffffff, roughness: 0.4 });
  lampScreen.emissiveMap = lampScreen.map;
  onLampLevel(l => { lampScreen.emissiveIntensity = 0.5 + 0.9 * l; });
  const tent = ['#c8102e', '#1d4e9e', '#ffd21f', '#f2f2ee'];
  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.5, metalness: 0.5 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide }),
    sponsor: new THREE.MeshStandardMaterial({ map: tex.sharedSponsorAtlas(), roughness: 0.55, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ map: tex.facadeTexture({ wall: '#e8e2d2', glass: '#26323c', frame: '#f3f0e6', cols: 1, rows: 2 }), roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide }),
    lit: lampMaterial({ color: 0x26323c, emissive: 0xffd9a0, roughness: 0.3, side: THREE.DoubleSide }, 1.6),
    lamp: lampMaterial({ color: 0xdfe3e6, emissive: 0xfff2cf }, 5),
    screen: lampScreen,
    flagR: flagMaterial({ color: 0xc8102e }), flagB: flagMaterial({ color: 0x1d4e9e }), flagY: flagMaterial({ color: 0xffd21f }), flagW: flagMaterial({ color: 0xf2f2ee }),
  };
  for (const k of ['concrete', 'roof']) mats[k].userData.wet = 'surface';   // darker and glossier in the rain (src/environment.js)
  tent.forEach((c, k) => { mats['tent' + k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }); });
  const all = new Kit(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const torso = new THREE.BoxGeometry(0.42, 0.5, 0.26); torso.translate(0, 0.25, 0);
  const head = new THREE.OctahedronGeometry(0.13, 0);
  const crowdMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const videoGroup = new THREE.Group();

  for (const st of plan.items) {
    const kit = new Kit(), spots = [];
    if (st.kind === 'fanzone') fanZone(kit, st, spots); else if (st.kind === 'screen') bigScreen(kit, st); else if (st.kind === 'tower') mediaTower(kit, st, spots);
    E.set(0, st.yaw, 0);
    M.compose(new THREE.Vector3(st.x, st.y0, st.z), Q.setFromEuler(E), new THREE.Vector3(1, 1, 1));
    for (const [key, list] of kit.parts) for (const geo of list) { geo.applyMatrix4(M); all.push(key, geo); }
    if (spots.length) {
      const tm = new THREE.InstancedMesh(torso, crowdMat, spots.length), hm = new THREE.InstancedMesh(head, crowdMat, spots.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), one = new THREE.Vector3(1, 1, 1);
      spots.forEach(([a, y, z, colour, h, standing], k) => {
        const lift = standing ? 0.42 : 0;
        m4.compose(new THREE.Vector3(a, y + 0.45 + lift, z), q.identity(), new THREE.Vector3(0.9 + h * 0.25, standing ? 1.25 : 1, 1));
        tm.setMatrixAt(k, m4); tm.setColorAt(k, c.setHex(colour));
        m4.compose(new THREE.Vector3(a, y + 1.08 + lift + (standing ? 0.12 : 0), z), q, one);
        hm.setMatrixAt(k, m4); hm.setColorAt(k, c.setHex(SKIN[Math.floor(((h * 7919) % 1) * SKIN.length)]));
      });
      tm.castShadow = hm.castShadow = false; tm.userData.debug = hm.userData.debug = 'building';
      const cg = new THREE.Group(); cg.add(tm, hm); cg.position.set(st.x, st.y0, st.z); cg.rotation.y = st.yaw;
      group.add(cg);
    }
  }
  for (const b of plan.bridges) footbridge(all, b, videoGroup);

  // signs, pit boards: one merged mesh with the atlas
  const sk = new Kit();
  for (const s of plan.small.signs) {
    const y = ground.meshHeight(s.x, s.z), ex = [Math.cos(s.yaw), -Math.sin(s.yaw)], ux = ex[0] * 0.9, uz = ex[1] * 0.9;
    sk.box('post', 0.08, 2.3, 0.08, s.x - ux * 0.7, y + 1.1, s.z - uz * 0.7); sk.box('post', 0.08, 2.3, 0.08, s.x + ux * 0.7, y + 1.1, s.z + uz * 0.7);
    sk.quad('signs', [s.x + ux, y + 1.5, s.z + uz], [s.x - ux, y + 1.5, s.z - uz], [s.x - ux, y + 2.6, s.z - uz], [s.x + ux, y + 2.6, s.z + uz], tileUV(s.tile));
  }
  for (const p of plan.small.pit) {
    const y = ground.meshHeight(p.x, p.z), hwid = 2.4, a = [p.x + p.nx * hwid, p.z + p.nz * hwid], b = [p.x - p.nx * hwid, p.z - p.nz * hwid];
    for (const q of [a, b]) sk.box('post', 0.14, 4.4, 0.14, q[0], y + 2.1, q[1]);
    sk.quad('signs', [b[0], y + 2.2, b[1]], [a[0], y + 2.2, a[1]], [a[0], y + 4.4, a[1]], [b[0], y + 4.4, b[1]], tileUV(p.tile));
  }
  const signMesh = sk.build({ post: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.5 }), signs: new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6, side: THREE.DoubleSide }) });
  signMesh.traverse(o => { if (o.isMesh) o.userData.debug = 'sign'; });
  group.add(signMesh);

  // banner flags along the start straight: tall poles with long vertical flags (wind material)
  for (const f of plan.small.flags) {
    const y = ground.meshHeight(f.x, f.z) - 0.1, k = Math.round(f.s / 16) % 4;
    all.box('steel', 0.1, 8.4, 0.1, f.x, y + 4.2, f.z);
    addFlag(all, ['flagR', 'flagW', 'flagB', 'flagY'][k], f.x + f.tx * 0.05, y + 4.0, f.z + f.tz * 0.05, f.tx, f.tz, 1.5, 4.2, 4);
  }
  const body = all.build(mats);
  body.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  group.add(body);
  group.add(videoGroup);

  // bins: instanced
  if (plan.small.bins.length) {
    const bin = new THREE.CylinderGeometry(0.34, 0.3, 0.9, 8); bin.translate(0, 0.45, 0);
    const im = new THREE.InstancedMesh(bin, new THREE.MeshStandardMaterial({ color: 0x2f5d3c, roughness: 0.7 }), plan.small.bins.length);
    const m4 = new THREE.Matrix4();
    plan.small.bins.forEach((b, k) => { m4.makeTranslation(b.x, ground.meshHeight(b.x, b.z) - 0.05, b.z); im.setMatrixAt(k, m4); });
    im.userData.debug = 'sign'; group.add(im);
  }

  // perimeter fence: panels of diamond mesh and posts
  if (plan.small.fence.length) {
    const fk = new Kit(), pk = new Kit();
    let u = 0, prev = null;
    for (const s of plan.small.fence) {
      const ya = ground.meshHeight(s.ax, s.az), yb = ground.meshHeight(s.bx, s.bz), du = Math.hypot(s.bx - s.ax, s.bz - s.az) / 2;
      const cont = prev && Math.hypot(prev.bx - s.ax, prev.bz - s.az) < 0.5;
      if (!cont) u = 0;
      fk.quad('fence', [s.ax, ya - 0.2, s.az], [s.bx, yb - 0.2, s.bz], [s.bx, yb + 2.2, s.bz], [s.ax, ya + 2.2, s.az], [[u, 0], [u + du, 0], [u + du, 1.2], [u, 1.2]]);
      u += du;
      if (!cont) pk.box('post', 0.1, 2.6, 0.1, s.ax, ya + 1.1, s.az);
      pk.box('post', 0.1, 2.6, 0.1, s.bx, yb + 1.1, s.bz);
      prev = s;
    }
    const fenceMat = new THREE.MeshStandardMaterial({ map: tex.fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4, depthWrite: false });
    const fg = fk.build({ fence: fenceMat }, { fence: { cast: false } });
    const pg = pk.build({ post: new THREE.MeshStandardMaterial({ color: 0x555b61, roughness: 0.5, metalness: 0.5 }) }, { post: { cast: false } });
    for (const o of [fg, pg]) o.traverse(m => { if (m.isMesh) m.userData.debug = 'fence'; });
    group.add(fg, pg);
  }
  return group;
}

// the whole plan in one call (used by the scenery and by tools/venue.js); `stands` and `blockers` as the stands were planned
export function planExtras(T, ground, blockers, stands) {
  const sites = planSites(T, ground, blockers, stands);
  const fb = planFootbridges(T, ground, blockers, [...stands, ...sites.items]);
  const obstacles = [...stands, ...sites.items];
  const small = planSmall(T, ground, [...blockers, ...footBlockers(fb.bridges)], obstacles);
  return { items: sites.items, bridges: fb.bridges, small, why: [...sites.why, ...fb.why] };
}
