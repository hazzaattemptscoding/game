// Global lap times: the rules, with no I/O. Shared by the Cloudflare Durable Object (times-do.js, SQLite) and worker/dev-relay.mjs
// (an in-memory store), and tested by tools/times.js.
//
// The model talks to a small SYNCHRONOUS store, so the same rules run on SQLite in production and on a Map in the tests:
//   store.get(board, key)        -> row or null, with the ghost string (or null)
//   store.put(board, row)        -> insert or replace the driver's row
//   store.top(board, n)          -> the first n rows by time, then earlier `at`, then key (rows carry hasGhost, not the ghost)
//   store.countAhead(board, row) -> how many rows on the board rank ahead of this row (same order as top)
//   store.count(board)           -> number of rows on the board
//   store.pruneGhosts(board, n)  -> remove the stored ghost of every row that is not in the top n
//   store.owner(key)             -> the hash of the token that owns this name (lowercase key), or null
//   store.setOwner(key, hash)    -> record the owner of a name
// A row is { key, name, time, sectors: [s1, s2, s3], at, ghost }.

import { TRACK } from './track-data.js';

export const MAX_BODY = 64 * 1024;
export const NAME_MAX = 16, BUILD_MAX = 40;
export const MIN_TIME = 60, MAX_TIME = 900, MIN_SECTOR = 5, SECTOR_TOLERANCE = 0.05;
export const TOKEN_RE = /^[0-9a-f]{32}$/;
export const GHOST_TOP = 10;
export const GHOST_MIN_PER_S = 8, GHOST_MAX_PER_S = 12, GHOST_SLACK = 10;
export const GHOST_START_TOL = 0.5, GHOST_END_TOL = 0.05;   // s: the first sample against 0, the last against the posted time
export const GHOST_MAX_SPEED = 120;   // m/s, over any one step

// The lap (TRACK, from src/layout.js: tools/globaltimes.js checks it stays in step). The fastest autopilot lap (tools/laptest.js,
// quick driver, 1:30.1) averages 42.6 m/s. 53 m/s is 25 % above that, a margin for a better line or a better driver. So no lap of
// this length can be posted under LAP_MIN_TIME (72.4 s), and no ghost can cover its path faster than MAX_AVG_SPEED.
export const LAP_LENGTH = TRACK.length;   // m
export const MAX_AVG_SPEED = 53;          // m/s
export const LAP_MIN_TIME = LAP_LENGTH / MAX_AVG_SPEED;
export const GHOST_MIN_PATH = 0.9 * LAP_LENGTH;   // m. Recorded laps run about 0.98 of the length (the line sits inside the centreline on corners)
// The ghost must stay this close to the centreline. The tarmac is 13 m wide and the pit lane sits 15.5 m off the centreline, so 60 m
// allows for run-off and kerbs, and still refuses a line that is on a different part of the map.
export const OFF_TRACK_M = 60;
// The start/finish line and the two sector boundaries: a sample of the ghost must come this close to each. A real line runs within
// about 6 m of the centreline, and a sample is about 4 m apart at 10 samples a second, so 30 m is generous.
export const LINE_TOL_M = 30;
export const RATE_LIMIT = 20, RATE_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_N = 20, MAX_N = 100;

const WEATHER = ['dry', 'wet'], MODE = ['solo', 'online'], DIR = ['fwd', 'rev'], ASSISTS = ['on', 'off'];
export const BOARDS = WEATHER.flatMap(w => MODE.flatMap(m => DIR.flatMap(d => ASSISTS.map(a => `${w}-${m}-${d}-${a}`))));

export const parseTimesRoute = pathname => pathname === '/times' || pathname === '/times/' ? 'times' : pathname === '/ghost' || pathname === '/ghost/' ? 'ghost' : null;

export const boardKey = b => b && typeof b === 'object' && WEATHER.includes(b.weather) && MODE.includes(b.mode) && DIR.includes(b.dir) && ASSISTS.includes(b.assists) ? `${b.weather}-${b.mode}-${b.dir}-${b.assists}` : null;
export const validBoardKey = k => typeof k === 'string' && BOARDS.includes(k);

// Letters of any language, digits, space . _ -. Whitespace of any kind becomes one space, other control characters are removed.
// Returns the cleaned name, or null when it is empty, too long or has other characters.
export function cleanDriverName(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/gu, ' ').replace(/\p{Cc}/gu, '').replace(/ +/g, ' ').trim();
  if (!t || [...t].length > NAME_MAX || !/^[\p{L}\p{N} ._-]+$/u.test(t)) return null;
  return t;
}
export const driverKey = name => name.toLowerCase();

// base64 of little-endian float32 -> Float32Array, or null if it is not that. DataView, so it does not depend on alignment or the host's byte order.
export function decodeGhost(b64) {
  if (typeof b64 !== 'string' || b64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  let bin;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length % 16) return null;   // whole 4-float samples
  const out = new Float32Array(bin.length / 4), dv = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) dv.setUint8(i, bin.charCodeAt(i));
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

// distance in metres from (x, z) to the closed polyline `pts` (flat [x0, z0, x1, z1, ...], the centreline)
export function distToLine(x, z, pts = TRACK.line) {
  const n = pts.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], dx = pts[j * 2] - ax, dz = pts[j * 2 + 1] - az;
    const len2 = dx * dx + dz * dz;
    const f = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = Math.hypot(ax + dx * f - x, az + dz * f - z);
    if (d < best) best = d;
  }
  return best;
}

// null when the ghost is fine, else a plain reason. The checks run from the cheapest to the most work.
export function ghostProblem(b64, time) {
  const g = decodeGhost(b64);
  if (!g) return 'ghost is not a whole number of samples';
  const n = g.length / 4;
  if (n < time * GHOST_MIN_PER_S || n > time * GHOST_MAX_PER_S + GHOST_SLACK) return 'ghost has the wrong number of samples for this lap time';
  for (let i = 0; i < g.length; i++) if (!Number.isFinite(g[i])) return 'ghost has a value that is not a number';
  if (Math.abs(g[0]) > GHOST_START_TOL) return 'ghost does not start at the start of the lap';
  if (Math.abs(g[(n - 1) * 4] - time) > GHOST_END_TOL) return 'ghost does not end at the lap time';
  let path = 0;
  for (let i = 1; i < n; i++) {
    const dt = g[i * 4] - g[(i - 1) * 4];
    if (!(dt > 0)) return 'ghost times must increase';
    const d = Math.hypot(g[i * 4 + 1] - g[(i - 1) * 4 + 1], g[i * 4 + 2] - g[(i - 1) * 4 + 2]);
    if (d / dt > GHOST_MAX_SPEED) return 'ghost moves too fast';
    path += d;
  }
  if (path < GHOST_MIN_PATH) return 'ghost is too short for a full lap';
  if (path > time * MAX_AVG_SPEED) return 'ghost averages too fast for a lap of this length';
  for (let i = 0; i < n; i++) if (distToLine(g[i * 4 + 1], g[i * 4 + 2]) > OFF_TRACK_M) return 'ghost leaves the track';
  const near = (x, z, [px, pz]) => Math.hypot(x - px, z - pz) <= LINE_TOL_M;
  if (!near(g[1], g[2], TRACK.start) || !near(g[(n - 1) * 4 + 1], g[(n - 1) * 4 + 2], TRACK.start)) return 'ghost does not start and finish on the start/finish line';
  for (const boundary of TRACK.sectors) {
    let hit = false;
    for (let i = 0; i < n && !hit; i++) hit = near(g[i * 4 + 1], g[i * 4 + 2], boundary);
    if (!hit) return 'ghost does not pass a sector boundary';
  }
  return null;
}

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const ms = x => Math.round(x * 1000) / 1000;

// body -> { error } or { name, key, board, time, sectors, ghost, token }
export function validateLap(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  const name = cleanDriverName(body.name);
  if (!name) return { error: `name must be 1 to ${NAME_MAX} characters: letters, digits, space . _ -` };
  const board = boardKey(body.board);
  if (!board) return { error: 'unknown board' };
  const { time, sectors } = body;
  if (!isNum(time) || time < MIN_TIME || time > MAX_TIME) return { error: `time must be a number from ${MIN_TIME} to ${MAX_TIME} seconds` };
  if (time < LAP_MIN_TIME) return { error: `time is too fast for a lap of this length (at least ${LAP_MIN_TIME.toFixed(1)} seconds)` };
  if (!Array.isArray(sectors) || sectors.length !== 3 || !sectors.every(isNum)) return { error: 'sectors must be three numbers' };
  if (sectors.some(s => s < MIN_SECTOR)) return { error: `every sector must be at least ${MIN_SECTOR} seconds` };
  if (Math.abs(sectors[0] + sectors[1] + sectors[2] - time) > SECTOR_TOLERANCE) return { error: 'sectors must add up to the lap time' };
  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) return { error: 'token must be 32 lowercase hex characters, sent with every lap' };
  if (body.build !== undefined && (typeof body.build !== 'string' || body.build.length > BUILD_MAX)) return { error: `build must be a string of at most ${BUILD_MAX} characters` };
  if (body.ghost === undefined || body.ghost === null) return { error: 'ghost is required: the line of the lap, sent with every lap' };
  if (typeof body.ghost !== 'string') return { error: 'ghost must be a string' };
  const p = ghostProblem(body.ghost, time);
  if (p) return { error: p };
  return { name, key: driverKey(name), board, time: ms(time), sectors: sectors.map(ms), ghost: body.ghost, token: body.token };
}

// The ownership token is kept only as a SHA-256 hash (hex), in the store, so a copy of the rows holds no token.
export async function hashToken(token) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sliding window per client: at most `limit` hits in `windowMs`. In memory only: it forgets when the object restarts, which is fine for a limit this loose.
export class RateLimiter {
  constructor(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); this.sweptAt = 0; }
  allow(id, now) {
    if (now - this.sweptAt > this.windowMs) {   // drop clients that have gone quiet so the map cannot grow without end
      this.sweptAt = now;
      for (const [k, a] of this.hits) if (!a.length || now - a[a.length - 1] >= this.windowMs) this.hits.delete(k);
    }
    const a = (this.hits.get(id) || this.hits.set(id, []).get(id));
    while (a.length && now - a[0] >= this.windowMs) a.shift();
    if (a.length >= this.limit) return false;
    a.push(now);
    return true;
  }
}

export class TimesModel {
  constructor(store) { this.store = store; }

  // lap = validateLap(...) result with tokenHash. Keeps only the driver's best per board. A name belongs to the token that first
  // posts it, on every board: another token gets { ok: false } until the owner's rows are the only thing left (never, by design).
  submit(lap, now) {
    const { board, key } = lap;
    const owner = this.store.owner(key);
    if (owner === null) this.store.setOwner(key, lap.tokenHash);   // the first poster claims the name, including names from before tokens
    else if (owner !== lap.tokenHash) return { ok: false, error: 'that name belongs to another driver' };
    const old = this.store.get(board, key);
    const improved = !old || lap.time < old.time;
    let row = old;
    if (improved) {
      row = { key, name: lap.name, time: lap.time, sectors: lap.sectors, at: now, ghost: lap.ghost };
      this.store.put(board, row);
      this.store.pruneGhosts(board, GHOST_TOP);
    } else if (old.name !== lap.name) {   // same driver, new spelling: show the latest
      row = { ...old, name: lap.name };
      this.store.put(board, row);
    }
    return { ok: true, improved, rank: this.store.countAhead(board, row) + 1, best: row.time, entries: this.store.count(board) };
  }

  view(row, rank) { return { rank, name: row.name, time: row.time, sectors: row.sectors, at: row.at, ghost: row.hasGhost ?? !!row.ghost }; }

  list(board, n, name) {
    const entries = this.store.top(board, n).map((r, i) => this.view(r, i + 1));
    let you = null;
    const clean = name === undefined || name === null ? null : cleanDriverName(name);
    if (clean) {
      const r = this.store.get(board, driverKey(clean));
      if (r) you = this.view(r, this.store.countAhead(board, r) + 1);
    }
    return { board, entries, you };
  }

  ghost(board, name) {
    const clean = cleanDriverName(name);
    const r = clean && this.store.get(board, driverKey(clean));
    return r && r.ghost ? { name: r.name, time: r.time, ghost: r.ghost } : null;
  }
}

// The whole request logic with no I/O: returns { status, json }. bodyText is the raw POST body (null when it was over MAX_BODY
// before it was read), params a URLSearchParams.
export async function handleTimes(model, limiter, { method, route, params, bodyText, ip, now }) {
  const bad = (status, error) => ({ status, json: { error } });
  if (route === 'times' && method === 'POST') {
    if (!limiter.allow(ip || 'unknown', now)) return bad(429, 'too many laps, try again later');
    if (bodyText === null || (typeof bodyText === 'string' && new TextEncoder().encode(bodyText).length > MAX_BODY)) return bad(413, 'body too large');
    let body;
    try { body = JSON.parse(bodyText); } catch { return bad(400, 'body is not JSON'); }
    const lap = validateLap(body);
    if (lap.error) return bad(400, lap.error);
    const res = model.submit({ ...lap, tokenHash: await hashToken(lap.token) }, now);
    return res.ok ? { status: 200, json: res } : bad(403, res.error);
  }
  if (method !== 'GET') return bad(405, 'method not allowed');
  const board = params.get('board');
  if (!validBoardKey(board)) return bad(400, 'unknown board');
  if (route === 'times') {
    const k = parseInt(params.get('n'), 10);
    const n = Number.isFinite(k) ? Math.max(1, Math.min(MAX_N, k)) : DEFAULT_N;
    return { status: 200, json: model.list(board, n, params.get('name')) };
  }
  const g = model.ghost(board, params.get('name'));
  return g ? { status: 200, json: g } : bad(404, 'no ghost');
}

// The in-memory store (dev-relay.mjs and the tests). Same ordering as the SQL one.
export class MemoryTimesStore {
  constructor() { this.boards = new Map(); this.owners = new Map(); }
  rows(board) { return this.boards.get(board) || this.boards.set(board, new Map()).get(board); }
  sorted(board) { return [...this.rows(board).values()].sort((a, b) => a.time - b.time || a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); }
  get(board, key) { const r = this.rows(board).get(key); return r ? { ...r } : null; }
  put(board, row) { this.rows(board).set(row.key, { ...row }); }
  top(board, n) { return this.sorted(board).slice(0, n).map(({ ghost, ...r }) => ({ ...r, hasGhost: !!ghost })); }
  countAhead(board, row) { return this.sorted(board).filter(r => r.key !== row.key && (r.time < row.time || (r.time === row.time && (r.at < row.at || (r.at === row.at && r.key < row.key))))).length; }
  count(board) { return this.rows(board).size; }
  pruneGhosts(board, n) { this.sorted(board).slice(n).forEach(r => { this.rows(board).get(r.key).ghost = null; }); }
  owner(key) { return this.owners.has(key) ? this.owners.get(key) : null; }
  setOwner(key, hash) { this.owners.set(key, hash); }
}
