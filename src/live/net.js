// The live page's connection to the relay: where the relay is, the list of open lobbies, and one spectator seat in a room.
// A spectator only listens. RelayClient (src/relay.js) is the same socket the game uses, joined with spectator:true; the relay then
// sends the room's cars (state at 15 Hz), their paint and names, telemetry, the race details and who comes and goes.

import { RelayClient, cleanRelayUrl } from '../relay.js';
import { unpackState, decodeState, cleanName, DELAY, BIN_STATE } from '../ghosts.js';
import { decodeTelemetry, TAG_TELEMETRY } from '../shared/telemetry.js';

export const LIST_MS = 3000;           // the lobby list is read this often
export const SPEC_DELAY = 0.3;         // seconds behind real time the cars are drawn, fixed: states come at 15 Hz (the relay sends spectators every 2nd state from a 30 Hz sender), and a fixed delay keeps the broadcast picture still
const CODE = /^[A-Z]{5}$/;

// ?relay=ws://localhost:8787/ wins, then "relay" in multiplayer.json next to the page. Returns '' when there is none.
export async function findRelay(search, fetchFn = (u, o) => fetch(u, o)) {
  const q = new URLSearchParams(search);
  const fromUrl = cleanRelayUrl(q.get('relay') || '');
  if (fromUrl) return fromUrl;
  try {
    const r = await fetchFn('multiplayer.json', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && typeof j.relay === 'string') return cleanRelayUrl(j.relay); }
  } catch { /* no file: no relay */ }
  return '';
}

export const httpBase = wsUrl => wsUrl.replace(/^ws/i, 'http');

// One entry of GET /lobbies, cleaned for the page. The relay is trusted no further than any server: strings are cut, numbers clamped.
export function cleanLobby(e) {
  if (!e || typeof e !== 'object' || !CODE.test(String(e.code))) return null;
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
  const players = (Array.isArray(e.players) ? e.players : []).slice(0, 8).map(p => cleanName(p && p.name) || 'Player');
  return {
    code: e.code, host: cleanName(e.host) || players[0] || 'Host', players, count: num(e.count || players.length, 0, 8), max: num(e.max || 8, 1, 8),
    mode: String(e.mode || 'Free practice').slice(0, 16), laps: num(e.laps, 0, 999), started: e.started === true, spectators: num(e.spectators, 0, 50),
  };
}

// Reads GET /lobbies. Returns { lobbies, ping } where ping is the round trip of that request in ms. Throws when the relay does not answer.
export async function fetchLobbies(base, fetchFn = (u, o) => fetch(u, o), now = () => performance.now()) {
  const t0 = now();
  const r = await fetchFn(`${base}/lobbies`, { cache: 'no-store' });
  if (!r.ok) throw new Error('relay answered ' + r.status);
  const list = await r.json();
  const ping = Math.max(1, Math.round(now() - t0));
  return { lobbies: (Array.isArray(list) ? list : []).slice(0, 100).map(cleanLobby).filter(Boolean), ping };
}

const peerId = n => 'r' + n;

// One seat as a spectator. handlers: onStatus('connecting' | 'live' | 'reconnecting' | 'full' | 'gone'), onSpectators(n), onTelemetry(id, tele)
// The cars go into `ghosts` (src/ghosts.js, the game's interpolation) and the facts into `model` (src/live/model.js).
export class SpectatorRoom {
  constructor({ url, code, ghosts, model, handlers = {}, WebSocket, timers, now = () => performance.now() }) {
    Object.assign(this, { url, code, ghosts, model, handlers, now });
    ghosts.fixed = SPEC_DELAY;   // before any car arrives: every car is drawn SPEC_DELAY behind, whatever the jitter
    this.players = new Set();
    this.spectators = 0;
    this.client = new RelayClient({
      url, code, name: 'Spectator', spectator: true, WebSocket, timers,
      handlers: {
        onWelcome: m => this.welcome(m),
        onJSON: m => this.control(m),
        onBinary: (id, bytes) => this.binary(id, bytes),
        onState: s => { if (s === 'reconnecting') this.handlers.onStatus?.('reconnecting'); },
        onRefused: kind => this.handlers.onStatus?.(kind === 'full' ? 'full' : 'gone'),
      },
    });
  }

  start() { this.handlers.onStatus?.('connecting'); this.client.connect(); }
  stop() { this.client.stop(); this.ghosts.clear(); }

  welcome(m) {
    const seen = new Set();
    for (const p of Array.isArray(m.players) ? m.players.slice(0, 8) : []) {
      if (!p || typeof p.id !== 'number') continue;
      const id = peerId(p.id);
      seen.add(id);
      this.model.addDriver(id, cleanName(p.name));
    }
    for (const id of [...this.model.drivers.keys()]) if (!seen.has(id)) { this.model.removeDriver(id); this.ghosts.remove(id); }
    this.players = seen;
    if (m.meta) this.model.setMeta(m.meta);
    this.setSpectators(m.spectators);
    this.handlers.onStatus?.('live');
  }

  setSpectators(n) { this.spectators = Math.max(0, Math.min(50, Math.round(+n || 0))); this.handlers.onSpectators?.(this.spectators); }

  control(m) {
    const id = typeof m.from === 'number' ? peerId(m.from) : typeof m.id === 'number' ? peerId(m.id) : '';
    switch (m.t) {
      case 'peer': if (id) this.model.addDriver(id, cleanName(m.name)); break;
      case 'bye': if (id) { this.model.removeDriver(id); this.ghosts.remove(id); } break;
      case 'name': if (typeof m.n === 'string' && this.model.drivers.has(id)) { this.ghosts.setName(id, m.n); this.model.setName(id, cleanName(m.n)); } break;
      case 'lv': if (typeof m.l === 'string' && this.model.drivers.has(id)) { this.ghosts.setLivery(id, m.l); this.ghosts.setProto(id, m.v); } break;
      case 'meta': this.model.setMeta(m); break;
      case 'spec': this.setSpectators(m.n); break;
      default: /* events from the game and anything else: the page works out its own */
    }
  }

  binary(num, bytes) {
    const id = peerId(num), tag = bytes[0];
    if (!this.model.drivers.has(id)) return;
    if (tag === BIN_STATE) {
      const st = decodeState(unpackState(bytes));
      if (!st) return;
      const t = this.now();
      if (this.ghosts.receive(id, st, t)) {
        const g = this.ghosts.map.get(id);
        this.model.state(id, st, st.t + (g && g.buf.off != null ? g.buf.off : t - st.t));
        const l = g && g.livery;
        if (l) this.model.setLivery(id, l);
      }
    } else if (tag === TAG_TELEMETRY) {
      const tele = decodeTelemetry(bytes);
      if (tele) this.model.telemetry(id, tele);
    }
  }
}

export { DELAY };
