// Cameras. Phase 1 has the chase camera and a bonnet camera (C to switch).
// Cockpit and broadcast cameras come later.

import * as THREE from 'three';

const CHASE_DISTANCE = 6.2;   // metres behind the car
const CHASE_HEIGHT = 1.9;     // metres above it
const CHASE_LAG = 7;          // how quickly the camera swings round behind the car. Lower = lazier.
const BASE_FOV = 60;
const SPEED_FOV = 10;         // extra field of view at top speed

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 6000);
    this.mode = 'chase';
    this.yaw = null;
    this.height = null;
    this._look = new THREE.Vector3();
  }

  next() { this.mode = this.mode === 'chase' ? 'bonnet' : 'chase'; }

  update(view, car, dt) {
    const cam = this.camera, pos = view.root.position;
    const heading = -view.root.rotation.y;
    const pitch = view.slope.rotation.z;

    if (this.mode === 'chase') {
      // swing towards the direction of travel, so slides are visible
      const travel = car.speed > 3 ? Math.atan2(car.vz, car.vx) : heading;
      let want = heading + 0.35 * Math.atan2(Math.sin(travel - heading), Math.cos(travel - heading));
      if (this.yaw === null) this.yaw = want;
      const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += d * Math.min(1, dt * CHASE_LAG);
      if (this.height === null) this.height = pos.y;
      this.height += (pos.y - this.height) * Math.min(1, dt * 4);

      const cx = Math.cos(this.yaw), cz = Math.sin(this.yaw);
      const rise = Math.tan(pitch) * CHASE_DISTANCE;
      cam.position.set(pos.x - cx * CHASE_DISTANCE, this.height + CHASE_HEIGHT - rise * 0.8, pos.z - cz * CHASE_DISTANCE);
      this._look.set(pos.x + cx * 4, pos.y + 0.9 + Math.tan(pitch) * 4, pos.z + cz * 4);
      cam.lookAt(this._look);
    } else {
      const cx = Math.cos(heading), cz = Math.sin(heading);
      cam.position.set(pos.x + cx * 0.6, pos.y + 1.15, pos.z + cz * 0.6);
      this._look.set(pos.x + cx * 20, pos.y + 1.0 + Math.tan(pitch) * 20, pos.z + cz * 20);
      cam.lookAt(this._look);
      this.yaw = null;
    }

    const fov = BASE_FOV + SPEED_FOV * Math.min(1, Math.max(0, car.fwdSpeed) / 75);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
  }
}
