// The times board: hold Tab (or the Times button on a touch screen) to see this session's laps over the game.
// Three parts: this session (current, last and best lap, sector colours, delta to your best), the last 10 laps
// with their sector times and track limit warnings, and a leaderboard (everyone in the room by best lap, or your
// own best 10 laps saved in this browser when you are alone).
//
// The data functions at the top are plain JavaScript with no page needed, so tools/board.js tests them in node.
// createBoard at the bottom draws them.

import { fmtTime } from './hud.js';

export const BEST_KEY = 'lakeside.best';
export const TOP_N = 10;        // local leaderboard length
export const HISTORY_N = 10;    // laps shown in the lap list
const EPS = 1e-6;

const min = list => { const v = list.filter(x => x != null); return v.length ? Math.min(...v) : null; };

// Sector colour: purple = the best of this session so far (nothing earlier in the session was faster),
// green = faster than or equal to your personal best from before this session, yellow = slower than both.
// `sessionBefore` is the best of that sector over the earlier valid laps this session, `personal` your best from earlier sessions.
// A lap with track limit warnings (valid false) is never purple.
export function sectorClass(t, sessionBefore, personal, valid = true) {
  if (t == null) return '';
  if (valid && (sessionBefore == null || t <= sessionBefore + EPS)) return 'purple';
  if (personal != null && t <= personal + EPS) return 'green';
  return 'yellow';
}

// the best time of sector i over the valid laps before index k of the history (all laps when k is omitted)
const sectorBefore = (history, i, k = history.length) => min(history.slice(0, k).filter(l => l.valid).map(l => l.sectors[i]));

// The lap list, newest first, at most n: { lap, time, sectors: [{ time, cls }], warnings, valid, best }.
// Colours are as they were when the lap was driven. The best is the best valid lap: an invalid lap is never best.
export function lapRows(history, n = HISTORY_N, personal = [null, null, null]) {
  const bestTime = min(history.filter(l => l.valid).map(l => l.time));
  return history.map((l, k) => ({
    lap: l.lap, time: l.time, warnings: l.warnings, jumped: !!l.jumped, valid: l.valid, best: l.valid && bestTime != null && l.time <= bestTime + EPS,
    sectors: l.sectors.map((t, i) => ({ time: t, cls: sectorClass(t, sectorBefore(history, i, k), personal[i], l.valid) })),
  })).slice(-n).reverse();
}

// This session at the moment `simTime`: the times, the three sector cells (the lap in progress once it has a sector,
// otherwise the last lap) and the delta to your best lap ({ value, text } or null).
export function sessionView(timer, simTime, personal = [null, null, null]) {
  const h = timer.history, running = timer.running(simTime);
  const bestLap = h.reduce((b, l) => (l.valid && (!b || l.time < b.time) ? l : b), null);
  const live = timer.current.length > 0;
  const src = live ? timer.current : timer.lastSectors || [];
  const lastValid = live || !h.length || h[h.length - 1].valid;   // the lap in progress is not judged until it ends
  const cells = [0, 1, 2].map(i => {
    const t = src[i] == null ? null : src[i];
    return { time: t, cls: sectorClass(t, sectorBefore(h, i, live ? h.length : h.length - 1), personal[i], lastValid) };
  });
  let delta = null;
  if (bestLap) {
    if (live) {
      const n = timer.current.length, have = timer.current.reduce((a, b) => a + b, 0), then = bestLap.sectors.slice(0, n).reduce((a, b) => a + b, 0);
      delta = have - then;
    } else if (timer.last != null) delta = timer.last - bestLap.time;
  }
  return { current: running, last: timer.last, best: timer.best, live, cells, delta };
}

// --- local leaderboard: your best 10 laps, kept in this browser ---

// returns a new list with `entry` ({ time, sectors, date, warn }) added, sorted fastest first, cut to n
export function addBest(list, entry, n = TOP_N) {
  return [...list, entry].map((e, i) => ({ e, i })).sort((a, b) => a.e.time - b.e.time || a.i - b.i).slice(0, n).map(x => x.e);
}

const cleanEntry = e => e && typeof e === 'object' && Number.isFinite(e.time) && e.time > 0 && e.time < 3600
  ? { time: e.time, sectors: Array.isArray(e.sectors) ? e.sectors.slice(0, 3).map(v => (Number.isFinite(v) ? v : null)) : [], date: String(e.date || '').slice(0, 10), warn: Math.max(0, +e.warn || 0) } : null;

// the saved list, or [] (private mode, nothing saved, or damaged data)
// reverse laps are kept in their own list
export const bestKey = (reverse = false) => (reverse ? BEST_KEY + '.reverse' : BEST_KEY);

export function loadBest(storage = globalThis.localStorage, key = BEST_KEY) {
  try {
    const list = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(list) ? list.map(cleanEntry).filter(Boolean).sort((a, b) => a.time - b.time).slice(0, TOP_N) : [];
  } catch (e) { return []; }
}

export function saveBest(list, storage = globalThis.localStorage, key = BEST_KEY) {
  try { storage.setItem(key, JSON.stringify(list)); } catch (e) { /* private mode: the list lasts until the page closes */ }
}

// your best time for each sector over a saved list
export const personalSectors = list => [0, 1, 2].map(i => min(list.map(e => e.sectors[i])));

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// --- drawing ---

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = t => (t == null ? '-.--' : t.toFixed(2));
const fmtDelta = d => (d < 0 ? '-' : '+') + Math.abs(d).toFixed(3);
const cell = c => `<td class="${c.cls}">${sec(c.time)}</td>`;

// ctx: { timer, lobby, storage }. `lobby.active` and `lobby.board(own)` come from lobby.js. Returns { show, hide, toggle, update }.
export function createBoard(root, ctx) {
  const storage = ctx.storage || (() => { try { return localStorage; } catch (e) { return null; } })();
  let key = bestKey(!!ctx.timer.reverse), best = loadBest(storage, key);
  let personal = personalSectors(best);     // from before this session: it is not updated as you drive
  let seen = ctx.timer.history.length, fresh = null, shown = false, lastDraw = -1;

  const draw = simTime => {
    const t = ctx.timer, v = sessionView(t, simTime, personal);
    const dClass = v.delta == null ? '' : v.delta <= 0 ? 'green' : 'yellow';
    let html = `<h2>Times</h2><section><h3>This session</h3>
      <div class="bd-big"><div><span>Lap ${t.currentLap() || 'out'}</span><b>${fmtTime(v.current)}</b></div><div><span>Last</span><b>${fmtTime(v.last)}</b></div><div><span>Best</span><b>${fmtTime(v.best)}</b></div>
      <div><span>Delta to best</span><b class="${dClass}">${v.delta == null ? '-.---' : fmtDelta(v.delta)}</b></div></div>
      <div class="bd-sectors"><span>${v.live ? 'This lap' : 'Last lap'}</span>${v.cells.map((c, i) => `<i class="${c.cls}">S${i + 1} ${sec(c.time)}</i>`).join('')}</div></section>`;

    const rows = lapRows(t.history, HISTORY_N, personal);
    html += `<section><h3>Laps</h3>${rows.length ? `<table><thead><tr><th>Lap</th><th>Time</th><th>S1</th><th>S2</th><th>S3</th><th>Track limits</th></tr></thead><tbody>${rows.map(r =>
      `<tr class="${r.valid ? '' : 'invalid'}${r.best ? ' pb' : ''}"><td>${r.lap}</td><td>${fmtTime(r.time)}</td>${r.sectors.map(cell).join('')}<td class="tag${r.valid || r.warnings ? '' : ' reset'}">${r.valid ? '' : r.warnings ? `${r.warnings} invalid` : 'reset'}</td></tr>`).join('')}</tbody></table>` : '<p class="bd-none">No finished laps yet.</p>'}</section>`;

    if (ctx.lobby && ctx.lobby.active) {
      const players = ctx.lobby.board({ name: ctx.lobby.name(), laps: t.lap, best: t.best, last: t.last });
      html += `<section><h3>Room</h3><table><thead><tr><th></th><th>Driver</th><th>Laps</th><th>Best</th><th>Last</th><th>Gap</th></tr></thead><tbody>${players.map((p, i) =>
        `<tr class="${p.me ? 'me' : ''}"><td>${i + 1}</td><td class="name">${esc(p.name)}${p.me ? ' <em>you</em>' : ''}</td><td>${p.laps}</td><td>${p.best ? fmtTime(p.best) : '-'}</td><td>${p.last ? fmtTime(p.last) : '-'}</td><td>${p.gap ? '+' + p.gap.toFixed(3) : ''}</td></tr>`).join('')}</tbody></table></section>`;
    } else {
      html += `<section><h3>Your best laps${key === BEST_KEY ? '' : ', reverse'}</h3>${best.length ? `<table><thead><tr><th></th><th>Time</th><th>S1</th><th>S2</th><th>S3</th><th>Date</th></tr></thead><tbody>${best.map((e, i) =>
        `<tr class="${e === fresh ? 'me' : ''}"><td>${i + 1}</td><td>${fmtTime(e.time)}</td>${[0, 1, 2].map(k => `<td>${sec(e.sectors[k])}</td>`).join('')}<td>${esc(e.date)}${e.warn ? ' <em>invalid</em>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="bd-none">Finish a lap to start your list. It is kept in this browser.</p>'}</section>`;
    }
    root.innerHTML = html;
  };

  return {
    get shown() { return shown; },
    show() { shown = true; root.hidden = false; lastDraw = -1; },
    hide() { shown = false; root.hidden = true; },
    toggle() { shown ? this.hide() : this.show(); },
    // every frame: files new laps into the local list, redraws four times a second while shown
    update(simTime, now) {
      const h = ctx.timer.history;
      if (h.length < seen) seen = h.length;       // the timer was reset
      if (bestKey(!!ctx.timer.reverse) !== key) {  // the direction changed: switch to that direction's list
        key = bestKey(!!ctx.timer.reverse); best = loadBest(storage, key); personal = personalSectors(best); fresh = null; lastDraw = -1;
      }
      for (; seen < h.length; seen++) {
        const l = h[seen];
        if (!l.valid || l.autopilot) continue;   // only the driver's valid laps go on the list (not invalid laps, not autopilot laps)
        fresh = { time: l.time, sectors: l.sectors.slice(), date: today(), warn: l.warnings };
        best = addBest(best, fresh);
        saveBest(best, storage, key);
        if (!best.includes(fresh)) fresh = null;
      }
      if (shown && (lastDraw < 0 || now - lastDraw > 250)) { lastDraw = now; draw(simTime); }
    },
  };
}
