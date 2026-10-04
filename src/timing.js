// Lap and sector timing for one car. Uses simulation time (seconds), so the
// headless lap test and the browser give the same numbers.

import { TrackLimits } from './trackLimits.js';

export class LapTimer {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.lap = 0;            // completed laps
    this.lapStart = null;    // sim time the current lap started, null before the first crossing
    this.sector = 0;
    this.current = [];       // sector times this lap
    this.last = null;        // last lap time
    this.lastSectors = null;
    this.best = null;
    this.bestSectors = [null, null, null];
    this.prevS = null;
    this.distance = 0;       // total distance driven along the lap, for race positions
    this.events = [];        // {type: 'sector'|'lap', ...} since last read
    this.limits = new TrackLimits();   // track limit warnings this session, cleared with everything else
  }

  // the lap being driven: 0 on the out lap, then 1, 2, ...
  currentLap() { return this.lapStart === null ? 0 : this.lap + 1; }

  // feed the car's wheels to the track limits check; returns the new warning, if any
  checkLimits(car, time) { return this.limits.update(car, time, this.currentLap(), this.running(time)); }

  update(s, time) {
    const T = this.track, L = T.length;
    if (this.prevS === null) { this.prevS = s; return; }
    let ds = s - this.prevS;
    if (ds < -L / 2) ds += L;
    if (ds > L / 2) ds -= L;
    this.distance += ds;
    const crossedLine = this.prevS > L - 200 && s < 200;
    if (crossedLine && ds > 0) this.finishLap(time);
    else if (this.lapStart !== null && this.sector < 2) {
      const next = T.sectors[this.sector + 1];
      if (this.prevS < next && s >= next && ds > 0) this.finishSector(time);
    }
    this.prevS = s;
  }

  finishSector(time) {
    const elapsed = time - this.lapStart;
    const t = elapsed - this.current.reduce((a, b) => a + b, 0);
    this.current.push(t);
    const i = this.sector;
    if (this.bestSectors[i] === null || t < this.bestSectors[i]) this.bestSectors[i] = t;
    this.events.push({ type: 'sector', index: i, time: t, elapsed });
    this.sector++;
  }

  finishLap(time) {
    if (this.lapStart !== null && this.sector === 2) {
      this.finishSector(time);
      const lapTime = time - this.lapStart;
      const isBest = this.best === null || lapTime < this.best;
      this.last = lapTime;
      this.lastSectors = this.current.slice();
      if (isBest) this.best = lapTime;
      this.lap++;
      this.events.push({ type: 'lap', time: lapTime, best: isBest, sectors: this.lastSectors });
    }
    this.lapStart = time;
    this.sector = 0;
    this.current = [];
  }

  // time into the current lap
  running(time) { return this.lapStart === null ? null : time - this.lapStart; }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
