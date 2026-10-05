// Small helpers for building scenery as a handful of merged meshes instead of thousands of loose ones.
// A Kit collects geometry under a material key; build() merges each key into one mesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as tex from './textures.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();

export class Kit {
  constructor() { this.parts = new Map(); }

  push(key, geo) {
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
    return geo;
  }

  // A box centred on (x, y, z), turned by rotY (and rotX / rotZ), with its texture coordinates in metres divided by `tile`
  // (so a concrete or brick texture keeps its scale on boxes of any size). tile = 0 keeps the plain 0..1 box mapping.
  box(key, w, h, d, x, y, z, rotY = 0, tile = 0, rotX = 0, rotZ = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    E.set(rotX, rotY, rotZ, 'YXZ');
    M4.compose(V.set(x, y, z), Q.setFromEuler(E), S.set(1, 1, 1));
    g.applyMatrix4(M4);
    if (tile) metreUV(g, tile);
    return this.push(key, g);
  }

  // a box between two y levels (y0 up to y1)
  column(key, w, d, y0, y1, x, z, rotY = 0, tile = 0) {
    return this.box(key, w, y1 - y0, d, x, (y0 + y1) / 2, z, rotY, tile);
  }

  // one flat quad from four points (counter-clockwise seen from the front), with uv corners
  quad(key, a, b, c, d, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const g = new THREE.BufferGeometry();
    const pos = [...a, ...b, ...c, ...d];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return this.push(key, g);
  }

  // merge everything. mats maps key to a material; opts: { cast, receive, debug }
  build(mats, opts = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, mats[key]);
      const o = { cast: true, receive: true, ...(opts[key] || {}) };
      mesh.castShadow = o.cast; mesh.receiveShadow = o.receive;
      if (opts.debug) mesh.userData.debug = opts.debug;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    return group;
  }
}

// texture coordinates from position and face direction, `tile` metres per texture repeat
export function metreUV(g, tile) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let k = 0; k < p.count; k++) {
    const ax = Math.abs(n.getX(k)), ay = Math.abs(n.getY(k)), az = Math.abs(n.getZ(k));
    if (ax >= ay && ax >= az) uv.setXY(k, p.getZ(k) / tile, p.getY(k) / tile);
    else if (ay >= az) uv.setXY(k, p.getX(k) / tile, p.getZ(k) / tile);
    else uv.setXY(k, p.getX(k) / tile, p.getY(k) / tile);
  }
  uv.needsUpdate = true;
}

// row of the sponsor atlas as [vBottom, vTop]
export function sponsorRow(row) {
  const rows = tex.SPONSORS.length;
  return [1 - (row + 1) / rows, 1 - row / rows];
}

// a vertical sponsor panel standing on the line from (x0, z0) to (x1, z1), y0 to y1, facing the side `face` (+1 or -1) of that line
export function sponsorPanel(kit, key, row, x0, z0, x1, z1, y0, y1, face = 1) {
  const [vb, vt] = sponsorRow(row);
  const uv = [[0, vb], [1, vb], [1, vt], [0, vt]];
  if (face > 0) kit.quad(key, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], uv);
  else kit.quad(key, [x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1], uv);
}

// a deterministic hash in 0..1
export function hash01(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A point relative to the track: s along the lap, d to the side (positive right). Returns world x, z and the unit tangent.
export function trackPoint(T, s, d) {
  const L = T.length, f = (((s % L) + L) % L) / T.ds, i0 = Math.floor(f) % T.N, i1 = (i0 + 1) % T.N, t = f - Math.floor(f);
  const nx = T.nx[i0] + (T.nx[i1] - T.nx[i0]) * t, nz = T.nz[i0] + (T.nz[i1] - T.nz[i0]) * t, m = Math.hypot(nx, nz) || 1;
  const x = T.x[i0] + (T.x[i1] - T.x[i0]) * t + nx / m * d, z = T.z[i0] + (T.z[i1] - T.z[i0]) * t + nz / m * d;
  return { x, z, i: Math.round(f) % T.N, tx: nz / m, tz: -nx / m, nx: nx / m, nz: nz / m };
}
