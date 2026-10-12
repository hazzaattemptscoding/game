// Floodlight masts round the circuit and along the pit and start straight. The lamp heads are emissive and glow at dusk and
// night (src/lamps.js sets the level from the time of day), each with a glow sprite. The light they throw is a light map over the
// whole venue (src/nightLight.js), baked here from the masts, that every lit material in the world adds at night.
//
// planMasts() picks the places as numbers only (tools/venue.js checks them): behind the containment wall, off every barrier
// line, clear of buildings and stands, and enough of them that the whole track is lit. buildFloodlights() draws them: 3 draw
// calls (poles, lamp heads, glow) however many masts there are.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { trackPoint, hash01, Kit } from './meshKit.js';
import { wallClearance } from './grandstands.js';
import { nearBarrier } from './trackNear.js';
import { lampMaterial, onLampLevel, onTopDown, light, flagMaterial, addFlag } from './lamps.js';
import { mastLightAt, saturate, bakeNightLight, useNightLight } from './nightLight.js';

export const MAST_H = 26;        // metres to the lamp frame
export const MAST_BEHIND = 7;    // metres behind the containment wall, at least
export const MAST_BARRIER = 6;   // metres from any barrier line, at least

// is a spot free for a mast (the same discipline as the props: wall, barriers, blockers, stands)
export function mastFree(T, blockers, stands, x, z) {
  if (wallClearance(T, x, z) < MAST_BEHIND) return false;
  if (nearBarrier(T, x, z, MAST_BARRIER)) return false;
  for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 4) return false;
  for (const o of stands) {
    const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
    if (Math.abs(a) < o.len / 2 + 5 && b > -8 && b < o.depth + 5) return false;
  }
  return true;
}

// Masts: the pit and start straights first (every 48 m, the pit side behind the garages), then every MAST_EVERY metres round the
// lap on alternating sides, then more wherever the road is still darker than LIT_TARGET at night (src/nightLight.js), each one as
// close as the rules allow to the darkest point left, until the whole track is lit or no free place is left near a dark point.
export const MAST_EVERY = 70;    // metres between masts round the lap, alternating sides
export const LIT_TARGET = 0.5;   // the least floodlight on any part of the road (centre and both edges), 0..1 (nightLight.js)
export function planMasts(T, blockers, stands, pitS = T.pitRange) {
  const masts = [], taken = [];
  const near = (x, z, m) => taken.some(p => Math.hypot(p.x - x, p.z - z) < m);
  const place = (s, side, off) => {
    const c = trackPoint(T, s, 0), i = c.i;
    if (T.isBridge[i]) return null;
    if (side === 0 && T.pitOut[i] && off < 0) return null;
    const wall = Math.max(T.wall[side][i], side === 0 && T.pitOut[i] ? T.pitOut[i] + 2 : 0);
    const sg = side ? 1 : -1, p = trackPoint(T, s, sg * (wall + off));
    return { x: p.x, z: p.z, s, side, i, yaw: Math.atan2(sg * p.nz, -sg * p.nx), toX: -sg * p.nx, toZ: -sg * p.nz };   // the heads face the track: local +x points at it
  };
  const tryAt = (s, side, offsets, minGap) => {
    for (const off of offsets) {
      const m = place(s, side, off);
      if (!m || near(m.x, m.z, minGap) || !mastFree(T, blockers, stands, m.x, m.z)) continue;
      masts.push(m); taken.push(m);
      return m;
    }
    return null;
  };
  // pit and start straight first (they claim their places), pit side behind the garages
  for (let s = T.length - 140; s < T.length + 330; s += 48) {
    tryAt(s, 0, [26, 31, 38], 36);
    tryAt(s + 24, 1, [10, 14, 20], 36);
  }
  for (let s = 380, k = 0; s < T.length - 150; s += MAST_EVERY, k++) {
    const side = k % 2;
    if (!tryAt(s, side, [8, 12, 18, 26], 45)) tryAt(s + 25, 1 - side, [8, 12, 18, 26], 45);
  }

  // fill the dark places: the light on the road's centre and edges every 3 m, the darkest point first
  const pts = [];
  for (let s = 0; s < T.length; s += 3) {
    const c = trackPoint(T, s, 0);
    for (const f of [-1, 0, 1]) { const q = trackPoint(T, s, f * T.hw[c.i]); pts.push({ x: q.x, z: q.z, s, sum: 0, given: false }); }
  }
  const light = m => { for (const p of pts) p.sum += mastLightAt(m, p.x, p.z); };
  masts.forEach(light);
  for (let round = 0; round < 120; round++) {
    let worst = null;
    for (const p of pts) if (!p.given && saturate(p.sum) < LIT_TARGET && (!worst || p.sum < worst.sum)) worst = p;
    if (!worst) break;
    let added = null;
    for (const ds of [0, -12, 12, -24, 24, -36, 36]) {
      for (const side of [0, 1]) { added = tryAt(worst.s + ds, side, [6, 10, 15, 22, 30], 28); if (added) break; }
      if (added) break;
    }
    if (added) light(added);
    else for (const p of pts) if (Math.abs(p.s - worst.s) < 15) p.given = true;   // nowhere to stand a mast here: leave this stretch
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
  const glowPos = [];
  masts.forEach((m, k) => {
    const y = ground.surfaceHeight(m.x, m.z) - 0.2;
    e.set(0, m.yaw, 0);
    m4.compose(new THREE.Vector3(m.x, y, m.z), q.setFromEuler(e), one);
    poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
    glowPos.push(m.x + m.toX * 1.6, y + MAST_H + 1.4, m.z + m.toZ * 1.6);
  });
  poles.castShadow = false; poles.userData.debug = heads.userData.debug = 'sign';
  g.add(poles, heads);
  // a long banner flag on every other mast, half way up, flying along the track (wind material, one draw call a colour)
  const flags = new Kit(), keys = ['flagR', 'flagB', 'flagY'];
  masts.forEach((m, k) => {
    if (k % 2) return;
    const y = ground.surfaceHeight(m.x, m.z) - 0.2, dx = Math.sin(m.yaw), dz = Math.cos(m.yaw);
    addFlag(flags, keys[(k / 2) % 3], m.x + dx * 0.4, y + MAST_H * 0.45, m.z + dz * 0.4, dx, dz, 1.6, 4.5, 4);
  });
  if (flags.parts.size) g.add(flags.build({ flagR: flagMaterial({ color: 0xc8102e }), flagB: flagMaterial({ color: 0x1d4e9e }), flagY: flagMaterial({ color: 0xffd21f }) }, { debug: 'sign' }));

  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uScale: { value: 620 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'uniform float uScale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(34.0 * uScale / max(1.0, -mv.z), 2.0, 150.0); }',
    fragmentShader: 'uniform float uLevel; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2) * uLevel; if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.9, 0.68) * a, a); }',
  });
  const glow = new THREE.Points(gg, glowMat);
  glow.frustumCulled = false; glow.renderOrder = 4; glow.userData.debug = 'sign';
  g.add(glow);

  const updateVisibility = () => {
    const l = light.lamps;
    const n = light.night;
    const topDown = light.topDown;
    glowMat.uniforms.uLevel.value = l * n;
    glow.visible = !topDown && l > 0.01 && n > 0.01;
  };
  onLampLevel(() => updateVisibility());
  onTopDown(() => updateVisibility());
  updateVisibility();

  useNightLight(bakeNightLight(T, masts));   // the light they throw, for every lit material at night (src/nightLight.js)
  g.userData.count = masts.length;
  return g;
}
