// Cameras. Phase 1 has the chase camera and a bonnet camera (C to switch).
// Cockpit and broadcast cameras come later.

import * as THREE from 'three';
import { ease } from './loop.js';

const CHASE_DISTANCE = 6.2;   // metres behind the car
const CHASE_HEIGHT = 2.1;     // metres above it
const CHASE_LAG = 7;          // how quickly the camera swings round behind the car. Lower = lazier.
const CHASE_RISE = 14;        // how quickly the camera's height follows the car's (quick: on a long climb it never trails below)
const CHASE_AHEAD = 18;       // metres ahead along the road the camera aims at, so it tips up for a climb and down for a drop
const CHASE_CLEAR = 1.3;      // the camera stays at least this far above the ground under it
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
    this.extraFov = 0;   // degrees added on top of the speed widening, set by the slipstream effect (src/slipFx.js)
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
      this.height += (pos.y - this.height) * ease(CHASE_RISE, dt);

      const cx = Math.cos(this.yaw), cz = Math.sin(this.yaw);
      // the camera does not tip down with a climb (it would sit low behind the car, looking up at it, with the car covering
      // the road): it keeps its height over the car, never closer than CHASE_CLEAR to the ground, and aims at the road ahead
      const ground = this.groundAt || (() => -Infinity);
      const bx = pos.x - cx * CHASE_DISTANCE, bz = pos.z - cz * CHASE_DISTANCE;
      const camY = Math.max(this.height + CHASE_HEIGHT, ground(bx, bz) + CHASE_CLEAR);
      const gAhead = ground(pos.x + cx * CHASE_AHEAD, pos.z + cz * CHASE_AHEAD);
      const aimRise = Number.isFinite(gAhead) ? Math.max(-6, Math.min(6, gAhead - (pos.y - 0.3))) : Math.tan(pitch) * CHASE_AHEAD;
      if (this.aim == null) this.aim = aimRise;
      this.aim += (aimRise - this.aim) * ease(5, dt);
      const lookAt = (k) => this._look.set(pos.x + cx * 4 * k, pos.y + 0.9 + this.aim * (4 / CHASE_AHEAD) * k + this.aim * 0.12 * k, pos.z + cz * 4 * k);
      if (this.lookYaw || this.lookPitch) {
        // orbit the car at the chase distance, looking at its middle
        const a = this.yaw + this.lookYaw, up = this.lookPitch, r = CHASE_DISTANCE * Math.cos(up);
        const ox = pos.x - Math.cos(a) * r, oz = pos.z - Math.sin(a) * r;
        cam.position.set(ox, Math.max(this.height + CHASE_HEIGHT + CHASE_DISTANCE * Math.sin(up), ground(ox, oz) + CHASE_CLEAR), oz);
        const blend = Math.min(1, (Math.abs(this.lookYaw) + Math.abs(this.lookPitch)) * 3);   // from looking ahead of the car to looking at it
        lookAt(1 - blend);
      } else {
        cam.position.set(bx, camY, bz);
        lookAt(1);
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

    const fov = BASE_FOV + SPEED_FOV * Math.min(1, Math.max(0, car.fwdSpeed) / 75) + this.extraFov;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * ease(3, dt); cam.updateProjectionMatrix(); }
  }
}
