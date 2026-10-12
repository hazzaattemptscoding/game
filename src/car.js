// The car as shapes: a smooth lofted skin for each class (src/carShapes.js: the GT is a GT4 coupe, the GT1 after the DBR9, the
// CITY a Peugeot 108), a glasshouse, wing, wheels that spin and steer, lamps. Each car class (src/cars.js, by cfg.id) has its own
// shape in src/carShapes.js; the fields every shape gives are listed below.
//
// Local axes: +x forward, +y up, +z right (matches the physics).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normaliseLivery, liveryEquals, DEFAULT_LIVERY } from './livery.js';
import { light, reflections } from './lamps.js';
import { addNightLight } from './nightLight.js';
import { ease } from './loop.js';
import { acquireTextures, releaseTextures, SIDE_W, SIDE_H } from './liveryTex.js';
import { stepFlap, flapAngle } from './drsFlap.js';
import { cityShape, gt1Shape, gt4Shape } from './carShapes.js';
import { GT } from './cars.js';

const VIBRATION = 0.006;   // metres of body movement per unit of surface roughness (rumble is 1.2, gravel 0.6)

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

// The shape of each class (src/carShapes.js). Every one returns the same fields:
//   half      half the body's width at the doors, where the side panel sits
//   loft      the body, the greenhouse and the glass as ready-made skins (and loftLow, the same in fewer triangles)
//   stripes   the top lines for the livery stripes: { pts, off }, off being how far the surface stands out from the line
//   side      the side panel: its centre (x, y) and width (its height follows from the texture)
//   plate     the bonnet number plate: the quadratic bonnet curve (c0, c1, c2), its size and how far it stands off
//   wing      the rear wing: x of the flap's hinge, y, the main plane and flap chords, span, and posts { x, y, z, h }; or null
//   dark      dark parts of the body, each { p, s }: splitter, diffuser, trims
//   tails     the rear lamps, { p, s, rz }, both sides; heads the front lamps, the same shape
//   liners    the dark liner behind each wheel; tyreW, rim and glass: the wheels and the glass
// Local x runs from the tail (negative) to the nose (positive), and y is up from the road.

const SHAPES = { GT: gt4Shape, GT1: gt1Shape, CITY: cityShape };

// The shape of a car class. A config with no id, or an id with no shape of its own, is the GT. One shape per config is kept (the
// shapes are plain numbers and lofted skins, built once however many cars of the class there are).
const specs = new WeakMap();
export function bodySpec(cfg) {
  if (!cfg || typeof cfg !== 'object') cfg = GT;
  let sp = specs.get(cfg);
  if (!sp) specs.set(cfg, sp = (Object.hasOwn(SHAPES, cfg.id) ? SHAPES[cfg.id] : gt4Shape)(cfg));
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

// A geometry moved into place: at p, turned ry about the vertical and then rz about the car's width (the order the shapes give).
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
function placed(g, p, ry = 0, rz = 0) {
  return g.applyMatrix4(_m4.compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(0, ry, rz, 'YXZ')), _one));
}
// A part from a shape's list ({ p, s, ry, rz }): a box, or with `disc` an oval lamp with its axis along the car.
function part(d) {
  let g;
  if (d.disc) { g = new THREE.CylinderGeometry(1, 1, 1, 20); g.rotateZ(Math.PI / 2); g.scale(d.s[0], d.s[1] / 2, d.s[2] / 2); }
  else g = new THREE.BoxGeometry(d.s[0], d.s[1], d.s[2]);
  return placed(g, d.p, d.ry || 0, d.rz || 0);
}
// The dark liner behind a wheel: from the floor up round the arch.
function linerGeometry(l) {
  const shape = new THREE.Shape();
  shape.moveTo(-l.R, l.floor - l.y);
  shape.lineTo(-l.R, 0);
  shape.absarc(0, 0, l.R, Math.PI, 0, true);
  shape.lineTo(l.R, l.floor - l.y);
  return new THREE.ShapeGeometry(shape, 16).translate(l.x, l.y, l.z);
}

// One wheel's geometry (the four wheels of a car share it), its axle along z and the outside towards +z.
//   tyre     a lathe: bead, sidewall, rounded shoulder, tread, and back
//   rim      the barrel, the lip, the spokes, the hub and the centre lock, and the brake disc behind them, coloured by vertex
//   caliper  a block over the rear top of the disc, between the disc and the spokes
// `low`: a remote car's wheels, in fewer segments (they are seldom close).
function wheelParts(sp, r, tw, low = false) {
  const hw = tw / 2, ri = r * 0.64, seg = low ? 18 : 32, round = low ? 16 : 28;
  const prof = [[ri, -hw * 0.86], [r * 0.8, -hw], [r * 0.93, -hw * 0.97], [r * 0.985, -hw * 0.82], [r, -hw * 0.55], [r, hw * 0.55], [r * 0.985, hw * 0.82], [r * 0.93, hw * 0.97], [r * 0.8, hw], [ri, hw * 0.86]];
  const tyre = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg).rotateX(Math.PI / 2);
  const rimCol = new THREE.Color(sp.rim.color), disc = new THREE.Color(0x6e7175), dim = rimCol.clone().multiplyScalar(0.45), nut = new THREE.Color(sp.rim.nut ?? 0x1c1d20);
  const paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const face = hw * 0.72, n = sp.spokes || 5, rr = ri * 0.98;
  const pieces = [
    paint(new THREE.CylinderGeometry(rr, rr, tw * 0.8, round, 1, true).rotateX(Math.PI / 2), dim),                           // the barrel
    paint(new THREE.RingGeometry(rr * 0.84, rr, round).translate(0, 0, face + 0.012), rimCol),                               // the lip
    paint(new THREE.CylinderGeometry(rr * 0.25, rr * 0.28, 0.05, 16).rotateX(Math.PI / 2).translate(0, 0, face), rimCol),   // the hub
    paint(new THREE.CylinderGeometry(rr * 0.11, rr * 0.11, 0.05, 6).rotateX(Math.PI / 2).translate(0, 0, face + 0.02), nut), // the centre lock
    paint(new THREE.CylinderGeometry(rr * 0.8, rr * 0.8, 0.03, round).rotateX(Math.PI / 2).translate(0, 0, -hw * 0.1), disc),  // the brake disc
  ];
  const sw = (sp.spokeW || 0.12) * rr;
  for (let k = 0; k < n; k++) {
    const g = new THREE.BoxGeometry(rr * 0.66, sw, 0.035).translate(rr * 0.55, 0, face);
    g.rotateZ(k / n * Math.PI * 2);
    pieces.push(paint(g, rimCol));
  }
  const rim = mergeGeometries(pieces.map(g => g.index ? g.toNonIndexed() : g));
  const ang = Math.PI * 0.78, cr = rr * 0.66;
  const caliper = new THREE.BoxGeometry(rr * 0.42, rr * 0.2, Math.min(0.06, hw * 0.3)).rotateZ(ang - Math.PI / 2).translate(Math.cos(ang) * cr, Math.sin(ang) * cr, hw * 0.18);
  return { tyre, rim, caliper };
}

export class CarView {
  // `livery` is a livery object (src/livery.js), or a plain colour number as before.
  // `ghost` is for a remote car: it casts no shadow and swaps to a simple skin at a distance.
  // `studio`: a car shown in a scene of its own (the garage), not on the circuit: no floodlight at night.
  constructor(cfg, livery = DEFAULT_LIVERY, { ghost = false, studio = false } = {}) {
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
    // paint under a clear coat: the base colour is a little rough, the lacquer on top is glossy and shows the sky (src/lamps.js reflections)
    const paint = this.paint = new THREE.MeshPhysicalMaterial({ color: 0xffd21f, roughness: 0.42, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.07 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.2 });
    this.wingFaceMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.2, vertexColors: true });   // the main plane and the flap
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial(sp.glass);

    // Body: the class's lofted skins, shared by every car of the class
    this._skinGeos = new Set();   // the skins this car takes from its class (freed by the class, not by the car)
    takeSkin(sp);
    this._sharedSkin = sp;
    for (const g of Object.values(sp.loft)) this._skinGeos.add(g);
    const shell = new THREE.Mesh(sp.loft.body, paint), cabMesh = new THREE.Mesh(sp.loft.cab, paint), glassMesh = new THREE.Mesh(sp.loft.glass, glass);
    shell.castShadow = true;
    cabMesh.castShadow = true;
    if (ghost) {
      // near: the full skin; beyond GHOST_LOD_DISTANCE: the same shape in a sixth of the triangles, in the same materials
      const lod = new THREE.LOD(), near = new THREE.Group(), far = new THREE.Group();
      for (const g of Object.values(sp.loftLow)) this._skinGeos.add(g);
      near.add(shell, cabMesh, glassMesh);
      far.add(new THREE.Mesh(sp.loftLow.body, paint), new THREE.Mesh(sp.loftLow.cab, paint), new THREE.Mesh(sp.loftLow.glass, glass));
      lod.addLevel(near, 0);
      lod.addLevel(far, GHOST_LOD_DISTANCE);
      hull.add(lod);
    } else {
      hull.add(shell, cabMesh, glassMesh);
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
      if (wg.plate) {                  // end plates on the main plane, both in one mesh
        const ends = [-1, 1].map(sd => placed(new THREE.BoxGeometry(wg.plate.len, wg.plate.h, 0.02), [wg.x - wg.flap / 2 + wg.plate.len / 2 - 0.05, wg.y + 0.02, sd * (wg.span / 2)]));
        this.wing.add(new THREE.Mesh(mergeGeometries(ends), this.wingMat));
      }
    }
    this._flap = 0;     // 0 at rest (angled), 1 open and flat (src/drsFlap.js)

    // The small parts, one mesh a material: the dark trim (splitter, diffuser, vents, the wing's posts), the body coloured bits
    // (mirrors), the liners behind the wheels and the lamps. A car is drawn several times a frame (its own and other players'),
    // so a part that is not a mesh of its own is a draw call saved.
    const merged = (geos, mat, cast = false) => {
      if (!geos.length) return null;
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = cast;
      hull.add(m);
      return m;
    };
    const darkGeos = [], paintGeos = [];
    if (sp.wing) for (const s of [-1, 1]) darkGeos.push(placed(new THREE.BoxGeometry(WING_POST_W, sp.wing.post.h, WING_POST_T), [sp.wing.post.x, sp.wing.post.y, s * sp.wing.post.z]));
    for (const d of sp.dark) (d.paint ? paintGeos : darkGeos).push(part(d));
    merged(darkGeos, dark);
    merged(paintGeos, paint, true);
    const linerMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9, side: THREE.DoubleSide });
    this.liners = merged((sp.liners || []).map(linerGeometry), linerMat);
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.2, roughness: 0.25 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.5, roughness: 0.2 });
    merged(sp.tails.map(part), this.brakeMat);
    merged(sp.heads.map(part), this.headMat);

    // Wheels: a tyre with rounded shoulders, a rim (lip, spokes, centre lock) with the brake disc behind it, and on your own car a
    // caliper that turns with the steering but does not spin. The rim's colours are vertex colours, so rim and disc are one draw.
    const tw = sp.tyreW || 0.3;
    const wp = wheelParts(sp, r, tw, ghost);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.88 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: sp.rim.roughness ?? 0.35, metalness: sp.rim.metalness ?? 0.6, vertexColors: true });
    const caliperMat = new THREE.MeshStandardMaterial({ color: sp.caliper ?? 0xc8102e, roughness: 0.4, metalness: 0.2 });
    this.wheels = [];
    const a = cfg.wheelbase * (1 - cfg.frontWeight), bb = cfg.wheelbase * cfg.frontWeight;
    for (const [x, z, front] of [[a, -1, true], [a, 1, true], [-bb, -1, false], [-bb, 1, false]]) {
      const steer = new THREE.Group();
      steer.position.set(x, r, z * cfg.trackWidth / 2);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(wp.tyre, tyreMat);
      tyre.castShadow = true;
      const rim = new THREE.Mesh(wp.rim, rimMat);
      if (z < 0) rim.rotation.y = Math.PI;     // the spokes face outwards on both sides
      spin.add(tyre, rim);
      steer.add(spin);
      if (!ghost) {
        const cal = new THREE.Mesh(wp.caliper, caliperMat);
        if (z < 0) cal.rotation.y = Math.PI;
        steer.add(cal);
      }
      this.slope.add(steer);  // wheels stay on the road while the body rolls
      this.wheels.push({ steer, spin, front });
    }

    // Decals: a side panel on each side, a number plate on the bonnet and stripe ribbons along the top. Always present,
    // shown or hidden by setLivery, so the materials never change and a remote car's fade out keeps working.
    const decal = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.4, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, ...extra });
    this.sideMat = decal(null); this.plateMat = decal(null);
    this.stripeMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.42, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.07, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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
    this._pieces = sp.stripes.map(({ pts, off }) => ({ pts, off }));
    this.stripes = [new THREE.Mesh(new THREE.BufferGeometry(), this.stripeMat), new THREE.Mesh(new THREE.BufferGeometry(), this.stripeMat)];
    for (const m of this.stripes) { m.visible = false; this.decals.add(m); }
    this._style = -1;
    this.livery = null; this._tex = null;
    this.flat = false;
    this.setLivery(livery);

    if (ghost) this.root.traverse(o => { if (o.isMesh) o.castShadow = false; });   // a remote car casts no shadow (the shadow pass is the dearer part of a car)
    this._q = new THREE.Quaternion();

    // how strongly each part reflects the sky: lacquer and glass most, rubber hardly at all
    this._envMats = [[paint, 1], [this.stripeMat, 1], [glass, 1.3], [this.wingMat, 0.6], [this.wingFaceMat, 0.6], [dark, 0.45], [rimMat, 1],
      [tyreMat, 0.12], [this.sideMat, 0.8], [this.plateMat, 0.8], [this.brakeMat, 0.6], [this.headMat, 0.6]];
    this._envV = -1; this._ownEnv = false;
    if (!studio) for (const m of this.materials()) addNightLight(m);   // the floodlights light the car at night (src/nightLight.js)
  }

  // The environment map the car reflects. Cars in the world follow the shared sky (src/lamps.js reflections, made by
  // src/environment.js for the time and weather) by themselves; a car in its own scene (the garage) is given one here.
  setEnvironment(map, own = true) {
    this._ownEnv = own;
    for (const [m, k] of this._envMats) {
      if (!!m.envMap !== !!map) m.needsUpdate = true;
      m.envMap = map || null; m.envMapIntensity = k;
    }
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
    if (!this._ownEnv && this._envV !== reflections.version) { this._envV = reflections.version; this.setEnvironment(reflections.map, false); }
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
