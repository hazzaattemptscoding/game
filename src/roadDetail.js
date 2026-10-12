// Wear on the racing surface: a darker band of rubber laid down along the racing line, with the two tyre tracks in it, heavier
// and streaked where the cars brake, and large patches of older and newer tarmac so the 8 m texture does not show its repeat.
// Visual only. The line comes from the reference lap in src/racingLineData.js (the same one the optional racing line shows); a track
// it does not match (another layout) gets the patches and no rubber.
//
// The road's texture coordinates are the lap distance and the sideways offset, both over 8 (src/trackMesh.js), so the shader
// knows where on the track every pixel is without any extra vertex data. One small texture holds the line along the lap.

import * as THREE from 'three';
import data from './racingLineData.js';
import { dataMatches } from './racingLine.js';
import { chainShader } from './shaderPatch.js';

const SAMPLES = 2048;      // along the lap: about 1.9 m apart on Lakeside, smooth enough for a line that bends gently
const BLEND_M = 14;        // metres the rubber weight is smoothed over, so a braking zone fades in and out

// The line texture: R the line's sideways offset (metres), G how much rubber is down (0..1), B braking marks (0..1).
export function lineTexture(T) {
  const ok = dataMatches(T);
  const n = ok ? data.d.length : 1, src = new Float32Array(n * 3);
  if (ok) {
    for (let i = 0; i < n; i++) {
      const c = data.c[i];
      src[i * 3] = data.d[i];
      src[i * 3 + 1] = c === 'b' ? 1 : c === 'l' ? 0.75 : 0.55;
      src[i * 3 + 2] = c === 'b' ? 1 : 0;
    }
  }
  const half = Math.max(1, Math.round(BLEND_M / (T.length / n) / 2)), out = new Uint16Array(SAMPLES * 4);
  for (let k = 0; k < SAMPLES; k++) {
    const i0 = Math.floor(k / SAMPLES * n);
    let d = 0, w = 0, b = 0, m = 0;
    for (let j = -half; j <= half; j++) {
      const i = ((i0 + j) % n + n) % n;
      w += src[i * 3 + 1]; b += src[i * 3 + 2]; m++;
    }
    d = src[i0 * 3];
    out[k * 4] = THREE.DataUtils.toHalfFloat(d);
    out[k * 4 + 1] = THREE.DataUtils.toHalfFloat(ok ? w / m : 0);
    out[k * 4 + 2] = THREE.DataUtils.toHalfFloat(ok ? b / m : 0);
    out[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.DataTexture(out, SAMPLES, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Puts the wear on the road material (the tarmac of the circuit, not the pit lane or the run-off).
export function addRoadDetail(m, T) {
  const uLine = { value: lineTexture(T) }, uLen = { value: T.length };
  return chainShader(m, 'road-detail', sh => {
    sh.uniforms.uLine = uLine; sh.uniforms.uLen = uLen;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uLine; uniform float uLen;
float roadRub = 0.0;
float rdh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float rdn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rdh(i), rdh(i + vec2(1, 0)), f.x), mix(rdh(i + vec2(0, 1)), rdh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float rs = vMapUv.x * 8.0, rd = vMapUv.y * 8.0;
        vec4 ln = texture2D(uLine, vec2(rs / uLen, 0.5));
        float x = rd - ln.r;
        float band = exp(-x * x / 2.4);                                   // the rubbered band, about 3 m wide
        float tyres = exp(-(abs(x) - 0.82) * (abs(x) - 0.82) / 0.09);      // the two wheel tracks in it
        float grain = 0.75 + 0.5 * rdn(vec2(rs * 0.25, rd * 3.0));
        roadRub = clamp(ln.g * (0.5 * band + 0.5 * tyres) * grain, 0.0, 1.0);
        float marks = ln.b * tyres * smoothstep(0.45, 0.85, rdn(vec2(rs * 0.08, rd * 7.0 + 3.0)));   // dark streaks where cars brake
        float patches = rdn(vec2(rs * 0.03, rd * 0.11)) * 0.6 + rdn(vec2(rs * 0.13, rd * 0.45) + 7.0) * 0.4;
        diffuseColor.rgb *= (0.9 + 0.2 * patches) * (1.0 - 0.27 * roadRub - 0.28 * marks);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor *= 1.0 - 0.15 * roadRub;`);
  });
}
