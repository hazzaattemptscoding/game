// Autopilot: drives a car round a racing line. Used by the headless lap test
// now, and as the base for AI opponents later.

import { wrap } from './track.js';

const G = 9.81, AIR = 1.225;

// A racing line, as a sideways offset from the centreline at every sample.
// Bends the line within the track edges to make the curvature as low and as
// even as possible, which gives the classic outside-apex-outside shape.
export function computeRacingLine(T, edgeMargin = 1.4) {
  const { N, x, z, nx, nz } = T;
  const off = new Float64Array(N);
  const lim = T.halfWidth - edgeMargin;
  const px = i => x[i] + nx[i] * off[i], pz = i => z[i] + nz[i] * off[i];
  for (const [reach, iters] of [[24, 300], [12, 300], [6, 300], [3, 200]]) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a2 = wrap(i - 2 * reach, N), a = wrap(i - reach, N), b = wrap(i + reach, N), b2 = wrap(i + 2 * reach, N);
        // where this point would sit if the curvature here matched its neighbours
        const mx = (4 * (px(a) + px(b)) - px(a2) - px(b2)) / 6;
        const mz = (4 * (pz(a) + pz(b)) - pz(a2) - pz(b2)) / 6;
        const want = (mx - x[i]) * nx[i] + (mz - z[i]) * nz[i];
        off[i] = Math.max(-lim, Math.min(lim, off[i] + 0.5 * (want - off[i])));
      }
    }
  }
  const lx = new Float64Array(N), lz = new Float64Array(N), curv = new Float64Array(N);
  for (let i = 0; i < N; i++) { lx[i] = x[i] + nx[i] * off[i]; lz[i] = z[i] + nz[i] * off[i]; }
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 6, N), b = wrap(i + 6, N);
    const abx = lx[i] - lx[a], abz = lz[i] - lz[a], acx = lx[b] - lx[a], acz = lz[b] - lz[a];
    const cross = abx * acz - abz * acx;
    const AB = Math.hypot(abx, abz), BC = Math.hypot(lx[b] - lx[i], lz[b] - lz[i]), CA = Math.hypot(acx, acz);
    curv[i] = 2 * cross / (AB * BC * CA || 1);
  }
  return { off, x: lx, z: lz, curv };
}

// Target speed at every sample: as fast as the grip allows in corners, and
// slow enough to brake in time for the next one. `skill` scales the grip the
// driver dares to use (1 = on the limit).
export function speedProfile(T, line, cfg, skill) {
  const { N, ds } = T;
  const v = new Float64Array(N);
  const mu = cfg.grip * Math.min(cfg.frontGrip, cfg.rearGrip) * skill;
  const q = 0.5 * AIR * cfg.downforceArea / cfg.mass;
  const dragK = 0.5 * AIR * cfg.dragArea / cfg.mass;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(line.curv[i]);
    v[i] = k > mu * q ? Math.min(85, Math.sqrt(mu * G / (k - mu * q))) : 85;
  }
  // braking zones, worked backwards from each corner
  const brakeShare = 0.82 * skill;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = N - 1; k >= 0; k--) {
      const i = k, j = wrap(k + 1, N);
      const decel = mu * brakeShare * (G + q * v[j] * v[j]) + dragK * v[j] * v[j];
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * decel * ds));
    }
  }
  return v;
}

export class Autopilot {
  constructor(track, cfg, { skill = 1, line } = {}) {
    this.track = track;
    this.cfg = cfg;
    this.line = line || computeRacingLine(track);
    this.skill = skill;
    this.vmax = speedProfile(track, this.line, cfg, skill);
    this.input = { steer: 0, throttle: 0, brake: 0, drs: true };
    this.brakeCap = 1;
    this.throttleCap = 1;
  }

  drive(car) {
    const T = this.track, L = this.line, i = car.loc.i, v = Math.max(car.fwdSpeed, 0);

    // steering: aim at a point on the line ahead (pure pursuit), measured
    // from the direction the car is travelling, then ask for the cornering
    // force that arc needs as a share of what the tyres can give
    const look = 6 + v * 0.4;
    const j = wrap(i + Math.round(look / T.ds), T.N);
    const dx = L.x[j] - car.x, dz = L.z[j] - car.z;
    const dirA = car.speed > 4 ? Math.atan2(car.vz, car.vx) : car.heading;
    const ch = Math.cos(dirA), sh = Math.sin(dirA);
    const fwd = dx * ch + dz * sh, right = -dx * sh + dz * ch;
    const arc = 2 * right / Math.max(fwd * fwd + right * right, 1);
    if (v > 8) {
      const grip = this.cfg.grip * (G + 0.5 * AIR * this.cfg.downforceArea * v * v / this.cfg.mass);
      // catch slides: ease off the lock when the car rotates faster than the
      // arc, and harder still once the rear tyres are past their peak
      const yawErr = car.yawRate - v * arc;
      const catchGain = 1.5 + 4 * Math.max(0, car.slipR - 1);
      this.input.steer = Math.max(-1, Math.min(1, 1.15 * arc * v * v / grip - catchGain * yawErr));
    } else {
      const delta = Math.atan(car.cfg.wheelbase * arc);
      this.input.steer = Math.max(-1, Math.min(1, delta / car.steerRange));
    }

    // speed: follow the target speed a little ahead of the car
    const k = wrap(i + Math.round((2 + v * 0.15) / T.ds), T.N);
    const err = this.vmax[k] - v;
    if (err > 0) { this.input.throttle = Math.min(1, 0.55 + err * 0.4); this.input.brake = 0; }
    else if (err > -1.5) { this.input.throttle = Math.max(0, 0.45 + err * 0.3); this.input.brake = 0; }
    else { this.input.throttle = 0; this.input.brake = Math.min(1, -err * 0.25); }
    // squeeze the throttle out of corners, and come off the brake, if the rear is near its limit
    this.input.throttle *= Math.max(0.15, Math.min(1, 1.8 - car.slipR));
    this.input.brake *= Math.max(0, Math.min(1, 2 - car.slipR));
    // feel for lock-ups and wheelspin, like a driver without ABS or traction control
    this.brakeCap = car.lock ? Math.max(0.3, this.brakeCap - 0.05) : Math.min(1, this.brakeCap + 0.01);
    this.throttleCap = car.spin ? Math.max(0.2, this.throttleCap - 0.05) : Math.min(1, this.throttleCap + 0.01);
    this.input.brake = Math.min(this.input.brake, this.brakeCap);
    this.input.throttle = Math.min(this.input.throttle, this.throttleCap);
    return this.input;
  }
}
