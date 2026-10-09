// Track limits test. Run with `npm run limits` (also part of `npm run check`). No browser needed.
//
// A cut is three or more wheels on grass or gravel beyond the white line on the inside of a corner, or two wheels there with
// the centre too. Kerbs, sausage kerbs, run-off and the pit lane are legal. The checks:
//   1. zones: every corner with an inside side has one, and it covers the apex
//   2. cut spots: where each corner can be cut (the most wheels on grass or gravel within 12 m of the apex, stopping at the
//      pit lane or a street wall); three or more is a warning there.
//   3. scripted drives: the autopilot cuts Windsock Hairpin and Searchlight across the grass (a warning), and takes the
//      racing line through every corner (no warning)
//   4. legal ground: every place in the chicane and Boundary Loop zones where all four wheels are on kerb, sausage, run-off
//      or pit gives no warning
//   5. the wheel count: one wheel on the line with three on grass is a cut; two on grass is not
//   6. two cuts within 3 s: both logged and counted, one banner
//   7. reverse: the same cut facing the other way is the same cut at every metre of the zone
import { buildTrack, SURF } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { CORNERS } from '../src/corners.js';
import { limitZones, LIMIT_CORNERS, COOLDOWN, cutting, cutOnSide, TrackLimits } from '../src/trackLimits.js';

const track = buildTrack();
const racingLine = computeRacingLine(track);
const zones = limitZones();
const fails = [];
const wrap = (i, n) => ((i % n) + n) % n;
const IDLE = { steer: 0, throttle: 0, brake: 0, drs: false };
const car0 = new Car(GT, track);
const OFF = [SURF.GRASS, SURF.GRAVEL];
const LEGAL = [SURF.TARMAC, SURF.PAINT, SURF.KERB, SURF.SAUSAGE, SURF.RUNOFF, SURF.RUNOFF_ROUGH, SURF.RUMBLE, SURF.PIT];
const sideOf = c => (c.inside === 'L' ? 0 : 1);                  // track.js index: 0 left, 1 right
const sampleAt = s => wrap(Math.round(s / track.ds), track.N);
// the distance from the centreline to the far edge of the legal ground at sample i on the inside: line, kerb, sausage, run-off
const legalEdge = (side, i) => track.hw[i] + track.kerb[side][i] + track.sausage[side][i] + track.runoff[side][i];

// the car put down at s, `d` from the centreline, facing forwards or backwards, with its wheels read by a physics step
function place(car, s, d, reverse = false) {
  car.placeAt(s, d, reverse);
  car.step(IDLE);
  return car;
}
const apexesOf = c => c.apexes || [c.apexS];

// a copy of the racing line pushed to `offset` metres on the inside over [from, to], eased in and out over 40 m
function cutLine(zone, offset) {
  const T = track, N = T.N, x = Float64Array.from(racingLine.x), z = Float64Array.from(racingLine.z);
  const ease = Math.round(40 / T.ds);
  const i0 = Math.round(zone.from / T.ds), i1 = Math.round(zone.to / T.ds);
  for (let i = i0 - ease; i <= i1 + ease; i++) {
    const k = wrap(i, N), w = Math.min(1, (i - (i0 - ease)) / ease, (i1 + ease - i) / ease);
    const f = w * w * (3 - 2 * w), d = racingLine.off[k] + (zone.side * offset - racingLine.off[k]) * f;
    x[k] = T.x[k] + T.nx[k] * d; z[k] = T.z[k] + T.nz[k] * d;
  }
  return { ...racingLine, x, z };
}

// drive from 150 m before the zone to 60 m after it on `line`; returns the warnings on that corner
function drive(zone, line, skill = 0.8) {
  const car = new Car(GT, track);
  car.setAssists(true);
  const timer = new LapTimer(track);
  car.placeAt(zone.from - 150, 0);
  const ap = new Autopilot(track, GT, { skill, line });
  let t = 0;
  // start at speed so the run is short
  car.vx = Math.cos(car.heading) * 40; car.vz = Math.sin(car.heading) * 40; car.fwdSpeed = 40; car.speed = 40;
  while (car.loc.s < zone.to + 60 && t < 60) {
    car.step(ap.drive(car));
    t += STEP;
    timer.update(car.loc.s, t);
    timer.checkLimits(car, t);
  }
  return timer.limits.events.filter(e => e.corner === zone.name);
}

// 1. zones
console.log('ZONES');
const inside = CORNERS.filter(c => c.inside === 'L' || c.inside === 'R');
if (zones.length !== inside.length) fails.push(`${zones.length} zones for ${inside.length} corners with an inside side`);
if (LIMIT_CORNERS.length !== inside.length) fails.push('LIMIT_CORNERS does not list every corner with an inside side');
for (const c of inside) {
  const z = zones.find(k => k.name === c.name);
  if (!z) { fails.push(`${c.name}: no zone`); continue; }
  if (!apexesOf(c).every(s => s >= z.from && s <= z.to)) fails.push(`${c.name}: zone ${z.from.toFixed(0)} to ${z.to.toFixed(0)} misses an apex`);
}
console.log(`  ${zones.length} zones, one per corner with an inside side (${zones.map(z => z.name).join(', ')})`);

// 2. cut spots: at each cuttable corner, the spot within 12 m of the apex (out to 25 m beyond the legal ground, stopping at
// the pit lane or the wall beyond it) with the most wheels on grass or gravel. Three or more there is a cut.
console.log('CUT SPOTS (most wheels off the track, within 12 m of the apex)');
const cutCorners = [];
for (const c of inside) {
  const zone = zones.find(z => z.name === c.name), side = sideOf(c), g = side ? 1 : -1;
  const probe = new Car(GT, track);
  let best = { off: -1 };
  for (const apex of apexesOf(c)) {
    for (let s = Math.max(zone.from + 2, apex - 12); s <= Math.min(zone.to - 2, apex + 12); s += 2) {   // inside the zone (placeAt snaps to the sample below)
      const i = sampleAt(s), edge = legalEdge(side, i);
      for (let off = 0.25; off <= 25; off += 0.25) {
        place(probe, s, g * (edge + off));
        if (track.surfaceAt(probe.loc.i, probe.loc.d) === SURF.PIT) break;   // the pit lane, and the wall beyond it
        // a street wall stops the car: its wheel on the far side may not pass the wall (track.wall is from the centreline)
        if (track.street[side][i] && Math.abs(probe.loc.d) + car0.cfg.trackWidth / 2 > track.wall[side][i]) break;
        const n = probe.wheelSurf.filter(w => OFF.includes(w)).length;
        if (n > best.off) best = { off: n, s, d: g * (edge + off) };
      }
    }
  }
  if (best.off < 3) {
    console.log(`  ${c.name.padEnd(18)} no cut possible: at most ${Math.max(0, best.off)} wheel(s) on grass or gravel beyond the legal ground`);
    continue;
  }
  const car = place(new Car(GT, track), best.s, best.d);
  const lim = new TrackLimits([zone]);
  lim.update(car, 0, 1, 0);
  console.log(`  ${c.name.padEnd(18)} cut at s ${best.s.toFixed(0)}, ${best.off} wheels off: ${lim.events.length} warning(s)`);
  if (lim.events.length !== 1) fails.push(`${c.name}: a cut with ${best.off} wheels off gave ${lim.events.length} warnings`);
  cutCorners.push(c.name);
}
if (!cutCorners.length) fails.push('no corner can be cut at all');

// 3. scripted drives: the autopilot cuts two corners, and takes the racing line through every corner
console.log('SCRIPTED DRIVES (autopilot)');
for (const name of ['Windsock Hairpin', 'Searchlight']) {
  const zone = zones.find(z => z.name === name), side = zone.side < 0 ? 0 : 1;
  let reach = 0;
  for (let i = Math.round(zone.from); i <= Math.round(zone.to); i++) reach = Math.max(reach, legalEdge(side, wrap(i, track.N)));
  const cut = drive(zone, cutLine(zone, reach + 2.5));
  console.log(`  ${name.padEnd(18)} cut across the grass: ${cut.length} warning(s)`);
  if (cut.length < 1) fails.push(`${name}: the autopilot cut across the grass gave no warning`);
}
let cleanOk = 0;
for (const zone of zones) {
  const clean = drive(zone, racingLine);
  if (clean.length) fails.push(`${zone.name}: the racing line gave ${clean.length} warning(s)`);
  else cleanOk++;
}
console.log(`  racing line through ${zones.length} corners: ${cleanOk} with no warning`);

// 4. legal ground: every place in the zone where all four wheels are on kerb, sausage, run-off or pit gives no warning
console.log('LEGAL GROUND (kerbs, sausage kerbs, run-off, pit lane)');
{
  const names = ['Guardroom Chicane', 'Boundary Loop'];
  for (const name of names) {
    const zone = zones.find(z => z.name === name), c = CORNERS.find(k => k.name === name), side = sideOf(c), g = side ? 1 : -1;
    const car = new Car(GT, track), lim = new TrackLimits([zone]);
    const seen = { [SURF.RUNOFF]: 0, [SURF.KERB]: 0, [SURF.SAUSAGE]: 0, [SURF.PIT]: 0 };
    let checked = 0, cuts = 0;
    for (let s = zone.from; s <= zone.to; s += 1) {
      for (let off = 0.5; off <= 30; off += 0.5) {
        const d = g * (track.hw[sampleAt(s)] + off);
        place(car, s, d);
        if (!car.wheelSurf.every(w => LEGAL.includes(w))) continue;
        const cs = track.surfaceAt(car.loc.i, car.loc.d);
        if (seen[cs] !== undefined) seen[cs]++;
        checked++;
        if (cutting(car, [zone]) !== null) { cuts++; if (cuts <= 3) fails.push(`${name}: a legal place at s ${s.toFixed(0)}, ${off} m out, gave a cut`); }
      }
    }
    console.log(`  ${name.padEnd(18)} ${checked} places with four legal wheels: run-off ${seen[SURF.RUNOFF]}, kerb ${seen[SURF.KERB]}, sausage ${seen[SURF.SAUSAGE]}, pit ${seen[SURF.PIT]}; cuts ${cuts}`);
    // the chicane's paved apron beside the pit entry lane is grass now (the owner's narrow-entry request), so its legal places are kerb and pit lane
    if (name === 'Guardroom Chicane' && checked === 0) fails.push('Guardroom Chicane: found no legal ground to test');
    if (name === 'Boundary Loop' && seen[SURF.KERB] === 0) fails.push('Boundary Loop: found no kerb to test');
  }
}

// 5. the wheel count. The surfaces are set by hand here, the positions are real.
console.log('WHEEL COUNT (surfaces set by hand)');
{
  const c = CORNERS.find(k => k.name === 'Aileron'), side = sideOf(c), g = side ? 1 : -1;
  const s = c.apexS, i = sampleAt(s), edge = legalEdge(side, i);
  const kerbSpot = place(new Car(GT, track), s, g * (track.hw[i] + 1.0));    // all four wheels just beyond the line, centre on kerb
  const grassSpot = place(new Car(GT, track), s, g * (edge + 2));          // centre on grass
  const cases = [
    ['three on grass, one on the line', kerbSpot, [SURF.GRASS, SURF.GRASS, SURF.GRASS, SURF.PAINT], true],
    ['two on grass, two on the line', kerbSpot, [SURF.GRASS, SURF.GRASS, SURF.PAINT, SURF.PAINT], false],
    ['one on grass, three on tarmac', kerbSpot, [SURF.GRASS, SURF.TARMAC, SURF.TARMAC, SURF.TARMAC], false],
    ['two on grass, centre on grass', grassSpot, [SURF.GRASS, SURF.GRASS, SURF.RUNOFF, SURF.RUNOFF], true],
    ['one on grass, centre on grass', grassSpot, [SURF.GRASS, SURF.RUNOFF, SURF.RUNOFF, SURF.RUNOFF], false],
  ];
  for (const [label, car, surfs, want] of cases) {
    car.wheelSurf = surfs;
    const got = cutOnSide(car, g) === true;
    console.log(`  ${label.padEnd(32)} ${got ? 'cut' : 'no cut'}`);
    if (got !== want) fails.push(`wheel count: ${label} should be ${want ? 'a cut' : 'no cut'}`);
  }
}

// 6. two cuts within 3 s: both logged and counted, one banner
console.log('REPEAT CUTS');
{
  const zone = zones.find(z => z.name === 'Aileron'), c = CORNERS.find(k => k.name === 'Aileron'), g = sideOf(c) ? 1 : -1;
  const s = c.apexS, i = sampleAt(s);
  const off = place(new Car(GT, track), s, g * (legalEdge(sideOf(c), i) + 2));
  const on = place(new Car(GT, track), s, 0);
  const lim = new TrackLimits([zone]);
  lim.update(off, 10.0, 1, 0);
  lim.update(on, 10.5, 1, 0.5);
  lim.update(off, 11.0, 1, 1.0);
  const banners = lim.takeNew();
  console.log(`  cut at 10.0 s and again at 11.0 s: ${lim.events.length} logged, ${lim.countFor(1)} counted on lap 1, ${banners.length} banner`);
  if (lim.events.length !== 2 || lim.countFor(1) !== 2) fails.push(`repeat cuts: ${lim.events.length} logged, ${lim.countFor(1)} counted (both should count)`);
  if (banners.length !== 1) fails.push(`repeat cuts: ${banners.length} banners within ${COOLDOWN} s (one)`);
  lim.update(on, 13.0, 1, 3.0);
  lim.update(off, 14.0, 1, 4.0);
  const later = lim.takeNew();
  if (later.length !== 1) fails.push('repeat cuts: a cut after the cooldown should show a banner');
}

// 7. reverse: the same cut at every metre of the zone, facing forwards and backwards, gives the same warnings
console.log('REVERSE');
for (const c of inside) {
  const zone = zones.find(z => z.name === c.name), side = sideOf(c), g = side ? 1 : -1;
  const run = reverse => {
    const car = new Car(GT, track), lim = new TrackLimits([zone]);
    const names = [];
    for (let s = zone.from; s <= zone.to; s += 2) {
      const i = sampleAt(s);
      place(car, s, g * (legalEdge(side, i) + 2), reverse);
      names.push(cutting(car, [zone]) ? 1 : 0);
      lim.update(car, s, 1, 0);
    }
    return { names: names.join(''), events: lim.events.length };
  };
  const fwd = run(false), back = run(true);
  if (fwd.names !== back.names || fwd.events !== back.events) fails.push(`${c.name}: reverse gives ${back.events} warnings, forwards ${fwd.events}`);
  if (c.name === 'Aileron' || c.name === 'Windsock Hairpin') console.log(`  ${c.name.padEnd(18)} forwards ${fwd.events} warning(s), reverse ${back.events}, same metres: ${fwd.names === back.names}`);
}

if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nPASS');
