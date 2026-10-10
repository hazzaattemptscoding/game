// Shared state between the scenery and the weather: how bright the lamps are (floodlights, stand and window lights, big
// screens), how hard the wind blows on flags, and how dark it is for the cars' lamps. The scenery registers its materials here
// when it builds them; src/environment.js sets the levels every frame. With no environment running (node tests, the live page
// before it starts one) everything stays at its day value.

import * as THREE from 'three';

export const light = { lamps: 0, night: 0, headlamps: 0, topDown: false };   // read by car.js for the tail lights and headlamps
export const wind = { uTime: { value: 0 }, uWind: { value: 0.45 } };

const listeners = new Set();
const topDownListeners = new Set();
export function onLampLevel(fn) { listeners.add(fn); fn(light.lamps); return fn; }
export function setLampLevel(level) {
  light.lamps = level;
  for (const fn of listeners) fn(level);
}
export function onTopDown(fn) { topDownListeners.add(fn); fn(light.topDown); return fn; }
export function setTopDown(topDown) {
  light.topDown = topDown;
  for (const fn of topDownListeners) fn(topDown);
}

// A material that glows with the lamp level: emissive colour times `base` times the level (0 by day).
export function lampMaterial(o, base = 2.2) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.4, ...o, emissive: o.emissive ?? 0xfff2cf, emissiveIntensity: 0 });
  const fn = onLampLevel(l => { m.emissiveIntensity = base * l; });
  m.addEventListener('dispose', () => listeners.delete(fn));   // a rebuilt scenery disposes the old materials: their listeners go with them
  return m;
}

// Flags and banners that move in the wind. The wave runs along the cloth (attribute flagW, 0 at the pole to 1 at the free end)
// and is pushed out of the plane of the cloth; the shared uniforms wind.uTime and wind.uWind drive every flag at once.
export function flagMaterial(o) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, ...o });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = wind.uTime; sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float flagW; uniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = position.x * 0.31 + position.z * 0.37;
        float amp = (0.05 + 0.2 * uWind) * flagW;
        transformed += normal * (sin(flagW * 6.5 - uTime * (3.0 + 2.2 * uWind) + ph) * amp + sin(flagW * 13.0 - uTime * 6.0 + ph * 1.7) * amp * 0.25);
        transformed.y -= flagW * flagW * 0.06 * (1.0 - uWind * 0.4); }`);
  };
  m.customProgramCacheKey = () => 'wind-flag';
  return m;
}

// A cloth from the pole point (x, y, z) along (dx, dz) for `len` metres, `h` metres high, in `n` columns. Both faces use one quad
// strip: the material is double sided.
export function flagGeometry(x, y, z, dx, dz, len, h, n = 6, uv0 = 0, uv1 = 1) {
  const pos = [], uv = [], w = [], idx = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pos.push(x + dx * len * u, y, z + dz * len * u, x + dx * len * u, y + h, z + dz * len * u);
    uv.push(uv0 + (uv1 - uv0) * u, 0, uv0 + (uv1 - uv0) * u, 1);
    w.push(u, u);
    if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('flagW', new THREE.Float32BufferAttribute(w, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Add a flag to a Kit (key = a flagMaterial). Everything under one key must be flags (same attributes).
export function addFlag(kit, key, x, y, z, dx, dz, len, h, n = 6, uv0 = 0, uv1 = 1) {
  return kit.push(key, flagGeometry(x, y, z, dx, dz, len, h, n, uv0, uv1));
}
