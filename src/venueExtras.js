// More trackside furniture: fan zones, big screens, a media tower, pedestrian footbridges, spectator signs and bins, pit entry and
// exit boards, banner flags along the start straight and a perimeter fence. Planned as numbers first (planExtras, checked by
// tools/venue.js with the same rules as the stands: behind the containment wall, off every barrier line, clear of buildings and of each
// other), then drawn into a handful of merged meshes (Kit) and instanced meshes.

import * as THREE from 'three';
import { bannerVideo } from './bannerVideo.js';
import * as tex from './textures.js';
import { Kit, metreUV, sponsorPanel, trackPoint, hash01, beam } from './meshKit.js';
import { frame, checkStand, wallClearance, standDepth, GAP } from './grandstands.js';
import { lampMaterial, flagMaterial, addFlag, onLampLevel, wind } from './lamps.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { crowdMesh } from './crowd.js';
import { CORNERS } from './corners.js';
import { vehicleBlockers } from './vehicleBays.js';


const wrapN = (i, n) => ((i % n) + n) % n;
const PALETTE = [0xc8102e, 0xf2f2ee, 0x1d4e9e, 0xffd21f, 0x0e7c86, 0xff6a13, 0x2f3136, 0x3f9d4f, 0xd4145a, 0x8a5cd6];

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
  // the left of Scramble, Hurricane Sweep and the run to Windsock Hairpin (placed after the stands, so they fill round them)
  // (the left of Scramble itself, s 335 to 520, is the pit exit side and is kept for the service vehicles: src/vehicleBays.js)
  { kind: 'marquee', name: 'Scramble Marquees', s: 300, range: 160, sides: [1], len: 40, depth: 14, back: [0, 10, 20, 30, 40] },
  { kind: 'screen', name: 'Standings Screen', s: 560, range: 90, sides: [0, 1], len: 18, depth: 7, standings: true },
  { kind: 'tower', name: 'Commentary Tower', s: 630, range: 90, sides: [0], len: 12, depth: 12 },
  { kind: 'screen', name: 'Big Screen Hurricane', s: 690, range: 60, sides: [0], len: 16, depth: 7 },
  { kind: 'marquee', name: 'Approach Marquees', s: 860, range: 70, sides: [0], len: 36, depth: 14 },
  // well back from the track: the ferris wheel, past the first row of stands, and the paddock behind the pit building
  { kind: 'wheel', name: 'Ferris Wheel', s: 600, range: 100, sides: [0], len: 44, depth: 16, back: [60, 50, 70, 80] },
  { kind: 'paddock', name: 'Paddock', s: 35, range: 10, sides: [0], len: 60, depth: 24, back: [70] },
  // infield and start straight
  { kind: 'medical', name: 'Medical Centre', s: 1070, range: 60, sides: [1], len: 36, depth: 30, back: [0] },
  { kind: 'scoreboard', name: 'Scoreboard', s: 300, range: 80, sides: [1], len: 8, depth: 5 },
  { kind: 'crane', name: 'Camera Crane', s: 3990, range: 140, sides: [1], len: 14, depth: 8 },
  { kind: 'camtower', name: 'TV Tower Start', s: 280, range: 60, sides: [1], len: 4, depth: 4 },
  { kind: 'camtower', name: 'TV Tower Scramble', s: 460, range: 60, sides: [1], len: 4, depth: 4 },
  { kind: 'camtower', name: 'TV Tower Hairpin', s: 900, range: 60, sides: [1, 0], len: 4, depth: 4 },
];

export function planSites(T, ground, blockers0, placed, sites = EXTRA_SITES) {
  const out = [], why = [], all = [...placed], vehicles = vehicleBlockers(T);
  for (const site of sites) {
    // the ground kept for the service vehicles; the paddock awnings may stand in the paddock zone (they are well behind the trucks)
    const blockers = [...blockers0, ...vehicles.filter(b => !(site.kind === 'paddock' && b.zone === 'paddock'))];
    let best = null;
    const reason = {};
    search:
    for (let off = 0; off <= site.range; off += 5) for (const sgn of off ? [1, -1] : [1]) for (const side of site.sides) for (const back of site.back || [0]) {
      // `back` moves the place further out than the usual gap behind the wall (the wheel and the paddock stand well back)
      const s = site.s + sgn * off, f0 = frame(T, s, side, site.len), depth = standDepth(site);
      const f = { ...f0, F: f0.F + back, x: f0.x + f0.ez[0] * back, z: f0.z + f0.ez[1] * back };
      const bad = checkStand(T, ground, blockers, all, f, side, site.len, depth);
      if (bad) { reason[bad] = (reason[bad] || 0) + 1; continue; }
      let near = false;   // the same 10 m the venue check wants behind the wall, over the whole footprint
      for (let a = -site.len / 2 - 2; a <= site.len / 2 + 2 && !near; a += 2) for (let b = 0; b <= depth && !near; b += 2) { const [x, z] = local(f, a, b); if (wallClearance(T, x, z) < GAP - 0.5) near = true; }
      if (near) { reason['too close to the wall'] = (reason['too close to the wall'] || 0) + 1; continue; }
      let lo = Infinity, hi = -Infinity;
      for (let a = -site.len / 2; a <= site.len / 2; a += 4) for (let b = 0; b <= depth; b += 3) { const [x, z] = local(f, a, b), y = ground.meshHeight(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      best = { name: site.name, kind: site.kind, standings: !!site.standings, s, side, len: site.len, rows: 0, x: f.x, z: f.z, ex: f.ex, ez: f.ez, yaw: f.yaw, F: f.F, depth, y0: hi + 0.15, low: lo };
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

// The toilet blocks, kiosks and photographers as circles, for the things planned after them (masts, lamp posts, trees).
export const smallBlockers = small => [...small.cater.flatMap(c => c.pts.map(([x, z]) => ({ x, z, r: 2, name: 'kiosk' }))), ...small.photo.map(p => ({ x: p.x, z: p.z, r: 1.5, name: 'photographer' }))];

// Obstacles other things must keep off (circles), for the footbridge stairs.
export const footBlockers = bridges => bridges.flatMap(b => b.sides.flatMap(s => s.pts.filter((_, k) => k % 3 === 0).map(([x, z]) => ({ x, z, r: 2.5, name: 'footbridge' }))));

// ---- small things: signs, bins, banner flags, pit boards and the perimeter fence ---------------------------------------
export const SIGN_LABELS = ['GRANDSTAND', 'GATE', 'FIRST AID', 'TOILETS', 'FAN ZONE', 'CAR PARK', 'MEDIA', 'EXIT', 'PIT ENTRY', 'PIT EXIT', 'HOSPITALITY', 'VIEWING AREA'];
// Arrows on the pit boards, as [right, up] on the face the approaching driver reads. The entry board stands 40 m before the
// mouth on the pit side, so its arrow points ahead and to the left (up and left: the way the car goes, not sideways across the road).
export const PIT_ARROWS = { entry: [-1, 1], exit: [1, 0] };
export const SMALL_RULES = { cater: { behind: 8, barrier: 6 }, photo: { behind: 2.5, barrier: 2.5 }, sign: { behind: 2.5, barrier: 3 }, bin: { behind: 3, barrier: 3 }, flag: { behind: 6, barrier: 5 }, pit: { behind: 2.2, barrier: 2.5 }, fence: { behind: 30, barrier: 20 } };

export function planSmall(T, ground, blockers, obstacles) {
  const bays = vehicleBlockers(T, false);
  const free = (x, z, r) => {
    if (wallClearance(T, x, z) < r.behind) return false;
    for (const sg of T.segs) if (segDist(x, z, sg) < r.barrier) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 2) return false;
    if (r !== SMALL_RULES.flag) for (const b of bays) if (Math.hypot(x - b.x, z - b.z) < b.r + 2) return false;   // the banner flags are the vehicle plan's own
    for (const o of obstacles) { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; if (Math.abs(a) < o.len / 2 + 2 && b > -3 && b < o.depth + 2) return false; }
    return true;
  };
  const out = { signs: [], bins: [], flags: [], pit: [], fence: [], cater: [], photo: [] };
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
  // a toilet block or a food kiosk at the far end of every stand and fan zone (beyond the bin), alternately: 6 m by 3 m
  obstacles.forEach((o, k) => {
    if (!['main', 'terrace', 'scaffold', 'fanzone'].includes(o.kind)) return;
    for (const b of [o.depth * 0.5, 3, o.depth - 3]) {
      const a = -(o.len / 2 + 8), at = (da, db) => [o.x + o.ex[0] * (a + da) + o.ez[0] * (b + db), o.z + o.ex[1] * (a + da) + o.ez[1] * (b + db)];
      const pts = [at(0, 0), ...[[-3, -1.5], [3, -1.5], [-3, 1.5], [3, 1.5]].map(([da, db]) => at(da, db))];
      if (!pts.every(([x, z]) => free(x, z, SMALL_RULES.cater))) continue;
      out.cater.push({ x: pts[0][0], z: pts[0][1], ex: o.ex, ez: o.ez, pts, type: k % 2 ? 'kiosk' : 'loos' });
      break;
    }
  });
  // photographers at a hole in the catch fence just past each corner's exit, on the outside, a few metres behind the wall
  for (const c of CORNERS) {
    const side = c.outside === 'L' ? 0 : 1, sg = side ? 1 : -1;
    for (const off of [15, 25, 35, 5, 45]) {
      const s = c.exitS + off, q = trackPoint(T, s, 0), i = q.i;
      if (T.isBridge[i] || T.street[side][i] || (side === 0 && (T.pitOut[i] || T.pitEntryZone[i]))) continue;
      const p = trackPoint(T, s, sg * (T.wall[side][i] + 3.2));
      if (!free(p.x, p.z, SMALL_RULES.photo)) continue;
      out.photo.push({ x: p.x, z: p.z, nx: -sg * q.nx, nz: -sg * q.nz, tx: q.tx, tz: q.tz, s });
      break;
    }
  }
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
  kit.quad(st.standings ? 'standings' : 'screen', [W / 2, y0, 3.65], [-W / 2, y0, 3.65], [-W / 2, y0 + Hs, 3.65], [W / 2, y0 + Hs, 3.65], [[0, 0], [1, 0], [1, 1], [0, 1]]);   // the picture faces the track; seen from the track +x is on the left, so u runs 0 to 1 from +x to -x
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

// ---- the venue pieces added round Scramble, Hurricane Sweep and the run to Windsock Hairpin, the infield and the start ----------

// a gable roof with its ridge along x, over x0..x1 and z0..z1, eaves at y0 and the ridge at y1 (a degenerate quad is one triangle)
function gable(kit, key, x0, x1, z0, z1, y0, y1) {
  const zm = (z0 + z1) / 2;
  kit.quad(key, [x1, y0, z0], [x0, y0, z0], [x0, y1, zm], [x1, y1, zm]);
  kit.quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, zm], [x0, y1, zm]);
  kit.quad(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, zm], [x0, y1, zm]);
  kit.quad(key, [x1, y0, z1], [x1, y0, z0], [x1, y1, zm], [x1, y1, zm]);
}

// a deck from the lowest ground up to the platform (y = 0), so a piece on a slope never floats
const plinth = (kit, st, w, d, x = 0, z = d / 2) => { const low = st.low - 0.7 - st.y0; kit.box('concrete', w, -low, d, x, low / 2, z, 0, 4); };

// Hospitality marquees: a row of white tents with peaked roofs, a sponsor valance along the front, tables, guests and flag poles.
function marquee(kit, st, spots) {
  const { len, depth } = st, n = Math.max(2, Math.round(len / 12)), pitch = len / n, z0 = 2.5, z1 = depth - 0.5, H = 2.7;
  plinth(kit, st, len, depth);
  for (let k = 0; k < n; k++) {
    const xa = -len / 2 + k * pitch + 0.4, xb = xa + pitch - 0.8, xc = (xa + xb) / 2, colour = 'tent' + ((k + Math.round(st.s)) % 4);
    for (const x of [xa, xb]) for (const z of [z0, z1]) kit.box('steel', 0.1, H, 0.1, x, H / 2, z);
    kit.box('tentWhite', xb - xa, H - 0.4, 0.05, xc, (H + 0.4) / 2, z1);            // back wall
    for (const x of [xa, xb]) kit.box('tentWhite', 0.05, H - 0.4, z1 - z0, x, (H + 0.4) / 2, (z0 + z1) / 2);   // side walls
    gable(kit, 'tentWhite', xa - 0.2, xb + 0.2, z0 - 0.3, z1 + 0.3, H, H + 1.8);
    kit.box(colour, xb - xa + 0.4, 0.45, 0.06, xc, H - 0.22, z0 - 0.32);            // the valance in the tent's colour
    sponsorPanel(kit, 'sponsor', tex.MODERN_SPONSORS[(k * 5 + Math.round(st.s)) % tex.MODERN_SPONSORS.length], xa + 0.4, z0 - 0.36, xb - 0.4, z0 - 0.36, H - 1.25, H - 0.45, -1);
    kit.box('lamp', xb - xa - 1, 0.08, 0.2, xc, H - 0.5, z0 + 0.4);
    for (let t = 0; t < 2; t++) {
      const tx = xc + (t ? 2.4 : -2.4), tz = z0 + 4;
      kit.box('white', 1.6, 0.06, 1.6, tx, 0.95, tz); kit.box('steel', 0.08, 0.95, 0.08, tx, 0.47, tz);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1.1]]) if (hash01(k, t, dx * 3 + dz * 7) < 0.8) spots.push([tx + dx * 1.1, 0.02, tz + dz, PALETTE[((k + t) * 3 + dx + 5) % PALETTE.length], hash01(k, t, 9 + dx), true]);
    }
  }
  // flag poles in front, every 8 m
  for (let x = -len / 2 + 2, k = 0; x <= len / 2 - 1; x += 8, k++) {
    kit.box('steel', 0.1, 8, 0.1, x, 4, 0.8);
    addFlag(kit, ['flagR', 'flagW', 'flagB', 'flagY'][k % 4], x + 0.05, 5.4, 0.8, 1, 0, 2.6, 1.7, 5);
  }
}

// Medical centre: a single storey building with a red cross, an ambulance canopy, and a helipad with a helicopter on it (rotors still).
function medical(kit, st) {
  const { len, depth } = st, x0 = -len / 2;
  plinth(kit, st, len, depth);
  // the building on the left half
  const bx0 = x0 + 1, bx1 = x0 + 17, bz0 = 3, bz1 = 15, H = 4.6;
  kit.box('white', bx1 - bx0, H, bz1 - bz0, (bx0 + bx1) / 2, H / 2, (bz0 + bz1) / 2);
  kit.box('roof', bx1 - bx0 + 0.6, 0.3, bz1 - bz0 + 0.6, (bx0 + bx1) / 2, H + 0.15, (bz0 + bz1) / 2);
  kit.box('red', bx1 - bx0 + 0.02, 0.5, bz1 - bz0 + 0.02, (bx0 + bx1) / 2, H - 0.6, (bz0 + bz1) / 2);
  kit.quad('glass', [bx1 - 1, 0.8, bz0 - 0.03], [bx0 + 6, 0.8, bz0 - 0.03], [bx0 + 6, 3.4, bz0 - 0.03], [bx1 - 1, 3.4, bz0 - 0.03], [[0, 0], [2.5, 0], [2.5, 1], [0, 1]]);
  // the cross on the front, and a smaller one on the roof
  const cx = bx0 + 3, cy = 2.4;
  kit.box('red', 2.4, 0.7, 0.08, cx, cy, bz0 - 0.05); kit.box('red', 0.7, 2.4, 0.08, cx, cy, bz0 - 0.05);
  kit.box('red', 5, 0.04, 1.4, (bx0 + bx1) / 2, H + 0.32, (bz0 + bz1) / 2); kit.box('red', 1.4, 0.04, 5, (bx0 + bx1) / 2, H + 0.32, (bz0 + bz1) / 2);
  // ambulance canopy at the side of the building
  for (const x of [bx0 + 1, bx0 + 9]) kit.box('steel', 0.2, 3.6, 0.2, x, 1.8, 0.6);
  kit.box('roof', 10, 0.2, 3.2, bx0 + 5, 3.7, 1.6);
  // helipad: a raised concrete square with the H and circle on top, edge lights, a windsock
  const hx = x0 + 28, hz = depth / 2 + 1, P = 14;
  kit.box('concrete', P, 0.35, P, hx, 0.17, hz, 0, 4);
  kit.quad('helipad', [hx - P / 2 + 0.3, 0.36, hz + P / 2 - 0.3], [hx + P / 2 - 0.3, 0.36, hz + P / 2 - 0.3], [hx + P / 2 - 0.3, 0.36, hz - P / 2 + 0.3], [hx - P / 2 + 0.3, 0.36, hz - P / 2 + 0.3]);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; kit.box('lamp', 0.25, 0.15, 0.25, hx + Math.cos(a) * (P / 2 - 0.4), 0.42, hz + Math.sin(a) * (P / 2 - 0.4)); }
  kit.box('steel', 0.1, 6, 0.1, hx + P / 2 + 1.5, 3, hz - P / 2);
  const sock = new THREE.ConeGeometry(0.4, 2.2, 6, 1, true); sock.rotateZ(Math.PI / 2); sock.translate(hx + P / 2 + 2.6, 5.7, hz - P / 2); kit.push('orange', sock);
  // the helicopter: body, cabin glass, tail boom and fin, skids, a two blade main rotor and the tail rotor
  const g = new Kit(), yaw = 0.5;
  g.box('red', 3.2, 1.6, 1.7, 0, 1.55, 0);
  g.box('glass', 1.3, 1.2, 1.5, 2.1, 1.65, 0);
  g.box('white', 2.6, 0.5, 1.72, 0.2, 2.15, 0);
  beam(g, 'red', [-1.4, 1.9, 0], [-6.2, 2.3, 0], 0.45, 0.35);
  g.box('red', 0.7, 1.3, 0.12, -6.1, 2.8, 0);
  g.box('steel', 0.16, 0.5, 0.5, -6.3, 2.5, 0.3);
  for (const z of [-0.95, 0.95]) { g.box('steel', 4.2, 0.08, 0.1, 0.2, 0.32, z); for (const x of [-0.8, 1.2]) g.box('steel', 0.08, 0.55, 0.08, x, 0.6, z * 0.9); }
  g.box('steel', 0.3, 0.5, 0.3, 0, 2.6, 0);
  g.box('steel', 10.5, 0.06, 0.35, 0, 2.9, 0, 0.6);
  for (const [key, list] of g.parts) for (const geo of list) { geo.rotateY(yaw); geo.translate(hx, 0.36, hz); kit.push(key, geo); }
}

// A TV camera tower: a scaffold tower with a platform, a small canopy, the camera on a tripod and its operator.
function camTower(kit, st, spots) {
  const H = 7.5, w = 1.5, zc = 2;
  plinth(kit, st, 3.6, 3.6, 0, zc);
  for (const [x, z] of [[-w, zc - w], [w, zc - w], [-w, zc + w], [w, zc + w]]) kit.box('scaff', 0.1, H + 1.1, 0.1, x, (H + 1.1) / 2, z);
  for (let k = 0; k < 3; k++) {
    const y = 0.3 + k * 2.4;
    for (const z of [zc - w, zc + w]) beam(kit, 'scaff', [-w, y, z], [w, y + 2.3, z], 0.07);
    for (const x of [-w, w]) beam(kit, 'scaff', [x, y, zc + w], [x, y + 2.3, zc - w], 0.07);
  }
  kit.box('concrete', 3.4, 0.15, 3.4, 0, H, zc);
  kit.box('scaff', 3.2, 0.06, 0.06, 0, H + 1.05, zc - w); kit.box('scaff', 0.06, 0.06, 3.2, -w, H + 1.05, zc); kit.box('scaff', 0.06, 0.06, 3.2, w, H + 1.05, zc);
  kit.box('tent1', 3.8, 0.1, 3.8, 0, H + 3.0, zc); for (const x of [-w, w]) kit.box('steel', 0.06, 1.9, 0.06, x, H + 2.05, zc + w);
  kit.box('black', 0.42, 0.42, 0.9, 0.3, H + 1.45, zc - 0.5); kit.box('black', 0.22, 0.22, 0.6, 0.3, H + 1.45, zc - 1.2);
  for (const dx of [-0.25, 0.25]) beam(kit, 'steel', [0.3 + dx, H, zc], [0.3, H + 1.2, zc - 0.5], 0.04);
  spots.push([-0.6, H + 0.08, zc + 0.2, 0x1d4e9e, 0.4, true]);
}

// A camera crane on a dolly: the boom runs along the track (inside the footprint) with the counterweight at one end.
function crane(kit, st, spots) {
  const zc = st.depth / 2;
  plinth(kit, st, 6, 4.5, -1, zc);
  kit.box('black', 3.0, 0.7, 2.6, -1, 0.35, zc);
  for (const x of [-2.2, 0.2]) for (const z of [zc - 1.3, zc + 1.3]) { const w = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10); w.rotateX(Math.PI / 2); w.translate(x, 0.3, z); kit.push('black', w); }
  kit.box('steel', 0.4, 3.4, 0.4, -1, 2.4, zc);
  beam(kit, 'steel', [-6, 3.6, zc], [6.4, 6.8, zc], 0.3, 0.35);
  kit.box('black', 1.0, 0.9, 0.9, -5.6, 3.3, zc);
  kit.box('black', 0.6, 0.55, 0.5, 6.3, 6.4, zc);
  kit.box('glass', 0.05, 0.3, 0.3, 6.62, 6.4, zc);
  spots.push([-1.6, 0.02, zc + 1.9, 0x2f3136, 0.3, true]);
  spots.push([0.8, 0.02, zc + 1.9, 0xff6a13, 0.6, true]);
}

// A scoreboard pylon: positions down the face on a lit panel (key 'board', which faces the track).
function scoreboard(kit, st) {
  const zc = 2.4, W = 4.4, H = 17;
  plinth(kit, st, W + 2, 3.6, 0, zc);
  kit.box('white', W + 0.6, H, 1.0, 0, H / 2, zc);
  kit.box('red', W + 0.7, 1.2, 1.05, 0, H + 0.1, zc);
  kit.quad('board', [W / 2, 1.6, zc - 0.52], [-W / 2, 1.6, zc - 0.52], [-W / 2, H - 0.8, zc - 0.52], [W / 2, H - 0.8, zc - 0.52]);
}

// The paddock behind the pit building: a paved yard with team awnings along the front, tables under them, people, flags. The back of the
// yard is left clear (team trucks park there).
function paddock(kit, st, spots) {
  const { len, depth } = st, n = Math.max(3, Math.round(len / 14)), pitch = len / n;
  plinth(kit, st, len, depth);
  for (let k = 0; k < n; k++) {
    const xa = -len / 2 + k * pitch + 1, xb = xa + pitch - 2, xc = (xa + xb) / 2, z0 = 3, z1 = 11, colour = 'tent' + (k % 4);
    for (const x of [xa, xb]) for (const z of [z0, z1]) kit.box('steel', 0.12, 3.2, 0.12, x, 1.6, z);
    kit.box(colour, xb - xa + 0.4, 0.15, z1 - z0 + 0.6, xc, 3.25, (z0 + z1) / 2, 0, 0, -0.06);
    kit.box(colour, xb - xa + 0.4, 0.5, 0.06, xc, 2.95, z0 - 0.3);
    sponsorPanel(kit, 'sponsor', tex.MODERN_SPONSORS[(k * 3 + 2) % tex.MODERN_SPONSORS.length], xa, z1 + 0.05, xb, z1 + 0.05, 0.4, 2.6, -1);
    for (let t = 0; t < 3; t++) {
      const tx = xa + 2 + t * (xb - xa - 4) / 2, tz = z0 + 3;
      kit.box('white', 1.4, 0.06, 0.9, tx, 0.95, tz); kit.box('steel', 0.08, 0.95, 0.08, tx, 0.47, tz);
      if (hash01(k, t, 4) < 0.7) spots.push([tx + 0.9, 0.02, tz + 0.2, PALETTE[(k * 2 + t) % PALETTE.length], hash01(k, t, 6), true]);
    }
    kit.box('steel', 0.1, 7, 0.1, xc, 3.5, 0.6);
    addFlag(kit, ['flagR', 'flagB', 'flagY', 'flagW'][k % 4], xc + 0.05, 4.8, 0.6, 1, 0, 2.2, 1.5, 5);
  }
  // white lines marking the truck bays at the back
  for (let x = -len / 2 + 4; x <= len / 2 - 3; x += 4.5) kit.box('white', 0.12, 0.02, 9, x, 0.01, depth - 6);
}

// The ferris wheel. The legs, the hub mount, the boarding platform and the ticket booth are static (into `kit`); the turning part
// (rims, open lattice spokes, gondolas) is one mesh made by wheelMesh() and turned in its vertex shader by the shared clock.
export const WHEEL = { R: 17, H: 21.5, speed: Math.PI * 2 * 5 / 900 };   // radius, hub height, radians a second (five turns per 900 s clock wrap)
function wheelStand(kit, st) {
  const { R, H } = WHEEL, zc = st.depth / 2, low = st.low - 0.7 - st.y0;
  // the A-frame legs stand on concrete footings that go down to the lowest ground, so a slope never leaves one hanging
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      kit.box('concrete', 2.4, 0.6 - low, 2.4, sx * 10, (0.6 + low) / 2, zc + sz * 4.2, 0, 4);
      beam(kit, 'wheelSteel', [sx * 10, 0.4, zc + sz * 4.2], [0, H, zc + sz * 2.0], 0.55, 0.55);
    }
    beam(kit, 'wheelSteel', [-6.2, 8, zc + sz * 3.5], [6.2, 8, zc + sz * 3.5], 0.3);
  }
  beam(kit, 'wheelSteel', [0, H, zc - 2.4], [0, H, zc + 2.4], 1.0, 1.0);   // the axle
  // boarding platform and ticket booth under the wheel
  kit.box('concrete', 8, 0.9 - low, 5, 0, (0.9 + low) / 2, zc, 0, 4);
  kit.box('steel', 7.8, 0.06, 0.06, 0, 1.9, zc - 2.4);
  kit.box('concrete', 3.2, 0.3 - low, 2.8, -7.5, (0.3 + low) / 2, zc - 4.5, 0, 4);
  kit.box('white', 2.6, 2.6, 2.2, -7.5, 1.6, zc - 4.5);
  kit.box('tent0', 3.0, 0.2, 2.6, -7.5, 3.0, zc - 4.5);
}

function wheelMesh(st, palette) {
  const { R, H } = WHEEL, NG = 18, zc = st.depth / 2;
  const frame = new Kit(), bulbs = new Kit();
  const P = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
  for (const z of [-1.4, 1.4]) {
    for (let k = 0; k < 36; k++) { const a = k / 36 * Math.PI * 2, b = (k + 1) / 36 * Math.PI * 2; beam(frame, 'f', P(R, a, z), P(R, b, z), 0.28); beam(frame, 'f', P(R * 0.55, a, z), P(R * 0.55, b, z), 0.16); }
    for (let k = 0; k < NG; k++) {
      const a = k / NG * Math.PI * 2, d = 0.07;
      beam(frame, 'f', P(1.2, a - d * 3, z), P(R, a, z), 0.12);   // a pair of tension members to each rim node: open lattice
      beam(frame, 'f', P(1.2, a + d * 3, z), P(R, a, z), 0.12);
      beam(frame, 'f', P(R * 0.55, a, z), P(R, a + Math.PI / NG, z), 0.09);
    }
    for (let k = 0; k < 36; k++) bulbs.box('b', 0.22, 0.22, 0.22, ...P(R + 0.2, (k + 0.5) / 36 * Math.PI * 2, z));
  }
  for (let k = 0; k < NG; k++) beam(frame, 'f', P(R, k / NG * Math.PI * 2, -1.4), P(R, k / NG * Math.PI * 2, 1.4), 0.14);
  // colour, pivot and spin per vertex: spin 1 turns the vertex with the wheel; spin 0 moves it with its pivot (a gondola stays upright)
  const finish = (list, colourOf, pivotOf) => list.map((geo, n) => {
    const p = geo.attributes.position, cnt = p.count, col = new Float32Array(cnt * 3), piv = new Float32Array(cnt * 3), spin = new Float32Array(cnt);
    const c = colourOf(n), pv = pivotOf(n);
    for (let v = 0; v < cnt; v++) {
      col.set([c.r, c.g, c.b], v * 3);
      if (pv) piv.set(pv, v * 3); else { piv.set([p.getX(v), p.getY(v), p.getZ(v)], v * 3); spin[v] = 1; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('pivot', new THREE.BufferAttribute(piv, 3));
    geo.setAttribute('spin', new THREE.BufferAttribute(spin, 1));
    return geo;
  });
  const white = new THREE.Color(0xf2f2ee), grey = new THREE.Color(0x4a4f55), lampColour = new THREE.Color(0xfff2cf);
  const out = finish(frame.parts.get('f'), () => white, () => null);
  // gondolas: a cabin, a roof and a hanger each, hung from a rim node (the pivot)
  const cab = [], cabColour = [], cabPivot = [];
  for (let k = 0; k < NG; k++) {
    const [px, py] = P(R, k / NG * Math.PI * 2, 0), colour = new THREE.Color(palette[k % palette.length]);
    cab.push(new THREE.BoxGeometry(1.8, 1.6, 1.7).translate(px, py - 1.9, 0), new THREE.BoxGeometry(2.1, 0.2, 2.0).translate(px, py - 1.0, 0), new THREE.BoxGeometry(0.1, 0.9, 0.1).translate(px, py - 0.5, 0));
    cabColour.push(colour, white, grey);
    for (let q = 0; q < 3; q++) cabPivot.push([px, py, 0]);
  }
  out.push(...finish(cab, n => cabColour[n], n => cabPivot[n]));
  const bulbOut = finish(bulbs.parts.get('b'), () => lampColour, () => null);
  const strip = g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'pivot', 'spin'].includes(k)) g.deleteAttribute(k); return g; };
  const turning = (mat, list) => {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = wind.uTime;
      const rot = `float wa = uTime * ${WHEEL.speed.toFixed(6)}; float wc = cos(wa), ws = sin(wa);`;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 pivot; attribute float spin; uniform float uTime;')
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { ${rot} vec3 rn = vec3(wc * objectNormal.x - ws * objectNormal.y, ws * objectNormal.x + wc * objectNormal.y, objectNormal.z); objectNormal = mix(objectNormal, rn, spin); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        { ${rot} vec3 pr = vec3(wc * pivot.x - ws * pivot.y, ws * pivot.x + wc * pivot.y, pivot.z); transformed = pr + (position - pivot); }`);
    };
    mat.customProgramCacheKey = () => 'ferris-wheel';
    const mesh = new THREE.Mesh(mergeGeometries(list.map(strip), false), mat);
    mesh.position.set(st.x + st.ez[0] * zc, st.y0 + H, st.z + st.ez[1] * zc);
    mesh.rotation.y = st.yaw;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.debug = 'building'; mesh.userData.noMerge = true;
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere.radius = R + 3;
    mesh.geometry.boundingSphere.center.set(0, 0, 0);
    return mesh;
  };
  return [
    turning(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), out),
    turning(lampMaterial({ color: 0xfff2cf, emissive: 0xfff2cf, vertexColors: true }, 4), bulbOut),
  ];
}

function boardTexture(kind) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  if (kind === 'helipad') {
    c.width = c.height = 256;
    x.fillStyle = '#4a4d50'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#f2f2ee'; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 100, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#ffd21f'; x.lineWidth = 6; x.strokeRect(8, 8, 240, 240);
    x.fillStyle = '#f2f2ee'; x.fillRect(88, 70, 18, 116); x.fillRect(150, 70, 18, 116); x.fillRect(88, 119, 80, 18);
  } else if (kind === 'standings') {
    c.width = 512; c.height = 288;
    x.fillStyle = '#0d1420'; x.fillRect(0, 0, 512, 288);
    x.fillStyle = '#e10600'; x.fillRect(0, 0, 512, 34);
    x.fillStyle = '#ffffff'; x.font = 'bold 24px sans-serif'; x.textBaseline = 'middle'; x.fillText('STANDINGS', 16, 18);
    x.textAlign = 'right'; x.fillText('LAP 12 / 20', 496, 18); x.textAlign = 'left';
    const names = ['VEYRA', 'NORRLAND', 'CORVANE', 'OXLEY', 'ZEPHRA', 'LUMENOR', 'BRIGHTFOLD', 'DELTADASH'];
    names.forEach((n, k) => {
      const y = 52 + k * 29;
      x.fillStyle = k % 2 ? '#141d2c' : '#18243a'; x.fillRect(8, y - 13, 496, 27);
      x.fillStyle = '#ffd21f'; x.font = 'bold 20px sans-serif'; x.fillText(String(k + 1), 18, y);
      x.fillStyle = '#ffffff'; x.fillText(n, 60, y);
      x.fillStyle = '#9fc2ff'; x.textAlign = 'right'; x.fillText(k ? '+' + (k * 1.37 + 0.21).toFixed(3) : '1:30.412', 496, y); x.textAlign = 'left';
    });
  } else {
    // scoreboard pylon: lap counter and the running order as car numbers, tall and narrow
    c.width = 128; c.height = 512;
    x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = '#ffd21f'; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('LAP', 64, 24); x.font = 'bold 40px sans-serif'; x.fillText('12', 64, 62);
    const nums = [7, 21, 3, 44, 16, 9, 55, 12, 31, 5];
    nums.forEach((n, k) => {
      const y = 112 + k * 39;
      x.fillStyle = '#e10600'; x.font = 'bold 22px sans-serif'; x.textAlign = 'left'; x.fillText(String(k + 1), 10, y);
      x.fillStyle = '#ffffff'; x.font = 'bold 32px sans-serif'; x.textAlign = 'right'; x.fillText(String(n), 118, y);
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildExtras(T, ground, plan) {
  const group = new THREE.Group();
  // a screen that glows a little by day and more at night
  const litScreen = map => { const m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, roughness: 0.4 }); onLampLevel(l => { m.emissiveIntensity = 0.5 + 0.9 * l; }); return m; };
  const lampScreen = litScreen(screenTexture());
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
    tentWhite: new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.85, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.7, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.3 }),
    scaff: new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.45, metalness: 0.7 }),
    wheelSteel: new THREE.MeshStandardMaterial({ color: 0xe9ebec, roughness: 0.5, metalness: 0.3 }),
    helipad: new THREE.MeshStandardMaterial({ map: boardTexture('helipad'), roughness: 0.85 }),
    standings: litScreen(boardTexture('standings')),
    board: litScreen(boardTexture('scoreboard')),
  };
  for (const k of ['concrete', 'roof']) mats[k].userData.wet = 'surface';   // darker and glossier in the rain (src/environment.js)
  tent.forEach((c, k) => { mats['tent' + k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }); });
  const all = new Kit(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();

  const videoGroup = new THREE.Group();

  for (const st of plan.items) {
    const kit = new Kit(), spots = [];
    const draw = { fanzone: fanZone, screen: bigScreen, tower: mediaTower, marquee, medical, camtower: camTower, crane, scoreboard, paddock, wheel: wheelStand }[st.kind];
    if (draw) draw(kit, st, spots);
    if (st.kind === 'wheel') group.add(...wheelMesh(st, PALETTE));
    E.set(0, st.yaw, 0);
    M.compose(new THREE.Vector3(st.x, st.y0, st.z), Q.setFromEuler(E), new THREE.Vector3(1, 1, 1));
    for (const [key, list] of kit.parts) for (const geo of list) { geo.applyMatrix4(M); all.push(key, geo); }
    const cm = crowdMesh(spots);
    if (cm) {
      const cg = new THREE.Group(); cg.add(cm); cg.position.set(st.x, st.y0, st.z); cg.rotation.y = st.yaw;
      group.add(cg);
    }
  }
  for (const b of plan.bridges) footbridge(all, b, videoGroup);

  // signs, pit boards: one merged mesh with the atlas
  const sk = new Kit();
  for (const s of plan.small.signs) {
    const y = ground.surfaceHeight(s.x, s.z), ex = [Math.cos(s.yaw), -Math.sin(s.yaw)], ux = ex[0] * 0.9, uz = ex[1] * 0.9;
    sk.box('post', 0.08, 2.3, 0.08, s.x - ux * 0.7, y + 1.1, s.z - uz * 0.7); sk.box('post', 0.08, 2.3, 0.08, s.x + ux * 0.7, y + 1.1, s.z + uz * 0.7);
    sk.quad('signs', [s.x + ux, y + 1.5, s.z + uz], [s.x - ux, y + 1.5, s.z - uz], [s.x - ux, y + 2.6, s.z - uz], [s.x + ux, y + 2.6, s.z + uz], tileUV(s.tile));
  }
  for (const p of plan.small.pit) {
    const y = ground.surfaceHeight(p.x, p.z), hwid = 2.4, a = [p.x + p.nx * hwid, p.z + p.nz * hwid], b = [p.x - p.nx * hwid, p.z - p.nz * hwid];
    for (const q of [a, b]) sk.box('post', 0.14, 4.4, 0.14, q[0], y + 2.1, q[1]);
    sk.quad('signs', [b[0], y + 2.2, b[1]], [a[0], y + 2.2, a[1]], [a[0], y + 4.4, a[1]], [b[0], y + 4.4, b[1]], tileUV(p.tile));
  }
  const signMesh = sk.build({ post: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.5 }), signs: new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6, side: THREE.DoubleSide }) });
  signMesh.traverse(o => { if (o.isMesh) o.userData.debug = 'sign'; });
  group.add(signMesh);

  // toilet blocks and food kiosks at the ends of the stands, photographers at the corner exits (people into one world-space crowd)
  const people = [];
  const place = (o, y) => (key, w, h, d, a, yy, b) => all.box(key, w, h, d, o.x + o.ex[0] * a + o.ez[0] * b, y + yy, o.z + o.ex[1] * a + o.ez[1] * b, Math.atan2(-o.ex[1], o.ex[0]));
  for (const c of plan.small.cater) {
    const y = Math.min(...c.pts.map(([x, z]) => ground.meshHeight(x, z))), at = place(c, y);
    at('concrete', 6.4, 0.5, 3.2, 0, 0.0, 0);
    if (c.type === 'loos') {
      for (let k = 0; k < 4; k++) { at(k % 2 ? 'tent1' : 'tent3', 1.35, 2.3, 1.4, -2.2 + k * 1.45, 1.4, 0.2); at('white', 1.45, 0.12, 1.5, -2.2 + k * 1.45, 2.6, 0.2); }
    } else {
      at('white', 4.6, 2.6, 2.4, 0, 1.55, 0.3);
      at('tent0', 5.0, 0.1, 1.6, 0, 2.75, -1.6);
      at('steel', 4.4, 0.1, 0.5, 0, 1.15, -1.0);
      at('lamp', 4.0, 0.08, 0.15, 0, 2.6, -1.0);
      for (let k = 0; k < 3; k++) people.push([c.x + c.ex[0] * (k - 1) * 1.2 - c.ez[0] * 2.1, y + 0.25, c.z + c.ex[1] * (k - 1) * 1.2 - c.ez[1] * 2.1, PALETTE[(k * 4 + 1) % PALETTE.length], hash01(k, 3, 8), true]);
    }
  }
  for (const p of plan.small.photo) {
    const y = ground.surfaceHeight(p.x, p.z), yaw = Math.atan2(p.nx, p.nz);   // the lens (the box's long side) points at the track
    people.push([p.x, y, p.z, 0xff6a13, 0.5, true]);
    const lx = p.x + p.nx * 0.45, lz = p.z + p.nz * 0.45;
    all.box('black', 0.18, 0.18, 0.55, lx, y + 1.5, lz, yaw);
    all.box('black', 0.25, 0.25, 0.25, p.x + p.nx * 0.15, y + 1.5, p.z + p.nz * 0.15, yaw);
  }
  const pc = crowdMesh(people);
  if (pc) group.add(pc);

  // banner flags along the start straight: tall poles with long vertical flags (wind material)
  for (const f of plan.small.flags) {
    const y = ground.surfaceHeight(f.x, f.z) - 0.1, k = Math.round(f.s / 16) % 4;
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
    plan.small.bins.forEach((b, k) => { m4.makeTranslation(b.x, ground.surfaceHeight(b.x, b.z) - 0.05, b.z); im.setMatrixAt(k, m4); });
    im.userData.debug = 'sign'; group.add(im);
  }

  // perimeter fence: panels of diamond mesh and posts
  if (plan.small.fence.length) {
    const fk = new Kit(), pk = new Kit();
    let u = 0, prev = null;
    for (const s of plan.small.fence) {
      const ya = ground.surfaceHeight(s.ax, s.az), yb = ground.surfaceHeight(s.bx, s.bz), du = Math.hypot(s.bx - s.ax, s.bz - s.az) / 2;
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
