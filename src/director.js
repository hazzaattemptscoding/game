// The director: joins the menu, the session state machine (session.js), the start sequence (start.js) and the session overlay to
// the game. main.js owns the car, the world and the loop; this file decides what the player is doing and what each button does.
//
//   const dir = createDirector(game);   // game: the car, timer, track, view, lobby and a few callbacks (see main.js)
//   every frame: dir.frame(now, dt) before the physics, dir.after(now, simTime) after it, dir.camera(camera, now) for the view.

import * as THREE from 'three';
import { createMenu } from './menu.js';
import { registerScreens } from './menuScreens.js';
import { resultsScreen, sampleResults } from './results.js';
import { createSessionHud, limitBanner } from './sessionHud.js';
import { Flow, PHASE, RACE, makeSession, timeTrialRows, raceDistance, raceRows, MODE_NAMES } from './session.js';
import { FIN } from './finish.js';
import { START, gridSlot, pitSlot, ttSlot, orbitPose, cinematicPose } from './start.js';
import { createScreenControl } from './screenControl.js';
import { GantryFeed } from './gantryState.js';
import { createRaceControl } from './raceControl.js';
import { cleanEnv, WEATHER_NAMES, TIME_NAMES } from './weather.js';

// the car on the grid before lights out: brake held, but under the 0.5 that would put it in reverse
export const HOLD = Object.freeze({ steer: 0, throttle: 0, brake: 0.45, drs: false });
const FINISH_DELAY_MS = 3000;       // the car keeps rolling this long after the flag before the results come up
const JUMP_SHOW_MS = 3500;

export function createDirector(g) {
  const { car, timer, track, lobby, settings, params } = g;   // the view is read as g.view: a change of car class replaces it
  const flow = new Flow();
  const sessHud = createSessionHud(document.getElementById('sess'));
  let session = null, finishedAt = null, pausedAt = 0, pos = null, jumpShownUntil = 0, lastPhase = '';
  const L = track.length;

  // --- online ---
  const mp = lobby.mp;
  const rc = createRaceControl({ mp, now: () => performance.now(), onRace: ({ msg, seq, slot, late }) => {
    if (late) { api.startPractice({ start: 'pit' }); return; }
    launch(makeSession('online', { laps: msg.laps, assists: msg.assists, racingLine: msg.racingLine, slipstream: msg.slipstream, weather: msg.weather, time: msg.time, slot }), { seq });
  } });
  // the gantry screen's control panel (src/screenControl.js): the host's in a room, handed to others by the host
  const sc = createScreenControl({ screen: g.gantryScreen, mp, inRoom: () => !!lobby.active, onChange: () => { const top = menu.current && menu.current(); if (top && (top.id === 'screen' || top.id === 'pause')) menu.refresh(); } });
  const gantry = new GantryFeed(g.gantryScreen);   // the race state on the gantry screen (src/gantryState.js)
  mp.onControl = (m, id) => { rc.handle(m, id); sc.handle(m, id); if (m && m.t === FIN) lobby.receiveFinish(m, id); };
  lobby.onChange(() => refreshResults());     // a finish arrived or a player came or went: the results screen, if it is open, follows

  // --- the menu ---
  const api = {};      // filled in below; the menu screens reach the game through it
  const menu = createMenu({ root: document.getElementById('menu'), settings, save: g.save, api, params, build: typeof __BUILD_COMMIT__ === 'undefined' ? '' : String(__BUILD_COMMIT__).slice(0, 7) });
  registerScreens(menu);
  const resultsHub = { current: null };     // the results screen's view while it is open (see showResults and refreshResults)
  let resultsAt = 0;
  menu.addScreen('results', resultsScreen(resultsHub));

  const online = () => !!lobby.active;
  // weather and time of day on screen: a guest takes the host's (when the host sends one), everybody else their own choice. Visual only.
  const ownEnv = () => cleanEnv({ weather: settings.weather, time: settings.timeOfDay });
  const environment = () => (online() && !mp.isHost && rc.env ? rc.env : ownEnv());
  const racingLineAllowed = () => !session || session.racingLine !== false;
  // drafting: the session's rule when one is running (time trial off, a race the setup's or the host's), else the player's own setting
  const slipstreamOn = () => (!session || session.mode === 'practice' ? settings.slipstream !== false : session.slipstream !== false);

  function applyAssists() {
    const off = session && session.assists === 'off' && flow.phase !== PHASE.MENU;
    car.setAssists(off ? { tc: false, abs: false, esc: false } : { tc: settings.assistTc, abs: settings.assistAbs, esc: settings.assistEsc });
  }

  // Put the car where the session starts, clear the timing and start the flow. o: { keepPlacement, restart, seq }
  function launch(s, o = {}) {
    const now = performance.now();
    session = s;
    if (settings.lastMode !== s.mode && ['practice', 'timetrial', 'race', 'online'].includes(s.mode)) { settings.lastMode = s.mode; g.save(settings); }   // the main menu's Resume button
    if (!o.keepPlacement) { const spot = s.start === 'standing' ? gridSlot(track, s.slot, s.reverse) : s.start === 'track' ? ttSlot(track) : pitSlot(track, s.reverse); car.placeAt(spot.s, spot.d, !!s.reverse); }
    car.contactGrace = 1.5;
    timer.reverse = !!s.reverse;
    timer.reset();
    g.history.inputs.length = 0; g.history.telemetry.length = 0;
    g.rig.yaw = null; g.rig.height = null;
    finishedAt = null; pos = null; jumpShownUntil = 0;
    lobby.resetFinishes();     // the finishes of the last race are not this race's
    sessHud.reset();
    const fo = { length: L };
    if (o.seq) { fo.t0 = o.seq.t0; fo.hold = o.seq.hold; }
    if (o.restart && (flow.phase === PHASE.PAUSED || flow.phase === PHASE.RESULTS)) flow.restart(now, fo);
    else { if (flow.phase !== PHASE.MENU) flow.toMenu(); flow.begin(s, now, fo); }
    applyAssists();
    if (menu.isOpen) menu.close();
  }

  function doResume() {
    if (flow.phase !== PHASE.PAUSED) return;
    const was = flow.pausedFrom;
    flow.resume();
    if (was === PHASE.START && flow.seq && !online()) flow.seq.shift(performance.now() - pausedAt);
  }

  // our finish for the room (src/finish.js): the race time with penalties, the best valid lap and sectors, the penalties, the warnings
  function finishMessage() {
    const race = flow.race;
    return { t: FIN, time: race.time, laps: race.laps, best: timer.best || 0, sec: timer.bestSectors.map(v => v || 0),
      pen: race.penalties.map(p => ({ s: p.seconds, why: p.reason })), warn: timer.limits.events.length };
  }

  // The results table: every car of the race, ranked by raceRows (session.js). The local car is from the session. A remote car is
  // ranked by its finish message once it has one; before that by where the room has it (its drawn distance); a car of the grid that
  // is no longer in the room did not finish (DNF). Cars that are not on the grid and not in the room are not in the race.
  const knownCars = new Map();   // id -> { name, colour, num }: the last we saw of each remote car, for a row after it left
  function buildResults() {
    const s = session || {}, L = track.length;
    const grid = rc.current && Array.isArray(rc.current.grid) ? rc.current.grid : [];
    const myId = online() ? mp.selfId : 'me';
    const gridOf = id => { const i = grid.indexOf(id); return i >= 0 ? i + 1 : null; };
    const own = lobby.ownLivery ? lobby.ownLivery() : null;
    const race = flow.race;
    const entries = [{ id: myId, name: lobby.name(), me: true, finished: true, time: race.time, dist: 0, best: timer.best || 0,
      sec: timer.bestSectors.map(v => v || 0), pen: race.penalties.map(p => ({ s: p.seconds, why: p.reason })), warn: timer.limits.events.length,
      grid: online() ? gridOf(myId) : null, colour: own ? own.body : '#ffd21f', num: own ? own.number : -1 }];
    const ids = new Set([...grid, ...lobby.finishes.ids(), ...[...mp.peers.values()].filter(p => p.hello).map(p => p.id)]);
    ids.delete(myId);
    for (const id of ids) {
      const fin = lobby.finishes.get(id), present = lobby.isPresent(id), g = lobby.ghosts.map.get(id), known = knownCars.get(id) || {};
      const lv = lobby.liveryOf(id) || known;
      const base = { id, name: lobby.nameOf(id) || known.name || 'Driver', colour: lv.colour || '#8f84a8', num: lv.num ?? -1, grid: gridOf(id) };
      if (fin) entries.push({ ...base, finished: true, time: fin.time, best: fin.best, sec: fin.sec, pen: fin.pen, warn: fin.warn, dist: 0 });
      else if (present) { const p = g && g.info ? lobby.ghosts.shownPose(g) : null; entries.push({ ...base, finished: false, dist: p ? raceDistance(p.lap, p.s, L) : 0 }); }
      else if (base.grid != null) entries.push({ ...base, finished: false, dnf: true, dist: 0 });
    }
    const rows = raceRows(entries, { laps: s.laps || 0, length: L });
    return { rows, laps: s.laps || 0, track: 'Lakeside Circuit', conditions: [WEATHER_NAMES[s.weather], TIME_NAMES[s.time]].filter(Boolean).join(', '), canAgain: !online() || mp.isHost };
  }

  function showResults() {
    const data = buildResults();
    if (!flow.finish(data.rows)) return;
    resultsAt = performance.now();
    menu.open('results', 'pause', { data });
  }

  // the results screen is open: its table takes the new rows in place (a finish, a car leaving, the cars still out moving on)
  function refreshResults() {
    if (!menu.isOpen || flow.phase !== PHASE.RESULTS || !resultsHub.current) return;
    const data = buildResults();
    flow.results = data.rows;
    resultsHub.current.update(data);
  }

  // The other cars for the race. Position uses the pose each car is drawn at (lap and s go together, from the same sample), so
  // the order matches the picture; laps completed and the best lap are the sender's own, from its newest packet.
  function otherCars() {
    const out = [];
    if (!lobby.active) return out;
    for (const o of lobby.ghosts.map.values()) {
      if (!o.info) continue;
      knownCars.set(o.id, { name: lobby.ghosts.nameOf(o), colour: o.livery.body, num: o.livery.number });
      const p = lobby.ghosts.shownPose(o);
      out.push({ id: o.id, name: lobby.ghosts.nameOf(o), laps: Math.max(0, o.info.lap - 1), lap: p.lap, s: p.s, best: o.info.bl || null });
    }
    return out;
  }

  // --- what the buttons do ---
  Object.assign(api, {
    session: () => session,
    // what the pause screen shows about the session: the mode, the laps driven, the best lap and the lap in progress (if any)
    sessionStats: () => ({ mode: session ? session.mode : null, laps: session ? session.laps || 0 : 0, done: timer.history.length, best: timer.best, current: timer.running(g.simTime()), reverse: !!(session && session.reverse) }),
    environment,
    envLocked: () => online() && !mp.isHost,     // a guest cannot change the room's weather
    inRoom: online,
    lobby,
    track: { N: track.N, x: track.x, z: track.z },   // the circuit outline for the race setup's track map
    hasRacingLine: () => true,
    racingLineAllowed,
    slipstreamOn,
    screen: sc,
    applyAssists,
    applyLook: () => g.applyLook(),
    qualityChanged: () => g.qualityChanged && g.qualityChanged(),
    getTopDown: () => g.getTopDown(),
    setTopDown: v => g.setTopDown(v),
    getAutopilot: () => g.getAutopilot(),
    setAutopilot: v => g.setAutopilot(v),
    learn: g.learn || null,   // the learning autopilot (src/learnClient.js), experimental
    autopilotStyleChanged: () => g.autopilotStyleChanged && g.autopilotStyleChanged(),
    livery: () => g.liveryChanged(),
    car: id => g.setCar(id),   // the garage's car class (src/cars.js)
    globalTimes: g.globalTimes || null,
    go(id) {
      if (id === 'practice') menu.push('setup', { mode: 'practice' });
      else if (id === 'timetrial') api.startTimeTrial();
      else if (id === 'race') menu.push('setup', { mode: 'race' });
      else menu.push(id);
    },
    startPractice: (o = {}) => launch(makeSession('practice', { start: o.start, reverse: o.reverse === true, ...ownEnv() })),
    startTimeTrial: () => launch(makeSession('timetrial', ownEnv())),
    startRace: o => launch(makeSession('race', { ...ownEnv(), ...o })),
    hostStartRace(o) {
      const r = rc.hostStart({ laps: o.laps, assists: o.assists, racingLine: o.racingLine, slipstream: o.slipstream, ...ownEnv() });
      if (r) launch(makeSession('online', { laps: o.laps, assists: o.assists, racingLine: o.racingLine, slipstream: o.slipstream, ...ownEnv(), slot: r.slot }), { seq: r.seq });
    },
    resume: () => menu.close(),
    restart() {
      const s = flow.session;
      if (!s) return;
      if (s.mode === 'online') { if (mp.isHost) api.hostStartRace({ laps: s.laps, assists: s.assists, racingLine: s.racingLine, slipstream: s.slipstream }); return; }
      launch(s, { restart: true });
    },
    report() { menu.close(); g.openReport(); },
    toMainMenu() {
      rc.endRace();
      flow.toMenu(); session = null; finishedAt = null;
      applyAssists();
      showMain();
    },
  });

  function showMain(screen) {
    const spot = gridSlot(track, 0);
    car.placeAt(spot.s, spot.d);   // forward, on the grid: the timer goes back to forward too (the boards read it)
    timer.reverse = false;
    timer.markJump();
    g.view.update(car, 1);
    menu.open('main', 'main');
    if (screen) { for (const s of [].concat(screen)) menu.push(s.id || s, s.params); }
  }

  menu.onClose = () => { if (menu.kind === 'pause') doResume(); };

  // Esc, P or the pad's Start button in the game
  function escape() {
    if (menu.isOpen) return;
    if (flow.phase !== PHASE.RUN && flow.phase !== PHASE.START) return;
    if (!online()) { flow.pause(); pausedAt = performance.now(); }
    menu.open('pause', 'pause');
  }

  // --- start up ---
  const startParam = params.get('start'), menuParam = params.get('menu');
  const skipMenu = menuParam === '0' || params.has('view') || params.has('viewat') || params.has('autopilot') || params.has('topdown');
  // a start asked for in the address begins at the first frame, so the first shader compile does not eat the start sequence
  let boot = () => {
    if (startParam === 'race') launch(makeSession('race', { laps: 3 }));
    else if (startParam === 'timetrial') launch(makeSession('timetrial'));
    else if (startParam === 'practice' || skipMenu) launch(makeSession('practice'), { keepPlacement: true });
  };
  const booting = startParam === 'race' || startParam === 'timetrial' || startParam === 'practice' || skipMenu;
  if (!booting) {
    if (params.has('garage')) showMain('garage');
    else if (menuParam === 'race') showMain('race');
    else if (menuParam === 'practice' || menuParam === 'solo') showMain(['race', { id: 'setup', params: { mode: menuParam === 'solo' ? 'race' : 'practice' } }]);
    else if (menuParam === 'online') showMain(['race', 'online']);
    else if (['settings', 'garage', 'times'].includes(menuParam)) showMain(menuParam);
    else if (menuParam === 'results' && import.meta.env.DEV) menu.open('results', 'pause', { data: sampleResults() });   // dev only: the screen with sample rows (tools/shot.mjs "menu=results")
    else showMain();
  }

  // --- every frame ---
  let tick = menu.tick, lastMpPhase = '';
  const d = {
    flow, menu, api, sessHud,
    get session() { return session; },
    get phase() { return flow.phase; },
    get menuOpen() { return menu.isOpen; },
    get inMenu() { return flow.phase === PHASE.MENU; },
    get hold() { return flow.phase === PHASE.START; },
    escape,
    // true when the key press that closed the menu this frame is also in the action list: it must not open it again
    menuToggledSinceLastFrame: () => menu.tick !== tick,

    // before the physics: advance the start, poll the menu pad, keep the online start in step
    frame(now, dt, playerInput) {
      if (boot) { const f = boot; boot = null; f(); }
      menu.update(dt);
      const mpPhase = mp.phase;
      if (mpPhase !== lastMpPhase) { lastMpPhase = mpPhase; if (mpPhase === 'joined' && !mp.isHost) rc.syncClock(); }
      rc.tick();
      sc.tick();
      if (lobby.active && mp.isHost) rc.hostSetEnv(ownEnv()); else if (!lobby.active) rc.clearEnv();
      if (session && lobby.active) lobby.setMeta({ mode: MODE_NAMES[session.mode] || 'Free practice', laps: session.laps || 0, started: flow.phase === PHASE.RUN || flow.phase === PHASE.START ? session.mode === 'online' || session.mode === 'race' : false });
      if (flow.phase === PHASE.START) {
        if (!menu.isOpen && flow.seq && playerInput) {
          const j = flow.seq.check(now, playerInput.throttle, car.speed * 3.6);
          if (j) jumpShownUntil = Infinity;
        }
        if (flow.update(now, g.simTime()) === 'run' && flow.seq.jump) jumpShownUntil = now + JUMP_SHOW_MS;
      }
    },

    // after the physics: laps, position, the flag, the overlay
    after(now, simTime) {
      if (flow.phase === PHASE.RUN && flow.race) {
        const others = otherCars();
        const r = flow.race.update(simTime, { laps: timer.lap, lap: timer.currentLap(), s: car.loc.s }, others, timer);   // the timer gives the track limit excursions to judge
        pos = r;
        if (flow.race.finished && finishedAt === null) { finishedAt = now; if (online()) lobby.announceFinish(finishMessage()); }
        if (finishedAt !== null && now - finishedAt > FINISH_DELAY_MS && !menu.isOpen) showResults();
      }
      if (flow.phase === PHASE.RESULTS && menu.isOpen && now - resultsAt > 1000) { resultsAt = now; refreshResults(); }   // the cars still out move on
      gantryFeed(now);
      sessHud.update(overlay(now, simTime));
      document.body.classList.toggle('in-session', flow.phase !== PHASE.MENU);
      tick = menu.tick;
    },

    // the camera for the menu and the start: returns true when it set the camera
    camera(camera, now) {
      if (flow.phase === PHASE.MENU && menu.kind === 'main' && menu.isOpen) {
        const i = Math.round(((L - 10) % L) / track.ds) % track.N;
        const p = orbitPose(now / 1000, { x: track.x[i], y: track.h[i], z: track.z[i] });
        camera.up.set(0, 1, 0); camera.position.set(...p.pos); camera.lookAt(...p.look);
        return true;
      }
      return false;
    },
    // after the normal camera ran: blend towards the start camera (race only), weight 1 at the start of the sequence, 0 at the end
    blendStartCamera(camera, now) {
      if (flow.phase !== PHASE.START || !flow.seq || flow.seq.kind !== 'lights') return;
      const st = flow.seq.state(now);
      if (st.phase !== 'cinematic' && st.phase !== 'wait') return;
      const p = cinematicPose(st.phase === 'wait' ? 0 : st.cam, { x: car.x, y: car.y, z: car.z, heading: car.heading });
      if (!(p.weight > 0)) return;
      const q0 = camera.quaternion.clone(), pos0 = camera.position.clone();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...p.pos), new THREE.Vector3(...p.look), new THREE.Vector3(0, 1, 0));
      const q1 = new THREE.Quaternion().setFromRotationMatrix(m);
      camera.position.lerpVectors(pos0, new THREE.Vector3(...p.pos), p.weight);
      camera.quaternion.copy(q0).slerp(q1, p.weight);
    },
    rc,
  };

  // the gantry screen shows the session: the start lights, GO, LAST LAP, the chequered flag, the lap (or the lap and best lap)
  function gantryFeed(now) {
    const s = session, race = flow.race;
    let leadLap = timer.currentLap();
    if (s && online()) for (const o of otherCars()) leadLap = Math.max(leadLap, o.laps + 1);   // the leader's lap, from the room's packets
    gantry.update({
      session: s, phase: flow.phase, lap: timer.currentLap(), leadLap, best: timer.best,
      lights: flow.phase === PHASE.START && flow.seq && flow.seq.kind === 'lights' ? flow.seq.state(now) : null,
      flagOut: !!race && (race.state !== RACE.RACING || (online() && lobby.finishes.size > 0)),
    });
  }

  function overlay(now, simTime) {
    const s = session, ph = flow.phase;
    if (!s || ph === PHASE.MENU) return { show: false };
    const v = { show: true, chip: null, lights: null, lightsOut: false, banner: null, laps: null };
    const lap = timer.currentLap();
    if (s.mode === 'practice') v.chip = { title: s.reverse ? 'Free practice, reverse' : 'Free practice' };
    else if (s.mode === 'timetrial') { v.chip = { title: 'Time trial', lap: lap ? `LAP ${lap}` : null }; v.laps = timeTrialRows(timer.history, 6); }
    else {
      const total = pos ? pos.total : 1;
      v.chip = { title: s.mode === 'online' ? 'Online race' : 'Race', lap: `LAP ${Math.min(s.laps, Math.max(1, lap))} / ${s.laps}`, pos: total > 1 ? `P${pos ? pos.pos : 1}` : null, of: total > 1 ? `/${total}` : null };
    }
    if (flow.seq && (ph === PHASE.START || ph === PHASE.RUN || ph === PHASE.PAUSED)) {
      const st = flow.seq.state(now);
      if (flow.seq.kind === 'lights') {
        if (st.phase === 'cinematic' || st.phase === 'wait') v.lights = 0;
        else if (st.phase === 'lights' || st.phase === 'hold') v.lights = st.lit;
        if (st.phase === 'go') v.banner = { text: 'GO', kind: 'go' };
      } else if (st.phase === 'ready' || st.phase === 'wait') v.banner = { text: String(st.count), kind: 'ready' };
      else if (st.phase === 'go') v.banner = { text: 'GO', kind: 'go' };
      if (flow.seq.jump && now < jumpShownUntil) v.banner = { text: `Jump start, +${START.PENALTY_S} s`, kind: 'jump' };
    }
    if (flow.race && flow.race.finished) v.banner = { text: 'Chequered flag', kind: 'flag' };
    const limit = limitBanner(flow.race, simTime); if (limit) v.banner = limit;   // the latest track limits penalty, a few seconds
    return v;
  }

  return d;
}
