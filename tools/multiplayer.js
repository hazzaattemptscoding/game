// Multiplayer test. Run with `npm run multiplayer` (also part of `npm run check`). No network and no browser needed.
//   1. wire format: encode and decode round trip, bad data rejected, names cleaned
//   2. interpolation: smooth with jittered packets, extrapolation bounded, silence removes the car, a reset restarts the grace
//   3. rooms: the room logic over an in-memory stand-in for PeerJS (full mesh, host leaving, full room, broker down, wrong code)
//   3b. connection setup: ICE list, multiplayer.json merge order and loader, join retry (fake timers), diagnostics text, host hints
//   4. collisions: two real Car objects through Car.collideCars, head-on and side by side
import { buildTrack } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { carContact } from '../src/carContact.js';
import { encodeState, decodeState, stateFromCar, StateBuffer, Ghosts, cleanName, FIELDS, DELAY, MAX_EXTRAP, TIMEOUT, PALETTE } from '../src/ghosts.js';
import { Multiplayer, makeCode, cleanCode, parseBroker, brokerFromSearch, BROKER, hostId, DEFAULT_ICE_SERVERS, applyConfigFile, cleanIceServers, fetchConfigFile, resolveConfig, loadConfig, hasTurn, rtcConfig, newDiag, diagText, failureReason, NO_OUTSIDE, NEEDS_RELAY } from '../src/multiplayer.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();

// ---------------------------------------------------------------- 1. wire format
console.log('WIRE FORMAT');
{
  const s = { t: 123456.7, x: 1234.5678, y: 12.345, z: -987.654, h: 2.12345, vx: 41.236, vz: -3.141, yr: 0.4567, st: -0.21, w: 7.5, thr: 0.8, brk: 0, pz: 0.05, rx: -0.02, col: 3, lap: 4, s: 2345.67, name: 'Ada', bl: 91.2344, ll: 92.5 };
  const wire = JSON.parse(JSON.stringify(encodeState(s)));      // through JSON, as the data channel does
  const d = decodeState(wire);
  check(d && d.name === 'Ada' && d.col === 3 && d.lap === 4, 'round trip: name, colour, lap');
  for (const k of ['x', 'y', 'z']) check(d && near(d[k], s[k], 0.006), `round trip ${k}`);
  for (const k of ['vx', 'vz', 'yr', 'st', 'thr', 'brk', 'pz', 'rx']) check(d && near(d[k], s[k], 0.006), `round trip ${k}`);
  check(d && near(d.bl, 91.234, 0.0006) && d.ll === 92.5, 'round trip best and last lap times');
  check(d && near(d.h, s.h, 0.001) && near(d.s, s.s, 0.06) && near(d.t, Math.round(s.t), 0.51), 'round trip heading, s, t');
  check(d && near(d.w, s.w % (Math.PI * 2), 0.006), 'wheel angle wrapped to one turn');
  const bytes = JSON.stringify(encodeState(s)).length;
  console.log(`  state is ${bytes} bytes as JSON, 20 per second = ${(bytes * 20 / 1000).toFixed(1)} kB/s per other player`);
  check(bytes < 220, 'state stays small');
  for (const [label, bad] of [['null', null], ['string', 'x'], ['wrong tag', ['q', ...wire.slice(1)]], ['short', wire.slice(0, 10)], ['NaN', wire.map((v, i) => i === 2 ? NaN : v)],
    ['string number', wire.map((v, i) => i === 2 ? '5' : v)], ['absurd x', wire.map((v, i) => i === 2 ? 1e9 : v)], ['Infinity', wire.map((v, i) => i === 6 ? Infinity : v)], ['object', { t: 's' }]]) {
    check(decodeState(bad) === null, `decode rejects ${label}`);
  }
  const evil = decodeState(wire.map((v, i) => i === wire.length - 1 ? '<img src=x onerror=alert(1)>Bob\u0000\n   Smith "quoted"' + 'z'.repeat(40) : v));
  check(evil && !/[<>"&\u0000\n]/.test(evil.name) && evil.name.length <= 16, 'name is stripped to plain text and capped');
  check(cleanName(null) === '' && cleanName('  a   b ') === 'a b', 'cleanName');
  const wild = decodeState(wire.map((v, i) => i === 15 ? 99 : i === 16 ? -5 : v));
  check(wild && wild.col <= 7 && wild.lap === 0, 'colour and lap clamped');

  // lap times ride after the name, so the format stays safe both ways
  const oldPacket = wire.slice(0, wire.length - 2);          // what a player without lap times sends: ends at the name
  const od = decodeState(oldPacket);
  check(od && od.name === 'Ada' && od.lap === 4 && od.bl === 0 && od.ll === 0, 'a packet without lap times decodes with 0 for both');
  const newer = decodeState([...wire, 7, 'unknown', { x: 1 }]);
  check(newer && newer.name === 'Ada' && newer.bl === d.bl && newer.ll === d.ll, 'unknown trailing fields are ignored');
  for (const [label, v] of [['string', '91.2'], ['NaN', NaN], ['Infinity', Infinity], ['negative', -3], ['zero', 0], ['an hour', 3600], ['null', null], ['object', {}]]) {
    const w2 = decodeState(wire.map((x, i) => i === wire.length - 2 ? v : x));
    check(w2 && w2.bl === 0 && w2.ll === d.ll && w2.name === 'Ada', `a bad best lap (${label}) becomes 0 and the packet still decodes`);
  }
  const noTimes = encodeState({ ...s, bl: undefined, ll: null });
  check(noTimes[noTimes.length - 2] === 0 && noTimes[noTimes.length - 1] === 0 && noTimes.length === FIELDS.length + 4, 'no lap times are sent as 0');
  check(JSON.stringify(encodeState({ ...s, bl: 91.23456 })).includes('91.235'), 'lap times go out to the millisecond');

  // from a real car
  const track = buildTrack(), car = new Car(GT, track);
  car.placeAt(500, 3);
  const st = decodeState(JSON.parse(JSON.stringify(encodeState(stateFromCar(car, 2, 4, 'Zed', 1000)))));
  check(st && near(st.x, car.x, 0.01) && near(st.s, car.loc.s, 0.1) && st.lap === 2 && st.bl === 0 && st.ll === 0, 'state from a Car');
  const st2 = decodeState(JSON.parse(JSON.stringify(encodeState(stateFromCar(car, 3, 4, 'Zed', 1000, 88.8, 89.9)))));
  check(st2 && st2.bl === 88.8 && st2.ll === 89.9, 'state from a Car carries best and last lap');
}

// ---------------------------------------------------------------- 2. interpolation, extrapolation, silence
console.log('INTERPOLATION');
// a car on a circle of radius 60 m at 40 m/s, clock ms
const R = 60, V = 40, W = V / R;
const truth = tMs => { const a = W * tMs / 1000; return { x: R * Math.sin(a), z: R * (1 - Math.cos(a)), h: a, vx: V * Math.cos(a), vz: V * Math.sin(a), yr: W }; };
const mkState = (tMs, extra = {}) => ({ ...truth(tMs), t: tMs, y: 0, st: 0, w: 0, thr: 1, brk: 0, pz: 0, rx: 0, col: 1, lap: 0, s: 0, name: 'A', ...extra });
{
  // sender clock is 5000 ms ahead of ours. Packets every 50 ms, each delayed 20 to 80 ms (so they can arrive out of order), some lost.
  const skew = 5000, arrivals = [];
  for (let t = 0; t <= 8000; t += 50) {
    if (rnd() < 0.1) continue;       // 10 % lost
    arrivals.push({ at: t + 20 + rnd() * 60, st: mkState(t + skew) });
  }
  arrivals.sort((a, b) => a.at - b.at);
  const buf = new StateBuffer();
  let i = 0, prev = null, maxErr = 0, maxStepErr = 0, n = 0;
  const out = {};
  for (let now = 0; now <= 8000; now += 1000 / 60) {
    while (i < arrivals.length && arrivals[i].at <= now) { buf.push(arrivals[i].st, arrivals[i].at); i++; }
    const p = buf.sample(now, out);
    if (!p || now < 1500) { prev = null; continue; }
    // the car should be where the sender was about DELAY plus the fastest packet's delay ago; allow 0 to 160 ms of lag
    const err = Math.min(...[0, 20, 40, 60, 80, 100, 120, 140, 160].map(lag => Math.hypot(p.x - truth(now + skew - lag).x, p.z - truth(now + skew - lag).z)));
    maxErr = Math.max(maxErr, err);
    if (prev) {
      const step = Math.hypot(p.x - prev.x, p.z - prev.z), want = V / 60;
      maxStepErr = Math.max(maxStepErr, Math.abs(step - want) / want);
    }
    prev = { x: p.x, z: p.z }; n++;
  }
  console.log(`  jittered 20 to 80 ms, 10% lost: ${n} frames, largest frame-to-frame step error ${(maxStepErr * 100).toFixed(1)} %`);
  check(n > 300, 'interpolation produced poses');
  check(maxStepErr < 0.25, `interpolated motion smooth with jitter (largest step error ${(maxStepErr * 100).toFixed(1)} %, limit 25 %)`);
  check(maxErr < 0.6, `interpolated path stays on the true path (${maxErr.toFixed(2)} m)`);
}
{
  // late packets: nothing arrives for 2 s. The car coasts a short way, then holds, and never runs away.
  const buf = new StateBuffer(), skew = 0;
  for (let t = 0; t <= 1000; t += 50) buf.push(mkState(t + skew), t + 30);
  const last = buf.latest, out = {};
  let far = 0, moved = [];
  for (let now = 1030; now <= 3000; now += 16) {
    const p = buf.sample(now, out);
    check(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.h), 'extrapolation finite');
    far = Math.max(far, Math.hypot(p.x - last.x, p.z - last.z)); moved.push(Math.hypot(p.x - last.x, p.z - last.z));
  }
  console.log(`  2 s with no packets: furthest from the last known position ${far.toFixed(2)} m (limit ${(V * MAX_EXTRAP).toFixed(1)} m)`);
  check(far <= V * MAX_EXTRAP + 0.01, 'extrapolation is bounded by speed times the cap');
  check(near(moved[moved.length - 1], moved[moved.length - 20], 1e-9), 'the car holds still after the cap');
}
{
  // heading across the +-pi wrap interpolates the short way
  const b = new StateBuffer();
  b.push({ ...mkState(0), h: 3.1, vx: 0, vz: 0, yr: 0 }, 0);
  b.push({ ...mkState(50), h: -3.1, vx: 0, vz: 0, yr: 0 }, 50);
  const p = b.sample(125, {});     // halfway between the two (DELAY 100)
  check(Math.abs(Math.abs(p.h) - Math.PI) < 0.05, `heading wraps the short way (${p.h.toFixed(2)})`);
}
console.log('SILENCE AND REMOVAL');
{
  const made = [], gone = [];
  const factory = { create: info => { made.push(info.id); return { setPose() {}, setOpacity() {}, setLabel() {}, dispose() { gone.push(info.id); } }; } };
  const g = new Ghosts(factory);
  for (let t = 0; t <= 1000; t += 50) g.receive('p1', mkState(t, { col: 2 }), t);
  g.receive('p2', mkState(900, { col: 2, name: 'B' }), 900);   // same colour asked for: gets another
  check(made.length === 2 && g.size === 2, 'two cars created');
  check(g.map.get('p1').col !== g.map.get('p2').col && g.map.get('p2').col !== 0, 'colours do not clash');
  let s = g.solids(1100);
  check(s.length === 2 && s.find(o => o.id === 'p2').age > 0, 'solids list the cars');
  check(s.find(o => o.id === 'p1').age > 1 && s.find(o => o.id === 'p1').silent < 0.2, 'age and silence reported');
  g.update(1000 + (TIMEOUT - 0.05) * 1000, null);
  check(g.map.has('p1'), 'present just before the timeout');
  s = g.solids(1000 + 700);
  check(s.find(o => o.id === 'p1').silent > 0.5, 'silent over 0.5 s is reported (collisions skip it)');
  g.update(1000 + (TIMEOUT + 0.05) * 1000, null);
  check(!g.map.has('p1') && gone.includes('p1'), `removed after ${TIMEOUT} s of silence`);
  check(!g.map.has('p2'), 'the other, silent since 900, removed too');
  // a reset: a big jump starts the grace again
  const g2 = new Ghosts(null);
  for (let t = 0; t <= 3000; t += 50) g2.receive('p', mkState(0 + t * 0 + 0, {}) && { ...mkState(0), x: t * 0.01, z: 0, t }, t);
  check(g2.solids(3050)[0].age > 2, 'grace over after a few seconds');
  g2.receive('p', { ...mkState(0), x: 900, z: 900, t: 3050 }, 3050);
  g2.receive('p', { ...mkState(0), x: 900, z: 900, t: 3100 }, 3100);
  check(g2.solids(3150)[0].age < 0.2, 'a teleport (reset) restarts the 1.5 s grace');
  // standings
  const g3 = new Ghosts(null);
  g3.receive('a', { ...mkState(0), lap: 2, s: 100, vx: 50, vz: 0, name: 'Ann' }, 0);
  g3.receive('b', { ...mkState(0), lap: 1, s: 4000, vx: 50, vz: 0, name: 'Bo' }, 0);
  const rows = g3.standings({ name: 'Me', lap: 2, s: 50, speed: 50 }, 5000);
  check(rows.map(r => r.name).join() === 'Ann,Me,Bo', `standings order (${rows.map(r => r.name)})`);
  check(rows[1].gap === '+1.0s', `gap in seconds (${rows[1].gap})`);
  check(rows[2].gap === '+1 lap' || /s$/.test(rows[2].gap), 'gap for the car a lap down');
}

// ---------------------------------------------------------------- 3. rooms, over an in-memory PeerJS
console.log('ROOMS (in-memory PeerJS)');
function fakeNetwork({ down = false } = {}) {
  const peers = new Map();
  class Conn {
    constructor(owner, peer, label, metadata) { Object.assign(this, { owner, peer, label, metadata, open: false, h: {}, other: null }); }
    on(e, f) { this.h[e] = f; return this; }
    emit(e, ...a) { this.h[e] && this.h[e](...a); }
    send(d) { if (!this.open) return; const o = this.other, j = JSON.parse(JSON.stringify(d)); setTimeout(() => o.emit('data', j), 1); }
    close() { if (!this.open) return; this.open = false; const o = this.other; o.open = false; setTimeout(() => { this.emit('close'); o.emit('close'); }, 1); }
  }
  class Peer {
    constructor(id) {
      this.id = id; this.h = {}; this.conns = []; this.open = false;
      setTimeout(() => {
        if (down) return this.emit('error', { type: 'network', message: 'Lost connection to server.' });
        if (peers.has(id)) return this.emit('error', { type: 'unavailable-id', message: `ID "${id}" is taken` });
        peers.set(id, this); this.open = true; this.emit('open', id);
      }, 1);
    }
    on(e, f) { this.h[e] = f; return this; }
    emit(e, ...a) { this.h[e] && this.h[e](...a); }
    connect(id, o) {
      const mine = new Conn(this, id, o.label, o.metadata), target = peers.get(id);
      if (!target) { setTimeout(() => this.emit('error', { type: 'peer-unavailable', message: `Could not connect to peer ${id}` }), 1); return mine; }
      const theirs = new Conn(target, this.id, o.label, o.metadata);
      mine.other = theirs; theirs.other = mine; this.conns.push(mine); target.conns.push(theirs);
      setTimeout(() => { target.emit('connection', theirs); setTimeout(() => { mine.open = theirs.open = true; theirs.emit('open'); mine.emit('open'); }, 1); }, 1);
      return mine;
    }
    reconnect() {}
    destroy() { peers.delete(this.id); for (const c of this.conns) c.close(); this.open = false; }
  }
  return Peer;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const player = (Peer, name, statuses = []) => {
  const ghosts = new Ghosts(null);
  const mp = new Multiplayer({ ghosts, loadPeer: async () => Peer, onStatus: s => statuses.push(s), random: rnd, now: () => Date.now() });
  return { mp, ghosts, name, statuses };
};
{
  const Peer = fakeNetwork();
  const a = player(Peer, 'Ann'), b = player(Peer, 'Bob'), c = player(Peer, 'Cy');
  await a.mp.host('Ann'); await wait(20);
  check(a.mp.phase === 'hosting' && /^[A-HJ-NP-Z]{5}$/.test(a.mp.code), `host gets a 5 letter code (${a.mp.code})`);
  await b.mp.join(a.mp.code.toLowerCase(), 'Bob'); await wait(40);
  await c.mp.join(a.mp.code, 'Cy'); await wait(60);
  check(b.mp.phase === 'joined' && c.mp.phase === 'joined', 'guests joined');
  check(a.mp.players === 3 && b.mp.players === 3 && c.mp.players === 3, `full mesh: everyone sees 3 players (${a.mp.players}, ${b.mp.players}, ${c.mp.players})`);
  check([...b.mp.peers.values()].map(p => p.name).sort().join() === 'Ann,Cy', 'names exchanged');
  // state flows between every pair
  for (const [p, label] of [[a, 'a'], [b, 'b'], [c, 'c']]) p.mp.sendState(encodeState(mkState(1000, { name: p.name, x: label === 'a' ? 1 : label === 'b' ? 2 : 3 })));
  await wait(20);
  check(a.ghosts.size === 2 && b.ghosts.size === 2 && c.ghosts.size === 2, 'everyone has the other two cars');
  // host leaves: the others keep playing
  a.mp.leave(); await wait(300);
  check(b.mp.players === 2 && c.mp.players === 2 && b.mp.phase === 'joined', `host left, the others still see each other (${b.mp.players}, ${c.mp.players})`);
  check(/host left/i.test(b.statuses[b.statuses.length - 1].text), 'guests are told the host left');
  b.mp.sendState(encodeState(mkState(2000, { name: 'Bob', x: 20 }))); await wait(20);
  check(c.ghosts.size === 1 && [...c.ghosts.map.values()][0].info.x === 20, 'state still flows without the host');
  b.mp.leave(); c.mp.leave(); await wait(300);
  check(b.mp.phase === 'idle' && c.ghosts.size === 0, 'leaving clears the other cars');
}
{
  // room limit: 8 players, the 9th is turned away
  const Peer = fakeNetwork();
  const host = player(Peer, 'H'); await host.mp.host('H'); await wait(20);
  const guests = [];
  for (let i = 0; i < 8; i++) { const g = player(Peer, 'G' + i); guests.push(g); await g.mp.join(host.mp.code, 'G' + i); await wait(60); }
  check(host.mp.players === 8, `host sees 8 players (${host.mp.players})`);
  const rejected = guests[7];
  check(rejected.mp.phase === 'error' && /full/i.test(rejected.statuses[rejected.statuses.length - 1].text), `the 9th is told the room is full (${rejected.mp.phase})`);
  check(guests.slice(0, 7).every(g => g.mp.players === 8), 'the first eight are all meshed');
  host.mp.leave(); for (const g of guests) g.mp.leave(); await wait(300);
}
{
  const Peer = fakeNetwork();
  const g = player(Peer, 'X'); await g.mp.join('ZZZZZ', 'X'); await wait(40);
  const last = g.statuses[g.statuses.length - 1];
  check(last.phase === 'error' && /No room with the code ZZZZZ/.test(last.text), `wrong code: plain message (${last.text})`);
  check(g.mp.phase === 'error' && !g.mp.active, 'game carries on single player after a wrong code');
  const d = player(fakeNetwork({ down: true }), 'Y'); await d.mp.host('Y'); await wait(40);
  const t = d.statuses[d.statuses.length - 1].text;
  check(d.mp.phase === 'error' && /single player/.test(t) && /claude\.ai/.test(t), `broker down: plain message that mentions the claude.ai block (${t.slice(0, 60)}...)`);
  const n = player(null, 'Z'); n.mp.loadPeer = async () => { throw new Error('blocked'); }; await n.mp.host('Z'); await wait(10);
  check(n.mp.phase === 'error' && /single player/.test(n.statuses[n.statuses.length - 1].text), 'PeerJS failing to load: plain message');
  // hostile messages are ignored
  const Peer2 = fakeNetwork();
  const h = player(Peer2, 'H'), k = player(Peer2, 'K');
  await h.mp.host('H'); await wait(20); await k.mp.join(h.mp.code, 'K'); await wait(60);
  const kp = h.mp.peers.values().next().value;
  h.mp.receive(kp.id, 'ctl', { t: 'peers', ids: ['evil'] }); h.mp.receive(kp.id, 'ctl', 'junk'); h.mp.receive(kp.id, 'st', [1, 2, 3]); h.mp.receive('nobody', 'st', encodeState(mkState(0)));
  check(h.ghosts.size === 0, 'junk messages create no cars');
  h.mp.leave(); k.mp.leave(); await wait(300);
}
{
  // broker settings
  check(parseBroker('example.com').host === 'example.com' && parseBroker('example.com').secure && parseBroker('example.com').port === 443, 'broker: host only means https on 443');
  const l = parseBroker('localhost:9000/myapp');
  check(l.host === 'localhost' && l.port === 9000 && !l.secure && l.path === '/myapp/', 'broker: localhost:9000/myapp');
  const u = brokerFromSearch('?broker=peers.example.org:8443/signal&brokerkey=abc');
  check(u.host === 'peers.example.org' && u.port === 8443 && u.secure && u.path === '/signal/' && u.key === 'abc', 'broker: ?broker= and ?brokerkey=');
  check(brokerFromSearch('').host === BROKER.host, 'broker: default when no parameter');
  check(parseBroker('http://192.168.1.5:9000').secure === false, 'broker: http:// is plain');
  check(cleanCode(' ab-cd e12 ') === 'ABCDE' && makeCode().length === 5, 'room codes');
}

// ---------------------------------------------------------------- 3b. connection setup
console.log('CONNECTION SETUP');
{
  // ICE list is explicit: Google and Cloudflare STUN, Open Relay TURN
  const urls = DEFAULT_ICE_SERVERS.flatMap(e => [].concat(e.urls));
  for (const u of ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp']) check(urls.includes(u), `default ICE list has ${u}`);
  const turn = DEFAULT_ICE_SERVERS.find(e => [].concat(e.urls).some(u => u.startsWith('turn')));
  check(turn.username === 'openrelayproject' && turn.credential === 'openrelayproject', 'open relay login');
  check(BROKER.iceServers === DEFAULT_ICE_SERVERS && hasTurn(BROKER.iceServers) && !hasTurn([{ urls: 'stun:x:1' }]) && !hasTurn(null), 'BROKER uses the explicit list; hasTurn');
  check(!('iceTransportPolicy' in rtcConfig(BROKER)) && rtcConfig(BROKER).iceServers.length === 3, 'rtcConfig: normal');
  check(rtcConfig(BROKER, true).iceTransportPolicy === 'relay' && rtcConfig({ ...BROKER, relayOnly: true }).iceTransportPolicy === 'relay', 'rtcConfig: relay for one attempt or from config');
  check(rtcConfig({ ...BROKER, iceServers: [] }).iceServers.length === 0, 'rtcConfig: ?ice=none keeps an empty list');

  // merge order: defaults < multiplayer.json < URL
  const file = { broker: { host: 'peers.example.org', port: 8443, path: 'sig', secure: true, key: 'k1' }, iceServers: [{ urls: ['turn:t.example.org:3478', 'turns:t.example.org:5349?transport=tcp'], username: 'u', credential: 'c' }], relayOnly: true };
  const f1 = resolveConfig('', file);
  check(f1.host === 'peers.example.org' && f1.port === 8443 && f1.path === '/sig/' && f1.key === 'k1' && f1.relayOnly === true, 'file overrides the default broker and relayOnly');
  check(f1.iceServers.length === 1 && f1.iceServers[0].username === 'u' && f1.iceServers[0].urls.length === 2, 'file replaces the ICE list');
  const f2 = resolveConfig('?broker=other.example.com:9000/x&brokerkey=zz&ice=none&relay=0', file);
  check(f2.host === 'other.example.com' && f2.port === 9000 && f2.key === 'zz' && f2.iceServers.length === 0 && f2.relayOnly === false, 'URL beats the file (broker, key, ice=none, relay=0)');
  check(resolveConfig('?relay=1', null).relayOnly === true && resolveConfig('', null).host === BROKER.host && resolveConfig('', {}).iceServers === DEFAULT_ICE_SERVERS, 'URL ?relay=1; no file means defaults');
  check(BROKER.host === '0.peerjs.com' && BROKER.relayOnly === false, 'defaults are not modified by merging');
  const bad = applyConfigFile(BROKER, { broker: { host: 5, port: 'x', secure: 'yes', path: '' }, iceServers: [{ urls: 'http://nope' }, null, { urls: 5 }], relayOnly: 'true' });
  check(bad.host === BROKER.host && bad.port === 443 && bad.secure === true && bad.iceServers === DEFAULT_ICE_SERVERS && bad.relayOnly === false, 'wrong types and unusable ICE entries are ignored');
  check(applyConfigFile(BROKER, { iceServers: [] }).iceServers.length === 0, 'an empty list in the file means no servers');
  check(cleanIceServers([{ urls: 'stun:a:1' }, { urls: ['turn:b:1', 'junk'], username: 'u', credential: 'p', extra: 1 }]).length === 2 && !('extra' in cleanIceServers([{ urls: 'turn:b:1', extra: 1 }])[0]), 'cleanIceServers keeps only urls, username, credential');

  // loader, with a fake fetch
  const asked = [];
  const okFetch = async (u, o) => { asked.push([u, o]); return { ok: true, json: async () => file }; };
  const lc = await loadConfig({ fetchFn: okFetch, search: '?brokerkey=url', build: 'abc123' });
  check(lc.host === 'peers.example.org' && lc.key === 'url' && lc.relayOnly, 'loadConfig: file then URL');
  check(asked[0][0] === 'multiplayer.json?v=abc123' && asked[0][1].cache === 'no-store', `loadConfig: cache busted with the build id (${asked[0][0]})`);
  for (const [label, fn] of [['404', async () => ({ ok: false })], ['network error', async () => { throw new Error('offline'); }], ['bad JSON', async () => ({ ok: true, json: async () => { throw new Error('x'); } })], ['an html page', async () => ({ ok: true, json: async () => { throw new SyntaxError('<'); } })], ['null', async () => ({ ok: true, json: async () => null })], ['an array', async () => ({ ok: true, json: async () => [1] })]]) {
    const c = await loadConfig({ fetchFn: fn, search: '', build: 'x' });
    check(c.host === BROKER.host && c.iceServers === DEFAULT_ICE_SERVERS, `loadConfig: ${label} falls back to defaults`);
  }
  const t0 = Date.now();
  check(await fetchConfigFile(() => new Promise(() => {}), 'multiplayer.json', 60) === null && Date.now() - t0 < 1000, 'loadConfig: a fetch that never answers gives up');
  check((await loadConfig({ search: '?broker=a.b' })).host === 'a.b', 'loadConfig: no fetch available');
}
{
  // diagnostics text
  check(failureReason(newDiag()) === NO_OUTSIDE && /^No outside address was found, so this network blocks the connection helpers\. Try another network or add a TURN server \(README\)$/.test(NO_OUTSIDE), 'no candidates: the no outside address message');
  const d = newDiag(); d.ever.host = true;
  check(failureReason(d) === NO_OUTSIDE, 'host candidates only: still no outside address');
  d.ever.srflx = true;
  check(failureReason(d) === NEEDS_RELAY && NEEDS_RELAY === "Your network or the host's network needs a relay (TURN)", 'srflx seen: needs a relay message');
  const d2 = newDiag(); d2.ever.relay = true; check(failureReason(d2) === NEEDS_RELAY, 'relay seen: needs a relay message');
  const t = diagText({ ...newDiag(), broker: true, brokerHost: '0.peerjs.com', states: ['new', 'checking', 'failed'], ever: { host: true, srflx: true, relay: false }, gathered: true, reason: NEEDS_RELAY });
  check(/Broker: reachable \(0\.peerjs\.com\)/.test(t) && /new, checking, failed/.test(t) && /Addresses found: host, srflx/.test(t) && /Result: Your network/.test(t), 'diagText: broker, states, candidate types, result');
  check(/Broker: not reachable/.test(diagText({ ...newDiag(), broker: false })) && /Broker: not tried yet/.test(diagText(newDiag())) && /none/.test(diagText(newDiag())), 'diagText: broker no, fresh state');
  check(!/—/.test(NO_OUTSIDE + NEEDS_RELAY + t), 'no em dashes');
}
// fake timers and a Peer whose host never answers, with a controllable RTCPeerConnection
function fakeClock() {
  let now = 0, id = 0; const q = new Map();
  return { setTimeout: (f, ms) => { q.set(++id, [now + ms, f]); return id; }, clearTimeout: t => q.delete(t),
    advance(ms) { const end = now + ms; for (;;) { let best = null; for (const [k, [at]] of q) if (at <= end && (!best || at < q.get(best)[0])) best = k; if (best === null) break; const [at, f] = q.get(best); q.delete(best); now = at; f(); } now = end; } };
}
function fakePC() {
  const l = {}; return { iceConnectionState: 'new', addEventListener(e, f) { (l[e] = l[e] || []).push(f); }, fire(e, ev) { for (const f of l[e] || []) f(ev); }, setState(s) { this.iceConnectionState = s; this.fire('iceconnectionstatechange'); }, cand(type) { this.fire('icecandidate', { candidate: { type, candidate: `candidate:1 1 udp 1 1.2.3.4 5 typ ${type}` } }); } };
}
function stuckNetwork({ brokerOk = true, rooms = true } = {}) {
  const made = [];
  class Peer {
    constructor(id, opts) { this.id = id; this.opts = opts; this.h = {}; this.open = false; this.pcs = []; made.push(this); setTimeout(() => { if (!brokerOk) return this.emit('error', { type: 'network', message: 'x' }); this.open = true; this.emit('open', id); }, 1); }
    on(e, f) { this.h[e] = f; return this; }
    emit(e, ...a) { this.h[e] && this.h[e](...a); }
    connect(id, o) { const pc = fakePC(); this.pcs.push(pc); const c = { peer: id, label: o.label, open: false, peerConnection: pc, on() { return this; }, send() {}, close() {} }; if (!rooms) setTimeout(() => this.emit('error', { type: 'peer-unavailable', message: `Could not connect to peer ${id}` }), 1); return c; }
    reconnect() {} destroy() { this.destroyed = true; }
  }
  Peer.made = made; return Peer;
}
{
  // retry logic: the first attempt times out, one retry with a fresh peer and, with no relay candidate seen, relay only
  const Peer = stuckNetwork(), clock = fakeClock(), st = [];
  const mp = new Multiplayer({ loadPeer: async () => Peer, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onStatus: s => st.push(s), random: rnd, loadConfig: async () => ({ ...BROKER }) });
  check(mp.joinTimeout === 25000, 'join timeout is 25 s');
  await mp.join('ABCDE', 'Me'); await wait(10);
  check(Peer.made.length === 1 && st[st.length - 1].text.startsWith('Looking for room ABCDE'), 'first attempt looks for the room');
  check(Peer.made[0].opts.config.iceTransportPolicy === undefined && Peer.made[0].opts.config.iceServers.length === 3, 'first attempt: normal ICE, explicit server list');
  Peer.made[0].pcs[0].setState('checking'); Peer.made[0].pcs[0].cand('host');
  clock.advance(24000); check(Peer.made.length === 1 && mp.phase === 'connecting', 'nothing happens before 25 s');
  clock.advance(1500); await wait(10);
  check(Peer.made.length === 2 && Peer.made[0].id !== Peer.made[1].id && mp.phase === 'connecting', 'after 25 s: one retry with a fresh peer id');
  check(Peer.made[1].opts.config.iceTransportPolicy === 'relay', 'retry with no relay candidate seen: relay only');
  check(mp.diag.attempt === 1 && mp.diag.relayForced && /relay only/.test(diagText(mp.diag)), 'diagnostics show attempt 2, relay only');
  clock.advance(26000); await wait(10);
  const last = st[st.length - 1];
  check(Peer.made.length === 2 && last.phase === 'error' && mp.phase === 'error', 'the retry failing ends it: no third attempt');
  check(/Reached the broker but not the host of room ABCDE\. No outside address was found, so this network blocks the connection helpers\. Try another network or add a TURN server \(README\)\. Playing single player\./.test(last.text), `final message explains: ${last.text}`);
  check(/Broker: reachable/.test(last.details) && /new, checking, retry, new/.test(last.details) && /Addresses found: host\b/.test(last.details) && /Result: No outside address/.test(last.details), 'lobby details carry broker, states, candidates, reason');
  check(Peer.made.length === 2, 'peers made: 2');
}
{
  // srflx seen and the link still never opens: the relay message; relay already seen: the retry is not relay only
  const Peer = stuckNetwork(), clock = fakeClock(), st = [];
  const mp = new Multiplayer({ loadPeer: async () => Peer, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onStatus: s => st.push(s), random: rnd });
  await mp.join('ABCDE', 'Me'); await wait(10);
  Peer.made[0].pcs[0].cand('host'); Peer.made[0].pcs[0].cand('srflx'); Peer.made[0].pcs[0].cand('relay'); Peer.made[0].pcs[0].fire('icecandidate', { candidate: null });
  clock.advance(25001); await wait(10);
  check(Peer.made.length === 2 && Peer.made[1].opts.config.iceTransportPolicy === undefined, 'relay candidate was seen: the retry is a normal attempt');
  check(mp.diag.ever.relay && mp.diag.ever.srflx && mp.diag.ever.host && !mp.diag.gathered, 'candidate types remembered across attempts, gathering restarts');
  clock.advance(25001); await wait(10);
  check(/needs a relay \(TURN\)/.test(st[st.length - 1].text), `candidates found but no link: relay message (${st[st.length - 1].text})`);
  // ICE failed: no need to wait out the clock
  const P2 = stuckNetwork(), c2 = fakeClock(), s2 = [];
  const m2 = new Multiplayer({ loadPeer: async () => P2, setTimeout: c2.setTimeout, clearTimeout: c2.clearTimeout, onStatus: x => s2.push(x), random: rnd });
  await m2.join('ABCDE', 'Me'); await wait(10);
  P2.made[0].pcs[0].setState('failed'); await wait(10);
  check(P2.made.length === 2 && m2.diag.states.join() === 'new,failed,retry,new', `an ICE failure retries at once (${m2.diag.states})`);
  // a TURN-less config does not force relay only
  const P3 = stuckNetwork(), c3 = fakeClock();
  const m3 = new Multiplayer({ loadPeer: async () => P3, setTimeout: c3.setTimeout, clearTimeout: c3.clearTimeout, random: rnd, config: { ...BROKER, iceServers: [{ urls: 'stun:a:1' }] } });
  await m3.join('ABCDE', 'Me'); await wait(10); c3.advance(25001); await wait(10);
  check(P3.made.length === 2 && P3.made[1].opts.config.iceTransportPolicy === undefined, 'no TURN server configured: the retry is not relay only');
  // relayOnly in the config is applied from the first attempt
  const P4 = stuckNetwork(), c4 = fakeClock();
  const m4 = new Multiplayer({ loadPeer: async () => P4, setTimeout: c4.setTimeout, clearTimeout: c4.clearTimeout, random: rnd, loadConfig: async () => resolveConfig('?relay=1', null) });
  await m4.join('ABCDE', 'Me'); await wait(10);
  check(P4.made[0].opts.config.iceTransportPolicy === 'relay', 'relayOnly from config or URL reaches PeerJS');
  // no retry for a missing room or when the broker is unreachable
  const P5 = stuckNetwork({ rooms: false }), c5 = fakeClock(), s5 = [];
  const m5 = new Multiplayer({ loadPeer: async () => P5, setTimeout: c5.setTimeout, clearTimeout: c5.clearTimeout, onStatus: x => s5.push(x), random: rnd });
  await m5.join('ABCDE', 'Me'); await wait(20); c5.advance(60000); await wait(10);
  check(P5.made.length === 1 && /No room with the code ABCDE/.test(s5[s5.length - 1].text), 'no such room: no retry');
  const P6 = stuckNetwork({ brokerOk: false }), s6 = [];
  const m6 = new Multiplayer({ loadPeer: async () => P6, onStatus: x => s6.push(x), random: rnd });
  await m6.join('ABCDE', 'Me'); await wait(20);
  check(P6.made.length === 1 && s6[s6.length - 1].phase === 'error' && /Broker: not reachable/.test(s6[s6.length - 1].details), 'broker down: no retry, details say not reachable');
  // room full: no retry
  const P7 = stuckNetwork(), c7 = fakeClock(), s7 = [];
  const m7 = new Multiplayer({ loadPeer: async () => P7, setTimeout: c7.setTimeout, clearTimeout: c7.clearTimeout, onStatus: x => s7.push(x), random: rnd });
  await m7.join('ABCDE', 'Me'); await wait(10);
  m7.receive(hostId('ABCDE'), 'ctl', { t: 'full' });   // no record yet, so nothing happens
  m7.record(hostId('ABCDE')); m7.receive(hostId('ABCDE'), 'ctl', { t: 'full' }); await wait(10);
  check(P7.made.length === 1 && /full/.test(s7[s7.length - 1].text), 'room full: no retry');
  // a config loader that fails still lets the player connect
  const P8 = stuckNetwork(), s8 = [];
  const m8 = new Multiplayer({ loadPeer: async () => P8, onStatus: x => s8.push(x), random: rnd, loadConfig: async () => { throw new Error('no file'); } });
  await m8.host('H'); await wait(20);
  check(m8.phase === 'hosting' && P8.made[0].opts.config.iceServers.length === 3, 'a broken config loader falls back to the defaults');
  m8.leave();
}
{
  // host side: a guest that is trying shows up, and goes away when it opens
  const Peer = fakeNetwork(), a = player(Peer, 'A');
  await a.mp.host('A'); await wait(20);
  check(/Room [A-Z]{5} is open\./.test(a.statuses[a.statuses.length - 1].text) && !/connecting/.test(a.statuses[a.statuses.length - 1].text), 'host: plain room text with nobody trying');
  let sawTrying = false; const orig = a.mp.onStatus;
  a.mp.onStatus = s => { if (/A player is connecting/.test(s.text)) sawTrying = true; orig(s); };
  const b = player(Peer, 'B'); await b.mp.join(a.mp.code, 'B'); await wait(60);
  check(sawTrying, 'host: shown "A player is connecting..." while the guest links up');
  check(a.mp.trying.size === 0 && !/connecting/.test(a.mp.lastText()) && b.mp.phase === 'joined', 'host: the hint clears once the guest is in');
  a.mp.leave(); b.mp.leave(); await wait(300);
}

// ---------------------------------------------------------------- 4. collisions
console.log('COLLISIONS (two real Car objects)');
const track = buildTrack();
const m = GT.mass, I = GT.yawInertia;
const energy = cars => cars.reduce((e, c) => e + 0.5 * m * (c.vx * c.vx + c.vz * c.vz) + 0.5 * I * c.yawRate * c.yawRate, 0);
const mk = (x, z, heading, speed, yaw = 0) => {
  const c = new Car(GT, track);
  c.x = x; c.z = z; c.heading = heading; c.vx = Math.cos(heading) * speed; c.vz = Math.sin(heading) * speed; c.yawRate = yaw; c.contactGrace = 0;
  return c;
};
// the other car as collideCars wants it, from a snapshot taken before either car moves
const asOther = (c, id) => ({ id, x: c.x, z: c.z, heading: c.heading, vx: c.vx, vz: c.vz, yawRate: c.yawRate, age: 5, silent: 0 });
// Both players resolve against the other's pre-step state (as two clients would), then both integrate.
function run(cars, seconds, onStep) {
  let minGap = Infinity, maxSpeed = 0, penMax = 0;
  const trace = [];
  for (let i = 0; i < seconds / STEP; i++) {
    const snap = cars.map((c, k) => asOther(c, 'p' + k));
    cars.forEach((c, k) => c.collideCars(snap.filter((_, j) => j !== k)));
    for (const c of cars) { c.x += c.vx * STEP; c.z += c.vz * STEP; c.heading += c.yawRate * STEP; }
    for (const c of cars) maxSpeed = Math.max(maxSpeed, Math.hypot(c.vx, c.vz));
    const k = carContact(cars[0], cars[1], GT.length, GT.width);
    if (k) penMax = Math.max(penMax, k.depth);
    if (onStep) onStep(i);
    trace.push(cars.map(c => [c.x, c.z, c.vx, c.vz, c.yawRate, c.heading]));
  }
  return { penMax, maxSpeed, trace, final: cars.map(c => ({ x: c.x, z: c.z, vx: c.vx, vz: c.vz, yr: c.yawRate, h: c.heading })) };
}
{
  // head-on at 30 m/s each, exactly in line
  const A = mk(-30, 0, 0, 30), B = mk(30, 0, Math.PI, 30);
  const e0 = energy([A, B]); let crossed = false;
  const r = run([A, B], 2, () => { if (A.x > B.x) crossed = true; });
  console.log(`  head-on 30+30 m/s: deepest overlap ${r.penMax.toFixed(2)} m, after: ${A.vx.toFixed(1)} and ${B.vx.toFixed(1)} m/s, energy ${(energy([A, B]) / e0 * 100).toFixed(0)} % of before`);
  check(!crossed, 'head-on: no tunnelling (cars never swap places)');
  check(r.penMax < 1.2, `head-on: overlap stays small (${r.penMax.toFixed(2)} m)`);
  check(energy([A, B]) <= e0 * 1.001, 'head-on: energy does not increase');
  check(r.maxSpeed <= 30.001, `head-on: no car gains speed (max ${r.maxSpeed.toFixed(2)})`);
  check(A.vx < 1 && B.vx > -1, 'head-on: they stop or bounce back, not through');
  const k = carContact(A, B, GT.length, GT.width);
  check(!k, 'head-on: separated at the end');
}
{
  // very fast head-on, 75 m/s each, 150 m/s closing: more than a metre per step
  const A = mk(-40, 0, 0, 75), B = mk(40, 0, Math.PI, 75);
  const e0 = energy([A, B]); let crossed = false;
  run([A, B], 2, () => { if (A.x > B.x) crossed = true; });
  check(!crossed, 'fast head-on (150 m/s closing): no tunnelling');
  check(energy([A, B]) <= e0 * 1.001, 'fast head-on: energy does not increase');
}
{
  // rear-end: 20 m/s faster, then offset hits
  for (const off of [0, 0.7, 1.5]) {
    const A = mk(-20, off, 0, 60), B = mk(0, 0, 0, 40);
    const e0 = energy([A, B]); const r = run([A, B], 3);
    check(energy([A, B]) <= e0 * 1.001, `rear-end offset ${off}: energy does not increase`);
    check(r.maxSpeed <= 60.5, `rear-end offset ${off}: nobody gains speed (${r.maxSpeed.toFixed(1)})`);
    check(A.vx <= B.vx + 0.5 || !carContact(A, B, GT.length, GT.width), `rear-end offset ${off}: car behind ends no faster than car ahead`);
    check(!carContact(A, B, GT.length, GT.width) || carContact(A, B, GT.length, GT.width).depth < 0.2, `rear-end offset ${off}: not left overlapping`);
  }
}
{
  // side by side, 40 m/s, closing 1.5 m/s sideways
  const A = mk(0, -1.2, 0, 40), B = mk(0, 1.2, 0, 40);
  A.vz = 0.75; B.vz = -0.75;
  const e0 = energy([A, B]); let gap = Infinity;
  const r = run([A, B], 2, () => { gap = Math.min(gap, B.z - A.z); });
  console.log(`  side by side: closest centre gap ${gap.toFixed(2)} m (car width ${GT.width}), energy ${(energy([A, B]) / e0 * 100).toFixed(1)} % of before, lateral speeds ${A.vz.toFixed(2)} / ${B.vz.toFixed(2)}`);
  check(gap > GT.width - 0.45, `side by side: no tunnelling (gap ${gap.toFixed(2)} m)`);
  check(energy([A, B]) <= e0 * 1.001, 'side by side: energy does not increase');
  check(Math.abs(A.vz) < 1.5 && Math.abs(B.vz) < 1.5 && r.maxSpeed < 40.2, 'side by side: gentle, nobody is thrown');
  check(near(A.vx, 40, 1) && near(B.vx, 40, 1), 'side by side: forward speed barely changes');
}
{
  // a rubbing, staggered side contact with different speeds
  const A = mk(0, -1.0, 0, 50), B = mk(-2, 1.0, 0, 44);
  const e0 = energy([A, B]);
  const r = run([A, B], 2);
  check(energy([A, B]) <= e0 * 1.001 && r.maxSpeed < 50.5, 'staggered rubbing: energy does not increase, nobody gains speed');
  check(Math.abs(A.yawRate) < 3 && Math.abs(B.yawRate) < 3, `staggered rubbing: no wild spin (${A.yawRate.toFixed(2)}, ${B.yawRate.toFixed(2)} rad/s)`);
}
{
  // T-bone at 25 m/s into a standing car
  const A = mk(-15, 0, 0, 25), B = mk(0, 0, Math.PI / 2, 0);
  const e0 = energy([A, B]); const r = run([A, B], 3);
  check(energy([A, B]) <= e0 * 1.001 && r.maxSpeed < 25.5, `T-bone: energy does not increase, nobody gains speed (${r.maxSpeed.toFixed(1)})`);
  check(!carContact(A, B, GT.length, GT.width), 'T-bone: separated at the end');
}
{
  // symmetry: swap which car is which, and mirror the whole scene sideways. Same physical result.
  const scenes = [
    () => [mk(-3, -0.4, 0.05, 35, 0.1), mk(1.5, 0.9, -0.1, 28, -0.2)],
    () => [mk(0, -1.0, 0, 50), mk(-2, 1.0, 0.02, 44)],
  ];
  for (const [si, scene] of scenes.entries()) {
    const ab = scene(), ba = scene().reverse();
    const r1 = run(ab, 1).final, r2 = run(ba, 1).final.reverse();
    let worst = 0;
    for (let k = 0; k < 2; k++) for (const f of ['x', 'z', 'vx', 'vz', 'yr', 'h']) worst = Math.max(worst, Math.abs(r1[k][f] - r2[k][f]));
    check(worst < 1e-9, `symmetry, swapped cars, scene ${si}: identical (worst difference ${worst.toExponential(1)})`);
    // mirror: z -> -z, heading -> -heading, yaw -> -yaw
    const mir = scene().map(c => { c.z = -c.z; c.heading = -c.heading; c.vz = -c.vz; c.yawRate = -c.yawRate; return c; });
    const r3 = run(mir, 1).final;
    let worstM = 0;
    for (let k = 0; k < 2; k++) worstM = Math.max(worstM, Math.abs(r1[k].x - r3[k].x), Math.abs(r1[k].z + r3[k].z), Math.abs(r1[k].vx - r3[k].vx), Math.abs(r1[k].vz + r3[k].vz), Math.abs(r1[k].yr + r3[k].yr));
    check(worstM < 1e-6, `symmetry, mirrored scene ${si}: mirror image (worst difference ${worstM.toExponential(1)})`);
  }
}
{
  // each player sees the other 150 ms late (interpolation delay plus network). A parked car is hit at 30 m/s: it must still be moved.
  const A = mk(0, 0, 0, 0), B = mk(-20, 0, 0, 30), hist = [];
  const e0 = energy([A, B]); let crossed = false;
  const LAG = Math.round(0.15 / STEP);
  for (let i = 0; i < 3 / STEP; i++) {
    hist.push([asOther(A, 'a'), asOther(B, 'b')]);
    const old = hist[Math.max(0, hist.length - 1 - LAG)];
    A.collideCars([old[1]]); B.collideCars([old[0]]);
    for (const c of [A, B]) { c.x += c.vx * STEP; c.z += c.vz * STEP; c.heading += c.yawRate * STEP; }
    if (B.x > A.x) crossed = true;
  }
  console.log(`  parked car hit at 30 m/s with 150 ms of lag: parked car ${A.vx.toFixed(1)} m/s, striker ${B.vx.toFixed(1)} m/s`);
  check(A.vx > 8, `lag: the parked car is moved (${A.vx.toFixed(1)} m/s)`);
  check(!crossed, 'lag: no tunnelling');
  check(energy([A, B]) <= e0 * 1.001 && Math.max(Math.abs(A.vx), Math.abs(B.vx)) <= 30.01, 'lag: energy does not increase, nobody gains speed');
}
{
  // grace, silence, and overlap at rest
  const A = mk(0, 0, 0, 30), other = { id: 'x', x: 1, z: 0, heading: 0, vx: 0, vz: 0, yawRate: 0, age: 5, silent: 0 };
  A.contactGrace = 1.5; A.collideCars([other]);
  check(A.vx === 30 && A.contactGrace < 1.5, 'grace: no contact for 1.5 s after a reset or join');
  const B = mk(0, 0, 0, 30); B.collideCars([{ ...other, silent: 0.6 }]);
  check(B.vx === 30 && B.x === 0, 'silent over 0.5 s: no contact');
  const C = mk(0, 0, 0, 30); C.collideCars([{ ...other, age: 1.0 }]);
  check(C.vx === 30 && C.x === 0, 'a car that has just appeared: no contact for 1.5 s');
  // two cars left overlapping at rest drift apart gently
  const D = mk(0, 0, 0, 0), E = mk(1.2, 0.3, 0, 0);
  const r = run([D, E], 3);
  check(r.maxSpeed < 2.5 && !carContact(D, E, GT.length, GT.width), `overlap at rest: they drift apart gently (peak speed ${r.maxSpeed.toFixed(2)} m/s)`);
  const none = mk(0, 0, 0, 30); none.collideCars([]); check(none.vx === 30, 'no other cars: nothing changes');
}
{
  // driven through Car.step, with the barriers on: two cars on the track, head-on on the start straight
  const A = new Car(GT, track), B = new Car(GT, track);
  A.placeAt(300, 0); B.placeAt(340, 0.3); B.heading += Math.PI;
  const f = (c, v) => { c.vx = Math.cos(c.heading) * v; c.vz = Math.sin(c.heading) * v; c.fwdSpeed = v; c.speed = v; c.contactGrace = 0; };
  f(A, 30); f(B, 30);
  const e0 = energy([A, B]); let crossed = false, vmax = 0;
  const idle = { steer: 0, throttle: 0, brake: 0, drs: false };
  for (let i = 0; i < 4 / STEP; i++) {
    const sa = asOther(A, 'a'), sb = asOther(B, 'b');
    A.collideCars([sb]); B.collideCars([sa]);
    A.step(idle); B.step(idle);
    vmax = Math.max(vmax, Math.hypot(A.vx, A.vz), Math.hypot(B.vx, B.vz));
    const d = (B.x - A.x) * Math.cos(Math.atan2(track.tz[Math.floor(300 / track.ds) % track.N], track.tx[Math.floor(300 / track.ds) % track.N])) + (B.z - A.z) * Math.sin(Math.atan2(track.tz[Math.floor(300 / track.ds) % track.N], track.tx[Math.floor(300 / track.ds) % track.N]));
    if (d < -0.5) crossed = true;
  }
  check(!crossed, 'on the track through Car.step: no tunnelling');
  check(vmax <= 30.3, `on the track through Car.step: nobody gains speed (${vmax.toFixed(1)})`);
  check(energy([A, B]) <= e0, 'on the track through Car.step: energy does not increase');
}

if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nPASS');
