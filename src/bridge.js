// Roundel Bridge: the deck carries the circuit over the main straight.
//
// Drawn here: the soffit and edge girders, the PowerMedia banners on the girders, expansion joints on the deck,
// a debris fence along the parapets, piers (a column at each deck edge, joined by a cross beam) on concrete
// footings that run down into the real terrain, abutments at both ends, and tyre stacks round every pier base
// with a hazard-striped collar. Piers never stand on a road.

import * as THREE from 'three';
import { bannerVideo } from './bannerVideo.js';
import * as tex from './textures.js';
import { Kit, trackPoint } from './meshKit.js';
import { wallClearance } from './grandstands.js';

const GIRDER = 2.4;       // depth of the edge girders below the deck surface
const SOFFIT = 1.3;       // underside of the slab below the deck surface
const PIER_EVERY = 12;    // metres between piers along the deck
const COL_A = 1.2, COL_L = 1.6;   // column size along the deck and across it
const TYRE_R = 0.36, TYRE_H = 0.26;

// A pier needs 6 m of room beyond the containment wall of every part of the circuit and the pit lane.
export const pierBlocked = T => (x, z) => {
  if (wallClearance(T, x, z, true) < 6) return true;
  for (let j = 0; j < T.N; j++) {
    if (T.isBridge[j]) continue;
    const dx = x - T.x[j], dz = z - T.z[j];
    if (dx * dx + dz * dz > 140 * 140) continue;
    if (Math.abs(dx * T.tx[j] + dz * T.tz[j]) > 1) continue;
    const lat = dx * T.nx[j] + dz * T.nz[j];
    const room = (lat < 0 ? Math.max(T.wall[0][j], T.pitOut[j] ? T.pitOut[j] + 16 : 0) : T.wall[1][j]) + 6;
    if (Math.abs(lat) < room) return true;
  }
  return false;
};

// Where the piers go: [{ i, sd, x, z, base, top }]. Never on a road, never where there is no room under the deck.
export function planPiers(T, ground, blocked) {
  const idx = [];
  for (let i = 0; i < T.N; i++) if (T.isBridge[i]) idx.push(i);
  const out = [];
  for (let k = PIER_EVERY; k < idx.length - PIER_EVERY / 2; k += PIER_EVERY) {
    const i = idx[k];
    for (const sd of [0, 1]) {
      const d = (sd ? 1 : -1) * (T.wall[sd][i] - 0.2);
      const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
      if (blocked(x, z)) continue;
      const base = Math.min(ground.meshHeight(x, z), ground.meshHeight(x + 1, z), ground.meshHeight(x - 1, z), ground.meshHeight(x, z + 1), ground.meshHeight(x, z - 1)), top = T.h[i] - GIRDER;
      if (top - base < 1.2) continue;
      out.push({ i, sd, x, z, base, top, d });
    }
  }
  return out;
}


export function buildBridge(T, ground, mat, { Strips }) {
  const g = new THREE.Group();
  const idx = [];
  for (let i = 0; i < T.N; i++) if (T.isBridge[i]) idx.push(i);
  if (!idx.length) return g;

  const concrete = new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.9, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x25272a, roughness: 0.85 });
  const hazard = new THREE.MeshStandardMaterial({ map: tex.chevronTexture('#f2c200', '#16171a'), roughness: 0.7 });
  const tyreMat = new THREE.MeshStandardMaterial({ map: tex.tyreWallTexture(), roughness: 0.85 });
  const tyreWhite = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7 });

  const P = (i, d, lift) => {
    const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    return [x, T.groundAt(x, z, i) + lift, z];
  };

  // --- soffit, girders and banners ------------------------------------------------------------------------------
  const body = new Strips();
  const edge = i => T.wall[0][i] + 0.45, edge1 = i => T.wall[1][i] + 0.45;
  const u = (i, j) => T.s[idx[j]] / 6;
  body.strip(idx, i => P(i, -edge(i), -SOFFIT), i => P(i, edge1(i), -SOFFIT), u, 0, 1);
  for (const sd of [0, 1]) {
    const gg = sd ? 1 : -1, w = i => T.wall[sd][i];
    body.strip(idx, i => P(i, gg * (w(i) - 0.7), -SOFFIT), i => P(i, gg * (w(i) - 0.7), -GIRDER), u, 0, 0.2);   // inner face of the girder
    body.strip(idx, i => P(i, gg * (w(i) - 0.7), -GIRDER), i => P(i, gg * (w(i) + 0.5), -GIRDER), u, 0, 0.3);   // its underside
    body.strip(idx, i => P(i, gg * (w(i) + 0.5), -GIRDER), i => P(i, gg * (w(i) + 0.5), -0.1), u, 0, 0.5);      // outer face
  }
  const deck = new THREE.Mesh(body.geometry(), concrete);
  deck.castShadow = deck.receiveShadow = true;
  deck.userData.debug = 'parapet';
  g.add(deck);

  const banners = new Strips();
  const mid = idx.slice(Math.floor(idx.length * 0.25), Math.floor(idx.length * 0.75));
  const len = mid.length - 1;
  for (const sd of [0, 1]) {
    const gg = sd ? 1 : -1;
    banners.strip(mid, i => P(i, gg * (T.wall[sd][i] + 0.52), -GIRDER + 0.15), i => P(i, gg * (T.wall[sd][i] + 0.52), -0.1),
      (i, j) => (sd ? j / len : 1 - j / len), 1 - 1 / tex.SPONSORS.length, 1);
  }
  const ban = new THREE.Mesh(banners.geometry(), mat.sponsor);
  ban.userData.debug = 'tyres';
  g.add(ban);

  // The PowerMedia loop (3840 x 128, 30:1) replaces the still board once the video can play. It is a looping muted
  // video, so it starts without a click; if the file is missing (the single-file artifact) or the browser refuses it,
  // the still board stays.
  const videoBanners = new Strips();
  for (const sd of [0, 1]) {
    const gg = sd ? 1 : -1;
    videoBanners.strip(mid, i => P(i, gg * (T.wall[sd][i] + 0.52), -GIRDER + 0.15), i => P(i, gg * (T.wall[sd][i] + 0.52), -0.1),
      (i, j) => (sd ? j / len : 1 - j / len), 0, 1);
  }
  const videoTex = bannerVideo(() => { ban.visible = false; videoMesh.visible = true; });
  const videoMesh = new THREE.Mesh(videoBanners.geometry(), new THREE.MeshBasicMaterial({ map: videoTex || null, toneMapped: false }));
  videoMesh.visible = false;
  videoMesh.userData.debug = 'tyres';
  g.add(videoMesh);

  // roundel painted under the deck over the main straight
  const m = idx[Math.floor(idx.length / 2)];
  const width = T.wall[0][m] + T.wall[1][m];
  const roundel = new THREE.Mesh(new THREE.PlaneGeometry(width - 1.2, width - 1.2), new THREE.MeshStandardMaterial({ map: tex.roundelTexture(), roughness: 0.8 }));
  roundel.position.set(T.x[m] + T.nx[m] * (T.wall[1][m] - T.wall[0][m]) / 2, T.h[m] - SOFFIT - 0.03, T.z[m] + T.nz[m] * (T.wall[1][m] - T.wall[0][m]) / 2);
  roundel.rotation.set(Math.PI / 2, 0, 0);
  g.add(roundel);

  // --- deck surface details: expansion joints, a debris fence on top of the parapets -------------------------------
  const joints = new Strips();
  const first = T.bridge[0], last = T.bridge[1];
  const jointS = [first + 0.3, last - 0.6];
  for (let s = first + 30; s < last - 20; s += 30) jointS.push(s);
  for (const s of jointS) {
    const i0 = Math.round(s / T.ds), run = [i0, i0 + 1];
    joints.strip(run, i => P(i, -T.wall[0][i], 0.012), i => P(i, T.wall[1][i], 0.012), () => 0, 0, 1);
  }
  const jm = new THREE.Mesh(joints.geometry(), dark);
  jm.material = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  jm.receiveShadow = true;
  jm.userData.debug = 'line';
  g.add(jm);

  const fence = new Strips(), posts = new Kit();
  const run = idx.slice(4, idx.length - 4);
  for (const sd of [0, 1]) {
    const gg = sd ? 1 : -1;
    fence.strip(run, i => P(i, gg * (T.wall[sd][i] + 0.17), 1.1), i => P(i, gg * (T.wall[sd][i] + 0.17), 2.4), (i, j) => T.s[run[j]] / 2, 0, 1.3 / 1);
    for (let k = 0; k < run.length; k += 5) {
      const i = run[k], p = P(i, gg * (T.wall[sd][i] + 0.17), 0);
      posts.box('post', 0.08, 1.4, 0.08, p[0], p[1] + 1.8, p[2]);
    }
  }
  const fenceMesh = new THREE.Mesh(fence.geometry(), mat.fence);
  fenceMesh.renderOrder = 2;
  fenceMesh.userData.debug = 'fence';
  g.add(fenceMesh);

  // --- abutments: a wall across the deck at both ends, and where the deck leaves the embankment to span the road -----
  const abut = new Kit();
  const blocked = pierBlocked(T), ends = [[first, 1], [last, -1]];
  const edgeAt = (from, dir) => {
    for (let k = 0; k < idx.length; k++) {
      const i = dir > 0 ? idx[k] : idx[idx.length - 1 - k];
      if (k < 3) continue;
      for (const sd of [0, 1]) {
        const d = (sd ? 1 : -1) * (T.wall[sd][i] - 0.2);
        if (blocked(T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d)) return T.s[i] - dir * 1.5;
      }
    }
    return null;
  };
  const tyres = [];
  const spots = [...ends.map(e => [...e, false])];
  for (const [s0, dir] of ends) { const e = edgeAt(s0, dir); if (e !== null) spots.push([e, dir, true]); }
  const faces = [];
  for (const [s, dir, onRoadSide] of spots) {
    const c = trackPoint(T, s, 0), i = c.i, yaw = -Math.atan2(c.tz, c.tx);
    const wL = T.wall[0][i] + 0.5, wR = T.wall[1][i] + 0.5;
    const lowAt = (lat, along) => { const p = trackPoint(T, s + dir * along, lat); return ground.meshHeight(p.x, p.z); };
    let low = Infinity;
    for (const lat of [-wL, -wL / 2, 0, wR / 2, wR]) for (const along of [-0.8, 0.8]) low = Math.min(low, lowAt(lat, along));
    low -= 0.6;
    const top = T.h[i] - SOFFIT;
    if (top - low < 0.4) continue;
    const p = trackPoint(T, s, (wR - wL) / 2);
    abut.box('concrete', 1.6, top - low, wL + wR, p.x, (top + low) / 2, p.z, yaw, 6);
    faces.push({ s, dir, i, yaw, wL, wR });
    // tyre stacks along the foot of a wall that faces the road: two rows, only where the ground is flat enough to stand on
    if (onRoadSide) {
      const flatAt = (lat, along) => {
        const q = trackPoint(T, s + dir * along, lat);
        let lo = Infinity, hi = -Infinity;
        for (const [ax, az] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) { const y = ground.meshHeight(q.x + ax, q.z + az); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        return { q, lo, ok: hi - lo < 0.3 };
      };
      for (let lat = -wL + 0.6; lat <= wR - 0.6; lat += 0.74) {
        let along = 1.0;
        while (along < 16 && !flatAt(lat, along).ok) along += 0.5;
        if (along >= 16) continue;
        for (let row = 0; row < 2; row++) { const f = flatAt(lat, along + row * 0.74); if (f.ok) tyres.push([f.q.x, f.q.z, f.lo]); }
      }
    }
  }
  g.add(abut.build({ concrete }));
  g.add(posts.build({ post: dark }));

  // --- piers ------------------------------------------------------------------------------------------------------
  const piers = planPiers(T, ground, pierBlocked(T));
  const pk = new Kit();
  const stackRing = (cx, cz, yaw, base) => {
    // a rectangle of tyre stacks round the footing, three high, 0.75 m apart, the corners rounded off
    const hx = 2.1, hz = 2.5, step = 0.74, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const add = (lx, lz) => {
      const x = cx + lx * cs + lz * sn, z = cz - lx * sn + lz * cs;
      tyres.push([x, z, base]);
    };
    for (let lx = -hx; lx <= hx + 1e-6; lx += step) { add(lx, -hz); add(lx, hz); }
    for (let lz = -hz + step; lz < hz - 1e-6; lz += step) { add(-hx, lz); add(hx, lz); }
  };
  for (const p of piers) {
    const i = p.i, yaw = -Math.atan2(T.tz[i], T.tx[i]);
    const foot = p.base - 0.7, collarTop = p.base + 1.0;
    // footing: a block that runs down into the terrain
    const f = { x: p.x, z: p.z };
    pk.column('concrete', 2.2, 2.6, foot, p.base + 0.35, f.x, f.z, yaw, 6);
    // the column, with a slight batter: wider at the cap
    pk.column('concrete', COL_A, COL_L, p.base + 0.3, p.top - 0.2, f.x, f.z, yaw, 6);
    pk.column('concrete', COL_A + 0.5, COL_L + 0.4, p.top - 0.9, p.top, f.x, f.z, yaw, 6);
    // hazard collar at the base, facing the traffic
    pk.column('hazard', COL_A + 0.12, COL_L + 0.12, p.base + 0.3, collarTop, f.x, f.z, yaw, 0);
    stackRing(f.x, f.z, yaw, p.base - 0.1);
    // cross beam to the pier on the other side, under the soffit
    if (p.sd === 1) {
      const q = piers.find(o => o.i === p.i && o.sd === 0);
      if (q) {
        const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2, span = Math.hypot(p.x - q.x, p.z - q.z);
        pk.box('concrete', 1.0, 0.9, span, cx, p.top - 0.45, cz, yaw, 6);
      }
    }
  }
  g.add(pk.build({ concrete, hazard }));

  // tyre stacks, instanced: 3 high, black with the conveyor-belt tyre face, top tyre white
  if (tyres.length) {
    const profile = [[0.16, 0], [TYRE_R * 0.97, 0.02], [TYRE_R, TYRE_H * 0.5], [TYRE_R * 0.97, TYRE_H - 0.02], [0.16, TYRE_H]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(profile, 12);
    const black = new THREE.InstancedMesh(geo, tyreMat, tyres.length * 2), white = new THREE.InstancedMesh(geo, tyreWhite, tyres.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
    let nb = 0, nw = 0;
    tyres.forEach(([x, z, base], k) => {
      const yaw = ((k * 2654435761) >>> 0) / 4294967296 * 6.28;
      for (let h = 0; h < 3; h++) {
        e.set(0, yaw + h, 0);
        m4.compose(new THREE.Vector3(x, base + h * TYRE_H, z), q.setFromEuler(e), s1);
        if (h < 2) black.setMatrixAt(nb++, m4); else white.setMatrixAt(nw++, m4);
      }
    });
    black.count = nb; white.count = nw;
    black.castShadow = white.castShadow = true;
    black.receiveShadow = white.receiveShadow = true;
    black.userData.debug = white.userData.debug = 'tyres';
    g.add(black, white);
  }
  g.userData.piers = piers;
  return g;
}
