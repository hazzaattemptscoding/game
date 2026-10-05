// The start / finish line: gantry over the straight, the painted chequered line and the grid boxes.
//
// The gantry stands 4 m outside the white lines (the legs are well clear of the pit wall, which is 13 m out) and
// everything on it is 6 m or more above the road, so a car, a mirror or a roll hoop can never touch it.
// Frame, in local axes: x along the direction of travel, y up from the road at the centre line, z to the right.
//
// The main screen displays the PowerMedia video loop (3840 x 128, 30:1 aspect), letterboxed across the full width.
// A companion text board shows LAKESIDE START / FINISH in a bold condensed display font.
// The structure includes a deep truss, lighting rig, camera pods, and a catwalk along the top.

import * as THREE from 'three';
import { bannerVideo } from './bannerVideo.js';
import * as tex from './textures.js';
import { Kit, sponsorRow, trackPoint } from './meshKit.js';

export const GANTRY_S = 2;          // metres past the start line, the lights hang just before it
export const GANTRY_CLEAR = 7.0;    // underside of the truss above the road
export const GANTRY_LOWEST = 6.25;  // lowest point of anything hanging from it (the lamp housing)
export const GANTRY_LEG = 4.0;      // legs stand this far outside the white line

const DECAL = 0.006;


// Canvas texture with START / FINISH text in a bold condensed display font
function gantryTextTexture() {
  const c = document.createElement('canvas');
  c.width = 1920; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#1a1a1e';
  x.fillRect(0, 0, 1920, 512);
  x.fillStyle = '#ffd21f';
  x.font = 'italic 900 180px "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('LAKESIDE', 480, 256);
  x.fillText('START / FINISH', 1440, 256);
  x.fillStyle = 'rgba(255, 210, 31, 0.3)';
  x.strokeStyle = '#ffd21f';
  x.lineWidth = 3;
  x.strokeRect(20, 20, 880, 472);
  x.strokeRect(1020, 20, 880, 472);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  const bankY0 = GANTRY_CLEAR, topY = GANTRY_CLEAR + 2.4, half = span + 0.7;

  // legs: a pair of columns each side, braced on concrete plinths
  for (const sd of [-1, 1]) {
    const z = sd * span, p = trackPoint(T, GANTRY_S, z);
    const base = T.groundAt(p.x, p.z, i) - roadY - 0.5;
    for (const dx of [-0.6, 0.6]) kit.column('steel', 0.48, 0.48, base, topY + 0.2, dx, z);
    kit.column('concrete', 2.2, 2.2, base, base + 1.0, 0, z);
    // heavy cross-bracing on the legs: X-pattern with thicker diagonal members
    for (let y = base + 2.4; y < topY; y += 2.8) {
      kit.box('steel', 1.2, 0.14, 0.14, 0, y, z);
      const len = Math.hypot(1.2, 2.8);
      for (const sx of [-1, 1]) {
        kit.box('steel', 0.12, len, 0.12, sx * 0.6, y + 1.4, z, 0, 0, 0, sx * Math.atan2(1.2, 2.8));
      }
    }
    // timing loop cabinet and speaker mounted on the inside face
    kit.box('housing', 0.6, 1.0, 0.4, 1.1, base + 1.8, z - sd * 0.15);
    kit.box('housing', 0.35, 0.35, 0.35, -0.8, topY - 1.1, z - sd * 0.6);
  }

  // deep truss between the legs: outer and inner chords plus a center beam
  for (const x of [-0.65, 0, 0.65]) for (const y of [bankY0 + 0.15, topY]) {
    kit.box('steel', 0.24, 0.24, half * 2, x, y, 0);
  }
  // vertical uprights and diagonals in bay sections
  const bays = Math.round(half * 2 / 1.6), bay = half * 2 / bays;
  for (let k = 0; k <= bays; k++) {
    const z = -half + k * bay;
    for (const x of [-0.65, 0, 0.65]) {
      kit.box('steel', 0.12, topY - bankY0 - 0.15, 0.12, x, (topY + bankY0 + 0.15) / 2, z);
    }
    kit.box('steel', 1.3, 0.12, 0.12, 0, topY, z);
    kit.box('steel', 1.3, 0.12, 0.12, 0, bankY0 + 0.15, z);
    if (k < bays) {
      const h = topY - bankY0 - 0.15, len = Math.hypot(bay, h);
      for (const x of [-0.65, 0.65]) {
        kit.box('steel', 0.10, len, 0.10, x, (topY + bankY0 + 0.15) / 2, z + bay / 2, 0, 0, (k % 2 ? 1 : -1) * Math.atan2(bay, h));
      }
    }
  }

  // main screens and text board on top: PowerMedia video on front, START/FINISH text on back
  const sw = 10.0, sy0 = topY + 0.4, sy1 = sy0 + 1.2;
  kit.box('steel', 0.28, sy1 - sy0 + 0.12, sw * 2 + 0.25, 0, (sy0 + sy1) / 2, 0);
  for (const z of [-sw + 0.6, -sw / 2, 0, sw / 2, sw - 0.6]) kit.box('steel', 0.24, sy0 - topY, 0.22, 0, (topY + sy0) / 2, z);
  // back face: text panel
  faceX(kit, 'text', -0.16, sy0, sy1, -sw, sw, -1);
  // front face: will hold still board (video mesh added separately)
  faceX(kit, 'banner', 0.16, sy0, sy1, -sw, sw, 1, 0, 1);
  // top edge cap with detail
  kit.box('steel', 0.4, 0.12, sw * 2 + 0.35, 0, sy1 + 0.08, 0);
  kit.box('steel', 0.14, 0.08, sw * 2 + 0.25, 0, sy1 + 0.26, 0);

  // sponsor boards on both sides of the truss (visible from the sides)
  const rows = tex.MODERN_SPONSORS;
  const panels = [[-9.2, -4.6], [4.6, 9.2]];
  panels.forEach(([z0, z1], k) => {
    const [b0, t0] = sponsorRow(rows[(k + 1) % rows.length]);
    faceX(kit, 'sponsor', -0.8, bankY0 + 0.3, topY - 0.12, z0, z1, -1, b0, t0);
  });
  [[-9.2, -4.8], [-4.6, 0], [0.2, 4.8], [4.6, 9.2]].forEach(([z0, z1], k) => {
    const [b0, t0] = sponsorRow(rows[(k + 4) % rows.length]);
    faceX(kit, 'sponsor', 0.8, bankY0 + 0.3, topY - 0.12, z0, z1, 1, b0, t0);
  });

  // lighting rig: long bar on the grid side with five modules
  const hy = 7.0;
  kit.box('housing', 0.7, 1.15, 9.8, -1.1, hy, 0);
  const lamp = new THREE.CircleGeometry(0.22, 24);
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const z = (k - 2) * 1.9;
    kit.box('housing', 0.16, 1.05, 1.5, -1.5, hy, z);
    // structural pod frame
    kit.box('steel', 0.08, 0.7, 0.08, -0.9, hy - 0.3, z);
    const pair = [];
    for (const y of [-0.3, 0.3]) {
      const m = new THREE.Mesh(lamp, new THREE.MeshStandardMaterial({ color: 0x5a0f0f, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.4 }));
      m.position.set(-1.5, hy + y, z);
      m.rotation.y = -Math.PI / 2;
      g.add(m);
      pair.push(m);
      kit.box('housing', 0.14, 0.04, 0.54, -1.6, hy + y + 0.25, z);
    }
    lights.push(pair);
  }
  // camera pods: on the back of the lamp housing and on the wing positions
  for (const z of [-5.7, 0, 5.7]) kit.box('housing', 0.48, 0.48, 0.48, -1.0, hy + 0.9, z);
  // catwalk structure along the top of the truss
  kit.box('steel', 0.08, 0.05, sw * 2 + 0.4, 0, topY + 0.05, 0);
  for (let k = 0; k <= bays; k++) {
    const z = -half + k * bay;
    kit.box('steel', 0.08, 0.05, 0.16, 0, topY + 0.1, z);
  }

  // Build materials
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.52, metalness: 0.6 });
  const textMat = new THREE.MeshStandardMaterial({ map: gantryTextTexture(), roughness: 0.4 });
  const stillBannerMat = new THREE.MeshStandardMaterial({ map: tex.gantryBannerTexture(), roughness: 0.4, toneMapped: false });
  const mats = {
    steel,
    housing: new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.6, metalness: 0.15 }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.92 }),
    text: textMat,
    banner: stillBannerMat,
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.48 }),
  };
  const body = kit.build(mats);
  body.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  g.add(body);

  // Video screen: create a separate mesh for the PowerMedia video, layered over the still board
  // Build it the same way as bridge.js does: create geometry separately, add with video texture
  const videoGeom = new THREE.BufferGeometry();
  const pos = [0.16, sy0, -sw, 0.16, sy0, sw, 0.16, sy1, sw, 0.16, sy1, -sw];
  videoGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  videoGeom.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  videoGeom.setIndex([0, 1, 2, 0, 2, 3]);
  videoGeom.computeVertexNormals();

  const videoMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const videoTex = bannerVideo(() => {
    videoMesh.visible = true;
  });
  videoMat.map = videoTex || null;
  const videoMesh = new THREE.Mesh(videoGeom, videoMat);
  videoMesh.visible = false;
  videoMesh.userData.debug = 'building';
  g.add(videoMesh);

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
