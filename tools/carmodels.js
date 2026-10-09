// Car model test. Run with `npm run carmodels`. No browser needed.
//   1. each class builds (src/car.js, bodySpec): the GT (id 'GT' and no id), the GT1 and the CITY, from test configs made here
//      (src/cars.js only has the GT until the other classes are added there)
//   2. bounding box within 5 % of the class's length, height and width. The GT's glasshouse bevel adds 0.08 m to its roof
//      (an existing part of the model, kept as it was), so the GT's height is checked against 1.2 + 0.08
//   3. the wheels touch the road (lowest point of each tyre at y = 0 within 1 cm) and sit under the body (the wheel's x is
//      within the body's length, and the body clears the road)
//   4. the GT and GT1 have a rear wing and a DRS flap that opens; the CITY has no wing group and no flap
//   5. the GT1 has its four wheel arch flares, the GT and CITY none
//   6. materials: a sane count, every mesh has one
//   7. livery: body, wing, stripe style, side panel, number plate and flat mode all apply on all three classes
//   8. stripes run over the car: their points stay within its height

import * as THREE from 'three';
import { CarView, bodySpec } from '../src/car.js';
import { GT } from '../src/cars.js';
import { deps } from '../src/liveryTex.js';
import { OPEN_ANGLE } from '../src/drsFlap.js';

let n = 0, fails = 0;
function check(ok, label) {
  n++;
  if (!ok) { fails++; console.log(`  FAIL ${label}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// The three classes as test configs (the numbers are the brief's, the wheel layout is set so the bodies sit over the wheels).
const CONFIGS = {
  GT,
  GT1: { ...GT, id: 'GT1', name: 'GT1', length: 4.8, width: 2.0, height: 1.15, trackWidth: 1.6, wheelRadius: 0.33, wheelbase: 2.9, frontWeight: 0.47 },
  CITY: { ...GT, id: 'CITY', name: 'CITY', length: 3.48, width: 1.62, height: 1.45, trackWidth: 1.36, wheelRadius: 0.29, wheelbase: 2.36, frontWeight: 0.56 },
};

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
const bodyOf = view => view.body.children[0];          // the extruded side profile is the first thing added to the body

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

  // 5. wheel arch flares
  const paintMeshes = v.body.children.filter(m => m.material === v.paint).length;
  const flares = name === 'GT1' ? 4 : 0;
  check(paintMeshes === 1 + flares, `${name} has ${flares} wheel arch flares (${paintMeshes - 1} found)`);

  // 6. materials
  const mats = v.materials();
  check(mats.length >= 8 && mats.length <= 16, `${name} has a sane number of materials (${mats.length})`);
  let bare = 0;
  v.root.traverse(o => { if (o.isMesh && !o.material) bare++; });
  check(bare === 0, `${name} every mesh has a material`);

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

// No id, or an unknown id, gives the GT's own shape.
{
  const size = c => boxOf(new CarView(c).root).getSize(new THREE.Vector3());
  const ref = size(GT), noId = size({ ...GT, id: undefined }), unknown = size({ ...GT, id: 'NOPE' });
  check(noId.distanceTo(ref) < 1e-9, 'a config with no id builds the GT');
  check(unknown.distanceTo(ref) < 1e-9, 'an unknown id builds the GT');
}

// The three classes are different bodies: their outlines are not the same length.
{
  const len = name => boxOf(views[name].root).getSize(new THREE.Vector3()).x;
  check(Math.abs(len('GT') - len('GT1')) > 0.1 && Math.abs(len('GT') - len('CITY')) > 0.5, 'the three classes differ in length');
}

for (const v of Object.values(views)) v.dispose();
console.log(fails ? `carmodels: ${fails} of ${n} checks FAILED` : `carmodels: all ${n} checks passed`);
if (fails) process.exit(1);
