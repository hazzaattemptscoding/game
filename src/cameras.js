// Cameras. Phase 1 has the chase camera and a bonnet camera (C to switch).
// Cockpit and broadcast cameras come later.

import * as THREE from 'three';
import { ease } from './loop.js';

const CHASE_DISTANCE = 6.2;   // metres behind the car
const CHASE_HEIGHT = 1.9;     // metres above it
const CHASE_LAG = 7;          // how quickly the camera swings round behind the car. Lower = lazier.
const BASE_FOV = 60;
const SPEED_FOV = 10;         // extra field of view at top speed
// Free look (Settings > Display): drag with the mouse or push the right stick to look round the car; let go and it eases back.
const LOOK_YAW = Math.PI;     // as far round as it goes either way (behind to in front)
const LOOK_PITCH = [-0.15, 0.7];
const LOOK_RETURN = 4;        // how quickly it settles back behind the car
const STICK_DEAD = 0.18;

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.5, 2600);
    this.mode = 'chase';
    this.yaw = null;
    this.height = null;
    this._look = new THREE.Vector3();
    this.lookYaw = 0; this.lookPitch = 0;   // free look offsets, radians
    this.dragging = false; this.stick = [0, 0];
  }

  // mouse drag: dx, dy in pixels
  drag(dx, dy) {
    this.lookYaw = Math.max(-LOOK_YAW, Math.min(LOOK_YAW, this.lookYaw + dx * 0.006));
    this.lookPitch = Math.max(LOOK_PITCH[0], Math.min(LOOK_PITCH[1], this.lookPitch + dy * 0.004));
  }
  // the right stick, -1..1 each way, read every frame (it points the camera, it does not spin it)
  setStick(x, y) { this.stick = [Math.abs(x) > STICK_DEAD ? x : 0, Math.abs(y) > STICK_DEAD ? y : 0]; }
  resetLook() { this.lookYaw = 0; this.lookPitch = 0; this.dragging = false; this.stick = [0, 0]; }

  // the offsets for this frame: the stick sets them, a drag holds them, otherwise they ease back to zero
  _updateLook(dt) {
    const [sx, sy] = this.stick;
    if (sx || sy) {
      const k = ease(8, dt);
      this.lookYaw += (sx * LOOK_YAW - this.lookYaw) * k;
      this.lookPitch += (Math.max(LOOK_PITCH[0], Math.min(LOOK_PITCH[1], sy * LOOK_PITCH[1])) - this.lookPitch) * k;
    } else if (!this.dragging) {
      const k = ease(LOOK_RETURN, dt);
      this.lookYaw -= this.lookYaw * k; this.lookPitch -= this.lookPitch * k;
      if (Math.abs(this.lookYaw) < 1e-4) this.lookYaw = 0;
      if (Math.abs(this.lookPitch) < 1e-4) this.lookPitch = 0;
    }
  }

  next() { this.mode = this.mode === 'chase' ? 'bonnet' : 'chase'; }

  update(view, car, dt) {
    const cam = this.camera, pos = view.root.position;
    const heading = -view.root.rotation.y;
    const pitch = view.slope.rotation.z;
    this._updateLook(dt);

    if (this.mode === 'chase') {
      // swing towards the direction of travel, so slides are visible
      const travel = car.speed > 3 ? Math.atan2(car.vz, car.vx) : heading;
      let want = heading + 0.35 * Math.atan2(Math.sin(travel - heading), Math.cos(travel - heading));
      if (this.yaw === null) this.yaw = want;
      const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += d * ease(CHASE_LAG, dt);
      if (this.height === null) this.height = pos.y;
      this.height += (pos.y - this.height) * ease(4, dt);

      const cx = Math.cos(this.yaw), cz = Math.sin(this.yaw);
      const rise = Math.tan(pitch) * CHASE_DISTANCE;
      if (this.lookYaw || this.lookPitch) {
        // orbit the car at the chase distance, looking at its middle
        const a = this.yaw + this.lookYaw, up = this.lookPitch, r = CHASE_DISTANCE * Math.cos(up);
        cam.position.set(pos.x - Math.cos(a) * r, this.height + CHASE_HEIGHT - rise * 0.8 + CHASE_DISTANCE * Math.sin(up), pos.z - Math.sin(a) * r);
        const blend = Math.min(1, (Math.abs(this.lookYaw) + Math.abs(this.lookPitch)) * 3);   // from looking ahead of the car to looking at it
        this._look.set(pos.x + cx * 4 * (1 - blend), pos.y + 0.9 + Math.tan(pitch) * 4 * (1 - blend), pos.z + cz * 4 * (1 - blend));
      } else {
        cam.position.set(pos.x - cx * CHASE_DISTANCE, this.height + CHASE_HEIGHT - rise * 0.8, pos.z - cz * CHASE_DISTANCE);
        this._look.set(pos.x + cx * 4, pos.y + 0.9 + Math.tan(pitch) * 4, pos.z + cz * 4);
      }
      cam.lookAt(this._look);
    } else {
      const cx = Math.cos(heading), cz = Math.sin(heading);
      cam.position.set(pos.x + cx * 0.6, pos.y + 1.15, pos.z + cz * 0.6);
      // free look turns the driver's head
      const hx = Math.cos(heading + this.lookYaw), hz = Math.sin(heading + this.lookYaw);
      this._look.set(cam.position.x + hx * 20, pos.y + 1.0 + Math.tan(pitch) * 20 + Math.tan(this.lookPitch * 0.6) * 20, cam.position.z + hz * 20);
      cam.lookAt(this._look);
      this.yaw = null;
    }

    const fov = BASE_FOV + SPEED_FOV * Math.min(1, Math.max(0, car.fwdSpeed) / 75);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * ease(3, dt); cam.updateProjectionMatrix(); }
  }
}
