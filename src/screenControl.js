// The control panel's side of the gantry LED screen (src/gantryScreen.js): start lights, GO, flags, a custom message and the
// advert loop. Single player: always yours. In an online room the host always has it and can give it to other players; the
// host is the only one who changes the screen, so everybody in the room sees the same thing.
//
//   scrc  player -> room   { t:'scrc', cmd }      a command from a player with access (only the host acts on it)
//   scr   host -> all      { t:'scr', cmd }       a command to show, the host's own or one it accepted
//   scrs  host -> one      { t:'scrs', st }       what is on the screen now, once to each newcomer
//   scrg  host -> all      { t:'scrg', ids }      the players the host has given access to
//
// Commands: { c:'start' } (the whole start sequence: a lamp a second, a random hold, GO; run by the host, who sends each step),
// { c:'lights', n } (0 to 5), { c:'go' }, { c:'flag', name } (yellow, red, green, final, chequered),
// { c:'msg', text }, { c:'clear' }, { c:'scene', name } (hold one advert), { c:'loop' } (back to the loop), { c:'next' },
// { c:'ad', name, on } (an advert in or out of the loop). The lap board stays local: each player sees their own laps.
// Pure JavaScript with the screen and the room injected, so tools/screencontrol.js tests it with fakes.

export const FLAGS = ['yellow', 'red', 'green', 'final', 'chequered'];
export const MSG_MAX = 40;

const str = v => (typeof v === 'string' ? v : '');

// what is accepted from the network (or the panel): anything else is null
export function cleanCommand(cmd, scenes = []) {
  if (!cmd || typeof cmd !== 'object') return null;
  switch (cmd.c) {
    case 'lights': { const n = Math.round(+cmd.n); return Number.isFinite(n) ? { c: 'lights', n: Math.max(0, Math.min(5, n)) } : null; }
    case 'start': case 'go': case 'clear': case 'loop': case 'next': return { c: cmd.c };
    case 'flag': return FLAGS.includes(cmd.name) ? { c: 'flag', name: cmd.name } : null;
    case 'msg': { const text = str(cmd.text).replace(/[\u0000-\u001f]/g, '').trim().slice(0, MSG_MAX); return text ? { c: 'msg', text } : null; }
    case 'scene': return scenes.includes(cmd.name) ? { c: 'scene', name: cmd.name } : null;
    case 'ad': return scenes.includes(cmd.name) ? { c: 'ad', name: cmd.name, on: cmd.on !== false } : null;
    default: return null;
  }
}

export const LAMP_MS = 1000, HOLD_MIN_MS = 200, HOLD_MAX_MS = 3000;   // like a real start: a lamp a second, then a random hold

// o: { screen (createGantryScreen's api), mp (Multiplayer: isHost, selfId, hostPeerId, peers, sendControl), inRoom () => bool, onChange (),
//      setTimeout, clearTimeout, random (injected for the tests) }
export function createScreenControl(o) {
  const screen = o.screen, mp = o.mp, inRoom = o.inRoom || (() => false), changed = o.onChange || (() => {});
  const scenes = screen ? screen.scenes || [] : [];
  // what a newcomer needs to see the same screen: the held board (lights, a flag or a message), the held advert, the adverts off
  let st = { board: null, scene: null, off: [] };
  let grants = new Set(), mine = false, sentTo = new Set(), lastGrants = '';

  const host = () => !inRoom() || mp.isHost;
  const later = o.setTimeout || ((f, ms) => setTimeout(f, ms)), cancel = o.clearTimeout || (id => clearTimeout(id)), random = o.random || Math.random;
  let steps = [];   // the timers of a running start sequence (host or single player)
  const stopSequence = () => { for (const id of steps) cancel(id); steps = []; };
  // show one step here and, in a room, on everyone's screen
  const out = cmd => { apply(cmd); if (inRoom() && mp.isHost) mp.sendControl({ t: 'scr', cmd }); };
  function runStart() {
    stopSequence();
    out({ c: 'lights', n: 0 });
    for (let n = 1; n <= 5; n++) steps.push(later(() => out({ c: 'lights', n }), n * LAMP_MS));
    const hold = HOLD_MIN_MS + random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    steps.push(later(() => { steps = []; out({ c: 'go' }); }, 5 * LAMP_MS + hold));
  }
  // the host's (or single player's) own command, or one it accepted from a player with access
  function run(cmd) {
    if (cmd.c === 'start') return runStart();
    if (cmd.c !== 'lights' && cmd.c !== 'go') stopSequence();     // anything else (a flag, clear, a message) cuts a running start short
    out(cmd);
  }

  function apply(cmd) {
    if (!screen) return;
    switch (cmd.c) {
      case 'lights': screen.lights(cmd.n); st.board = cmd; break;
      case 'go': screen.go(); st.board = null; break;
      case 'flag': screen.flag(cmd.name); st.board = ['green', 'final'].includes(cmd.name) ? null : cmd; break;   // green and final lap clear themselves
      case 'msg': screen.message(cmd.text); st.board = cmd; break;
      case 'clear': screen.clear(); st.board = null; st.scene = null; break;
      case 'scene': screen.showScene(cmd.name); st.board = null; st.scene = cmd.name; break;
      case 'loop': screen.showScene(null); st.scene = null; break;
      case 'next': screen.next(); st.scene = null; break;
      case 'ad': screen.setAd(cmd.name, cmd.on); st.off = scenes.filter(n => !screen.adOn(n)); break;
    }
    changed();
  }

  const api = {
    scenes,
    get state() { return st; },
    // may this player use the panel right now
    canControl() { return host() || mine; },
    isHost: host,
    adOn: name => (screen ? screen.adOn(name) : true),

    // the panel: show it here, and in a room send it to everyone (or ask the host to)
    command(raw) {
      const cmd = cleanCommand(raw, scenes);
      if (!cmd || !api.canControl()) return false;
      if (!inRoom() || mp.isHost) run(cmd);
      else mp.sendControl({ t: 'scrc', cmd });
      return true;
    },

    // host: the players in the room and whether each has access
    players() {
      if (!inRoom() || !mp.isHost) return [];
      return [...mp.peers.values()].filter(p => p.hello).map(p => ({ id: p.id, name: p.name || 'Player', access: grants.has(p.id) }));
    },
    setAccess(id, on) {
      if (!inRoom() || !mp.isHost || !mp.peers.has(id)) return;
      if (on) grants.add(id); else grants.delete(id);
      changed();
    },

    // every frame: the host keeps newcomers and the access list up to date, and forgets players who left
    tick() {
      if (!inRoom()) { if (mine || grants.size || sentTo.size) { mine = false; grants = new Set(); sentTo = new Set(); lastGrants = ''; changed(); } return; }
      if (!mp.isHost) return;
      for (const id of [...grants]) if (!mp.peers.has(id)) grants.delete(id);
      const ids = [...grants].sort(), key = ids.join(',');
      let fresh = false;
      for (const p of mp.peers.values()) {
        if (!p.hello || sentTo.has(p.id)) continue;
        sentTo.add(p.id); fresh = true;
        mp.sendControl({ t: 'scrs', st }, p.id);
      }
      for (const id of [...sentTo]) if (!mp.peers.has(id)) sentTo.delete(id);
      if (key !== lastGrants || fresh) { lastGrants = key; mp.sendControl({ t: 'scrg', ids }); }
    },

    // everything that arrives from the room
    handle(m, from) {
      if (!m || typeof m !== 'object' || !inRoom()) return;
      const fromHost = from === mp.hostPeerId;
      if (m.t === 'scrc') {
        if (!mp.isHost || !grants.has(from)) return;     // only a player the host has let in
        const cmd = cleanCommand(m.cmd, scenes);
        if (cmd) run(cmd);
      } else if (m.t === 'scr') {
        if (mp.isHost || !fromHost) return;
        const cmd = cleanCommand(m.cmd, scenes);
        if (cmd && cmd.c !== 'start') apply(cmd);
      } else if (m.t === 'scrs') {
        if (mp.isHost || !fromHost || !m.st || typeof m.st !== 'object') return;
        for (const name of Array.isArray(m.st.off) ? m.st.off : []) { const c = cleanCommand({ c: 'ad', name, on: false }, scenes); if (c) apply(c); }
        const scene = cleanCommand({ c: 'scene', name: m.st.scene }, scenes);
        if (scene) apply(scene);
        const board = cleanCommand(m.st.board, scenes);
        if (board) apply(board);
      } else if (m.t === 'scrg') {
        if (mp.isHost || !fromHost) return;
        const was = mine;
        mine = Array.isArray(m.ids) && m.ids.includes(mp.selfId);
        if (was !== mine) changed();
      }
    },
  };
  return api;
}
