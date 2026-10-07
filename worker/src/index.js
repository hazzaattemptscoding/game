// Lakeside relay Worker. GET /room/<CODE> with Upgrade: websocket goes to the Durable Object for that code (add ?spectator=1 to watch),
// GET /lobbies lists the open rooms (GET /lobbies/<CODE> one room), GET /health answers ok.
// POST /times and GET /times, GET /ghost are the global lap times (the Times Durable Object, rules in times.js).
// ALLOWED_ORIGINS (comma separated, or *) decides which websites may connect.
import { parseRoute, originAllowed } from './protocol.js';
import { parseTimesRoute, MAX_BODY } from './times.js';
export { Room } from './room.js';
export { Directory } from './directory.js';
export { Times } from './times-do.js';

// the lobby list is shared between requests that hit the same Worker instance for a few seconds, so a busy lobby page costs the directory little
const LIST_CACHE_MS = 3000;
let cache = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
    const cors = origin && allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    const timesRoute = parseTimesRoute(url.pathname);
    if (timesRoute) {
      const json = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      const fail = (status, error) => new Response(JSON.stringify({ error }), { status, headers: json });
      // the browser preflight for a JSON POST: it needs POST and the Content-Type header allowed
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
      if (request.method === 'POST' && !(origin && allowed)) return fail(403, 'origin not allowed');   // a lap must come from an allowed website, so no Origin is refused too
      if (request.method === 'POST' && +request.headers.get('Content-Length') > MAX_BODY) return fail(400, 'body too large');
      if (!env.TIMES) return fail(503, 'times are not set up');
      const forward = new Request(request);
      forward.headers.set('x-lakeside-ip', request.headers.get('CF-Connecting-IP') || 'unknown');
      const r = await env.TIMES.get(env.TIMES.idFromName('times')).fetch(forward);
      return new Response(r.body, { status: r.status, headers: json });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const route = parseRoute(url.pathname);
    if (route?.kind === 'health') return new Response('ok', { headers: { ...cors, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    if (route?.kind === 'lobbies' || route?.kind === 'lobby') {
      if (!env.DIRECTORY) return new Response('[]', { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      const json = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
      if (route.kind === 'lobby') {
        const r = await stub.fetch('https://directory/get?code=' + route.code);
        return r.ok ? new Response(r.body, { headers: json }) : new Response('{"error":"no such room"}', { status: 404, headers: json });
      }
      const now = Date.now();
      if (!cache || now - cache.at > LIST_CACHE_MS) cache = { at: now, body: await (await stub.fetch('https://directory/list')).text() };
      return new Response(cache.body, { headers: json });
    }
    if (route?.kind === 'room') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!allowed) return new Response('Origin not allowed. Add your site to ALLOWED_ORIGINS.', { status: 403 });
      const stub = env.ROOM.get(env.ROOM.idFromName(route.code));
      const forward = new Request(request);
      forward.headers.set('x-lakeside-code', route.code);
      return stub.fetch(forward);
    }
    return new Response('Lakeside relay. Rooms are at /room/ABCDE (?spectator=1 to watch), the open rooms at /lobbies, status at /health.', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  },
};
