// Lap and sector timing for one car. Uses simulation time (seconds), so the
// headless lap test and the browser give the same numbers.

import { TrackLimits } from './trackLimits.js';
import { MinisectorTracker } from './minisectors.js';

export class LapTimer {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.reverse ??= false;  // the lap driven the other way round: distances and sectors are mirrored, the line stays put
    this.lap = 0;            // completed laps
    this.lapStart = null;    // sim time the current lap started, null before the first crossing
    this.sector = 0;
    this.current = [];       // sector times this lap
    this.last = null;        // last lap time
    this.lastSectors = null;
    this.best = null;
    this.bestSectors = [null, null, null];
    this.history = [];       // every finished lap: { lap, time, sectors: [s1, s2, s3], warnings, valid, clean, autopilot }, oldest first (the out lap is not a lap)
    this.sectorBests = [null, null, null];   // the sector bests before the lap being driven: put back if that lap turns out invalid
    this.sectorPB = [false, false, false];   // this lap's sectors that are the session best so far (purple): never with a track limit warning
    this.autoLap = false;    // the autopilot drove some of the lap being driven
    this.prevS = null;
    this.distance = 0;       // total distance driven along the lap, for race positions
    this.events = [];        // {type: 'sector'|'lap', ...} since last read
    this.limits = new TrackLimits();   // track limit warnings this session, cleared with everything else
    // live delta: the time into the lap at every metre of this lap, and of the session's best lap
    this.trace = null;       // Float32Array, NaN where not reached yet
    this.traceAt = -1;       // the last whole metre written
    this.traceOK = false;    // false once the lap jumps (a reset, the pit lane cut short): such a lap never becomes the reference
    this.bestTrace = null;
    this.minis = new MinisectorTracker(this.track, this.reverse);   // the 25 minisector times and colours (src/minisectors.js), in lap order like everything here
  }

  // live delta: time into this lap minus the session's best lap at the same distance; null on the out lap or with no best yet
  delta(time) {
    const b = this.bestTrace;
    if (!b || this.lapStart === null || this.prevS === null) return null;
    const s = this.prevS;   // already in lap order (mirrored in reverse) by update
    const k = Math.floor(s), f = s - k, ref = b[k] + ((b[k + 1] ?? b[k]) - b[k]) * f;
    return Number.isFinite(ref) ? (time - this.lapStart) - ref : null;
  }

  // write the time into the lap for every whole metre passed since the last call
  recordTrace(s, time) {
    const n = Math.ceil(this.track.length) + 1;
    if (!this.trace) { this.trace = new Float32Array(n).fill(NaN); this.traceAt = -1; }
    const k = Math.floor(s), t = time - this.lapStart;
    if (k <= this.traceAt) return;                       // standing still or going backwards: keep the first pass
    if (k - this.traceAt > 40) this.traceOK = false;     // a jump, not driving
    const t0 = this.traceAt >= 0 ? this.trace[this.traceAt] : 0, from = this.traceAt;
    for (let m = from + 1; m <= k && m < n; m++) this.trace[m] = from < 0 ? t : t0 + (t - t0) * (m - from) / (k - from);
    this.traceAt = k;
  }

  // a reset or a teleport: the lap is no longer driven all the way round, so it is not clean (the flag a jump sets)
  markJump() { this.traceOK = false; }

  // the autopilot is driving: this lap is not a driver's lap (the local list leaves it out, see src/board.js)
  noteAutopilot() { this.autoLap = true; }

  // the lap being driven: 0 on the out lap, then 1, 2, ...
  currentLap() { return this.lapStart === null ? 0 : this.lap + 1; }

  // feed the car's wheels to the track limits check; returns the new warning, if any
  checkLimits(car, time) { return this.limits.update(car, time, this.currentLap(), this.running(time)); }

  update(s, time) {
    const T = this.track, L = T.length;
    if (this.reverse) s = (L - s) % L;
    const sectors = this.reverse ? [0, L - T.sectors[2], L - T.sectors[1]] : T.sectors;
    if (this.prevS === null) { this.prevS = s; return; }
    let ds = s - this.prevS;
    if (ds < -L / 2) ds += L;
    if (ds > L / 2) ds -= L;
    this.distance += ds;
    const crossedLine = this.prevS > L - 200 && s < 200;
    if (crossedLine && ds > 0) this.finishLap(time);
    else if (this.lapStart !== null) {
      if (ds > 0) this.recordTrace(s, time);
      this.minis.update(this.prevS, s, ds, time - this.lapStart, this.limits.countFor(this.currentLap()) === 0);
      const next = sectors[this.sector + 1];
      if (this.sector < 2 && this.prevS < next && s >= next && ds > 0) this.finishSector(time);
    }
    this.prevS = s;
  }

  finishSector(time) {
    const elapsed = time - this.lapStart;
    const t = elapsed - this.current.reduce((a, b) => a + b, 0);
    this.current.push(t);
    const i = this.sector;
    // purple only while this lap has no track limit warning yet; finishLap takes the sector back if the lap ends up invalid
    const prev = this.bestSectors[i], clean = this.limits.countFor(this.currentLap()) === 0;
    const pb = clean && (prev === null || t <= prev + 1e-6);
    if (clean && (prev === null || t < prev)) this.bestSectors[i] = t;
    this.sectorPB[i] = pb;
    this.events.push({ type: 'sector', index: i, time: t, elapsed, best: pb });
    this.sector++;
  }

  finishLap(time) {
    const autopilot = this.autoLap;   // whether the autopilot drove any of the lap that is ending
    if (this.lapStart !== null && this.sector === 2) {
      this.finishSector(time);
      const lapTime = time - this.lapStart;
      // a lap with a track limit warning is invalid: it keeps its time, but it is never the best, the PB, a purple sector or a purple minisector
      const warnings = this.limits.countFor(this.lap + 1), valid = warnings === 0;   // the lap being finished is currentLap() until lap++
      this.minis.finishLap(lapTime, true, valid);
      this.lap++;
      // whole: driven all the way round with no jump (a reset or a teleport). Only a whole lap can be the session best or the delta reference
      const whole = !!(this.trace && this.traceOK && this.traceAt > this.track.length - 60);
      const isBest = valid && whole && (this.best === null || lapTime < this.best);
      if (!valid) this.bestSectors = this.sectorBests.slice();
      this.last = lapTime;
      this.lastSectors = this.current.slice();
      if (isBest) {
        this.best = lapTime;
        // this lap becomes the delta reference (the last metres up to the line filled in)
        for (let m = this.traceAt + 1; m < this.trace.length; m++) this.trace[m] = lapTime;
        this.bestTrace = this.trace;
      }
      // clean: a whole lap with no jump; only a valid AND clean lap goes to the global times
      const clean = whole;
      this.history.push({ lap: this.lap, time: lapTime, sectors: this.lastSectors, warnings, valid, clean, autopilot });
      this.events.push({ type: 'lap', time: lapTime, best: isBest, valid, sectors: this.lastSectors });
    }
    else this.minis.finishLap(0, false);   // the out lap or a lap that skipped a sector: nothing to keep
    this.lapStart = time;
    this.sectorBests = this.bestSectors.slice();
    this.sector = 0;
    this.current = [];
    this.sectorPB = [false, false, false];
    this.autoLap = false;
    this.trace = null; this.traceAt = -1; this.traceOK = true;   // a new lap starts clean (markJump clears it again)
  }

  // time into the current lap
  running(time) { return this.lapStart === null ? null : time - this.lapStart; }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
