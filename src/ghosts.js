// Other players' cars in a multiplayer room: the wire format for one car state, the interpolation that smooths
// it, and the set of remote cars that creates, fades and removes them.
//
// Everything except `threeFactory` and `makeProjector` is plain JavaScript with no DOM or WebGL, so
// tools/multiplayer.js runs it in node.
//
// Remote cars are drawn about 100 ms in the past, so there are normally two packets to blend. They are solid:
// `solids()` hands the same interpolated poses to Car.collideCars in src/physics.js.

import * as THREE from 'three';
import { CarView } from './car.js';
import { GT } from './cars.js';

export const DELAY = 0.1;         // seconds behind real time that remote cars are drawn
export const MAX_EXTRAP = 0.25;   // seconds a car may be extrapolated when packets are late, then it holds still
export const TIMEOUT = 3;         // seconds without a packet before a remote car is removed
export const FADE = 1;            // the last second before removal is a fade out
export const MAX_NAME = 16;
export const MAX_PLAYERS = 8;

// Car body colours. Index 0 is the player's own yellow, so remote cars use 1 to 7.
export const PALETTE = [0xffd21f, 0xe23b3b, 0x2f8fe0, 0x3cc46a, 0xe8863a, 0xb15fe0, 0x2fd0c8, 0xf06fb0];

// Fields of one state, in wire order. t is the sender's clock in ms, h the heading, vx/vz the velocity,
// yr the yaw rate, st the steering angle, w the wheel angle, thr/brk the pedals, pz/rx the slope pitch and roll
// of the body, col the colour index, lap and s the race progress (lap number and metres into the lap).
export const FIELDS = ['t', 'x', 'y', 'z', 'h', 'vx', 'vz', 'yr', 'st', 'w', 'thr', 'brk', 'pz', 'rx', 'col', 'lap', 's'];

export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const round = (n, d) => { const k = 10 ** d; return Math.round(n * k) / k; };
const TAU = Math.PI * 2;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const DIGITS = { t: 0, x: 2, y: 2, z: 2, h: 3, vx: 2, vz: 2, yr: 3, st: 3, w: 2, thr: 2, brk: 2, pz: 3, rx: 3, col: 0, lap: 0, s: 1 };

// One state on the wire: a flat array ['s', ...numbers, name, best, last]. Around 120 bytes as JSON.
// best and last are the sender's best and last lap times in seconds (0 = none yet). They come after the name so
// that anything reading only up to the name still works, and a packet without them decodes with 0.
export function encodeState(o) {
  const a = ['s'];
  for (const f of FIELDS) {
    let v = o[f] || 0;
    if (f === 'w') v %= TAU;
    a.push(round(v, DIGITS[f]));
  }
  a.push(cleanName(o.name));
  a.push(lapTime(o.bl), lapTime(o.ll));
  return a;
}

// a lap time in seconds for the wire: 0 for none or nonsense, else milliseconds precision
const lapTime = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 3600 ? round(v, 3) : 0);

// Returns a clean state or null. Anything from the network is untrusted: wrong types, NaN and absurd
// values are rejected, and the name is stripped to plain text.
export function decodeState(a) {
  if (!Array.isArray(a) || a[0] !== 's' || a.length < FIELDS.length + 1) return null;
  const o = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const v = a[i + 1];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    o[FIELDS[i]] = v;
  }
  if (Math.abs(o.x) > 1e5 || Math.abs(o.y) > 1e4 || Math.abs(o.z) > 1e5 || Math.abs(o.vx) > 400 || Math.abs(o.vz) > 400 || Math.abs(o.yr) > 50) return null;
  if (Math.abs(o.h) > 1e3 || Math.abs(o.st) > 3 || Math.abs(o.pz) > 3 || Math.abs(o.rx) > 3) return null;
  o.thr = Math.max(0, Math.min(1, o.thr)); o.brk = Math.max(0, Math.min(1, o.brk));
  o.col = Math.max(0, Math.min(PALETTE.length - 1, Math.round(o.col)));
  o.lap = Math.max(0, Math.min(9999, Math.round(o.lap)));
  o.s = Math.max(0, Math.min(1e5, o.s));
  o.name = cleanName(a[FIELDS.length + 1]);
  o.bl = lapTime(a[FIELDS.length + 2]);      // best lap, 0 if missing or bad
  o.ll = lapTime(a[FIELDS.length + 3]);      // last lap
  return o;
}

// Reads the sending player's own car into a state (t is added by the caller). best and last are the lap times in seconds, or null.
export function stateFromCar(car, lap, col, name, t, best = null, last = null) {
  const along = Math.cos(car.heading) * (car.loc.tx || 0) + Math.sin(car.heading) * (car.loc.tz || 0);
  return {
    t, x: car.x, y: car.y, z: car.z, h: wrapAngle(car.heading), vx: car.vx, vz: car.vz, yr: car.yawRate, st: car.steer, w: car.wheelSpinAngle,
    thr: car.throttle, brk: car.brake, pz: Math.atan((car.loc.grade || 0) * along) + (car.groundPitch || 0), rx: car.groundRoll || 0,
    col, lap, s: car.loc.s || 0, name, bl: best || 0, ll: last || 0,
  };
}

const SMOOTH = ['y', 'st', 'pz', 'rx', 'thr', 'brk', 'vx', 'vz', 'yr'];
const WINDOW = 100;     // packets (5 s at 20 Hz) over which the fastest delivery sets the clock offset

// Holds the recent states of one remote car and answers "where is it at this moment".
export class StateBuffer {
  constructor() { this.buf = []; this.offs = []; this.off = null; this.lastRecv = -Infinity; this.born = -Infinity; }

  // st.t is the sender's clock (ms), recvMs is ours. The offset between the clocks follows the fastest packets,
  // slowly, so a late packet does not shift the car and the car never jumps when the delay settles.
  push(st, recvMs) {
    let last = this.buf[this.buf.length - 1];
    if (last && st.t <= last.t) return false;      // old or duplicate
    if (last) {
      const gap = (st.t - last.t) / 1000, jump = Math.hypot(st.x - last.x, st.z - last.z);
      if (jump > 15 + 100 * gap) { this.buf.length = 0; this.offs.length = 0; this.off = null; last = null; }   // a reset or a teleport: start again
    }
    if (!last) this.born = recvMs;
    this.offs.push(recvMs - st.t);
    if (this.offs.length > WINDOW) this.offs.shift();
    const target = Math.min(...this.offs);
    if (this.off == null || Math.abs(target - this.off) > 250) this.off = target;
    else this.off += Math.max(-1, Math.min(1, target - this.off));
    this.buf.push(st);
    if (this.buf.length > 40) this.buf.shift();
    this.lastRecv = recvMs;
    return true;
  }

  get latest() { return this.buf[this.buf.length - 1] || null; }

  // Fills and returns `out` with the pose at local time nowMs, or null when nothing has arrived.
  sample(nowMs, out = {}) {
    const b = this.buf, n = b.length;
    if (!n) return null;
    const t = nowMs - DELAY * 1000 - this.off;       // the sender's clock at the moment we want to show
    const last = b[n - 1];
    if (n === 1 || t <= b[0].t) return Object.assign(out, n === 1 ? last : b[0]);
    if (t >= last.t) {
      // late packets: carry on at the last velocity for a short while, then hold still
      const dt = Math.min((t - last.t) / 1000, MAX_EXTRAP);
      Object.assign(out, last);
      out.x = last.x + last.vx * dt; out.z = last.z + last.vz * dt;
      out.h = last.h + Math.max(-6, Math.min(6, last.yr)) * dt;
      return out;
    }
    let i = n - 2;
    while (i > 0 && b[i].t > t) i--;
    const a = b[i], c = b[i + 1], span = (c.t - a.t) / 1000, u = (t - a.t) / (c.t - a.t);
    Object.assign(out, c);
    // position: cubic Hermite through both packets using the velocities they carry, so a 20 Hz stream curves smoothly
    const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    out.x = h00 * a.x + h10 * span * a.vx + h01 * c.x + h11 * span * c.vx;
    out.z = h00 * a.z + h10 * span * a.vz + h01 * c.z + h11 * span * c.vz;
    for (const f of SMOOTH) out[f] = a[f] + (c[f] - a[f]) * u;
    out.h = a.h + wrapAngle(c.h - a.h) * u;
    out.w = a.w + wrapAngle(c.w - a.w) * u;
    return out;
  }
}

// Races are ranked by distance covered: lap number times the track length plus the distance into the lap.
export const raceDistance = (lap, s, length) => lap * length + s;

// The set of remote cars in the scene. `factory.create(info)` returns an entity with setPose(pose), setOpacity(o),
// setLabel(screen or null, name, opacity) and dispose(); the browser one is threeFactory below, the test uses a stub.
export class Ghosts {
  constructor(factory) {
    this.factory = factory;
    this.map = new Map();    // id -> { id, buf, ent, name, col, info, opacity }
    this._pose = {};
    this._solids = [];
  }

  get size() { return this.map.size; }

  // A state arrived from player `id` at local time nowMs. Returns false if it was ignored.
  receive(id, st, nowMs) {
    let g = this.map.get(id);
    if (!g) {
      if (this.map.size >= MAX_PLAYERS - 1) return false;
      const used = new Set([...this.map.values()].map(x => x.col));
      let col = st.col || 1;
      for (let k = 0; k < PALETTE.length && (used.has(col) || col === 0); k++) col = col % (PALETTE.length - 1) + 1;
      g = { id, buf: new StateBuffer(), col, name: st.name, info: null, opacity: 1, ent: this.factory ? this.factory.create({ id, col, name: st.name }) : null };
      this.map.set(id, g);
    }
    if (!g.buf.push(st, nowMs)) return false;
    if (st.name) g.name = st.name;
    g.info = st;
    return true;
  }

  setName(id, name) { const g = this.map.get(id); if (g) g.name = cleanName(name) || g.name; }

  remove(id) {
    const g = this.map.get(id);
    if (!g) return;
    if (g.ent) g.ent.dispose();
    this.map.delete(id);
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  // Call every frame. `project(x, y, z)` gives {x, y} in pixels or null if the point is off screen or behind the camera.
  update(nowMs, project) {
    for (const g of [...this.map.values()]) {
      const silent = (nowMs - g.buf.lastRecv) / 1000;
      if (silent >= TIMEOUT) { this.remove(g.id); continue; }
      g.opacity = silent <= TIMEOUT - FADE ? 1 : (TIMEOUT - silent) / FADE;
      const pose = g.buf.sample(nowMs, this._pose);
      if (!pose || !g.ent) continue;
      g.ent.setPose(pose);
      g.ent.setOpacity(g.opacity);
      g.ent.setLabel(project ? project(pose.x, pose.y + 2.1, pose.z) : null, g.name || 'Player', g.opacity);
    }
  }

  // The remote cars as Car.collideCars wants them, at local time nowMs. The array and its objects are reused,
  // so read them straight away. `age` is seconds since the car appeared (or was reset), `silent` seconds since its last packet.
  solids(nowMs) {
    const out = this._solids;
    let n = 0;
    for (const g of this.map.values()) {
      const p = g.buf.sample(nowMs, this._pose);
      if (!p) continue;
      const o = out[n] || (out[n] = {});
      o.id = g.id; o.x = p.x; o.z = p.z; o.heading = p.h; o.vx = p.vx; o.vz = p.vz; o.yawRate = p.yr;
      o.age = (nowMs - g.buf.born) / 1000; o.silent = (nowMs - g.buf.lastRecv) / 1000;
      n++;
    }
    out.length = n;
    return out;
  }

  // The standings: every player (you included) ranked by race distance, with the gap to the leader.
  // own = { name, col, lap, s, speed }. A gap under a lap is in seconds at that player's speed, over a lap it is whole laps.
  standings(own, length) {
    const rows = [{ id: 'me', name: own.name || 'You', col: 0, lap: own.lap, dist: raceDistance(own.lap, own.s, length), speed: own.speed, me: true }];
    for (const g of this.map.values()) {
      if (!g.info) continue;
      const v = Math.hypot(g.info.vx, g.info.vz);
      rows.push({ id: g.id, name: g.name || 'Player', col: g.col, lap: g.info.lap, dist: raceDistance(g.info.lap, g.info.s, length), speed: v, me: false });
    }
    rows.sort((a, b) => b.dist - a.dist);
    const lead = rows[0].dist;
    rows.forEach((r, i) => {
      const d = lead - r.dist;
      r.gap = i === 0 ? '' : d >= length ? `+${Math.floor(d / length)} lap${d >= 2 * length ? 's' : ''}` : `+${(d / Math.max(r.speed, 20)).toFixed(1)}s`;
    });
    return rows;
  }

  // The lap time board: every player (you included) ordered by best lap, fastest first, players with no lap last.
  // own = { name, laps, best, last } with times in seconds or null. Laps are completed laps. gap is to the fastest best lap.
  board(own) {
    const rows = [{ id: 'me', name: own.name || 'You', col: 0, laps: own.laps || 0, best: own.best || 0, last: own.last || 0, me: true }];
    for (const g of this.map.values()) {
      if (!g.info) continue;
      rows.push({ id: g.id, name: g.name || 'Player', col: g.col, laps: Math.max(0, g.info.lap - 1), best: g.info.bl || 0, last: g.info.ll || 0, me: false });
    }
    const key = r => r.best || 1e9;      // no lap yet sorts last
    rows.sort((a, b) => key(a) - key(b) || b.laps - a.laps || (a.me ? -1 : b.me ? 1 : 0));
    const lead = rows[0].best;
    for (const r of rows) r.gap = r.best && lead && r.best > lead ? r.best - lead : 0;
    return rows;
  }
}

// Browser side: one CarView per remote car, plus a CSS name tag.
export function threeFactory(scene, tagRoot) {
  return {
    create({ col, name }) {
      const view = new CarView(GT, PALETTE[col] ?? PALETTE[1]);
      scene.add(view.root);
      const tag = document.createElement('div');
      tag.className = 'mp-tag';
      tag.hidden = true;
      tagRoot.appendChild(tag);
      const mats = [];
      view.root.traverse(o => { if (o.isMesh) mats.push(o.material); });
      // a stand-in for the physics car that CarView.update reads; the slope comes straight from the sender
      const fake = { prev: null, x: 0, y: 0, z: 0, heading: 0, steer: 0, wheelSpinAngle: 0, wheel: 0, ax: 0, ay: 0, brake: 0, fwdSpeed: 0, bump: 0,
        loc: { tx: 1, tz: 0, grade: 0 }, groundPitch: 0, groundRoll: 0 };
      fake.prev = fake;
      let shown = 1;
      return {
        setPose(p) {
          fake.x = p.x; fake.y = p.y; fake.z = p.z; fake.heading = p.h; fake.steer = p.st; fake.wheelSpinAngle = fake.wheel = p.w;
          fake.fwdSpeed = p.vx * Math.cos(p.h) + p.vz * Math.sin(p.h); fake.ay = fake.fwdSpeed * p.yr; fake.brake = p.brk;
          fake.groundPitch = p.pz; fake.groundRoll = p.rx;
          view.update(fake, 1);
        },
        setOpacity(o) {
          if (o === shown) return;
          shown = o;
          for (const m of mats) { m.transparent = o < 1; m.opacity = o; m.needsUpdate = true; }
        },
        setLabel(px, nm, o) {
          if (!px) { tag.hidden = true; return; }
          if (tag.textContent !== nm) tag.textContent = nm;
          tag.hidden = false;
          tag.style.opacity = o;
          tag.style.transform = `translate(-50%,-100%) translate(${px.x.toFixed(0)}px,${px.y.toFixed(0)}px)`;
        },
        dispose() {
          scene.remove(view.root);
          view.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
          for (const m of new Set(mats)) m.dispose();
          tag.remove();
        },
      };
    },
  };
}

const _v = new THREE.Vector3();
// Projects a world point to pixels for the name tags; null when behind the camera or further than 400 m.
export function makeProjector(camera, width, height) {
  return (x, y, z) => {
    _v.set(x, y, z);
    if (_v.distanceTo(camera.position) > 400) return null;
    _v.project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) return null;
    return { x: (_v.x * 0.5 + 0.5) * width, y: (-_v.y * 0.5 + 0.5) * height };
  };
}
