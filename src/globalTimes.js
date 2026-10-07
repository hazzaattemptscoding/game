// Global times: the best valid lap of every driver, kept on the relay (worker/src/times.js) on 16 boards, one for each mix of
// dry or wet, solo or online, normal or reverse direction, assists on or off. The top 10 of each board keep their ghost line.
//
// A lap is posted when it is VALID (no track limit warnings), CLEAN (driven all the way round, no reset or jump) and driven by
// the player (no autopilot at any point of it). Posts wait in a small queue in the browser and go out when the relay answers,
// so a lap set offline or while the relay is busy is not lost. A lap the relay refuses (400, 403) is dropped, not retried.
//
// The data functions are plain JavaScript with fetch and storage injected, so tools/globaltimes.js tests them in node.
// The menu screen that shows the boards is in src/menuScreens.js, the ghost car in src/boardGhost.js.

import { LapRecorder } from './lapTrace.js';

export const WEATHERS = ['dry', 'wet'], MODES = ['solo', 'online'], DIRS = ['fwd', 'rev'], ASSISTS = ['on', 'off'];
export const LABELS = { dry: 'Dry', wet: 'Wet', solo: 'Solo', online: 'Online', fwd: 'Normal', rev: 'Reverse', on: 'Assists on', off: 'Assists off' };
export const WET_WEATHERS = ['lightrain', 'heavyrain'];
export const QUEUE_KEY = 'lakeside.timesQueue';
export const QUEUE_MAX = 20;          // laps waiting to be posted; the oldest go first when it is full
export const RETRY_MS = 30000;        // after a failed post (offline, relay busy) the queue is tried again this long after
export const TOP_N = 20;

export const boardKey = b => `${b.weather}-${b.mode}-${b.dir}-${b.assists}`;
export const boardLabel = b => [LABELS[b.weather], LABELS[b.mode], LABELS[b.dir], LABELS[b.assists]].join(' · ');
export const validBoard = b => !!b && WEATHERS.includes(b.weather) && MODES.includes(b.mode) && DIRS.includes(b.dir) && ASSISTS.includes(b.assists);

// the board a lap belongs on. weather: the weather it was driven in (src/weather.js names); assists: { tc, abs, esc }
export function boardFor({ weather, online, reverse, assists }) {
  const anyAssist = !!(assists && (assists.tc || assists.abs || assists.esc));
  return { weather: WET_WEATHERS.includes(weather) ? 'wet' : 'dry', mode: online ? 'online' : 'solo', dir: reverse ? 'rev' : 'fwd', assists: anyAssist ? 'on' : 'off' };
}

// lap: a timer.history entry; flags: { autopilot } true if the autopilot drove any part of the lap
export const lapQualifies = (lap, flags = {}) => !!(lap && lap.valid && lap.clean && !flags.autopilot && lap.time >= 60 && Array.isArray(lap.sectors) && lap.sectors.length === 3);

// the relay's web address from its socket address: wss://host/ -> https://host, ws://host:8787/ -> http://host:8787
export function timesBase(relayUrl) {
  if (typeof relayUrl !== 'string' || !relayUrl) return '';
  const m = relayUrl.trim().match(/^(wss?):\/\/([^/?#]+)/i);
  if (!m) return '';
  return (m[1].toLowerCase() === 'wss' ? 'https://' : 'http://') + m[2];
}

// what the relay checks (worker/src/times.js); kept in step so the game never posts a name it would refuse
export function cleanName(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, 16).join('');
}

// o: { fetchFn, storage (getItem/setItem), getBase () => 'https://host' or '', now () => ms, onResult (post, answer) }
export function createGlobalTimes(o = {}) {
  const fetchFn = o.fetchFn || ((...a) => fetch(...a)), storage = o.storage || null, now = o.now || (() => Date.now());
  const getBase = o.getBase || (() => '');
  let queue = [], busy = false, retryAt = 0;
  try { const q = JSON.parse(storage?.getItem(QUEUE_KEY) || '[]'); if (Array.isArray(q)) queue = q.filter(p => p && typeof p === 'object').slice(-QUEUE_MAX); } catch { queue = []; }
  const save = () => { try { storage?.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* storage full or blocked: the queue lives in memory */ } };
  const status = { last: null, error: null };   // the last answer the relay gave a post, and the last reason it could not be reached

  const api = {
    status,
    get pending() { return queue.length; },
    available: () => !!getBase(),

    // a finished lap: { name, time, sectors, board, build, ghost? }. Queued at once, sent when the relay answers.
    submit(post) {
      if (!post || !validBoard(post.board) || !cleanName(post.name)) return false;
      queue.push({ ...post, name: cleanName(post.name) });
      // a full queue keeps the newest laps but always the fastest one too (the one that matters on the board)
      while (queue.length > QUEUE_MAX) { const fast = queue.reduce((a, b) => (b.time < a.time ? b : a)); const drop = queue.find(p => p !== fast); queue.splice(queue.indexOf(drop), 1); }
      save();
      retryAt = 0;
      return api.flush();
    },

    // send what is waiting, oldest first; stops at the first lap the relay cannot take right now
    async flush() {
      const base = getBase();
      if (busy || !queue.length || !base || now() < retryAt) return false;
      busy = true;
      try {
        while (queue.length) {
          const post = queue[0];
          let r;
          try { r = await fetchFn(base + '/times', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) }); }
          catch (e) { status.error = 'The times server cannot be reached'; retryAt = now() + RETRY_MS; return false; }
          let body = null; try { body = await r.json(); } catch { body = null; }
          if (r.status === 200) { queue.shift(); save(); status.last = { post, answer: body }; status.error = null; o.onResult && o.onResult(post, body); continue; }
          if (r.status === 400 || r.status === 403) { queue.shift(); save(); status.error = (body && body.error) || `refused (${r.status})`; continue; }   // never accepted: do not retry
          status.error = (body && body.error) || `the times server answered ${r.status}`; retryAt = now() + RETRY_MS; return false;   // 429, 5xx: later
        }
        return true;
      } finally { busy = false; }
    },

    // the board: { board, entries: [{ rank, name, time, sectors, at, ghost }], you }, or null when the relay cannot be reached
    async top(board, name = '', n = TOP_N) {
      const base = getBase();
      if (!base || !validBoard(board)) return null;
      const q = `board=${boardKey(board)}&n=${n}` + (cleanName(name) ? `&name=${encodeURIComponent(cleanName(name))}` : '');
      try { const r = await fetchFn(`${base}/times?${q}`); return r.ok ? await r.json() : null; } catch { return null; }
    },

    // a stored ghost line: { name, time, ghost } (base64, src/lapTrace.js), or null
    async ghost(board, name) {
      const base = getBase();
      if (!base || !validBoard(board) || !cleanName(name)) return null;
      try { const r = await fetchFn(`${base}/ghost?board=${boardKey(board)}&name=${encodeURIComponent(cleanName(name))}`); return r.ok ? await r.json() : null; } catch { return null; }
    },
  };
  return api;
}

// Watches the laps as they are driven and turns each qualifying one into a post. Call step() after every timer.update.
// Per lap it records the line (src/lapTrace.js) and whether the autopilot drove, the road was wet, the car was in an online
// room or any assist was on at ANY point of the lap (a lap that was partly wet is a wet lap, partly assisted is assisted).
// o: { timer, getConditions () => { weather, online, reverse, assists }, isAutopilot () => bool, getName () => string, build }
export class LapWatch {
  constructor(o) {
    this.o = o;
    this.recorder = new LapRecorder();
    this.seen = o.timer.history.length;
    this.lapStart = o.timer.lapStart;
    this.flags = null;
    this.startLap();
  }
  startLap() { this.recorder.reset(); this.flags = { autopilot: false, wet: false, online: false, assists: false, reverse: !!this.o.timer.reverse }; }
  // car: { x, z, heading }. Returns the post for a lap that just finished and qualified, else null.
  step(simTime, car) {
    const t = this.o.timer;
    let post = null;
    if (t.history.length < this.seen) { this.seen = t.history.length; this.lapStart = t.lapStart; this.startLap(); }   // the session restarted
    if (t.lapStart !== this.lapStart) {
      // a lap started: the one before it, if it was a lap (not the out lap), has just gone into the history
      if (t.history.length > this.seen && this.lapStart !== null) {
        const lap = t.history[t.history.length - 1];
        this.recorder.finish(lap.time, car.x, car.z, car.heading);
        post = this.postFor(lap);
      }
      this.seen = t.history.length; this.lapStart = t.lapStart;
      this.startLap();
    }
    if (t.lapStart === null) return post;
    const c = this.o.getConditions(), f = this.flags;
    f.autopilot = f.autopilot || !!this.o.isAutopilot();
    const b = boardFor(c);
    f.wet = f.wet || b.weather === 'wet'; f.online = f.online || b.mode === 'online'; f.assists = f.assists || b.assists === 'on';
    this.recorder.push(simTime - t.lapStart, car.x, car.z, car.heading);
    return post;
  }
  postFor(lap) {
    const f = this.flags;
    if (!lapQualifies(lap, { autopilot: f.autopilot })) return null;
    const board = { weather: f.wet ? 'wet' : 'dry', mode: f.online ? 'online' : 'solo', dir: f.reverse ? 'rev' : 'fwd', assists: f.assists ? 'on' : 'off' };
    const post = { name: cleanName(this.o.getName()), time: +lap.time.toFixed(3), sectors: lap.sectors.map(s => +s.toFixed(3)), board, build: this.o.build || '' };
    if (this.recorder.samples >= lap.time * 8) post.ghost = this.recorder.encode();
    return post.name ? post : null;
  }
}
