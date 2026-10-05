// Floodlight masts round the circuit and along the pit and start straight. The lamp heads are emissive and glow at dusk and
// night (src/lamps.js sets the level from the time of day); there is no real light per mast. Each mast also gets a glow
// sprite and a pool of light draped on the ground in front of it (vertex colours, additive), so the road looks lit.
//
// planMasts() picks the places as numbers only (tools/venue.js checks them): behind the containment wall, off every barrier
// line, clear of buildings and stands. buildFloodlights() draws them: 4 draw calls (poles, lamp heads, glow, pools).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { trackPoint, hash01 } from './meshKit.js';
import { wallClearance } from './grandstands.js';
import { lampMaterial, onLampLevel, onTopDown, light } from './lamps.js';

export const MAST_H = 26;        // metres to the lamp frame
export const MAST_BEHIND = 7;    // metres behind the containment wall, at least
export const MAST_BARRIER = 6;   // metres from any barrier line, at least
const POOL_R = 24, POOL_AHEAD = 20;

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

// is a spot free for a mast (the same discipline as the props: wall, barriers, blockers, stands)
export function mastFree(T, blockers, stands, x, z) {
  if (wallClearance(T, x, z) < MAST_BEHIND) return false;
  for (const sg of T.segs) if (segDist(x, z, sg) < MAST_BARRIER) return false;
  for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 4) return false;
  for (const o of stands) {
    const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
    if (Math.abs(a) < o.len / 2 + 5 && b > -8 && b < o.depth + 5) return false;
  }
  return true;
}

// Masts: every ~150 m alternating sides round the lap, every 48 m along the pit straight (behind the garages) and the start straight.
export function planMasts(T, blockers, stands, pitS = T.pitRange) {
  const masts = [], taken = [];
  const near = (x, z, m) => taken.some(p => Math.hypot(p.x - x, p.z - z) < m);
  const tryAt = (s, side, offsets, minGap) => {
    const c = trackPoint(T, s, 0), i = c.i;
    if (T.isBridge[i]) return false;
    for (const off of offsets) {
      if (side === 0 && T.pitOut[i] && off < 0) continue;
      const wall = Math.max(T.wall[side][i], side === 0 && T.pitOut[i] ? T.pitOut[i] + 2 : 0);
      const sg = side ? 1 : -1, p = trackPoint(T, s, sg * (wall + off));
      if (near(p.x, p.z, minGap) || !mastFree(T, blockers, stands, p.x, p.z)) continue;
      const m = { x: p.x, z: p.z, s, side, i, yaw: Math.atan2(sg * p.nz, -sg * p.nx), toX: -sg * p.nx, toZ: -sg * p.nz };   // the heads face the track: local +x points at it
      masts.push(m); taken.push(m);
      return true;
    }
    return false;
  };
  // pit and start straight first (they claim their places), pit side behind the garages
  for (let s = T.length - 140; s < T.length + 330; s += 48) {
    tryAt(s, 0, [26, 31, 38], 36);
    tryAt(s + 24, 1, [10, 14, 20], 36);
  }
  for (let s = 380, k = 0; s < T.length - 150; s += 150, k++) {
    const side = k % 2;
    if (!tryAt(s, side, [10, 15, 22], 70)) tryAt(s + 40, 1 - side, [10, 15, 22], 70);
  }
  return masts;
}

const steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.6 });

export function buildFloodlights(T, ground, masts) {
  const g = new THREE.Group();
  if (!masts.length) return g;
  // geometry of one mast in its own frame: +x towards the track, y up from the base
  const pole = new THREE.CylinderGeometry(0.18, 0.4, MAST_H, 8); pole.translate(0, MAST_H / 2, 0);
  const frame = new THREE.BoxGeometry(0.3, 3.4, 5.6); frame.translate(0.5, MAST_H + 0.9, 0);
  const arm = new THREE.BoxGeometry(1.0, 0.25, 0.25); arm.translate(0.2, MAST_H - 0.4, 0);
  const poleAll = mergeGeometries([pole, frame, arm]);
  const lamps = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const l = new THREE.BoxGeometry(0.4, 0.62, 0.8);
    l.rotateZ(-0.38);   // tilted down towards the track
    l.translate(0.9, MAST_H + 2.2 - r * 0.85, (c - 2) * 1.05);
    lamps.push(l);
  }
  const lampAll = mergeGeometries(lamps);
  const poles = new THREE.InstancedMesh(poleAll, steel, masts.length);
  const heads = new THREE.InstancedMesh(lampAll, lampMaterial({ color: 0xdfe3e6, emissive: 0xfff0c8, roughness: 0.3 }, 5.5), masts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const glowPos = [], poolPos = [], poolCol = [], poolIdx = [];
  const N = 9, tmpLoc = {};
  masts.forEach((m, k) => {
    const y = ground.meshHeight(m.x, m.z) - 0.2;
    e.set(0, m.yaw, 0);
    m4.compose(new THREE.Vector3(m.x, y, m.z), q.setFromEuler(e), one);
    poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
    glowPos.push(m.x + m.toX * 1.6, y + MAST_H + 1.4, m.z + m.toZ * 1.6);
    // pool: a grid draped on the ground ahead of the mast, brightest at the centre
    const cx = m.x + m.toX * POOL_AHEAD, cz = m.z + m.toZ * POOL_AHEAD, base = poolPos.length / 3;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const dx = (a / (N - 1) * 2 - 1) * POOL_R, dz = (b / (N - 1) * 2 - 1) * POOL_R, x = cx + dx, z = cz + dz;
      const f = Math.max(0, 1 - Math.hypot(dx, dz) / POOL_R), w = f * f;
      // the road surface sits a little above the ground height under it, so near the road the pool is lifted clear of it
      // (otherwise the road hides the pool and the light stops dead at the road edge)
      const loc = T.locate(x, z, m.i, tmpLoc), lift = 0.32 * (1 - Math.min(1, Math.max(0, (Math.abs(loc.d) - T.hw[loc.i] - 0.5) / 4)));
      poolPos.push(x, Math.max(ground.height(x, z), ground.meshHeight(x, z)) + 0.14 + lift, z);
      poolCol.push(0.62 * w, 0.5 * w, 0.3 * w);
      if (a && b) { const i0 = base + (a - 1) * N + b - 1, i1 = i0 + 1, i2 = base + a * N + b - 1, i3 = i2 + 1; poolIdx.push(i0, i2, i1, i1, i2, i3); }
    }
  });
  poles.castShadow = false; poles.userData.debug = heads.userData.debug = 'sign';
  g.add(poles, heads);

  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uScale: { value: 620 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'uniform float uScale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(34.0 * uScale / max(1.0, -mv.z), 2.0, 150.0); }',
    fragmentShader: 'uniform float uLevel; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2) * uLevel; if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.9, 0.68) * a, a); }',
  });
  const glow = new THREE.Points(gg, glowMat);
  glow.frustumCulled = false; glow.renderOrder = 4; glow.userData.debug = 'sign';

  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(poolPos, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(poolCol, 3));
  pg.setIndex(poolIdx);
  const poolMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, opacity: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const pools = new THREE.Mesh(pg, poolMat);
  pools.frustumCulled = false; pools.renderOrder = 3; pools.userData.debug = 'sign';
  g.add(glow, pools);

  const updateVisibility = () => {
    const l = light.lamps;
    const n = light.night;
    const topDown = light.topDown;
    glowMat.uniforms.uLevel.value = l * n;
    poolMat.opacity = n;
    glow.visible = pools.visible = !topDown && l > 0.01 && n > 0.01;
  };
  onLampLevel(() => updateVisibility());
  onTopDown(() => updateVisibility());
  updateVisibility();

  g.userData.count = masts.length;
  return g;
}
