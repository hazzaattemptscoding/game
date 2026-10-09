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

// Build the three skins from a hull definition.
function buildHull(h) {
  const { F } = h;
  const body = loft(stations(-F, F), x => {
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
  const cab = loft(stations(c.x0, c.x1, 0.02, 0.1, 0.008), cabAt);
  const inside = [0, 0.7, 0], lift = 0.004, n = 2 * (CAB.SIDE + 1 + CAB.CORNER) + CAB.ROOF - 1;
  const parts = [];
  const point = (x, j, flip) => { const ring = cabAt(x), [z, y] = ringPoint(ring, flip ? n - 1 - j : j, lift); return [x, y, z]; };
  for (const w of h.windows) {
    if (w.side) {
      for (const flip of [false, true]) {
        parts.push(patch(18, 6, (u, v) => {
          const j = lerp(w.j0, w.j1, v), xf = lerp(w.front[0], w.front[1], v), xr = lerp(w.rear[0], w.rear[1], v);
          return point(lerp(xf, xr, u), j, flip);
        }, inside));
      }
    } else {
      parts.push(patch(18, 6, (u, v) => point(lerp(w.x0, w.x1, u), lerp(w.j0, w.j1, v), false), inside));
    }
  }
  return { body, cab, glass: merge(parts) };
}

// The liners: a dark panel on each side of each wheel, from the road up to the arch roof.
const liners = (c, arches, track, tyreW) => arches.flatMap(a => [1, -1].map(s => ({ x: a.x, y: c.wheelRadius, z: s * (track / 2 - tyreW / 2 - 0.012), R: a.R + 0.02, floor: a.floor })));

// CITY: a Peugeot 108 three-door hatchback.
export function cityShape(c) {
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
  const loftGeo = buildHull({ F, ys, yb, w, crown, arches, rt: 0.10, rb: 0.05, z0: 0.25, cab, windows });
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
    half, dx, tyreW: 0.165, loft: loftGeo, liners: liners(c, arches, c.trackWidth, 0.165),
    rim: { color: 0x8f969d, roughness: 0.4, metalness: 0.3 },
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
export function gt1Shape(c) {
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
  const loftGeo = buildHull({ F, ys, yb, w, crown, arches, rt: 0.09, rb: 0.04, z0: 0.45, cab, windows });
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
    half, dx: 0, tyreW, loft: loftGeo, liners: liners(c, arches, c.trackWidth, tyreW),
    rim: { color: 0x8f969d, roughness: 0.4, metalness: 0.3 },
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
