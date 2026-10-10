// The pit area round the garages: the team stands on a gantry along the pit wall, the boards held out through the openings in its
// debris fence, and the service area on the left of the pit lane before the pit building (tyre fitting tent and racks, a weighbridge
// garage, marshal huts, lamp posts, signs, bollards, painted parking bays).
//
// planPitDressing() is numbers only (tools/venue.js checks them): every ground item stands beyond the low wall on the garage side of
// the lane (pitOut + PIT_APRON) and inside the containment wall; the gantry deck hangs over the edge of the fast lane, its underside
// GANTRY_CLEAR above the road, so the whole width of the lane stays open; a pit board reaches no more than BOARD_REACH past the
// wall's track face. The pit wall itself and its collision faces are not changed: the openings are in the debris fence above it.

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit, trackPoint, hash01 } from './meshKit.js';
import { garageBay } from './pitBuilding.js';
import { lampMaterial } from './lamps.js';
import { crowdMesh } from './crowd.js';
import { VEHICLE_ZONES } from './vehicleBays.js';

export const PIT_DRESS = {
  wallTop: 1.1,          // height of the pit wall (src/trackMesh.js draws it)
  wallThick: 0.6,        // its thickness (src/track.js PIT_WALL)
  deckY: 2.7,            // gantry deck top above the road
  deckUnder: 2.45,       // its underside: cars pass under the overhang
  deckOver: 1.3,         // how far the deck reaches over the lane from the wall's pit face
  boardReach: 1.0,       // a pit board reaches this far past the wall's track face
  apron: 2,              // the paved apron between the lane and the garage side low wall (src/track.js PIT_APRON)
  opening: 3,            // length of an opening in the debris fence, metres
};
const TEAM = ['#c8102e', '#1d4e9e', '#ffd21f', '#0e7c86', '#ff6a13', '#3f9d4f', '#8a5cd6', '#f2f2ee'];

const wrapS = (T, s) => ((s % T.length) + T.length) % T.length;

// The team stands (centre s of each) and the stretch of the gantry, opposite the garage block.
export function pitWallStands(T) {
  const bay = garageBay(T);
  if (bay.length < 20) return { from: 0, to: 0, stands: [] };
  const a = T.s[bay[0]], b = T.s[bay[bay.length - 1]], n = Math.max(3, Math.round((b - a) / 13)), pitch = (b - a) / n;
  const stands = [];
  for (let k = 0; k < n; k++) stands.push(a + (k + 0.5) * pitch);
  return { from: a - 1, to: b + 1, stands, pitch };
}

// the fence openings, as [s0, s1] along the lap (src/trackMesh.js leaves the debris fence out there)
export const fenceOpenings = T => pitWallStands(T).stands.map(s => [s - PIT_DRESS.opening / 2, s + PIT_DRESS.opening / 2]);

// Ground items on the left of the pit lane before the garages: { kind, s, d0, d1, len } with d measured outwards from the lane's outer
// edge (pitOut) and len along the lap; itemPoints() gives a footprint in world coordinates for the checks.
// The paddock zone (src/vehicleBays.js: the team transporters park there) starts PADDOCK_S metres before the garage block: the huts,
// the weighbridge garage and the tyre tent stand before it, and inside it there is only low kit within 16 m of the lane (lamp posts,
// signs, painted buggy bays, tyre stacks, fire points, bollards), which is not the paddock the vehicle plan uses.
export const PIT_BUILD_CLEAR = 3;   // a building keeps this far inside the containment wall
export function planPitDressing(T) {
  const items = [];
  const bay = garageBay(T);
  if (!bay.length) return { items, gantry: pitWallStands(T) };
  const zone = VEHICLE_ZONES.find(z => z.name === 'paddock'), z0 = zone.s0, garageS = T.s[bay[0]];
  const add = (kind, s, len, d0, d1) => {
    s = wrapS(T, s);
    for (const du of [-len / 2, 0, len / 2]) {
      const i = trackPoint(T, s + du, 0).i;
      if (!(T.pitOut[i] > 0) || T.wall[0][i] - T.pitOut[i] - d1 < PIT_BUILD_CLEAR) return;   // room inside the wall
    }
    items.push({ kind, s, len, d0, d1 });
  };
  // before the paddock zone, working back from it: the tyre tent, the weighbridge with its plate and bollards, a marshal hut, a sign
  add('tyrebay', z0 - 14, 22, 7, 16);
  add('weighbridge', z0 - 33, 10, 8, 16);
  add('plate', z0 - 33, 6, 4, 7.6);
  for (const u of [-5, -3, 3, 5]) add('bollard', z0 - 33 + u, 0.3, 3.4, 3.7);
  add('hut', z0 - 43, 2.6, 5, 7.6);
  add('sign', z0 - 49, 2, 4.2, 4.6);
  add('sign', z0 - 2, 2, 4.2, 4.6);
  // in the zone, up to the garages: low kit only
  const span = wrapS(T, garageS - 4 - z0);
  add('carts', z0 + 22, 14, 5, 9);
  for (const u of [45, 105]) add('stacks', z0 + u, 6, 4, 6);
  for (const u of [65, 125]) if (u < span) add('firepoint', z0 + u, 1, 4, 5);
  add('sign', z0 + 4, 2, 4.2, 4.6);
  for (let u = -51; u < span; u += 30) add('lamp', z0 + u, 0.5, 3.6, 4.1);
  return { items, gantry: pitWallStands(T), zone: z0, garageS };
}

// world footprint of an item (its corners and middle)
export function itemPoints(T, it) {
  const pts = [];
  for (const du of [-it.len / 2, 0, it.len / 2]) for (const dd of [it.d0, (it.d0 + it.d1) / 2, it.d1]) {
    const c = trackPoint(T, it.s + du, 0), i = c.i, p = trackPoint(T, it.s + du, -(T.pitOut[i] + dd));
    pts.push({ x: p.x, z: p.z, i, d: T.pitOut[i] + dd });
  }
  return pts;
}

function boardTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  ['P2  +1.4  L12', 'P5  -0.8  L12', 'BOX  BOX', 'P1  +3.2  L11'].forEach((t, k) => {
    x.fillStyle = '#101114'; x.fillRect(k * 128, 0, 128, 128);
    x.strokeStyle = '#ffd21f'; x.lineWidth = 4; x.strokeRect(k * 128 + 4, 4, 120, 120);
    x.fillStyle = k === 2 ? '#ff3b30' : '#ffd21f'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    t.split('  ').forEach((line, r, all) => x.fillText(line, k * 128 + 64, 64 + (r - (all.length - 1) / 2) * 34));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  ['WEIGHBRIDGE', 'TYRES', 'MARSHALS', 'NO ENTRY'].forEach((t, k) => {
    x.fillStyle = k === 3 ? '#c8102e' : '#0b3d91'; x.fillRect(k * 128, 0, 128, 128);
    x.strokeStyle = '#f2f2ee'; x.lineWidth = 4; x.strokeRect(k * 128 + 4, 4, 120, 120);
    x.fillStyle = '#f2f2ee'; x.font = `bold ${t.length > 8 ? 17 : 24}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(t, k * 128 + 64, 64);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const tile4 = k => [[k / 4, 0], [(k + 1) / 4, 0], [(k + 1) / 4, 1], [k / 4, 1]];

export function buildPitDressing(T, ground) {
  const g = new THREE.Group(), kit = new Kit(), people = [];
  const plan = planPitDressing(T), D = PIT_DRESS;
  // a frame on the left of the lap at s: x, z of the point d to the left, tangent (along the lap) and the left normal
  const F = (s, d) => { const p = trackPoint(T, s, -d); return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, lx: -p.nx, lz: -p.nz, i: p.i }; };
  const yaw = q => Math.atan2(-q.tz, q.tx);
  // a box centred on (s, d) with its length along the lap, `w` across, from y0 to y1 above the base height y
  const box = (key, s, d, len, w, y, y0, y1) => { const q = F(s, d); kit.box(key, len, y1 - y0, w, q.x, y + (y0 + y1) / 2, q.z, yaw(q)); };
  const cyl = (key, s, d, r, y, y0, y1, n = 10) => { const q = F(s, d), c = new THREE.CylinderGeometry(r, r, y1 - y0, n); c.translate(q.x, y + (y0 + y1) / 2, q.z); kit.push(key, c); };
  const roadY = s => { const q0 = F(s, 0), q = F(s, T.pitIn[q0.i] + 1); return T.groundAt(q.x, q.z, q.i); };   // the fast lane's surface

  // ---- the gantry along the pit wall, opposite the garages
  const G = plan.gantry;
  if (G.stands.length) {
    const len = G.to - G.from, n = Math.ceil(len / 3);
    for (let k = 0; k < n; k++) {
      const s0 = G.from + k * len / n, s1 = s0 + len / n, sm = (s0 + s1) / 2, i = F(sm, 0).i, pin = T.pitIn[i], y = roadY(sm);
      const dA = pin - D.wallThick + 0.45, dB = pin + D.deckOver;   // from just behind the debris fence to over the fast lane
      box('deck', sm, (dA + dB) / 2, s1 - s0 + 0.02, dB - dA, y, D.deckUnder, D.deckY);
      box('steel', sm, dB - 0.05, s1 - s0 + 0.02, 0.06, y, D.deckY + 1.0, D.deckY + 1.06);   // the rail on the lane side
      box('steel', sm, dB - 0.05, s1 - s0 + 0.02, 0.06, y, D.deckY + 0.5, D.deckY + 0.55);
    }
    for (let s = G.from; s <= G.to + 0.01; s += 6) {
      const i = F(s, 0).i, pin = T.pitIn[i], y = roadY(s);
      box('steel', s, pin - 0.2, 0.16, 0.16, y, D.wallTop, D.deckY + 2.5);                    // posts stand on the wall
      box('steel', s, pin + D.deckOver / 2 - 0.1, 0.12, D.deckOver + 0.3, y, D.deckUnder - 0.35, D.deckUnder - 0.2);   // brackets under the deck
    }
    G.stands.forEach((sc, k) => {
      const i = F(sc, 0).i, pin = T.pitIn[i], y = roadY(sc), w = G.pitch - 3.6, team = 'team' + (k % TEAM.length);
      const dDesk = pin - D.wallThick + 0.9, dSeat = pin + 0.5;
      // the awning over the stand in the team's colour, its fascia, and the desk with four screens
      box(team, sc, pin + D.deckOver / 2 - 0.1, w + 0.6, D.deckOver + 1.0, y, D.deckY + 2.45, D.deckY + 2.6);
      box(team, sc, pin - D.wallThick + 0.35, w + 0.6, 0.06, y, D.deckY + 2.0, D.deckY + 2.45);
      box('white', sc, dDesk, w, 0.6, y, D.deckY, D.deckY + 0.8);
      for (let m = 0; m < 4; m++) {
        const su = sc - w / 2 + (m + 0.5) * w / 4;
        box('dark', su, dDesk - 0.05, 0.62, 0.06, y, D.deckY + 0.85, D.deckY + 1.3);
        box('screen', su, dDesk - 0.09, 0.56, 0.02, y, D.deckY + 0.88, D.deckY + 1.27);   // lit face to the track
        box('screen', su, dDesk - 0.01, 0.56, 0.02, y, D.deckY + 0.88, D.deckY + 1.27);   // and to the seat
      }
      // the crew on the stand, a fire bottle at its end
      for (let m = 0; m < 3; m++) {
        if (hash01(k, m, 5) > 0.8) continue;
        const q = F(sc - w / 3 + m * w / 3, dSeat);
        people.push([q.x, y + D.deckY, q.z, parseInt(TEAM[k % TEAM.length].slice(1), 16), hash01(k, m, 7), false]);
      }
      cyl('red', sc + w / 2 - 0.3, pin + 0.6, 0.12, y, D.deckY, D.deckY + 0.55, 8);
      // the pit board held out through the opening in the fence, on a pole from the deck, facing the cars coming down the straight
      const wallFace = pin - D.wallThick, out = wallFace - D.boardReach;
      const a = F(sc, pin), b = F(sc, out + 0.1), ya = y + D.deckY + 0.6, yb = y + D.wallTop + 1.0;
      const L = Math.hypot(b.x - a.x, b.z - a.z, yb - ya);
      const pole = new THREE.BoxGeometry(0.05, 0.05, L);
      pole.lookAt(new THREE.Vector3(b.x - a.x, yb - ya, b.z - a.z));
      pole.translate((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2);
      kit.push('steel', pole);
      const c = F(sc, out + 0.1), hw = 0.55, x0 = c.x, z0 = c.z;
      const L1 = [x0 + c.lx * hw, z0 + c.lz * hw], R1 = [x0 - c.lx * hw, z0 - c.lz * hw];
      // facing back along the lap (towards the oncoming cars): seen from there the left of the lap is on the left
      kit.quad('board', [L1[0], yb - 0.9, L1[1]], [R1[0], yb - 0.9, R1[1]], [R1[0], yb, R1[1]], [L1[0], yb, L1[1]], tile4(k % 4));
    });
  }

  // ---- in front of the open garages: cable covers across the apron (flat, 4 cm)
  {
    const bay = garageBay(T);
    for (let k = 4; k < bay.length - 4; k += 7) {
      const s = T.s[bay[k]], i = bay[k], y = T.h[i];
      box('yellow', s, T.pitOut[i] + D.apron / 2, 0.4, D.apron - 0.2, y, 0, 0.04);
    }
  }

  // ---- the service area before the garages
  for (const it of plan.items) {
    const i = F(it.s, 0).i, po = T.pitOut[i], dm = po + (it.d0 + it.d1) / 2, dw = it.d1 - it.d0;
    const pts = itemPoints(T, it), y = Math.min(...pts.map(p => ground.surfaceHeight(p.x, p.z))) - 0.05;
    const B = (key, du, dd, len, w, y0, y1) => box(key, it.s + du, po + dd, len, w, y, y0, y1);
    if (it.kind === 'hut') {
      B('concrete', 0, (it.d0 + it.d1) / 2, it.len + 0.4, dw + 0.4, -0.5, 0.15);
      B('white', 0, (it.d0 + it.d1) / 2, it.len, dw, 0.15, 2.4);
      B('orange', 0, (it.d0 + it.d1) / 2, it.len + 0.5, dw + 0.5, 2.4, 2.6);
      B('glass', 0, it.d0 - 0.02, it.len - 0.6, 0.04, 1.1, 2.0);
      B('steel', it.len / 2 + 0.3, it.d0 + 0.2, 0.08, 0.08, 0, 4.2);
      B('yellow', it.len / 2 + 0.75, it.d0 + 0.2, 0.8, 0.03, 3.4, 3.95);
      const q = F(it.s + 0.6, po + it.d0 - 0.8);
      people.push([q.x, y + 0.05, q.z, 0xff6a13, 0.3, true]);
    } else if (it.kind === 'tyrebay') {
      // an open-sided tent with tyre racks under it and a fitting machine
      B('concrete', 0, (it.d0 + it.d1) / 2, it.len + 1, dw + 1, -0.5, 0.1);
      for (const du of [-it.len / 2, -it.len / 6, it.len / 6, it.len / 2]) for (const dd of [it.d0, it.d1]) B('steel', du, dd, 0.12, 0.12, 0.1, 3.4);
      B('tentWhite', 0, (it.d0 + it.d1) / 2, it.len + 0.4, dw + 0.6, 3.4, 3.55);
      B('team1', 0, it.d0 - 0.1, it.len + 0.4, 0.05, 2.9, 3.5);
      for (let r = 0; r < 3; r++) {
        const dd = it.d0 + 2.5 + r * 2.6;
        B('steel', 0, dd, it.len - 4, 0.9, 0.1, 0.18); B('steel', 0, dd, it.len - 4, 0.9, 1.15, 1.22);
        for (let m = 0; m < 12; m++) for (const lv of [0.18, 1.22]) {
          const su = it.s - it.len / 2 + 2.6 + m * (it.len - 5) / 11, q = F(su, po + dd), c = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 10);
          c.rotateX(Math.PI / 2); c.rotateY(yaw(q)); c.translate(q.x, y + lv + 0.34, q.z); kit.push('tyre', c);
        }
      }
      B('red', -it.len / 2 + 2, it.d1 - 1.2, 1.2, 1.0, 0.1, 1.2);
      for (let m = 0; m < 3; m++) { const q = F(it.s - 4 + m * 4, po + it.d0 + 1.2); people.push([q.x, y + 0.1, q.z, 0x2f3136, hash01(m, 4, 4), true]); }
    } else if (it.kind === 'weighbridge') {
      // the weighbridge garage: a box with a roller door facing the lane, a canopy over the door, a sign
      B('concrete', 0, (it.d0 + it.d1) / 2, it.len + 0.6, dw + 0.6, -0.5, 0.15);
      B('white', 0, (it.d0 + it.d1) / 2, it.len, dw, 0.15, 4.6);
      B('roof', 0, (it.d0 + it.d1) / 2, it.len + 0.4, dw + 0.4, 4.6, 4.85);
      B('dark', 0, it.d0 - 0.02, 5, 0.06, 0.15, 3.6);
      B('roof', 0, it.d0 - 1.0, 6.4, 2.0, 3.9, 4.05);
      const q = F(it.s, po + it.d0 - 0.06), hw = 1.6, yy = y + 4.0;
      kit.quad('sign', [q.x - q.tx * hw, yy, q.z - q.tz * hw], [q.x + q.tx * hw, yy, q.z + q.tz * hw], [q.x + q.tx * hw, yy + 0.6, q.z + q.tz * hw], [q.x - q.tx * hw, yy + 0.6, q.z - q.tz * hw], tile4(0));   // read from the lane: the lap runs left to right
    } else if (it.kind === 'plate') {
      // the weighing plate in front of the door: steel, with hazard striped edges
      B('steel', 0, (it.d0 + it.d1) / 2, it.len - 0.4, dw - 0.4, -0.2, 0.12);
      B('yellow', 0, it.d0 + 0.1, it.len, 0.2, -0.2, 0.13); B('yellow', 0, it.d1 - 0.1, it.len, 0.2, -0.2, 0.13);
    } else if (it.kind === 'carts') {
      // painted bays for the marshals' buggies and a charging post
      for (let m = 0; m <= 5; m++) B('white', -it.len / 2 + m * it.len / 5, (it.d0 + it.d1) / 2, 0.12, dw, 0.0, 0.05);
      B('white', 0, it.d0, it.len, 0.12, 0, 0.05);
      B('dark', it.len / 2 + 0.6, it.d1 - 0.5, 0.4, 0.3, 0, 1.4);
    } else if (it.kind === 'lamp') {
      cyl('steel', it.s, dm, 0.09, y, 0, 7.2, 6);
      B('steel', 0, (it.d0 + it.d1) / 2 - 0.7, 0.08, 1.5, 7.1, 7.18);
      B('lamp', 0, (it.d0 + it.d1) / 2 - 1.3, 0.34, 0.8, 7.0, 7.1);
    } else if (it.kind === 'sign') {
      B('steel', -0.7, (it.d0 + it.d1) / 2, 0.08, 0.08, 0, 2.4); B('steel', 0.7, (it.d0 + it.d1) / 2, 0.08, 0.08, 0, 2.4);
      const q = F(it.s, dm - 0.05), hw = 0.9, k = hash01(Math.round(it.s), 2) < 0.5 ? 1 : 2;
      kit.quad('sign', [q.x - q.tx * hw, y + 1.4, q.z - q.tz * hw], [q.x + q.tx * hw, y + 1.4, q.z + q.tz * hw], [q.x + q.tx * hw, y + 2.4, q.z + q.tz * hw], [q.x - q.tx * hw, y + 2.4, q.z - q.tz * hw], tile4(k));
    } else if (it.kind === 'stacks') {
      // the teams' spare tyres in stacks of five on a pallet, under covers in the team's colour on some
      B('steel', 0, (it.d0 + it.d1) / 2, it.len, dw, 0, 0.14);
      for (let m = 0; m < 6; m++) for (const dd of [it.d0 + 0.5, it.d1 - 0.5]) {
        const k = Math.round(it.s) + m, cover = hash01(k, dd > it.d0 + 1 ? 1 : 0, 8) < 0.4;
        cyl(cover ? 'team' + (k % TEAM.length) : 'tyre', it.s - it.len / 2 + 0.5 + m * (it.len - 1) / 5, po + dd, 0.34, y, 0.14, 1.5, 10);
      }
    } else if (it.kind === 'firepoint') {
      // a fire point: a red cabinet on two posts, two extinguishers on the ground
      B('steel', -0.3, it.d0 + 0.3, 0.06, 0.06, 0, 1.8); B('steel', 0.3, it.d0 + 0.3, 0.06, 0.06, 0, 1.8);
      B('red', 0, it.d0 + 0.45, 0.8, 0.35, 0.6, 1.7);
      cyl('red', it.s - 0.7, dm, 0.12, y, 0, 0.6, 8); cyl('red', it.s + 0.7, dm, 0.12, y, 0, 0.6, 8);
    } else if (it.kind === 'bollard') {
      cyl('yellow', it.s, dm, 0.1, y, 0, 1.0, 8);
      cyl('dark', it.s, dm, 0.105, y, 0.55, 0.75, 8);
    }
  }

  const team = Object.fromEntries(TEAM.map((c, k) => ['team' + k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide })]));
  const mats = {
    ...team,
    deck: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), color: 0xb8bcc0, roughness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.5, metalness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.5 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 }),
    tentWhite: new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.85, side: THREE.DoubleSide }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x26323c, roughness: 0.2, metalness: 0.3 }),
    lamp: lampMaterial({ color: 0xdfe3e6, emissive: 0xfff2cf }, 5),
    screen: lampMaterial({ color: 0x2a5d8f, emissive: 0x6fb2ff, roughness: 0.3 }, 1.2),
    board: new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.5, side: THREE.DoubleSide }),
    sign: new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6, side: THREE.DoubleSide }),
  };
  // the plain coloured parts share one vertex coloured material, so the whole dressing is a handful of draw calls
  const plain = [], shiny = [];
  for (const [key, list] of kit.parts) {
    const m = mats[key];
    if (m.map || m.emissive?.getHex() || key === 'glass') continue;
    const c = m.color;
    for (const geo of list) {
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      (m.metalness > 0.2 ? shiny : plain).push(geo);   // the metal parts (steel, roof) keep their look: a second material
      if (geo.attributes.uv) geo.deleteAttribute('uv');
    }
    kit.parts.delete(key);
  }
  if (plain.length) kit.parts.set('solid', plain);
  if (shiny.length) kit.parts.set('solidMetal', shiny);
  mats.solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  mats.solidMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.42 });
  for (const k of ['deck', 'concrete', 'solid', 'solidMetal']) mats[k].userData.wet = 'surface';
  const mesh = kit.build(mats, { debug: 'building' });
  g.add(mesh);
  const crew = crowdMesh(people);
  if (crew) g.add(crew);
  g.userData.plan = plan;
  return g;
}
