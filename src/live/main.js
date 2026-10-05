// Lakeside Live: the lobby list and the spectator view. live.html#ABCDE opens the room ABCDE straight away.
// The page never plays: it joins a room as a spectator (the relay does not count it as a player and sends it the room's cars),
// builds the same world as the game, and draws the cars from the state stream with the game's own interpolation.

import { Ghosts, threeFactory, makeProjector } from '../ghosts.js';
import { RaceModel } from './model.js';
import { TVDirector } from './tv.js';
import { LiveCameras, MODES, MODE_NAMES } from './cams.js';
import { findRelay, httpBase, fetchLobbies, SpectatorRoom, LIST_MS } from './net.js';
import { createLobbyList, createTower, createTelemetry, createMap, createFeed, driverName } from './ui.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TABLE_MS = 250;                // the timing tower and the panels redraw this often; the picture runs every frame

const app = { relay: '', base: '', ping: 0, lobbies: [], error: '', loading: true, view: 'lobbies', code: '', status: 'connecting', spectators: 0, room: null, model: null, scene: null };
window.live = app;                   // for tests and the console

// ---- the lobby list ----
const list = createLobbyList($('lobby-list'), { onPick: code => { location.hash = code; } });
let listTimer = 0;
async function refreshList() {
  if (app.view !== 'lobbies') return;
  try {
    const r = await fetchLobbies(app.base);
    app.lobbies = r.lobbies; app.ping = r.ping; app.error = '';
  } catch (e) { app.error = `Could not reach the relay (${app.relay}). It may be down, or this network blocks outside connections.`; app.lobbies = []; }
  app.loading = false;
  list.update(app);
  setStatus();
}
function startList() { clearInterval(listTimer); refreshList(); listTimer = setInterval(refreshList, LIST_MS); }

// ---- header ----
function setStatus() {
  const s = $('status');
  if (app.view === 'lobbies') { s.textContent = app.relay ? (app.error ? 'Relay not reachable' : 'Live timing') : 'No relay set'; return; }
  const m = app.model && app.model.status(), n = app.model ? app.model.rows().length : 0;
  s.replaceChildren();
  const add = (t, cls) => { const b = document.createElement('b'); if (cls) b.className = cls; b.textContent = t; s.append(b, ' · '); };
  add(app.code);
  if (m) add(m.text, m.racing ? 'racing' : '');
  s.append(`${n} ${n === 1 ? 'car' : 'cars'}`);
  if (app.spectators > 1) s.append(` · ${app.spectators} watching`);
  if (app.status !== 'live') s.append(` · ${app.status === 'connecting' ? 'connecting' : app.status === 'reconnecting' ? 'reconnecting' : ''}`);
}

// ---- the live view ----
let ui = null, selected = null, rows = [], lastTable = 0, last = performance.now(), running = false;
const tmpPose = { x: 0, y: 0, z: 0, h: 0, pz: 0, vx: 0, vz: 0 };
const dotPose = {};   // (reused, the map reads it at once)

async function ensureView() {
  if (ui) return ui;
  const { createLiveScene } = await import('./scene.js');
  const sc = createLiveScene($('gl'));
  const ghosts = new Ghosts(threeFactory(sc.scene, $('tags')), { max: 8 });
  const poseOf = id => { const g = ghosts.map.get(id); return g ? g.buf.sample(performance.now(), tmpPose) : null; };
  const cams = new LiveCameras(sc.camera, sc.track, poseOf);
  const tv = new TVDirector({ spots: cams.spots.length });
  const tower = createTower($('tower'), { onPick: id => pick(id) });
  const tele = createTelemetry($('tele'));
  const map = createMap($('map-canvas'), sc.track);
  const feed = createFeed($('feed'));
  ui = { sc, ghosts, cams, tv, tower, tele, map, feed, poseOf, project: null, psize: { w: 0, h: 0 } };
  app.ui = ui;
  buildCamBar();
  return ui;
}

function pick(id) {
  selected = id;
  if (ui.cams.mode === 'tv') ui.cams.setMode('chase');
  buildCamBar();
}

function buildCamBar() {
  const bar = $('cams');
  const buttons = MODES.map(m => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = MODE_NAMES[m]; b.dataset.mode = m;
    if (ui.cams.mode === m) b.classList.add('on');
    b.addEventListener('click', () => {
      if (m === 'trackside' && ui.cams.mode === 'trackside') ui.cams.pickSpot(ui.cams.spot + 1);      // a second click goes to the next camera
      else ui.cams.setMode(m);
      buildCamBar();
    });
    return b;
  });
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Driver');
  const cur = ui.cams.current.id ?? selected;
  for (const r of rows) { const o = document.createElement('option'); o.value = r.id; o.textContent = `${r.pos}. ${driverName(r)}`; if (r.id === cur) o.selected = true; sel.appendChild(o); }
  sel.addEventListener('change', () => pick(sel.value));
  bar.replaceChildren(...buttons, sel);
  $('freepad').hidden = ui.cams.mode !== 'free';
}

async function enterRoom(code) {
  await ensureView();
  leaveRoom(false);
  app.view = 'live'; app.code = code; app.status = 'connecting'; app.spectators = 0;
  $('lobbies').hidden = true; $('live').hidden = false; $('back').hidden = false;
  clearInterval(listTimer);
  const { sc, ghosts, cams } = ui;
  const model = app.model = new RaceModel({ length: sc.track.length, sectors: sc.track.sectors });
  selected = null; rows = []; ui.tv = new TVDirector({ spots: cams.spots.length });
  cams.shot = null; cams.setMode(params.get('cam') && MODES.includes(params.get('cam')) ? params.get('cam') : 'tv');
  $('notice').hidden = true;
  buildCamBar();
  app.room = new SpectatorRoom({
    url: app.relay, code, ghosts, model,
    handlers: {
      onStatus: s => {
        app.status = s; setStatus();
        const n = $('notice');
        n.hidden = !(s === 'full' || s === 'gone');
        if (s === 'full') n.textContent = 'This room already has the most spectators it allows. Try again in a moment.';
        if (s === 'gone') n.textContent = `Room ${code} is not open any more. Pick another from the list.`;
      },
      onSpectators: n => { app.spectators = n; setStatus(); },
    },
  });
  app.room.start();
  if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
}

function leaveRoom(showList = true) {
  if (app.room) { app.room.stop(); app.room = null; }
  if (ui) ui.ghosts.clear();
  app.model = null;
  if (showList) {
    app.view = 'lobbies'; app.code = '';
    $('lobbies').hidden = false; $('live').hidden = true; $('back').hidden = true;
    startList(); setStatus();
  }
}

function frame(now) {
  if (app.view !== 'live') { running = false; return; }
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const { sc, ghosts, cams, tv } = ui, model = app.model;
  const box = $('gl').getBoundingClientRect();
  sc.resize(Math.max(2, Math.round(box.width)), Math.max(2, Math.round(box.height)));

  if (now - lastTable >= TABLE_MS) {
    lastTable = now;
    rows = model.rows(now);
    const shot = tv.update(now / 1000, rows, model.meta);
    cams.shot = shot;
    if (selected == null || !rows.some(r => r.id === selected)) selected = rows.length ? rows[0].id : null;
    if (cams.mode !== 'tv' || !shot) cams.target = selected;
    const shown = cams.current.id ?? selected, row = rows.find(r => r.id === shown) || null;
    ui.tower.update(rows, shown, model.raceOn ? 'Race' : 'Best lap');
    ui.tele.update(row);
    ui.feed.update(model.events);
    $('shot').textContent = cams.mode === 'tv' && shot && row ? `${driverName(row)}: ${({ battle: 'battle', incident: 'incident', start: 'the start', finish: 'the finish', leader: 'the leader', field: 'the field' })[shot.why] || ''}` : '';
    syncSelect(shown);
    setStatus();
  }

  if (ui.psize.w !== sc.size.w || ui.psize.h !== sc.size.h) { ui.psize = { w: sc.size.w, h: sc.size.h }; ui.project = makeProjector(sc.camera, sc.size.w, sc.size.h); }
  cams.update(dt);
  sc.camera.updateMatrixWorld();
  ghosts.update(now, params.get('tags') === '0' ? null : ui.project);
  const f = cams.current.id != null ? ui.poseOf(cams.current.id) : null;
  if (f) sc.sunAt(f.x, f.y, f.z); else sc.sunAt(sc.camera.position.x, 0, sc.camera.position.z);
  sc.render();

  const dots = [];
  for (const r of rows) {
    const g = ghosts.map.get(r.id), p = g && g.buf.sample(now, dotPose);
    if (p) dots.push({ x: p.x, z: p.z, colour: (r.livery && r.livery.body) || '#888', label: r.livery && r.livery.number >= 0 ? String(r.livery.number) : '', selected: r.id === (cams.current.id ?? selected) });
  }
  ui.map.draw(dots);
}

function syncSelect(id) {
  const sel = $('cams').querySelector('select');
  if (!sel) return;
  const have = [...sel.options].map(o => o.value).join('|'), want = rows.map(r => r.id).join('|');
  if (have !== want) { buildCamBar(); return; }
  if (sel.value !== id && id != null && document.activeElement !== sel) sel.value = id;
}

// ---- input ----
const typing = e => /^(select|input|textarea)$/i.test(e.target.tagName);
addEventListener('keydown', e => {
  if (app.view !== 'live' || !ui || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (/^[1-6]$/.test(k)) { ui.cams.setMode(MODES[+k - 1]); buildCamBar(); e.preventDefault(); return; }
  if (ui.cams.mode === 'free') { ui.cams.keys.add(k); if (k.startsWith('arrow') || k === ' ') e.preventDefault(); if (e.shiftKey) ui.cams.keys.add('shift'); return; }
  if (k === 'n' || k === 'arrowright' || k === 'p' || k === 'arrowleft') {
    const ix = rows.findIndex(r => r.id === (ui.cams.current.id ?? selected)), d = k === 'n' || k === 'arrowright' ? 1 : -1;
    if (rows.length) pick(rows[(ix + d + rows.length) % rows.length].id);
  } else if (k === ']' || k === '[') { ui.cams.pickSpot((ui.cams.spot + (k === ']' ? 1 : ui.cams.spots.length - 1)) % ui.cams.spots.length); buildCamBar(); }
  else if (k === 'escape' || k === 'backspace') location.hash = '';
});
addEventListener('keyup', e => { if (ui) { ui.cams.keys.delete(e.key.toLowerCase()); if (!e.shiftKey) ui.cams.keys.delete('shift'); } });
addEventListener('blur', () => { if (ui) ui.cams.keys.clear(); });

// drag to look (free camera); a tap on the picture does nothing else
{
  const gl = $('gl');
  let drag = null;
  gl.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { gl.setPointerCapture(e.pointerId); } catch { /* not capturable */ } });
  gl.addEventListener('pointermove', e => { if (drag && ui) { ui.cams.look(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; } });
  const end = () => { drag = null; };
  gl.addEventListener('pointerup', end); gl.addEventListener('pointercancel', end);
  gl.addEventListener('wheel', e => { if (ui && ui.cams.mode === 'free') { ui.cams.nudge(-e.deltaY * 0.05, 0); e.preventDefault(); } }, { passive: false });
}
for (const b of document.querySelectorAll('#freepad button')) {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', e => { if (ui) ui.cams.keys.add(k); e.preventDefault(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { if (ui) ui.cams.keys.delete(k); });
}

// the tabs of the phone layout
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => {
    const tab = b.dataset.tab;
    for (const o of document.querySelectorAll('#tabs button')) o.classList.toggle('on', o === b);
    $('tower').classList.toggle('on', tab === 'tower');
    $('side').classList.toggle('on', tab !== 'tower');
    for (const p of document.querySelectorAll('#side .panel')) p.classList.toggle('on', p.dataset.panel === tab);
  });
}
$('back').addEventListener('click', () => { location.hash = ''; });

// ---- routing ----
function route() {
  const code = location.hash.replace(/^#/, '').toUpperCase();
  if (/^[A-Z]{5}$/.test(code) && app.relay) enterRoom(code); else if (app.view === 'live') leaveRoom(true);
}
addEventListener('hashchange', route);

(async () => {
  app.relay = await findRelay(location.search);
  app.base = httpBase(app.relay);
  setStatus();
  if (!app.relay) { app.loading = false; app.error = 'No relay is set for this site. Add "relay" to multiplayer.json or open this page with ?relay=wss://your-relay.'; list.update(app); return; }
  startList();
  route();
})();
