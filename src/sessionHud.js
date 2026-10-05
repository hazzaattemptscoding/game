// The session overlay on top of the HUD: a one line chip (mode, lap, position), the five start lights, banners (GO, Jump start,
// chequered flag) and the time trial lap list. The director (director.js) hands it a plain `view` object every frame; it only
// touches the page when something changed. Elements live in index.html under #sess.

import { fmtTime } from './hud.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// view: { show, chip: string|null, lights: 0..5|null (null hides the lights), lightsOut: bool, banner: { text, kind }|null,
//         laps: [{ lap, time, valid, best }]|null, ready: number|null }
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
      set('chip', v.chip, t => { chip.hidden = !t; chip.textContent = t || ''; });
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
