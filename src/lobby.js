// The multiplayer lobby and its connection to the game: the Multiplayer section of the settings panel, the name tags
// over other cars and the standings list. All the networking is in multiplayer.js and the remote cars in ghosts.js;
// this file only joins them to the page. The game calls `solids()` in its step loop and `update()` once a frame.
// With no room open every call is a no-op.

import { Multiplayer, brokerFromSearch, loadConfig, cleanCode } from './multiplayer.js';
import { encodeLivery } from './livery.js';
import { Ghosts, threeFactory, makeProjector, stateFromCar, encodeState } from './ghosts.js';
import { encodeTelemetry, telemetryFromCar, TELEMETRY_HZ } from './shared/telemetry.js';

const SEND_MS = 33;           // 30 Hz (the relay allows 80 frames a second per socket, worker/src/protocol.js)
const HELD_MS = 250;          // a pose older than this is not moving on (paused, or a hidden tab): see the sender below
const NAME_KEY = 'lakeside-mp-name';
const COLLAPSE_KEY = 'lakeside-mp-standings';
const NO_CARS = [];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

// ctx: { scene, camera, car, timer, track, search, getLivery, poseTime } where getLivery() is the player's own livery (a normalised livery
// object) and poseTime() is the performance.now() time that the car's pose belongs to (the last physics step, see src/main.js)
const LIVERY_MS = 2000;       // our livery goes out again every 2 s (the low rate control state)
export function createLobby(ctx) {
  const $ = id => document.getElementById(id);
  const tagRoot = document.createElement('div');
  tagRoot.id = 'mp-tags';
  $('hud').appendChild(tagRoot);

  const ghosts = new Ghosts(threeFactory(ctx.scene, tagRoot));
  const el = { name: $('mp-name'), code: $('mp-code'), host: $('mp-host'), join: $('mp-join'), leave: $('mp-leave'), copy: $('mp-copy'), big: $('mp-big'),
    start: $('mp-start'), joinrow: $('mp-joinrow'), room: $('mp-room'), status: $('mp-status'), who: $('mp-who'), hint: $('mp-hint'), via: $('mp-via'), diag: $('mp-diag'), details: $('mp-details'), stand: $('h-stand') };
  const search = ctx.search || '';
  const q = new URLSearchParams(search);

  const mp = new Multiplayer({
    ghosts,
    config: brokerFromSearch(search),
    // multiplayer.json next to index.html is read each time someone hosts or joins, so the owner can edit it without a rebuild
    loadConfig: () => loadConfig({ fetchFn: (u, o) => fetch(u, o), search, build: typeof __BUILD_COMMIT__ === 'undefined' ? '' : __BUILD_COMMIT__ }),
    onStatus: s => render(s),
    onDiag: t => { el.diag.textContent = t; el.details.hidden = !t; },
    onPlayers: () => { renderWho(); lastStand = ''; },
    onRtt: ms => { rttSeen.push(ms); if (rttSeen.length > 500) rttSeen.shift(); renderVia(); },
  });

  el.name.value = store.get(NAME_KEY) || 'Driver' + (100 + Math.floor(Math.random() * 900));
  if (q.has('room')) el.code.value = cleanCode(q.get('room'));
  if (/(^|\.)(claude\.ai|claudeusercontent\.com)$/.test(location.hostname)) {
    el.status.textContent = 'This page is inside claude.ai, which blocks outside connections. Multiplayer only works when the game is on a real web host.';
  }

  const liveryNow = () => (ctx.getLivery ? ctx.getLivery() : null);
  const name = () => ((liveryNow() && liveryNow().name) || el.name.value.trim() || 'Driver');
  el.name.addEventListener('change', () => { store.set(NAME_KEY, el.name.value.trim()); mp.setName(name()); });
  el.code.addEventListener('input', () => { el.code.value = cleanCode(el.code.value); });
  el.host.addEventListener('click', () => { store.set(NAME_KEY, name()); mp.host(name()); });
  el.join.addEventListener('click', () => { store.set(NAME_KEY, name()); mp.join(el.code.value, name()); });
  el.code.addEventListener('keydown', e => { if (e.key === 'Enter') el.join.click(); });
  el.leave.addEventListener('click', () => mp.leave());
  el.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(mp.code); el.copy.textContent = 'Copied'; }
    catch (e) { el.copy.textContent = 'Select and copy'; }
    setTimeout(() => { el.copy.textContent = 'Copy code'; }, 1500);
  });

  // the round trips of this room (ms), for the console (logPing); cleared when a connection starts
  let rttSeen = [];
  function render(s) {
    if (s.phase === 'connecting') rttSeen = [];
    const inRoom = s.phase === 'hosting' || s.phase === 'joined' || s.phase === 'connecting';
    el.start.hidden = el.joinrow.hidden = inRoom;
    el.room.hidden = !inRoom;
    el.big.textContent = s.code;
    el.leave.textContent = s.phase === 'connecting' ? 'Cancel' : 'Leave';
    el.status.textContent = s.text;
    renderVia(s);
    el.hint.hidden = !(s.phase === 'hosting' && s.host);
    el.diag.textContent = s.details || '';
    el.details.hidden = !s.details || !(inRoom || s.phase === 'error');
    el.stand.hidden = !(s.phase === 'hosting' || s.phase === 'joined');
    if (s.phase === 'hosting' || s.phase === 'joined') ctx.car.contactGrace = 1.5;   // nobody is launched by a car that was already there
    renderWho();
    lastStand = '';
  }
  // which transport the room uses, and over the relay the round trip time to it in ms (measured by the 15 s ping), printed small
  function renderVia(s) {
    const inRoom = mp.phase === 'hosting' || mp.phase === 'joined';
    el.via.textContent = !inRoom ? '' : mp.transport === 'relay' ? `Via relay${mp.rtt != null ? ` \u00b7 ${mp.rtt} ms` : ''}${s && s.reconnecting ? ' \u00b7 reconnecting' : ''}` : 'Peer to peer';
  }
  function renderWho() {
    const names = [...mp.peers.values()].filter(p => p.hello).map(p => p.name);
    el.who.textContent = mp.active ? `${mp.players} of 8 in the room: ${[name(), ...names].join(', ')}` : '';
  }

  // --- standings (collapsible, under the timing block) ---
  let collapsed = store.get(COLLAPSE_KEY) === '1', lastStand = '', lastStandAt = 0;
  const head = document.createElement('button');
  head.type = 'button'; head.className = 'stand-head';
  head.addEventListener('click', () => { collapsed = !collapsed; store.set(COLLAPSE_KEY, collapsed ? '1' : '0'); lastStand = ''; });
  const list = document.createElement('div');
  el.stand.append(head, list);
  el.stand.hidden = true;

  function drawStandings(now) {
    if (el.stand.hidden || now - lastStandAt < 250) return;
    lastStandAt = now;
    const rows = ghosts.standings({ name: name(), livery: liveryNow(), lap: ctx.timer.currentLap(), s: ctx.car.loc.s, speed: ctx.car.speed }, ctx.track.length);
    const key = collapsed + '|' + rows.map(r => `${r.id}${r.name}${r.colour}${r.num}${r.lap}${r.gap}`).join('|');
    if (key === lastStand) return;
    lastStand = key;
    head.textContent = `${collapsed ? '+' : '-'} Players ${rows.length}`;
    head.setAttribute('aria-expanded', String(!collapsed));
    list.hidden = collapsed;
    list.replaceChildren(...rows.map((r, i) => {
      const d = document.createElement('div');
      d.className = r.me ? 'stand-row me' : 'stand-row';
      const dot = document.createElement('i'); dot.style.background = r.colour;
      const nm = document.createElement('span'); nm.textContent = `${i + 1} ${r.num >= 0 ? '#' + r.num + ' ' : ''}${r.name}`;
      const lp = document.createElement('em'); lp.textContent = 'L' + r.lap;
      const gp = document.createElement('b'); gp.textContent = r.gap;
      d.append(dot, nm, lp, gp);
      return d;
    }));
  }

  // --- per frame ---
  // The car goes out 30 times a second on a timer, not on the frame, so a slow frame rate does not make us look silent. Its stamp is
  // the time of the physics step that made the pose (ctx.poseTime), so a remote car is drawn where it was at that time, whatever the
  // frame rate. When the pose has not moved on for HELD_MS (the game is paused or the tab is hidden) the car goes out stood still,
  // stamped now, so it stays on the other screens instead of dropping out after a few seconds.
  let sentStamp = -Infinity;
  setInterval(() => {
    if (!(mp.players > 1 || mp.spectators > 0)) return;
    const now = performance.now(), pose = ctx.poseTime(), held = now - pose > HELD_MS;
    if (!held && pose <= sentStamp) return;                  // no physics step since the last one we sent
    const stamp = Math.max(held ? now : pose, sentStamp + 0.001);
    sentStamp = stamp;
    const st = stateFromCar(ctx.car, ctx.timer.currentLap(), mp.col, name(), stamp, ctx.timer.best, ctx.timer.last);
    if (held) { st.vx = 0; st.vz = 0; st.yr = 0; }
    mp.sendState(encodeState(st));
  }, SEND_MS);
  // the livery goes with the hello and again every 2 s, so a late or lost one still arrives and a repaint reaches everyone
  const sendLivery = () => { const l = liveryNow(); if (l) { mp.setLivery(encodeLivery(l)); } };
  setInterval(() => { if (mp.players > 1 || mp.spectators > 0) mp.sendLivery(); }, LIVERY_MS);
  // telemetry for the live timing page, only while somebody is watching; the room details for the lobby list (host only, repeated every 5 s)
  setInterval(() => { if (mp.spectators > 0) mp.sendTelemetry(encodeTelemetry(telemetryFromCar(ctx.car))); }, 1000 / TELEMETRY_HZ);
  let meta = { mode: 'Free practice', laps: 0, started: false }, metaSent = '', metaAt = 0;
  const sendMeta = () => {
    if (!mp.active || !mp.isHost) { metaSent = ''; return; }
    const key = JSON.stringify(meta), now = performance.now();
    if (key !== metaSent || now - metaAt > 5000) { if (mp.sendMeta(meta)) { metaSent = key; metaAt = now; } }
  };
  setInterval(sendMeta, 1000);
  sendLivery();
  let size = { w: innerWidth, h: innerHeight }, project = null;
  return {
    get active() { return mp.active; },
    get rtt() { return mp.active ? mp.rtt : null; },      // the relay round trip in ms, null when not online (the HUD readout)
    // the round trip over this room: min, average and max in ms, to the console (Tab, with the handling readout on, src/main.js)
    logPing() {
      if (!rttSeen.length) { console.log('ping: no round trip yet'); return; }
      const avg = rttSeen.reduce((a, b) => a + b, 0) / rttSeen.length;
      console.log(`ping (relay): min ${Math.min(...rttSeen)} ms, avg ${avg.toFixed(1)} ms, max ${Math.max(...rttSeen)} ms, ${rttSeen.length} samples`);
    },
    get joined() { return ghosts.size > 0; },
    ghosts,       // for tests and the console
    mp,           // the Multiplayer: the director reads its phase and sends the race start through it
    name,         // our name in the room
    // what the room is doing, for the lobby list: { mode (a name), laps (0 = open), started (a race is on) }. Host only; sent at once and then every 5 s.
    setMeta(m) { if (m.mode !== meta.mode || m.laps !== meta.laps || m.started !== meta.started) { meta = { mode: m.mode, laps: m.laps, started: m.started }; sendMeta(); } },
    board(own) { return ghosts.board({ ...own, livery: liveryNow() }); },
    // the player changed their livery: tell the room now (the standings follow on their next redraw)
    liveryChanged() { sendLivery(); lastStand = ''; },     // the lap time board rows, for the Tab board
    // the other cars for Car.collideCars at local time nowMs (performance.now() clock)
    solids(nowMs) { return ghosts.size ? ghosts.solids(nowMs) : NO_CARS; },
    update(nowMs) {
      if (!mp.active) return;
      if (!project || size.w !== innerWidth || size.h !== innerHeight) { size = { w: innerWidth, h: innerHeight }; project = makeProjector(ctx.camera, size.w, size.h); }
      ctx.camera.updateMatrixWorld();
      ghosts.update(nowMs, project);
      drawStandings(nowMs);
    },
  };
}
