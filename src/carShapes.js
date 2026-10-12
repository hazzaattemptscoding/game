// The body of the two classes that are not the GT (src/cars.js ids GT1 and CITY), as lofted surfaces (src/carLoft.js):
// a body with its wheel arches, a greenhouse sitting on it and the glass lying on the greenhouse. Each shape returns the same
// fields as the GT's (see bodySpec in src/car.js) and, in `loft`, the three skins; the extras are in the notes below.
//   dx       how far the whole body is moved along the car to put its overhangs where the real car has them
//   tyreW    tyre width
//   liners   a dark liner behind each wheel closing the arch
//   glass    the glass material
//   dark     boxes in the dark trim colour, or in the body colour with `paint`; { p, s, rz, ry }
// Everything is in the body's own axes, before dx moves it.

import { curve, stations, bodyRing, cabRing, loft, patch, merge, ringPoint, CAB } from './carLoft.js';

const lerp = (a, b, t) => a + (b - a) * t;
const pair = (p, s, rz = 0, ry = 0) => [{ p, s, rz, ry }, { p: [p[0], p[1], -p[2]], s, rz, ry: -ry }];

// The wheel arch: the height of its roof at x, or -Infinity outside it.
const archTop = (x, a) => { const d = x - a.x; return Math.abs(d) < a.R ? a.cy + Math.sqrt(a.R * a.R - d * d) : -Infinity; };

// How densely a skin is sampled along the car: the even step, the length of the finer run at each end and its step, in metres.
// HIGH is the car as drawn up close; LOW is the same shape for a remote car further than a few tens of metres away (src/car.js).
const HIGH = { step: 0.05, fine: 0.12, fineStep: 0.02 }, LOW = { step: 0.1, fine: 0.1, fineStep: 0.05 };

// Build the three skins from a hull definition.
export function buildHull(h, q = HIGH) {
  const { F } = h;
  const body = loft(stations(-F, F, q.step, q.fine, q.fineStep, q === HIGH ? h.arches.flatMap(a => [a.x - a.R, a.x + a.R]) : []), x => {
    const ys = h.ys(x);
    let y0 = h.yb(x);
    for (const a of h.arches) y0 = Math.max(y0, archTop(x, a));
    return bodyRing({ y0, ys, yc: ys + h.crown(x), w: h.w(x), rt: h.rt, rb: h.rb, z0: h.z0 });
  });
  const c = h.cab;
  const cabAt = x => {
    const yB = c.yB(x);
    return cabRing({ yB, yR: Math.max(c.roof(x), yB + 0.012), wb: c.wb(x), wr: c.wr(x), crown: c.crown });
  };
  const cab = loft(stations(c.x0, c.x1, q.step, Math.min(q.fine, 0.1), q.fineStep), cabAt);
  const inside = [0, 0.7, 0], lift = 0.004, n = 2 * (CAB.SIDE + 1 + CAB.CORNER) + CAB.ROOF - 1;
  const parts = [];
  const point = (x, j, flip) => { const ring = cabAt(x), [z, y] = ringPoint(ring, flip ? n - 1 - j : j, lift); return [x, y, z]; };
  for (const w of h.windows) {
    if (w.side) {
      for (const flip of [false, true]) {
        parts.push(patch(q === HIGH ? 18 : 8, q === HIGH ? 6 : 3, (u, v) => {
          const j = lerp(w.j0, w.j1, v), xf = lerp(w.front[0], w.front[1], v), xr = lerp(w.rear[0], w.rear[1], v);
          return point(lerp(xf, xr, u), j, flip);
        }, inside));
      }
    } else {
      parts.push(patch(q === HIGH ? 18 : 8, q === HIGH ? 6 : 3, (u, v) => point(lerp(w.x0, w.x1, u), lerp(w.j0, w.j1, v), false), inside));
    }
  }
  return { body, cab, glass: merge(parts) };
}

// The skins of a shape with a `hull` definition, as the properties `loft` (close up) and `loftLow` (far away). They are built when first
// asked for and rebuilt after freeLoft(): a shape that is only read for its numbers (src/carFx.js, the garage camera) never builds them,
// and CarView shares one set between all the cars of a class and frees it when the last of them goes (src/car.js).
function withLofts(spec) {
  let hi = null, lo = null;
  Object.defineProperties(spec, {
    loft: { get() { return hi ||= buildHull(spec.hull, HIGH); }, enumerable: true },
    loftLow: { get() { return lo ||= buildHull(spec.hull, LOW); }, enumerable: true },
    freeLoft: { value() { for (const set of [hi, lo]) if (set) for (const g of Object.values(set)) g.dispose(); hi = lo = null; } },
  });
  return spec;
}

// The liners: a dark panel on each side of each wheel, from the road up to the arch roof.
const liners = (c, arches, track, tyreW) => arches.flatMap(a => [1, -1].map(s => ({ x: a.x, y: c.wheelRadius, z: s * (track / 2 - tyreW / 2 - 0.012), R: a.R + 0.02, floor: a.floor })));

// CITY: a Peugeot 108 three-door hatchback.
export const cityShape = c => withLofts(cityShapeRaw(c));
function cityShapeRaw(c) {
  const L = c.length, F = L / 2, wb = c.wheelbase, r = c.wheelRadius;
  const fx = F - 0.2014 * L, rx = fx - wb;                         // the axles in the hull's own axes: 700 mm of nose, 435 mm of tail
  const dx = c.wheelbase * (1 - c.frontWeight) - fx;
  const half = c.width / 2, R = r + 0.055;
  const arches = [{ x: fx, cy: r, R, floor: 0.2 }, { x: rx, cy: r, R, floor: 0.2 }];
  const ys = curve([[-F, 0.84], [-1.72, 0.885], [-1.66, 0.91], [-1.5, 0.93], [-1.0, 0.935], [-0.3, 0.92], [0.4, 0.905], [1.1, 0.885], [1.3, 0.86], [1.5, 0.82], [1.64, 0.785], [1.70, 0.755], [1.725, 0.72], [F, 0.70]]);
  const yb = curve([[-F, 0.36], [-1.72, 0.30], [-1.65, 0.235], [-1.5, 0.205], [-1.3, 0.2], [1.3, 0.2], [1.5, 0.205], [1.65, 0.235], [1.72, 0.30], [F, 0.36]]);
  const w = curve([[-F, 0.64], [-1.72, 0.70], [-1.6, 0.76], [-1.45, 0.795], [-1.25, half], [1.2, half], [1.45, 0.795], [1.62, 0.76], [1.70, 0.70], [F, 0.62]]);
  const crown = curve([[-F, 0], [-1.6, 0.01], [-1.2, 0.03], [1.2, 0.04], [1.55, 0.03], [F, 0]]);
  const roof = curve([[-1.70, 0.93], [-1.68, 0.98], [-1.64, 1.06], [-1.57, 1.16], [-1.46, 1.24], [-1.25, 1.31], [-0.95, 1.375], [-0.6, 1.425], [-0.25, 1.455], [-0.05, 1.46], [0.15, 1.44], [0.4, 1.36], [0.65, 1.22], [0.9, 1.05], [1.06, 0.92], [1.10, 0.90]]);
  const cab = {
    x0: -1.70, x1: 1.10, roof, crown: 0.025,
    yB: x => ys(x) - 0.04,
    wb: curve([[-1.70, 0.58], [-1.55, 0.64], [-1.2, 0.68], [-0.5, 0.70], [0.3, 0.71], [0.9, 0.69], [1.10, 0.65]]),
    wr: curve([[-1.70, 0.40], [-1.55, 0.43], [-1.2, 0.46], [-0.5, 0.47], [0.3, 0.46], [0.9, 0.44], [1.10, 0.42]]),
  };
  const windows = [
    { side: true, j0: 0.4, j1: 8, front: [0.88, 0.50], rear: [-0.36, -0.36] },       // the door
    { side: true, j0: 0.4, j1: 8, front: [-0.56, -0.56], rear: [-1.38, -1.24] },      // the quarter
    { x0: 1.04, x1: 0.30, j0: 12.6, j1: 23.4 },                                       // the windscreen
    { x0: -1.46, x1: -1.69, j0: 12.8, j1: 23.2 },                                        // the tailgate
  ];
  const hullDef = { F, ys, yb, w, crown, arches, rt: 0.10, rb: 0.05, z0: 0.25, cab, windows };
  const yc = x => ys(x) + crown(x);
  // the bonnet curve for the number plate, from the two ends and the middle
  const P = x => [x, yc(x)], p0 = P(1.55), p2 = P(1.2), pm = P(1.38), p1 = [2 * pm[0] - (p0[0] + p2[0]) / 2, 2 * pm[1] - (p0[1] + p2[1]) / 2];
  const roofPts = [];
  for (let x = 1.10; x >= -1.70; x -= 0.04) roofPts.push([x, roof(x)]);
  roofPts.push([-1.70, roof(-1.70)]);
  const bonnetPts = [[F, 0.40], [F, 0.58]];
  for (let x = F - 0.01; x >= 1.11; x -= 0.04) bonnetPts.push([x, yc(x)]);
  const tailPts = [[-1.70, roof(-1.70)], [-1.72, ys(-1.72) + crown(-1.72)], [-1.7375 + 0.004, ys(-F + 0.01)], [-F, ys(-F) - 0.04], [-F, 0.45]];
  return {
    half, dx, tyreW: 0.165, hull: hullDef, liners: liners(c, arches, c.trackWidth, 0.165),
    rim: { color: 0xc9cdd1, roughness: 0.35, metalness: 0.6 }, spokes: 8, spokeW: 0.13, caliper: 0x55595e,
    glass: { color: 0x4a5c72, roughness: 0.16, metalness: 0.1, emissive: 0x0a1018 },
    stripes: [{ pts: bonnetPts, off: 0.0 }, { pts: roofPts, off: 0.0 }, { pts: tailPts, off: 0.0 }],
    side: { x: -0.2, y: 0.7, w: 1.5 },
    plate: { c0: p0, c1: p1, c2: p2, size: 0.3, off: 0.016 },
    wing: null,
    dark: [
      { p: [F - 0.01, 0.46, 0], s: [0.06, 0.15, 1.05] },              // the lower grille
      { p: [F - 0.01, 0.62, 0], s: [0.06, 0.07, 0.5] },               // the upper grille
      { p: [-1.45, 1.285, 0], s: [0.16, 0.03, 0.62], rz: 0.3 },        // the roof spoiler
      { p: [-F + 0.02, 0.36, 0], s: [0.06, 0.1, 1.0] },              // the rear bumper trim
    ],
    tails: pair([-F + 0.005, 0.80, 0.57], [0.06, 0.30, 0.15], 0, 0.3),
    heads: [
      { p: [F - 0.005, 0.6, 0.47], s: [0.07, 0.14, 0.4], rz: 0, ry: -0.22, disc: true },
      { p: [F - 0.005, 0.6, -0.47], s: [0.07, 0.14, 0.4], rz: 0, ry: 0.22, disc: true },
      ...pair([F - 0.015, 0.47, 0.56], [0.045, 0.04, 0.26], 0.6, -0.5),
    ],
  };
}

// GT1: a Group GT1 racer after the Aston Martin DBR9. A long low nose between front fenders that stand clear of the bonnet, a
// narrow cabin set back, and swollen rear haunches: the body's skin is one surface, with the shoulder rising from the low front
// fenders over the doors to the full-width rear haunches. Splitter, diffuser and a big wing on two uprights (with the DRS flap).
export const gt1Shape = c => withLofts(gt1ShapeRaw(c));
function gt1ShapeRaw(c) {
  const L = c.length, F = L / 2, W = c.width, r = c.wheelRadius, tyreW = 0.28;
  const fx = c.wheelbase * (1 - c.frontWeight), rx = fx - c.wheelbase;
  const R = r + 0.065, half = 0.93;
  const arches = [{ x: fx, cy: r, R, floor: 0.13 }, { x: rx, cy: r, R, floor: 0.13 }];
  const ys = curve([[-F, 0.80], [-2.30, 0.86], [-2.15, 0.93], [-1.9, 0.98], [-1.45, 0.995], [-1.0, 0.96], [-0.4, 0.91], [0.3, 0.885], [0.9, 0.875], [1.37, 0.865], [1.8, 0.80], [2.0, 0.68], [2.2, 0.54], [F, 0.47]]);
  const yb = curve([[-F, 0.30], [-2.25, 0.22], [-2.0, 0.15], [-1.8, 0.13], [1.8, 0.13], [2.1, 0.15], [2.28, 0.2], [F, 0.26]]);
  const w = curve([[-F, 0.80], [-2.25, 0.92], [-2.0, 0.985], [-1.75, W / 2], [-1.0, W / 2], [-0.75, 0.945], [-0.65, half], [0.65, half], [0.9, 0.955], [1.2, 0.972], [1.37, 0.975], [1.8, 0.96], [2.1, 0.90], [2.28, 0.82], [F, 0.74]]);
  const crown = curve([[-F, -0.03], [-2.0, -0.05], [-1.45, -0.07], [-0.8, -0.02], [0, 0], [0.6, -0.06], [1.0, -0.12], [1.37, -0.15], [1.8, -0.09], [2.1, -0.03], [F, 0]]);
  const roof = curve([[-1.75, 0.93], [-1.72, 0.97], [-1.65, 1.04], [-1.5, 1.10], [-1.2, 1.15], [-0.7, 1.19], [-0.3, 1.195], [0.0, 1.18], [0.25, 1.12], [0.5, 1.0], [0.7, 0.9], [0.77, 0.86]]);
  const cab = {
    x0: -1.75, x1: 0.77, roof, crown: 0.02,
    yB: x => ys(x) - 0.06,
    wb: curve([[-1.75, 0.62], [-1.4, 0.72], [-0.8, 0.76], [0, 0.77], [0.77, 0.76]]),
    wr: curve([[-1.75, 0.38], [-1.4, 0.46], [-0.8, 0.50], [0, 0.50], [0.77, 0.52]]),
  };
  const windows = [
    { side: true, j0: 0.4, j1: 8, front: [0.55, 0.22], rear: [-1.35, -1.05] },
    { x0: 0.72, x1: 0.08, j0: 12.6, j1: 23.4 },
    { x0: -1.38, x1: -1.72, j0: 12.8, j1: 23.2 },
  ];
  const hullDef = { F, ys, yb, w, crown, arches, rt: 0.09, rb: 0.04, z0: 0.45, cab, windows };
  const yc = x => ys(x) + crown(x);
  const P = x => [x, yc(x)], p0 = P(1.7), p2 = P(1.05), pm = P(1.35), p1 = [2 * pm[0] - (p0[0] + p2[0]) / 2, 2 * pm[1] - (p0[1] + p2[1]) / 2];
  const roofPts = [];
  for (let x = 0.77; x >= -1.75; x -= 0.04) roofPts.push([x, roof(x)]);
  roofPts.push([-1.75, roof(-1.75)]);
  const bonnetPts = [[F, 0.32], [F, 0.44]];
  for (let x = F - 0.01; x >= 0.78; x -= 0.04) bonnetPts.push([x, yc(x)]);
  const tailPts = [];
  for (let x = -1.75; x >= -F + 0.02; x -= 0.04) tailPts.push([x, yc(x)]);
  tailPts.push([-F, yc(-F)], [-F, 0.5]);
  const wx = -F + 0.35;
  return {
    half, dx: 0, tyreW, hull: hullDef, liners: liners(c, arches, c.trackWidth, tyreW),
    rim: { color: 0xb8bcc0, roughness: 0.3, metalness: 0.8, nut: 0x1d4e9e }, spokes: 6, spokeW: 0.16, caliper: 0xc8102e,
    glass: { color: 0x4a5c72, roughness: 0.16, metalness: 0.1, emissive: 0x0a1018 },
    stripes: [{ pts: bonnetPts, off: 0 }, { pts: roofPts, off: 0 }, { pts: tailPts, off: 0 }],
    side: { x: 0, y: 0.52, w: 1.4 },
    plate: { c0: p0, c1: p1, c2: p2, size: 0.3, off: 0.016 },
    wing: { x: wx, y: 1.12, main: 0.3, flap: 0.3, span: W - 0.2, post: { x: wx + 0.2, y: 0.99, z: 0.6, h: 0.3 }, plate: { len: 0.7, h: 0.22 } },
    dark: [
      { p: [F - 0.15, 0.14, 0], s: [0.5, 0.03, W - 0.2] },                     // the splitter
      { p: [-F + 0.45, 0.24, 0], s: [0.9, 0.03, 1.3], rz: -0.22 },              // the diffuser
      ...[-0.6, -0.2, 0.2, 0.6].map(z => ({ p: [-F + 0.45, 0.3, z], s: [0.9, 0.14, 0.015], rz: -0.22 })),
      { p: [F - 0.005, 0.37, 0], s: [0.05, 0.14, 0.9] },                         // the nose opening
      ...pair([0.45, 0.93, 0.85], [0.12, 0.06, 0.15], 0, 0).map(d => ({ ...d, paint: true })),
    ],
    tails: pair([-F + 0.005, 0.68, 0.58], [0.05, 0.07, 0.42]),
    heads: pair([F - 0.01, 0.4, 0.52], [0.06, 0.09, 0.4], 0, -0.25).map(h => ({ ...h, disc: true })),
  };
}

// GT: a GT4 coupe, front engined, on the proportions of the AMG GT4 (4.6 m long, 2.0 m wide, 2.65 m wheelbase, like the class's
// numbers in src/cars.js). A long bonnet between front fenders that stand a little proud of it, the cabin set well back, a fastback
// running down to a short ducktail, the rear haunches the widest part of the car. Race parts: a splitter, canards, bonnet vents, side
// skirts, a diffuser with fins, and a wing on swan-neck mounts (with the DRS flap).
export const gt4Shape = c => withLofts(gt4ShapeRaw(c));
function gt4ShapeRaw(c) {
  const L = c.length, F = L / 2, W = c.width, r = c.wheelRadius, tyreW = 0.265;
  const fx = c.wheelbase * (1 - c.frontWeight), rx = fx - c.wheelbase;
  const R = r + 0.06, half = 0.945;
  const arches = [{ x: fx, cy: r, R, floor: 0.13 }, { x: rx, cy: r, R, floor: 0.13 }];
  const ys = curve([[-F, 0.86], [-2.2, 0.93], [-2.0, 0.965], [-1.6, 0.975], [-1.2, 0.965], [-0.8, 0.93], [-0.3, 0.88], [0.3, 0.85], [0.9, 0.83], [fx, 0.805], [1.8, 0.75], [2.05, 0.665], [2.2, 0.57], [F, 0.47]]);
  const yb = curve([[-F, 0.32], [-2.18, 0.24], [-2.0, 0.15], [-1.8, 0.12], [1.85, 0.12], [2.1, 0.13], [2.25, 0.16], [F, 0.22]]);
  const w = curve([[-F, 0.86], [-2.22, 0.93], [-2.05, 0.98], [-1.75, W / 2], [-1.0, W / 2], [-0.8, 0.952], [-0.72, half], [0.72, half], [0.95, 0.965], [fx, 0.986], [1.85, 0.975], [2.1, 0.93], [2.25, 0.86], [F, 0.8]]);
  const crown = curve([[-F, 0.0], [-2.1, 0.02], [-1.6, 0.03], [-1.0, 0.02], [-0.3, 0.02], [0.4, 0.045], [1.0, 0.03], [fx, 0.0], [1.9, -0.012], [F, 0.0]]);
  const roof = curve([[-1.9, 0.99], [-1.75, 1.03], [-1.5, 1.09], [-1.2, 1.15], [-0.9, 1.19], [-0.6, 1.215], [-0.35, 1.225], [-0.15, 1.215], [0.02, 1.18], [0.18, 1.1], [0.32, 1.0], [0.42, 0.92]]);
  const cab = {
    x0: -1.9, x1: 0.42, roof, crown: 0.02,
    yB: x => ys(x) - 0.04,
    wb: curve([[-1.9, 0.6], [-1.6, 0.72], [-1.1, 0.8], [-0.5, 0.8], [0.1, 0.79], [0.42, 0.74]]),
    wr: curve([[-1.9, 0.42], [-1.6, 0.48], [-1.1, 0.53], [-0.5, 0.54], [0.1, 0.52], [0.42, 0.5]]),
  };
  const windows = [
    { side: true, j0: 0.4, j1: 8, front: [0.36, 0.0], rear: [-1.32, -1.0] },         // the side glass, to the slope of the fastback
    { x0: 0.4, x1: -0.02, j0: 12.6, j1: 23.4 },                                     // the windscreen
    { x0: -0.78, x1: -1.86, j0: 12.8, j1: 23.2 },                                    // the fastback glass
  ];
  const hullDef = { F, ys, yb, w, crown, arches, rt: 0.15, rb: 0.07, z0: 0.35, cab, windows };
  const yc = x => ys(x) + crown(x);
  const P = x => [x, yc(x)], p0 = P(1.9), p2 = P(1.2), pm = P(1.55), p1 = [2 * pm[0] - (p0[0] + p2[0]) / 2, 2 * pm[1] - (p0[1] + p2[1]) / 2];
  const roofPts = [];
  for (let x = 0.42; x >= -1.9; x -= 0.04) roofPts.push([x, roof(x)]);
  roofPts.push([-1.9, roof(-1.9)]);
  const bonnetPts = [[F, 0.34], [F, 0.46]];
  for (let x = F - 0.01; x >= 0.43; x -= 0.04) bonnetPts.push([x, yc(x)]);
  const tailPts = [];
  for (let x = -1.9; x >= -F + 0.02; x -= 0.04) tailPts.push([x, yc(x)]);
  tailPts.push([-F, yc(-F)], [-F, 0.5]);
  const wx = -F + 0.32, deck = yc(wx + 0.12), wy = 1.15;
  const slope = x => Math.atan2(yc(x + 0.05) - yc(x - 0.05), 0.1);   // the bonnet's slope at x, for the vents lying on it
  return {
    half, dx: 0, tyreW, hull: hullDef, liners: liners(c, arches, c.trackWidth, tyreW),
    rim: { color: 0x2b2e33, roughness: 0.32, metalness: 0.7, nut: 0xc8102e }, spokes: 10, spokeW: 0.09, caliper: 0xf2c200,
    glass: { color: 0x3d4c5f, roughness: 0.08, metalness: 0.1, emissive: 0x070b10 },
    stripes: [{ pts: bonnetPts, off: 0 }, { pts: roofPts, off: 0 }, { pts: tailPts, off: 0 }],
    side: { x: 0, y: 0.5, w: 1.4 },
    plate: { c0: p0, c1: p1, c2: p2, size: 0.3, off: 0.016 },
    wing: { x: wx, y: wy, main: 0.26, flap: 0.2, span: W - 0.3, post: { x: wx + 0.12, y: (deck + wy) / 2, z: 0.42, h: wy - deck }, plate: { len: 0.55, h: 0.16 } },
    dark: [
      { p: [F - 0.12, 0.12, 0], s: [0.42, 0.025, W - 0.14] },                                // the splitter
      { p: [F - 0.035, 0.35, 0], s: [0.06, 0.17, 0.86] },                                    // the grille, set into the nose
      ...pair([F - 0.05, 0.24, 0.62], [0.06, 0.12, 0.3]),                                     // the corner intakes
      ...pair([F - 0.2, 0.42, 0.9], [0.24, 0.015, 0.13], 0.12),                               // the canards
      ...pair([1.62, yc(1.62) + 0.004, 0.32], [0.34, 0.012, 0.2], slope(1.62)),             // the bonnet vents
      ...pair([0.1, 0.15, 0.952], [2.1, 0.07, 0.03]),                                          // the side skirts
      { p: [-F + 0.34, 0.21, 0], s: [0.64, 0.025, 1.3], rz: -0.18 },                          // the diffuser
      ...[-0.55, -0.18, 0.18, 0.55].map(z => ({ p: [-F + 0.34, 0.27, z], s: [0.64, 0.12, 0.015], rz: -0.18 })),
      { p: [-F + 0.015, 0.36, 0], s: [0.05, 0.13, 1.36] },                                    // the rear valance
      { p: [-F + 0.012, 0.72, 0], s: [0.04, 0.05, 0.62] },                                    // the black band between the tail lamps
      ...pair([-F + 0.01, 0.31, 0.3], [0.08, 0.075, 0.075]).map(d => ({ ...d, disc: true })),  // the exhausts
      ...pair([0.3, 0.97, 0.88], [0.14, 0.07, 0.13]).map(d => ({ ...d, paint: true })),       // the mirrors
    ],
    tails: [...pair([-F + 0.01, 0.72, 0.56], [0.05, 0.07, 0.5], 0, 0.28), { p: [-F + 0.03, 0.22, 0], s: [0.04, 0.06, 0.12] }],   // the lamps and the rain light
    heads: pair([F - 0.14, 0.585, 0.66], [0.07, 0.1, 0.44], 0.32, -0.58).map(h => ({ ...h, disc: true })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Open wheel cars (the F4 and the F1): no body round the wheels. A narrow nose into the monocoque, sidepods either side of the
// cockpit narrowing to the gearbox (one lofted skin: the deck falls from the tub to the sidepods' tops), an engine cover with the
// airbox over the driver's head (the second skin), the cockpit opening (the third, in the glass material: a dark gloss), a helmet,
// the halo, a front wing of several elements, a rear wing (with the DRS flap on the F1), the floor and diffuser, the suspension
// arms out to the wheels, mirrors and a rain light. The numbers for each car are in P below; everything else follows from them.

// A thin bar from a to b ([x, y, z]), as a dark part: a box turned to lie along the line.
function rod(a, b, t = 0.028, h = 0.014) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], hz = Math.hypot(dx, dz), len = Math.hypot(hz, dy);
  return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], s: [len, h, t], ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, hz) };
}
const mirrorZ = parts => parts.flatMap(d => [d, { ...d, p: [d.p[0], d.p[1], -d.p[2]], ry: d.ry ? -d.ry : 0, rz: d.rz || 0 }]);

function openSkins(P, q) {
  const fine = q === HIGH ? 0.04 : 0.09;
  const deck = x => P.ys(x) + P.crown(x);
  const body = loft(stations(P.tail, P.nose, fine, 0.1, q === HIGH ? 0.02 : 0.05), x => bodyRing({ y0: P.yb(x), ys: P.ys(x), yc: deck(x), w: P.w(x), rt: P.rt, rb: P.rb, z0: P.z0 }));
  const c = P.cover;
  const cab = loft(stations(c.x0, c.x1, fine, 0.06, q === HIGH ? 0.015 : 0.04), x => {
    const yB = deck(x) - 0.04;
    return cabRing({ yB, yR: Math.max(c.roof(x), yB + 0.012), wb: c.wb(x), wr: c.wr(x), crown: 0.01 });
  });
  // the cockpit opening: an oval lying on the flat top of the tub
  const k = P.cockpit, n = q === HIGH ? 16 : 8;
  const glass = patch(n, 6, (u, v) => {
    const x = k.x1 + (k.x0 - k.x1) * u, t = (x - (k.x0 + k.x1) / 2) / ((k.x0 - k.x1) / 2), half = k.half * Math.sqrt(Math.max(0, 1 - t * t));
    return [x, deck(x) + 0.004, (v * 2 - 1) * half];
  }, [k.x0 / 2 + k.x1 / 2, 0, 0]);
  return { body, cab, glass };
}

function openShape(c, P) {
  const F = c.length / 2, W = c.width, r = c.wheelRadius, fx = c.wheelbase * (1 - c.frontWeight), rx = fx - c.wheelbase, T = c.trackWidth / 2;
  const deck = x => P.ys(x) + P.crown(x);
  const k = P.cockpit, hx = k.x1 + (k.x0 - k.x1) * 0.25;      // the helmet towards the back of the cockpit
  const hy = deck(hx) + P.helmetR * 0.75;
  // the halo: a hoop round the driver's head from mounts behind the cockpit, and a pillar down to the tub in front of it
  const top = hy + P.helmetR * 0.55, hoop = [], hz = k.half + 0.04;
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + Math.PI * i / 12, s = Math.sin(a), cz = Math.cos(a);
    hoop.push([hx + (k.x0 - hx) * 0.55 * cz + 0.08 * (1 - cz), top - 0.02 * (1 - cz), hz * s]);
  }
  const rear = z => [k.x1 - 0.04, deck(k.x1) + 0.02, z];
  const halo = [{ pts: [rear(-hz), [k.x1 + 0.04, top - 0.08, -hz], ...hoop, [k.x1 + 0.04, top - 0.08, hz], rear(hz)], r: 0.024 },
    { pts: [[k.x0 + 0.08, deck(k.x0 + 0.08) + 0.01, 0], [k.x0, (deck(k.x0) + top) / 2 + 0.02, 0], hoop[6]], r: 0.03 }];
  // suspension: upper and lower wishbones (two legs each) and a push rod at each corner, from the tub to the upright inside the rim
  const arms = [];
  for (const [ax, tw, inner] of [[fx, P.tyreW, P.armsF], [rx, P.tyreWR, P.armsR]]) {
    const out = T - tw * 0.32;
    for (const [yIn, yOut, spread] of [[inner.up, r + 0.13, inner.spread], [inner.low, r - 0.12, inner.spread * 1.2]]) {
      arms.push(rod([ax + spread, yIn, inner.z], [ax, yOut, out]), rod([ax - spread, yIn, inner.z], [ax, yOut, out]));
    }
    arms.push(rod([ax - 0.06, inner.up - 0.04, inner.z], [ax, r - 0.08, out - 0.02], 0.022, 0.022));
  }
  const fw = P.frontWing, rw = P.rearWing;
  const dark = [
    // front wing: the main plane across the car, flaps stepping up behind it (body coloured), the end plates and the nose pylons
    { p: [fw.x, fw.y, 0], s: [fw.chord, 0.022, W - 0.06] },
    ...pair([fw.x - fw.chord * 0.42, fw.y + 0.05, W * 0.26], [fw.chord * 0.62, 0.016, W * 0.42], -0.22).map(d => ({ ...d, paint: true })),
    ...(fw.flaps > 1 ? pair([fw.x - fw.chord * 0.72, fw.y + 0.11, W * 0.3], [fw.chord * 0.46, 0.014, W * 0.36], -0.42) : []),
    ...pair([fw.x - 0.04, fw.y + 0.08, W / 2 - 0.035], [fw.chord + 0.1, 0.19, 0.016]),
    ...pair([fw.x + 0.02, (fw.y + deck(fw.x)) / 2, 0.07], [0.12, deck(fw.x) - fw.y, 0.012]),
    // floor, its edges, the diffuser with fins, the beam wing (F1)
    { p: [(P.floor[0] + P.floor[1]) / 2, 0.04, 0], s: [P.floor[0] - P.floor[1], 0.02, P.floorW] },
    { p: [P.floor[1] - 0.3, 0.1, 0], s: [0.62, 0.02, P.floorW * 0.62], rz: -0.26 },
    ...[-0.3, -0.1, 0.1, 0.3].map(z => ({ p: [P.floor[1] - 0.3, 0.14, z * P.floorW], s: [0.6, 0.1, 0.012], rz: -0.26 })),
    ...(rw.beam ? [{ p: [rw.x + 0.06, rw.beam, 0], s: [0.2, 0.025, rw.span * 0.82], rz: -0.12 }] : []),
    // sidepod inlets, the airbox mouth, the helmet's visor, mirror stalks, the arms
    ...pair([P.inlet.x, P.inlet.y, P.inlet.z], [0.03, P.inlet.h, P.inlet.w]),
    { p: [P.cover.x1 + 0.005, P.cover.roof(P.cover.x1) - 0.06, 0], s: [0.02, 0.11, 0.12], disc: true },
    { p: [hx + P.helmetR * 0.8, hy + 0.01, 0], s: [0.05, 0.05, P.helmetR * 1.3], rz: 0.25 },
    ...pair([P.mirror[0] - 0.02, P.mirror[1] - 0.06, P.mirror[2] - 0.08], [0.02, 0.1, 0.02]),
    ...arms, ...mirrorZ(arms).filter((_, i) => i % 2 === 1),
    // body coloured: the shark fin on the engine cover, the mirrors
    { p: [P.fin[0], P.cover.roof(Math.max(P.cover.x0, P.fin[0])) + P.fin[2] / 2 - 0.05, 0], s: [P.fin[1], P.fin[2], 0.012], rz: 0.1, paint: true },
    ...pair(P.mirror, [0.07, 0.06, 0.15]).map(d => ({ ...d, paint: true })),
  ];
  // stripes: along the top of the nose, and along the engine cover from the airbox to the tail
  const nosePts = [], coverPts = [];
  for (let x = P.nose - 0.02; x >= k.x0 + 0.05; x -= 0.04) nosePts.push([x, deck(x)]);
  for (let x = P.cover.x1; x >= P.tail + 0.05; x -= 0.04) coverPts.push([x, x > P.cover.x0 ? P.cover.roof(x) : deck(x)]);
  const p0 = [P.plateX + 0.2, deck(P.plateX + 0.2)], p2 = [P.plateX - 0.2, deck(P.plateX - 0.2)], pm = [P.plateX, deck(P.plateX)];
  const p1 = [2 * pm[0] - (p0[0] + p2[0]) / 2, 2 * pm[1] - (p0[1] + p2[1]) / 2];
  const hull = { ...P, deck };
  return withOpenLofts({
    open: true, half: P.w(P.side.x), dx: 0, tyreW: P.tyreW, tyreWR: P.tyreWR, hull, liners: [],
    rim: P.rim, spokes: P.spokes, spokeW: P.spokeW, caliper: P.caliper,
    glass: { color: 0x0d0f12, roughness: 0.35, metalness: 0.2 },
    stripes: [{ pts: nosePts, off: 0 }, { pts: coverPts, off: 0 }],
    side: P.side,
    plate: { c0: p0, c1: p1, c2: p2, size: P.plateSize, off: 0.012 },
    wing: { x: rw.x, y: rw.y, main: rw.main, flap: rw.flap, span: rw.span, post: { x: rw.x + 0.12, y: (rw.base + rw.y) / 2, z: rw.postZ, h: rw.y - rw.base }, plate: { len: rw.plateLen, h: rw.plateH, y: rw.plateY } },
    helmet: { p: [hx, hy, 0], r: P.helmetR },
    cam: [P.cover.x1 - 0.05, P.cover.roof(P.cover.x1) + 0.14],   // the onboard camera, over the airbox (src/cameras.js)
    tubes: halo,
    dark,
    tails: [...(rw.lights ? pair([rw.x - rw.flap - 0.02, rw.plateY + rw.plateH * 0.2, rw.span / 2 + 0.01], [0.02, rw.plateH * 0.45, 0.02]) : []), { p: [P.tail - 0.01, P.rain, 0], s: [0.03, 0.06, 0.1] }],
    heads: [],
  });
}

function withOpenLofts(spec) {
  let hi = null, lo = null;
  Object.defineProperties(spec, {
    loft: { get() { return hi ||= openSkins(spec.hull, HIGH); }, enumerable: true },
    loftLow: { get() { return lo ||= openSkins(spec.hull, LOW); }, enumerable: true },
    freeLoft: { value() { for (const set of [hi, lo]) if (set) for (const g of Object.values(set)) g.dispose(); hi = lo = null; } },
  });
  return spec;
}

// Formula 1: 5.6 m long, 2.0 m wide, the front axle 1.98 m ahead of the middle and the rear 1.62 m behind (src/cars.js).
export const f1Shape = c => {
  const F = c.length / 2, fx = c.wheelbase * (1 - c.frontWeight), rx = fx - c.wheelbase;
  return openShape(c, {
    nose: F - 0.1, tail: rx - 0.7, rt: 0.07, rb: 0.03, z0: 0.22,
    w: curve([[rx - 0.7, 0.12], [rx - 0.45, 0.15], [rx, 0.21], [rx + 0.32, 0.3], [-0.95, 0.55], [-0.5, 0.71], [0.2, 0.73], [0.42, 0.66], [0.52, 0.36], [1.2, 0.3], [fx, 0.21], [2.4, 0.13], [F - 0.1, 0.09]]),
    ys: curve([[rx - 0.7, 0.34], [rx, 0.38], [-1.0, 0.42], [-0.5, 0.48], [0.3, 0.52], [0.45, 0.55], [0.55, 0.6], [1.2, 0.56], [fx, 0.47], [2.4, 0.37], [F - 0.1, 0.3]]),
    yb: curve([[rx - 0.7, 0.24], [rx - 0.38, 0.12], [rx - 0.1, 0.06], [1.2, 0.06], [1.6, 0.12], [fx, 0.17], [F - 0.1, 0.2]]),
    crown: curve([[rx - 0.7, 0.02], [rx, 0.06], [-1.0, 0.16], [-0.3, 0.2], [0.3, 0.16], [0.55, 0.05], [1.2, 0.04], [F - 0.1, 0.02]]),
    cover: { x0: -1.5, x1: -0.24, roof: curve([[-1.5, 0.6], [-1.2, 0.67], [-0.8, 0.77], [-0.45, 0.89], [-0.3, 0.95], [-0.24, 0.93]]), wb: curve([[-1.5, 0.1], [-0.8, 0.2], [-0.3, 0.22], [-0.24, 0.2]]), wr: curve([[-1.5, 0.04], [-0.8, 0.07], [-0.3, 0.1], [-0.24, 0.09]]) },
    cockpit: { x0: 0.62, x1: -0.22, half: 0.2 },
    helmetR: 0.125,
    frontWing: { x: F - 0.18, y: 0.09, chord: 0.34, flaps: 2 },
    rearWing: { x: rx - 0.9, y: 0.88, main: 0.26, flap: 0.2, span: 1.0, base: 0.42, postZ: 0.05, plateLen: 0.66, plateH: 0.5, plateY: 0.68, beam: 0.42, lights: true },
    floor: [1.25, rx + 0.25], floorW: 1.7,
    inlet: { x: 0.44, y: 0.36, z: 0.5, h: 0.17, w: 0.28 },
    fin: [-1.0, 0.85, 0.16],        // the shark fin on the engine cover: centre x, length, height
    mirror: [0.52, 0.72, 0.56],
    armsF: { up: 0.5, low: 0.2, z: 0.18, spread: 0.24 }, armsR: { up: 0.46, low: 0.18, z: 0.16, spread: 0.22 },
    tyreW: 0.305, tyreWR: 0.405,
    rim: { color: 0x1d1f22, roughness: 0.3, metalness: 0.75, nut: 0xf2c200 }, spokes: 10, spokeW: 0.08, caliper: 0x2b2d30,
    side: { x: -0.45, y: 0.28, w: 0.9 },
    plateX: 1.45, plateSize: 0.22, rain: 0.36,
  });
};

// Formula 4: 4.7 m long, 1.75 m wide, the front axle 1.6 m ahead of the middle and the rear 1.16 m behind (src/cars.js). Smaller
// sidepods, a single front flap, a two-element rear wing on the gearbox and no beam wing; the flap never opens (no DRS).
export const f4Shape = c => {
  const F = c.length / 2, fx = c.wheelbase * (1 - c.frontWeight), rx = fx - c.wheelbase;
  return openShape(c, {
    nose: F - 0.08, tail: rx - 0.78, rt: 0.06, rb: 0.03, z0: 0.2,
    w: curve([[rx - 0.78, 0.11], [rx - 0.4, 0.15], [rx, 0.2], [rx + 0.3, 0.29], [-0.6, 0.45], [-0.2, 0.55], [0.25, 0.55], [0.38, 0.49], [0.46, 0.32], [1.0, 0.28], [fx, 0.2], [2.0, 0.13], [F - 0.08, 0.09]]),
    ys: curve([[rx - 0.78, 0.32], [rx, 0.36], [-0.6, 0.42], [0.2, 0.47], [0.4, 0.52], [0.5, 0.58], [1.0, 0.56], [fx, 0.47], [2.0, 0.38], [F - 0.08, 0.31]]),
    yb: curve([[rx - 0.78, 0.22], [rx - 0.5, 0.1], [rx - 0.2, 0.06], [1.0, 0.06], [1.35, 0.12], [fx, 0.17], [F - 0.08, 0.21]]),
    crown: curve([[rx - 0.78, 0.02], [rx, 0.05], [-0.6, 0.12], [0.0, 0.16], [0.4, 0.12], [0.5, 0.04], [1.0, 0.03], [F - 0.08, 0.02]]),
    cover: { x0: -1.25, x1: -0.3, roof: curve([[-1.25, 0.6], [-1.0, 0.66], [-0.7, 0.76], [-0.45, 0.88], [-0.34, 0.93], [-0.3, 0.91]]), wb: curve([[-1.25, 0.1], [-0.7, 0.19], [-0.35, 0.21], [-0.3, 0.19]]), wr: curve([[-1.25, 0.04], [-0.7, 0.07], [-0.35, 0.09], [-0.3, 0.08]]) },
    cockpit: { x0: 0.55, x1: -0.28, half: 0.19 },
    helmetR: 0.125,
    frontWing: { x: F - 0.16, y: 0.1, chord: 0.3, flaps: 1 },
    rearWing: { x: rx - 0.84, y: 0.8, main: 0.24, flap: 0.17, span: 0.9, base: 0.4, postZ: 0.2, plateLen: 0.5, plateH: 0.36, plateY: 0.74, beam: 0, lights: false },
    floor: [1.0, rx + 0.2], floorW: 1.4,
    inlet: { x: 0.4, y: 0.36, z: 0.4, h: 0.15, w: 0.22 },
    fin: [-0.85, 0.55, 0.12],
    mirror: [0.48, 0.7, 0.5],
    armsF: { up: 0.47, low: 0.18, z: 0.16, spread: 0.22 }, armsR: { up: 0.42, low: 0.17, z: 0.15, spread: 0.2 },
    tyreW: 0.2, tyreWR: 0.25,
    rim: { color: 0xc9cdd1, roughness: 0.35, metalness: 0.6, nut: 0x1c1d20 }, spokes: 6, spokeW: 0.14, caliper: 0x55595e,
    side: { x: -0.25, y: 0.28, w: 0.9 },
    plateX: 1.2, plateSize: 0.2, rain: 0.34,
  });
};
