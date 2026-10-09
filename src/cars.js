// Car classes. Every number that changes how a car drives lives here.
// To add a class later, copy GT, rename it and change the numbers.
//
// Units: metres, kilograms, seconds, newtons, radians (1 rad = 57 degrees).

export const GT = {
  id: 'GT',
  label: 'GT',
  name: 'GT',
  drive: 'rear',       // which axle the engine drives: 'rear' or 'front'
  hasDRS: true,        // the car has a rear wing flap: DRS opens in the zones

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
  draftDrag: 0.25,     // slipstream: share of drag removed at full strength, close behind another car (src/slipstream.js)
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

  // --- Assists (each one only when it is switched on) ----------------------
  tcFloor: 0.25,       // traction control never cuts drive below this share of grip
  escThreshold: 0.06,  // stability control steps in when the car rotates this much faster than its path (rad/s)
  escSlipGain: 2,      // how much the angle of a slide (not just its growth) counts
  escGain: 20000,      // how hard stability control pushes back (Nm per rad/s)
  escMax: 14000,       // the most yaw it can apply (Nm)
};

// Peugeot 108 1.0 VTi 72 (road car), set up as a cup car. Sources, per number:
//   length 3475 mm, height 1460 mm, wheelbase 2340 mm: autotijd.be, 1.0 VTi 72 dimensions (also cars-data.com).
//   width 1615 mm: cars-data.com (body, without mirrors; autotijd gives 1884 mm with mirrors).
//   power 53 kW (72 hp), torque 93 Nm at 4000 rpm: autotijd.be, 1.0 VTi 72 specifications.
//   mass 910 kg with driver: cars-data.com gives 835 kg kerb for a 2018 e-VTi 72 Active, autotijd gives 958 kg unladen for the
//   automatic. 835 plus about 75 kg of driver. ESTIMATE: a cup car is lighter than the road car, so this is a middle figure.
//   five-speed gearbox, ratios, final drive, redline 6500 rpm, torque curve: ESTIMATE (no official figures found), shaped to the
//   power and torque above.
//   tyres 155/65 R14 (about 0.28 m radius): ESTIMATE, a common size for the car. No downforce, no DRS (a city car has no wing).
export const CITY = {
  id: 'CITY',
  label: 'Peugeot 108 Cup',
  name: 'City Cup',
  drive: 'front',
  hasDRS: false,

  // --- Body -------------------------------------------------------------
  mass: 910,           // kg, with driver (see the note above)
  yawInertia: 1100,    // about mass x (length^2 + width^2) / 12
  wheelbase: 2.34,     // 108 autotijd.be
  frontWeight: 0.62,   // ESTIMATE: a front-engined, front-drive hatchback, most of the weight over the front wheels
  cgHeight: 0.42,      // ESTIMATE: tall, narrow car, high centre of gravity
  length: 3.475,       // 108 autotijd.be
  width: 1.615,        // 108 cars-data.com, body without mirrors
  height: 1.46,        // 108 autotijd.be
  trackWidth: 1.4,     // ESTIMATE: a 108 with 14 inch wheels
  wheelRadius: 0.28,   // ESTIMATE: 155/65 R14

  // --- Tyres ------------------------------------------------------------
  // Narrow road tyres: about 1.1 to 1.2 g of grip. ESTIMATE, no tyre test found.
  grip: 1.15,
  frontGrip: 1.0,
  rearGrip: 1.0,
  loadSensitivity: 0.15,
  peakSlipFront: 0.11,
  peakSlipRear: 0.10,
  slideGripFront: 0.7,
  slideGripRear: 0.85,
  wheelspinGrip: 0.85,
  slipLateral: 0.35,

  // --- Aero -------------------------------------------------------------
  dragArea: 0.65,      // ESTIMATE: Cd about 0.33 on a frontal area of about 2 m2. Top speed is set by the gears here.
  downforceArea: 0,    // none
  aeroBalance: 0.5,
  drsDragCut: 0,
  draftDrag: 0.2,      // slipstream: a small, low-drag car gains less
  drsDownforceCut: 0,
  rollingResistance: 0.012,

  // --- Engine and gearbox -----------------------------------------------
  // [rpm, torque in Nm]. Peak power about 53 kW (72 hp) at 6000 rpm, peak torque 93 Nm at 4000 rpm.
  torqueCurve: [[1000, 60], [2500, 84], [4000, 93], [5000, 90], [6000, 84], [6500, 70]],
  idleRpm: 850,
  redline: 6500,
  upshiftRpm: 6200,
  downshiftRpm: 4000,
  gears: [3.55, 1.95, 1.3, 0.97, 0.76],   // ESTIMATE: five-speed gearbox
  finalDrive: 4.06,                       // ESTIMATE
  driveEfficiency: 0.88,
  shiftTime: 0.2,      // a manual gearbox is slower to change than a paddle
  engineBraking: 300,  // a small engine has little drag off throttle
  reverseForce: 2000,

  // --- Brakes -----------------------------------------------------------
  brakeForce: 10000,   // total braking force at full pedal, newtons (about 1.1 g)
  brakeBias: 0.7,

  // --- Steering ---------------------------------------------------------
  maxLock: 0.6,        // ESTIMATE: about 34 degrees at the front wheels
  steerRate: 3.0,
  steerLimit: 1.05,
  steerSlack: 0.02,

  // --- Assists ----------------------------------------------------------
  tcFloor: 0.25,
  escThreshold: 0.06,
  escSlipGain: 2,
  escGain: 9000,       // a lighter car needs less yaw to hold it
  escMax: 6000,
};

// Group GT1, modelled on the Aston Martin DBR9 (2005 to 2008). Sources, per number:
//   length 4687 mm, width 1978 mm, height 1195 mm, wheelbase 2741 mm: en.wikipedia.org/wiki/Aston_Martin_DBR9
//   (supercars.net gives a 4750 mm length, the figure varies by source).
//   mass 1170 kg race weight (Wikipedia, supercars.net), minimum 1100 kg. 1200 kg with driver is used.
//   power 466 kW (625 bhp with restrictors), 746 Nm: en.wikipedia.org/wiki/Aston_Martin_DBR9. The torque curve is ESTIMATE.
//   six-speed sequential gearbox (Xtrac): Wikipedia. Ratios, final drive, tyre radius: ESTIMATE.
//   grip 1.75 g, large downforce, top speed about 290 km/h: ESTIMATE for a GT1 with slicks.
export const GT1 = {
  id: 'GT1',
  label: 'GT1',
  name: 'GT1',
  drive: 'rear',
  hasDRS: true,

  // --- Body -------------------------------------------------------------
  mass: 1200,          // kg, with driver
  yawInertia: 2600,    // about mass x (length^2 + width^2) / 12, a bit under the GT's
  wheelbase: 2.741,    // DBR9 Wikipedia
  frontWeight: 0.5,    // ESTIMATE: a front engined car with the weight about even
  cgHeight: 0.33,      // ESTIMATE: a low race car
  length: 4.687,       // DBR9 Wikipedia
  width: 1.978,        // DBR9 Wikipedia
  height: 1.195,       // DBR9 Wikipedia
  trackWidth: 1.63,    // ESTIMATE
  wheelRadius: 0.34,   // ESTIMATE: race slick, the GT's size

  // --- Tyres ------------------------------------------------------------
  grip: 1.75,          // ESTIMATE: race slicks with the downforce below
  frontGrip: 1.0,
  rearGrip: 1.06,
  loadSensitivity: 0.15,
  peakSlipFront: 0.10,
  peakSlipRear: 0.09,
  slideGripFront: 0.7,
  slideGripRear: 0.85,
  wheelspinGrip: 0.85,
  slipLateral: 0.35,

  // --- Aero -------------------------------------------------------------
  dragArea: 0.95,      // ESTIMATE: GT1 wing set, top speed about 300 km/h
  downforceArea: 3.6,  // ESTIMATE: big downforce, a little over the GT's 2.5
  aeroBalance: 0.42,
  drsDragCut: 0.12,
  draftDrag: 0.28,     // slipstream: the big wing set leaves a bigger hole in the air
  drsDownforceCut: 0.1,
  rollingResistance: 0.013,

  // --- Engine and gearbox -----------------------------------------------
  // [rpm, torque in Nm]. Peak power about 466 kW at 6500 rpm, peak torque 746 Nm (curve ESTIMATE, peaks at 5000 rpm).
  torqueCurve: [[1000, 420], [3000, 620], [5000, 720], [6000, 700], [6500, 684], [6800, 620]],
  idleRpm: 1100,
  redline: 6800,
  upshiftRpm: 6600,
  downshiftRpm: 5000,
  gears: [2.75, 2.0, 1.55, 1.27, 1.08, 0.94],   // ESTIMATE
  finalDrive: 3.1,                              // ESTIMATE
  driveEfficiency: 0.9,
  shiftTime: 0.06,     // sequential gearbox
  engineBraking: 1200,
  reverseForce: 4000,

  // --- Brakes -----------------------------------------------------------
  brakeForce: 28000,   // about 2.4 g at 1200 kg, with the downforce
  brakeBias: 0.66,

  // --- Steering ---------------------------------------------------------
  maxLock: 0.42,
  steerRate: 2.5,
  steerLimit: 1.05,
  steerSlack: 0.02,

  // --- Assists ----------------------------------------------------------
  tcFloor: 0.25,
  escThreshold: 0.06,
  escSlipGain: 2,
  escGain: 20000,
  escMax: 14000,
};

export const CARS = { GT, GT1, CITY };
export const CAR_LIST = [GT, GT1, CITY];
export const CAR_IDS = CAR_LIST.map(c => c.id);
// The class with this id. An unknown or missing id is the GT, the car everyone had before there were classes.
export const carById = id => CARS[id] || GT;
