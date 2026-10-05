// The relay transport: the same rooms as the peer to peer mode, over one WebSocket to a relay server (the Cloudflare Worker
// in worker/, protocol described in worker/src/protocol.js). Players behind a carrier-grade NAT cannot connect to each other
// directly, but everybody can connect OUT to the relay.
//
// Two classes. RelayClient is the socket: connect, reconnect with backoff, ping, framing. RelayRoom is a room on top of it and
// has the same public shape as the peer to peer room in multiplayer.js (host, join, leave, setName, sendState, peers, players,
// phase, code ...), so the Multiplayer class there, the lobby and the rest of the game do not know which one is active.
//
// Framing: JSON control messages as text frames; car state as ONE binary frame (ghosts.js packState). The relay prefixes the
// sender's player id (one byte, 0 to 7) to binary frames it forwards, and adds `from` to JSON ones.

import { decodeState, packState, unpackState, cleanName, MAX_PLAYERS, DELAY, RELAY_EXTRA_DELAY } from './ghosts.js';

export const RELAY = {
  CONNECT_MS: 6000,                         // no welcome within this long: the relay is unreachable
  PING_MS: 15000,                           // a ping every 15 s; the relay closes a socket after 60 s of silence
  DEAD_MS: 40000,                           // nothing received for this long (the relay answers every ping): the link is dead, reconnect
  BACKOFF: [500, 1000, 2000, 4000, 8000],   // reconnect delays, the last one repeats
  MAX_BUFFERED: 65536,                      // do not queue car state on a slow link
};

const defaultTimers = {
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id),
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id),
  now: () => performance.now(),
};

// "wss://x.workers.dev" or "wss://x.workers.dev/" -> "wss://x.workers.dev". Anything that is not ws:// or wss:// gives ''.
export function cleanRelayUrl(s) {
  const m = /^(wss?):\/\/([^/\s?#]+)(\/[^\s?#]*)?$/i.exec(String(s || '').trim());
  return m ? `${m[1].toLowerCase()}://${m[2]}${(m[3] || '').replace(/\/+$/, '')}` : '';
}

export class RelayClient {
  // o: url (cleaned), code, name, host (bool), token, WebSocket (class), timers, and the handlers
  // onWelcome(msg, first), onJSON(msg), onBinary(id, bytes), onState('open' | 'reconnecting'), onRefused('full' | 'nohost' | 'taken'), onRtt(ms)
  constructor(o) {
    Object.assign(this, { name: 'Driver', host: false, handlers: {} }, o);
    this.WS = o.WebSocket || globalThis.WebSocket;
    this.t = o.timers || defaultTimers;
    this.ws = null; this.closed = false; this.welcomed = false; this.everWelcomed = false;
    this.attempt = 0; this.seq = 0; this.sent = new Map(); this.lastRecv = 0; this.rtt = null;
    this.retryTimer = null; this.pingTimer = null;
  }

  connect() { this.closed = false; this.openSocket(); }

  openSocket() {
    let ws;
    try { ws = new this.WS(`${this.url}/room/${this.code}${this.spectator ? '?spectator=1' : ''}`); } catch (e) { this.lost(); return; }
    this.ws = ws;
    try { ws.binaryType = 'arraybuffer'; } catch (e) { /* fixed by the implementation */ }
    ws.onopen = () => { if (this.ws === ws) { this.lastRecv = this.t.now(); this.send(this.spectator ? { t: 'join', name: this.name, spectator: true } : { t: 'join', name: this.name, id: this.token, host: this.host }); } };
    ws.onmessage = e => { if (this.ws === ws) this.receive(e.data); };
    ws.onerror = () => { /* a failed socket is followed by close */ };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.lost(); } };
  }

  receive(data) {
    this.lastRecv = this.t.now();
    if (typeof data !== 'string') {
      const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
      if (u8 && u8.length > 1 && this.welcomed) this.handlers.onBinary?.(u8[0], u8.subarray(1));
      return;
    }
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'welcome': {
        const first = !this.everWelcomed;
        this.welcomed = this.everWelcomed = true; this.attempt = 0;
        this.startPing();
        this.handlers.onWelcome?.(m, first);
        break;
      }
      case 'pong': {
        const at = this.sent.get(m.n);
        if (at !== undefined) { this.sent.delete(m.n); this.rtt = Math.max(0, Math.round(this.t.now() - at)); this.handlers.onRtt?.(this.rtt); }
        break;
      }
      case 'full': case 'nohost': case 'taken':
        this.stop(); this.handlers.onRefused?.(m.t);
        break;
      default:
        if (this.welcomed) this.handlers.onJSON?.(m);
    }
  }

  startPing() {
    this.t.clearInterval(this.pingTimer);
    this.ping();
    this.pingTimer = this.t.setInterval(() => this.ping(), RELAY.PING_MS);
  }

  ping() {
    const now = this.t.now();
    if (this.lastRecv && now - this.lastRecv > RELAY.DEAD_MS) {       // the relay answers every ping: silence means a dead link
      const ws = this.ws; this.ws = null;
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch (e) { /* gone */ } }
      this.lost();
      return;
    }
    const n = ++this.seq;
    this.sent.set(n, now);
    if (this.sent.size > 8) this.sent.delete(this.sent.keys().next().value);
    this.send({ t: 'ping', n });
  }

  // the socket closed or never opened: try again after a growing delay, unless we closed it ourselves
  lost() {
    this.t.clearInterval(this.pingTimer);
    this.welcomed = false;
    if (this.closed) return;
    this.handlers.onState?.('reconnecting');
    const delay = RELAY.BACKOFF[Math.min(this.attempt, RELAY.BACKOFF.length - 1)];
    this.attempt++;
    this.t.clearTimeout(this.retryTimer);
    this.retryTimer = this.t.setTimeout(() => { if (!this.closed) this.openSocket(); }, delay);
  }

  get ready() { return !!this.ws && this.ws.readyState === 1; }

  send(o) { if (!this.ready) return false; try { this.ws.send(JSON.stringify(o)); return true; } catch (e) { return false; } }

  // car state: one binary frame (bytes from packState). Skipped, not queued, when the link is slow.
  sendBinary(bytes) {
    if (!this.ready || !this.welcomed || this.ws.bufferedAmount > RELAY.MAX_BUFFERED) return false;
    try { this.ws.send(bytes); return true; } catch (e) { return false; }
  }

  stop() {
    this.closed = true;
    this.t.clearInterval(this.pingTimer); this.t.clearTimeout(this.retryTimer);
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(1000); } catch (e) { /* closed */ } }
  }
}

const randomToken = random => { let s = ''; for (let i = 0; i < 16; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]; return s; };
const peerId = n => 'r' + n;
const CONTROL = new Set(['clk', 'clkr', 'race']);     // message types that go to Multiplayer.onControl

export class RelayRoom {
  // opts: ghosts, url, onStatus(status), onPlayers(), onRtt(ms), now() ms clock, random(), makeCode(), WebSocket, timers
  constructor(opts = {}) {
    this.ghosts = opts.ghosts;
    this.url = opts.url;
    this.onStatus = opts.onStatus || (() => {});
    this.onPlayers = opts.onPlayers || (() => {});
    this.onRtt = opts.onRtt || (() => {});
    this.now = opts.now || (() => performance.now());
    this.random = opts.random || Math.random;
    this.makeCode = opts.makeCode || (() => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(this.random() * 24)]).join(''));
    this.WebSocket = opts.WebSocket;
    this.timers = opts.timers || defaultTimers;
    this.connectMs = opts.connectMs || RELAY.CONNECT_MS;
    this.transport = 'relay';
    this.name = 'Driver';
    this.livery = '';          // our livery string, set by Multiplayer; sent as {t:'lv', l} (the relay forwards unknown JSON as it is)
    this.gen = 0;
    this.reset();
  }

  reset() {
    this.phase = 'idle';       // idle, connecting, hosting, joined, error
    this.code = '';
    if (this.peers) this.peers.clear(); else this.peers = new Map();    // 'r<slot>' -> { id, name, hello: true }; one Map for the room's life, so Multiplayer can share it
    this.isHost = false;
    this.client = null;
    this.me = null;
    this.reconnecting = false;
    this.rtt = null;
    this.spectators = 0;       // how many people are watching (the live timing page): while it is above 0 we send state and telemetry even when alone
    this.gen++;
    this.timers.clearTimeout(this.timer);
  }

  get active() { return this.phase === 'hosting' || this.phase === 'joined' || this.phase === 'connecting'; }
  get players() { return 1 + this.peers.size; }
  get hostname() { try { return new URL(this.url.replace(/^ws/i, 'http')).host; } catch (e) { return this.url; } }

  status(phase, text, extra) {
    this.phase = phase;
    this.onStatus({ phase, text, code: this.code, players: this.players, host: this.isHost, transport: 'relay', rtt: this.rtt, reconnecting: this.reconnecting, ...extra });
  }

  roomText() {
    if (this.reconnecting) return 'The connection to the relay was lost. Reconnecting...';
    return this.phase === 'hosting' ? `Room ${this.code} is open. Share the code; up to ${MAX_PLAYERS} players.` : `Joined room ${this.code}.`;
  }

  host(name, tries = 0) {
    if (this.active) return;
    this.begin(name, true, this.makeCode(), tries);
  }

  join(code, name) {
    if (this.active) return;
    code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (code.length !== 5) { this.status('error', 'Type the 5 letters of the room code.'); return; }
    this.begin(name, false, code, 0);
  }

  begin(name, isHost, code, tries) {
    this.name = cleanName(name) || 'Driver';
    this.reset();
    this.isHost = isHost; this.code = code;
    if (this.ghosts) this.ghosts.delay = DELAY + RELAY_EXTRA_DELAY;
    const gen = this.gen;
    this.status('connecting', 'Connecting to the relay...');
    this.client = new RelayClient({
      url: this.url, code, name: this.name, host: isHost, token: randomToken(this.random), WebSocket: this.WebSocket, timers: this.timers,
      handlers: {
        onWelcome: (m, first) => { if (gen === this.gen) this.welcome(m, first); },
        onJSON: m => { if (gen === this.gen) this.control(m); },
        onBinary: (id, bytes) => { if (gen === this.gen) this.binary(id, bytes); },
        onState: s => { if (gen === this.gen && s === 'reconnecting' && (this.phase === 'hosting' || this.phase === 'joined')) { this.reconnecting = true; this.status(this.phase, this.roomText()); } },
        onRefused: kind => { if (gen === this.gen) this.refused(kind, tries); },
        onRtt: ms => { if (gen === this.gen) { this.rtt = ms; this.onRtt(ms); } },
      },
    });
    this.timer = this.timers.setTimeout(() => { if (gen === this.gen && this.phase === 'connecting') this.fail(`Could not reach the relay server (${this.hostname}). It may be down, or this network blocks outside connections. Playing single player.`, 'unreachable'); }, this.connectMs);
    this.client.connect();
  }

  fail(text, reason) {
    this.teardown();
    this.reset();
    this.status('error', text, { reason });
  }

  refused(kind, tries) {
    if (kind === 'taken' && this.isHost && tries < 4) { const name = this.name; this.teardown(); this.reset(); this.host(name, tries + 1); return; }
    if (kind === 'nohost') this.fail(`No room with the code ${this.code}. Check the letters, or ask the host to start it again.`, 'nohost');
    else if (kind === 'full') this.fail(`Room ${this.code} is full (${MAX_PLAYERS} players). Playing single player.`, 'full');
    else this.fail('Could not open a room. Try again.', 'taken');
  }

  welcome(m, first) {
    this.timers.clearTimeout(this.timer);
    this.me = m.you; this.reconnecting = false;
    this.spectators = Math.max(0, Math.min(50, Math.round(+m.spectators || 0)));
    const seen = new Set();
    for (const p of Array.isArray(m.players) ? m.players.slice(0, MAX_PLAYERS) : []) {
      if (!p || typeof p.id !== 'number' || p.id === m.you) continue;
      const id = peerId(p.id);
      seen.add(id);
      const rec = this.peers.get(id);
      if (rec) rec.name = cleanName(p.name) || rec.name; else this.peers.set(id, { id, name: cleanName(p.name) || 'Player', hello: true });
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.dropPeer(id, false);     // left while we were disconnected
    if (first) this.status(this.isHost ? 'hosting' : 'joined', this.roomText()); else this.status(this.phase, this.roomText());
    this.onPlayers();
    this.sendLivery();
  }

  control(m) {
    if (m.t === 'peer' && typeof m.id === 'number' && m.id !== this.me && this.peers.size < MAX_PLAYERS - 1) {
      const id = peerId(m.id);
      this.peers.set(id, { id, name: cleanName(m.name) || 'Player', hello: true });
      this.changed();
      this.sendLivery();      // the newcomer has not seen our paint yet
    } else if (m.t === 'spec') {
      this.spectators = Math.max(0, Math.min(50, Math.round(+m.n || 0)));
    } else if (m.t === 'bye' && typeof m.id === 'number') {
      this.dropPeer(peerId(m.id), true);
    } else if (m.t === 'lv' && typeof m.from === 'number' && typeof m.l === 'string') {
      if (this.peers.has(peerId(m.from)) && this.ghosts) this.ghosts.setLivery(peerId(m.from), m.l);
    } else if (CONTROL.has(m.t) && typeof m.from === 'number') {
      if (this.peers.has(peerId(m.from)) && this.onControl) this.onControl(m, peerId(m.from));     // clock samples and race starts (src/raceControl.js)
    } else if (m.t === 'name' && typeof m.from === 'number') {
      const p = this.peers.get(peerId(m.from));
      if (!p) return;
      p.name = cleanName(m.n) || p.name;
      this.ghosts && this.ghosts.setName(p.id, p.name);
      this.changed();
    }
  }

  binary(num, bytes) {
    const id = peerId(num);
    if (!this.peers.has(id) || !this.ghosts) return;
    const st = decodeState(unpackState(bytes));
    if (st) this.ghosts.receive(id, st, this.now());
  }

  dropPeer(id, announce) {
    if (!this.peers.delete(id)) return;
    if (this.ghosts) this.ghosts.remove(id);
    if (announce && (this.phase === 'joined' || this.phase === 'hosting')) this.status(this.phase, this.roomText());
    this.onPlayers();
  }

  changed() {
    if (this.phase === 'joined' || this.phase === 'hosting') this.status(this.phase, this.roomText());
    this.onPlayers();
  }

  setName(name) {
    this.name = cleanName(name) || 'Driver';
    if (this.client) { this.client.name = this.name; this.client.send({ t: 'name', n: this.name }); }
  }

  // a control message for everyone, or for one player (`to` is a peer id 'r<n>'): the relay forwards unknown JSON as it is and adds `from`
  sendControl(obj, to) {
    if (!this.client || !this.peers.size) return false;
    if (to === undefined) return this.client.send(obj);
    const n = +String(to).slice(1);
    return Number.isInteger(n) ? this.client.send({ ...obj, to: n }) : false;
  }

  sendLivery() { if (this.client && this.livery && (this.peers.size || this.spectators)) this.client.send({ t: 'lv', l: this.livery }); }

  // the host's room details for the lobby directory (the relay ignores them from anybody else); m is { mode, laps, started }
  sendMeta(m) { return !!this.client && this.isHost && this.client.send({ t: 'meta', mode: m.mode, laps: m.laps, started: m.started }); }

  // a telemetry frame (src/shared/telemetry.js): the relay passes it to spectators only, so send it only while somebody watches
  sendTelemetry(bytes) { if (this.client && this.spectators > 0) this.client.sendBinary(bytes); }

  // Broadcast our car (the array from encodeState) as one binary frame. About 20 times a second; never waits.
  sendState(arr) {
    if (this.client && (this.peers.size || this.spectators)) this.client.sendBinary(packState(arr));
  }

  teardown() {
    this.timers.clearTimeout(this.timer);
    if (this.client) this.client.stop();
    this.client = null;
    this.peers.clear();
    if (this.ghosts) this.ghosts.clear();
  }

  leave() {
    if (this.phase === 'idle') return;
    this.teardown();
    this.reset();
    this.status('idle', 'Not in a room.');
  }
}
