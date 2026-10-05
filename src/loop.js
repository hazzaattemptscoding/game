// Frame pacing helpers, plain data and maths with no page needed (tools/perf.js runs them in node).
//
// The game draws on requestAnimationFrame, at whatever rate the display runs (60, 120, 144, 240 Hz). The physics runs on a fixed step
// (STEP in physics.js) fed from an accumulator, so the car does exactly the same at any frame rate, and the render blends between the
// last two steps with alpha = acc / step.

export const MAX_FRAME = 0.1;      // longest frame time the loop will believe, seconds; a tab switch or a debugger stop is cut to this

export const frameTime = (dt, max = MAX_FRAME) => (dt > 0 ? Math.min(dt, max) : 0);

// 1 - exp(-rate * dt): the share of the gap a value closes in dt seconds when it eases towards its target at `rate` per second.
// Unlike `rate * dt` it gives the same motion at 60 and 240 Hz and never overshoots on a long frame.
export const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

export class FixedStep {
  constructor(step) { this.step = step; this.acc = 0; }
  // add the real time of one frame (seconds, clamped)
  add(dt) { this.acc += frameTime(dt); }
  // true once for every whole physics step that is due: `while (loop.due()) { ...one step... }`
  due() { if (this.acc >= this.step) { this.acc -= this.step; return true; } return false; }
  get alpha() { return this.acc / this.step; }
  // drop the time that has built up (after a pause or a reset)
  reset() { this.acc = 0; }
}

// Frame time statistics for the FPS readout and the render scaler: an average and the slowest frame over a short window.
export class FrameStats {
  constructor(window = 0.5) {
    this.window = window; this.t = 0; this.n = 0; this.sum = 0; this.worstNow = 0;
    this.fps = 0; this.avgMs = 0; this.worstMs = 0;
  }
  // dt in seconds. Returns true when a new reading was just published.
  push(dt) {
    if (!(dt > 0)) return false;
    this.t += dt; this.n++; this.sum += dt; if (dt > this.worstNow) this.worstNow = dt;
    if (this.t < this.window) return false;
    this.fps = this.n / this.t; this.avgMs = this.sum / this.n * 1000; this.worstMs = this.worstNow * 1000;
    this.t = 0; this.n = 0; this.sum = 0; this.worstNow = 0;
    return true;
  }
  text(extra = '') { return this.n || this.fps ? `${Math.round(this.fps)} fps  ${this.avgMs.toFixed(1)} ms  worst ${this.worstMs.toFixed(1)}${extra ? '  ' + extra : ''}` : 'FPS'; }
}
