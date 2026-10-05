// Lights and spray for the cars of other players (and the tail lights of your own), without one real light per car.
//   Glow sprites (one Points draw call): a lamp glow at each headlamp and tail light, strength from the time of day
//   (src/lamps.js `light`) and from braking. Ground pools (one InstancedMesh draw call): a soft elongated patch of light on the road
//   ahead of each other car, standing in for the spot light that your own car carries (src/environment.js attachCar).
//   Spray (one Points draw call, the same shader as your own car's): mist behind other cars on a wet road.
// Visual only. The cars' emissive lamp materials are in src/car.js and already follow the same levels, so the sprites only add the glow.
//
//   const fx = createCarFx(scene);
//   fx.update(dt, camera, others, self, env.resolved);   // every frame; others: [{ x, y, z, h, v, brk, o }], self the same shape or null
// h is the heading (radians, +x forward at 0), v the speed in m/s, brk the brake 0..1, o the opacity of the car 0..1.

import * as THREE from 'three';
import { GT } from './cars.js';
import { light } from './lamps.js';
import { makeSpray } from './environment.js';

export const MAX_FX_CARS = 8;
const FAR = 320;            // metres from the camera beyond which a car gets no glow
const SPRAY_RANGE = 160;    // other cars spray only this close to the camera
const SPRAY_POOL = 400;

const F = GT.length / 2;
// lamp positions in the car frame: x forward, z right
const HEAD = [[F - 0.12, 0.5, -0.6], [F - 0.12, 0.5, 0.6]];
const TAIL = [[-F - 0.08, 0.62, -0.62], [-F - 0.08, 0.62, 0.62]];

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
  scene.add(glow, pools, spray.mesh);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
  let sprayVisible = false;

  function lamp(k, x, y, z, r, g, b, s, a) {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    colr[k * 3] = r * a; colr[k * 3 + 1] = g * a; colr[k * 3 + 2] = b * a; size[k] = a > 0.01 ? s : 0;
  }

  return {
    glow, pools, spray, get sprayVisible() { return sprayVisible; },
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
        spray.step(dt, spr);
      }
    },
    dispose() { scene.remove(glow, pools, spray.mesh); gg.dispose(); pg.dispose(); glowMat.dispose(); poolMat.dispose(); },
  };
}
