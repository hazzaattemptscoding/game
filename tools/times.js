// Global times tests: the rules (worker/src/times.js), the SQL store and the Durable Object's body reader and request path
// (worker/src/times-do.js, run on node:sqlite when this Node has it), and an end to end run of dev-relay.mjs over HTTP.
// Ghosts here are laps round the relay's own track (worker/src/track-data.js); tools/globaltimes.js checks that track
// against the game's, and drives a real autopilot lap through the same rules.
import * as T from '../worker/src/times.js';
import { SqlTimesStore, Times, readCapped } from '../worker/src/times-do.js';
import { startRelay } from '../worker/dev-relay.mjs';
import { TRACK } from '../worker/src/track-data.js';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} within ${tol}`);

// The centreline as a walkable closed polyline: at(s) is the point, direction and left normal at s metres along the lap.
const LINE = (() => {
  const P = TRACK.line, n = P.length / 2, cum = [0];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum.push(cum[i] + Math.hypot(P[j * 2] - P[i * 2], P[j * 2 + 1] - P[i * 2 + 1])); }
  const total = cum[n];
  const at = s => {
    s = ((s % total) + total) % total;
    let i = 0;
    while (cum[i + 1] < s) i++;
    const j = (i + 1) % n, f = (s - cum[i]) / (cum[i + 1] - cum[i]);
    const dx = P[j * 2] - P[i * 2], dz = P[j * 2 + 1] - P[i * 2 + 1], m = Math.hypot(dx, dz);
    return { x: P[i * 2] + dx * f, z: P[i * 2 + 1] + dz * f, hx: dx / m, hz: dz / m };
  };
  const arcOf = ([px, pz]) => {   // arc length of the vertex nearest to a point
    let best = Infinity, arc = 0;
    for (let i = 0; i < n; i++) { const d = Math.hypot(P[i * 2] - px, P[i * 2 + 1] - pz); if (d < best) { best = d; arc = cum[i]; } }
    return arc;
  };
  return { total, at, arcOf };
})();

// A ghost that drives the lap round the centreline in `time` s, `hz` samples a second. span: the share of the lap driven (2 = twice
// round). offset(s): a sideways shift in metres at s metres along the lap (+ to the left). mutate(a, n): change the float32 array.
function ghostArray(time, { hz = 10, span = 1, offset, mutate } = {}) {
  const count = Math.round(time * hz) + 1, a = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) {
    const t = Math.min(time, k / hz), s = span * LINE.total * t / time, p = LINE.at(s), o = offset ? offset(s) : 0;
    a.set([t, p.x - p.hz * o, p.z + p.hx * o, Math.atan2(p.hz, p.hx)], k * 4);
  }
  if (mutate) mutate(a, count);
  return a;
}
// A straight stretch of the lap where a line can leave the track: 120 m out, the point is at least 100 m from the centreline and
// the lap is straight for 80 m either side, so the excursion below is not refused for its speed at a corner.
const EXCURSION = (() => {
  for (let s0 = 300; s0 < LINE.total - 300; s0 += 25) {
    const p = LINE.at(s0), q = { x: p.x - p.hz * 120, z: p.z + p.hx * 120 };
    const before = LINE.at(s0 - 80), after = LINE.at(s0 + 80);
    if (T.distToLine(q.x, q.z) >= 100 && p.hx * before.hx + p.hz * before.hz > 0.999 && p.hx * after.hx + p.hz * after.hz > 0.999) return s0;
  }
  throw new Error('no straight stretch for the excursion test');
})();
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const ghost = (time, o) => b64(ghostArray(time, o));
const board = { weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'on' };
const BK = 'dry-solo-fwd-on';
const TOKEN = '0123456789abcdef0123456789abcdef', TOKEN2 = 'fedcba9876543210fedcba9876543210';
const HASH_A = 'a'.repeat(64), HASH_B = 'b'.repeat(64), HASH_C = 'c'.repeat(64), HASH_D = 'd'.repeat(64);
const lap = (o = {}) => { const time = o.time ?? 100; return { name: 'Harry', time, sectors: [30, 30, time - 60], board, build: 'v1', token: TOKEN, ghost: ghost(time), ...o }; };

// ---- names ----
eq(T.cleanDriverName('  Harry  '), 'Harry', 'name is trimmed');
eq(T.cleanDriverName('a \t\n b'), 'a b', 'whitespace collapses to one space');
eq(T.cleanDriverName('Ha\u0000r\u0007ry'), 'Harry', 'control characters are removed');
eq(T.cleanDriverName('Zoë Mül-Å_2.0'), 'Zoë Mül-Å_2.0', 'letters, digits and . _ - allowed');
eq(T.cleanDriverName('山田 太郎'), '山田 太郎', 'other scripts allowed');
eq(T.cleanDriverName('a'.repeat(16)), 'a'.repeat(16), '16 characters allowed');
eq(T.cleanDriverName('a'.repeat(17)), null, '17 characters refused');
for (const bad of ['', '   ', '\u0000', 'a<b', 'a/b', 'a@b', 'a!', '😀', 'a,b', 5, null, undefined, {}]) eq(T.cleanDriverName(bad), null, 'name refused: ' + JSON.stringify(bad));
eq(T.driverKey('HaRRy'), 'harry', 'driver key is lowercase');

// ---- boards ----
eq(T.BOARDS.length, 48, '16 boards for each of the three car classes');
check(new Set(T.BOARDS).size === 48 && T.BOARDS.includes(BK) && T.BOARDS.includes('wet-online-rev-off') && T.BOARDS.includes('wet-online-rev-off-city'), 'board keys (the GT keeps the old names)');
eq(T.boardKey({ ...board, car: 'CITY' }), BK + '-city', 'a 108 board has the car on the end');
eq(T.boardKey({ ...board, car: 'XX' }), null, 'an unknown car is no board');
eq(T.boardKey(board), BK, 'board key from fields');
for (const bad of [{ ...board, weather: 'snow' }, { ...board, mode: 'x' }, { ...board, dir: 'up' }, { ...board, assists: 'maybe' }, { weather: 'dry' }, null, BK]) eq(T.boardKey(bad), null, 'bad board ' + JSON.stringify(bad));

// ---- the track the ghosts are checked against ----
{
  near(T.LAP_LENGTH, 3834.96, 0.01, 'lap length from the track constant');
  near(LINE.total, T.LAP_LENGTH, 10, 'the line adds up to the lap length (chords are a little shorter)');
  near(T.LAP_MIN_TIME, 72.36, 0.05, 'the shortest lap is LAP_LENGTH / 53 m/s');
  near(T.distToLine(TRACK.start[0], TRACK.start[1]), 0, 1e-9, 'a point on the line is 0 m away');
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  near(T.distToLine(5, -3, square), 3, 1e-9, 'a point 3 m off the bottom edge is 3 m away');
  near(T.distToLine(5, 5, square), 5, 1e-9, 'the middle of a 10 m square is 5 m from its edges');
  near(T.distToLine(13, 14, square), 5, 1e-9, 'a corner is nearest, 5 m away');
}

// ---- lap validation ----
const err = (o, re, msg) => { const r = T.validateLap(o); check(r.error && re.test(r.error), `${msg}: ${JSON.stringify(r).slice(0, 120)}`); };
check(!T.validateLap(lap()).error, 'a plain lap is valid');
check(!T.validateLap({ ...lap(), build: undefined }).error, 'build is optional');
err(lap({ build: 'x'.repeat(41) }), /build/, 'build over 40 chars');
check(!T.validateLap(lap({ build: 'x'.repeat(40) })).error, 'build of 40 chars ok');
err(lap({ build: 5 }), /build/, 'build must be a string');
err(lap({ name: '' }), /name/, 'empty name');
err(lap({ board: { ...board, weather: 'fog' } }), /board/, 'bad board');
err(lap({ time: 59.9, sectors: [20, 20, 19.9] }), /time/, 'time under 60');
err(lap({ time: 900.1, sectors: [300, 300, 300.1] }), /time/, 'time over 900');
err(lap({ time: '100' }), /time/, 'time as string');
err(lap({ time: NaN }), /time/, 'NaN time');
err(lap({ time: 60, sectors: [20, 20, 20] }), /too fast/, 'a 60 s lap is too fast for this lap');
err(lap({ time: 60, sectors: [20, 20, 20], ghost: undefined }), /too fast/, 'a 60 s lap with no ghost is refused (the time goes first)');
err(lap({ time: 72, sectors: [24, 24, 24] }), /too fast/, 'a 72 s lap is too fast');
check(!T.validateLap(lap({ time: 73, sectors: [24, 24, 25] })).error, 'a 73 s lap is possible');
check(!T.validateLap(lap({ time: 900, sectors: [300, 300, 300], ghost: ghost(900) })).error, 'a 900 s lap with its ghost is ok');
err(lap({ sectors: [30, 30] }), /sectors/, 'two sectors');
err(lap({ sectors: [30, 30, 40, 0] }), /sectors/, 'four sectors');
err(lap({ sectors: [30, '30', 40] }), /sectors/, 'string sector');
err(lap({ time: 100, sectors: [4.9, 50, 45.1] }), /at least/, 'sector under 5 s');
check(!T.validateLap(lap({ time: 100, sectors: [5, 50, 45] })).error, 'sector of exactly 5 s ok');
err(lap({ time: 100, sectors: [30, 30, 40.06] }), /add up/, 'sum off by 0.06');
check(!T.validateLap(lap({ time: 100, sectors: [30, 30, 40.04] })).error, 'sum off by 0.04 ok');
err(lap({ token: undefined }), /token/, 'no token');
err(lap({ token: TOKEN.toUpperCase() }), /token/, 'a token in capitals');
err(lap({ token: 'abc' }), /token/, 'a short token');
err(lap({ token: 5 }), /token/, 'a token that is not a string');
eq(T.validateLap(lap()).token, TOKEN, 'the validated lap carries the token');
err(lap({ ghost: undefined }), /ghost is required/, 'a lap with no ghost is refused');
err(lap({ ghost: null }), /ghost is required/, 'a lap with a null ghost is refused');
err(lap({ ghost: 5 }), /ghost must be a string/, 'ghost not a string');
err([], /object/, 'array body');
err(null, /object/, 'null body');
{
  const r = T.validateLap(lap({ name: ' HARRY ' }));
  eq([r.name, r.key, r.board], ['HARRY', 'harry', BK], 'validated lap carries name, key, board');
}

// ---- ghost decode ----
{
  const a = new Float32Array([1.5, 2.5, -3.5, 0.25, 4, 5, 6, 7]);
  eq(Array.from(T.decodeGhost(b64(a))), Array.from(a), 'ghost decodes little-endian float32');
  eq(T.decodeGhost('abc'), null, 'bad base64 length');
  eq(T.decodeGhost('@@@@'), null, 'bad base64 characters');
  eq(T.decodeGhost(Buffer.alloc(20).toString('base64')), null, '5 floats is not a whole number of samples');
  eq(T.decodeGhost(Buffer.alloc(48).toString('base64'))?.length, 12, '3 samples decode');
  eq(T.decodeGhost(5), null, 'not a string');
}

// ---- ghost checks: the lap, its time, its speed, its path, the track and the line ----
{
  const p = (g, time = 100) => T.ghostProblem(g, time);
  eq(p(ghost(100)), null, 'a ghost that drives the lap passes');
  eq(p(ghost(100, { hz: 8 })), null, '8 samples per second passes');
  eq(p(ghost(100, { hz: 12 })), null, '12 samples per second passes');
  check(/samples/.test(p(ghost(100, { hz: 7 }))), 'too few samples');
  check(/samples/.test(p(ghost(100, { hz: 13 }))), 'too many samples');
  check(/whole/.test(p(Buffer.alloc(20).toString('base64'))), 'not whole samples');
  check(/start/.test(p(ghost(100, { mutate: a => { for (let i = 0; i < a.length; i += 4) a[i] += 0.6; } }))), 'start more than 0.5 s late');
  eq(p(ghost(100, { mutate: a => { for (let i = 0; i < a.length; i += 4) a[i] = 0.4 + a[i] * 0.996; } })), null, 'start 0.4 s late passes');
  check(/end/.test(p(ghost(100), 102)), 'a posted time 2 s past the last sample');
  check(/end/.test(p(ghost(100), 100.2)), 'a posted time 0.2 s past the last sample (tolerance 0.05 s)');
  eq(p(ghost(100), 100.04), null, 'a posted time 0.04 s past the last sample passes');
  check(/increase/.test(p(ghost(100, { mutate: a => { a[40 * 4] = a[39 * 4]; } }))), 'equal times refused');
  check(/increase/.test(p(ghost(100, { mutate: a => { a[40 * 4] = a[38 * 4]; } }))), 'times going back refused');
  check(/fast/.test(p(ghost(100, { mutate: a => { a[50 * 4 + 1] += 13; } }))), 'a 130 m/s step refused');
  check(/fast/.test(p(ghost(100, { mutate: a => { a[50 * 4 + 2] += 1000; } }))), 'a teleport refused');
  check(/short/.test(p(ghost(100, { span: 0.8 }))), 'a path under 90% of the lap refused');
  check(/fast/.test(p(ghost(80, { span: 2 }), 80)), 'two laps in 80 s (96 m/s on average) refused');
  check(/fast/.test(p(ghost(72, { span: 1.2 }), 72)), 'a path of 1.2 laps in 72 s refused on average speed');
  // the peak speed of a step, per class: a quick car's lap cannot be posted as a 108 whatever its (slow) average, since the class comes from the poster
  const spike = m => ghost(135, { mutate: a => { a[50 * 4 + 1] += m; } });   // one step 10 samples a second: m metres extra is 10 m m/s extra
  eq(T.ghostProblem(ghost(135), 135, 'CITY'), null, 'a slow even ghost passes as a 108');
  check(/this car/.test(T.ghostProblem(spike(2), 135, 'CITY') || ''), 'a ghost with a 60 m/s step is refused as a 108');
  eq(T.ghostProblem(spike(2), 135, 'GT'), null, 'the same ghost passes as a GT (its peak is far under the GT cap)');
  eq(T.ghostProblem(spike(2), 135, 'GT1'), null, 'and as a GT1');
  check(/this car/.test(T.ghostProblem(spike(7), 135, 'GT') || ''), 'a GT ghost with a 100 m/s step is refused');
  check(T.carPeakSpeed('CITY') === 45 && T.carPeakSpeed('GT') > 68 && T.carPeakSpeed('GT1') > 74, 'the caps sit above the real peaks (GT 68, GT1 74, 108 about 40)');
  // a line that leaves the track for a stretch: 120 m out at the middle of a straight, back on the centreline either side
  const excursion = s => { const d = Math.abs(s - EXCURSION); return d < 75 ? 120 * (1 - d / 75) : 0; };
  check(/track/.test(p(ghost(100, { offset: excursion }))), 'a line 120 m off the track refused');
  eq(p(ghost(100, { offset: () => 5 })), null, 'a line 5 m off the centreline passes (a racing line)');
  check(/start\/finish/.test(p(ghost(92, { span: 0.92 }), 92)), 'a lap that does not come back to the line refused');
  check(/sector/.test(p(ghost(100, { offset: s => 40 * Math.max(0, 1 - Math.abs(s - LINE.arcOf(TRACK.sectors[0])) / 100) }))), 'a line that goes 40 m wide of sector 2 refused');
  check(/number/.test(p(ghost(100, { mutate: a => { a[7] = NaN; } }))), 'NaN refused');
  err(lap({ ghost: ghost(100, { span: 0.8 }) }), /short/, 'a bad ghost rejects the whole lap');
}

// ---- rate limiter with a fake clock ----
{
  const rl = new T.RateLimiter(20, 600000);
  let ok = 0;
  for (let i = 0; i < 25; i++) if (rl.allow('1.1.1.1', 1000 + i)) ok++;
  eq(ok, 20, '20 allowed, the rest refused');
  check(rl.allow('2.2.2.2', 1100), 'another IP has its own allowance');
  check(!rl.allow('1.1.1.1', 1000 + 599999), 'still refused just inside the window');
  check(rl.allow('1.1.1.1', 1000 + 600000), 'allowed again when the first hit leaves the window');
  let again = 0;
  for (let i = 0; i < 25; i++) if (rl.allow('3.3.3.3', 2000000 + i * 1000)) again++;
  eq(again, 20, 'a new window gives 20 again');
  const rl2 = new T.RateLimiter(2, 1000);
  rl2.allow('a', 0); rl2.allow('b', 0);
  rl2.allow('c', 5000);
  eq(rl2.hits.size, 1, 'quiet clients are forgotten');
}

// ---- the model: best per driver, ranks, ties, you, ghost pruning, names and their owners ----
function modelTests(makeStore, label) {
  const n = s => `${label}: ${s}`;
  const m = new T.TimesModel(makeStore());
  const post = (o, now, tokenHash = HASH_A) => { const l = T.validateLap(o); if (l.error) throw new Error(l.error); return m.submit({ ...l, tokenHash }, now); };
  let r = post(lap({ name: 'Harry', time: 100 }), 1000);
  eq([r.ok, r.improved, r.rank, r.best, r.entries], [true, true, 1, 100, 1], n('first lap'));
  r = post(lap({ name: 'harry', time: 101, sectors: [31, 30, 40] }), 2000);
  eq([r.improved, r.rank, r.best, r.entries], [false, 1, 100, 1], n('a slower lap does not change the row'));
  eq(m.list(BK, 20).entries[0].at, 1000, n('slower lap keeps the old timestamp'));
  eq(m.list(BK, 20).entries[0].name, 'harry', n('latest spelling is shown'));
  r = post(lap({ name: 'Harry', time: 100 }), 3000);
  eq([r.improved, r.best], [false, 100], n('an equal lap is not an improvement'));
  r = post(lap({ name: 'HARRY', time: 99.5, sectors: [29.5, 30, 40] }), 4000);
  eq([r.improved, r.best, r.entries], [true, 99.5, 1], n('a faster lap replaces the row'));
  eq(m.list(BK, 20).entries[0], { rank: 1, name: 'HARRY', time: 99.5, sectors: [29.5, 30, 40], at: 4000, ghost: true }, n('row shape'));
  r = post(lap({ name: 'Harry', time: 120, board: { ...board, weather: 'wet' } }), 5000);
  eq([r.improved, r.rank, r.entries], [true, 1, 1], n('another board is separate'));
  eq(m.list(BK, 20).entries.length, 1, n('first board unchanged'));
  // ranks and ties: Bob sets 98 first, Cy ties 98 later, Dee 98.5
  post(lap({ name: 'Bob', time: 98, sectors: [28, 30, 40] }), 6000, HASH_B);
  r = post(lap({ name: 'Cy', time: 98, sectors: [28, 30, 40] }), 7000, HASH_C);
  eq([r.rank, r.entries], [2, 3], n('a tie ranks behind the earlier lap'));
  r = post(lap({ name: 'Dee', time: 98.5, sectors: [28.5, 30, 40] }), 8000, HASH_D);
  eq(r.rank, 3, n('Dee third'));
  eq(m.list(BK, 20).entries.map(e => [e.rank, e.name]), [[1, 'Bob'], [2, 'Cy'], [3, 'Dee'], [4, 'HARRY']], n('order by time then earlier at'));
  r = post(lap({ name: 'Dee', time: 90, sectors: [20, 30, 40] }), 9000, HASH_D);
  eq([r.improved, r.rank], [true, 1], n('improving moves up'));
  eq(m.list(BK, 20).entries.map(e => e.name), ['Dee', 'Bob', 'Cy', 'HARRY'], n('order after Dee improves'));
  const l = m.list(BK, 2, 'harry');
  eq([l.entries.length, l.you?.rank, l.you?.name, l.you?.time], [2, 4, 'HARRY', 99.5], n('you is returned outside the top n, with the real rank'));
  eq(m.list(BK, 20, 'nobody').you, null, n('you is null for an unknown driver'));
  eq(m.list(BK, 20, '<<>>').you, null, n('you is null for a bad name'));
  eq(m.list(BK, 20).you, null, n('you is null without a name'));
  eq(m.list(BK, 20, 'dee').you?.rank, 1, n('you inside the top n'));
  eq(m.list(BK, 20).board, BK, n('list carries the board'));
  check(!JSON.stringify(m.list(BK, 20)).includes(HASH_D), n('the owner hash is never in a board'));

  // ghosts are kept for the top 10 only. Lap times are whole seconds so the generated ghost matches the time.
  const g = new T.TimesModel(makeStore());
  const post2 = (name, time, withGhost, now) => { const l = T.validateLap(lap({ name, time, sectors: [time - 40, 20, 20], ghost: withGhost ? ghost(time) : undefined })); if (l.error) throw new Error(l.error); return g.submit({ ...l, tokenHash: HASH_A }, now); };
  for (let i = 0; i < 12; i++) post2('D' + i, 100 + i, true, 1000 + i);
  const withGhost = () => g.list(BK, 100).entries.filter(e => e.ghost).map(e => e.name);
  eq(withGhost(), ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], n('only the top 10 keep a ghost'));
  eq(g.ghost(BK, 'd10'), null, n('no ghost for rank 11'));
  check(g.ghost(BK, 'd0')?.ghost === ghost(100) && g.ghost(BK, 'D0').time === 100 && g.ghost(BK, 'D0').name === 'D0', n('ghost is returned with name and time'));
  post2('D11', 95, true, 5000);   // D11 improves to first, so D9 drops to 11th and loses its ghost
  eq(withGhost(), ['D11', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'], n('a new top 10 row pushes the 10th out of ghosts'));
  eq(g.ghost(BK, 'D9'), null, n('the pushed out ghost is gone'));
  // D10 has a faster lap but no line for it: refused, so its row stays as it was
  check(!!T.validateLap(lap({ name: 'D10', time: 96, sectors: [56, 20, 20], ghost: undefined })).error, n('a lap with no line is refused'));
  eq(g.list(BK, 100).entries.find(e => e.name === 'D10').time, 110, n('and the driver keeps the row'));
  post2('Slow', 500, true, 7000);   // lands outside the top 10: its ghost is not kept
  eq(g.ghost(BK, 'slow'), null, n('a lap outside the top 10 keeps no ghost'));
  eq(g.list(BK, 100).entries.at(-1).name, 'Slow', n('but the row is there'));

  // names and their owners: the first token to post a name owns it on every board, in any case
  const o = new T.TimesModel(makeStore());
  const sub = (name, time, h, b = board) => o.submit({ ...T.validateLap(lap({ name, time, sectors: [time - 40, 20, 20], board: b })), tokenHash: h }, 1000);
  eq(sub('Owner', 100, HASH_A).ok, true, n('a new name is taken by its first token'));
  eq(sub('owner', 90, HASH_B), { ok: false, error: 'that name belongs to another driver' }, n('another token under the same name, any case, is refused'));
  eq(o.list(BK, 20).entries.map(e => e.time), [100], n('and the refused lap is not on the board'));
  eq(sub('OWNER', 95, HASH_A).ok, true, n('the first token still posts under the name'));
  eq(o.list(BK, 20).entries[0].time, 95, n('and improves'));
  eq(sub('Owner', 110, HASH_B, { ...board, weather: 'wet' }).ok, false, n('the name is owned on every board'));
  eq(sub('Owner', 110, HASH_A, { ...board, weather: 'wet' }).ok, true, n('the owner posts on another board'));
  // a name from before tokens (a row with no owner) is claimed by the first poster
  const s = makeStore();
  s.put(BK, { key: 'old', name: 'Old', time: 100, sectors: [30, 30, 40], at: 1, ghost: null });
  const om = new T.TimesModel(s);
  eq(om.submit({ ...T.validateLap(lap({ name: 'Old', time: 120 })), tokenHash: HASH_C }, 2).ok, true, n('a row from before tokens is claimed by the first poster'));
  eq(om.submit({ ...T.validateLap(lap({ name: 'Old', time: 110 })), tokenHash: HASH_D }, 3).ok, false, n('then only that token posts under it'));
}
modelTests(() => new T.MemoryTimesStore(), 'memory');
let sqlTested = false;
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (e) { if (e?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') { fails++; console.log('  exception loading node:sqlite', e); } else console.log('  (node:sqlite not available, the SQL store was not tested)'); }
// the storage's synchronous exec API (ctx.storage.sql), on node:sqlite
const sqlApi = () => { const db = new DatabaseSync(':memory:'); return { exec: (q, ...a) => ({ toArray: () => db.prepare(q).all(...a) }) }; };
if (DatabaseSync) { modelTests(() => new SqlTimesStore(sqlApi()), 'sqlite'); sqlTested = true; }

// ---- the request logic ----
{
  const model = new T.TimesModel(new T.MemoryTimesStore()), limiter = new T.RateLimiter(1000);
  const run = (method, route, query = '', bodyText, now = 1000) => T.handleTimes(model, limiter, { method, route, params: new URLSearchParams(query), bodyText, ip: '9.9.9.9', now });
  {
    const r = await run('GET', 'times', 'board=dry-solo-fwd-on&n=1');
    check(JSON.stringify(r.json.cars) === JSON.stringify(T.CAR_IDS), 'a board answer lists the car classes the worker knows');
    const e = await run('GET', 'times', 'board=nope');
    check(e.status === 400 && !('cars' in e.json), 'an error answer carries no list');
  }
  eq((await run('POST', 'times', '', 'nope')).status, 400, 'bad JSON is 400');
  eq((await run('POST', 'times', '', JSON.stringify(lap({ time: 5 })))).status, 400, 'a validation failure is 400');
  eq((await run('POST', 'times', '', JSON.stringify(lap({ token: undefined })))).status, 400, 'a lap with no token is 400');
  eq((await run('POST', 'times', '', 'x'.repeat(T.MAX_BODY + 1))).status, 413, 'a body over 64 KB is 413');
  eq((await run('POST', 'times', '', null)).json, { error: 'body too large' }, 'a body cut off before it was read is 413');
  eq((await run('POST', 'times', '', JSON.stringify(lap()))).json.ok, true, 'a good POST is 200');
  eq((await run('GET', 'times', 'board=nope')).status, 400, 'a bad board key on GET /times is 400');
  eq((await run('GET', 'ghost', 'board=nope&name=x')).status, 400, 'a bad board key on GET /ghost is 400');
  eq((await run('GET', 'ghost', `board=${BK}&name=Harry`)).status, 200, 'the ghost of a row that has one is 200');
  eq((await run('GET', 'ghost', `board=${BK}&name=Nobody`)).status, 404, 'no ghost is 404');
  eq((await run('GET', 'times', `board=${BK}&n=0`)).json.entries.length, 1, 'n is at least 1');
  eq((await run('PUT', 'times', '')).status, 405, 'other methods are 405');
  for (let i = 0; i < 30; i++) model.store.put(BK, { key: 'p' + i, name: 'p' + i, time: 200 + i, sectors: [60, 60, 80 + i], at: i, ghost: null });
  eq((await run('GET', 'times', `board=${BK}`)).json.entries.length, T.DEFAULT_N, 'default n is 20');
  eq((await run('GET', 'times', `board=${BK}&n=abc`)).json.entries.length, T.DEFAULT_N, 'a bad n falls back to 20');
  for (let i = 0; i < 100; i++) model.store.put(BK, { key: 'q' + i, name: 'q' + i, time: 300 + i, sectors: [100, 100, 100 + i], at: i, ghost: null });
  eq((await run('GET', 'times', `board=${BK}&n=500`)).json.entries.length, T.MAX_N, 'n is capped at 100');
}

// ---- the body reader and the Durable Object's request path (times-do.js) ----
{
  const enc = new TextEncoder();
  const stream = (...parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
  eq(await readCapped(stream('ab', 'cd'), 10), 'abcd', 'a small chunked body is read whole');
  eq(await readCapped(stream('a'.repeat(6), 'b'.repeat(6)), 10), null, 'a chunked body over the cap is null');
  eq(await readCapped(undefined, 10), '', 'no body is empty');
  const endless = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); } });
  eq(await readCapped(endless, 4096), null, 'an endless body is cut off at the cap');
  if (DatabaseSync) {
    const times = new Times({ storage: { sql: sqlApi() } });
    const req = (body, method = 'POST') => new Request('http://x/times', { method, body, duplex: 'half', headers: { 'Content-Type': 'application/json' } });
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(16 * 1024).fill(32)); c.close(); } });
    const r413 = await times.fetch(req(big));
    eq([r413.status, await r413.json()], [413, { error: 'body too large' }], 'the Durable Object answers 413 to a chunked body over the cap');
    const r200 = await times.fetch(req(stream(JSON.stringify(lap({ name: 'Chunky' })).slice(0, 300), JSON.stringify(lap({ name: 'Chunky' })).slice(300))));
    eq((await r200.json()).ok, true, 'a chunked lap in two pieces is accepted');
    const r403 = await times.fetch(req(JSON.stringify(lap({ name: 'chunky', token: TOKEN2 }))));
    eq([r403.status, (await r403.json()).error], [403, 'that name belongs to another driver'], 'the Durable Object refuses a second token under the name');
  }
}

// ---- end to end over HTTP ----
const relay = await startRelay({ port: 0, allowed: 'http://ok.example' });
const base = `http://localhost:${relay.port}`, ORIGIN = { Origin: 'http://ok.example' };
const post = (body, headers = ORIGIN) => fetch(base + '/times', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
try {
  let r = await post(lap());
  let j = await r.json();
  eq([r.status, j], [200, { ok: true, improved: true, rank: 1, best: 100, entries: 1, cars: T.CAR_IDS }], 'POST /times');
  check(r.headers.get('access-control-allow-origin') === 'http://ok.example' && /Origin/.test(r.headers.get('vary')) && r.headers.get('cache-control') === 'no-store' && /json/.test(r.headers.get('content-type')), 'POST has CORS, Vary, no-store, JSON');
  r = await post(lap({ name: 'Ann', time: 99, sectors: [29, 30, 40], token: TOKEN2 }));
  eq((await r.json()).rank, 1, 'a faster driver ranks first');
  r = await fetch(`${base}/times?board=${BK}&n=1&name=Harry`, { headers: ORIGIN });
  j = await r.json();
  eq(r.status, 200, 'GET /times');
  eq([j.board, j.entries.length, j.entries[0].name, j.entries[0].ghost, j.you.name, j.you.rank, j.you.ghost, typeof j.you.at, j.you.sectors], [BK, 1, 'Ann', true, 'Harry', 2, true, 'number', [30, 30, 40]], 'entries, and you outside the top n');
  check(!JSON.stringify(j).includes(TOKEN) && !JSON.stringify(j).includes(TOKEN2), 'GET answers never hold a token');
  check(r.headers.get('access-control-allow-origin') === 'http://ok.example' && r.headers.get('cache-control') === 'no-store', 'GET has CORS and no-store');
  r = await fetch(`${base}/ghost?board=${BK}&name=harry`, { headers: ORIGIN });
  j = await r.json();
  eq([r.status, j.name, j.time, j.ghost === ghost(100)], [200, 'Harry', 100, true], 'GET /ghost');
  r = await fetch(`${base}/ghost?board=${BK}&name=Nobody`);
  eq([r.status, await r.json()], [404, { error: 'no ghost' }], 'GET /ghost without a ghost is 404');
  r = await fetch(`${base}/times?board=bad`);
  eq(r.status, 400, 'bad board on GET');
  r = await post('{"name":');
  eq([r.status, typeof (await r.json()).error], [400, 'string'], 'bad JSON over HTTP is 400 with an error');
  r = await post(lap({ ghost: ghost(100, { span: 0.8 }) }));
  eq(r.status, 400, 'a bad ghost over HTTP is 400');
  r = await post(lap({ time: 60, sectors: [20, 20, 20], ghost: undefined }));
  eq([r.status, (await r.json()).error.slice(0, 26)], [400, 'time is too fast for a lap'], 'a fake 60 s lap with no ghost is 400 over HTTP');
  r = await post('x'.repeat(T.MAX_BODY + 10));
  eq([r.status, (await r.json()).error], [413, 'body too large'], 'a body over 64 KB is 413');
  // a chunked body (no Content-Length) over the cap: the relay stops counting and answers 413
  const chunks = Array.from({ length: 6 }, () => new Uint8Array(16 * 1024).fill(32));
  const big = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
  r = await fetch(base + '/times', { method: 'POST', headers: { 'Content-Type': 'application/json', ...ORIGIN }, body: big, duplex: 'half' });
  eq([r.status, (await r.json()).error], [413, 'body too large'], 'an oversize chunked body gets 413');
  r = await fetch(base + '/times', { method: 'OPTIONS', headers: { ...ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  check(r.status === 204 && /GET/.test(r.headers.get('access-control-allow-methods')) && /POST/.test(r.headers.get('access-control-allow-methods')) && /Content-Type/i.test(r.headers.get('access-control-allow-headers')) && r.headers.get('access-control-allow-origin') === 'http://ok.example', 'OPTIONS preflight allows GET, POST and Content-Type');
  r = await post(lap(), { Origin: 'http://evil.example' });
  eq([r.status, await r.json()], [403, { error: 'origin not allowed' }], 'a disallowed Origin gets 403');
  check(!r.headers.get('access-control-allow-origin'), '403 does not echo the origin');
  r = await post(lap(), {});
  eq(r.status, 403, 'a POST without an Origin gets 403');

  // ownership over HTTP: the name belongs to the first token; the owner's later posts go through, another token gets 403
  r = await post(lap({ name: 'Owned', time: 105, token: TOKEN }));
  eq(r.status, 200, 'a new name is posted with its token');
  r = await post(lap({ name: 'owned', time: 104, token: TOKEN2 }));
  eq([r.status, await r.json()], [403, { error: 'that name belongs to another driver' }], 'a second token under the same name gets 403');
  r = await post(lap({ name: 'OWNED', time: 103, token: TOKEN }));
  eq([r.status, (await r.json()).improved], [200, true], 'the same token under the same name gets 200');

  // rate limit: 20 POSTs per 10 minutes per IP. Post until the first 429 and count what got through. (The limiter is reset here, so
  // the POSTs above do not count against it.)
  relay.times.limiter.hits.clear();
  const used = [...relay.times.limiter.hits.values()].reduce((a, x) => a + x.length, 0);
  let accepted = 0, limited = null;
  for (let i = 0; i < 30 && !limited; i++) { r = await post(lap({ name: 'Rate' + i })); if (r.status === 429) limited = await r.json(); else accepted++; }
  eq(limited, { error: 'too many laps, try again later' }, '429 body');
  eq(used + accepted, 20, '429 comes after exactly 20 POSTs from one IP');
  r = await fetch(`${base}/times?board=${BK}`, { headers: ORIGIN });
  check(r.status === 200, 'GET is not rate limited');
} catch (e) { fails++; console.log('  exception', e); }
relay.close();
console.log(fails ? `times: ${fails} FAILED, ${passes} passed` : `times: all ${passes} checks passed${sqlTested ? '' : ' (SQL store skipped)'}`);
process.exit(fails ? 1 : 0);
