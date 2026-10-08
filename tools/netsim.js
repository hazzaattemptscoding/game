// Simulated network test for remote cars. Two players drive the same scripted run (straight at 60 m/s, a corner, straight
// again). Each sends its state 30 times a second over a fake link with a base latency, jitter and optionally a stall (no
// packet leaves for a while, then they all arrive together), in order, as a relay socket would deliver them. Each player
// draws the other through src/ghosts.js. Measured on each screen, against the sender's true path:
//   (a) visual lag: how many ms behind the sender's true pose the drawn car sits (mean and p95)
//   (b) position error: distance from the drawn car to where the sender was one base latency earlier (max)
//   (c) snaps: frames where the drawn car jumps more than 3 m
//   (d) standings: race distance of the remote car in the standings minus the race distance of the drawn pose (must be 0)
// The old behaviour (legacy: fixed 150 ms delay, freeze then snap) and the new one (adaptive delay, clock offset, catch-up
// after a stall) run over the same packets. Run with `npm run netsim`.
import { Ghosts, encodeState, decodeState, raceDistance } from '../src/ghosts.js';

const RATE = 30;                 // states a second
const T = 12000;                 // ms of the scripted run
const WARM = 2000;               // ms before the measuring starts: the clock offset and the delay settle
const BASE = 60;                 // the mean one-way latency, ms: the reference is where the car was BASE ms ago
const FRAME = 1000 / 60;         // the screen refreshes at 60 Hz
const LAP = 300;                 // metres in a lap, for race distance (the script drives several laps)
const V = 60;                    // m/s
const SKEW = [5000, -2300];      // each sender's clock is this far from ours, ms: the offset has to be found

// The scripted run, sampled every ms: straight for 4 s, a corner at 0.5 rad/s for 3 s, straight again.
function script(x0, z0) {
  const n = T + 1, x = new Float64Array(n), z = new Float64Array(n), h = new Float64Array(n), s = new Float64Array(n);
  let cx = x0, cz = z0, ch = 0, cs = 0;
  for (let i = 0; i < n; i++) {
    x[i] = cx; z[i] = cz; h[i] = ch; s[i] = cs;
    const yr = i >= 4000 && i < 7000 ? 0.5 : 0;
    ch += yr * 0.001; cx += Math.cos(ch) * V * 0.001; cz += Math.sin(ch) * V * 0.001; cs += V * 0.001;
  }
  return { n, x, z, h, s };
}
// the true pose at wall time ms (clamped to the run)
function truth(sc, ms) {
  const i = Math.max(0, Math.min(sc.n - 1, Math.round(ms)));
  return { x: sc.x[i], z: sc.z[i], h: sc.h[i], vx: V * Math.cos(sc.h[i]), vz: V * Math.sin(sc.h[i]), yr: i >= 4000 && i < 7000 ? 0.5 : 0, lap: Math.floor(sc.s[i] / LAP), s: sc.s[i] % LAP };
}

const rngOf = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The packets one sender puts on the link, as [{ at (arrival, ms), wire }] in arrival order.
function packetsFor(p, sc, { base, jit, stall }) {
  const rng = rngOf(1000 + p * 77), out = [];
  let prevAt = -Infinity;
  for (let k = 0; ; k++) {
    const w = k * 1000 / RATE;
    if (w > T) break;
    // a stall: what is made during it is held by the link until it ends, then comes through at once
    const depart = stall && w >= stall.at && w < stall.at + stall.ms ? stall.at + stall.ms : w;
    const q = truth(sc, w);
    const st = { t: Math.round(w + SKEW[p]), x: q.x, y: 0, z: q.z, h: q.h, vx: q.vx, vz: q.vz, yr: q.yr, st: 0, w: 0, thr: 1, brk: 0, pz: 0, rx: 0, col: 0,
      lap: q.lap, s: q.s, name: `P${p}`, bl: 0, ll: 0 };
    const wire = JSON.parse(JSON.stringify(encodeState(st)));
    const at = Math.max(depart + Math.max(0, base + (rng() * 2 - 1) * jit), prevAt + 0.01);   // in order, like a socket
    prevAt = at;
    out.push({ at, wire });
  }
  return out;
}

// a stand-in for the 3D car: remembers the pose it was last given
function stubFactory() {
  return { create() { const ent = { pose: null, setPose(p) { ent.pose = { x: p.x, z: p.z, h: p.h, vx: p.vx, vz: p.vz, lap: p.lap, s: p.s }; }, setOpacity() {}, setLabel() {}, dispose() {} }; return ent; } };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// the lag: the sender's true pose at wall time w - tau that the drawn pose matches best
function lagOf(sc, d, w) {
  let best = 0, bestErr = Infinity;
  for (let tau = -100; tau <= 400; tau++) {
    const e = Math.hypot(d.x - sc.x[Math.max(0, Math.min(sc.n - 1, Math.round(w - tau)))], d.z - sc.z[Math.max(0, Math.min(sc.n - 1, Math.round(w - tau)))]);
    if (e < bestErr) { bestErr = e; best = tau; }
  }
  return best;
}

// one run of both players over the same packets, with the old or the new behaviour
function simulate(net, legacy) {
  const scripts = [script(0, 0), script(-60, 3)];          // player 1 starts 60 m behind player 0, in the next lane
  const sides = [0, 1].map(r => ({ r, ghosts: new Ghosts(stubFactory(), { legacy }), queue: net[1 - r], qi: 0, lags: [], posErr: 0, snaps: 0, standErr: 0, prev: null, delaySum: 0, frames: 0 }));
  const id = p => `P${p}`;
  for (let w = 0; w <= T; w += FRAME) {
    for (const sd of sides) {
      while (sd.qi < sd.queue.length && sd.queue[sd.qi].at <= w) { const pk = sd.queue[sd.qi++]; sd.ghosts.receive(id(1 - sd.r), decodeState(pk.wire), pk.at); }
      sd.ghosts.update(w, null);
      const g = sd.ghosts.map.get(id(1 - sd.r));
      const d = g && g.ent && g.ent.pose;
      if (!d || w < WARM) continue;
      sd.lags.push(lagOf(scripts[1 - sd.r], d, w));
      sd.posErr = Math.max(sd.posErr, dist(d, truth(scripts[1 - sd.r], w - BASE)));
      if (sd.prev && dist(d, sd.prev) > 3) sd.snaps++;
      sd.prev = d;
      sd.delaySum += g.buf.delay * 1000; sd.frames++;
      const own = truth(scripts[sd.r], w);
      const rows = sd.ghosts.standings({ name: 'me', lap: own.lap, s: own.s, speed: V }, LAP);
      const row = rows.find(r => !r.me);
      sd.standErr = Math.max(sd.standErr, Math.abs(row.dist - raceDistance(d.lap, d.s, LAP)));
    }
  }
  const lags = sides.flatMap(sd => sd.lags).sort((a, b) => a - b);
  const mean = lags.reduce((a, b) => a + b, 0) / lags.length;
  const p95 = lags[Math.min(lags.length - 1, Math.ceil(0.95 * lags.length) - 1)];
  return {
    mean, p95,
    posErr: Math.max(...sides.map(sd => sd.posErr)),
    snaps: sides.reduce((a, sd) => a + sd.snaps, 0),
    standErr: Math.max(...sides.map(sd => sd.standErr)),
    delay: sides.reduce((a, sd) => a + sd.delaySum, 0) / sides.reduce((a, sd) => a + sd.frames, 0),
  };
}

const CASES = [
  { name: 'jitter 60 ms +/- 20 ms', base: 60, jit: 20 },
  { name: 'jitter 60 ms +/- 20 ms, 300 ms stall', base: 60, jit: 20, stall: { at: 5000, ms: 300 } },
  { name: 'calm 60 ms +/- 2 ms (for reference)', base: 60, jit: 2 },
];

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const pad = (s, n) => String(s).padEnd(n);
const f0 = v => (Math.round(v)).toString();
const f2 = v => v.toFixed(2);

console.log('REMOTE CAR SIMULATION: 2 players, 30 Hz states, 60 m/s straight then a corner; measured after 2 s');
console.log(pad('case', 36) + pad('version', 9) + pad('mean lag', 10) + pad('p95 lag', 9) + pad('max pos err', 13) + pad('snaps', 7) + pad('delay', 8) + 'standings err');
console.log(pad('', 36) + pad('', 9) + pad('ms', 10) + pad('ms', 9) + pad('m', 13) + pad('> 3 m', 7) + pad('ms', 8) + 'm');
const results = {};
for (const c of CASES) {
  // the same packets for both versions: each sender's generator is seeded the same way every time
  const net = [0, 1].map(p => packetsFor(p, script(p === 0 ? 0 : -60, p === 0 ? 0 : 3), c));
  const old = simulate(net, true), neu = simulate(net, false);
  results[c.name] = { old, neu };
  for (const [label, m] of [['old', old], ['new', neu]]) {
    console.log(pad(c.name, 36) + pad(label, 9) + pad(f0(m.mean), 10) + pad(f0(m.p95), 9) + pad(f2(m.posErr), 13) + pad(m.snaps, 7) + pad(f0(m.delay), 8) + f2(m.standErr));
  }
  check(neu.standErr < 1e-9, `${c.name}: standings and drawn pose disagree by ${neu.standErr}`);
}
{
  const a = results[CASES[0].name];
  const cut = 1 - a.neu.mean / a.old.mean;
  console.log(`\njitter case: mean lag ${f0(a.old.mean)} ms before, ${f0(a.neu.mean)} ms after (${(cut * 100).toFixed(0)} % less)`);
  check(a.neu.mean <= 0.6 * a.old.mean, `jitter: mean lag must fall by at least 40 % (${f0(a.old.mean)} to ${f0(a.neu.mean)} ms)`);
}
{
  const b = results[CASES[1].name];
  console.log(`stall case: p95 lag ${f0(b.old.p95)} ms before, ${f0(b.neu.p95)} ms after; snaps above 3 m: ${b.old.snaps} before, ${b.neu.snaps} after`);
  check(b.neu.p95 <= b.old.p95, `stall: p95 lag is not worse (${f0(b.old.p95)} to ${f0(b.neu.p95)} ms)`);
  check(b.neu.snaps === 0, `stall: no snap above 3 m (${b.neu.snaps})`);
}

if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nPASS');
