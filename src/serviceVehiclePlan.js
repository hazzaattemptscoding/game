// Where the parked service vehicles stand (src/serviceVehicles.js draws them). Numbers only, deterministic, derived from the track.
//   planVehicles(T, keep?)  [{ type, s, d, x, z, yaw, colourSeed, label }]
//     keep is what the scenery leaves free ({ obstacles, blockers } as scenery.userData.keepClear): the stands and the other
//     boxes, and the building circles. Without it the vehicles only avoid the track, the pit lane, the bridge and the furniture.
// A vehicle stands behind the containment wall (on the pit side, behind the pit lane's outer edge), 4 m or more from every barrier
// line and from every kind of road surface, so no physics is involved. Each is searched for at its anchor, then slid along the road
// and out from the wall until every sample of its footprint passes. yaw is the heading in the ground plane (atan2(z, x) of the nose).

import { trackPoint } from './meshKit.js';
import { wallClearance, GAP } from './grandstands.js';
import { entryRoadAt } from './track.js';
import { planMarshal } from './marshal.js';
import { planMasts } from './floodlights.js';

// footprint in metres (the models stay inside these; tools/vehicles.js checks it)
export const VEHICLES = {
  ambulance: { len: 6.5, wid: 2.5, label: 'ambulance' },
  fire: { len: 8.4, wid: 2.8, label: 'fire engine' },
  recovery: { len: 8.1, wid: 2.5, label: 'recovery truck' },
  medical: { len: 5.1, wid: 2.3, label: 'medical car' },
  sweeper: { len: 6.3, wid: 2.4, label: 'track sweeper' },
  safety: { len: 4.9, wid: 2.3, label: 'safety car' },
  buggy: { len: 3.0, wid: 1.4, label: 'marshal buggy' },
  transport: { len: 13.4, wid: 3.0, label: 'team transporter' },
};

export const WALL_MIN = 4;          // every footprint sample is this far behind the containment wall
export const BARRIER_MIN = 4;       // and this far from every barrier line
export const FURNITURE_MIN = 3.5;   // from the footprint to a board, sign or bin
export const VEHICLE_GAP = 1.5;     // between two vehicles
export const BRIDGE_MIN = 40;       // from the deck (and so from its approach)
export const PADDOCK_MIN = 16;      // the paddock starts this far behind the garage fronts (the building is 14 deep)
export const MARGIN = 0.6;          // the footprint is tested this much bigger than the vehicle

// Anchors, in the order they are placed (the ones that matter most first). s is along the lap, side 0 left (the pit side) or
// 1 right, offs the distances behind the wall to try, slide how far along the road it may be moved from the anchor, face 1
// nose with the traffic or -1 against it, turn degrees towards the track, near a post names the marshal post k to stand beside.
export const SLOTS = [
  { type: 'safety', s: 335, side: 0, offs: [7, 9, 12, 16], slide: 60, face: 1, turn: 0, why: 'pit exit: on the grass beside the exit road' },
  { type: 'medical', s: 405, side: 0, offs: [7, 9, 12, 16], slide: 60, face: 1, turn: 8, why: 'beyond the pit wall end' },
  { type: 'sweeper', s: 365, side: 0, offs: [7, 9, 12, 16], slide: 50, face: 1, turn: 0, why: 'start of the pit exit' },
  { type: 'ambulance', s: 470, side: 0, offs: [7, 9, 12, 16], slide: 80, face: 1, turn: 10, why: 'pit exit side' },
  { type: 'fire', s: 520, side: 0, offs: [7, 9, 12, 16], slide: 80, face: 1, turn: 10, why: 'pit exit side' },
  { type: 'ambulance', s: 154, side: 1, offs: [7, 9, 12, 16], slide: 70, face: 1, turn: 10, why: 'main marshal post, start straight' },
  { type: 'fire', s: 2842, side: 0, offs: [7, 9, 12, 16], slide: 70, face: -1, turn: 10, why: 'main marshal post' },
  { type: 'recovery', s: 958, side: 0, offs: [7, 9, 12, 16], slide: 80, face: -1, turn: 20, why: 'outside of Windsock Hairpin' },
  { type: 'recovery', s: 1968, side: 0, offs: [7, 9, 12, 16], slide: 80, face: -1, turn: 20, why: 'outside of Station Corner' },
  { type: 'recovery', s: 3184, side: 1, offs: [7, 9, 12, 16], slide: 80, face: -1, turn: 20, why: 'outside of Boundary Loop' },
  { type: 'sweeper', s: 3420, side: 0, offs: [7, 9, 12, 16], slide: 70, face: 1, turn: 0, why: 'by the pit entry road' },
  { type: 'buggy', s: 3700, side: 0, behindPit: 9, offs: [0, 4, 8, 12, 16], slide: 60, face: 1, turn: 0, why: 'paddock, behind the pit building' },
  { type: 'buggy', s: 60, side: 0, behindPit: 9, offs: [0, 4, 8, 12, 16], slide: 60, face: -1, turn: 0, why: 'paddock, behind the pit building' },
  { type: 'transport', s: 3770, side: 0, behindPit: 12, offs: [0, 5, 10, 15], slide: 80, face: 1, turn: 0, why: 'paddock line' },
  { type: 'transport', s: 3800, side: 0, behindPit: 12, offs: [0, 5, 10, 15], slide: 80, face: 1, turn: 0, why: 'paddock line' },
  { type: 'transport', s: 3830, side: 0, behindPit: 12, offs: [0, 5, 10, 15], slide: 80, face: 1, turn: 0, why: 'paddock line' },
];

const wrapN = (i, n) => ((i % n) + n) % n;
const hash = (a, b = 0) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 7, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

// the footprint samples of a vehicle: a grid over its rectangle grown by `m` metres, every 2 m or less, as world points
export function footprint(type, x, z, yaw, m = MARGIN) {
  const v = VEHICLES[type], c = Math.cos(yaw), sn = Math.sin(yaw);
  const hl = v.len / 2 + m, hw = v.wid / 2 + m;
  const nl = Math.max(1, Math.ceil(2 * hl / 2)), nw = Math.max(1, Math.ceil(2 * hw / 2)), out = [];
  for (let a = 0; a <= nl; a++) for (let b = 0; b <= nw; b++) {
    const u = -hl + 2 * hl * a / nl, w = -hw + 2 * hw * b / nw;
    out.push([x + u * c - w * sn, z + u * sn + w * c]);   // the nose is along (cos yaw, sin yaw), the right hand is (-sin yaw, cos yaw)
  }
  return out;
}

// the point (x, z) in the rectangle of a placed vehicle grown by `m`
function inside(v, x, z, m) {
  const c = Math.cos(v.yaw), sn = Math.sin(v.yaw), dx = x - v.x, dz = z - v.z;
  const u = dx * c + dz * sn, w = -dx * sn + dz * c, d = VEHICLES[v.type];
  return Math.abs(u) < d.len / 2 + m && Math.abs(w) < d.wid / 2 + m;
}

export function planVehicles(T, keep = {}, slots = SLOTS) {
  const obstacles = keep.obstacles || [], blockers = keep.blockers || [];
  const furniture = (T.furniture || []).filter(f => Number.isFinite(f.x) && Number.isFinite(f.z));
  const deck = []; for (let i = 0; i < T.N; i += 4) if (T.isBridge[i]) deck.push(i);
  // the banner flags that planSmall (src/venueExtras.js) puts along the start straight, right side, 8 m behind the wall
  const flags = [];
  for (let s = T.length - 120; s < T.length + 260; s += 16) { const i = Math.round(s / T.ds) % T.N; if (!T.isBridge[i]) { const q = trackPoint(T, s, T.wall[1][i] + 8); flags.push({ x: q.x, z: q.z }); } }
  const posts = [...flags, ...planMarshal(T, null, { obstacles, blockers }).posts, ...planMasts(T, blockers, obstacles)];   // the flags, the marshal posts and the floodlight masts, planned the way the scenery plans them
  const { cell, map } = T.segGrid;
  const placed = [];

  // the paddock lies inside the containment wall, behind the garages: there the test is the distance from the garage fronts instead
  const paddockOk = (x, z) => {
    let best = Infinity, j = 0;
    for (let i = 0; i < T.N; i++) { const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2; if (q < best) { best = q; j = i; } }
    return T.pitGarage[j] > 0 && -((x - T.x[j]) * T.nx[j] + (z - T.z[j]) * T.nz[j]) >= T.pitOut[j] + 2 + PADDOCK_MIN;
  };
  const pointFree = (x, z, paddock) => {
    if (paddock ? !paddockOk(x, z) : wallClearance(T, x, z) < WALL_MIN) return false;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = map.get((gx + a) + ',' + (gz + b));
      if (list) for (const n of list) if (segDist(x, z, T.segs[n]) < BARRIER_MIN) return false;
    }
    const r = entryRoadAt(T, x, z, 6);
    if (r) return false;
    for (const j of deck) if (Math.hypot(x - T.x[j], z - T.z[j]) < BRIDGE_MIN) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 1.5) return false;
    for (const o of obstacles) {
      const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
      if (Math.abs(a) < o.len / 2 + 8 && b > -(GAP + 2) && b < o.depth + 4) return false;   // the stand, its frontage with the fence, and its flanks
    }
    for (const f of furniture) if (Math.hypot(x - f.x, z - f.z) < FURNITURE_MIN) return false;
    for (const p of posts) if (Math.hypot(x - p.x, z - p.z) < 3.5) return false;   // (flags included)
    for (const v of placed) if (inside(v, x, z, VEHICLE_GAP)) return false;
    return true;
  };
  const slopeOk = (x, z, yaw, type) => {
    const v = VEHICLES[type], c = Math.cos(yaw), sn = Math.sin(yaw), h = (u, w) => T.groundAt(x + u * c - w * sn, z + u * sn + w * c);
    const l = v.len / 2, w = v.wid / 2;
    return Math.abs(h(l, 0) - h(-l, 0)) / v.len < 0.12 && Math.abs(h(0, w) - h(0, -w)) / v.wid < 0.15;
  };

  const out = [];
  slots.forEach((slot, k) => {
    const v = VEHICLES[slot.type], sg = slot.side ? 1 : -1;
    const slides = [0]; for (let m = 3; m <= slot.slide; m += 3) slides.push(m, -m);
    let found = null;
    for (const slide of slides) {
      const s = slot.s + slide, p = trackPoint(T, s, 0), i = p.i;
      const base = slot.behindPit ? T.pitOut[i] + 2 : slot.side === 0 && T.pitOut[i] > 0 ? Math.max(T.wall[0][i], T.pitOut[i] + 2) : T.wall[slot.side][i];
      if (slot.behindPit && !(T.pitGarage[i] > 0)) continue;   // the paddock lies behind the garages
      const seed = Math.floor(s) * 7 + k;
      const jitter = (hash(seed, 3) - 0.5) * 0.12;
      const turn = slot.turn * Math.PI / 180;
      for (const off of slot.offs) {
        // heading: with or against the traffic, turned towards the track by `turn`, plus a little dither
        let f = [p.tx * slot.face, p.tz * slot.face];
        if (slot.behindPit) {   // parallel to the garage fronts, which part from the track a little along the pit straight
          const a = trackPoint(T, s - 8, 0), b = trackPoint(T, s + 8, 0), ia = a.i, ib = b.i;
          const ax = a.x + a.nx * -T.pitOut[ia], az = a.z + a.nz * -T.pitOut[ia], bx = b.x + b.nx * -T.pitOut[ib], bz = b.z + b.nz * -T.pitOut[ib], l = Math.hypot(bx - ax, bz - az);
          f = [(bx - ax) / l * slot.face, (bz - az) / l * slot.face];
        }
        const toward = [-sg * p.nx, -sg * p.nz];
        const ang = turn * slot.face + jitter;
        const dx = f[0] * Math.cos(ang) + toward[0] * Math.sin(ang), dz = f[1] * Math.cos(ang) + toward[1] * Math.sin(ang);
        const yaw = Math.atan2(dz, dx);
        // lateral extent of the footprint across the road: half length along the road plus half width
        const rel = Math.abs(Math.sin(Math.atan2(dx * p.nx + dz * p.nz, dx * p.tx + dz * p.tz)));
        const ext = (v.len / 2) * rel + (v.wid / 2) * Math.sqrt(1 - rel * rel);
        const lat = base + (slot.behindPit ? PADDOCK_MIN + slot.behindPit + off + ext : off + ext + MARGIN);
        const q = trackPoint(T, s, sg * lat);
        const fp = footprint(slot.type, q.x, q.z, yaw);
        if (!slopeOk(q.x, q.z, yaw, slot.type)) continue;
        if (!fp.every(([x, z]) => pointFree(x, z, !!slot.behindPit))) continue;
        found = { type: slot.type, s, d: sg * lat, x: q.x, z: q.z, yaw, colourSeed: Math.floor(hash(seed, 11) * 1e6), label: slot.why };
        break;
      }
      if (found) break;
    }
    if (found) { placed.push(found); out.push(found); } else out.push({ type: slot.type, failed: true, label: slot.why, s: slot.s });
  });
  return out;
}
