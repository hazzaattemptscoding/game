// Game side of the relay: src/relay.js (socket client and room) and the relay path of Multiplayer in src/multiplayer.js,
// tested with a fake WebSocket and a fake clock. No network. The server side is tested in tools/relay.js.
import { encodeState, decodeState, packState, unpackState, Ghosts, DELAY, RELAY_EXTRA_DELAY, MAX_DELAY, FIELDS } from '../src/ghosts.js';
import { RelayClient, RelayRoom, RELAY, cleanRelayUrl } from '../src/relay.js';
import { Multiplayer, BROKER, resolveConfig, applyConfigFile, brokerFromSearch } from '../src/multiplayer.js';
import { createRaceControl } from '../src/raceControl.js';
import { onOpen, onMessage, onClose, CLOSE } from '../worker/src/protocol.js';
import { fakeNetwork } from './lib/fakepeer.js';

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// a fake clock: timers fire in order when advance() passes them
function makeClock() {
  let now = 0, id = 0; const timers = new Map();
  const add = (f, ms, every) => { timers.set(++id, { f, at: now + ms, every }); return id; };
  return {
    setTimeout: (f, ms) => add(f, ms, 0), setInterval: (f, ms) => add(f, ms, ms),
    clearTimeout: i => timers.delete(i), clearInterval: i => timers.delete(i),
    now: () => now,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [i, t] of timers) if (t.at <= end && (!best || t.at < best[1].at)) best = [i, t];
        if (!best) break;
        const [i, t] = best; now = t.at;
        if (t.every) t.at += t.every; else timers.delete(i);
        t.f();
      }
      now = end;
    },
  };
}

// a fake WebSocket under manual control
function makeFakeWS() {
  const list = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; list.push(this); }
    send(d) { this.sent.push(d); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); }
    // test controls
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    got(o) { this.onmessage && this.onmessage({ data: typeof o === 'string' || o instanceof ArrayBuffer ? o : JSON.stringify(o) }); }
    drop() { this.readyState = 3; this.onclose && this.onclose({ code: 1006 }); }
    json() { return this.sent.filter(x => typeof x === 'string').map(x => JSON.parse(x)); }
  }
  FakeWS.list = list;
  return FakeWS;
}

const sample = (o = {}) => ({ t: 123456.5, x: 812.34, y: 1.25, z: -406.78, h: 1.571, vx: 30.12, vz: -4.5, yr: 0.123, st: -0.2, w: 3.14, thr: 0.8, brk: 0, pz: 0.01, rx: -0.02, col: 3, lap: 2, s: 1234.5, name: 'Ann', bl: 95.123, ll: 97.5, ...o });

// ---------------------------------------------------------------- 1. binary framing
console.log('FRAMING');
{
  const arr = encodeState(sample());
  const bin = packState(arr);
  check(bin instanceof Uint8Array && bin[0] === 1, 'a state packs into one binary frame');
  check(bin.length < 100, `the frame is small (${bin.length} bytes, JSON is about ${JSON.stringify(arr).length})`);
  const back = unpackState(bin);
  eq(back, arr, 'unpack gives back exactly what encodeState made');
  const st = decodeState(back);
  check(st && st.name === 'Ann' && st.lap === 2 && Math.abs(st.x - 812.34) < 1e-9 && st.bl === 95.123, 'and decodeState accepts it');
  const bin2 = packState(encodeState(sample({ name: 'Zoë 日本', x: -99999.5, t: 9e9, bl: 0, ll: 0 })));
  const st2 = decodeState(unpackState(bin2));
  check(st2.name === 'Zoë 日本' && st2.t === 9e9 && Math.abs(st2.x + 99999.5) < 0.01, 'UTF-8 names, big clocks and far positions survive');
  // through the relay's prefix byte and an ArrayBuffer, the way it arrives
  const framed = new Uint8Array(bin.length + 1); framed[0] = 5; framed.set(bin, 1);
  eq(decodeState(unpackState(new Uint8Array(framed.buffer).subarray(1))).name, 'Ann', 'works on a subarray view (offset in the buffer)');
  // random states
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const o = sample({ x: (rnd() - 0.5) * 4000, z: (rnd() - 0.5) * 4000, vx: (rnd() - 0.5) * 100, h: (rnd() - 0.5) * 6, s: rnd() * 5000, lap: Math.floor(rnd() * 20), t: Math.floor(rnd() * 1e7) });
    const a = encodeState(o), c = unpackState(packState(a));
    if (!c || JSON.stringify(c) !== JSON.stringify(a)) bad++;
  }
  eq(bad, 0, '300 random states round trip exactly');
  for (const junk of [null, new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array([9, ...bin.subarray(1)]), bin.subarray(0, bin.length - 1), new Uint8Array([...bin, 7])]) eq(unpackState(junk), null, 'bad frame rejected: ' + (junk ? junk.length + ' bytes' : junk));
  check(FIELDS.length === 17, 'the packed layout matches the 17 state fields');
  const nan = packState(encodeState(sample())); new DataView(nan.buffer).setFloat32(9, NaN);       // the x field
  eq(decodeState(unpackState(nan)), null, 'a NaN in a frame is rejected by decodeState');
}

// ---------------------------------------------------------------- 2. RelayClient: join, ping, backoff
console.log('CLIENT');
{
  const WS = makeFakeWS(), clock = makeClock(), ev = { welcome: [], json: [], bin: [], states: [], refused: [], rtt: [] };
  const c = new RelayClient({ url: 'wss://relay.example', code: 'ABCDE', name: 'Ann', host: true, token: 'tok1', WebSocket: WS, timers: clock,
    handlers: { onWelcome: (m, f) => ev.welcome.push(f), onJSON: m => ev.json.push(m), onBinary: (id, b) => ev.bin.push([id, Array.from(b)]), onState: s => ev.states.push(s), onRefused: k => ev.refused.push(k), onRtt: ms => ev.rtt.push(ms) } });
  c.connect();
  eq(WS.list.map(w => w.url), ['wss://relay.example/room/ABCDE?host=1'], 'connects to /room/<CODE>, host=1 on the first socket of a room it makes (the relay places the room)');
  WS.list[0].open();
  eq(WS.list[0].json(), [{ t: 'join', name: 'Ann', id: 'tok1', host: true }], 'sends join on open');
  check(WS.list[0].binaryType === 'arraybuffer', 'binary frames are read as ArrayBuffer');
  check(!c.sendBinary(new Uint8Array([1])), 'no state is sent before the welcome');
  WS.list[0].got({ t: 'welcome', you: 0, host: 0, players: [] });
  eq(ev.welcome, [true], 'welcome reported (first time)');
  // ping timing: one at once, then every 15 s
  const pings = () => WS.list[0].json().filter(m => m.t === 'ping');
  eq(pings().length, 1, 'first ping right after the welcome');
  clock.advance(14999); eq(pings().length, 1, 'no ping before 15 s');
  clock.advance(2); eq(pings().length, 2, 'ping at 15 s');
  clock.advance(15000); eq(pings().length, 3, 'ping at 30 s');
  clock.advance(15000); eq(pings().length, 4, 'ping at 45 s');
  // round trip time
  const last = pings().at(-1); clock.advance(36);
  eq(clock.now(), 45037, 'clock sanity');
  clock.advance(0);
  WS.list[0].got({ t: 'pong', n: last.n });
  eq(ev.rtt, [clock.now() - 45000], 'pong gives the round trip time in ms (ping sent at 45 s, answered 37 ms later)');
  WS.list[0].got({ t: 'pong', n: 9999 }); eq(ev.rtt.length, 1, 'an unknown pong is ignored');
  // incoming frames
  WS.list[0].got({ t: 'peer', id: 1, name: 'Bob' }); WS.list[0].got('garbage{'); WS.list[0].got({ x: 1 });
  eq(ev.json, [{ t: 'peer', id: 1, name: 'Bob' }], 'JSON control frames are passed on, garbage is not');
  WS.list[0].got(new Uint8Array([1, 7, 8, 9]).buffer);
  eq(ev.bin, [[1, [7, 8, 9]]], 'binary frame: first byte is the sender, the rest the payload');
  WS.list[0].got(new Uint8Array([1]).buffer); eq(ev.bin.length, 1, 'a frame with no payload is ignored');
  // sending binary, slow link
  check(c.sendBinary(new Uint8Array([4, 5])) && WS.list[0].sent.at(-1) instanceof Uint8Array, 'state goes out as a binary frame');
  WS.list[0].bufferedAmount = RELAY.MAX_BUFFERED + 1;
  check(!c.sendBinary(new Uint8Array([4, 5])), 'state is skipped, not queued, on a slow link');
  WS.list[0].bufferedAmount = 0;

  // reconnect backoff: the link drops, the delays grow 0.5, 1, 2, 4, 8, 8 s
  WS.list[0].drop();
  eq(ev.states.at(-1), 'reconnecting', 'a drop is reported as reconnecting');
  eq(WS.list.length, 1, 'no instant retry');
  const delays = [];
  for (let i = 0; i < 6; i++) {
    const n = WS.list.length; let waited = 0;
    while (WS.list.length === n && waited < 20000) { clock.advance(100); waited += 100; }
    delays.push(waited);
    WS.list.at(-1).drop();       // never opens
  }
  eq(delays, [500, 1000, 2000, 4000, 8000, 8000], 'backoff delays in ms');
  // it comes back: join again with the SAME token, backoff starts over
  { const n = WS.list.length; clock.advance(8000); eq(WS.list.length, n + 1, 'tries again'); const w = WS.list.at(-1); w.open();
    eq(w.url, 'wss://relay.example/room/ABCDE', 'a reconnect after the welcome has no host=1: the room exists, its place does not change');
    eq(w.json()[0], { t: 'join', name: 'Ann', id: 'tok1', host: true }, 'rejoins with the same token (keeps its slot)');
    w.got({ t: 'welcome', you: 0, host: 0, players: [] });
    eq(ev.welcome, [true, false], 'second welcome is not "first"');
    w.drop(); const m = WS.list.length; clock.advance(499); eq(WS.list.length, m, 'after a success the backoff starts at 0.5 s again (not yet)'); clock.advance(2); eq(WS.list.length, m + 1, '... and fires at 0.5 s'); }
  // dead link: no traffic for 40 s although pings go out
  { const w = WS.list.at(-1); w.open(); w.got({ t: 'welcome', you: 0, host: 0, players: [] });
    const n = WS.list.length; clock.advance(15000); clock.advance(15000); clock.advance(15000);
    check(w.readyState === 3 && WS.list.length === n || clock.advance(1000) === undefined && WS.list.length > n, 'silence for 40 s is treated as a dead link and reconnects'); }
  c.stop();
  const n = WS.list.length; clock.advance(60000);
  eq(WS.list.length, n, 'after stop() nothing reconnects');
}
{ // refusals are final: no reconnect
  for (const kind of ['full', 'nohost', 'taken']) {
    const WS = makeFakeWS(), clock = makeClock(), got = [];
    const c = new RelayClient({ url: 'wss://r', code: 'ABCDE', name: 'x', token: 't', WebSocket: WS, timers: clock, handlers: { onRefused: k => got.push(k) } });
    c.connect(); WS.list[0].open(); WS.list[0].got({ t: kind });
    clock.advance(30000);
    eq([got, WS.list.length], [[kind], 1], `${kind}: reported once, no reconnect`);
  }
  const WS = makeFakeWS(); const c = new RelayClient({ url: 'wss://r', code: 'ABCDE', token: 't', WebSocket: class { constructor() { throw new Error('blocked'); } }, timers: makeClock(), handlers: {} });
  c.connect(); check(true, 'a WebSocket constructor that throws does not crash the client');
}
{ // urls
  eq(cleanRelayUrl('wss://a.workers.dev'), 'wss://a.workers.dev', 'wss url kept');
  eq(cleanRelayUrl(' WSS://a.workers.dev/ '), 'wss://a.workers.dev', 'trailing slash and case cleaned');
  eq(cleanRelayUrl('ws://localhost:8787/'), 'ws://localhost:8787', 'ws on localhost allowed');
  eq(cleanRelayUrl('wss://h/base/'), 'wss://h/base', 'a base path is kept');
  for (const bad of ['https://a.example', '1', '', 'wss://', 'wss://a b', 'javascript:alert(1)', 'wss://a?x=1']) eq(cleanRelayUrl(bad), '', 'rejected: ' + bad);
  eq(brokerFromSearch('?relay=wss://r.example/').relayUrl, 'wss://r.example', '?relay=wss://... sets the relay address');
  check(brokerFromSearch('?relay=wss://r.example/').relayOnly === false, '... and is not mistaken for the TURN-only switch');
  check(brokerFromSearch('?relay=1').relayOnly === true && brokerFromSearch('?relay=1').relayUrl === '', '?relay=1 is still TURN only');
  eq(brokerFromSearch('?transport=peer').transport, 'peer', '?transport=peer'); eq(brokerFromSearch('?transport=relay').transport, 'relay', '?transport=relay'); eq(brokerFromSearch('?transport=junk').transport, 'auto', 'junk ignored');
  eq(applyConfigFile(BROKER, { relay: 'wss://f.example/' }).relayUrl, 'wss://f.example', 'multiplayer.json "relay"');
  eq(applyConfigFile(BROKER, { relay: 'https://f.example/' }).relayUrl, '', 'a non-websocket relay address in the file is ignored');
  eq(resolveConfig('?relay=wss://q.example', { relay: 'wss://f.example' }).relayUrl, 'wss://q.example', 'the address bar wins over the file');
  eq(BROKER.relayUrl, '', 'no relay by default');
}

// ---------------------------------------------------------------- 3. a fake relay server running the real protocol logic
function makeFakeServer() {
  const rooms = new Map(), sockets = [];
  const srv = { rooms, sockets, down: false, opens: 0 };
  srv.WS = class {
    constructor(url) {
      this.url = url; this.readyState = 0; this.bufferedAmount = 0; sockets.push(this);
      const code = /\/room\/([A-Z]{5})(?:\?|$)/.exec(url)[1];   // the URL may carry ?host=1 or ?spectator=1
      const room = rooms.get(code) || rooms.set(code, { list: [], conns: () => rooms.get(code).list }).get(code);
      setTimeout(() => {
        if (srv.down) { this.readyState = 3; this.onclose && this.onclose({}); return; }
        srv.opens++;
        this.readyState = 1;
        let att = {};
        const sock = this;
        this.conn = {
          mem: {}, get att() { return att; }, setAtt(o) { att = o; },
          send(x) { setTimeout(() => { if (sock.readyState !== 1) return; sock.onmessage && sock.onmessage({ data: typeof x === 'string' ? x : x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) }); }, 0); },
          close(code) { setTimeout(() => sock.shut(code), 0); },
        };
        this.room = room;
        room.list.push(this.conn);
        onOpen(this.conn, Date.now());
        this.onopen && this.onopen();
      }, 0);
    }
    send(d) { if (this.readyState !== 1) return; const x = typeof d === 'string' ? d : new Uint8Array(d); setTimeout(() => { if (this.conn) onMessage(this.room, this.conn, x, Date.now()); }, 0); }
    close() { if (this.readyState === 3) return; this.shut(1000, true); }
    shut(code, byClient) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const i = this.room ? this.room.list.indexOf(this.conn) : -1;
      if (i >= 0) { this.room.list.splice(i, 1); onClose(this.room, this.conn); }
      if (!byClient) this.onclose && this.onclose({ code });
    }
  };
  srv.kill = n => srv.sockets.filter(s => s.readyState === 1)[n].shut(1006);
  return srv;
}
const makePlayer = (cfg, srv, name, extra = {}) => {
  const ghosts = new Ghosts(null), statuses = [], rtts = [];
  const mp = new Multiplayer({ ghosts, config: { ...BROKER, ...cfg }, WebSocket: srv && srv.WS, loadPeer: async () => (extra.Peer || fakeNetwork()), onStatus: s => statuses.push(s), onRtt: ms => rtts.push(ms), random: rnd, now: () => Date.now(), ...extra });
  return { mp, ghosts, name, statuses, rtts, last: () => statuses[statuses.length - 1] };
};

// ---------------------------------------------------------------- 4. the same room logic over both transports
// One scenario, written against the Multiplayer public face only, run over the relay and over (fake) peer to peer.
async function scenario(label, make, expectTransport) {
  console.log(`ROOMS over ${label}`);
  const say = m => `[${label}] ${m}`;
  const a = make('Ann'), b = make('Bob'), c = make('Cy');
  await a.mp.host('Ann'); await wait(30);
  check(a.mp.phase === 'hosting' && /^[A-HJ-NP-Z]{5}$/.test(a.mp.code), say(`host gets a 5 letter code (${a.mp.code})`));
  check(a.last().transport === expectTransport && a.mp.transport === expectTransport, say(`status says transport ${expectTransport}`));
  await b.mp.join(a.mp.code.toLowerCase(), 'Bob'); await wait(60);
  await c.mp.join(a.mp.code, 'Cy'); await wait(120);
  check(b.mp.phase === 'joined' && c.mp.phase === 'joined', say('guests joined: ' + b.last().text + ' | ' + c.last().text));
  check(a.mp.players === 3 && b.mp.players === 3 && c.mp.players === 3, say(`everyone sees 3 players (${a.mp.players}, ${b.mp.players}, ${c.mp.players})`));
  eq([...b.mp.peers.values()].map(p => p.name).sort(), ['Ann', 'Cy'], say('names known to a guest'));
  eq([...a.mp.peers.values()].map(p => p.name).sort(), ['Bob', 'Cy'], say('names known to the host'));
  check(a.last().players === 3 && a.last().host === true && b.last().host === false, say('status carries players and host flag'));
  // car state both ways
  const t0 = Date.now();
  for (const [p, x] of [[a, 1], [b, 2], [c, 3]]) p.mp.sendState(encodeState(sample({ t: t0, x, name: p.name, lap: x })));
  await wait(60);
  const idsAt = p => [...p.ghosts.map.values()].map(g => g.info.x).sort();
  eq(idsAt(a), [2, 3], say('host sees both other cars'));
  eq(idsAt(b), [1, 3], say('guest sees the other two')); eq(idsAt(c), [1, 2], say('third sees the other two'));
  check([...a.ghosts.map.values()].every(g => g.info.col === 3 || g.col > 0), say('colours assigned'));
  check([...a.ghosts.map.values()].map(g => g.name).sort().join() === 'Bob,Cy', say('ghost names come from the state'));
  const rows = a.ghosts.standings({ name: 'Ann', lap: 1, s: 100, speed: 30 }, 5000);
  check(rows.length === 3, say('standings has 3 rows'));
  const want = expectTransport === 'relay' ? DELAY + RELAY_EXTRA_DELAY : DELAY;
  // the transport's ceiling is set as asked; each car's buffer settles inside it (the adaptive delay in ghosts.js moves with the jitter)
  check(Math.abs(a.ghosts.delay - want) < 1e-9 && [...a.ghosts.map.values()].every(g => g.buf.delay > 0 && g.buf.delay <= Math.max(MAX_DELAY, want) + 1e-9), say(`remote cars are drawn at most ${Math.round(want * 1000)} ms behind (ceiling)`));
  // rename
  b.mp.setName('Robert'); await wait(60);
  check([...a.mp.peers.values()].some(p => p.name === 'Robert') && [...c.mp.peers.values()].some(p => p.name === 'Robert'), say('a rename reaches everyone'));
  // a guest leaves
  c.mp.leave(); await wait(300);
  check(c.mp.phase === 'idle' && c.ghosts.size === 0, say('leaving clears the other cars'));
  check(a.mp.players === 2 && b.mp.players === 2 && a.ghosts.size === 1, say(`the others see the guest go (${a.mp.players}, ${b.mp.players}, ghosts ${a.ghosts.size})`));
  // the host leaves: the guest carries on
  a.mp.leave(); await wait(300);
  check(b.mp.players === 1 && b.mp.phase === 'joined' && b.ghosts.size === 0, say(`host left: the guest stays in the room alone (${b.mp.players}, ${b.mp.phase})`));
  b.mp.leave(); await wait(100);
  // wrong code
  const x = make('X'); await x.mp.join('ZZZZZ', 'X'); await wait(300);
  check(x.mp.phase === 'error' && !x.mp.active && /No room with the code ZZZZZ/.test(x.last().text), say('wrong code: a plain "no such room": ' + x.last().text));
  // short code
  const y = make('Y'); await y.mp.join('AB', 'Y'); await wait(30);
  check(y.mp.phase === 'error' && /5 letters/.test(y.last().text), say('short code: asks for 5 letters'));
  // a full room
  const h = make('H'); await h.mp.host('H'); await wait(30);
  const guests = [];
  for (let i = 0; i < 7; i++) { const g = make('G' + i); guests.push(g); await g.mp.join(h.mp.code, 'G' + i); await wait(60); }
  check(h.mp.players === 8, say(`eight fit (${h.mp.players})`));
  const nine = make('N'); await nine.mp.join(h.mp.code, 'N'); await wait(400);
  check(nine.mp.phase === 'error' && /full/i.test(nine.last().text), say('the ninth is told the room is full: ' + nine.last().text));
  check(h.mp.players === 8 && !nine.statuses.some(s => s.phase === 'joined'), say('and does not get in'));
  for (const g of guests) g.mp.leave(); h.mp.leave(); await wait(300);
  // garbage from outside must not break anything
  check(true, say('done'));
}
{
  const srv = makeFakeServer();
  await scenario('the relay', n => makePlayer({ relayUrl: 'wss://relay.test' }, srv, n), 'relay');
  check(srv.rooms.size >= 1 && [...srv.rooms.values()].every(r => r.list.length === 0), 'relay: every socket was closed again');
}
await scenario('peer to peer', (() => { const Peer = fakeNetwork(); return n => makePlayer({}, null, n, { loadPeer: async () => Peer }); })(), 'peer');

// ---------------------------------------------------------------- 5. host rules over the relay, rtt, reconnect inside a room
console.log('RELAY ROOM DETAILS');
{
  const srv = makeFakeServer();
  const a = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'A'), b = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'B');
  // two hosts on one code: the second picks another code by itself
  // first code is AAAAA twice
  const h1 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'H1', { random: () => 0.01 }), h2 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'H2', { random: (() => { let k = 0; return () => (k++ < 5 ? 0.01 : rnd()); })() });
  await h1.mp.host('H1'); await wait(30); await h2.mp.host('H2'); await wait(100);
  check(h1.mp.phase === 'hosting' && h2.mp.phase === 'hosting' && h1.mp.code !== h2.mp.code, `a taken code makes the second host pick another (${h1.mp.code}, ${h2.mp.code})`);
  h1.mp.leave(); h2.mp.leave(); await wait(50);
  // ping gives rtt to the lobby
  await a.mp.host('A'); await wait(30);
  check(a.rtts.length >= 1 && typeof a.mp.rtt === 'number' && a.last().transport === 'relay', 'the first ping gives a round trip time (' + a.mp.rtt + ' ms)');
  // a dropped connection inside a room: reconnect, same slot, room carries on
  await b.mp.join(a.mp.code, 'B'); await wait(60);
  check(a.mp.players === 2, 'two in the room');
  const before = srv.opens;
  srv.kill(1); await wait(30);                                    // B's socket dies
  check(b.last().reconnecting === true && /Reconnecting/.test(b.last().text) && b.mp.phase === 'joined', 'guest shows "reconnecting" and stays in the room');
  await wait(900);
  check(srv.opens === before + 1 && b.last().reconnecting === false && b.mp.phase === 'joined' && b.mp.players === 2, 'guest is back after the backoff, same room');
  check(a.mp.players === 2 && a.mp.peers.size === 1, 'the host never lost the guest (takeover keeps the slot)');
  b.mp.sendState(encodeState(sample({ t: Date.now(), x: 42, name: 'B' }))); await wait(40);
  check([...a.ghosts.map.values()].some(g => g.info.x === 42), 'state flows again after the reconnect');
  a.mp.leave(); b.mp.leave(); await wait(50);
  // the host closing the room: a guest who reconnects finds nobody hosting
  const h = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'H'), g = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'G');
  await h.mp.host('H'); await wait(30); await g.mp.join(h.mp.code, 'G'); await wait(60);
  const roomCode = h.mp.code;
  h.mp.leave(); await wait(60);
  check(g.mp.phase === 'joined' && g.mp.players === 1, 'host left, guest still in the (hostless) room');
  g.mp.leave(); await wait(30);
  const late = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'L'); await late.mp.join(roomCode, 'L'); await wait(100);
  check(late.mp.phase === 'error' && /No room with the code/.test(late.last().text), 'after the host has left a new guest gets "no such room": ' + late.mp.phase + ' ' + late.last().text);
  // the room's weather: the host's env message reaches the guests, a guest's does not
  const eh = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'EH'), e1 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'E1'), e2 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'E2');
  const gotEnv = { eh: [], e1: [], e2: [] };
  eh.mp.onControl = m => { if (m.t === 'env') gotEnv.eh.push(m); }; e1.mp.onControl = m => { if (m.t === 'env') gotEnv.e1.push(m); }; e2.mp.onControl = m => { if (m.t === 'env') gotEnv.e2.push(m); };
  await eh.mp.host('EH'); await wait(30); await e1.mp.join(eh.mp.code, 'E1'); await e2.mp.join(eh.mp.code, 'E2'); await wait(80);
  eh.mp.sendControl({ t: 'env', weather: 'rain', time: 'night' }); await wait(40);
  check(gotEnv.e1.length === 1 && gotEnv.e2.length === 1 && gotEnv.e1[0].weather === 'rain' && gotEnv.e2[0].time === 'night', 'the relay forwards the host env message to every guest');
  check(gotEnv.eh.length === 0, 'the host does not get its own env message back');
  e1.mp.sendControl({ t: 'env', weather: 'heavyrain', time: 'dusk' }); await wait(40);
  check(gotEnv.eh.length === 0 && gotEnv.e2.length === 1, 'an env message from a guest goes nowhere');
  eh.mp.leave(); e1.mp.leave(); e2.mp.leave(); await wait(50);
  // leave while connecting
  const k = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'K'); const jp = k.mp.host('K'); k.mp.leave(); await jp; await wait(50);
  check(k.mp.phase === 'idle', 'leave during start cancels it');
  check([...srv.rooms.values()].every(r => r.list.length === 0), 'no socket left behind');
}

{ // the finish message over the relay (src/finish.js): a guest's fin reaches the other players tagged with the sender's id, not the sender
  console.log('FINISH MESSAGES (relay)');
  const srv = makeFakeServer();
  const FH = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'FH'), F1 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'F1'), F2 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'F2');
  const got = { FH: [], F1: [], F2: [] };
  FH.mp.onControl = (m, id) => { if (m.t === 'fin') got.FH.push(id); };
  F1.mp.onControl = (m, id) => { if (m.t === 'fin') got.F1.push(id); };
  F2.mp.onControl = (m, id) => { if (m.t === 'fin') got.F2.push(id); };
  await FH.mp.host('FH'); await wait(30); await F1.mp.join(FH.mp.code, 'F1'); await F2.mp.join(FH.mp.code, 'F2'); await wait(80);
  const fin = { t: 'fin', time: 480.5, laps: 5, best: 92.4, sec: [29.8, 38.1, 24.5], pen: [{ s: 2, why: 'Track limits +2s' }], warn: 1 };
  F1.mp.sendControl(fin); await wait(40);
  check(got.F2.length === 1 && got.F2[0] === 'r1' && got.FH.length === 1 && got.FH[0] === 'r1', 'a guest finish reaches the host and the other guest, from the sender id r1');
  check(got.F1.length === 0, 'the sender does not get its own finish back');
  FH.mp.sendControl(fin, 'r2'); await wait(40);
  check(got.F2.length === 2 && got.F2[1] === 'r0' && got.F1.length === 0, 'a finish sent to one player (the late joiner rebroadcast) reaches only that player');
  FH.mp.leave(); F1.mp.leave(); F2.mp.leave(); await wait(50);
}

{ // the host's secret over the relay (the server side is the real protocol): a host that drops comes back with it, a thief without it is refused
  console.log('HOST TAKEOVER (relay)');
  const srv = makeFakeServer();
  const H = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'H'), G = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'G');
  const raced = { H: [], G: [] };
  H.mp.onControl = m => { if (m.t === 'race') raced.H.push(m); };
  G.mp.onControl = m => { if (m.t === 'race') raced.G.push(m); };
  await H.mp.host('H'); await wait(30);
  const code = H.mp.code, key = H.mp.relayRoom.client.hostKey;
  check(typeof key === 'string' && key.length === 32, 'the host has the room secret from its welcome');
  await G.mp.join(code, 'G'); await wait(60);
  check(H.mp.hostPeerId === 'r0' && G.mp.hostPeerId === 'r0' && G.mp.relayRoom.hostPeer === 'r0', 'both sides know the host is r0');
  // a race frame from a guest reaches nobody; the host's reaches the guest
  G.mp.sendControl({ t: 'race', laps: 1, grid: [], startAt: Date.now() + 5000, hold: 1500 }); await wait(40);
  check(raced.H.length === 0 && raced.G.length === 0, 'a race frame from a guest reaches nobody');
  H.mp.sendControl({ t: 'race', laps: 2, grid: ['r0', 'r1'], startAt: Date.now() + 5000, hold: 1500 }); await wait(40);
  check(raced.G.length === 1 && raced.G[0].laps === 2, 'the host race frame reaches the guest');
  // the host's socket dies: at once a thief asks for the room, first with no secret, then with a wrong one
  const refusals = [];
  const thief = (hostKey, token) => { const t = new RelayClient({ url: 'wss://relay.test', code, name: 'T', host: true, token, hostKey, WebSocket: srv.WS, handlers: { onRefused: k => refusals.push(k) } }); t.connect(); };
  const hostSocket = H.mp.relayRoom.client.ws;
  hostSocket.shut(1006); await wait(5);
  thief(undefined, 'thief1'); await wait(40);
  thief('0'.repeat(32), 'thief2'); await wait(40);
  eq(refusals, ['taken', 'taken'], 'a host join without the secret, and with a wrong one, are both refused');
  // the host reconnects (after its backoff) with the secret: same code, its slot and the guest back
  await wait(900);
  check(H.mp.phase === 'hosting' && H.mp.code === code && H.mp.players === 2 && H.mp.relayRoom.client.ws !== hostSocket, `the real host is back in its room with the secret (${H.mp.phase}, ${H.mp.players} players)`);
  check(G.mp.phase === 'joined' && G.mp.players === 2, 'the guest is still in the room');
  check(!JSON.stringify(G.statuses).includes(key) && !JSON.stringify(raced.G).includes(key), 'the guest has never seen the secret');
  H.mp.leave(); G.mp.leave(); await wait(50);
  // a host whose secret no longer matches is told the room is gone, and is not moved to another code by itself
  const H2 = makePlayer({ relayUrl: 'wss://relay.test' }, srv, 'H2');
  await H2.mp.host('H2'); await wait(30);
  H2.mp.relayRoom.client.hostKey = '0'.repeat(32);
  H2.mp.relayRoom.client.ws.shut(1006); await wait(900);
  check(H2.mp.phase === 'error' && /taken over/.test(H2.last().text), 'a host with a secret that no longer matches gets an error: ' + H2.last().text);
  check(srv.rooms.size >= 1 && [...srv.rooms.values()].every(r => r.list.length === 0), 'and nothing is left open');
}

{ // the secret of a room: a RelayClient keeps the host's, from its welcome, and sends it on every join; a guest never sends one
  console.log('HOST SECRET (client)');
  const WS = makeFakeWS(), clock = makeClock();
  const c = new RelayClient({ url: 'wss://r', code: 'ABCDE', name: 'Ann', host: true, token: 'tk', WebSocket: WS, timers: clock, handlers: {} });
  c.connect(); WS.list[0].open();
  eq(WS.list[0].json()[0], { t: 'join', name: 'Ann', id: 'tk', host: true }, 'the first join carries no secret');
  WS.list[0].got({ t: 'welcome', you: 0, host: 0, players: [], hostKey: 'k3y' });
  WS.list[0].drop(); clock.advance(600);
  WS.list[1].open();
  eq(WS.list[1].json()[0], { t: 'join', name: 'Ann', id: 'tk', host: true, hostKey: 'k3y' }, 'a reconnect sends the secret it got from the welcome');
  c.stop();
  const WG = makeFakeWS(), cg = new RelayClient({ url: 'wss://r', code: 'ABCDE', name: 'Bob', host: false, token: 'tb', WebSocket: WG, timers: clock, handlers: {} });
  cg.connect(); WG.list[0].open(); WG.list[0].got({ t: 'welcome', you: 1, host: 0, players: [], hostKey: 'not-for-guests' });
  WG.list[0].drop(); clock.advance(600); WG.list[1].open();
  eq(WG.list[1].json()[0], { t: 'join', name: 'Bob', id: 'tb', host: false }, 'a guest never sends a secret');
  cg.stop();
}

// ---------------------------------------------------------------- 6. fallback to peer to peer after 6 s
console.log('FALLBACK');
{
  // the relay never answers (sockets stay "connecting"): 6 s later the room is made peer to peer, and the lobby is told
  const clock = makeClock(), WS = makeFakeWS(), Peer = fakeNetwork();
  const st = [];
  const mp = new Multiplayer({ ghosts: new Ghosts(null), config: { ...BROKER, relayUrl: 'wss://dead.test' }, WebSocket: WS, relayTimers: clock, setTimeout: (f, ms) => setTimeout(f, ms), loadPeer: async () => Peer, onStatus: s => st.push(s), random: rnd });
  await mp.host('Ann'); await wait(5);
  check(WS.list.length === 1 && mp.transport === 'relay' && mp.phase === 'connecting' && /relay/i.test(st.at(-1).text), 'relay is tried first: ' + st.at(-1).text);
  clock.advance(5900); await wait(5);
  check(mp.transport === 'relay' && mp.phase === 'connecting', 'still waiting for the relay at 5.9 s');
  clock.advance(200); await wait(40);
  check(mp.transport === 'peer' && mp.phase === 'hosting', `after 6 s: peer to peer (${mp.transport}, ${mp.phase})`);
  check(/relay server did not answer/.test(st.at(-1).text) && /peer to peer/.test(st.at(-1).text) && st.at(-1).transport === 'peer', 'and the lobby says so: ' + st.at(-1).text);
  check(WS.list.every(w => w.readyState === 3 || w.onclose === null || w.readyState === 0), 'the relay socket is dropped');
  const ghostsDelay = mp.ghosts.delay; check(ghostsDelay === DELAY, 'remote cars back to the normal delay in peer mode');
  mp.leave(); await wait(300);

  // a guest: the relay is down at once (socket errors), the join falls back to the host's peer room
  const srv = makeFakeServer(); srv.down = true;
  const host = makePlayer({}, null, 'H', { loadPeer: async () => Peer });
  await host.mp.host('H'); await wait(40);
  const clock2 = makeClock(); const guestSt = [];
  const guest = new Multiplayer({ ghosts: new Ghosts(null), config: { ...BROKER, relayUrl: 'wss://dead.test' }, WebSocket: srv.WS, relayTimers: clock2, loadPeer: async () => Peer, onStatus: s => guestSt.push(s), random: rnd });
  await guest.join(host.mp.code, 'G'); await wait(10);
  for (let i = 0; i < 62; i++) { clock2.advance(100); await wait(3); }     // the retries all fail; 6.2 s pass on the fake clock
  await wait(150);
  check(guest.transport === 'peer' && guest.phase === 'joined' && host.mp.players === 2, `guest ended up in the host's room over peer to peer (${guest.transport}, ${guest.phase}, host sees ${host.mp.players})`);
  check(srv.sockets.length >= 3, `the relay was retried with backoff meanwhile (${srv.sockets.length} attempts)`);
  check(/peer to peer/.test(guestSt.find(s => s.phase === 'joined')?.text || ''), 'the joined text mentions the fallback');
  host.mp.leave(); guest.leave(); await wait(300);

  // ?transport=relay: no fallback, a plain error
  const clock3 = makeClock(), WS3 = makeFakeWS(), s3 = [];
  const only = new Multiplayer({ ghosts: new Ghosts(null), config: { ...BROKER, relayUrl: 'wss://dead.test', transport: 'relay' }, WebSocket: WS3, relayTimers: clock3, loadPeer: async () => { throw new Error('must not be used'); }, onStatus: s => s3.push(s), random: rnd });
  await only.host('X'); clock3.advance(6100); await wait(10);
  check(only.phase === 'error' && only.transport === 'relay' && /Could not reach the relay server \(dead\.test\)/.test(s3.at(-1).text) && /single player/.test(s3.at(-1).text), 'relay only: plain error, no peer to peer: ' + s3.at(-1).text);
  // relay only but no address
  const s4 = []; const none = new Multiplayer({ ghosts: new Ghosts(null), config: { ...BROKER, transport: 'relay' }, onStatus: s => s4.push(s), random: rnd });
  await none.host('X'); check(none.phase === 'error' && /no relay address/.test(s4.at(-1).text), 'relay only without an address: explained');
  // ?transport=peer ignores a configured relay
  const WS5 = makeFakeWS(), Peer5 = fakeNetwork();
  const forced = new Multiplayer({ ghosts: new Ghosts(null), config: { ...BROKER, relayUrl: 'wss://x.test', transport: 'peer' }, WebSocket: WS5, loadPeer: async () => Peer5, random: rnd });
  await forced.host('X'); await wait(30);
  check(WS5.list.length === 0 && forced.transport === 'peer' && forced.phase === 'hosting', 'transport=peer: the relay is not touched');
  forced.leave(); await wait(300);
  // no relay configured: plain peer to peer, no sockets
  const WS6 = makeFakeWS(), Peer6 = fakeNetwork();
  const plain = new Multiplayer({ ghosts: new Ghosts(null), config: { ...BROKER }, WebSocket: WS6, loadPeer: async () => Peer6, random: rnd });
  await plain.host('X'); await wait(30);
  check(WS6.list.length === 0 && plain.transport === 'peer' && plain.phase === 'hosting', 'no relay configured: peer to peer as before');
  plain.leave(); await wait(300);
  // config read at host time (multiplayer.json)
  const WS7 = makeFakeWS(), s7 = [];
  const viaFile = new Multiplayer({ ghosts: new Ghosts(null), loadConfig: async () => resolveConfig('', { relay: 'wss://file.test' }), WebSocket: WS7, onStatus: s => s7.push(s), random: rnd, loadPeer: async () => fakeNetwork() });
  await viaFile.host('X'); await wait(5);
  eq(WS7.list.map(w => w.url.replace(/\/room\/[A-Z]{5}(\?.*)?$/, '')), ['wss://file.test'], 'the relay address from multiplayer.json is used');
  viaFile.leave();
}

// ---------------------------------------------------------------- 7. race control: only the host's race, weather and clock reply count
console.log('RACE CONTROL FROM THE ROOM');
{
  const rig = (isHost, hostPeerId) => {
    const sent = [], starts = [];
    const mp = { isHost, selfId: isHost ? 'r0' : 'r2', hostPeerId, peers: new Map([['r0', { id: 'r0', hello: true }], ['r1', { id: 'r1', hello: true }]]), sendControl: (o, to) => { sent.push({ o, to }); return true; } };
    // timers are queued and run by flush(): a guest with no clock sample waits for one (up to 1.5 s), then starts as a free drive
    const timers = [];
    const rc = createRaceControl({ mp, now: () => 1000, random: () => 0.5, setTimeout: f => { timers.push(f); }, onRace: r => starts.push(r) });
    const flush = () => { while (timers.length) timers.shift()(); };
    return { rc, mp, starts, sent, flush };
  };
  const race = () => ({ t: 'race', laps: 3, assists: 'off', racingLine: false, grid: ['r0', 'r2'], startAt: 5000, hold: 1500 });
  const g = rig(false, 'r0');
  g.rc.handle(race(), 'r1'); eq(g.starts.length, 0, 'a race from another guest does not start a race');
  g.rc.handle({ t: 'env', weather: 'fog', time: 'night' }, 'r1'); eq(g.rc.env, null, 'weather from another guest is not taken');
  g.rc.handle({ t: 'clkr', n: 1, c: 0, h: 5 }, 'r1'); eq(g.rc.offset, null, 'a clock reply from another guest is not taken');
  g.rc.handle(race(), 'r0'); g.flush(); eq(g.starts.length, 1, 'the host race starts the race (after the wait for a clock, no reply: a free drive)');
  g.rc.handle({ t: 'env', weather: 'fog', time: 'night' }, 'r0'); eq(g.rc.env && g.rc.env.weather, 'fog', 'the host weather is taken');
  g.rc.handle({ t: 'clkr', n: 1, c: 0, h: 5 }, 'r0'); check(g.rc.offset !== null, 'the host clock reply is taken');
  const h = rig(true, 'r0');
  h.rc.handle(race(), 'r0'); h.rc.handle(race(), 'r1'); eq(h.starts.length, 0, 'the host does not take a race message at all');
  h.rc.handle({ t: 'env', weather: 'fog', time: 'night' }, 'r1'); eq(h.rc.env, null, 'the host takes no weather from anybody');
  const u = rig(false, 'r0'); u.rc.handle(race()); u.flush(); eq(u.starts.length, 1, 'with no sender given (the transport checked it already) the host message is taken');
  const early = rig(false, null); early.rc.handle(race(), 'r0'); eq(early.starts.length, 0, 'before the room names a host, nothing counts as the host');
  const p = rig(false, 'lakeside-ABCDE'); p.rc.handle(race(), 'lakeside-ABCDE'); p.rc.handle(race(), 'lakeside-QWERT'); p.flush(); eq(p.starts.length, 1, 'peer to peer: the host id is its room id, another peer is refused');
}

console.log(fails ? `relay-client: ${fails} FAILED, ${passes} passed` : `relay-client: all ${passes} checks passed`);
process.exit(fails ? 1 : 0);
