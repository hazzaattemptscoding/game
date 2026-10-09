// The gantry screen's race state (src/gantryState.js): the resting board's text for each session, and the screen calls the race
// makes frame by frame (lights, GO, LAST LAP, the chequered flag), with a fake screen. Run with `npm run gantrystate`.
import { statusOf, GantryFeed } from '../src/gantryState.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// the screen calls, as text, in the order they came
function fakeScreen() {
  const log = [];
  let status = 'unset';
  return {
    log,
    lights: n => log.push('lights' + n),
    go: () => log.push('go'),
    flag: (name, d = {}) => log.push(`flag:${name}:${d.text || ''}`),
    clear: () => log.push('clear'),
    status: d => { status = d ? `${d.eyebrow}|${d.value}|${d.sub || ''}` : null; },
    get shown() { return status; },
  };
}

// the statuses ---------------------------------------------------------------
check(statusOf(null) === null, 'no session, no board');
check(statusOf({ mode: 'menu' }) === null, 'unknown mode, no board');
{
  const r = statusOf({ mode: 'race', laps: 5, lap: 0, leadLap: 0 });
  check(r.eyebrow === 'RACE' && r.value === 'LAP 1 / 5' && r.sub === null, 'race out lap reads LAP 1 / 5: ' + JSON.stringify(r));
  check(statusOf({ mode: 'race', laps: 5, leadLap: 3 }).value === 'LAP 3 / 5', 'race reads the lead lap');
  check(statusOf({ mode: 'race', laps: 5, leadLap: 9 }).value === 'LAP 5 / 5', 'race lap never past the last');
  check(statusOf({ mode: 'online', laps: 3, leadLap: 2 }).eyebrow === 'ONLINE RACE', 'online race names itself');
}
{
  const p = statusOf({ mode: 'practice', laps: 0, lap: 4, best: 91.117 });
  check(p.eyebrow === 'FREE PRACTICE' && p.value === 'LAP 4' && p.sub === 'BEST 1:31.117', 'practice shows the lap and the best: ' + JSON.stringify(p));
  check(statusOf({ mode: 'practice', lap: 0, best: null }).value === 'OUT LAP', 'practice out lap');
  check(statusOf({ mode: 'practice', lap: 0, best: null }).sub === null, 'practice without a best has no sub line');
  check(statusOf({ mode: 'practice', reverse: true, lap: 2 }).eyebrow === 'FREE PRACTICE, REVERSE', 'reverse practice says so');
  const t = statusOf({ mode: 'timetrial', lap: 1, best: 90.008 });
  check(t.eyebrow === 'TIME TRIAL' && t.value === 'LAP 1' && t.sub === 'BEST 1:30.008', 'time trial shows the lap and the best');
}

// a race, frame by frame: the start, GO, the last lap, the chequered flag and the way out
{
  const scr = fakeScreen(), feed = new GantryFeed(scr);
  const race = { mode: 'race', laps: 3 }, base = { session: race, lap: 0, leadLap: 0, best: null, flagOut: false };
  feed.update({ ...base, phase: 'menu', session: null });
  check(scr.log.length === 0 && scr.shown === null, 'menu: nothing on the screen but the loop');
  feed.update({ ...base, phase: 'start', lights: { phase: 'cinematic', lit: 0 } });
  feed.update({ ...base, phase: 'start', lights: { phase: 'wait', lit: 0 } });
  check(!scr.log.some(l => l.startsWith('lights')), 'nothing lit before the lights');
  check(scr.shown === 'RACE|LAP 1 / 3|', 'on the grid the board says the race and lap 1');
  for (const n of [1, 1, 2, 3, 4, 5, 5]) feed.update({ ...base, phase: 'start', lights: { phase: n < 5 ? 'lights' : 'hold', lit: n } });
  check(scr.log.join() === 'lights1,lights2,lights3,lights4,lights5', 'each lamp sent once, in order: ' + scr.log.join());
  feed.update({ ...base, phase: 'run', lap: 0.5 });
  feed.update({ ...base, phase: 'run', lap: 0.5 });
  check(scr.log.join() === 'lights1,lights2,lights3,lights4,lights5,go', 'GO once when the lights go out: ' + scr.log.join());
  feed.update({ ...base, phase: 'run', lap: 1, leadLap: 1 });
  feed.update({ ...base, phase: 'run', lap: 2, leadLap: 2 });
  check(!scr.log.some(l => l.startsWith('flag:final')), 'no last lap before the last lap');
  check(scr.shown === 'RACE|LAP 2 / 3|', 'the board follows the lap: ' + scr.shown);
  feed.update({ ...base, phase: 'run', lap: 3, leadLap: 3 });
  feed.update({ ...base, phase: 'run', lap: 3, leadLap: 3 });
  check(scr.log.filter(l => l === 'flag:final:LAST LAP').length === 1, 'LAST LAP once, when the last lap starts');
  check(scr.shown === 'RACE|LAP 3 / 3|', 'the board says lap 3 of 3 on the last lap');
  feed.update({ ...base, phase: 'run', lap: 3, leadLap: 3, flagOut: true });
  feed.update({ ...base, phase: 'results', lap: 4, leadLap: 4, flagOut: true });
  check(scr.log.filter(l => l === 'flag:chequered:CHEQUERED FLAG').length === 1, 'the chequered flag once, with its label');
  check(!scr.log.some(l => l === 'clear'), 'the flag is held, not cleared, through the results');
  feed.update({ ...base, phase: 'menu', session: null });
  check(scr.log.slice(-1)[0] === 'clear' && scr.shown === null, 'leaving the session clears the flag and gives back the loop: ' + scr.log.slice(-2).join());
}

// the race started again from the results: the flag and the lights from the last start do not carry over
{
  const scr = fakeScreen(), feed = new GantryFeed(scr);
  const race = { mode: 'race', laps: 2 }, base = { session: race, lap: 0, leadLap: 0, best: null, flagOut: false };
  feed.update({ ...base, phase: 'run', lap: 2, leadLap: 2, flagOut: true });
  feed.update({ ...base, phase: 'results', lap: 2, leadLap: 2, flagOut: true });
  feed.update({ ...base, phase: 'start', lights: { phase: 'lights', lit: 1 }, flagOut: false });
  check(scr.log.slice(-2).join() === 'clear,lights1', 'a new start clears the flag and lights up: ' + scr.log.join());
  feed.update({ ...base, phase: 'run', lap: 1, leadLap: 1 });
  feed.update({ ...base, phase: 'run', lap: 2, leadLap: 2 });
  check(scr.log.filter(l => l === 'go').length === 1 && scr.log.filter(l => l === 'flag:final:LAST LAP').length === 1, 'the second race gets its own GO and LAST LAP: ' + scr.log.join());
}

// a new session of another kind on the same screen: no lights, no flags, only the board
{
  const scr = fakeScreen(), feed = new GantryFeed(scr);
  const prac = { mode: 'practice', laps: 0, reverse: false };
  feed.update({ session: prac, phase: 'run', lap: 2, leadLap: 2, best: 92.5, flagOut: false });
  check(scr.log.length === 0, 'practice sends no flags or lights: ' + scr.log.join());
  check(scr.shown === 'FREE PRACTICE|LAP 2|BEST 1:32.500', 'practice board: ' + scr.shown);
  feed.update({ session: { mode: 'timetrial' }, phase: 'run', lap: 0, leadLap: 0, best: null, flagOut: false });
  check(scr.shown === 'TIME TRIAL|OUT LAP|', 'time trial board on the out lap: ' + scr.shown);
}

// online: the room's first finish puts the chequered flag out, even while our own car is still on the last lap
{
  const scr = fakeScreen(), feed = new GantryFeed(scr);
  const on = { mode: 'online', laps: 5 };
  feed.update({ session: on, phase: 'run', lap: 4, leadLap: 4, flagOut: false });
  check(!scr.log.some(l => l.startsWith('flag:chequered')), 'no flag while the race goes on');
  feed.update({ session: on, phase: 'run', lap: 4, leadLap: 5, flagOut: false });
  check(scr.log.includes('flag:final:LAST LAP'), 'the room is on its last lap');
  feed.update({ session: on, phase: 'run', lap: 4, leadLap: 5, flagOut: true });
  check(scr.log.slice(-1)[0] === 'flag:chequered:CHEQUERED FLAG', 'the room finished: chequered for everyone');
}

console.log('GANTRY STATE: the status text and the race calls on the screen');
if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('  all passed');
