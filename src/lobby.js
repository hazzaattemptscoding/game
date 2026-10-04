// The multiplayer lobby and its connection to the game: the Multiplayer section of the settings panel, the name tags
// over other cars and the standings list. All the networking is in multiplayer.js and the remote cars in ghosts.js;
// this file only joins them to the page. The game calls `solids()` in its step loop and `update()` once a frame.
// With no room open every call is a no-op.

import { Multiplayer, brokerFromSearch, loadConfig, cleanCode } from './multiplayer.js';
import { Ghosts, PALETTE, threeFactory, makeProjector, stateFromCar, encodeState } from './ghosts.js';

const SEND_MS = 50;           // 20 Hz
const NAME_KEY = 'lakeside-mp-name';
const COLLAPSE_KEY = 'lakeside-mp-standings';
const NO_CARS = [];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

// ctx: { scene, camera, car, timer, track, search }
export function createLobby(ctx) {
  const $ = id => document.getElementById(id);
  const tagRoot = document.createElement('div');
  tagRoot.id = 'mp-tags';
  $('hud').appendChild(tagRoot);

  const ghosts = new Ghosts(threeFactory(ctx.scene, tagRoot));
  const el = { name: $('mp-name'), code: $('mp-code'), host: $('mp-host'), join: $('mp-join'), leave: $('mp-leave'), copy: $('mp-copy'), big: $('mp-big'),
    start: $('mp-start'), joinrow: $('mp-joinrow'), room: $('mp-room'), status: $('mp-status'), who: $('mp-who'), hint: $('mp-hint'), diag: $('mp-diag'), details: $('mp-details'), stand: $('h-stand') };
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
  });

  el.name.value = store.get(NAME_KEY) || 'Driver' + (100 + Math.floor(Math.random() * 900));
  if (q.has('room')) el.code.value = cleanCode(q.get('room'));
  if (/(^|\.)(claude\.ai|claudeusercontent\.com)$/.test(location.hostname)) {
    el.status.textContent = 'This page is inside claude.ai, which blocks outside connections. Multiplayer only works when the game is on a real web host.';
  }

  const name = () => (el.name.value.trim() || 'Driver');
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

  function render(s) {
    const inRoom = s.phase === 'hosting' || s.phase === 'joined' || s.phase === 'connecting';
    el.start.hidden = el.joinrow.hidden = inRoom;
    el.room.hidden = !inRoom;
    el.big.textContent = s.code;
    el.leave.textContent = s.phase === 'connecting' ? 'Cancel' : 'Leave';
    el.status.textContent = s.text;
    el.hint.hidden = !(s.phase === 'hosting' && s.host);
    el.diag.textContent = s.details || '';
    el.details.hidden = !s.details || !(inRoom || s.phase === 'error');
    el.stand.hidden = !(s.phase === 'hosting' || s.phase === 'joined');
    if (s.phase === 'hosting' || s.phase === 'joined') ctx.car.contactGrace = 1.5;   // nobody is launched by a car that was already there
    renderWho();
    lastStand = '';
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
    const rows = ghosts.standings({ name: name(), lap: ctx.timer.currentLap(), s: ctx.car.loc.s, speed: ctx.car.speed }, ctx.track.length);
    const key = collapsed + '|' + rows.map(r => `${r.id}${r.name}${r.lap}${r.gap}`).join('|');
    if (key === lastStand) return;
    lastStand = key;
    head.textContent = `${collapsed ? '+' : '-'} Players ${rows.length}`;
    head.setAttribute('aria-expanded', String(!collapsed));
    list.hidden = collapsed;
    list.replaceChildren(...rows.map((r, i) => {
      const d = document.createElement('div');
      d.className = r.me ? 'stand-row me' : 'stand-row';
      const dot = document.createElement('i'); dot.style.background = '#' + PALETTE[r.col].toString(16).padStart(6, '0');
      const nm = document.createElement('span'); nm.textContent = `${i + 1} ${r.name}`;
      const lp = document.createElement('em'); lp.textContent = 'L' + r.lap;
      const gp = document.createElement('b'); gp.textContent = r.gap;
      d.append(dot, nm, lp, gp);
      return d;
    }));
  }

  // --- per frame ---
  // the car goes out 20 times a second on a timer, not on the frame, so a slow frame rate does not make us look silent
  setInterval(() => {
    if (mp.players > 1) mp.sendState(encodeState(stateFromCar(ctx.car, ctx.timer.currentLap(), mp.col, name(), performance.now(), ctx.timer.best, ctx.timer.last)));
  }, SEND_MS);
  let size = { w: innerWidth, h: innerHeight }, project = null;
  return {
    get active() { return mp.active; },
    get joined() { return ghosts.size > 0; },
    ghosts,       // for tests and the console
    name,         // our name in the room
    board(own) { return ghosts.board(own); },     // the lap time board rows, for the Tab board
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
