// The Durable Object: one instance per room code. It holds nothing but the live sockets (WebSocket Hibernation API),
// so it can be evicted from memory between messages, plus a small snapshot for new spectators (memory only). All the rules are in protocol.js.
// It also tells the lobby directory (directory.js) when players join or leave and every 30 s while occupied.
import { onOpen, onMessage, onClose, sweep, lobbyEntry, Publisher, MAX_PLAYERS, MAX_SPECTATORS, CODE_RE } from './protocol.js';

const SWEEP_MS = 15000;

const intVar = (v, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined; };

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.wrapped = new WeakMap();
    this.code = null;
    // optional settings (Worker variables): MAX_SPECTATORS (default 100) and SPECTATOR_STATE_DIVIDER (default 2: spectators get every 2nd state frame)
    const cfg = {};
    const maxSpec = intVar(env && env.MAX_SPECTATORS, 0, MAX_SPECTATORS), div = intVar(env && env.SPECTATOR_STATE_DIVIDER, 1, 20);
    if (maxSpec !== undefined) cfg.maxSpectators = maxSpec;
    if (div !== undefined) cfg.specDivider = div;
    this.maxSockets = MAX_PLAYERS * 2 + (cfg.maxSpectators ?? MAX_SPECTATORS) + 4;     // sockets that connect but never join count too; refuse a flood
    this.pub = new Publisher({ entry: () => lobbyEntry(this.room), send: e => this.publish(e) });
    this.room = {
      conns: () => this.ctx.getWebSockets().map(ws => this.wrap(ws)), cfg,
      notify: (urgent, now) => { this.pub.poke(urgent, now); this.ctx.waitUntil(this.arm()); },
    };
    // woken from hibernation with players in the room: the directory already lists us
    if (this.room.conns().some(c => typeof c.att.id === 'number')) this.pub.listed = true;
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

  // Tell the directory (a Durable Object of its own). e is the room's entry, or null when the room is empty.
  async publish(e) {
    const env = this.env;
    if (!env || !env.DIRECTORY) return;
    const code = this.code || (this.code = await this.ctx.storage.get('code'));
    if (!code) return;
    try {
      await env.DIRECTORY.get(env.DIRECTORY.idFromName('directory')).fetch('https://directory/update', { method: 'POST', body: JSON.stringify({ code, entry: e }) });
    } catch { /* the directory is a nicety: a failed update is repaired by the next heartbeat */ }
  }

  // the timer: a sweep for idle sockets every 15 s, and the directory's waiting update or heartbeat when due
  async arm() {
    const due = this.pub.due(Date.now());
    const at = Date.now() + Math.min(SWEEP_MS, due === null ? SWEEP_MS : due);
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || cur > at + 50) await this.ctx.storage.setAlarm(at);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (this.ctx.getWebSockets().length >= this.maxSockets) return new Response('Room busy', { status: 503 });
    const code = (request.headers.get('x-lakeside-code') || '').toUpperCase();
    if (CODE_RE.test(code) && code !== this.code) { this.code = code; await this.ctx.storage.put('code', code); }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    onOpen(this.wrap(server), Date.now(), { spectator: new URL(request.url).searchParams.get('spectator') === '1' });
    await this.arm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) { onMessage(this.room, this.wrap(ws), data, Date.now()); }

  async webSocketClose(ws, code, reason) {
    onClose(this.room, this.wrap(ws), Date.now());
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1000, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) { onClose(this.room, this.wrap(ws), Date.now()); }

  async alarm() {
    const now = Date.now();
    sweep(this.room, now);
    this.pub.tick(now);
    if (this.ctx.getWebSockets().length) await this.arm();
  }
}
