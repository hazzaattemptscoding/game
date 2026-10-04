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
// Limits: 8 players, frames over 2048 bytes dropped, 40 frames per second per socket (token bucket, extras dropped),
// sockets with no traffic for 60 s closed (4008), garbage dropped silently. Nothing is stored beyond the live sockets.
//
// A "room" given to these functions is { conns() } and a "conn" is { att, setAtt(obj), mem, send(stringOrBytes), close(code, reason) }.
// att is the small per-socket record that survives hibernation (id, name, tok, host, last); mem is a plain object that does not.

export const MAX_PLAYERS = 8;
export const MAX_BYTES = 2048;
export const RATE = 40;            // frames per second
export const BURST = 40;
export const IDLE_MS = 60000;
export const NAME_MAX = 16;
export const CODE_RE = /^[A-Z]{5}$/;
export const CLOSE = { full: 4001, nohost: 4002, taken: 4003, replaced: 4004, idle: 4008 };
// type names only the relay may send; a client frame using one is dropped
const RESERVED = new Set(['join', 'welcome', 'peer', 'bye', 'full', 'nohost', 'taken', 'pong', 'ping']);

export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

// '/room/ABCDE' -> {kind:'room', code}, '/health' -> {kind:'health'}, anything else null. Case of the code is ignored.
export function parseRoute(pathname) {
  if (pathname === '/health') return { kind: 'health' };
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
const isJoined = c => typeof c.att?.id === 'number';
const joined = room => room.conns().filter(isJoined);
const sendJSON = (c, o) => c.send(JSON.stringify(o));
const toBytes = d => d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);

// call when a socket opens
export function onOpen(conn, now) { conn.mem.last = now; }

function touch(conn, now) {
  conn.mem.last = now;
  if (now - (conn.att?.last || 0) > 10000 && isJoined(conn)) conn.setAtt({ ...conn.att, last: now });   // so an idle check after hibernation still knows
}

// One frame from a client. Returns what happened, for the tests: 'rate', 'big', 'bad', 'joined', 'forwarded', 'pong',
// 'full', 'nohost', 'taken', 'ignored'.
export function onMessage(room, conn, data, now) {
  touch(conn, now);
  const mem = conn.mem;
  mem.tokens = Math.min(BURST, (mem.tokens ?? BURST) + (now - (mem.stamp ?? now)) * RATE / 1000); mem.stamp = now;
  if (mem.tokens < 1) return 'rate';
  mem.tokens -= 1;
  const text = typeof data === 'string';
  if ((text ? utf8Length(data) : (data?.byteLength ?? MAX_BYTES + 1)) > MAX_BYTES) return 'big';
  if (!text) {
    if (!isJoined(conn)) return 'ignored';
    const b = toBytes(data);
    if (!b.length) return 'bad';
    const out = new Uint8Array(b.length + 1); out[0] = conn.att.id; out.set(b, 1);
    for (const c of joined(room)) if (c.att.id !== conn.att.id) c.send(out);
    return 'forwarded';
  }
  let m;
  try { m = JSON.parse(data); } catch { return 'bad'; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return 'bad';
  if (m.t === 'join') return isJoined(conn) ? 'ignored' : join(room, conn, m, now);
  if (!isJoined(conn)) return 'ignored';
  if (m.t === 'ping') { sendJSON(conn, { t: 'pong', n: m.n }); return 'pong'; }
  if (RESERVED.has(m.t)) return 'ignored';
  const out = JSON.stringify({ ...m, from: conn.att.id });
  const to = typeof m.to === 'number' ? m.to : null;
  for (const c of joined(room)) if (c.att.id !== conn.att.id && (to === null || c.att.id === to)) c.send(out);
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
  const others = all.filter(c => c !== old);
  const hostNow = host ? id : (hostConn ? hostConn.att.id : null);
  sendJSON(conn, { t: 'welcome', you: id, host: hostNow, players: others.map(c => ({ id: c.att.id, name: c.att.name, host: !!c.att.host })) });
  if (!old) for (const c of others) sendJSON(c, { t: 'peer', id, name, host });
  return 'joined';
}

// call when a socket has closed or errored
export function onClose(room, conn) {
  if (!isJoined(conn)) return;
  const id = conn.att.id;
  conn.setAtt({});
  for (const c of joined(room)) if (c.att.id !== id) sendJSON(c, { t: 'bye', id });
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
