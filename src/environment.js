// The look of the sky, the light and the weather. The numbers come from src/weather.js; this file puts them on screen:
//   sky gradient behind the world, a sky dome on top of it (clouds, stars, moon or sun disc, glow at the horizon),
//   sun and sky light, fog, exposure and shadows,
//   rain (streaks moved on the GPU in a box around the camera), spray behind the player's car,
//   a wet road (darker, glossier, with puddle patches and a sky reflection), flags in the wind,
//   floodlight, window and stand lamps through src/lamps.js, the player's headlamps, the cars' tail lights.
// Visual only: nothing here is read by the physics.
//
//   const env = createEnvironment({ renderer, scene, sun, hemi, sunDir, camera });
//   env.set({ weather: 'lightrain', time: 'dusk' });   // fades over about a second; { instant: true } as the second argument jumps
//   env.registerWorld(world);                           // after the world is built: finds the road and other materials that get wet
//   env.attachCar(view);                                // the player's car: headlamps and spray
//   env.update(dt, camera);                             // every frame

import * as THREE from 'three';
import { resolveEnv, blendEnv, shadowsOn, DEFAULT_ENV, cleanEnv, sameEnv } from './weather.js';
import { setLampLevel, light, wind } from './lamps.js';

const FADE_S = 1.2;
const RAIN_MAX = 14000;
const RAIN_BOX = 40;
const SPRAY_MAX = 160;

const col = (c, a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);

// ---- the sky dome -------------------------------------------------------------------------------------------------
const SKY_VERT = `
varying vec3 vDir;
void main() { vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; }`;
const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uSunCol, uDiscCol, uCloudLight, uCloudShade, uGlowCol;
uniform float uCloud, uStars, uTime, uDisc, uGlow;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float up = d.y, sd = max(dot(d, uSunDir), 0.0);
  vec3 add = vec3(0.0); float alpha = 0.0;
  // glow round the sun and along the horizon on its side
  float hz = exp(-abs(up) * 7.0);
  add += uGlowCol * uGlow * (pow(sd, 5.0) * 0.55 + pow(sd, 40.0) * 0.8) * (0.35 + 0.65 * hz);
  add += uGlowCol * uGlow * 0.25 * hz * (0.4 + 0.6 * sd);
  float discM = smoothstep(0.99935, 0.99965, sd) * step(0.0, up + 0.02);
  float cl = 0.0;
  if (uCloud > 0.001 && up > 0.0) {
    vec2 p = d.xz / (up + 0.2) * 1.15 + vec2(uTime * 0.010, uTime * 0.005);
    float n = fbm(p) * 0.62 + fbm(p * 2.7 + 3.1) * 0.38;
    float thr = 0.72 - uCloud * 0.36;
    cl = smoothstep(thr, thr + 0.2, n) * smoothstep(0.0, 0.16, up);
    float toward = fbm(p + uSunDir.xz * 0.12) ;
    float shade = clamp((n - toward) * 3.0 + 0.5, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLight, shade);
    add = add * (1.0 - cl * 0.7);
    add += cc * cl;
    alpha = max(alpha, cl);
    discM *= 1.0 - smoothstep(0.1, 0.7, cl);
  }
  if (uStars > 0.001 && up > 0.02) {
    vec3 sp = d * 190.0; vec3 id = floor(sp); vec3 f = fract(sp) - 0.5;
    float h = hash3(id);
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    float star = step(0.9885, h) * smoothstep(0.34, 0.02, length(f)) * tw * (0.5 + 0.5 * fract(h * 91.7));
    float s = star * uStars * smoothstep(0.02, 0.2, up) * (1.0 - cl);
    add += vec3(0.85, 0.9, 1.0) * s; alpha = max(alpha, s);
  }
  add += uDiscCol * discM * uDisc;
  alpha = max(alpha, discM * uDisc);
  gl_FragColor = vec4(add, clamp(alpha, 0.0, 1.0));
}`;

function makeSky() {
  const u = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uDiscCol: { value: new THREE.Color(1, 1, 1) },
    uCloudLight: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.6, 0.65, 0.7) }, uGlowCol: { value: new THREE.Color(1, 0.8, 0.5) },
    uCloud: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 }, uDisc: { value: 0 }, uGlow: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2300, 32, 16), m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  mesh.userData.debug = 'sky';
  return { mesh, u };
}

// ---- rain ---------------------------------------------------------------------------------------------------------
function makeRain() {
  const seed = new Float32Array(RAIN_MAX * 2 * 4), end = new Float32Array(RAIN_MAX * 2), pos = new Float32Array(RAIN_MAX * 2 * 3);
  for (let k = 0; k < RAIN_MAX; k++) {
    const a = Math.random(), b = Math.random(), c = Math.random(), d = Math.random();
    for (let v = 0; v < 2; v++) { const o = (k * 2 + v) * 4; seed[o] = a; seed[o + 1] = b; seed[o + 2] = c; seed[o + 3] = d; end[k * 2 + v] = v; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const u = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: RAIN_BOX }, uVel: { value: new THREE.Vector3(1, -14, 0.5) }, uLen: { value: 0.7 }, uAlpha: { value: 0.3 }, uCol: { value: new THREE.Color(0xcfd9e4) } };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      uniform vec3 uCam, uVel; uniform float uTime, uBox, uLen, uAlpha;
      attribute vec4 aSeed; attribute float aEnd; varying float vA;
      void main() {
        vec3 p = aSeed.xyz * uBox + uVel * (uTime * (0.85 + aSeed.w * 0.3));
        p = uCam + mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
        p -= normalize(uVel) * uLen * (0.6 + aSeed.w * 0.8) * aEnd;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = length(mv.xyz);
        vA = uAlpha * (1.0 - 0.75 * aEnd) * smoothstep(uBox * 0.5, uBox * 0.2, d) * smoothstep(0.6, 2.5, d);
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; void main() { gl_FragColor = vec4(uCol, vA); }`,
  });
  const mesh = new THREE.LineSegments(g, m);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5;
  mesh.userData.debug = 'rain';
  return { mesh, u };
}

// ---- spray behind the player's car ----------------------------------------------------------------------------------
function makeSpray() {
  const pos = new Float32Array(SPRAY_MAX * 3), size = new Float32Array(SPRAY_MAX), alpha = new Float32Array(SPRAY_MAX);
  const vel = new Float32Array(SPRAY_MAX * 3), age = new Float32Array(SPRAY_MAX).fill(9), life = new Float32Array(SPRAY_MAX).fill(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, uCol: { value: new THREE.Color(0xdde4ec) } }, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(1.0, -mv.z); vA = aAlpha; }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.1, r) * vA; if (a < 0.003) discard; gl_FragColor = vec4(uCol, a); }`,
  });
  const mesh = new THREE.Points(g, m);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 6;
  mesh.userData.debug = 'rain';
  let next = 0;
  return {
    mesh,
    emit(x, y, z, vx, vy, vz) {
      const k = next; next = (next + 1) % SPRAY_MAX;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; vel[k * 3] = vx; vel[k * 3 + 1] = vy; vel[k * 3 + 2] = vz; age[k] = 0; life[k] = 0.7 + Math.random() * 0.7;
    },
    step(dt, strength) {
      for (let k = 0; k < SPRAY_MAX; k++) {
        if (age[k] >= life[k]) { alpha[k] = 0; continue; }
        age[k] += dt;
        const f = age[k] / life[k], drag = Math.exp(-2.2 * dt);
        vel[k * 3] *= drag; vel[k * 3 + 2] *= drag; vel[k * 3 + 1] = vel[k * 3 + 1] * drag - 1.2 * dt;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] = Math.max(pos[k * 3 + 1] + vel[k * 3 + 1] * dt, 0.05); pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        size[k] = 1.1 + f * 3.2;
        alpha[k] = strength * 0.22 * (1 - f) * Math.min(1, f * 8);
      }
      g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
    },
  };
}

// ---- the wet road ----------------------------------------------------------------------------------------------------
// Road materials get puddle patches: a mask from two scales of noise on the world position lowers the roughness and darkens the
// surface where it is wet. Everything else only gets a little darker.
const WET_ROAD = { uWet: { value: 0 } };
function patchRoad(m) {
  if (m.onBeforeCompile && m.onBeforeCompile.toString().length > 40 && !m.userData.wetPatched) return;
  m.userData.wetPatched = true;
  m.onBeforeCompile = sh => {
    sh.uniforms.uWet = WET_ROAD.uWet;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldXYZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXYZ = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldXYZ; uniform float uWet;
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }
float puddleMask() { vec2 p = vWorldXYZ.xz; float n = wn(p * 0.045) * 0.55 + wn(p * 0.17 + 5.0) * 0.3 + wn(p * 0.6 + 9.0) * 0.15; return smoothstep(0.62 - uWet * 0.14, 0.74 - uWet * 0.1, n) * smoothstep(0.1, 0.5, uWet); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      { float pd = puddleMask(); roughnessFactor = mix(roughnessFactor, 0.035, pd); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { float pd = puddleMask(); diffuseColor.rgb *= 1.0 - 0.38 * pd * uWet; }`);
  };
  m.customProgramCacheKey = () => 'wet-road';
}

export function createEnvironment({ renderer, scene, sun, hemi, sunDir, camera }) {
  const sky = makeSky(), rain = makeRain(), spray = makeSpray();
  scene.add(sky.mesh, rain.mesh, spray.mesh);
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 2; bgCanvas.height = 256;
  const bgCtx = bgCanvas.getContext('2d');
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;

  const css = c => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  let target = { ...DEFAULT_ENV }, from = null, to = null, cur = resolveEnv(DEFAULT_ENV), t = 1, topDown = false, time = 0, shadowsWanted = true;
  let car = null, head = null, headTarget = null;
  const wetMats = [];       // { m, kind, color, rough }
  let pmrem = null, envRT = null, envKey = '';
  const out = { sun: new THREE.Color(), tmp: new THREE.Color() };

  function paint(r) {
    bgCtx.clearRect(0, 0, 2, 256);
    const g = bgCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, css(r.sky)); g.addColorStop(1, css(r.skyBottom));
    bgCtx.fillStyle = g; bgCtx.fillRect(0, 0, 2, 256);
    bgTex.needsUpdate = true;
  }

  function apply(r) {
    cur = r;
    paint(r);
    scene.fog.color.setRGB(r.fog[0], r.fog[1], r.fog[2], THREE.SRGBColorSpace);
    scene.fog.near = r.fogNear; scene.fog.far = topDown ? 20000 : r.fogFar;
    sun.color.setRGB(r.sun[0], r.sun[1], r.sun[2], THREE.SRGBColorSpace); sun.intensity = r.sunI;
    sunDir.set(r.dir[0], r.dir[1], r.dir[2]);
    hemi.color.setRGB(r.hemiSky[0], r.hemiSky[1], r.hemiSky[2], THREE.SRGBColorSpace); hemi.groundColor.setRGB(r.hemiGround[0], r.hemiGround[1], r.hemiGround[2], THREE.SRGBColorSpace); hemi.intensity = r.hemiI;
    renderer.toneMappingExposure = r.exposure;
    setLampLevel(r.lamps);
    light.night = r.night;
    light.headlamps = Math.max(r.night > 0.4 ? Math.min(1, (r.night - 0.4) / 0.4) : 0, r.weather === 'heavyrain' ? 0.8 : 0, r.weather === 'fog' ? 0.5 : 0);
    wind.uWind.value = r.wind;
    // sky dome
    const u = sky.u;
    u.uSunDir.value.set(r.dir[0], r.dir[1], r.dir[2]);
    u.uCloud.value = r.cloud; u.uStars.value = r.stars;
    const dark = r.cloudDark, dayK = 1 - r.night, lit = 0.35 + 0.65 * dayK;
    const sb = r.skyBottom, base = [0.55 + sb[0] * 0.45, 0.55 + sb[1] * 0.45, 0.58 + sb[2] * 0.42];
    u.uCloudLight.value.setRGB(base[0] * lit * (1 - dark * 0.55) + r.sun[0] * 0.08 * dayK, base[1] * lit * (1 - dark * 0.55), base[2] * lit * (1 - dark * 0.5), THREE.LinearSRGBColorSpace);
    u.uCloudShade.value.setRGB((r.sky[0] * 0.6 + 0.12) * lit * (1 - dark * 0.6), (r.sky[1] * 0.6 + 0.13) * lit * (1 - dark * 0.6), (r.sky[2] * 0.6 + 0.15) * lit * (1 - dark * 0.55), THREE.LinearSRGBColorSpace);
    const above = r.dir[1] > 0.03 ? 1 : 0;
    u.uDisc.value = above * (r.time === 'night' ? 0.9 : 1) * (1 - r.cloud * 0.8) * (r.weather === 'fog' ? 0.2 : 1);
    if (r.time === 'night') u.uDiscCol.value.setRGB(0.82, 0.88, 1.0, THREE.LinearSRGBColorSpace); else u.uDiscCol.value.setRGB(r.sun[0], r.sun[1] * 0.97 + 0.03, r.sun[2] * 0.9 + 0.1, THREE.LinearSRGBColorSpace);
    u.uGlowCol.value.setRGB(r.sun[0], r.sun[1] * 0.85, r.sun[2] * 0.6, THREE.LinearSRGBColorSpace);
    u.uGlow.value = (r.time === 'night' ? 0.12 : r.time === 'midday' ? 0.18 : 0.75) * (1 - r.cloud * 0.55);
    sky.mesh.visible = !topDown && (r.cloud > 0.001 || r.stars > 0.001 || u.uGlow.value > 0.001 || u.uDisc.value > 0.001) && !(r.time === 'midday' && r.weather === 'clear');
    // rain
    rain.mesh.visible = !topDown && r.rain > 0.001;
    const count = Math.round(RAIN_MAX * Math.pow(r.rain, 0.9));
    rain.mesh.geometry.setDrawRange(0, count * 2);
    rain.u.uAlpha.value = 0.14 + 0.2 * r.rain + (r.night > 0.5 ? 0.06 : 0);
    rain.u.uVel.value.set(r.wind * 2.2, -(12 + 6 * r.rain), r.wind * 0.9);
    rain.u.uCol.value.setRGB(0.8 - r.night * 0.45, 0.85 - r.night * 0.4, 0.92 - r.night * 0.25, THREE.SRGBColorSpace);
    spray.mesh.visible = !topDown && r.spray > 0.01;
    // wet road
    WET_ROAD.uWet.value = r.wet;
    for (const w of wetMats) wetMaterial(w, r.wet);
    if (car) {
    }
    if (head) head.visible = light.headlamps > 0.05;
  }

  function wetMaterial(w, wet) {
    const { m, kind, color, rough } = w;
    const k = kind === 'road' ? 1 : 0.4;
    m.color.copy(color).multiplyScalar(1 - 0.34 * wet * k);
    m.roughness = rough * (1 - (kind === 'road' ? 0.62 : 0.2) * wet);
    if (kind === 'road') {
      const on = wet > 0.04 && envRT;
      if (on && m.envMap !== envRT.texture) { m.envMap = envRT.texture; m.needsUpdate = true; } else if (!on && m.envMap) { m.envMap = null; m.needsUpdate = true; }
      m.envMapIntensity = 0.04 + 0.4 * wet;
    }
  }

  // a small sky of the target look, reflected by the wet road
  function buildReflection(r) {
    const key = `${r.time}|${r.weather}`;
    if (key === envKey || r.wet < 0.04) return;
    envKey = key;
    try {
      pmrem ||= new THREE.PMREMGenerator(renderer);
      const s = new THREE.Scene();
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color().setRGB(r.sky[0], r.sky[1], r.sky[2], THREE.SRGBColorSpace) }, bot: { value: new THREE.Color().setRGB(r.skyBottom[0], r.skyBottom[1], r.skyBottom[2], THREE.SRGBColorSpace) }, sunDir: { value: new THREE.Vector3(...r.dir) }, sunCol: { value: new THREE.Color().setRGB(r.sun[0], r.sun[1], r.sun[2], THREE.SRGBColorSpace) }, sunK: { value: Math.min(1, r.sunI / 2.4) * 6 } },
        vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec3 vD; uniform vec3 top, bot, sunDir, sunCol; uniform float sunK; void main() { vec3 d = normalize(vD); float k = smoothstep(-0.1, 0.8, d.y); vec3 c = mix(bot, top, k); c += sunCol * sunK * pow(max(dot(d, sunDir), 0.0), 60.0); if (d.y < 0.0) c = mix(bot, bot * 0.4, min(1.0, -d.y * 3.0)); gl_FragColor = vec4(c, 1.0); }',
      });
      s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 16, 12), mat));
      const rt = pmrem.fromScene(s, 0.03);
      if (envRT) envRT.dispose();
      envRT = rt;
      mat.dispose();
    } catch (e) { envRT = null; }
  }

  const api = {
    get env() { return { ...target }; },
    get resolved() { return cur; },
    set(env, { instant = false } = {}) {
      const e = cleanEnv(env);
      if (sameEnv(e, target) && t >= 1 && !instant && to) return;
      target = e;
      to = resolveEnv(e);
      buildReflection(to);
      shadowsWanted = shadowsOn(to);
      sun.castShadow = shadowsWanted;
      if (instant) { from = null; t = 1; apply(to); }
      else { from = cur; t = 0; }
    },
    registerWorld(root) {
      const seen = new Set();
      root.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || seen.has(m) || !m.isMeshStandardMaterial || !m.color) continue;
          seen.add(m);
          const kind = m.userData.wet === 'road' ? 'road' : 'other';
          if (kind === 'road') patchRoad(m);
          wetMats.push({ m, kind, color: m.color.clone(), rough: m.roughness });
        }
      });
      if (cur.wet > 0) for (const w of wetMats) wetMaterial(w, cur.wet);
    },
    attachCar(view) {
      car = view;
      if (!head) {
        head = new THREE.SpotLight(0xfff0d8, 700, 75, 0.5, 0.55, 2);
        head.castShadow = false; head.visible = false;
        head.position.set(1.8, 0.75, 0);
        headTarget = new THREE.Object3D(); headTarget.position.set(24, -0.6, 0);
        head.target = headTarget;
        view.root.add(head, headTarget);
        head.visible = light.headlamps > 0.05;
      }
    },
    setTopDown(v) { topDown = !!v; apply(cur); },
    // call every frame. carState (optional): { speed } of the player's car, for the spray
    update(dt, cam, carState) {
      time += dt;
      wind.uTime.value = time % 900;
      sky.u.uTime.value = time;
      if (t < 1) {
        t = Math.min(1, t + dt / FADE_S);
        const k = t * t * (3 - 2 * t);
        apply(blendEnv(from, to, k));
        if (t >= 1) apply(to);
      }
      const c = cam || camera;
      sky.mesh.position.copy(c.position);
      if (rain.mesh.visible) { rain.u.uCam.value.copy(c.position); rain.u.uTime.value = time % 400; }
      if (spray.mesh.visible && car) {
        const sp = carState ? carState.speed : 0, r = cur;
        if (sp > 14 && r.wet > 0.3) {
          const n = Math.floor(dt * 70 * r.spray * Math.min(1, sp / 55) + Math.random());
          const p = car.root.position, yaw = -car.root.rotation.y, fx = Math.cos(yaw), fz = Math.sin(yaw);
          for (let k = 0; k < n; k++) {
            const side = (Math.random() < 0.5 ? -1 : 1) * 0.85, back = -1.9 - Math.random() * 0.4;
            const x = p.x + fx * back - fz * side, z = p.z + fz * back + fx * side;
            const v = sp * (0.12 + Math.random() * 0.12);
            spray.emit(x, p.y + 0.25, z, fx * sp * 0.35 - fx * v * 0.2 - fz * side * 1.2 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.6, fz * sp * 0.35 - fz * v * 0.2 + fx * side * 1.2 + (Math.random() - 0.5) * 1.5);
          }
        }
        spray.step(dt, r.spray);
      }
    },
  };
  apply(cur);
  return api;
}
