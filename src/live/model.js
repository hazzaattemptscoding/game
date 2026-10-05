// The race as the live page sees it: positions, gaps, lap and sector times and the event feed, worked out from the car state
// stream alone (the same packets the other players get). Plain JavaScript with no page and no WebGL, so tools/live.js runs it in node.
//
// Clocks: every state carries the SENDER's clock (st.t, ms). Times between two states of one car (sector and lap times) are taken
// from that clock, so they are exact whatever the network does. To compare two cars the page passes a common clock `tc` (ms) with each
// state: the sender's clock plus the offset the interpolation buffer already tracks (src/ghosts.js StateBuffer.off).

export const CHECKPOINT_M = 100;        // gaps are measured at a checkpoint every 100 m, as real timing does at its loops
export const MAX_EVENTS = 60;
export const STALE_MS = 3000;           // no state for this long: shown as no signal

const wrapDist = (a, L) => ((a % L) + L) % L;

export function fmtTime(t) {
  if (!(t > 0)) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}
export function fmtGap(g) {
  if (g == null) return '';
  if (typeof g === 'string') return g;
  return `+${g.toFixed(g < 100 ? 3 : 1)}`;
}

class Driver {
  constructor(id, name) {
    this.id = id; this.name = name || 'Player';
    this.livery = null;
    this.joinedAt = 0;
    this.lap = 0; this.s = 0; this.speed = 0; this.best = 0; this.last = 0;
    this.seen = false; this.t = 0; this.tc = 0; this.lastMs = -Infinity;
    this.cp = new Map(); this.cpTop = -1;           // checkpoint index -> common time of crossing
    this.sec = [0, 0, 0]; this.bestSec = [0, 0, 0];  // the sector times shown (last lap, replaced one by one this lap) and the personal bests
    this.secNow = -1; this.secStartT = null; this.lapStartT = null;
    this.finished = false; this.finishOrder = 0; this.finishAt = 0;
    this.tele = null; this.st = null;       // the latest telemetry frame and car state
    this.stoppedSince = null;
  }
  get completed() { return Math.max(0, this.lap - 1); }
}

export class RaceModel {
  // o: { length (m), sectors: [0, s1, s2] (m) }
  constructor({ length, sectors = [0, length / 3, (2 * length) / 3] }) {
    this.length = length; this.sectors = sectors;
    this.drivers = new Map();
    this.meta = { mode: '', laps: 0, started: false };
    this.events = [];
    this.bestSec = [0, 0, 0];       // the fastest time in each sector by anybody
    this.bestLap = 0; this.bestLapId = null;
    this.finishers = 0;
    this.clock = 0;                  // the latest common time seen
    this.seq = 0;
  }

  get raceOn() { return this.meta.started === true; }

  addDriver(id, name) {
    let d = this.drivers.get(id);
    if (!d) { d = new Driver(id, name); this.drivers.set(id, d); d.joinedAt = this.clock; this.event('join', id, `${d.name} joined`); }
    else if (name) d.name = name;
    return d;
  }
  removeDriver(id) {
    const d = this.drivers.get(id);
    if (!d) return;
    this.drivers.delete(id);
    this.event('leave', id, `${d.name} left`);
  }
  setName(id, name) { const d = this.drivers.get(id); if (d && name) d.name = name; }
  setLivery(id, livery) { const d = this.drivers.get(id); if (d) d.livery = livery; }

  setMeta(m) {
    if (!m || typeof m !== 'object') return;
    const was = this.meta.started;
    if (typeof m.mode === 'string') this.meta.mode = m.mode;
    if (typeof m.laps === 'number') this.meta.laps = m.laps;
    if (typeof m.started === 'boolean') this.meta.started = m.started;
    if (this.meta.started && !was) {
      this.finishers = 0;
      for (const d of this.drivers.values()) { d.finished = false; d.finishOrder = 0; }
      this.event('start', null, this.meta.laps ? `Race start, ${this.meta.laps} laps` : 'Race start');
    } else if (!this.meta.started && was) this.event('end', null, 'Race over');
  }

  event(kind, id, text) {
    this.events.push({ n: ++this.seq, kind, id, text, at: this.clock });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  // A state arrived. st: a decoded state (src/ghosts.js decodeState), tc the common clock in ms.
  state(id, st, tc) {
    const d = this.drivers.get(id) || this.addDriver(id, st.name);
    if (tc > this.clock) this.clock = tc;
    const L = this.length;
    const dist = st.lap * L + st.s;
    if (d.seen && st.t <= d.t) return;           // old or duplicate
    if (d.seen) {
      const dPrev = d.lap * L + d.s, dd = dist - dPrev;
      if (dd < -50 || dd > 300) {
        // a reset, a reverse or a long gap: start the lap and sector timing again; the gap checkpoints start again too
        d.secStartT = d.lapStartT = null; d.secNow = this.sectorAt(st.s);
        d.cp.clear(); d.cpTop = Math.floor(dist / CHECKPOINT_M);
      } else if (dd > 0) this.advance(d, dPrev, dist, d.t, st.t, d.tc, tc);
    } else { d.cpTop = Math.floor(dist / CHECKPOINT_M); d.secNow = this.sectorAt(st.s); }
    d.st = st;
    d.seen = true; d.lap = st.lap; d.s = st.s; d.t = st.t; d.tc = tc; d.lastMs = tc;
    d.speed = Math.hypot(st.vx, st.vz);
    if (st.name && !d.livery) d.name = st.name;
    if (st.bl > 0 && st.bl !== d.best) {
      d.best = st.bl;
      if (this.bestLap === 0 || st.bl < this.bestLap - 1e-6) { this.bestLap = st.bl; this.bestLapId = id; this.event('fastest', id, `Fastest lap ${fmtTime(st.bl)}, ${d.name}`); }
    }
    if (st.ll > 0) d.last = st.ll;
    if (this.meta.laps > 0 && this.meta.started && !d.finished && d.completed >= this.meta.laps) {
      d.finished = true; d.finishOrder = ++this.finishers; d.finishAt = tc;
      this.event('finish', id, `${d.name} finishes P${d.finishOrder}`);
    }
  }

  telemetry(id, tele) { const d = this.drivers.get(id); if (d) d.tele = tele; }

  sectorAt(s) { let k = 0; for (let i = 1; i < this.sectors.length; i++) if (s >= this.sectors[i]) k = i; return k; }

  // the car went from distance a to distance b (total metres, lap * length + s) between sender times t0 and t1: record the checkpoints
  // and sector boundaries it crossed, each at its interpolated time
  advance(d, a, b, t0, t1, tc0, tc1) {
    const L = this.length;
    // checkpoints on the common clock
    for (let k = Math.floor(a / CHECKPOINT_M) + 1; k * CHECKPOINT_M <= b; k++) {
      const f = (k * CHECKPOINT_M - a) / (b - a);
      d.cp.set(k, tc0 + (tc1 - tc0) * f); d.cpTop = k;
      d.cp.delete(k - Math.ceil(L / CHECKPOINT_M) * 3);
    }
    // sector boundaries and the line on the sender's clock: the first boundary at or after distance a
    const lapA = Math.floor(a / L);
    for (let lap = lapA; lap <= Math.floor(b / L); lap++) {
      for (let k = 0; k < this.sectors.length; k++) {
        const at = lap * L + this.sectors[k];
        if (at <= a || at > b) continue;
        const tx = t0 + (t1 - t0) * (at - a) / (b - a);
        this.boundary(d, k, tx, lap);
      }
    }
  }

  // the car crossed the start of sector k (0 is the line) at sender time tx
  boundary(d, k, tx, lap) {
    const prev = k === 0 ? this.sectors.length - 1 : k - 1;
    if (d.secStartT !== null && (k !== 0 || d.lapStartT !== null) && d.secNow === prev) {
      const t = (tx - d.secStartT) / 1000;
      if (t > 1 && t < 600) {
        d.sec[prev] = t;
        if (!d.bestSec[prev] || t < d.bestSec[prev]) d.bestSec[prev] = t;
        if (!this.bestSec[prev] || t < this.bestSec[prev]) this.bestSec[prev] = t;
      }
    }
    d.secNow = k; d.secStartT = tx;
    if (k === 0) d.lapStartT = tx;
  }

  // Everybody in order, with gaps. Order: in a race (or a finished one) by distance covered, finishers first in finishing order;
  // otherwise by best lap, drivers with no lap by distance.
  rows(now = this.clock) {
    const L = this.length, list = [...this.drivers.values()].filter(d => d.seen);
    const race = this.raceOn;
    const dist = d => d.lap * L + d.s;
    list.sort(race
      ? (a, b) => (b.finished - a.finished) || (a.finished ? a.finishOrder - b.finishOrder : 0) || dist(b) - dist(a)
      : (a, b) => (a.best || 1e9) - (b.best || 1e9) || dist(b) - dist(a));
    const lead = list[0];
    return list.map((d, i) => {
      const ahead = i ? list[i - 1] : null;
      return {
        id: d.id, pos: i + 1, name: d.name, livery: d.livery, lap: d.lap, completed: d.completed, s: d.s, speed: d.speed, dist: dist(d),
        last: d.last, best: d.best, finished: d.finished, signal: now - d.lastMs < STALE_MS,
        gap: i ? this.gapTo(d, lead, race) : '', interval: i ? this.gapTo(d, ahead, race) : '',
        sectors: [0, 1, 2].map(k => ({ t: d.sec[k], c: this.sectorColour(d, k) })),
        fastest: this.bestLapId === d.id, tele: d.tele, st: d.st,
      };
    });
  }

  // d's gap behind `ref`: seconds at the last checkpoint d passed (a number), or text ('+1 lap'), or ''.
  gapTo(d, ref, race) {
    if (!ref) return '';
    if (!race) return d.best && ref.best ? d.best - ref.best : '';
    if (ref.finished && d.finished) return d.finishAt && ref.finishAt ? Math.max(0, (d.finishAt - ref.finishAt) / 1000) : '';
    const L = this.length, dd = ref.lap * L + ref.s - (d.lap * L + d.s);
    if (dd >= L) { const n = Math.floor(dd / L); return `+${n} lap${n > 1 ? 's' : ''}`; }
    const k = d.cpTop, t1 = d.cp.get(k), t0 = ref.cp.get(k);
    if (t1 !== undefined && t0 !== undefined && t1 >= t0) return (t1 - t0) / 1000;
    return Math.max(0, dd) / Math.max(d.speed, 20);
  }

  // 'purple' fastest of everybody, 'green' this driver's best, 'yellow' slower, '' no time
  sectorColour(d, k) {
    const t = d.sec[k];
    if (!t) return '';
    if (t <= this.bestSec[k] + 0.0005) return 'purple';
    return t <= d.bestSec[k] + 0.0005 ? 'green' : 'yellow';
  }

  // the race in one line for the header
  status() {
    const lead = this.rows()[0];
    const m = this.meta;
    if (m.started && m.laps) return { text: `Race, lap ${Math.min(m.laps, Math.max(1, lead ? lead.lap : 1))}/${m.laps}`, racing: true };
    if (m.started) return { text: 'Race', racing: true };
    return { text: m.mode || 'Lobby', racing: false };
  }
}
