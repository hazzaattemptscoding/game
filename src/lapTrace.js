// The line a lap was driven on, for the global times' ghosts: the car's position and heading about 10 times a second,
// recorded during the lap and sent with it, then played back as a see-through car (src/boardGhost.js). Plain JavaScript
// with no page needed, so tools/globaltimes.js tests it in node.
//
// Wire format (what worker/src/times.js checks): base64 of a little-endian Float32Array [t0, x0, z0, yaw0, t1, x1, ...],
// t in seconds into the lap, x and z in metres, yaw in radians.

export const TRACE_HZ = 10;
const STEP = 1 / TRACE_HZ;

export class LapRecorder {
  constructor() { this.reset(); }
  reset() { this.data = []; this.lastT = -Infinity; }
  // t: seconds into the lap
  push(t, x, z, yaw) {
    if (t - this.lastT < STEP - 1e-6) return;
    this.data.push(t, x, z, yaw);
    this.lastT = t;
  }
  // the lap's last sample, at its exact finishing time, so the line runs right up to the line
  finish(time, x, z, yaw) { if (time > this.lastT + 1e-6) { this.data.push(time, x, z, yaw); this.lastT = time; } }
  get samples() { return this.data.length / 4; }
  encode() { return encodeTrace(Float32Array.from(this.data)); }
}

const toB64 = bytes => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = b64 => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

// Float32Array -> base64 (little-endian whatever the machine)
export function encodeTrace(f32) {
  const dv = new DataView(new ArrayBuffer(f32.length * 4));
  for (let i = 0; i < f32.length; i++) dv.setFloat32(i * 4, f32[i], true);
  return toB64(new Uint8Array(dv.buffer));
}

// base64 -> Float32Array, or null if it is not a whole number of samples
export function decodeTrace(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  let bytes; try { bytes = fromB64(b64); } catch { return null; }
  if (bytes.length === 0 || bytes.length % 16) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

// where the ghost is `t` seconds into its lap: { x, z, yaw }, between samples by straight line (heading the short way round);
// held at the ends. `hint` (an object kept by the caller) remembers the last sample index, so playback is not a search every frame.
export function sampleTrace(tr, t, hint = {}) {
  const n = tr.length / 4;
  if (!n) return null;
  if (t <= tr[0]) return { x: tr[1], z: tr[2], yaw: tr[3] };
  if (t >= tr[(n - 1) * 4]) { const k = (n - 1) * 4; return { x: tr[k + 1], z: tr[k + 2], yaw: tr[k + 3] }; }
  let k = Math.min(Math.max(0, hint.k | 0), n - 2);
  if (tr[k * 4] > t) k = 0;
  while (k < n - 2 && tr[(k + 1) * 4] <= t) k++;
  hint.k = k;
  const a = k * 4, b = a + 4, f = (t - tr[a]) / ((tr[b] - tr[a]) || 1);
  let dy = tr[b + 3] - tr[a + 3];
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return { x: tr[a + 1] + (tr[b + 1] - tr[a + 1]) * f, z: tr[a + 2] + (tr[b + 2] - tr[a + 2]) * f, yaw: tr[a + 3] + dy * f };
}
