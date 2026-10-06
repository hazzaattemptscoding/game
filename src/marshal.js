// Marshal posts with LED light panels, one at every minisector boundary (src/minisectors.js), standing behind the barrier on the outside
// of the track and facing the cars that are coming. The panel at boundary k is the one a car passes as it enters minisector k.
// Two instanced meshes (the posts with the panel housing, and the lit faces with a colour per instance), so +2 draw calls however many posts.
//   planMarshal(T, ground, { obstacles, blockers })  where each post stands, as numbers (tools/minisectors.js checks them)
//   createMarshalLights(T, ground, plan?)  { group, posts, set(k, state), setAll(state), state(k), update(time) }
//   MarshalWatch  turns on yellow by itself for the player's car when it is off the track or stopped (needs no race control yet)
// States: off, yellow (flashes), double (double yellow: flashes faster), red, green, blue.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SURF } from './track.js';
import { wallClearance } from './grandstands.js';
import { trackPoint } from './meshKit.js';
import { minisectorBounds, minisectorAt } from './minisectors.js';
import { allWheelsBeyondLine } from './trackLimits.js';

export const STATES = ['off', 'yellow', 'double', 'red', 'green', 'blue'];
const COLOUR = { off: 0x15181b, yellow: 0xffc400, double: 0xffc400, red: 0xff1a1a, green: 0x14e060, blue: 0x2a6bff };
const FLASH_HZ = { yellow: 1.5, double: 3 };   // a flashing state is lit for half of each period
const PANEL = 1.8, POST_H = 2.1, PANEL_Y = 3.0;   // metres: the square housing, the post under it, the housing centre above the ground
const SLIDES = [0]; for (let m = 6; m <= 120; m += 6) SLIDES.push(m, -m);
const BEHIND = 2.5, BARRIER = 2.5;                 // least distance from the wall face and from any barrier line

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

// one post per minisector boundary: [{ k, s, side (0 left, 1 right), x, z, yaw, fx, fz }]; `why` lists any boundary with no valid place
export function planMarshal(T, ground, { obstacles = [], blockers = [], n } = {}) {
  const B = minisectorBounds(T, false, n), count = B.length - 1, posts = [], why = [];
  const near = (i, f) => { for (let j = -10; j <= 10; j++) if (f(((i + j) % T.N + T.N) % T.N)) return true; return false; };
  const free = (x, z) => {
    if (wallClearance(T, x, z) < BEHIND) return false;
    for (const sg of T.segs) if (segDist(x, z, sg) < BARRIER) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + 2) return false;
    for (const o of obstacles) { const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1]; if (Math.abs(a) < o.len / 2 + 3 && b > -4 && b < o.depth + 3) return false; }
    return true;
  };
  for (let k = 0; k < count; k++) {
    let found = null;
    // the boundary itself, then slid along the road in 6 m steps when the spot is taken (a stand, the pit lane, a bridge)
    for (const slide of SLIDES) {
      const s = B[k] + slide, p = trackPoint(T, s, 0), a = trackPoint(T, s - 25, 0), b = trackPoint(T, s + 25, 0);
      if (near(p.i, j => T.isBridge[j])) continue;
      // the outside of the bend: a car running wide goes this way. Straights go to the right.
      const turn = (b.tx - a.tx) * p.nx + (b.tz - a.tz) * p.nz;
      const sides = Math.abs(turn) < 0.02 ? [1, 0] : turn > 0 ? [0, 1] : [1, 0];
      for (const side of sides) {
        if (side === 0 && near(p.i, j => T.pitOut[j] > 0 || T.pitMouth[j])) continue;
        const sg = side ? 1 : -1;
        for (let off = 3; off <= 9 && !found; off += 1) {
          const q = trackPoint(T, s, sg * (T.wall[side][p.i] + off));
          if (!free(q.x, q.z)) continue;
          // the panel faces back along the road at the cars coming, turned a little toward the track so a car in the corner sees it too
          let fx = -p.tx - sg * p.nx * 0.5, fz = -p.tz - sg * p.nz * 0.5; const m = Math.hypot(fx, fz); fx /= m; fz /= m;
          found = { k, s, side, x: q.x, z: q.z, yaw: Math.atan2(fx, fz), fx, fz };
        }
        if (found) break;
      }
      if (found) break;
    }
    if (found) posts.push(found); else why.push({ k, s: B[k] });
  }
  return { posts, why };
}

export function createMarshalLights(T, ground, plan = planMarshal(T, ground)) {
  const posts = plan.posts, N = posts.length;
  const group = new THREE.Group();
  const post = new THREE.BoxGeometry(0.1, POST_H, 0.1); post.translate(0, POST_H / 2, 0);
  const housing = new THREE.BoxGeometry(PANEL, PANEL, 0.12); housing.translate(0, PANEL_Y, 0);
  const frame = mergeGeometries([post, housing]);
  // the lit face on both sides of the housing, so a car coming the other way (reverse laps) sees it too
  const face = new THREE.PlaneGeometry(PANEL - 0.16, PANEL - 0.16); face.translate(0, PANEL_Y, 0.065);
  const back = face.clone(); back.rotateY(Math.PI); back.translate(0, 0, 0);
  const led = mergeGeometries([face, back]);
  const frames = new THREE.InstancedMesh(frame, new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.6, metalness: 0.4 }), N);
  const leds = new THREE.InstancedMesh(led, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), C = new THREE.Color();
  posts.forEach((p, i) => {
    M.compose(new THREE.Vector3(p.x, (ground ? ground.meshHeight(p.x, p.z) : 0) - 0.05, p.z), Q.setFromAxisAngle(UP, p.yaw), ONE);
    frames.setMatrixAt(i, M); leds.setMatrixAt(i, M); leds.setColorAt(i, C.setHex(COLOUR.off));
  });
  frames.castShadow = leds.castShadow = false;
  frames.computeBoundingSphere(); leds.computeBoundingSphere();
  frames.userData.debug = leds.userData.debug = 'sign';
  group.add(frames, leds);

  const states = new Array(N).fill('off');
  let dirty = true, flashing = 0, lastPhase = '';
  const index = new Map(posts.map((p, i) => [p.k, i]));   // boundary number to instance, in case a boundary had no place

  function set(k, state) {
    if (!STATES.includes(state)) throw new Error('marshal light state: ' + state);
    const i = index.get(((k % (N || 1)) + (N || 1)) % (N || 1));
    if (i === undefined || states[i] === state) return;
    states[i] = state; dirty = true;
    flashing = states.filter(s => FLASH_HZ[s]).length;
  }
  const state = k => { const i = index.get(k); return i === undefined ? null : states[i]; };
  function setAll(s) { for (const p of posts) set(p.k, s); }

  // `time` in seconds; recolours only when a state changed or a flash turned over
  function update(time) {
    let phase = '';
    if (flashing) phase = Object.keys(FLASH_HZ).map(s => Math.floor(time * FLASH_HZ[s] * 2) & 1).join('');
    if (!dirty && phase === lastPhase) return;
    dirty = false; lastPhase = phase;
    for (let i = 0; i < N; i++) {
      const s = states[i], hz = FLASH_HZ[s], lit = !hz || !(Math.floor(time * hz * 2) & 1);
      leds.setColorAt(i, C.setHex(lit ? COLOUR[s] : COLOUR.off));
    }
    leds.instanceColor.needsUpdate = true;
  }
  update(0);
  return { group, posts, count: N, set, setAll, state, update, states: () => states.slice() };
}

// Yellow by itself for the player's car: off the track (no wheel on the racing surface) or stopped on it for over a second, not in the
// pit lane. Lit at the car's minisector and the one before it as the cars come (the two after it in a reverse lap). It clears once the car has
// been driving normally for 3 s. Only lights it switched on itself are cleared, so a red or green from the API is left alone. Not armed until
// the car has been over 10 m/s, and a jump (a reset, a new session) disarms it, so the grid or a reset car does not light the road.
export class MarshalWatch {
  constructor(lights, T) {
    this.lights = lights; this.T = T; this.bounds = minisectorBounds(T, false);
    this.n = this.bounds.length - 1;
    this.armed = false; this.since = null; this.calm = null; this.mine = new Set(); this.px = null; this.pz = null;
  }

  update(car, time, reverse = false) {
    const jump = this.px !== null && Math.hypot(car.x - this.px, car.z - this.pz) > 30;
    this.px = car.x; this.pz = car.z;
    if (jump) { this.armed = false; this.since = null; }
    if (car.speed > 10) this.armed = true;
    const inPit = car.pitLimiter || car.wheelSurf.some(w => w === SURF.PIT);
    const hazard = this.armed && !inPit && (allWheelsBeyondLine(car) || car.speed < 3);
    if (!hazard) { this.since = null; if (this.mine.size && this.calm === null) this.calm = time; if (this.calm !== null && time - this.calm >= 3) this.clear(); return; }
    this.calm = null;
    if (this.since === null) this.since = time;
    if (time - this.since < 1) return;
    const m = minisectorAt(this.bounds, car.loc.s), n = this.n;
    const want = reverse ? [(m + 1) % n, (m + 2) % n] : [m, (m + n - 1) % n];
    for (const k of [...this.mine]) if (!want.includes(k)) { if (this.lights.state(k) === 'yellow') this.lights.set(k, 'off'); this.mine.delete(k); }
    for (const k of want) if (!this.mine.has(k) && this.lights.state(k) === 'off') { this.lights.set(k, 'yellow'); this.mine.add(k); }
  }

  clear() {
    for (const k of this.mine) if (this.lights.state(k) === 'yellow') this.lights.set(k, 'off');
    this.mine.clear(); this.calm = null;
  }
}
