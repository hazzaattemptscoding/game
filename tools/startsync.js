// Start clock tests: the offset from clock samples, the samples a guest takes, and how a race message waits for a clock.
// Run with `npm run startsync` (also part of `npm run check`). No browser needed.
//   1. the estimate: the median of the lowest-round-trip half, not just the shortest round trip
//   2. a join: seven samples 100 ms apart, the offset found exactly on a symmetric path
//   3. a race with a fresh clock starts at once, on this machine's clock
//   4. a race after a clock older than 20 s: a new run first, the race waits for its replies
//   5. no reply at all: the guest starts as a free drive with no sequence (never on its raw clock)
//   6. some replies: the race waits for the timeout, then uses what arrived
//   7. a guest that changes room does not mix the old room's samples into the new one
import { estimateOffset, sampleOffset } from '../src/start.js';
import { createRaceControl, RESYNC_MS, WAIT_MS, SAMPLES } from '../src/raceControl.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('ESTIMATE');
{
  // the shortest round trip is the odd one out (its stamp was lopsided): the median of the lowest half is the answer, not that one
  const est = estimateOffset([
    { rtt: 50, offset: 120 }, { rtt: 55, offset: 100 }, { rtt: 60, offset: 80 },
    { rtt: 300, offset: 9000 }, { rtt: 320, offset: 9100 }, { rtt: 400, offset: 9200 }, { rtt: 500, offset: 9300 },
  ]);
  check(est && est.offset === 100, `median of the lowest-round-trip half (got ${est && est.offset}, want 100)`);
  check(est && est.rtt === 50 && est.n === 7, 'the shortest round trip is reported, and all samples counted');
  check(estimateOffset([{ rtt: 80, offset: 5 }, { rtt: 40, offset: 7 }]).offset === 7, 'two samples: the shorter round trip alone');
  check(estimateOffset([{ rtt: 10, offset: 1 }, { rtt: 20, offset: 3 }, { rtt: 30, offset: 5 }, { rtt: 40, offset: 9 }]).offset === 2, 'four samples: the mean of the middle two of the lowest half');
  check(estimateOffset([]) === null && estimateOffset([{ rtt: NaN, offset: 1 }]) === null, 'no usable sample gives null');
  check(near(sampleOffset(1000, 6040, 1080).offset, 5000, 1e-9), 'a symmetric sample finds the offset');
}

// a small world: real time T runs for everyone, each machine's clock reads T + skew, a message takes lat[to] ms (the sender's table)
let T = 0; const queue = [];
const at = (ms, f) => queue.push({ ms: T + ms, f });
const run = until => { for (;;) { queue.sort((a, b) => a.ms - b.ms); if (!queue.length || queue[0].ms > until) break; const e = queue.shift(); T = Math.max(T, e.ms); e.f(); } T = until; };
const nodes = {};
function node(id, isHost, skew, lat = {}, opts = {}) {
  const n = { id, skew, got: [], clk: [] };
  n.mp = {
    isHost, selfId: id, hostPeerId: 'host', code: 'ROOMA', peers: new Map(),
    sendControl(obj, to) {
      if (obj.t === 'clk') n.clk.push(T);
      if (obj.t === 'clk' && (opts.dropAll || (opts.keep && !opts.keep.has(n.clk.length - 1)))) return true;   // this request's reply never comes
      for (const o of Object.values(nodes)) if (o !== n && (to === undefined || to === o.id)) at(lat[o.id] ?? 30, () => o.rc.handle(JSON.parse(JSON.stringify(obj)), id));
      return true;
    },
  };
  n.rc = createRaceControl({ mp: n.mp, now: () => T + skew, random: () => 0.5, setTimeout: (f, ms) => at(ms, f), onRace: r => n.got.push({ ...r, real: T }) });
  nodes[id] = n;
  return n;
}
const HOST_SKEW = 777000;
const H = node('host', true, HOST_SKEW);
const G = node('g1', false, -42000, { host: 35 });        // the host's own latency to us is 30 (default), ours to it 35: a lopsided path
const TRUE = HOST_SKEW - (-42000);                          // host clock = guest clock + this
const sameTrue = (x, tol = 1) => near(x, TRUE, tol);

console.log('JOIN SYNC');
G.rc.syncClock();
run(1000);
check(G.clk.length === SAMPLES && SAMPLES === 7, `a join takes seven samples (got ${G.clk.length})`);
check(G.clk.every((t, i) => i === 0 || near(t - G.clk[i - 1], 100, 1e-9)), 'the samples are 100 ms apart');
check(G.rc.estimate && G.rc.estimate.n === 7, 'all seven replies are in the estimate');
check(G.rc.offset !== null && near(G.rc.offset, TRUE, 20), `offset found on the lopsided path (error ${G.rc.offset === null ? 'none' : (G.rc.offset - TRUE).toFixed(1)} ms, limit 20)`);

console.log('RACE WITH A FRESH CLOCK');
{
  const clkBefore = G.clk.length;
  const r = H.rc.hostStart({ laps: 3, grid: ['host', 'g1'] });
  run(T + 200);
  check(G.got.length === 1, 'the race reaches the guest');
  check(G.clk.length === clkBefore, 'no new sync: the clock is fresh');
  check(G.got[0].seq && near(G.got[0].seq.goAt, r.msg.startAt - G.rc.offset, 1), 'lights out is on the guest clock, from the host time');
  check(G.got[0].slot === 1 && !G.got[0].late, 'on the grid, not late');
}

console.log('RACE AFTER A STALE CLOCK');
{
  run(T + RESYNC_MS + 5000);                                  // the last reply is now older than 20 s
  const clkBefore = G.clk.length, gotBefore = G.got.length;
  const r = H.rc.hostStart({ laps: 3, grid: ['host', 'g1'] });
  const arrive = T + 30;
  run(arrive + 500);
  check(G.clk.length - clkBefore >= 6, `a new run starts when the race comes (${G.clk.length - clkBefore} requests)`);
  check(G.got.length === gotBefore, 'the race waits for the replies (nothing yet after 500 ms)');
  run(arrive + 800);
  check(G.got.length === gotBefore + 1, 'the race goes out once seven replies are in');
  const got = G.got[G.got.length - 1];
  check(got.seq && near(got.seq.goAt, r.msg.startAt - G.rc.offset, 1) && !got.late, 'and starts on the new offset');
}

console.log('NO CLOCK AT ALL');
{
  const X = node('g2', false, 5000, {}, { dropAll: true });
  X.rc.syncClock();                                       // nothing ever comes back
  run(T + 100);
  const r = H.rc.hostStart({ laps: 3, grid: ['host', 'g1', 'g2'] });
  const arrive = T + 30;
  run(arrive + 1400);
  check(X.got.length === 0, 'no race before the wait is over (1.4 s)');
  run(arrive + WAIT_MS + 50);
  check(X.got.length === 1, 'after 1.5 s the race is handed over anyway');
  check(X.got[0].late === true && X.got[0].seq === null, 'as a free drive, with no sequence built from a guessed offset');
  check(!X.got.some(g => g.seq && near(g.seq.goAt, r.msg.startAt, 1)), 'never the raw clock');
}

console.log('SOME REPLIES, THEN A STALE CLOCK');
{
  const P = node('g3', false, 9000, {}, { keep: new Set([0, 1, 2]) });   // three replies at the join, none after
  P.rc.syncClock();
  run(T + 1000);
  check(P.rc.estimate && P.rc.estimate.n === 3 && near(P.rc.offset, HOST_SKEW - 9000, 20), 'the join got three replies, the offset is right');
  run(T + RESYNC_MS + 1000);                                  // the clock is now stale
  const r = H.rc.hostStart({ laps: 3, grid: ['host', 'g1', 'g3'] });
  const arrive = T + 30;
  run(arrive + 1400);
  check(P.got.length === 0, 'a stale clock: the race waits for the run (nothing after 1.4 s)');
  run(arrive + WAIT_MS + 50);
  check(P.got.length === 1 && P.got[0].seq !== null && !P.got[0].late, 'after 1.5 s it starts on the offset it has (no new reply came)');
  check(P.got[0].seq && near(P.got[0].seq.goAt, r.msg.startAt - P.rc.offset, 1), 'lights out on that offset');
}

console.log('ANOTHER ROOM');
{
  const Q = node('g4', false, 1000, {});
  Q.rc.syncClock(); run(T + 1000);
  check(Q.rc.estimate && Q.rc.estimate.n === 7, 'first room: seven samples');
  Q.mp.code = 'ROOMB';
  Q.rc.syncClock();
  check(Q.rc.offset === null && Q.rc.estimate === null, 'joining another room drops the old room\'s clock at once');
  run(T + 1000);
  check(Q.rc.estimate && Q.rc.estimate.n === 7, 'the new room has its own seven samples, none of the old');
}

console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'PASS');
process.exitCode = fails.length ? 1 : 0;
