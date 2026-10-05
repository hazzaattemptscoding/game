// The results screen after a race: finishing order, your total time, best lap, track limit warnings and penalties.
// Registered as a menu screen ('results'); the director passes the data in as the screen's params:
//   { rows: orderResults(...) rows, race: { laps, time, best, warnings, penalties: [{ seconds, reason }] }, canAgain }

import { fmtTime } from './hud.js';
import { h } from './menuScreens.js';

const gapText = r => (r.rank === 1 ? '' : r.gap != null ? `+${r.gap.toFixed(3)}` : '');

export function resultsScreen() {
  return {
    title: 'Results', backable: false,
    mount(c, ctx) {
      const { rows = [], race = {}, canAgain = true } = ctx.params || {};
      const me = rows.find(r => r.me);
      c.append(h('p', 'm-sub', me ? (me.rank === 1 ? 'You won.' : `You finished ${ordinal(me.rank)}${rows.length > 1 ? ` of ${rows.length}` : ''}.`) : 'Race over.'));
      const table = h('table', 'res-table');
      table.innerHTML = '<thead><tr><th></th><th>Driver</th><th>Time</th><th>Gap</th><th>Best lap</th></tr></thead>';
      const tb = h('tbody');
      for (const r of rows) {
        const tr = h('tr', r.me ? 'me' : '');
        tr.append(h('td', '', String(r.rank)), h('td', 'name', r.name || 'Driver'), h('td', '', r.finished ? fmtTime(r.time) : 'Racing'), h('td', '', gapText(r)), h('td', '', r.best ? fmtTime(r.best) : '-'));
        tb.append(tr);
      }
      table.append(tb);
      c.append(table);
      const stats = h('div', 'res-stats');
      const stat = (label, value, cls = '') => h('div', 'res-stat ' + cls, h('span', '', label), h('b', '', value));
      stats.append(stat('Total time', race.time != null ? fmtTime(race.time) : '-'), stat('Best lap', race.best != null ? fmtTime(race.best) : '-'), stat('Track limit warnings', String(race.warnings || 0), race.warnings ? 'amber' : ''));
      c.append(stats);
      const pens = race.penalties || [];
      if (pens.length) c.append(h('p', 'res-pen', 'Penalties: ' + pens.map(p => `${p.reason} +${p.seconds.toFixed(0)} s`).join(', ') + '. Already included in the time.'));
      const again = h('button', 'm-btn primary', 'Race again'); again.type = 'button';
      again.disabled = !canAgain;
      again.addEventListener('click', () => ctx.api.restart());
      again.dataset.first = canAgain ? '1' : '';
      const back = h('button', 'm-btn', 'Back to menu'); back.type = 'button';
      back.addEventListener('click', () => ctx.api.toMainMenu());
      if (!canAgain) back.dataset.first = '1';
      c.append(h('div', 'm-actions', again, back));
      return null;
    },
    onBack: ctx => { ctx.api.toMainMenu(); return true; },
  };
}

const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4 === n % 10 ? n % 10 : 0] || 'th'}`;
