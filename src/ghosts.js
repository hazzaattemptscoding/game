// Other players' cars in a multiplayer room: the wire format for one car state, the interpolation that smooths
// it, and the set of remote cars that creates, fades and removes them.
//
// Everything except `threeFactory` and `makeProjector` is plain JavaScript with no DOM or WebGL, so
// tools/multiplayer.js runs it in node.
//
// Remote cars are drawn a little in the past (a per-car delay that follows the measured arrival jitter, see StateBuffer), so
// there are normally two packets to blend. Race position and the standings use the pose they are drawn at. They are solid:
// `solids()` hands the present pose (where the car is now, extrapolated from the newest packet) to Car.collideCars in src/physics.js.

import * as THREE from 'three';
import { CarView } from './car.js';
import { GT, CAR_IDS, carById } from './cars.js';
import { decodeLivery, defaultLivery, liveryEquals } from './livery.js';

export const DELAY = 0.1;         // seconds behind real time that remote cars start from (peer to peer and relay alike)
export const MIN_DELAY = 0.05;    // the adaptive delay never goes below this (seconds)
export const MAX_DELAY = 0.15;    // ...nor above this, unless a transport asks for more (Ghosts.delay)
export const LEGACY_DELAY = 0.15; // the old fixed delay, for the before and after in tools/netsim.js (Ghosts with legacy: true)
export const RELAY_EXTRA_DELAY = 0;   // kept for old imports; not added any more, the clock offset already measures the relay's extra hop
export const MAX_EXTRAP = 0.25;   // seconds a car may be extrapolated when packets are late, then it holds still
export const TIMEOUT = 3;         // seconds without a packet before a remote car is removed
export const FADE = 1;            // the last second before removal is a fade out
export const MAX_NAME = 16;
export const MAX_PLAYERS = 8;

// How a remote car looks comes from its livery (src/livery.js), which its player sends, and from nothing local: the same
// car looks the same on every screen. `col` is the car's flags (bit 0: DRS open); the field keeps its old place in the packet so
// old clients, which ignore it, can still talk to new ones.

// The car class is in col too, bits 1 and 2 (the index in CAR_IDS, src/cars.js). An old client reads only the DRS bit and
// accepts the value (it is at most 7), so it keeps working and draws every car as a GT. A missing or unknown class reads as GT.
//
// Fields of one state, in wire order. t is the sender's clock in ms, h the heading, vx/vz the velocity,
// yr the yaw rate, st the steering angle, w the wheel angle, thr/brk the pedals, pz/rx the slope pitch and roll
// of the body, col the flags (FLAG_DRS, bit 0 = DRS open), lap and s the race progress (lap number and metres into the lap).
export const FIELDS = ['t', 'x', 'y', 'z', 'h', 'vx', 'vz', 'yr', 'st', 'w', 'thr', 'brk', 'pz', 'rx', 'col', 'lap', 's'];

export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const round = (n, d) => { const k = 10 ** d; return Math.round(n * k) / k; };
const TAU = Math.PI * 2;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
// The bits of `col`: bit 0 is DRS open, bits 1 and 2 are the car class (the index in CAR_IDS, 0 = GT).
export const FLAG_DRS = 1;
export const CAR_SHIFT = 1;
const carCode = id => { const i = CAR_IDS.indexOf(id); return i < 0 ? 0 : i; };

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

// The same state as one binary frame, for the relay (src/relay.js): [1, t as float64, the other 16 fields as float32,
// best lap and last lap as float32, name length, name as UTF-8]. About 80 bytes. packState takes the array that encodeState
// returns and unpackState returns such an array again (or null), so decodeState still validates everything.
export const BIN_STATE = 1;
export function packState(a) {
  const nm = new TextEncoder().encode(String(a[FIELDS.length + 1] || '')).subarray(0, 48);
  const buf = new ArrayBuffer(1 + 8 + 4 * (FIELDS.length - 1) + 8 + 1 + nm.length), dv = new DataView(buf);
  dv.setUint8(0, BIN_STATE);
  dv.setFloat64(1, +a[1] || 0);
  let o = 9;
  for (let i = 1; i < FIELDS.length; i++, o += 4) dv.setFloat32(o, +a[i + 1] || 0);
  dv.setFloat32(o, +a[FIELDS.length + 2] || 0); dv.setFloat32(o + 4, +a[FIELDS.length + 3] || 0); o += 8;
  dv.setUint8(o++, nm.length);
  new Uint8Array(buf).set(nm, o);
  return new Uint8Array(buf);
}

export function unpackState(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 1 + 8 + 4 * (FIELDS.length - 1) + 8 + 1 || u8[0] !== BIN_STATE) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const a = ['s', dv.getFloat64(1)];
  let o = 9;
  for (let i = 1; i < FIELDS.length; i++, o += 4) a.push(round(dv.getFloat32(o), DIGITS[FIELDS[i]]));
  const bl = round(dv.getFloat32(o), 3), ll = round(dv.getFloat32(o + 4), 3); o += 8;
  const n = dv.getUint8(o++);
  if (o + n !== u8.length) return null;
  a.push(new TextDecoder().decode(u8.subarray(o, o + n)), bl, ll);
  return a;
}

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
  const flags = Math.round(o.col);
  o.col = flags >= 0 && flags <= 7 ? flags : 0;      // a flags value out of range reads as none
  o.drs = (o.col & FLAG_DRS) !== 0;
  o.car = CAR_IDS[(o.col >> CAR_SHIFT) & 3] || 'GT';   // the car class; index 3 is not a class, so it reads as GT
  o.lap = Math.max(0, Math.min(9999, Math.round(o.lap)));
  o.s = Math.max(0, Math.min(1e5, o.s));
  o.name = cleanName(a[FIELDS.length + 1]);
  o.bl = lapTime(a[FIELDS.length + 2]);      // best lap, 0 if missing or bad
  o.ll = lapTime(a[FIELDS.length + 3]);      // last lap
  return o;
}

// Reads the sending player's own car into a state (t is added by the caller). best and last are the lap times in seconds, or null.
// The flags in col come from the car: DRS open or not.
export function stateFromCar(car, lap, name, t, best = null, last = null) {
  return {
    t, x: car.x, y: car.y, z: car.z, h: wrapAngle(car.heading), vx: car.vx, vz: car.vz, yr: car.yawRate, st: car.steer, w: car.wheelSpinAngle,
    thr: car.throttle, brk: car.brake, pz: car.groundPitch || 0, rx: car.groundRoll || 0,
    col: (car.drs ? FLAG_DRS : 0) | (carCode(car.cfg && car.cfg.id) << CAR_SHIFT), lap, s: car.loc.s || 0, name, bl: best || 0, ll: last || 0,
  };
}

const SMOOTH = ['y', 'st', 'pz', 'rx', 'thr', 'brk', 'vx', 'vz', 'yr'];
const OFFSET_MS = 2000;      // the clock offset follows the fastest packet of the last 2 s
const OFFSET_RATE = 0.15;    // ms the offset may move per ms of time: 5 ms a packet at 30 Hz, spread over the frames so the picture does not step
const LEGACY_SLEW = 1;       // ms per packet, the old behaviour
const OFFSET_RESET = 250;    // ms: a bigger change than this re-syncs at once
const JITTER_GAIN = 1 / 16;  // smoothing of the lateness and jitter estimates (about 16 packets)
const DELAY_UP = 2, DELAY_DOWN = 1;   // ms per packet the delay may grow (fast, a stall needs it) or shrink (slow, no wobble)
const BLEND_MS = 150;        // after a stall the picture eases from where it was to the new pose over this long
const STALL_MS = 100;        // no packet for this long (and three packet intervals) counts as a stall
const LEGACY_WINDOW = 100;   // packets (legacy: the old 5 s offset window at 20 Hz)

// Holds the recent states of one remote car and answers "where is it at this moment".
//
// The delay is adaptive. Each packet is `late` ms after the fastest packet of the last 2 s (the clock offset). A smoothed
// mean of that lateness and a smoothed mean absolute deviation from it give the jitter; the target delay is the mean lateness
// plus twice the jitter plus half a packet interval (the spacing is measured from the sender's clock), held between the
// floor (MIN_DELAY, or one packet interval if that is more) and the ceiling (MAX_DELAY, or what the transport asked for). The
// delay moves toward the target by at most 2 ms a packet up and 1 ms down, so the picture does not wobble. The offset walks to
// its target at 5 ms a packet. legacy: a fixed delay, the old offset window and slew, and a freeze then snap after a stall
// (for tools/netsim.js). fixed (a number of seconds, the live spectator view): the delay stays at that value and the
// adaptive logic is skipped, so the broadcast picture does not move with the jitter.
export class StateBuffer {
  // delay: with legacy, the fixed delay; otherwise the ceiling is the larger of MAX_DELAY and this, and the delay starts at DELAY
  constructor(delay = DELAY, opts = {}) {
    this.legacy = !!opts.legacy;
    this.fixed = opts.fixed > 0 ? opts.fixed : 0;
    this.ceil = Math.max(MAX_DELAY, delay);
    this.delay = this.fixed || (this.legacy ? delay : DELAY);   // seconds behind real time that this car is drawn
    this.buf = []; this.offs = []; this.off = null; this.lastRecv = -Infinity; this.born = -Infinity;
    this.iv = 0;         // smoothed spacing of the sender's packets, ms (0 until there are two)
    this.late = 0;       // smoothed lateness of a packet over the fastest one, ms
    this.jit = 0;        // smoothed mean absolute deviation of that lateness, ms
    this.drawn = null;   // the pose sample() returned last, the start of a blend after a stall
    this.under = false;  // the last sample ran past the newest packet (the buffer ran dry)
    this.blend = null;   // { x, z, h, t0 }: the pose the picture eases from after a stall
    this.target = null;  // the clock offset the packets point at; this.off walks to it
    this.offAt = null;   // the local time of the last walk
  }

  // the ceiling of the adaptive delay (Ghosts.delay); the fixed delay with legacy; nothing with fixed (the delay stays put)
  setCeiling(v) { this.ceil = Math.max(MAX_DELAY, v); if (this.legacy) this.delay = v; }

  // st.t is the sender's clock (ms), recvMs is ours. The offset between the clocks follows the fastest packets of the last
  // 2 s, slowly, so a late packet does not shift the car and the car never jumps when the delay settles.
  push(st, recvMs) {
    let last = this.buf[this.buf.length - 1];
    if (last && st.t <= last.t) return false;      // old or duplicate
    if (last) {
      const gap = (st.t - last.t) / 1000, jump = Math.hypot(st.x - last.x, st.z - last.z);
      if (jump > 15 + 100 * gap) { this.buf.length = 0; this.offs.length = 0; this.off = null; this.drawn = null; this.blend = null; last = null; }   // a reset or a teleport: start again
    }
    if (!last) this.born = recvMs;
    // a stall: the car was drawn past its newest packet, and nothing arrived for a long time before this one (a stalled link
    // delivers what was made during the stall all at once, with the old timestamps, so the gap is measured in arrivals).
    // Ease from the drawn pose to the new one instead of jumping. A short gap (one lost packet, a late one) does not blend.
    if (!this.legacy && last && this.under && this.drawn && !this.blend && recvMs - this.lastRecv > Math.max(STALL_MS, 3 * this.iv))
      this.blend = { x: this.drawn.x, z: this.drawn.z, h: this.drawn.h, t0: recvMs };

    this.offs.push({ v: recvMs - st.t, r: recvMs });
    if (this.legacy) { if (this.offs.length > LEGACY_WINDOW) this.offs.shift(); }
    else while (this.offs.length > 1 && recvMs - this.offs[0].r > OFFSET_MS) this.offs.shift();
    let target = Infinity;
    for (const o of this.offs) if (o.v < target) target = o.v;
    this.target = target;
    if (this.off == null || Math.abs(target - this.off) > OFFSET_RESET) this.off = target;   // a big change re-syncs at once
    else if (this.legacy) this.off += Math.max(-LEGACY_SLEW, Math.min(LEGACY_SLEW, target - this.off));
    else this.walkOffset(recvMs);

    if (last && !this.legacy) { const sp = st.t - last.t; if (sp <= 250) this.iv = this.iv ? this.iv + (sp - this.iv) / 8 : sp; }
    if (!this.legacy && !this.fixed) {
      const late = recvMs - st.t - this.off;     // how much later than the fastest packet this one came (ms)
      this.late += (late - this.late) * JITTER_GAIN;
      this.jit += (Math.abs(late - this.late) - this.jit) * JITTER_GAIN;
      const floor = Math.max(MIN_DELAY, this.iv / 1000), ceil = Math.max(floor, this.ceil);
      const want = (this.late + 2 * this.jit + (this.iv || 33) / 2) / 1000;
      const goal = Math.max(floor, Math.min(ceil, want));
      const step = Math.max(-DELAY_DOWN, Math.min(DELAY_UP, (goal - this.delay) * 1000));
      this.delay += step / 1000;
    }

    this.buf.push(st);
    if (this.buf.length > 40) this.buf.shift();
    this.lastRecv = recvMs;
    return true;
  }

  get latest() { return this.buf[this.buf.length - 1] || null; }

  // The clock offset walks to the target the packets point at, at OFFSET_RATE, so it never steps (a packet, or a frame, at a time).
  walkOffset(nowMs) {
    if (this.legacy || this.target === null || this.off === null) return;
    const room = this.offAt === null ? 0 : Math.max(0, nowMs - this.offAt) * OFFSET_RATE;
    this.off += Math.max(-room, Math.min(room, this.target - this.off));
    this.offAt = nowMs;
  }

  // Where the car is now, by the sender's clock: the newest packet carried on at its own velocity to the present (the
  // present is nowMs less the clock offset, so the time the packet spent on the way is counted). Capped at MAX_EXTRAP.
  // Used for contact only: the drawn pose is sample()'s, which is behind by the delay.
  presentPose(nowMs, out = {}) {
    const last = this.latest;
    if (!last) return null;
    const dt = Math.max(0, Math.min((nowMs - this.off - last.t) / 1000, MAX_EXTRAP));
    Object.assign(out, last);
    out.x = last.x + last.vx * dt; out.z = last.z + last.vz * dt;
    out.h = last.h + Math.max(-6, Math.min(6, last.yr)) * dt;
    return out;
  }

  // Fills and returns `out` with the pose at local time nowMs, or null when nothing has arrived. This is the pose the car is
  // drawn at, and race position and the standings use it too.
  sample(nowMs, out = {}) {
    const b = this.buf, n = b.length;
    if (!n) return null;
    this.walkOffset(nowMs);
    const t = nowMs - this.delay * 1000 - this.off;       // the sender's clock at the moment we want to show
    const last = b[n - 1];
    this.under = false;
    if (n === 1 || t <= b[0].t) Object.assign(out, n === 1 ? last : b[0]);
    else if (t >= last.t) {
      // the packets have run out: carry on at the last velocity for a short while, then hold still
      this.under = true;
      const dt = Math.min((t - last.t) / 1000, MAX_EXTRAP);
      Object.assign(out, last);
      out.x = last.x + last.vx * dt; out.z = last.z + last.vz * dt;
      out.h = last.h + Math.max(-6, Math.min(6, last.yr)) * dt;
    } else {
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
      out.drs = a.drs;      // a flag is not blended: the newest packet at or before the moment shown
      // race progress: lap and the distance into it go together, so across a lap line take both from one packet
      if (a.lap === c.lap) out.s = a.s + (c.s - a.s) * u;
      else { const p = u < 0.5 ? a : c; out.lap = p.lap; out.s = p.s; }
    }
    if (this.blend) this.easeBlend(nowMs, out);
    if (!this.drawn) this.drawn = { x: 0, z: 0, h: 0 };
    this.drawn.x = out.x; this.drawn.z = out.z; this.drawn.h = out.h;
    return out;
  }

  // After a stall: the pose eases from the blend's start to the interpolated one over BLEND_MS (smoothstep), so a car that was
  // drawn ahead of its last packet is not pulled back in one frame.
  easeBlend(nowMs, out) {
    const k = this.blend, w = (nowMs - k.t0) / BLEND_MS;
    if (w >= 1) { this.blend = null; return; }
    const s = w <= 0 ? 0 : w * w * (3 - 2 * w);
    out.x = k.x + (out.x - k.x) * s;
    out.z = k.z + (out.z - k.z) * s;
    out.h = k.h + wrapAngle(out.h - k.h) * s;
  }
}

// Races are ranked by distance covered: lap number times the track length plus the distance into the lap.
export const raceDistance = (lap, s, length) => lap * length + s;

// The set of remote cars in the scene. `factory.create(info)` returns an entity with setPose(pose), setOpacity(o),
// setLabel(screen or null, name, opacity) and dispose(); the browser one is threeFactory below, the test uses a stub.
export class Ghosts {
  // opts.max: how many cars at most (the game shows the other 7; the live page, a spectator, all 8).
  // opts.legacy: the old behaviour (fixed delay, see StateBuffer), for tools/netsim.js only.
  // opts.fixed: seconds of a fixed delay for every car (the live spectator view, see StateBuffer). Set it before the cars arrive.
  constructor(factory, opts = {}) {
    this.factory = factory;
    this.max = opts.max || MAX_PLAYERS - 1;
    this.legacy = !!opts.legacy;
    this.fixed = opts.fixed > 0 ? opts.fixed : 0;
    this.map = new Map();    // id -> { id, buf, ent, name, livery, info, opacity, shown }
    this.pending = new Map();   // id -> livery string that arrived before the first state of that player
    this._pose = {};
    this._pres = {};
    this._solids = [];
    this.fx = [];            // pose summary of each car drawn this frame, for the lights and spray (src/carFx.js): { x, y, z, h, v, brk, o }
    this._delay = this.fixed || (this.legacy ? LEGACY_DELAY : DELAY);
    this.drawnAt = null;     // the local time of the last update(): the pose on screen is the one sampled at this time
  }

  get size() { return this.map.size; }

  // Seconds behind real time that remote cars may be drawn at most. A transport sets it (peer to peer and relay: DELAY). It is the
  // ceiling of each car's adaptive delay, which is never above MAX_DELAY unless this asks for more. With fixed, every car is
  // drawn at that delay and this returns it.
  get delay() { return this.fixed || this._delay; }
  set delay(v) { this._delay = v; for (const g of this.map.values()) g.buf.setCeiling(v); }

  // A state arrived from player `id` at local time nowMs. Returns false if it was ignored.
  receive(id, st, nowMs) {
    let g = this.map.get(id);
    if (!g) {
      if (this.map.size >= this.max) return false;
      // painted from the player's own livery if it has arrived, else from the default for that player id (the same on every client)
      const livery = this.pending.has(id) ? decodeLivery(this.pending.get(id)) : defaultLivery(id);
      this.pending.delete(id);
      const carId = st.car || 'GT';
      g = { id, buf: new StateBuffer(this._delay, { legacy: this.legacy, fixed: this.fixed }), livery, name: st.name, carId, info: null, opacity: 1, shown: {}, ent: this.factory ? this.factory.create({ id, livery, name: st.name, car: carById(carId) }) : null };
      this.map.set(id, g);
    }
    if (!g.buf.push(st, nowMs)) return false;
    if (st.car && st.car !== g.carId) this.swapCar(g, st.car);   // the player changed class (src/cars.js): a new model
    if (st.name) g.name = st.name;
    g.info = st;
    return true;
  }

  // A livery string arrived from player `id` (hello, or the repeat every 2 s). Repaints the car if it changed. If the car does
  // not exist yet the livery is kept for when it does. Anything that is not a valid livery string is ignored.
  setLivery(id, str) {
    if (typeof str !== 'string' || str.length > 64) return;
    const g = this.map.get(id);
    if (!g) { if (this.pending.size < 16 || this.pending.has(id)) this.pending.set(id, str); return; }
    const l = decodeLivery(str);
    if (liveryEquals(l, g.livery)) return;
    g.livery = l;
    if (g.ent && g.ent.setLivery) g.ent.setLivery(l);
  }

  // The remote car `g` is now another class: its model is made again (the same livery and name).
  swapCar(g, carId) {
    g.carId = carId;
    if (!this.factory || !g.ent) return;
    g.ent.dispose();
    g.ent = this.factory.create({ id: g.id, livery: g.livery, name: g.name, car: carById(carId) });
  }

  setName(id, name) { const g = this.map.get(id); if (g) g.name = cleanName(name) || g.name; }

  remove(id) {
    const g = this.map.get(id);
    if (!g) return;
    if (g.ent) g.ent.dispose();
    this.map.delete(id);
    this.pending.delete(id);
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); this.pending.clear(); this.fx.length = 0; }

  // the name shown for a player: the one painted on the car, else the one they joined with
  nameOf(g) { return (g.livery && g.livery.name) || g.name || 'Player'; }

  // Call every frame. `project(x, y, z)` gives {x, y} in pixels or null if the point is off screen or behind the camera.
  update(nowMs, project) {
    this.drawnAt = nowMs;
    let nfx = 0;
    for (const g of [...this.map.values()]) {
      const silent = (nowMs - g.buf.lastRecv) / 1000;
      if (silent >= TIMEOUT) { this.remove(g.id); continue; }
      g.opacity = silent <= TIMEOUT - FADE ? 1 : (TIMEOUT - silent) / FADE;
      const pose = g.buf.sample(nowMs, this._pose);
      if (!pose || !g.ent) continue;
      g.ent.setPose(pose);
      g.ent.setOpacity(g.opacity);
      const f = this.fx[nfx] || (this.fx[nfx] = {});
      f.x = pose.x; f.y = pose.y; f.z = pose.z; f.h = pose.h; f.v = Math.hypot(pose.vx, pose.vz); f.brk = pose.brk; f.o = g.opacity; f.len = carById(g.carId).length; nfx++;
      g.ent.setLabel(project ? project(pose.x, pose.y + 2.1, pose.z) : null, this.nameOf(g), g.opacity, g.livery);
    }
    this.fx.length = nfx;
  }

  // The pose a remote car is drawn at, at local time at (default: the last update()). Before any update, the newest packet.
  // Race position uses this pose, so the standings agree with the picture. Read it straight away: the object is reused per car.
  shownPose(g, at = this.drawnAt) {
    return (at == null ? null : g.buf.sample(at, g.shown)) || g.info;
  }

  // Where every remote car is now, for Car.collideCars (see StateBuffer.presentPose): id, x, z, heading, vx, vz, yawRate, age
  // (seconds since the car appeared or was reset) and silent (seconds since its last packet). The array and its objects are
  // reused, so read them straight away.
  presentPose(nowMs) {
    const out = this._solids;
    let n = 0;
    for (const g of this.map.values()) {
      const p = g.buf.presentPose(nowMs, this._pres);
      if (!p) continue;
      const o = out[n] || (out[n] = {});
      o.id = g.id; o.x = p.x; o.z = p.z; o.heading = p.h; o.vx = p.vx; o.vz = p.vz; o.yawRate = p.yr;
      o.age = (nowMs - g.buf.born) / 1000; o.silent = (nowMs - g.buf.lastRecv) / 1000;
      const size = carById(g.carId); o.length = size.length; o.width = size.width;   // this car's size, for the contact shape
      n++;
    }
    out.length = n;
    return out;
  }

  // The remote cars as Car.collideCars wants them, at local time nowMs (the present pose, see presentPose).
  solids(nowMs) { return this.presentPose(nowMs); }

  // The standings: every player (you included) ranked by race distance, with the gap to the leader. Remote cars are ranked
  // at the pose they are drawn at (shownPose), so the order on screen is the order here. Lap, best and last come from the newest packet.
  // own = { name, livery, lap, s, speed }. Rows carry colour (css body colour) and num (race number or -1). A gap under a lap is in seconds at that player's speed, over a lap it is whole laps.
  standings(own, length) {
    const rows = [{ id: 'me', name: (own.livery && own.livery.name) || own.name || 'You', colour: own.livery ? own.livery.body : '#ffd21f', num: own.livery ? own.livery.number : -1, lap: own.lap, dist: raceDistance(own.lap, own.s, length), speed: own.speed, me: true }];
    for (const g of this.map.values()) {
      if (!g.info) continue;
      const p = this.shownPose(g);
      const v = Math.hypot(p.vx, p.vz);
      rows.push({ id: g.id, name: this.nameOf(g), colour: g.livery.body, num: g.livery.number, lap: g.info.lap, dist: raceDistance(p.lap, p.s, length), speed: v, me: false });
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
  // own = { name, livery, laps, best, last } with times in seconds or null. Laps are completed laps. gap is to the fastest best lap.
  board(own) {
    const rows = [{ id: 'me', name: (own.livery && own.livery.name) || own.name || 'You', colour: own.livery ? own.livery.body : '#ffd21f', num: own.livery ? own.livery.number : -1, laps: own.laps || 0, best: own.best || 0, last: own.last || 0, me: true }];
    for (const g of this.map.values()) {
      if (!g.info) continue;
      rows.push({ id: g.id, name: this.nameOf(g), colour: g.livery.body, num: g.livery.number, laps: Math.max(0, g.info.lap - 1), best: g.info.bl || 0, last: g.info.ll || 0, me: false });
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
    create({ livery, car }) {
      const view = new CarView(car || GT, livery);
      scene.add(view.root);
      const tag = document.createElement('div');
      tag.className = 'mp-tag';
      tag.hidden = true;
      tagRoot.appendChild(tag);
      // a stand-in for the physics car that CarView.update reads; the slope comes straight from the sender
      const fake = { prev: null, x: 0, y: 0, z: 0, heading: 0, steer: 0, wheelSpinAngle: 0, wheel: 0, ax: 0, ay: 0, brake: 0, fwdSpeed: 0, bump: 0,
        loc: { tx: 1, tz: 0, grade: 0 }, groundPitch: 0, groundRoll: 0, drs: false };
      fake.prev = fake;
      let shown = 1;
      return {
        view,
        setPose(p) {
          fake.x = p.x; fake.y = p.y; fake.z = p.z; fake.heading = p.h; fake.steer = p.st; fake.wheelSpinAngle = fake.wheel = p.w;
          fake.fwdSpeed = p.vx * Math.cos(p.h) + p.vz * Math.sin(p.h); fake.ay = fake.fwdSpeed * p.yr; fake.brake = p.brk;
          fake.groundPitch = p.pz; fake.groundRoll = p.rx;
          fake.drs = !!p.drs;      // the DRS flap (src/drsFlap.js, car.js) follows the packet
          view.update(fake, 1);
        },
        setLivery(l) { view.setLivery(l); },
        setOpacity(o) {
          if (o === shown) return;
          shown = o;
          for (const m of view.materials()) { m.transparent = o < 1 || !!m.userData.alpha; m.opacity = o; m.needsUpdate = true; }
        },
        setLabel(px, nm, o, l) {
          if (!px) { tag.hidden = true; return; }
          if (l && l.number >= 0) nm = `#${l.number} ${nm}`;
          if (tag.textContent !== nm) tag.textContent = nm;
          tag.hidden = false;
          tag.style.opacity = o;
          tag.style.transform = `translate(-50%,-100%) translate(${px.x.toFixed(0)}px,${px.y.toFixed(0)}px)`;
        },
        dispose() {
          scene.remove(view.root);
          view.dispose();
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
