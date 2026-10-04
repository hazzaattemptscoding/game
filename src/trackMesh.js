// The circuit itself: tarmac, kerbs, run-off, gravel, the pit road, the
// placed barrier sections, catch fences, boards and signs, the bridge and the
// start gantry. Positions all come from track.js (and corners.js through it);
// this file only draws them. Scenery away from the track lives in scenery.js.
//
// Every mesh is tagged with a debug category (mesh.userData.debug) so the
// top-down debug view can colour it.

import * as THREE from 'three';
import { wrap, BARRIER } from './track.js';
import * as tex from './textures.js';
import { buildGroundRibbon } from './groundRibbon.js';

const FENCE_HEIGHT = 4;       // catch fence height, metres
const DECAL = 0.006;          // paint sits this far above the surface, drawn with polygonOffset so it never fights
const POWERMEDIA_SHARE = 0.15;   // share of the sponsor panels that are PowerMedia (the start gantry and bridge banners are always PowerMedia)
const SPONSOR_CHUNK = 9;      // length of one sponsor panel, metres (three 3 m wall units)

// colours for the top-down debug view
export const DEBUG_COLOURS = {
  road: 0x3a3a3a, line: 0xffffff, kerb: 0xe03030, sausage: 0xffcc00, runoff: 0xb8b0a0, rumble: 0xe85d4a,
  gravel: 0xf0b040, grass: 0x4f8f3a, pit: 0x8a5cd6, island: 0xc0a8ff, tyres: 0xff2020, armco: 0x1e5bff,
  armcoSingle: 0x66ccff, street: 0xffffff, parapet: 0xbbbbbb, pitwall: 0xff55ff, fence: 0xffa000,
  board: 0xffff00, sign: 0x00ffff, building: 0x777777,
};
const tag = (mesh, cat) => { mesh.userData.debug = cat; return mesh; };

export function buildTrackScene(T, ground) {
  const group = new THREE.Group();
  const hw = T.halfWidth;
  // A point at sample i, d metres to the side. Every ground surface takes its height from
  // T.groundAt, so neighbouring bands share their edge vertices exactly and nothing is stacked.
  // `lift` is only for real relief (T.relief) and paint decals (DECAL).
  const P = (i, d, lift = 0) => {
    const e = T.reach ? Math.sign(d) * Math.min(Math.abs(d), T.reach[d < 0 ? 0 : 1][i]) : d;   // never fold on the inside of a bend
    const x = T.x[i] + T.nx[i] * e, z = T.z[i] + T.nz[i] * e;
    return [x, T.groundAt(x, z, i) + lift, z];
  };
  const rel = (sd, i, a) => T.relief(sd, i, a);
  const G = (x, z, i) => T.groundAt(x, z, i);
  const all = [];
  for (let i = 0; i <= T.N; i++) all.push(wrap(i, T.N));
  const sOf = (i, j, idx) => (j === idx.length - 1 && i === idx[0] && j > 0 ? T.length : T.s[i]);
  const off = (factor = -2) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor * 2 });

  const sponsorTex = tex.sponsorAtlas();
  const mat = {
    road: new THREE.MeshStandardMaterial({ map: tex.tarmacTexture(), roughness: 0.9 }),
    line: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, ...off(-3) }),
    kerb: new THREE.MeshStandardMaterial({ map: tex.kerbTexture(), roughness: 0.6, ...off(-2) }),
    sausage: new THREE.MeshStandardMaterial({ map: tex.kerbTexture('#f2c200', '#111111'), roughness: 0.6 }),
    apron: new THREE.MeshStandardMaterial({ map: tex.runoffTexture(), roughness: 0.9, ...off(-2) }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.runwayTexture(), roughness: 0.95, ...off(-2) }),
    rumble: new THREE.MeshStandardMaterial({ map: tex.rumbleTexture(), roughness: 0.85, ...off(-3) }),
    grass: new THREE.MeshStandardMaterial({ map: tex.grassTexture(), roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ map: tex.gravelTexture(), roughness: 1, ...off(-2) }),
    gravelEdge: new THREE.MeshStandardMaterial({ color: 0x6e5a3c, roughness: 1, ...off(-3) }),
    pit: new THREE.MeshStandardMaterial({ map: tex.pitAsphaltTexture(), vertexColors: true, roughness: 0.85, ...off(-2) }),
    island: new THREE.MeshStandardMaterial({ map: tex.chevronTexture(), roughness: 0.8, ...off(-2) }),
    armco: new THREE.MeshStandardMaterial({ map: tex.armcoTexture(), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0x6b7075, roughness: 0.5, metalness: 0.5 }),
    fencePost: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.5 }),
    wallConcrete: new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    street: new THREE.MeshStandardMaterial({ map: tex.streetWallTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.55, side: THREE.DoubleSide }),
    tyre: new THREE.MeshStandardMaterial({ map: tex.tyreWallTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, side: THREE.DoubleSide }),
    fence: new THREE.MeshStandardMaterial({ map: tex.fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.6 }),
    garage: new THREE.MeshStandardMaterial({ map: tex.garageTexture(), roughness: 0.7, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ map: tex.facadeTexture({ wall: '#e6e3da', glass: '#24313b', frame: '#2a2d31', cols: 8, rows: 1 }), roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }),
    roof: new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
    attenuator: new THREE.MeshStandardMaterial({ map: tex.chevronTexture('#f2c200', '#111111'), roughness: 0.6 }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x2a0606, emissive: 0xff1a1a, emissiveIntensity: 0 }),
  };
  const DEBUG_OF = {
    road: 'road', line: 'line', kerb: 'kerb', sausage: 'sausage', apron: 'runoff', concrete: 'runoff', rumble: 'rumble', grass: 'grass',
    gravel: 'gravel', gravelEdge: 'gravel', pit: 'pit', island: 'island', armco: 'armco', armcoSingle: 'armcoSingle',
    wallConcrete: 'pitwall', street: 'street', parapet: 'parapet', sponsor: 'tyres', tyre: 'tyres', white: 'tyres',
    fence: 'fence', garage: 'building', glass: 'building', roof: 'building', attenuator: 'pitwall', pitOuter: 'pitwall',
  };

  // --- ground-level surfaces, laid side by side so nothing overlaps -----
  const S = {};
  const strips = name => (S[name] ||= new Strips());

  strips('road').strip(all, i => P(i, -hw), i => P(i, hw), (i, j) => sOf(i, j, all) / 8, -hw / 8, hw / 8);
  for (const g of [-1, 1]) {
    const lineRuns = g < 0 ? runs(T.N, i => !T.pitMouth[i]) : [all];
    for (const run of lineRuns) strips('line').strip(run, i => P(i, g * (hw - 0.15), DECAL), i => P(i, g * hw, DECAL), () => 0, 0, 1);
  }

  // all the ground beside the tarmac, as one ribbon with shared vertices (groundRibbon.js)
  buildGroundRibbon(T, strips, P, G);

  // paint on top of it: rumble bands across the concrete apron, dark edges on the gravel
  for (const sd of [0, 1]) {
    const g = sd ? 1 : -1;
    for (const run of runs(T.N, i => T.concrete[sd][i] && T.runoff[sd][i] > 1.8)) {
      const inner = i => hw + T.kerb[sd][i] + T.sausage[sd][i];
      for (const fraction of [1 / 3, 2 / 3]) {
        strips('rumble').strip(run, i => P(i, g * (inner(i) + T.runoff[sd][i] * fraction - 0.275), 0.006),
          i => P(i, g * (inner(i) + T.runoff[sd][i] * fraction + 0.275), 0.006),
          (i, j) => sOf(i, j, run) / 2, 0, 1);
      }
    }
    for (const run of runs(T.N, i => T.gravelOut[sd][i] > 0)) {
      for (const e of [i => T.gravelIn[sd][i], i => T.gravelOut[sd][i] - 0.35]) {
        strips('gravelEdge').strip(run, i => P(i, g * e(i), DECAL), i => P(i, g * (e(i) + 0.35), DECAL), () => 0, 0, 1);
      }
    }
  }

  // a short grass skirt at the edge of the flat ground, down into the terrain
  for (const sd of [0, 1]) {
    const g = sd ? 1 : -1;
    for (const run of runs(T.N, i => !T.isBridge[i])) {
      strips('grass').strip(run, i => P(i, g * T.wall[sd][i], -1.5), i => P(i, g * T.wall[sd][i]), (i, j) => sOf(i, j, run) / 40, 0, 0.1);
    }
  }

  // pit road lines and boxes (its surface, and the mouth that joins it to the track, are in the ground ribbon)
  for (const run of runs(T.N, i => T.pitLimiter[i] > 0)) {
    strips('line').strip(run, i => P(i, -(T.pitIn[i] + 4), DECAL), i => P(i, -(T.pitIn[i] + 4.15), DECAL), () => 0, 0, 1);
    strips('line').strip(run, i => P(i, -(T.pitOut[i] - 0.15), DECAL), i => P(i, -T.pitOut[i], DECAL), () => 0, 0, 1);
    // pit box outlines in the working lane, 7 m apart
    for (let k = 0; k < run.length - 6; k += 7) {
      const i = run[k];
      crossLine(strips('line'), T, T.s[i], 0.12, -(T.pitIn[i] + 4.2), -(T.pitOut[i] - 0.2));
    }
  }

  // start line, grid slots, sector and DRS lines, pit limiter lines
  crossLine(strips('line'), T, 0, 0.9, -hw, hw);
  for (const s of T.sectors.slice(1)) crossLine(strips('line'), T, s, 0.3, -hw, hw);
  for (const [a] of T.drs) crossLine(strips('line'), T, a, 0.3, -hw, hw);
  for (let slot = 0; slot < 12; slot++) {
    const s = T.length - 10 - slot * 8, d = (slot % 2 ? 1 : -1) * 3;
    crossLine(strips('line'), T, s, 0.15, d - 1, d + 1);
  }
  const lim = runs(T.N, i => T.pitLimiter[i] > 0)[0];
  if (lim) for (const i of [lim[0], lim[lim.length - 1]]) crossLine(strips('line'), T, T.s[i], 0.5, -T.pitIn[i], -T.pitOut[i]);

  // --- barriers, from the placed sections in track.js ------------------
  const posts = [], fencePosts = [];
  for (const b of T.barriers) {
    if (b.hidden) continue;   // containment wall directly behind an impact wall: physics only, not drawn
    const pts = b.pts, nrm = inwardNormals(T, b);
    const at = (k, back, y) => [pts[k][0] - nrm[k][0] * back, pts[k][1] + y, pts[k][2] - nrm[k][1] * back];
    const idx = pts.map((_, k) => k), len = cumulative(pts);
    const wall = (name, back, y0, y1, uScale = 4) => strips(name).strip(idx, k => at(k, back, y0), k => at(k, back, y1), k => len[k] / uScale, 0, 1);
    const cap = (name, b0, b1, y) => strips(name).strip(idx, k => at(k, b0, y), k => at(k, b1, y), () => 0, 0, 1);

    if (b.type === BARRIER.TYRES) {
      // impact zone: conveyor-faced tyre wall, double armco 1.2 m behind, catch fence 2 m behind that
      // sponsored tyre wall: conveyor-belt face with bolt heads, a sponsor wrap, a rounded top edge. The armco that
      // used to stand behind it is gone from view (the wall itself is what a car meets).
      wall('tyre', 0, 0.1, 1.78); strips('tyre').strip(idx, k => at(k, 0, 1.78), k => at(k, 0.12, 1.9), k => len[k] / 4, 0.93, 1); cap('tyre', 0.12, 1.2, 1.9);
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0.03, 0.45, 1.45, b.side);
      wall('white', 0.03, 1.6, 1.78);
      if (b.fence) {
        strips('fence').strip(idx, k => at(k, 3.3, 0.2), k => at(k, 3.3, FENCE_HEIGHT), k => len[k] / 2, 0.1, FENCE_HEIGHT / 2);
        for (let m = 0; m <= len[len.length - 1]; m += 5) fencePosts.push([...pointAt(pts, nrm, len, m, 3.3), FENCE_HEIGHT]);
        fencePosts.push([...pointAt(pts, nrm, len, len[len.length - 1], 3.3), FENCE_HEIGHT]);   // a post at both ends
      }
    } else if (b.type === BARRIER.ARMCO) {
      // the containment wall: a plain sponsored tyre wall, 1.2 m high, rounded top, no armco and no posts
      wall('tyre', 0, 0.05, 1.1); strips('tyre').strip(idx, k => at(k, 0, 1.1), k => at(k, 0.1, 1.2), k => len[k] / 4, 0.93, 1); cap('tyre', 0.1, 0.8, 1.2);
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0.02, 0.25, 0.95, b.side, 1);
    } else if (b.type === BARRIER.CONCRETE) {
      if (b.impact) {
        // tyres stacked in front of the street wall where cars arrive
        wall('tyre', -1.0, 0, 1.0); cap('tyre', -1.0, 0, 1.0);
      } else {
        wall('street', 0, -0.3, 1.4, 6);
        sponsorPoly(strips('sponsor'), pts, nrm, len, 0.03, 0.15, 1.05, b.side, 2);
        cap('wallConcrete', 0, 0.35, 1.4);
        if (b.fence) strips('fence').strip(idx, k => at(k, 0.2, 1.4), k => at(k, 0.2, 3.4), k => len[k] / 2, 0.7, 1.7);
      }
    } else if (b.type === BARRIER.PARAPET) {
      wall('parapet', 0, -1.3, 1.1, 6); cap('parapet', 0, 0.35, 1.1);
    } else if (b.type === BARRIER.PITWALL) {
      // pit wall: sponsor panels on the track face, white top, debris fence, attenuator at the start
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0, 0, 0.8, 0, 1);
      wall('white', 0, 0.8, 1.1);
      cap('white', 0, 0.6, 1.1);
      wall('wallConcrete', 0.6, 0, 1.1, 6);
      strips('fence').strip(idx, k => at(k, 0.3, 1.1), k => at(k, 0.3, 3.1), k => len[k] / 2, 0.55, 1.55);
      for (let m = 0; m <= len[len.length - 1]; m += 5) fencePosts.push([...pointAt(pts, nrm, len, m, 0.3), 3.1]);
      group.add(attenuator(pts, nrm, mat.attenuator));
    } else if (b.type === BARRIER.PITOUTER) {
      wall('pitOuter', 0, -0.2, 0.81, 6); cap('pitOuter', 0, 0.3, 0.81);
    }
  }
  mat.armcoSingle = mat.armco; mat.parapet = mat.wallConcrete; mat.pitOuter = mat.wallConcrete;

  // pit garages: rough block for now, rebuilt in part 2
  const garageRun = runs(T.N, i => T.pitGarage[i] > 0)[0];
  if (garageRun) {
    const mid = Math.floor(garageRun.length / 2), bay = garageRun.slice(Math.max(0, mid - 63), mid + 64);
    const front = i => -(T.pitOut[i] + 2), back = i => front(i) - 14, H = 9.5;
    strips('garage').strip(bay, i => P(i, front(i), 0), i => P(i, front(i), 5.5), (i, j) => sOf(i, j, bay) / 14, 0, 1);
    strips('glass').strip(bay, i => P(i, front(i) + 1.2, 6.6), i => P(i, front(i) + 1.2, H), (i, j) => sOf(i, j, bay) / 28, 0, 1);
    strips('roof').strip(bay, i => P(i, front(i) + 2.5, H), i => P(i, back(i), H), () => 0, 0, 1);
    strips('roof').strip(bay, i => P(i, front(i), 5.5), i => P(i, front(i), 6.6), () => 0, 0, 1);
    strips('wallConcrete').strip(bay, i => P(i, back(i), 0), i => P(i, back(i), H), (i, j) => sOf(i, j, bay) / 8, 0, 1);
    // concrete forecourt in front of the garages
    strips('apron').strip(bay, i => P(i, -T.pitOut[i]), i => P(i, front(i)), (i, j) => sOf(i, j, bay) / 8, 0, 1);
  }

  for (const [name, b] of Object.entries(S)) {
    const mesh = tag(new THREE.Mesh(b.geometry(), mat[name]), DEBUG_OF[name] || name);
    mesh.receiveShadow = true;
    mesh.castShadow = ['armco', 'armcoSingle', 'wallConcrete', 'street', 'sponsor', 'tyre', 'garage', 'glass', 'roof', 'parapet', 'pitOuter'].includes(name);
    if (name === 'fence') mesh.renderOrder = 2;
    group.add(mesh);
  }
  group.add(instancedPosts(posts, mat.post, 0.06, 'armco'));
  group.add(instancedPosts(fencePosts, mat.fencePost, 0.06, 'fence'));

  group.add(bridge(T, mat, ground));
  const gantryGroup = gantry(T, mat, sponsorTex);
  group.add(gantryGroup);
  group.add(furniture(T));
  group.userData.startLights = gantryGroup.userData.lights;
  return group;
}

// Per-point unit normals pointing from a barrier towards the track it guards.
function inwardNormals(T, b) {
  const pts = b.pts, g = b.side ? 1 : -1, n = [];
  const seg = k => {
    const [ax, , az, i] = pts[k], [bx, , bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    if (nx * -g * T.nx[i] + nz * -g * T.nz[i] < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  };
  for (let k = 0; k < pts.length; k++) {
    const a = k > 0 ? seg(k - 1) : seg(k), c = k < pts.length - 1 ? seg(k) : seg(k - 1);
    const x = a[0] + c[0], z = a[1] + c[1], m = Math.hypot(x, z) || 1;
    n.push([x / m, z / m]);
  }
  return n;
}

function cumulative(pts) {
  const out = [0];
  for (let k = 1; k < pts.length; k++) out.push(out[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
  return out;
}

// the point `m` metres along a polyline, `back` metres behind its face
function pointAt(pts, nrm, len, m, back) {
  let k = 0;
  while (k < len.length - 2 && len[k + 1] < m) k++;
  const t = Math.min(1, Math.max(0, (m - len[k]) / ((len[k + 1] - len[k]) || 1)));
  const lerp = (a, b) => a + (b - a) * t;
  return [lerp(pts[k][0], pts[k + 1][0]) - lerp(nrm[k][0], nrm[k + 1][0]) * back, lerp(pts[k][1], pts[k + 1][1]), lerp(pts[k][2], pts[k + 1][2]) - lerp(nrm[k][1], nrm[k + 1][1]) * back];
}

// sponsor panels along a polyline, SPONSOR_CHUNK metres each
function sponsorPoly(b, pts, nrm, len, inFront, y0, y1, side, every = 1) {
  const rows = tex.SPONSORS.length, modern = tex.MODERN_SPONSORS, total = len[len.length - 1];
  for (let m = 0, n = 0; m < total - 1; m += SPONSOR_CHUNK, n++) {
    const m1 = Math.min(total, m + SPONSOR_CHUNK), steps = Math.max(1, Math.round((m1 - m) / 1.5));
    // pick by a hash of the panel, so every brand appears; PowerMedia gets 15% of the panels
    const hash = Math.imul((n + 1) * 2654435761 ^ (Math.round(pts[0][0] * 7) + side * 977) * 40503, 2246822519) >>> 0;
    const row = hash / 4294967296 < POWERMEDIA_SHARE ? 0 : modern[(hash >>> 8) % modern.length];
    const vTop = 1 - row / rows, vBot = 1 - (row + 1) / rows, idx = [];
    for (let q = 0; q <= steps; q++) idx.push(m + (m1 - m) * q / steps);
    const flipU = side === 1;
    b.strip(idx, mm => { const p = pointAt(pts, nrm, len, mm, -inFront); return [p[0], p[1] + y0, p[2]]; },
      mm => { const p = pointAt(pts, nrm, len, mm, -inFront); return [p[0], p[1] + y1, p[2]]; },
      (mm) => { const u = (mm - m) / (m1 - m); return flipU ? 1 - u : u; }, vBot, vTop);
  }
}

function instancedPosts(list, material, radius, cat) {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 6);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
  const m4 = new THREE.Matrix4();
  list.forEach(([x, y, z, h], k) => { m4.makeScale(1, h, 1).setPosition(x, y, z); mesh.setMatrixAt(k, m4); });
  mesh.count = list.length;
  mesh.castShadow = true;
  return tag(mesh, cat);
}

// a sloped, chevron-painted crash attenuator at the start of the pit wall
function attenuator(pts, nrm, material) {
  const [x0, y0, z0] = pts[0], [x1, , z1] = pts[1];
  const dir = Math.atan2(z1 - z0, x1 - x0);
  const geo = new THREE.BoxGeometry(4, 1.1, 0.8);
  // slope the nose down to the ground
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) if (p.getX(k) < 0 && p.getY(k) > 0) p.setY(k, -0.3);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.position.set(x0 - Math.cos(dir) * 2 - nrm[0][0] * 0.3, y0 + 0.55, z0 - Math.sin(dir) * 2 - nrm[0][1] * 0.3);
  m.rotation.y = -dir;
  m.castShadow = true;
  return tag(m, 'pitwall');
}

// ---------------------------------------------------------------------------
// Distance boards and signs, as placed by track.js.

function furniture(T) {
  const g = new THREE.Group();
  const bollardMat = { white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }), orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.5 }) };
  const boardMats = {}, postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
  const signMat = new THREE.MeshStandardMaterial({ map: tex.speedSignTexture(T.layout.pit.speedLimit), roughness: 0.6, side: THREE.DoubleSide });
  for (const f of T.furniture) {
    const i = f.i, heading = Math.atan2(T.tz[i], T.tx[i]);
    if (f.type === 'board') {
      boardMats[f.value] ||= new THREE.MeshStandardMaterial({ map: tex.distanceTexture(f.value), roughness: 0.6, side: THREE.DoubleSide });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), boardMats[f.value]);
      board.position.set(f.x, f.y + 1.6, f.z);
      // faces oncoming cars, angled 10 degrees towards the track
      board.rotation.y = -heading - Math.PI / 2 + Math.sign(f.d) * 10 * Math.PI / 180;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.08), postMat);
      post.position.set(f.x, f.y + 0.6, f.z);
      g.add(tag(board, 'board'), tag(post, 'board'));
    } else if (f.type === 'bollard') {
      // a flexible white post with an orange band, standing on the kerb
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8), bollardMat.white);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0625, 0.0625, 0.18, 8), bollardMat.orange);
      post.position.set(f.x, f.y + 0.45, f.z); band.position.set(f.x, f.y + 0.72, f.z);
      post.castShadow = true;
      g.add(tag(post, 'sign'), tag(band, 'sign'));
    } else if (f.type === 'sign') {
      const sign = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), signMat);
      sign.position.set(f.x, f.y + 2.4, f.z);
      sign.rotation.y = -heading - Math.PI / 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), postMat);
      pole.position.set(f.x, f.y + 1.75, f.z);
      g.add(tag(sign, 'sign'), tag(pole, 'sign'));
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Strip builder: quads between two edge lines, merged into one geometry.

class Strips {
  constructor() { this.pos = []; this.uv = []; this.ind = []; this.col = null; }

  // a(i), b(i): world positions of the two edges at sample i.
  // u(i, j): texture coordinate along the strip. va, vb: across (number or function of i).
  strip(idx, a, b, u, va, vb, colour) {
    if (idx.length < 2) return;
    const base = this.pos.length / 3;
    const V = (v, i) => (typeof v === 'function' ? v(i) : v);
    idx.forEach((i, j) => {
      this.pos.push(...a(i), ...b(i));
      if (colour) { const c = colour(i, j); (this.col ||= []).push(...c, ...c); }
      const uu = u(i, j);
      this.uv.push(uu, V(va, i), uu, V(vb, i));
    });
    // flat strips must face up: choose the winding for every quad on its own
    // (a run can start or end with a zero-width quad, which says nothing)
    const p = this.pos;
    for (let j = 1; j < idx.length; j++) {
      const k = base + j * 2, o = (k - 2) * 3;
      const ex = p[o + 3] - p[o], ey = p[o + 4] - p[o + 1], ez = p[o + 5] - p[o + 2];   // a -> b, previous sample
      const fx = p[o + 6] - p[o], fz = p[o + 8] - p[o + 2];                             // a(prev) -> a(this)
      const flat = Math.abs(ey) < 0.5 * Math.hypot(ex, ez) + 1e-6;
      const flip = flat && (ez * fx - ex * fz) < 0;
      if (flip) this.ind.push(k - 2, k, k - 1, k - 1, k, k + 1);
      else this.ind.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }

  // Like strip(), but cut across its width into pieces no wider than `maxWidth`, each corner taking
  // its height from `ground(x, z, i)`. A wide band drawn as one quad would cut a straight chord
  // through ground that bends (a bank beside the circuit, a hill beyond the run-off).
  band(idx, a, b, u, va, vb, ground, colour, maxWidth = 6) {
    if (idx.length < 2) return;
    let widest = 0;
    for (const i of idx) { const p = a(i), q = b(i); widest = Math.max(widest, Math.hypot(q[0] - p[0], q[2] - p[2])); }
    const n = Math.max(1, Math.ceil(widest / maxWidth)), V = (v, i) => (typeof v === 'function' ? v(i) : v);
    const at = (i, t) => {
      const p = a(i), q = b(i), x = p[0] + (q[0] - p[0]) * t, z = p[2] + (q[2] - p[2]) * t;
      return [x, t === 0 ? p[1] : t === 1 ? q[1] : ground(x, z, i), z];
    };
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      this.strip(idx, i => at(i, t0), i => at(i, t1), u, i => V(va, i) + (V(vb, i) - V(va, i)) * t0, i => V(va, i) + (V(vb, i) - V(va, i)) * t1, colour);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.ind);
    g.computeVertexNormals();
    return g;
  }
}

// sponsor panels for straight runs are drawn by sponsorPoly above

function crossLine(b, T, s, width, d0, d1, lift = DECAL) {
  const i0 = wrap(Math.round(s / T.ds), T.N), idx = [];
  for (let k = 0; k <= Math.max(1, Math.round(width / T.ds)); k++) idx.push(wrap(i0 + k, T.N));
  const y = (i, d) => T.groundAt(T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d, i) + lift;
  b.strip(idx, i => [T.x[i] + T.nx[i] * d0, y(i, d0), T.z[i] + T.nz[i] * d0], i => [T.x[i] + T.nx[i] * d1, y(i, d1), T.z[i] + T.nz[i] * d1], () => 0, 0, 1);
}

// ---------------------------------------------------------------------------
// Bridge: deck underside, banners and pillars. Pillars never stand on a road.

function bridge(T, mat, ground) {
  const g = new THREE.Group();
  const idx = [];
  for (let i = 0; i < T.N; i++) if (T.isBridge[i]) idx.push(i);
  if (!idx.length) return g;
  const b = new Strips();
  const P = (i, d, lift) => {
    const x = T.x[i] + T.nx[i] * d;
    const z = T.z[i] + T.nz[i] * d;
    return [x, T.groundAt(x, z, i) + lift, z];
  };
  b.strip(idx, i => P(i, -T.wall[0][i] - 0.45, -1.3), i => P(i, T.wall[1][i] + 0.45, -1.3), () => 0, 0, 1);
  // deck edge beams carry a big PowerMedia banner on the outside faces
  const banners = new Strips();
  for (const sd of [0, 1]) {
    const gg = sd ? 1 : -1;
    const mid = idx.slice(Math.floor(idx.length * 0.25), Math.floor(idx.length * 0.75));
    const len = mid.length - 1;
    banners.strip(mid, i => P(i, gg * (T.wall[sd][i] + 0.5), -1.25), i => P(i, gg * (T.wall[sd][i] + 0.5), 1.0),
      (i, j) => (sd ? j / len : 1 - j / len), 1 - 1 / tex.SPONSORS.length, 1);
  }
  const deck = tag(new THREE.Mesh(b.geometry(), mat.concrete), 'parapet');
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
    if (T.pitOut[i] && d < 0 && -d > T.pitIn[i] - margin && -d < T.pitOut[i] + margin) return true;
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
  boardTex.repeat.set(1, 1 / tex.SPONSORS.length);
  boardTex.offset.set(0, 1 - 1 / tex.SPONSORS.length);
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
  const x = T.x[i], z = T.z[i];
  g.position.set(x, T.groundAt(x, z, i), z);
  g.rotation.y = -Math.atan2(T.tz[i], T.tx[i]);
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
    // only samples that pass the test: a band must never be closed with a sample where its edges
    // are zero, which would stretch it across the road to the centreline
    if (test(i)) { if (!cur) cur = []; cur.push(i); }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
