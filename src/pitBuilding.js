// The pit building: which stretch of the pit lane has garages (garageBay, used by trackMesh.js for the walls and roof),
// and the detail on it: garage numbers over the doors, a roof parapet and rooftop plant.

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit } from './meshKit.js';

const H = 9.5;   // roof height above the ground, as drawn in trackMesh.js

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

export function buildPitDetail(T, ground) {
  const g = new THREE.Group(), bay = garageBay(T);
  if (bay.length < 20) return g;
  const kit = new Kit();
  const front = i => -(T.pitOut[i] + 2), back = i => front(i) - 14;
  const wp = (i, d) => [T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d];
  const y = (i, d) => { const [x, z] = wp(i, d); return T.groundAt(x, z, i); };

  // a number plate on the band over every second door (doors are 3.5 m wide in garageTexture, 14 m to a tile from s = 0)
  const first = bay[0], sFirst = T.s[first];
  for (let k = 0; ; k++) {
    const s = Math.ceil(sFirst / 14) * 14 + 3.5 + k * 7, i = bay.find(j => T.s[j] >= s);
    if (i === undefined || bay[bay.length - 1] - i < 6) break;
    const n = (k + 1) % 32, col = n % 8, row = Math.floor(n / 8);
    const u0 = col / 8, u1 = (col + 1) / 8, v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
    const d = front(i) + 0.06, [x, z] = wp(i, d), base = y(i, d);
    const tx = T.tx[i], tz = T.tz[i], hw = 0.7, y0 = base + 5.7, y1 = base + 6.4;
    // facing the track (towards +d): normal along +n; reads left to right seen from the lane
    kit.quad('number', [x - tx * hw, y0, z - tz * hw], [x + tx * hw, y0, z + tz * hw], [x + tx * hw, y1, z + tz * hw], [x - tx * hw, y1, z - tz * hw], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  // roof parapet along the front edge, and rooftop plant every 28 m
  for (let k = 2; k < bay.length - 2; k += 3) {
    const i = bay[k], j = bay[k + 1];
    const [xa, za] = wp(i, front(i) + 2.5), [xb, zb] = wp(j, front(j) + 2.5);
    const ya = y(i, front(i) + 2.5) + H, yb = y(j, front(j) + 2.5) + H;
    const len = Math.hypot(xb - xa, zb - za) + 0.05, yaw = Math.atan2(-(zb - za), xb - xa);
    kit.box('parapet', len, 0.45, 0.2, (xa + xb) / 2, (ya + yb) / 2 + 0.22, (za + zb) / 2, yaw);
  }
  for (let k = 12; k < bay.length - 12; k += 28) {
    const i = bay[k], d = (front(i) + back(i)) / 2, [x, z] = wp(i, d), base = y(i, d) + H;
    const yaw = -Math.atan2(T.tz[i], T.tx[i]);
    kit.box('plant', 4.2, 1.5, 2.2, x, base + 0.75, z, yaw);
    kit.box('plant', 1.4, 1.0, 1.4, x + T.tx[i] * 4, base + 0.5, z + T.tz[i] * 4, yaw);
    kit.box('dark', 3.0, 0.3, 3.0, x - T.tx[i] * 4, base + 0.15, z - T.tz[i] * 4, yaw);
  }
  const mats = {
    number: new THREE.MeshStandardMaterial({ map: tex.numberSheet(), roughness: 0.6 }),
    parapet: new THREE.MeshStandardMaterial({ color: 0xcfcdc6, roughness: 0.8 }),
    plant: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.6, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 }),
  };
  for (const k of ['parapet', 'plant']) mats[k].userData.wet = 'surface';   // darker and glossier in the rain (src/environment.js)
  const mesh = kit.build(mats);
  mesh.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  g.add(mesh);
  return g;
}
