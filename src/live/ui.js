// The panels of the live page. Each one is a small object that owns some DOM and has update(...): the lobby list, the timing tower,
// the telemetry panel, the track map and the event feed. Everything that came from the network goes in with textContent, never as HTML.

import { fmtTime, fmtGap } from './model.js';
import { SURF_NAMES } from '../track.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const colourOf = r => (r.livery && r.livery.body) || '#888';
const numOf = r => (r.livery && r.livery.number >= 0 ? '#' + r.livery.number + ' ' : '');
export const driverName = r => (r.livery && r.livery.name) || r.name;

// ---- the lobby list ----
export function createLobbyList(root, { onPick }) {
  const head = el('div', 'lob-head');
  const table = el('div', 'lob-table');
  const empty = el('p', 'lob-empty');
  root.append(head, table, empty);
  return {
    // state: { lobbies, ping, error, loading }
    update({ lobbies, ping, error, loading }) {
      head.textContent = error ? '' : `${lobbies.length} open ${lobbies.length === 1 ? 'lobby' : 'lobbies'}${ping ? ` · relay ping ${ping} ms` : ''}`;
      empty.textContent = error ? error : loading ? 'Looking for lobbies...' : lobbies.length ? '' : 'No lobbies are open right now. Open the game, press Esc, Online play, and host a room: it shows up here within a few seconds.';
      const rows = lobbies.map(l => {
        const r = el('button', 'lob-row');
        r.type = 'button';
        r.addEventListener('click', () => onPick(l.code));
        const cells = [
          ['code', l.code], ['host', l.host], ['players', `${l.count}/${l.max}`], ['mode', l.mode], ['laps', l.laps ? String(l.laps) : 'open'],
          ['status', l.started ? 'Racing' : 'Lobby'], ['ping', ping ? `${ping} ms` : '--'],
        ];
        for (const [k, v] of cells) { const c = el('span', 'c-' + k, v); if (k === 'status') c.classList.add(l.started ? 'racing' : 'idle'); r.appendChild(c); }
        r.title = l.players.join(', ') + (l.spectators ? ` (${l.spectators} watching)` : '');
        return r;
      });
      const th = el('div', 'lob-row lob-th');
      for (const t of ['Code', 'Host', 'Players', 'Mode', 'Laps', 'Status', 'Ping']) th.appendChild(el('span', 'c-' + t.toLowerCase(), t));
      table.replaceChildren(...(rows.length ? [th, ...rows] : []));
    },
  };
}

// ---- the timing tower ----
export function createTower(root, { onPick }) {
  const head = el('div', 'tw-head'), list = el('div', 'tw-list');
  root.append(head, list);
  return {
    update(rows, selected, order) {
      head.textContent = order;
      list.replaceChildren(...rows.map(r => {
        const row = el('button', 'tw-row' + (r.id === selected ? ' sel' : '') + (r.signal ? '' : ' lost'));
        row.type = 'button';
        row.addEventListener('click', () => onPick(r.id));
        const sw = el('i'); sw.style.background = colourOf(r);
        const secs = el('span', 'tw-sec');
        for (const s of r.sectors) { const b = el('b', s.c || 'none'); b.title = s.t ? s.t.toFixed(3) : ''; secs.appendChild(b); }
        const gap = r.finished ? 'FIN' : r.pos === 1 ? (order === 'Best lap' ? fmtTime(r.best) : 'Leader') : fmtGap(r.gap);
        row.append(el('span', 'tw-pos', r.pos), sw, el('span', 'tw-name', numOf(r) + driverName(r)), el('span', 'tw-gap', gap),
          el('span', 'tw-int', r.pos === 1 ? '' : fmtGap(r.interval)), secs,
          el('span', 'tw-last', fmtTime(r.last)), el('span', 'tw-best' + (r.fastest ? ' purple' : ''), fmtTime(r.best)));
        return row;
      }));
      if (!rows.length) list.appendChild(el('p', 'tw-empty', 'Waiting for the cars...'));
    },
  };
}

// ---- telemetry of the selected driver ----
export function createTelemetry(root) {
  const name = el('div', 'te-name');
  const big = el('div', 'te-big');
  const speed = el('b', null, '0'), unit = el('small', null, 'km/h'), gear = el('span', 'te-gear', 'N');
  big.append(speed, unit, gear);
  const bars = {};
  const mk = (k, label) => { const w = el('div', 'te-bar ' + k), f = el('i'); w.append(el('span', null, label), f); bars[k] = f; return w; };
  const steer = el('div', 'te-bar steer'), steerMark = el('i');
  steer.append(el('span', null, 'Steer'), steerMark);
  const info = el('div', 'te-info');
  const flags = el('div', 'te-flags');
  root.append(name, big, mk('thr', 'Throttle'), mk('brk', 'Brake'), steer, info, flags);
  return {
    update(r) {
      if (!r) { name.textContent = 'Pick a driver'; speed.textContent = '0'; gear.textContent = 'N'; for (const k in bars) bars[k].style.width = '0'; steerMark.style.left = '50%'; info.textContent = ''; flags.replaceChildren(); return; }
      const t = r.tele, st = r.st;
      name.textContent = numOf(r) + driverName(r);
      const ms = t ? t.speed : r.speed;
      speed.textContent = String(Math.round(ms * 3.6));
      gear.textContent = t ? (t.gear < 0 ? 'R' : t.gear === 0 ? 'N' : String(t.gear)) : '';
      const thr = t ? t.throttle : st ? st.thr : 0, brk = t ? t.brake : st ? st.brk : 0, str = t ? t.steer : st ? Math.max(-1, Math.min(1, st.st / 0.5)) : 0;
      bars.thr.style.width = (thr * 100).toFixed(0) + '%'; bars.brk.style.width = (brk * 100).toFixed(0) + '%';
      steerMark.style.left = (50 + str * 48).toFixed(1) + '%';
      info.textContent = t ? `${Math.round(t.rpm)} rpm · lat ${t.latG.toFixed(1)} g · long ${t.longG.toFixed(1)} g · ${Math.round(ms * 2.23694)} mph` : `${Math.round(ms * 2.23694)} mph · no telemetry from this player`;
      const on = t ? [['TC', t.tc], ['ABS', t.abs], ['ESC', t.esc], ['DRS', t.drs], ['PIT', t.pit]].filter(f => f[1]).map(f => f[0]) : [];
      const surf = t ? [...new Set(t.surf.map(s => SURF_NAMES[s] || ''))].filter(s => s && s !== 'tarmac') : [];
      flags.replaceChildren(...on.map(f => el('em', null, f)), ...surf.map(f => el('em', 'warn', f)));
    },
  };
}

// ---- the track map ----
export function createMap(canvas, track) {
  const g = canvas.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const step = Math.max(1, Math.floor(track.N / 400)), pts = [];
  for (let i = 0; i < track.N; i += step) { pts.push([track.x[i], track.z[i]]); minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]); minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]); }
  let w = 0, h = 0, k = 1, ox = 0, oz = 0;
  function fit() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    w = Math.max(40, r.width); h = Math.max(40, r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 10;
    k = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxZ - minZ));
    ox = (w - (maxX - minX) * k) / 2 - minX * k; oz = (h - (maxZ - minZ) * k) / 2 - minZ * k;
  }
  const X = x => x * k + ox, Z = z => z * k + oz;
  return {
    // dots: [{ x, z, colour, label, selected }]
    draw(dots) {
      fit();
      g.clearRect(0, 0, w, h);
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath();
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 9; g.stroke();
      g.strokeStyle = 'rgba(20,24,29,.9)'; g.lineWidth = 6; g.stroke();
      const sx = track.x[0], sz = track.z[0];
      g.fillStyle = '#fff'; g.fillRect(X(sx) - 4, Z(sz) - 1.5, 8, 3);
      g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center';
      for (const d of [...dots].sort((a, b) => a.selected - b.selected)) {
        g.beginPath(); g.arc(X(d.x), Z(d.z), d.selected ? 6 : 4.5, 0, Math.PI * 2);
        g.fillStyle = d.colour; g.fill();
        g.lineWidth = d.selected ? 2.5 : 1.5; g.strokeStyle = d.selected ? '#fff' : 'rgba(0,0,0,.7)'; g.stroke();
        if (d.label) { g.fillStyle = '#fff'; g.fillText(d.label, X(d.x), Z(d.z) - 9); }
      }
    },
  };
}

// ---- the event feed ----
export function createFeed(root) {
  let last = 0;
  return {
    update(events) {
      const n = events.length ? events[events.length - 1].n : 0;
      if (n === last) return;
      last = n;
      root.replaceChildren(...events.slice(-30).reverse().map(e => el('div', 'ev ev-' + e.kind, e.text)));
      if (!events.length) root.appendChild(el('p', 'tw-empty', 'Nothing yet'));
    },
  };
}
