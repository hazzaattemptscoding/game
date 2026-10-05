// Lakeside relay protocol: the pure logic, shared by the Cloudflare Durable Object (src/room.js) and the local
// test server (dev-relay.mjs), so one set of tests (tools/relay.js) covers both. No I/O in here.
//
// Wire format (one WebSocket per player, to wss://HOST/room/<CODE>, CODE = 5 letters A to Z):
//
//  client -> relay (JSON text frames)
//    {t:'join', name, id, host?}   first frame. id is a random token the client keeps for the session, so a reconnect
//                                  takes its old slot back. host:true marks the room as hosted (the room's creator).
//    {t:'ping', n}                 every 15 s. Answered to the sender only with {t:'pong', n}. Also keeps the socket alive.
//    {to?, ...anything else}       forwarded to all OTHER players as {...message, from:<sender id>}; with `to:<id>` only to that player.
//  client -> relay (binary frames)  any bytes (car state). Forwarded to all OTHER players as [sender id (1 byte)] + the bytes.
//
//  relay -> client (JSON text frames)
//    {t:'welcome', you, host, players:[{id,name,host}]}   you = your player id (0 to 7), host = the host's id or null,
//                                  players = everybody ELSE already in the room.
//    {t:'peer', id, name, host}    somebody joined.      {t:'bye', id}    somebody left.
//    {t:'pong', n}                 reply to ping.
//    {t:'full'}                    the room has 8 players, socket is closed (4001).
//    {t:'nohost'}                  a guest joined a room nobody is hosting, socket is closed (4002).
//    {t:'taken'}                   host:true join on a room that already has a host, socket is closed (4003).
//  Player ids are slot numbers 0 to 7 and are reused after a player leaves (always preceded by its {t:'bye'}).
//
// Spectators (the live timing page, live.html): {t:'join', spectator:true, name?} or ?spectator=1 on the socket URL. They never count
// toward the 8 players, at most 100 per room, can send only ping, and receive everything the players broadcast plus telemetry:
//    relay -> spectator   {t:'welcome', you:-1, spectator:true, host, players:[{id,name,host}], spectators, meta?}  followed at once by a
//                         snapshot: the stored lv/name messages and the last events as JSON frames (with `from`), the last state and
//                         telemetry frame of each player as binary frames (with the sender id byte), so the view fills immediately.
//                         A room with no players answers {t:'nohost'} (close 4002), a 101st spectator {t:'full', spectator:true} (4001).
//    binary frames        a player's state frame (first byte TAG_STATE = 1) goes to the other players and, every 2nd frame, to spectators
//                         (SPECTATOR_DIVIDER, 10 Hz); a telemetry frame (first byte TAG_TELEMETRY = 2, 14 bytes, src/shared/telemetry.js)
//                         goes to SPECTATORS ONLY, never to other players.
//    {t:'spec', n}        to everybody when the spectator count changes (players send telemetry only while n > 0). The welcome of a
//                         player carries `spectators` when it is above 0.
//    {t:'meta', mode, laps, started}  the host's room details (also in join as `meta`), shown in the lobby directory. All fields optional.
//    {t:'ev', k, ...}     a player's event (lap, limits, jump, best, contact, join, leave), forwarded like any other message.
// Lobby directory: rooms with at least one player publish themselves (lobbyEntry, Directory below); GET /lobbies lists them.
//
// Limits: 8 players, frames over 2048 bytes dropped, 40 frames per second per socket (token bucket, extras dropped),
// sockets with no traffic for 60 s closed (4008), garbage dropped silently. Nothing is stored beyond the live sockets,
// the snapshot for new spectators (memory only) and the lobby directory.
//
// A "room" given to these functions is { conns() } and a "conn" is { att, setAtt(obj), mem, send(stringOrBytes), close(code, reason) }.
// att is the small per-socket record that survives hibernation (id, name, tok, host, last); mem is a plain object that does not.

export const MAX_PLAYERS = 8;
export const MAX_BYTES = 2048;
export const RATE = 40;            // frames per second (20 Hz state + 10 Hz telemetry + pings and messages stay well under)
export const BURST = 40;
export const MAX_SPECTATORS = 100;
export const SPECTATOR_DIVIDER = 2;   // spectators get every 2nd state frame (10 Hz). Override with room.cfg.specDivider (env SPECTATOR_STATE_DIVIDER).
export const TAG_STATE = 1;           // first byte of a car state frame (src/ghosts.js BIN_STATE)
export const TAG_TELEMETRY = 2;       // first byte of a telemetry frame (src/shared/telemetry.js TAG_TELEMETRY; tools/live.js checks both)
export const EVENT_RING = 30;         // events kept for a new spectator
export const DIRECTORY_TTL_MS = 90000;
export const PUBLISH_MIN_MS = 5000;   // a room tells the directory at most this often (join and leave excepted)
export const PUBLISH_BEAT_MS = 30000; // and at least this often while occupied
export const IDLE_MS = 60000;
export const NAME_MAX = 16;
export const CODE_RE = /^[A-Z]{5}$/;
export const CLOSE = { full: 4001, nohost: 4002, taken: 4003, replaced: 4004, idle: 4008 };
// type names only the relay may send; a client frame using one is dropped
const RESERVED = new Set(['join', 'welcome', 'peer', 'bye', 'full', 'nohost', 'taken', 'pong', 'ping', 'spec']);

export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

// '/room/ABCDE' -> {kind:'room', code}, '/health' -> {kind:'health'}, '/lobbies' -> {kind:'lobbies'}, '/lobbies/ABCDE' -> {kind:'lobby', code},
// anything else null. Case of the code is ignored.
export function parseRoute(pathname) {
  if (pathname === '/health') return { kind: 'health' };
  if (pathname === '/lobbies' || pathname === '/lobbies/') return { kind: 'lobbies' };
  const l = /^\/lobbies\/([A-Za-z]{5})$/.exec(pathname);
  if (l) return { kind: 'lobby', code: l[1].toUpperCase() };
  const m = /^\/room\/([A-Za-z]{5})$/.exec(pathname);
  return m ? { kind: 'room', code: m[1].toUpperCase() } : null;
}

// allowed is the ALLOWED_ORIGINS text: comma separated origins, or * for any. A request with no Origin header
// (curl, a native client) passes: the check protects against other websites, it is not authentication.
export function originAllowed(origin, allowed) {
  if (!origin) return true;
  const list = String(allowed ?? '').split(',').map(s => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  if (list.includes('*')) return true;
  return list.includes(String(origin).replace(/\/+$/, '').toLowerCase());
}

const utf8Length = s => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; } return n; };
const isPlayer = c => typeof c.att?.id === 'number';
const isSpec = c => c.att?.spec === true;
const isMember = c => isPlayer(c) || isSpec(c);
const joined = room => room.conns().filter(isPlayer);
const spectators = room => room.conns().filter(isSpec);
const sendJSON = (c, o) => c.send(JSON.stringify(o));
const toBytes = d => d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);

// What the room remembers for new spectators. Memory only: if the Durable Object is evicted it starts empty and fills again from
// the live traffic (players repeat their livery every 2 s, a state arrives 20 times a second).
// room.store is created here on first use; room.cfg is { maxSpectators, specDivider } (optional).
function store(room) { return room.store || (room.store = { lv: {}, name: {}, state: {}, tele: {}, count: {}, events: [], meta: {} }); }
const cfgOf = room => ({ maxSpectators: MAX_SPECTATORS, specDivider: SPECTATOR_DIVIDER, ...(room.cfg || {}) });
const notify = (room, urgent, now) => { if (typeof room.notify === 'function') { try { room.notify(urgent, now); } catch { /* the directory is a nicety */ } } };

// the host's room details, cleaned: mode a short word, laps 0 to 999, started a boolean. Unknown fields are dropped, missing ones stay as they were.
export function cleanMeta(m, base = {}) {
  const out = { ...base };
  if (!m || typeof m !== 'object') return out;
  if (typeof m.mode === 'string') out.mode = m.mode.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 16);
  if (typeof m.laps === 'number' && Number.isFinite(m.laps)) out.laps = Math.max(0, Math.min(999, Math.round(m.laps)));
  if (typeof m.started === 'boolean') out.started = m.started;
  return out;
}

// call when a socket opens. opts.spectator: the URL had ?spectator=1
export function onOpen(conn, now, opts) { conn.mem.last = now; if (opts && opts.spectator) conn.mem.specHint = true; }

function touch(conn, now) {
  conn.mem.last = now;
  if (now - (conn.att?.last || 0) > 10000 && isMember(conn)) conn.setAtt({ ...conn.att, last: now });   // so an idle check after hibernation still knows
}

// One frame from a client. Returns what happened, for the tests: 'rate', 'big', 'bad', 'joined', 'forwarded', 'pong',
// 'full', 'nohost', 'taken', 'ignored', 'spectating', 'telemetry'.
export function onMessage(room, conn, data, now) {
  touch(conn, now);
  const mem = conn.mem;
  mem.tokens = Math.min(BURST, (mem.tokens ?? BURST) + (now - (mem.stamp ?? now)) * RATE / 1000); mem.stamp = now;
  if (mem.tokens < 1) return 'rate';
  mem.tokens -= 1;
  const text = typeof data === 'string';
  if ((text ? utf8Length(data) : (data?.byteLength ?? MAX_BYTES + 1)) > MAX_BYTES) return 'big';
  if (!text) {
    if (!isPlayer(conn)) return 'ignored';       // spectators cannot send anything but ping
    const b = toBytes(data);
    if (!b.length) return 'bad';
    return forwardBinary(room, conn, b);
  }
  let m;
  try { m = JSON.parse(data); } catch { return 'bad'; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return 'bad';
  if (m.t === 'join') return isMember(conn) ? 'ignored' : (m.spectator === true || mem.specHint) ? joinSpectator(room, conn, m, now) : join(room, conn, m, now);
  if (!isMember(conn)) return 'ignored';
  if (m.t === 'ping') { sendJSON(conn, { t: 'pong', n: m.n }); return 'pong'; }
  if (isSpec(conn)) return 'ignored';
  if (m.t === 'meta') return metaFromHost(room, conn, m, now);
  if (RESERVED.has(m.t)) return 'ignored';
  const st = store(room), from = conn.att.id;
  if (m.t === 'lv' && typeof m.l === 'string') st.lv[from] = m.l.slice(0, 80);
  else if (m.t === 'name' && typeof m.n === 'string') st.name[from] = m.n.slice(0, 40);
  else if (m.t === 'ev') { st.events.push({ ...m, from }); if (st.events.length > EVENT_RING) st.events.shift(); }
  const out = JSON.stringify({ ...m, from });
  const to = typeof m.to === 'number' ? m.to : null;
  for (const c of joined(room)) if (c.att.id !== from && (to === null || c.att.id === to)) c.send(out);
  if (to === null) for (const c of spectators(room)) c.send(out);       // a message to one player stays between the two
  return 'forwarded';
}

function forwardBinary(room, conn, b) {
  const id = conn.att.id, st = store(room);
  const out = new Uint8Array(b.length + 1); out[0] = id; out.set(b, 1);
  if (b[0] === TAG_TELEMETRY) {
    st.tele[id] = out;
    for (const c of spectators(room)) c.send(out);
    return 'telemetry';
  }
  for (const c of joined(room)) if (c.att.id !== id) c.send(out);
  if (b[0] === TAG_STATE) {
    st.state[id] = out;
    const n = st.count[id] = (st.count[id] || 0) + 1, div = Math.max(1, cfgOf(room).specDivider | 0);
    if ((n - 1) % div === 0) for (const c of spectators(room)) c.send(out);
  } else for (const c of spectators(room)) c.send(out);
  return 'forwarded';
}

function metaFromHost(room, conn, m, now) {
  if (!conn.att.host) return 'ignored';
  const st = store(room), before = JSON.stringify(st.meta);
  st.meta = cleanMeta(m, st.meta);
  const out = JSON.stringify({ t: 'meta', ...st.meta, from: conn.att.id });
  for (const c of room.conns()) if (isMember(c) && c !== conn) c.send(out);
  notify(room, !!st.meta.started !== (JSON.parse(before).started === true), now);     // the start of a race is worth an immediate update
  return 'forwarded';
}

function join(room, conn, m, now) {
  const all = joined(room).filter(c => c !== conn && c.att.id !== undefined);
  const tok = (typeof m.id === 'string' || typeof m.id === 'number') ? String(m.id).slice(0, 40) : '';
  const host = m.host === true;
  const old = tok ? all.find(c => c.att.tok === tok) : null;
  const hostConn = all.find(c => c.att.host);
  const refuse = (t, code) => { sendJSON(conn, { t }); conn.close(code, t); return t; };
  if (host && hostConn && hostConn !== old) return refuse('taken', CLOSE.taken);
  if (!host && !hostConn) return refuse('nohost', CLOSE.nohost);
  if (all.length - (old ? 1 : 0) >= MAX_PLAYERS) return refuse('full', CLOSE.full);
  let id;
  if (old) { id = old.att.id; old.setAtt({}); old.close(CLOSE.replaced, 'replaced'); }
  else { const used = new Set(all.map(c => c.att.id)); id = 0; while (used.has(id)) id++; }
  const name = cleanName(m.name) || 'Player';
  conn.setAtt({ id, name, tok, host, last: now });
  const st = store(room);
  if (!old && !all.length) { st.lv = {}; st.name = {}; st.state = {}; st.tele = {}; st.count = {}; st.events = []; st.meta = {}; }    // a new room: nothing of an earlier one
  if (host && m.meta) st.meta = cleanMeta(m.meta, st.meta);
  const others = all.filter(c => c !== old);
  const hostNow = host ? id : (hostConn ? hostConn.att.id : null);
  const specs = spectators(room).length;
  const welcome = { t: 'welcome', you: id, host: hostNow, players: others.map(c => ({ id: c.att.id, name: c.att.name, host: !!c.att.host })) };
  if (specs) welcome.spectators = specs;
  sendJSON(conn, welcome);
  const peer = { t: 'peer', id, name, host };
  if (!old) { for (const c of others) sendJSON(c, peer); for (const c of spectators(room)) sendJSON(c, peer); }
  notify(room, !old, now);
  return 'joined';
}

function joinSpectator(room, conn, m, now) {
  const players = joined(room);
  const refuse = (t, code, extra) => { sendJSON(conn, { t, ...extra }); conn.close(code, t); return t; };
  if (!players.length) return refuse('nohost', CLOSE.nohost);
  if (spectators(room).filter(c => c !== conn).length >= cfgOf(room).maxSpectators) return refuse('full', CLOSE.full, { spectator: true });
  const name = cleanName(m.name) || 'Spectator';
  conn.setAtt({ spec: true, name, last: now });
  const st = store(room), hostConn = players.find(c => c.att.host);
  const specs = spectators(room).length;
  const welcome = { t: 'welcome', you: -1, spectator: true, host: hostConn ? hostConn.att.id : null, players: players.map(c => ({ id: c.att.id, name: c.att.name, host: !!c.att.host })), spectators: specs };
  if (Object.keys(st.meta).length) welcome.meta = st.meta;
  sendJSON(conn, welcome);
  // the snapshot: what the players said last, then their last state and telemetry frames
  for (const c of players) {
    const id = c.att.id;
    if (st.name[id]) sendJSON(conn, { t: 'name', n: st.name[id], from: id });
    if (st.lv[id]) sendJSON(conn, { t: 'lv', l: st.lv[id], from: id });
  }
  for (const e of st.events) sendJSON(conn, e);
  for (const c of players) { const id = c.att.id; if (st.state[id]) conn.send(st.state[id]); if (st.tele[id]) conn.send(st.tele[id]); }
  const out = JSON.stringify({ t: 'spec', n: specs });
  for (const c of room.conns()) if (isMember(c) && c !== conn) c.send(out);
  notify(room, false, now);
  return 'spectating';
}

// call when a socket has closed or errored
export function onClose(room, conn, now = Date.now()) {
  if (isSpec(conn)) {
    conn.setAtt({});
    const specs = spectators(room).length;
    const out = JSON.stringify({ t: 'spec', n: specs });
    for (const c of room.conns()) if (isMember(c)) c.send(out);
    notify(room, false, now);
    return;
  }
  if (!isPlayer(conn)) return;
  const id = conn.att.id;
  conn.setAtt({});
  const rest = joined(room).filter(c => c.att.id !== id);
  const st = store(room);
  delete st.state[id]; delete st.tele[id]; delete st.count[id]; delete st.lv[id]; delete st.name[id];
  for (const c of rest) sendJSON(c, { t: 'bye', id });
  for (const c of spectators(room)) sendJSON(c, { t: 'bye', id });
  notify(room, true, now);
}

// close sockets with no traffic for IDLE_MS; call every few seconds. A socket whose last traffic is unknown (just woke from
// hibernation) gets a fresh start rather than being closed.
export function sweep(room, now, idleMs = IDLE_MS) {
  let n = 0;
  for (const c of room.conns()) {
    const last = Math.max(c.mem.last || 0, c.att?.last || 0);
    if (!last) { c.mem.last = now; continue; }
    if (now - last > idleMs) { c.close(CLOSE.idle, 'idle'); n++; }
  }
  return n;
}

// ---- the lobby directory ----

// What a room tells the directory about itself, or null when nobody is playing (the room is then not listed).
export function lobbyEntry(room) {
  const players = joined(room);
  if (!players.length) return null;
  const meta = store(room).meta;
  return {
    players: players.sort((a, b) => a.att.id - b.att.id).map(c => ({ name: c.att.name })), count: players.length, max: MAX_PLAYERS,
    mode: meta.mode || 'Free practice', laps: meta.laps || 0, started: meta.started === true, spectators: spectators(room).length,
  };
}

const cleanEntryIn = e => {
  if (!e || typeof e !== 'object' || !Array.isArray(e.players)) return null;
  const players = e.players.slice(0, MAX_PLAYERS).map(p => ({ name: cleanName(p && p.name) || 'Player' }));
  if (!players.length) return null;
  const meta = cleanMeta(e, {});
  return {
    players, count: players.length, max: MAX_PLAYERS, mode: meta.mode || 'Free practice', laps: meta.laps || 0, started: meta.started === true,
    spectators: Math.max(0, Math.min(MAX_SPECTATORS, Math.round(+e.spectators || 0))),
  };
};

// The directory: code -> entry, with the time of the last heartbeat. Pure: the Durable Object (worker/src/directory.js) and dev-relay.mjs
// both keep one of these. An entry that has not been refreshed for ttl ms is gone.
export class Directory {
  constructor(ttl = DIRECTORY_TTL_MS) { this.ttl = ttl; this.rooms = new Map(); }
  update(code, entry, now) {
    if (!CODE_RE.test(code)) return false;
    const e = cleanEntryIn(entry);
    if (!e) { this.rooms.delete(code); return false; }
    const old = this.rooms.get(code);
    this.rooms.set(code, { ...e, createdAt: old ? old.createdAt : now, at: now });
    if (this.rooms.size > 500) this.prune(now, true);
    return true;
  }
  remove(code) { return this.rooms.delete(code); }
  prune(now, force) {
    for (const [k, v] of this.rooms) if (now - v.at > this.ttl) this.rooms.delete(k);
    if (force && this.rooms.size > 500) { const old = [...this.rooms.entries()].sort((a, b) => a[1].at - b[1].at); for (const [k] of old.slice(0, this.rooms.size - 500)) this.rooms.delete(k); }
  }
  get(code, now) { this.prune(now); const v = this.rooms.get(code); return v ? publicEntry(code, v) : null; }
  // newest rooms first
  list(now) { this.prune(now); return [...this.rooms].map(([k, v]) => publicEntry(k, v)).sort((a, b) => b.createdAt - a.createdAt || (a.code < b.code ? -1 : 1)); }
  // for storage: a plain object, and back
  dump() { return Object.fromEntries(this.rooms); }
  load(o) { this.rooms = new Map(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => CODE_RE.test(k) && v && Array.isArray(v.players))); }
}
const publicEntry = (code, v) => ({ code, players: v.players, count: v.count, max: v.max, mode: v.mode, laps: v.laps, started: v.started, createdAt: v.createdAt, spectators: v.spectators });

// Decides when a room tells the directory. poke(urgent, now): urgent ones (a player joined or left, the race started) go at once, others
// at most one per minMs (the rest wait for tick). tick(now): sends a waiting update, or a heartbeat when beatMs passed. send(entryOrNull)
// is the host's business (a fetch to the directory, or a function call). A room with no players sends null once, then stays quiet.
export class Publisher {
  constructor({ entry, send, minMs = PUBLISH_MIN_MS, beatMs = PUBLISH_BEAT_MS }) { Object.assign(this, { entry, send, minMs, beatMs }); this.last = -Infinity; this.pending = false; this.listed = false; }
  fire(now) { const e = this.entry(); this.last = now; this.pending = false; if (e) { this.listed = true; this.send(e); } else if (this.listed) { this.listed = false; this.send(null); } }
  poke(urgent, now) { if (urgent || now - this.last >= this.minMs) this.fire(now); else this.pending = true; }
  tick(now) { if (this.pending ? now - this.last >= this.minMs : this.listed && now - this.last >= this.beatMs) this.fire(now); }
  // ms until tick has something to do, or null when nothing is listed or waiting
  due(now) { if (this.pending) return Math.max(0, this.last + this.minMs - now); if (this.listed) return Math.max(0, this.last + this.beatMs - now); return null; }
}
