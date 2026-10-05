// Multiplayer connection: rooms, peers, and sending and receiving car state. Peer to peer over WebRTC with PeerJS,
// so the game is still plain static files. The only server is the PeerJS broker, used for the first handshake only
// ("signalling"); once two players are connected their cars travel directly between browsers.
//
// Everything here is optional. With no room the game never touches this file (PeerJS is loaded only when a player
// hosts or joins), and if the broker or PeerJS cannot be reached the player is told in plain words and carries on alone.
// Nothing is awaited by the game loop: all work happens in event callbacks.
//
// Rooms: a room code is 5 letters. The host's peer id is `lakeside-<code>`, every guest's is `lakeside-<code>-<random>`.
// A guest connects to the host, the host replies with the ids of the players already there, and the guest connects to
// each of them: a full mesh, so nobody relays anything and the room carries on if the host leaves.
// Between each pair there are two data channels: 'ctl' (reliable: hello, name, goodbye) and 'st' (unordered: car state).
// What is sent: car state, name and colour. Nothing else.
//
// Two transports, one Multiplayer class. This file's own code is the peer to peer transport. The other is a relay server
// (src/relay.js, worker/): when multiplayer.json or ?relay=wss://host/ names a relay, host() and join() use that first, and
// if it does not answer within 6 s they fall back to peer to peer (unless ?transport=relay) and say so. Whichever is active,
// this class keeps the same public face (phase, code, peers, players, status callbacks, sendState, setName, leave), and the
// lobby and the game never learn which one it is, except for the label in the status (`transport`) and the ping time (`rtt`).
// A transport is anything with host(name), join(code, name), setName, sendState(arr), leave()/teardown(), and the callbacks
// onStatus, onPlayers, onRtt; RelayRoom in relay.js is one, the methods below (hostPeer, joinPeer, ...) are the other.

import { decodeState, cleanName, MAX_PLAYERS, DELAY } from './ghosts.js';
import { RelayRoom, cleanRelayUrl } from './relay.js';

// ICE servers: the helpers WebRTC uses to find a route between two browsers. We list them explicitly instead of relying on
// PeerJS defaults. STUN servers only tell a browser its outside address (fine for most home networks). TURN servers relay the
// traffic and are what makes strict networks (mobile data, school or office Wi-Fi, symmetric NAT) work.
// NOTE: the openrelay.metered.ca entries are a shared FREE public service with a publicly documented login. It is best
// effort only: it can be slow, rate limited or switched off at any time. For reliable play the owner should replace them with
// their own TURN (Cloudflare Calls TURN, a metered.ca account, or coturn on a small VPS) by editing multiplayer.json (README).
export const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];

// The one place the broker is configured. Order of precedence, lowest first: these defaults, then multiplayer.json next to
// index.html (read when someone hosts or joins, so it can be edited on the web space without a rebuild), then the address
// bar: ?broker=host:port/path (add http:// for a plain connection), ?brokerkey=key, ?ice=none or ?ice=stun:host:port,turn:host:port,
// ?relay=1 (relay only, to test TURN).
export const BROKER = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  key: 'peerjs',
  iceServers: DEFAULT_ICE_SERVERS,   // an array replaces the list, [] = none (local network only)
  relayOnly: false,     // true: iceTransportPolicy 'relay', every connection must go through a TURN server (this is TURN, not the relay server below)
  relayUrl: '',         // wss:// address of the relay server (worker/). Set by "relay" in multiplayer.json or ?relay=wss://host/
  transport: 'auto',    // 'auto' = relay first when relayUrl is set, then peer to peer; 'relay' = relay only; 'peer' = peer to peer only
  debug: 0,             // PeerJS log level, 0 silent to 3 everything
};

const isLocalHost = h => h === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local') || h.includes(':');

// "host", "host:port", "host:port/path", "https://host/path", "http://host:9000". Returns a new config.
export function parseBroker(text, base = BROKER) {
  const cfg = { ...base };
  const m = /^(?:(https?):\/\/)?([^/:\s]+)(?::(\d{1,5}))?(\/.*)?$/i.exec(String(text || '').trim());
  if (!m) return cfg;
  const [, scheme, host, port, path] = m;
  cfg.host = host;
  cfg.secure = scheme ? scheme.toLowerCase() === 'https' : !isLocalHost(host);
  cfg.port = port ? +port : cfg.secure ? 443 : 80;
  let p = path || '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p += '/';
  cfg.path = p;
  return cfg;
}

export function brokerFromSearch(search, base = BROKER) {
  const q = new URLSearchParams(search || '');
  const cfg = q.has('broker') ? parseBroker(q.get('broker'), base) : { ...base };
  if (q.has('brokerkey')) cfg.key = q.get('brokerkey');
  if (q.has('ice')) cfg.iceServers = q.get('ice') === 'none' ? [] : q.get('ice').split(',').map(urls => ({ urls }));   // ?ice=none for a local network, or ?ice=stun:host:3478
  if (q.has('relay')) {
    const url = cleanRelayUrl(q.get('relay'));
    if (url) cfg.relayUrl = url;                                       // ?relay=wss://host/ is the relay server
    else cfg.relayOnly = q.get('relay') !== '0' && q.get('relay') !== 'false';     // ?relay=1 is TURN only
  }
  if (q.has('transport') && ['auto', 'peer', 'relay'].includes(q.get('transport'))) cfg.transport = q.get('transport');
  return cfg;
}

// --- multiplayer.json: { "broker": {host,port,path,secure,key}, "iceServers": [{urls,username,credential}], "relayOnly": false } ---
const ICE_URL = /^(stun|stuns|turn|turns):[^\s]+$/i;
export function cleanIceServers(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const e of list.slice(0, 16)) {
    if (!e || typeof e !== 'object') continue;
    const urls = (Array.isArray(e.urls) ? e.urls : [e.urls]).filter(u => typeof u === 'string' && u.length < 300 && ICE_URL.test(u));
    if (!urls.length) continue;
    const o = { urls: urls.length === 1 ? urls[0] : urls };
    if (typeof e.username === 'string') o.username = e.username.slice(0, 300);
    if (typeof e.credential === 'string') o.credential = e.credential.slice(0, 600);
    out.push(o);
  }
  return out;
}
// Values from the file replace the defaults. Anything of the wrong type is ignored. Returns a new config.
export function applyConfigFile(base, file) {
  const cfg = { ...base };
  if (!file || typeof file !== 'object') return cfg;
  const b = file.broker;
  if (b && typeof b === 'object') {
    if (typeof b.host === 'string' && b.host.trim() && b.host.length < 254) cfg.host = b.host.trim();
    if (Number.isInteger(b.port) && b.port > 0 && b.port < 65536) cfg.port = b.port;
    if (typeof b.path === 'string' && b.path) { let p = b.path.startsWith('/') ? b.path : '/' + b.path; if (!p.endsWith('/')) p += '/'; cfg.path = p; }
    if (typeof b.secure === 'boolean') cfg.secure = b.secure;
    if (typeof b.key === 'string' && b.key) cfg.key = b.key;
  }
  const ice = cleanIceServers(file.iceServers);
  if (ice && (ice.length || file.iceServers.length === 0)) cfg.iceServers = ice;
  if (typeof file.relayOnly === 'boolean') cfg.relayOnly = file.relayOnly;
  if (typeof file.relay === 'string') cfg.relayUrl = cleanRelayUrl(file.relay);
  if (['auto', 'peer', 'relay'].includes(file.transport)) cfg.transport = file.transport;
  return cfg;
}
// Fetch and parse multiplayer.json. Never throws: any failure (missing file, bad JSON, slow server) gives null.
export async function fetchConfigFile(fetchFn, url, timeoutMs = 4000) {
  try {
    const job = (async () => { const res = await fetchFn(url, { cache: 'no-store' }); if (!res || !res.ok) return null; const j = await res.json(); return j && typeof j === 'object' ? j : null; })();
    let t; const timeout = new Promise(r => { t = setTimeout(() => r(null), timeoutMs); });
    const out = await Promise.race([job.catch(() => null), timeout]);
    clearTimeout(t);
    return out;
  } catch (e) { return null; }
}
// defaults < multiplayer.json < address bar
export function resolveConfig(search, file, base = BROKER) { return brokerFromSearch(search, applyConfigFile(base, file)); }
export async function loadConfig({ fetchFn, search = '', build = '', base = BROKER, url = 'multiplayer.json' } = {}) {
  if (typeof fetchFn !== 'function') return resolveConfig(search, null, base);
  const file = await fetchConfigFile(fetchFn, `${url}?v=${encodeURIComponent(build || Date.now())}`);
  return resolveConfig(search, file, base);
}
export const hasTurn = list => Array.isArray(list) && list.some(e => e && [].concat(e.urls || []).some(u => /^turns?:/i.test(u)));
// what RTCPeerConnection gets for this config; `relay` forces relay only for one attempt
export function rtcConfig(cfg, relay = false) {
  const rc = { iceServers: Array.isArray(cfg.iceServers) ? cfg.iceServers : DEFAULT_ICE_SERVERS, sdpSemantics: 'unified-plan' };
  if (cfg.relayOnly || relay) rc.iceTransportPolicy = 'relay';
  return rc;
}

// --- diagnostics: plain text for the lobby ---
export const NO_OUTSIDE = 'No outside address was found, so this network blocks the connection helpers. Try another network or add a TURN server (README)';
export const NEEDS_RELAY = "Your network or the host's network needs a relay (TURN)";
export const newDiag = () => ({ broker: null, brokerHost: '', attempt: 0, relayForced: false, states: [], cand: { host: 0, srflx: 0, relay: 0 }, ever: { host: false, srflx: false, relay: false }, gathered: false, reason: '' });
export const failureReason = d => (d && (d.ever.srflx || d.ever.relay)) ? NEEDS_RELAY : NO_OUTSIDE;
export function diagText(d) {
  if (!d) return '';
  const found = ['host', 'srflx', 'relay'].filter(k => d.ever[k]);
  const lines = [
    `Broker: ${d.broker === null ? 'not tried yet' : d.broker ? 'reachable' : 'not reachable'}${d.brokerHost ? ` (${d.brokerHost})` : ''}`,
    `Attempt ${d.attempt + 1}${d.relayForced ? ' (relay only)' : ''}. Connection: ${d.states.length ? d.states.join(', ') : 'not started'}`,
    `Addresses found: ${found.length ? found.join(', ') : 'none'} (host = this device, srflx = STUN worked, relay = TURN worked)${d.gathered ? '' : ' (still looking)'}`,
  ];
  if (d.reason) lines.push(`Result: ${d.reason}`);
  return lines.join('\n');
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O: they look like 1 and 0
export function makeCode(random = Math.random) {
  let s = '';
  for (let i = 0; i < 5; i++) s += LETTERS[Math.floor(random() * LETTERS.length)];
  return s;
}
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
export const hostId = code => `lakeside-${code}`;
const ID = /^lakeside-[A-Z]{5}(-[a-z0-9]{6})?$/;
const randomSuffix = random => { let s = ''; for (let i = 0; i < 6; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]; return s; };

const BLOCKED = 'If you are viewing this inside the claude.ai artifact page, that page blocks outside connections, so multiplayer only works when the game is on a real web host.';
const CONNECT_TIMEOUT = 9000;     // ms to reach the broker
const JOIN_TIMEOUT = 25000;       // ms to reach the host once the broker answers (per attempt; a failed first attempt is retried once)
const TRYING_MS = 30000;          // how long the host shows "a player is connecting"

export class Multiplayer {
  // opts: ghosts (a Ghosts), config (a BROKER-shaped object), loadConfig() resolving to one (read at host or join time),
  // onStatus(status), onDiag(text), onPlayers(), now() ms clock, loadPeer() resolving to the PeerJS Peer class, random(),
  // joinTimeout ms, setTimeout/clearTimeout (for tests); for the relay: onRtt(ms), WebSocket (class), relayTimers (see relay.js).
  constructor(opts = {}) {
    this.ghosts = opts.ghosts;
    this.config = opts.config || BROKER;
    this.onStatus = opts.onStatus || (() => {});
    this.onPlayers = opts.onPlayers || (() => {});
    this.onDiag = opts.onDiag || (() => {});
    this.loadConfig = opts.loadConfig || null;
    this.joinTimeout = opts.joinTimeout || JOIN_TIMEOUT;
    this.setT = opts.setTimeout || ((f, ms) => setTimeout(f, ms));
    this.clearT = opts.clearTimeout || (t => clearTimeout(t));
    this.diag = newDiag();
    this.now = opts.now || (() => performance.now());
    this.random = opts.random || Math.random;
    this.loadPeer = opts.loadPeer || (async () => (await import('peerjs')).Peer);
    this.onRtt = opts.onRtt || (() => {});
    this.WebSocket = opts.WebSocket;
    this.relayTimers = opts.relayTimers;
    this.relayRoom = null;     // the RelayRoom while the relay transport is in use
    this.transport = 'peer';   // 'relay' or 'peer': which one the current room uses
    this.fallbackNote = '';    // set when the relay could not be reached and the room fell back to peer to peer
    this.preloaded = null;
    this.reset();
    this.col = 1 + Math.floor(this.random() * 7);       // the colour we ask the others to use; they avoid clashes
    this.name = 'Driver';
    this.livery = '';          // our livery as the wire string (src/livery.js encodeLivery), sent in the hello and again by sendLivery()
  }

  reset() {
    this.phase = 'idle';       // idle, connecting, hosting, joined, error
    this.code = '';
    this.peer = null;
    this.peers = new Map();    // id -> { id, ctl, st, name, hello }
    this.isHost = false;
    this.gen = (this.gen || 0) + 1;     // callbacks from an old session check this and stop
    this.trying = new Set();   // host side: guests whose connection arrived but is not open yet
    this.attempt = 0;
    this.relay = false;        // this attempt is relay only (TURN only, not the relay server)
    this.rtt = null;           // ms, round trip to the relay (relay transport only)
    if (this.clearT) this.clearT(this.timer);
  }

  get active() { return this.phase === 'hosting' || this.phase === 'joined' || this.phase === 'connecting'; }
  get players() { return 1 + [...this.peers.values()].filter(p => p.hello).length; }

  status(phase, text) {
    this.phase = phase;
    if (this.fallbackNote && phase !== 'idle') text = `${this.fallbackNote} ${text}`;
    this.onStatus({ phase, text, code: this.code, players: this.players, host: this.isHost, details: diagText(this.diag), transport: this.transport, rtt: this.rtt });
  }

  // update the diagnostics: fn changes this.diag, then the lobby is told
  note(fn) { try { fn(this.diag); this.onDiag(diagText(this.diag)); } catch (e) { /* diagnostics must never break a connection */ } }

  fail(text) {
    this.teardown();
    this.reset();
    this.status('error', text);
  }

  // --- choosing the transport ---

  // The settings for this room: multiplayer.json and the address bar (loadConfig), or the config given to the constructor.
  async resolveConfig() {
    let cfg = null;
    if (this.loadConfig) { try { cfg = await this.loadConfig(); } catch (e) { cfg = null; } }     // a missing or broken multiplayer.json is fine
    return cfg || this.config;
  }

  // Host a room. With a relay configured the relay is tried first; otherwise (or after a retry) peer to peer.
  async host(name, tries = 0) {
    if (this.active) return;
    if (tries) return this.hostPeer(name, tries);
    this.name = cleanName(name) || 'Driver';
    const cfg = await this.start(name);
    if (!cfg) return;
    if (this.useRelay(cfg)) this.viaRelay(cfg, true, '');
    else this.hostPeer(name, 0);
  }

  async join(code, name) {
    if (this.active) return;
    code = cleanCode(code);
    if (code.length !== 5) { this.status('error', 'Type the 5 letters of the room code.'); return; }
    this.name = cleanName(name) || 'Driver';
    const cfg = await this.start(name);
    if (!cfg) return;
    if (this.useRelay(cfg)) this.viaRelay(cfg, false, code);
    else this.joinPeer(code, name);
  }

  // Common start of host() and join(): shows 'connecting' at once (so a second click does nothing), reads the config, and
  // returns it, or null if the player cancelled meanwhile or the settings make a room impossible.
  async start(name) {
    this.fallbackNote = '';
    if (this.relayRoom) { this.relayRoom.teardown(); this.relayRoom = null; }
    this.reset();
    this.transport = 'peer';
    this.status('connecting', 'Connecting...');
    const gen = this.gen;
    const cfg = await this.resolveConfig();
    if (gen !== this.gen) return null;
    this.phase = 'idle';       // hostPeer and joinPeer start their own session
    if (cfg.transport === 'relay' && !cfg.relayUrl) { this.status('error', 'This game is set to use the relay only, but no relay address is set. Add "relay": "wss://..." to multiplayer.json, or use ?relay=wss://host/ in the address. Playing single player.'); return null; }
    this.preloaded = cfg;
    return cfg;
  }

  useRelay(cfg) { return cfg.transport !== 'peer' && !!cfg.relayUrl; }

  // The relay transport: a RelayRoom does the room work, this class mirrors its state so everything outside stays the same.
  viaRelay(cfg, asHost, code) {
    this.preloaded = null;
    this.reset();
    this.transport = 'relay';
    const room = this.relayRoom = new RelayRoom({
      ghosts: this.ghosts, url: cfg.relayUrl, now: this.now, random: this.random, makeCode: () => makeCode(this.random),
      WebSocket: this.WebSocket, timers: this.relayTimers,
      onStatus: s => { if (this.relayRoom === room) this.relayStatus(s, cfg, asHost, code); },
      onPlayers: () => { if (this.relayRoom === room) this.onPlayers(); },
      onRtt: ms => { if (this.relayRoom === room) { this.rtt = ms; this.onRtt(ms); } },
    });
    room.livery = this.livery;
    this.peers = room.peers;
    room.onControl = (m, id) => { if (this.relayRoom === room && this.onControl) this.onControl(m, id); };
    if (asHost) room.host(this.name); else room.join(code, this.name);
  }

  relayStatus(s, cfg, asHost, code) {
    if (s.phase === 'error' && s.reason === 'unreachable' && cfg.transport !== 'relay') {
      // the relay did not answer: peer to peer instead, and say so
      this.relayRoom = null;
      this.reset();
      this.transport = 'peer';
      this.fallbackNote = 'The relay server did not answer, so this room uses peer to peer.';
      this.preloaded = cfg;
      if (asHost) this.hostPeer(this.name, 0); else this.joinPeer(code, this.name);
      return;
    }
    this.phase = s.phase; this.code = s.code; this.isHost = s.host; this.rtt = s.rtt;
    this.onStatus({ ...s, details: '', transport: 'relay' });
  }

  // --- peer to peer: host and join ---

  async hostPeer(name, tries = 0) {
    if (this.active) return;
    this.name = cleanName(name) || 'Driver';
    this.reset();
    this.cfg = this.preloaded; this.preloaded = null;
    if (this.ghosts) this.ghosts.delay = DELAY;
    if (tries === 0) this.diag = newDiag();
    this.isHost = true;
    this.code = makeCode(this.random);
    await this.open(hostId(this.code), async () => {
      this.status('hosting', this.lastText());
    }, tries);
  }

  async joinPeer(code, name) {
    if (this.active) return;
    this.name = cleanName(name) || 'Driver';
    this.cfg = this.preloaded; this.preloaded = null;
    if (this.ghosts) this.ghosts.delay = DELAY;
    this.diag = newDiag();
    await this.attemptJoin(code, 0, false);
  }

  // One try at reaching the host. The first try that times out is repeated once with a fresh peer.
  async attemptJoin(code, attempt, relay) {
    this.reset();
    this.code = code;
    this.attempt = attempt;
    this.relay = relay;
    this.note(d => { d.attempt = attempt; d.relayForced = relay; if (attempt) d.states.push('retry'); d.cand = { host: 0, srflx: 0, relay: 0 }; d.gathered = false; d.broker = null; });
    await this.open(`${hostId(code)}-${randomSuffix(this.random)}`, async () => {
      const gen = this.gen;
      this.status('connecting', `Looking for room ${code}${attempt ? ' (second try)' : ''}...`);
      this.timer = this.setT(() => { if (gen === this.gen && this.phase === 'connecting') this.joinFailed(code, attempt); }, this.joinTimeout);
      this.connectTo(hostId(code), true);
    });
  }

  // The host did not answer in time (or the link failed). Retry once, otherwise explain.
  joinFailed(code, attempt) {
    const reason = failureReason(this.diag);
    if (attempt === 0) {
      // with no relay candidate seen, the second try goes through TURN only (when there is a TURN server to use)
      const cfg = this.cfg || this.config;
      const relay = !this.diag.ever.relay && !cfg.relayOnly && hasTurn(cfg.iceServers);
      this.teardown();
      this.attemptJoin(code, 1, relay);
      return;
    }
    this.note(d => { d.reason = reason; });
    this.fail(`Reached the broker but not the host of room ${code}. ${reason}. Playing single player.`);
  }

  // Create the peer and wait for the broker to answer.
  async open(id, onOpen, tries = 0) {
    const gen = this.gen;
    this.status('connecting', this.attempt ? 'Trying again...' : 'Connecting to the broker...');
    let Peer;
    try { Peer = await this.loadPeer(); } catch (e) { if (gen === this.gen) this.fail('The multiplayer library could not be loaded. Playing single player.'); return; }
    if (gen !== this.gen) return;
    if (!this.cfg) {
      let cfg = null;
      if (this.loadConfig) { try { cfg = await this.loadConfig(); } catch (e) { cfg = null; } }     // a missing or broken multiplayer.json is fine
      if (gen !== this.gen) return;
      this.cfg = cfg || this.config;
    }
    const c = this.cfg;
    this.note(d => { d.brokerHost = c.host; });
    let peer;
    try {
      peer = new Peer(id, { host: c.host, port: c.port, path: c.path, secure: c.secure, key: c.key, debug: c.debug, config: rtcConfig(c, this.relay) });
    } catch (e) { this.fail(`Multiplayer is not available in this browser. Playing single player. ${BLOCKED}`); return; }
    this.peer = peer;
    this.timer = this.setT(() => { if (gen === this.gen && this.phase === 'connecting' && !peer.open) { this.note(d => { d.broker = false; }); this.fail(`Could not reach the multiplayer broker (${c.host}). It may be down, or this network or page blocks outside connections. Playing single player. ${BLOCKED}`); } }, CONNECT_TIMEOUT);
    peer.on('open', () => { if (gen !== this.gen) return; this.clearT(this.timer); this.note(d => { d.broker = true; }); onOpen(); });
    peer.on('connection', conn => { if (gen === this.gen) this.accept(conn); });
    peer.on('disconnected', () => { if (gen === this.gen && this.phase !== 'error') { try { peer.reconnect(); } catch (e) { /* stays connected to the players it has */ } } });
    peer.on('error', err => { if (gen === this.gen) this.peerError(err, tries); });
  }

  peerError(err, tries) {
    const type = err && err.type, msg = (err && err.message) || '';
    if (type === 'unavailable-id' && this.isHost && tries < 4) { const name = this.name; this.teardown(); this.reset(); this.host(name, tries + 1); return; }
    if (type === 'peer-unavailable') {
      if (!this.isHost && msg.includes(hostId(this.code)) && !(this.peers.get(hostId(this.code)) || {}).hello) this.fail(`No room with the code ${this.code}. Check the letters, or ask the host to start it again.`);
      return;       // some other player left while we were connecting: ignore
    }
    if (this.phase === 'connecting' || type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      if (this.phase === 'hosting' || this.phase === 'joined') return;   // already playing: the broker is only needed to meet new players
      this.note(d => { d.broker = false; });
      this.fail(`Could not reach the multiplayer broker (${(this.cfg || this.config).host}). It may be down, or this network or page blocks outside connections. Playing single player. ${BLOCKED}`);
      return;
    }
    if (type === 'browser-incompatible') { this.fail('This browser cannot do peer to peer connections. Playing single player.'); return; }
    if (this.phase !== 'hosting' && this.phase !== 'joined') this.fail(`Multiplayer error (${type || 'unknown'}). Playing single player.`);
  }

  // --- connections ---

  record(id) {
    let p = this.peers.get(id);
    if (!p) { p = { id, ctl: null, st: null, name: '', hello: false }; this.peers.set(id, p); }
    return p;
  }

  // We start the connection (to the host first, then to each player the host names): control channel, then state.
  connectTo(id, first = false) {
    if (!this.peer || this.peers.has(id) || id === this.peer.id) return;
    const ctl = this.peer.connect(id, { label: 'ctl', reliable: true, serialization: 'json', metadata: { first } });
    this.attach(ctl, id, 'ctl', true);
    if (first) this.watchIce(ctl);
    const st = this.peer.connect(id, { label: 'st', reliable: false, serialization: 'json' });
    this.attach(st, id, 'st', true);
  }

  // Someone connected to us.
  accept(conn) {
    const id = conn.peer;
    if (typeof id !== 'string' || !ID.test(id)) { conn.close(); return; }
    const kind = conn.label === 'st' ? 'st' : 'ctl';
    this.attach(conn, id, kind, false, conn.metadata && conn.metadata.first);
    if (kind === 'ctl' && this.isHost && !(this.peers.get(id) || {}).hello) { this.markTrying(id); this.watchIce(conn); }
  }

  // Host side: a guest's connection reached us through the broker but its data link is not open yet.
  markTrying(id) {
    if (this.trying.has(id)) return;
    this.trying.add(id);
    const gen = this.gen;
    this.setT(() => { if (gen === this.gen && this.trying.delete(id)) this.changed(); }, TRYING_MS);
    this.changed();
  }

  // Record the ICE connection state and candidate types of a DataConnection's RTCPeerConnection (conn.peerConnection).
  // PeerJS creates it inside connect() or soon after, so look a few times. Everything is guarded: internals vary by version.
  watchIce(conn, n = 0) {
    const gen = this.gen;
    try {
      const pc = conn && conn.peerConnection;
      if (!pc) { if (n < 10) this.setT(() => { if (gen === this.gen) this.watchIce(conn, n + 1); }, 100); return; }
      if (pc.__lakesideWatched) return;
      pc.__lakesideWatched = true;
      const state = () => {
        try {
          if (gen !== this.gen) return;
          const st = pc.iceConnectionState;
          this.note(d => { if (st && d.states[d.states.length - 1] !== st) d.states.push(st); if (d.states.length > 12) d.states.shift(); });
          if (st === 'failed' && !this.isHost && this.phase === 'connecting') this.joinFailed(this.code, this.attempt);     // no point waiting out the clock
        } catch (e) { /* ignore */ }
      };
      pc.addEventListener('iceconnectionstatechange', state);
      pc.addEventListener('icecandidate', ev => {
        try {
          if (gen !== this.gen) return;
          const c = ev && ev.candidate;
          if (!c) { this.note(d => { d.gathered = true; }); return; }
          let type = c.type; if (!type) { const m = / typ (host|srflx|prflx|relay)/.exec(c.candidate || ''); type = m && m[1]; }
          if (type === 'prflx') type = 'srflx';
          if (type === 'host' || type === 'srflx' || type === 'relay') this.note(d => { d.cand[type]++; d.ever[type] = true; });
        } catch (e) { /* ignore */ }
      });
      state();
    } catch (e) { /* diagnostics only */ }
  }

  attach(conn, id, kind, outgoing, first = false) {
    const gen = this.gen;
    const p = this.record(id);
    if (p[kind] && p[kind] !== conn) { try { p[kind].close(); } catch (e) { /* already gone */ } }
    p[kind] = conn;
    if (kind === 'ctl' && first && this.isHost) p.pending = true;     // the host answers with the player list once the guest's hello arrives
    conn.on('open', () => {
      if (gen !== this.gen) return;
      if (kind === 'ctl') {
        if (!outgoing && this.players >= MAX_PLAYERS && !p.hello) { this.sendTo(conn, { t: 'full' }); this.setT(() => { try { conn.close(); } catch (e) { /* closed */ } }, 300); this.peers.delete(id); return; }
        this.sendTo(conn, { t: 'hi', n: this.name, l: this.livery });
      }
    });
    conn.on('data', data => { if (gen === this.gen) this.receive(id, kind, data); });
    conn.on('close', () => { if (gen === this.gen && p[kind] === conn) { p[kind] = null; if (kind === 'ctl') this.drop(id); } });
    conn.on('error', () => { /* a failed channel shows up as a close; the room carries on */ });
  }

  sendTo(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* the channel closed under us */ } }

  receive(id, kind, data) {
    const p = this.peers.get(id);
    if (!p) return;
    if (Array.isArray(data)) {          // car state
      const st = decodeState(data);
      if (st && p.hello && this.ghosts) this.ghosts.receive(id, st, this.now());
      return;
    }
    if (!data || typeof data !== 'object') return;
    if (data.t === 'hi') {
      p.name = cleanName(data.n) || 'Player';
      if (!p.hello) {
        p.hello = true;
        this.trying.delete(id);
        if (this.isHost && p.pending) {
          p.pending = false;
          const ids = [...this.peers.values()].filter(q => q.hello && q.id !== id && ID.test(q.id)).map(q => q.id);
          this.sendTo(p.ctl, { t: 'peers', ids });
        }
        if (!this.isHost && id === hostId(this.code) && this.phase === 'connecting') { this.clearT(this.timer); this.status('joined', `Joined room ${this.code}.`); }
      }
      this.ghosts && this.ghosts.setName(id, p.name);
      if (typeof data.l === 'string' && this.ghosts) this.ghosts.setLivery(id, data.l);
      this.changed();
    } else if (data.t === 'lv') {
      if (p.hello && typeof data.l === 'string' && this.ghosts) this.ghosts.setLivery(id, data.l);
    } else if (data.t === 'clk' || data.t === 'clkr' || data.t === 'race') {
      if (p.hello && this.onControl) this.onControl(data, id);      // clock samples and race starts (src/raceControl.js)
    } else if (data.t === 'name') {
      p.name = cleanName(data.n) || p.name;
      this.ghosts && this.ghosts.setName(id, p.name);
      this.changed();
    } else if (data.t === 'peers' && Array.isArray(data.ids) && id === hostId(this.code)) {
      for (const q of data.ids.slice(0, MAX_PLAYERS)) if (typeof q === 'string' && ID.test(q) && q.startsWith(`lakeside-${this.code}`)) this.connectTo(q);
    } else if (data.t === 'full') {
      if (id === hostId(this.code)) this.fail(`Room ${this.code} is full (${MAX_PLAYERS} players). Playing single player.`);
    } else if (data.t === 'bye') {
      this.drop(id);
    }
  }

  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    this.trying.delete(id);
    for (const c of [p.ctl, p.st]) { try { if (c) c.close(); } catch (e) { /* closed */ } }
    if (this.ghosts) this.ghosts.remove(id);
    if (this.phase === 'joined' || this.phase === 'hosting') {
      const left = !this.isHost && id === hostId(this.code);
      this.status(this.phase, left ? `The host left. The room carries on with ${this.players - 1} other player${this.players === 2 ? '' : 's'}.` : this.lastText());
    }
    this.onPlayers();
  }

  changed() {
    if (this.phase === 'joined' || this.phase === 'hosting') this.status(this.phase, this.lastText());
    this.onPlayers();
  }

  lastText() {
    if (this.phase !== 'hosting' && !(this.phase === 'connecting' && this.isHost)) return `Joined room ${this.code}.`;
    const n = this.trying.size;
    return `Room ${this.code} is open. Share the code; up to ${MAX_PLAYERS} players.` + (n ? ` ${n === 1 ? 'A player is' : n + ' players are'} connecting...` : '');
  }

  // Our name changed: tell everyone.
  setName(name) {
    this.name = cleanName(name) || 'Driver';
    if (this.relayRoom) { this.relayRoom.setName(this.name); return; }
    for (const p of this.peers.values()) this.sendTo(p.ctl, { t: 'name', n: this.name });
  }

  // --- control messages: one-off JSON that is not car state (clock samples, the host's race start). onControl(msg, fromId) is set by
  // the game (src/raceControl.js). Ids are the same on every machine: the peer id, or 'r<n>' over the relay. ---
  get selfId() { return this.relayRoom ? (this.relayRoom.me == null ? '' : 'r' + this.relayRoom.me) : (this.peer ? this.peer.id : ''); }
  // to everybody in the room (toId undefined) or one player; returns false when there is nobody to send to
  sendControl(obj, toId) {
    if (this.relayRoom) return this.relayRoom.sendControl(obj, toId);
    let sent = false;
    for (const p of this.peers.values()) {
      if (!p.hello || (toId !== undefined && p.id !== toId)) continue;
      this.sendTo(p.ctl, obj);
      sent = true;
    }
    return sent;
  }
  broadcast(obj) { return this.sendControl(obj); }

  // Our livery changed (str is encodeLivery's string): remember it for new players and tell everyone.
  setLivery(str) {
    this.livery = typeof str === 'string' ? str.slice(0, 64) : '';
    this.sendLivery();
  }

  // Say again what we look like. The game calls this every 2 s while in a room, so a livery that was lost or arrived before the
  // car did still gets there, and a repaint reaches everyone within 2 s.
  sendLivery() {
    if (!this.livery) return;
    if (this.relayRoom) { this.relayRoom.livery = this.livery; this.relayRoom.sendLivery(); return; }
    for (const p of this.peers.values()) if (p.hello) this.sendTo(p.ctl, { t: 'lv', l: this.livery });
  }

  // Spectators of the room (the live timing page): only over the relay. Telemetry and the room details go out only over the relay too.
  get spectators() { return this.relayRoom ? this.relayRoom.spectators : 0; }
  sendTelemetry(bytes) { if (this.relayRoom) this.relayRoom.sendTelemetry(bytes); }
  sendMeta(m) { return this.relayRoom ? this.relayRoom.sendMeta(m) : false; }

  // Broadcast our car (an encoded state array). Called about 20 times a second; never waits.
  sendState(arr) {
    if (this.relayRoom) { this.relayRoom.sendState(arr); return; }
    for (const p of this.peers.values()) {
      if (!p.hello) continue;
      const ch = p.st && p.st.open ? p.st : p.ctl;       // if the state channel never opened, state rides the reliable one
      if (!ch || !ch.open) continue;
      const dc = ch.dataChannel;
      if (dc && dc.bufferedAmount > 65536) continue;     // a slow link: skip, do not queue
      try { ch.send(arr); } catch (e) { /* closing */ }
    }
  }

  teardown() {
    if (this.relayRoom) { this.relayRoom.teardown(); this.relayRoom = null; }
    this.clearT(this.timer);
    const peer = this.peer;
    this.peer = null;
    for (const p of this.peers.values()) this.sendTo(p.ctl, { t: 'bye' });
    this.peers.clear();
    if (this.ghosts) this.ghosts.clear();
    if (peer) this.setT(() => { try { peer.destroy(); } catch (e) { /* gone */ } }, 200);    // after the goodbyes have left
  }

  leave() {
    if (this.phase === 'idle') return;
    this.teardown();
    this.reset();
    this.status('idle', 'Not in a room.');
  }
}
