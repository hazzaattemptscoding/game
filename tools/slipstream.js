// Slipstream tests. Run with `node tools/slipstream.js` (also part of `npm run check`). No browser needed.
//   1. wakeFor: in line, offset, too far, too slow, behind and ahead, ghost excluded, the session rule off
//   2. the easing: no jump larger than the limit per step, rise 0.15 s, fall 0.3 s
//   3. drag and downforce in the physics: top speed, DRS stacking, the 40 percent cap, front grip in dirty air, class values
//   4. the setting and the rule: settings, sessions, the race message
//   5. a two-car lap: a follower behind a pace car of the same speed, with and without the draft
import { wakeFor, easeWake, draftDragCut, totalDragCut, dirtyAirLoss, ATTACK_S, RELEASE_S, MAX_DRAG_CUT, DRAFT_DRAG } from '../src/slipstream.js';
import { Car, STEP } from '../src/physics.js';
import { SURF, buildTrack } from '../src/track.js';
import { GT, GT1, CITY, CARS } from '../src/cars.js';
import { makeSession } from '../src/session.js';
import { migrateSettings } from '../src/settings.js';
import { createRaceControl, cleanRaceMessage } from '../src/raceControl.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';

const fails = [];
const DRIVE = { steer: 0, throttle: 1, brake: 0, drs: false };
const check = (ok, what) => { if (!ok) { fails.push(what); console.log('  FAIL ' + what); } };
const kmh = v => v * 3.6;

// --- 1. wakeFor ---------------------------------------------------------------------------------------------------------
console.log('WAKE FROM POSES');
// Everything on the x axis facing +x. The follower is `me`; a leader is `gap` metres ahead of my nose (4.6 m cars).
const me = { x: 0, z: 0, heading: 0, length: 4.6 };
const lead = (gap, o = {}) => ({ id: 'a', x: gap + 4.6, z: 0, heading: 0, vx: 70, vz: 0, length: 4.6, age: 10, silent: 0, ...o });
const near = wakeFor(me, [lead(5)]);
check(near.strength === 1 && Math.abs(near.distance - 5) < 1e-9 && near.leaderIndex === 0, `5 m behind a fast car in line: full strength (${near.strength}), distance 5 (${near.distance})`);
check(wakeFor(me, [lead(8)]).strength === 1, 'full strength out to 8 m');
const mid = wakeFor(me, [lead(24)]).strength;
check(mid > 0.3 && mid < 0.7, `half way out (24 m) is about half (${mid.toFixed(2)})`);
check(wakeFor(me, [lead(40)]).strength === 0 && wakeFor(me, [lead(60)]).strength === 0, 'nothing from 40 m');
let prev = 1, mono = true;
for (let g = 8; g <= 40; g += 0.5) { const s = wakeFor(me, [lead(g)]).strength; if (s > prev + 1e-9) mono = false; prev = s; }
check(mono, 'the wake only gets weaker with the gap');
check(wakeFor(me, [lead(5, { z: 0.5 })]).strength > 0.9, 'half a metre off the line still drafts at close range');
check(wakeFor(me, [lead(5, { z: 1.3 })]).strength === 0, '1.3 m off the line at close range: no draft');
check(wakeFor(me, [lead(30, { z: 1.5 })]).strength > 0 && wakeFor(me, [lead(30, { z: 1.5 })]).strength < wakeFor(me, [lead(30)]).strength, '1.5 m off at 30 m: the window is wider, the draft weaker');
check(wakeFor(me, [lead(30, { z: 2.1 })]).strength === 0, 'over 2 m off at distance: none');
const turned = a => lead(5, { heading: a, x: 9.6 * Math.cos(a), z: 9.6 * Math.sin(a), vx: 70 * Math.cos(a), vz: 70 * Math.sin(a) });   // me on its line, it turned by a
check(wakeFor(me, [turned(0.2)]).strength > 0.5, 'a heading difference of 11 degrees still drafts');
check(wakeFor(me, [turned(0.5)]).strength === 0, 'a heading difference of 29 degrees: no draft');
check(wakeFor(me, [lead(5, { vx: 24, vz: 0 })]).strength === 0, 'a leader at 24 m/s makes no wake');
check(wakeFor(me, [lead(5, { vx: 26, vz: 0 })]).strength < 0.1, 'just over 25 m/s the wake starts from nothing, no step');
check(wakeFor(me, [lead(5, { vx: 33, vz: 0 })]).strength === 1, 'full from 32 m/s');
check(wakeFor(me, [{ ...lead(5), x: -9.2 }]).strength === 0, 'a car behind me gives me nothing');
check(wakeFor(me, [lead(5, { ghost: true })]).strength === 0, 'the ghost lap is never a leader');
check(wakeFor(me, [lead(5, { silent: 0.8 })]).strength === 0 && wakeFor(me, [lead(5, { age: 0.5 })]).strength === 0, 'a car that went quiet or has just appeared is skipped, as in collisions');
check(wakeFor(me, [lead(5)], { enabled: false }).strength === 0, 'session rule off (time trial): no wake');
check(wakeFor(me, []).strength === 0 && wakeFor(me, null).leaderIndex === -1, 'no other cars: no wake');
const two = wakeFor(me, [lead(30), lead(6, { id: 'b' })]);
check(two.leaderIndex === 1 && two.strength === 1, 'with two cars ahead the nearer one counts');
// turned about: the same test with everything rotated 90 degrees and moved
const rot = (o, a) => ({ ...o, x: o.x * Math.cos(a) - o.z * Math.sin(a) + 100, z: o.x * Math.sin(a) + o.z * Math.cos(a) - 50, heading: o.heading + a, vx: o.vx * Math.cos(a), vz: o.vx * Math.sin(a) });
check(wakeFor(rot(me, 2.1), [rot(lead(5), 2.1)]).strength === 1, 'the same in another direction on the map');
check(wakeFor({ ...rot(me, 3.1), heading: 3.1 - 2 * Math.PI }, [rot(lead(5), 3.1)]).strength === 1, 'headings a full turn apart compare as equal');

// --- 2. easing ----------------------------------------------------------------------------------------------------------
console.log('EASING');
{
  let s = 0, maxUp = 0, maxDown = 0, tUp = 0, tDown = 0;
  for (let k = 0; k < 120; k++) { const n = easeWake(s, 1, STEP); maxUp = Math.max(maxUp, n - s); s = n; if (s < 1) tUp += STEP; }
  check(Math.abs(tUp - ATTACK_S) < 2 * STEP && s === 1, `rises to 1 in ${tUp.toFixed(3)} s (0.15 s)`);
  for (let k = 0; k < 120; k++) { const n = easeWake(s, 0, STEP); maxDown = Math.max(maxDown, s - n); s = n; if (s > 0) tDown += STEP; }
  check(Math.abs(tDown - RELEASE_S) < 2 * STEP && s === 0, `falls to 0 in ${tDown.toFixed(3)} s (0.3 s)`);
  check(maxUp < 0.06 && maxDown < 0.03, `largest step ${maxUp.toFixed(3)} up, ${maxDown.toFixed(3)} down per physics step`);
  // through the car: a draft that switches on and off every few steps never moves the strength by more than a step
  const car = flatCar(GT); car.vx = 60; let worst = 0, last = 0;
  for (let k = 0; k < 600; k++) { if ((k >> 3) & 1) car.setWake(1, 5); car.step(DRIVE); worst = Math.max(worst, Math.abs(car.wake - last)); last = car.wake; }
  check(worst < 0.06, `through Car.step the strength moves by at most ${worst.toFixed(3)} a step`);
  car.step(DRIVE); car.step(DRIVE); car.step(DRIVE);
  const forgot = flatCar(GT); forgot.vx = 60; forgot.setWake(1, 5); forgot.step(DRIVE);
  for (let k = 0; k < 60; k++) forgot.step(DRIVE);
  check(forgot.wake === 0, 'a caller that stops telling the car about a wake gets no wake after 0.3 s');
}

// --- 3. physics ---------------------------------------------------------------------------------------------------------
console.log('DRAG AND DOWNFORCE');
function topSpeed(cfg, wake, drs = false, seconds = 120) {
  const car = flatCar(cfg, drs); car.vx = 50; let top = 0;
  for (let k = 0; k < seconds / STEP; k++) { if (wake) car.setWake(wake, 5); car.step({ steer: 0, throttle: 1, brake: 0, drs }); top = Math.max(top, car.fwdSpeed); }
  return top;
}
{
  const alone = topSpeed(GT, 0), drafted = topSpeed(GT, 1);
  const gain = kmh(drafted - alone);
  console.log(`  GT top speed alone ${kmh(alone).toFixed(1)} km/h, 5 m behind a car: ${kmh(drafted).toFixed(1)} km/h (+${gain.toFixed(1)})`);
  check(gain >= 3 && gain <= 12, `the GT gains ${gain.toFixed(1)} km/h at the top (3 to 12; it ends at the rev limit of 6th gear)`);
  const half = kmh(topSpeed(GT, 0.5) - alone);
  check(half > 0 && half < gain + 0.01, `half strength gains ${half.toFixed(1)} km/h, no more than full`);
  // the gain where the engine is not yet at its limit: speed 8 s after a start from 60 m/s
  const at = (w, s) => { const car = flatCar(GT); car.vx = 60; for (let k = 0; k < s / STEP; k++) { if (w) car.setWake(w, 5); car.step({ steer: 0, throttle: 1, brake: 0, drs: false }); } return car.fwdSpeed; };
  console.log(`  GT speed 6 s after 60 m/s flat out: alone ${kmh(at(0, 6)).toFixed(1)}, drafted ${kmh(at(1, 6)).toFixed(1)} km/h`);
  check(at(1, 6) > at(0, 6), 'a drafting car accelerates harder');
  const soft = flatCar(GT); soft.vx = 70; const same = flatCar(GT); same.vx = 70;
  for (let k = 0; k < 600; k++) { soft.step(DRIVE); same.step(DRIVE); }
  check(soft.vx === same.vx && soft.x === same.x, 'a car that is never told of a wake is the same car as before (no effect when the rule is off)');
}
{
  // DRS and draft together
  const car = flatCar(GT, true); car.vx = 70; let worst = 0;
  for (let k = 0; k < 600; k++) { car.setWake(1, 5); car.step({ steer: 0, throttle: 1, brake: 0, drs: true }); worst = Math.max(worst, car.draftCut); }
  check(car.drs && Math.abs(worst - (GT.drsDragCut + GT.draftDrag)) < 1e-9 && worst < MAX_DRAG_CUT, `GT with DRS open and a full draft cuts ${(100 * worst).toFixed(0)} percent of drag, under 40`);
  const a = topSpeed(GT, 0, true, 60), b = topSpeed(GT, 1, true, 60), c = topSpeed(GT, 0, false, 60);
  check(a > c && b >= a, `DRS alone ${kmh(a).toFixed(1)}, DRS and draft ${kmh(b).toFixed(1)} km/h: they stack`);
  const big = { ...GT, draftDrag: 0.5 }, bc = flatCar(big, true); bc.vx = 70;
  for (let k = 0; k < 300; k++) { bc.setWake(1, 5); bc.step({ steer: 0, throttle: 1, brake: 0, drs: true }); }
  check(Math.abs(bc.draftCut - MAX_DRAG_CUT) < 1e-9, 'a class that asks for more than 40 percent is held at 40');
  check(totalDragCut(0.3, 0.2) === MAX_DRAG_CUT && totalDragCut(0.2, 0.1) === 0.2 + 0.1, 'totalDragCut caps at 40 percent');
}
{
  // front downforce: the loss is 12 percent close behind a car, nothing from 14 m, and scales with the strength
  check(Math.abs(dirtyAirLoss(1, 5) - 0.12) < 1e-9 && Math.abs(dirtyAirLoss(1, 10) - 0.12) < 1e-9, 'a full wake under 10 m takes 12 percent of the front downforce');
  check(dirtyAirLoss(1, 14) === 0 && dirtyAirLoss(1, 30) === 0 && dirtyAirLoss(0, 5) === 0, 'none from 14 m, none without a wake');
  check(dirtyAirLoss(0.5, 5) === 0.06, 'half strength takes 6 percent');
  // through the car: the same steady corner at 60 m/s, with and without a wake. The front has less grip: less lateral acceleration.
  const grip0 = GT.grip;   // read before the runs: the class value must be the same after them
  const corner = w => {
    const car = flatCar(GT); car.setAssists(true); car.vx = 60;
    let ay = 0;
    for (let k = 0; k < 3 / STEP; k++) {
      if (w) car.setWake(1, 5);
      car.step({ steer: k * STEP > 0.3 ? 0.6 : 0, throttle: Math.max(0, Math.min(1, 0.4 + (60 - car.fwdSpeed) * 0.5)), brake: 0, drs: false });
      if (k * STEP > 2.5) ay += Math.abs(car.ay);
    }
    return ay / (0.5 / STEP) / 9.81;
  };
  const g0 = corner(false), g1 = corner(true);
  console.log(`  steady corner at 60 m/s: ${g0.toFixed(3)} g alone, ${g1.toFixed(3)} g in dirty air`);
  check(g1 < g0, 'in dirty air the same steering gives less cornering force (understeer in traffic)');
  // tyre grip is untouched: the numbers on the class are the same, and a car with no wake corners as before
  check(GT.grip === grip0 && flatCar(GT).cfg.grip === grip0, 'tyre grip itself is not changed');
  // leaving the wake keeps the last gap, so the front downforce loss eases out and does not jump to the 12 percent of a gap of 0
  {
    const car = flatCar(GT); car.vx = 60;
    for (let k = 0; k < 120; k++) { car.setWake(1, 12); car.step({ steer: 0, throttle: 0.5, brake: 0, drs: false }); }
    car.setWake(0, 0); car.step({ steer: 0, throttle: 0.5, brake: 0, drs: false });
    check(car.wakeGap === 12, 'a step with no wake keeps the last gap');
  }
}
{
  // class values
  check(GT.draftDrag === 0.25 && CITY.draftDrag === 0.2 && GT1.draftDrag === 0.28, 'GT 0.25, CITY 0.2, GT1 0.28');
  check(Object.values(CARS).every(c => c.draftDrag > 0 && c.draftDrag <= 0.3), 'every class has a draft value up to 0.3');
  check(Math.abs(draftDragCut(1, GT) - 0.25) < 1e-12 && Math.abs(draftDragCut(1, CITY) - 0.2) < 1e-12 && Math.abs(draftDragCut(1, GT1) - 0.28) < 1e-12, 'draftDragCut reads the class');
  check(draftDragCut(1, { }) === DRAFT_DRAG && draftDragCut(0.5, GT) === 0.125, 'a class with no value uses 0.25; half strength is half the cut');
  // in absolute terms the bigger drag area gains more: drag removed in newtons at 70 m/s
  const N = c => 0.5 * 1.225 * 70 * 70 * c.dragArea * c.draftDrag;
  check(N(GT) > N(CITY) && N(GT) > N(GT1) * 0.9, `drag removed at 70 m/s: GT ${N(GT).toFixed(0)} N, GT1 ${N(GT1).toFixed(0)} N, CITY ${N(CITY).toFixed(0)} N`);
  for (const cfg of [GT, GT1, CITY]) {
    const car = flatCar(cfg); car.vx = 60;
    for (let k = 0; k < 120; k++) { car.setWake(1, 5); car.step(DRIVE); }
    check(Math.abs(car.draftCut - cfg.draftDrag) < 1e-9, `${cfg.id}: the car cuts ${(100 * car.draftCut).toFixed(0)} percent of its drag at full strength`);
  }
}

// --- 4. the setting and the rule ----------------------------------------------------------------------------------------
console.log('SETTING AND RULE');
{
  check(migrateSettings({}).slipstream === undefined, 'an old save has no slipstream key (the default, on, comes from DEFAULTS)');
  check(migrateSettings({ slipstream: false }).slipstream === false && migrateSettings({ slipstream: 'x' }).slipstream === true, 'the saved setting: false stays false, anything else is on');
  check(makeSession('race').slipstream === true && makeSession('online').slipstream === true && makeSession('practice').slipstream === true, 'races and practice draft by default');
  check(makeSession('timetrial').slipstream === false && makeSession('timetrial', { slipstream: true }).slipstream === false, 'a time trial never drafts, whatever is asked');
  check(makeSession('race', { slipstream: false }).slipstream === false && makeSession('practice', { slipstream: false }).slipstream === false, 'the race setup and the practice setting switch it off');
  check(makeSession('race', { slipstream: 'no' }).slipstream === true, 'a value that is not a boolean is ignored');
  const sent = [];
  const mp = { isHost: true, selfId: 'h', peers: new Map(), sendControl: m => sent.push(m), code: 'ABCDE' };
  const rc = createRaceControl({ mp, now: () => 1000, random: () => 0.5, setTimeout: () => {} });
  rc.hostStart({ laps: 3, slipstream: false });
  check(sent[0] && sent[0].t === 'race' && sent[0].slipstream === false, 'the host puts its slipstream rule in the race message');
  check(cleanRaceMessage(sent[0]).slipstream === false, 'a guest reads it');
  // wakeFor fills the object it is given and returns it (the game's physics loop allocates none)
  {
    const out = { strength: -1, distance: -1, leaderIndex: -9 };
    const none = wakeFor({ x: 0, z: 0, heading: 0 }, [], { out });
    check(none === out && out.strength === 0 && out.distance === 0 && out.leaderIndex === -1, 'wakeFor with nobody ahead fills the given object with none');
    const lead = { x: 12, z: 0, heading: 0, vx: 60, vz: 0, length: 4.6, age: 99, silent: 0 };
    const hit = wakeFor({ x: 0, z: 0, heading: 0, length: 4.6 }, [lead], { out });
    check(hit === out && out.strength > 0.9 && out.leaderIndex === 0, 'and with a leader close ahead, the same object with the wake');
    const plain = wakeFor({ x: 0, z: 0, heading: 0, length: 4.6 }, [lead]);
    check(plain !== out && plain.strength === out.strength && plain.distance === out.distance, 'without out it still returns a fresh object with the same numbers');
  }
  const old = { ...sent[0], slipstream: true }; delete old.slipstream;
  check(cleanRaceMessage(old).slipstream === false, 'a message from an older host (no field, no drafting there) means the draft is off');
  check(cleanRaceMessage({ ...sent[0], slipstream: 'x' }).slipstream === false, 'junk in the field counts as off');
  check(cleanRaceMessage({ ...sent[0], slipstream: true }).slipstream === true, 'true is on');
  rc.hostStart({ laps: 3 });
  check(sent[1].slipstream === true, 'the host default is on');
}

// --- 5. two cars round the lap -------------------------------------------------------------------------------------------
console.log('TWO CARS ROUND LAKESIDE (same pace, the follower starts 12 m behind)');
{
  const track = buildTrack(), line = computeRacingLine(track);
  const run = (draft, gapAt = 12, cfg = GT) => {
    const lead = new Car(cfg, track), fol = new Car(cfg, track);
    lead.placeAt(-20 + gapAt, 0); fol.placeAt(-20, 0);
    const apL = new Autopilot(track, cfg, { skill: 0.9, line }), apF = new Autopilot(track, cfg, { skill: 0.9, line });
    const tl = new LapTimer(track), tf = new LapTimer(track);
    let t = 0, sum = 0, n = 0, inWake = 0, minGap = 1e9, topL = 0, topF = 0;
    while (tf.lap < 2 && t < 400) {
      lead.step(apL.drive(lead));
      if (draft) {
        const w = wakeFor(fol, [{ id: 'lead', x: lead.x, z: lead.z, heading: lead.heading, vx: lead.vx, vz: lead.vz, length: cfg.length, age: 99, silent: 0 }], { length: cfg.length });
        fol.setWake(w.strength, w.distance);
      }
      fol.step(apF.drive(fol));
      t += STEP;
      tl.update(lead.loc.s, t); tf.update(fol.loc.s, t);
      if (tf.lap >= 1) {
        n++; sum += fol.wake; if (fol.wake > 0.1) inWake++;
        minGap = Math.min(minGap, Math.hypot(lead.x - fol.x, lead.z - fol.z));
        topL = Math.max(topL, lead.fwdSpeed); topF = Math.max(topF, fol.fwdSpeed);
      }
    }
    return { lead: tl.last, fol: tf.last, mean: sum / n, share: inWake / n, minGap, topL, topF };
  };
  const base = run(false), dr = run(true);
  const f = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
  console.log(`  pace car lap ${f(base.lead)}; follower without a draft ${f(base.fol)}, with it ${f(dr.fol)}`);
  console.log(`  time gained on the lap ${(base.fol - dr.fol).toFixed(3)} s; in the wake ${(100 * dr.share).toFixed(0)} percent of the lap (mean strength ${dr.mean.toFixed(2)}); top ${(kmh(dr.topF)).toFixed(0)} vs pace car ${(kmh(dr.topL)).toFixed(0)} km/h`);
  check(base.lead != null && dr.fol != null, 'both cars finished the lap');
  check(Math.abs(base.fol - base.lead) < 0.3, `without a draft the follower lap matches the pace car (${f(base.fol)} v ${f(base.lead)})`);
  check(base.fol - dr.fol > 0.05 && base.fol - dr.fol < 2, `the draft gains ${(base.fol - dr.fol).toFixed(3)} s a lap behind a car of the same pace`);
  check(dr.share > 0.08, 'the follower is in the wake on the straights (it is out of line in the corners, where the window is a metre or two)');
}

console.log(fails.length ? `\nFAIL (${fails.length})\n  ` + fails.join('\n  ') : '\nslipstream: all checks passed');
process.exitCode = fails.length ? 1 : 0;

// --- helpers ---
function flatCar(cfg, drsZone = false) {
  const N = 10, flat = new Float64Array(N);
  const pad = {
    N, ds: 1, length: N, halfWidth: 1e6, x: flat, z: flat, h: flat, tx: new Float64Array(N).fill(1), tz: flat,
    nx: flat, nz: new Float64Array(N).fill(1), wall: [new Float64Array(N).fill(1e9), new Float64Array(N).fill(1e9)],
    locate: (x, z, h, o) => Object.assign(o, { i: 0, s: 0, d: 0, h: 0, grade: 0, vcurv: 0, tx: 1, tz: 0, nx: 0, nz: 1 }),
    surfaceAt: () => SURF.TARMAC, inDRS: () => drsZone,
    pitWallIn: flat, inPitLimiter: () => false, pitSpeed: 99,
  };
  return new Car(cfg, pad);
}
