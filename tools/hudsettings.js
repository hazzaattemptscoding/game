// HUD settings and track map test. Run with `npm run hudsettings` (also part of `npm run check`). No browser needed.
//   1. defaults: an empty or old save loads with the current look (every old part on, extras off, map on, scale 100)
//   2. old saves: the single `assists` switch and other old keys still work next to the new ones; junk values fall back
//   3. presets: full, minimal and off, detection, and the H key cycle
//   4. the hide classes the HUD puts on the page
//   5. the track map: option checks, view transform, corner numbers, bounds
//   6. the ping readout: on by default, saved, and its colour steps
import { migrateSettings, loadSettings } from '../src/settings.js';
import { HUD_KEYS, FULL, MINIMAL, OFF, DEFAULT_TRACK_MAP, normaliseHudSettings, detectPreset, applyPreset, cyclePreset, hudClasses, hudOn, SCALE_MIN, SCALE_MAX, pingTone } from '../src/hudSettings.js';
import { viewTransform, project, trackBounds, cornerMarks, LOCAL_SPAN } from '../src/miniMap.js';
import { buildTrack } from '../src/track.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('DEFAULTS');
const empty = migrateSettings({});
check(same(empty.hud, FULL), 'an empty save gets the full HUD');
check(same(empty.trackMap, DEFAULT_TRACK_MAP), 'an empty save gets the default map');
check(empty.hudScale === 100, 'HUD scale defaults to 100');
check(HUD_KEYS.includes('minisectors') && FULL.minisectors === true && MINIMAL.minisectors === false && empty.hud.minisectors === true, 'the minisectors part is on in full and off in minimal');
check(HUD_KEYS.every(k => k === 'pedals' || k === 'inputOverlay' || k === 'fps' ? empty.hud[k] === false : empty.hud[k] === true), 'every part that existed before is on, the three extras are off');
check(empty.trackMap.on === true, 'the map is on by default');
for (const bad of [null, undefined, 5, 'x', []]) check(same(migrateSettings(bad).hud, FULL), 'a save that is not an object (' + JSON.stringify(bad) + ') gives the defaults');
// loadSettings with storage that is empty, throws or holds junk
globalThis.localStorage = { getItem: () => null, setItem() {} };
check(loadSettings().hudScale === 100 && loadSettings().units === 'mph', 'empty storage loads the defaults');
globalThis.localStorage = { getItem: () => { throw new Error('private mode'); }, setItem() {} };
check(loadSettings().hud.speed === true, 'storage that throws loads the defaults');
globalThis.localStorage = { getItem: () => '{not json', setItem() {} };
check(loadSettings().hud.speed === true, 'a broken save loads the defaults');

console.log('OLD SAVES');
const old = { units: 'kmh', assists: false, steering: 'cursor', steerSens: 1.5, debug: true, racingLine: true, sound: false, volume: 0.2 };
globalThis.localStorage = { getItem: () => JSON.stringify(old), setItem() {} };
const loaded = loadSettings();
check(loaded.units === 'kmh' && loaded.steering === 'cursor' && loaded.steerSens === 1.5 && loaded.debug === true && loaded.racingLine === true && loaded.sound === false && loaded.volume === 0.2, 'old keys keep their values');
check(loaded.assistTc === false && loaded.assistAbs === false && loaded.assistEsc === false && !('assists' in loaded), 'the old assists switch still sets the three assists');
check(same(loaded.hud, FULL) && loaded.hudScale === 100 && loaded.trackMap.on, 'an old save gets the new keys at their defaults');
const partial = migrateSettings({ hud: { speed: false, fps: true, bogus: true, delta: 'yes' }, hudScale: 120, trackMap: { size: 'large', zoom: 'local', opacity: 0.5, rotate: true, labels: 'numbers', position: 'bl' } });
check(partial.hud.speed === false && partial.hud.fps === true && partial.hud.lapTimer === true && partial.hud.delta === true && !('bogus' in partial.hud), 'a partial hud object keeps valid values, fills the rest, drops unknown keys, ignores wrong types');
check(partial.hudScale === 120 && partial.trackMap.size === 'large' && partial.trackMap.zoom === 'local' && partial.trackMap.opacity === 0.5 && partial.trackMap.rotate === true && partial.trackMap.labels === 'numbers' && partial.trackMap.position === 'bl', 'valid saved map options are kept');
const junk = migrateSettings({ hud: 'x', hudScale: 500, trackMap: { size: 'huge', position: 'middle', opacity: 7, zoom: 3, labels: 'names', rotate: 'yes', on: 0 } });
check(same(junk.hud, FULL) && junk.hudScale === 100 && same(junk.trackMap, DEFAULT_TRACK_MAP), 'out of range and wrong typed values fall back to the defaults');
check(migrateSettings({ hudScale: SCALE_MIN }).hudScale === SCALE_MIN && migrateSettings({ hudScale: SCALE_MAX }).hudScale === SCALE_MAX, 'the scale limits are accepted');
check(migrateSettings({ hudScale: 79 }).hudScale === 100 && migrateSettings({ hudScale: 141 }).hudScale === 100, 'a scale outside 80 to 140 falls back');
const once = migrateSettings(partial);
check(same(once, partial), 'migrating twice changes nothing');
check(migrateSettings(JSON.parse(JSON.stringify(partial))).hud.speed === false, 'a save survives a JSON round trip');
const shared = { hud: { speed: false } }; migrateSettings(shared);
check(Object.keys(shared.hud).length === 1, 'the input object is not changed');

console.log('PRESETS');
const s = normaliseHudSettings({});
check(detectPreset(s) === 'full', 'defaults are the full preset');
applyPreset(s, 'minimal');
check(same(s.hud, { ...MINIMAL }) && s.trackMap.on === false && detectPreset(s) === 'minimal', 'minimal sets its parts and hides the map');
check(MINIMAL.speed && MINIMAL.lapTimer && MINIMAL.flags && MINIMAL.limits && !MINIMAL.sectors && !MINIMAL.assists, 'minimal keeps speed, lap timer, limits warnings and messages');
applyPreset(s, 'off');
check(HUD_KEYS.every(k => s.hud[k] === OFF[k] && !s.hud[k]) && detectPreset(s) === 'off', 'off hides every part');
s.hud.fps = true;
check(detectPreset(s) === 'custom', 'a changed switch makes the set custom');
check(cyclePreset(s) === 'full' && detectPreset(s) === 'full', 'custom goes to full on H');
const seq = [cyclePreset(s), cyclePreset(s), cyclePreset(s)];
check(same(seq, ['minimal', 'off', 'full']), 'H cycles full, minimal, off, full (got ' + seq + ')');
s.trackMap.on = false;
check(detectPreset(s) === 'custom', 'turning only the map off is custom');
check(hudOn(s, 'speed') === true && hudOn({}, 'speed') === false, 'hudOn reads a switch and is safe without a hud object');

console.log('HIDE CLASSES');
const f = normaliseHudSettings({});
check(same(hudClasses(f), ['hx-no-pedals', 'hx-no-inputOverlay', 'hx-no-fps']), 'full hides only the three extras');
const m = normaliseHudSettings({}); applyPreset(m, 'minimal');
check(hudClasses(m).includes('hx-no-sectors') && hudClasses(m).includes('hx-no-assists') && !hudClasses(m).includes('hx-no-speed') && !hudClasses(m).includes('hx-no-lights'), 'minimal hides sectors and assists but keeps the speed block and its lights');
const o = normaliseHudSettings({}); applyPreset(o, 'off');
check(hudClasses(o).length === HUD_KEYS.length + 1 && hudClasses(o).includes('hx-no-lights'), 'off hides every part and the light row');

console.log('PING READOUT');
check(migrateSettings({}).showPing === true && migrateSettings({ showPing: 'no' }).showPing === true, 'the ping readout is on by default, and junk gives the default');
check(migrateSettings({ showPing: false }).showPing === false && migrateSettings(JSON.parse(JSON.stringify(migrateSettings({ showPing: false })))).showPing === false, 'a switched off ping readout stays off through a save');
check(pingTone(0) === 'good' && pingTone(59) === 'good' && pingTone(60) === 'mid' && pingTone(119) === 'mid' && pingTone(120) === 'bad' && pingTone(900) === 'bad', 'green under 60 ms, amber under 120, red from 120');

console.log('TRACK MAP');
const T = buildTrack();
const b = trackBounds(T);
check(b.x1 > b.x0 && b.z1 > b.z0 && b.radius >= Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 - 1e-6, 'bounds and circumradius');
const size = 180, car = { x: 100, z: -50, heading: 0.7 };
const mid = { x: 0, y: 0 };
// local view: the car is in the middle, at any rotation
for (const rotate of [false, true]) {
  const t = viewTransform({ mode: 'local', rotate, size, bounds: b, car });
  project(t, size, car.x, car.z, mid);
  check(near(mid.x, size / 2) && near(mid.y, size / 2), 'local view keeps the car in the middle (rotate ' + rotate + ')');
  check(near(t.k, size / LOCAL_SPAN), 'local view is ' + LOCAL_SPAN + ' m across');
}
// rotated: a point straight ahead of the car is straight up the screen
{
  const t = viewTransform({ mode: 'local', rotate: true, size, bounds: b, car });
  const p = project(t, size, car.x + Math.cos(car.heading) * 50, car.z + Math.sin(car.heading) * 50);
  check(near(p.x, size / 2, 1e-6) && p.y < size / 2, 'with rotation the car faces up the screen');
  const r = project(t, size, car.x - Math.sin(car.heading) * 50, car.z + Math.cos(car.heading) * 50);
  check(r.x > size / 2, 'with rotation the car\'s right is the right of the screen');
}
// north up: world +x is screen right, +z is screen down
{
  const t = viewTransform({ mode: 'circuit', rotate: false, size, bounds: b, car });
  const a = project(t, size, b.cx, b.cz), c = project(t, size, b.cx + 10, b.cz + 10);
  check(near(a.x, size / 2) && near(a.y, size / 2) && c.x > a.x && c.y > a.y, 'north up: circuit middle at the middle, x to the right, z down');
}
// the whole circuit fits inside the map at every rotation and in north up
for (const rotate of [false, true]) for (const heading of [0, 1, 2.5, -2, 3.1]) {
  const t = viewTransform({ mode: 'circuit', rotate, size, bounds: b, car: { x: 0, z: 0, heading } });
  let inside = true; const p = {};
  for (let i = 0; i < T.N; i += 25) { project(t, size, T.x[i], T.z[i], p); if (p.x < 0 || p.y < 0 || p.x > size || p.y > size) inside = false; }
  check(inside, 'the whole circuit stays on the map (rotate ' + rotate + ', heading ' + heading + ')');
}
const marks = cornerMarks(T);
check(marks.length > 5 && marks.every((c, i) => c.n === i + 1 && c.i >= 0 && c.i < T.N && (c.side === 1 || c.side === -1)), 'corner numbers run 1.. in lap order, on real samples (' + marks.length + ' corners)');
check(marks.every((c, i) => i === 0 || c.i >= marks[i - 1].i), 'corner numbers go up with distance along the lap');
check(T.sectors.length === 3 && T.sectors[0] === 0 && T.sectors[1] < T.sectors[2], 'three sectors start at 0 and rise');

console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'PASS');
process.exitCode = fails.length ? 1 : 0;
