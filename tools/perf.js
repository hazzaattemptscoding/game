// Performance test. Run with `npm run perf` (also part of `npm run check`).
//   1. fixed timestep: the same drive at 60, 120, 144, 240 Hz and with uneven frames ends in the same car state and the same lap time
//   2. the frame loop helpers (src/loop.js): clamped frame time, alpha, frame rate independent easing, camera damping at 60 and 144 Hz
//   3. graphics quality (src/quality.js): the settings, Auto's render scaler, the shadow centre snapping
//   4. the source: the physics step is only called from the fixed step loop, no 60 Hz constants in the frame code
//   5. draw calls and triangles of the real page against a budget (headless Chromium, skipped if it is not installed)
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildTrack } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { FixedStep, FrameStats, frameTime, ease, MAX_FRAME } from '../src/loop.js';
import { CameraRig } from '../src/cameras.js';
import { Scaler, TIERS, baseTier, cleanQuality, snapShadowCentre, SCALE_MIN } from '../src/quality.js';
import { startVite } from './lib/vite.mjs';

export const DRAW_CALL_BUDGET = 700, TRIANGLE_BUDGET = 700000;
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

console.log('FIXED TIMESTEP');
const track = buildTrack(), line = computeRacingLine(track);
// Drives with the real loop shape (add the frame time, step while due) and stops after `steps` steps or when the first lap is done.
function drive(frameDts, steps) {
  const car = new Car(GT, track); car.setAssists({ tc: true, abs: true, esc: true }); car.placeAt(-20, 0);
  const ap = new Autopilot(track, GT, { skill: 0.9, line }), timer = new LapTimer(track), loop = new FixedStep(STEP);
  let n = 0, simTime = 0, f = 0;
  while (n < steps && timer.lap < 1) {
    loop.add(frameDts(f++));
    while (n < steps && loop.due()) { car.step(ap.drive(car)); simTime += STEP; timer.update(car.loc.s, simTime); n++; }
  }
  return { x: car.x, z: car.z, speed: car.speed, heading: car.heading, n, lap: timer.last };
}
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rates = { '60 Hz': () => 1 / 60, '120 Hz': () => 1 / 120, '144 Hz': () => 1 / 144, '240 Hz': () => 1 / 240, 'uneven 3 to 25 ms': () => 0.003 + rnd() * 0.022 };
const SOME = 6000;   // 50 s of driving
const ref = drive(rates['60 Hz'], SOME);
for (const [name, dts] of Object.entries(rates)) {
  const r = drive(dts, SOME);
  console.log(`  ${name.padEnd(18)} after ${r.n} steps: x ${r.x.toFixed(6)} z ${r.z.toFixed(6)} speed ${r.speed.toFixed(6)}`);
  check(r.n === SOME && r.x === ref.x && r.z === ref.z && r.speed === ref.speed && r.heading === ref.heading, `${name}: the car state after ${SOME} steps differs from the 60 Hz run`);
}
const laps = Object.entries(rates).map(([name, dts]) => [name, drive(dts, 20000).lap]);
console.log('  first lap time: ' + laps.map(([n, t]) => `${n} ${t == null ? '--' : t.toFixed(4)}`).join(', '));
check(laps.every(([, t]) => t != null && t === laps[0][1]), 'the lap time differs between frame rates');

console.log('FRAME LOOP');
{
  const l = new FixedStep(STEP); let steps = 0;
  l.add(0.5); while (l.due()) steps++;
  check(steps === Math.floor(MAX_FRAME / STEP + 1e-9) || steps === Math.ceil(MAX_FRAME / STEP), `a half second frame is cut to ${MAX_FRAME} s (${steps} steps)`);
  check(l.alpha >= 0 && l.alpha < 1, 'alpha stays in 0 to 1');
  const l2 = new FixedStep(STEP); l2.add(-1); check(!l2.due() && l2.acc === 0, 'a negative frame time adds nothing');
  check(frameTime(NaN) === 0 && frameTime(0.02) === 0.02, 'frameTime handles NaN and normal frames');
  check(Math.abs((1 - ease(7, 1 / 144)) ** 2 - (1 - ease(7, 2 / 144))) < 1e-12, 'ease(k, dt) composes: two frames equal one frame of twice the time');
  const fs = new FrameStats(0.5); let pub = 0; for (let i = 0; i < 144; i++) if (fs.push(1 / 144)) pub++;
  check(pub >= 1 && Math.abs(fs.fps - 144) < 1 && Math.abs(fs.avgMs - 6.944) < 0.05, `frame stats read 144 fps (${fs.fps.toFixed(1)}, ${fs.avgMs.toFixed(2)} ms)`);
  // chase camera damping: the same wall time at 60 and 144 Hz ends in the same place
  const camAt = hz => {
    const rig = new CameraRig(16 / 9), view = { root: { position: new THREE.Vector3(10, 0, 0), rotation: { y: 0.8 } }, slope: { rotation: { z: 0 } } };
    const car = { speed: 30, vx: 25, vz: 15, fwdSpeed: 40 };
    rig.yaw = 0; rig.height = 3;
    for (let i = 0; i < hz; i++) rig.update(view, car, 1 / hz);
    return [rig.yaw, rig.height, rig.camera.fov];
  };
  const a = camAt(60), b = camAt(144), c = camAt(240);
  check(a.every((v, i) => Math.abs(v - b[i]) < 2e-3 && Math.abs(v - c[i]) < 2e-3), `camera damping depends on the frame rate: ${a.map(v => v.toFixed(4))} vs ${b.map(v => v.toFixed(4))}`);
}

console.log('GRAPHICS QUALITY');
{
  check(cleanQuality('high') === 'high' && cleanQuality('ultra') === 'auto' && cleanQuality(undefined) === 'auto', 'quality settings are validated, default auto');
  check(baseTier('auto', true) === 'medium' && baseTier('auto', false) === 'high' && baseTier('low', false) === 'low', 'Auto starts on High for a desktop and Medium for a phone');
  check(TIERS.high.shadowSize === 2048 && TIERS.high.shadowHz === 0 && TIERS.high.pixelCap === 2 && TIERS.high.propDist === Infinity, 'High is the full look');
  check(TIERS.medium.pixelCap <= TIERS.high.pixelCap && TIERS.low.pixelCap <= TIERS.medium.pixelCap && TIERS.low.shadowSize <= TIERS.medium.shadowSize, 'tiers go down in cost');
  const feed = (sc, ms, seconds) => { let s = null; for (let i = 0; i < seconds * 1000 / ms; i++) s = sc.push(ms) ?? s; return s; };
  const slow = new Scaler(); feed(slow, 8.3, 5);   // a 120 Hz display sets the budget
  feed(slow, 16, 12);
  check(slow.scale < 1 && slow.scale >= SCALE_MIN, `Auto lowers the scale when frames are over budget (${slow.scale})`);
  const floor = new Scaler(); feed(floor, 8.3, 5); feed(floor, 40, 60);
  check(floor.scale === SCALE_MIN && floor.pinned > 3, 'the scale stops at its floor and reports it');
  const fast = new Scaler(); feed(fast, 8.3, 5); feed(fast, 16, 8); const low = fast.scale; feed(fast, 8.3, 60);
  check(fast.scale > low, `Auto raises the scale with headroom (${low} to ${fast.scale})`);
  const ok = new Scaler(); feed(ok, 6.9, 30);
  check(ok.scale === 1, 'a display holding its rate keeps full scale');
  const out = snapShadowCentre({ x: 123.456, y: 7, z: -88.8 }, { x: -0.4, y: 0.8, z: 0.45 }, 2048, 80), texel = 80 / 2048;
  check(Math.hypot(out.x - 123.456, out.y - 7, out.z + 88.8) < texel * 2, 'the snapped shadow centre is within a texel or two of the car');
}

console.log('SOURCE');
{
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  check(/new FixedStep\(STEP\)/.test(main) && /while \(loop\.due\(\)\)/.test(main), 'main.js steps the physics from the FixedStep loop');
  check((main.match(/car\.step\(/g) || []).length === 1, 'car.step is called in one place');
  check(/requestAnimationFrame\(frame\)/.test(main) && !/setInterval|setTimeout/.test(main.split('// --- loop ---')[1] || ''), 'the frame loop runs on requestAnimationFrame only');
  const bad = [];
  for (const f of ['main', 'cameras', 'car', 'carFx', 'ghosts', 'hud', 'miniMap', 'director', 'environment', 'lobby']) {
    const src = readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/(1 \/ 60\b|0\.016\d*|16\.6\d*)/g)) bad.push(`${f}.js: ${m[0]}`);
  }
  check(!bad.length, 'no 60 Hz constants in the frame code: ' + bad.join(', '));
}

// the real page against the budget
async function pageBudget() {
  const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
  if (!existsSync(chromePath) || !existsSync(pw)) { console.log('  Chromium or Playwright not found, skipped'); return; }
  const { chromium } = createRequire(import.meta.url)(pw);
  const PORT = process.env.PERF_PORT || '5340';
  const server = await startVite(PORT);
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 480 } });
  page.on('pageerror', e => fails.push('page error: ' + e.message));
  let worst = { calls: 0, tris: 0 };
  for (const [name, q, at] of [['start grid', 'viewat=100,0,2,40'], ['crowded stretch', 'viewat=1000,0,2,40'], ['night and rain', 'viewat=3500,0,2,40&weather=heavyrain&time=night']]) {
    await page.goto(`http://localhost:${PORT}/?menu=0&${q}`, { timeout: 90000 });
    await page.waitForFunction(() => window.lakeside, null, { timeout: 120000 });   // the page builds the world before the first frame (a slow machine takes a while)
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => { const L = window.lakeside, i = L.renderer.info.render; return { calls: i.calls, tris: i.triangles, auto: L.renderer.shadowMap.autoUpdate, q: L.settings.quality }; });
    console.log(`  ${name.padEnd(16)} ${r.calls} draw calls, ${r.tris} triangles`);
    check(r.calls <= DRAW_CALL_BUDGET, `${name}: ${r.calls} draw calls is over the budget of ${DRAW_CALL_BUDGET}`);
    check(r.tris <= TRIANGLE_BUDGET, `${name}: ${r.tris} triangles is over the budget of ${TRIANGLE_BUDGET}`);
    check(r.auto === false && r.q === 'auto', 'the shadow map is refreshed from the loop and the quality setting defaults to auto');
    worst = { calls: Math.max(worst.calls, r.calls), tris: Math.max(worst.tris, r.tris) };
  }
  await browser.close(); server.stop();
}
console.log(`PAGE BUDGET (draw calls <= ${DRAW_CALL_BUDGET}, triangles <= ${TRIANGLE_BUDGET})`);
await pageBudget();

console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'PASS');
process.exitCode = fails.length ? 1 : 0;
