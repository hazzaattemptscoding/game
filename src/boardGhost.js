// The ghost of a global times lap (src/globalTimes.js): a see-through car that drives a stored lap line (src/lapTrace.js) on
// the player's own lap clock. It waits on the line during the out lap, sets off when the player starts a lap, and starts again
// with every new lap, so it is always the same lap to race. It never touches the player's car (it is not in the collision list).
import { decodeTrace, sampleTrace } from './lapTrace.js';
import { threeFactory } from './ghosts.js';
import { defaultLivery } from './livery.js';
import { fmtTime } from './hud.js';
import { carById } from './cars.js';

export const GHOST_OPACITY = 0.45;


// o: { scene, tagRoot, track, factory } (factory: ghosts.js threeFactory, or a stub in tests)
export function createBoardGhost(o) {
  const track = o.track, factory = o.factory || threeFactory(o.scene, o.tagRoot);
  let tr = null, ent = null, info = null, hint = {}, wheel = 0, last = null;
  // where the ghost's tilt is measured, metres from its middle: half the wheelbase and half the track of its class (src/cars.js)
  let AXLE = 1.3, HALF_TRACK = 0.8;
  const pose = { x: 0, y: 0, z: 0, h: 0, st: 0, w: 0, vx: 0, vz: 0, yr: 0, brk: 0, pz: 0, rx: 0 };

  const api = {
    get active() { return !!tr; },
    get info() { return info; },
    // entry: { name, time, ghost (base64), board }. Returns false if the line cannot be read.
    load(entry) {
      const t = entry && decodeTrace(entry.ghost);
      if (!t || t.length < 8) return false;
      api.clear();
      tr = t; info = { name: entry.name, time: entry.time, board: entry.board }; hint = {}; last = null;
      const cfg = carById(entry.board && entry.board.car);   // the ghost is a car of the class it was driven in
      AXLE = cfg.wheelbase / 2; HALF_TRACK = cfg.trackWidth / 2;
      ent = factory.create({ id: 'board-ghost', livery: defaultLivery(7), name: entry.name, car: cfg });
      ent.setOpacity && ent.setOpacity(GHOST_OPACITY);
      return true;
    },
    clear() { if (ent) ent.dispose(); ent = null; tr = null; info = null; },

    // lapT: seconds into the player's lap, or null on the out lap (the ghost waits on the line); dt: frame time;
    // project: (x, y, z) -> screen point for the name tag, or null
    update(lapT, dt, project) {
      if (!tr || !ent) return;
      const t = lapT == null ? 0 : Math.min(lapT, info.time);
      const p = sampleTrace(tr, t, hint);
      const ground = (x, z) => track.groundAt(x, z);
      const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
      pose.x = p.x; pose.z = p.z; pose.y = ground(p.x, p.z); pose.h = p.yaw;
      // speed and turn rate from the step since the last frame (for the wheels and the body's lean)
      if (last && dt > 0) { pose.vx = (p.x - last.x) / dt; pose.vz = (p.z - last.z) / dt; let dy = p.yaw - last.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); pose.yr = dy / dt; }
      else { pose.vx = pose.vz = pose.yr = 0; }
      last = { x: p.x, z: p.z, yaw: p.yaw };
      wheel += Math.hypot(pose.vx, pose.vz) * dt / 0.33;
      pose.w = wheel;
      // the body's tilt from the ground under it, like the player's car (physics.js)
      pose.pz = Math.atan((ground(p.x + fx * AXLE, p.z + fz * AXLE) - ground(p.x - fx * AXLE, p.z - fz * AXLE)) / (2 * AXLE));
      pose.rx = Math.atan((ground(p.x - fz * HALF_TRACK, p.z + fx * HALF_TRACK) - ground(p.x + fz * HALF_TRACK, p.z - fx * HALF_TRACK)) / (2 * HALF_TRACK));
      ent.setPose(pose);
      ent.setLabel && ent.setLabel(project ? project(pose.x, pose.y + 2.1, pose.z) : null, `Ghost: ${info.name} ${fmtTime(info.time)}`, GHOST_OPACITY + 0.3, null);
    },
  };
  return api;
}
