// Car physics: a bicycle model (one front tyre, one rear tyre) with load
// transfer, a tyre slip curve, aero, an engine and an automatic gearbox.
// Runs at a fixed 120 steps per second, the same in the browser, the AI and
// the headless lap test.
//
// Body frame: vx forward, vy to the right, yaw rate r positive = turning right.

import { SURF } from './track.js';
import { carContact } from './carContact.js';

export const STEP = 1 / 120;
const G = 9.81;
const AIR = 1.225;      // air density, kg/m3
const MIN_SLIP_SPEED = 5; // below this speed (m/s) slip angles are calculated as if at this speed, to keep parking speeds stable

// What each surface does to the car.
//   grip: multiplies tyre grip
//   drag: extra rolling drag as a share of the car's weight (gravel is huge)
//   bump: how much it shakes the car (for camera, rumble and sound)
export const SURFACE = {
  // spacing: metres between the bumps this surface makes, which sets the pitch of the vibration
  [SURF.TARMAC]: { grip: 1.0, drag: 0, bump: 0, spacing: 4 },
  [SURF.PAINT]: { grip: 0.93, drag: 0, bump: 0, spacing: 4 },
  [SURF.KERB]: { grip: 0.95, drag: 0.004, bump: 0.35, spacing: 0.9 },
  [SURF.SAUSAGE]: { grip: 0.6, drag: 0.03, bump: 1, spacing: 0.7 },
  [SURF.RUNOFF]: { grip: 0.97, drag: 0, bump: 0.15, spacing: 4 },   // old runway concrete: a mild rumble from its joints
  [SURF.GRASS]: { grip: 0.55, drag: 0.06, bump: 0.2, spacing: 1.1 },
  [SURF.GRAVEL]: { grip: 0.35, drag: 0.7, bump: 0.6, spacing: 0.35 },
  [SURF.PIT]: { grip: 1.0, drag: 0, bump: 0 },
  [SURF.RUMBLE]: { grip: 0.95, drag: 0.02, bump: 1.2, spacing: 0.45 },
  [SURF.RUNOFF_ROUGH]: { grip: 0.95, drag: 0.002, bump: 0.25, spacing: 4 },   // starts like RUNOFF; physics.js fades it towards the gravel
};

const WALL_BOUNCE = 0.25;   // how much speed comes back off a barrier (0 = dead stop, 1 = rubber ball)
const WALL_FRICTION = 0.5;  // how much the barrier scrubs speed when you slide along it
const CAR_BOUNCE = 0.2;     // how much closing speed comes back off another car

// Grip as the tyre slips more. Builds to 1 at the peak slip angle, then
// falls off smoothly to `slide` (planted until overdriven, slides are
// recoverable rather than a cliff).
export function tyreCurve(slip, peak, slide) {
  const s = Math.abs(slip) / peak;
  let k;
  if (s < 1) k = s * (2 - s);
  else if (s < 3) { const t = (s - 1) / 2; k = 1 - (1 - slide) * t * t * (3 - 2 * t); }
  else k = slide;
  return slip < 0 ? -k : k;
}

export class Car {
  constructor(cfg, track) {
    this.cfg = cfg;
    this.track = track;
    this.a = cfg.wheelbase * (1 - cfg.frontWeight); // centre of gravity to front axle
    this.b = cfg.wheelbase * cfg.frontWeight;       // centre of gravity to rear axle
    this.assistTc = true; this.assistAbs = true; this.assistEsc = true;   // each assist is switched on its own, see setAssists
    this.wetGrip = 1;         // set by weather, 1 = dry
    this.loc = { i: 0 };
    this.prev = {};
    this.wheelSurf = [0, 0, 0, 0]; // FL FR RL RR
    this.events = { shift: 0, hit: 0 };
    this.placeAt(0, 0);
  }

  // true, false, or { tc, abs, esc } (a missing key leaves that assist as it is)
  setAssists(v) {
    if (typeof v === 'boolean') { this.assistTc = this.assistAbs = this.assistEsc = v; return; }
    if (v.tc !== undefined) this.assistTc = !!v.tc;
    if (v.abs !== undefined) this.assistAbs = !!v.abs;
    if (v.esc !== undefined) this.assistEsc = !!v.esc;
  }
  get assists() { return { tc: this.assistTc, abs: this.assistAbs, esc: this.assistEsc }; }
  set assists(v) { this.setAssists(v); }   // old code that sets car.assists = true|false keeps working

  // Put the car on the track at distance s, offset d to the side, stationary. reverse: facing the other way round the lap.
  placeAt(s, d, reverse = false) {
    const T = this.track, i = Math.floor(((s % T.length) + T.length) % T.length / T.ds) % T.N;
    this.x = T.x[i] + T.nx[i] * d;
    this.z = T.z[i] + T.nz[i] * d;
    this.y = T.h[i];
    this.heading = Math.atan2(T.tz[i], T.tx[i]) + (reverse ? Math.PI : 0);
    this.reversed = reverse;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.steer = 0; this.gear = 1; this.rpm = this.cfg.idleRpm; this.shiftTimer = 0;
    this.ax = 0; this.ay = 0; this.speed = 0; this.fwdSpeed = 0;
    this.throttle = 0; this.brake = 0; this.drs = false;
    this.slipF = 0; this.slipR = 0; this.spin = false; this.lock = false;
    this.tc = false; this.abs = false; this.esc = false; this.pitLimiter = false;
    this.reverseTimer = 0; this.wheelSpinAngle = 0; this.bump = 0;
    this.steerRange = this.cfg.maxLock;
    this.loc = { i, h: this.y };
    this.track.locate(this.x, this.z, i, this.loc);
    this.y = T.groundAt ? T.groundAt(this.x, this.z, i) : this.loc.h;
    this.groundY = this.y; this.relY = 0; this.groundRoll = 0; this.groundPitch = 0; this.bumpSpacing = 4; this.slopeRight = 0;
    this.savePrev();
  }

  // Back onto the centreline facing the right way (the R key).
  resetToTrack() { this.placeAt(this.loc.s, 0, this.reversed); }

  savePrev() {
    const p = this.prev;
    p.x = this.x; p.y = this.y; p.z = this.z; p.heading = this.heading;
    p.steer = this.steer; p.ax = this.ax; p.ay = this.ay; p.wheel = this.wheelSpinAngle;
  }

  step(inp, dt = STEP) {
    const c = this.cfg, T = this.track, loc = this.loc, m = c.mass;
    this.savePrev();
    this.events.shift = 0; this.events.hit = 0;

    // --- body-frame velocity ---
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    let vx = this.vx * ch + this.vz * sh;
    let vy = -this.vx * sh + this.vz * ch;
    let r = this.yawRate;
    const speed = Math.hypot(vx, vy);
    const dir = vx >= 0 ? 1 : -1;

    // --- what each wheel is on ---
    const hw = c.trackWidth / 2;
    const fwdN = ch * loc.nx + sh * loc.nz;     // how much "forward" points across the track
    const rightN = -sh * loc.nx + ch * loc.nz;  // how much "right" points across the track
    const wheelX = [this.a, this.a, -this.b, -this.b], wheelY = [-hw, hw, -hw, hw];
    let gripF = 0, gripR = 0, surfDrag = 0, bump = 0, spacing = 4;
    for (let w = 0; w < 4; w++) {
      const d = loc.d + wheelX[w] * fwdN + wheelY[w] * rightN;
      const sf = T.surfaceAt(loc.i, d);
      this.wheelSurf[w] = sf;
      const S = SURFACE[sf];
      const progress = sf === SURF.RUNOFF_ROUGH && T.concreteProgressAt ? T.concreteProgressAt(loc.i, d) : 0;
      const grip = sf === SURF.RUNOFF_ROUGH ? 0.95 - 0.25 * progress : S.grip;
      const drag = sf === SURF.RUNOFF_ROUGH ? 0.002 + 0.018 * progress : S.drag;
      const roughness = sf === SURF.RUNOFF_ROUGH ? 0.25 + 0.75 * progress : S.bump;
      if (w < 2) gripF += grip / 2; else gripR += grip / 2;
      surfDrag += drag / 4;
      if (roughness > bump) { bump = roughness; spacing = S.spacing || 4; }
    }
    this.bump = bump * Math.min(1, speed / 15);
    this.bumpSpacing = spacing;

    // --- DRS: opens in a zone when asked, shuts on the brakes or leaving the zone ---
    const inZone = !this.reversed && T.inDRS(loc.s);   // the DRS zones are laid out for the normal direction
    if (inZone && inp.drs && inp.brake < 0.05 && this.gear > 0) this.drs = true;
    if (!inZone || inp.brake > 0.05) this.drs = false;

    // --- aero ---
    const q = 0.5 * AIR * vx * vx;
    const drag = q * c.dragArea * (this.drs ? 1 - c.drsDragCut : 1);
    const down = q * c.downforceArea * (this.drs ? 1 - c.drsDownforceCut : 1);

    // --- hills: slope along the car, and crests/dips changing the load ---
    const along = ch * loc.tx + sh * loc.tz;
    const slope = loc.grade * along;
    const weight = Math.max(0.2 * m * G, m * (G + vx * vx * loc.vcurv * along * along));

    // --- axle loads with weight transfer (uses smoothed acceleration, like suspension) ---
    const L = c.wheelbase, transfer = m * this.ax * c.cgHeight / L;
    const Fzf = Math.max(50, weight * this.b / L - transfer + down * c.aeroBalance);
    const Fzr = Math.max(50, weight * this.a / L + transfer + down * (1 - c.aeroBalance));
    // a tyre carrying more than its share loses a little grip per kilo, and an unloaded one gains a little
    const sens = (Fz, share) => clamp(1 - c.loadSensitivity * (Fz / (m * G * share) - 1), 0.75, 1.15);
    const FmaxF = Fzf * c.grip * c.frontGrip * gripF * this.wetGrip * sens(Fzf, c.frontWeight);
    const FmaxR = Fzr * c.grip * c.rearGrip * gripR * this.wetGrip * sens(Fzr, 1 - c.frontWeight);

    // --- steering ---
    // Speed-sensitive: at speed, full lock is about the angle that takes the
    // car to its cornering limit, so holding full lock is stable and quick.
    // Steering towards a slide (countersteer) gets extra room: up to the
    // angle the front wheels are actually travelling at, plus the grip peak,
    // so slides can always be caught.
    // cornering grip left after braking or accelerating (friction circle)
    const gripLimit = c.grip * (G + down / m);
    const latLimit = Math.sqrt(Math.max(0.2 * gripLimit * gripLimit, gripLimit * gripLimit - this.ax * this.ax));
    const vs = Math.max(speed, 1);
    const turnLimit = Math.min(c.maxLock, c.steerLimit * L * latLimit / (vs * vs) + c.steerSlack);
    const travel = vx > 3 ? Math.atan2(vy + this.a * r, vx) : 0;
    const catchLimit = Math.min(c.maxLock, Math.abs(travel) + c.peakSlipFront * c.steerLimit);
    const steerIn = clamp(inp.steer, -1, 1);
    const target = steerIn * (steerIn * travel > 0 ? Math.max(turnLimit, catchLimit) : turnLimit);
    this.steerRange = turnLimit;
    this.steer += clamp(target - this.steer, -c.steerRate * dt, c.steerRate * dt);
    const delta = this.steer, cd = Math.cos(delta), sd = Math.sin(delta);

    // --- gearbox and engine ---
    const throttleIn = clamp(inp.throttle, 0, 1), brakeIn = clamp(inp.brake, 0, 1);
    this.updateGear(vx, throttleIn, brakeIn, dt);
    let throttle = throttleIn, brake = brakeIn;
    if (this.gear < 0) { throttle = brakeIn; brake = throttleIn; } // reversing: brake pedal drives backwards
    // pit lane speed limiter: no drive above the limit, and gentle braking down to it
    this.pitLimiter = T.inPitLimiter(loc.i, loc.d);
    if (this.pitLimiter && speed > T.pitSpeed - 0.5) throttle = 0;
    if (this.pitLimiter && speed > T.pitSpeed + 1) brake = Math.max(brake, Math.min(0.5, (speed - T.pitSpeed) * 0.08));

    let drive = 0;
    if (this.gear > 0) {
      const ratio = c.gears[this.gear - 1] * c.finalDrive;
      let rpm = Math.abs(vx) / c.wheelRadius * ratio * 60 / (2 * Math.PI);
      if (this.gear === 1) rpm = Math.max(rpm, c.idleRpm + throttle * 3200); // clutch slip pulling away
      this.rpm = Math.max(c.idleRpm, rpm);
      let torque = interp(c.torqueCurve, this.rpm) * throttle;
      if (this.rpm >= c.redline || this.shiftTimer > 0) torque = 0;
      if (this.esc) torque *= 0.6;
      drive = torque * ratio * c.driveEfficiency / c.wheelRadius;
      // engine braking off throttle
      drive -= dir * c.engineBraking * (this.rpm / c.redline) * (1 - throttle);
    } else {
      this.rpm = c.idleRpm + throttle * 3000;
      drive = -throttle * c.reverseForce * (vx > -8 ? 1 : 0);
    }

    // --- tyre slip angles ---
    const fvy = vy + this.a * r;
    const longF = vx * cd + fvy * sd, latF = -vx * sd + fvy * cd;
    const alphaF = Math.atan2(latF, Math.max(Math.abs(longF), MIN_SLIP_SPEED));
    const alphaR = Math.atan2(vy - this.b * r, Math.max(Math.abs(vx), MIN_SLIP_SPEED));
    const curveF = tyreCurve(alphaF, c.peakSlipFront, c.slideGripFront);
    const curveR = tyreCurve(alphaR, c.peakSlipRear, c.slideGripRear);

    // --- forward/back force each axle wants ---
    const reqF = -brake * c.brakeForce * c.brakeBias * dir;
    const reqR = drive - brake * c.brakeForce * (1 - c.brakeBias) * dir;

    // --- combine with cornering: a tyre has one budget of grip to share ---
    const front = this.axle(reqF, FmaxF, curveF, false);
    const rearDrives = drive * dir > 0 && brake === 0;   // the rear tyres are pulling: traction control, otherwise ABS
    const rear = this.axle(reqR, FmaxR, curveR, rearDrives);
    this.tc = rear.assisted && rearDrives;
    this.abs = (front.assisted || rear.assisted) && brake > 0;
    this.spin = rear.slipping && drive * dir > 0;
    this.lock = (front.slipping || rear.slipping) && brake > 0;

    // --- total forces on the body ---
    const resist = (c.rollingResistance + surfDrag) * weight;
    let Fx = front.fx * cd - front.fy * sd + rear.fx - dir * (drag + resist) - m * G * slope;
    // across a sloping road (camber, a bank) gravity pulls the car towards the low side: slopeRight is last step's rise to the right
    const Fy = front.fx * sd + front.fy * cd + rear.fy - m * G * (this.slopeRight || 0);
    let Mz = this.a * (front.fx * sd + front.fy * cd) - this.b * rear.fy;

    // --- stability control: stops the car rotating faster than its path, and
    // pulls it back when the tail is already well out ---
    this.esc = false;
    if (this.assistEsc && vx > 5) {
      const beta = Math.atan2(vy, vx);   // body slip: angle between the nose and the direction of travel
      const signal = r - (Fy / m) / vx - c.escSlipGain * beta;
      if (Math.sign(signal) === Math.sign(r) && Math.abs(signal) > c.escThreshold) {
        Mz -= Math.sign(signal) * Math.min(c.escGain * (Math.abs(signal) - c.escThreshold), c.escMax);
        this.esc = true;
      }
    }

    // --- integrate ---
    const vxBefore = vx;
    vx += (Fx / m + r * vy) * dt;
    vy += (Fy / m - r * vxBefore) * dt;
    r += Mz / c.yawInertia * dt;
    // brakes and drag stop the car, they never push it backwards
    if (drive * dir <= 0 && Math.sign(vx) !== Math.sign(vxBefore) && vxBefore !== 0) vx = 0;
    if (Math.abs(vx) < 0.05 && throttle === 0) { vx = 0; vy *= 0.8; r *= 0.8; }

    // smoothed accelerations, used for weight transfer and body pitch/roll
    const k = Math.min(1, dt / 0.08);
    this.ax += (Fx / m - this.ax) * k;
    this.ay += (Fy / m - this.ay) * k;

    this.heading += r * dt;
    const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
    this.vx = vx * c2 - vy * s2;
    this.vz = vx * s2 + vy * c2;
    this.yawRate = r;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // --- back onto the road surface, then barriers ---
    T.locate(this.x, this.z, loc.i, loc);
    this.collideWalls();
    // the road under the car, plus the real height of the kerb or sausage under each wheel
    const groundY = T.groundAt ? T.groundAt(this.x, this.z, loc.i) : loc.h;
    const hwt = c.trackWidth / 2, fN = Math.cos(this.heading) * loc.nx + Math.sin(this.heading) * loc.nz, rN = -Math.sin(this.heading) * loc.nx + Math.cos(this.heading) * loc.nz;
    const wheelRel = [0, 0, 0, 0];
    for (let w = 0; w < 4; w++) {
      const dw = loc.d + wheelX[w] * fN + wheelY[w] * rN;
      wheelRel[w] = T.relief ? T.relief(dw < 0 ? 0 : 1, loc.i, Math.abs(dw)) : 0;
    }
    const meanRel = (wheelRel[0] + wheelRel[1] + wheelRel[2] + wheelRel[3]) / 4;
    // The body's tilt (drawing only, nothing here feeds the forces): the real ground under each wheel, plus the kerb on it,
    // so the car leans with the road's camber, a bank or a sloping verge instead of only with the centreline's grade.
    // groundPitch and groundRoll are the whole tilt (CarView draws them, ghosts.js sends them as pz and rx). Taken from the ground
    // itself, not from loc.grade: loc's tangent points the other way to the track's, which once tilted every car the wrong way on slopes.
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading), wheelY2 = [0, 0, 0, 0];
    for (let w = 0; w < 4; w++) {
      const wx = this.x + fx * wheelX[w] - fz * wheelY[w], wz = this.z + fz * wheelX[w] + fx * wheelY[w];
      wheelY2[w] = (T.groundAt ? T.groundAt(wx, wz, loc.i) : loc.h) + wheelRel[w];
    }
    const roll = Math.atan(((wheelY2[1] + wheelY2[3]) - (wheelY2[0] + wheelY2[2])) / 2 / (2 * hwt));
    // the ground's own rise to the right under the car (no kerb relief), for the sideways pull of gravity next step
    this.slopeRight = ((wheelY2[1] - wheelRel[1] + wheelY2[3] - wheelRel[3]) - (wheelY2[0] - wheelRel[0] + wheelY2[2] - wheelRel[2])) / 2 / (2 * hwt);
    const pitch = Math.atan(((wheelY2[0] + wheelY2[1]) - (wheelY2[2] + wheelY2[3])) / 2 / (this.a + this.b));
    const ease = 1 - Math.exp(-dt / 0.05);
    this.groundY += (groundY - this.groundY) * ease;
    this.relY += (meanRel - this.relY) * ease; this.groundRoll += (roll - this.groundRoll) * ease; this.groundPitch += (pitch - this.groundPitch) * ease;
    this.y = this.groundY + this.relY;

    // --- outputs for camera, sound, HUD ---
    const fx2 = Math.cos(this.heading), fz2 = Math.sin(this.heading);
    this.fwdSpeed = this.vx * fx2 + this.vz * fz2;
    this.speed = Math.hypot(this.vx, this.vz);
    this.throttle = throttleIn; this.brake = brakeIn;
    this.slipF = Math.abs(alphaF) / c.peakSlipFront;
    this.slipR = Math.abs(alphaR) / c.peakSlipRear;
    this.wheelSpinAngle += (this.spin ? Math.max(Math.abs(vx), 10) * dir : vx) / c.wheelRadius * dt;
    if (this.lock) this.wheelSpinAngle = this.prev.wheel;
  }

  // One axle: share the grip between forward force and cornering.
  axle(req, Fmax, curve, isDrive) {
    const c = this.cfg, out = { fx: req, fy: 0, slipping: false, assisted: false };
    if (isDrive ? this.assistTc : this.assistAbs) {
      // traction control (drive) or ABS (braking): keep the tyre inside its grip budget
      const room = Math.max(isDrive ? c.tcFloor : 0.3, Math.sqrt(Math.max(0, 1 - curve * curve))) * Fmax * 0.98;
      if (Math.abs(req) > room) { out.fx = Math.sign(req) * room; out.assisted = true; }
    }
    let cap;
    if (Math.abs(out.fx) > Fmax) {
      // wheelspin or lock-up: less drive, and the tyre loses most of its sideways grip
      out.fx = Math.sign(out.fx) * Fmax * c.wheelspinGrip;
      cap = Fmax * c.slipLateral;
      out.slipping = true;
    } else {
      cap = Math.sqrt(Fmax * Fmax - out.fx * out.fx);
    }
    out.fy = -cap * curve;
    return out;
  }

  updateGear(vx, throttle, brake, dt) {
    const c = this.cfg;
    // hold the brake while stopped to reverse, press throttle to go forward again
    if (this.gear > 0 && Math.abs(vx) < 0.5 && brake > 0.5 && throttle < 0.1) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.4) { this.gear = -1; this.reverseTimer = 0; }
      return;
    }
    this.reverseTimer = 0;
    if (this.gear < 0) { if (throttle > 0.1 && vx > -0.5) this.gear = 1; return; }
    if (this.shiftTimer > 0) { this.shiftTimer -= dt; return; }
    const wheelRpm = Math.abs(vx) / c.wheelRadius * 60 / (2 * Math.PI);
    const rpmIn = g => wheelRpm * c.gears[g - 1] * c.finalDrive;
    if (this.gear < c.gears.length && rpmIn(this.gear) > c.upshiftRpm) {
      this.gear++; this.shiftTimer = c.shiftTime; this.events.shift = 1;
    } else if (this.gear > 1 && rpmIn(this.gear - 1) < c.downshiftRpm) {
      this.gear--; this.shiftTimer = c.shiftTime * 0.5; this.events.shift = -1;
    }
  }

  // Other players' cars (multiplayer). There is no server, so each player resolves contact for their own car only,
  // against the other cars as they are drawn. `others` is a list of { x, z, heading, vx, vz, yawRate, age, silent }.
  // Same treatment as a barrier hit, but at half strength: the other player's game applies the other half to their car.
  // Call it before step(). With no other cars it does nothing.
  collideCars(others, dt = STEP) {
    this.clock = (this.clock || 0) + dt;
    if (this.contactGrace > 0) { this.contactGrace -= dt; return; }   // just appeared or reset: no contact for a moment
    const eps = this.contactEpisodes || (this.contactEpisodes = new Map());   // id -> { vn: closing speed after our impulse, t: last contact }
    const c = this.cfg, m = c.mass, I = c.yawInertia;
    for (const o of others) {
      if (o.silent > 0.5 || o.age < 1.5) continue;
      const k = carContact(this, o, c.length, c.width);
      if (!k) continue;
      const cx = k.px - this.x, cz = k.pz - this.z, r = this.yawRate, ro = o.yawRate || 0;
      const rx = k.px - o.x, rz = k.pz - o.z;
      const rvx = this.vx - r * cz - (o.vx - ro * rz), rvz = this.vz + r * cx - (o.vz + ro * rx);   // my velocity at the contact, relative to theirs
      const vn = rvx * k.nx + rvz * k.nz;
      if (k.depth > 0.3 && Math.hypot(rvx, rvz) < 3) {
        // overlapping while nearly still (a reset or a join on top of someone): drift apart gently, no impulse
        this.x += k.nx * 1.5 * dt; this.z += k.nz * 1.5 * dt;
        continue;
      }
      const push = Math.min(0.5 * k.depth, 0.5);
      this.x += k.nx * push; this.z += k.nz * push;
      // One impulse per touch. The other player's game answers 100 ms or more later, and until it does we see them standing
      // still; hitting them again every step would stop us dead against a car that is about to move away.
      const ep = eps.get(o.id);
      const fresh = !ep || this.clock - ep.t > 0.25;
      if (ep) ep.t = this.clock;
      if (vn >= 0 || (!fresh && vn >= ep.vn - 2)) continue;
      const cross = (ax, az, bx, bz) => ax * bz - az * bx;
      const kn = 1 / m + cross(cx, cz, k.nx, k.nz) ** 2 / I;
      const jn = 0.5 * (1 + CAR_BOUNCE) * -vn / kn;
      let tx = rvx - vn * k.nx, tz = rvz - vn * k.nz;
      const vt = Math.hypot(tx, tz);
      let jt = 0;
      if (vt > 1e-3) {
        tx /= vt; tz /= vt;
        const kt = 1 / m + cross(cx, cz, tx, tz) ** 2 / I;
        jt = -Math.min(0.5 * vt / kt, WALL_FRICTION * jn);
      }
      const Jx = jn * k.nx + jt * tx, Jz = jn * k.nz + jt * tz;
      this.vx += Jx / m; this.vz += Jz / m;
      this.yawRate += cross(cx, cz, Jx, Jz) / I;
      eps.set(o.id, { vn: vn + (1 + CAR_BOUNCE) * 0.5 * -vn, t: this.clock });
    }
  }

  // Barriers: check the four corners of the car against the placed barrier
  // sections (tools in track.js), push back out and bounce.
  collideWalls() {
    const c = this.cfg, T = this.track, loc = this.loc;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    let deepest = 0, cx = 0, cz = 0, nnx = 0, nnz = 0;
    for (const lx of [c.length / 2, -c.length / 2]) for (const ly of [-c.width / 2, c.width / 2]) {
      const ox = lx * ch - ly * sh, oz = lx * sh + ly * ch;
      const hit = T.collide ? T.collide(this.x + ox, this.z + oz, this.x, this.z, loc.h) : null;
      if (hit && hit.pen > deepest) { deepest = hit.pen; cx = ox; cz = oz; nnx = hit.nx; nnz = hit.nz; }
    }
    if (deepest <= 0) return;

    // push out
    this.x += nnx * deepest; this.z += nnz * deepest;

    // impulse at the contact corner, with friction along the wall
    const r = this.yawRate, m = c.mass, I = c.yawInertia;
    const px = this.vx - r * cz, pz = this.vz + r * cx;   // velocity of that corner
    const vn = px * nnx + pz * nnz;
    if (vn >= 0) { T.locate(this.x, this.z, loc.i, loc); return; }
    const cross = (ax, az, bx, bz) => ax * bz - az * bx;
    const kn = 1 / m + cross(cx, cz, nnx, nnz) ** 2 / I;
    const jn = -(1 + WALL_BOUNCE) * vn / kn;
    let tx = px - vn * nnx, tz = pz - vn * nnz;
    const vt = Math.hypot(tx, tz);
    let jt = 0;
    if (vt > 1e-3) {
      tx /= vt; tz /= vt;
      const kt = 1 / m + cross(cx, cz, tx, tz) ** 2 / I;
      jt = -Math.min(vt / kt, WALL_FRICTION * jn);
    }
    const Jx = jn * nnx + jt * tx, Jz = jn * nnz + jt * tz;
    this.vx += Jx / m; this.vz += Jz / m;
    this.yawRate += cross(cx, cz, Jx, Jz) / I;
    this.events.hit = Math.max(this.events.hit, -vn);
    T.locate(this.x, this.z, loc.i, loc);
  }
}

function interp(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return curve[curve.length - 1][1];
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
