// Session, start sequence and online start tests. Run with `npm run session` (also part of `npm run check`). No browser needed.
//   1. the session state machine: menu to practice, race setup to start to race to finish to results, restart, back to menu
//   2. the start sequence with an injected clock and random: light cadence, hold range, jump start with its tolerance, penalty
//   3. lap counting and the finish rule, positions, results ordering
//   4. the grid and pit slots on the real track
//   5. the clock offset estimate and the online schedule
import { StartSequence, START, pickHold, goOffset, gridSlot, pitSlot, sampleOffset, estimateOffset, toLocalTime, scheduleStart, sequenceFromMessage, cinematicPose, orbitPose } from '../src/start.js';
import { makeSession, Flow, PHASE, RaceTracker, RACE, orderResults, timeTrialRows, hasStartLights } from '../src/session.js';
import { buildTrack } from '../src/track.js';
import { createRaceControl, cleanRaceMessage } from '../src/raceControl.js';
import { TIMES, WEATHERS, resolveEnv, blendEnv, cleanEnv, cleanWeather, cleanTime, envFromParams, shadowsOn, DEFAULT_ENV } from '../src/weather.js';
import { migrateSettings } from '../src/settings.js';
import { boltShape } from '../src/environment.js';

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
  check(makeSession('race', { ai: 5 }).ai === 5 && makeSession('online', { ai: 5 }).ai === 0 && makeSession('timetrial', { ai: 5 }).ai === 0 && makeSession('race').ai === 0, 'AI opponents are for the offline race and practice only, off by default');
  check(makeSession('nonsense').mode === 'practice', 'unknown mode falls back to practice');
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
  check(f.finish([{ id: 'me', me: true, finished: true, time: 100 }]) && f.phase === PHASE.RESULTS && f.results[0].rank === 1, 'finish gives the results');
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
    const n = { id, skew, got: [], mp: { isHost, selfId: id, peers: new Map(), sendControl(obj, to) { for (const o of Object.values(nodes)) if (o.id !== id && (to === undefined || to === o.id)) at(n.lat[o.id] ?? 30, () => o.rc.handle(JSON.parse(JSON.stringify(obj)), id)); return true; } } };
    n.rc = createRaceControl({ mp: n.mp, now: () => T + skew, random: () => 0.5, setTimeout: (f, ms) => at(ms, f), onRace: r => n.got.push({ ...r, real: T }) });
    nodes[id] = n; return n;
  };
  const H = make('host', true, 777000), A = make('g1', false, -42000), B = make('g2', false, 5);
  H.lat = { g1: 20, g2: 90 }; A.lat = { host: 35, g2: 50 }; B.lat = { host: 60, g1: 50 };
  for (const x of [H, A, B]) for (const y of [H, A, B]) if (x !== y) x.mp.peers.set(y.id, { id: y.id, hello: true });
  A.rc.syncClock(); B.rc.syncClock();
  run(1000);
  check(A.rc.estimate && A.rc.estimate.n === 3 && B.rc.estimate && B.rc.estimate.n === 3, 'both guests took 3 clock samples');
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

console.log(fails.length ? `FAILED\n  ${fails.join('\n  ')}` : 'session: all checks passed');
process.exitCode = fails.length ? 1 : 0;
