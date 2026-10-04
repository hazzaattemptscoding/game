// The circuit itself: tarmac, kerbs, run-off, gravel, pit lane, barriers,
// catch fencing, sponsor boards, the bridge, the start gantry and distance
// boards. Scenery away from the track lives in scenery.js.
//
// Most pieces are long strips that follow the track. Strips of the same
// material are merged into one mesh to keep draw calls low.

import * as THREE from 'three';
import { wrap, BARRIER } from './track.js';
import { computeRacingLine, speedProfile } from './autopilot.js';
import { GT } from './cars.js';
import * as tex from './textures.js';

const FENCE_HEIGHT = 4;       // catch fence height above the barrier base, metres
const SPONSOR_CHUNK = 9;      // length of one sponsor panel on walls, metres (three 3 m wall units)

export function buildTrackScene(T, ground) {
  const group = new THREE.Group();
  const hw = T.halfWidth;
  const sideSign = sd => (sd ? 1 : -1);
  const P = (i, d, lift = 0) => [T.x[i] + T.nx[i] * d, T.h[i] + lift, T.z[i] + T.nz[i] * d];
  const all = [];
  for (let i = 0; i <= T.N; i++) all.push(wrap(i, T.N));
  const sOf = (i, j, idx) => (j === idx.length - 1 && i === idx[0] && j > 0 ? T.length : T.s[i]);

  const sponsorTex = tex.sponsorAtlas();
  const mat = {
    road: new THREE.MeshStandardMaterial({ map: tex.tarmacTexture(), roughness: 0.9 }),
    line: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }),
    kerb: new THREE.MeshStandardMaterial({ map: tex.kerbTexture(), roughness: 0.6 }),
    sausage: new THREE.MeshStandardMaterial({ map: tex.kerbTexture('#f2c400', '#1a1a1a'), roughness: 0.6 }),
    runoff: new THREE.MeshStandardMaterial({ map: tex.runoffTexture(), roughness: 0.9 }),
    grass: new THREE.MeshStandardMaterial({ map: tex.grassTexture(), roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ map: tex.gravelTexture(), roughness: 1 }),
    pit: new THREE.MeshStandardMaterial({ map: tex.pitLaneTexture(), roughness: 0.85 }),
    armco: new THREE.MeshStandardMaterial({ map: tex.armcoTexture(), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0x6b7075, roughness: 0.5, metalness: 0.5 }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    street: new THREE.MeshStandardMaterial({ map: tex.streetWallTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ map: tex.facadeTexture({ wall: '#e6e3da', glass: '#24313b', frame: '#2a2d31', cols: 8, rows: 1 }), roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }),
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.55, side: THREE.DoubleSide }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.85, side: THREE.DoubleSide }),
    fence: new THREE.MeshStandardMaterial({ map: tex.fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.45, metalness: 0.7 }),
    garage: new THREE.MeshStandardMaterial({ map: tex.garageTexture(), roughness: 0.7, side: THREE.DoubleSide }),
    roof: new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x2a0606, emissive: 0xff1a1a, emissiveIntensity: 0 }),
  };

  // --- ground-level surfaces -------------------------------------------
  const S = {};                                 // strip builders by material
  const strips = name => (S[name] ||= new Strips());

  // tarmac and edge lines
  strips('road').strip(all, i => P(i, -hw, 0.03), i => P(i, hw, 0.03), (i, j) => sOf(i, j, all) / 8, -hw / 8, hw / 8);
  for (const sd of [0, 1]) {
    const g = sideSign(sd);
    strips('line').strip(all, i => P(i, g * (hw - 0.25), 0.04), i => P(i, g * hw, 0.04), () => 0, 0, 1);
  }

  for (const sd of [0, 1]) {
    const g = sideSign(sd);
    const kerbOut = i => hw + T.kerb[sd][i];
    const sausOut = i => kerbOut(i) + T.sausage[sd][i];
    const runOut = i => sausOut(i) + T.runoff[sd][i];

    for (const run of runs(T.N, i => T.kerb[sd][i] > 0)) {
      strips('kerb').strip(run, i => P(i, g * hw, 0.045), i => P(i, g * kerbOut(i), 0.08), (i, j) => sOf(i, j, run) / 2, 0, 1);
    }
    for (const run of runs(T.N, i => T.sausage[sd][i] > 0)) {
      // raised: a slope up, then the top
      strips('sausage').strip(run, i => P(i, g * kerbOut(i), 0.08), i => P(i, g * (kerbOut(i) + 0.15), 0.2), (i, j) => sOf(i, j, run) / 1.2, 0, 0.3);
      strips('sausage').strip(run, i => P(i, g * (kerbOut(i) + 0.15), 0.2), i => P(i, g * sausOut(i), 0.2), (i, j) => sOf(i, j, run) / 1.2, 0.3, 1);
    }
    for (const run of runs(T.N, i => T.runoff[sd][i] > 0.2)) {
      strips('runoff').strip(run, i => P(i, g * sausOut(i), 0.035), i => P(i, g * runOut(i), 0.035), (i, j) => sOf(i, j, run) / 8, 0, i => T.runoff[sd][i] / 7.3);
    }
    // grass from the run-off out to the barrier (the pit lane and gravel sit on top)
    strips('grass').strip(all, i => P(i, g * runOut(i), 0.0), i => P(i, g * T.wall[sd][i], 0.0), (i, j) => sOf(i, j, all) / 40, i => runOut(i) / 12, i => T.wall[sd][i] / 12);
    for (const run of runs(T.N, i => T.gravelOut[sd][i] > 0)) {
      strips('gravel').strip(run, i => P(i, g * T.gravelIn[sd][i], 0.02), i => P(i, g * T.gravelOut[sd][i], 0.02), (i, j) => sOf(i, j, run) / 6, i => T.gravelIn[sd][i] / 6, i => T.gravelOut[sd][i] / 6);
    }
  }

  // pit lane
  for (const run of runs(T.N, i => T.pitO[i] !== 0)) {
    strips('pit').strip(run, i => P(i, T.pitO[i] + T.pitHalf, 0.032), i => P(i, T.pitO[i] - T.pitHalf, 0.032), (i, j) => sOf(i, j, run) / 16, 0, 1);
  }

  // start line, grid slots, sector and DRS lines, pit limiter lines
  crossLine(strips('line'), T, 0, 0.6, -hw, hw);
  for (const s of T.sectors.slice(1)) crossLine(strips('line'), T, s, 0.25, -hw, -hw + 2);
  for (const [a] of T.drs) crossLine(strips('line'), T, a, 0.3, -hw, hw);
  for (let slot = 0; slot < 12; slot++) {
    const s = T.length - 10 - slot * 8, d = (slot % 2 ? 1 : -1) * 3.2;
    crossLine(strips('line'), T, s, 0.2, d - 1.3, d + 1.3);
  }
  const lim = runs(T.N, i => T.pitLimiter[i] > 0)[0];
  if (lim) for (const i of [lim[0], lim[lim.length - 1]]) crossLine(strips('line'), T, T.s[i], 0.5, T.pitO[i] - T.pitHalf, T.pitO[i] + T.pitHalf, 0.045);

  // --- barriers ---------------------------------------------------------
  const posts = [];          // armco and fence posts: [x, y, z, height]
  for (const sd of [0, 1]) {
    const g = sideSign(sd), w = i => g * T.wall[sd][i];
    const type = i => T.barrier[sd][i];

    // armco: two rails on posts
    for (const run of runs(T.N, i => type(i) === BARRIER.ARMCO)) {
      for (const [y0, y1] of [[0.45, 0.78], [0.82, 1.15]]) {
        strips('armco').strip(run, i => P(i, w(i), y0), i => P(i, w(i), y1), (i, j) => sOf(i, j, run) / 4, 0, 1);
      }
      for (let k = 0; k < run.length; k += 2) { const i = run[k]; posts.push([...P(i, w(i) + g * 0.12, 0), 1.2]); }
    }
    // tyre walls: conveyor-belt faced, 1.9 m tall, sponsor band and a white top band
    for (const run of runs(T.N, i => type(i) === BARRIER.TYRES)) {
      strips('tyre').strip(run, i => P(i, w(i), 0.1), i => P(i, w(i), 1.9), (i, j) => sOf(i, j, run) / 4, 0, 1);
      strips('tyre').strip(run, i => P(i, w(i), 1.9), i => P(i, w(i) + g * 1.2, 1.9), () => 0, 0, 1);
      sponsorWall(strips('sponsor'), T, run, i => w(i) - g * 0.03, 0.45, 1.45, sd);
      strips('line').strip(run, i => P(i, w(i) - g * 0.03, 1.6), i => P(i, w(i) - g * 0.03, 1.9), () => 0, 0, 1);
    }
    // tall concrete walls on the street section (red and white top band, sponsor panels)
    for (const run of runs(T.N, i => type(i) === BARRIER.CONCRETE)) {
      strips('street').strip(run, i => P(i, w(i), -0.3), i => P(i, w(i), 1.4), (i, j) => sOf(i, j, run) / 6, 0, 1);
      sponsorWall(strips('sponsor'), T, run, i => w(i) - g * 0.03, 0.15, 1.05, sd, 2);
      strips('concrete').strip(run, i => P(i, w(i), 1.4), i => P(i, w(i) + g * 0.35, 1.4), () => 0, 0, 0.1);
    }
    // bridge parapets
    for (const run of runs(T.N, i => type(i) === BARRIER.PARAPET)) {
      strips('concrete').strip(run, i => P(i, w(i), -0.3), i => P(i, w(i), 1.1), (i, j) => sOf(i, j, run) / 6, 0, 1);
      strips('concrete').strip(run, i => P(i, w(i), 1.1), i => P(i, w(i) + g * 0.35, 1.1), () => 0, 0, 0.1);
    }
    // catch fences behind the tyre walls, debris fences on top of the street walls
    for (const run of runs(T.N, i => T.fence[sd][i] > 0 && type(i) !== BARRIER.PIT)) {
      const tyres = i => type(i) === BARRIER.TYRES;
      const back = i => w(i) + g * (tyres(i) ? 2.0 : 0.2);
      const bottom = i => (tyres(i) ? 0.3 : 1.4), top = i => (tyres(i) ? FENCE_HEIGHT : 3.4);
      strips('fence').strip(run, i => P(i, back(i), bottom(i)), i => P(i, back(i), top(i)), (i, j) => sOf(i, j, run) / 2, i => bottom(i) / 2, i => top(i) / 2);
      for (let k = 0; k < run.length; k += 5) { const i = run[k]; posts.push([...P(i, back(i), 0), top(i)]); }
    }
    // skirt below every barrier, so raised road never floats
    strips('concrete').strip(all, i => P(i, w(i) + g * 0.45, T.isBridge[i] ? -1.3 : -8), i => P(i, w(i) + g * 0.45, 0), (i, j) => sOf(i, j, all) / 8, 0, 1);
  }

  // pit wall: concrete with sponsor panels, a fence on top
  for (const run of runs(T.N, i => T.pitWallIn[i] > 0)) {
    const inner = i => -T.pitWallIn[i], outer = i => -T.pitWallIn[i] - 0.6;
    sponsorWall(strips('sponsor'), T, run, inner, 0, 0.8, 0, 1);
    strips('line').strip(run, i => P(i, inner(i), 0.8), i => P(i, inner(i), 1.1), () => 0, 0, 1);
    strips('line').strip(run, i => P(i, inner(i), 1.1), i => P(i, outer(i), 1.1), () => 0, 0, 1);
    strips('concrete').strip(run, i => P(i, outer(i), 0), i => P(i, outer(i), 1.1), (i, j) => sOf(i, j, run) / 8, 0, 1);
    strips('fence').strip(run, i => P(i, outer(i) + 0.3, 1.1), i => P(i, outer(i) + 0.3, 3.2), (i, j) => sOf(i, j, run) / 2, 0.55, 1.6);
    for (let k = 0; k < run.length; k += 4) { const i = run[k]; posts.push([...P(i, outer(i) + 0.3, 0), 3.2]); }
  }

  // pit lane outer edge: apron, and a low wall wherever there are no garages
  for (const run of runs(T.N, i => T.barrier[0][i] === BARRIER.PIT)) {
    strips('pit').strip(run, i => P(i, T.pitO[i] - T.pitHalf, 0.03), i => P(i, -T.wall[0][i], 0.03), (i, j) => sOf(i, j, run) / 16, 0.95, 0.99);
    strips('concrete').strip(run, i => P(i, -T.wall[0][i], -0.3), i => P(i, -T.wall[0][i], 0.81), (i, j) => sOf(i, j, run) / 6, 0, 1);
  }

  // pit garages along the pit lane, behind the outer wall
  // 18 bays of 7 m, centred on the pit lane
  const limRun = runs(T.N, i => T.pitLimiter[i] > 0)[0];
  const garageRun = limRun && limRun.slice(Math.floor(limRun.length / 2) - 63, Math.floor(limRun.length / 2) + 64);
  if (garageRun) {
    // the Operations Block: garages below, a glazed upper floor, roof terrace
    const front = i => -T.wall[0][i] - 0.05, back = i => front(i) - 14, H = 9.5;
    strips('garage').strip(garageRun, i => P(i, front(i), 0), i => P(i, front(i), 5.5), (i, j) => sOf(i, j, garageRun) / 14, 0, 1);
    sponsorWall(strips('sponsor'), T, garageRun, i => front(i) + 0.05, 5.6, 6.6, 0, 1);
    strips('glass').strip(garageRun, i => P(i, front(i) + 1.2, 6.6), i => P(i, front(i) + 1.2, H), (i, j) => sOf(i, j, garageRun) / 28, 0, 1);
    strips('roof').strip(garageRun, i => P(i, front(i) + 2.5, 6.6), i => P(i, front(i), 6.6), () => 0, 0, 1);
    strips('roof').strip(garageRun, i => P(i, front(i) + 2.5, H), i => P(i, back(i), H), () => 0, 0, 1);
    strips('concrete').strip(garageRun, i => P(i, back(i), 0), i => P(i, back(i), H), (i, j) => sOf(i, j, garageRun) / 8, 0, 1);
    strips('fence').strip(garageRun, i => P(i, front(i) + 2.4, H), i => P(i, front(i) + 2.4, H + 1.1), (i, j) => sOf(i, j, garageRun) / 2, 0, 0.55);
  }

  // build the merged strip meshes
  for (const [name, b] of Object.entries(S)) {
    const mesh = new THREE.Mesh(b.geometry(), mat[name]);
    mesh.receiveShadow = true;
    mesh.castShadow = ['armco', 'concrete', 'street', 'sponsor', 'tyre', 'garage', 'glass', 'roof'].includes(name);
    if (name === 'fence') mesh.renderOrder = 2;
    group.add(mesh);
  }

  // posts, instanced
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6);
  postGeo.translate(0, 0.5, 0);
  const postMesh = new THREE.InstancedMesh(postGeo, mat.post, posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach(([x, y, z, h], k) => { m4.makeScale(1, h, 1).setPosition(x, y, z); postMesh.setMatrixAt(k, m4); });
  postMesh.castShadow = true;
  group.add(postMesh);

  group.add(bridge(T, mat, ground));
  const gantryGroup = gantry(T, mat, sponsorTex);
  group.add(gantryGroup);
  group.add(distanceBoards(T));
  group.add(billboards(T, sponsorTex));
  group.userData.startLights = gantryGroup.userData.lights;
  return group;
}

// ---------------------------------------------------------------------------
// Strip builder: quads between two edge lines, merged into one geometry.

class Strips {
  constructor() { this.pos = []; this.uv = []; this.ind = []; }

  // a(i), b(i): world positions of the two edges at sample i.
  // u(i, j): texture coordinate along the strip. va, vb: across (number or function of i).
  strip(idx, a, b, u, va, vb) {
    if (idx.length < 2) return;
    const base = this.pos.length / 3;
    const V = (v, i) => (typeof v === 'function' ? v(i) : v);
    idx.forEach((i, j) => {
      this.pos.push(...a(i), ...b(i));
      const uu = u(i, j);
      this.uv.push(uu, V(va, i), uu, V(vb, i));
    });
    // flat strips must face up: choose the winding from the first quad
    const p = this.pos, o = base * 3;
    const ex = p[o + 3] - p[o], ey = p[o + 4] - p[o + 1], ez = p[o + 5] - p[o + 2];   // a -> b
    const fx = p[o + 6] - p[o], fy = p[o + 7] - p[o + 1], fz = p[o + 8] - p[o + 2];   // a(i) -> a(i+1)
    const ny = ez * fx - ex * fz;                                                      // y of (a->b) x (along)
    const flat = Math.abs(ey) < 0.5 * Math.hypot(ex, ez) + 1e-6;
    const flip = flat && ny < 0;
    for (let j = 1; j < idx.length; j++) {
      const k = base + j * 2;
      if (flip) this.ind.push(k - 2, k, k - 1, k - 1, k, k + 1);
      else this.ind.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.ind);
    g.computeVertexNormals();
    return g;
  }
}

// A wall face split into sponsor panels. `every`: 1 = every panel sponsored,
// 2 = every other one (the gaps show the PowerMedia board).
function sponsorWall(b, T, run, w, y0, y1, sd, every = 1) {
  const rows = tex.SPONSORS.length, modern = tex.MODERN_SPONSORS;
  for (let k = 0; k < run.length - 1; k += SPONSOR_CHUNK) {
    const piece = run.slice(k, Math.min(run.length, k + SPONSOR_CHUNK + 1));
    if (piece.length < 3) continue;
    const n = Math.round(T.s[piece[0]] / SPONSOR_CHUNK);
    const row = every === 1 || n % every === 0 ? modern[(n * 5 + sd * 3) % modern.length] : 0;
    const vTop = 1 - row / rows, vBot = 1 - (row + 1) / rows;
    const len = piece.length - 1;
    const flipU = sd === 1;   // text reads left to right from the track on both sides
    b.strip(piece,
      i => [T.x[i] + T.nx[i] * w(i), T.h[i] + y0, T.z[i] + T.nz[i] * w(i)],
      i => [T.x[i] + T.nx[i] * w(i), T.h[i] + y1, T.z[i] + T.nz[i] * w(i)],
      (i, j) => (flipU ? 1 - j / len : j / len), vBot, vTop);
  }
}

function crossLine(b, T, s, width, d0, d1, lift = 0.045) {
  const i0 = wrap(Math.round(s / T.ds), T.N), idx = [];
  for (let k = 0; k <= Math.max(1, Math.round(width / T.ds)); k++) idx.push(wrap(i0 + k, T.N));
  b.strip(idx, i => [T.x[i] + T.nx[i] * d0, T.h[i] + lift, T.z[i] + T.nz[i] * d0], i => [T.x[i] + T.nx[i] * d1, T.h[i] + lift, T.z[i] + T.nz[i] * d1], () => 0, 0, 1);
}

// ---------------------------------------------------------------------------
// Bridge: deck underside, banners and pillars. Pillars never stand on a road.

function bridge(T, mat, ground) {
  const g = new THREE.Group();
  const idx = [];
  for (let i = 0; i < T.N; i++) if (T.isBridge[i]) idx.push(i);
  if (!idx.length) return g;
  const b = new Strips();
  const P = (i, d, lift) => [T.x[i] + T.nx[i] * d, T.h[i] + lift, T.z[i] + T.nz[i] * d];
  b.strip(idx, i => P(i, -T.wall[0][i] - 0.45, -1.3), i => P(i, T.wall[1][i] + 0.45, -1.3), () => 0, 0, 1);
  // deck edge beams carry a big PowerMedia banner on the outside faces
  const banners = new Strips();
  for (const sd of [0, 1]) {
    const gg = sd ? 1 : -1;
    const mid = idx.slice(Math.floor(idx.length * 0.25), Math.floor(idx.length * 0.75));
    const len = mid.length - 1;
    banners.strip(mid, i => P(i, gg * (T.wall[sd][i] + 0.5), -1.25), i => P(i, gg * (T.wall[sd][i] + 0.5), 1.0),
      (i, j) => (sd ? j / len : 1 - j / len), 7 / 8, 1);
  }
  const deck = new THREE.Mesh(b.geometry(), mat.concrete);
  deck.receiveShadow = deck.castShadow = true;
  const ban = new THREE.Mesh(banners.geometry(), mat.sponsor);
  g.add(deck, ban);

  // Roundel Bridge: a big RAF-style roundel painted under the deck, over the main straight
  const mid = idx[Math.floor(idx.length / 2)];
  const width = T.wall[0][mid] + T.wall[1][mid];
  const roundel = new THREE.Mesh(new THREE.PlaneGeometry(width, width), new THREE.MeshStandardMaterial({ map: tex.roundelTexture(), roughness: 0.8 }));
  const off = (T.wall[1][mid] - T.wall[0][mid]) / 2;
  roundel.position.set(T.x[mid] + T.nx[mid] * off, T.h[mid] - 1.33, T.z[mid] + T.nz[mid] * off);
  roundel.rotation.set(Math.PI / 2, 0, 0);
  g.add(roundel);

  // pillars in pairs under the deck edges, skipping any that would land on a road
  const pillarGeo = new THREE.BoxGeometry(1.4, 1, 1.4);
  pillarGeo.translate(0, 0.5, 0);
  for (let k = 6; k < idx.length - 6; k += 10) {
    const i = idx[k];
    for (const sd of [0, 1]) {
      const d = (sd ? 1 : -1) * (T.wall[sd][i] - 0.3);
      const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
      if (onAnyRoad(T, x, z, 3)) continue;
      const base = ground.height(x, z), top = T.h[i] - 1.3;
      if (top - base < 1.5) continue;
      const p = new THREE.Mesh(pillarGeo, mat.concrete);
      p.scale.y = top - base;
      p.position.set(x, base, z);
      p.castShadow = p.receiveShadow = true;
      g.add(p);
    }
  }
  return g;
}

// Is this point on any non-bridge tarmac (track or pit lane), with a margin?
export function onAnyRoad(T, x, z, margin) {
  for (let i = 0; i < T.N; i++) {
    if (T.isBridge[i]) continue;
    const dx = x - T.x[i], dz = z - T.z[i];
    if (dx * dx + dz * dz > 60 * 60) continue;
    const along = dx * T.tx[i] + dz * T.tz[i];
    if (Math.abs(along) > 0.6) continue;
    const d = dx * T.nx[i] + dz * T.nz[i];
    if (Math.abs(d) < T.halfWidth + margin) return true;
    if (T.pitO[i] && Math.abs(d - T.pitO[i]) < T.pitHalf + margin) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Start gantry: steel truss over the grid, PowerMedia boards, five light pods.

function gantry(T, mat, sponsorTex) {
  const g = new THREE.Group();
  const i = wrap(Math.round(-4 / T.ds), T.N);
  const hw = T.halfWidth, leftD = -hw - 2.3, rightD = hw + 2.3, mid = 0;
  const under = 6.0, beamH = 1.0, beamD = 0.9;
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 });
  // pillars: 0.6 m square, 2 m beyond the track edge
  for (const d of [leftD, rightD]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, under + beamH, 0.6), frame);
    leg.position.set(0, (under + beamH) / 2, d);
    leg.castShadow = true;
    g.add(leg);
  }
  const span = rightD - leftD + 0.6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(beamD, beamH, span), frame);
  beam.position.set(0, under + beamH / 2, mid);
  beam.castShadow = true;
  g.add(beam);
  // PowerMedia banner on both faces, 14 m by 1.2 m
  const boardTex = sponsorTex.clone();
  boardTex.repeat.set(1, 1 / 8);
  boardTex.offset.set(0, 7 / 8);
  boardTex.needsUpdate = true;
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.5 });
  for (const x of [-1, 1]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.2), boardMat);
    board.position.set(x * (beamD / 2 + 0.02), under + beamH + 0.65, mid);
    board.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(board);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 14.2), frame);
    back.position.set(0, under + beamH + 0.65, mid);
    g.add(back);
  }
  // five pods, 1.6 m apart, two stacked red lights each with a visor, facing the grid
  const lights = [];
  const housing = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6 });
  for (let k = 0; k < 5; k++) {
    const z = mid + (k - 2) * 1.6;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.9), housing);
    pod.position.set(-beamD / 2 - 0.15, under - 0.3, z);
    g.add(pod);
    const pair = [];
    for (const y of [-0.2, 0.2]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), mat.lampOff.clone());
      lamp.material.color.set(0x5a0f0f);
      lamp.position.set(-beamD / 2 - 0.31, under - 0.3 + y, z);
      lamp.rotation.y = -Math.PI / 2;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.34), housing);
      visor.position.set(-beamD / 2 - 0.36, under - 0.3 + y + 0.16, z);
      g.add(lamp, visor);
      pair.push(lamp);
    }
    lights.push(pair);
  }
  g.userData.lights = lights;
  g.position.set(T.x[i], T.h[i], T.z[i]);
  g.rotation.y = -Math.atan2(T.tz[i], T.tx[i]);
  return g;
}

// ---------------------------------------------------------------------------
// 300 / 200 / 100 boards before the big braking zones.

function distanceBoards(T) {
  const g = new THREE.Group();
  const line = computeRacingLine(T);
  const v = speedProfile(T, line, GT, 0.9);
  const N = T.N, mats = {};
  for (const n of [300, 200, 100]) mats[n] = new THREE.MeshStandardMaterial({ map: tex.distanceTexture(n), roughness: 0.6, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
  // a braking zone starts where the target speed begins to fall; keep the big ones
  for (let i = 0; i < N; i++) {
    const before = v[wrap(i - 1, N)];
    if (!(before > v[i] + 0.01 && v[wrap(i - 2, N)] <= before + 0.01)) continue;
    let k = i;
    while (v[wrap(k + 1, N)] < v[wrap(k, N)] + 0.01 && k - i < 400) k++;
    if ((v[i] - v[wrap(k, N)]) * 3.6 < 70) continue;
    const corner = wrap(k, N);
    const outside = T.curv[wrap(corner + 10, N)] > 0 ? 0 : 1;   // boards on the outside of the corner
    for (const n of [300, 200, 100]) {
      const j = wrap(corner - Math.round(n / T.ds), N);
      if (T.isBridge[j] || (outside === 0 && T.pitO[j])) continue;
      const d = (outside ? 1 : -1) * (T.halfWidth + T.kerb[outside][j] + T.runoff[outside][j] + 2.5);
      const x = T.x[j] + T.nx[j] * d, z = T.z[j] + T.nz[j] * d;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), mats[n]);
      board.position.set(x, T.h[j] + 1.6, z);
      board.rotation.y = -Math.atan2(T.tz[j], T.tx[j]) - Math.PI / 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), postMat);
      post.position.set(x, T.h[j] + 0.6, z);
      g.add(board, post);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Freestanding sponsor hoardings behind the gravel traps, facing the track.

function billboards(T, sponsorTex) {
  const g = new THREE.Group();
  const rows = tex.SPONSORS.length;
  const geoCache = [];
  const boardMat = new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.5 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6 });
  let n = 0;
  for (const sd of [0, 1]) {
    for (const run of runs(T.N, i => T.gravelOut[sd][i] > 0)) {
      for (let k = 20; k < run.length - 20; k += 45) {
        const i = run[k], row = tex.MODERN_SPONSORS[(n++ * 3 + 1) % tex.MODERN_SPONSORS.length];
        if (!geoCache[row]) {
          const geo = new THREE.PlaneGeometry(10, 1.6);
          const uv = geo.attributes.uv;
          for (let q = 0; q < uv.count; q++) uv.setY(q, 1 - (row + 1 - uv.getY(q)) / rows);
          geoCache[row] = geo;
        }
        const sg = sd ? 1 : -1, d = sg * (T.wall[sd][i] + 4);
        const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
        const board = new THREE.Mesh(geoCache[row], boardMat);
        board.position.set(x, T.h[i] + 2.6, z);
        // plane faces +z by default; turn it to face back towards the track
        board.lookAt(x - T.nx[i] * sg, T.h[i] + 2.6, z - T.nz[i] * sg);
        board.castShadow = true;
        g.add(board);
        for (const off of [-4, 4]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, 0.15), legMat);
          leg.position.set(x + T.tx[i] * off, T.h[i] + 1, z + T.tz[i] * off);
          g.add(leg);
        }
      }
    }
  }
  return g;
}

// Run lengths of consecutive samples where test(i) is true, as index lists.
export function runs(N, test) {
  const out = [];
  let start = 0;
  while (start < N && test(start)) start++;
  if (start === N) { const all = []; for (let i = 0; i <= N; i++) all.push(i % N); return [all]; }
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (test(i)) { if (!cur) cur = [wrap(i - 1, N)]; cur.push(i); }
    else if (cur) { cur.push(i); out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
