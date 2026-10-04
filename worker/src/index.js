// Lakeside relay Worker. GET /room/<CODE> with Upgrade: websocket goes to the Durable Object for that code,
// GET /health answers ok. ALLOWED_ORIGINS (comma separated, or *) decides which websites may connect.
import { parseRoute, originAllowed } from './protocol.js';
export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
    const cors = origin && allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const route = parseRoute(url.pathname);
    if (route?.kind === 'health') return new Response('ok', { headers: { ...cors, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    if (route?.kind === 'room') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!allowed) return new Response('Origin not allowed. Add your site to ALLOWED_ORIGINS.', { status: 403 });
      const stub = env.ROOM.get(env.ROOM.idFromName(route.code));
      return stub.fetch(request);
    }
    return new Response('Lakeside relay. Rooms are at /room/ABCDE, status at /health.', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  },
};
