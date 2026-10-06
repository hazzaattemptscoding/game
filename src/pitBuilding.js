// The pit building: which stretch of the pit lane has garages (garageBay), and the building itself, drawn here as a few merged
// meshes: a roller door and team board for every bay (some doors open on a lit garage), a glazed first floor under a roof canopy
// that reaches over the apron, a roof terrace with a railing and plant, end walls (the start end has a glass corner, a stair head
// and the LAKESIDE sign) and a back wall. Local frame: u metres along the lap from the first bay sample, f metres from the front face
// (positive towards the track, the back wall at -14), h metres above the ground at the front face.

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit, hash01 } from './meshKit.js';
import { lampMaterial } from './lamps.js';


function runsOf(N, test) {
  let start = 0;
  while (start < N && test(start)) start++;
  if (start === N) return [Array.from({ length: N + 1 }, (_, i) => i % N)];
  const out = []; let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (test(i)) (cur ||= []).push(i); else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// The sample indices the garage block stands on. The block stops short of the bridge: its roof is level with the deck,
// so nothing of it may stand under or beside the deck.
export function garageBay(T) {
  const garageRun = runsOf(T.N, i => T.pitGarage[i] > 0)[0];
  if (!garageRun) return [];
  const mid = Math.floor(garageRun.length / 2);
  let bay = garageRun.slice(Math.max(0, mid - 63), mid + 64);
  const deck = [];
  for (let i = 0; i < T.N; i++) if (T.isBridge[i]) deck.push(i);
  const hitsDeck = i => [T.pitOut[i] + 2, T.pitOut[i] + 16].some(d => deck.some(j => Math.hypot(T.x[i] - T.nx[i] * d - T.x[j], T.z[i] - T.nz[i] * d - T.z[j]) < T.wall[0][j] + 14));
  const cut = bay.findIndex(hitsDeck);
  if (cut >= 0) bay = bay.slice(0, Math.max(0, cut));
  return bay;
}

const DEPTH = 14, DOOR_H = 3.9, FLOOR1 = 5.0, SLAB = 5.6, ROOF = 9.5, DECK = 9.1, CANOPY = 2.4, REC = 5.2;

// sheet regions of tex.pitFacadeTexture(), as [u0, v0, u1, v1] (inset a little so mip levels do not bleed)
const px = (x0, y0, x1, y1) => [(x0 + 2) / 1024, 1 - (y1 - 2) / 512, (x1 - 2) / 1024, 1 - (y0 + 2) / 512];
const DOORS = [px(0, 0, 256, 256), px(256, 0, 512, 256)], SIGN = px(512, 0, 1024, 128);
const TEAM = k => px((k % 8) * 128, 256, (k % 8) * 128 + 128, 512);

export function buildPitDetail(T, ground) {
  const g = new THREE.Group(), bay = garageBay(T);
  if (bay.length < 20) return g;
  const kit = new Kit();
  const n = bay.length - 1, Lb = T.s[bay[n]] - T.s[bay[0]], du = Lb / n;

  // the frame at u: world position of the front face line, unit tangent and normal (pointing to the track)
  const frame = u => {
    const q = u / du, k = Math.max(0, Math.min(n - 1, Math.floor(q))), t = q - k, i = bay[k], j = bay[k + 1];
    const L = a => a[i] + (a[j] - a[i]) * t;
    let nx = L(T.nx), nz = L(T.nz); const m = Math.hypot(nx, nz); nx /= m; nz /= m;
    return { x: L(T.x), z: L(T.z), nx, nz, tx: nz, tz: -nx, fr: -(L(T.pitOut) + 2), i };
  };
  const at = (u, f, o = 0) => { const q = frame(u); return [q.x + q.nx * (q.fr + f) + q.tx * o, q.z + q.nz * (q.fr + f) + q.tz * o, q.i]; };
  const ground0 = u => { const [x, z, i] = at(u, 0); return T.groundAt(x, z, i); };
  const floorY = new Map();
  const flo = u => { const key = Math.round(u * 4); if (!floorY.has(key)) floorY.set(key, ground0(key / 4)); return floorY.get(key); };
  const pt = (u, f, h, o = 0) => { const [x, z] = at(u, f, o); return [x, flo(u) + h, z]; };

  // a box between u0 and u1 (along the lap), f0 and f1 (across), h0 and h1 (height), following the slope of the ground
  const bar = (key, u0, u1, f0, f1, h0, h1, tile = 0) => {
    const fc = (f0 + f1) / 2, [xa, za] = at(u0, fc), [xb, zb] = at(u1, fc), len = Math.hypot(xb - xa, zb - za);
    const ya = flo(u0), yb = flo(u1);
    kit.box(key, len + (len > 1 ? 0.1 : 0), h1 - h0, f1 - f0, (xa + xb) / 2, (ya + yb) / 2 + (h0 + h1) / 2, (za + zb) / 2, -Math.atan2(zb - za, xb - xa), tile, 0, Math.atan2(yb - ya, len));
  };
  // the same, cut into pieces of about 4 m so a long run follows the bend
  const run = (key, u0, u1, f0, f1, h0, h1, tile = 0) => {
    const c = Math.max(1, Math.ceil((u1 - u0) / 4));
    for (let k = 0; k < c; k++) bar(key, u0 + (u1 - u0) * k / c, u0 + (u1 - u0) * (k + 1) / c, f0, f1, h0, h1, tile);
  };
  // a box centred at (u, f), w along the lap and d across
  const post = (key, u, f, w, d, h0, h1) => {
    const q = frame(u), [x, z] = at(u, f);
    kit.box(key, w, h1 - h0, d, x, flo(u) + (h0 + h1) / 2, z, -Math.atan2(q.tz, q.tx));
  };
  // a flat quad facing `want` (a world direction); a, b, c, d as seen from the front, left to right, bottom then top
  const quad = (key, a, b, c, d, uv, want) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const [u0, v0, u1, v1] = uv, tc = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    if (nrm[0] * want[0] + nrm[1] * want[1] + nrm[2] * want[2] < 0) kit.quad(key, a, d, c, b, [tc[0], tc[3], tc[2], tc[1]]);
    else kit.quad(key, a, b, c, d, tc);
  };
  // a quad on the front side (facing the track) between u0 and u1, h0 and h1, f across
  const face = (key, u0, u1, f, h0, h1, uv) => {
    const q = frame((u0 + u1) / 2);
    quad(key, pt(u0, f, h0), pt(u1, f, h0), pt(u1, f, h1), pt(u0, f, h1), uv, [q.nx, 0, q.nz]);
  };

  const U0 = 0.4, U1 = Lb - 0.4;
  const NB = Math.max(4, Math.round(Lb / 7)), pitch = Lb / NB, DW = Math.min(5.4, pitch - 1.7);

  // ---- ground floor: piers between the doors, a header with the team boards, a roller door or a lit garage in every bay ----
  const piers = [];
  for (let b = 0; b <= NB; b++) piers.push([b === 0 ? U0 : (b - 0.5) * pitch + DW / 2, b === NB ? U1 : (b + 0.5) * pitch - DW / 2]);
  for (const [a, b] of piers) {
    bar('render', a, b, -0.5, 0, -1, DOOR_H);
    bar('concrete', a, b, -0.5, 0.08, -1, 0.5, 6);
  }
  run('render', U0, U1, -0.5, 0, DOOR_H, FLOOR1);
  for (let b = 0; b < NB; b++) {
    const uc = (b + 0.5) * pitch, ua = uc - DW / 2, ub = uc + DW / 2, team = (b * 3 + 1) % 8;
    bar('dark', ua - 0.2, ua, -0.3, 0.1, 0, DOOR_H + 0.15);
    bar('dark', ub, ub + 0.2, -0.3, 0.1, 0, DOOR_H + 0.15);
    bar('dark', ua - 0.2, ub + 0.2, -0.3, 0.1, DOOR_H - 0.05, DOOR_H + 0.15);
    if (hash01(b, 7, 3) < 0.45) {
      // open: a recess with a team colour back wall, side walls, a ceiling with light strips, and the floor raised to the ground behind
      let lift = 0.04;
      for (const uu of [ua, uc, ub]) for (const f of [0, -2, -4, -REC]) { const [x, z, i] = at(uu, f); lift = Math.max(lift, T.groundAt(x, z, i) - flo(uc) + 0.03); }
      bar('concrete', ua, ub, -0.5, 0.3, -1, 0.04, 6);
      bar('dark', ua, ub, -REC, -0.2, lift - 0.3, lift);
      bar('dark', ua, ua + 0.1, -REC, -0.2, 0, DOOR_H);
      bar('dark', ub - 0.1, ub, -REC, -0.2, 0, DOOR_H);
      bar('dark', ua, ub, -REC - 0.1, -REC, 0, DOOR_H);
      face('pit', ua + 0.1, ub - 0.1, -REC + 0.02, lift, DOOR_H - 0.2, TEAM(team));
      bar('dark', ua, ub, -REC, -0.2, DOOR_H, DOOR_H + 0.1);
      for (const du2 of [-1.5, 1.5]) bar('lamp', uc + du2 - 0.15, uc + du2 + 0.15, -REC + 0.5, -0.9, DOOR_H - 0.07, DOOR_H);
      bar('lamp', ua + 0.4, ub - 0.4, -REC + 0.3, -REC + 0.5, DOOR_H - 0.07, DOOR_H);
    } else {
      face('pit', ua, ub, -0.15, 0.04, DOOR_H, DOORS[(b + (b >> 2)) & 1]);
    }
    // team board over the door, with the garage number on it
    face('pit', ua, ub, 0.05, DOOR_H + 0.15, FLOOR1 - 0.12, TEAM(team));
    const num = (b + 1) % 32, col = num % 8, row = Math.floor(num / 8);
    face('number', uc - 0.45, uc + 0.45, 0.09, DOOR_H + 0.2, DOOR_H + 0.95, [col / 8, 1 - (row + 1) / 4, (col + 1) / 8, 1 - row / 4]);
  }

  // ---- first floor: a band over the doors, glazing with mullions set back from it, a floor and a lit partition behind ----
  run('render', U0, U1, -0.5, 0.6, FLOOR1, SLAB);
  run('glass', U0, U1, -0.34, -0.3, SLAB, ROOF - 0.45);
  run('glass', U0, U1, -3.5, -3.46, SLAB, DECK);
  run('dark', U0, U1, -3.5, -0.3, SLAB - 0.15, SLAB - 0.02);
  for (const h of [SLAB, 7.2, ROOF - 0.6]) run('dark', U0, U1, -0.42, 0, h, h + 0.12);
  for (let u = U0; u <= U1 + 0.01; u += 2) post('dark', u, -0.2, 0.12, 0.5, SLAB, ROOF - 0.45);

  // ---- roof: a canopy over the apron, the deck, a paved terrace along the front with a railing, plant behind ----
  run('metal', 0, Lb, -0.5, CANOPY, ROOF - 0.45, ROOF);
  run('render', 0, Lb, CANOPY - 0.12, CANOPY, ROOF - 0.55, ROOF + 0.05);
  run('lamp', 1, Lb - 1, 1.4, 1.7, ROOF - 0.5, ROOF - 0.45);
  run('metal', 0, Lb, -DEPTH, -0.5, DECK, ROOF);
  run('render', 0.3, Lb - 0.3, -6, CANOPY - 0.12, ROOF, ROOF + 0.03);
  run('render', 0, Lb, -DEPTH, -DEPTH + 0.3, ROOF, ROOF + 0.5);
  for (const u of [0.15, Lb - 0.15]) {
    post('render', u, -10, 0.3, 8, ROOF, ROOF + 0.5);
    for (let f = -6; f <= CANOPY - 0.1; f += 2.1) post('dark', u, f, 0.07, 0.07, ROOF, ROOF + 1.1);
    post('dark', u, (CANOPY - 6) / 2, 0.06, CANOPY + 6, ROOF + 1.0, ROOF + 1.08);
    post('dark', u, (CANOPY - 6) / 2, 0.05, CANOPY + 6, ROOF + 0.55, ROOF + 0.6);
  }
  for (let u = 0.15; u <= Lb - 0.1; u += 2) post('dark', u, CANOPY - 0.1, 0.07, 0.07, ROOF, ROOF + 1.1);
  run('dark', 0.15, Lb - 0.15, CANOPY - 0.13, CANOPY - 0.07, ROOF + 1.0, ROOF + 1.08);
  run('dark', 0.15, Lb - 0.15, CANOPY - 0.12, CANOPY - 0.08, ROOF + 0.55, ROOF + 0.6);
  for (const u of [14, 42, 66].filter(u => u < Lb - 8)) {
    post('metal', u, -9.5, 4.2, 2.2, ROOF, ROOF + 1.5);
    post('metal', u + 4, -9.5, 1.4, 1.4, ROOF, ROOF + 1.0);
    post('metal', u - 3.5, -9.5, 0.7, 0.7, ROOF, ROOF + 2.2);
    post('dark', u - 5, -9.5, 3.0, 3.0, ROOF, ROOF + 0.3);
  }

  // ---- back wall: concrete between pilasters, with service doors ----
  run('concrete', U0, U1, -DEPTH, -DEPTH + 0.4, -1, DECK, 6);
  for (let u = 1; u < Lb; u += 8) post('render', u, -DEPTH - 0.1, 0.5, 0.6, -1, ROOF);
  for (let u = 5; u < Lb - 3; u += 17) { post('dark', u, -DEPTH - 0.12, 1.3, 0.1, 0, 2.3); post('render', u, -DEPTH - 0.1, 1.7, 0.08, 2.3, 2.45); }

  // ---- ends. The start end (u = 0) faces the start straight: a glass corner at the front, the sign above, a stair head on the roof ----
  post('render', 0.2, -DEPTH / 2, 0.4, DEPTH, -1, DECK);
  post('render', Lb - 0.2, -DEPTH / 2, 0.4, DEPTH, -1, DECK);
  run('glass', 0, 0.06, -6, -0.3, SLAB, ROOF - 0.45);
  for (let f = -6; f <= 0.01; f += 1.2) post('dark', 0.0, f, 0.4, 0.1, SLAB, ROOF - 0.45);
  for (const h of [SLAB, 7.2, ROOF - 0.6]) post('dark', 0.0, -3, 0.4, 6, h, h + 0.12);
  post('glass', 2.0, -3.15, 0.05, 5.7, SLAB, DECK);
  post('dark', 1.0, -3, 2.0, 5.7, SLAB - 0.15, SLAB - 0.02);
  const start = frame(0), want = [-start.tx, 0, -start.tz];
  quad('pit', pt(0, -13.6, 6.2, -0.03), pt(0, -6.4, 6.2, -0.03), pt(0, -6.4, 8.0, -0.03), pt(0, -13.6, 8.0, -0.03), SIGN, want);
  post('render', 2.1, -11.3, 4.2, 4.6, ROOF, ROOF + 3.1);
  post('render', 2.1, -11.3, 4.4, 4.8, ROOF + 3.1, ROOF + 3.25);
  post('glass', -0.02, -12.3, 0.06, 1.6, ROOF + 0.6, ROOF + 2.8);
  post('glass', 2.1, -8.97, 2.0, 0.06, ROOF + 0.6, ROOF + 2.8);
  // the far end: a plain wall with a fire door and a downpipe
  post('dark', Lb + 0.03, -10, 0.1, 1.4, 0, 2.3);
  post('metal', Lb + 0.1, -2, 0.16, 0.16, -0.5, DECK);

  const mats = {
    render: new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.85 }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), roughness: 0.9 }),
    pit: new THREE.MeshStandardMaterial({ map: tex.pitFacadeTexture(), roughness: 0.6, side: THREE.DoubleSide }),
    number: new THREE.MeshStandardMaterial({ map: tex.numberSheet(), roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.6, metalness: 0.4 }),
    glass: lampMaterial({ color: 0x50697a, emissive: 0xffd9a0, roughness: 0.2, metalness: 0.3 }, 1.4),
    lamp: lampMaterial({ color: 0xe9ecee, emissive: 0xfff2cf }, 5),
  };
  for (const k of ['render', 'concrete', 'metal']) mats[k].userData.wet = 'surface';   // darker and glossier in the rain (src/environment.js)
  const mesh = kit.build(mats);
  mesh.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  g.add(mesh);
  return g;
}
