// The results screen after a race (a menu screen, 'results'): the timing sheet of every car (position, gap, best lap, sectors,
// penalty) and the driver's own card (P of N, sector bar, race time, track limits, penalty, positions gained, the buttons).
//
// The director builds the data (buildResults in src/director.js, rows from raceRows in src/session.js) and passes it as
// ctx.params.data: { rows, laps, track, conditions, canAgain }. While the screen is open the director calls hub.current.update(data)
// again (a finish arrives, a car leaves, the cars still out move on), and the table changes in place: the same row elements, moved
// and re-texted, so the scroll stays and nothing flashes. The rows come in with a 30 ms stagger on the first show only.
//
// resultsModel(data) is the pure part (text, classes, order) and is what tools/session.js tests in node.

import { fmtTime } from './hud.js';
import { h } from './menuScreens.js';
import { raceRows } from './session.js';

const secText = v => (v > 0 ? v.toFixed(3) : '-');
const timeText = t => (t == null ? '-' : fmtTime(t));
const lapsText = n => `${n} lap${n === 1 ? '' : 's'}`;
const penText = s => `+${Number.isInteger(s) ? s : s.toFixed(1)} s`;
const warnText = n => (n === 0 ? 'None' : n === 1 ? '1 warning' : `${n} warnings`);
const CLS = { best: 'best', near: 'near', slow: 'slow' };

// the text colour for a race number on a livery colour: the dark on-gantry token on the light colours, the text token on the dark ones
export function chipInk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 'var(--text)';
  const n = parseInt(m[1], 16), lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? 'var(--on-gantry)' : 'var(--text)';
}

// The view model: every string and class the screen shows, from the rows. Pure.
export function resultsModel(data = {}) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const total = rows.length, me = rows.find(r => r.me) || null;
  const laps = data.laps || 0;
  const gainedText = g => (g == null ? '' : g > 0 ? `+${g}` : g < 0 ? `${g}` : '0');
  const gainedCls = g => (g == null ? '' : g > 0 ? 'up' : g < 0 ? 'down' : 'flat');
  const out = rows.map(r => {
    const finished = r.status === 'finished', dnf = r.status === 'dnf';
    let gap = '-', gapCls = '';
    if (dnf) { gap = 'DNF'; gapCls = 'dnf'; }
    else if (finished) { if (r.gap != null) gap = `+${r.gap.toFixed(3)}`; }
    else if (r.lapsDown > 0) { gap = `+${lapsText(r.lapsDown)}`; gapCls = 'lapped'; }
    else { gap = 'Racing'; gapCls = 'out'; }
    return {
      id: r.id, me: !!r.me, status: r.status,
      pos: r.rank == null ? '-' : String(r.rank),
      gained: gainedText(r.gained), gainedCls: gainedCls(r.gained),
      name: r.name || 'Driver', num: r.num != null && r.num >= 0 ? String(r.num) : '', colour: r.colour || 'var(--text-faint)',
      gap, gapCls,
      best: r.best > 0 ? timeText(r.best) : '-', bestCls: r.bestCls || '',
      sec: [0, 1, 2].map(i => ({ text: secText(r.sec ? r.sec[i] : 0), cls: (r.secCls && r.secCls[i]) ? CLS[r.secCls[i]] : '' })),
      pen: r.penalty > 0 ? penText(r.penalty) : '',
      penTitle: (r.pen || []).map(p => `${p.why} ${penText(p.s)}`).join(', '),
      penalty: r.penalty || 0,
    };
  });
  const card = {
    pos: me && me.rank != null ? `P${me.rank}` : 'P-',
    of: total > 1 ? `of ${total}` : '',
    raceTime: me ? timeText(me.time) : '-',
    best: me && me.best > 0 ? timeText(me.best) : '-',
    warn: me ? warnText(me.warn || 0) : '-',
    penalty: me && me.penalty > 0 ? penText(me.penalty) : 'None',
    penalised: !!(me && me.penalty > 0),
    gained: me ? (me.gained == null ? '-' : gainedText(me.gained) || '0') : '-',
    gainedCls: me ? gainedCls(me.gained) : '',
    sectors: me ? [0, 1, 2].map(i => (me.secCls && me.secCls[i]) ? CLS[me.secCls[i]] : '') : ['', '', ''],
    canAgain: data.canAgain !== false,
  };
  const sub = [data.track || 'Lakeside Circuit', lapsText(laps), data.conditions].filter(Boolean).join(', ');
  return { sub, rows: out, card, total, hasMe: !!me };
}

// the data for the screen's dev view (?menu=results): five cars, one lapped, one out of the race, your own row among them
export function sampleResults() {
  const L = 3835, laps = 5;
  const entries = [
    { id: 'a', name: 'Mara K', colour: '#c43b3b', num: 7, finished: true, time: 472.302, dist: laps * L, best: 92.411, sec: [29.8, 38.1, 24.5], pen: [], warn: 0, grid: 3 },
    { id: 'me', name: 'Driver367', colour: '#1c6dd0', num: 46, me: true, finished: true, time: 472.418 + 2, dist: laps * L, best: 92.906, sec: [30.1, 37.9, 24.9], pen: [{ s: 2, why: 'Track limits +2s' }], warn: 1, grid: 2 },
    { id: 'b', name: 'Tom R', colour: '#2c8a5a', num: 12, finished: true, time: 479.87, dist: laps * L, best: 93.54, sec: [30.4, 38.5, 24.7], pen: [], warn: 0, grid: 5 },
    { id: 'c', name: 'Jess A', colour: '#8a4fc0', num: 88, finished: true, time: 491.402, dist: laps * L, best: 94.019, sec: [30.9, 38.8, 25.1], pen: [], warn: 0, grid: 1 },
    { id: 'd', name: 'Liam P', colour: '#d97a1c', num: 31, finished: false, dist: 4 * L + 900, best: 95.22, sec: [31.2, 39.4, 25.3], pen: [], warn: 0, grid: 4 },
    { id: 'e', name: 'Ada W', colour: '#2fd0c8', num: 5, dnf: true, finished: false, dist: 2 * L, best: 0, sec: [0, 0, 0], pen: [], warn: 2, grid: 6 },
  ];
  return { rows: raceRows(entries, { laps, length: L }), laps, track: 'Lakeside Circuit', conditions: 'Clear, Midday', canAgain: true };
}
// The screen. hub: { current } the mounted view, set while the screen is open, so the director can push new data into it.
export function resultsScreen(hub = { current: null }) {
  return {
    title: 'Race result', backable: false,
    mount(c, ctx) {
      const p = ctx.params || {};
      const view = buildView(c, ctx);
      view.update(p.data || { rows: [] });
      hub.current = view;
      return null;
    },
    unmount() { hub.current = null; },
    onBack: ctx => { ctx.api.toMainMenu(); return true; },
  };
}

// --- the page: built once, then updated in place ---
function buildView(c, ctx) {
  const sub = h('p', 'm-sub res-sub');
  const wrap = h('div', 'res-tablewrap');
  const table = h('table', 'res-table');
  table.setAttribute('aria-label', 'Race result');
  const thead = h('thead', '', h('tr', '',
    h('th', 'res-c-pos', 'Pos'), h('th', '', 'Driver'), h('th', '', 'Gap'), h('th', '', 'Best lap'),
    h('th', 'res-c-s1', 'S1'), h('th', 'res-c-s2', 'S2'), h('th', 'res-c-s3', 'S3'), h('th', '', 'Penalty')));
  const tbody = h('tbody', 'res-enter');
  table.append(thead, tbody);
  wrap.append(table);
  // the driver's own card
  const cardPos = h('span', 'res-big-pos'), cardOf = h('small', '');
  const secBar = [0, 1, 2].map(() => h('i', 'res-seg'));
  const kv = {};
  const kvRow = (key, label) => { kv[key] = h('b', ''); return [h('span', '', label), kv[key]]; };
  const kvEl = h('div', 'res-kv', ...kvRow('time', 'Race time'), ...kvRow('best', 'Best lap'), ...kvRow('warn', 'Track limits'), ...kvRow('pen', 'Penalty'), ...kvRow('gained', 'Positions gained'));
  const again = h('button', 'm-btn primary res-again', 'Race again'); again.type = 'button';
  again.addEventListener('click', () => ctx.api.restart());
  const back = h('button', 'm-btn res-back', 'Back to menu'); back.type = 'button';
  back.addEventListener('click', () => ctx.api.toMainMenu());
  const card = h('aside', 'res-card', h('div', 'res-pos', cardPos, cardOf), h('div', 'res-sectors', ...secBar), kvEl, again, back);
  const legend = h('p', 'm-note res-legend', 'Pink: fastest in the sector. Green: within 0.3 s of it.');
  const body = h('div', 'res', h('div', 'res-main', wrap, legend), card);
  c.append(sub, body);
  setTimeout(() => tbody.classList.remove('res-enter'), 900);

  const els = new Map();   // row id -> { tr, cells }
  const text = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  const makeRow = (r, i) => {
    const tr = h('tr', 'res-tr');
    tr.style.setProperty('--i', String(i));
    const pos = h('span', 'res-pos-badge'), gained = h('em', 'res-gain');
    const num = h('span', 'res-num'), name = h('span', 'res-name'), you = h('em', 'res-you', 'You');
    const gap = h('td', 'res-gap'), best = h('td', 'res-best'), pen = h('td', 'res-penalty');
    const sec = [0, 1, 2].map(() => h('td', 'res-sec'));
    const tdPos = h('td', 'res-c-pos', pos, gained);
    const tdDriver = h('td', 'res-driver', num, name, you);
    tr.append(tdPos, tdDriver, gap, best, ...sec, pen);
    return { tr, pos, gained, num, name, you, gap, best, sec, pen, tdDriver };
  };
  const apply = (e, r) => {
    text(e.pos, r.pos); e.pos.classList.toggle('dnf', r.status === 'dnf');
    text(e.gained, r.gained); e.gained.className = 'res-gain ' + r.gainedCls;
    text(e.num, r.num); e.num.style.background = r.colour; e.num.style.color = chipInk(r.colour);
    text(e.name, r.name);
    e.you.hidden = !r.me;
    e.tr.classList.toggle('me', r.me); e.tr.classList.toggle('out', r.status !== 'finished');
    text(e.gap, r.gap); e.gap.className = 'res-gap ' + r.gapCls;
    text(e.best, r.best); e.best.className = 'res-best ' + r.bestCls;
    r.sec.forEach((s, i) => { text(e.sec[i], s.text); e.sec[i].className = 'res-sec ' + s.cls; });
    text(e.pen, r.pen); e.pen.className = 'res-penalty'; e.pen.title = r.penTitle;
  };

  function update(data) {
    const m = resultsModel(data);
    const keep = new Set(m.rows.map(r => r.id));
    for (const [id, e] of els) if (!keep.has(id)) { e.tr.remove(); els.delete(id); }
    m.rows.forEach((r, i) => {
      let e = els.get(r.id);
      if (!e) { e = makeRow(r, i); els.set(r.id, e); }
      apply(e, r);
      if (tbody.children[i] !== e.tr) tbody.insertBefore(e.tr, tbody.children[i] || null);
    });
    text(sub, m.sub);
    text(cardPos, m.card.pos); text(cardOf, m.card.of);
    text(kv.time, m.card.raceTime); text(kv.best, m.card.best); text(kv.warn, m.card.warn);
    text(kv.pen, m.card.penalty); kv.pen.className = m.card.penalised ? 'pen' : '';
    text(kv.gained, m.card.gained); kv.gained.className = m.card.gainedCls;
    m.card.sectors.forEach((k, i) => { secBar[i].className = 'res-seg ' + k; });
    again.disabled = !m.card.canAgain;
    if (m.card.canAgain) again.dataset.first = '1'; else delete again.dataset.first;
    if (!m.card.canAgain) back.dataset.first = '1'; else delete back.dataset.first;
    if (!m.hasMe) cardPos.dataset.none = '1'; else delete cardPos.dataset.none;
  }
  return { update, rows: els };
}
