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
        vColor.rgb = mix(vColor.rgb, tone, skin);
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
