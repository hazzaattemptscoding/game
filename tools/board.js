// Times board test. Run with `npm run board` (also part of `npm run check`). No browser needed.
//   1. LapTimer keeps every lap with its sector times and track limit warnings
//   2. sector colours, lap list, this session summary and delta
//   3. the local top 10 (sorting, cutting, saving and loading, storage that throws)
//   4. the room board rows (order by best lap, gaps, "you")
import { LapTimer } from '../src/timing.js';
import { sectorClass, lapRows, sessionView, addBest, loadBest, saveBest, personalSectors, createBoard, BEST_KEY, TOP_N, today } from '../src/board.js';
import { Ghosts } from '../src/ghosts.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// A 1000 m track with sectors starting at 0, 300 and 650. driveLap drives one lap (the three sectors in `secs` seconds each)
// starting at the line, then on over the line, and returns the time at the end. warn puts that many track limit warnings on the lap.
const track = { length: 1000, sectors: [0, 300, 650] };
const state = { s: 949, t: 0 };
function drive(timer, metres, secs) {
  const dt = 0.01, v = metres / secs;
  for (let d = 0; d < metres - 1e-9; d += v * dt) {
    state.t += dt; state.s += v * dt;
    if (state.s >= 1000) state.s -= 1000;
    timer.update(state.s, state.t);
  }
}
function driveLap(timer, secs, warn = 0) {
  drive(timer, 300, secs[0]);
  if (warn) timer.limits.byLap[timer.currentLap()] = warn;
  drive(timer, 350, secs[1]);
  drive(timer, 350, secs[2]);
}

console.log('LAP HISTORY');
const timer = new LapTimer(track);
// out lap: crossing the line starts lap 1 and is not a lap itself
timer.update(state.s, state.t);
drive(timer, 51, 1);       // the last 51 m, over the line to the start of lap 1
check(timer.history.length === 0, 'the out lap is not in the history');
const laps = [[30.0, 31.0, 29.0], [29.5, 31.5, 29.5], [30.5, 30.5, 28.5], [31.0, 31.0, 30.0]];
laps.forEach((secs, k) => driveLap(timer, secs, k === 1 ? 2 : 0));
drive(timer, 51, 1);       // over the line again, which finishes the last lap
console.log('  laps recorded:', timer.history.map(l => `${l.lap}:${l.time.toFixed(2)}`).join('  '));
check(timer.history.length === 4, `four laps recorded (got ${timer.history.length})`);
check(timer.history.every((l, i) => l.lap === i + 1), 'lap numbers run 1, 2, 3, 4');
check(timer.history.every((l, i) => l.sectors.length === 3 && near(l.sectors[0] + l.sectors[1] + l.sectors[2], l.time, 1e-6)), 'three sector times per lap that add up to the lap time');
check(timer.history.every((l, i) => laps[i].every((s, j) => near(l.sectors[j], s, 0.2))), 'sector times are about what was driven');
check(timer.history[1].warnings === 2 && !timer.history[1].valid && timer.history[0].valid && timer.history[0].warnings === 0, 'track limit warnings are kept per lap, and a lap with one is invalid');
check(near(timer.best, Math.min(...timer.history.map(l => l.time))) && near(timer.last, timer.history[3].time), 'best and last agree with the history');
check(timer.history[0].sectors !== timer.history[1].sectors, 'each lap has its own sector list');
timer.reset();
check(timer.history.length === 0, 'reset clears the history');

console.log('BEST, INVALID LAPS, JUMPS, AUTOPILOT');
// a fresh timer driven through `laps`: { secs, warn, jump, auto }. warn puts a track limit warning on the lap after sector 1,
// jump calls markJump after sector 1 (a reset), auto says the autopilot drove the whole lap. `pre` runs before the out lap.
function lapOf(t, lap) {
  if (lap.auto) t.noteAutopilot();
  drive(t, 300, lap.secs[0]);
  if (lap.jump) t.markJump();
  if (lap.warn) t.limits.byLap[t.currentLap()] = lap.warn;
  drive(t, 350, lap.secs[1]);
  drive(t, 350, lap.secs[2]);
  drive(t, 2, 0.02);   // over the line, which finishes the lap
}
function runLaps(t, laps) {
  state.s = 949;
  t.update(state.s, state.t);
  drive(t, 51, 1);     // the out lap
  laps.forEach(l => lapOf(t, l));
  return t;
}
const scenario = [
  { secs: [30, 31, 29] },                 // 90: valid, the session's best so far
  { secs: [28, 29, 27], warn: 1 },        // 84: faster, but warned: invalid, so it is no best and no purple
  { secs: [31, 31, 31], jump: true },     // 93: valid but reset in the lap: not clean
  { secs: [29, 30, 30], auto: true },     // 89: valid, the autopilot drove it
  { secs: [30, 31, 29] },                 // 90: valid
];
{
  const t = runLaps(new LapTimer(track), scenario);
  const h = t.history;
  check(h.length === 5, `five laps recorded (got ${h.length})`);
  check(h.map(l => l.valid).join() === 'true,false,true,true,true', `validity per lap (got ${h.map(l => l.valid)})`);
  const validMin = (k) => Math.min(...h.filter(l => l.valid).map(l => l.sectors[k] ?? l.time));
  check(near(t.best, Math.min(...h.filter(l => l.valid).map(l => l.time)), 1e-6) && t.best > h[1].time, `the session best is the fastest VALID lap, not the faster warned lap (got ${t.best}, warned ${h[1].time})`);
  check(t.events.filter(e => e.type === 'lap').map(e => e.best).join() === 'true,false,false,true,false', 'only valid laps are flagged as the best when they finish, and invalid ones never');
  check(t.events.filter(e => e.type === 'lap')[1].valid === false && t.events.filter(e => e.type === 'lap')[1].time < 85, 'an invalid lap keeps its time and is marked invalid');
  check(near(t.bestSectors[0], validMin(0), 1e-6) && t.bestSectors[0] > h[1].sectors[0], `sector bests come from valid laps too: the warned lap's faster S1 does not count (got ${t.bestSectors[0]}, warned ${h[1].sectors[0]})`);
  check(t.history[2].clean === false && t.history[0].clean === true && t.history[4].clean === true, 'a reset in the lap makes it unclean, the others stay clean');
  check(h.map(l => !!l.autopilot).join() === 'false,false,false,true,false', 'the autopilot flag is kept per lap');
  check(t.sectorPB.length === 3 && t.sectorPB.every(v => v === false), 'a lap that has just finished shows no purple sector until its next sector ends');
}
{
  // a lap reset in place (markJump) that is the fastest of the session is valid, but it is not whole: it never becomes the
  // session best, the PB flash or the delta reference, and it is not clean for the global times
  const t = runLaps(new LapTimer(track), [{ secs: [30, 31, 29] }, { secs: [27, 28, 26], jump: true }, { secs: [30, 31, 30] }]);
  const h = t.history, ev = t.events.filter(e => e.type === 'lap');
  check(h[1].valid === true && h[1].clean === false, 'a reset lap is valid but not clean');
  check(near(t.best, h[0].time, 1e-6), `a reset lap does not become the session best (best ${t.best}, lap 1 ${h[0].time}, reset lap ${h[1].time})`);
  check(ev.map(e => e.best).join() === 'true,false,false', `no PB flash for the reset lap (got ${ev.map(e => e.best)})`);
  check(t.bestTrace !== null && near(t.bestTrace[t.bestTrace.length - 1], h[0].time, 1e-3), 'the delta reference is still lap 1, not the reset lap');
  check(near(t.last, h[2].time, 1e-6), 'the reset lap is still the last lap time');
}
{
  // a reset before the first crossing (the start phase) does not change the first lap
  const t = new LapTimer(track);
  t.markJump();
  runLaps(t, [{ secs: [30, 31, 29] }]);
  check(t.history.length === 1 && t.history[0].clean === true, 'a jump before the out lap does not spoil lap 1');
}
{
  // the local list: valid laps the driver drove; no invalid laps, no autopilot laps
  const st = { m: {}, getItem(k) { return k in this.m ? this.m[k] : null; }, setItem(k, v) { this.m[k] = String(v); } };
  const bt = new LapTimer(track);
  state.s = 949; bt.update(state.s, state.t);
  const bd = createBoard({ hidden: true }, { timer: bt, lobby: null, storage: st });
  drive(bt, 51, 1);
  scenario.forEach(l => lapOf(bt, l));
  bd.update(state.t, 0);
  const list = loadBest(st, BEST_KEY);
  check(list.length === 3 && list.map(e => Math.round(e.time)).join() === '90,90,93', `the local list has the three valid, non-autopilot laps (got ${list.map(e => e.time.toFixed(2))})`);
  check(!list.some(e => e.time < 85 || (e.time > 88 && e.time < 89.5)), 'neither the warned 84 nor the autopilot 89 is saved');
}

console.log('BOARD DATA');
// sector colours
check(sectorClass(30, null, null) === 'purple', 'the first time of the session is the session best');
check(sectorClass(30, 30.5, null) === 'purple' && sectorClass(30, 30, null) === 'purple', 'faster than or equal to the session best is purple');
check(sectorClass(30.4, 30, 30.5) === 'green', 'slower than the session best but beating your personal best is green');
check(sectorClass(30.6, 30, 30.5) === 'yellow' && sectorClass(30.6, 30, null) === 'yellow', 'slower than both is yellow');
check(sectorClass(null, 30, 30) === '', 'no time, no colour');

const H = (lap, time, sectors, warnings = 0) => ({ lap, time, sectors, warnings, valid: warnings === 0 });
const hist = [H(1, 90, [30, 31, 29]), H(2, 90.5, [29.5, 31.5, 29.5], 1), H(3, 89.5, [30.5, 30.5, 28.5]), H(4, 92, [31, 31, 30])];
const pb = [30.6, 31.2, 29.2];
const rows = lapRows(hist, 10, pb);
check(rows.map(r => r.lap).join() === '4,3,2,1', 'laps are listed newest first');
const byLap = Object.fromEntries(rows.map(r => [r.lap, r]));
check(byLap[1].sectors.every(s => s.cls === 'purple'), 'lap 1: the first laps of the session are purple');
check(byLap[2].sectors.map(s => s.cls).join() === 'green,yellow,yellow', `lap 2 (invalid): S1 beats the session's valid best but is never purple, so green (beats the personal best 30.6); S2 and S3 slower than the personal best are yellow (got ${byLap[2].sectors.map(s => s.cls)})`);
check(byLap[3].sectors[0].cls === 'green', 'lap 3 S1 30.5 beats the personal best 30.6 but not the session best 29.5: green');
check(byLap[4].sectors.map(s => s.cls).join() === 'yellow,green,yellow', 'lap 4: slower than the session, but S2 (31.0) still beats the personal best 31.2');
check(byLap[3].best && !byLap[1].best && !byLap[4].best, 'only the fastest lap is marked best');
check(!byLap[2].valid && byLap[2].warnings === 1 && byLap[1].valid, 'invalid laps are marked');
const many = Array.from({ length: 25 }, (_, i) => H(i + 1, 90 + i, [30, 30, 30 + i]));
const last10 = lapRows(many);
check(last10.length === 10 && last10[0].lap === 25 && last10[9].lap === 16, 'only the last 10 laps are listed');

// this session summary: a fake timer
const fake = (h, current, lastSectors, last, best, running) => ({ history: h, current, lastSectors, last, best, running: () => running });
{
  const v = sessionView(fake(hist, [], hist[3].sectors, 92, 89.5, 12.3), 0, pb);
  check(!v.live && v.cells.map(c => c.time).join() === '31,31,30', 'between laps the cells show the last lap');
  check(near(v.delta, 92 - 89.5), 'delta after a lap is the last lap minus the best');
  check(v.cells.map(c => c.cls).join() === 'yellow,green,yellow', 'cells carry the sector colours of the last lap');
  const w = sessionView(fake(hist, [30.0, 30.2], hist[3].sectors, 92, 89.5, 61), 0, pb);
  check(w.live && w.cells[0].time === 30 && w.cells[2].time === null, 'during a lap the cells show the sectors so far');
  check(near(w.delta, (30 + 30.2) - (30.5 + 30.5)), 'delta during a lap is against the same sectors of the best lap');
  check(w.cells[0].cls === 'purple' && w.cells[1].cls === 'purple' && w.cells[2].cls === '', 'colours of the lap in progress: 30.0 is the best valid S1 so far (purple), 30.2 the best valid S2 (purple)');
  const none = sessionView(fake([], [], null, null, null, null), 0, [null, null, null]);
  check(none.delta === null && none.cells.every(c => c.time === null), 'a fresh session shows nothing and no delta');
}

console.log('LOCAL TOP 10');
{
  let list = [];
  const times = [95.2, 91.1, 99.9, 93.3, 91.1, 97, 94, 92.5, 96, 98, 90.4, 100.5, 91.0];
  times.forEach((x, i) => { list = addBest(list, { time: x, sectors: [30, 31, x - 61], date: '2026-10-0' + (1 + i % 9), warn: 0 }); });
  check(list.length === TOP_N, 'the list is cut to 10');
  check(list.every((e, i) => i === 0 || list[i - 1].time <= e.time), 'sorted fastest first');
  check(list[0].time === 90.4 && list[9].time === 97 || list[9].time === 96, `fastest and 10th are right (${list[0].time}, ${list[9].time})`);
  check(!list.some(e => e.time === 100.5 || e.time === 99.9), 'slow laps fall off the end');
  const a = { time: 91.1, sectors: [], date: 'first', warn: 0 }, b = { time: 91.1, sectors: [], date: 'second', warn: 0 };
  check(addBest([a], b)[0] === a, 'a tie keeps the older lap first');
  const input = [{ time: 95, sectors: [1, 2, 3], date: 'x', warn: 0 }];
  addBest(input, { time: 90, sectors: [], date: 'y', warn: 0 });
  check(input.length === 1, 'addBest does not change its input');

  // storage: a fake that holds strings, and ones that throw
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
  const st = mem();
  saveBest(list, st);
  check(Object.keys(st.m).join() === BEST_KEY && BEST_KEY === 'lakeside.best', 'saved under lakeside.best');
  const back = loadBest(st);
  check(back.length === TOP_N && back[0].time === list[0].time && back[0].date === list[0].date && back[3].sectors.length === 3, 'loads what was saved');
  check(loadBest(mem()).length === 0, 'nothing saved gives an empty list');
  const broken = mem(); broken.setItem(BEST_KEY, '{not json');
  check(loadBest(broken).length === 0, 'damaged data gives an empty list');
  broken.setItem(BEST_KEY, JSON.stringify([{ time: 'x' }, null, { time: 90, sectors: [1, 'a', 3], date: '2026-01-02<b>', warn: 1 }, { time: -5 }]));
  const cleaned = loadBest(broken);
  check(cleaned.length === 1 && cleaned[0].sectors[1] === null && cleaned[0].warn === 1, 'bad entries are dropped and bad fields cleaned');
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  check(loadBest(thrower).length === 0, 'storage that throws on read gives an empty list');
  let ok = true; try { saveBest(list, thrower); loadBest(null); saveBest(list, null); } catch (e) { ok = false; }
  check(ok, 'storage that throws on write, or is missing, does not break the game');
  const ps = personalSectors([{ sectors: [30, 31, 29] }, { sectors: [29.5, 32, null] }]);
  check(ps[0] === 29.5 && ps[1] === 31 && ps[2] === 29, 'personal best sectors are the best of each over the saved laps');
  check(personalSectors([]).every(v => v === null), 'no saved laps: no personal best');
  check(/^\d{4}-\d\d-\d\d$/.test(today()) && today(new Date(2026, 0, 5)) === '2026-01-05', 'dates are YYYY-MM-DD in local time');
}

console.log('ROOM BOARD');
{
  const g = new Ghosts(null);
  const st = (name, lap, bl, ll, t = 1000) => ({ t, x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0, yr: 0, st: 0, w: 0, thr: 0, brk: 0, pz: 0, rx: 0, col: 1, lap, s: 0, name, bl, ll });
  g.receive('a', st('Ada', 4, 91.2, 92.0), 0);
  g.receive('b', st('Bo', 3, 90.1, 95.5), 0);
  g.receive('c', st('Cy', 1, 0, 0), 0);        // still on the out lap, no time
  const rows = g.board({ name: 'Me', laps: 5, best: 90.9, last: 91.4 });
  console.log('  ' + rows.map(r => `${r.name}${r.me ? '(you)' : ''} ${r.best || '-'}`).join('  '));
  check(rows.map(r => r.name).join() === 'Bo,Me,Ada,Cy', `ordered by best lap, no lap last (got ${rows.map(r => r.name)})`);
  check(rows.find(r => r.me).name === 'Me' && rows.filter(r => r.me).length === 1, 'exactly one row is you');
  check(near(rows[0].gap, 0) && near(rows[1].gap, 0.8, 1e-9) && near(rows[2].gap, 1.1, 1e-9), 'gaps are to the fastest best lap');
  check(rows.find(r => r.name === 'Ada').laps === 3 && rows.find(r => r.name === 'Me').laps === 5 && rows.find(r => r.name === 'Cy').laps === 0, 'laps are finished laps (the lap in progress is not counted)');
  check(rows.find(r => r.name === 'Cy').gap === 0 && rows.find(r => r.name === 'Cy').best === 0, 'a player with no lap has no gap');
  const alone = new Ghosts(null).board({ name: 'Me', laps: 0, best: null, last: null });
  check(alone.length === 1 && alone[0].me && alone[0].best === 0 && alone[0].gap === 0, 'alone in a room: just you');
  const tie = new Ghosts(null);
  tie.receive('a', st('Ada', 2, 90, 90), 0);
  const tied = tie.board({ name: 'Me', laps: 1, best: 90, last: 90 });
  check(tied.length === 2 && tied[0].gap === 0 && tied[1].gap === 0, 'equal best laps share the lead');
}

if (fails.length) { console.log('\nFAILED'); for (const f of fails) console.log('  ' + f); process.exit(1); }
console.log('  all passed');
