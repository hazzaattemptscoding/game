// The director: joins the menu, the session state machine (session.js), the start sequence (start.js) and the session overlay to
// the game. main.js owns the car, the world and the loop; this file decides what the player is doing and what each button does.
//
//   const dir = createDirector(game);   // game: the car, timer, track, view, lobby and a few callbacks (see main.js)
//   every frame: dir.frame(now, dt) before the physics, dir.after(now, simTime) after it, dir.camera(camera, now) for the view.

import * as THREE from 'three';
import { createMenu } from './menu.js';
import { registerScreens } from './menuScreens.js';
import { resultsScreen } from './results.js';
import { createSessionHud } from './sessionHud.js';
import { Flow, PHASE, makeSession, timeTrialRows, raceDistance, MODE_NAMES } from './session.js';
import { START, gridSlot, pitSlot, orbitPose, cinematicPose } from './start.js';
import { createRaceControl } from './raceControl.js';

// the car on the grid before lights out: brake held, but under the 0.5 that would put it in reverse
export const HOLD = Object.freeze({ steer: 0, throttle: 0, brake: 0.45, drs: false });
const FINISH_DELAY_MS = 3000;       // the car keeps rolling this long after the flag before the results come up
const JUMP_SHOW_MS = 3500;

export function createDirector(g) {
  const { car, timer, track, view, lobby, settings, params } = g;
  const flow = new Flow();
  const sessHud = createSessionHud(document.getElementById('sess'));
  let session = null, finishedAt = null, pausedAt = 0, pos = null, jumpShownUntil = 0, lastPhase = '';
  const L = track.length;

  // --- online ---
  const mp = lobby.mp;
  const rc = createRaceControl({ mp, now: () => performance.now(), onRace: ({ msg, seq, slot, late }) => {
    if (late) { api.startPractice({ start: 'pit' }); return; }
    launch(makeSession('online', { laps: msg.laps, assists: msg.assists, racingLine: msg.racingLine, slot }), { seq });
  } });
  mp.onControl = (m, id) => rc.handle(m, id);

  // --- the menu ---
  const api = {};      // filled in below; the menu screens reach the game through it
  const menu = createMenu({ root: document.getElementById('menu'), settings, save: g.save, api, params, build: typeof __BUILD_COMMIT__ === 'undefined' ? '' : String(__BUILD_COMMIT__).slice(0, 7) });
  registerScreens(menu);
  menu.addScreen('results', resultsScreen());

  const online = () => !!lobby.active;
  const racingLineAllowed = () => !session || session.racingLine !== false;

  function applyAssists() {
    const off = session && session.assists === 'off' && flow.phase !== PHASE.MENU;
    car.setAssists(off ? { tc: false, abs: false, esc: false } : { tc: settings.assistTc, abs: settings.assistAbs, esc: settings.assistEsc });
  }

  // Put the car where the session starts, clear the timing and start the flow. o: { keepPlacement, restart, seq }
  function launch(s, o = {}) {
    const now = performance.now();
    session = s;
    if (!o.keepPlacement) { const spot = s.start === 'standing' ? gridSlot(track, s.slot) : pitSlot(track); car.placeAt(spot.s, spot.d); }
    car.contactGrace = 1.5;
    timer.reset();
    g.history.inputs.length = 0; g.history.telemetry.length = 0;
    g.rig.yaw = null; g.rig.height = null;
    finishedAt = null; pos = null; jumpShownUntil = 0;
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

  function showResults() {
    const race = flow.race, others = otherCars();
    const rows = [{ id: 'me', name: lobby.name(), me: true, finished: true, time: race.time, dist: raceDistance(timer.currentLap(), car.loc.s, L), best: timer.best }];
    for (const o of others) rows.push({ id: o.id, name: o.name, me: false, finished: false, dist: raceDistance(o.lap, o.s, L), best: o.best });
    if (!flow.finish(rows)) return;
    menu.open('results', 'pause', { rows: flow.results, race: { laps: race.laps, time: race.time, best: timer.best, warnings: timer.limits.events.length, penalties: race.penalties }, canAgain: !online() || mp.isHost });
  }

  function otherCars() {
    const out = [];
    if (!lobby.active) return out;
    for (const o of lobby.ghosts.map.values()) if (o.info) out.push({ id: o.id, name: lobby.ghosts.nameOf(o), laps: Math.max(0, o.info.lap - 1), lap: o.info.lap, s: o.info.s, best: o.info.bl || null });
    return out;
  }

  // --- what the buttons do ---
  Object.assign(api, {
    session: () => session,
    inRoom: online,
    lobby,
    hasRacingLine: () => true,
    racingLineAllowed,
    applyAssists,
    applyLook: () => g.applyLook(),
    getTopDown: () => g.getTopDown(),
    setTopDown: v => g.setTopDown(v),
    getAutopilot: () => g.getAutopilot(),
    setAutopilot: v => g.setAutopilot(v),
    livery: () => g.liveryChanged(),
    go(id) {
      if (id === 'practice') menu.push('setup', { mode: 'practice' });
      else if (id === 'timetrial') api.startTimeTrial();
      else if (id === 'race') menu.push('setup', { mode: 'race' });
      else menu.push(id);
    },
    startPractice: (o = {}) => launch(makeSession('practice', { start: o.start })),
    startTimeTrial: () => launch(makeSession('timetrial')),
    startRace: o => launch(makeSession('race', o)),
    hostStartRace(o) {
      const r = rc.hostStart({ laps: o.laps, assists: o.assists, racingLine: o.racingLine });
      if (r) launch(makeSession('online', { laps: o.laps, assists: o.assists, racingLine: o.racingLine, slot: r.slot }), { seq: r.seq });
    },
    resume: () => menu.close(),
    restart() {
      const s = flow.session;
      if (!s) return;
      if (s.mode === 'online') { if (mp.isHost) api.hostStartRace({ laps: s.laps, assists: s.assists, racingLine: s.racingLine }); return; }
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
    car.placeAt(spot.s, spot.d);
    view.update(car, 1);
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
    else if (menuParam === 'race' || menuParam === 'practice') showMain([{ id: 'setup', params: { mode: menuParam } }]);
    else if (['settings', 'garage', 'online'].includes(menuParam)) showMain(menuParam);
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
        const r = flow.race.update(simTime, { laps: timer.lap, lap: timer.currentLap(), s: car.loc.s }, others);
        pos = r;
        if (flow.race.finished && finishedAt === null) { finishedAt = now; }
        if (finishedAt !== null && now - finishedAt > FINISH_DELAY_MS && !menu.isOpen) showResults();
      }
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

  function overlay(now, simTime) {
    const s = session, ph = flow.phase;
    if (!s || ph === PHASE.MENU) return { show: false };
    const v = { show: true, chip: null, lights: null, lightsOut: false, banner: null, laps: null };
    const lap = timer.currentLap();
    if (s.mode === 'practice') v.chip = 'Free practice';
    else if (s.mode === 'timetrial') { v.chip = `Time trial${lap ? `  Lap ${lap}` : ''}`; v.laps = timeTrialRows(timer.history, 6); }
    else {
      const total = pos ? pos.total : 1;
      v.chip = `${s.mode === 'online' ? 'Online race' : 'Race'}  Lap ${Math.min(s.laps, Math.max(1, lap))}/${s.laps}${total > 1 ? `  P${pos ? pos.pos : 1}/${total}` : ''}`;
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
    return v;
  }

  return d;
}
