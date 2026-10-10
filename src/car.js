// The car as shapes: an extruded side profile for the GT, smooth lofted skins for the GT1 and the CITY (src/carShapes.js), a
// glasshouse, wing, wheels that spin and steer, lamps. Each car class (src/cars.js, by cfg.id) has its own shape, set out below and
// in src/carShapes.js. GT is the original car and is unchanged.
//
// Local axes: +x forward, +y up, +z right (matches the physics).

import * as THREE from 'three';
import { normaliseLivery, liveryEquals, DEFAULT_LIVERY } from './livery.js';
import { light } from './lamps.js';
import { ease } from './loop.js';
import { acquireTextures, releaseTextures, SIDE_W, SIDE_H } from './liveryTex.js';
import { stepFlap, flapAngle } from './drsFlap.js';
import { cityShape, gt1Shape } from './carShapes.js';

const VIBRATION = 0.006;   // metres of body movement per unit of surface roughness (rumble is 1.2, gravel 0.6)

// A side outline as a path: a start point, then steps. ['L', x, y] is a straight line to (x, y). ['Q', cx, cy, x, y] is a curve
// to (x, y) with control point (cx, cy). A sixth number on a curve is how many points to sample for the livery stripes; the
// extruded body uses the true curve.
function pathShape(p) {
  const s = new THREE.Shape();
  s.moveTo(p.start[0], p.start[1]);
  for (const op of p.ops) {
    if (op[0] === 'L') s.lineTo(op[1], op[2]);
    else s.quadraticCurveTo(op[1], op[2], op[3], op[4]);
  }
  return s;
}

// The points of a path, for the stripes: the start, then each step's points.
function samplePath(p) {
  const pts = [p.start];
  let x0 = p.start[0], y0 = p.start[1];
  for (const op of p.ops) {
    if (op[0] === 'L') { x0 = op[1]; y0 = op[2]; pts.push([x0, y0]); continue; }
    const [, cx, cy, x1, y1, n = 8] = op;
    for (let i = 1; i <= n; i++) {
      const t = i / n, v = 1 - t;
      pts.push([v * v * x0 + 2 * v * t * cx + t * t * x1, v * v * y0 + 2 * v * t * cy + t * t * y1]);
    }
    x0 = x1; y0 = y1;
  }
  return pts;
}

// A ribbon of width w centred at z = zc following the stripe pieces ({ pts, off }), lifted 8 mm off the surface.
function stripeGeometry(pieces, zc, w) {
  const pos = [], idx = [];
  for (const { pts, off } of pieces) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      let tx = c[0] - a[0], ty = c[1] - a[1]; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
      const nx = ty, ny = -tx, d = off + 0.008;
      for (const z of [zc - w / 2, zc + w / 2]) pos.push(pts[i][0] + nx * d, pts[i][1] + ny * d, z);
      if (i) { const k = base + (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A pair of lamps, one each side: p is the right one ([x, y, z]), s its size, rz its tilt about the z axis.
const pair = (p, s, rz = 0) => [{ p, s, rz }, { p: [p[0], p[1], -p[2]], s, rz }];

// The shape of each class. Every one returns the same fields:
//   half      half the body's width (the body's bevel is inside it)
//   cabHalf   half the glasshouse's width
//   body      the closed side outline, extruded across the body. Its bevel makes the car 0.1 m longer than the outline,
//             so outlines stop 0.1 m short of the ends of the car.
//   cab       the closed outline of the glasshouse
//   stripes   the top lines for the livery stripes: { path, off }, off being how far the surface stands out from the line
//   side      the side panel: its centre (x, y) and width (its height follows from the texture)
//   plate     the bonnet number plate: the quadratic bonnet curve (c0, c1, c2), its size and how far it stands off
//   wing      the rear wing: x of the flap's hinge, y, the main plane and flap chords, span, and posts { x, y, z, h }; or null
//   arches    wheel arch flares, each { x, r }: a half disc of radius r about the axle at wheel height, on each side (old style)
//   loft      (CITY, GT1) the body, the greenhouse and the glass as ready-made skins, in place of body and cab (src/carShapes.js)
//   dark      dark parts of the body, each { p, s }: splitter, diffuser, trims
//   tails     the rear lamps, { p, s, rz }, both sides; heads the front lamps, the same shape
// Local x runs from the tail (negative) to the nose (positive), and y is up from the road.

// GT: the original car. Its numbers are unchanged.
function gtShape(c) {
  const L = c.length, W = c.width, f = L / 2, b = -L / 2, h = 1.0;
  return {
    half: W / 2, cabHalf: (W - 0.7) / 2,
    body: { start: [b, 0.18], ops: [['L', f - 0.15, 0.18], ['Q', f, 0.2, f, 0.42], ['Q', f - 0.25, 0.62, f - 1.0, 0.72], ['L', b + 0.4, 0.82], ['Q', b, 0.84, b, 0.6], ['L', b, 0.18]] },
    cab: { start: [0.9, 0.7], ops: [['Q', 0.3, 1.15, -0.3, h + 0.2], ['L', -1.2, h + 0.18], ['Q', -1.6, 1.05, -1.7, 0.8], ['L', 0.9, 0.7]] },
    stripes: [
      { path: { start: [f - 0.15, 0.18], ops: [['Q', f, 0.2, f, 0.42, 6], ['Q', f - 0.25, 0.62, f - 1.0, 0.72, 12], ['L', 0.9, 0.7325]] }, off: 0.1 },
      { path: { start: [0.9, 0.7], ops: [['Q', 0.3, 1.15, -0.3, 1.2, 12], ['L', -1.2, 1.18], ['Q', -1.6, 1.05, -1.7, 0.8, 8]] }, off: 0.08 },
      { path: { start: [-1.7, 0.815], ops: [['L', b + 0.4, 0.82], ['Q', b, 0.84, b, 0.6, 8]] }, off: 0.1 },
    ],
    side: { x: 0.1, y: 0.45, w: 1.8 },
    plate: { c0: [f, 0.42], c1: [f - 0.25, 0.62], c2: [f - 1.0, 0.72], size: 0.44, off: 0.114 },
    wing: { x: b + 0.27, y: 1.22, main: 0.2, flap: 0.22, span: W - 0.1, post: { x: b + 0.3, y: 1.02, z: 0.5, h: 0.38 } },
    arches: [],
    dark: [{ p: [f - 0.1, 0.16, 0], s: [0.4, 0.04, W] }],
    tails: pair([b - 0.08, 0.62, 0.62], [0.05, 0.08, 0.45]),
    heads: pair([f - 0.12, 0.5, 0.6], [0.05, 0.08, 0.38], -0.5),
  };
}

const SHAPES = { GT: gtShape, GT1: gt1Shape, CITY: cityShape };

// The shape of a car class. A config with no id, or an id with no shape of its own, is the GT. One shape per config is kept (the
// shapes are plain numbers and the lofted skins of the GT1 and the CITY, built once however many cars of the class there are).
const specs = new WeakMap();
export function bodySpec(cfg) {
  if (!cfg || typeof cfg !== 'object') return gtShape(cfg);
  let sp = specs.get(cfg);
  if (!sp) specs.set(cfg, sp = (Object.hasOwn(SHAPES, cfg.id) ? SHAPES[cfg.id] : gtShape)(cfg));
  return sp;
}

// The lofted skins are shared by every CarView of a class: counted here, and freed when the last one is disposed.
const skinUsers = new WeakMap();
function takeSkin(sp) { skinUsers.set(sp, (skinUsers.get(sp) || 0) + 1); }
function dropSkin(sp) {
  const n = (skinUsers.get(sp) || 0) - 1;
  skinUsers.set(sp, Math.max(0, n));
  if (n <= 0 && sp.freeLoft) sp.freeLoft();
}

// A remote car is drawn with the simple skin beyond this many metres (THREE.LOD, only for the classes with a lofted skin).
export const GHOST_LOD_DISTANCE = 60;

// Where the side panel's texture is shown: its shape (SIDE_W by SIDE_H pixels).
const SIDE_ASPECT = SIDE_H / SIDE_W;

// The rear wing and the DRS flap (src/drsFlap.js): the flap turns about its hinge, the leading edge where it meets the main plane.
// At rest it is angled up, its trailing edge raised REST_ANGLE (high downforce, high drag); DRS flattens it to the main plane (low
// drag). The hinge sits a little way inside the main plane, so the flap's leading edge is hidden in the main plane at every angle
// and the slot between them stays closed. Both take the livery's wing colour; the underside of the flap and the trailing face of
// the main plane are in a much darker slot colour, so the open slot reads as a gap.
const WING_POST_W = 0.1, WING_POST_T = 0.05;
const SLOT = new THREE.Color(0x060708);   // the slot faces' own colour

// A wing box (main plane or flap) in one material: a colour attribute (white, a tint of the wing colour) and the slot face dark. The
// slot face's colour is set by slotColours() from the wing's colour, so it stays the same dark whatever the livery.
function wingBox(w, h, d, slotFace) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.clearGroups();
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  g.userData.slotFace = slotFace;
  return g;
}
function slotColours(g, wing) {
  const col = g.attributes.color, f = g.userData.slotFace;
  const k = (a, b) => b > 1e-5 ? Math.min(1, a / b) : 1;
  for (let v = f * 4; v < f * 4 + 4; v++) col.setXYZ(v, k(SLOT.r, wing.r), k(SLOT.g, wing.g), k(SLOT.b, wing.b));
  col.needsUpdate = true;
}
const HINGE_SINK = 0.03;     // how far the flap's hinge sits inside the main plane, metres

export class CarView {
  // `livery` is a livery object (src/livery.js), or a plain colour number as before.
  // `ghost` is for a remote car: it casts no shadow and swaps to a simple skin at a distance.
  constructor(cfg, livery = DEFAULT_LIVERY, { ghost = false } = {}) {
    livery = typeof livery === 'number' ? { ...DEFAULT_LIVERY, body: livery } : livery;
    this.cfg = cfg;
    this.spec = bodySpec(cfg);
    const sp = this.spec;
    this.root = new THREE.Group();     // follows position and heading
    this.slope = new THREE.Group();    // tilts with the road
    this.body = new THREE.Group();     // pitches and rolls with weight transfer
    this.root.add(this.slope);
    this.slope.add(this.body);
    const hull = this.hull = new THREE.Group();     // the car's parts, moved along the body so the overhangs are right
    hull.position.x = sp.dx || 0;
    this.body.add(hull);

    const W = cfg.width, r = cfg.wheelRadius;
    const paint = this.paint = new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.35, metalness: 0.3 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.2 });
    this.wingFaceMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.2, vertexColors: true });   // the main plane and the flap
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial(sp.glass || { color: 0x14181d, roughness: 0.1, metalness: 0.6 });

    // Body: the side profile extruded across the width with rounded edges, or (CITY, GT1) a lofted skin
    let shell, cabMesh, glassMesh = null;
    this._sharedSkin = null; this._skinGeos = new Set();   // the skins this car takes from its class (freed by the class, not by the car)
    if (sp.loft) {
      takeSkin(sp);
      this._sharedSkin = sp;
      for (const g of Object.values(sp.loft)) this._skinGeos.add(g);
      shell = new THREE.Mesh(sp.loft.body, paint);
      cabMesh = new THREE.Mesh(sp.loft.cab, paint);
      glassMesh = new THREE.Mesh(sp.loft.glass, glass);
    } else {
      const depth = 2 * sp.half - 0.24;
      const bodyGeo = new THREE.ExtrudeGeometry(pathShape(sp.body), { depth, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 8 });
      bodyGeo.translate(0, 0, -depth / 2);
      shell = new THREE.Mesh(bodyGeo, paint);
      // Glasshouse
      const cabDepth = 2 * sp.cabHalf;
      const cabGeo = new THREE.ExtrudeGeometry(pathShape(sp.cab), { depth: cabDepth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
      cabGeo.translate(0, 0, -cabDepth / 2);
      cabMesh = new THREE.Mesh(cabGeo, glass);
    }
    shell.castShadow = true;
    cabMesh.castShadow = true;
    if (ghost && sp.loftLow) {
      // near: the full skin; beyond GHOST_LOD_DISTANCE: the same shape in a sixth of the triangles, in the same materials
      const lod = new THREE.LOD(), near = new THREE.Group(), far = new THREE.Group();
      for (const g of Object.values(sp.loftLow)) this._skinGeos.add(g);
      near.add(shell, cabMesh, glassMesh);
      far.add(new THREE.Mesh(sp.loftLow.body, paint), new THREE.Mesh(sp.loftLow.cab, paint), new THREE.Mesh(sp.loftLow.glass, glass));
      lod.addLevel(near, 0);
      lod.addLevel(far, GHOST_LOD_DISTANCE);
      hull.add(lod);
    } else {
      hull.add(shell);
      hull.add(cabMesh);
      if (glassMesh) hull.add(glassMesh);
    }

    // Rear wing, when the class has one (the flap is the DRS flap: the flapPivot takes its angle in update)
    this._wingSlots = [];     // the wing boxes with a slot face (see wingBox and _paint)
    this.wing = null; this.flapPivot = null;
    if (sp.wing) {
      const wg = sp.wing;
      this.wing = new THREE.Group();
      hull.add(this.wing);
      // the main plane and the flap are one material each, with the dark slot faces in vertex colours (a box with six materials is six draws)
      const main = new THREE.Mesh(wingBox(wg.main, 0.05, wg.span, 1), this.wingFaceMat);
      main.position.set(wg.x + wg.main / 2, wg.y, 0);
      this.wing.add(main);
      this.flapPivot = new THREE.Group();
      this.flapPivot.position.set(wg.x + HINGE_SINK, wg.y, 0);
      const flap = new THREE.Mesh(wingBox(wg.flap, 0.035, wg.span, 3), this.wingFaceMat);
      this._wingSlots.push(main.geometry, flap.geometry);
      flap.position.set(-wg.flap / 2, 0, 0);
      this.flapPivot.add(flap);
      this.wing.add(this.flapPivot);
      if (wg.plate) {                  // end plates on the main plane
        for (const sd of [-1, 1]) {
          const ep = new THREE.Mesh(new THREE.BoxGeometry(wg.plate.len, wg.plate.h, 0.02), this.wingMat);
          ep.position.set(wg.x - wg.flap / 2 + wg.plate.len / 2 - 0.05, wg.y + 0.02, sd * (wg.span / 2));
          this.wing.add(ep);
        }
      }
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(WING_POST_W, wg.post.h, WING_POST_T), dark);
        post.position.set(wg.post.x, wg.post.y, s * wg.post.z);
        this.wing.add(post);
      }
    }
    this._flap = 0;     // 0 at rest (angled), 1 open and flat (src/drsFlap.js)

    // Wheel arch flares: a half disc on each side over the wheel, in the body colour, standing out from the flatter body side
    for (const a of sp.arches || []) {
      const shape = new THREE.Shape();
      shape.moveTo(-a.r, 0);
      shape.absarc(0, 0, a.r, Math.PI, 0, true);     // the top half, from one side to the other
      const z0 = sp.half - 0.16, zd = W / 2 - z0;     // out to the car's full width, so the tyre sits inside the flare
      for (const s of [-1, 1]) {
        const geo = new THREE.ExtrudeGeometry(shape, { depth: zd, bevelEnabled: false });
        geo.translate(a.x, r, s > 0 ? z0 : -W / 2);
        const flare = new THREE.Mesh(geo, paint);
        flare.castShadow = true;
        hull.add(flare);
      }
    }

    // Dark parts: splitter, diffuser and trims
    for (const d of sp.dark) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.s[0], d.s[1], d.s[2]), d.paint ? paint : dark);
      m.position.set(d.p[0], d.p[1], d.p[2]);
      m.rotation.set(0, d.ry || 0, d.rz || 0, 'YXZ');
      hull.add(m);
    }
    // Wheel liners: the dark inside of each wheel arch, behind the tyre
    const linerMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9, side: THREE.DoubleSide });
    for (const l of sp.liners || []) {
      const shape = new THREE.Shape();
      shape.moveTo(-l.R, l.floor - l.y);
      shape.lineTo(-l.R, 0);
      shape.absarc(0, 0, l.R, Math.PI, 0, true);
      shape.lineTo(l.R, l.floor - l.y);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 16), linerMat);
      m.position.set(l.x, l.y, l.z);
      hull.add(m);
    }

    // Lights
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.2 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.5 });
    for (const t of sp.tails) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(t.s[0], t.s[1], t.s[2]), this.brakeMat);
      tail.position.set(t.p[0], t.p[1], t.p[2]);
      tail.rotation.set(0, t.ry || 0, t.rz || 0, 'YXZ');
      hull.add(tail);
    }
    for (const hd of sp.heads) {
      let geo = new THREE.BoxGeometry(hd.s[0], hd.s[1], hd.s[2]);
      if (hd.disc) { geo = new THREE.CylinderGeometry(1, 1, 1, 20); geo.rotateZ(Math.PI / 2); geo.scale(hd.s[0], hd.s[1] / 2, hd.s[2] / 2); }     // an oval lamp, its axis along the car
      const head = new THREE.Mesh(geo, this.headMat);
      head.position.set(hd.p[0], hd.p[1], hd.p[2]);
      head.rotation.set(0, hd.ry || 0, hd.rz || 0, 'YXZ');
      hull.add(head);
    }

    // Wheels: tyre with a light rim so the spin is visible
    const tw = sp.tyreW || 0.3;
    const tyreGeo = new THREE.CylinderGeometry(r, r, tw, 24);
    tyreGeo.rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, sp.tyreW ? tw + 0.01 : 0.31, 6);
    rimGeo.rotateX(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial(sp.rim || { color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 });
    this.wheels = [];
    const a = cfg.wheelbase * (1 - cfg.frontWeight), bb = cfg.wheelbase * cfg.frontWeight;
    for (const [x, z, front] of [[a, -1, true], [a, 1, true], [-bb, -1, false], [-bb, 1, false]]) {
      const steer = new THREE.Group();
      steer.position.set(x, r, z * cfg.trackWidth / 2);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      spin.add(tyre, new THREE.Mesh(rimGeo, rimMat));
      steer.add(spin);
      this.slope.add(steer);  // wheels stay on the road while the body rolls
      this.wheels.push({ steer, spin, front });
    }

    // Decals: a side panel on each side, a number plate on the bonnet and stripe ribbons along the top. Always present,
    // shown or hidden by setLivery, so the materials never change and a remote car's fade out keeps working.
    const decal = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.4, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, ...extra });
    this.sideMat = decal(null); this.plateMat = decal(null);
    this.stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const m of [this.sideMat, this.plateMat]) m.userData.alpha = true;
    this.decals = new THREE.Group();
    hull.add(this.decals);
    const sw = sp.side.w, sh = sw * SIDE_ASPECT, sideGeo = new THREE.PlaneGeometry(sw, sh);
    this.sides = [1, -1].map(sgn => {
      const m = new THREE.Mesh(sideGeo, this.sideMat);
      m.position.set(sp.side.x, sp.side.y, sgn * (sp.half + 0.004));
      if (sgn < 0) m.rotation.y = Math.PI;
      this.decals.add(m);
      return m;
    });
    // number plate on the bonnet, lying on the surface half way along the bonnet curve, upright for a driver behind the car
    {
      const pl = sp.plate, u = 0.5, v = 1 - u, c0 = pl.c0, c1 = pl.c1, c2 = pl.c2;
      const px = v * v * c0[0] + 2 * v * u * c1[0] + u * u * c2[0], py = v * v * c0[1] + 2 * v * u * c1[1] + u * u * c2[1];
      const tx = 2 * v * (c1[0] - c0[0]) + 2 * u * (c2[0] - c1[0]), ty = 2 * v * (c1[1] - c0[1]) + 2 * u * (c2[1] - c1[1]);
      const m = Math.hypot(tx, ty), nx = ty / m, ny = -tx / m;      // outward normal (the tangent runs towards the tail)
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(pl.size, pl.size), this.plateMat);
      plate.position.set(px + nx * pl.off, py + ny * pl.off, 0);
      // basis: right = +z, up = towards the nose (along the surface, against the tangent), normal = outward
      plate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-tx / m, -ty / m, 0), new THREE.Vector3(nx, ny, 0)));
      this.plate = plate;
      this.decals.add(plate);
    }
    this._pieces = sp.stripes.map(({ path, pts, off }) => ({ pts: pts || samplePath(path), off }));
    this.stripes = [new THREE.Mesh(new THREE.BufferGeometry(), this.stripeMat), new THREE.Mesh(new THREE.BufferGeometry(), this.stripeMat)];
    for (const m of this.stripes) { m.visible = false; this.decals.add(m); }
    this._style = -1;
    this.livery = null; this._tex = null;
    this.flat = false;
    this.setLivery(livery);

    if (ghost) this.root.traverse(o => { if (o.isMesh) o.castShadow = false; });   // a remote car casts no shadow (the shadow pass is the dearer part of a car)
    this._q = new THREE.Quaternion();
  }

  // Every material of the car, for fading it out (src/ghosts.js) and for disposal.
  materials() {
    const set = new Set();
    this.root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => set.add(m)); });
    return [...set];
  }

  // Repaint: body, wing and stripe colours, the stripe style, the race number and the sponsor. Cheap when nothing changed.
  setLivery(raw) {
    const l = normaliseLivery(typeof raw === 'number' ? { ...DEFAULT_LIVERY, body: raw } : raw);
    if (this.livery && liveryEquals(this.livery, l)) return;
    const next = acquireTextures(l);
    if (this._tex) releaseTextures(this.livery);
    this._tex = next;
    this.livery = l;
    this.sideMat.map = next.side; this.sideMat.needsUpdate = true;
    this.plateMat.map = next.plate; this.plateMat.needsUpdate = true;
    this.stripeMat.color.set(l.stripe);
    if (l.style !== this._style) {
      for (const m of this.stripes) m.geometry.dispose();
      if (l.style === 1) { this.stripes[0].geometry = stripeGeometry(this._pieces, 0, 0.34); this.stripes[1].geometry = new THREE.BufferGeometry(); }
      else if (l.style === 2) { this.stripes[0].geometry = stripeGeometry(this._pieces, -0.2, 0.1); this.stripes[1].geometry = stripeGeometry(this._pieces, 0.2, 0.1); }
      else { this.stripes[0].geometry = new THREE.BufferGeometry(); this.stripes[1].geometry = new THREE.BufferGeometry(); }
      this._style = l.style;
    }
    this._paint();
  }

  // Blockout view: flat colours, the body colour only (no decals, stripes or coloured wing).
  setFlat(on) {
    if (this.flat === !!on) return;
    this.flat = !!on;
    this._paint();
  }

  _paint() {
    const l = this.livery, flat = this.flat;
    this.paint.color.set(l.body);
    this.wingMat.color.set(flat ? '#1b1d20' : l.wing);
    this.wingFaceMat.color.copy(this.wingMat.color);
    for (const g of this._wingSlots) slotColours(g, this.wingMat.color);
    this.decals.visible = !flat;
    this.sides.forEach(m => { m.visible = !!this._tex.side; });
    this.plate.visible = !!this._tex.plate;
    for (const m of this.stripes) m.visible = l.style === 1 || l.style === 2;
  }

  dispose() {
    if (this._tex) releaseTextures(this.livery);
    this._tex = null;
    // the lofted skins belong to the class (bodySpec): freed with the last car that uses them
    this.root.traverse(o => { if (o.isMesh && !this._skinGeos.has(o.geometry)) o.geometry.dispose(); });
    if (this._sharedSkin) { dropSkin(this._sharedSkin); this._sharedSkin = null; }
    for (const m of this.materials()) m.dispose();
  }

  // Place the model at the physics state, blended between the last two steps.
  update(car, alpha) {
    const p = car.prev, lerp = (a, b) => a + (b - a) * alpha;
    let dh = car.heading - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const heading = p.heading + dh * alpha;
    this.root.position.set(lerp(p.x, car.x), lerp(p.y, car.y), lerp(p.z, car.z));
    this.root.rotation.y = -heading;

    // the ground's slope under the wheels (physics.js works it out from the ground under each one)
    this.slope.rotation.z = car.groundPitch || 0;
    this.slope.rotation.x = -(car.groundRoll || 0);

    // weight transfer: nose dips under braking, body leans out of corners
    const ax = lerp(p.ax, car.ax), ay = lerp(p.ay, car.ay);
    this.body.rotation.z = THREE.MathUtils.clamp(ax * 0.0018, -0.035, 0.035);
    this.body.rotation.x = THREE.MathUtils.clamp(-ay * 0.0028, -0.05, 0.05);
    // vibration from the surface: a smooth wobble, pitched by speed over the bump spacing, a few mm tall
    const now = performance.now() / 1000, dt = Math.min(0.1, now - (this._t || now)); this._t = now;
    this._amp = (this._amp || 0) + ((car.bump || 0) - (this._amp || 0)) * ease(1 / 0.12, dt);
    const hz = Math.min(32, Math.max(4, Math.abs(car.fwdSpeed) / (car.bumpSpacing || 4)));
    this._ph = ((this._ph || 0) + hz * dt) % 1000;
    car.vibration = this._amp * VIBRATION * (0.65 * Math.sin(this._ph * Math.PI * 2) + 0.35 * Math.sin(this._ph * Math.PI * 2 * 2.31 + 1.3));
    this.body.position.y = car.vibration;

    // DRS flap: eases flat while the car's DRS is on and back to its angled rest position otherwise. Remote cars get the flag from
    // their packets (src/ghosts.js). A class with no rear wing has no flap to move.
    this._flap = stepFlap(this._flap, car.drs ? 1 : 0, dt);
    if (this.flapPivot) this.flapPivot.rotation.z = -flapAngle(this._flap);     // negative z lifts the trailing edge (the flap's tail is at -x); 0 when open

    const steer = lerp(p.steer, car.steer), wheel = lerp(p.wheel, car.wheelSpinAngle);
    for (const w of this.wheels) {
      w.steer.rotation.y = w.front ? -steer : 0;
      w.spin.rotation.z = -wheel;
    }

    this.brakeMat.emissiveIntensity = car.brake > 0.05 ? 3 + 2 * light.night : 0.25 + 1.4 * light.night;   // the tail lights stay on in the dark
    this.headMat.emissiveIntensity = 1.5 + 4 * light.headlamps;
  }
}
