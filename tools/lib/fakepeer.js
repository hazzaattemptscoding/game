// An in-memory stand-in for PeerJS (broker and data channels), for tests: `fakeNetwork()` returns a Peer class, all peers made from
// one call can find each other. { down: true } makes every Peer fail like an unreachable broker.
export function fakeNetwork({ down = false } = {}) {
  const peers = new Map();
  class Conn {
    constructor(owner, peer, label, metadata) { Object.assign(this, { owner, peer, label, metadata, open: false, h: {}, other: null }); }
    on(e, f) { this.h[e] = f; return this; }
    emit(e, ...a) { this.h[e] && this.h[e](...a); }
    send(d) { if (!this.open) return; const o = this.other, j = JSON.parse(JSON.stringify(d)); setTimeout(() => o.emit('data', j), 1); }
    close() { if (!this.open) return; this.open = false; const o = this.other; o.open = false; setTimeout(() => { this.emit('close'); o.emit('close'); }, 1); }
  }
  class Peer {
    constructor(id) {
      this.id = id; this.h = {}; this.conns = []; this.open = false;
      setTimeout(() => {
        if (down) return this.emit('error', { type: 'network', message: 'Lost connection to server.' });
        if (peers.has(id)) return this.emit('error', { type: 'unavailable-id', message: `ID "${id}" is taken` });
        peers.set(id, this); this.open = true; this.emit('open', id);
      }, 1);
    }
    on(e, f) { this.h[e] = f; return this; }
    emit(e, ...a) { this.h[e] && this.h[e](...a); }
    connect(id, o) {
      const mine = new Conn(this, id, o.label, o.metadata), target = peers.get(id);
      if (!target) { setTimeout(() => this.emit('error', { type: 'peer-unavailable', message: `Could not connect to peer ${id}` }), 1); return mine; }
      const theirs = new Conn(target, this.id, o.label, o.metadata);
      mine.other = theirs; theirs.other = mine; this.conns.push(mine); target.conns.push(theirs);
      setTimeout(() => { target.emit('connection', theirs); setTimeout(() => { mine.open = theirs.open = true; theirs.emit('open'); mine.emit('open'); }, 1); }, 1);
      return mine;
    }
    reconnect() {}
    destroy() { peers.delete(this.id); for (const c of this.conns) c.close(); this.open = false; }
  }
  return Peer;
}
