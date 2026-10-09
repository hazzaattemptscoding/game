// Car model test. Run with `npm run carmodels`. No browser needed.
//   1. each class builds (src/car.js, bodySpec) from its real config in src/cars.js: the GT, the GT1 and the CITY (a config with
//      no id, or an unknown id, builds the GT)
//   2. bounding box within 5 % of the class's length, height and width. The GT's glasshouse bevel adds 0.08 m to its roof
//      (an existing part of the model, kept as it was), so the GT's height is checked against 1.2 + 0.08
//   3. the wheels touch the road (lowest point of each tyre at y = 0 within 1 cm), sit under the body, and their outer face is inside
//      the body's width with a gap, so tyres and body never share a surface
//   4. the GT and GT1 have a rear wing and a DRS flap that opens; the CITY has no wing group and no flap
//   5. the GT1's fenders are part of its body skin (no pasted flares): the rear haunches are wider than the doors and the front
//      fenders stand lower than the rear haunches; the GT1 and CITY have a liner behind each wheel
//   6. materials: a sane count, every mesh has one; the GT1 and CITY glass is tinted blue grey and lighter than the GT's black glass
//   7. livery: body, wing, stripe style, side panel, number plate and flat mode all apply on all three classes
//   8. stripes run over the car: their points stay within its height
//  10. the garage preview camera (src/preview.js) keeps the whole car in frame for each class, at both a wide and a narrow box,
//      and looks at it from the front three-quarter
//   9. the GT's model is exactly the original one: every mesh's vertex data, position and material colours match a fingerprint taken
//      before the other classes were added

import crypto from 'node:crypto';
import * as THREE from 'three';
import { CarView, bodySpec } from '../src/car.js';
import { CARS } from '../src/cars.js';
import { deps } from '../src/liveryTex.js';
import { OPEN_ANGLE } from '../src/drsFlap.js';
import { previewFrame, PREVIEW_FOV, PREVIEW_AZ } from '../src/preview.js';

let n = 0, fails = 0;
function check(ok, label) {
  n++;
  if (!ok) { fails++; console.log(`  FAIL ${label}`); }
}
// lightness of a colour as it is typed in (sRGB), not in the renderer's linear space
const lightness = c => { const h = {}; c.getHSL(h, THREE.SRGBColorSpace); return h.l; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// The three classes, from their real configs.
const CONFIGS = { GT: CARS.GT, GT1: CARS.GT1, CITY: CARS.CITY };
const GT = CARS.GT;

// The livery canvases need a 2D context, which node does not have: a stub that draws nothing.
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
deps.canvas = () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => '' });
deps.sponsorBoard = () => null;

// A car at rest, as CarView.update reads it.
function restCar() {
  const car = { prev: null, x: 0, y: 0, z: 0, heading: 0, steer: 0, wheelSpinAngle: 0, wheel: 0, ax: 0, ay: 0, brake: 0, fwdSpeed: 0, bump: 0, groundPitch: 0, groundRoll: 0, drs: false };
  car.prev = car;
  return car;
}
function drive(view, car, drs, frames) {
  car.drs = drs;
  for (let i = 0; i < frames; i++) { view._t = performance.now() / 1000 - 0.016; view.update(car, 1); }
}
const boxOf = o => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const bodyOf = view => view.hull.children[0];          // the body's skin is the first thing added to the hull

const views = {};
for (const [name, cfg] of Object.entries(CONFIGS)) {
  console.log(name);
  let v;
  try { v = new CarView(cfg); } catch (e) { check(false, `${name} builds (${e.message})`); continue; }
  views[name] = v;
  check(true, `${name} builds`);

  // 2. bounding box
  const bb = boxOf(v.root), size = bb.getSize(new THREE.Vector3());
  const height = cfg.height + (name === 'GT' ? 0.08 : 0);
  check(near(size.x, cfg.length, cfg.length * 0.05), `${name} length ${size.x.toFixed(3)} m within 5 % of ${cfg.length}`);
  check(near(size.y, height, height * 0.05), `${name} height ${size.y.toFixed(3)} m within 5 % of ${height.toFixed(2)}`);
  check(near(size.z, cfg.width, cfg.width * 0.05), `${name} width ${size.z.toFixed(3)} m within 5 % of ${cfg.width}`);

  // 3. wheels on the road and under the body
  const shell = boxOf(bodyOf(v));
  for (const w of v.wheels) {
    const tyre = boxOf(w.spin.children[0]);
    check(Math.abs(tyre.min.y) <= 0.01, `${name} wheel at x ${w.steer.position.x.toFixed(2)} z ${w.steer.position.z.toFixed(2)} touches the road (lowest y ${tyre.min.y.toFixed(4)})`);
    check(w.steer.position.x > shell.min.x && w.steer.position.x < shell.max.x, `${name} wheel at x ${w.steer.position.x.toFixed(2)} is under the body's length`);
  }
  check(shell.min.y > 0.05, `${name} body clears the road (lowest point ${shell.min.y.toFixed(3)} m)`);

  // 4. rear wing and DRS flap
  const hasWing = name !== 'CITY';
  check(!!v.wing === hasWing && !!v.flapPivot === hasWing, `${name} ${hasWing ? 'has' : 'has no'} rear wing group and DRS flap`);
  if (hasWing) {
    const car = restCar();
    drive(v, car, false, 3);
    check(Math.abs(v.flapPivot.rotation.z) < 1e-9, `${name} flap is shut with DRS off`);
    drive(v, car, true, 10);
    check(-v.flapPivot.rotation.z >= 0.99 * OPEN_ANGLE - 1e-6, `${name} flap opens with DRS`);
    drive(v, car, false, 14);
    check(-v.flapPivot.rotation.z < 0.01 * OPEN_ANGLE + 1e-6, `${name} flap shuts again`);
  } else {
    const car = restCar();
    drive(v, car, true, 10);
    check(v.flapPivot === null && v.wing === null, `${name} update with DRS on does not need a flap`);
  }

  // 5. fenders: the GT1's are part of the skin. Its width and height along the car, read from the body's own vertices.
  check((bodySpec(cfg).arches || []).length === 0, `${name} has no pasted wheel arch flares`);
  check(v.hull.children.filter(m => m.geometry && m.geometry.type === 'ShapeGeometry').length === (name === 'GT' ? 0 : 4), `${name} has a liner behind each wheel (${name === 'GT' ? 'none' : 'four'})`);
  if (name === 'GT1') {
    const pos = bodyOf(v).geometry.getAttribute('position'), a = cfg.wheelbase * (1 - cfg.frontWeight), b = a - cfg.wheelbase;
    const around = x => { let z = 0, y = 0; for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - x) < 0.05) { z = Math.max(z, Math.abs(pos.getZ(i))); y = Math.max(y, pos.getY(i)); } return { z, y }; };
    const rear = around(b), door = around(0), front = around(a);
    check(near(rear.z, cfg.width / 2, 0.005), `GT1 rear haunch is the full width (${rear.z.toFixed(3)} m of ${cfg.width / 2})`);
    check(door.z < rear.z - 0.03 && front.z < rear.z && front.z > door.z, `GT1 doors (${door.z.toFixed(3)}) are narrower than the front fenders (${front.z.toFixed(3)}), which are narrower than the rear haunches (${rear.z.toFixed(3)})`);
    check(front.y < rear.y - 0.05, `GT1 front fenders (${front.y.toFixed(3)} m) stand lower than the rear haunches (${rear.y.toFixed(3)} m)`);
    // the skin is continuous from the front arch over the door to the rear arch: no step in its width
    let step = 0, prev = around(a).z;
    for (let x = a; x >= b; x -= 0.05) { const z = around(x).z; step = Math.max(step, Math.abs(z - prev)); prev = z; }
    check(step < 0.03, `GT1 fender surface is continuous from the front arch to the rear arch (largest step ${step.toFixed(3)} m per 5 cm)`);
  }
  if (name !== 'GT') {
    const tyreW = bodySpec(cfg).tyreW, outer = cfg.trackWidth / 2 + tyreW / 2;
    check(outer < cfg.width / 2 - 0.01, `${name} tyre outer face ${outer.toFixed(3)} m is inside the body width ${(cfg.width / 2).toFixed(3)} m`);
  }

  // 6. materials
  const mats = v.materials();
  check(mats.length >= 8 && mats.length <= 16, `${name} has a sane number of materials (${mats.length})`);
  let bare = 0;
  v.root.traverse(o => { if (o.isMesh && !o.material) bare++; });
  check(bare === 0, `${name} every mesh has a material`);

  // glass
  if (name === 'GT') check(v.materials().some(m => m.color.getHexString() === '14181d' && m.metalness === 0.6), 'GT glass is the original black');
  else check(v.materials().some(m => m.roughness === 0.16 && m.color.b > m.color.r && lightness(m.color) > 0.2 && lightness(m.color) < 0.5), `${name} glass is a dark blue grey with some lightness`);

  // 7. livery
  v.setLivery({ body: '#2f8fe0', stripe: '#f4f4f0', wing: '#d3202b', style: 1, number: 7, sponsor: '', name: '' });
  check(v.paint.color.getHexString() === '2f8fe0', `${name} body takes the livery colour`);
  if (hasWing) check(v.wingMat.color.getHexString() === 'd3202b', `${name} wing takes the livery colour`);
  check(v.stripes[0].visible && v.stripes[1].geometry.getAttribute('position') === undefined, `${name} centre stripe shows for style 1 (no second stripe)`);
  check(v.stripes[0].geometry.getAttribute('position').count > 0, `${name} centre stripe has geometry`);
  check(v.sides.every(m => m.visible) && v.plate.visible, `${name} side panel and number plate show with a number`);
  check(near(v.sides[0].position.z, bodySpec(cfg).half + 0.004, 1e-9) && near(v.sides[1].position.z, -(bodySpec(cfg).half + 0.004), 1e-9), `${name} side panels sit on the body surface`);
  v.setLivery({ body: '#1b1d20', stripe: '#111111', wing: '#1b1d20', style: 2, number: -1, sponsor: '', name: '' });
  check(v.stripes[0].visible && v.stripes[1].visible, `${name} twin stripes show for style 2`);
  check(!v.sides.some(m => m.visible) && !v.plate.visible, `${name} side panel and plate hide without a number`);
  v.setLivery({ body: '#ffd21f', stripe: '#111111', wing: '#1b1d20', style: 0, number: -1, sponsor: '', name: '' });
  check(!v.stripes[0].visible && !v.stripes[1].visible, `${name} no stripes for style 0`);
  v.setLivery({ body: '#e23b3b', stripe: '#f4f4f0', wing: '#1b1d20', style: 1, number: 7, sponsor: '', name: '' });
  v.setFlat(true);
  check(!v.decals.visible && v.paint.color.getHexString() === 'e23b3b', `${name} flat blockout hides decals and keeps the body colour`);
  v.setFlat(false);
  check(v.decals.visible, `${name} decals return after the blockout`);

  // 8. the stripes run over the car: every point is inside the car's height and off the road
  const top = v.stripes[0].geometry.getAttribute('position');
  let outside = 0;
  for (let i = 0; i < top.count; i++) if (top.getY(i) > size.y + 0.01 || top.getY(i) < -0.01) outside++;
  check(top.count > 0 && outside === 0, `${name} stripe points stay within the car's height`);
  v.dispose();
}

// 9. the GT is the original model: a fingerprint of every mesh (geometry type, vertex count, a hash of the vertices, its position,
// and its material colours, roughness, metalness and emissive colour), taken from the car before the other classes existed.
const GT_FINGERPRINT = [
  "BoxGeometry 24 00b13db1768bdf7acbfed4d2916c1f10 2.2,0.16,0 1b1d20:0.6:0:000000",
    "BoxGeometry 24 016f0dbb33e578141d37bb45df7c41e1 -0.11,0,0 1b1d20:0.5:0.2:000000|1b1d20:0.5:0.2:000000|1b1d20:0.5:0.2:000000|060708:0.8:0:000000|1b1d20:0.5:0.2:000000|1b1d20:0.5:0.2:000000",
    "BoxGeometry 24 07a16b0854a572aab88e8732e30d5f27 -2.38,0.62,-0.62 400000:1:0:ff1010",
    "BoxGeometry 24 07a16b0854a572aab88e8732e30d5f27 -2.38,0.62,0.62 400000:1:0:ff1010",
    "BoxGeometry 24 66170f477fc1bf8d062fab0783f4e72f 2.18,0.5,-0.6 ffffff:1:0:fff2d0",
    "BoxGeometry 24 66170f477fc1bf8d062fab0783f4e72f 2.18,0.5,0.6 ffffff:1:0:fff2d0",
    "BoxGeometry 24 6be779015c13a6ebf03458ad49cf3ab1 -2,1.02,-0.5 1b1d20:0.6:0:000000",
    "BoxGeometry 24 6be779015c13a6ebf03458ad49cf3ab1 -2,1.02,0.5 1b1d20:0.6:0:000000",
    "BoxGeometry 24 f74309680df0723bf7ef66e1684ef47d -1.93,1.22,0 1b1d20:0.5:0.2:000000|060708:0.8:0:000000|1b1d20:0.5:0.2:000000|1b1d20:0.5:0.2:000000|1b1d20:0.5:0.2:000000|1b1d20:0.5:0.2:000000",
    "CylinderGeometry 148 29cc2175df10ef26d4a7f13323762d59 0,0,0 151515:0.9:0:000000",
    "CylinderGeometry 148 29cc2175df10ef26d4a7f13323762d59 0,0,0 151515:0.9:0:000000",
    "CylinderGeometry 148 29cc2175df10ef26d4a7f13323762d59 0,0,0 151515:0.9:0:000000",
    "CylinderGeometry 148 29cc2175df10ef26d4a7f13323762d59 0,0,0 151515:0.9:0:000000",
    "CylinderGeometry 40 fe7e62a6e7d8c97c18d2d26b999c2add 0,0,0 9aa0a6:0.3:0.8:000000",
    "CylinderGeometry 40 fe7e62a6e7d8c97c18d2d26b999c2add 0,0,0 9aa0a6:0.3:0.8:000000",
    "CylinderGeometry 40 fe7e62a6e7d8c97c18d2d26b999c2add 0,0,0 9aa0a6:0.3:0.8:000000",
    "CylinderGeometry 40 fe7e62a6e7d8c97c18d2d26b999c2add 0,0,0 9aa0a6:0.3:0.8:000000",
    "ExtrudeGeometry 1284 75be83889bce905ae39eea9550e9d6a7 0,0,0 ffd21f:0.35:0.3:000000",
    "ExtrudeGeometry 924 bb10cf53d54a40250ac0c89b0e37265f 0,0,0 14181d:0.1:0.6:000000",
    "PlaneGeometry 4 24241e2b7a1a169665023dd0c98d2699 1.9578,0.7042,0 ffffff:0.4:0.1:000000",
    "PlaneGeometry 4 f432b9630078a9668da214b1888d71d5 0.1,0.45,-1.004 ffffff:0.4:0.1:000000",
    "PlaneGeometry 4 f432b9630078a9668da214b1888d71d5 0.1,0.45,1.004 ffffff:0.4:0.1:000000",
    "empty",
    "empty",
];
{
  const gt = new CarView(GT), got = [];
  gt.root.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) { got.push('empty'); return; }
    const hash = crypto.createHash('md5').update(Buffer.from(pos.array.buffer)).digest('hex');
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(m => `${m.color.getHexString()}:${m.roughness}:${m.metalness}:${m.emissive ? m.emissive.getHexString() : ''}`).join('|');
    got.push([o.geometry.type, pos.count, hash, o.position.toArray().map(x => +x.toFixed(4)).join(','), mats].join(' '));
  });
  const want = GT_FINGERPRINT.slice().sort(), have = got.sort();
  check(want.length === have.length && want.every((r, i) => r === have[i]), `the GT model is unchanged (${have.length} meshes match the original fingerprint)`);
  gt.dispose();
}

// No id, or an unknown id, gives the GT's own shape.
{
  const size = c => boxOf(new CarView(c).root).getSize(new THREE.Vector3());
  const ref = size(GT), noId = size({ ...GT, id: undefined }), unknown = size({ ...GT, id: 'NOPE' });
  check(noId.distanceTo(ref) < 1e-9, 'a config with no id builds the GT');
  check(unknown.distanceTo(ref) < 1e-9, 'an unknown id builds the GT');
}

// The three classes are different bodies: their bounding boxes are not the same size.
{
  const size = name => boxOf(views[name].root).getSize(new THREE.Vector3());
  check(size('GT').distanceTo(size('CITY')) > 1 && size('GT').distanceTo(size('GT1')) > 0.03 && size('GT1').distanceTo(size('CITY')) > 1, 'the three classes differ in size');
}

// 10. the preview camera: every corner of the car's bounding box is inside the picture, and the camera is in front of the car's
// right side (the nose is towards +x, the right is +z)
for (const [name, v] of Object.entries(views)) {
  const box = boxOf(v.root);
  for (const aspect of [1.0, 1.3, 1.78, 2.4]) {
    for (const az of [PREVIEW_AZ - 14, PREVIEW_AZ, PREVIEW_AZ + 14]) {
      const f = previewFrame(CONFIGS[name], aspect, az, v.hull.position.x);
      const cam = new THREE.PerspectiveCamera(PREVIEW_FOV, aspect, 0.1, 100);
      cam.position.set(f.x, f.y, f.z); cam.lookAt(...f.target); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
      let worst = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(cam);
        worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
      }
      check(worst <= 1 && worst >= 0.55, `${name} fits the preview, and fills it, at aspect ${aspect}, az ${az} (worst corner at ${worst.toFixed(2)} of the half frame)`);
      check(f.x > 0 && f.z > 0, `${name} preview camera is at the front right`);
    }
  }
}

for (const v of Object.values(views)) v.dispose();
console.log(fails ? `carmodels: ${fails} of ${n} checks FAILED` : `carmodels: all ${n} checks passed`);
if (fails) process.exit(1);
