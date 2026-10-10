// People as one InstancedMesh: a torso (a box with no bottom, 10 triangles) and a head (a three-sided double pyramid, 6 triangles)
// in one geometry, so a crowd is one draw call and 16 triangles a person. The instance colour is the shirt; the head takes a skin
// tone picked in the vertex shader from the instance number, so it needs no second mesh.
//
// spots: [x, y, z, colour, random 0..1, standing] in the parent's frame (y is the floor the person stands on).

import * as THREE from 'three';

const SKIN = [0xf1c9a5, 0xe0ac88, 0xc68a62, 0x9a6540, 0x6b4328, 0xf6d6bd];
const HEAD_Y = 0.64, HEAD_R = 0.155;
export const CROWD_FAR = 400;   // metres: beyond this a crowd is not drawn (src/cull.js propCuller); a person there is about three pixels tall
export const CROWD_NEAR = 140;  // metres: a crowd whose nearest part is further than this is drawn with the simple person below

function personGeometry() {
  const pos = [], skin = [], idx = [];
  const v = (x, y, z, s) => { pos.push(x, y, z); skin.push(s); return pos.length / 3 - 1; };
  // torso: 0.42 wide, 0.5 tall, 0.26 deep, standing on y = 0, open underneath
  const w = 0.21, d = 0.13, h = 0.5;
  const face = (a, b, c, e) => { const s = pos.length / 3; for (const p of [a, b, c, e]) v(...p, 0); idx.push(s, s + 1, s + 2, s, s + 2, s + 3); };
  face([-w, 0, d], [w, 0, d], [w, h, d], [-w, h, d]);       // front (+z)
  face([w, 0, -d], [-w, 0, -d], [-w, h, -d], [w, h, -d]);   // back
  face([w, 0, d], [w, 0, -d], [w, h, -d], [w, h, d]);       // right
  face([-w, 0, -d], [-w, 0, d], [-w, h, d], [-w, h, -d]);   // left
  face([-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]);     // top
  // head: three points round the middle, a top and a bottom point
  const ring = [0, 1, 2].map(k => { const a = k * Math.PI * 2 / 3 + Math.PI / 2; return [Math.cos(a) * HEAD_R, HEAD_Y, Math.sin(a) * HEAD_R]; });
  for (const tip of [[0, HEAD_Y + HEAD_R * 1.2, 0], [0, HEAD_Y - HEAD_R, 0]]) {
    for (let k = 0; k < 3; k++) {
      const a = ring[k], b = ring[(k + 1) % 3], up = tip[1] > HEAD_Y;
      const s = pos.length / 3; v(...a, 1); v(...b, 1); v(...tip, 1);
      idx.push(...(up ? [s, s + 2, s + 1] : [s, s + 1, s + 2]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skin', new THREE.Float32BufferAttribute(skin, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The person for a crowd far away: a three sided prism as tall as the head, the shirt on the sides and the skin tone on the top, 7 triangles
// instead of 16 (src/cull.js propCuller swaps it in on the crowd's mesh beyond CROWD_NEAR).
function farGeometry() {
  const pos = [], skin = [], idx = [];
  const R = 0.24, H = 0.8;
  const ring = [0, 1, 2].map(k => { const a = k * Math.PI * 2 / 3 + Math.PI / 2; return [Math.cos(a) * R, Math.sin(a) * R]; });
  for (let k = 0; k < 3; k++) {
    const a = ring[k], b = ring[(k + 1) % 3], s = pos.length / 3;
    pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], H, b[1], a[0], H, a[1]); skin.push(0, 0, 0, 0);
    idx.push(s, s + 2, s + 1, s, s + 3, s + 2);
  }
  const s = pos.length / 3;
  for (const [x, z] of ring) { pos.push(x, H, z); skin.push(1); }
  idx.push(s, s + 1, s + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skin', new THREE.Float32BufferAttribute(skin, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A standing person with legs, torso, arms, an octagonal head and a white helmet (about 90 triangles), 1.24 m tall as built; the
// instance colour is the overalls, the skin attribute is 0 for overalls, 1 for skin and 2 for the helmet. Front is +z.
export function standingPersonGeometry() {
  const pos = [], skin = [], idx = [];
  const quad = (a, b, c, d, k) => { const n = pos.length / 3; for (const q of [a, b, c, d]) { pos.push(...q); skin.push(k); } idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  // a box without a bottom, centred on x (cx), standing from y0 to y1, w wide, d deep
  const box = (cx, y0, y1, w, d, cz, k) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], k);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], k);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], k);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], k);
  };
  box(-0.085, 0, 0.45, 0.14, 0.16, 0, 0);                 // legs
  box(0.085, 0, 0.45, 0.14, 0.16, 0, 0);
  box(0, 0.45, 1.0, 0.4, 0.24, 0, 0);                     // torso
  box(-0.25, 0.47, 0.97, 0.1, 0.1, 0, 0);                 // arms
  box(0.25, 0.47, 0.97, 0.1, 0.1, 0, 0);
  // an eight sided prism from y0 to y1 with a flat top, no bottom
  const prism = (r, y0, y1, k) => {
    const ring = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4 + Math.PI / 8; return [Math.cos(a) * r, Math.sin(a) * r]; });
    for (let i = 0; i < 8; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 8];
      quad([bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], k);
    }
    const n = pos.length / 3;
    for (const [x, z] of ring) { pos.push(x, y1, z); skin.push(k); }
    for (let i = 1; i < 7; i++) idx.push(n, n + i + 1, n + i);   // the top, seen from above
  };
  prism(0.11, 1.0, 1.12, 1);                              // head
  prism(0.125, 1.12, 1.25, 2);                            // helmet
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skin', new THREE.Float32BufferAttribute(skin, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let shared = null;
function parts() {
  if (shared) return shared;
  const geo = personGeometry(), far = farGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const tones = SKIN.map(h => new THREE.Color(h)).map(c => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`);
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float skin;')
      .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
      {
        float hh = fract(sin(float(gl_InstanceID) * 12.9898 + 4.1) * 43758.5453);
        int k = int(hh * ${SKIN.length}.0);
        vec3 tone = ${tones.slice(1).map((t, k) => `k == ${k + 1} ? ${t} : `).join('')}${tones[0]};
        vColor.rgb = skin > 1.5 ? vec3(0.93) : mix(vColor.rgb, tone, skin);
      }
#endif`);
  };
  mat.customProgramCacheKey = () => 'crowd-skin';
  shared = { geo, far, mat };
  return shared;
}

// One InstancedMesh for these people (null for none). A standing person is taller and stands a little higher (on a step).
export function crowdMesh(spots) {
  if (!spots.length) return null;
  const { geo, far, mat } = parts();
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), p = new THREE.Vector3(), s = new THREE.Vector3();
  spots.forEach(([a, y, z, colour, h, standing], k) => {
    m4.compose(p.set(a, y + 0.45 + (standing ? 0.42 : 0), z), q, s.set(0.9 + h * 0.25, standing ? 1.25 : 1, 1));
    im.setMatrixAt(k, m4);
    im.setColorAt(k, c.setHex(colour));
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = false;
  im.userData.debug = 'building';
  im.userData.maxDist = CROWD_FAR;
  im.userData.nearGeometry = geo; im.userData.farGeometry = far; im.userData.nearDist = CROWD_NEAR;   // swapped by propCuller
  return im;
}

// People in overalls standing about: one InstancedMesh of standingPersonGeometry. spots: [x, y, z, colour, random 0..1, yaw] with y the ground
// they stand on and yaw the way they face (their front is +z, so yaw = atan2(dx, dz) towards what they look at). About 1.7 m tall.
let standing = null;
export function standingCrowd(spots) {
  if (!spots.length) return null;
  const { mat } = parts();
  standing = standing || standingPersonGeometry();
  const im = new THREE.InstancedMesh(standing, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, y, z, colour, h, yaw], k) => {
    const f = 1.3 + h * 0.12;
    m4.compose(p.set(x, y, z), q.setFromAxisAngle(up, yaw), s.set(f, f, f));
    im.setMatrixAt(k, m4);
    im.setColorAt(k, c.setHex(colour));
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = false;
  im.userData.debug = 'building';
  im.userData.maxDist = CROWD_FAR;
  return im;
}
