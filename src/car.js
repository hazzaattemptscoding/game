// The GT car as simple shapes: an extruded side profile for the body, a
// glasshouse, wing, wheels that spin and steer, brake lights and
// headlights. A proper model comes in phase 3.
//
// Local axes: +x forward, +y up, +z right (matches the physics).

import * as THREE from 'three';
import { normaliseLivery, liveryEquals, DEFAULT_LIVERY } from './livery.js';
import { light } from './lamps.js';
import { acquireTextures, releaseTextures, SIDE_W, SIDE_H } from './liveryTex.js';

const VIBRATION = 0.006;   // metres of body movement per unit of surface roughness (rumble is 1.2, gravel 0.6)

// The top line of the body and cab as pieces of (x, y) points from the nose to the tail, with how far the extruded surface
// stands out from the outline there (the bevel size), so stripes can lie on it.
const quad = (p0, c, p1, n) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, v = 1 - u; return [v * v * p0[0] + 2 * v * u * c[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * c[1] + u * u * p1[1]]; });
function stripePieces(L) {
  const f = L / 2, b = -L / 2;
  const body1 = [...quad([f - 0.15, 0.18], [f, 0.2], [f, 0.42], 6), ...quad([f, 0.42], [f - 0.25, 0.62], [f - 1.0, 0.72], 12).slice(1), [0.9, 0.7325]];
  const cab = [...quad([0.9, 0.7], [0.3, 1.15], [-0.3, 1.2], 12), [-1.2, 1.18], ...quad([-1.2, 1.18], [-1.6, 1.05], [-1.7, 0.8], 8).slice(1)];
  const deck = [[-1.7, 0.815], [b + 0.4, 0.82], ...quad([b + 0.4, 0.82], [b, 0.84], [b, 0.6], 8).slice(1)];
  return [{ pts: body1, off: 0.1 }, { pts: cab, off: 0.08 }, { pts: deck, off: 0.1 }];
}

// A ribbon of width w centred at z = zc following the pieces, lifted 8 mm off the surface.
function stripeGeometry(L, zc, w) {
  const pos = [], idx = [];
  for (const { pts, off } of stripePieces(L)) {
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

// Where the side panel sits: between the wheels, on the flat side of the body (x metres, y metres, size).
const SIDE = { x0: -0.8, x1: 1.0, y0: 0.25, y1: 0.65 };

export class CarView {
  // `livery` is a livery object (src/livery.js), or a plain colour number as before.
  constructor(cfg, livery = DEFAULT_LIVERY) {
    livery = typeof livery === 'number' ? { ...DEFAULT_LIVERY, body: livery } : livery;
    this.cfg = cfg;
    this.root = new THREE.Group();     // follows position and heading
    this.slope = new THREE.Group();    // tilts with the road
    this.body = new THREE.Group();     // pitches and rolls with weight transfer
    this.root.add(this.slope);
    this.slope.add(this.body);

    const L = cfg.length, W = cfg.width, r = cfg.wheelRadius;
    const paint = this.paint = new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.35, metalness: 0.3 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.1, metalness: 0.6 });

    // Body: side profile extruded across the width, with rounded edges
    const p = new THREE.Shape();
    const h = 1.0, f = L / 2, b = -L / 2;
    p.moveTo(b, 0.18);
    p.lineTo(f - 0.15, 0.18);
    p.quadraticCurveTo(f, 0.2, f, 0.42);
    p.quadraticCurveTo(f - 0.25, 0.62, f - 1.0, 0.72);   // bonnet
    p.lineTo(b + 0.4, 0.82);                              // deck
    p.quadraticCurveTo(b, 0.84, b, 0.6);
    p.lineTo(b, 0.18);
    const bodyGeo = new THREE.ExtrudeGeometry(p, { depth: W - 0.24, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 8 });
    bodyGeo.translate(0, 0, -(W - 0.24) / 2);
    const shell = new THREE.Mesh(bodyGeo, paint);
    shell.castShadow = true;
    this.body.add(shell);

    // Glasshouse
    const g = new THREE.Shape();
    g.moveTo(0.9, 0.7);
    g.quadraticCurveTo(0.3, 1.15, -0.3, h + 0.2);
    g.lineTo(-1.2, h + 0.18);
    g.quadraticCurveTo(-1.6, 1.05, -1.7, 0.8);
    g.lineTo(0.9, 0.7);
    const cabGeo = new THREE.ExtrudeGeometry(g, { depth: W - 0.7, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
    cabGeo.translate(0, 0, -(W - 0.7) / 2);
    const cab = new THREE.Mesh(cabGeo, glass);
    cab.castShadow = true;
    this.body.add(cab);

    // Rear wing
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, W - 0.1), this.wingMat);
    wing.position.set(b + 0.25, 1.22, 0);
    this.body.add(wing);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.05), dark);
      post.position.set(b + 0.3, 1.02, s * 0.5);
      this.body.add(post);
    }
    // splitter and diffuser
    const split = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, W), dark);
    split.position.set(f - 0.1, 0.16, 0);
    this.body.add(split);

    // Lights
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.2 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.5 });
    for (const s of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.45), this.brakeMat);
      tail.position.set(b - 0.08, 0.62, s * 0.62);
      this.body.add(tail);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.38), this.headMat);
      head.position.set(f - 0.12, 0.5, s * 0.6);
      head.rotation.z = -0.5;
      this.body.add(head);
    }

    // Wheels: tyre with a light rim so the spin is visible
    const tyreGeo = new THREE.CylinderGeometry(r, r, 0.3, 24);
    tyreGeo.rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.31, 6);
    rimGeo.rotateX(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 });
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
    this.body.add(this.decals);
    const sw = SIDE.x1 - SIDE.x0, sh = SIDE.y1 - SIDE.y0, sideGeo = new THREE.PlaneGeometry(sw, sh);
    this.sides = [1, -1].map(sgn => {
      const m = new THREE.Mesh(sideGeo, this.sideMat);
      m.position.set((SIDE.x0 + SIDE.x1) / 2, (SIDE.y0 + SIDE.y1) / 2, sgn * (W / 2 + 0.004));
      if (sgn < 0) m.rotation.y = Math.PI;
      this.decals.add(m);
      return m;
    });
    // number plate on the bonnet, lying on the surface 0.5 m behind the nose, upright for a driver behind the car
    {
      const f = L / 2, u = 0.5, v = 1 - u, c0 = [f, 0.42], c1 = [f - 0.25, 0.62], c2 = [f - 1.0, 0.72];
      const px = v * v * c0[0] + 2 * v * u * c1[0] + u * u * c2[0], py = v * v * c0[1] + 2 * v * u * c1[1] + u * u * c2[1];
      const tx = 2 * v * (c1[0] - c0[0]) + 2 * u * (c2[0] - c1[0]), ty = 2 * v * (c1[1] - c0[1]) + 2 * u * (c2[1] - c1[1]);
      const m = Math.hypot(tx, ty), nx = ty / m, ny = -tx / m;      // outward normal (the tangent runs towards the tail)
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), this.plateMat);
      plate.position.set(px + nx * 0.114, py + ny * 0.114, 0);
      // basis: right = +z, up = towards the nose (along the surface, against the tangent), normal = outward
      plate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-tx / m, -ty / m, 0), new THREE.Vector3(nx, ny, 0)));
      this.plate = plate;
      this.decals.add(plate);
    }
    this.stripes = [new THREE.Mesh(new THREE.BufferGeometry(), this.stripeMat), new THREE.Mesh(new THREE.BufferGeometry(), this.stripeMat)];
    for (const m of this.stripes) { m.visible = false; this.decals.add(m); }
    this._style = -1;
    this.livery = null; this._tex = null;
    this.flat = false;
    this.setLivery(livery);

    this._q = new THREE.Quaternion();
  }

  // Every material of the car, for fading it out (src/ghosts.js) and for disposal.
  materials() {
    const set = new Set();
    this.root.traverse(o => { if (o.isMesh) set.add(o.material); });
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
      const L = this.cfg.length;
      if (l.style === 1) { this.stripes[0].geometry = stripeGeometry(L, 0, 0.34); this.stripes[1].geometry = new THREE.BufferGeometry(); }
      else if (l.style === 2) { this.stripes[0].geometry = stripeGeometry(L, -0.2, 0.1); this.stripes[1].geometry = stripeGeometry(L, 0.2, 0.1); }
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
    this.decals.visible = !flat;
    this.sides.forEach(m => { m.visible = !!this._tex.side; });
    this.plate.visible = !!this._tex.plate;
    for (const m of this.stripes) m.visible = l.style === 1 || l.style === 2;
  }

  dispose() {
    if (this._tex) releaseTextures(this.livery);
    this._tex = null;
    this.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
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

    // road slope along the car
    const along = Math.cos(heading) * car.loc.tx + Math.sin(heading) * car.loc.tz;
    this.slope.rotation.z = Math.atan(car.loc.grade * along) + (car.groundPitch || 0);
    this.slope.rotation.x = -(car.groundRoll || 0);

    // weight transfer: nose dips under braking, body leans out of corners
    const ax = lerp(p.ax, car.ax), ay = lerp(p.ay, car.ay);
    this.body.rotation.z = THREE.MathUtils.clamp(ax * 0.0018, -0.035, 0.035);
    this.body.rotation.x = THREE.MathUtils.clamp(-ay * 0.0028, -0.05, 0.05);
    // vibration from the surface: a smooth wobble, pitched by speed over the bump spacing, a few mm tall
    const now = performance.now() / 1000, dt = Math.min(0.1, now - (this._t || now)); this._t = now;
    this._amp = (this._amp || 0) + ((car.bump || 0) - (this._amp || 0)) * Math.min(1, dt / 0.12);
    const hz = Math.min(32, Math.max(4, Math.abs(car.fwdSpeed) / (car.bumpSpacing || 4)));
    this._ph = ((this._ph || 0) + hz * dt) % 1000;
    car.vibration = this._amp * VIBRATION * (0.65 * Math.sin(this._ph * Math.PI * 2) + 0.35 * Math.sin(this._ph * Math.PI * 2 * 2.31 + 1.3));
    this.body.position.y = car.vibration;

    const steer = lerp(p.steer, car.steer), wheel = lerp(p.wheel, car.wheelSpinAngle);
    for (const w of this.wheels) {
      w.steer.rotation.y = w.front ? -steer : 0;
      w.spin.rotation.z = -wheel;
    }

    this.brakeMat.emissiveIntensity = car.brake > 0.05 ? 3 + 2 * light.night : 0.25 + 1.4 * light.night;   // the tail lights stay on in the dark
    this.headMat.emissiveIntensity = 1.5 + 4 * light.headlamps;
  }
}
