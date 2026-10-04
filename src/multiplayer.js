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

import { decodeState, cleanName, MAX_PLAYERS } from './ghosts.js';

// The one place the broker is configured. These defaults are the free public PeerJS broker. Override any of them
// from the address: ?broker=host:port/path  (add http:// for a plain connection), ?brokerkey=key, ?ice=none or ?ice=stun:host:port.
export const BROKER = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  key: 'peerjs',
  iceServers: null,     // null = PeerJS's own default list (public STUN and TURN); an array replaces it, [] = none (local network only)
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
  return cfg;
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
const JOIN_TIMEOUT = 15000;       // ms to reach the host once the broker answers

export class Multiplayer {
  // opts: ghosts (a Ghosts), config (a BROKER-shaped object), onStatus(status), onPlayers(), now() ms clock,
  // loadPeer() resolving to the PeerJS Peer class, random().
  constructor(opts = {}) {
    this.ghosts = opts.ghosts;
    this.config = opts.config || BROKER;
    this.onStatus = opts.onStatus || (() => {});
    this.onPlayers = opts.onPlayers || (() => {});
    this.now = opts.now || (() => performance.now());
    this.random = opts.random || Math.random;
    this.loadPeer = opts.loadPeer || (async () => (await import('peerjs')).Peer);
    this.reset();
    this.col = 1 + Math.floor(this.random() * 7);       // the colour we ask the others to use; they avoid clashes
    this.name = 'Driver';
  }

  reset() {
    this.phase = 'idle';       // idle, connecting, hosting, joined, error
    this.code = '';
    this.peer = null;
    this.peers = new Map();    // id -> { id, ctl, st, name, hello }
    this.isHost = false;
    this.gen = (this.gen || 0) + 1;     // callbacks from an old session check this and stop
    clearTimeout(this.timer);
  }

  get active() { return this.phase === 'hosting' || this.phase === 'joined' || this.phase === 'connecting'; }
  get players() { return 1 + [...this.peers.values()].filter(p => p.hello).length; }

  status(phase, text) {
    this.phase = phase;
    this.onStatus({ phase, text, code: this.code, players: this.players, host: this.isHost });
  }

  fail(text) {
    this.teardown();
    this.reset();
    this.status('error', text);
  }

  async host(name, tries = 0) {
    if (this.active) return;
    this.name = cleanName(name) || 'Driver';
    this.reset();
    this.isHost = true;
    this.code = makeCode(this.random);
    await this.open(hostId(this.code), async () => {
      this.status('hosting', `Room ${this.code} is open. Share the code; up to ${MAX_PLAYERS} players.`);
    }, tries);
  }

  async join(code, name) {
    if (this.active) return;
    code = cleanCode(code);
    if (code.length !== 5) { this.status('error', 'Type the 5 letters of the room code.'); return; }
    this.name = cleanName(name) || 'Driver';
    this.reset();
    this.code = code;
    await this.open(`${hostId(code)}-${randomSuffix(this.random)}`, async () => {
      this.status('connecting', `Looking for room ${code}...`);
      this.timer = setTimeout(() => { if (this.phase === 'connecting') this.fail(`Reached the broker but not the host of room ${code}. A strict firewall can stop players connecting directly. Playing single player.`); }, JOIN_TIMEOUT);
      this.connectTo(hostId(code), true);
    });
  }

  // Create the peer and wait for the broker to answer.
  async open(id, onOpen, tries = 0) {
    const gen = this.gen;
    this.status('connecting', 'Connecting to the broker...');
    let Peer;
    try { Peer = await this.loadPeer(); } catch (e) { if (gen === this.gen) this.fail('The multiplayer library could not be loaded. Playing single player.'); return; }
    if (gen !== this.gen) return;
    const c = this.config;
    let peer;
    try {
      peer = new Peer(id, { host: c.host, port: c.port, path: c.path, secure: c.secure, key: c.key, debug: c.debug, config: c.iceServers ? { iceServers: c.iceServers } : undefined });
    } catch (e) { this.fail(`Multiplayer is not available in this browser. Playing single player. ${BLOCKED}`); return; }
    this.peer = peer;
    this.timer = setTimeout(() => { if (this.phase === 'connecting' && !peer.open) this.fail(`Could not reach the multiplayer broker (${c.host}). It may be down, or this network or page blocks outside connections. Playing single player. ${BLOCKED}`); }, CONNECT_TIMEOUT);
    peer.on('open', () => { if (gen !== this.gen) return; clearTimeout(this.timer); onOpen(); });
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
      this.fail(`Could not reach the multiplayer broker (${this.config.host}). It may be down, or this network or page blocks outside connections. Playing single player. ${BLOCKED}`);
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
    const st = this.peer.connect(id, { label: 'st', reliable: false, serialization: 'json' });
    this.attach(st, id, 'st', true);
  }

  // Someone connected to us.
  accept(conn) {
    const id = conn.peer;
    if (typeof id !== 'string' || !ID.test(id)) { conn.close(); return; }
    const kind = conn.label === 'st' ? 'st' : 'ctl';
    this.attach(conn, id, kind, false, conn.metadata && conn.metadata.first);
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
        if (!outgoing && this.players >= MAX_PLAYERS && !p.hello) { this.sendTo(conn, { t: 'full' }); setTimeout(() => { try { conn.close(); } catch (e) { /* closed */ } }, 300); this.peers.delete(id); return; }
        this.sendTo(conn, { t: 'hi', n: this.name });
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
        if (this.isHost && p.pending) {
          p.pending = false;
          const ids = [...this.peers.values()].filter(q => q.hello && q.id !== id && ID.test(q.id)).map(q => q.id);
          this.sendTo(p.ctl, { t: 'peers', ids });
        }
        if (!this.isHost && id === hostId(this.code) && this.phase === 'connecting') { clearTimeout(this.timer); this.status('joined', `Joined room ${this.code}.`); }
      }
      this.ghosts && this.ghosts.setName(id, p.name);
      this.changed();
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
    for (const c of [p.ctl, p.st]) { try { if (c) c.close(); } catch (e) { /* closed */ } }
    if (this.ghosts) this.ghosts.remove(id);
    if (this.phase === 'joined' || this.phase === 'hosting') {
      const left = !this.isHost && id === hostId(this.code);
      this.status(this.phase, left ? `The host left. The room carries on with ${this.players - 1} other player${this.players === 2 ? '' : 's'}.` : this.phase === 'hosting' ? `Room ${this.code} is open. Share the code; up to ${MAX_PLAYERS} players.` : `Joined room ${this.code}.`);
    }
    this.onPlayers();
  }

  changed() {
    if (this.phase === 'joined' || this.phase === 'hosting') this.status(this.phase, this.lastText());
    this.onPlayers();
  }

  lastText() {
    return this.phase === 'hosting' ? `Room ${this.code} is open. Share the code; up to ${MAX_PLAYERS} players.` : `Joined room ${this.code}.`;
  }

  // Our name changed: tell everyone.
  setName(name) {
    this.name = cleanName(name) || 'Driver';
    for (const p of this.peers.values()) this.sendTo(p.ctl, { t: 'name', n: this.name });
  }

  // Broadcast our car (an encoded state array). Called about 20 times a second; never waits.
  sendState(arr) {
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
    clearTimeout(this.timer);
    const peer = this.peer;
    this.peer = null;
    for (const p of this.peers.values()) this.sendTo(p.ctl, { t: 'bye' });
    this.peers.clear();
    if (this.ghosts) this.ghosts.clear();
    if (peer) setTimeout(() => { try { peer.destroy(); } catch (e) { /* gone */ } }, 200);    // after the goodbyes have left
  }

  leave() {
    if (this.phase === 'idle') return;
    this.teardown();
    this.reset();
    this.status('idle', 'Not in a room.');
  }
}
