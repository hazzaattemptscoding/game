// Lights and spray for the cars of other players (and the tail lights of your own), without one real light per car.
//   Glow sprites (one Points draw call): a lamp glow at each headlamp and tail light, strength from the time of day
//   (src/lamps.js `light`) and from braking. Ground pools (one InstancedMesh draw call): a soft elongated patch of light on the road
//   ahead of each other car, standing in for the spot light that your own car carries (src/environment.js attachCar).
//   Spray (one Points draw call, the same shader as your own car's): mist behind other cars on a wet road.
//   Wake streaks (one mesh, one draw call): faint ribbons of air shed from the wing tips, the roof and the diffuser of any car above 40 m/s,
//   following the path the car took for about 25 m and fading out. They need only the pose, so they cost nothing in the netcode.
// Visual only. The cars' emissive lamp materials are in src/car.js and already follow the same levels, so the sprites only add the glow.
//
//   const fx = createCarFx(scene);
//   fx.update(dt, camera, others, self, env.resolved);   // every frame; others: [{ x, y, z, h, v, brk, o, len }], self the same shape or null
// h is the heading (radians, +x forward at 0), v the speed in m/s, brk the brake 0..1, o the opacity of the car 0..1,
// len the car's length in metres (its class, src/cars.js; the GT's when missing), which places its lamps; id a key that stays with the car
// (the streaks remember its path) and cls its class id, for where its wing is.

import * as THREE from 'three';
import { GT, carById } from './cars.js';
import { bodySpec } from './car.js';
import { light } from './lamps.js';
import { makeSpray } from './environment.js';

export const MAX_FX_CARS = 8;
const FAR = 320;            // metres from the camera beyond which a car gets no glow
const SPRAY_RANGE = 160;    // other cars spray only this close to the camera
const SPRAY_POOL = 400;
// wake streaks
const STREAK_MIN = 40;      // m/s: no streaks below this
const STREAK_FULL = 72;     // m/s: longest and brightest from here
const TRAIL_STEP = 2;       // m between remembered points of a car's path
const TRAIL_N = 13;         // points kept: 12 steps of 2 m is the 25 m the streaks drift back over
const STREAK_ALPHA = 0.5;   // brightness of a streak at its start, at full speed
const EMITTERS = 4;         // per car: the two wing tips, the roof and the diffuser

// lamp positions in the car frame: x forward, z right. They depend on the car's length (its class).
const lampCache = new Map();
function lampsFor(len) {
  const key = Math.round(len * 100);
  let l = lampCache.get(key);
  if (!l) {
    const F = len / 2;
    l = { head: [[F - 0.12, 0.5, -0.6], [F - 0.12, 0.5, 0.6]], tail: [[-F - 0.08, 0.62, -0.62], [-F - 0.08, 0.62, 0.62]] };
    lampCache.set(key, l);
  }
  return l;
}

// where the air leaves the car, in the car frame (x forward, y up, z right): the wing tips, the roof and the diffuser. From the class's shape.
const emitCache = new Map();
function emittersFor(cid) {
  let e = emitCache.get(cid);
  if (!e) {
    const cfg = carById(cid), sp = bodySpec(cfg), tail = -cfg.length / 2, wing = sp.wing;
    const tipX = wing ? wing.x : tail, tipY = wing ? wing.y : cfg.height * 0.8, tipZ = wing ? wing.span / 2 : cfg.width / 2 - 0.1;
    e = [[tipX, tipY, -tipZ, 1], [tipX, tipY, tipZ, 1], [-0.4, cfg.height + 0.02, 0, 0.5], [tail, 0.2, 0, 0.4]];   // [x, y, z, size]
    emitCache.set(cid, e);
  }
  return e;
}

export function createCarFx(scene) {
  const N = MAX_FX_CARS, P = N * 4;
  // glow sprites
  const pos = new Float32Array(P * 3), colr = new Float32Array(P * 3), size = new Float32Array(P);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  gg.setAttribute('aCol', new THREE.BufferAttribute(colr, 3));
  gg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 620 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'uniform float uScale; attribute vec3 aCol; attribute float aSize; varying vec3 vC; void main() { vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize > 0.0 ? clamp(aSize * uScale / max(1.0, -mv.z), 3.0, 70.0) : 0.0; }',
    fragmentShader: 'varying vec3 vC; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.0); if (a < 0.004) discard; gl_FragColor = vec4(vC * a, a); }',
  });
  const glow = new THREE.Points(gg, glowMat);
  glow.frustumCulled = false; glow.renderOrder = 4; glow.visible = false; glow.userData.debug = 'rain';

  // road pools: a flat quad per car, +x forward
  const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
  const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  pg.setAttribute('aA', alphaAttr);
  const poolMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: 'attribute float aA; varying vec2 vU; varying float vA; void main() { vU = uv; vA = aA; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vU; varying float vA; void main() { float u = vU.x, v = abs(vU.y - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - u), 1.4) * smoothstep(1.0, 0.0, v * (0.5 + u)) * smoothstep(0.0, 0.08, u) * vA; if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.92, 0.72) * a, a); }',
  });
  const pools = new THREE.InstancedMesh(pg, poolMat, N);
  pools.frustumCulled = false; pools.renderOrder = 3; pools.count = 0; pools.visible = false; pools.userData.debug = 'rain';
  pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const spray = makeSpray(SPRAY_POOL);

  // wake streaks: for each car, EMITTERS ribbons of TRAIL_N points, two vertices a point. One indexed mesh, filled each frame.
  const SV = N * EMITTERS * TRAIL_N * 2, SI = N * EMITTERS * (TRAIL_N - 1) * 6;
  const sPos = new Float32Array(SV * 3), sCol = new Float32Array(SV * 3), sIdx = new Uint16Array(SI);
  for (let s = 0, k = 0; s < N * EMITTERS; s++) {
    for (let j = 0; j < TRAIL_N - 1; j++) {
      const a = (s * TRAIL_N + j) * 2;
      sIdx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k); k += 6;
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('color', new THREE.BufferAttribute(sCol, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setIndex(new THREE.BufferAttribute(sIdx, 1));
  const streakMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const streaks = new THREE.Mesh(sg, streakMat);
  streaks.frustumCulled = false; streaks.renderOrder = 4; streaks.visible = false; streaks.userData.debug = 'rain';
  scene.add(glow, pools, spray.mesh, streaks);
  const trails = new Map();   // car id -> { n, x[], y[], z[], h[] }: the last points of its path, newest first
  let time = 0;
  const px = new Float32Array(TRAIL_N), py = new Float32Array(TRAIL_N), pz = new Float32Array(TRAIL_N);

  // keep the path of a car: a point every TRAIL_STEP metres, newest first. A frame that moved the car further than that is filled in
  // along the line between its last point and where it is now, so the trail is the same at 20 frames a second as at 120.
  // A jump (a reset, a car that left and another took its place) clears it.
  function addPoint(t, x, y, z, h) {
    t.n = Math.min(t.n + 1, TRAIL_N - 1);   // the current pose is the ribbon's first point, so the path holds one fewer
    for (let j = t.n - 1; j > 0; j--) { t.x[j] = t.x[j - 1]; t.y[j] = t.y[j - 1]; t.z[j] = t.z[j - 1]; t.h[j] = t.h[j - 1]; }
    t.x[0] = x; t.y[0] = y; t.z[0] = z; t.h[0] = h;
  }
  function trailOf(car) {
    let t = trails.get(car.id);
    if (!t) { t = { n: 0, x: new Float32Array(TRAIL_N), y: new Float32Array(TRAIL_N), z: new Float32Array(TRAIL_N), h: new Float32Array(TRAIL_N), seen: 0 }; trails.set(car.id, t); }
    t.seen = time;
    if (t.n === 0) { addPoint(t, car.x, car.y, car.z, car.h); return t; }
    const d = Math.hypot(car.x - t.x[0], car.z - t.z[0]);
    if (d > 80) { t.n = 0; addPoint(t, car.x, car.y, car.z, car.h); return t; }
    if (d < TRAIL_STEP) return t;
    const k = Math.floor(d / TRAIL_STEP), x0 = t.x[0], y0 = t.y[0], z0 = t.z[0], h0 = t.h[0];
    const dh = Math.atan2(Math.sin(car.h - h0), Math.cos(car.h - h0));
    for (let i = 1; i <= k; i++) { const f = i / k; addPoint(t, x0 + (car.x - x0) * f, y0 + (car.y - y0) * f, z0 + (car.z - z0) * f, h0 + dh * f); }
    return t;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
  let sprayVisible = false;

  function lamp(k, x, y, z, r, g, b, s, a) {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    colr[k * 3] = r * a; colr[k * 3 + 1] = g * a; colr[k * 3 + 2] = b * a; size[k] = a > 0.01 ? s : 0;
  }

  return {
    glow, pools, spray, streaks, get sprayVisible() { return sprayVisible; },
    // others: array of { x, y, z, h, v, brk, o }; self: the same for your own car or null; env: the resolved weather (wet, spray)
    update(dt, cam, others, self, env, topDown = false) {
      const night = light.night, head = light.headlamps, wet = env ? env.wet : 0, spr = env ? env.spray : 0;
      const cx = cam.position.x, cz = cam.position.z;
      let k = 0, n = 0;
      const list = self ? [self, ...others] : others;
      for (let c = 0; c < list.length && c < N; c++) {
        const car = list[c];
        if (Math.hypot(car.x - cx, car.z - cz) > FAR) continue;
        const fx = Math.cos(car.h), fz = Math.sin(car.h), o = car.o === undefined ? 1 : car.o;
        const { head: HEAD, tail: TAIL } = lampsFor(car.len || GT.length);
        const place = lp => [car.x + fx * lp[0] - fz * lp[2], car.y + lp[1], car.z + fz * lp[0] + fx * lp[2]];
        // tail lights: a faint red glow in the dark, stronger and wider when braking (also a small one in daylight under braking)
        const brake = car.brk > 0.05 ? 1 : 0;
        const ta = o * (brake ? 0.55 + 0.45 * night : 0.1 + 0.5 * night * (0.6 + 0.4 * head));
        for (const lp of TAIL) { const p = place(lp); lamp(k++, p[0], p[1], p[2], 1, 0.08, 0.04, brake ? 1.1 : 0.8, ta > 0.03 && (night > 0.05 || brake) ? ta : 0); }
        if (!car.self) {
          const ha = o * head * 0.95;
          for (const lp of HEAD) { const p = place(lp); lamp(k++, p[0], p[1], p[2], 1, 0.93, 0.74, 1.3, ha); }
          // the pool of light on the road ahead
          const len = 16, wid = 8, a = o * head;
          if (a > 0.03 && !topDown) {
            e.set(0, -car.h, 0); q.setFromEuler(e);
            tp.set(car.x + fx * 1.4, car.y + 0.1, car.z + fz * 1.4);
            sc.set(len, 1, wid);
            m4.compose(tp, q, sc); pools.setMatrixAt(n, m4); alphaAttr.array[n] = a * 0.34; n++;
          }
        } else { lamp(k++, 0, 0, 0, 0, 0, 0, 0, 0); lamp(k++, 0, 0, 0, 0, 0, 0, 0, 0); }
      }
      for (let j = k; j < P; j++) size[j] = 0;
      gg.attributes.position.needsUpdate = gg.attributes.aCol.needsUpdate = gg.attributes.aSize.needsUpdate = true;
      glow.visible = !topDown && k > 0 && (night > 0.05 || list.some(c => c.brk > 0.05));
      pools.count = n; pools.visible = !topDown && n > 0;
      pools.instanceMatrix.needsUpdate = true; alphaAttr.needsUpdate = true;

      // wake streaks
      time += dt;
      let ns = 0;
      if (!topDown) {
        const rainK = 1 - 0.8 * wet;
        for (let c = 0; c < list.length && c < N; c++) {
          const car = list[c], v = car.v;
          if (!(v > STREAK_MIN) || car.id === undefined || Math.hypot(car.x - cx, car.z - cz) > FAR) continue;
          const tr = trailOf(car), pts = 1 + tr.n;
          const kv = Math.min(1, (v - STREAK_MIN) / (STREAK_FULL - STREAK_MIN)), live = 4 + kv * (TRAIL_N - 5), o = car.o === undefined ? 1 : car.o;
          const em = emittersFor(car.cls || 'GT');
          for (let ei = 0; ei < EMITTERS; ei++) {
            const E = em[ei], base = (ns * TRAIL_N) * 2;
            for (let j = 0; j < TRAIL_N; j++) {
              const src = Math.min(j, pts - 1);
              const X = src === 0 ? car.x : tr.x[src - 1], Y = src === 0 ? car.y : tr.y[src - 1], Z = src === 0 ? car.z : tr.z[src - 1], H = src === 0 ? car.h : tr.h[src - 1];
              const hx = Math.cos(H), hz = Math.sin(H);
              const sw = Math.min(j, pts - 1) * E[3];   // the air spreads and curls a little as it ages
              const lz = E[2] + Math.sin(time * 13 + j * 0.9 + ei * 1.7) * 0.03 * sw + (E[2] > 0 ? 1 : E[2] < 0 ? -1 : 0) * 0.02 * sw;
              const ly = E[1] + Math.cos(time * 11 + j * 0.8 + ei * 2.3) * 0.02 * sw + 0.015 * sw;
              px[j] = X + hx * E[0] - hz * lz; pz[j] = Z + hz * E[0] + hx * lz; py[j] = Y + ly;
            }
            for (let j = 0; j < TRAIL_N; j++) {
              const a = Math.max(0, j - 1), b = Math.min(TRAIL_N - 1, j + 1);
              let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
              const tx = cam.position.x - px[j], ty = cam.position.y - py[j], tz = cam.position.z - pz[j];
              let sx = dy * tz - dz * ty, sy = dz * tx - dx * tz, sz = dx * ty - dy * tx;
              const sl = Math.hypot(sx, sy, sz) || 1, half = 0.06 * E[3] * (1 - 0.5 * j / TRAIL_N) / sl;
              sx *= half; sy *= half; sz *= half;
              const camD = Math.hypot(tx, ty, tz);
              const life = j >= pts ? 0 : Math.pow(Math.max(0, 1 - j / live), 1.4), dash = (j + ei * 2) % 5 === 4 ? 0.25 : 1;
              const al = STREAK_ALPHA * E[3] * kv * life * dash * rainK * o * Math.min(1, Math.max(0, (camD - 3) / 10)) * (j === 0 ? 0.5 : 1);
              const k = (base + j * 2) * 3;
              sPos[k] = px[j] - sx; sPos[k + 1] = py[j] - sy; sPos[k + 2] = pz[j] - sz;
              sPos[k + 3] = px[j] + sx; sPos[k + 4] = py[j] + sy; sPos[k + 5] = pz[j] + sz;
              sCol[k] = sCol[k + 3] = 0.88 * al; sCol[k + 1] = sCol[k + 4] = 0.93 * al; sCol[k + 2] = sCol[k + 5] = al;
            }
            ns++;
          }
        }
      }
      for (const [id, t] of trails) if (time - t.seen > 2) trails.delete(id);
      sg.setDrawRange(0, ns * (TRAIL_N - 1) * 6);
      sg.attributes.position.needsUpdate = sg.attributes.color.needsUpdate = true;
      streaks.visible = ns > 0;

      // spray
      sprayVisible = !topDown && spr > 0.01;
      spray.mesh.visible = sprayVisible;
      if (sprayVisible) {
        if (wet > 0.3) {
          for (const car of others) {
            const sp = car.v;
            if (!(sp > 14) || Math.hypot(car.x - cx, car.z - cz) > SPRAY_RANGE) continue;
            const fx = Math.cos(car.h), fz = Math.sin(car.h), cnt = Math.floor(dt * 40 * spr * Math.min(1, sp / 55) + Math.random());
            for (let j = 0; j < cnt; j++) {
              const side = (Math.random() < 0.5 ? -1 : 1) * 0.85, back = -1.9 - Math.random() * 0.4, v = sp * (0.12 + Math.random() * 0.12);
              const x = car.x + fx * back - fz * side, z = car.z + fz * back + fx * side;
              spray.emit(x, car.y + 0.25, z, fx * sp * 0.35 - fx * v * 0.2 - fz * side * 1.2 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.6, fz * sp * 0.35 - fz * v * 0.2 + fx * side * 1.2 + (Math.random() - 0.5) * 1.5);
            }
          }
        }
        // in rain the wake of a fast car is spray: a little off its wing tips
        if (wet > 0.3) {
          for (const car of list) {
            const sp = car.v;
            if (!(sp > STREAK_MIN) || car.cls === undefined || Math.hypot(car.x - cx, car.z - cz) > SPRAY_RANGE) continue;
            const fx = Math.cos(car.h), fz = Math.sin(car.h), E = emittersFor(car.cls), cnt = Math.floor(dt * 24 * spr * Math.min(1, sp / 70) + Math.random());
            for (let j = 0; j < cnt; j++) {
              const e = E[Math.random() < 0.5 ? 0 : 1], x = car.x + fx * e[0] - fz * e[2], z = car.z + fz * e[0] + fx * e[2];
              spray.emit(x, car.y + e[1], z, fx * sp * 0.3 + (Math.random() - 0.5) * 1.2, 0.2 + Math.random() * 0.8, fz * sp * 0.3 + (Math.random() - 0.5) * 1.2);
            }
          }
        }
        spray.step(dt, spr);
      }
    },
    dispose() { scene.remove(glow, pools, spray.mesh, streaks); gg.dispose(); pg.dispose(); sg.dispose(); glowMat.dispose(); poolMat.dispose(); streakMat.dispose(); },
  };
}
