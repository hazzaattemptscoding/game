// The lobby directory: ONE Durable Object (idFromName('directory')) that every Room tells when it is occupied. GET /lobbies reads it.
// The list is kept in memory and saved to this object's storage, so it survives the object being evicted between requests.
// An entry nobody refreshed for 90 s is dropped (a room heartbeats every 30 s while occupied). The rules are in protocol.js (Directory).
import { Directory as DirectoryModel, DIRECTORY_TTL_MS } from './protocol.js';

export class Directory {
  constructor(ctx) {
    this.ctx = ctx;
    this.model = new DirectoryModel(DIRECTORY_TTL_MS);
    ctx.blockConcurrencyWhile(async () => { this.model.load(await ctx.storage.get('rooms')); });
  }

  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    if (request.method === 'POST' && url.pathname === '/update') {
      let b = null;
      try { b = await request.json(); } catch { return new Response('bad', { status: 400 }); }
      if (!b || typeof b.code !== 'string') return new Response('bad', { status: 400 });
      if (b.entry) this.model.update(b.code, b.entry, now); else this.model.remove(b.code);
      await this.ctx.storage.put('rooms', this.model.dump());
      return new Response('ok');
    }
    if (url.pathname === '/list') return Response.json(this.model.list(now));
    if (url.pathname === '/get') { const e = this.model.get((url.searchParams.get('code') || '').toUpperCase(), now); return e ? Response.json(e) : new Response('none', { status: 404 }); }
    return new Response('not found', { status: 404 });
  }
}
