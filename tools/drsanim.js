// DRS flap test. Run with `npm run drsanim`. No browser needed.
//   1. the easing (src/drsFlap.js): 99 % within the open and close times, no overshoot, symmetric per its constants, frame
//      rate independent, dt of 0 and bad dt, large dt clamped
//   2. the flap on the real CarView (src/car.js) built in node: it flattens and angles up with car.drs, and the trailing edge moves
//   3. the DRS flag on the wire (src/ghosts.js): col bit 0 through stateFromCar, encodeState, packState, unpackState, decodeState
//      and JSON, bad flags clamp to 0, the layout is unchanged
//   4. the interpolation buffer takes the flag from the newest packet at or before the moment shown, never blended
//   5. a remote car (threeFactory, the browser side, with a stub DOM) flattens its flap from the flag in its pose

import * as THREE from 'three';
import { stepFlap, flapAngle, REST_ANGLE, OPEN_MS, CLOSE_MS, MAX_DT } from '../src/drsFlap.js';
import { CarView } from '../src/car.js';
import { GT } from '../src/cars.js';
import { encodeState, packState, unpackState, decodeState, stateFromCar, StateBuffer, FLAG_DRS, FIELDS, threeFactory } from '../src/ghosts.js';
import { defaultLivery } from '../src/livery.js';

let n = 0, fails = 0;
function check(ok, label) {
  n++;
  if (!ok) { fails++; console.log(`  FAIL ${label}`); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- 1. the easing
console.log('EASING');
{
  // n frames of `seconds` in all, each frame at most MAX_DT (a longer frame is clamped, checked below)
  const settle = (f, target, seconds, frames) => { for (let i = 0; i < frames; i++) f = stepFlap(f, target, seconds / frames); return f; };
  const sec = ms => ms / 1000;
  check(settle(0, 1, sec(OPEN_MS), 16) >= 0.99 - 1e-12, 'in the open time (16 frames) the flap reaches 99 % open');
  check(settle(1, 0, sec(CLOSE_MS), 22) <= 0.01 + 1e-12, 'in the close time (22 frames) the flap reaches 99 % shut');
  check(settle(0, 1, sec(OPEN_MS) * 0.99, 16) < 0.99, 'a little short of the open time it is not yet 99 % open (no early snap)');
  check(settle(1, 0, sec(CLOSE_MS), 22) <= 0.01 + 1e-12 && settle(1, 0, sec(OPEN_MS), 16) > 0.01, 'shutting is slower than opening: not yet shut at 160 ms');
  check(settle(0, 1, sec(OPEN_MS / 2), 8) < 0.95 && settle(1, 0, sec(CLOSE_MS / 2), 11) > 0.05, 'halfway through the time it is not at the ends (eased, not snapped)');

  // no overshoot: from every start, through every kind of frame time, the flap moves towards the target and stops there
  let overshoot = 0, backwards = 0;
  const dts = [0, 1e-4, 0.004, 0.016, 0.05, 0.1, 0.25, 1, 10];
  for (const target of [0, 1]) for (const dt of dts) for (const start of [0, 0.2, 0.5, 0.9, 1]) {
    let v = start;
    for (let i = 0; i < 200; i++) {
      const nv = stepFlap(v, target, dt);
      if (nv < Math.min(v, target) - 1e-15 || nv > Math.max(v, target) + 1e-15) overshoot++;
      if (Math.abs(target - nv) > Math.abs(target - v) + 1e-15) backwards++;
      v = nv;
    }
  }
  check(overshoot === 0, 'the flap never passes its target');
  check(backwards === 0, 'the flap only ever moves towards its target');

  // symmetric per its constants: the shut curve is the open curve turned over, each on its own time
  let asym = 0;
  for (const s of [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
    const up = settle(0, 1, sec(OPEN_MS) * s, 40), down = 1 - settle(1, 0, sec(CLOSE_MS) * s, 40);
    if (!near(up, down, 1e-12)) asym++;
  }
  check(asym === 0, 'opening and shutting are mirror images on their own times');

  // frame rate independent: six frames of 1/60 s are the same as one of 0.1 s
  let g = 0; for (let i = 0; i < 6; i++) g = stepFlap(g, 1, 1 / 60);
  check(near(g, stepFlap(0, 1, 0.1), 1e-12), 'six frames of 1/60 s equal one of 0.1 s');

  // dt of 0, negative and NaN: nothing moves
  check(stepFlap(0.3, 1, 0) === 0.3 && stepFlap(0.7, 0, 0) === 0.7, 'dt of 0 leaves the flap where it is');
  check(stepFlap(0.4, 1, -1) === 0.4 && stepFlap(0.4, 1, NaN) === 0.4, 'negative and NaN dt leave the flap where it is');
  // large dt is clamped to MAX_DT: a stall does not jump the flap
  check(stepFlap(0, 1, 10) === stepFlap(0, 1, MAX_DT) && stepFlap(0, 1, sec(OPEN_MS)) === stepFlap(0, 1, MAX_DT), 'a long frame counts as MAX_DT');
  check(stepFlap(0, 1, 10) < 0.95, 'after a long stall the flap is still opening, not snapped open');
  check(stepFlap(NaN, 1, 0.016) > 0 && stepFlap(NaN, 1, 0.016) <= 1, 'a NaN position is read as the rest position');

  check(flapAngle(0) === REST_ANGLE && flapAngle(1) === 0 && flapAngle(3) === 0 && flapAngle(-1) === REST_ANGLE, 'the trailing edge is REST_ANGLE up at rest, flat when open, clamped');
  check(near(REST_ANGLE, 22 * Math.PI / 180), 'rest angle is 22 degrees');
}

// ---------------------------------------------------------------- 2. the flap on the car
console.log('CAR VIEW');
{
  const view = new CarView(GT);
  const car = { prev: null, x: 0, y: 0, z: 0, heading: 0, steer: 0, wheelSpinAngle: 0, wheel: 0, ax: 0, ay: 0, brake: 0, fwdSpeed: 0, bump: 0,
    loc: { tx: 1, tz: 0, grade: 0 }, groundPitch: 0, groundRoll: 0, drs: false };
  car.prev = car;
  // one frame of dt seconds with the car's drs flag set (CarView.update reads the time from performance.now)
  const frame = (drs, dt) => { car.drs = drs; view._t = performance.now() / 1000 - dt; view.update(car, 1); };
  const angle = () => -view.flapPivot.rotation.z;

  for (let i = 0; i < 3; i++) frame(false, 0.016);
  check(near(angle(), REST_ANGLE, 1e-9), 'the flap sits angled up at rest when DRS is off (trailing edge REST_ANGLE above the main plane)');
  for (let i = 0; i < 10; i++) frame(true, 0.016);
  check(angle() >= 0 && angle() <= 0.01 * REST_ANGLE + 1e-6, 'the flap flattens to the main plane (0 degrees) within 160 ms of car.drs');
  view.flapPivot.updateMatrix();
  const tail = new THREE.Vector3(-0.15, 0, 0).applyMatrix4(view.flapPivot.matrix);     // the flap's trailing corner, in body space
  const rise = tail.y - view.flapPivot.position.y, back = view.flapPivot.position.x - tail.x;
  check(near(rise, 0.15 * Math.sin(angle()), 1e-9), 'the trailing edge lifts by the flap chord times sin(angle)');
  check(rise < 0.001, 'with DRS open the trailing edge is level with the main plane');
  const hingeFwd = view.spec.wing;
  check(view.flapPivot.position.x > hingeFwd.x && view.flapPivot.position.x < hingeFwd.x + hingeFwd.main, 'the hinge sits inside the main plane, so the flap meets it with no gap');
  check(near(back, 0.15 * Math.cos(angle()), 1e-9), 'the hinge stays put: the flap turns about its leading edge');
  for (let i = 0; i < 14; i++) frame(false, 0.016);
  check(near(angle(), REST_ANGLE, 0.01 * REST_ANGLE), 'the flap angles back up to its rest position after DRS goes off');
  const wing = view.flapPivot.children[0];
  check(wing.material[0] === view.wingMat && wing.material[3] !== view.wingMat, 'the flap is in the livery wing colour, its underside dark');
  view.dispose();
}

// ---------------------------------------------------------------- 3. the flag on the wire
console.log('WIRE');
{
  const car = { x: 812.34, y: 1.25, z: -406.78, heading: 1.571, vx: 30.12, vz: -4.5, yawRate: 0.123, steer: -0.2, wheelSpinAngle: 3.14,
    throttle: 0.8, brake: 0, groundPitch: 0.01, groundRoll: -0.02, loc: { s: 1234.5 }, drs: true };
  check(FIELDS.length === 17 && FIELDS[14] === 'col', 'the field order is unchanged: col is still the 15th field');
  const open = stateFromCar(car, 2, 'Ann', 1000, 95.1, 97.5);
  check(open.col === FLAG_DRS && FLAG_DRS === 1, 'an open DRS is sent as flag bit 0');
  const shut = stateFromCar({ ...car, drs: false }, 2, 'Ann', 1000);
  check(shut.col === 0, 'a shut DRS is sent as 0');
  for (const [label, st, want] of [['open', open, true], ['shut', shut, false]]) {
    const bin = decodeState(unpackState(packState(encodeState(st))));
    check(bin && bin.drs === want && bin.col === (want ? 1 : 0), `binary frame round trip, DRS ${label}`);
    const json = decodeState(JSON.parse(JSON.stringify(encodeState(st))));
    check(json && json.drs === want && json.name === 'Ann' && json.lap === 2, `JSON round trip, DRS ${label}`);
  }
  // the other bits: a flag value with bit 0 clear is not DRS, with bit 0 set it is, whatever the other bits say
  for (const [col, want] of [[2, false], [3, true], [6, false], [7, true]]) {
    const d = decodeState(unpackState(packState(encodeState({ ...open, col }))));
    check(d && d.col === col && d.drs === want, `flags ${col} give DRS ${want}`);
  }
  // a bad flags value clamps to 0 (and so no DRS), and nothing else in the packet is touched
  for (const bad of [8, 9, 99, -1, -7, 1e6]) {
    const d = decodeState(decodeJsonRound(encodeState({ ...open, col: bad })));
    check(d && d.col === 0 && d.drs === false && d.lap === 2 && d.name === 'Ann', `a bad flags value (${bad}) clamps to 0`);
  }
  const old = decodeState(encodeState({ ...open, col: 1 }).map((v, i) => i === 15 ? 'x' : v));
  check(old === null, 'a non-number in the flags slot is still refused (the packet is rejected, as for any field)');
  // an old client sends its legacy colour index here: only bit 0 means DRS, so old packets never show a flap by mistake
  const legacy = decodeState(encodeState({ ...open, col: 4 }));
  check(legacy && legacy.drs === false, 'a legacy colour index (bit 0 clear) does not open the flap');
}
function decodeJsonRound(arr) { return JSON.parse(JSON.stringify(arr)); }

// ---------------------------------------------------------------- 4. the interpolation buffer
console.log('BUFFER');
{
  const pk = (t, drs) => ({ t, x: t * 0.1, y: 0, z: 0, h: 0, vx: 0, vz: 0, yr: 0, st: 0, w: 0, thr: 0, brk: 0, pz: 0, rx: 0, col: drs ? 1 : 0, drs, lap: 0, s: 0, name: 'A', bl: 0, ll: 0 });
  const b = new StateBuffer(0, { legacy: true });       // legacy: a fixed delay of 0 and no clock offset, so the moment shown is the local time
  for (const t of [0, 50, 100, 150, 200]) b.push(pk(t, t >= 150), t);
  check(b.sample(120, {}).drs === false, 'between a shut packet and an open one, the older (shut) flag is shown, not blended');
  check(b.sample(149, {}).drs === false, 'just before the open packet: still shut');
  check(b.sample(150, {}).drs === true, 'at the open packet: open');
  check(b.sample(175, {}).drs === true, 'between two open packets: open');
  check(b.sample(260, {}).drs === true, 'past the newest packet: the newest flag holds');
  check(Math.abs(b.sample(125, {}).x - 12.5) < 1e-9, 'positions are still interpolated (x at 125 ms is 12.5)');
  const c = new StateBuffer(0, { legacy: true });
  for (const t of [0, 50, 100]) c.push(pk(t, true), t);
  c.push(pk(150, false), 150);
  check(c.sample(120, {}).drs === true && c.sample(150, {}).drs === false, 'an open to shut change follows the same rule');
  const e = new StateBuffer(0, { legacy: true });
  e.push(pk(0, false), 0);
  check(e.sample(0, {}).drs === false && e.sample(-5, {}).drs === false, 'a single packet gives its flag');
}

// ---------------------------------------------------------------- 5. a remote car
console.log('REMOTE CAR');
{
  const hadDoc = 'document' in globalThis;
  // a no-op 2D canvas: the livery textures are painted on canvases, which node does not have
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => '' });
  if (!hadDoc) globalThis.document = { createElement: t => (t === 'canvas' ? canvas() : { style: {}, remove() {}, appendChild() {} }) };
  const scene = { add() {}, remove() {} }, tagRoot = { appendChild() {} };
  const ent = threeFactory(scene, tagRoot).create({ id: 'p1', livery: defaultLivery('p1'), name: 'Bo' });
  const view = ent.view;
  const pose = { x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0, yr: 0, st: 0, w: 0, brk: 0, thr: 0, pz: 0, rx: 0 };
  const frame = drs => { view._t = performance.now() / 1000 - 0.016; ent.setPose({ ...pose, drs }); };
  for (let i = 0; i < 3; i++) frame(false);
  check(near(-view.flapPivot.rotation.z, REST_ANGLE, 1e-9), 'a remote car with no flag has its flap angled at rest');
  for (let i = 0; i < 10; i++) frame(true);
  check(-view.flapPivot.rotation.z <= 0.01 * REST_ANGLE + 1e-6, 'a remote car with the DRS flag in its pose flattens the flap');
  for (let i = 0; i < 14; i++) frame(false);
  check(-view.flapPivot.rotation.z >= 0.99 * REST_ANGLE - 1e-6, 'and angles it back up when the flag goes off');
  // a pose without the field (the board ghost) is shut
  view._t = performance.now() / 1000 - 0.016; for (let i = 0; i < 10; i++) { view._t = performance.now() / 1000 - 0.016; ent.setPose(pose); }
  check(near(-view.flapPivot.rotation.z, REST_ANGLE, 0.01 * REST_ANGLE), 'a pose with no drs field keeps the flap at rest');
  ent.dispose();
  if (!hadDoc) delete globalThis.document;
}

console.log(fails ? `drsanim: ${fails} of ${n} checks FAILED` : `drsanim: all ${n} checks passed`);
if (fails) process.exit(1);
