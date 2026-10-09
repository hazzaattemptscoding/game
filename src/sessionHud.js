// The session overlay on top of the HUD: the race chip (mode, lap, position), the five start lights, banners (GO, the countdown,
// jump start, track limits penalty, chequered flag) and the time trial lap list. The director (director.js) hands it a plain `view`
// object every frame; it only touches the page when something changed. Elements live in index.html under #sess. Colours are
// the tokens in src/style.css.

import { fmtTime } from './hud.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The banner for the latest track limits penalty, for `shownFor` seconds after it was given (race.limitPenalties from
// RaceTracker, simTime the sim clock). Uses the 'jump' style (a red bar). Null when there is nothing to show.
export function limitBanner(race, simTime, shownFor = 3) {
  const list = race && race.limitPenalties;
  const p = list && list.length ? list[list.length - 1] : null;
  if (!p || !(simTime - p.at <= shownFor)) return null;
  return { text: `Track limits +${p.seconds}s`, kind: 'jump' };
}

// The race chip as its parts: { title, lap?, pos?, of? } (title 'Race', lap 'LAP 2 / 5', pos 'P3', of '/8'), or null.
const chipHtml = c => (c ? `<span class="sess-title">${esc(c.title)}</span>${c.lap ? `<span class="sess-lap">${esc(c.lap)}</span>` : ''}${c.pos ? `<span class="sess-pos">${esc(c.pos)}${c.of ? `<small>${esc(c.of)}</small>` : ''}</span>` : ''}` : '');

// view: { show, chip: {title, lap, pos, of}|null, lights: 0..5|null (null hides the lights), lightsOut: bool, banner: { text, kind }|null,
//         laps: [{ lap, time, valid, best }]|null, ready: number|null }
// SAMPLE (development only, `?hud=sample`) shows a race chip and a track limits penalty for the look check; see src/hud.js.
const SAMPLE = typeof location !== 'undefined' && !!import.meta.env?.DEV && new URLSearchParams(location.search).get('hud') === 'sample';
const SAMPLE_VIEW = { chip: { title: 'Race', lap: 'LAP 2 / 5', pos: 'P3', of: '/8' }, banner: { text: 'Track limits +1s', kind: 'jump' } };

export function createSessionHud(root = document.getElementById('sess')) {
  const q = id => root.querySelector('#' + id);
  const chip = q('sess-chip'), lights = q('sess-lights'), banner = q('sess-banner'), laps = q('sess-laps');
  const pods = [...lights.children];
  let last = {};
  const set = (key, val, fn) => { const s = JSON.stringify(val); if (last[key] !== s) { last[key] = s; fn(val); } };

  return {
    update(v) {
      root.hidden = !v.show;
      if (!v.show) return;
      if (SAMPLE) v = { ...v, ...SAMPLE_VIEW };
      set('chip', v.chip, c => { chip.hidden = !c; chip.innerHTML = chipHtml(c); });
      set('lights', [v.lights, v.lightsOut], ([n, out]) => {
        lights.hidden = n === null || n === undefined;
        lights.classList.toggle('out', !!out);
        pods.forEach((p, i) => p.classList.toggle('on', n !== null && i < n));
      });
      set('banner', v.banner, b => { banner.hidden = !b; banner.className = 'sess-banner' + (b ? ' ' + b.kind : ''); banner.textContent = b ? b.text : ''; });
      set('laps', v.laps, rows => {
        laps.hidden = !rows || !rows.length;
        if (!rows || !rows.length) { laps.textContent = ''; return; }
        laps.innerHTML = '<h3>Laps</h3>' + rows.map(r => `<div class="${r.valid ? '' : 'bad'}${r.best ? ' best' : ''}"><span>${r.lap}</span><b>${fmtTime(r.time)}</b>${r.valid ? '' : '<em>invalid</em>'}</div>`).join('');
      });
    },
    reset() { last = {}; },
  };
}
export { esc };
