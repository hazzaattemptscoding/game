// Ground the venue dressing leaves free for the parked service vehicles (src/serviceVehiclePlan.js on its own branch places them).
// No imports, numbers only, so src/track.js (the fill clusters) and the stand and extras planners can all use it.
//   VEHICLE_BAYS   the spots the vehicle plan picks on a bare venue: s along the lap, d across it (negative is the left, the pit side),
//                  r the half diagonal of the vehicle. Nothing new goes within BAY_CLEAR metres of one.
//   VEHICLE_ZONES  stretches kept free of new buildings: the pit exit side on the left (the safety car, medical car, sweeper,
//                  ambulance and fire engine stand there) and the paddock behind the garage fronts (the transporters and buggies).
//                  from and to are metres out from the pit lane's outer edge (pitOut) or the left wall, whichever is further.
// vehicleBlockers(T, zones) gives them as circles { x, z, r, name } for the planners, which add their own margin (4 m for a stand,
// 2 m for a small thing) on top: r is grown so the clear distance is BAY_CLEAR or more either way.

export const BAY_CLEAR = 6;
export const VEHICLE_BAYS = [
  { type: 'safety', s: 335, d: -37.3, r: 2.7 },
  { type: 'medical', s: 405, d: -32.3, r: 2.8 },
  { type: 'sweeper', s: 365, d: -34.6, r: 3.4 },
  { type: 'ambulance', s: 470, d: -38.0, r: 3.5 },
  { type: 'fire', s: 520, d: -48.0, r: 4.4 },
  { type: 'ambulance', s: 181, d: 42.8, r: 3.5 },
  { type: 'fire', s: 2842, d: -38.0, r: 4.4 },
  { type: 'recovery', s: 958, d: -60.3, r: 4.2 },
  { type: 'recovery', s: 1968, d: -41.0, r: 4.2 },
  { type: 'recovery', s: 3184, d: 70.6, r: 4.2 },
  { type: 'sweeper', s: 3420, d: -17.6, r: 3.4 },
  { type: 'buggy', s: 3700, d: -53.4, r: 1.7 },
  { type: 'buggy', s: 45, d: -53.5, r: 1.7 },
  { type: 'transport', s: 3770, d: -57.5, r: 6.9 },
  { type: 'transport', s: 3800, d: -57.5, r: 6.9 },
  { type: 'transport', s: 3830, d: -57.4, r: 6.9 },
];
export const VEHICLE_ZONES = [
  { name: 'pit exit side', s0: 335, s1: 520, from: 4, to: 66 },
  { name: 'paddock', s0: 3700, s1: 3835 + 45, from: 12, to: 60 },
];
const ZONE_R = 6;   // the circles the zones are made of, every 6 m along and 12 m across

const at = (T, s, d) => {
  const i = ((Math.round(s / T.ds) % T.N) + T.N) % T.N;
  return { i, x: T.x[i] + T.nx[i] * d, z: T.z[i] + T.nz[i] * d };
};
// the left edge the zones are measured from: the pit lane's outer edge where there is one, else the left wall
const leftBase = (T, i) => Math.max(T.wall[0][i], T.pitOut[i] > 0 ? T.pitOut[i] : 0);

export function vehicleBlockers(T, zones = true) {
  const out = VEHICLE_BAYS.map(b => { const p = at(T, b.s, b.d); return { x: p.x, z: p.z, r: b.r + BAY_CLEAR - 2, name: 'vehicle bay (' + b.type + ')' }; });
  if (zones) for (const zn of VEHICLE_ZONES) for (let s = zn.s0; s <= zn.s1; s += 6) {
    const i = at(T, s, 0).i, base = leftBase(T, i);
    for (let d = zn.from + ZONE_R; d <= zn.to; d += 2 * ZONE_R) { const p = at(T, s, -(base + d)); out.push({ x: p.x, z: p.z, r: ZONE_R, name: zn.name + ' (kept for the vehicles)', zone: zn.name }); }
  }
  return out;
}

// distance from (x, z) to the nearest vehicle bay's rectangle, roughly (the circle round it), for the checks
export function bayDistance(T, x, z) {
  let best = Infinity;
  for (const b of VEHICLE_BAYS) { const p = at(T, b.s, b.d); best = Math.min(best, Math.hypot(x - p.x, z - p.z) - b.r); }
  return best;
}
