// The trees and bushes round the venue (src/props.js places them). Each kind is one geometry, trunk and crown together, drawn
// as one instanced mesh, so a kind costs one draw call however many trees there are.
//
// A crown is a few rough lumps. Its normals point out from the middle of the whole crown (a point, or a short upright line for
// tall crowns), with a little of each facet's own, so it shades as one soft leafy mass rather than a cut gem. Its vertex colour is
// darker underneath and in the hollows between lumps, where little sky reaches, and a little warmer on top. The instance colour
// tints the crown only (attribute `tint`, 0 on the trunk), and the crowns sway a little in the wind (src/lamps.js wind).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wind } from './lamps.js';
import { chainShader, after } from './shaderPatch.js';

// a number in [0, 1) from a position, the same for the same position (so shared corners of a lump move together)
const hashP = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// near: a dodecahedron (36 triangles, round enough with the crown's normals); far: an icosahedron (20)
function lump([r, x, y, z, sx = 1, sy = 1, sz = 1], near = 1) {
  const g = near ? new THREE.DodecahedronGeometry(r, 0) : new THREE.IcosahedronGeometry(r, 0), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const d = 0.84 + 0.3 * hashP(p.getX(k), p.getY(k), p.getZ(k));     // rough, not a perfect ball
    p.setXYZ(k, p.getX(k) * d * sx + x, p.getY(k) * d * sy + y, p.getZ(k) * d * sz + z);
  }
  g.computeVertexNormals();
  return g;
}

function cone([r, h, y, turn = 0], segs = 9) {
  const g = new THREE.ConeGeometry(r, h, segs, 1, false), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) if (p.getY(k) < 0) { const a = Math.atan2(p.getZ(k), p.getX(k)), d = 0.9 + 0.2 * hashP(Math.round(a * 10), r, h); p.setXYZ(k, p.getX(k) * d, p.getY(k) - 0.25 * (d - 0.9) / 0.2, p.getZ(k) * d); }   // a ragged hem
  g.rotateY(turn);
  g.translate(0, y, 0);
  return g.toNonIndexed();
}

// a branch from the trunk up into the crown, an open six-sided tube
function branch(r, [x0, y0, z0], [x1, y1, z1], colour) {
  const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0), g = new THREE.CylinderGeometry(r * 0.55, r, l, 5, 1, true).toNonIndexed();
  g.translate(0, l / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize()));
  g.translate(x0, y0, z0);
  return paint(g, colour, 0, 1);
}

// vertex colour and no tint (wood), a little darker low down
function paint(g, colour, y0, y1) {
  const c = new THREE.Color(colour), col = [], tint = [], p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const b = 0.75 + 0.25 * THREE.MathUtils.clamp((p.getY(k) - y0) / (y1 - y0), 0, 1); col.push(c.r * b, c.g * b, c.b * b); tint.push(0); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 1));
  return g;
}

// Crown shading: normals out from the axis [y0, y1] (with `facet` of the facet normal), colour from height and hollows.
function shadeCrown(g, { axis: [y0, y1], facet = 0.25, low, high, up = 0 }) {
  const p = g.attributes.position, n = g.attributes.normal, col = [], tint = [], v = new THREE.Vector3(), f = new THREE.Vector3();
  let rMax = 0;
  for (let k = 0; k < p.count; k++) rMax = Math.max(rMax, Math.hypot(p.getX(k), p.getY(k) - THREE.MathUtils.clamp(p.getY(k), y0, y1), p.getZ(k)));
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), cy = THREE.MathUtils.clamp(y, y0, y1);
    f.fromBufferAttribute(n, k);
    v.set(x, y - cy + up * Math.hypot(x, z), z).normalize().multiplyScalar(1 - facet).addScaledVector(f, facet).normalize();
    if (f.y < -0.95) v.set(0, -1, 0);                                     // flat undersides (pine tiers) stay facing down
    n.setXYZ(k, v.x, v.y, v.z);
    const h = THREE.MathUtils.clamp((y - low) / (high - low), 0, 1);      // 0 at the bottom of the crown, 1 at the top
    const out = Math.min(1, Math.hypot(x, y - cy, z) / rMax);              // 0 in the middle, 1 on the outside
    const b = (0.64 + 0.44 * h) * (0.74 + 0.26 * out) * (f.y < -0.95 ? 0.7 : 1);
    col.push(b * (0.97 + 0.07 * h), b, b * (1.02 - 0.1 * h));
    tint.push(1);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 1));
  return g;
}

function trunk(r, h, colour, segs = 7) {
  const g = new THREE.CylinderGeometry(r * 0.6, r, h, segs, 1, true).toNonIndexed();
  g.translate(0, h / 2, 0);
  return paint(g, colour, 0, h);
}

function tree(parts) {
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts);
}

// The kinds, each { geometry, far, hue: [base, spread], l: [base, spread] }: the instance colour is HSL from hue and l, and `far` is
// the same tree with fewer, plainer lumps (about a quarter of the triangles) that src/cull.js propCuller draws beyond FAR_TREE metres.
export const FAR_TREE = 120;
export function treeKinds() {
  const OAK = 0x5b4632, PINE = 0x4a3a2a, POPLAR = 0x6a5a44, BIRCH = 0xdad6cc;
  const lumps = (list, d, shade, sy) => shadeCrown(mergeGeometries(list.map(l => lump(sy ? [...l, 1, sy, 1] : l, d))), shade);
  const kinds = d => {
    const oak = lumps([[2.6, 0, 5.3, 0], [2.1, 1.7, 5.9, 0.6], [2.0, -1.5, 6.1, -0.8], [1.9, 0.4, 6.0, -1.7], [1.8, -0.4, 6.4, 1.6], [1.8, 0.2, 7.6, 0.1]].slice(0, d ? 6 : 2),
      d, { axis: [5.8, 6.2], facet: 0.12, low: 3.6, high: 9.0 }, 0.82);
    const pine = shadeCrown(mergeGeometries([[2.9, 3.2, 3.3, 0], [2.4, 3.0, 4.9, 0.4], [1.8, 2.8, 6.5, 0.8], [1.1, 2.4, 8.0, 1.2]].filter((c, k) => d || k !== 1).map(c => cone(c, d ? 9 : 5))), { axis: [2, 10], facet: 0.3, low: 1.6, high: 9.2, up: 0.55 });
    const poplar = lumps([[1.5, 0, 5.4, 0, 1, 1.9, 1], [1.3, 0.15, 8.2, -0.1, 1, 1.8, 1], [0.9, -0.1, 10.4, 0.1, 1, 1.6, 1]].filter((l, k) => d || k !== 1), d, { axis: [5.0, 9.4], facet: 0.12, low: 2.6, high: 11.6 });
    const birch = lumps([[1.6, 0, 5.6, 0, 1, 1.2, 1], [1.35, 0.9, 6.6, 0.4, 1, 1.15, 1], [1.25, -0.7, 7.2, -0.5, 1, 1.15, 1], [1.0, 0.1, 8.2, 0.2, 1, 1.1, 1]].slice(0, d ? 4 : 2), d, { axis: [5.8, 7.0], facet: 0.12, low: 3.6, high: 9.3 });
    return [
      tree([trunk(0.38, 4.4, OAK, d ? 7 : 5), ...(d ? [branch(0.2, [0, 3.2, 0], [1.6, 5.4, 0.6], OAK), branch(0.18, [0, 3.6, 0], [-1.4, 5.6, -0.8], OAK)] : []), oak]),
      tree([trunk(0.3, 3.0, PINE, d ? 7 : 5), pine]),
      tree([trunk(0.22, 4.2, POPLAR, d ? 7 : 5), poplar]),
      tree([trunk(0.2, 5.8, BIRCH, d ? 7 : 5), ...(d ? [branch(0.1, [0, 3.8, 0], [0.9, 5.6, 0.4], BIRCH)] : []), birch]),
    ];
  };
  const near = kinds(1), far = kinds(0);
  return [[0.24, 0.07, 0.22, 0.08], [0.36, 0.04, 0.15, 0.05], [0.2, 0.06, 0.24, 0.08], [0.18, 0.06, 0.3, 0.08]]
    .map(([h, hs, l, ls], k) => ({ geometry: near[k], far: far[k], hue: [h, hs], l: [l, ls] }));
}

export function bushGeometry(d = 1) {
  return tree([shadeCrown(mergeGeometries([[1.1, 0, 0.75, 0, 1.3, 0.8, 1.1], [0.8, 0.7, 0.95, 0.3, 1.2, 0.85, 1.1]].map(l => lump(l, d))), { axis: [0.8, 0.8], low: 0, high: 1.7 })]);
}

// One material for every kind: vertex colours, the instance colour on the crown only, a little sway on the crown.
export function treeMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  return chainShader(m, 'tree', sh => {
    sh.uniforms.uTime = wind.uTime; sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tint; uniform float uTime; uniform float uWind;');
    sh.vertexShader = after(sh.vertexShader, 'color_vertex', `
      #if defined(USE_INSTANCING_COLOR) && defined(USE_COLOR)
        vColor.xyz = color.xyz * mix(vec3(1.0), instanceColor.xyz, tint);
      #endif`);
    sh.vertexShader = after(sh.vertexShader, 'begin_vertex', `
      #ifdef USE_INSTANCING
      {
        float ph = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
        float k = tint * max(0.0, position.y - 2.5) * 0.016 * (0.4 + uWind);
        transformed.x += k * sin(uTime * 1.1 + ph);
        transformed.z += k * 0.6 * sin(uTime * 0.87 + ph * 1.3);
      }
      #endif`);
  });
}
