// Local stand-in for the Cloudflare Worker: the same protocol (src/protocol.js), a hand-written RFC 6455 server, no packages.
// Run: node worker/dev-relay.mjs [port]   (default 8787). Then use ?relay=ws://localhost:8787/ in the game.
// Environment: ALLOWED_ORIGINS (default *), MAX_SPECTATORS, SPECTATOR_STATE_DIVIDER like the Worker. Also serves GET /lobbies and /lobbies/CODE
// (the directory lives in this process) and /times and /ghost (the global lap times, kept in memory, same rules as the Worker). Used by tools/relay.js, tools/live.js and tools/relay-live.mjs.
import http from 'node:http';
import crypto from 'node:crypto';
import { parseRoute, originAllowed, onOpen, onMessage, onClose, sweep, lobbyEntry, Directory, Publisher, IDLE_MS, MAX_PLAYERS, MAX_SPECTATORS, DIRECTORY_TTL_MS, PUBLISH_MIN_MS, PUBLISH_BEAT_MS } from './src/protocol.js';

import { parseTimesRoute, TimesModel, MemoryTimesStore, RateLimiter, handleTimes, MAX_BODY } from './src/times.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 64 * 1024;

function frame(op, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  return Buffer.concat([head, payload]);
}

export function startRelay({ port = 0, allowed = process.env.ALLOWED_ORIGINS ?? '*', idleMs = IDLE_MS, sweepMs = 5000, cfg: cfgIn, ttl = DIRECTORY_TTL_MS, publishMs = PUBLISH_MIN_MS, beatMs = PUBLISH_BEAT_MS } = {}) {
  const cfg = { ...cfgIn };
  if (cfg.maxSpectators === undefined && process.env.MAX_SPECTATORS) cfg.maxSpectators = Math.max(0, Math.min(MAX_SPECTATORS, +process.env.MAX_SPECTATORS || 0));
  if (cfg.specDivider === undefined && process.env.SPECTATOR_STATE_DIVIDER) cfg.specDivider = Math.max(1, Math.min(20, +process.env.SPECTATOR_STATE_DIVIDER || 1));
  const directory = new Directory(ttl);
  const rooms = new Map();        // code -> Set of conns
  const roomObjs = new Map();     // code -> { conns(), cfg, store, notify, pub } (what protocol.js sees as `room`)
  const roomFor = (code, set) => {
    let r = roomObjs.get(code);
    if (!r) {
      r = { conns: () => [...set], cfg, pub: null, notify(urgent, now) { r.pub.poke(urgent, now); } };
      r.pub = new Publisher({ entry: () => lobbyEntry(r), send: e => { if (e) directory.update(code, e, Date.now()); else directory.remove(code); }, minMs: publishMs, beatMs });
      roomObjs.set(code, r);
    }
    return r;
  };
  const stats = { sockets: 0 };
  const times = { model: new TimesModel(new MemoryTimesStore()), limiter: new RateLimiter() };
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const timesUrl = new URL(req.url, 'http://x'), timesRoute = parseTimesRoute(timesUrl.pathname);
    if (timesRoute) {
      const ok = origin && originAllowed(origin, allowed);
      const head = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}) };
      const send = (status, json) => { res.writeHead(status, head); res.end(JSON.stringify(json)); };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...head, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }); res.end(); return; }
      if (req.method === 'POST' && !ok) return send(403, { error: 'origin not allowed' });
      const run = async bodyText => { const r = await handleTimes(times.model, times.limiter, { method: req.method, route: timesRoute, params: timesUrl.searchParams, bodyText, ip: req.socket.remoteAddress, now: Date.now() }); send(r.status, r.json); };
      if (req.method !== 'POST') return run(undefined);
      // the body is counted as it arrives; over MAX_BODY it is not kept, and times.js answers 413 (as the Worker does, times-do.js)
      const chunks = []; let size = 0, over = false;
      req.on('data', c => { size += c.length; if (size > MAX_BODY) over = true; else chunks.push(c); });
      req.on('end', () => run(over ? null : Buffer.concat(chunks).toString('utf8')));
      return;
    }
    const route = parseRoute(new URL(req.url, 'http://x').pathname);
    const cors = origin && originAllowed(origin, allowed) ? { 'Access-Control-Allow-Origin': origin } : {};
    if (route?.kind === 'health') { res.writeHead(200, { 'Content-Type': 'text/plain', ...cors }); res.end('ok'); return; }
    if (route?.kind === 'lobbies' || route?.kind === 'lobby') {
      const body = route.kind === 'lobbies' ? directory.list(Date.now()) : directory.get(route.code, Date.now());
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }); res.end(JSON.stringify(body || { error: 'no such room' })); return;
    }
    res.writeHead(route ? 426 : 404, { 'Content-Type': 'text/plain' }); res.end(route ? 'Expected a WebSocket' : 'Lakeside dev relay');
  });
  server.on('upgrade', (req, socket) => {
    const reqUrl = new URL(req.url, 'http://x'), route = parseRoute(reqUrl.pathname), key = req.headers['sec-websocket-key'];
    const refuse = (s, m) => { socket.end(`HTTP/1.1 ${s} ${m}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (route?.kind !== 'room' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return refuse(route ? 400 : 404, 'No');
    if (!originAllowed(req.headers.origin, allowed)) return refuse(403, 'Forbidden');
    const set = rooms.get(route.code) || rooms.set(route.code, new Set()).get(route.code);
    if (set.size >= MAX_PLAYERS * 2 + (cfg.maxSpectators ?? MAX_SPECTATORS) + 4) return refuse(503, 'Busy');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
    socket.setNoDelay(true);
    let att = {}, closed = false;
    const conn = {
      mem: {}, get att() { return att; }, setAtt(o) { att = o; },
      send(x) { if (!socket.destroyed) socket.write(typeof x === 'string' ? frame(1, Buffer.from(x)) : frame(2, Buffer.from(x.buffer, x.byteOffset, x.byteLength))); },
      close(code = 1000, reason = '') { if (closed) return; closed = true; const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code); p.write(reason, 2); if (!socket.destroyed) socket.end(frame(8, p)); },
    };
    const room = roomFor(route.code, set);
    set.add(conn); stats.sockets++;
    onOpen(conn, Date.now(), { spectator: reqUrl.searchParams.get('spectator') === '1' });
    let buf = Buffer.alloc(0), msgOp = 0, parts = [];
    const gone = () => {
      if (!set.has(conn)) return;
      set.delete(conn); stats.sockets--; closed = true;
      onClose(room, conn, Date.now());
      if (!set.size) { rooms.delete(route.code); roomObjs.delete(route.code); }
    };
    socket.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 128, op = buf[0] & 15, masked = buf[1] & 128;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (len > MAX_FRAME) { conn.close(1009, 'too big'); socket.destroy(); return; }
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null; off += masked ? 4 : 0;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
        buf = buf.subarray(off + len);
        if (op === 8) { conn.close(1000, ''); return; }
        if (op === 9) { if (!socket.destroyed) socket.write(frame(10, payload)); continue; }
        if (op === 10) continue;
        if (op === 1 || op === 2) { msgOp = op; parts = [payload]; } else if (op === 0) parts.push(payload); else continue;
        if (!fin) { if (parts.reduce((a, p) => a + p.length, 0) > MAX_FRAME) { socket.destroy(); return; } continue; }
        const whole = parts.length === 1 ? parts[0] : Buffer.concat(parts); parts = [];
        onMessage(room, conn, msgOp === 1 ? whole.toString('utf8') : new Uint8Array(whole.buffer, whole.byteOffset, whole.byteLength), Date.now());
      }
    });
    socket.on('close', gone); socket.on('error', () => { socket.destroy(); gone(); });
  });
  const timer = setInterval(() => { const now = Date.now(); for (const [code, set] of rooms) { sweep({ conns: () => [...set] }, now, idleMs); roomObjs.get(code)?.pub.tick(now); } }, sweepMs);
  timer.unref();
  return new Promise(r => server.listen(port, () => r({
    port: server.address().port, rooms, stats, directory, roomObjs, times,
    close() { clearInterval(timer); for (const set of rooms.values()) for (const c of set) c.close(1001, 'shutdown'); server.close(); server.closeAllConnections?.(); },
  })));
}

if (process.argv[1] && process.argv[1].endsWith('dev-relay.mjs')) {
  const port = +process.argv[2] || 8787;
  const r = await startRelay({ port });
  console.log(`Lakeside dev relay on ws://localhost:${r.port}/room/ABCDE  (health: http://localhost:${r.port}/health, origins: ${process.env.ALLOWED_ORIGINS ?? '*'})`);
}
