// Global times tests: the rules (worker/src/times.js), the SQL store (worker/src/times-do.js, run on node:sqlite when this Node has it)
// and an end to end run of dev-relay.mjs over HTTP.
import * as T from '../worker/src/times.js';
import { SqlTimesStore } from '../worker/src/times-do.js';
import { startRelay } from '../worker/dev-relay.mjs';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// a ghost that drives a straight line of `length` m in `time` s at `hz` samples per second
function ghostArray(time, { length = 3835, hz = 10, mutate } = {}) {
  const n = Math.round(time * hz) + 1, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const t = Math.min(time, i / hz); a.set([t, length * t / time, 5, 0.5], i * 4); }
  if (mutate) mutate(a, n);
  return a;
}
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const ghost = (time, o) => b64(ghostArray(time, o));
const board = { weather: 'dry', mode: 'solo', dir: 'fwd', assists: 'on' };
const BK = 'dry-solo-fwd-on';
const lap = (o = {}) => { const time = o.time ?? 100; return { name: 'Harry', time, sectors: [30, 30, time - 60], board, build: 'v1', ...o }; };

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
eq(T.BOARDS.length, 16, '16 boards');
check(new Set(T.BOARDS).size === 16 && T.BOARDS.includes(BK) && T.BOARDS.includes('wet-online-rev-off'), 'board keys');
eq(T.boardKey(board), BK, 'board key from fields');
for (const bad of [{ ...board, weather: 'snow' }, { ...board, mode: 'x' }, { ...board, dir: 'up' }, { ...board, assists: 'maybe' }, { weather: 'dry' }, null, BK]) eq(T.boardKey(bad), null, 'bad board ' + JSON.stringify(bad));

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
check(!T.validateLap(lap({ time: 60, sectors: [20, 20, 20] })).error && !T.validateLap(lap({ time: 900, sectors: [300, 300, 300] })).error, 'time 60 and 900 ok');
err(lap({ time: '100' }), /time/, 'time as string');
err(lap({ time: NaN }), /time/, 'NaN time');
err(lap({ sectors: [30, 30] }), /sectors/, 'two sectors');
err(lap({ sectors: [30, 30, 40, 0] }), /sectors/, 'four sectors');
err(lap({ sectors: [30, '30', 40] }), /sectors/, 'string sector');
err(lap({ time: 100, sectors: [4.9, 50, 45.1] }), /at least/, 'sector under 5 s');
check(!T.validateLap(lap({ time: 100, sectors: [5, 50, 45] })).error, 'sector of exactly 5 s ok');
err(lap({ time: 100, sectors: [30, 30, 40.06] }), /add up/, 'sum off by 0.06');
check(!T.validateLap(lap({ time: 100, sectors: [30, 30, 40.04] })).error, 'sum off by 0.04 ok');
err([], /object/, 'array body');
err(null, /object/, 'null body');
{
  const r = T.validateLap(lap({ name: ' HARRY ' }));
  eq([r.name, r.key, r.board], ['HARRY', 'harry', BK], 'validated lap carries name, key, board');
}

// ---- ghost decode and checks ----
{
  const a = new Float32Array([1.5, 2.5, -3.5, 0.25, 4, 5, 6, 7]);
  eq(Array.from(T.decodeGhost(b64(a))), Array.from(a), 'ghost decodes little-endian float32');
  eq(T.decodeGhost('abc'), null, 'bad base64 length');
  eq(T.decodeGhost('@@@@'), null, 'bad base64 characters');
  eq(T.decodeGhost(Buffer.alloc(20).toString('base64')), null, '5 floats is not a whole number of samples');
  eq(T.decodeGhost(Buffer.alloc(48).toString('base64'))?.length, 12, '3 samples decode');
  eq(T.decodeGhost(5), null, 'not a string');
}
{
  const p = (g, time = 100) => T.ghostProblem(g, time);
  eq(p(ghost(100)), null, 'a good ghost passes');
  eq(p(ghost(100, { hz: 8 })), null, '8 samples per second passes');
  eq(p(ghost(100, { hz: 12 })), null, '12 samples per second passes');
  check(/samples/.test(p(ghost(100, { hz: 7 }))), 'too few samples');
  check(/samples/.test(p(ghost(100, { hz: 13 }))), 'too many samples');
  check(/whole/.test(p(Buffer.alloc(20).toString('base64'))), 'not whole samples');
  check(/start/.test(p(ghost(100, { mutate: a => { for (let i = 0; i < a.length; i += 4) a[i] += 0.6; } }))), 'start more than 0.5 s late');
  check(p(ghost(100, { mutate: a => { for (let i = 0; i < a.length; i += 4) a[i] = 0.4 + a[i] * 0.996; } })) === null, 'start 0.4 s late passes');
  check(/end/.test(p(ghost(100), 102)), 'last t more than 1 s from the lap time');
  check(/increase/.test(p(ghost(100, { mutate: a => { a[40 * 4] = a[39 * 4]; } }))), 'equal times refused');
  check(/increase/.test(p(ghost(100, { mutate: a => { a[40 * 4] = a[38 * 4]; } }))), 'times going back refused');
  check(/fast/.test(p(ghost(100, { mutate: a => { a[50 * 4 + 1] += 13; } }))), 'a 130 m/s step refused');
  check(/fast/.test(p(ghost(100, { mutate: a => { a[50 * 4 + 2] += 1000; } }))), 'a teleport refused');
  check(/short/.test(p(ghost(100, { length: 3300 }))), 'path under 3400 m refused');
  check(p(ghost(100, { length: 3450 })) === null, 'path of 3450 m passes');
  check(/number/.test(p(ghost(100, { mutate: a => { a[7] = NaN; } }))), 'NaN refused');
  check(/fast/.test(p(ghost(60, { length: 9000 }), 60)), 'a sustained 150 m/s refused');
  err(lap({ ghost: ghost(100, { length: 3000 }) }), /short/, 'a bad ghost rejects the whole lap');
  check(!T.validateLap(lap({ ghost: ghost(100) })).error, 'a good ghost is accepted with the lap');
  err(lap({ ghost: 5 }), /ghost/, 'ghost not a string');
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

// ---- the model: best per driver, ranks, ties, you, ghost pruning ----
function modelTests(makeStore, label) {
  const n = s => `${label}: ${s}`;
  const m = new T.TimesModel(makeStore());
  const post = (o, now) => { const l = T.validateLap(o); if (l.error) throw new Error(l.error); return m.submit(l, now); };
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
  eq(m.list(BK, 20).entries[0], { rank: 1, name: 'HARRY', time: 99.5, sectors: [29.5, 30, 40], at: 4000, ghost: false }, n('row shape'));
  r = post(lap({ name: 'Harry', time: 120, board: { ...board, weather: 'wet' } }), 5000);
  eq([r.improved, r.rank, r.entries], [true, 1, 1], n('another board is separate'));
  eq(m.list(BK, 20).entries.length, 1, n('first board unchanged'));
  // ranks and ties: Bob sets 98 first, Cy ties 98 later, Dee 98.5
  post(lap({ name: 'Bob', time: 98, sectors: [28, 30, 40] }), 6000);
  r = post(lap({ name: 'Cy', time: 98, sectors: [28, 30, 40] }), 7000);
  eq([r.rank, r.entries], [2, 3], n('a tie ranks behind the earlier lap'));
  r = post(lap({ name: 'Dee', time: 98.5, sectors: [28.5, 30, 40] }), 8000);
  eq(r.rank, 3, n('Dee third'));
  eq(m.list(BK, 20).entries.map(e => [e.rank, e.name]), [[1, 'Bob'], [2, 'Cy'], [3, 'Dee'], [4, 'HARRY']], n('order by time then earlier at'));
  r = post(lap({ name: 'Dee', time: 90, sectors: [20, 30, 40] }), 9000);
  eq([r.improved, r.rank], [true, 1], n('improving moves up'));
  eq(m.list(BK, 20).entries.map(e => e.name), ['Dee', 'Bob', 'Cy', 'HARRY'], n('order after Dee improves'));
  const l = m.list(BK, 2, 'harry');
  eq([l.entries.length, l.you?.rank, l.you?.name, l.you?.time], [2, 4, 'HARRY', 99.5], n('you is returned outside the top n, with the real rank'));
  eq(m.list(BK, 20, 'nobody').you, null, n('you is null for an unknown driver'));
  eq(m.list(BK, 20, '<<>>').you, null, n('you is null for a bad name'));
  eq(m.list(BK, 20).you, null, n('you is null without a name'));
  eq(m.list(BK, 20, 'dee').you?.rank, 1, n('you inside the top n'));
  eq(m.list(BK, 20).board, BK, n('list carries the board'));

  // ghosts are kept for the top 10 only. Lap times are whole seconds so the generated ghost matches the time.
  const g = new T.TimesModel(makeStore());
  const post2 = (name, time, withGhost, now) => { const l = T.validateLap(lap({ name, time, sectors: [time - 40, 20, 20], ghost: withGhost ? ghost(time) : undefined })); if (l.error) throw new Error(l.error); return g.submit(l, now); };
  for (let i = 0; i < 12; i++) post2('D' + i, 100 + i, true, 1000 + i);
  const withGhost = () => g.list(BK, 100).entries.filter(e => e.ghost).map(e => e.name);
  eq(withGhost(), ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], n('only the top 10 keep a ghost'));
  eq(g.ghost(BK, 'd10'), null, n('no ghost for rank 11'));
  check(g.ghost(BK, 'd0')?.ghost === ghost(100) && g.ghost(BK, 'D0').time === 100 && g.ghost(BK, 'D0').name === 'D0', n('ghost is returned with name and time'));
  post2('D11', 95, true, 5000);   // D11 improves to first, so D9 drops to 11th and loses its ghost
  eq(withGhost(), ['D11', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'], n('a new top 10 row pushes the 10th out of ghosts'));
  eq(g.ghost(BK, 'D9'), null, n('the pushed out ghost is gone'));
  post2('D10', 96, false, 6000);   // D10 improves to second without a ghost
  eq(g.list(BK, 100).entries.find(e => e.name === 'D10').ghost, false, n('a row that improves without a ghost has none'));
  eq(withGhost().length, 9, n('and the row it displaced lost its ghost'));
  post2('Slow', 500, true, 7000);   // lands outside the top 10: its ghost is not kept
  eq(g.ghost(BK, 'slow'), null, n('a lap outside the top 10 keeps no ghost'));
  eq(g.list(BK, 100).entries.at(-1).name, 'Slow', n('but the row is there'));
}
modelTests(() => new T.MemoryTimesStore(), 'memory');
let sqlTested = false;
try {
  const { DatabaseSync } = await import('node:sqlite');
  modelTests(() => {
    const db = new DatabaseSync(':memory:');
    return new SqlTimesStore({ exec: (q, ...a) => ({ toArray: () => db.prepare(q).all(...a) }) });
  }, 'sqlite');
  sqlTested = true;
} catch (e) { if (e?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') { fails++; console.log('  exception in sqlite tests', e); } else console.log('  (node:sqlite not available, the SQL store was not tested)'); }

// ---- the request logic ----
{
  const model = new T.TimesModel(new T.MemoryTimesStore()), limiter = new T.RateLimiter(1000);
  const run = (method, route, query = '', bodyText, now = 1000) => T.handleTimes(model, limiter, { method, route, params: new URLSearchParams(query), bodyText, ip: '9.9.9.9', now });
  eq(run('POST', 'times', '', 'nope').status, 400, 'bad JSON is 400');
  eq(run('POST', 'times', '', JSON.stringify(lap({ time: 5 }))).status, 400, 'a validation failure is 400');
  eq(run('POST', 'times', '', 'x'.repeat(T.MAX_BODY + 1)).json.error, 'body too large', 'a body over 64 KB is 400');
  eq(run('POST', 'times', '', JSON.stringify(lap())).json.ok, true, 'a good POST is 200');
  eq(run('GET', 'times', 'board=nope').status, 400, 'a bad board key on GET /times is 400');
  eq(run('GET', 'ghost', 'board=nope&name=x').status, 400, 'a bad board key on GET /ghost is 400');
  eq(run('GET', 'ghost', `board=${BK}&name=Harry`).status, 404, 'no ghost is 404');
  eq(run('GET', 'times', `board=${BK}&n=0`).json.entries.length, 1, 'n is at least 1');
  eq(run('PUT', 'times', '').status, 405, 'other methods are 405');
  for (let i = 0; i < 30; i++) model.store.put(BK, { key: 'p' + i, name: 'p' + i, time: 200 + i, sectors: [60, 60, 80 + i], at: i, ghost: null });
  eq(run('GET', 'times', `board=${BK}`).json.entries.length, T.DEFAULT_N, 'default n is 20');
  eq(run('GET', 'times', `board=${BK}&n=abc`).json.entries.length, T.DEFAULT_N, 'a bad n falls back to 20');
  for (let i = 0; i < 100; i++) model.store.put(BK, { key: 'q' + i, name: 'q' + i, time: 300 + i, sectors: [100, 100, 100 + i], at: i, ghost: null });
  eq(run('GET', 'times', `board=${BK}&n=500`).json.entries.length, T.MAX_N, 'n is capped at 100');
}

// ---- end to end over HTTP ----
const relay = await startRelay({ port: 0, allowed: 'http://ok.example' });
const base = `http://localhost:${relay.port}`, ORIGIN = { Origin: 'http://ok.example' };
const post = (body, headers = ORIGIN) => fetch(base + '/times', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
try {
  let r = await post(lap({ ghost: ghost(100) }));
  let j = await r.json();
  eq([r.status, j], [200, { ok: true, improved: true, rank: 1, best: 100, entries: 1 }], 'POST /times');
  check(r.headers.get('access-control-allow-origin') === 'http://ok.example' && /Origin/.test(r.headers.get('vary')) && r.headers.get('cache-control') === 'no-store' && /json/.test(r.headers.get('content-type')), 'POST has CORS, Vary, no-store, JSON');
  r = await post(lap({ name: 'Ann', time: 99, sectors: [29, 30, 40] }));
  eq((await r.json()).rank, 1, 'a faster driver ranks first');
  r = await fetch(`${base}/times?board=${BK}&n=1&name=Harry`, { headers: ORIGIN });
  j = await r.json();
  eq(r.status, 200, 'GET /times');
  eq([j.board, j.entries.length, j.entries[0].name, j.entries[0].ghost, j.you.name, j.you.rank, j.you.ghost, typeof j.you.at, j.you.sectors], [BK, 1, 'Ann', false, 'Harry', 2, true, 'number', [30, 30, 40]], 'entries, and you outside the top n');
  check(r.headers.get('access-control-allow-origin') === 'http://ok.example' && r.headers.get('cache-control') === 'no-store', 'GET has CORS and no-store');
  r = await fetch(`${base}/ghost?board=${BK}&name=harry`, { headers: ORIGIN });
  j = await r.json();
  eq([r.status, j.name, j.time, j.ghost === ghost(100)], [200, 'Harry', 100, true], 'GET /ghost');
  r = await fetch(`${base}/ghost?board=${BK}&name=Ann`);
  eq([r.status, await r.json()], [404, { error: 'no ghost' }], 'GET /ghost without a ghost is 404');
  r = await fetch(`${base}/times?board=bad`);
  eq(r.status, 400, 'bad board on GET');
  r = await post('{"name":');
  eq([r.status, typeof (await r.json()).error], [400, 'string'], 'bad JSON over HTTP is 400 with an error');
  r = await post(lap({ ghost: ghost(100, { length: 100 }) }));
  eq(r.status, 400, 'a bad ghost over HTTP is 400');
  r = await post('x'.repeat(T.MAX_BODY + 10));
  eq(r.status, 400, 'a body over 64 KB is 400');
  r = await fetch(base + '/times', { method: 'OPTIONS', headers: { ...ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  check(r.status === 204 && /GET/.test(r.headers.get('access-control-allow-methods')) && /POST/.test(r.headers.get('access-control-allow-methods')) && /Content-Type/i.test(r.headers.get('access-control-allow-headers')) && r.headers.get('access-control-allow-origin') === 'http://ok.example', 'OPTIONS preflight allows GET, POST and Content-Type');
  r = await post(lap(), { Origin: 'http://evil.example' });
  eq([r.status, await r.json()], [403, { error: 'origin not allowed' }], 'a disallowed Origin gets 403');
  check(!r.headers.get('access-control-allow-origin'), '403 does not echo the origin');
  r = await post(lap(), {});
  eq(r.status, 403, 'a POST without an Origin gets 403');
  // rate limit: 20 POSTs per 10 minutes per IP. 403s do not reach the limiter. Post until the first 429 and count what got through.
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
