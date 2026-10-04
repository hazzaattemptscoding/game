// The GT car as simple shapes: an extruded side profile for the body, a
// glasshouse, wing, wheels that spin and steer, brake lights and
// headlights. A proper model comes in phase 3.
//
// Local axes: +x forward, +y up, +z right (matches the physics).

import * as THREE from 'three';

export class CarView {
  constructor(cfg, colour = 0xffd21f) {
    this.cfg = cfg;
    this.root = new THREE.Group();     // follows position and heading
    this.slope = new THREE.Group();    // tilts with the road
    this.body = new THREE.Group();     // pitches and rolls with weight transfer
    this.root.add(this.slope);
    this.slope.add(this.body);

    const L = cfg.length, W = cfg.width, r = cfg.wheelRadius;
    const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.3 });
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
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, W - 0.1), dark);
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

    this._q = new THREE.Quaternion();
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
    this.slope.rotation.z = Math.atan(car.loc.grade * along);

    // weight transfer: nose dips under braking, body leans out of corners
    const ax = lerp(p.ax, car.ax), ay = lerp(p.ay, car.ay);
    this.body.rotation.z = THREE.MathUtils.clamp(ax * 0.0018, -0.035, 0.035);
    this.body.rotation.x = THREE.MathUtils.clamp(-ay * 0.0028, -0.05, 0.05);
    this.body.position.y = car.bump ? (Math.random() - 0.5) * 0.02 * car.bump : 0;

    const steer = lerp(p.steer, car.steer), wheel = lerp(p.wheel, car.wheelSpinAngle);
    for (const w of this.wheels) {
      w.steer.rotation.y = w.front ? -steer : 0;
      w.spin.rotation.z = -wheel;
    }

    this.brakeMat.emissiveIntensity = car.brake > 0.05 ? 3 : 0.25;
  }
}
