// Session, start sequence and online start tests. Run with `npm run session` (also part of `npm run check`). No browser needed.
//   1. the session state machine: menu to practice, race setup to start to race to finish to results, restart, back to menu
//   2. the start sequence with an injected clock and random: light cadence, hold range, jump start with its tolerance, penalty
//   3. lap counting and the finish rule, positions, results ordering
//   4. the grid and pit slots on the real track
//   5. the clock offset estimate and the online schedule
//   6. the finish message (src/finish.js) and the results table (src/session.js raceRows): validation, order, DNF, late finishes
//   7. the results screen's view model (src/results.js), in node
import { StartSequence, START, pickHold, goOffset, gridSlot, pitSlot, sampleOffset, estimateOffset, toLocalTime, scheduleStart, sequenceFromMessage, cinematicPose, orbitPose } from '../src/start.js';
import { makeSession, Flow, PHASE, RaceTracker, RACE, orderResults, raceRows, timeTrialRows, hasStartLights } from '../src/session.js';
import { buildTrack } from '../src/track.js';
import { createRaceControl, cleanRaceMessage, SAMPLES } from '../src/raceControl.js';
import { TIMES, WEATHERS, resolveEnv, blendEnv, cleanEnv, cleanWeather, cleanTime, envFromParams, shadowsOn, DEFAULT_ENV } from '../src/weather.js';
import { migrateSettings } from '../src/settings.js';
import { boltShape } from '../src/environment.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { LapTimer } from '../src/timing.js';
import { Autopilot, computeRacingLine } from '../src/autopilot.js';
import { limitZones, timeGained, TOLERANCE } from '../src/trackLimits.js';
import { limitBanner } from '../src/sessionHud.js';
import { cleanFinish, FinishBook, FIN } from '../src/finish.js';
import { resultsModel, sampleResults, chipInk } from '../src/results.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('SESSIONS');
{
  const p = makeSession('practice'), t = makeSession('timetrial'), r = makeSession('race', { laps: 10, assists: 'off', racingLine: false });
  check(p.mode === 'practice' && p.laps === 0 && p.start === 'pit' && p.assists === 'any' && p.ai === 0, 'practice defaults');
  check(t.mode === 'timetrial' && t.start === 'pit' && t.trackLimits === 'warn', 'time trial defaults');
  check(r.laps === 10 && r.assists === 'off' && r.racingLine === false && r.start === 'standing', 'race options are kept');
  check(makeSession('race').laps === 5, 'race defaults to 5 laps');
  check(makeSession('race', { laps: 500 }).laps === 99 && makeSession('race', { laps: 0 }).laps === 1, 'custom laps are clamped to 1 to 99');
  check(makeSession('race', { slot: 3 }).slot === 3 && makeSession('race', { slot: -2 }).slot === 0, 'grid slot');
  check(makeSession('nonsense').mode === 'practice', 'unknown mode falls back to practice');
  check(makeSession('race').trackLimits === 'penalty' && makeSession('race', { trackLimits: 'warn' }).trackLimits === 'warn' && makeSession('race', { trackLimits: 'bogus' }).trackLimits === 'penalty', 'the race setup Track limits choice reaches the session (warn or penalty)');
  check(makeSession('practice', { start: 'standing' }).start === 'standing', 'practice may start on the grid');
  check(p.weather === 'clear' && p.time === 'midday' && makeSession('race', { weather: 'heavyrain', time: 'night' }).weather === 'heavyrain' && makeSession('race', { weather: 'x', time: 9 }).time === 'midday', 'weather and time are part of the session, bad values fall back to clear midday');
  check(!hasStartLights(p) && !hasStartLights(t) && hasStartLights(r) && hasStartLights(makeSession('online')), 'only races have start lights');
}

console.log('START SEQUENCE');
{
  // cadence: cinematic 3 s, a light every 0.9 s, hold, then lights out
  const seq = new StartSequence({ t0: 1000, hold: 1500 });
  const at = ms => seq.state(1000 + ms);
  check(seq.state(900).phase === 'wait', 'before t0 the sequence waits');
  check(at(0).phase === 'cinematic' && at(2999).phase === 'cinematic' && at(2999).lit === 0, 'cinematic for 3 s with no lights');
  check(near(at(1500).cam, 0.5), 'camera progress is half way at 1.5 s');
  check(at(3000).lit === 1 && at(3000).phase === 'lights', 'light 1 at 3.0 s');
  check(at(3899).lit === 1 && at(3900).lit === 2, 'light 2 at 3.9 s (0.9 s apart)');
  check(at(4800).lit === 3 && at(5700).lit === 4 && at(6600).lit === 5, 'lights 3, 4, 5 at 4.8, 5.7, 6.6 s');
  check(at(6600).phase === 'hold' && at(8099).phase === 'hold' && at(8099).lit === 5, 'all five stay lit for the hold');
  check(!at(8099).released && at(8100).released && at(8100).phase === 'go' && at(8100).lit === 0, 'lights out at 3 + 3.6 + 1.5 = 8.1 s');
  check(near(seq.goAt, 1000 + 8100) && goOffset(1500) === 8100, 'goAt and goOffset agree');
  check(at(8100 + START.GO_SHOW_MS - 1).phase === 'go' && at(8100 + START.GO_SHOW_MS).phase === 'done', 'GO stays up 2.2 s');

  // the hold comes from the injected random, within 0.6 to 2.8 s
  check(pickHold(() => 0) === 600 && near(pickHold(() => 0.999999), 2800, 0.01) && near(pickHold(() => 0.5), 1700), 'hold range 0.6 to 2.8 s');
  let lo = 1e9, hi = 0; for (let i = 0; i < 2000; i++) { const h = pickHold(); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  check(lo >= 600 && hi <= 2800 && hi - lo > 1500, 'real random stays in range and varies');
  const f = new Flow({ random: () => 0.5 });
  f.begin(makeSession('race'), 0);
  check(f.seq.hold === 1700, 'the flow takes its hold from the injected random');

  // jump start
  const j = (throttle, kmh, ms, hold = 1500) => { const s = new StartSequence({ t0: 0, hold }); return { s, r: s.check(ms, throttle, kmh) }; };
  check(j(1, 0, 1000).r === null, 'throttle during the cinematic is not a jump start (the lights are not on yet)');
  check(j(1, 0, 3000).r && j(1, 0, 3000).r.cause === 'throttle', 'throttle at the first light is a jump start');
  check(j(0.05, 0, 5000).r === null, 'a touch of throttle under 0.1 is ignored');
  check(j(0, 3, 5000).r === null && j(0, 3.01, 5000).r && j(0, 3.01, 5000).r.cause === 'moving', '3 km/h is tolerated, more is a jump start');
  check(j(0, 20, 5000).r.light === 3, 'the record says which light was on');
  check(j(1, 0, 8100).r === null && j(1, 80, 8100).r === null, 'throttle at lights out is a good start, not a jump');
  const g = new StartSequence({ t0: 0, hold: 1500 });
  check(g.check(5000, 1, 0) !== null && g.check(5100, 1, 0) === null && g.penalty === 5 && g.jump.at === 5000, 'a jump start is recorded once and costs 5 s');
  const clean = new StartSequence({ t0: 0, hold: 1500 });
  clean.check(5000, 0, 0);
  check(clean.penalty === 0 && clean.jump === null, 'no jump, no penalty');
  clean.check(8100 + 230, 0.2, 0);
  check(clean.reaction === 230, 'reaction time is measured from lights out to the first throttle');
  const ready = new StartSequence({ t0: 0, kind: 'ready' });
  check(ready.check(1000, 1, 50) === null && ready.penalty === 0, 'the time trial countdown has no jump start');
  check(ready.state(0).count === 3 && ready.state(1001).count === 2 && ready.state(2500).count === 1 && ready.state(3000).phase === 'go', 'ready countdown 3, 2, 1, go');
  const sh = new StartSequence({ t0: 0, hold: 1000 }); sh.shift(4000);
  check(sh.state(3999).phase === 'wait' && sh.state(4000).phase === 'cinematic' && near(sh.goAt, 4000 + goOffset(1000)), 'shift moves the sequence');
}

console.log('FLOW');
{
  let t = 0;
  const f = new Flow({ random: () => 0 });
  check(f.phase === PHASE.MENU, 'starts at the menu');
  // menu -> practice: no start, straight to run
  check(f.begin(makeSession('practice'), t) && f.phase === PHASE.RUN && f.seq === null && f.race === null, 'practice goes straight to run');
  check(!f.finish([]), 'practice has no results');
  check(f.pause() && f.phase === PHASE.PAUSED && f.resume() && f.phase === PHASE.RUN, 'pause and resume');
  check(f.toMenu() && f.phase === PHASE.MENU && f.session === null, 'back to menu clears the session');
  // time trial: ready countdown first
  f.begin(makeSession('timetrial'), t);
  check(f.phase === PHASE.START && f.seq.kind === 'ready', 'time trial starts with the countdown');
  check(f.update(2999) === null && f.update(3000) === 'run' && f.phase === PHASE.RUN, 'countdown ends in run');
  f.toMenu();
  // race: setup -> start -> run -> results
  check(f.openSetup('race') && f.phase === PHASE.SETUP && f.setupMode === 'race', 'race setup opens from the menu');
  check(f.cancelSetup() && f.phase === PHASE.MENU, 'setup can be cancelled');
  f.openSetup('race');
  const s = makeSession('race', { laps: 3 });
  t = 10000;
  check(f.begin(s, t, { hold: 1000 }) && f.phase === PHASE.START && f.race.laps === 3, 'race begins with the start sequence');
  check(!f.begin(s, t), 'a session cannot begin over a running one');
  check(f.update(t + 5000, 5) === null, 'still on the grid at 5 s');
  f.seq.check(t + 4000, 1, 0); // jump
  check(f.update(t + goOffset(1000) - 1, 8) === null, 'not released one ms early');
  check(f.update(t + goOffset(1000), 8.1) === 'run' && f.phase === PHASE.RUN, 'lights out starts the race');
  check(f.race.startSim === 8.1 && f.race.penalty === 5 && f.race.penalties[0].reason === 'Jump start', 'the jump start penalty goes on the race');
  check(f.pause() && f.resume(), 'pause in the race');
  // restart
  check(f.pause() && f.restart(t + 20000, { hold: 800 }) && f.phase === PHASE.START && f.race.penalty === 0 && f.seq.hold === 800, 'restart session: a fresh start and a clean race');
  f.update(t + 20000 + goOffset(800), 30);
  // finish -> results
  check(f.finish(raceRows([{ id: 'me', me: true, finished: true, time: 100 }])) && f.phase === PHASE.RESULTS && f.results[0].rank === 1, 'finish gives the results');
  check(f.restart(t + 99000) && f.phase === PHASE.START, 'race again from the results');
  f.update(t + 99000 + goOffset(f.seq.hold), 0);
  f.finish([{ id: 'me', me: true, finished: true, time: 90 }]);
  check(f.toMenu() && f.phase === PHASE.MENU && f.results === null, 'back to menu from the results');
  check(f.log.join(' ').includes('setup:race') && f.log[f.log.length - 1] === 'menu', 'phase log');
}

console.log('RACE: LAPS, FINISH, POSITION');
{
  const r = new RaceTracker({ laps: 3, length: 4000 });
  r.start(100);
  const me = (laps, s = 0) => ({ laps, lap: laps + 1, s });
  check(r.update(110, me(0, 100)).pos === 1 && r.state === RACE.RACING, 'alone: position 1 of 1');
  check(r.update(150, me(2)).pos === 1 && r.state === RACE.RACING && !r.finished, 'two laps of three: still racing');
  const p = r.update(200, me(3));
  check(r.state === RACE.FINISHED && r.finished && p.leaderDone && r.finishSim === 200, 'the third lap ends the race');
  check(near(r.time, 100), 'race time = finish minus lights out');
  r.update(210, me(4));
  check(r.finishSim === 200, 'the finish time does not move');
  r.addPenalty(5, 'Jump start');
  check(near(r.time, 105), 'penalty added to the race time');
  check(near(r.elapsed(500), 100), 'running time freezes at the finish');

  // online: the leader finishes first, we finish at our next line crossing
  const o = new RaceTracker({ laps: 2, length: 4000 });
  o.start(0);
  const others = [{ laps: 1, lap: 2, s: 3000 }, { laps: 0, lap: 1, s: 500 }];
  let q = o.update(50, me(1, 2000), others);
  check(q.pos === 2 && q.total === 3, 'order by laps then distance: second of three');
  q = o.update(60, me(1, 3500), others);
  check(q.pos === 1, 'we pass the other car on the same lap');
  q = o.update(70, me(1, 3900), [{ laps: 2, lap: 3, s: 100 }, others[1]]);
  check(o.state === RACE.FLAG && !o.finished && q.pos === 2 && q.leaderDone, 'the leader finishing shows the flag');
  o.update(75, me(1, 3990), [{ laps: 2, lap: 3, s: 500 }]);
  check(!o.finished, 'still driving to the line');
  o.update(80, me(2, 5), [{ laps: 2, lap: 3, s: 900 }]);
  check(o.finished && o.finishSim === 80, 'we finish at the next line crossing after the flag');
  check(new RaceTracker({ laps: 5, length: 4000 }).time === null, 'no time before the start');
  // the first car over the line from a grid behind it: lap 0 is the out lap, so lap 1 s=0 is ahead of lap 0 s=3990
  const g = new RaceTracker({ laps: 5, length: 4000 });
  check(g.position({ lap: 1, s: 5 }, [{ lap: 0, s: 3990 }]).pos === 1, 'crossing the line from the grid is progress');
}

console.log('RESULTS ORDER');
{
  const r = orderResults([
    { id: 'a', name: 'A', finished: false, dist: 9000 },
    { id: 'b', name: 'B', finished: true, time: 301.2 },
    { id: 'me', name: 'You', me: true, finished: true, time: 296.0 + 5 },
    { id: 'c', name: 'C', finished: false, dist: 11000 },
    { id: 'd', name: 'D', finished: true, time: 290.4 },
  ]);
  check(r.map(x => x.id).join() === 'd,me,b,c,a', 'finished by time (penalty included), then the rest by distance');
  check(r.map(x => x.rank).join() === '1,2,3,4,5' && r[0].gap === null && near(r[1].gap, 10.6, 1e-9) && r[3].gap === null, 'ranks and gaps');
  check(orderResults([{ id: 'x', finished: true, time: 5 }, { id: 'y', finished: true, time: 5 }]).map(x => x.id).join() === 'x,y', 'ties keep their order');
  check(orderResults([]).length === 0, 'empty results');
  const rows = timeTrialRows([{ lap: 1, time: 90, sectors: [], valid: true, warnings: 0 }, { lap: 2, time: 88, sectors: [], valid: false, warnings: 1 }, { lap: 3, time: 89, sectors: [], valid: true, warnings: 0 }]);
  check(rows[0].lap === 3 && rows.find(x => x.best).lap === 3 && !rows.find(x => x.lap === 2).best, 'time trial list: newest first, an invalid lap is never the best');
}

console.log('TRACK LIMITS IN A RACE');
{
  // the setting: races penalise, everything else only warns
  check(makeSession('race').trackLimits === 'penalty' && makeSession('online').trackLimits === 'penalty', 'races default to penalty');
  check(makeSession('race', { trackLimits: 'warn' }).trackLimits === 'warn' && makeSession('race', { trackLimits: 'nonsense' }).trackLimits === 'penalty', 'a race may choose warn; bad values fall back to penalty');
  check(makeSession('practice', { trackLimits: 'penalty' }).trackLimits === 'warn' && makeSession('timetrial').trackLimits === 'warn', 'practice and time trial only warn, whatever is asked');
  const f = new Flow({ random: () => 0 });
  f.begin(makeSession('race'), 0, { hold: 500 });
  check(f.race.limitRule === 'penalty', 'a race started by the flow penalises');

  // the rule on a fake timer: a gain over the tolerance costs the gain rounded up to a whole second
  const L = 3835, trace = new Float32Array(L + 1);
  for (let k = 0; k <= L; k++) trace[k] = k * 0.05;   // the reference: 20 m/s, 0.05 s a metre
  const fake = { bestTrace: trace, track: { length: L }, reverse: false };
  const ex = (s0, s1, took, corner = 'Windsock Hairpin') => ({ corner, s0, s1, t0: 100, t1: 100 + took });
  check(near(timeGained(ex(1000, 1010, 0.3), fake), 0.2, 1e-3) && near(timeGained(ex(1000, 1010, 0.5), fake), 0, 1e-3), 'time gained is the reference time for the stretch minus the time taken');
  check(timeGained(ex(1000, 1010, 0.3), { ...fake, bestTrace: null }) === null, 'no clean lap yet: no reference, no judgement');
  const rev = { ...fake, reverse: true };
  check(near(timeGained(ex(1010, 1000, 0.3), rev), 0.2, 1e-3), 'a reverse lap is mirrored in lap order: the same gain going backwards');
  check(timeGained(ex(1000, 1250, 0.3), fake) === null && timeGained(ex(1000, 1010, 40), fake) === null, 'a long stretch or a long time (a reset) is not judged');

  const race = (rule) => new RaceTracker({ laps: 5, length: L, trackLimits: rule });
  const closed = (gained) => ({ closed: [ex(1000, 1010, 0.5 - gained)] });
  const judge = (rule, gained, finished = false) => {
    const r = race(rule);
    r.start(0);
    if (finished) { r.state = RACE.FINISHED; r.finishSim = 1; }
    const timer = { limits: { takeClosed: () => closed(gained).closed }, ...fake };
    r.update(120, { laps: 1, lap: 2, s: 1020 }, [], timer);
    return r;
  };
  const g2 = judge('penalty', 0.9);
  check(g2.penalties.length === 1 && g2.penalties[0].seconds === 1 && g2.penalties[0].reason === 'Track limits +1s', 'a gain of 0.9 s costs 1 s, shown as Track limits +1s');
  const g3 = judge('penalty', 1.3);
  check(g3.penalty === 2 && g3.penalties[0].reason === 'Track limits +2s', 'a gain of 1.3 s costs 2 s (rounded up)');
  check(judge('penalty', TOLERANCE - 0.01).penalties.length === 0, 'a gain under the tolerance costs nothing');
  check(judge('penalty', -0.4).penalties.length === 0, 'slower than the reference: no penalty');
  check(judge('warn', 1.3).penalties.length === 0, 'the warn setting never penalises');
  check(judge('penalty', 1.3, true).penalties.length === 0, 'an excursion that ends after the race is finished is not judged');

  // the banner: shown for three seconds after the penalty
  const br = { limitPenalties: [{ corner: 'Windsock Hairpin', gained: 0.9, seconds: 1, at: 50 }] };
  check(limitBanner(br, 51).text === 'Track limits +1s' && limitBanner(br, 51).kind === 'jump' && limitBanner(br, 54) === null, 'the HUD banner: Track limits +1s for three seconds');
  check(limitBanner({ limitPenalties: [] }, 10) === null && limitBanner(null, 10) === null, 'no penalty, no banner');

  // scripted drives on the real track: out lap, lap 1 on the racing line (the reference), lap 2 with the inside cut
  const track = buildTrack(), line = computeRacingLine(track);
  const zone = limitZones().find(z => z.name === 'Windsock Hairpin');
  const side = zone.side < 0 ? 0 : 1;
  let reach = 0;
  for (let i = Math.round(zone.from); i <= Math.round(zone.to); i++) reach = Math.max(reach, track.hw[i] + track.kerb[side][i] + track.sausage[side][i] + track.runoff[side][i]);
  const cut = { ...line, x: Float64Array.from(line.x), z: Float64Array.from(line.z) };
  {
    const ease = Math.round(40 / track.ds), i0 = Math.round(zone.from), i1 = Math.round(zone.to);
    for (let i = i0 - ease; i <= i1 + ease; i++) {
      const k = ((i % track.N) + track.N) % track.N, w = Math.min(1, (i - (i0 - ease)) / ease, (i1 + ease - i) / ease);
      const f = w * w * (3 - 2 * w), want = zone.side * (reach + 2.5), d = line.off[k] + (want - line.off[k]) * f;
      cut.x[k] = track.x[k] + track.nx[k] * d; cut.z[k] = track.z[k] + track.nz[k] * d;
    }
  }
  const drive = (rule, skill) => {
    const r = new RaceTracker({ laps: 5, length: track.length, trackLimits: rule });
    const car = new Car(GT, track), timer = new LapTimer(track);
    car.setAssists(true); car.placeAt(-20, 0);
    const clean = new Autopilot(track, GT, { skill: 0.8, line });
    const cutter = new Autopilot(track, GT, { skill, line });
    cutter.line = cut;
    let ap = clean, t = 0;
    r.start(0);
    while (timer.lap < 2 && t < 500) {
      if (timer.lap === 1) ap = cutter;
      car.step(ap.drive(car)); t += STEP;
      timer.update(car.loc.s, t);
      timer.checkLimits(car, t);
      r.update(t, { laps: timer.lap, lap: timer.currentLap(), s: car.loc.s }, [], timer);
    }
    return { r, timer };
  };
  const gain = drive('penalty', 0.8);
  const cuts = gain.timer.limits.events.filter(e => e.lap === 2 && e.corner === 'Windsock Hairpin').length;
  console.log(`  Windsock Hairpin, lap 2 cut at 0.8 skill: ${cuts} warning(s), lap 2 ${gain.timer.history[1] ? (gain.timer.history[1].valid ? 'valid' : 'invalid') : 'not finished'}, penalties ${gain.r.penalties.map(p => `${p.reason} (${p.seconds} s)`).join(', ') || 'none'}`);
  check(cuts >= 1, 'the autopilot cut across the grass at Windsock Hairpin is a warning');
  check(gain.timer.history[1] && gain.timer.history[1].valid === false, 'the lap with the cut is invalid');
  check(gain.r.penalties.length >= 1 && gain.r.penalties.every(p => /^Track limits \+\d+s$/.test(p.reason)), 'the cut gains time: a Track limits penalty in the race');
  const warn = drive('warn', 0.8);
  check(warn.timer.limits.events.some(e => e.corner === 'Windsock Hairpin') && warn.r.penalties.length === 0, 'the same cut in a warn session: warning and no penalty');
  // the same cut by a driver who is slower through it than the reference lap: the warning stays, the penalty does not
  const slow = drive('penalty', 0.5);
  const slowCuts = slow.timer.limits.events.filter(e => e.lap === 2 && e.corner === 'Windsock Hairpin').length;
  console.log(`  Windsock Hairpin, lap 2 cut at 0.5 skill: ${slowCuts} warning(s), penalties ${slow.r.penalties.map(p => p.reason).join(', ') || 'none'}`);
  check(slowCuts >= 1 && slow.r.penalties.length === 0, 'a slower driver on the same cut: the warning, but no time gained, so no penalty');
}

console.log('GRID AND PIT');
{
  const T = buildTrack();
  const s0 = gridSlot(T, 0), s1 = gridSlot(T, 1), s2 = gridSlot(T, 2);
  check(near(s0.s, T.length - 12) && s0.d === -3 && s1.d === 3 && s2.d === -3, 'slots stagger left and right');
  check(near(s0.s - s1.s, 8) && near(s1.s - s2.s, 8), 'slots are 8 m apart');
  check(s0.s < T.length && s0.s > T.length - 30, 'slot 0 is just before the line');
  const ps = pitSlot(T);
  const i = Math.round(ps.s / T.ds) % T.N;
  check(T.pitOut[i] > 0 && !T.pitLimiter[i] && ps.d < 0 && -ps.d > T.pitIn[i] && -ps.d < T.pitOut[i], `pit slot is in the pit lane past the limiter (s ${ps.s.toFixed(0)}, d ${ps.d.toFixed(1)})`);
  const cp = cinematicPose(0, { x: 0, y: 0, z: 0, heading: 0 }), ce = cinematicPose(1, { x: 0, y: 0, z: 0, heading: 0 });
  check(cp.weight === 1 && ce.weight === 0 && cp.pos[0] > 40 && near(ce.pos[0], -6.2, 0.01) && near(ce.pos[1], 1.9, 0.01), 'cinematic camera starts up the straight and ends at the chase position');
  const op = orbitPose(0, { x: 0, y: 0, z: 0 });
  check(Math.hypot(op.pos[0], op.pos[2]) > 40, 'orbit circles at a distance');
}

console.log('ONLINE CLOCK AND SCHEDULE');
{
  // host clock = guest clock + 5000. Request at 1000 (guest), the host stamps 1000+5000+rtt/2 = 6040 when rtt 80, reply at 1080.
  const s1 = sampleOffset(1000, 6040, 1080);
  check(near(s1.offset, 5000) && s1.rtt === 80, 'a symmetric sample finds the offset exactly');
  const est = estimateOffset([sampleOffset(0, 5090, 200), sampleOffset(300, 5340, 380), sampleOffset(600, 5700 + 60, 780)]);
  check(est && est.rtt === 80 && near(est.offset, 5000) && est.n === 3, 'the shortest round trip wins');
  check(estimateOffset([]) === null && estimateOffset(null) === null && estimateOffset([{ offset: NaN, rtt: 1 }]) === null, 'no usable sample gives null');
  check(near(toLocalTime(9000, 5000), 4000), 'host time to local time');

  // schedule: the host decides at hostNow; sequence begins after the lead; startAt = lights out in host time
  const sc = scheduleStart(20000, 1500);
  check(sc.t0 === 20000 + START.LEAD_MS && sc.startAt === sc.t0 + goOffset(1500) && sc.hold === 1500, 'schedule: lead, then the sequence');
  // two guests with different clocks and different offset errors: their lights go out at the same real moment within 100 ms
  const real = { host: 20000, guestA: 20000 - 5000, guestB: 20000 + 123456 };      // each machine's clock reading at one real instant
  const offA = estimateOffset([sampleOffset(1000, 1000 + 5000 + 45, 1060)]).offset;             // true offset 5000
  const offB = estimateOffset([sampleOffset(1000, 1000 - 123456 + 20, 1040), sampleOffset(2000, 2000 - 123456 + 55, 2110)]).offset;  // true offset -123456
  const msg = { t: 'race', laps: 5, assists: 'any', racingLine: true, grid: ['a', 'b'], startAt: sc.startAt, hold: sc.hold };
  const seqA = sequenceFromMessage(msg, offA), seqB = sequenceFromMessage(msg, offB), seqH = sequenceFromMessage(msg, 0);
  // the real instant of lights out, as each machine sees it, mapped back to the host clock
  const outA = seqA.goAt + 5000, outB = seqB.goAt - 123456, outH = seqH.goAt;      // local goAt plus the TRUE offset
  check(Math.abs(outA - outH) <= 100 && Math.abs(outB - outH) <= 100, `lights out within 100 ms on every clock (A ${Math.abs(outA - outH).toFixed(0)} ms, B ${Math.abs(outB - outH).toFixed(0)} ms)`);
  check(seqA.state(seqA.goAt - 1).lit === 5 && seqA.state(seqA.goAt).released, 'the guest sequence is the same sequence');
  // a guest that gets the message late joins in the middle of the sequence
  const late = sequenceFromMessage(msg, 0);
  check(late.state(sc.t0 + 4000).phase === 'lights' && late.state(sc.t0 + 4000).lit === 2, 'a late message lands in the right place in the sequence');
  check(sequenceFromMessage(msg, null).goAt === msg.startAt, 'without a clock sample the guest trusts its own clock');
  const grid = ['host', 'g1', 'g2'];
  check(grid.indexOf('g2') === 2 && gridSlot(buildTrack(), grid.indexOf('g2')).d === -3, 'grid slot from the order in the message');
}

console.log('ONLINE: A FAKE ROOM WITH SKEWED CLOCKS AND UNEVEN LATENCY');
{
  // real time T (ms) runs for everyone; each machine's clock reads T + skew. A message takes lat[from][to] ms.
  let T = 0; const queue = [];
  const at = (ms, f) => queue.push({ ms: T + ms, f });
  const run = until => { for (;;) { queue.sort((a, b) => a.ms - b.ms); if (!queue.length || queue[0].ms > until) break; const e = queue.shift(); T = Math.max(T, e.ms); e.f(); } T = until; };
  const nodes = {};
  const make = (id, isHost, skew) => {
    const n = { id, skew, got: [], mp: { isHost, selfId: id, hostPeerId: 'host', peers: new Map(), sendControl(obj, to) { for (const o of Object.values(nodes)) if (o.id !== id && (to === undefined || to === o.id)) at(n.lat[o.id] ?? 30, () => o.rc.handle(JSON.parse(JSON.stringify(obj)), id)); return true; } } };
    n.rc = createRaceControl({ mp: n.mp, now: () => T + skew, random: () => 0.5, setTimeout: (f, ms) => at(ms, f), onRace: r => n.got.push({ ...r, real: T }) });
    nodes[id] = n; return n;
  };
  const H = make('host', true, 777000), A = make('g1', false, -42000), B = make('g2', false, 5);
  H.lat = { g1: 20, g2: 90 }; A.lat = { host: 35, g2: 50 }; B.lat = { host: 60, g1: 50 };
  for (const x of [H, A, B]) for (const y of [H, A, B]) if (x !== y) x.mp.peers.set(y.id, { id: y.id, hello: true });
  A.rc.syncClock(); B.rc.syncClock();
  run(1000);
  check(A.rc.estimate && A.rc.estimate.n === SAMPLES && B.rc.estimate && B.rc.estimate.n === SAMPLES, 'both guests took 7 clock samples');
  check(Math.abs(A.rc.offset - 819000) < 40 && Math.abs(B.rc.offset - 776995) < 40, `clock offsets found (A error ${Math.abs(A.rc.offset - 819000).toFixed(1)} ms, B ${Math.abs(B.rc.offset - 776995).toFixed(1)} ms)`);
  const r = H.rc.hostStart({ laps: 3, assists: 'off', racingLine: false });
  check(r && r.msg.t === 'race' && r.msg.grid.join() === 'host,g1,g2' && r.slot === 0 && r.msg.laps === 3, 'the host builds the message with the grid in join order');
  run(4000);
  check(A.got.length === 1 && B.got.length === 1 && H.got.length === 0, 'each guest got the race message once, the host did not echo it');
  check(A.got[0].slot === 1 && B.got[0].slot === 2 && !A.got[0].late && A.got[0].msg.assists === 'off' && A.got[0].msg.racingLine === false, 'slots follow the host grid order; options arrive');
  // the real instant each machine thinks the lights go out: local goAt minus its clock skew
  const outH = r.seq.goAt - 777000, outA = A.got[0].seq.goAt - -42000, outB = B.got[0].seq.goAt - 5;
  check(Math.max(outH, outA, outB) - Math.min(outH, outA, outB) <= 100, `three machines, lights out within ${(Math.max(outH, outA, outB) - Math.min(outH, outA, outB)).toFixed(0)} ms of each other (limit 100)`);
  check(A.got[0].seq.hold === r.msg.hold && B.got[0].seq.hold === r.msg.hold, 'everybody sees the same hold');
  // a guest joins during the race: gets the message once, no grid slot, free drive
  const C = make('g3', false, 9000); C.lat = { host: 40 }; H.lat.g3 = 40;
  C.mp.peers.set('host', { id: 'host', hello: true });
  H.mp.peers.set('g3', { id: 'g3', hello: true });
  C.rc.syncClock();
  run(T + 600);
  H.rc.tick(); H.rc.tick();
  run(T + 500);
  check(C.got.length === 1 && C.got[0].late && C.got[0].slot >= 1, 'a late joiner is told once and takes part as a free drive');
  // bad messages are cleaned
  check(cleanRaceMessage({ t: 'race', startAt: 'x' }) === null && cleanRaceMessage(null) === null && cleanRaceMessage({ t: 'clk' }) === null, 'messages without a start time are dropped');
  const c = cleanRaceMessage({ t: 'race', startAt: 5, laps: 999, hold: 99999, assists: 'weird', grid: ['a', 3, 'b'] });
  check(c.laps === 99 && c.hold === START.HOLD_MAX_MS && c.assists === 'any' && c.grid.join() === 'a,b', 'laps, hold, assists and grid are clamped');
  // weather and time of day: the host chooses, guests see the same; old hosts send nothing and guests keep their own
  H.rc.hostSetEnv({ weather: 'heavyrain', time: 'night' });
  run(T + 1000);
  check(A.rc.env && A.rc.env.weather === 'heavyrain' && A.rc.env.time === 'night' && B.rc.env && B.rc.env.time === 'night', 'the host\'s weather reaches every guest');
  check(C.rc.env && C.rc.env.weather === 'heavyrain', 'a late joiner gets the weather once from the next host update');
  check(H.rc.env === null, 'the host has no host environment of its own');
  const sentBefore = A.rc.env; H.rc.hostSetEnv({ weather: 'heavyrain', time: 'night' }); run(T + 1000);
  check(A.rc.env === sentBefore, 'an unchanged environment is not sent again');
  H.rc.hostSetEnv({ weather: 'fog', time: 'dusk' }); run(T + 1000);
  check(A.rc.env.weather === 'fog' && A.rc.env.time === 'dusk' && B.rc.env.weather === 'fog', 'a change reaches everybody');
  const r2 = H.rc.hostStart({ laps: 2, assists: 'any', racingLine: true, weather: 'lightrain', time: 'golden' });
  check(r2.msg.weather === 'lightrain' && r2.msg.time === 'golden', 'the race message carries the weather');
  run(T + 6000);
  check(A.rc.env.weather === 'lightrain' && A.rc.env.time === 'golden' && A.got[A.got.length - 1].msg.weather === 'lightrain', 'guests take the weather from the race message too');
  A.rc.handle({ t: 'env', weather: 'bogus', time: 42 }, 'host');
  check(A.rc.env.weather === 'clear' && A.rc.env.time === 'midday', 'a bad environment message becomes the default');
  const hostEnvBefore = H.rc.env; H.rc.handle({ t: 'env', weather: 'fog', time: 'night' }, 'g1');
  check(H.rc.env === hostEnvBefore, 'the host ignores environment messages');
  A.rc.clearEnv(); check(A.rc.env === null, 'leaving the room clears the host environment');
  const old = createRaceControl({ mp: { isHost: false, selfId: 'x', peers: new Map(), sendControl() {} }, now: () => 0, random: () => 0.5, setTimeout: () => {}, onRace: () => {} });
  old.handle({ t: 'race', startAt: 5000, laps: 3, grid: [] }, 'host');
  check(old.env === null, 'a race message from an old host (no weather) leaves the guest on its own settings');
  // the host does not obey a race message, a guest does not answer clock requests
  const before = H.got.length; H.rc.handle({ t: 'race', startAt: 1, laps: 3 }, 'g1'); check(H.got.length === before, 'the host ignores race messages');
}

console.log('WEATHER AND TIME OF DAY');
{
  const d = resolveEnv(DEFAULT_ENV);
  const hex = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  check(same(d.sky, hex(0x6fa3d6)) && same(d.skyBottom, hex(0xd9e6ee)) && same(d.fog, hex(0xcfdde6)) && d.fogNear === 300 && d.fogFar === 2600, 'the default is the old clear daytime sky and fog');
  check(same(d.sun, hex(0xfff1dc)) && d.sunI === 2.4 && same(d.hemiSky, hex(0xdfeeff)) && same(d.hemiGround, hex(0x4a5a3a)) && d.hemiI === 1.1 && d.exposure === 1, 'the default sun, sky light and exposure are unchanged');
  const sd = [-0.5, 0.75, 0.42], n = Math.hypot(...sd);
  check(same(d.dir, sd.map(x => x / n)) && d.rain === 0 && d.wet === 0 && d.lamps === 0 && d.stars === 0 && d.cloud === 0, 'default sun direction, no rain, wet road, lamps, stars or cloud');
  let finite = true;
  for (const time of TIMES) for (const weather of WEATHERS) {
    const r = resolveEnv({ time, weather });
    for (const v of Object.values(r)) if (typeof v === 'number' ? !Number.isFinite(v) : Array.isArray(v) ? v.some(x => !Number.isFinite(x)) : false) finite = false;
    if (!(r.fogFar > r.fogNear && r.fogNear > 0)) finite = false;
  }
  check(finite, 'every time and weather resolves to finite numbers with fog far beyond near');
  check(resolveEnv({ time: 'night', weather: 'clear' }).lamps === 1 && resolveEnv({ time: 'dusk', weather: 'clear' }).lamps > 0.5 && resolveEnv({ time: 'midday', weather: 'clear' }).lamps === 0, 'floodlights come on at dusk and night, not by day');
  check(resolveEnv({ time: 'night', weather: 'clear' }).stars > 0.9 && resolveEnv({ time: 'night', weather: 'overcast' }).stars < 0.2 && resolveEnv({ time: 'midday', weather: 'clear' }).stars === 0, 'stars at a clear night, hidden by cloud and by day');
  check(resolveEnv({ weather: 'heavyrain' }).wet === 1 && resolveEnv({ weather: 'lightrain' }).wet < 1 && resolveEnv({ weather: 'lightrain' }).wet > 0.3 && resolveEnv({ weather: 'cloudy' }).wet === 0, 'the road is wet in rain only');
  check(resolveEnv({ weather: 'fog' }).fogFar < 500 && resolveEnv({ weather: 'heavyrain' }).fogFar < resolveEnv({ weather: 'lightrain' }).fogFar && resolveEnv({ weather: 'lightrain' }).fogFar < 2600, 'fog and rain shorten the view');
  check(resolveEnv({ weather: 'overcast' }).sunI < resolveEnv({ weather: 'cloudy' }).sunI && resolveEnv({ weather: 'cloudy' }).sunI < 2.4 && shadowsOn(d) && !shadowsOn(resolveEnv({ weather: 'heavyrain' })) && !shadowsOn(resolveEnv({ time: 'night' })), 'cloud takes the sun down and the shadows go with it');
  check(resolveEnv({ time: 'golden' }).dir[1] < resolveEnv({ time: 'midday' }).dir[1] && resolveEnv({ time: 'morning' }).dir[1] < 0.5, 'the sun is lower at golden hour and in the morning');
  check(resolveEnv({ weather: 'heavyrain' }).wind > resolveEnv({ weather: 'clear' }).wind && resolveEnv({ weather: 'heavyrain' }).spray > 0.9 && resolveEnv({ weather: 'cloudy' }).spray === 0, 'wind and spray follow the weather');
  const mid = blendEnv(resolveEnv({ time: 'midday' }), resolveEnv({ time: 'night' }), 0.5);
  check(Math.abs(mid.sunI - (2.4 + resolveEnv({ time: 'night' }).sunI) / 2) < 1e-9 && same(blendEnv(d, d, 0.3).sky, d.sky) && blendEnv(d, resolveEnv({ time: 'night' }), 1).lamps === 1, 'blending between two looks');
  check(cleanWeather('Light Rain') === 'lightrain' && cleanWeather('rain') === 'lightrain' && cleanWeather('storm') === 'heavyrain' && cleanWeather('nonsense') === 'clear' && cleanWeather(null) === 'clear', 'weather names are cleaned');
  check(cleanTime('Golden hour') === 'golden' && cleanTime('night') === 'night' && cleanTime(3) === 'midday' && cleanTime('sunset') === 'dusk', 'time names are cleaned');
  const q = s => new URLSearchParams(s);
  check(envFromParams(q('')) === null && envFromParams(q('?menu=0')) === null, 'no weather in the address gives no override');
  check(JSON.stringify(envFromParams(q('?weather=rain&time=dusk'))) === JSON.stringify({ weather: 'lightrain', time: 'dusk' }) && envFromParams(q('?time=night')).weather === 'clear', '?weather=rain&time=dusk and a time alone');
  check(cleanEnv({ weather: 'fog', timeOfDay: 'dusk' }).time === 'dusk' && cleanEnv(null).weather === 'clear', 'settings style environments are accepted');
  const ms = migrateSettings({ weather: 'blizzard', timeOfDay: 'teatime' });
  check(ms.weather === 'clear' && ms.timeOfDay === 'midday' && migrateSettings({ weather: 'fog', timeOfDay: 'night' }).weather === 'fog' && !('weather' in migrateSettings({})), 'saved settings are cleaned and old saves are left alone');
  // lightning is optional and cosmetic: saved as a boolean, anything but false counts as on; the flash is two pulses and a tail inside 0.85 s
  check(!('lightning' in migrateSettings({})) && migrateSettings({ lightning: false }).lightning === false && migrateSettings({ lightning: 'no' }).lightning === true && migrateSettings({ lightning: true }).lightning === true, 'the lightning setting is cleaned and old saves keep the default');
  let peak = 0, ok = true;
  for (let t = -0.2; t < 1.2; t += 0.005) { const v = boltShape(t); if (!(v >= 0 && v <= 1)) ok = false; if (t >= 0 && t < 0.1) peak = Math.max(peak, v); }
  check(ok && peak > 0.95 && boltShape(-0.1) === 0 && boltShape(0.9) === 0 && boltShape(0.3) > 0.3, 'the lightning flash is 0 to 1, peaks at once and is over in under a second');
}

console.log('FINISH MESSAGES AND THE RESULTS TABLE');
{
  // the finish message: clean numbers, clamped ranges, bad numbers rejected, at most 8 penalties, short plain reasons
  const good = { t: 'fin', time: 480.5, laps: 5, best: 92.4, sec: [29.8, 38.1, 24.5], pen: [{ s: 2, why: 'Track limits +2s' }], warn: 1 };
  check(JSON.stringify(cleanFinish(good)) === JSON.stringify(good), 'a good finish message is kept as it is');
  check(cleanFinish({ ...good, time: NaN }) === null && cleanFinish({ ...good, time: 'fast' }) === null && cleanFinish({ ...good, time: 0 }) === null, 'a bad or zero race time is rejected');
  check(cleanFinish({ ...good, laps: Infinity }) === null && cleanFinish({ ...good, best: NaN }) === null && cleanFinish({ ...good, warn: -Infinity }) === null, 'bad laps, best or warnings are rejected');
  check(cleanFinish({ ...good, sec: [29.8, NaN, 24.5] }) === null && cleanFinish({ ...good, sec: [1, 2, 3, 4] }) === null && cleanFinish({ ...good, pen: 'x' }) === null, 'a bad sector, a long sector list or a non-list penalty is rejected');
  const big = cleanFinish({ ...good, time: 1e9, laps: 500, best: 1e9, sec: [-5, 1e9, 3], warn: 1e9 });
  check(big.time === 7200 && big.laps === 99 && big.best === 3600 && big.sec[0] === 0 && big.sec[1] === 3600 && big.warn === 999, 'out of range numbers are clamped');
  const pens = cleanFinish({ ...good, pen: [...Array(12)].map((_, i) => ({ s: i + 1, why: 'Track limits' })) });
  check(pens.pen.length === 8 && pens.pen[7].s === 8, 'at most 8 penalties');
  check(cleanFinish({ ...good, pen: [{ s: NaN, why: 'x' }, { s: 3, why: 'Jump start' }] }).pen.map(p => p.s).join() === '3', 'a penalty with a bad number is dropped, the rest kept');
  const reason = cleanFinish({ ...good, pen: [{ s: 5, why: '<b>Track limits and a very long reason text</b>' }] }).pen[0].why;
  check(reason.length <= 24 && !/[<>]/.test(reason) && reason.startsWith('bTrack limits'), `reasons are plain and at most 24 characters (got "${reason}")`);
  check(cleanFinish({ ...good, pen: [{ s: 2 }] }).pen[0].why === 'Penalty', 'a penalty with no reason gets a plain one');
  check(cleanFinish({ ...good, sec: undefined, best: undefined, warn: undefined, pen: undefined }).sec.join() === '0,0,0', 'optional parts default');
  check(cleanFinish(null) === null && cleanFinish('fin') === null, 'not an object: rejected');

  // the book: a repeat changes nothing; a player who leaves keeps their finish; a new race clears it
  const book = new FinishBook();
  check(book.set('r1', good) === true && book.set('r1', { ...good }) === false && book.set('r1', { ...good, time: 481 }) === true, 'a repeated finish is idempotent, a changed one is stored');
  book.set('r2', good);
  check(book.has('r1') && book.has('r2') && book.size === 2, 'a finish stays in the book when its player leaves (nothing removes it)');
  check(book.clear() === true && book.size === 0 && book.clear() === false, 'a new race clears the book');

  // the results table: a finished car ranks by its time, penalties included; the local car is not first unless it is
  const L = 1000, laps = 3;
  const me = (over = {}) => ({ id: 'me', name: 'You', me: true, finished: true, time: 250, dist: 0, best: 80, sec: [26, 27, 27], pen: [], warn: 0, grid: 2, ...over });
  const remote = (over = {}) => ({ id: 'r1', name: 'Ada', finished: true, time: 240, dist: 0, best: 79, sec: [25, 27, 27], pen: [{ s: 10, why: 'Track limits +10s' }], warn: 1, grid: 1, ...over });
  const rows = raceRows([me(), remote(), { id: 'r2', name: 'Bo', finished: false, dist: 2 * L + 300, grid: 3 }, { id: 'r3', name: 'Cy', finished: false, dnf: true, dist: 900, grid: 4 }], { laps, length: L });
  check(rows.map(r => r.id).join() === 'r1,me,r2,r3', `remote finished first by time (penalty in it), local not automatically first (got ${rows.map(r => r.id)})`);
  check(rows[0].rank === 1 && rows[0].gap === null && near(rows[1].gap, 10, 1e-9), 'the winner has no gap; the car behind has the time gap');
  check(rows[2].status === 'racing' && rows[2].rank === 3 && rows[2].lapsDown === 0, 'a car still out is ranked after the finished ones, by distance');
  check(rows[3].status === 'dnf' && rows[3].rank === null && rows[3].gap === null, 'a car that did not finish is DNF, unranked, last');
  check(rows[0].gained === 1 - 1 && rows[1].gained === 2 - 2 && rows[2].gained === 3 - 3, 'positions gained: grid minus finish');
  check(rows[0].penalty === 10 && rows[1].penalty === 0, 'the penalty of each car is in its row');
  // the sector colours: the fastest of the race is best, within 0.3 s near, else slow
  const sc = raceRows([me({ sec: [26, 27.2, 27] }), remote({ sec: [25, 27, 27.5] }), { id: 'x', name: 'X', finished: true, time: 260, sec: [25.2, 28, 0], best: 78, pen: [], warn: 0 }], { laps, length: L });
  const byId = Object.fromEntries(sc.map(r => [r.id, r]));
  check(byId.r1.secCls[0] === 'best' && byId.x.secCls[0] === 'near' && byId.me.secCls[0] === 'slow', `sector 1: the fastest is best, 0.2 s is near, 1.0 s is slow (got ${byId.r1.secCls[0]}, ${byId.x.secCls[0]}, ${byId.me.secCls[0]})`);
  check(byId.x.secCls[2] === null && byId.me.secCls[1] === 'near' && byId.x.secCls[1] === 'slow', `no time is no colour; 0.2 s behind the fastest S2 is near, 1 s is slow (got ${byId.x.secCls[2]}, ${byId.me.secCls[1]}, ${byId.x.secCls[1]})`);
  check(byId.x.bestCls === 'best' && byId.r1.bestCls === null, 'the fastest lap of the race is marked');
  // a late finish: the same table with a car that was out now finishing first, the rows re-rank
  const before = raceRows([me({ time: 300 }), { id: 'r2', name: 'Bo', finished: false, dist: 2.5 * L, grid: 3 }], { laps, length: L });
  check(before.map(r => r.id).join() === 'me,r2' && before[1].lapsDown === 0, 'before: the car out is second');
  const after = raceRows([me({ time: 300 }), { id: 'r2', name: 'Bo', finished: true, time: 290, grid: 3, dist: 0 }], { laps, length: L });
  check(after.map(r => r.id).join() === 'r2,me' && after[1].gap === 10 && after[0].gained === 2, 'a late finish re-ranks: the new finisher (grid 3) goes ahead on time and gains two');
  // a lap down: a car a whole lap behind the leader, still out
  const lapped = raceRows([me(), { id: 'r4', name: 'Di', finished: false, dist: L + 10, grid: 5 }], { laps, length: L });
  check(lapped[1].lapsDown === 1 && lapped[1].gap === null, `a car a whole lap behind shows one lap down (got ${lapped[1].lapsDown})`);
  check(raceRows([], { laps, length: L }).length === 0 && orderResults([{ id: 'x', finished: true, time: 5 }]).length === 1, 'empty and single rows');
}

console.log('RESULTS SCREEN MODEL');
{
  const sample = sampleResults(), m = resultsModel(sample);
  const txt = id => m.rows.find(r => r.id === id);
  check(m.rows.length === 6 && m.total === 6 && m.hasMe && m.rows.filter(r => r.me).length === 1 && txt('me').me, 'the sample table has six rows and one of them is you');
  check(m.card.pos === 'P2' && m.card.of === 'of 6' && m.sub === 'Lakeside Circuit, 5 laps, Clear, Midday', `the card and the subtitle (got ${m.card.pos} ${m.card.of}, "${m.sub}")`);
  check(txt('a').gap === '-' && txt('a').pos === '1' && txt('me').gap === '+2.116' && txt('me').pen === '+2 s' && txt('me').penTitle === 'Track limits +2s +2 s', `winner has no gap, you have the gap and the penalty with its reason (got ${txt('me').gap} ${txt('me').pen} ${txt('me').penTitle})`);
  check(txt('d').gap === 'Racing' && txt('d').pos === '5' && txt('e').gap === 'DNF' && txt('e').pos === '-', 'a car out of the race is Racing, a car that left is DNF with no position');
  check(txt('me').gained === '0' && txt('a').gained === '+2' && txt('d').gained === '-1' && txt('e').gained === '', 'positions gained as text: +2, 0, -1, and nothing for DNF');
  check(txt('a').sec.map(x => x.cls).join() === 'best,near,best' && txt('a').best === '1:32.411' && txt('a').bestCls === 'best', 'sector and lap classes come from the rows');
  check(m.card.sectors.join() === 'slow,best,slow' && m.card.penalised && m.card.penalty === '+2 s' && m.card.warn === '1 warning' && m.card.gained === '0', 'the card: your sectors, penalty, warnings and positions gained');
  const dnfRow = txt('e');
  check(dnfRow.best === '-' && dnfRow.sec.every(x => x.text === '-') && dnfRow.pen === '', 'a DNF car with no laps shows dashes');
  const solo = resultsModel({ rows: [{ id: 'me', me: true, status: 'finished', rank: 1, time: 300, best: 90, sec: [30, 30, 30], secCls: ['best', 'best', 'best'], penalty: 0, pen: [], warn: 0, name: 'You', colour: '#1c6dd0', num: -1 }], laps: 1, canAgain: false });
  check(solo.card.of === '' && solo.card.pos === 'P1' && solo.rows[0].num === '' && solo.card.canAgain === false && solo.card.penalty === 'None' && solo.rows[0].pen === '', 'a solo race: no "of", no number, no penalty, Race again off');
  check(solo.sub === 'Lakeside Circuit, 1 lap', `one lap is singular (got "${solo.sub}")`);
  check(chipInk('#ffd400') === 'var(--on-gantry)' && chipInk('#1c6dd0') === 'var(--text)' && chipInk('nope') === 'var(--text)', 'race number text is dark on light liveries and light on dark ones (tokens)');
  check(resultsModel({}).rows.length === 0 && resultsModel({}).card.pos === 'P-', 'no data: an empty card');
}

console.log(fails.length ? `FAILED\n  ${fails.join('\n  ')}` : 'session: all checks passed');
process.exitCode = fails.length ? 1 : 0;
