// Ghost cars for multiplayer: the wire format for one car state, the interpolation
// that smooths it, and the ghost set that creates, fades and removes the cars.
//
// Everything except `threeFactory` is plain JavaScript with no DOM or WebGL, so
// tools/multiplayer-test.js can run it in node.
//
// Ghosts are not solid. Each one is one CarView, drawn at the position the other
// player sent, about 100 ms in the past so there are always two packets to blend.

import * as THREE from 'three';
import { CarView } from './car.js';
import { GT } from './cars.js';

export const DELAY = 0.1;         // seconds behind real time that ghosts are drawn
export const MAX_EXTRAP = 0.25;   // seconds a ghost may be extrapolated when packets are late, then it holds still
export const TIMEOUT = 3;         // seconds without a packet before a ghost is removed
export const FADE = 1;            // the last second before removal is a fade out
export const MAX_NAME = 16;

// Car body colours. Index 0 is the player's own yellow, so ghosts use 1 to 7.
export const PALETTE = [0xffd21f, 0xe23b3b, 0x2f8fe0, 0x3cc46a, 0xe8863a, 0xb15fe0, 0x2fd0c8, 0xf06fb0];

const NUM = ['t', 'x', 'y', 'z', 'h', 'v', 'st', 'w', 'pz', 'rx'];

export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const r = (n, d) => { const k = 10 ** d; return Math.round(n * k) / k; };

// A state is {t ms, x, y, z, h heading, v speed, st steer, w wheel angle, pz slope pitch, rx slope roll,
// br braking, lap, s, dist, col, name}. On the wire it is one flat array.
export function encodeState(o) {
  return ['s', Math.round(o.t), r(o.x, 2), r(o.y, 2), r(o.z, 2), r(o.h, 3), r(o.v, 1), r(o.st, 3), r(o.w, 2), r(o.pz || 0, 3), r(o.rx || 0, 3),
    o.br ? 1 : 0, o.lap | 0, Math.round(o.s), Math.round(o.dist), o.col | 0, cleanName(o.name)];
}

// Returns a clean state or null. Anything from the network is untrusted: wrong types, NaN and absurd
// values are rejected, and the name is stripped to plain text.
export function decodeState(a) {
  if (!Array.isArray(a) || a[0] !== 's' || a.length < 17) return null;
  for (let i = 1; i <= 10; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return null;
  for (let i = 11; i <= 15; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return null;
  const o = {};
  NUM.forEach((k, i) => { o[k] = a[i + 1]; });
  if (Math.abs(o.x) > 1e5 || Math.abs(o.y) > 1e4 || Math.abs(o.z) > 1e5 || Math.abs(o.v) > 400) return null;
  o.br = a[11] ? 1 : 0;
  o.lap = Math.max(0, Math.min(9999, a[12] | 0));
  o.s = a[13]; o.dist = a[14];
  o.col = Math.max(0, Math.min(PALETTE.length - 1, a[15] | 0));
  o.name = cleanName(a[16]);
  return o;
}

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const LERP = ['x', 'y', 'z', 'v', 'st', 'w', 'pz', 'rx'];

// Holds the recent states of one remote car and answers "where is it at this moment".
export class StateBuffer {
  constructor() { this.buf = []; this.off = null; this.lastRecv = -Infinity; }

  // st.t is the sender's clock (ms), recvMs is ours. The offset between them follows the fastest packets,
  // so a late packet does not shift the whole ghost.
  push(st, recvMs) {
    const last = this.buf[this.buf.length - 1];
    if (last && st.t <= last.t) return false;      // old or duplicate
    const off = recvMs - st.t;
    this.off = this.off == null || off < this.off ? off : this.off + (off - this.off) * 0.02;
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
      // late packets: carry on at the last velocity for a short while, then hold
      const p = b[n - 2], span = last.t - p.t;
      const dt = Math.min((t - last.t) / 1000, MAX_EXTRAP), k = dt * 1000 / span;
      Object.assign(out, last);
      for (const f of LERP) out[f] = last[f] + (last[f] - p[f]) * k;
      out.h = last.h + Math.max(-3, Math.min(3, wrapAngle(last.h - p.h) / (span / 1000))) * dt;
      // a wild extrapolation of a position is capped by the speed the car reported
      const lim = (Math.abs(last.v) + 5) * dt, dx = out.x - last.x, dz = out.z - last.z, d = Math.hypot(dx, dz);
      if (d > lim) { out.x = last.x + dx / d * lim; out.z = last.z + dz / d * lim; }
      out.pz = last.pz; out.rx = last.rx; out.st = last.st; out.y = last.y;
      return out;
    }
    let i = n - 2;
    while (i > 0 && b[i].t > t) i--;
    const a = b[i], c = b[i + 1], k = (t - a.t) / (c.t - a.t);
    Object.assign(out, c);
    for (const f of LERP) out[f] = a[f] + (c[f] - a[f]) * k;
    out.h = a.h + wrapAngle(c.h - a.h) * k;
    return out;
  }
}

// The set of ghosts in the scene. `factory.create(info)` returns an entity with setPose(pose), setOpacity(o),
// setLabel(screen or null) and dispose(); the browser one is threeFactory below, the test uses a stub.
export class Ghosts {
  constructor(factory) {
    this.factory = factory;
    this.map = new Map();    // id -> { buf, ent, name, col, ... }
    this._pose = {};
  }

  receive(id, st, nowMs) {
    let g = this.map.get(id);
    if (!g) {
      const used = new Set([...this.map.values()].map(x => x.col));
      let col = st.col || 1;
      for (let k = 0; k < PALETTE.length && (used.has(col) || col === 0); k++) col = col % (PALETTE.length - 1) + 1;
      g = { id, buf: new StateBuffer(), col, ent: this.factory.create({ id, col, name: st.name }), opacity: 1 };
      this.map.set(id, g);
    }
    if (g.buf.push(st, nowMs)) { g.name = st.name || g.name; g.info = st; }
  }

  remove(id) {
    const g = this.map.get(id);
    if (!g) return;
    g.ent.dispose();
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
      if (!pose) continue;
      g.ent.setPose(pose);
      g.ent.setOpacity(g.opacity);
      g.ent.setLabel(project ? project(pose.x, pose.y + 2.1, pose.z, g) : null, g.name, g.opacity);
    }
  }

  // For the standings: every ghost's latest known race progress.
  list() {
    return [...this.map.values()].filter(g => g.info).map(g => ({ id: g.id, name: g.name || 'Player', col: g.col, lap: g.info.lap, s: g.info.s, dist: g.info.dist }));
  }
}

// Browser side: one CarView per ghost, plus a CSS name tag.
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
      // a stand-in for the physics car that CarView.update reads; slope comes straight from the sender
      const fake = { prev: null, x: 0, y: 0, z: 0, heading: 0, steer: 0, wheelSpinAngle: 0, wheel: 0, ax: 0, ay: 0, brake: 0, fwdSpeed: 0, bump: 0,
        loc: { tx: 1, tz: 0, grade: 0 }, groundPitch: 0, groundRoll: 0 };
      fake.prev = fake;
      let shown = 1;
      return {
        setPose(p) {
          fake.x = p.x; fake.y = p.y; fake.z = p.z; fake.heading = p.h; fake.steer = p.st; fake.wheelSpinAngle = fake.wheel = p.w;
          fake.fwdSpeed = p.v; fake.brake = p.br ? 1 : 0; fake.groundPitch = p.pz; fake.groundRoll = -p.rx;
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
// Projects a world point to pixels for the name tags; null when behind the camera or further than 500 m.
export function makeProjector(camera, width, height) {
  return (x, y, z) => {
    _v.set(x, y, z);
    const d = _v.distanceTo(camera.position);
    if (d > 500) return null;
    _v.project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) return null;
    return { x: (_v.x * 0.5 + 0.5) * width, y: (-_v.y * 0.5 + 0.5) * height };
  };
}
