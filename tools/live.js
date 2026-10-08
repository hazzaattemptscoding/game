// The live timing and spectator side, tested without a browser or Cloudflare:
//   1. the relay protocol for spectators, the host's room details and the lobby directory (worker/src/protocol.js)
//   2. dev-relay.mjs end to end with fake players (tools/lib/bots.js) and a real SpectatorRoom (src/live/net.js)
//   3. the race model (positions, gaps, sector colours, events), the TV director and the camera spots (src/live/)
// Run with `npm run live` (also part of `npm run check`).
import { readFileSync } from 'node:fs';
import { onOpen, onMessage, onClose, sweep, lobbyEntry, cleanMeta, Directory, Publisher, MAX_PLAYERS, MAX_SPECTATORS, MAX_BYTES, RATE, DIRECTORY_TTL_MS, TAG_STATE, TAG_TELEMETRY as RELAY_TAG_TELEMETRY, EVENT_RING, parseRoute } from '../worker/src/protocol.js';
import { startRelay } from '../worker/dev-relay.mjs';
import { startBots, BOTS } from './lib/bots.js';
import { encodeTelemetry, decodeTelemetry, TAG_TELEMETRY, TAG_STATE as SHARED_TAG_STATE, TELEMETRY_BYTES } from '../src/shared/telemetry.js';
import { BIN_STATE, Ghosts, encodeState, packState } from '../src/ghosts.js';
import { RaceModel, fmtTime, fmtGap, CHECKPOINT_M } from '../src/live/model.js';
import { TVDirector, HOLD } from '../src/live/tv.js';
import { trackSpots } from '../src/live/cams.js';
import { cleanLobby, fetchLobbies, findRelay, SpectatorRoom, httpBase } from '../src/live/net.js';
import { buildTrack } from '../src/track.js';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} +-${tol}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- a fake room, as in tools/relay.js ----
function makeRoom(cfg) {
  const list = [], notes = [];
  const room = { conns: () => list.filter(c => !c.dead), cfg, notes, notify: (urgent, now) => notes.push({ urgent, now }) };
  room.connect = (opts) => {
    let att = {};
    const c = { mem: {}, out: [], closed: null, dead: false, get att() { return att; }, setAtt(o) { att = o; }, send(x) { this.out.push(typeof x === 'string' ? JSON.parse(x) : x); }, close(code, reason) { this.closed = { code, reason }; } };
    list.push(c); onOpen(c, 1000, opts); return c;
  };
  room.say = (c, o, now = 1000) => onMessage(room, c, typeof o === 'string' || o instanceof Uint8Array ? o : JSON.stringify(o), now);
  room.join = (name, id, host = false, now = 1000) => { const c = room.connect(); room.say(c, { t: 'join', name, id, host }, now); return c; };
  room.watch = (name = 'Spec', now = 1000) => { const c = room.connect(); room.say(c, { t: 'join', name, spectator: true }, now); return c; };
  room.drop = c => { c.dead = true; onClose(room, c, 1000); };
  return room;
}
const types = c => c.out.map(m => (m instanceof Uint8Array ? 'bin' : m.t));
const bins = c => c.out.filter(m => m instanceof Uint8Array);
const jsons = (c, t) => c.out.filter(m => !(m instanceof Uint8Array) && m.t === t);
const state = (n = 1) => new Uint8Array([TAG_STATE, n, 9, 9]);
const tele = (n = 1) => { const u = new Uint8Array(14); u[0] = RELAY_TAG_TELEMETRY; u[2] = n; return u; };

// ================= 1. protocol =================
check(TAG_TELEMETRY === RELAY_TAG_TELEMETRY && SHARED_TAG_STATE === TAG_STATE && BIN_STATE === TAG_STATE, 'the worker and the game agree on the frame tags');
check(MAX_SPECTATORS === 50, 'a room holds 50 spectators');
{ // joining
  const r = makeRoom();
  const lone = r.watch();
  eq(types(lone), ['nohost'], 'a spectator to a room with no players gets nohost');
  check(lone.closed?.code === 4002, 'and is closed with 4002');
  const a = r.join('Alice', 'a', true), b = r.join('Bob', 'b');
  r.say(a, { t: 'lv', l: 'LIVERY-A' }); r.say(b, { t: 'name', n: 'Robert' });
  r.say(a, state(1)); r.say(b, state(2)); r.say(a, { t: 'ev', k: 'lap', n: 1 });
  const s = r.watch('Watcher');
  const w = s.out[0];
  eq([w.t, w.you, w.spectator, w.host, w.players.map(p => p.name), w.spectators], ['welcome', -1, true, 0, ['Alice', 'Bob'], 1], 'welcome to a spectator: no player id, who is there, host, spectator count');
  check(jsons(s, 'lv').some(m => m.l === 'LIVERY-A' && m.from === 0), 'snapshot: the stored livery');
  check(jsons(s, 'name').some(m => m.n === 'Robert' && m.from === 1), 'snapshot: the stored name');
  check(jsons(s, 'ev').length === 1, 'snapshot: the recent events');
  eq(bins(s).map(m => Array.from(m)), [[0, 1, 1, 9, 9], [1, 1, 2, 9, 9]], 'snapshot: the last state frame of each player, with the sender id');
  eq(s.att.spec, true, 'a spectator is marked in its attachment');
  check(typeof s.att.id !== 'number', 'and has no player id');
  eq(jsons(a, 'spec').at(-1), { t: 'spec', n: 1 }, 'players are told when a spectator comes');
  check(!jsons(a, 'peer').length || !jsons(a, 'peer').some(m => m.name === 'Watcher'), 'a spectator is never announced as a peer');
  // by URL flag instead of the join field
  const u = r.connect({ spectator: true }); r.say(u, { t: 'join', name: 'ByUrl' });
  eq(types(u)[0], 'welcome', '?spectator=1 makes a plain join a spectator join');
  eq(u.out[0].you, -1, 'with no player id');
  // spectators do not use player slots
  const c = r.join('Cy', 'c');
  eq(c.out[0].you, 2, 'the next player still gets slot 2 with spectators present');
  eq(c.out[0].spectators, 2, 'a player welcome tells how many are watching');
  check(jsons(s, 'peer').some(m => m.id === 2 && m.name === 'Cy'), 'spectators hear about new players');
  check(!c.out.some(m => m.t === 'welcome' && m.players.some(p => p.name === 'Watcher')), 'players are not told about spectators as players');
}
{ // capacity
  const r = makeRoom({ maxSpectators: 3 });
  r.join('H', 'h', true);
  const w = [1, 2, 3].map(i => r.watch('S' + i));
  check(w.every(c => c.out[0].t === 'welcome'), 'three spectators fit when the limit is three');
  const four = r.watch('S4');
  eq(types(four), ['full'], 'the fourth gets full');
  eq(four.out[0].spectator, true, 'marked as the spectator kind of full');
  check(four.closed?.code === 4001, 'and is closed with 4001');
  r.drop(w[0]);
  eq(r.watch('S5').out[0].t, 'welcome', 'a free seat is reused');
  const big = makeRoom();
  const cs = [big.join('P0', 't0', true)];
  for (let i = 1; i < MAX_PLAYERS; i++) cs.push(big.join('P' + i, 't' + i));
  const specs = Array.from({ length: MAX_SPECTATORS }, (_, i) => big.watch('S' + i));
  check(specs.every(c => c.out[0].t === 'welcome'), 'a full room still takes 50 spectators');
  eq(types(big.watch('late')), ['full'], 'the 51st spectator is refused');
  eq(types(big.join('P9', 'tx')), ['full'], 'spectators do not make room for a 9th player, and do not take a seat from the 8');
  eq(big.join('P3again', 't3').out[0].t, 'welcome', 'a player reconnecting into the full room still works');
}
{ // spectators only listen
  const r = makeRoom();
  const a = r.join('A', 'a', true), b = r.join('B', 'b'), s = r.watch();
  const na = a.out.length, nb = b.out.length;
  eq(r.say(s, { t: 'chat', x: 1 }), 'ignored', 'a spectator message is ignored');
  eq(r.say(s, new Uint8Array([1, 2, 3])), 'ignored', 'a spectator binary frame is ignored');
  eq(r.say(s, new Uint8Array([TAG_TELEMETRY, 2, 3])), 'ignored', 'so is a fake telemetry frame');
  eq(r.say(s, { t: 'meta', mode: 'Hacked', laps: 5, started: true }), 'ignored', 'and a meta message');
  eq(r.say(s, { t: 'bye', id: 0 }), 'ignored', 'and a forged bye');
  eq(r.say(s, { t: 'join', name: 'again', host: true }), 'ignored', 'and a second join (a spectator cannot turn into a host)');
  eq([a.out.length, b.out.length], [na, nb], 'nothing a spectator says reaches a player');
  r.say(s, { t: 'ping', n: 9 });
  eq(s.out.at(-1), { t: 'pong', n: 9 }, 'a spectator can ping');
  check(!lobbyEntry(r).players.some(p => p.name === 'Spec'), 'a spectator is not in the lobby entry players');
}
{ // what spectators receive
  const r = makeRoom();
  const a = r.join('A', 'a', true), b = r.join('B', 'b'), s = r.watch();
  r.say(a, { t: 'hello', x: 5 });
  eq(s.out.at(-1), { t: 'hello', x: 5, from: 0 }, 'a broadcast reaches a spectator, tagged with the sender');
  r.say(a, { t: 'private', to: 1 });
  check(!s.out.some(m => m.t === 'private') && b.out.some(m => m.t === 'private'), 'a message to one player stays between the two');
  r.say(a, { t: 'lv', l: 'X' });
  check(jsons(s, 'lv').some(m => m.l === 'X'), 'livery updates reach spectators');
  // 20 Hz state: every 2nd frame to a spectator, every frame to the players
  const before = bins(s).length, pb = bins(b).length;
  for (let i = 0; i < 20; i++) r.say(a, state(i), 2000 + i * 50);
  eq(bins(s).length - before, 10, 'spectators get 10 of 20 state frames (10 Hz)');
  eq(bins(b).length - pb, 20, 'players get all 20');
  const r2 = makeRoom({ specDivider: 1 });
  const x = r2.join('A', 'a', true), y = r2.watch();
  for (let i = 0; i < 6; i++) r2.say(x, state(i), 2000 + i * 50);
  eq(bins(y).length, 6, 'a divider of 1 passes every frame');
  // telemetry: spectators only
  const tb = bins(b).length, ta = bins(a).length, ts = bins(s).length;
  eq(r.say(a, tele(7), 5000), 'telemetry', 'a telemetry frame is recognised');
  eq([bins(b).length - tb, bins(a).length - ta, bins(s).length - ts], [0, 0, 1], 'telemetry goes to spectators only, never to other players');
  eq(Array.from(bins(s).at(-1).subarray(0, 3)), [0, RELAY_TAG_TELEMETRY, 0], 'with the sender id first');
  const late = r.watch('Late');
  check(bins(late).some(m => m[0] === 0 && m[1] === RELAY_TAG_TELEMETRY), 'a late spectator gets the last telemetry frame in the snapshot');
  // events are kept, bounded
  for (let i = 0; i < EVENT_RING + 20; i++) r.say(a, { t: 'ev', k: 'lap', n: i }, 3000 + i * 100);
  const evs = jsons(r.watch('Later'), 'ev');
  eq(evs.length, EVENT_RING, 'the event snapshot is bounded');
  eq(evs.at(-1).n, EVENT_RING + 19, 'and holds the newest');
  // a player leaving
  r.drop(b);
  check(jsons(s, 'bye').some(m => m.id === 1), 'spectators hear that a player left');
  const after = r.watch('After');
  check(!bins(after).some(m => m[0] === 1), 'a player who left is not in the next snapshot');
  // a spectator leaving
  const na = a.out.length;
  r.drop(s);
  eq(a.out.slice(na).map(m => m.t), ['spec'], 'a spectator leaving costs players one spec message and no bye');
  eq(a.out.at(-1).n, 3, 'with the new count');
}
{ // limits apply to spectators too
  const r = makeRoom();
  r.join('A', 'a', true);
  const s = r.watch();
  eq(r.say(s, { t: 'x', pad: 'y'.repeat(MAX_BYTES) }), 'big', 'an oversized spectator frame is dropped');
  let ok = 0;
  for (let i = 0; i < 200; i++) if (r.say(s, { t: 'ping', n: i }, 9000) === 'pong') ok++;
  check(ok >= RATE - 2 && ok <= RATE + 1, `a ping flood from a spectator is rate limited (${ok} of 200)`);
  // idle spectators are swept like players
  const r2 = makeRoom();
  r2.join('A', 'a', true); const s2 = r2.watch('S', 1000);
  eq(sweep(r2, 1000 + 61000), 2, 'sockets silent for 60 s are closed, spectators included');
  check(s2.closed?.code === 4008, 'with 4008');
}
{ // room details from the host
  eq(cleanMeta({ mode: 'Online race', laps: 5, started: true }), { mode: 'Online race', laps: 5, started: true }, 'meta passes');
  eq(cleanMeta({ mode: '<b>Race</b>\u0000 with a very long name', laps: 99999, started: 'yes', evil: 1 }), { mode: 'bRaceb with a ver'.slice(0, 16), laps: 999 }, 'meta is cleaned: tags stripped, mode cut to 16, laps clamped, unknown and wrong typed fields dropped');
  eq(cleanMeta({ laps: -5 }), { laps: 0 }, 'negative laps become 0');
  eq(cleanMeta({ laps: NaN, mode: 5 }), {}, 'NaN and non strings are dropped');
  eq(cleanMeta(null, { mode: 'keep' }), { mode: 'keep' }, 'junk keeps the old details');
  const r = makeRoom();
  const h = r.join('Host', 'h', true), g = r.join('Guest', 'g'), s = r.watch();
  eq(r.say(g, { t: 'meta', mode: 'Mine', laps: 2, started: true }), 'ignored', 'a guest cannot set the room details');
  check(!lobbyEntry(r).started && lobbyEntry(r).mode === 'Free practice', 'so the entry is unchanged');
  r.notes.length = 0;
  eq(r.say(h, { t: 'meta', mode: 'Online race', laps: 5, started: false }), 'forwarded', 'the host sets them');
  check(jsons(g, 'meta').length === 1 && jsons(s, 'meta').length === 1, 'players and spectators are told');
  eq(jsons(s, 'meta')[0], { t: 'meta', mode: 'Online race', laps: 5, started: false, from: 0 }, 'as a cleaned meta message');
  check(r.notes.length === 1 && r.notes[0].urgent === false, 'an ordinary change is not urgent for the directory');
  r.say(h, { t: 'meta', started: true });
  check(r.notes.at(-1).urgent === true, 'the start of a race is urgent for the directory');
  const e = lobbyEntry(r);
  eq([e.mode, e.laps, e.started, e.host, e.count, e.max, e.spectators], ['Online race', 5, true, 'Host', 2, 8, 1], 'the lobby entry carries mode, laps, status, host, players, spectators');
  eq(r.watch('M').out[0].meta?.mode, 'Online race', 'a new spectator welcome carries the details');
  // the host's meta in the join message
  const r3 = makeRoom();
  const hc = r3.connect(); r3.say(hc, { t: 'join', name: 'H', id: 'h', host: true, meta: { mode: 'Time trial', laps: 3 } });
  eq(lobbyEntry(r3).mode, 'Time trial', 'meta in the host join is taken');
  // the room keeps its host key after the host leaves: nobody else can take it, so the old room stays empty
  r3.drop(hc);
  const hc2 = r3.join('H2', 'h2', true);
  eq(hc2.closed && hc2.closed.reason, 'taken', 'a new host cannot take a room that has had a host, without its key');
  check(lobbyEntry(r3) === null, 'and the room is empty in the lobby');
  // a fresh room starts clean
  const r4 = makeRoom();
  r4.join('H3', 'h3', true);
  eq(lobbyEntry(r4).mode, 'Free practice', 'a new room starts with no old details');
}

// ================= 2. directory =================
{
  const d = new Directory(1000);
  const entry = (n = 2, over = {}) => ({ host: 'Alice', players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), mode: 'Race', laps: 5, started: false, spectators: 3, ...over });
  check(d.update('ABCDE', entry(), 100), 'an entry is accepted');
  const l = d.list(100)[0];
  eq([l.code, l.host, l.count, l.max, l.mode, l.laps, l.started, l.spectators, l.players.length], ['ABCDE', 'Alice', 2, 8, 'Race', 5, false, 3, 2], 'listed with every field');
  eq(Object.keys(l).sort(), ['code', 'count', 'createdAt', 'host', 'laps', 'max', 'mode', 'players', 'spectators', 'started'], 'and nothing else is exposed');
  d.update('ABCDE', entry(3, { started: true }), 500);
  eq(d.get('ABCDE', 500).createdAt, 100, 'an update keeps the creation time');
  eq([d.get('ABCDE', 500).count, d.get('ABCDE', 500).started], [3, true], 'and changes the rest');
  eq(d.get('ABCDE', 1600), null, 'an entry nobody refreshed for the TTL is gone');
  d.update('ZZZZZ', entry(), 2000); d.update('YYYYY', entry(), 2100); d.update('XXXXX', entry(), 2200);
  eq(d.list(2300).map(e => e.code), ['XXXXX', 'YYYYY', 'ZZZZZ'], 'newest first');
  check(!d.update('abc', entry(), 1), 'a bad code is refused');
  check(!d.update('ABCDEF', entry(), 1) && !d.update('AB1DE', entry(), 1), 'so are codes of the wrong shape');
  check(!d.update('WWWWW', null, 1) && !d.update('WWWWW', { players: [] }, 1) && !d.update('WWWWW', { players: 'x' }, 1), 'junk and empty entries are refused');
  const hostile = { host: '<script>alert(1)</script>'.repeat(5), players: Array.from({ length: 50 }, () => ({ name: '\u0000<b>x</b>'.repeat(20) })), mode: 'x'.repeat(100), laps: 1e9, started: 'true', spectators: -5 };
  d.update('VVVVV', hostile, 3000);
  const h = d.get('VVVVV', 3000);
  eq([h.players.length, h.laps, h.started, h.spectators, h.mode.length <= 16, h.host.length <= 16, /[<>]/.test(JSON.stringify(h))], [8, 999, false, 0, true, true, false], 'a hostile entry is clamped and cleaned');
  d.remove('VVVVV');
  eq(d.get('VVVVV', 3000), null, 'remove');
  d.update('UUUUU', entry(), 3000);
  const dump = d.dump(), d2 = new Directory(1000); d2.load(JSON.parse(JSON.stringify(dump)));
  eq(d2.list(3000).map(e => e.code).sort(), d.list(3000).map(e => e.code).sort(), 'dump and load survive a round trip (the Durable Object storage)');
  d2.load({ 'bad': { players: [] }, ABCDE: 5, QQQQQ: { players: [{ name: 'x' }], count: 1, max: 8, mode: 'Race', laps: 1, started: false, spectators: 0, at: 1, createdAt: 1 } });
  eq(d2.list(1).map(e => e.code), ['QQQQQ'], 'load drops garbage');
  const big = new Directory(1e9);
  for (let i = 0; i < 700; i++) big.update(String.fromCharCode(65 + (i % 24)) + String.fromCharCode(65 + (Math.floor(i / 24) % 24)) + String.fromCharCode(65 + (Math.floor(i / 576))) + 'AA', entry(), i);
  check(big.rooms.size <= 500, `the directory is bounded (${big.rooms.size})`);
  check(DIRECTORY_TTL_MS >= 60000, 'the TTL is at least a minute (rooms heartbeat every 30 s)');
}
{ // the publisher
  const sent = []; let entry = { n: 1 };
  const p = new Publisher({ entry: () => entry, send: e => sent.push(e), minMs: 5000, beatMs: 30000 });
  p.poke(true, 0); eq(sent.length, 1, 'an urgent update goes at once');
  p.poke(false, 1000); eq(sent.length, 1, 'an ordinary one inside 5 s waits');
  eq(p.due(1000), 4000, 'and says when');
  p.tick(3000); eq(sent.length, 1, 'tick before the time does nothing');
  p.tick(5000); eq(sent.length, 2, 'tick sends it when due');
  p.tick(20000); eq(sent.length, 2, 'no heartbeat before 30 s');
  p.tick(35000); eq(sent.length, 3, 'a heartbeat after 30 s');
  p.poke(true, 36000); p.poke(true, 36001); eq(sent.length, 5, 'urgent ones are never held back');
  entry = null; p.poke(true, 40000);
  eq(sent.at(-1), null, 'an empty room tells the directory once');
  p.poke(true, 50000); p.tick(200000);
  eq(sent.length, 6, 'and then stays quiet');
  eq(p.due(1e6), null, 'with nothing due');
}

// ================= 3. dev relay end to end =================
const relay = await startRelay({ port: 0, publishMs: 100, beatMs: 400, ttl: 1500, cfg: { maxSpectators: 3 } });
const http = `http://127.0.0.1:${relay.port}`, ws = `ws://127.0.0.1:${relay.port}`;
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(20); } return false; };
const lobbies = async () => (await fetch(`${http}/lobbies`)).json();
let fleet = null;
try {
  eq(await lobbies(), [], 'no lobbies at the start');
  const nf = await fetch(`${http}/lobbies/ABCDE`); check(nf.status === 404, 'GET /lobbies/CODE of a closed room is 404');
  fleet = startBots({ url: ws, code: 'RACEA', count: 4, laps: 3 });
  check(await until(async () => (await lobbies()).some(l => l.code === 'RACEA' && l.count === 4)), 'four bots make a listed lobby with 4 players');
  const l = (await lobbies()).find(x => x.code === 'RACEA');
  eq([l.host, l.mode, l.laps, l.started, l.max], ['Alice', 'Race', 3, true, 8], 'the entry shows host, mode, laps, status (the bots are racing)');
  eq(l.players.map(p => p.name), ['Alice', 'Bram', 'Chiara', 'Dev'], 'and the player names');
  const one = await (await fetch(`${http}/lobbies/RACEA`)).json();
  eq(one.code, 'RACEA', 'GET /lobbies/CODE gives one lobby');
  const cors = await fetch(`${http}/lobbies`, { headers: { Origin: 'https://x.example' } });
  check(cors.headers.get('access-control-allow-origin') === 'https://x.example', 'the list answers cross origin requests (the live page is on another host than the relay)');

  // a real spectator through the page's own modules
  const ghosts = new Ghosts(null, { max: 8 });
  const track = buildTrack();
  const model = new RaceModel({ length: track.length, sectors: track.sectors });
  const status = [], telem = [];
  const room = new SpectatorRoom({ url: ws, code: 'RACEA', ghosts, model, handlers: { onStatus: s => status.push(s), onSpectators: n => telem.push(n) }, WebSocket: globalThis.WebSocket });
  room.start();
  check(await until(() => status.includes('live')), 'the spectator room goes live');
  check(await until(() => model.rows().length === 4), 'all four cars arrive in the model');
  check(await until(() => ghosts.size === 4), 'and in the ghosts (the game interpolation)');
  eq(model.meta, { mode: 'Race', laps: 3, started: true }, 'the race details arrive');
  check(await until(() => model.rows().every(r => r.livery && r.livery.name)), 'liveries (with the driver names) arrive');
  eq(model.rows().map(r => r.livery.body).sort(), BOTS.slice(0, 4).map(b => b.body).sort(), 'with the right colours');
  check(await until(() => model.rows().every(r => r.tele), 6000), 'telemetry arrives once somebody watches (the bots only send while the room has a spectator)');
  const tl = model.rows()[0].tele;
  check(tl.speed >= 0 && tl.throttle >= 0 && tl.throttle <= 1 && tl.gear >= 1, `with sane values (speed ${tl.speed.toFixed(1)}, gear ${tl.gear})`);
  check(telem.includes(1), 'the spectator count is reported');
  eq((await lobbies()).find(x => x.code === 'RACEA').count, 4, 'the spectator does not count as a player in the directory');
  check(await until(async () => (await lobbies()).find(x => x.code === 'RACEA').spectators === 1), 'but is counted as a spectator');
  const p0 = model.rows().map(r => r.dist);
  await wait(2500);
  const p1 = model.rows().map(r => r.dist);
  check(p1.every((d, i) => d > p0[i] + 10), 'the cars move: every car gained more than 10 m in 2.5 s');
  const pose = ghosts.map.get('r0').buf.sample(performance.now(), {});
  check(pose && Number.isFinite(pose.x) && Number.isFinite(pose.h), 'a pose can be sampled from the interpolation');
  const rows = model.rows();
  eq(rows.map(r => r.pos), [1, 2, 3, 4], 'positions are 1 to 4');
  check(rows.every((r, i) => !i || rows[i - 1].dist >= r.dist), 'ordered by distance in a race');

  // a second and third watcher, then the limit of 3
  const extra = [];
  for (let i = 0; i < 4; i++) { const w = new WebSocket(`${ws}/room/RACEA?spectator=1`); const o = { w, msgs: [], closed: null }; w.addEventListener('message', e => { if (typeof e.data === 'string') o.msgs.push(JSON.parse(e.data)); }); w.addEventListener('close', e => { o.closed = e.code; }); w.addEventListener('open', () => w.send(JSON.stringify({ t: 'join', name: 'W' + i }))); extra.push(o); await wait(100); }
  check(extra.slice(0, 2).every(o => o.msgs.some(m => m.t === 'welcome' && m.spectator)), 'two more spectators are welcome (three in all)');
  check(await until(() => extra[2].closed === 4001) && extra[2].msgs.some(m => m.t === 'full' && m.spectator), 'the fourth is refused with full (the limit is 3 in this test)');
  const nine = new WebSocket(`${ws}/room/RACEA`); const nm = []; nine.addEventListener('message', e => { if (typeof e.data === 'string') nm.push(JSON.parse(e.data)); }); nine.addEventListener('open', () => nine.send(JSON.stringify({ t: 'join', name: 'P', id: 'x' })));
  check(await until(() => nm.some(m => m.t === 'welcome')), 'players can still join while spectators fill their own seats (5 of 8)');
  nine.close();
  // a spectator of a room that does not exist
  const none = new WebSocket(`${ws}/room/NOONE?spectator=1`); const nn = [];
  none.addEventListener('message', e => { if (typeof e.data === 'string') nn.push(JSON.parse(e.data)); }); none.addEventListener('open', () => none.send(JSON.stringify({ t: 'join', name: 'S', spectator: true })));
  check(await until(() => nn.some(m => m.t === 'nohost')), 'a spectator of a room nobody opened gets nohost');
  for (const o of extra) o.w.close();

  // the page's lobby list reader
  const got = await fetchLobbies(http);
  check(got.lobbies.some(x => x.code === 'RACEA') && got.ping >= 1, `fetchLobbies reads the list and measures the ping (${got.ping} ms)`);
  eq(await findRelay('?relay=ws://localhost:8787/'), 'ws://localhost:8787', 'findRelay: the address bar wins');
  eq(await findRelay('', async () => ({ ok: true, json: async () => ({ relay: 'wss://r.example/' }) })), 'wss://r.example', 'findRelay: multiplayer.json');
  eq(await findRelay('', async () => { throw new Error('offline'); }), '', 'findRelay: nothing found is an empty string');
  eq(await findRelay('?relay=http://evil', async () => ({ ok: false })), '', 'findRelay: a non websocket address is not taken');
  eq(httpBase('wss://a.example'), 'https://a.example', 'httpBase');

  // dropping out: the room closes, the lobby disappears
  room.stop();
  fleet.stop(); fleet = null;
  check(await until(async () => !(await lobbies()).some(x => x.code === 'RACEA'), 3000), 'when everybody has left the lobby is gone from the list');
  // an entry nobody refreshes expires: a room whose host goes silent
  const lone = startBots({ url: ws, code: 'IDLEA', count: 1 });
  check(await until(async () => (await lobbies()).some(x => x.code === 'IDLEA')), 'a one car lobby is listed');
  lone.stop();
  check(await until(async () => !(await lobbies()).some(x => x.code === 'IDLEA')), 'and removed when it leaves');
} catch (e) { fails++; console.log('  exception', e); }
if (fleet) fleet.stop();
relay.close();

// ---- the shared lobby cleaner ----
{
  eq(cleanLobby(null), null, 'cleanLobby: null'); eq(cleanLobby({ code: 'abc' }), null, 'cleanLobby: bad code');
  const c = cleanLobby({ code: 'ABCDE', host: '<i>H</i>', players: [{ name: 'a' }, null, { name: 5 }], count: 99, max: 99, mode: 'm'.repeat(40), laps: -3, started: 1, spectators: 1e6 });
  eq([c.host, c.players, c.count, c.max, c.mode.length, c.laps, c.started, c.spectators], ['iH/i', ['a', 'Player', '5'], 8, 8, 16, 0, false, 50], 'cleanLobby clamps and cleans what a server sends');
}

// ---- telemetry codec ----
{
  const t = { speed: 83.4, rpm: 7421, gear: 5, throttle: 0.8, brake: 0, steer: -0.5, tc: true, abs: false, esc: true, drs: true, pit: false, surf: [0, 5, 6, 0], latG: -2.5, longG: 1.2 };
  const u = encodeTelemetry(t), d = decodeTelemetry(u);
  eq(u.length, TELEMETRY_BYTES, 'a telemetry frame is 14 bytes');
  near(d.speed, 83.4, 0.01, 'speed round trip'); eq(d.rpm, 7421, 'rpm'); eq(d.gear, 5, 'gear'); near(d.throttle, 0.8, 0.005, 'throttle'); near(d.steer, -0.5, 0.01, 'steer');
  eq([d.tc, d.abs, d.esc, d.drs, d.pit], [true, false, true, true, false], 'flags'); eq(d.surf, [0, 5, 6, 0], 'wheel surfaces'); near(d.latG, -2.5, 0.05, 'lateral g'); near(d.longG, 1.2, 0.05, 'longitudinal g');
  eq(decodeTelemetry(new Uint8Array(5)), null, 'a short frame is refused'); eq(decodeTelemetry(new Uint8Array(14)), null, 'a wrong tag is refused'); eq(decodeTelemetry('x'), null, 'not bytes is refused');
  const junk = encodeTelemetry({ speed: NaN, rpm: Infinity, gear: 99, throttle: 7, brake: -1, steer: 9, surf: 'no', latG: 1e9 });
  const j = decodeTelemetry(junk);
  check(j.speed === 0 && j.rpm === 0 && j.gear === 12 && j.throttle === 1 && j.brake === 0 && Math.abs(j.steer) <= 1 && j.surf.every(s => s >= 0 && s <= 15), 'junk values are clamped on the way in');
  const longer = new Uint8Array(20); longer.set(u); check(decodeTelemetry(longer)?.gear === 5, 'a longer frame (a later version) still reads');
  const r = new Uint8Array(14); for (let i = 0; i < 200; i++) { for (let k = 1; k < 14; k++) r[k] = (Math.random() * 256) | 0; r[0] = TAG_TELEMETRY; const x = decodeTelemetry(r); if (!x || Math.abs(x.steer) > 1 || x.throttle > 1 || x.gear < -1 || x.gear > 12) { check(false, 'random bytes decode to a valid object'); break; } }
}

// ================= 4. the model =================
const L = 3800, SEC = [0, 1200, 2500];
// a fake car: speed in m/s along the lap, state packets every 100 ms on its own clock
function drive(model, ids, { secs = 60, v = {}, t0 = {}, s0 = {}, lap0 = {}, bl = {}, ll = {}, dt = 0.1, clock = {} }) {
  const cars = ids.map(id => ({ id, s: s0[id] ?? 0, lap: lap0[id] ?? 1, v: v[id] ?? 50 }));
  for (let t = 0; t < secs; t += dt) {
    for (const c of cars) {
      const sp = typeof c.v === 'function' ? c.v(t) : c.v;
      c.s += sp * dt;
      if (c.s >= L) { c.s -= L; c.lap++; }
      const ts = (t0[c.id] ?? 100000) + t * 1000;                 // the sender's own clock, different for every car
      const tc = 5000 + t * 1000 + (clock[c.id] ?? 0);            // the common clock
      model.state(c.id, { t: ts, x: 0, y: 0, z: 0, h: 0, vx: sp, vz: 0, yr: 0, st: 0, w: 0, thr: 1, brk: 0, pz: 0, rx: 0, col: 0, lap: c.lap, s: c.s, name: c.id, bl: bl[c.id] ?? 0, ll: ll[c.id] ?? 0 }, tc);
    }
  }
  return cars;
}
{
  const m = new RaceModel({ length: L, sectors: SEC });
  m.addDriver('A', 'Ann'); m.addDriver('B', 'Ben'); m.addDriver('C', 'Cat');
  m.setMeta({ mode: 'Race', laps: 5, started: true });
  check(m.events.some(e => e.kind === 'start'), 'the start of a race is an event');
  // A leads, B 1.0 s behind at the same speed (50 m), C 2.5 s behind. They start at different distances.
  drive(m, ['A', 'B', 'C'], { secs: 20, v: { A: 50, B: 50, C: 50 }, s0: { A: 1000, B: 950, C: 875 }, t0: { A: 1e5, B: 7e7, C: 3e3 }, bl: { A: 90 }, ll: { A: 90.5 } });
  const r = m.rows();
  eq(r.map(x => x.id), ['A', 'B', 'C'], 'ordered by distance in a race');
  near(r[1].gap, 1.0, 0.12, 'gap of B to the leader (50 m at 50 m/s is 1 s, different sender clocks)');
  near(r[2].gap, 2.5, 0.12, 'gap of C to the leader');
  near(r[2].interval, 1.5, 0.15, 'interval of C to the car in front');
  eq(r[0].gap, '', 'the leader has no gap');
  check(r[0].fastest && !r[1].fastest, 'the fastest lap holder is marked'); eq(r[0].best, 90, 'best lap'); eq(r[0].last, 90.5, 'last lap');
  check(m.events.some(e => e.kind === 'fastest' && /1:30\.000, A/.test(e.text)), 'a fastest lap event: ' + m.events.find(e => e.kind === 'fastest')?.text);
  // a lapped car
  const m2 = new RaceModel({ length: L, sectors: SEC });
  m2.setMeta({ mode: 'Race', laps: 9, started: true });
  drive(m2, ['A', 'B'], { secs: 4, v: { A: 60, B: 60 }, s0: { A: 100, B: 100 }, lap0: { A: 3, B: 2 } });
  eq(m2.rows()[1].gap, '+1 lap', 'a car a lap down shows +1 lap');
  eq(fmtGap(1.2345), '+1.234', 'gap text'); eq(fmtGap(''), '', 'no gap'); eq(fmtGap('+1 lap'), '+1 lap', 'a text gap passes'); eq(fmtTime(94.2215), '1:34.222', 'lap time text'); eq(fmtTime(0), '--', 'no time'); eq(fmtTime(9.5), '9.500', 'short time');
}
{ // sectors and laps
  const m = new RaceModel({ length: L, sectors: SEC });
  m.setMeta({ mode: 'Free practice', laps: 0, started: false });
  // two cars, 2 laps each; A is quick, B slower in sector 1 only
  const sp = { A: () => 60, B: t => 60 };
  const cars = { A: { s: 3700, lap: 0, v: 60 }, B: { s: 3700, lap: 0, v: 60 } };
  // sector 1 is 1200 m: A at 60 m/s takes 20 s; B at 55 takes 21.8 s; sector 2 (1300 m) and 3 (1300 m) the same speed for both
  const speed = (id, s) => (id === 'B' && s < 1200 ? 55 : 60);
  for (let t = 0; t < 140; t += 0.1) for (const id of ['A', 'B']) {
    const c = cars[id], v = speed(id, c.s); c.s += v * 0.1;
    if (c.s >= L) { c.s -= L; c.lap++; }
    m.state(id, { t: 1e6 * (id === 'A' ? 1 : 3) + t * 1000, x: 0, y: 0, z: 0, h: 0, vx: v, vz: 0, yr: 0, st: 0, w: 0, thr: 1, brk: 0, pz: 0, rx: 0, col: 0, lap: c.lap, s: c.s, name: id, bl: 0, ll: 0 }, 1000 + t * 1000);
  }
  const rows = Object.fromEntries(m.rows().map(r => [r.id, r]));
  near(rows.A.sectors[0].t, 20, 0.01, 'sector 1 time of A, exact on the sender clock'); near(rows.B.sectors[0].t, 1200 / 55, 0.01, 'sector 1 time of B');
  near(rows.A.sectors[1].t, 1300 / 60, 0.01, 'sector 2 time'); near(rows.A.sectors[2].t, 1300 / 60, 0.01, 'sector 3 time (the last one runs over the line)');
  eq(rows.A.sectors.map(s => s.c), ['purple', 'purple', 'purple'], 'the fastest sectors are purple');
  eq([rows.B.sectors[0].c, rows.B.sectors[2].c], ['green', 'purple'], 'B: sector 1 is its own best but A was faster (green), sector 3 ties the best (purple)');
  // a slower second lap makes yellow
  const m3 = new RaceModel({ length: L, sectors: SEC });
  const c3 = { s: 3700, lap: 0 };
  for (let t = 0; t < 200; t += 0.1) { const v = t < 100 ? 60 : 50; c3.s += v * 0.1; if (c3.s >= L) { c3.s -= L; c3.lap++; } m3.state('A', { t: t * 1000, x: 0, y: 0, z: 0, h: 0, vx: v, vz: 0, yr: 0, st: 0, w: 0, thr: 1, brk: 0, pz: 0, rx: 0, col: 0, lap: c3.lap, s: c3.s, name: 'A', bl: 0, ll: 0 }, t * 1000); }
  eq(m3.rows()[0].sectors.map(s => s.c), ['yellow', 'yellow', 'yellow'], 'a slower lap shows yellow in every sector');
  near(m3.bestSec[0], 20, 0.01, 'while the best sector times are kept from the quick lap');
  eq(m3.rows()[0].sectors.filter(s => s.t > 0).length, 3, 'all three sectors are timed');
  // in practice the order is by best lap
  const m4 = new RaceModel({ length: L, sectors: SEC });
  m4.setMeta({ mode: 'Free practice', laps: 0, started: false });
  drive(m4, ['X', 'Y', 'Z'], { secs: 5, v: { X: 50, Y: 52, Z: 51 }, s0: { X: 500, Y: 100, Z: 300 }, bl: { X: 95, Y: 0, Z: 93 } });
  eq(m4.rows().map(r => r.id), ['Z', 'X', 'Y'], 'outside a race the order is by best lap, no lap last');
  near(m4.rows()[1].gap, 2, 0.001, 'and the gap is the lap time difference');
}
{ // finish, join and leave, lost signal, resets
  const m = new RaceModel({ length: L, sectors: SEC });
  m.setMeta({ mode: 'Race', laps: 2, started: true });
  drive(m, ['A', 'B'], { secs: 130, v: { A: 70, B: 68 }, s0: { A: 3700, B: 3690 }, lap0: { A: 0, B: 0 } });
  const fin = m.events.filter(e => e.kind === 'finish');
  eq(fin.map(e => e.text), ['A finishes P1', 'B finishes P2'], 'finish events in finishing order');
  eq(m.rows().map(r => [r.id, r.finished]), [['A', true], ['B', true]], 'finished cars are marked and keep their order');
  m.removeDriver('B'); check(m.events.at(-1).text === 'B left', 'a leave event'); m.addDriver('C', 'Cy'); check(m.events.at(-1).text === 'Cy joined', 'a join event');
  m.setMeta({ started: false }); check(m.events.at(-1).kind === 'end', 'the end of the race is an event');
  const rows = m.rows(1e9); check(rows.every(r => !r.signal), 'a car silent for 3 s has no signal');
  // a reset (the car is put back): timing restarts, no crash, no absurd sector time
  const n = new RaceModel({ length: L, sectors: SEC });
  const st = (t, lap, s) => ({ t, x: 0, y: 0, z: 0, h: 0, vx: 50, vz: 0, yr: 0, st: 0, w: 0, thr: 1, brk: 0, pz: 0, rx: 0, col: 0, lap, s, name: 'A', bl: 0, ll: 0 });
  n.state('A', st(0, 1, 1000), 0); n.state('A', st(100, 1, 1005), 100); n.state('A', st(200, 1, 400), 200); n.state('A', st(300, 1, 405), 300);
  check(n.rows()[0].sectors.every(s => !s.t), 'a reset gives no sector times'); n.state('A', st(300, 1, 410), 400); eq(n.rows()[0].s, 405, 'a duplicate time stamp is ignored');
  n.state('A', st(50, 1, 420), 500); eq(n.rows()[0].s, 405, 'and so is an older one');
  // ring size and events are bounded
  for (let i = 0; i < 200; i++) n.event('join', null, 'x'); check(n.events.length <= 60, 'the feed is bounded');
  // hostile numbers
  const h = new RaceModel({ length: L, sectors: SEC });
  h.state('A', st(0, 1, 100), 0); h.state('A', st(100, 9999, 99999), 100); check(Number.isFinite(h.rows()[0].dist), 'wild lap and distance values do not break the model');
}

// ================= 5. TV director =================
{
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tv = new TVDirector({ random: rnd, spots: 8 });
  const mk = (id, dist, speed, extra = {}) => ({ id, dist, speed, signal: true, finished: false, ...extra });
  // a field strung out over 1 km, nobody close: the leader, held 7 to 12 s
  const field = () => [mk('A', 5000, 60), mk('B', 4400, 60), mk('C', 3800, 60), mk('D', 3000, 60)];
  const log = [];
  for (let t = 0; t < 120; t += 0.25) { const s = tv.update(t, field(), { started: false }); if (!log.length || log.at(-1).shot !== s) log.push({ t, shot: s }); }
  check(log.length >= 6 && log.length <= 17, `a quiet field is cut every 7 to 12 s (${log.length} shots in 2 minutes)`);
  const holds = log.slice(0, -1).map((x, i) => log[i + 1].t - x.t);
  check(holds.every(h => h >= HOLD.min - 0.01 && h <= HOLD.max + 0.5), `every hold is between ${HOLD.min} and ${HOLD.max} s: ${holds.map(h => h.toFixed(1)).join(' ')}`);
  check(log.slice(1).every((x, i) => x.shot.id !== log[i].shot.id), 'never the same car twice in a row');
  check(new Set(log.map(x => x.shot.kind)).size >= 3, 'the kind of camera changes: ' + [...new Set(log.map(x => x.shot.kind))].join(', '));
  check(log.every(x => x.shot.spot >= 0 && x.shot.spot < 8), 'trackside spots are in range');
  // a battle
  const tv2 = new TVDirector({ random: rnd, spots: 8 });
  const battle = () => [mk('A', 5000, 60), mk('B', 4400, 60), mk('C', 4380, 61), mk('D', 3000, 60)];
  let first = null;
  for (let t = 0; t < 30; t += 0.25) { const s = tv2.update(t, battle(), { started: false }); first ??= s; }
  eq(tv2.shot.why === 'battle' || tv2.shot.why === 'leader', true, 'with a battle on, the director shows it or the leader');
  let battleShown = false; for (let t = 30; t < 60; t += 0.25) { const s = tv2.update(t, battle(), { started: false }); if (s.why === 'battle' && s.id === 'C') battleShown = true; }
  check(battleShown, 'the car chasing in the battle is shown');
  // the shot is held at least the minimum, even when the situation changes
  const tv3 = new TVDirector({ random: rnd, spots: 8 });
  tv3.update(0, field(), { started: false });
  const s0 = tv3.shot;
  check(tv3.update(3, battle(), { started: false }) === s0, 'a battle appearing 3 s into a shot does not cut it');
  // an incident interrupts after 3 s
  const tv4 = new TVDirector({ random: rnd, spots: 8 });
  tv4.update(0, field(), { started: false });
  const stuck = [mk('A', 5000, 60), mk('B', 4400, 0.5), mk('C', 3800, 60), mk('D', 3000, 60)];
  check(tv4.update(1, stuck, { started: false }).why !== 'incident', 'an incident in the first 3 s waits');
  const inc = tv4.update(3.5, stuck, { started: false });
  eq([inc.why, inc.id], ['incident', 'B'], 'after 3 s the stopped car is shown');
  check(tv4.update(8, stuck, { started: false }) === inc, 'and held for the incident time'); 
  check(tv4.update(8 + HOLD.incident, field(), { started: false }) !== inc, 'then released');
  // a stopped car with the whole field stopped (red flag, lobby) is not an incident
  const tv5 = new TVDirector({ random: rnd, spots: 8 });
  tv5.update(0, field().map(r => ({ ...r, speed: 0 })), { started: false });
  check(tv5.shot.why !== 'incident', 'when everybody is stopped nothing is an incident');
  // the start
  const tv6 = new TVDirector({ random: rnd, spots: 8 });
  tv6.update(0, field(), { started: false });
  const st = tv6.update(1, field(), { started: true });
  eq([st.why, st.kind], ['start', 'trackside'], 'the lights going out cuts to a trackside view of the field');
  // the finish
  const tv7 = new TVDirector({ random: rnd, spots: 8 });
  tv7.update(0, field(), { started: true });
  const win = field(); win[1].finished = true;
  const f = tv7.update(HOLD.start + 1, win, { started: true });
  eq([f.why, f.id], ['finish', 'B'], 'the first car over the line is shown');
  // nobody there
  eq(tv7.update(500, field().map(r => ({ ...r, signal: false })), {}), null, 'no signal gives no shot');
  // a shown car that leaves
  const tv8 = new TVDirector({ random: rnd, spots: 8 });
  tv8.update(0, field(), {});
  const gone = field().filter(r => r.id !== tv8.shot.id);
  check(tv8.update(1, gone, {}).id !== undefined && gone.some(r => r.id === tv8.shot.id), 'when the shown car leaves the director cuts to one that is still there');
}

// ================= 6. cameras and the page files =================
{
  const track = buildTrack();
  const spots = trackSpots(track);
  eq(spots.length, 10, 'ten trackside cameras');
  let clear = true, apart = Infinity;
  for (const s of spots) { const i = Math.round(s.s / track.ds) % track.N; const d = Math.hypot(s.x - track.x[i], s.z - track.z[i]); if (d < track.halfWidth + 8) clear = false; }
  check(clear, 'every trackside camera stands well clear of the road');
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) apart = Math.min(apart, Math.abs(spots[i].s - spots[j].s));
  check(apart > 100, `the cameras are spread round the lap (closest pair ${apart.toFixed(0)} m)`);
  check(spots.every(s => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)), 'with real positions');
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  check(/live:\s*path\.join\(root, 'live\.html'\)/.test(vite), 'vite.config.js builds live.html next to index.html');
  check(/ARTIFACT \? \{ output: \{ inlineDynamicImports: true \} \} :/.test(vite), 'and the single file artifact build is left alone');
  const html = readFileSync(new URL('../live.html', import.meta.url), 'utf8');
  check(html.includes('src="/src/live/main.js"') && html.includes('width=device-width'), 'live.html loads the page script and has a phone viewport');
  eq(parseRoute('/lobbies'), { kind: 'lobbies' }, 'the lobbies route exists');
}

console.log(fails ? `live: ${fails} FAILED, ${passes} passed` : `live: all ${passes} checks passed`);
process.exit(fails ? 1 : 0);
