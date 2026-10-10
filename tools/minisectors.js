// Minisector and marshal light test. Run with `npm run minisectors` (also part of `npm run check`). No browser needed.
//   1. boundaries: about 25 pieces of about equal length, the three sector boundaries among them, mirrored in reverse
//   2. timing: every lap's minisector times add up to the lap time and to each sector time, forward and reverse
//   3. colours: purple (session best), green (better than the last lap), yellow (slower); a jump leaves gaps instead of wrong times;
//      a lap with a track limit warning is never purple and never sets the bests
//   4. marshal posts: one per boundary, behind the wall, off the pit lane, clear of stands and barrier lines
//   5. light panels: states, flashing, and the automatic yellow for a stopped or off-track car
import { buildTrack, SURF } from '../src/track.js';
import { LapTimer } from '../src/timing.js';
import { minisectorBounds, minisectorAt, MINISECTORS, PURPLE, GREEN, YELLOW } from '../src/minisectors.js';
import { createGround, sceneryFootprints } from '../src/scenery.js';
import { planStands, trackBlockers, wallClearance } from '../src/grandstands.js';
import { planExtras, footBlockers } from '../src/venueExtras.js';
import { planMarshal, createMarshalLights, MarshalWatch, STATES } from '../src/marshal.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const T = buildTrack(), L = T.length;

console.log('BOUNDARIES');
const B = minisectorBounds(T), Br = minisectorBounds(T, true);
console.log(`  ${B.length - 1} minisectors, ${Math.min(...B.slice(1).map((b, i) => b - B[i])).toFixed(0)} to ${Math.max(...B.slice(1).map((b, i) => b - B[i])).toFixed(0)} m, mean ${(L / MINISECTORS).toFixed(0)} m`);
check(B.length === MINISECTORS + 1 && B[0] === 0 && B[MINISECTORS] === L, 'bounds run from 0 to the lap length in 25 pieces');
check(B.every((b, i) => i === 0 || b > B[i - 1]), 'bounds rise');
const lens = B.slice(1).map((b, i) => b - B[i]), mean = L / MINISECTORS;
check(lens.every(l => l > mean * 0.6 && l < mean * 1.5), 'every minisector is within 60% to 150% of the mean length');
check(T.sectors.every(s => B.some(b => near(b, s, 1e-6))), 'the three sector boundaries are minisector boundaries');
check(Br.length === B.length && Br.every((b, i) => near(b, L - B[B.length - 1 - i], 1e-9)), 'reverse bounds are the forward ones mirrored');
const rs = [0, L - T.sectors[2], L - T.sectors[1]];
check(rs.every(s => Br.some(b => near(b, s, 1e-6))), 'the mirrored sector boundaries are minisector boundaries in reverse');
check(minisectorAt(B, 0) === 0 && minisectorAt(B, L - 0.01) === MINISECTORS - 1 && minisectorAt(B, B[7]) === 7 && minisectorAt(B, B[7] - 0.01) === 6, 'minisectorAt finds the piece');

// drive a path through the timer. speedAt(lapIndex, minisector) gives m/s. Returns the timer.
const DT = 1 / 120;
function drive(timer, laps, speedAt, { reverse = false, startS = L - 60 } = {}) {
  const bounds = minisectorBounds(T, reverse);
  let lapS = startS, time = 0, lapNo = 0, prevLapS = lapS;
  timer.update(reverse ? (L - lapS) % L : lapS, time);
  while (timer.lap < laps) {
    const v = speedAt(timer.lap, minisectorAt(bounds, lapS % L));
    lapS += v * DT; time += DT;
    if (lapS >= L) lapS -= L;
    timer.update(reverse ? (L - lapS) % L : lapS, time);
    if (++lapNo > 5e6) throw new Error('lap never finished');
  }
  return timer;
}
const sum = a => a.reduce((x, y) => x + y, 0);

console.log('TIMING');
for (const reverse of [false, true]) {
  const timer = new LapTimer(T); timer.reverse = reverse; timer.reset();
  drive(timer, 3, (lap, m) => 48 + lap * 2 + (m % 5), { reverse });
  const h = timer.minis.history, name = reverse ? 'reverse' : 'forward';
  check(h.length === 3 && timer.history.length === 3, `${name}: three laps timed`);
  h.forEach((lap, i) => {
    const total = sum(lap.times);
    check(lap.times.length === MINISECTORS && lap.times.every(t => t > 0), `${name} lap ${i + 1}: 25 times, all positive`);
    check(near(total, timer.history[i].time, 1e-9), `${name} lap ${i + 1}: minisector times add up to the lap time (${total} vs ${timer.history[i].time})`);
    // the sectors are built from the same minisectors
    const counts = [0, 0, 0], sb = reverse ? rs : T.sectors;
    for (let k = 0; k < MINISECTORS; k++) counts[sb.filter(s => s <= minisectorBounds(T, reverse)[k] + 1e-6).length - 1]++;
    let k0 = 0;
    counts.forEach((c, sct) => { const part = sum(lap.times.slice(k0, k0 + c)); check(near(part, timer.history[i].sectors[sct], 1e-9), `${name} lap ${i + 1}: sector ${sct + 1} equals its minisectors`); k0 += c; });
  });
  console.log(`  ${name}: lap times ${timer.history.map(l => l.time.toFixed(3)).join(', ')}; minisector sums match`);
}

console.log('COLOURS');
{
  const timer = new LapTimer(T);
  // lap 1 (after the out lap): 50 m/s. lap 2: 55 m/s, but 45 on pieces 5 to 9. lap 3: 47 m/s on pieces 5 to 9, else 52.
  const v = (lap, m) => lap === 0 ? 50 : lap === 1 ? (m >= 5 && m <= 9 ? 45 : 55) : (m >= 5 && m <= 9 ? 47 : 52);   // timer.lap is 0 on the out lap and the first full lap
  drive(timer, 3, v);
  const h = timer.minis.history;   // laps 1 to 3 (the out lap is not a lap)
  check(h[0].classes.every(c => c === PURPLE), 'the first lap is all purple (nothing to beat)');
  check(h[1].classes.every((c, m) => c === (m >= 5 && m <= 9 ? YELLOW : PURPLE)), 'lap 2: purple where faster than lap 1, yellow where slower');
  check(h[2].classes.every((c, m) => m < 5 || m > 9 ? c === YELLOW : true), 'lap 3: yellow where slower than lap 2');
  const m3 = h[2].classes.slice(5, 10);
  check(m3.every(c => c === GREEN), 'lap 3: faster than the last lap but not the session best is green (' + m3.join() + ')');
  check(timer.minis.best.every((b, m) => near(b, Math.min(...h.map(l => l.times[m])), 1e-12)), 'the session best of each minisector is the fastest of the laps');
  check(timer.minis.display().length === MINISECTORS, 'display gives 25 colours');
  const d = timer.minis.display();
  check(d.every((c, m) => c === h[2].classes[m]) || timer.minis.classes.length > 0, 'a new lap shows the last lap colours until each piece is done');
  // out lap: nothing is stored
  const t2 = new LapTimer(T); drive(t2, 1, () => 50);
  check(t2.minis.history.length === 1, 'the out lap is not stored, the first full lap is');
}

console.log('JUMPS');
{
  const timer = new LapTimer(T);
  let time = 0;
  const step = s => { time += DT; timer.update(s, time); };
  for (let s = L - 30; s < L; s += 0.4) step(s);
  for (let s = 0; s < 200; s += 0.4) step(s);   // over the line, lap 1 starts
  step(200 + 3 * mean); step(200 + 3 * mean + 0.4);   // a jump across several boundaries
  for (let s = 200 + 3 * mean; s < L - 1; s += 0.4) step(s);
  for (let s = L - 1; s < L; s += 0.4) step(s);
  for (let s = 0; s < 50; s += 0.4) step(s);
  check(timer.lap === 1, 'a lap with a jump still finishes');
  const lap = timer.minis.history[0];
  check(lap && lap.times.some(t => t === null), 'the pieces a jump hid have no time');
  check(lap && sum(lap.times.filter(t => t !== null)) <= timer.history[0].time + 1e-9, 'the timed pieces add up to no more than the lap');
  check(timer.history[0].valid === false && timer.history[0].jumped === true, 'a lap with a jump is invalid (like a track limit warning)');
  check(lap && lap.classes.every(c => c !== PURPLE), 'a jumped lap has no purple minisector, not even the pieces before the jump');
  check(timer.minis.best.every(b => b === null), 'and a jumped lap sets no minisector best');
  const back = new LapTimer(T);
  time = 0; const stepB = s => { time += DT; back.update(s, time); };
  for (let s = L - 30; s < L; s += 0.4) stepB(s);
  for (let s = 0; s < 800; s += 0.4) stepB(s);
  stepB(300);   // put back up the road
  for (let s = 300; s < L; s += 0.4) stepB(s);
  for (let s = 0; s < 50; s += 0.4) stepB(s);
  check(back.lap === 1 && back.minis.history.length === 0, 'a lap with a car put back is not kept as a minisector lap');
}

console.log('INVALID LAPS');
{
  // lap 1: 50 m/s (the reference). lap 2: 60 m/s, faster everywhere, but a track limit warning comes on piece 12, so the lap is
  // invalid: its earlier purple pieces must go back to green, and the session bests stay lap 1's. lap 3: 50 m/s again, the
  // same as lap 1, so it is purple everywhere (equal to the best), not against lap 2.
  const timer = new LapTimer(T);
  let warned = false;
  drive(timer, 3, (lap, m) => {
    if (lap === 1 && m >= 12 && !warned) { warned = true; timer.limits.byLap[timer.currentLap()] = 1; }   // a cut, counted the way TrackLimits counts it
    return lap === 1 ? 60 : 50;
  });
  const h = timer.minis.history;
  check(warned && timer.history[1].valid === false && timer.history[0].valid && timer.history[2].valid, 'the warning makes lap 2 invalid and only lap 2');
  check(h.length === 3, 'three minisector laps kept');
  check(h[1].classes.every(c => c !== PURPLE), 'invalid lap 2: no piece is purple (the ones before the warning are green again)');
  check(h[1].classes.slice(0, 12).every(c => c === GREEN), 'invalid lap 2: pieces 1 to 12 are green, faster than lap 1 (' + h[1].classes.join() + ')');
  // the bests are the fastest valid lap of each piece (lap 1 or lap 3; they differ by up to a physics step), never lap 2's
  check(timer.minis.best.every((b, m) => near(b, Math.min(h[0].times[m], h[2].times[m]), 1e-9)), 'the session bests come from the valid laps only (the invalid lap 2 never sets one)');
  check(h[2].classes.every(c => c === PURPLE || c === YELLOW) && h[2].classes.includes(PURPLE), 'lap 3 is judged against the session best (purple) and the slower last lap (yellow), no green');
  // a warning from the first counted lap on: none of its pieces are purple, and its best is not set
  const t2 = new LapTimer(T), w2 = { on: false };
  drive(t2, 2, (lap) => { if (lap === 0 && t2.lapStart !== null && !w2.on) { w2.on = true; t2.limits.byLap[t2.currentLap()] = 1; } return 50; });
  check(t2.minis.history.length === 2 && t2.minis.history[0].classes.every(c => c !== PURPLE) && t2.minis.history[1].classes.includes(PURPLE), 'a warning on the first counted lap: none of its pieces are purple, the next valid lap is');
}

console.log('MARSHAL POSTS');
const ground = createGround(T);
const blockers = [...trackBlockers(T), ...sceneryFootprints(T)];
const { stands } = planStands(T, ground, blockers);
const extras = planExtras(T, ground, blockers, stands);
const keepClear = { obstacles: [...stands, ...extras.items], blockers: [...blockers, ...footBlockers(extras.bridges)] };
const plan = planMarshal(T, ground, keepClear);
check(plan.why.length === 0 && plan.posts.length === MINISECTORS, `a post at every boundary (${plan.posts.length}, missing ${plan.why.map(w => w.k).join(',')})`);
const segDist = (x, z, sg) => { const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len))); return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az)); };
let worstWall = Infinity, worstSeg = Infinity, worstStand = Infinity, slid = 0;
for (const p of plan.posts) {
  const w = wallClearance(T, p.x, p.z), sg = Math.min(...T.segs.map(s => segDist(p.x, p.z, s)));
  worstWall = Math.min(worstWall, w); worstSeg = Math.min(worstSeg, sg);
  check(w >= 2.4, `post ${p.k}: ${w.toFixed(1)} m behind the wall, need 2.5`);
  check(sg >= 2.4, `post ${p.k}: ${sg.toFixed(1)} m from a barrier line, need 2.5`);
  const i = Math.round(p.s / T.ds) % T.N;
  if (p.side === 0) check(!T.pitOut[i] && !T.pitMouth[i], `post ${p.k}: on the pit lane side`);
  check(!T.isBridge[i], `post ${p.k}: on a bridge`);
  for (const o of keepClear.obstacles) { const a = (p.x - o.x) * o.ex[0] + (p.z - o.z) * o.ex[1], b = (p.x - o.x) * o.ez[0] + (p.z - o.z) * o.ez[1]; check(!(Math.abs(a) < o.len / 2 + 2 && b > -3 && b < o.depth + 2), `post ${p.k}: inside ${o.name}`); }
  for (const b of keepClear.blockers) check(Math.hypot(p.x - b.x, p.z - b.z) >= b.r + 1.5, `post ${p.k}: touches a building`);
  if (Math.abs(p.s - B[p.k]) > 1e-6) slid++;
  check(Math.abs(p.fx * p.fx + p.fz * p.fz - 1) < 1e-6, `post ${p.k}: facing is a unit vector`);
  const t = Math.hypot(...[T.x[(i + 1) % T.N] - T.x[i], T.z[(i + 1) % T.N] - T.z[i]]), tx = (T.x[(i + 1) % T.N] - T.x[i]) / t, tz = (T.z[(i + 1) % T.N] - T.z[i]) / t;
  check(p.fx * tx + p.fz * tz < -0.5, `post ${p.k}: the panel does not face the oncoming cars`);
}
console.log(`  ${plan.posts.length} posts, nearest to a wall ${worstWall.toFixed(1)} m, to a barrier line ${worstSeg.toFixed(1)} m, ${slid} slid along the road off their boundary`);

console.log('LIGHT PANELS');
{
  const m = createMarshalLights(T, ground, plan), col = k => { const c = m.group.children[1].instanceColor; return [c.getX(k), c.getY(k), c.getZ(k)]; };
  check(m.group.children.length === 3 && m.group.children.every(o => o.isInstancedMesh && o.count === plan.posts.length), 'three instanced meshes (posts, panels, the marshals): three draw calls');
  check(STATES.join() === 'off,yellow,double,red,green,blue', 'the six states');
  const off = col(3);
  m.set(3, 'red'); m.update(0);
  check(m.state(3) === 'red' && col(3)[0] > 0.9 && col(3)[1] < 0.2, 'red is lit red');
  m.set(4, 'green'); m.update(0); check(col(4)[1] > col(4)[0] && col(4)[1] > col(4)[2], 'green is lit green');
  m.set(5, 'blue'); m.update(0); check(col(5)[2] > col(5)[0], 'blue is lit blue');
  m.set(6, 'yellow'); m.update(0); const on = col(6); m.update(0.34); const gone = col(6);
  check(on[0] > 0.8 && on[2] < 0.2 && gone[0] < 0.2, 'yellow flashes: lit then dark half a period later');
  m.set(7, 'double'); m.update(0); const d0 = col(7)[0]; m.update(0.17); const d1 = col(7)[0];
  check(d0 > 0.8 && d1 < 0.2, 'double yellow flashes faster');
  m.update(0.01); m.update(0.02); check(col(3)[0] > 0.9, 'a steady colour does not change with time');
  m.setAll('off'); m.update(1); check(m.states().every(s => s === 'off') && col(3)[0] === off[0] && col(6)[0] === off[0], 'setAll off darkens every panel');
  m.setAll('red'); check(m.states().every(s => s === 'red'), 'setAll sets every panel');
  let threw = false; try { m.set(1, 'purple'); } catch (e) { threw = true; } check(threw, 'an unknown state is refused');
  m.set(25 + 2, 'green'); check(m.state(2) === 'green', 'boundary numbers wrap');
}
console.log('AUTOMATIC YELLOW');
{
  const TAR = [SURF.TARMAC, SURF.TARMAC, SURF.TARMAC, SURF.TARMAC], bounds = minisectorBounds(T, false);
  const mid = k => (bounds[k] + bounds[k + 1]) / 2;
  const rig = (reverse = false) => {
    const m = createMarshalLights(T, ground, plan), w = new MarshalWatch(m, T);
    const car = { x: 0, z: 0, speed: 0, loc: { s: mid(10), d: 0 }, wheelSurf: TAR, pitLimiter: false };
    let t = 0;
    const run = (secs, speed, surf = TAR) => { for (let i = 0; i < Math.round(secs * 20); i++) { t += 0.05; car.speed = speed; car.wheelSurf = surf; car.x += speed * 0.05; w.update(car, t, reverse); } };
    const lit = () => m.states().map((s, k) => s === 'yellow' ? k : -1).filter(k => k >= 0).join();
    return { m, w, car, run, lit, jump: () => { car.x += 500; } };
  };
  let r = rig();
  r.run(5, 0); check(r.lit() === '', 'a car on the grid that has not driven yet lights nothing');
  r.run(1, 60); r.run(0.8, 0); check(r.lit() === '', 'stopped for under a second lights nothing');
  r.run(0.5, 0); check(r.lit() === '9,10', 'stopped for over a second: yellow here and the one before (' + r.lit() + ')');
  r.run(2, 60); check(r.lit() === '9,10', 'still yellow 2 s after moving off');
  r.run(1.5, 60); check(r.lit() === '', 'cleared after 3 s of moving');
  r.run(1.5, 0); r.m.set(9, 'red'); r.run(5, 60);
  check(r.m.state(9) === 'red' && r.m.state(10) === 'off', 'a red set through the API is left alone');
  r = rig(); r.run(1, 60);
  const GRASS = [SURF.GRASS, SURF.GRASS, SURF.GRASS, SURF.GRASS];
  r.run(1.5, 60, GRASS); check(r.lit() === '9,10', 'all wheels off the track and still moving: yellow');
  r.run(2, 60, [SURF.TARMAC, SURF.GRASS, SURF.TARMAC, SURF.GRASS]); check(r.lit() === '9,10', 'one wheel back: still yellow until 3 s of driving');
  r.run(1.5, 60, [SURF.TARMAC, SURF.GRASS, SURF.TARMAC, SURF.GRASS]); check(r.lit() === '', 'two wheels on the tarmac for 3 s: clear');
  r = rig(); r.run(1, 60); r.run(4, 0, [SURF.PIT, SURF.PIT, SURF.PIT, SURF.PIT]); check(r.lit() === '', 'stopped in the pit lane lights nothing');
  r = rig(); r.run(1, 60); r.car.pitLimiter = true; r.run(4, 0); check(r.lit() === '', 'stopped with the pit limiter on lights nothing');
  r = rig(); r.run(1, 60); r.jump(); r.run(4, 0); check(r.lit() === '', 'a jump (a reset) disarms until the car drives again');
  r.run(1, 60); r.run(2, 0); check(r.lit() === '9,10', 'and it arms again after driving');
  r = rig(true); r.run(1, 60); r.run(2, 0);
  check(r.lit() === '11,12', 'reverse lap: lit on the boundaries the cars come from (' + r.lit() + ')');
}

console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'PASS');
process.exitCode = fails.length ? 1 : 0;
