// Parked service vehicles: an ambulance, a fire engine, a recovery truck, a medical car, a track sweeper, the safety car, a marshal
// buggy and a team transporter, low poly and flat shaded like the rest of the venue. They do not move and nothing collides with them
// (src/serviceVehiclePlan.js keeps every one clear of every drivable width).
//
//   addServiceVehicles(scene, T, ground, keep?)  { group, plan, stats }   builds and adds them (one call where the scene is built)
//   vehicleGeometry(type)                         { tris, box }  the model's size, as numbers (tools/vehicles.js)
//   VEHICLE_TRIS                                  triangles per type
//
// Every vehicle is baked into a few merged meshes, one per ground cell (about 4 or 5 draw calls for the lot): vertex colours for the
// paint (a colour per vehicle from its seed), one small atlas of lettering (src/textures.js sponsor boards for the transporters) and one
// shared material. The blue, amber, white and red lamps are marked per vertex (aFx) and driven by one shared time uniform: the light
// bars flash all day and every lamp gets brighter with the lamp level (src/lamps.js), so night and rain are covered. No per-vehicle
// objects and no per-frame code outside the mesh's own onBeforeRender.
//
// Local axes of a model: +x forward, +y up, +z right, origin on the ground in the middle of the footprint.

import * as THREE from 'three';
import { onLampLevel } from './lamps.js';
import * as tex from './textures.js';
import { planVehicles, VEHICLES } from './serviceVehiclePlan.js';

// ---- lettering atlas: 16 rows of 1024 x 128 -------------------------------------------------------------------------------------
const ROWS = 16;
export const ROW = { white: 0, ambulance: 1, batten: 2, fire: 3, medical: 4, safety: 5, recovery: 6, sweeper: 7, marshal: 8, paddock: 9, brand: -1 };
const BRAND_ROW0 = 10;
export const BRANDS = ['powermedia', 'veyra', 'norrland', 'merrow', 'quillon', 'tarnwick'];   // rows 10 to 15, copied from the sponsor sheet

// colour of the lamp kinds, base (unlit) values; the shader adds the glow
const LAMP = { 2: 0x2a63ff, 3: 0x2a63ff, 4: 0xffa000, 5: 0xf2f4ff, 6: 0xc0161c };
const FX = { paint: 1, blueA: 2, blueB: 3, amber: 4, head: 5, tail: 6 };

const C = new THREE.Color();
const lin = hex => { C.setHex(hex); return [C.r, C.g, C.b]; };

// ---- geometry builder ---------------------------------------------------------------------------------------------------------
class Part {
  constructor() { this.p = []; this.c = []; this.u = []; this.v = []; this.row = []; this.fx = []; }
  get tris() { return this.p.length / 9; }
  // one triangle, corners given counter-clockwise seen from outside
  tri(a, b, c, rgb, fx = 0, uv = null, row = 0) {
    this.p.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) {
      this.c.push(...rgb); this.fx.push(fx); this.row.push(row);
      this.u.push(uv ? uv[k][0] : 0.5); this.v.push(uv ? uv[k][1] : 0.5);
    }
  }
  quad(a, b, c, d, hex, fx = 0, uv = null, row = 0) {
    const rgb = lin(hex);
    this.tri(a, b, c, rgb, fx, uv && [uv[0], uv[1], uv[2]], row);
    this.tri(a, c, d, rgb, fx, uv && [uv[0], uv[2], uv[3]], row);
  }
  // a convex solid from rings of points (each ring in order round the section, the same count in each), closed by flat caps. The faces
  // are wound to face away from the middle, whatever order the points came in.
  loft(rings, hex, fx = 0, caps = true) {
    const rgb = lin(hex), n = rings[0].length;
    const mid = [0, 0, 0]; let cnt = 0;
    for (const r of rings) for (const q of r) { mid[0] += q[0]; mid[1] += q[1]; mid[2] += q[2]; cnt++; }
    mid[0] /= cnt; mid[1] /= cnt; mid[2] /= cnt;
    const face = (pts) => {
      // wind the face outward: the normal of its first three points against the direction from the solid's middle
      const [a, b, c] = pts, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const out = nx * (a[0] - mid[0]) + ny * (a[1] - mid[1]) + nz * (a[2] - mid[2]);
      const list = out >= 0 ? pts : [...pts].reverse();
      for (let k = 1; k < list.length - 1; k++) this.tri(list[0], list[k], list[k + 1], rgb, fx);
    };
    for (let r = 0; r + 1 < rings.length; r++) for (let k = 0; k < n; k++) face([rings[r][k], rings[r][(k + 1) % n], rings[r + 1][(k + 1) % n], rings[r + 1][k]]);
    if (caps) { face(rings[0]); face(rings[rings.length - 1]); }
  }
  // an axis aligned box
  box(x0, x1, y0, y1, z0, z1, hex, fx = 0) {
    this.loft([[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]], hex, fx);
  }
  // a box along x with its four long edges chamfered by `b` (the section is an octagon): vans, cabs, hoppers
  rbox(x0, x1, y0, y1, z0, z1, hex, fx = 0, b = 0.18, bTop = b) {
    const ring = x => [[x, y0, z0 + b], [x, y0, z1 - b], [x, y0 + b, z1], [x, y1 - bTop, z1], [x, y1, z1 - bTop], [x, y1, z0 + bTop], [x, y1 - bTop, z0], [x, y0 + b, z0]];
    this.loft([ring(x0), ring(x1)], hex, fx);
  }
  // a slab with a sloped front and back: pts is the side profile as [x, y] pairs (either way round), the slab runs from z0 to z1
  profile(pts, z0, z1, hex, fx = 0) {
    const rgb = lin(hex);
    let area = 0; pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; area += x * y2 - x2 * y; });
    const ring = area > 0 ? pts : [...pts].reverse();   // counter-clockwise seen from +z
    const flat = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [a, b, c] of flat) {
      const A = ring[a], B = ring[b], C = ring[c], ccw = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0;
      const t = ccw ? [A, B, C] : [A, C, B];
      this.tri([t[0][0], t[0][1], z1], [t[1][0], t[1][1], z1], [t[2][0], t[2][1], z1], rgb, fx);
      this.tri([t[0][0], t[0][1], z0], [t[2][0], t[2][1], z0], [t[1][0], t[1][1], z0], rgb, fx);
    }
    ring.forEach(([x, y], i) => {
      const [x2, y2] = ring[(i + 1) % ring.length];
      this.quad([x, y, z1], [x, y, z0], [x2, y2, z0], [x2, y2, z1], hex, fx);   // outward: to the right of the edge
    });
  }
  // glass laid on a sloped edge of a profile (a to b, in the profile's counter-clockwise order), from t0 to t1 along it, pushed 12 mm out
  slope(a, b, t0, t1, z0, z1, hex, fx = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = dy / l * 0.012, ny = -dx / l * 0.012;
    const at = t => [a[0] + dx * t + nx, a[1] + dy * t + ny];
    const p0 = at(t0), p1 = at(t1);
    this.quad([p0[0], p0[1], z1], [p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], hex, fx);
  }
  // a bar between two points, `t` square (up is world y unless the bar is nearly upright)
  beam(a, b, t, hex, fx = 0) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, f = d.map(v => v / l);
    let up = [0, 1, 0]; if (Math.abs(f[1]) > 0.95) up = [1, 0, 0];
    const s = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]], sl = Math.hypot(...s) || 1;
    const sx = s.map(v => v / sl * t / 2), u = [sx[1] * f[2] - sx[2] * f[1], sx[2] * f[0] - sx[0] * f[2], sx[0] * f[1] - sx[1] * f[0]], ul = Math.hypot(...u) || 1, uy = u.map(v => v / ul * t / 2);
    const ring = o => [[o[0] - sx[0] - uy[0], o[1] - sx[1] - uy[1], o[2] - sx[2] - uy[2]], [o[0] + sx[0] - uy[0], o[1] + sx[1] - uy[1], o[2] + sx[2] - uy[2]], [o[0] + sx[0] + uy[0], o[1] + sx[1] + uy[1], o[2] + sx[2] + uy[2]], [o[0] - sx[0] + uy[0], o[1] - sx[1] + uy[1], o[2] - sx[2] + uy[2]]];
    this.loft([ring(a), ring(b)], hex, fx);
  }
  // a wheel: an 8 sided drum about the z axis at (x, r, z), `w` wide, with a pale hub disc on the outer face
  wheel(x, z, r, w, side = 1) {
    const ring = zz => Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4 + Math.PI / 8; return [x + Math.cos(a) * r, r + Math.sin(a) * r, zz]; });
    this.loft([ring(z - w / 2), ring(z + w / 2)], 0x16181a);
    const o = z + side * (w / 2 + 0.004), hub = Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4 + Math.PI / 8; return [x + Math.cos(a) * r * 0.55, r + Math.sin(a) * r * 0.55, o]; });
    const rgb = lin(0x8d949b);
    for (let k = 1; k < 7; k++) { const t = side > 0 ? [hub[0], hub[k], hub[k + 1]] : [hub[0], hub[k + 1], hub[k]]; this.tri(t[0], t[1], t[2], rgb, 0); }
  }
  // lettering or a flat panel on a side wall at z, from xa to xb and ya to yb; side +1 is the right hand side (text reads towards the nose),
  // -1 the left (it reads towards the tail), so a model has the same text on both sides. row is an atlas row (ROW.*, or ROW.brand)
  decal(side, xa, xb, ya, yb, z, row) {
    const w = 0xffffff, q = row === ROW.white ? null : [[0, 0], [1, 0], [1, 1], [0, 1]];
    const zz = side * z, rgb = lin(w);
    const P = side > 0 ? [[xa, ya, zz], [xb, ya, zz], [xb, yb, zz], [xa, yb, zz]] : [[xb, ya, zz], [xa, ya, zz], [xa, yb, zz], [xb, yb, zz]];
    this.tri(P[0], P[1], P[2], rgb, 0, q && [q[0], q[1], q[2]], row);
    this.tri(P[0], P[2], P[3], rgb, 0, q && [q[0], q[2], q[3]], row);
  }
  // a flat coloured panel on a side wall (no lettering)
  panel(side, xa, xb, ya, yb, z, hex, fx = 0) {
    const zz = side * z, P = side > 0 ? [[xa, ya, zz], [xb, ya, zz], [xb, yb, zz], [xa, yb, zz]] : [[xb, ya, zz], [xa, ya, zz], [xa, yb, zz], [xb, yb, zz]];
    this.quad(...P, hex, fx);
  }
  // a flat panel facing along x (front: dir +1, back: -1) at x, from za to zb, ya to yb
  face(dir, x, za, zb, ya, yb, hex, fx = 0) {
    const P = dir > 0 ? [[x, ya, za], [x, yb, za], [x, yb, zb], [x, ya, zb]] : [[x, ya, zb], [x, yb, zb], [x, yb, za], [x, ya, za]];
    this.quad(...P, hex, fx);
  }
  // both side walls
  both(f) { f(1); f(-1); }
}

// ---- the models ---------------------------------------------------------------------------------------------------------------
const DARK = 0x23272b, GREY = 0x8c939a, GLASS = 0x28394b, BUMP = 0x1b1e21, CHROME = 0xb7bdc4;

// a light bar across the roof at x: blue halves alternate (A on the right hand half, B on the left)
function lightbar(p, x0, x1, y, zHalf, h = 0.14, kind = 'blue') {
  p.box(x0, x1, y - 0.03, y, -zHalf - 0.04, zHalf + 0.04, 0x1b1e21);
  if (kind === 'blue') {
    p.box(x0, x1, y, y + h, 0, zHalf, 0x2a63ff, FX.blueA);
    p.box(x0, x1, y, y + h, -zHalf, 0, 0x2a63ff, FX.blueB);
  } else p.box(x0, x1, y, y + h, -zHalf, zHalf, 0xffa000, FX.amber);
}

function ambulance() {
  const p = new Part(), W = 1.1;
  p.box(-3.0, 3.0, 0.38, 0.8, -0.98, 0.98, DARK);                                            // chassis
  p.rbox(-3.0, 0.95, 0.78, 2.72, -W, W, 0xf4f4f1, FX.paint, 0.16, 0.22);                       // the patient box
  p.profile([[0.95, 0.78], [3.0, 0.78], [3.0, 1.34], [2.55, 1.46], [2.0, 1.5], [1.6, 2.46], [0.95, 2.46]], -1.04, 1.04, 0xf4f4f1, FX.paint);   // bonnet and cab
  // glass: windscreen and the side windows
  p.slope([2.0, 1.5], [1.6, 2.46], 0.05, 0.9, -0.96, 0.96, GLASS);
  p.both(s => p.panel(s, 1.05, 1.9, 1.58, 2.28, 1.045, GLASS));
  // battenburg band and lettering
  p.both(s => { p.decal(s, -2.95, 2.9, 0.98, 1.42, W + 0.012, ROW.batten); p.decal(s, -2.75, 0.75, 1.62, 2.15, W + 0.012, ROW.ambulance); });
  p.decal(-1, -2.95, 2.9, 0.98, 1.42, W + 0.012, ROW.batten);
  p.face(-1, -3.002, -0.9, 0.9, 1.0, 1.4, 0xffd400);                                           // rear: a yellow panel
  p.face(-1, -3.004, -0.88, 0.88, 1.5, 2.55, 0xf4f4f1);
  // blue and amber lights: roof bar, grille lights, rear lights
  lightbar(p, 1.0, 1.5, 2.46, 0.82);
  p.box(-2.95, -2.7, 2.72, 2.86, 0.0, 0.85, 0x2a63ff, FX.blueA); p.box(-2.95, -2.7, 2.72, 2.86, -0.85, 0.0, 0x2a63ff, FX.blueB);
  p.box(2.98, 3.06, 0.95, 1.12, 0.45, 0.75, 0x2a63ff, FX.blueA); p.box(2.98, 3.06, 0.95, 1.12, -0.75, -0.45, 0x2a63ff, FX.blueB);
  p.both(s => { p.box(2.96, 3.04, 0.9, 1.2, s * 0.8 - 0.1, s * 0.8 + 0.1, 0xf2f4ff, FX.head); p.box(-3.04, -2.98, 0.9, 1.4, s * 0.92 - 0.06, s * 0.92 + 0.06, 0xffa000, FX.amber); p.box(-3.04, -2.98, 1.5, 1.8, s * 0.92 - 0.06, s * 0.92 + 0.06, 0xc0161c, FX.tail); });
  p.box(3.0, 3.18, 0.4, 0.85, -1.05, 1.05, BUMP); p.box(-3.2, -3.0, 0.42, 0.8, -1.0, 1.0, BUMP);   // bumpers
  p.both(s => p.box(1.85, 2.0, 1.75, 2.0, s * 1.09 - 0.04, s * 1.09 + 0.04 + s * 0.12, BUMP));   // mirrors
  for (const x of [1.95, -1.9]) p.both(s => p.wheel(x, s * 0.9, 0.42, 0.3, s));
  return p;
}

function fire() {
  const p = new Part(), RED = 0xc8161c;
  p.box(-4.2, 4.0, 0.42, 0.98, -1.0, 1.0, DARK);
  p.rbox(-4.2, 1.45, 0.96, 2.55, -1.25, 1.25, RED, FX.paint, 0.14, 0.2);                           // the pump body with its lockers
  p.rbox(1.55, 3.3, 0.96, 3.0, -1.2, 1.2, RED, FX.paint, 0.2, 0.28);                               // the cab
  p.face(1, 3.304, -1.08, 1.08, 1.55, 2.7, GLASS);                                                 // windscreen (the cab face is flat)
  p.both(s => { p.panel(s, 1.85, 2.9, 1.7, 2.7, 1.225 + 0.03, GLASS); });
  // roller shutters, white band, lettering
  p.both(s => {
    for (const [a, b] of [[-3.95, -2.65], [-2.45, -1.15], [-0.95, 0.35]]) p.panel(s, a, b, 1.5, 2.2, 1.265, 0xb4bac1);
    p.panel(s, -4.15, 1.4, 2.28, 2.36, 1.27, 0xf2f2ee);
    p.decal(s, -3.7, -0.5, 1.02, 1.42, 1.268, ROW.fire);
  });
  p.face(-1, -4.202, -1.1, 1.1, 1.2, 2.3, 0xb4bac1);                                             // rear shutter
  p.face(-1, -4.204, -1.1, 1.1, 2.3, 2.4, 0xf2f2ee);
  p.box(3.3, 3.5, 0.55, 0.98, -1.1, 1.1, BUMP);                                                  // bumper
  p.box(3.3, 3.34, 1.1, 1.45, -0.8, 0.8, 0x3a3f44);                                             // grille
  // the ladder on the roof of the body
  p.box(-4.1, 1.3, 2.55, 2.66, -0.5, -0.42, 0xd7dbdf); p.box(-4.1, 1.3, 2.55, 2.66, 0.42, 0.5, 0xd7dbdf);
  for (let x = -3.9; x <= 1.2; x += 0.5) p.box(x, x + 0.06, 2.6, 2.7, -0.46, 0.46, 0xd7dbdf);
  p.box(-4.0, -3.3, 2.55, 2.95, -0.55, 0.55, 0x5a6067);
  // the hose reel on the roof: a drum on its frame, hose wound on it
  const drumX = -2.4, reel = zz => Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4 + Math.PI / 8; return [drumX + Math.cos(a) * 0.3, 2.95 + Math.sin(a) * 0.3, zz]; });
  p.box(drumX - 0.4, drumX + 0.4, 2.55, 2.64, -0.5, 0.5, 0x3a3f44);
  p.loft([reel(-0.4), reel(0.4)], 0x23272b);
  p.both(s => p.box(drumX - 0.03, drumX + 0.03, 2.64, 3.28, s * 0.45 - 0.03, s * 0.45 + 0.03, 0x3a3f44));
  // lights
  lightbar(p, 2.2, 2.8, 3.0, 0.95, 0.16);
  p.box(3.5, 3.54, 0.62, 0.85, 0.5, 0.9, 0x2a63ff, FX.blueA); p.box(3.5, 3.54, 0.62, 0.85, -0.9, -0.5, 0x2a63ff, FX.blueB);
  p.box(-4.26, -4.2, 2.1, 2.5, 0.8, 1.2, 0x2a63ff, FX.blueA); p.box(-4.26, -4.2, 2.1, 2.5, -1.2, -0.8, 0x2a63ff, FX.blueB);
  p.both(s => { p.box(3.5, 3.54, 0.7, 0.9, s * 1.0 - 0.1, s * 1.0 + 0.1, 0xf2f4ff, FX.head); p.box(-4.26, -4.2, 0.95, 1.35, s * 1.1 - 0.07, s * 1.1 + 0.07, 0xc0161c, FX.tail); });
  p.both(s => { p.box(1.5, 1.64, 2.4, 2.8, s * 1.3 - 0.05, s * 1.3 + 0.05, BUMP); p.box(0.4, 0.46, 0.98, 1.1, s * 1.3, s * 1.3 + 0.05 * s, 0x3a3f44); });   // mirrors, a step
  for (const x of [2.55, -1.2, -3.0]) p.both(s => p.wheel(x, s * 0.98, 0.52, 0.4, s));
  return p;
}

function recovery() {
  const p = new Part(), Y = 0xffc20e;
  p.box(-3.9, 3.7, 0.5, 1.0, -0.95, 0.95, DARK);
  p.rbox(2.0, 3.7, 0.98, 2.95, -1.1, 1.1, Y, FX.paint, 0.2, 0.3);                                  // the cab
  p.face(1, 3.704, -1.0, 1.0, 1.55, 2.6, GLASS);
  p.both(s => p.panel(s, 2.3, 3.4, 1.65, 2.6, 1.13, GLASS));
  p.box(3.7, 3.95, 0.55, 1.05, -1.1, 1.1, BUMP);
  p.box(3.7, 3.74, 1.1, 1.45, -0.8, 0.8, 0x3a3f44);
  // the flatbed: a body with the lettering on its sides, a deck on top, a headboard behind the cab
  p.box(-3.8, 1.9, 1.0, 1.45, -1.2, 1.2, Y, FX.paint);
  p.box(-3.8, 1.9, 1.45, 1.5, -1.12, 1.12, 0x4b5057);
  p.box(1.7, 1.95, 1.45, 2.9, -1.15, 1.15, Y, FX.paint);
  p.both(s => { p.decal(s, -3.5, -0.7, 1.08, 1.38, 1.212, ROW.recovery); p.box(-3.8, 1.7, 1.5, 1.62, s * 1.12 - 0.03, s * 1.12 + 0.03, 0x30343a); });
  // the crane: a base, a boom raised over the flatbed, a hook on a cable
  p.box(0.3, 1.3, 1.5, 2.0, -0.45, 0.45, 0x30343a);
  p.beam([0.9, 1.95, 0], [-2.2, 3.2, 0], 0.34, Y);
  p.beam([0.7, 1.6, 0], [0.0, 2.6, 0], 0.2, 0x30343a);
  p.beam([-2.2, 3.15, 0], [-2.2, 1.85, 0], 0.05, 0x1b1e21);
  p.box(-2.32, -2.08, 1.65, 1.85, -0.1, 0.1, 0xd7dbdf);
  // rear tow bar
  p.box(-3.95, -3.8, 0.6, 0.8, -0.8, 0.8, 0x30343a);
  // amber light bar and beacons
  lightbar(p, 2.7, 3.1, 2.95, 0.7, 0.14, 'amber');
  p.box(-3.84, -3.8, 1.05, 1.3, 0.9, 1.1, 0xffa000, FX.amber); p.box(-3.84, -3.8, 1.05, 1.3, -1.1, -0.9, 0xffa000, FX.amber);
  p.box(1.0, 1.25, 2.9, 3.05, -0.1, 0.1, 0xffa000, FX.amber);
  p.both(s => { p.box(3.94, 4.0, 0.62, 0.9, s * 0.95 - 0.1, s * 0.95 + 0.1, 0xf2f4ff, FX.head); p.box(-3.84, -3.8, 1.1, 1.3, s * 0.6 - 0.07, s * 0.6 + 0.07, 0xc0161c, FX.tail); });
  for (const x of [2.8, -2.3, -3.3]) p.both(s => p.wheel(x, s * 0.92, 0.5, 0.38, s));
  return p;
}

function medical() {
  const p = new Part(), W = 0xf1f2f2;
  // an estate: low body, a long greenhouse
  p.profile([[-2.4, 0.3], [2.4, 0.3], [2.4, 0.78], [1.5, 0.92], [0.95, 0.98], [-2.4, 0.98]], -0.94, 0.94, W, FX.paint);
  p.profile([[-2.3, 0.96], [0.95, 0.96], [0.2, 1.52], [-2.15, 1.52], [-2.35, 1.42]], -0.84, 0.84, W, FX.paint);
  p.slope([0.95, 0.96], [0.2, 1.52], 0.08, 0.95, -0.76, 0.76, GLASS);
  p.slope([-2.15, 1.52], [-2.35, 1.42], 0.0, 1.0, -0.76, 0.76, GLASS);
  p.both(s => { p.panel(s, -2.0, 0.65, 1.04, 1.44, 0.852 + 0.0, GLASS); });
  p.both(s => { p.decal(s, -2.35, 2.3, 0.4, 0.66, 0.946, ROW.batten); p.decal(s, -1.5, 0.5, 0.72, 0.9, 0.946, ROW.medical); });
  p.face(-1, -2.404, -0.9, 0.9, 0.55, 0.85, 0xffd400);
  p.face(1, 2.404, -0.9, 0.9, 0.5, 0.7, 0x2a2e33);
  p.box(-2.45, -2.3, 0.32, 0.5, -0.88, 0.88, BUMP); p.box(2.3, 2.5, 0.3, 0.52, -0.9, 0.9, BUMP);
  lightbar(p, -0.35, 0.15, 1.52, 0.55, 0.12);
  p.box(2.38, 2.46, 0.55, 0.65, 0.3, 0.7, 0x2a63ff, FX.blueA); p.box(2.38, 2.46, 0.55, 0.65, -0.7, -0.3, 0x2a63ff, FX.blueB);
  p.both(s => { p.box(2.38, 2.44, 0.62, 0.78, s * 0.72 - 0.12, s * 0.72 + 0.12, 0xf2f4ff, FX.head); p.box(-2.44, -2.38, 0.72, 0.9, s * 0.74 - 0.12, s * 0.74 + 0.12, 0xc0161c, FX.tail); });
  p.both(s => p.box(0.9, 1.05, 1.0, 1.12, s * 0.97 - 0.02, s * 0.97 + 0.12 * s, BUMP));
  for (const x of [1.4, -1.35]) p.both(s => p.wheel(x, s * 0.8, 0.34, 0.24, s));
  return p;
}

function sweeper() {
  const p = new Part(), O = 0xf08a1c;
  p.box(-2.95, 2.5, 0.42, 0.86, -0.95, 0.95, DARK);
  p.profile([[-2.9, 0.84], [1.0, 0.84], [1.1, 2.3], [-2.0, 2.45], [-2.9, 2.0]], -1.12, 1.12, O, FX.paint);               // the hopper
  p.box(-2.95, -2.3, 0.84, 1.1, -0.9, 0.9, 0x30343a);                                                                 // the discharge chute
  p.rbox(1.2, 2.7, 0.84, 2.45, -1.05, 1.05, O, FX.paint, 0.2, 0.26);                                                  // the cab
  p.face(1, 2.704, -0.95, 0.95, 1.4, 2.25, GLASS);
  p.both(s => p.panel(s, 1.4, 2.5, 1.5, 2.25, 1.075, GLASS));
  p.box(2.7, 2.8, 0.45, 0.9, -1.0, 1.0, BUMP);
  // the front brush: a drum on two arms, with a skirt behind it
  const drum = zz => Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return [2.98 + Math.cos(a) * 0.3, 0.32 + Math.sin(a) * 0.3, zz]; });
  p.loft([drum(-1.05), drum(1.05)], 0x1f2326);
  p.both(s => { p.beam([2.7, 0.7, s * 0.95], [2.98, 0.34, s * 0.95], 0.1, 0x4b5057); });
  p.box(2.78, 2.9, 0.18, 0.5, -1.1, 1.1, 0x30343a);
  // lettering and the hazard bar
  p.both(s => p.decal(s, -2.6, 0.5, 1.35, 1.72, 1.124, ROW.sweeper));
  p.both(s => p.panel(s, -2.85, 0.9, 1.0, 1.08, 1.126, 0xfff2cf));
  lightbar(p, 1.4, 1.8, 2.45, 0.6, 0.14, 'amber');
  p.box(-2.7, -2.5, 2.2, 2.4, -0.7, 0.7, 0xffa000, FX.amber);
  p.box(-2.92, -2.86, 1.2, 1.5, -0.9, -0.5, 0xffa000, FX.amber); p.box(-2.92, -2.86, 1.2, 1.5, 0.5, 0.9, 0xffa000, FX.amber);
  p.both(s => { p.box(2.78, 2.84, 0.56, 0.8, s * 0.85 - 0.1, s * 0.85 + 0.1, 0xf2f4ff, FX.head); p.box(-2.95, -2.9, 0.9, 1.1, s * 0.5 - 0.07, s * 0.5 + 0.07, 0xc0161c, FX.tail); });
  for (const x of [1.95, -1.7]) p.both(s => p.wheel(x, s * 0.9, 0.44, 0.34, s));
  return p;
}

// the safety car: the GT1's shoulder and haunches as a coarse loft (the real skin is thirty thousand triangles), a cabin, splitter and wing
const SC_YS = [[-2.34, 0.8], [-2.15, 0.93], [-1.9, 0.98], [-1.45, 0.995], [-1.0, 0.96], [-0.4, 0.91], [0.3, 0.885], [0.9, 0.875], [1.37, 0.865], [1.8, 0.8], [2.0, 0.68], [2.2, 0.54], [2.34, 0.47]];
const SC_YB = [[-2.34, 0.3], [-2.25, 0.22], [-2.0, 0.15], [-1.8, 0.13], [1.8, 0.13], [2.1, 0.15], [2.28, 0.2], [2.34, 0.26]];
const SC_W = [[-2.34, 0.8], [-2.25, 0.92], [-2.0, 0.985], [-1.75, 0.99], [-1.0, 0.99], [-0.75, 0.945], [-0.65, 0.93], [0.65, 0.93], [0.9, 0.955], [1.2, 0.972], [1.37, 0.975], [1.8, 0.96], [2.1, 0.9], [2.28, 0.82], [2.34, 0.74]];
const SC_ROOF = [[-1.75, 0.93], [-1.5, 1.1], [-1.2, 1.15], [-0.7, 1.19], [0, 1.18], [0.25, 1.12], [0.5, 1.0], [0.77, 0.86]];
const along = (tab, x) => { for (let i = 0; i + 1 < tab.length; i++) if (x <= tab[i + 1][0]) { const t = (x - tab[i][0]) / (tab[i + 1][0] - tab[i][0] || 1); return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * Math.max(0, t); } return tab[tab.length - 1][1]; };
function safety() {
  const p = new Part(), xs = [-2.34, -2.1, -1.8, -1.4, -0.9, -0.4, 0.1, 0.6, 1.1, 1.5, 1.85, 2.1, 2.34];
  const body = 0xdfe3e6, green = 0x1d6b4a, black = 0x15181b;   // silver white with the green livery (PAINT.safety): neither follows the per vehicle paint pick
  // the body: a ring at each station, quads between, flat shaded
  const ring = x => {
    const yb = along(SC_YB, x), ys = along(SC_YS, x), w = along(SC_W, x);
    const half = [[0, yb], [w * 0.8, yb], [w, yb + 0.1], [w, ys - 0.12], [w * 0.92, ys], [w * 0.5, ys + 0.06], [0, ys + 0.08]];
    return [...half.map(([z, y]) => [x, y, z]), ...half.slice(1, -1).reverse().map(([z, y]) => [x, y, -z])];
  };
  p.loft(xs.map(ring), body);
  // the height of the body's top skin at x, z (for |z| under half the flank width): what the stripes and vents lie on
  const top = (x, z) => along(SC_YS, x) + 0.08 - 0.02 * Math.min(1, Math.abs(z) / (along(SC_W, x) * 0.5));
  // a flat strip on the top skin from x0 to x1 and za to zb, cut at every body station so it follows the shape
  const skin = (x0, x1, za, zb, hex, lift = 0.008) => {
    const cuts = [x0, ...xs.filter(x => x > x0 && x < x1), x1];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k], b = cuts[k + 1];
      p.quad([a, top(a, za) + lift, za], [a, top(a, zb) + lift, zb], [b, top(b, zb) + lift, zb], [b, top(b, za) + lift, za], hex);
    }
  };
  // cabin: a narrow greenhouse with tinted glass all round
  const cx = [-1.75, -1.5, -1.1, -0.6, -0.1, 0.25, 0.55, 0.77];
  const cabin = x => {
    const yB = along(SC_YS, x) - 0.05, yR = Math.max(along(SC_ROOF, x), yB + 0.02), w = 0.62 + 0.15 * Math.min(1, (x + 1.75) / 0.6) * Math.min(1, (0.8 - x) / 0.5);
    return { yB, yR, w, half: [[w, yB], [w * 0.9, yB + (yR - yB) * 0.7], [w * 0.55, yR], [0, yR + 0.01]] };
  };
  const cring = x => { const { half } = cabin(x); return [...half.map(([z, y]) => [x, y, z]), ...half.slice(1, -1).reverse().map(([z, y]) => [x, y, -z])]; };
  p.loft(cx.map(cring), GLASS);
  // the A, B and C pillars: dark bars up the glass from the sill to the roof edge, either side
  for (const [xb, xt, t] of [[0.74, 0.34, 0.09], [-0.55, -0.55, 0.08], [-1.4, -1.5, 0.1]]) {
    const lo = cabin(xb), hi = cabin(xt);
    p.both(s => {
      p.beam([xb, lo.yB, s * (lo.w + 0.008)], [(xb + xt) / 2, (lo.yB + (lo.yR - lo.yB) * 0.7 + hi.yB + (hi.yR - hi.yB) * 0.7) / 2, s * (lo.w * 0.9 + hi.w * 0.9) / 2 + s * 0.008], t, black);
      p.beam([(xb + xt) / 2, (lo.yB + (lo.yR - lo.yB) * 0.7 + hi.yB + (hi.yR - hi.yB) * 0.7) / 2, s * (lo.w * 0.9 + hi.w * 0.9) / 2 + s * 0.008], [xt, hi.yR, s * (hi.w * 0.55 + 0.004)], t, black);
    });
  }
  // the green stripe: along the roof, down the bonnet and over the tail, and along the sill between the wheels
  for (let k = 0; k + 1 < cx.length - 2; k++) {
    const a = cabin(cx[k + 1]), b = cabin(cx[k + 2]), x0 = cx[k + 1], x1 = cx[k + 2];
    p.quad([x0, a.yR + 0.02, -0.17], [x0, a.yR + 0.02, 0.17], [x1, b.yR + 0.02, 0.17], [x1, b.yR + 0.02, -0.17], green);
  }
  skin(0.77, 2.3, -0.17, 0.17, green);
  skin(-2.2, -1.78, -0.17, 0.17, green);
  p.both(s => { for (let x = -0.9; x < 0.95; x += 0.3) p.panel(s, x, Math.min(0.95, x + 0.31), 0.26, 0.37, along(SC_W, x + 0.15) + 0.005, green); });
  // bonnet vents, a mesh grille in the nose, the door cut lines
  p.both(s => skin(1.05, 1.6, s * 0.22, s * 0.42, black, 0.01));
  p.face(1, 2.344, -0.5, 0.5, 0.3, 0.43, black);
  for (const y of [0.34, 0.39]) p.face(1, 2.347, -0.5, 0.5, y, y + 0.012, 0x59616a);
  for (let z = -0.45; z <= 0.46; z += 0.15) p.face(1, 2.347, z - 0.006, z + 0.006, 0.3, 0.43, 0x59616a);
  p.both(s => {
    const z = 0.95, line = 0.012;
    p.panel(s, 0.6, 0.6 + line, 0.3, 0.78, z, black); p.panel(s, -0.75, -0.75 + line, 0.3, 0.78, z, black); p.panel(s, -0.17, -0.17 + line, 0.3, 0.78, z, black);
    p.panel(s, -0.75, 0.6, 0.78, 0.78 + line, z, black);
    p.decal(s, -0.45, 0.45, 0.42, 0.72, 0.94, ROW.safety);
  });
  // splitter, rear wing on two uprights
  p.box(2.1, 2.42, 0.1, 0.16, -0.9, 0.9, 0x1b1e21);
  p.box(-2.34, -1.95, 1.1, 1.18, -0.95, 0.95, 0x1b1e21);
  p.both(s => { p.box(-2.2, -2.05, 0.95, 1.1, s * 0.6 - 0.03, s * 0.6 + 0.03, 0x1b1e21); p.box(-2.38, -1.9, 1.02, 1.3, s * 0.95 - 0.015, s * 0.95 + 0.015, 0x1b1e21); });
  // the light bar: 1.1 m wide, 0.12 tall, lit amber, with a small beacon at each end
  p.box(-0.62, -0.08, 1.185, 1.215, -0.56, 0.56, black);
  p.box(-0.58, -0.12, 1.215, 1.335, -0.5, 0.5, 0xffa000, FX.amber);
  p.both(s => p.box(-0.45, -0.25, 1.215, 1.3, s * 0.52, s * 0.62, 0xffa000, FX.amber));
  p.both(s => { p.box(2.22, 2.3, 0.58, 0.68, s * 0.62 - 0.16, s * 0.62 + 0.16, 0xf2f4ff, FX.head); p.box(-2.38, -2.3, 0.7, 0.8, s * 0.6 - 0.2, s * 0.6 + 0.2, 0xc0161c, FX.tail); });
  // wheels outboard so the tyre face stands 0.14 proud of the flank, under flared arches (half discs of body colour, 0.1 m over the tyre)
  for (const x of [1.4, -1.3]) p.both(s => {
    p.wheel(x, s * 0.93, 0.34, 0.38, s);
    const R0 = 0.37, R1 = 0.46, pt = (a, R) => [x + Math.cos(a) * R, 0.34 + Math.sin(a) * R];
    for (let k = 0; k < 5; k++) {
      const a0 = k * Math.PI / 5, a1 = (k + 1) * Math.PI / 5, A = pt(a0, R0), B = pt(a1, R0), Cc = pt(a1, R1), D = pt(a0, R1);
      const ring = z => [[A[0], A[1], z], [B[0], B[1], z], [Cc[0], Cc[1], z], [D[0], D[1], z]];
      p.loft([ring(s * 0.84), ring(s * 1.05)], body);
    }
  });
  return p;
}

function buggy() {
  const p = new Part(), W = 0xf3f1ea;
  p.box(-1.35, 1.1, 0.2, 0.32, -0.55, 0.55, DARK);
  p.profile([[0.6, 0.3], [1.4, 0.3], [1.4, 0.7], [0.9, 0.95], [0.5, 0.95]], -0.58, 0.58, W, FX.paint);          // the front cowl
  p.box(-0.95, -0.15, 0.32, 0.55, -0.55, 0.55, W, FX.paint);                                                  // seat base
  p.box(-0.95, -0.82, 0.55, 1.0, -0.5, 0.5, 0x3a3f44);                                                         // back rest
  p.box(-0.82, -0.2, 0.55, 0.62, -0.5, 0.5, 0x2a2e33);                                                         // cushion
  p.box(-1.4, -0.98, 0.32, 0.8, -0.58, 0.58, W, FX.paint);                                                     // the rear box
  p.box(0.35, 0.5, 0.95, 1.25, -0.04, 0.04, 0x3a3f44);                                                         // steering column
  p.box(0.33, 0.52, 1.2, 1.28, -0.2, 0.2, 0x1b1e21);
  for (const [x, z] of [[0.55, 0.56], [0.55, -0.56], [-0.95, 0.56], [-0.95, -0.56]]) p.box(x - 0.025, x + 0.025, 0.95, 1.85, z - 0.025, z + 0.025, 0x3a3f44);
  p.box(-1.05, 0.7, 1.84, 1.9, -0.62, 0.62, W, FX.paint);                                                      // the canopy
  p.both(s => p.decal(s, -0.95, 0.65, 1.74, 1.84, 0.62 + 0.002, ROW.marshal));
  p.box(-1.0, -0.82, 1.9, 2.02, -0.09, 0.09, 0xffa000, FX.amber);
  p.both(s => { p.box(1.39, 1.45, 0.45, 0.62, s * 0.42 - 0.1, s * 0.42 + 0.1, 0xf2f4ff, FX.head); p.box(-1.43, -1.4, 0.6, 0.7, s * 0.5 - 0.06, s * 0.5 + 0.06, 0xc0161c, FX.tail); });
  p.box(1.4, 1.52, 0.28, 0.5, -0.5, 0.5, BUMP);                                                               // the front bumper
  p.box(-1.45, -1.38, 0.3, 0.46, -0.52, 0.52, BUMP);                                                          // the rear bumper
  p.box(0.3, 0.6, 0.55, 0.92, -0.5, 0.5, 0x2a2e33);                                                           // the dash
  p.both(s => { p.box(0.7, 1.35, 0.3, 0.38, s * 0.56 - 0.02, s * 0.56 + 0.02 + s * 0.06, 0x3a3f44); p.box(-1.0, 0.5, 0.28, 0.34, s * 0.56 - 0.02, s * 0.56 + 0.02 + s * 0.06, 0x3a3f44); });   // the running boards
  for (const x of [1.0, -0.95]) p.both(s => p.box(x - 0.27, x + 0.27, 0.36, 0.41, s * 0.6 - 0.07, s * 0.6 + 0.07, W, FX.paint));   // the mudguards
  p.both(s => p.wheel(1.0, s * 0.5, 0.2, 0.16, s)); p.both(s => p.wheel(-0.95, s * 0.5, 0.2, 0.16, s));
  return p;
}

function transport() {
  const p = new Part();
  p.box(-6.4, 6.0, 0.62, 1.2, -0.95, 0.95, DARK);                                                              // chassis
  p.rbox(-6.5, 3.9, 1.2, 4.0, -1.27, 1.27, 0xe9eaec, FX.paint, 0.1, 0.18);                                       // the box trailer
  p.profile([[3.4, 1.2], [6.35, 1.2], [6.35, 2.55], [6.0, 3.05], [4.6, 3.1], [4.3, 3.3], [3.4, 3.3]], -1.2, 1.2, 0xe9eaec, FX.paint);   // cab with its roof fairing
  p.face(1, 6.362, -1.05, 1.05, 1.7, 2.5, GLASS);
  p.slope([6.35, 2.55], [6.0, 3.05], 0.05, 0.95, -1.05, 1.05, GLASS);
  p.both(s => p.panel(s, 5.0, 6.2, 1.9, 2.85, 1.205, GLASS));
  p.box(6.35, 6.6, 0.65, 1.2, -1.1, 1.1, BUMP);
  p.both(s => p.decal(s, -6.2, 2.6, 2.05, 3.15, 1.27 + 0.012, ROW.brand));
  p.face(-1, -6.502, -1.2, 1.2, 1.4, 3.9, 0xcfd2d5);                                                           // the rear doors
  p.box(-6.53, -6.5, 1.4, 3.9, -0.02, 0.02, 0x555a60);
  p.box(-6.62, -6.5, 0.75, 1.0, -1.1, 1.1, BUMP);
  p.both(s => { p.box(6.34, 6.42, 0.8, 1.05, s * 0.85 - 0.1, s * 0.85 + 0.1, 0xf2f4ff, FX.head); p.box(-6.56, -6.5, 0.9, 1.3, s * 1.05 - 0.07, s * 1.05 + 0.07, 0xc0161c, FX.tail); });
  p.both(s => p.box(5.85, 6.0, 2.2, 2.6, s * 1.27 - 0.03, s * 1.27 + 0.2 * s, BUMP));
  p.box(5.0, 5.3, 3.3, 3.42, -0.9, 0.9, 0x23272b);                                                             // roof marker bar
  p.both(s => {
    p.box(-4.2, 3.3, 0.7, 1.0, s * 1.05 - 0.03, s * 1.05 + 0.03 + s * 0.17, 0x2a2e33);                         // the side skirt under the box
    p.box(-6.0, 3.6, 3.46, 3.52, s * 1.3 - 0.02, s * 1.3 + 0.06 * s, 0x8c939a);                                // the awning rail along the top of the box
    for (let x = -5.6; x < 3.5; x += 1.8) p.box(x - 0.03, x + 0.03, 3.4, 3.56, s * 1.28 - 0.03, s * 1.28 + 0.1 * s, 0x6a7077);   // its brackets
    p.box(3.4, 3.9, 0.9, 1.1, s * 1.2 - 0.04, s * 1.2 + 0.04, 0x2a2e33);
  });
  p.box(3.5, 3.62, 1.2, 3.7, 1.0, 1.12, CHROME); p.box(3.46, 3.66, 3.7, 3.78, 0.96, 1.16, 0x3a3f44);              // the exhaust stack up the back of the cab
  for (const x of [5.6, 3.9, 2.7, -3.9, -5.1, -6.2]) p.both(s => p.wheel(x, s * 1.0, 0.5, 0.4, s));
  return p;
}

const MODELS = { ambulance, fire, recovery, medical, sweeper, safety, buggy, transport };
const cache = new Map();
export function vehiclePart(type) { if (!cache.has(type)) cache.set(type, MODELS[type]()); return cache.get(type); }
export const VEHICLE_TYPES = Object.keys(MODELS);
export const VEHICLE_TRIS = Object.fromEntries(VEHICLE_TYPES.map(t => [t, vehiclePart(t).tris]));

// the size of a model: the bounding box of its vertices
export function vehicleGeometry(type) {
  const p = vehiclePart(type), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.p.length; k += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.p[k + a]); hi[a] = Math.max(hi[a], p.p[k + a]); }
  return { tris: p.tris, box: { x0: lo[0], x1: hi[0], y0: lo[1], y1: hi[1], z0: lo[2], z1: hi[2] } };
}

// ---- paint --------------------------------------------------------------------------------------------------------------------
// each type's paint colours (hex), picked per vehicle from its seed
const PAINT = {
  ambulance: [0xf4f4f1, 0xf6f3e4],
  fire: [0xc8161c, 0xb81f24, 0xd2231e],
  recovery: [0xffc20e, 0xf5b800],
  medical: [0xf1f2f2, 0xe9edef],
  sweeper: [0xf08a1c, 0xf5a01c],
  safety: [0xdfe3e6],   // silver white with a green stripe, both fixed in safety()
  buggy: [0xf3f1ea, 0xf08a1c, 0x2f6f4a],
  transport: [0xe9eaec, 0x2a3140, 0x7c8186, 0xf1ebe0, 0x1d5f5a, 0x8d1f2e],
};

// ---- baking -------------------------------------------------------------------------------------------------------------------
// One vehicle placed: position, heading and the ground's slope under it, applied to the part's vertices.
function placeMatrix(v, ground) {
  const d = VEHICLES[v.type], c = Math.cos(v.yaw), s = Math.sin(v.yaw), l = d.len * 0.36, w = d.wid * 0.42;
  const h = (u, z) => ground.surfaceHeight(v.x + u * c - z * s, v.z + u * s + z * c);
  const hf = h(l, 0), hr = h(-l, 0), hl = h(0, -w), hrt = h(0, w);
  const gf = (hf - hr) / (2 * l), gr = (hrt - hl) / (2 * w);
  const gx = gf * c + gr * -s, gz = gf * s + gr * c;
  const up = new THREE.Vector3(-gx, 1, -gz).normalize();
  const f = new THREE.Vector3(c, 0, s); f.addScaledVector(up, -f.dot(up)).normalize();
  const r = new THREE.Vector3().crossVectors(f, up);
  const y = (hf + hr + hl + hrt) / 4;
  return new THREE.Matrix4().makeBasis(f, up, r).setPosition(v.x, y, v.z);
}

function seedPick(list, seed, k = 0) { return list[Math.floor((((seed * 2654435761 + k * 40503) >>> 0) / 4294967296) * list.length)]; }

// the flash phase: where in its cycle the lights of this vehicle start, so they do not all blink as one
const phaseOf = seed => ((seed * 2654435761) >>> 0) / 4294967296;

function bakeInto(acc, v, ground) {
  const part = vehiclePart(v.type), M = placeMatrix(v, ground), N = new THREE.Matrix3().getNormalMatrix(M);
  const paint = lin(seedPick(PAINT[v.type], v.colourSeed)), ph = phaseOf(v.colourSeed);
  const brand = BRAND_ROW0 + Math.floor(((v.colourSeed * 40503) >>> 0) % BRANDS.length);
  const P = new THREE.Vector3();
  for (let k = 0; k < part.p.length; k += 9) {
    const t = [0, 1, 2].map(j => P.set(part.p[k + 3 * j], part.p[k + 3 * j + 1], part.p[k + 3 * j + 2]).applyMatrix4(M).toArray());
    const a = new THREE.Vector3(...t[1]).sub(new THREE.Vector3(...t[0])), b = new THREE.Vector3(...t[2]).sub(new THREE.Vector3(...t[0])), n = a.cross(b).normalize();
    void N;
    for (let j = 0; j < 3; j++) {
      const i = k / 3 + j;
      acc.pos.push(...t[j]); acc.nor.push(n.x, n.y, n.z);
      const fx = part.fx[i];
      acc.col.push(...(fx === FX.paint ? paint : [part.c[3 * i], part.c[3 * i + 1], part.c[3 * i + 2]]));
      const row = part.row[i] === ROW.brand ? brand : part.row[i];
      // the atlas row's v range, inset a little; the plain rows sample the middle of row 0
      const vl = row === 0 ? 0.5 : part.v[i] * 0.96 + 0.02;
      acc.uv.push(row === 0 ? 0.5 : part.u[i], 1 - (row + 1 - vl) / ROWS);
      acc.fx.push(fx); acc.ph.push(ph);
    }
  }
}

// ---- material -----------------------------------------------------------------------------------------------------------------
function atlasTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128 * ROWS;
  const x = c.getContext('2d');
  const sans = (w, s) => `${w} ${s}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
  const row = (r, bg, draw) => { x.save(); x.translate(0, r * 128); x.fillStyle = bg; x.fillRect(0, 0, 1024, 128); x.textBaseline = 'middle'; x.textAlign = 'center'; draw(); x.restore(); };
  const text = (t, fg, size = 92, cx = 512, spacing = 6) => { x.font = sans('800', size); x.fillStyle = fg; if ('letterSpacing' in x) x.letterSpacing = spacing + 'px'; x.fillText(t, cx, 68); if ('letterSpacing' in x) x.letterSpacing = '0px'; };
  row(0, '#ffffff', () => {});
  row(ROW.ambulance, '#f4f4f1', () => text('AMBULANCE', '#0b6b3a', 100));
  row(ROW.batten, '#ffffff', () => { for (let r = 0; r < 2; r++) for (let k = 0; k < 16; k++) { x.fillStyle = (k + r) % 2 ? '#ffd400' : '#0a9a4a'; x.fillRect(k * 64, r * 64, 64, 64); } });
  row(ROW.fire, '#c8161c', () => text('FIRE RESCUE', '#ffffff', 96));
  row(ROW.medical, '#f1f2f2', () => { text('MEDICAL', '#0b6b3a', 94, 560); x.fillStyle = '#0b6b3a'; x.fillRect(58, 50, 66, 26); x.fillRect(78, 28, 26, 70); });
  row(ROW.safety, '#15181b', () => text('SAFETY CAR', '#ffd21f', 100));
  row(ROW.recovery, '#ffc20e', () => text('RECOVERY', '#15181b', 100));
  row(ROW.sweeper, '#f08a1c', () => text('TRACK SWEEPER', '#ffffff', 92));
  row(ROW.marshal, '#2f6f4a', () => text('MARSHAL', '#ffffff', 96));
  row(ROW.paddock, '#15181b', () => text('PADDOCK', '#ffd21f', 96));
  BRANDS.forEach((id, k) => row(BRAND_ROW0 + k, '#222', () => { x.fillStyle = '#222'; x.fillRect(0, 0, 1024, 128); }));
  // the brand boards: the venue's sponsor sheet, drawn for the stands, copied row by row (the sheet is drawn on first use)
  const draw = async () => {};
  void draw;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { texture: t, ctx: x };
}

function vehicleMaterial() {
  const uniforms = { uTime: { value: 0 }, uGain: { value: 1 }, uLamp: { value: 0 } };
  const { texture, ctx } = atlasTexture();
  const mat = new THREE.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: 0.62, metalness: 0.12 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFx; attribute float aPh; varying float vFx; varying float vPh;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = aFx; vPh = aPh;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      uniform float uTime; uniform float uGain; uniform float uLamp; varying float vFx; varying float vPh;
      float twin(float t) { float f = fract(t); return step(f, 0.14) + step(0.26, f) * step(f, 0.40); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float on = 0.0;
        if (vFx > 1.5 && vFx < 2.5) on = twin(uTime * 2.4 + vPh);
        else if (vFx > 2.5 && vFx < 3.5) on = twin(uTime * 2.4 + vPh + 0.5);
        else if (vFx > 3.5 && vFx < 4.5) on = step(fract(uTime * 1.3 + vPh), 0.5);
        else if (vFx > 4.5) on = uLamp;
        totalEmissiveRadiance += vColor.rgb * on * uGain * (vFx > 4.5 ? 0.9 : 1.0);
      }`);
  };
  mat.customProgramCacheKey = () => 'service-vehicles';
  onLampLevel(l => { uniforms.uLamp.value = Math.min(1, l * 1.2); uniforms.uGain.value = 1.1 + 2.4 * l; });
  return { mat, uniforms, ctx, texture };
}

// copy the sponsor boards of the venue (src/textures.js) into the brand rows, once the page can draw canvases
function paintBrands(ctx, texture) {
  BRANDS.forEach((id, k) => {
    const b = tex.sponsorBoard(id);
    if (b) ctx.drawImage(b.canvas, 0, b.row * 128, 1024, 128, 0, (BRAND_ROW0 + k) * 128, 1024, 128);
  });
  texture.needsUpdate = true;
}

// ---- the meshes ---------------------------------------------------------------------------------------------------------------
// The planned vehicles as a group of merged meshes (one per 450 m cell of ground), standing on `ground` (its surfaceHeight).
// the mesh a vehicle is merged into: a 450 m cell of ground, so a view only draws the cells it can see
export const cellKey = v => Math.floor(v.x / 450) + ',' + Math.floor(v.z / 450);

export function createVehicleMeshes(plan, ground) {
  const group = new THREE.Group(); group.userData.debug = 'vehicles';
  const cells = new Map();
  for (const v of plan) {
    const key = cellKey(v);
    if (!cells.has(key)) cells.set(key, { pos: [], nor: [], col: [], uv: [], fx: [], ph: [] });
    bakeInto(cells.get(key), v, ground);
  }
  const { mat, uniforms, ctx, texture } = vehicleMaterial();
  paintBrands(ctx, texture);
  let tris = 0;
  for (const acc of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(acc.fx, 1));
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(acc.ph, 1));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false;   // no shadow casting: the sun pass would draw the whole set again (the crowded stretch is at the triangle budget)
    m.userData.debug = 'vehicles';
    m.onBeforeRender = () => { uniforms.uTime.value = performance.now() / 1000; };
    group.add(m);
    tris += acc.pos.length / 9;
  }
  return { group, stats: { vehicles: plan.length, meshes: cells.size, tris }, uniforms };
}

// the one call where the scene is built (src/main.js): plans, builds and adds. keep is scenery.userData.keepClear.
export function addServiceVehicles(scene, T, ground, keep) {
  const plan = planVehicles(T, keep).filter(v => !v.failed);
  const built = createVehicleMeshes(plan, ground);
  scene.add(built.group);
  return { group: built.group, plan, stats: built.stats };
}
