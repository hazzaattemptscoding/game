// The telemetry frame: one source of truth for the game (src/lobby.js packs it) and the spectator page (src/live/ reads it).
// worker/src/protocol.js keeps its own copy of TAG_STATE and TAG_TELEMETRY (the Worker is deployed on its own and cannot
// import from src/); tools/live.js checks that the copies match.
//
// A player sends it over the relay only (never over PeerJS), 10 times a second, and only while somebody is spectating.
// The relay forwards it to spectators only and prefixes the sender's player id (one byte), like every binary frame.
//
// One frame, 14 bytes, big endian:
//   0      tag            2 (TAG_TELEMETRY). Car state frames use tag 1 (src/ghosts.js BIN_STATE).
//   1      flags          bit 0 traction control active, 1 ABS active, 2 stability control active, 3 DRS open, 4 pit limiter on
//   2..3   speed          uint16, m/s times 100 (0 to 655 m/s)
//   4..5   rpm            uint16
//   6      gear           int8: -1 reverse, 0 neutral, 1 and up
//   7      throttle       uint8, 0..255 is 0..1
//   8      brake          uint8, 0..255 is 0..1
//   9      steer          int8, -127..127 is full lock left (-1) to full lock right (1); positive is to the right
//   10..11 wheel surfaces 4 nibbles, FL FR RL RR, the SURF number of src/track.js (0 to 15)
//   12     lateral g      int8, g times 20 (about +-6 g); positive is to the right
//   13     longitudinal g int8, g times 20; positive is accelerating
// Later versions may append bytes: readers accept longer frames and read the first 14.

export const TAG_STATE = 1;
export const TAG_TELEMETRY = 2;
export const TELEMETRY_BYTES = 14;
export const TELEMETRY_HZ = 10;
export const FLAGS = { tc: 1, abs: 2, esc: 4, drs: 8, pit: 16 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// t: { speed (m/s), rpm, gear, throttle 0..1, brake 0..1, steer -1..1, tc, abs, esc, drs, pit (booleans), surf [4] (SURF numbers), latG, longG (g) }
// Anything missing or not a finite number counts as 0. Returns a new Uint8Array of 14 bytes.
export function encodeTelemetry(t) {
  const u = new Uint8Array(TELEMETRY_BYTES), dv = new DataView(u.buffer);
  u[0] = TAG_TELEMETRY;
  u[1] = (t.tc ? FLAGS.tc : 0) | (t.abs ? FLAGS.abs : 0) | (t.esc ? FLAGS.esc : 0) | (t.drs ? FLAGS.drs : 0) | (t.pit ? FLAGS.pit : 0);
  dv.setUint16(2, clamp(Math.round(num(t.speed) * 100), 0, 65535));
  dv.setUint16(4, clamp(Math.round(num(t.rpm)), 0, 65535));
  dv.setInt8(6, clamp(Math.round(num(t.gear)), -1, 12));
  dv.setUint8(7, clamp(Math.round(num(t.throttle) * 255), 0, 255));
  dv.setUint8(8, clamp(Math.round(num(t.brake) * 255), 0, 255));
  dv.setInt8(9, clamp(Math.round(num(t.steer) * 127), -127, 127));
  const s = Array.isArray(t.surf) ? t.surf : [];
  dv.setUint16(10, ((clamp(Math.round(num(s[0])), 0, 15)) << 12) | ((clamp(Math.round(num(s[1])), 0, 15)) << 8) | ((clamp(Math.round(num(s[2])), 0, 15)) << 4) | clamp(Math.round(num(s[3])), 0, 15));
  dv.setInt8(12, clamp(Math.round(num(t.latG) * 20), -127, 127));
  dv.setInt8(13, clamp(Math.round(num(t.longG) * 20), -127, 127));
  return u;
}

// Bytes (the frame as the player sent it, tag first, NOT including the relay's sender id byte) to a telemetry object, or null for
// anything that is not a valid frame. Hostile input is safe: wrong type, wrong tag or too short gives null, every field is range limited.
export function decodeTelemetry(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < TELEMETRY_BYTES || u8[0] !== TAG_TELEMETRY) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), f = u8[1], sf = dv.getUint16(10);
  return {
    tc: !!(f & FLAGS.tc), abs: !!(f & FLAGS.abs), esc: !!(f & FLAGS.esc), drs: !!(f & FLAGS.drs), pit: !!(f & FLAGS.pit),
    speed: dv.getUint16(2) / 100, rpm: dv.getUint16(4), gear: clamp(dv.getInt8(6), -1, 12),
    throttle: u8[7] / 255, brake: u8[8] / 255, steer: clamp(dv.getInt8(9) / 127, -1, 1),
    surf: [(sf >> 12) & 15, (sf >> 8) & 15, (sf >> 4) & 15, sf & 15],
    latG: dv.getInt8(12) / 20, longG: dv.getInt8(13) / 20,
  };
}

// Reads the player's own car (src/physics.js Car) into the object encodeTelemetry takes.
export function telemetryFromCar(car) {
  const lock = (car.cfg && car.cfg.maxLock) || 0.5;
  return {
    speed: car.speed, rpm: car.rpm, gear: car.gear, throttle: car.throttle, brake: car.brake, steer: clamp(num(car.steer) / lock, -1, 1),
    tc: car.tc, abs: car.abs, esc: car.esc, drs: car.drs, pit: car.pitLimiter, surf: car.wheelSurf, latG: num(car.ay) / 9.81, longG: num(car.ax) / 9.81,
  };
}

// The same codes as the ev messages in worker/README.md: what a player tells the room when something happens.
export const EVENT_KINDS = ['lap', 'limits', 'jump', 'best', 'contact', 'join', 'leave'];
