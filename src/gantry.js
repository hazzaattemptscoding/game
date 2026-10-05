// The start / finish line: gantry over the straight, the painted chequered line and the grid boxes.
//
// The gantry stands 4 m outside the white lines (the legs are well clear of the pit wall, which is 13 m out) and
// everything on it is 6 m or more above the road, so a car, a mirror or a roll hoop can never touch it.
// Frame, in local axes: x along the direction of travel, y up from the road at the centre line, z to the right.

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit, sponsorRow, trackPoint } from './meshKit.js';

export const GANTRY_S = 2;          // metres past the start line, the lights hang just before it
export const GANTRY_CLEAR = 7.0;    // underside of the truss above the road
export const GANTRY_LOWEST = 6.25;  // lowest point of anything hanging from it (the lamp housing)
export const GANTRY_LEG = 4.0;      // legs stand this far outside the white line

const DECAL = 0.006;

// A flat quad facing +x or -x (dir), spanning z0..z1 and y0..y1, reading left to right for a viewer in front of it.
function faceX(kit, key, x, y0, y1, z0, z1, dir, vb = 0, vt = 1, u0 = 0, u1 = 1) {
  if (dir < 0) kit.quad(key, [x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
  else kit.quad(key, [x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
}

export function buildGantry(T, sponsorTex) {
  const g = new THREE.Group();
  const hw = T.halfWidth, span = hw + GANTRY_LEG;
  const c = trackPoint(T, GANTRY_S, 0), i = c.i;
  const roadY = T.groundAt(c.x, c.z, i);
  const kit = new Kit();
  const bankY0 = GANTRY_CLEAR, topY = GANTRY_CLEAR + 1.35, half = span + 0.7;

  // legs: a pair of columns each side, braced, on a concrete plinth cut down to the real ground
  for (const sd of [-1, 1]) {
    const z = sd * span, p = trackPoint(T, GANTRY_S, z);
    const base = T.groundAt(p.x, p.z, i) - roadY - 0.5;
    for (const dx of [-0.5, 0.5]) kit.column('steel', 0.4, 0.4, base, topY + 0.1, dx, z);
    kit.column('concrete', 1.8, 1.8, base, base + 0.9, 0, z);
    for (let y = base + 2.2; y < topY; y += 2.4) kit.box('steel', 1.0, 0.12, 0.12, 0, y, z);
    for (let y = base + 2.2, k = 0; y + 2.4 < topY + 0.2; y += 2.4, k++) {
      const len = Math.hypot(1.0, 2.4);
      kit.box('steel', 0.1, len, 0.1, 0, y + 1.2, z, 0, 0, 0, (k % 2 ? 1 : -1) * Math.atan2(1.0, 2.4));
    }
    // timing loop cabinet and a speaker on the inside face
    kit.box('housing', 0.5, 0.9, 0.35, 0.9, base + 1.6, z - sd * 0.1);
    kit.box('housing', 0.3, 0.3, 0.3, -0.7, topY - 1.0, z - sd * 0.5);
  }

  // truss between the legs: four chords, uprights and diagonals on both faces
  for (const x of [-0.55, 0.55]) for (const y of [bankY0 + 0.12, topY]) kit.box('steel', 0.2, 0.2, half * 2, x, y, 0);
  const bays = Math.round(half * 2 / 1.4), bay = half * 2 / bays;
  for (let k = 0; k <= bays; k++) {
    const z = -half + k * bay;
    for (const x of [-0.55, 0.55]) kit.box('steel', 0.1, topY - bankY0 - 0.12, 0.1, x, (topY + bankY0 + 0.12) / 2, z);
    kit.box('steel', 1.1, 0.1, 0.1, 0, topY, z);
    kit.box('steel', 1.1, 0.1, 0.1, 0, bankY0 + 0.12, z);
    if (k < bays) {
      const h = topY - bankY0 - 0.12, len = Math.hypot(bay, h), a = Math.atan2(bay, h) * (k % 2 ? 1 : -1);
      for (const x of [-0.55, 0.55]) kit.box('steel', 0.08, len, 0.08, x, (topY + bankY0 + 0.12) / 2, z + bay / 2, 0, 0, a);
    }
  }

  // timing banner on top: chequered ends and START / FINISH towards the grid, PowerMedia on the other face
  const bw = 8.6, by0 = topY + 0.35, by1 = by0 + 1.6;
  kit.box('steel', 0.22, by1 - by0 + 0.1, bw * 2 + 0.2, 0, (by0 + by1) / 2, 0);
  for (const z of [-bw + 0.5, -bw / 2, 0, bw / 2, bw - 0.5]) kit.box('steel', 0.2, by0 - topY, 0.18, 0, (topY + by0) / 2, z);
  faceX(kit, 'banner', -0.125, by0, by1, -bw, bw, -1);
  const [vb, vt] = sponsorRow(0);
  faceX(kit, 'sponsor', 0.125, by0, by1, -bw, bw, 1, vb, vt);
  // the top edge cap
  kit.box('steel', 0.36, 0.1, bw * 2 + 0.3, 0, by1 + 0.07, 0);

  // sponsor boards along both faces of the truss, either side of the lamp housing
  const rows = tex.MODERN_SPONSORS;
  const panels = [[-9.8, -4.9], [4.9, 9.8]];
  panels.forEach(([z0, z1], k) => {
    const [b0, t0] = sponsorRow(rows[(k + 1) % rows.length]);
    faceX(kit, 'sponsor', -0.68, bankY0 + 0.25, topY - 0.1, z0, z1, -1, b0, t0);
  });
  [[-9.8, -5], [-4.8, 0], [0.2, 5], [5.2, 9.8]].forEach(([z0, z1], k) => {
    const [b0, t0] = sponsorRow(rows[(k + 4) % rows.length]);
    faceX(kit, 'sponsor', 0.68, bankY0 + 0.25, topY - 0.1, z0, z1, 1, b0, t0);
  });

  // lamp housing: one long black bar on the grid side of the truss, five modules, two lamps in each
  const hy = 6.75;
  kit.box('housing', 0.62, 1.0, 8.8, -0.95, hy, 0);
  const lamp = new THREE.CircleGeometry(0.18, 20);
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const z = (k - 2) * 1.6;
    kit.box('housing', 0.14, 0.92, 1.3, -1.33, hy, z);
    const pair = [];
    for (const y of [-0.24, 0.24]) {
      const m = new THREE.Mesh(lamp, new THREE.MeshStandardMaterial({ color: 0x5a0f0f, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.4 }));
      m.position.set(-1.405, hy + y, z);
      m.rotation.y = -Math.PI / 2;
      g.add(m);
      pair.push(m);
      kit.box('housing', 0.12, 0.03, 0.46, -1.45, hy + y + 0.2, z);
    }
    lights.push(pair);
  }
  // two camera pods on the roof side of the lamp housing ends
  for (const z of [-4.9, 4.9]) kit.box('housing', 0.4, 0.4, 0.4, -0.85, hy + 0.7, z);

  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.55 });
  const mats = {
    steel,
    housing: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.55, metalness: 0.2 }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.9 }),
    banner: new THREE.MeshStandardMaterial({ map: tex.gantryBannerTexture(), roughness: 0.5 }),
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.5 }),
  };
  const body = kit.build(mats);
  body.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  g.add(body);
  g.userData.lights = lights;
  g.userData.bounds = { s: GANTRY_S, span, legs: [-span, span], clear: GANTRY_LOWEST };
  g.position.set(c.x, roadY, c.z);
  g.rotation.y = -Math.atan2(c.tz, c.tx);
  for (const l of lights) for (const m of l) m.castShadow = false;
  return g;
}

// ---------------------------------------------------------------------------
// Paint: the chequered start line and the grid boxes, as flat decals following the road.

class Paint {
  constructor(T) { this.T = T; this.pos = []; this.uv = []; this.ind = []; }
  // the rectangle s0..s1 along, d0..d1 across (d positive right), cut every metre along the road. uv in metres / tile.
  rect(s0, s1, d0, d1, tile = 0) {
    const { T } = this;
    const steps = Math.max(1, Math.ceil((s1 - s0) / 1.0));
    for (let k = 0; k <= steps; k++) {
      const s = s0 + (s1 - s0) * k / steps;
      for (const d of [d0, d1]) {
        const p = trackPoint(T, s, d);
        this.pos.push(p.x, T.groundAt(p.x, p.z, p.i) + DECAL, p.z);
        this.uv.push(tile ? (d - d0) / tile : 0, tile ? (s - s0) / tile : 0);
      }
    }
    const base = this.pos.length / 3 - (steps + 1) * 2;
    for (let k = 0; k < steps; k++) {
      const a = base + k * 2;
      this.ind.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  geometry() {
    // indices were built for the winding of a quad whose first edge runs across; flip any triangle facing down
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const idx = this.ind.slice(), p = this.pos;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
      if (uz * vx - ux * vz < 0) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

const off = f => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f * 2 });

// The painted start line (a 0.9 m chequered band, edge to edge) and the grid: 12 boxes, front line plus two side lines,
// staggered left and right 8 m apart on the same slots the cars are placed on.
export function buildStartPaint(T) {
  const g = new THREE.Group(), hw = T.halfWidth;
  const line = new Paint(T), cheq = new Paint(T);
  cheq.rect(0, 0.9, -hw, hw, 0.9);
  for (let slot = 0; slot < 12; slot++) {
    const s = -10 - slot * 8, d = (slot % 2 ? 1 : -1) * 3, w = 1.15;
    line.rect(s - 0.16, s, d - w, d + w);                  // front bar
    line.rect(s - 5.6, s, d - w, d - w + 0.14);            // side bars
    line.rect(s - 5.6, s, d + w - 0.14, d + w);
    line.rect(s - 5.6, s - 5.44, d - w, d + w);            // closing bar behind
  }
  const a = new THREE.Mesh(line.geometry(), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, ...off(-3) }));
  const b = new THREE.Mesh(cheq.geometry(), new THREE.MeshStandardMaterial({ map: tex.chequerTexture(), roughness: 0.6, ...off(-4) }));
  a.userData.debug = b.userData.debug = 'line';
  a.receiveShadow = b.receiveShadow = true;
  g.add(a, b);
  return g;
}
