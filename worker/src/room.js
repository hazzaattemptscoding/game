// The Durable Object: one instance per room code. It holds nothing but the live sockets (WebSocket Hibernation API),
// so it can be evicted from memory between messages. All the rules are in protocol.js.
import { onOpen, onMessage, onClose, sweep, MAX_PLAYERS } from './protocol.js';

const SWEEP_MS = 15000;
const MAX_SOCKETS = MAX_PLAYERS * 2;       // sockets that connect but never join count too; refuse a flood

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.wrapped = new WeakMap();
    this.room = { conns: () => this.ctx.getWebSockets().map(ws => this.wrap(ws)) };
  }

  wrap(ws) {
    let w = this.wrapped.get(ws);
    if (!w) {
      let att = {};
      try { att = ws.deserializeAttachment() || {}; } catch { /* none yet */ }
      w = {
        mem: {},
        get att() { return att; },
        setAtt(o) { att = o; try { ws.serializeAttachment(o); } catch { /* socket already gone */ } },
        send(x) { try { ws.send(x); } catch { /* socket already gone */ } },
        close(code, reason) { try { ws.close(code, reason); } catch { /* already closed */ } },
      };
      this.wrapped.set(ws, w);
    }
    return w;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('Room busy', { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    onOpen(this.wrap(server), Date.now());
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) { onMessage(this.room, this.wrap(ws), data, Date.now()); }

  async webSocketClose(ws, code, reason) {
    onClose(this.room, this.wrap(ws));
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1000, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) { onClose(this.room, this.wrap(ws)); }

  // the timer is only a sweep for idle sockets; it stops re-arming when nobody is connected
  async alarm() {
    sweep(this.room, Date.now());
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}
