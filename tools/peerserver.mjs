// A tiny PeerJS signalling server for tests, so the two-browser test needs no network and no extra packages.
// It speaks just enough of the PeerJS broker protocol: OPEN, ID-TAKEN, and relaying OFFER, ANSWER, CANDIDATE, LEAVE.
// For real use, run the real thing instead: `npx peer --port 9000` (see the README).
import http from 'node:http';
import crypto from 'node:crypto';

export function startPeerServer(port) {
  const clients = new Map();       // id -> socket
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"name":"test peer server"}'); });
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x'), id = url.searchParams.get('id');
    const key = req.headers['sec-websocket-key'];
    if (!key || !id) { socket.destroy(); return; }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    const send = (s, obj) => {
      const b = Buffer.from(JSON.stringify(obj)), n = b.length;
      const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
      if (!s.destroyed) s.write(Buffer.concat([head, b]));
    };
    if (clients.has(id)) { send(socket, { type: 'ID-TAKEN', payload: { msg: 'ID is taken' } }); socket.end(); return; }
    clients.set(id, socket);
    send(socket, { type: 'OPEN' });
    let buf = Buffer.alloc(0);
    socket.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15, masked = buf[1] & 128;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null; off += masked ? 4 : 0;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
        buf = buf.subarray(off + len);
        if (op === 8) { socket.end(); return; }
        if (op !== 1) continue;
        let m; try { m = JSON.parse(payload.toString()); } catch { continue; }
        if (m.type === 'HEARTBEAT' || !m.dst) continue;
        const dst = clients.get(m.dst);
        if (dst) send(dst, { ...m, src: id });
        else if (m.type !== 'LEAVE' && m.type !== 'EXPIRE') send(socket, { type: 'EXPIRE', src: m.dst });
      }
    });
    const gone = () => { if (clients.get(id) === socket) clients.delete(id); };
    socket.on('close', gone); socket.on('error', gone);
  });
  return new Promise(r => server.listen(port, () => r({ close: () => { for (const s of clients.values()) s.destroy(); server.close(); }, clients })));
}

if (process.argv[1] && process.argv[1].endsWith('peerserver.mjs')) {
  const port = +process.argv[2] || 9000;
  await startPeerServer(port);
  console.log(`test PeerJS server on port ${port}`);
}
