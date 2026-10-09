// The finish message: what a player sends to the room when they take the chequered flag, and what the others keep of it.
//
//   { t:'fin', time, laps, best, sec: [s1, s2, s3], pen: [{ s, why }], warn }
//   time  race time in seconds, penalties included
//   laps  laps in the race
//   best  best valid lap in seconds (0 = none)
//   sec   the best valid sector times in seconds (0 = none)
//   pen   the penalties (track limits, jump start): seconds and a short reason
//   warn  track limit warnings
//
// It goes over the room's control channel (src/multiplayer.js, src/relay.js). The relay forwards it to the other players with `from`
// (the sender's id), so a receiver only believes it from an id that is in the room (src/lobby.js). Everything a receiver gets is
// cleaned here: numbers are checked (a bad number drops the message), ranges are clamped, at most MAX_PENALTIES penalties, and a
// reason keeps its plain characters (the same rule as the names: src/ghosts.js cleanName) and at most REASON_MAX of them.
// Pure JavaScript, no page: tools/session.js tests it in node.

export const FIN = 'fin';
export const MAX_PENALTIES = 8;
export const REASON_MAX = 24;
const TIME_MAX = 7200, LAP_TIME_MAX = 3600, PEN_MAX = 600, LAPS_MAX = 99, WARN_MAX = 999;

// a reason for the results: plain text, no markup characters, REASON_MAX characters at most
export function cleanReason(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
}

// a number that must be finite (else null), clamped to [lo, hi]
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

// Clean a finish message (received or built). Returns the clean object, or null when it is not usable.
export function cleanFinish(m) {
  if (!m || typeof m !== 'object') return null;
  const time = num(m.time, 0, TIME_MAX), laps = num(m.laps, 1, LAPS_MAX);
  if (time === null || time <= 0 || laps === null) return null;
  const bestRaw = m.best === undefined || m.best === null ? 0 : m.best;
  const best = num(bestRaw, 0, LAP_TIME_MAX), warn = m.warn === undefined ? 0 : num(m.warn, 0, WARN_MAX);
  if (best === null || warn === null) return null;
  // a sector list: exactly three entries (missing ones are 0), each a number or the message is bad
  const secIn = m.sec === undefined ? [0, 0, 0] : m.sec;
  if (!Array.isArray(secIn) || secIn.length > 3) return null;
  const sec = [0, 1, 2].map(i => {
    const v = secIn[i] === undefined ? 0 : num(secIn[i], 0, LAP_TIME_MAX);
    return v === null ? NaN : v;
  });
  if (sec.some(v => Number.isNaN(v))) return null;
  // penalties: a list of at most MAX_PENALTIES; an entry with a bad number is dropped (the rest is kept)
  const penIn = m.pen === undefined ? [] : Array.isArray(m.pen) ? m.pen : null;
  if (penIn === null) return null;
  const pen = [];
  for (const p of penIn) {
    if (pen.length >= MAX_PENALTIES) break;
    if (!p || typeof p !== 'object') continue;
    const sec0 = num(p.s, 0, PEN_MAX);
    if (sec0 === null) continue;
    pen.push({ s: sec0, why: cleanReason(p.why) || 'Penalty' });
  }
  return { t: FIN, time, laps: Math.round(laps), best, sec, pen, warn: Math.round(warn) };
}

// The finished cars of the room, by player id. set() says whether anything changed (so a repeat does not redraw); clear() when a
// new race starts. A player who leaves keeps their finish: the book is only cleared by a new race. Pure, so the results screen
// can read it through the lobby.
export class FinishBook {
  constructor() { this.map = new Map(); }
  get size() { return this.map.size; }
  has(id) { return this.map.has(id); }
  get(id) { return this.map.get(id) || null; }
  ids() { return [...this.map.keys()]; }
  set(id, fin) {
    const old = this.map.get(id);
    if (old && JSON.stringify(old) === JSON.stringify(fin)) return false;
    this.map.set(id, fin);
    return true;
  }
  clear() { const had = this.map.size > 0; this.map.clear(); return had; }
}
