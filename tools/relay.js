// Relay tests: the protocol logic (worker/src/protocol.js, shared by the Cloudflare Durable Object and worker/dev-relay.mjs)
// and an end to end run of dev-relay.mjs with three real WebSocket clients (Node's built in WebSocket).
import { MAX_PLAYERS, MAX_BYTES, RATE, BURST, IDLE_MS, onOpen, onMessage, onClose, sweep, parseRoute, originAllowed, cleanName, lobbyEntry, Directory, locationHint } from '../worker/src/protocol.js';
import worker from '../worker/src/index.js';
import { startRelay } from '../worker/dev-relay.mjs';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- a fake room ----
function makeRoom(t0 = 1000) {
  const list = [];
  const room = { conns: () => list.filter(c => !c.dead), list };
  room.connect = () => {
    let att = {};
    const c = { mem: {}, out: [], closed: null, dead: false, get att() { return att; }, setAtt(o) { att = o; }, send(x) { this.out.push(typeof x === 'string' ? JSON.parse(x) : x); }, close(code, reason) { this.closed = { code, reason }; } };
    list.push(c); onOpen(c, t0); return c;
  };
  room.say = (c, o, now = t0) => onMessage(room, c, typeof o === 'string' || o instanceof Uint8Array ? o : JSON.stringify(o), now);
  room.join = (name, id, host = false, now = t0, hostKey) => { const c = room.connect(); room.say(c, { t: 'join', name, id, host, ...(hostKey !== undefined ? { hostKey } : {}) }, now); return c; };
  room.drop = c => { c.dead = true; onClose(room, c); };
  return room;
}
const types = c => c.out.map(m => m.t || 'bin');

// ---- unit tests ----
{
  const r = makeRoom();
  const a = r.join('Alice', 'ta', true);
  const { hostKey: aKey, ...aWelcome } = a.out[0];
  eq(aWelcome, { t: 'welcome', you: 0, host: 0, players: [] }, 'host welcome');
  check(typeof aKey === 'string' && aKey.length === 32, 'the host welcome also carries the room secret');
  const b = r.join('Bob', 'tb');
  eq(b.out[0], { t: 'welcome', you: 1, host: 0, players: [{ id: 0, name: 'Alice', host: true }] }, 'guest welcome lists the others, not itself');
  eq(a.out[1], { t: 'peer', id: 1, name: 'Bob', host: false }, 'existing player told about the joiner');
  const c = r.join('Cy', 'tc');
  eq(b.out[1], { t: 'peer', id: 2, name: 'Cy', host: false }, 'all others told');
  check(!c.out.some(m => m.t === 'peer'), 'joiner is not told about itself');

  // forwarding
  r.say(b, { t: 'hello', x: 5 });
  eq(a.out.at(-1), { t: 'hello', x: 5, from: 1 }, 'forward to others tagged with the sender id');
  eq(c.out.at(-1), { t: 'hello', x: 5, from: 1 }, 'forward reaches every other');
  check(!b.out.some(m => m.t === 'hello'), 'sender does not get its own message');
  r.say(a, { t: 'only', to: 2 });
  check(c.out.at(-1).t === 'only' && !b.out.some(m => m.t === 'only'), 'to: delivers to one player only');
  r.say(b, { t: 'ping', n: 7 });
  eq(b.out.at(-1), { t: 'pong', n: 7 }, 'ping answered to the sender');
  check(!a.out.some(m => m.t === 'ping') && !c.out.some(m => m.t === 'ping'), 'ping not forwarded');
  const before = a.out.length;
  r.say(b, { t: 'bye', id: 0 }); r.say(b, { t: 'peer', id: 3, name: 'Fake' }); r.say(b, { t: 'welcome' });
  eq(a.out.length, before, 'clients cannot forge relay messages');
  r.say(b, { t: 'spoof', from: 0 });
  eq(a.out.at(-1).from, 1, 'from is always the real sender');

  // binary
  r.say(b, new Uint8Array([9, 8, 7]));
  eq(Array.from(a.out.at(-1)), [1, 9, 8, 7], 'binary frame gets the sender id as first byte');
  eq(Array.from(c.out.at(-1)), [1, 9, 8, 7], 'binary reaches every other');
  check(!b.out.some(m => m instanceof Uint8Array), 'binary not echoed to the sender');
  eq(r.say(b, new Uint8Array(0)), 'bad', 'empty binary dropped');

  // leave
  r.drop(b);
  eq(a.out.at(-1), { t: 'bye', id: 1 }, 'bye broadcast');
  const d = r.join('Dee', 'td');
  eq(d.out[0].you, 1, 'a freed slot is reused');
  // reconnect with the same token takes the old slot, without bye/peer noise
  const na = a.out.length;
  const b2 = r.join('Dee2', 'td');
  eq(b2.out[0].you, 1, 'same token gets the same id back');
  check(d.closed?.code === 4004, 'old socket of the same token is closed');
  check(a.out.length === na, 'a takeover causes no bye or peer');
  r.drop(d);
  check(a.out.length === na, 'the replaced socket closing causes no bye');
}
{ // host rules
  const r = makeRoom();
  const g = r.join('Guest', 'g1');
  eq(types(g), ['nohost'], 'guest to a room nobody hosts gets nohost');
  check(g.closed?.code === 4002, 'and is closed');
  const h = r.join('Host', 'h1', true);
  const h2 = r.join('Host2', 'h2', true);
  eq(types(h2), ['taken'], 'a second host gets taken');
  check(h2.closed?.code === 4003, 'and is closed');
  const g2 = r.join('Guest', 'g1');
  eq(g2.out[0].t, 'welcome', 'guest joins once a host exists');
  const h1b = r.join('Host', 'h1', true, 1000, h.out[0].hostKey);
  eq(h1b.out[0].you, 0, 'the host reconnecting with its token and secret keeps being host');
  r.drop(h1b);
  const late = r.join('Late', 'l1');
  eq(types(late), ['nohost'], 'after the host left a new guest gets nohost');
}
{ // the room's weather (env) is the host's alone
  const r = makeRoom();
  const h = r.join('Host', 'h', true), g1 = r.join('G1', 'g1'), g2 = r.join('G2', 'g2');
  const n = [h.out.length, g1.out.length, g2.out.length];
  eq(r.say(h, { t: 'env', weather: 'rain', time: 'night' }), 'forwarded', 'the host env message is forwarded');
  eq(g1.out.at(-1), { t: 'env', weather: 'rain', time: 'night', from: 0 }, 'a guest gets the host env message tagged with the host id');
  eq(g2.out.at(-1), { t: 'env', weather: 'rain', time: 'night', from: 0 }, 'every guest gets it');
  check(h.out.length === n[0], 'the host does not get its own env back');
  r.say(h, { t: 'env', weather: 'fog', time: 'dusk', to: 2 });
  check(g2.out.at(-1).weather === 'fog' && g1.out.at(-1).weather === 'rain', 'env sent to one newcomer reaches only that guest');
  const m = [h.out.length, g1.out.length, g2.out.length];
  eq(r.say(g1, { t: 'env', weather: 'heavyrain', time: 'night' }), 'ignored', 'an env message from a guest is ignored');
  eq([h.out.length, g1.out.length, g2.out.length], m, 'and reaches nobody');
  // the race start is the host's too: a guest's race frame is not forwarded, the host's is
  eq(r.say(g2, { t: 'race', laps: 1, startAt: 5, grid: ['g2'] }), 'ignored', 'a race frame from a guest is ignored');
  eq([h.out.length, g1.out.length, g2.out.length], m, 'and reaches nobody, not even the other guests');
  eq(r.say(h, { t: 'race', laps: 3, startAt: 9, grid: ['h'] }), 'forwarded', 'the host race frame is forwarded');
  eq(g1.out.at(-1), { t: 'race', laps: 3, startAt: 9, grid: ['h'], from: 0 }, 'to every guest, tagged with the host id');
  eq(g2.out.at(-1), { t: 'race', laps: 3, startAt: 9, grid: ['h'], from: 0 }, 'and to the other one too');
}
{ // the finish message (src/finish.js) is a player's: any guest's fin is forwarded to the others, tagged with its sender, and not back to it
  const r = makeRoom();
  const h = r.join('Host', 'h', true), g1 = r.join('G1', 'g1'), g2 = r.join('G2', 'g2');
  const fin = { t: 'fin', time: 480.5, laps: 5, best: 92.4, sec: [29.8, 38.1, 24.5], pen: [{ s: 2, why: 'Track limits +2s' }], warn: 1 };
  eq(r.say(g1, fin), 'forwarded', 'a guest finish message is forwarded');
  eq(g2.out.at(-1), { ...fin, from: 1 }, 'to the other guest, tagged with the sender id');
  eq(h.out.at(-1), { ...fin, from: 1 }, 'and to the host');
  check(!g1.out.some(m => m.t === 'fin'), 'not back to the sender');
  eq(r.say(h, { ...fin, to: 2 }), 'forwarded', 'a finish sent to one player is forwarded to that player only');
  eq(g2.out.at(-1), { ...fin, to: 2, from: 0 }, 'the host finish reaches the guest it names (the relay passes `to` on, as for env)');
  check(!g1.out.some(m => m.t === 'fin' && m.from === 0), 'and not the other guest');
}
{ // the host secret: a room that has had a host keeps its key, and only the host that made the room gets it
  const r = makeRoom();
  const h = r.join('Host', 'h1', true);
  const key = h.out[0].hostKey;
  check(typeof key === 'string' && /^[0-9a-f]{32}$/.test(key), 'the first host gets a 128 bit secret in its welcome');
  check(r.hostKey === key, 'the room keeps the secret (on the room object, which the Durable Object stores)');
  const g = r.join('Guest', 'g1');
  const shown = s => JSON.stringify(s);
  check(!shown(g.out).includes(key) && !shown(h.out.slice(1)).includes(key), 'guests never see the secret, not even in the peer announcements');
  r.say(h, { t: 'hello', x: 1 }); r.say(g, { t: 'hello', x: 2 });
  check(!shown(g.out).includes(key), 'nor in what the room forwards to them');
  const ghost = r.join('Thief', 't1', true);
  eq(types(ghost), ['taken'], 'while the host is connected a second host is refused');
  r.drop(h);
  const thief = r.join('Thief', 't2', true);
  eq(types(thief), ['taken'], 'the host dropped for a moment: a host join without the secret is refused');
  check(thief.closed?.code === 4003 && !thief.att.host, 'and the thief is closed without a slot');
  const wrong = r.join('Thief', 't3', true, 1000, 'not the key');
  eq(types(wrong), ['taken'], 'a wrong secret is refused too');
  const nothing = r.join('Thief', 't4', true, 1000, '');
  eq(types(nothing), ['taken'], 'an empty secret is refused too');
  check(!r.conns().some(c => c.att.tok === 't2' || c.att.tok === 't3' || c.att.tok === 't4'), 'no refused join left a socket behind');
  const back = r.join('Host', 'h1', true, 1000, key);
  eq(back.out[0].you, 0, 'the real host comes back with the secret and is host again');
  check(back.out[0].hostKey === undefined, 'a host that rejoins is not sent the secret again');
  eq(g.out.at(-1).t, 'peer', 'the guest is still there');
  check(g.out.some(m => m.t === 'bye' && m.id === 0) && g.out.some(m => m.t === 'peer' && m.id === 0 && m.host === true), 'the guest saw the host leave and come back');
  check(!shown(g.out).includes(key), 'and still has not seen the secret');
  // the room empties: the secret stays with the room (storage), so nobody else can take it
  r.drop(back); r.drop(g);
  eq(types(r.join('Late', 'l9', true)), ['taken'], 'an empty room with a secret still refuses a host without it');
  const again = r.join('Host', 'h1', true, 1000, key);
  eq(again.out[0].you, 0, 'and the real host can still come back to it');
  // the directory: the entry for the room is what the lobby lists, and it has no secret
  const e = lobbyEntry(r);
  const d = new Directory(); d.update('ABCDE', e, 1000);
  check(e && !JSON.stringify([e, d.list(1000), d.get('ABCDE', 1000)]).includes(key), 'the lobby listing never has the secret');
  eq(lobbyEntry({ conns: () => [] }), null, 'a room with nobody in it is not listed');
}
{ // a fresh room: the first host join makes the secret, and each room has its own
  const r1 = makeRoom(), r2 = makeRoom();
  const k1 = r1.join('A', 'a', true).out[0].hostKey, k2 = r2.join('B', 'b', true).out[0].hostKey;
  check(k1 && k2 && k1 !== k2, 'every room gets its own secret');
  eq(types(r2.join('X', 'x', true)), ['taken'], 'the first host of a room makes it; a second is refused');
}
{ // full room
  const r = makeRoom();
  const cs = [r.join('P0', 't0', true)];
  for (let i = 1; i < MAX_PLAYERS; i++) cs.push(r.join('P' + i, 't' + i));
  check(cs.every(c => c.out[0].t === 'welcome'), 'eight players fit');
  eq(cs.map(c => c.att.id), [0, 1, 2, 3, 4, 5, 6, 7], 'ids are 0 to 7');
  const nine = r.join('P9', 't9');
  eq(types(nine), ['full'], 'the ninth gets full');
  check(nine.closed?.code === 4001, 'and is closed');
  check(cs.every(c => !c.out.some(m => m.t === 'peer' && m.name === 'P9')), 'the ninth is not announced');
  const again = r.join('P3b', 't3');
  eq(again.out[0].t, 'welcome', 'a reconnect into a full room works');
}
{ // limits and garbage
  const r = makeRoom();
  const a = r.join('A', 'a', true), b = r.join('B', 'b');
  const n0 = a.out.length;
  eq(r.say(b, { t: 'x', pad: 'y'.repeat(MAX_BYTES) }), 'big', 'text over 2 KB dropped');
  eq(r.say(b, new Uint8Array(MAX_BYTES + 1)), 'big', 'binary over 2 KB dropped');
  eq(r.say(b, { t: 'x', pad: 'é'.repeat(MAX_BYTES / 2) }), 'big', 'size is counted in bytes, not characters');
  eq(r.say(b, { t: 'ok', pad: 'y'.repeat(1900) }), 'forwarded', 'a frame under 2 KB passes');
  eq(a.out.length, n0 + 1, 'only the small one arrived');
  for (const bad of ['not json', '[1,2]', 'null', '42', '{"x":1}', '{"t":5}', '']) eq(r.say(b, bad), 'bad', 'malformed frame dropped: ' + JSON.stringify(bad));
  const nobody = r.connect();
  eq(r.say(nobody, { t: 'hi' }), 'ignored', 'frames before join are ignored');
  eq(r.say(nobody, new Uint8Array([1])), 'ignored', 'binary before join is ignored');
  eq(a.out.length, n0 + 1, 'garbage never reaches other players');
  eq(r.say(b, { t: 'join', name: 'again', id: 'zz' }), 'ignored', 'a second join on the same socket is ignored');
  // name cleaning
  const e = r.join('  <b>Eve</b>\u0000  the  great and powerful  ', 'e');
  eq(e.att.name, 'bEve/b the great', 'name is cleaned');
  check(e.att.name.length <= 16 && !/[<>]/.test(e.att.name), 'name is plain text, 16 characters at most');
  eq(r.join('', 'f').att.name, 'Player', 'an empty name becomes Player');
}
{ // rate limit: RATE (80) frames per second per socket, at most BURST at once, extras dropped silently
  const r = makeRoom();
  const a = r.join('A', 'a', true), b = r.join('B', 'b');
  const n0 = a.out.length;
  let got = 0;
  for (let i = 0; i < 200; i++) if (r.say(b, { t: 'm', i }, 5000) === 'forwarded') got++;
  check(got >= BURST - 2 && got <= BURST + 1, `a burst of 200 at one instant lets about ${BURST} through (${got})`);
  eq(a.out.length - n0, got, 'dropped frames are really dropped');
  let steady = 0;
  for (let i = 0; i < 100; i++) if (r.say(b, { t: 'm', i }, 6000 + i * 1000 / RATE) === 'forwarded') steady++;   // RATE per second exactly
  check(steady >= 98, `${RATE} frames per second is sustained (${steady} of 100)`);
  let fast = 0;
  for (let i = 0; i < 400; i++) if (r.say(b, { t: 'm', i }, 20000 + i * 5) === 'forwarded') fast++;       // 200 per second for 2 s
  check(fast >= 2 * RATE - 4 && fast <= 2 * RATE + BURST + 2, `200 per second is cut to about ${RATE} per second plus the burst (${fast} of 400 in 2 s)`);
  // what one player really sends for a minute: 30 Hz car state, 10 Hz telemetry (somebody watches), a ping every 15 s, a livery every 2 s
  const p = r.join('P', 'p'), watch = r.connect();
  r.say(watch, { t: 'join', name: 'Watch', spectator: true }, 40000);
  let refused = 0, sent = 0;
  for (let ms = 0; ms < 60000; ms++) {
    const now = 40000 + ms, frames = [];
    if (Math.floor(ms * 30 / 1000) !== Math.floor((ms - 1) * 30 / 1000)) frames.push(new Uint8Array([1, ms & 255, 0, 0]));   // state, 30 a second
    if (Math.floor(ms / 100) !== Math.floor((ms - 1) / 100)) frames.push(new Uint8Array([2, ms & 255, 0, 0]));              // telemetry, 10 a second
    if (ms % 15000 === 0) frames.push({ t: 'ping', n: ms });
    if (ms % 2000 === 0) frames.push({ t: 'lv', l: 'x' });
    for (const f of frames) { sent++; if (r.say(p, f, now) === 'rate') refused++; }
  }
  eq(refused, 0, `a player's real traffic (${sent} frames in a minute) is never refused`);
  check(watch.out.some(m => m instanceof Uint8Array), 'and the spectator gets the telemetry');
}
{ // idle timeout
  const r = makeRoom(1000);
  const a = r.join('A', 'a', true, 1000), b = r.join('B', 'b', false, 1000);
  r.say(a, { t: 'ping', n: 1 }, 1000 + 15000); r.say(a, { t: 'ping', n: 2 }, 1000 + 30000); r.say(a, { t: 'ping', n: 3 }, 1000 + 45000);
  eq(sweep(r, 1000 + 59000), 0, 'nobody is closed inside 60 s');
  eq(sweep(r, 1000 + 61000), 1, 'the silent one is closed after 60 s');
  check(b.closed?.code === 4008 && !a.closed, 'only the idle socket is closed');
  r.drop(b);
  eq(r.conns().length, 1, 'closed socket removed');
  eq(a.out.at(-1), { t: 'bye', id: 1 }, 'leaving through idle timeout says bye');
  // after hibernation the memory is gone but the attachment keeps the last traffic time
  const r3 = makeRoom(0);
  const c = r3.join('C', 'c', true, 100000);
  c.mem = {};
  eq(sweep(r3, 100000 + 30000), 0, 'unknown last traffic after waking is not an idle close');
  const r2 = makeRoom(0); const x = r2.connect(); x.mem = {};
  eq(sweep(r2, 1e6), 0, 'a socket with no record gets a fresh start');
  eq(sweep(r2, 1e6 + IDLE_MS + 1), 1, 'and then times out');
}
{ // where a room is placed: the host's first socket (host=1) gives a location hint, guests and later sockets give none
  eq(locationHint({ continent: 'EU', country: 'PL' }), 'eeur', 'eastern Europe: eeur');
  eq(locationHint({ continent: 'EU', country: 'FR' }), 'weur', 'the rest of Europe: weur');
  eq(locationHint({ continent: 'NA', country: 'US', longitude: '-74.0' }), 'enam', 'east of the Rockies: enam');
  eq(locationHint({ continent: 'NA', country: 'CA', longitude: '-123.1' }), 'wnam', 'the west: wnam');
  eq(locationHint({ continent: 'SA', country: 'BR' }), 'sam', 'South America: sam');
  eq(locationHint({ continent: 'AS', country: 'JP' }), 'apac', 'Asia: apac');
  eq(locationHint({ continent: 'AS', country: 'AE' }), 'me', 'the Gulf states: me');
  eq(locationHint({ continent: 'OC', country: 'AU' }), 'oc', 'Oceania: oc');
  eq(locationHint({ continent: 'AF', country: 'ZA' }), 'afr', 'Africa: afr');
  eq(locationHint({ continent: 'AN' }), undefined, 'no hint for Antarctica');
  eq(locationHint(undefined), undefined, 'no hint without request.cf (dev)');
  const calls = [];
  const env = { ALLOWED_ORIGINS: '*', ROOM: { idFromName: n => 'do:' + n, get: (id, opts) => { calls.push({ id, opts }); return { fetch: async () => ({ status: 101 }) }; } } };
  const req = (path, cf) => { const q = new Request('https://relay.example' + path, { headers: { Upgrade: 'websocket' } }); if (cf) Object.defineProperty(q, 'cf', { value: cf }); return q; };
  await worker.fetch(req('/room/QWERT?host=1', { continent: 'EU', country: 'DE' }), env);
  eq(calls.at(-1), { id: 'do:QWERT', opts: { locationHint: 'weur' } }, 'the host making the room passes its hint');
  await worker.fetch(req('/room/QWERT', { continent: 'NA', country: 'US', longitude: '-122' }), env);
  eq(calls.at(-1), { id: 'do:QWERT', opts: undefined }, 'a guest joining later: same object, no hint');
  await worker.fetch(req('/room/qwert?spectator=1', { continent: 'AS', country: 'JP' }), env);
  eq(calls.at(-1), { id: 'do:QWERT', opts: undefined }, 'a spectator too (any case of the code)');
  await worker.fetch(req('/room/ABCDE?host=1', { continent: 'SA', country: 'BR' }), env);
  eq(calls.at(-1), { id: 'do:ABCDE', opts: { locationHint: 'sam' } }, 'another room: its own hint');
  await worker.fetch(req('/room/BCDEF?host=1'), env);
  eq(calls.at(-1), { id: 'do:BCDEF', opts: undefined }, 'no request.cf: no hint, Cloudflare chooses');
}

{ // routing and origins
  eq(parseRoute('/room/ABCDE'), { kind: 'room', code: 'ABCDE' }, 'room route');
  eq(parseRoute('/room/abcde'), { kind: 'room', code: 'ABCDE' }, 'room code is upper-cased');
  eq(parseRoute('/health'), { kind: 'health' }, 'health route');
  for (const p of ['/room/ABCD', '/room/ABCDEF', '/room/AB1DE', '/room/', '/', '/room/ABCDE/x', '/roomABCDE']) eq(parseRoute(p), null, 'not a route: ' + p);
  check(originAllowed('https://a.example', 'https://a.example, https://b.example/'), 'listed origin passes');
  check(originAllowed('https://b.example', 'https://a.example, https://b.example/'), 'trailing slash in the list is fine');
  check(!originAllowed('https://evil.example', 'https://a.example'), 'unlisted origin refused');
  check(!originAllowed('https://evil.example', ''), 'empty list refuses all browsers');
  check(!originAllowed('https://evil.example', undefined), 'unset list refuses all browsers');
  check(originAllowed('https://anything.example', '*'), '* allows any');
  check(originAllowed(null, 'https://a.example'), 'no Origin header (curl) passes');
  check(!originAllowed('https://a.example.evil.com', 'https://a.example'), 'no prefix matching');
}

// ---- end to end through dev-relay.mjs ----
const relay = await startRelay({ port: 0, allowed: 'http://ok.example' });
const base = `ws://127.0.0.1:${relay.port}`;
function client(code, join, origin) {
  const ws = new WebSocket(`${base}/room/${code}`);
  ws.binaryType = 'arraybuffer';
  const c = { ws, msgs: [], bins: [], closed: null, open: new Promise(r => ws.addEventListener('open', r, { once: true })) };
  ws.addEventListener('message', e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); else c.bins.push(Array.from(new Uint8Array(e.data))); });
  ws.addEventListener('close', e => { c.closed = e.code; });
  c.send = o => ws.send(typeof o === 'string' || o instanceof Uint8Array ? o : JSON.stringify(o));
  c.until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 5)); } return false; };
  if (join) c.open.then(() => c.send(join));
  return c;
}
try {
  const health = await fetch(`http://127.0.0.1:${relay.port}/health`);
  check(health.status === 200 && await health.text() === 'ok', 'GET /health answers ok');
  const notFound = await fetch(`http://127.0.0.1:${relay.port}/nothing`);
  check(notFound.status === 404, 'unknown path is 404');
  const plain = await fetch(`http://127.0.0.1:${relay.port}/room/ABCDE`);
  check(plain.status === 426, 'a room URL without websocket upgrade is refused');

  const A = client('QWERT', { t: 'join', name: 'Alice', id: 'a1', host: true });
  await A.until(() => A.msgs.some(m => m.t === 'welcome'));
  const B = client('QWERT', { t: 'join', name: 'Bob', id: 'b1' });
  const C = client('QWERT', { t: 'join', name: 'Cy', id: 'c1' });
  await B.until(() => B.msgs.some(m => m.t === 'welcome')); await C.until(() => C.msgs.some(m => m.t === 'welcome'));
  eq([A, B, C].map(c => c.msgs[0].you), [0, 1, 2], 'three real clients get ids 0, 1, 2');
  eq(C.msgs[0].players.map(p => p.name), ['Alice', 'Bob'], 'welcome lists who is there');
  check(await A.until(() => A.msgs.filter(m => m.t === 'peer').length === 2), 'host hears about both joins');

  // ordering: 50 numbered JSON messages and 50 binary frames from B arrive complete and in order at A and C
  for (let i = 0; i < 50; i++) { B.send({ t: 'seq', i }); B.send(new Uint8Array([1, i, 200 + (i % 50)])); await new Promise(r => setTimeout(r, 60)); }   // 2 frames per 60 ms = 33 per second, under the limit
  check(await A.until(() => A.bins.length === 50 && C.bins.length === 50 && A.msgs.filter(m => m.t === 'seq').length === 50 && C.msgs.filter(m => m.t === 'seq').length === 50, 5000), 'fan out reached both other clients');
  for (const [n, P] of [['host', A], ['third client', C]]) {
    eq(P.msgs.filter(m => m.t === 'seq').map(m => m.i), [...Array(50).keys()], `${n}: JSON arrives in order`);
    check(P.msgs.filter(m => m.t === 'seq').every(m => m.from === 1), `${n}: JSON tagged with sender id 1`);
    eq(P.bins.map(b => b[2]), [...Array(50).keys()], `${n}: binary arrives in order`);
    check(P.bins.every(b => b.length === 4 && b[0] === 1 && b[3] === 200 + (b[2] % 50)), `${n}: binary has the 1 byte sender prefix`);
  }
  check(!B.msgs.some(m => m.t === 'seq') && B.bins.length === 0, 'sender gets none of its own');
  // the race start: a guest's race frame goes nowhere, the host's reaches the guests
  B.send({ t: 'race', startAt: 1, grid: [] }); A.send({ t: 'race', startAt: 2, grid: [] });
  check(await C.until(() => C.msgs.some(m => m.t === 'race')), 'the host race frame reaches a guest');
  await new Promise(r => setTimeout(r, 100));
  check(!A.msgs.some(m => m.t === 'race') && !C.msgs.some(m => m.t === 'race' && m.from === 1), 'a guest race frame is not forwarded to the host or the other guest');
  check(C.msgs.filter(m => m.t === 'race').length === 1 && C.msgs.find(m => m.t === 'race').from === 0, 'and only the host one arrived, tagged with the host id');
  // ping and pong over the wire
  B.send({ t: 'ping', n: 123 });
  check(await B.until(() => B.msgs.some(m => m.t === 'pong' && m.n === 123)), 'ping is answered with pong');
  // leave
  C.ws.close();
  check(await A.until(() => A.msgs.some(m => m.t === 'bye' && m.id === 2)) && await B.until(() => B.msgs.some(m => m.t === 'bye' && m.id === 2)), 'a closing client is announced with bye');
  // a different room is separate
  const X = client('ZZZZZ', { t: 'join', name: 'X', id: 'x', host: true });
  await X.until(() => X.msgs.length > 0);
  B.send({ t: 'solo' });
  await new Promise(r => setTimeout(r, 100));
  check(!X.msgs.some(m => m.t === 'solo'), 'rooms are separate');
  // guest to a room nobody opened
  const G = client('NOONE', { t: 'join', name: 'G', id: 'g' });
  check(await G.until(() => G.closed !== null), 'guest to an unopened room is closed') && eq([G.msgs.map(m => m.t), G.closed], [['nohost'], 4002], 'with nohost and code 4002');
  // full
  const room8 = [];
  for (let i = 0; i < 8; i++) { const p = client('EIGHT', { t: 'join', name: 'P' + i, id: 'p' + i, host: i === 0 }); room8.push(p); await p.until(() => p.msgs.length > 0); }
  const nine = client('EIGHT', { t: 'join', name: 'P9', id: 'p9' });
  check(await nine.until(() => nine.closed !== null), 'the ninth is closed');
  eq([nine.msgs.map(m => m.t), nine.closed], [['full'], 4001], 'with full and code 4001');
  // the host secret over the wire: only the host's welcome has it, the lobby listing does not, and a host that dropped comes back only with it
  const key = A.msgs.find(m => m.t === 'welcome').hostKey;
  check(typeof key === 'string' && key.length === 32, 'the host got the secret in its welcome');
  check(!B.msgs.some(m => JSON.stringify(m).includes(key)) && !C.msgs.some(m => JSON.stringify(m).includes(key)), 'guests never see the secret');
  const lobby = await (await fetch(`http://127.0.0.1:${relay.port}/lobbies`)).text();
  check(lobby.includes('"QWERT"') && !lobby.includes(key), 'the lobby lists the room and not its secret');
  A.ws.close();
  check(await B.until(() => B.msgs.some(m => m.t === 'bye' && m.id === 0)), 'the host dropped: the guest is told');
  const T = client('QWERT', { t: 'join', name: 'Thief', id: 'thief', host: true });
  check(await T.until(() => T.closed !== null) && T.closed === 4003 && T.msgs.map(m => m.t).join() === 'taken', 'with the host away, a host join without the secret is refused (4003)');
  const A2 = client('QWERT', { t: 'join', name: 'Alice', id: 'a1', host: true, hostKey: key });
  check(await A2.until(() => A2.msgs.some(m => m.t === 'welcome')) && A2.msgs[0].you === 0 && A2.msgs[0].host === 0, 'the host comes back with the secret, as host');
  // oversized frame from a real client is dropped and the connection survives
  B.send(JSON.stringify({ t: 'big', pad: 'x'.repeat(3000) })); B.send({ t: 'after' });
  check(await A2.until(() => A2.msgs.some(m => m.t === 'after')) && !A2.msgs.some(m => m.t === 'big'), 'oversized frame dropped, the next one arrives');
  // a bad origin is refused at the handshake
  const refused = await new Promise(res => { const s = new WebSocket(`${base}/room/QWERT`, { headers: { Origin: 'http://evil.example' } }); s.addEventListener('open', () => res('open')); s.addEventListener('error', () => res('refused')); s.addEventListener('close', () => res('refused')); });
  check(refused === 'refused', 'a websocket from an unlisted origin is refused: ' + refused);
  const goodOrigin = await new Promise(res => { const s = new WebSocket(`${base}/room/QWERT`, { headers: { Origin: 'http://ok.example' } }); s.addEventListener('open', () => { s.close(); res('open'); }); s.addEventListener('error', () => res('refused')); });
  check(goodOrigin === 'open', 'a websocket from a listed origin is accepted: ' + goodOrigin);
  for (const p of [A2, B, X, ...room8]) p.ws.close();
  await new Promise(r => setTimeout(r, 50));
  check(relay.rooms.size === 0, 'rooms disappear when empty (nothing kept): ' + relay.rooms.size);
} catch (e) { fails++; console.log('  exception', e); }
relay.close();
console.log(fails ? `relay: ${fails} FAILED, ${passes} passed` : `relay: all ${passes} checks passed`);
process.exit(fails ? 1 : 0);
