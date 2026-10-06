// Chase camera on hills: drives a stand-in car up and down the steepest stretches of the lap at racing speed, through the real
// CameraRig (src/cameras.js) with the track's ground, and checks the road ahead stays in view over the car's roof.
// node tools/camera.js
import * as THREE from 'three';
import { buildTrack } from '../src/track.js';
import { CameraRig } from '../src/cameras.js';

const T = buildTrack();
const ROOF = 1.15, SPEED = 60, DT = 1 / 120, LIMIT = 12;   // the road must show within 12 m past the car
const fails = [];
const at = s => ((Math.round(s / T.ds) % T.N) + T.N) % T.N;

// the steepest climb and the steepest descent along the lap
let up = 0, down = 0;
for (let i = 0; i < T.N; i++) { if (T.grade[i] > T.grade[up]) up = i; if (T.grade[i] < T.grade[down]) down = i; }

for (const [name, i0] of [['climb', up], ['descent', down]]) {
  const rig = new CameraRig(16 / 9);
  rig.groundAt = (x, z) => T.groundAt(x, z);
  const root = new THREE.Object3D(), slope = new THREE.Object3D(), view = { root, slope };
  let worst = 0;
  // run up to the steepest point from 150 m before it, the camera settling as it would in a lap
  for (let s = T.s[i0] - 150; s <= T.s[i0] + 30; s += SPEED * DT) {
    const i = at(s), y = T.groundAt(T.x[i], T.z[i], i);
    root.position.set(T.x[i], y, T.z[i]);
    root.rotation.y = -Math.atan2(T.tz[i], T.tx[i]);
    slope.rotation.z = Math.atan(T.grade[i]);
    rig.update(view, { speed: SPEED, fwdSpeed: SPEED, vx: T.tx[i] * SPEED, vz: T.tz[i] * SPEED }, DT);
    if (s < T.s[i0] - 20) continue;
    // the sightline from the camera over the roof: how far past the car until it meets the road
    const cam = rig.camera.position, back = Math.hypot(cam.x - T.x[i], cam.z - T.z[i]);
    const over = (y + ROOF - cam.y) / back;   // its slope past the roof (metres per metre)
    let seen = Infinity;
    for (let x = 0.5; x <= 60; x += 0.5) { const j = at(s + x); if (y + ROOF + over * x <= T.h[j] + 0.05) { seen = x; break; } }
    worst = Math.max(worst, seen);
  }
  console.log(`  ${name} at s=${T.s[i0].toFixed(0)} (${(T.grade[i0] * 100).toFixed(1)} %), ${SPEED} m/s: road in view from ${Number.isFinite(worst) ? worst.toFixed(1) + ' m' : 'never'} past the car (limit ${LIMIT} m)`);
  if (!(worst <= LIMIT)) fails.push(`${name}: the road ahead is hidden by the car for ${Number.isFinite(worst) ? worst.toFixed(1) + ' m' : 'the whole view'}`);
}
if (fails.length) { console.log('  FAILED:\n' + fails.map(f => '   - ' + f).join('\n')); process.exit(1); }
console.log('  camera: all passed');
