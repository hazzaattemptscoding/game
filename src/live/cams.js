// Cameras of the live page. One THREE camera, six ways to move it:
//   tv          follows the TV director's shots (src/live/tv.js): trackside, chase, onboard or heli, whichever it asked for
//   onboard     in the car of the selected driver
//   chase       behind the selected driver
//   trackside   a fixed camera at one of the spots around the lap that turns to follow the selected driver
//   heli        high above and behind the selected driver
//   free        yours: drag to look, W A S D to move, Q and E to go down and up, Shift for fast
// pose(id) gives { x, y, z, h, pz, vx, vz } of a car (the interpolated one that is on screen), or null.

import * as THREE from 'three';

export const MODES = ['tv', 'onboard', 'chase', 'trackside', 'heli', 'free'];
export const MODE_NAMES = { tv: 'TV', onboard: 'Onboard', chase: 'Chase', trackside: 'Trackside', heli: 'Heli', free: 'Free' };
const SPOT_COUNT = 10;

// Fixed trackside cameras: the sharpest corners (and so the likeliest battles), outside the bend, a few metres up and clear of the barrier.
// Each spot is { s, x, y, z, name }. Chosen from the track's curvature, so it follows the layout.
export function trackSpots(track, count = SPOT_COUNT) {
  const N = track.N, minGap = Math.floor(N / (count * 1.4));
  const idx = [...Array(N).keys()].sort((a, b) => Math.abs(track.curv[b]) - Math.abs(track.curv[a]));
  const chosen = [];
  for (const i of idx) {
    if (chosen.length >= count) break;
    if (chosen.every(j => { const d = Math.abs(i - j); return Math.min(d, N - d) > minGap; })) chosen.push(i);
  }
  // fill with evenly spaced spots if the layout has fewer corners than cameras
  for (let k = 0; chosen.length < count; k++) { const i = Math.floor((k + 0.5) * N / count); if (chosen.every(j => Math.min(Math.abs(i - j), N - Math.abs(i - j)) > 10)) chosen.push(i); else chosen.push((i + 20) % N); }
  chosen.sort((a, b) => a - b);
  return chosen.map((i, n) => {
    const j = (i + 8) % N, inward = (track.tx[j] - track.tx[i]) * track.nx[i] + (track.tz[j] - track.tz[i]) * track.nz[i];   // which side the road turns towards
    const d = (track.halfWidth + 20) * (inward > 0 ? -1 : 1);                                                                 // the camera goes on the other side
    return { s: track.s[i], x: track.x[i] + track.nx[i] * d, y: track.h[i] + 5, z: track.z[i] + track.nz[i] * d, name: `Camera ${n + 1}` };
  });
}

const smooth = (cur, want, k) => cur + (want - cur) * k;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class LiveCameras {
  constructor(camera, track, pose) {
    this.camera = camera; this.track = track; this.pose = pose;
    this.spots = trackSpots(track);
    this.mode = 'tv';
    this.target = null;           // the selected driver id
    this.shot = null;             // the director's shot while in tv mode
    this.spot = 0;                // the trackside spot in use
    this.free = { x: 0, y: 40, z: 0, yaw: 0, pitch: -0.4 };
    this.keys = new Set();
    this.yaw = null; this.height = null;
    this._look = new THREE.Vector3();
    this.lookAtId = null;
    this.spotLocked = false;       // true while the viewer chose a trackside camera by hand
    this.label = '';
  }

  pickSpot(i) { this.spot = Math.max(0, Math.min(this.spots.length - 1, i | 0)); this.spotLocked = true; this.setMode('trackside'); }

  setMode(m) { if (MODES.includes(m)) { this.mode = m; if (m !== 'trackside') this.spotLocked = false; this.yaw = null; this.height = null; if (m === 'free') this.startFree(); } }

  // the free camera starts where the camera was, looking the same way
  startFree() {
    const c = this.camera, e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
    Object.assign(this.free, { x: c.position.x, y: c.position.y, z: c.position.z, yaw: e.y, pitch: e.x });
  }

  nearestSpot(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.spots.length; i++) { const s = this.spots[i], d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }

  // the free camera: dx, dy are mouse or touch movement in pixels
  look(dx, dy) {
    if (this.mode !== 'free') return;
    this.free.yaw -= dx * 0.004; this.free.pitch = Math.max(-1.5, Math.min(1.5, this.free.pitch - dy * 0.004));
  }

  // what is being shown now: { mode, id } (in tv mode the director's choice)
  get current() {
    if (this.mode === 'tv') return this.shot ? { mode: this.shot.kind, id: this.shot.id } : { mode: 'tv', id: null };
    return { mode: this.mode, id: this.mode === 'free' ? null : this.target };
  }

  update(dt) {
    let mode = this.mode, id = this.target;
    if (mode === 'tv') { if (this.shot) { mode = this.shot.kind; id = this.shot.id; } else mode = 'heli'; }
    const p = id != null ? this.pose(id) : null;
    const cam = this.camera;
    if (mode === 'free') return this.updateFree(dt);
    if (!p) { this.overview(); return; }
    const hx = Math.cos(p.h), hz = Math.sin(p.h), speed = Math.hypot(p.vx, p.vz);
    this.lookAtId = id;
    if (mode === 'onboard') {
      cam.position.set(p.x + hx * 1.1, p.y + 1.05, p.z + hz * 1.1);       // over the bonnet, in front of the cab
      this._look.set(p.x + hx * 20, p.y + 1.0 + Math.tan(p.pz || 0) * 20, p.z + hz * 20);
      cam.lookAt(this._look);
      this.yaw = null;
      this.fov(66, dt);
    } else if (mode === 'chase') {
      const travel = speed > 3 ? Math.atan2(p.vz, p.vx) : p.h, want = p.h + 0.35 * angDiff(travel, p.h);
      if (this.yaw === null) { this.yaw = want; this.height = p.y; }
      this.yaw += angDiff(want, this.yaw) * Math.min(1, dt * 7); this.height = smooth(this.height, p.y, Math.min(1, dt * 4));
      const cx = Math.cos(this.yaw), cz = Math.sin(this.yaw);
      cam.position.set(p.x - cx * 7, this.height + 2.2, p.z - cz * 7);
      this._look.set(p.x + cx * 4, p.y + 1, p.z + cz * 4);
      cam.lookAt(this._look);
      this.fov(62 + 8 * Math.min(1, speed / 75), dt);
    } else if (mode === 'trackside') {
      if (this.mode === 'tv' || !this.spotLocked) this.spot = this.nearestSpot(p);       // the camera the car is closest to, unless the viewer chose one
      const sp = this.spots[this.spot];
      cam.position.set(sp.x, sp.y, sp.z);
      this._look.set(p.x + hx * speed * 0.15, p.y + 0.8, p.z + hz * speed * 0.15);
      cam.lookAt(this._look);
      const dist = Math.hypot(p.x - sp.x, p.z - sp.z);
      this.fov(Math.max(18, Math.min(60, 2 * Math.atan(9 / Math.max(10, dist)) * 180 / Math.PI * 1.6)), dt);      // zoom in on far cars
    } else {   // heli
      const cx = Math.cos(p.h), cz = Math.sin(p.h);
      cam.position.set(p.x - cx * 38, p.y + 30, p.z - cz * 38);
      this._look.set(p.x + cx * 10, p.y, p.z + cz * 10);
      cam.lookAt(this._look);
      this.fov(50, dt);
    }
  }

  fov(want, dt) {
    const cam = this.camera;
    if (Math.abs(cam.fov - want) > 0.05) { cam.fov = smooth(cam.fov, want, Math.min(1, dt * 3)); cam.updateProjectionMatrix(); }
  }

  // nobody to look at yet: a high view of the whole circuit
  overview() {
    const T = this.track;
    let cx = 0, cz = 0;
    for (let i = 0; i < T.N; i += 20) { cx += T.x[i]; cz += T.z[i]; }
    const n = Math.ceil(T.N / 20);
    this.camera.position.set(cx / n, 900, cz / n + 300);
    this.camera.lookAt(cx / n, 0, cz / n);
    this.fov(50, 1);
  }

  updateFree(dt) {
    const f = this.free, cam = this.camera, k = this.keys, sp = (k.has('shift') ? 120 : 30) * dt;
    const fx = Math.sin(f.yaw) * -1, fz = Math.cos(f.yaw) * -1;     // the direction the camera looks along, level
    let mx = 0, mz = 0, my = 0;
    if (k.has('w') || k.has('arrowup')) { mx += fx; mz += fz; }
    if (k.has('s') || k.has('arrowdown')) { mx -= fx; mz -= fz; }
    if (k.has('a') || k.has('arrowleft')) { mx += fz; mz -= fx; }
    if (k.has('d') || k.has('arrowright')) { mx -= fz; mz += fx; }
    if (k.has('e')) my += 1;
    if (k.has('q')) my -= 1;
    f.x += mx * sp; f.z += mz * sp; f.y = Math.max(1, f.y + my * sp);
    cam.position.set(f.x, f.y, f.z);
    cam.quaternion.setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
    this.fov(60, dt);
  }

  // move the free camera by a screen gesture: forward (m) and sideways (m) in metres, for a phone with no keyboard
  nudge(forward, side) {
    const f = this.free, fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    f.x += fx * forward + fz * side; f.z += fz * forward - fx * side;
  }
}
