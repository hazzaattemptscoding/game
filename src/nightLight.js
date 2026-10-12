// Floodlight light over the whole circuit at night, with no real lights. A light map (one texture laid over the venue from above)
// holds how much floodlight reaches each point and from which side it comes; every lit material in the world adds it as one more
// light in three.js's own light loop, so the road, the verges, the barriers, the buildings and the cars are lit the same way, with
// the right diffuse and gloss (a wet road and a car's clear coat shine under it). It costs one texture read a pixel, and none by day.
//
//   bakeNightLight(T, masts)      the light map as plain numbers (tools/venue.js tests it in node): { w, h, box, level, dir }
//   nightLightAt(bake, x, z)      the light at a point, 0..1
//   useNightLight(bake)           puts the map on the GPU
//   addNightLight(material)       makes a material take the light
//   setNightLevel(k)              0 by day, 1 with every floodlight on (src/environment.js sets it with the time of day)

import * as THREE from 'three';
import { chainShader, after } from './shaderPatch.js';

export const LAMP_H = 28;          // metres: the lamp frame on a mast (src/floodlights.js MAST_H plus the frame)
const REACH = 110;                 // metres: a mast lights nothing further than this
const AIM = 26;                    // metres: the distance in front of a mast where its light on the ground is strongest
const TEXEL = 2;                   // metres per texel of the light map
const MARGIN = 140;                // metres of map round the track
const GAIN = 1.25;                 // how fast the light saturates where masts overlap (1 - exp(-GAIN * sum))

// Light on the ground at horizontal distance dh from a mast, `along` the cosine of the angle off its aim (1 straight ahead).
// Floodlights are aimed down at the track: on the ground the light falls off with the square of the distance and the slant, and
// it is strongest a little way in front of the mast, weaker straight below it and behind it. 1 at the aim point.
function mastLight(dh, along) {
  const d3sq = dh * dh + LAMP_H * LAMP_H, cosInc = LAMP_H / Math.sqrt(d3sq);
  const aimSq = AIM * AIM + LAMP_H * LAMP_H, ref = (LAMP_H / Math.sqrt(aimSq)) / aimSq;
  const beam = 0.25 + 0.75 * Math.min(1, Math.max(0, (along + 0.35) / 0.85));   // mostly forwards, some spill to the sides and back
  const edge = dh > REACH * 0.8 ? Math.max(0, (REACH - dh) / (REACH * 0.2)) : 1;
  return cosInc / d3sq / ref * beam * edge;
}

// The light one mast puts on the ground at (x, z), unsaturated (src/floodlights.js plans the masts with it).
export function mastLightAt(m, x, z) {
  const px = x - m.x, pz = z - m.z, dh = Math.hypot(px, pz);
  if (dh > REACH) return 0;
  return mastLight(dh, dh > 1e-3 ? (px * m.toX + pz * m.toZ) / dh : 1);
}
export const saturate = sum => 1 - Math.exp(-GAIN * sum);

export function bakeNightLight(T, masts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
  x0 -= MARGIN; z0 -= MARGIN; x1 += MARGIN; z1 += MARGIN;
  const w = Math.ceil((x1 - x0) / TEXEL), h = Math.ceil((z1 - z0) / TEXEL);
  const sum = new Float32Array(w * h), dx = new Float32Array(w * h), dz = new Float32Array(w * h);
  const r = Math.ceil(REACH / TEXEL);
  for (const m of masts) {
    const ci = Math.floor((m.x - x0) / TEXEL), cj = Math.floor((m.z - z0) / TEXEL);
    for (let j = Math.max(0, cj - r); j <= Math.min(h - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(w - 1, ci + r); i++) {
        const px = x0 + (i + 0.5) * TEXEL - m.x, pz = z0 + (j + 0.5) * TEXEL - m.z, dh = Math.hypot(px, pz);
        if (dh > REACH) continue;
        const along = dh > 1e-3 ? (px * m.toX + pz * m.toZ) / dh : 1;
        const e = mastLight(dh, along), k = j * w + i;
        sum[k] += e;
        if (dh > 1e-3) { dx[k] -= e * px / dh; dz[k] -= e * pz / dh; }      // towards the mast
      }
    }
  }
  const level = new Float32Array(w * h), dir = new Float32Array(w * h * 2);
  for (let k = 0; k < w * h; k++) {
    level[k] = saturate(sum[k]);
    const l = Math.hypot(dx[k], dz[k]);
    dir[k * 2] = l > 1e-6 ? dx[k] / l : 0; dir[k * 2 + 1] = l > 1e-6 ? dz[k] / l : 0;
  }
  return { w, h, box: [x0, z0, TEXEL], level, dir };
}

// The light at a point (nearest texel), 0..1.
export function nightLightAt(b, x, z) {
  const i = Math.floor((x - b.box[0]) / b.box[2]), j = Math.floor((z - b.box[1]) / b.box[2]);
  if (i < 0 || j < 0 || i >= b.w || j >= b.h) return 0;
  return b.level[j * b.w + i];
}

// --- on the GPU ---------------------------------------------------------------------------------------------------------
const U = {
  uNightMap: { value: null },
  uNightBox: { value: new THREE.Vector4(0, 0, 1, 1) },    // x0, z0, 1 / width in metres, 1 / depth in metres
  uNightLevel: { value: 0 },
  uNightCol: { value: new THREE.Color(1.0, 0.93, 0.82) },   // metal halide floodlights, a little warm
};
const STRENGTH = 2.6;               // the floodlight's light at full level, in the same units as the sun (2.4 at midday)

export function useNightLight(b) {
  const data = new Uint8Array(b.w * b.h * 4);
  for (let k = 0; k < b.w * b.h; k++) {
    data[k * 4] = Math.round(b.level[k] * 255);
    data[k * 4 + 1] = Math.round((b.dir[k * 2] * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round((b.dir[k * 2 + 1] * 0.5 + 0.5) * 255);
    data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, b.w, b.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  if (U.uNightMap.value) U.uNightMap.value.dispose();
  U.uNightMap.value = t;
  U.uNightBox.value.set(b.box[0], b.box[1], 1 / (b.w * b.box[2]), 1 / (b.h * b.box[2]));
  return t;
}

export function setNightLevel(k) { U.uNightLevel.value = k * STRENGTH; }
export const nightLevel = () => U.uNightLevel.value / STRENGTH;

// Lit materials only (standard, physical, lambert, phong): they have the light loop the light joins.
export function addNightLight(m) {
  if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return m;
  return chainShader(m, 'night-light', sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = after(sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNightXZ;'), 'worldpos_vertex', `
      {
        vec4 nwp = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          nwp = batchingMatrix * nwp;
        #endif
        #ifdef USE_INSTANCING
          nwp = instanceMatrix * nwp;
        #endif
        vNightXZ = (modelMatrix * nwp).xz;
      }`);
    sh.fragmentShader = after(sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vNightXZ; uniform sampler2D uNightMap; uniform vec4 uNightBox; uniform float uNightLevel; uniform vec3 uNightCol;'),
      'lights_fragment_begin', `
      if (uNightLevel > 0.0) {
        vec4 nl = texture2D(uNightMap, (vNightXZ - uNightBox.xy) * uNightBox.zw);
        float lit = nl.r * uNightLevel;
        if (lit > 0.002) {
          IncidentLight floodLight;
          floodLight.direction = normalize((viewMatrix * vec4(nl.g * 2.0 - 1.0, 1.15, nl.b * 2.0 - 1.0, 0.0)).xyz);   // up and over towards the masts
          floodLight.color = uNightCol * lit;
          floodLight.visible = true;
          RE_Direct(floodLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          // light from many masts at once wraps round: faces turned away still get some
          RE_IndirectDiffuse(uNightCol * lit * 0.22, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        }
      }`);
  });
}
