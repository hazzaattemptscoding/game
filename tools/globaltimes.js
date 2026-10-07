// Global times, the game's side (src/globalTimes.js, src/lapTrace.js): the ghost line format, which board a lap goes on, which
// laps are posted at all, the posting queue against a fake server (offline, refused, busy) and the lap watcher over whole
// simulated laps. The relay's side has its own tests (tools/times.js); the end to end run against worker/dev-relay.mjs is at the end.
import { LapRecorder, encodeTrace, decodeTrace, sampleTrace, TRACE_HZ } from '../src/lapTrace.js';
import { boardFor, boardKey, boardLabel, validBoard, lapQualifies, timesBase, cleanName, createGlobalTimes, LapWatch, QUEUE_KEY, QUEUE_MAX, RETRY_MS } from '../src/globalTimes.js';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} within ${tol}`);

// ---- the ghost line ----
{
  const r = new LapRecorder();
  for (let t = 0; t <= 90; t += 1 / 120) r.push(t, 10 + t * 40, -5 + Math.sin(t), 3.1);
  r.finish(90.004, 3611, -4.2, 3.12);
  near(r.samples, 90 * TRACE_HZ + 2, 2, 'about 10 samples a second, plus the finish');
  const d = decodeTrace(r.encode());
  eq(d.length / 4, r.samples, 'decodes to the same number of samples');
  near(d[(r.samples - 1) * 4], 90.004, 1e-4, 'the last sample is at the finishing time');
  const p = sampleTrace(d, 45.05);
  near(p.x, 10 + 45.05 * 40, 0.05, 'position between samples');
  eq(decodeTrace('AAAA'), null, 'a length that is not whole samples is refused');
  eq(decodeTrace(''), null, 'empty is refused');
  // heading the short way round across +-pi
  const w = decodeTrace(encodeTrace(Float32Array.from([0, 0, 0, Math.PI - 0.1, 1, 1, 0, -Math.PI + 0.1])));
  near(Math.abs(sampleTrace(w, 0.5).yaw), Math.PI, 0.02, 'heading between samples goes the short way round');
  // a hint far ahead of t still finds the right sample (a new lap starts the clock again)
  const hint = { k: d.length / 4 - 3 };
  near(sampleTrace(d, 1.0, hint).x, 10 + 40, 0.5, 'a stale hint is reset when the clock goes back');
}

// ---- boards ----
{
  eq(boardFor({ weather: 'heavyrain', online: true, reverse: false, assists: { tc: false, abs: true, esc: false } }), { weather: 'wet', mode: 'online', dir: 'fwd', assists: 'on' }, 'rain, online, one assist');
  eq(boardFor({ weather: 'fog', online: false, reverse: true, assists: { tc: false, abs: false, esc: false } }), { weather: 'dry', mode: 'solo', dir: 'rev', assists: 'off' }, 'fog is dry, reverse, assists off');
  eq(boardKey({ weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'on' }), 'dry-solo-fwd-on', 'board key');
  eq(boardLabel({ weather: 'wet', mode: 'online', dir: 'rev', assists: 'off' }), 'Wet · Online · Reverse · Assists off', 'board label');
  check(!validBoard({ weather: 'damp', mode: 'solo', dir: 'fwd', assists: 'on' }), 'an unknown weather is not a board');
  eq(timesBase('wss://lakeside-relay.harry-eb8.workers.dev'), 'https://lakeside-relay.harry-eb8.workers.dev', 'wss becomes https');
  eq(timesBase('ws://localhost:8787/'), 'http://localhost:8787', 'ws becomes http, path dropped');
  eq(timesBase(''), '', 'no relay, no times');
  eq(cleanName('  Harry \u0007 P '), 'Harry P', 'control characters and extra spaces go');
  eq(cleanName('A<script>B'), 'AscriptB', 'only letters, digits, space . _ - stay');
  eq(cleanName('Abcdefghijklmnopqrstu'), 'Abcdefghijklmnop', 'at most 16 characters');
}

// ---- which laps are posted ----
{
  const lap = { time: 90.1, sectors: [35, 32.1, 23], valid: true, clean: true };
  check(lapQualifies(lap), 'a valid clean lap qualifies');
  check(!lapQualifies({ ...lap, valid: false }), 'a lap with a track limit warning does not');
  check(!lapQualifies({ ...lap, clean: false }), 'a lap with a reset does not');
  check(!lapQualifies(lap, { autopilot: true }), 'an autopilot lap does not');
  check(!lapQualifies({ ...lap, time: 40 }), 'an impossible time does not');
}

// ---- the posting queue against a fake server ----
async function queueTests() {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let clock = 1000, answer = { status: 200, body: { ok: true, improved: true, rank: 3, best: 90.1, entries: 7 } }, calls = [], down = false;
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (down) throw new Error('offline');
    const a = typeof answer === 'function' ? answer(url, init) : answer;
    return { status: a.status, ok: a.status === 200, json: async () => a.body };
  };
  let base = 'https://relay.example', results = [];
  const gt = createGlobalTimes({ fetchFn, storage, now: () => clock, getBase: () => base, onResult: (p, a) => results.push(a) });
  const board = { weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'on' };
  const post = t => ({ name: 'Harry', time: t, sectors: [30, 30, t - 60], board, build: 'abc' });

  check(await gt.submit(post(90.1)), 'a post goes out when the server answers');
  eq(calls[0].url, 'https://relay.example/times', 'posted to /times');
  eq(JSON.parse(calls[0].init.body).name, 'Harry', 'with the lap in the body');
  eq(gt.pending, 0, 'nothing left waiting');
  eq(results[0].rank, 3, 'the answer reaches onResult');

  down = true;
  check(!(await gt.submit(post(89.9))), 'offline: the post waits');
  eq(gt.pending, 1, 'one lap waiting');
  eq(JSON.parse(store.get(QUEUE_KEY)).length, 1, 'and it is saved in the browser');
  down = false;
  const before = calls.length;
  await gt.flush();
  eq(calls.length, before, 'no retry before RETRY_MS');
  clock += RETRY_MS + 1;
  check(await gt.flush(), 'retried after RETRY_MS');
  eq(gt.pending, 0, 'and sent');

  // a lap the server refuses is dropped, a busy server keeps it
  answer = { status: 400, body: { error: 'time too short' } };
  await gt.submit(post(88));
  eq(gt.pending, 0, 'a refused lap is dropped, not retried');
  eq(gt.status.error, 'time too short', 'with the reason kept for the screen');
  answer = { status: 429, body: { error: 'too many laps, try again later' } };
  await gt.submit(post(88.5));
  eq(gt.pending, 1, 'a rate limited lap waits');

  // the queue survives a reload, and a full queue keeps the fastest lap
  const gt2 = createGlobalTimes({ fetchFn, storage, now: () => clock, getBase: () => '' });
  eq(gt2.pending, 1, 'the waiting lap is still there after a reload');
  for (let i = 0; i < QUEUE_MAX + 5; i++) gt2.submit(post(95 + i));
  eq(gt2.pending, QUEUE_MAX, 'the queue is capped');
  const q = JSON.parse(store.get(QUEUE_KEY));
  check(q.some(p => p.time === 88.5), 'the fastest waiting lap is kept when the queue is full');
  check(!gt2.available(), 'no relay address: not available');
  eq(await gt2.flush(), false, 'and nothing is sent');

  // reading a board and a ghost
  answer = (url) => ({ status: 200, body: url.includes('/ghost') ? { name: 'Harry', time: 90.1, ghost: 'AAAAAAAAAAAAAAAAAAAAAA==' } : { board: 'dry-solo-fwd-on', entries: [], you: null } });
  calls = [];
  await gt.top(board, 'Harry P', 20);
  eq(calls[0].url, 'https://relay.example/times?board=dry-solo-fwd-on&n=20&name=Harry%20P', 'board query');
  const g = await gt.ghost(board, 'Harry');
  eq(calls[1].url, 'https://relay.example/ghost?board=dry-solo-fwd-on&name=Harry', 'ghost query');
  eq(g.name, 'Harry', 'ghost answer');
  down = true;
  eq(await gt.top(board, 'Harry'), null, 'an unreachable server gives null, not an error');
}

// ---- the lap watcher over simulated laps ----
function watchTests() {
  // a stand-in timer: lapStart, lap history, reverse; laps of exactly 90 s from t = 10 (the out lap is 0 to 10)
  const timer = { lapStart: null, history: [], reverse: false };
  const cond = { weather: 'clear', online: false, reverse: false, assists: { tc: true, abs: true, esc: true } };
  let auto = false;
  const w = new LapWatch({ timer, build: 'test', getName: () => 'Harry', isAutopilot: () => auto, getConditions: () => cond });
  const posts = [];
  const car = { x: 0, z: 0, heading: 0 };
  const drive = (from, to, lapOpts = {}) => {
    for (let t = from; t < to; t += 1 / 120) {
      // the line is crossed at 10, 100, 190, ...
      if (t >= 10 && timer.lapStart === null) timer.lapStart = 10;
      else if (timer.lapStart !== null && t - timer.lapStart >= 90) {
        timer.history.push({ lap: timer.history.length + 1, time: 90, sectors: [35, 32, 23], valid: lapOpts.valid !== false, clean: lapOpts.clean !== false });
        timer.lapStart += 90;
      }
      if (lapOpts.onTick) lapOpts.onTick(t);
      car.x = (t * 40) % 3835; car.z = 0;
      const p = w.step(t, car);
      if (p) posts.push(p);
    }
  };
  drive(0, 100.5);   // out lap, then lap 1 ends at 100
  eq(posts.length, 1, 'the out lap is not posted, lap 1 is');
  eq(posts[0].board, { weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'on' }, 'lap 1 on dry solo normal assists');
  check(!!posts[0].ghost && decodeTrace(posts[0].ghost).length / 4 >= 900, 'lap 1 carries its ghost line');
  eq(posts[0].sectors, [35, 32, 23], 'with its sectors');

  // lap 2: rain starts half way: a wet lap; the assists go off half way: still an assisted lap
  drive(100.5, 190.5, { onTick: t => { if (t > 140) { cond.weather = 'lightrain'; cond.assists = { tc: false, abs: false, esc: false }; } } });
  eq(posts.length, 2, 'lap 2 posted');
  eq(posts[1].board, { weather: 'wet', mode: 'solo', dir: 'fwd', assists: 'on' }, 'partly wet is wet, partly assisted is assisted');

  // lap 3: dry again, all off: the autopilot drives for a moment: not posted
  cond.weather = 'clear';
  drive(190.5, 280.5, { onTick: t => { auto = t > 200 && t < 201; } });
  eq(posts.length, 2, 'an autopilot moment keeps the lap off the boards');
  // lap 4: a track limit warning, lap 5: a reset
  drive(280.5, 370.5, { valid: false });
  drive(370.5, 460.5, { clean: false });
  eq(posts.length, 2, 'an invalid lap and a lap with a reset are not posted');
  // lap 6: clean, dry, all assists off
  drive(460.5, 550.5);
  eq(posts.length, 3, 'lap 6 posted');
  eq(posts[2].board, { weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'off' }, 'dry, assists all off');

  // the session restarts: no stale lap is posted
  timer.lapStart = null; timer.history = [];
  drive(0, 50);
  eq(posts.length, 3, 'a restart posts nothing');
}

await queueTests();
watchTests();

// ---- end to end against the local relay (worker/dev-relay.mjs), when its /times routes exist ----
try {
  const { startRelay } = await import('../worker/dev-relay.mjs');
  const relay = await startRelay({ port: 0 });
  const port = relay.port ?? relay.address?.().port;
  const base = `http://localhost:${port}`;
  const probe = await fetch(base + '/times?board=dry-solo-fwd-on').catch(() => null);
  if (probe && probe.status === 200) {
    const gt = createGlobalTimes({ getBase: () => base, fetchFn: (u, i = {}) => fetch(u, { ...i, headers: { ...(i.headers || {}), Origin: 'http://localhost' } }) });
    const timer = { lapStart: null, history: [], reverse: false };
    const w = new LapWatch({ timer, build: 'e2e', getName: () => 'Ghosty', isAutopilot: () => false, getConditions: () => ({ weather: 'clear', online: false, reverse: false, assists: {} }) });
    // a believable lap: 3835 m round a circle in 92 s
    const R = 3835 / (2 * Math.PI), car = { x: R, z: 0, heading: Math.PI / 2 };
    let post = null;
    for (let t = 0; t < 102.5 && !post; t += 1 / 120) {
      if (t >= 10 && timer.lapStart === null) timer.lapStart = 10;
      if (timer.lapStart !== null && t - timer.lapStart >= 92) { timer.history.push({ lap: 1, time: 92, sectors: [35, 33, 24], valid: true, clean: true }); timer.lapStart += 92; }
      const a = timer.lapStart === null ? 0 : ((t - timer.lapStart) / 92) * 2 * Math.PI;
      car.x = R * Math.cos(a); car.z = R * Math.sin(a); car.heading = a + Math.PI / 2;
      post = w.step(t, car);
    }
    check(!!post, 'e2e: the simulated lap qualifies');
    check(await gt.submit(post), 'e2e: posted to the local relay');
    const top = await gt.top({ weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'off' }, 'Ghosty');
    check(top && top.entries.some(e => e.name === 'Ghosty' && Math.abs(e.time - 92) < 1e-6 && e.ghost), 'e2e: on the board, with a ghost');
    const g = await gt.ghost({ weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'off' }, 'Ghosty');
    check(g && decodeTrace(g.ghost) && decodeTrace(g.ghost).length / 4 >= 900, 'e2e: the ghost comes back whole');
    console.log('  end to end against dev-relay.mjs: done');
  } else console.log('  end to end skipped: dev-relay.mjs has no /times yet');
  await (relay.close ? relay.close() : relay.stop?.());
} catch (e) { console.log('  end to end skipped: ' + e.message); }

console.log(`global times (game side): ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
