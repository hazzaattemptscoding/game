// Everything away from the racing surface: the ground, and what is left of
// RAF Stanmere (reference/LAKESIDE_REFERENCE_PACK.md, section 2).
//
// Phase 2 builds the terrain, the old runway slab and perimeter track, the
// Watch Office (now Race Control), the timekeepers' box, the old painted pit
// wall, a Bellman hangar, the Dispersal Nissen huts and the water tower.
// Grandstands, the gate guardian, the chapel, the lake and the rest come in phase 3.

import * as THREE from 'three';
import { wrap, entryRoadAt } from './track.js';
import * as tex from './textures.js';
import { buildGrandstands, trackBlockers } from './grandstands.js';
import { buildProps } from './props.js';
import { buildPitDetail } from './pitBuilding.js';
import { planMasts, buildFloodlights } from './floodlights.js';
import { planExtras, buildExtras, footBlockers, smallBlockers } from './venueExtras.js';
import { buildPitDressing } from './pitDressing.js';

// Longer, rougher grass for everything beyond the containment wall: one texture, one tint, shared by the ground ribbon's
// outer band and the terrain mesh, so the two meet without a seam. A second look at the same texture at another scale
// and offset breaks up the repeat.
const MEADOW_NEAR = [0.62, 0.8, 0.5];   // tint (linear) of the meadow beside the circuit
let meadowTex = null;
export function meadowMaterial(vertexColors = false) {
  meadowTex ||= tex.meadowTexture();
  const m = new THREE.MeshStandardMaterial({ map: meadowTex, roughness: 1, vertexColors });
  if (!vertexColors) m.color.setRGB(...MEADOW_NEAR, THREE.LinearSRGBColorSpace);
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
      diffuseColor.rgb *= 0.7 + 1.0 * texture2D(map, vMapUv * 0.173 + vec2(0.37, 0.21)).g;
#endif`);
  };
  m.customProgramCacheKey = () => 'meadow-detail';
  return m;
}

// smooth value noise in 0..1, for tint variation across the terrain
const lattice = (a, b) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, z) {
  const a = Math.floor(x), b = Math.floor(z), u = x - a, v = z - b, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return lattice(a, b) * (1 - su) * (1 - sv) + lattice(a + 1, b) * su * (1 - sv) + lattice(a, b + 1) * (1 - su) * sv + lattice(a + 1, b + 1) * su * sv;
}

// Ground height anywhere, matching the track near it and rolling away from it.
const TERRAIN_SINK = 1.0;   // metres the terrain lies under the surface strips

export function createGround(T) {
  const coarse = [];
  for (let i = 0; i < T.N; i += 8) if (!T.isBridge[i]) coarse.push(i);
  // how far the flat ground around the track reaches (the pit side includes the paddock)
  const reach = i => Math.max(T.wall[0][i] + (T.pitOut[i] ? 70 : 0), T.wall[1][i]) + 4;

  function sample(x, z) {
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
    return { dist: Math.sqrt(best), near, smooth: sh / sw };
  }
  function height(x, z) {
    return T.groundAt(x, z);
  }

  // free space around a point: metres between it and the nearest barrier (or paddock)
  function clearance(x, z) {
    let best = Infinity;
    for (let i = 0; i < T.N; i += 2) {
      const d = Math.hypot(x - T.x[i], z - T.z[i]) - Math.max(T.wall[0][i], T.wall[1][i]) - (T.pitOut[i] ? 16 : 0);
      if (d < best) best = d;
    }
    return best;
  }

  // Under and just beside the bridge deck the terrain is held below the deck underside, so the embankment
  // that rises to meet the road at the deck ends can never poke up through it (nor its sink be lost, because
  // `sample` skips the bridge). Margin covers the cell size, so no terrain triangle crossing the deck is above it.
  const deckIdx = [];
  for (let i = 0; i < T.N; i += 2) if (T.isBridge[i]) deckIdx.push(i);
  const DECK_MARGIN = 20, DECK_CLEAR = 1.6;
  function deckCap(x, z) {
    let cap = Infinity;
    for (const i of deckIdx) {
      const dx = x - T.x[i], dz = z - T.z[i];
      if (Math.abs(dx * T.tx[i] + dz * T.tz[i]) > DECK_MARGIN) continue;
      const lat = dx * T.nx[i] + dz * T.nz[i], w = T.wall[lat < 0 ? 0 : 1][i];
      if (Math.abs(lat) > w + DECK_MARGIN) continue;
      cap = Math.min(cap, T.h[i] - DECK_CLEAR);
    }
    return cap;
  }

  // the height of the terrain mesh as drawn at a point (under the circuit it is sunk below the ground height)
  function drawn(x, z, info) {
    const { dist, near } = sample(x, z);
    if (info) info.dist = dist;
    const signed = (x - T.x[near]) * T.nx[near] + (z - T.z[near]) * T.nz[near];
    const side = signed < 0 ? 0 : 1;
    const out = Math.min(1, Math.max(0, (dist - Math.min(T.wall[side][near], T.reach[side][near])) / 24));
    let sink = TERRAIN_SINK * (1 - out * out * (3 - 2 * out));
    // around the separate pit entry road: sunk under the road, its verge and meadow (13 m past its far edge), easing out over 24 m
    const r = entryRoadAt(T, x, z, 13 + 24);
    if (r) { const f = Math.min(1, Math.max(0, (r.out - 13) / 24)); sink = Math.max(sink, TERRAIN_SINK * (1 - f * f * (3 - 2 * f))); }
    return Math.min(height(x, z) - sink, deckCap(x, z));
  }

  function mesh() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < T.N; i++) {
      x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]);
      z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]);
    }
    const pad = GRID_PAD, cell = GRID_CELL;
    let lowest = Infinity;
    const info = { dist: 0 };
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3), ind = [];
    const lush = MEADOW_NEAR, dry = [0.92, 0.86, 0.5];
    for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) {
      const x = x0 + k * cell, z = z0 + j * cell, n = j * nx + k;
      // The terrain is never cut. Under the circuit it sits TERRAIN_SINK below the surface
      // strips, easing back up to the real ground over 24 m, so a gap between two strips shows
      // grass, never sky, and the terrain can never poke through the tarmac.
      pos[n * 3] = x; pos[n * 3 + 1] = drawn(x, z, info); pos[n * 3 + 2] = z;
      const dist = info.dist;
      uv[n * 2] = x / 24; uv[n * 2 + 1] = z / 24;
      lowest = Math.min(lowest, pos[n * 3 + 1]);
      // the same tint as the meadow beside the circuit, drifting further out into patches of lush and dry grass
      const away = Math.min(1, Math.max(0, (dist - 50) / 90)), wide = vnoise(x / 110, z / 110) * 0.6 + vnoise(x / 320 + 9, z / 320) * 0.4;
      const dryness = away * Math.min(1, Math.max(0, (wide - 0.3) * 2.2)), shade = 1 - away * 0.18 + away * 0.22 * vnoise(x / 28, z / 28);
      for (let c = 0; c < 3; c++) col[n * 3 + c] = (lush[c] + (dry[c] - lush[c]) * dryness * 0.8) * shade;
      if (j && k) { const a = (j - 1) * nx + k - 1, b = a + 1, c = j * nx + k - 1, d = c + 1; ind.push(a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, meadowMaterial(true));
    m.receiveShadow = true;
    // last resort: a huge dark earth plane well below everything, so a hole can never show the sky
    const earth = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2b2a22 }));
    earth.position.set((x0 + x1) / 2, lowest - 5, (z0 + z1) / 2);
    earth.userData.debug = 'earth';
    m.add(earth);
    return m;
  }

  // The terrain as it is drawn: the same 12 m grid and the same triangles as mesh(), so things that stand on the
  // ground (piers, tyre stacks, stands) can sit on the surface that is actually on screen, not on the smooth ground function.
  const GRID_PAD = 700, GRID_CELL = 12;
  let grid = null;
  const nodes = new Map();
  function meshHeight(x, z) {
    if (!grid) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
      grid = { x0: x0 - GRID_PAD, z0: z0 - GRID_PAD, nx: Math.ceil((x1 - x0 + 2 * GRID_PAD) / GRID_CELL) + 1 };
    }
    const fx = (x - grid.x0) / GRID_CELL, fz = (z - grid.z0) / GRID_CELL, k = Math.floor(fx), j = Math.floor(fz), u = fx - k, v = fz - j;
    const node = (a, b) => {
      const key = b * grid.nx + a;
      let h = nodes.get(key);
      if (h === undefined) { h = drawn(grid.x0 + a * GRID_CELL, grid.z0 + b * GRID_CELL); nodes.set(key, h); }
      return h;
    };
    const ha = node(k, j), hb = node(k + 1, j), hc = node(k, j + 1);
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    const hd = node(k + 1, j + 1);
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  // the level of whatever the viewer sees at a point: the grass strip beside the circuit sits at height(), about a metre above the
  // sunk terrain mesh, and on a rise where the mesh is higher the mesh is what shows. Things that stand on the ground use this.
  function surfaceHeight(x, z) { return Math.max(meshHeight(x, z), height(x, z)); }

  return { height, drawn, meshHeight, surfaceHeight, clearance, mesh };
}

// A foundation under a building: a block from the building's base down to the lowest terrain drawn under
// its footprint (rect = [x0, x1, z0, z1] in the group's own frame, group already placed and turned), so
// the terrain, which is sunk under the circuit corridor, never leaves a gap beneath it.
function footing(ground, g, rect, mat, extra = 0.3) {
  const [x0, x1, z0, z1] = rect, c = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y);
  let low = Infinity;
  const nx = Math.max(1, Math.ceil((x1 - x0) / 2)), nz = Math.max(1, Math.ceil((z1 - z0) / 2));
  for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) {
    const lx = x0 + (x1 - x0) * a / nx, lz = z0 + (z1 - z0) * b / nz;
    low = Math.min(low, ground.drawn(g.position.x + lx * c + lz * sn, g.position.z - lx * sn + lz * c));
  }
  const depth = Math.max(0.3, g.position.y - low + extra);
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, depth, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, -depth / 2 + 0.01, (z0 + z1) / 2);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

// Where the buildings go, as numbers only (no meshes), so other scenery (grandstands, trees, props) can keep clear of them.
// s along the lap, d to the side (negative is the pit side).
export function sceneryLayout(T) {
  const L = {};
  const pitRun = [];
  for (let i = 0; i < T.N; i++) if (T.pitLimiter[i]) pitRun.push(i);
  L.pitRun = pitRun;
  if (pitRun.length) {
    const mid = T.s[pitRun[Math.floor(pitRun.length * 0.5)]], dd = -(T.wall[0][pitRun[0]] + 12);
    L.watch = { s: mid - 85, d: dd };
    L.huts = [];
    for (let k = 0; k < 6; k++) L.huts.push({ s: mid + 90 + k * 11, d: -(T.wall[0][pitRun[0]] + 10) });
  }
  L.timekeepers = { s: 4, d: T.wall[1][4] + 4 };
  L.oldWall = { s0: T.length - 170, s1: T.length - 50 };
  L.hangar = T.fromSketch(600, 382);
  L.tower = T.fromSketch(470, 332);
  L.runway = { a: T.fromSketch(250, 392), b: T.fromSketch(480, 506) };
  L.perimeter = { s0: T.sAtPointRaw(53.4), s1: T.sAtPointRaw(57.2) };
  return L;
}

// Circles (x, z, r) that cover every building and slab above, for keeping other things clear of them.
export function sceneryFootprints(T) {
  const L = sceneryLayout(T), out = [];
  const at = (s, d) => {
    const i = wrap(Math.round(s / T.ds), T.N);
    return { x: T.x[i] + T.nx[i] * d, z: T.z[i] + T.nz[i] * d };
  };
  const add = (p, r, name) => out.push({ x: p.x, z: p.z, r, name });
  if (L.watch) add(at(L.watch.s, L.watch.d), 9, 'watch office');
  if (L.huts) L.huts.forEach((h, k) => add(at(h.s, h.d), 7, 'hut ' + k));
  add(at(L.timekeepers.s, L.timekeepers.d), 3.5, 'timekeepers');
  for (let s = L.oldWall.s0; s < L.oldWall.s1; s += 6) add(at(s, T.wall[1][wrap(Math.round(s / T.ds), T.N)] + 8), 3.5, 'old pit wall');
  add(L.hangar, 32, 'hangar');
  add(L.tower, 6, 'water tower');
  const { a, b } = L.runway, len = Math.hypot(b.x - a.x, b.z - a.z);
  for (let t = 0; t <= len; t += 20) add({ x: a.x + (b.x - a.x) * t / len, z: a.z + (b.z - a.z) * t / len }, 27, 'old runway');
  for (let s = L.perimeter.s0; s <= L.perimeter.s1; s += 8) {
    const i = wrap(Math.round(s), T.N), d = T.wall[1][i] + 12;
    add({ x: T.x[i] + T.nx[i] * d, z: T.z[i] + T.nz[i] * d }, 9, 'old perimeter track');
  }
  return out;
}

export function buildScenery(T, ground) {
  const g = new THREE.Group();
  const M = {
    runway: new THREE.MeshStandardMaterial({ map: tex.runwayTexture(), roughness: 0.95, side: THREE.DoubleSide }),
    oldTarmac: new THREE.MeshStandardMaterial({ map: tex.runwayTexture(9), color: 0x8f8a80, roughness: 0.95 }),
    fadedPaint: new THREE.MeshStandardMaterial({ color: 0xcfcbbe, roughness: 0.9, side: THREE.DoubleSide }),
    brick: new THREE.MeshStandardMaterial({ map: tex.brickTexture(), roughness: 0.9 }),
    render: new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x24313b, roughness: 0.15, metalness: 0.5 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x9fb2bc, roughness: 0.5, metalness: 0.4 }),
    roofSlab: new THREE.MeshStandardMaterial({ color: 0x6e6b63, roughness: 0.9 }),
    hangar: new THREE.MeshStandardMaterial({ map: tex.corrugatedTexture('#6f7a6b'), roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
    hut: new THREE.MeshStandardMaterial({ map: tex.corrugatedTexture('#7a7358', 21), roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
    green: new THREE.MeshStandardMaterial({ color: 0x4a5b3f, roughness: 0.8 }),
    timber: new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.85 }),
    darkFrame: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6 }),
    oldWall: new THREE.MeshStandardMaterial({ color: 0xd9d6cb, roughness: 0.95 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x6e7a6c, roughness: 0.7, metalness: 0.3 }),
  };
  const add = (geo, mat, x, y, z, rotY = 0, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = cast; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // a point relative to the track: s along the lap, d to the side
  const at = (s, d) => {
    const i = wrap(Math.round(s / T.ds), T.N);
    const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    return { x, z, y: ground.height(x, z), yaw: -Math.atan2(T.tz[i], T.tx[i]), i };
  };

  const L = sceneryLayout(T);

  // --- old runway: 45 m wide, 7.5 m slabs, broken up wherever the new circuit cuts it
  {
    const { a, b } = L.runway;
    const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const vx = -uz, vz = ux, slab = 7.5, half = 22.5;
    const pos = [], uv = [], ind = [];
    const paint = [];
    for (let s = 0; s < len; s += slab) for (let w = -half; w < half; w += slab) {
      const cx = a.x + ux * (s + slab / 2) + vx * (w + slab / 2), cz = a.z + uz * (s + slab / 2) + vz * (w + slab / 2);
      if (ground.clearance(cx, cz) < 4) continue;
      const y = ground.height(cx, cz) + 0.06, base = pos.length / 3;
      for (const [p, q] of [[0, 0], [slab, 0], [slab, slab], [0, slab]]) {
        pos.push(a.x + ux * (s + p) + vx * (w + q), y, a.z + uz * (s + p) + vz * (w + q));
        uv.push(p / 15 + (s % 15) / 15, q / 15 + (w % 15) / 15);
      }
      ind.push(base, base + 2, base + 1, base, base + 3, base + 2);
      // faded centreline dashes and threshold bars
      if (Math.abs(w + slab / 2) < slab / 2 && (s / slab) % 4 < 2) paint.push([cx, y + 0.01, cz, 0.9, slab * 0.8]);
      if (s < slab * 2 && Math.abs(w + slab / 2) > 4) paint.push([cx, y + 0.01, cz, 1.8, slab * 0.9]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(ind);
    geo.computeVertexNormals();
    const runway = new THREE.Mesh(geo, M.runway);
    runway.receiveShadow = true;
    g.add(runway);
    const yaw = -Math.atan2(uz, ux);
    for (const [x, y, z, wid, lng] of paint) {
      const p = add(new THREE.PlaneGeometry(lng, wid), M.fadedPaint, x, y, z, 0, false);
      p.rotation.set(-Math.PI / 2, 0, yaw);
    }
  }

  // --- old perimeter track behind the gravel at Mess Straight (12 m wide, cracked)
  {
    const s0 = L.perimeter.s0, s1 = L.perimeter.s1, pos = [], uv = [], ind = [];
    for (let s = s0; s <= s1; s += 2) {
      const i = wrap(Math.round(s), T.N), d0 = T.wall[1][i] + 6, d1 = d0 + 12;
      const base = pos.length / 3;
      for (const d of [d0, d1]) {
        const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
        pos.push(x, ground.height(x, z) + 0.05, z);
        uv.push((s - s0) / 15, (d - d0) / 15);
      }
      if (s > s0) ind.push(base - 2, base, base - 1, base - 1, base, base + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(ind);
    geo.computeVertexNormals();
    const strip = new THREE.Mesh(geo, M.oldTarmac);
    strip.material.side = THREE.DoubleSide;
    strip.receiveShadow = true;
    g.add(strip);
  }

  // --- behind the Operations Block: the Watch Office (Race Control) and Dispersal
  if (L.watch) {
    g.add(watchOffice(M, at(L.watch.s, L.watch.d), ground));
    // six Nissen huts in a row, ends facing the paddock road
    for (const h of L.huts) g.add(nissenHut(M, at(h.s, h.d), ground));
  }

  // --- right side of Runway Straight: the timekeepers' box and the old painted pit wall
  {
    const tk = at(L.timekeepers.s, L.timekeepers.d);
    g.add(timekeepersBox(M, tk, ground));
    const s0 = L.oldWall.s0, s1 = L.oldWall.s1;
    for (let s = s0; s < s1; s += 3) {
      const p = at(s, T.wall[1][wrap(Math.round(s), T.N)] + 8);
      // each block runs down to the lowest terrain drawn under it
      const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      let low = p.y;
      for (const lx of [-1.525, 0, 1.525]) for (const lz of [-0.15, 0.15]) low = Math.min(low, ground.drawn(p.x + lx * cs + lz * sn, p.z - lx * sn + lz * cs));
      const hgt = 1.0 + (p.y - low) + 0.3;
      const block = add(new THREE.BoxGeometry(3.05, hgt, 0.3), M.oldWall, p.x, p.y + 1.0 - hgt / 2, p.z, p.yaw);
      // flaking: every few blocks a little darker
      if ((s / 3) % 5 < 1) block.material = M.roofSlab;
    }
  }

  // --- infield: a Bellman hangar north of Scramble, and the water tower
  {
    const h = L.hangar;
    const yaw = -Math.atan2(T.tz[0], T.tx[0]);
    g.add(bellmanHangar(M, { x: h.x, z: h.z, y: ground.height(h.x, h.z), yaw }, ground));
    const w = L.tower;
    g.add(waterTower(M, { x: w.x, z: w.z, y: ground.height(w.x, w.z) }, ground));
  }

  // grandstands, then everything small that has to keep clear of them and of the buildings
  const blockers = sceneryFootprints(T);
  const stands = buildGrandstands(T, ground, blockers);
  const all = [...trackBlockers(T), ...blockers];
  const extras = planExtras(T, ground, all, stands.userData.stands);
  const obstacles = [...stands.userData.stands, ...extras.items];
  const allB = [...all, ...footBlockers(extras.bridges), ...smallBlockers(extras.small)];
  g.add(stands, buildExtras(T, ground, extras), buildProps(T, ground, allB, obstacles), buildPitDetail(T, ground), buildPitDressing(T, ground));
  g.add(buildFloodlights(T, ground, planMasts(T, allB, obstacles)));
  g.userData.keepClear = { obstacles, blockers: allB };   // for the marshal posts (src/marshal.js), planned after the scenery

  return g;
}

// Watch Office: 12 x 9 m brick block, 7 m high, balcony, glazed control room on the roof.
function watchOffice(M, p, ground) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 9), M.brick);
  body.position.y = 3.5;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.3, 9.4), M.roofSlab);
  roof.position.y = 7.15;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.2, 3.5), M.glass);
  cab.position.set(0, 8.4, 0);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.2, 3.9), M.roofSlab);
  cabRoof.position.set(0, 9.6, 0);
  g.add(body, roof, cab, cabRoof);
  // windows on the front (+z faces the track) and back, two floors
  for (const zf of [4.52, -4.52]) for (const y of [1.8, 5.0]) for (let k = 0; k < 4; k++) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 0.05), M.frame);
    frame.position.set(-4.2 + k * 2.8, y, zf);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.06), M.glass);
    pane.position.set(-4.2 + k * 2.8, y, zf + Math.sign(zf) * 0.01);
    g.add(frame, pane);
  }
  // first-floor balcony with a pale blue-grey rail, all along the front
  const slab = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.2, 1.4), M.render);
  slab.position.set(0, 3.5, 5.2);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.06, 0.06), M.rail);
  rail.position.set(0, 4.5, 5.85);
  g.add(slab, rail);
  for (let k = 0; k <= 8; k++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), M.rail);
    post.position.set(-6.1 + k * 1.525, 4.0, 5.85);
    g.add(post);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw - Math.PI / 2;   // front faces the pit lane
  footing(ground, g, [-6, 6, -4.5, 4.5], M.brick);
  return g;
}

// Nissen hut: 4.9 m wide, 11 m long half-cylinder of corrugated steel, brick ends.
function nissenHut(M, p, ground) {
  const g = new THREE.Group(), r = 2.45, L = 11;
  // the shell is the upper half of the cylinder, in the same plane as the brick ends (x across, y up), so it closes the hut's sides
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 16, 1, true, Math.PI / 2, Math.PI), M.hut);
  shell.rotation.x = Math.PI / 2;
  const endGeo = new THREE.CircleGeometry(r, 16, 0, Math.PI);
  for (const z of [-L / 2, L / 2]) {
    const end = new THREE.Mesh(endGeo, M.brick);
    end.position.z = z;
    if (z < 0) end.rotation.y = Math.PI;
    g.add(end);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.1), M.green);
  door.position.set(0, 1.0, L / 2 + 0.05);
  g.add(shell, door);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw;
  footing(ground, g, [-r, r, -L / 2, L / 2], M.roofSlab);   // concrete base slab under the hut
  return g;
}

// Timekeepers' box: 3.6 x 2.4 m white timber hut on 2.5 m stilts, glazed front, ladder.
function timekeepersBox(M, p, ground) {
  const g = new THREE.Group();
  for (const [x, z] of [[-1.6, -1.0], [1.6, -1.0], [-1.6, 1.0], [1.6, 1.0]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), M.darkFrame);
    leg.position.set(x, 1.25, z);
    g.add(leg);
  }
  const hut = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 2.4), M.timber);
  hut.position.y = 3.6;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.15, 2.8), M.darkFrame);
  roof.position.y = 4.78;
  const glazing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.05), M.glass);
  glazing.position.set(0, 3.9, -1.23);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.06), M.darkFrame);
  ladder.position.set(1.0, 1.3, 1.4);
  ladder.rotation.x = -0.25;
  g.add(hut, roof, glazing, ladder);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw + Math.PI / 2;   // glazing faces the track
  for (const [x, z] of [[-1.6, -1.0], [1.6, -1.0], [-1.6, 1.0], [1.6, 1.0]]) footing(ground, g, [x - 0.4, x + 0.4, z - 0.4, z + 0.4], M.roofSlab);   // a pad under each leg
  return g;
}

// Bellman hangar: 26 m wide, 54 m long, low arched roof to 8 m, doors at one end.
function bellmanHangar(M, p, ground) {
  const g = new THREE.Group(), W = 26, L = 54;
  const prof = new THREE.Shape();
  prof.moveTo(-W / 2, 0); prof.lineTo(-W / 2, 5.5);
  prof.quadraticCurveTo(0, 10.5, W / 2, 5.5);
  prof.lineTo(W / 2, 0); prof.lineTo(-W / 2, 0);
  const geo = new THREE.ExtrudeGeometry(prof, { depth: L, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -L / 2);
  // stretch the corrugation texture over the walls
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 6, uv.getY(k) / 6);
  const body = new THREE.Mesh(geo, M.hangar);
  const doors = new THREE.Mesh(new THREE.PlaneGeometry(W - 3, 5.2), M.green);
  doors.position.set(0, 2.6, L / 2 + 0.05);
  const rust = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.5, L + 0.1), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }));
  rust.position.y = 0.25;
  g.add(body, doors, rust);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw;
  footing(ground, g, [-W / 2, W / 2, -L / 2, L / 2], M.roofSlab);
  return g;
}

// Water tower: 6 x 6 x 3 m steel tank on four brick legs, 12 m to the top.
function waterTower(M, p, ground) {
  const g = new THREE.Group();
  for (const [x, z] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), M.brick);
    leg.position.set(x, 4.5, z);
    g.add(leg);
  }
  const tank = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), M.tank);
  tank.position.y = 10.5;
  g.add(tank);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  for (const [x, z] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) footing(ground, g, [x - 0.7, x + 0.7, z - 0.7, z + 0.7], M.roofSlab);
  return g;
}
