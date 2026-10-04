// Car classes. Every number that changes how a car drives lives here.
// To add a class later, copy GT, rename it and change the numbers.
//
// Units: metres, kilograms, seconds, newtons, radians (1 rad = 57 degrees).

export const GT = {
  name: 'GT',

  // --- Body -------------------------------------------------------------
  mass: 1300,          // kg, with driver
  yawInertia: 2300,    // how hard it is to spin the car. Lower = turns in more eagerly, but twitchier.
  wheelbase: 2.65,     // metres between front and rear axles
  frontWeight: 0.46,   // share of the weight on the front axle when stationary
  cgHeight: 0.36,      // centre of gravity height. Higher = more weight transfer under braking/accel.
  length: 4.6,
  width: 2.0,
  height: 1.2,
  trackWidth: 1.7,     // distance between left and right wheels
  wheelRadius: 0.34,

  // --- Tyres ------------------------------------------------------------
  grip: 1.7,           // peak friction. 1.7 means 1.7 g of cornering before downforce.
  frontGrip: 1.0,      // multiplier on front grip. Lower = more understeer.
  rearGrip: 1.06,      // multiplier on rear grip. Lower = more oversteer.
  loadSensitivity: 0.15, // tyres lose a little grip per kilo as load rises. Softens weight-transfer snaps.
  peakSlipFront: 0.10, // slip angle (rad) where the front tyres grip hardest. About 6 degrees.
  peakSlipRear: 0.09,  // same for the rear
  // Grip left when sliding well past the peak. Higher = slides are easier to
  // catch. The front falls away more than the rear so that in a big slide the
  // nose washes wide (safe) instead of the car spinning.
  slideGripFront: 0.7,
  slideGripRear: 0.85,
  wheelspinGrip: 0.85, // forward grip of a spinning or locked tyre, as a share of peak
  slipLateral: 0.35,   // sideways grip of a spinning or locked tyre, as a share of peak

  // --- Aero -------------------------------------------------------------
  dragArea: 1.3,       // drag coefficient x frontal area. Sets top speed (about 270 km/h).
  downforceArea: 2.5,  // lift coefficient x area. More = more grip at high speed.
  aeroBalance: 0.44,   // share of downforce on the front axle
  drsDragCut: 0.12,    // DRS removes this share of drag
  drsDownforceCut: 0.1,
  rollingResistance: 0.013,

  // --- Engine and gearbox -----------------------------------------------
  // [rpm, torque in Nm]. Peak power is about 400 kW (540 hp).
  torqueCurve: [[1000, 330], [3000, 460], [5000, 535], [6500, 560], [7500, 515], [8500, 440], [9000, 300]],
  idleRpm: 1100,
  redline: 8500,
  upshiftRpm: 8250,
  downshiftRpm: 6600,  // drop a gear when the lower gear would be below this rpm
  gears: [3.0, 2.2, 1.75, 1.46, 1.27, 1.13],
  finalDrive: 3.4,
  driveEfficiency: 0.9,
  shiftTime: 0.09,     // seconds of torque cut during a gear change
  engineBraking: 900,  // newtons of drag at the rear wheels off throttle at the redline
  reverseForce: 4000,

  // --- Brakes -----------------------------------------------------------
  brakeForce: 30000,   // total braking force at full pedal, newtons
  brakeBias: 0.72,     // share of braking on the front axle

  // --- Steering ---------------------------------------------------------
  maxLock: 0.42,       // most the front wheels can turn, rad (24 degrees)
  steerRate: 2.5,      // how fast the wheels can turn, rad per second
  // Speed-sensitive steering: at speed, full lock is limited to about the
  // angle that takes the car to its cornering limit. 1 = right on the limit,
  // above 1 lets you overdrive the front tyres into understeer.
  steerLimit: 1.05,
  steerSlack: 0.02,    // extra angle on top (rad), so there is always a bit more to give

  // --- Assists (only when assists are switched on) ----------------------
  tcFloor: 0.25,       // traction control never cuts drive below this share of grip
  escThreshold: 0.06,  // stability control steps in when the car rotates this much faster than its path (rad/s)
  escSlipGain: 2,      // how much the angle of a slide (not just its growth) counts
  escGain: 20000,      // how hard stability control pushes back (Nm per rad/s)
  escMax: 14000,       // the most yaw it can apply (Nm)
};

export const CARS = { GT };
