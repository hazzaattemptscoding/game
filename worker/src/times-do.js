// The global times: ONE Durable Object (idFromName('times')). The rules are in times.js; this file only keeps the rows in the
// object's SQLite storage (ctx.storage.sql, the synchronous API) and answers requests that index.js forwards.
// Stored per driver and board: the display name, lap time, three sectors, when the lap was set and (top 10 only) the ghost. No IPs.
import { TimesModel, RateLimiter, handleTimes, parseTimesRoute } from './times.js';

export class SqlTimesStore {
  // sql is ctx.storage.sql, or anything with exec(query, ...bindings) returning something with toArray()
  constructor(sql) {
    this.sql = sql;
    const run = q => sql.exec(q).toArray();
    run('CREATE TABLE IF NOT EXISTS times (board TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, time REAL NOT NULL, s1 REAL NOT NULL, s2 REAL NOT NULL, s3 REAL NOT NULL, at INTEGER NOT NULL, ghost TEXT, PRIMARY KEY (board, key))');
    run('CREATE INDEX IF NOT EXISTS times_rank ON times (board, time, at, key)');
  }
  q(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  row(r, withGhost) { return { key: r.key, name: r.name, time: r.time, sectors: [r.s1, r.s2, r.s3], at: r.at, ...(withGhost ? { ghost: r.ghost ?? null } : { hasGhost: !!r.hasGhost }) }; }
  get(board, key) { const r = this.q('SELECT key, name, time, s1, s2, s3, at, ghost FROM times WHERE board = ? AND key = ?', board, key)[0]; return r ? this.row(r, true) : null; }
  put(board, r) { this.q('INSERT OR REPLACE INTO times (board, key, name, time, s1, s2, s3, at, ghost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', board, r.key, r.name, r.time, r.sectors[0], r.sectors[1], r.sectors[2], r.at, r.ghost ?? null); }
  top(board, n) { return this.q('SELECT key, name, time, s1, s2, s3, at, ghost IS NOT NULL AS hasGhost FROM times WHERE board = ? ORDER BY time, at, key LIMIT ?', board, n).map(r => this.row(r, false)); }
  countAhead(board, r) { return this.q('SELECT COUNT(*) AS n FROM times WHERE board = ? AND (time < ? OR (time = ? AND (at < ? OR (at = ? AND key < ?))))', board, r.time, r.time, r.at, r.at, r.key)[0].n; }
  count(board) { return this.q('SELECT COUNT(*) AS n FROM times WHERE board = ?', board)[0].n; }
  pruneGhosts(board, n) { this.q('UPDATE times SET ghost = NULL WHERE board = ? AND ghost IS NOT NULL AND key NOT IN (SELECT key FROM times WHERE board = ? ORDER BY time, at, key LIMIT ?)', board, board, n); }
}

export class Times {
  constructor(ctx) {
    this.model = new TimesModel(new SqlTimesStore(ctx.storage.sql));
    this.limiter = new RateLimiter();   // in memory: it forgets when the object is evicted, which only makes it more lenient
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = parseTimesRoute(url.pathname);
    if (!route) return new Response('not found', { status: 404 });
    const bodyText = request.method === 'POST' ? await request.text() : undefined;
    const { status, json } = handleTimes(this.model, this.limiter, { method: request.method, route, params: url.searchParams, bodyText, ip: request.headers.get('x-lakeside-ip'), now: Date.now() });
    return Response.json(json, { status });
  }
}
