// Minisectors: the lap cut into about 25 pieces of roughly equal length, timed like the three sectors and coloured like F1:
// purple = the best this session, green = faster than the same minisector on your last lap, yellow = slower. Pure logic (no DOM,
// no meshes), fed by LapTimer, so tools/minisectors.js tests it in node.

export const MINISECTORS = 25;
export const PURPLE = 'purple', GREEN = 'green', YELLOW = 'yellow';
const EPS = 1e-6;

// Where each minisector starts, in metres along the lap, with the lap length as the last entry (so n + 1 numbers). The three sector
// boundaries are always minisector boundaries: each sector gets a share of `n` by its length (at least 1), then is cut evenly.
// reverse: the same boundaries mirrored (L - s, in lap order the other way round), so the posts stand in the same places in both directions.
export function minisectorBounds(track, reverse = false, n = MINISECTORS) {
  const L = track.length, edges = [...track.sectors, L];
  const counts = [];
  let left = n;
  for (let k = 0; k < 3; k++) {
    const last = k === 2, c = last ? left : Math.max(1, Math.min(left - (2 - k), Math.round(n * (edges[k + 1] - edges[k]) / L)));
    counts.push(c); left -= c;
  }
  const out = [];
  for (let k = 0; k < 3; k++) for (let j = 0; j < counts[k]; j++) out.push(edges[k] + (edges[k + 1] - edges[k]) * j / counts[k]);
  out.push(L);
  return reverse ? out.map(s => L - s).reverse() : out;
}

// the minisector that lap distance s (lap order) is in
export function minisectorAt(bounds, s) {
  let lo = 0, hi = bounds.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bounds[m] <= s) lo = m; else hi = m - 1; }
  return lo;
}

export class MinisectorTracker {
  constructor(track, reverse = false, n = MINISECTORS) {
    this.bounds = minisectorBounds(track, reverse, n);
    this.n = n;
    this.best = new Array(n).fill(null);   // best time of each minisector this session
    this.last = null;                      // times of the last finished lap (null for a minisector that was not timed)
    this.lastClasses = null;
    this.reset();
  }

  // the session starts over
  reset() { this.best.fill(null); this.last = null; this.lastClasses = null; this.history = []; this.startLap(false); }

  startLap(on) {
    this.dirty = false;
    this.on = on;           // false on the out lap and before the first crossing
    this.index = 0;         // the minisector being driven
    this.mark = 0;          // time into the lap when it began
    this.times = [];        // this lap's finished minisectors, in order
    this.classes = [];
  }

  // a minisector has been completed at `elapsed` seconds into the lap (null when a jump hid where it ended)
  finish(elapsed, timed) {
    const i = this.times.length;
    if (!timed) { this.times.push(null); this.classes.push(null); this.mark = elapsed; return; }
    const t = elapsed - this.mark;
    this.mark = elapsed;
    let cls;
    if (this.best[i] === null || t <= this.best[i] + EPS) { this.best[i] = this.best[i] === null ? t : Math.min(this.best[i], t); cls = PURPLE; }
    else if (this.last && this.last[i] != null && t < this.last[i] - EPS) cls = GREEN;
    else cls = YELLOW;
    this.times.push(t); this.classes.push(cls);
  }

  // one step of the car in lap order: from prevS to s, ds > 0 when it moved forward. elapsed = time into the lap.
  update(prevS, s, ds, elapsed) {
    if (!this.on) return;
    if (ds < -30) this.dirty = true;   // put back up the road: the minisector order no longer matches the lap
    if (ds <= 0) return;
    const B = this.bounds;
    let k = this.index, hit = 0;
    while (k + hit < this.n - 1 && prevS < B[k + hit + 1] && s >= B[k + hit + 1]) hit++;
    // a step that crosses two boundaries (a jump, not driving) cannot say when the first one was passed
    for (let j = 0; j < hit; j++) this.finish(elapsed, hit === 1);
    this.index += hit;
  }

  // the line was crossed. `counted` is true when the lap just finished was a whole lap (what LapTimer counts as one).
  finishLap(elapsed, counted) {
    if (counted && this.on && !this.dirty) {
      while (this.times.length < this.n) this.finish(elapsed, this.times.length === this.n - 1 && this.index === this.n - 1);
      this.last = this.times.slice(); this.lastClasses = this.classes.slice();
      this.history.push({ times: this.last, classes: this.lastClasses });
    }
    this.startLap(true);
  }

  // colour class of every minisector for drawing: this lap's where it is done, otherwise the last lap's (null: nothing yet)
  display() {
    const out = new Array(this.n).fill(null);
    for (let i = 0; i < this.n; i++) out[i] = i < this.classes.length ? this.classes[i] : this.lastClasses ? this.lastClasses[i] : null;
    return out;
  }
}
