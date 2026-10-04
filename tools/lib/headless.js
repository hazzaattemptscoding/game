// Builds the real track geometry without a browser, and answers "what is under this point?"
// Used by tools/bumps.js and tools/surfaces.js.
//
// Textures draw to a canvas, so a do-nothing canvas stands in for it here. Only the
// triangles that face up are kept, bucketed in a grid, so a query costs a few triangle tests.

import * as THREE from 'three';

const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (_, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern'
    ? () => ({ addColorStop: noop }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : noop),
  set: () => true,
});
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctxProxy, style: {} }) };

// the categories (set in trackMesh.js and scenery.js) that make up the ground you drive on
export const GROUND = ['road', 'line', 'kerb', 'sausage', 'apron', 'concrete', 'rumble', 'gravel', 'grass', 'pit', 'island', 'terrain'];

export async function buildWorld() {
  const { buildTrack } = await import('../../src/track.js');
  const { buildTrackScene } = await import('../../src/trackMesh.js');
  const { createGround, buildScenery } = await import('../../src/scenery.js');
  const T = buildTrack();
  const ground = createGround(T);
  const terrain = ground.mesh();
  terrain.userData.debug = 'terrain';
  const trackScene = buildTrackScene(T, ground);
  const scenery = buildScenery(T, ground);
  const root = new THREE.Group();
  root.add(terrain, trackScene, scenery);
  root.updateMatrixWorld(true);
  return { T, ground, root, terrain, trackScene, scenery };
}

const CELL = 4;
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

export function surfaceIndex(root, cats = GROUND) {
  const grid = new Map(), tris = [];
  root.traverse(m => {
    if (!m.isMesh || !cats.includes(m.userData.debug)) return;
    const g = m.geometry, p = g.attributes.position, ix = g.index;
    const n = ix ? ix.count : p.count;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, ix ? ix.getX(t + k) : t + k).applyMatrix4(m.matrixWorld);
      const ux = v[1].x - v[0].x, uz = v[1].z - v[0].z, wx = v[2].x - v[0].x, wz = v[2].z - v[0].z;
      const area = ux * wz - uz * wx;                       // twice the plan-view area; ~0 for walls
      if (Math.abs(area) < 1e-6) continue;
      const id = tris.length;
      tris.push({ cat: m.userData.debug, a: v[0].clone(), b: v[1].clone(), c: v[2].clone(), area });
      const x0 = Math.min(v[0].x, v[1].x, v[2].x), x1 = Math.max(v[0].x, v[1].x, v[2].x);
      const z0 = Math.min(v[0].z, v[1].z, v[2].z), z1 = Math.max(v[0].z, v[1].z, v[2].z);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const k = key(cx, cz);
          (grid.get(k) || grid.set(k, []).get(k)).push(id);
        }
    }
  });
  // every up-facing surface under (x, z), highest first: [{cat, y}]. eps < 0 counts a point on a shared
  // edge as inside; eps > 0 only counts points clearly inside a triangle.
  const at = (x, z, eps = -1e-6) => {
    const out = [], list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return out;
    for (const id of list) {
      const t = tris[id], { a, b, c, area } = t;
      const w1 = ((x - a.x) * (c.z - a.z) - (z - a.z) * (c.x - a.x)) / area;
      const w2 = ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) / area;
      const w0 = 1 - w1 - w2, e = eps;
      if (w0 < e || w1 < e || w2 < e) continue;
      out.push({ cat: t.cat, y: w0 * a.y + w1 * b.y + w2 * c.y });
    }
    return out.sort((p, q) => q.y - p.y);
  };
  return { at, count: tris.length };
}
