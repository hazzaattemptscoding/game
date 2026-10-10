// The marshals who stand beside the circuit: a station every 70 m, outside of the wall on the outside of the bend, with two marshals 1.2 m
// apart in orange overalls and white helmets facing the track. One in three marshals holds a flag in the colour of the nearest light panel's
// state, and the second marshal of each station holds a fire extinguisher. Three draw calls (the people, the flags, the extinguishers).
//   planStations(T, { obstacles, blockers }, posts)   [{ s, side, x, z, tx, tz, yaw, post }] (tools/minisectors.js checks them)
//   createCrew(T, ground, stations)                     { meshes, paint(colourOfPost) }  paint recolours the flags: colourOfPost(i) is a hex colour
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wallClearance } from './grandstands.js';
import { trackPoint } from './meshKit.js';
import { standingCrowd } from './crowd.js';

export const CREW_FAR = 260;   // metres: beyond this a marshal is a few pixels, so the crew is not drawn
export const STATION_EVERY = 70, PAIR_GAP = 1.2;
const BEHIND = 2.5, BARRIER = 2.5, FROM_POST = 3;
const SLIDES = [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30];

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

export function planStations(T, { obstacles = [], blockers = [] } = {}, posts = []) {
  const near = (i, f) => { for (let j = -10; j <= 10; j++) if (f(((i + j) % T.N + T.N) % T.N)) return true; return false; };
  const free = (x, z) => {
    if (wallClearance(T, x, z) < BEHIND) return false;
    for (const sg of T.segs) if (segDist(x, z, sg) < BARRIER) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 2) return false;
    for (const o of obstacles) { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; if (Math.abs(a) < o.len / 2 + 3 && b > -4 && b < o.depth + 3) return false; }
    for (const p of posts) if (Math.hypot(x - p.x, z - p.z) < FROM_POST + PAIR_GAP) return false;
    return true;
  };
  const out = [], count = Math.floor(T.length / STATION_EVERY);
  for (let k = 0; k < count; k++) {
    let found = null;
    for (const slide of SLIDES) {
      const s = 25 + k * STATION_EVERY + slide, p = trackPoint(T, s, 0), a = trackPoint(T, s - 25, 0), b = trackPoint(T, s + 25, 0);
      if (near(p.i, j => T.isBridge[j])) continue;
      const turn = (b.tx - a.tx) * p.nx + (b.tz - a.tz) * p.nz;
      const sides = Math.abs(turn) < 0.02 ? [1, 0] : turn > 0 ? [0, 1] : [1, 0];
      for (const side of sides) {
        if (side === 0 && near(p.i, j => T.pitOut[j] > 0 || T.pitMouth[j])) continue;
        const sg = side ? 1 : -1;
        for (let off = 3; off <= 9 && !found; off++) {
          const q = trackPoint(T, s, sg * (T.wall[side][p.i] + off));
          if (!free(q.x, q.z) || !free(q.x + p.tx * PAIR_GAP, q.z + p.tz * PAIR_GAP) || !free(q.x - p.tx * PAIR_GAP, q.z - p.tz * PAIR_GAP)) continue;
          found = { s, side, x: q.x, z: q.z, tx: p.tx, tz: p.tz, yaw: Math.atan2(-sg * p.nx, -sg * p.nz) };
        }
        if (found) break;
      }
      if (found) break;
    }
    // the crowded stretch round s 958 to 1000 is at the triangle budget: no marshals added there
    if (found && found.s > 930 && found.s < 1030) found = null;
    if (found) {
      // the light panel whose state this station's flag shows: the nearest along the road
      let best = -1, bd = Infinity;
      posts.forEach((q, i) => { const d = (((found.s - q.s) % T.length) + T.length) % T.length, e = Math.min(d, T.length - d); if (e < bd) { bd = e; best = i; } });
      found.post = best;
      out.push(found);
    }
  }
  return out;
}

// the people, the flags and the extinguishers as three instanced meshes
// split into chunks of the lap, so a view only draws (and counts) the marshals near it: an instanced mesh draws every instance whenever
// any of it is in view
export const CHUNK = 140;
export function createCrew(T, ground, stations) {
  const chunks = new Map();
  stations.forEach((st, k) => { const c = Math.floor(st.s / CHUNK); if (!chunks.has(c)) chunks.set(c, []); chunks.get(c).push([st, k]); });
  const built = [...chunks.values()].map(list => crewChunk(T, ground, list));
  return { meshes: built.flatMap(b => b.meshes), paint: f => built.forEach(b => b.paint(f)), people: stations.length * 2, flags: built.reduce((a, b) => a + b.flags, 0), extinguishers: stations.length };
}

function crewChunk(T, ground, list) {
  const ground0 = (x, z) => (ground ? ground.surfaceHeight(x, z) : 0);
  const people = [], gear = [];
  list.forEach(([st, k]) => {
    for (let j = 0; j < 2; j++) {
      const a = (j ? -0.5 : 0.5) * PAIR_GAP, x = st.x + st.tx * a, z = st.z + st.tz * a, n = k * 2 + j;
      people.push([x, ground0(x, z), z, 0xff6a13, ((n * 0.37) % 1), st.yaw]);
      gear.push({ x, z, y: ground0(x, z), yaw: st.yaw, flag: n % 3 === 0, extinguisher: j === 1, post: st.post });
    }
  });
  const meshes = [], mesh = standingCrowd(people);
  if (mesh) { mesh.userData.maxDist = CREW_FAR; meshes.push(mesh); }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), C = new THREE.Color();
  // flags: a 1.2 m stick held at the right hand with a 0.5 x 0.35 m flag at its top
  const flagged = gear.filter(g => g.flag), pos = [], col = [], idx = [];
  const addQuad = (a, b, c, d, v) => { const n = pos.length / 3; for (const q of [a, b, c, d]) { pos.push(...q); col.push(v, v, v); } idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  const sx = 0.015;
  {   // the stick, dark
    const x0 = -sx, x1 = sx, z0 = -sx, z1 = sx, y0 = 0, y1 = 1.2;
    addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.12); addQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.12);
    addQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.12); addQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.12);
  }
  addQuad([sx, 0.85, 0], [0.5, 0.85, 0], [0.5, 1.2, 0], [sx, 1.2, 0], 1); addQuad([sx, 0.85, 0], [sx, 1.2, 0], [0.5, 1.2, 0], [0.5, 0.85, 0], 1);   // the flag, seen from both sides
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); fg.setIndex(idx);
  let flags = null;
  if (flagged.length) {
    flags = new THREE.InstancedMesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), flagged.length);
    flagged.forEach((g, k) => {
      Q.setFromAxisAngle(UP, g.yaw); P.set(0.38, 0.5, 0.12).applyQuaternion(Q);
      M.compose(P.set(g.x + P.x, g.y + P.y, g.z + P.z), Q, ONE);
      flags.setMatrixAt(k, M); flags.setColorAt(k, C.setHex(0xe6e6dc));
    });
    flags.instanceMatrix.needsUpdate = true; flags.userData.debug = 'building'; flags.userData.maxDist = CREW_FAR; flags.castShadow = false;
    meshes.push(flags);
  }
  // extinguishers: a red 0.1 x 0.35 x 0.1 m cylinder box with a dark head, carried at the left hand
  const held = gear.filter(g => g.extinguisher);
  let ext = null;
  if (held.length) {
    const eg = new THREE.BoxGeometry(0.1, 0.35, 0.1); eg.translate(0, 0.175, 0);
    const head = new THREE.BoxGeometry(0.06, 0.06, 0.12); head.translate(0, 0.38, 0);
    const ecol = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const merged = mergeGeometries([ecol(eg, 0xc8161c), ecol(head, 0x1b1e21)]);
    ext = new THREE.InstancedMesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }), held.length);
    held.forEach((g, k) => {
      Q.setFromAxisAngle(UP, g.yaw);
      P.set(-0.36, 0.3, 0.08).applyQuaternion(Q);
      M.compose(P.set(g.x + P.x, g.y + P.y, g.z + P.z), Q, ONE);
      ext.setMatrixAt(k, M);
    });
    ext.instanceMatrix.needsUpdate = true; ext.userData.debug = 'building'; ext.userData.maxDist = CREW_FAR; ext.castShadow = false;
    meshes.push(ext);
  }
  for (const m of meshes) m.computeBoundingSphere();
  const paint = colourOfPost => {
    if (!flags) return;
    flagged.forEach((g, k) => flags.setColorAt(k, C.setHex(colourOfPost(g.post))));
    flags.instanceColor.needsUpdate = true;
  };
  return { meshes, paint, people: people.length, flags: flagged.length, extinguishers: held.length };
}
