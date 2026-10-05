// Draw call and triangle cuts for the static world, built once after the world is made. Nothing is removed or moved: the originals stay
// in the scene, hidden, and `set(false)` swaps them back (the report tool wants the real objects to pick and measure).
//
//  1. Chunking. The ribbons along the lap (grass, gravel, run-off, kerbs, walls, the terrain) and the long runs of instanced tyres, posts
//     and trees are each one object about 4 km long, so the frustum test could never drop any of it and the sun shadow pass drew all of
//     it too. Each is cut into pieces on a square grid, sharing the material, so a view only draws the pieces it can see. The grid grows
//     for light geometry (a piece should carry thousands of triangles, or it costs more in draw calls than it saves).
//  2. Batching. Hundreds of small separate meshes (posts, signs, cones, stand parts) are merged per material and grid cell.
//  3. `propCuller` hides small instanced props (crowds, trees, bins) beyond a distance on the lower graphics tiers.
//
// Materials are shared, so wet roads, lamp levels, flags and the Blockout and debug views carry on working on the pieces.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SKIP = new Set(['rain']);   // userData.debug values of the dynamic effects

// what a render needs from one object, copied to its replacement
function copyProps(from, to) {
  to.name = from.name; to.userData = { ...from.userData };
  to.castShadow = from.castShadow; to.receiveShadow = from.receiveShadow; to.renderOrder = from.renderOrder;
  to.layers.mask = from.layers.mask;
}

const category = o => { for (let p = o; p; p = p.parent) if (p.userData.debug) return p.userData.debug; return ''; };

// A grid size for points with a weight each (triangles): from `base` up by half again until a used cell holds `target` on average.
function pickCell(xs, zs, weight, base, target, max) {
  let cell = base;
  for (;;) {
    const used = new Set();
    for (let i = 0; i < xs.length; i++) used.add(Math.floor(xs[i] / cell) * 65536 + Math.floor(zs[i] / cell));
    if (weight / used.size >= target || cell >= max) return cell;
    cell *= 1.5;
  }
}

function splitMesh(mesh, o) {
  const g = mesh.geometry;
  if (!g.index || g.groups.length || !g.attributes.position || Array.isArray(mesh.material)) return null;
  const nTri = g.index.count / 3;
  if (nTri < o.minTris) return null;
  g.computeBoundingSphere();
  if (g.boundingSphere.radius < o.minRadius) return null;
  for (const k in g.attributes) if (!g.attributes[k].array || g.attributes[k].isInterleavedBufferAttribute) return null;
  const pos = g.attributes.position, ix = g.index.array;
  const cx = new Float32Array(nTri), cz = new Float32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2];
    cx[t] = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3; cz[t] = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
  }
  const cell = pickCell(cx, cz, nTri, o.cell, o.meshTarget, o.maxCell), buckets = new Map();
  for (let t = 0; t < nTri; t++) {
    const key = Math.floor(cx[t] / cell) * 65536 + Math.floor(cz[t] / cell);
    let list = buckets.get(key);
    if (!list) buckets.set(key, list = []);
    list.push(t);
  }
  if (buckets.size < 2) return null;
  const group = new THREE.Group();
  copyProps(mesh, group);
  const remap = new Int32Array(pos.count);
  for (const list of buckets.values()) {
    remap.fill(-1);
    let nv = 0;
    const order = [];
    for (const t of list) for (let k = 0; k < 3; k++) { const v = ix[t * 3 + k]; if (remap[v] < 0) { remap[v] = nv++; order.push(v); } }
    const sub = new THREE.BufferGeometry();
    for (const name in g.attributes) {
      const src = g.attributes[name], size = src.itemSize, arr = new src.array.constructor(nv * size);
      for (let i = 0; i < nv; i++) { const at = order[i] * size; for (let k = 0; k < size; k++) arr[i * size + k] = src.array[at + k]; }
      sub.setAttribute(name, new THREE.BufferAttribute(arr, size, src.normalized));
    }
    const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(list.length * 3);
    list.forEach((t, i) => { idx[i * 3] = remap[ix[t * 3]]; idx[i * 3 + 1] = remap[ix[t * 3 + 1]]; idx[i * 3 + 2] = remap[ix[t * 3 + 2]]; });
    sub.setIndex(new THREE.BufferAttribute(idx, 1));
    sub.computeBoundingSphere();
    const m = new THREE.Mesh(sub, mesh.material);
    copyProps(mesh, m);
    group.add(m);
  }
  return group;
}

function splitInstanced(im, o) {
  const n = im.count;
  if (n < o.minInstances) return null;
  const g = im.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3, e = im.instanceMatrix.array;
  const xs = new Float32Array(n), zs = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = e[i * 16 + 12]; zs[i] = e[i * 16 + 14]; }
  const cell = pickCell(xs, zs, n * tris, o.cell, o.instTarget, o.maxCell), buckets = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(xs[i] / cell) * 65536 + Math.floor(zs[i] / cell);
    let list = buckets.get(key);
    if (!list) buckets.set(key, list = []);
    list.push(i);
  }
  if (buckets.size < 2) return null;
  const group = new THREE.Group();
  copyProps(im, group);
  for (const list of buckets.values()) {
    const sub = new THREE.InstancedMesh(g, im.material, list.length);
    copyProps(im, sub);
    if (im.instanceColor) sub.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    list.forEach((i, k) => {
      sub.instanceMatrix.array.set(e.subarray(i * 16, i * 16 + 16), k * 16);
      if (im.instanceColor) sub.instanceColor.array.set(im.instanceColor.array.subarray(i * 3, i * 3 + 3), k * 3);
    });
    sub.instanceMatrix.needsUpdate = true;
    group.add(sub);
  }
  return group;
}

// Small plain meshes that can be merged: not transparent, not animated, not mirrored, a normal geometry.
function batchable(m, o) {
  if (m.isInstancedMesh || m.isSkinnedMesh || !m.visible || m.frustumCulled === false || m.userData.noMerge || SKIP.has(category(m))) return false;
  const g = m.geometry, mat = m.material;
  if (!g || !g.attributes.position || g.groups.length || Array.isArray(mat) || !mat || mat.transparent) return false;
  if (Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') || m.onBeforeRender !== THREE.Mesh.prototype.onBeforeRender) return false;
  if ((g.index ? g.index.count : g.attributes.position.count) / 3 > o.maxBatchTris) return false;
  for (const k in g.attributes) if (!g.attributes[k].array || g.attributes[k].isInterleavedBufferAttribute) return false;
  return m.matrixWorld.determinant() > 0;
}

const DEFAULTS = { cell: 320, maxCell: 1100, minTris: 2000, minRadius: 120, minInstances: 24, meshTarget: 3500, instTarget: 2500, batchCell: 400, maxBatchTris: 1500 };

// Returns { set(on), stats }. `root` is the world group; call it once the world is built and before env.registerWorld and the look is applied.
export function optimiseWorld(root, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = 'optimised';
  const hidden = [];
  const stats = { chunked: 0, instanced: 0, pieces: 0, batched: 0, merged: 0 };
  const swap = (orig, repl) => {
    // pieces are in the original's own coordinates, under the original's world matrix
    repl.matrixAutoUpdate = false; repl.matrix.copy(orig.matrixWorld);
    out.add(repl); hidden.push(orig);
  };

  // 1. big meshes and long runs of instances
  const found = [];
  root.traverse(m => { if (m.isMesh && m.visible && m.frustumCulled !== false && !SKIP.has(category(m))) found.push(m); });
  const left = [];
  for (const m of found) {
    const group = m.isInstancedMesh ? splitInstanced(m, o) : splitMesh(m, o);
    if (!group) { left.push(m); continue; }
    swap(m, group);
    stats[m.isInstancedMesh ? 'instanced' : 'chunked']++; stats.pieces += group.children.length;
  }

  // 2. small meshes merged per material and grid cell
  const buckets = new Map();
  for (const m of left) {
    if (!batchable(m, o)) continue;
    const g = m.geometry;
    g.computeBoundingSphere();
    const c = g.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
    const sig = Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize).join() + (g.index ? 'i' : 'n');
    const key = [m.material.uuid, m.castShadow, m.receiveShadow, m.renderOrder, m.layers.mask, category(m), sig, Math.floor(c.x / o.batchCell), Math.floor(c.z / o.batchCell)].join('|');
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = []);
    b.push(m);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map(m => { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return g; });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, list[0].material);
    copyProps(list[0], mesh);
    mesh.userData = { debug: category(list[0]) || undefined };
    if (!mesh.userData.debug) delete mesh.userData.debug;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
    for (const m of list) hidden.push(m);
    stats.batched += list.length; stats.merged++;
  }

  root.add(out);
  for (const m of hidden) m.visible = false;
  let on = true;
  return {
    stats, group: out,
    // false puts the real objects back (and takes the pieces out of the scene, so they cannot be picked); true the other way round
    set(v) {
      if (v === on) return;
      on = v;
      for (const m of hidden) m.visible = !v;
      if (v) root.add(out); else root.remove(out);
    },
  };
}

// The world never moves, so its matrices are worked out once and the per-frame update leaves them alone.
export function freezeWorld(root) {
  root.updateMatrixWorld(true);
  root.traverse(o => { o.matrixAutoUpdate = false; });
}

// Small instanced props (a crowd, trees, bushes, bins) disappear beyond `limit` metres from the camera. Cheap enough to run every few frames.
export function propCuller(root) {
  const props = [], c = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isInstancedMesh || !o.visible || o.frustumCulled === false || SKIP.has(category(o))) return;
    const g = o.geometry;
    if ((g.index ? g.index.count : g.attributes.position.count) / 3 > 400) return;   // only small things
    o.computeBoundingSphere();
    const s = o.boundingSphere;
    if (!s) return;
    c.copy(s.center).applyMatrix4(o.matrixWorld);
    props.push({ o, x: c.x, z: c.z, r: s.radius });
  });
  let last = -1;
  return {
    count: props.length,
    // limit in metres (Infinity shows everything). A prop shows while any part of it can be inside the limit.
    update(cam, limit) {
      if (limit === Infinity && last === Infinity) return;
      last = limit;
      const cx = cam.position.x, cz = cam.position.z;
      for (const p of props) {
        const show = Math.hypot(p.x - cx, p.z - cz) - p.r <= limit;
        if (p.o.visible !== show) p.o.visible = show;
      }
    },
  };
}
