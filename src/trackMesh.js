// Phase 1 test track: plain grey tarmac, kerbs, grass, barriers, the bridge
// and a terrain that follows the circuit. Scenery and proper materials come
// in phase 3.

import * as THREE from 'three';
import { wrap } from './track.js';

export function buildTrackScene(T) {
  const group = new THREE.Group();
  const all = [];
  for (let i = 0; i <= T.N; i++) all.push(wrap(i, T.N));

  const mat = {
    road: new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.92, map: noiseTexture(256, 70, 100, 6) }),
    line: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }),
    kerb: new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7 }),
    grass: new THREE.MeshStandardMaterial({ color: 0x5f8f45, roughness: 1, map: noiseTexture(256, 90, 120, 18) }),
    wall: new THREE.MeshStandardMaterial({ color: 0xb8b8b2, roughness: 0.85, side: THREE.DoubleSide }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a9a95, roughness: 0.9, side: THREE.DoubleSide }),
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.6 }),
    check: new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6 }),
  };
  for (const k of ['road', 'grass']) { mat[k].map.wrapS = mat[k].map.wrapT = THREE.RepeatWrapping; }

  const hw = T.halfWidth;
  const side = s => (s ? 1 : -1);

  // Tarmac and painted edge lines
  add(ribbon(T, all, i => [-hw, 0.03], i => [hw, 0.03], 8), mat.road, true);
  for (const s of [0, 1]) add(ribbon(T, all, i => [side(s) * (hw - 0.25), 0.04], i => [side(s) * hw, 0.04]), mat.line, true);

  // Kerbs, run by run
  for (const s of [0, 1]) {
    for (const run of runs(T.N, i => T.kerb[s][i] > 0)) {
      add(ribbon(T, run, i => [side(s) * hw, 0.05], i => [side(s) * (hw + T.kerb[s][i]), 0.09], 2), mat.kerb, true);
    }
  }

  // Grass verges out to the barriers, the barriers, and a skirt below them so
  // nothing floats where the road is raised above the ground
  for (const s of [0, 1]) {
    const inner = i => side(s) * (hw + T.kerb[s][i]);
    const wallD = i => side(s) * T.wall[s][i];
    add(ribbon(T, all, i => [inner(i), 0.0], i => [wallD(i), 0.0], 10), mat.grass, true);
    add(wallRibbon(T, all, wallD, () => 0, 1.0), mat.wall, false, true);
    add(wallRibbon(T, all, i => wallD(i) + side(s) * 0.25, i => (T.isBridge[i] ? -1.3 : -8), 1.0), mat.concrete, false, true);
  }

  // Bridge: deck edge and pillars down to the ground
  const bridgeIdx = all.filter(i => T.isBridge[i]);
  if (bridgeIdx.length) {
    const under = ribbon(T, bridgeIdx, i => [T.wall[1][i] + 0.25, -1.3], i => [-T.wall[0][i] - 0.25, -1.3], 8);
    add(under, mat.concrete);
    const deckSides = new THREE.Group();
    for (let k = 0; k < bridgeIdx.length; k += 14) {
      const i = bridgeIdx[k];
      for (const s of [0, 1]) {
        const d = side(s) * (T.wall[s][i] - 0.5);
        const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
        const ground = groundBelow(T, x, z, i);
        const hgt = T.h[i] - 1.2 - ground;
        if (hgt < 1) continue;
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, hgt, 1.2), mat.concrete);
        pillar.position.set(x, ground + hgt / 2, z);
        pillar.castShadow = pillar.receiveShadow = true;
        deckSides.add(pillar);
      }
    }
    group.add(deckSides);
  }

  // Start/finish line, sector lines and DRS lines
  add(crossLine(T, 0, 1.2), mat.check, true);
  for (const s of T.sectors.slice(1)) add(crossLine(T, s, 0.4), mat.yellow, true);
  for (const [a] of T.drs) add(crossLine(T, a, 0.3), mat.line, true);

  // Start gantry (lights come in phase 4)
  group.add(gantry(T, mat));

  // Terrain
  group.add(terrain(T, mat.terrain));

  function add(geo, m, receive, cast) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = !!receive;
    mesh.castShadow = !!cast;
    group.add(mesh);
    return mesh;
  }
  return group;
}

// A strip along the track between two sideways offsets. fa/fb return
// [offset, lift]. uvScale: metres per texture repeat along the track.
function ribbon(T, idx, fa, fb, uvScale = 4) {
  const pos = [], uv = [], ind = [];
  idx.forEach((i, j) => {
    const [da, ya] = fa(i), [db, yb] = fb(i);
    pos.push(T.x[i] + T.nx[i] * da, T.h[i] + ya, T.z[i] + T.nz[i] * da);
    pos.push(T.x[i] + T.nx[i] * db, T.h[i] + yb, T.z[i] + T.nz[i] * db);
    const u = (j === idx.length - 1 && i === idx[0] ? T.length : T.s[i]) / uvScale;
    uv.push(u, 0, u, Math.abs(db - da) / uvScale);
    if (j) {
      const k = j * 2;
      // wind so the face points up whichever side of the centreline we are on
      if (db > da) ind.push(k - 2, k - 1, k, k - 1, k + 1, k);
      else ind.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

function wallRibbon(T, idx, fd, y0, y1) {
  const pos = [], ind = [];
  idx.forEach((i, j) => {
    const d = fd(i), x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    pos.push(x, T.h[i] + y0(i), z, x, T.h[i] + y1, z);
    if (j) { const k = j * 2; ind.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

function crossLine(T, s, width) {
  const i0 = Math.floor(s / T.ds), idx = [];
  for (let k = 0; k <= Math.max(1, Math.round(width / T.ds)); k++) idx.push(wrap(i0 + k, T.N));
  return ribbon(T, idx, () => [-T.halfWidth, 0.045], () => [T.halfWidth, 0.045], 1);
}

function gantry(T, mat) {
  const g = new THREE.Group();
  const i = wrap(Math.round(-6 / T.ds), T.N);
  const span = T.halfWidth + 2;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), mat.dark);
    leg.position.set(0, 3.5, s * span);
    leg.castShadow = true;
    g.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, span * 2 + 0.5), mat.dark);
  beam.position.y = 7;
  beam.castShadow = true;
  g.add(beam);
  g.position.set(T.x[i], T.h[i], T.z[i]);
  g.rotation.y = -Math.atan2(T.tz[i], T.tx[i]);
  return g;
}

// Ground height under a point, ignoring the bridge deck above it.
function groundBelow(T, x, z, skip) {
  let best = Infinity, h = 0;
  for (let i = 0; i < T.N; i += 3) {
    if (T.isBridge[i]) continue;
    const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2;
    if (q < best) { best = q; h = T.h[i]; }
  }
  return h - 0.3;
}

function terrain(T, material) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < T.N; i++) {
    x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]);
    z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]);
  }
  const pad = 700, cell = 12;
  x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const coarse = [];
  for (let i = 0; i < T.N; i += 8) if (!T.isBridge[i]) coarse.push(i);
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), ind = [];
  const c1 = new THREE.Color(0x4f7d3a), c2 = new THREE.Color(0x6b8f4a), tmp = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) {
    const x = x0 + k * cell, z = z0 + j * cell;
    // nearest piece of track, and a smooth blend of nearby heights
    let best = Infinity, near = 0, sw = 0, sh = 0;
    for (const i of coarse) {
      const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2;
      if (q < best) { best = q; near = i; }
      const w = 1 / ((q + 900) * (q + 900));
      sw += w; sh += w * T.h[i];
    }
    for (let d = -8; d <= 8; d++) {
      const i = wrap(near + d, T.N);
      if (T.isBridge[i]) continue;
      const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2;
      if (q < best) { best = q; near = i; }
    }
    const dist = Math.sqrt(best);
    const corridor = Math.max(T.wall[0][near], T.wall[1][near]) + 4;
    const smooth = sh / sw;
    const far = Math.min(1, Math.max(0, (dist - corridor) / 120));
    const blend = far * far * (3 - 2 * far);
    const hills = 18 * Math.max(0, Math.min(1, (dist - 250) / 400)) * (0.6 + 0.4 * Math.sin(x * 0.004 + 1.3) * Math.cos(z * 0.005));
    let h = (T.isBridge[near] ? smooth : T.h[near]) * (1 - blend) + smooth * blend + hills - 0.35;
    if (dist < corridor) h = Math.min(h, T.h[near] - 0.35);
    const n = (j * nx + k) * 3;
    pos[n] = x; pos[n + 1] = h; pos[n + 2] = z;
    tmp.copy(c1).lerp(c2, 0.5 + 0.5 * Math.sin(x * 0.013) * Math.cos(z * 0.011));
    col[n] = tmp.r; col[n + 1] = tmp.g; col[n + 2] = tmp.b;
    if (j && k) { const a = (j - 1) * nx + k - 1, b = a + 1, c = j * nx + k - 1, d = c + 1; ind.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(ind);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Run lengths of consecutive samples where test(i) is true, as index lists.
function runs(N, test) {
  const out = [];
  let start = 0;
  while (start < N && test(start)) start++;
  if (start === N) { const all = []; for (let i = 0; i <= N; i++) all.push(i % N); return [all]; }
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (test(i)) { if (!cur) { cur = [wrap(i - 1, N)]; } cur.push(i); }
    else if (cur) { cur.push(i); out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

function noiseTexture(size, lo, hi, grain) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d'), img = x.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = lo + Math.random() * (hi - lo) + (Math.random() < 0.02 ? grain : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, v + 120);
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#d4242b'; x.fillRect(0, 0, 32, 8);
  x.fillStyle = '#f2f2ee'; x.fillRect(32, 0, 32, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
    x.fillStyle = (a + b) % 2 ? '#111' : '#eee';
    x.fillRect(a * 8, b * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
