// Lakeside, phase 1: drive feel on the test track.
//
// Physics runs at a fixed 120 steps per second, separate from the frame
// rate. Rendering runs on requestAnimationFrame at the display's rate (60,
// 120, 144, 240 Hz) and blends between the last two physics steps so motion
// stays smooth on any screen (src/loop.js). Graphics quality, the render
// scale that Auto adjusts and the shadow refresh are in src/quality.js.

import * as THREE from 'three';
import { buildTrack } from './track.js';
import { Car, STEP } from './physics.js';
import { FixedStep, FrameStats, frameTime } from './loop.js';
import { createQuality, isPhone, snapShadowCentre, QUALITY_LABELS } from './quality.js';
import { optimiseWorld, freezeWorld, propCuller } from './cull.js';
import { carById } from './cars.js';
import { LapTimer } from './timing.js';
import { Autopilot } from './autopilot.js';
import { createLearning } from './learnClient.js';
import { createLearnChip } from './learnUi.js';
import { createGlobalTimes, LapWatch, timesBase, boardFor, boardLabel } from './globalTimes.js';
import { createBoardGhost } from './boardGhost.js';
import { makeProjector } from './ghosts.js';
import { loadConfig } from './multiplayer.js';
import { buildTrackScene, DEBUG_COLOURS } from './trackMesh.js';
import { createGround, buildScenery } from './scenery.js';
import { CarView } from './car.js';
import { CameraRig } from './cameras.js';
import { createInput } from './input.js';
import { Hud } from './hud.js';
import { createMiniMap } from './miniMap.js';
import { createMarshalLights, planMarshal, MarshalWatch } from './marshal.js';
import { addServiceVehicles } from './serviceVehicles.js';
import { hudOn, cyclePreset, PRESET_NAMES } from './hudSettings.js';
import { loadSettings, saveSettings } from './settings.js';
import { ReportTool } from './report.js';
import { createLobby } from './lobby.js';
import { ownLivery, localPlayerId } from './livery.js';
import { createBoard, loadBest, bestKey, personalSectors } from './board.js';
import { CarAudio } from './audio.js';
import { createRacingLine } from './racingLine.js';
import { createDirector, HOLD } from './director.js';
import { createEnvironment } from './environment.js';
import { envFromParams } from './weather.js';
import { isRace } from './session.js';
import { createGantryScreen } from './gantryScreen.js';
import powermediaLogo from './assets/powermedia-white.png';
import deltadashLogo from './assets/deltadash.png';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';

import { createCarFx } from './carFx.js';
import { wakeFor } from './slipstream.js';
import { createSlipFx } from './slipFx.js';
const params = new URLSearchParams(location.search);
const settings = loadSettings();

// --- world ---
const track = buildTrack();
const car = new Car(carById(settings.car), track);   // the car class (settings.car, picked in the garage): the same object for the whole session
car.setAssists({ tc: settings.assistTc, abs: settings.assistAbs, esc: settings.assistEsc });
car.placeAt(params.has('at') ? +params.get('at') : -20, 0);  // ?at=1500 starts the car 1500 m into the lap
const timer = new LapTimer(track);
// the learning autopilot (experimental, src/learn.js): with the style set to 'learn' and a learned genome the autopilot drives that
const learn = createLearning({ track, getCarId: () => car.cfg.id, phone: isPhone() });
const playerAssists = () => ({ tc: settings.assistTc, abs: settings.assistAbs, esc: settings.assistEsc });
let learnVersion = -1;   // the stored genome that the running autopilot was built from
function newAutopilot() {
  if (settings.autopilotMode === 'learn') {
    const ap = learn.makeAutopilot(car.cfg, playerAssists());
    if (ap) { learnVersion = learn.version; return ap; }
  }
  learnVersion = -1;
  return new Autopilot(track, car.cfg, { skill: 0.9 });
}
let autopilot = params.has('autopilot') ? newAutopilot() : null;
let assistsTaken = false;   // the learned autopilot has switched the car's assists; the player's own come back when it stops

// --- rendering ---
const canvas = document.getElementById('view');
const phone = isPhone();
// multisampling costs a lot at a phone's pixel density and shows little there
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.shadowMap.autoUpdate = false;   // refreshed from the loop, at the rate the graphics quality allows
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const skyTop = new THREE.Color(0x6fa3d6), skyBottom = new THREE.Color(0xd9e6ee);
scene.background = skyTexture(skyTop, skyBottom);
scene.fog = new THREE.Fog(0xcfdde6, 300, 2600);

const hemi = new THREE.HemisphereLight(0xdfeeff, 0x4a5a3a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();   // the environment (src/environment.js) moves it with the time of day

const ground = createGround(track);
const terrain = ground.mesh();
const world = new THREE.Group();
const trackScene = buildTrackScene(track, ground);
const scenery = buildScenery(track, ground);
world.add(terrain, trackScene, scenery);
const optimised = optimiseWorld(world);   // long ribbons in pieces and small meshes merged (src/cull.js); the report tool swaps the real objects back
freezeWorld(world);
const props = propCuller(world);
scene.add(world);
const env = createEnvironment({ renderer, scene, sun, hemi, sunDir: SUN_DIR, onLightning: (delay, k) => audio.thunder(delay, k) });   // sky, light, fog, weather, wet road, lamps
const urlEnv = envFromParams(params);   // ?weather=rain&time=dusk wins over the settings and the room, for testing
env.set(urlEnv || settings, { instant: true });
env.registerWorld(world);
const marshal = createMarshalLights(track, ground, planMarshal(track, ground, scenery.userData.keepClear));   // LED panels at the minisector boundaries (src/marshal.js)
scene.add(marshal.group);
const marshalProps = propCuller(marshal.group);   // the marshals go beyond their draw distance like the crowds
addServiceVehicles(scene, track, ground, scenery.userData.keepClear);   // parked ambulances, fire engines, the safety car and the rest (src/serviceVehicles.js)
const marshalWatch = new MarshalWatch(marshal, track);
const racingLine = createRacingLine(track);   // optional colour coded racing line (L key, Settings); the page ?line=1 turns it on
scene.add(racingLine.group);
const slipFx = createSlipFx(canvas);   // speed lines and the wider view while drafting (src/slipFx.js)
const carFx = createCarFx(scene);     // headlamp and tail light glow, road pools and spray for the other cars
const selfFx = { x: 0, y: 0, z: 0, h: 0, v: 0, brk: 0, o: 1, self: true, id: 'self', cls: 'GT' };
if (params.get('line') === '1') settings.racingLine = true;
// LED screen on the start gantry (gantryScreen.js draws it, this puts it on the mesh)
const loadImage = src => { const i = new Image(); i.src = src; return i; };
const trackPath = [];
for (let i = 0; i < track.N; i += 12) trackPath.push([track.x[i], track.z[i]]);
const gantryScreen = createGantryScreen({
  logos: { powermedia: loadImage(powermediaLogo), deltadash: loadImage(deltadashLogo) },
  trackPath,
  facts: { km: track.length / 1000, turns: track.corners.length, drs: track.drs.length },
});
const gantryTex = new THREE.CanvasTexture(gantryScreen.canvas);
gantryTex.colorSpace = THREE.SRGBColorSpace;
gantryTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
trackScene.userData.gantryScreenMaterial.map = gantryTex;
trackScene.userData.gantryScreenMaterial.color.set(0xffffff);
trackScene.userData.gantryScreenMaterial.needsUpdate = true;
let gantryDrawn = -1;
const lapsShown = new WeakSet();   // the hud empties timer.events on its own schedule, so remember which laps the screen has had
const markers = debugMarkers(track);
markers.visible = false;
scene.add(markers);
const rig = new CameraRig(innerWidth / innerHeight);
rig.groundAt = (x, z) => track.groundAt(x, z);   // the chase camera keeps clear of the ground and aims at the road ahead
let topDown = params.has('topdown');
applyLook();
const playerId = localPlayerId(), myLivery = () => ownLivery(settings.livery, playerId);   // the paint the room sees (src/livery.js)
let view = new CarView(car.cfg, myLivery());   // replaced when the class changes (applyCarClass)
view.setFlat(settings.blockout);
scene.add(view.root);
env.attachCar(view);

// ?view=x,y,z,tx,ty,tz pins the camera (for screenshots); ?viewat=s,d,height,lookahead places it by track position
let fixedView = params.has('view') ? params.get('view').split(',').map(Number) : null;
if (params.has('viewat')) {
  const [s, d, hgt, ahead] = params.get('viewat').split(',').map(Number);
  const i = Math.round(((s % track.length) + track.length) % track.length) % track.N, j = (i + Math.round(ahead)) % track.N;
  fixedView = [track.x[i] + track.nx[i] * d, track.h[i] + hgt, track.z[i] + track.nz[i] * d, track.x[j], track.h[j], track.z[j]];
}
const input = createInput(settings, { boardAllowed: () => !dir.menuOpen && !reportTool.opened });   // Tab is the times board, except while a panel needs it for moving between buttons

// free look with the mouse: hold a button and drag on the view (only the right button with cursor steering, where the mouse steers).
// Touch screens steer with the left half and pedal with the right, so there is no free look by touch.
{
  let dragId = null, lastX = 0, lastY = 0;
  const lookButton = e => (settings.steering === 'cursor' ? e.button === 2 : e.button === 0 || e.button === 2);
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || settings.freeLook === false || dir.menuOpen || reportTool.opened || !lookButton(e)) return;
    dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; rig.dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== dragId) return;
    rig.drag(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY;
  });
  const end = e => { if (e.pointerId === dragId) { dragId = null; rig.dragging = false; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', e => { if (settings.freeLook !== false) e.preventDefault(); });   // right-drag must not open the browser menu
}
const audio = new CarAudio(settings, { muted: params.has('mute') });   // synthesised sound, starts at the first key press or touch
audio.attach(window, document);
const hud = new Hud(document.getElementById('hud'), settings);
const learnChip = createLearnChip(document.getElementById('hud'), learn, { settings, autopilotOn: () => !!autopilot });
hud.personalOf = reverse => personalSectors(loadBest(undefined, bestKey(reverse, car.cfg.id)));   // each car class has its own list (src/board.js)
const lobby = createLobby({ scene, camera: rig.camera, car, timer, track, search: location.search, getLivery: myLivery, poseTime: () => poseAt });   // multiplayer: idle until a room is opened
hud.pingOf = () => lobby.rtt;     // the relay round trip for the HUD readout (null when not online)
// global times (src/globalTimes.js): valid, clean laps go to the relay's boards; the relay's address comes from multiplayer.json
const BUILD = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : '';
const NAME_KEY = 'lakeside-mp-name';   // the name the lobby keeps (src/lobby.js); the name on the car's livery wins, like online
const driverName = () => {
  const painted = myLivery() && myLivery().name;
  if (painted && painted.trim()) return painted.trim();
  let n = null; try { n = localStorage.getItem(NAME_KEY); } catch { n = null; }
  if (!n || !n.trim()) { n = 'Driver' + (100 + Math.floor(Math.random() * 900)); try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } }
  return n.trim();
};
let timesUrl = '';
let storageRef = null; try { storageRef = localStorage; } catch { storageRef = null; }
const globalTimes = createGlobalTimes({
  storage: storageRef, getBase: () => timesUrl,
  onResult: (post, ans) => { if (ans && ans.improved) hud.flash(`Global P${ans.rank} \u00b7 ${boardLabel(post.board)}`, simTime, 'pb'); },
});
const timesReady = loadConfig({ fetchFn: (...a) => fetch(...a), search: location.search, build: BUILD }).then(cfg => { timesUrl = timesBase(cfg && cfg.relayUrl); globalTimes.flush(); }).catch(() => {});
setInterval(() => globalTimes.flush(), 30000);
const lapWatch = new LapWatch({
  timer, build: BUILD, getName: driverName, isAutopilot: () => !!autopilot,
  getConditions: () => ({ weather: (urlEnv || dir.api.environment()).weather, online: !!lobby.active, reverse: timer.reverse, car: car.cfg.id, assists: { tc: car.assistTc, abs: car.assistAbs, esc: car.assistEsc } }),
});
const boardGhost = createBoardGhost({ scene, tagRoot: document.getElementById('mp-tags') || document.getElementById('hud'), track });
let ghostProject = null, ghostSize = null;
const miniMap = createMiniMap(document.getElementById('hud'), { track, car, lobby, settings, ownColour: () => myLivery().body, timer });
const board = createBoard(document.getElementById('board'), { timer, lobby, car: () => car.cfg.id });
const steerBar = document.getElementById('steer-bar'), steerMark = steerBar.firstElementChild;
const IDLE = { steer: 0, throttle: 0, brake: 0.3, drs: false };
const history = { inputs: [], telemetry: [] };
let restoreTopDown = false;
const reportTool = new ReportTool({
  canvas, renderer, camera: rig.camera, scene, world, terrain, car, track, input, settings, history,
  onClose: () => { optimised.set(true); topDown = restoreTopDown; applyLook(); if (dir.phase === 'paused') dir.menu.open('pause', 'pause'); },   // a report started from the pause menu goes back to it
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  rig.camera.aspect = innerWidth / innerHeight;
  rig.camera.updateProjectionMatrix();
}
let quality = null, lastDpr = devicePixelRatio;
addEventListener('resize', () => { resize(); if (quality && devicePixelRatio !== lastDpr) { lastDpr = devicePixelRatio; quality.refresh(); } });
// the sun shadow, the pixel ratio and Auto's render scale follow settings.quality (src/quality.js)
quality = createQuality({ renderer, sun, settings, phone, onResize: resize, ready: tier => { limitAnisotropy(scene, tier.aniso); props.update(rig.camera, tier.propDist); marshalProps.update(rig.camera, tier.propDist); } });

// --- menu, sessions and the start sequence (src/director.js) ---
function openReport() {
  restoreTopDown = topDown;
  renderer.render(scene, rig.camera);
  const shot = canvas.toDataURL('image/png');
  const pose = { position: rig.camera.position.toArray(), quaternion: rig.camera.quaternion.toArray(), fov: rig.camera.fov };
  optimised.set(false);   // the report picks and measures the real objects, not the merged pieces
  topDown = true; applyLook(); reportTool.open(shot, pose);
}
const save = () => saveSettings(settings);

// --- the car class (settings.car, src/cars.js), picked in the garage. The physics car stays the same object (its config changes,
// see Car.setConfig), so the lobby, the mini map and the report keep their reference. The view is made again. It changes when the
// car is stopped (under 1 m/s), so a change never happens in the middle of a corner.
let pendingCar = null;
function setCarClass(id) {
  settings.car = id; save();
  pendingCar = id;
  applyCarClass();
}
function applyCarClass() {
  if (pendingCar === null) return;
  if (pendingCar === car.cfg.id) { pendingCar = null; return; }
  if (car.speed > 1) return;   // moving: wait until it stops
  const cfg = carById(pendingCar);
  pendingCar = null;
  car.setConfig(cfg);
  scene.remove(view.root); view.dispose();
  view = new CarView(cfg, myLivery());
  view.setFlat(settings.blockout);
  scene.add(view.root);
  env.attachCar(view);
  if (autopilot) autopilot = newAutopilot();
  if (window.lakeside) window.lakeside.view = view;
}

// the player's own assists back (settings, or all off in a race that sets that); never written by the autopilot
function releaseAssists() {
  if (!assistsTaken) return;
  assistsTaken = false;
  dir.api.applyAssists();
}

const dir = createDirector({
  gantryScreen,
  car, timer, track, lobby, settings, params, rig, hud, history, save, openReport,
  get view() { return view; },   // read each time: the class can change the view (applyCarClass)
  setCar: id => setCarClass(id),
  simTime: () => simTime,
  applyLook: () => { applyLook(); view.setFlat(settings.blockout); },
  getTopDown: () => topDown, setTopDown: v => { topDown = v; applyLook(); },
  qualityChanged: () => quality.refresh(),
  getAutopilot: () => !!autopilot, setAutopilot: v => { autopilot = v ? newAutopilot() : null; if (!v) releaseAssists(); },
  autopilotStyleChanged: () => { if (autopilot) autopilot = newAutopilot(); },
  learn,
  liveryChanged: () => { view.setLivery(myLivery()); lobby.liveryChanged(); },
  globalTimes: {
    client: () => globalTimes,
    ready: () => timesReady,   // resolves once multiplayer.json has said where the relay is (or that there is none)
    name: driverName,
    setName: v => { try { localStorage.setItem(NAME_KEY, v); } catch { /* private mode */ } },
    currentBoard: () => boardFor({ weather: (urlEnv || dir.api.environment()).weather, online: !!lobby.active, reverse: timer.reverse, car: car.cfg.id, assists: { tc: car.assistTc, abs: car.assistAbs, esc: car.assistEsc } }),
    loadGhost: entry => boardGhost.load(entry),
    clearGhost: () => boardGhost.clear(),
    ghostInfo: () => boardGhost.info,
  },
});

// --- loop ---
const loop = new FixedStep(STEP);
const stats = new FrameStats();
let simTime = 0, last = performance.now(), hudDue = Infinity, audioDue = 0, frameNo = 0;
let poseAt = performance.now();   // the clock time the car's pose is for: the last physics step, less the time not yet simulated (sent by src/lobby.js)
document.addEventListener('visibilitychange', () => { last = performance.now(); });   // no frame time spans the time the tab was hidden

function frame(now) {
  const raw = (now - last) / 1000;     // the first frame can carry a time stamp from before `last`, then this is negative and counts as 0
  last = now;
  const dt = frameTime(raw);
  if (raw < 0.25 && stats.push(raw) && settings.hud.fps) hud.perf = perfText();   // a longer one is a pause, not a slow frame
  if (raw < 0.25) quality.frame(raw * 1000);
  frameNo++;

  const actions = input.takeActions();
  const menuToggled = dir.menuToggledSinceLastFrame();   // Esc that just closed the menu is also in the list: ignore it
  for (const a of actions) {
    if (reportTool.opened && a !== 'report') continue;      // the report screen owns the keyboard while it is open
    if (a === 'settings') { if (!menuToggled) dir.escape(); continue; }
    if (dir.menuOpen) continue;                              // the menu has the keyboard
    if (a === 'reset' && dir.phase !== 'start') { car.resetToTrack(); car.contactGrace = 1.5; timer.markJump(); }   // a reset is a jump: the lap is not clean
    if (a === 'camera') rig.next();
    if (a === 'board-on') { board.show(); if (settings.debug) lobby.logPing(); }     // hold Tab; with the handling readout on, the round trip stats go to the console
    if (a === 'board-off') board.hide();
    if (a === 'board') board.toggle();      // the Times button on a touch screen
    if (a === 'line') {
      // a reverse practice or a race does not allow the line (src/session.js): say so instead of flashing a state that is not shown
      if (!dir.api.racingLineAllowed()) hud.flash('Racing line not available in this session', simTime, 'warn force');
      else { settings.racingLine = !settings.racingLine; saveSettings(settings); hud.flash(settings.racingLine ? 'Racing line on' : 'Racing line off', simTime); }
    }
    if (a === 'map') { settings.trackMap.on = !settings.trackMap.on; saveSettings(settings); hud.flash(settings.trackMap.on ? 'Track map on' : 'Track map off', simTime, 'info force'); }
    if (a === 'hud') { const name = cyclePreset(settings); saveSettings(settings); hud.flash('HUD ' + PRESET_NAMES[name].toLowerCase(), simTime, 'info force'); }
    if (a === 'fps') { settings.hud.fps = !settings.hud.fps; saveSettings(settings); hud.flash(settings.hud.fps ? 'FPS readout on' : 'FPS readout off', simTime, 'info force'); }
    if (a === 'debug') { settings.debug = !settings.debug; saveSettings(settings); }
    if (a === 'report' && !reportTool.opened && dir.phase !== 'menu') openReport();
  }
  if (dir.menuOpen) board.hide();

  applyCarClass();   // a class chosen in the garage takes effect once the car is stopped
  const playerInput = input.read(dt, car.speed);
  dir.frame(now, dt, playerInput);
  const paused = dir.inMenu || (dir.menuOpen && !lobby.active) || reportTool.opened;     // in a room the car keeps rolling behind the menu
  // the autopilot only drives the forward line (src/autopilot.js): it is off in a reverse session
  if (autopilot && dir.session && dir.session.reverse) { autopilot = null; releaseAssists(); }
  if (autopilot) {
    // learning: a better genome is picked up just after the line; a race that sets its own assists keeps them
    if (learnVersion >= 0 && learn.version !== learnVersion && car.loc.s < 120) autopilot = newAutopilot();
    autopilot.planOn = !(dir.session && dir.session.assists === 'off');
    Object.assign(autopilot.baseAssists, playerAssists());
  }
  learn.allow(!reportTool.opened && (dir.menuOpen || dir.phase === 'run' || dir.phase === 'start' || dir.phase === 'paused'));
  learnChip.draw();
  const drive = autopilot && !dir.hold ? () => autopilot.drive(car) : () => (dir.hold ? HOLD : dir.menuOpen ? IDLE : playerInput);
  if (autopilot && autopilot.assistPlan && (paused || dir.hold)) releaseAssists();
  if (!paused) {
    loop.add(dt);
    let keysNow = null, stepped = false;
    while (loop.due()) {
      stepped = true;
      if (lobby.active) {
        const solids = lobby.solids(now - loop.acc * 1000);   // the other players where they are drawn now, the same poses the collisions use
        car.collideCars(solids);
        // slipstream: only live cars count (never the ghost lap), and only when the session allows it (not in a time trial)
        const w = wakeFor(car, solids, { enabled: dir.api.slipstreamOn(), length: car.cfg.length });
        car.setWake(w.strength, w.distance);
      }
      if (autopilot && autopilot.assistPlan && autopilot.planOn && !dir.hold) assistsTaken = true;
      car.step(drive());
      audio.latch(car);
      simTime += STEP;
      if (autopilot) timer.noteAutopilot();
      timer.update(car.loc.s, simTime);
      timer.checkLimits(car, simTime);
      const post = lapWatch.step(simTime, car);
      if (post) globalTimes.submit(post);
      keysNow = keysNow || input.pressedKeys();
      history.inputs.push({ t: simTime, device: input.device, keys: keysNow, steer: playerInput.steer, throttle: playerInput.throttle, brake: playerInput.brake, drs: playerInput.drs });
      history.telemetry.push({ t: simTime, x: car.x, y: car.y, z: car.z, s: car.loc.s, d: car.loc.d, speed: car.speed });
      while (history.inputs.length && history.inputs[0].t < simTime - 10) history.inputs.shift();
      while (history.telemetry.length && history.telemetry[0].t < simTime - 10) history.telemetry.shift();
    }
    if (stepped) poseAt = now - loop.acc * 1000;
  }

  env.set(urlEnv || dir.api.environment());
  view.update(car, loop.alpha);
  if (reportTool.opened) reportTool.update();
  else if (topDown && fixedView) {
    // ?viewat with ?topdown: looking straight down at that track position, the lookahead point up the screen
    const [x, y, z, tx, , tz] = fixedView, l = Math.hypot(tx - x, tz - z) || 1;
    rig.camera.position.set(x, y, z);
    rig.camera.up.set((tx - x) / l, 0, (tz - z) / l);
    rig.camera.lookAt(x, y - 1, z);
  } else if (topDown) {
    // top-down debug view: high above the car, track direction up the screen
    const p = view.root.position, hd = -view.root.rotation.y;
    rig.camera.position.set(p.x, p.y + 260, p.z);
    rig.camera.up.set(Math.cos(hd), 0, Math.sin(hd));
    rig.camera.lookAt(p.x, p.y, p.z);
  } else if (fixedView) { rig.camera.position.set(fixedView[0], fixedView[1], fixedView[2]); rig.camera.lookAt(fixedView[3], fixedView[4], fixedView[5]); }
  else {
    // free look (Settings > Graphics): the right stick here, mouse drags in the listeners below
    if (settings.freeLook !== false && !dir.menuOpen) rig.setStick(playerInput.look[0], playerInput.look[1]); else rig.setStick(0, 0);
    rig.camera.up.set(0, 1, 0); rig.update(view, car, dt);
  }

  // keep the shadow map centred on the car, on whole shadow map pixels so the edges do not shimmer
  snapShadowCentre(view.root.position, SUN_DIR, sun.shadow.mapSize.x, 80, shadowAt);
  sun.target.position.set(shadowAt.x, shadowAt.y, shadowAt.z);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 150);
  renderer.shadowMap.needsUpdate = quality.shadowDue(now);
  if (frameNo % 8 === 0) { const lim = reportTool.opened ? Infinity : quality.tier.propDist; props.update(rig.camera, lim); marshalProps.update(rig.camera, lim); }

  env.update(dt, rig.camera, { speed: car.speed, lightning: settings.lightning });
  audioDue += dt;
  if (audioDue >= 1 / 62) { audio.update(car, audioDue, paused); audioDue = 0; }   // the sound parameters need no more than 60 updates a second
  lobby.update(now);
  // gantry screen: lap board on crossing the line, redrawn 30 times a second while it is close enough to read
  for (const ev of timer.events) {
    if (ev.type !== 'lap' || lapsShown.has(ev)) continue;
    lapsShown.add(ev);
    const raceLaps = dir.session && isRace(dir.session) ? dir.session.laps : null;   // a race shows "LAP 2 / 5"
    gantryScreen.lap({ lap: timer.lap, of: raceLaps, time: ev.time, kind: ev.best ? 'pb' : null, delta: ev.best || timer.best == null ? null : ev.time - timer.best });
  }
  if (now - gantryDrawn > 33 && rig.camera.position.distanceTo(trackScene.userData.gantryPosition) < 900) {
    gantryScreen.draw(now / 1000);
    gantryTex.needsUpdate = true;
    gantryDrawn = now;
  }
  hudDue += dt;
  if (hudDue >= 1 / quality.tier.hudHz - 0.002) {
    hud.update(car, timer, track, simTime, playerInput);
    marshalWatch.update(car, simTime, timer.reverse);
    miniMap.update();
    hudDue = 0;
  }
  dir.after(now, simTime);
  marshal.update(now / 1000);
  racingLine.setVisible(settings.racingLine && dir.api.racingLineAllowed());   // a race can forbid it
  racingLine.update(car.loc.s);
  if (boardGhost.active) {
    if (!ghostProject || ghostSize !== innerWidth + 'x' + innerHeight) { ghostSize = innerWidth + 'x' + innerHeight; ghostProject = makeProjector(rig.camera, innerWidth, innerHeight); }
    boardGhost.update(timer.lapStart === null ? null : simTime - timer.lapStart, dt, ghostProject);
  }
  board.update(simTime, now);
  const cursorOn = settings.steering === 'cursor';
  steerBar.hidden = !(cursorOn && hudOn(settings, 'steerBar'));
  if (cursorOn) steerMark.style.left = `${(50 + playerInput.steer * 44).toFixed(1)}%`;
  selfFx.x = view.root.position.x; selfFx.y = view.root.position.y; selfFx.z = view.root.position.z; selfFx.h = -view.root.rotation.y; selfFx.brk = car.brake; selfFx.len = car.cfg.length; selfFx.v = Math.max(0, car.fwdSpeed); selfFx.cls = car.cfg.id;
  rig.extraFov = slipFx.update(paused || topDown ? 0 : car.wake, dt, now);
  carFx.update(dt, rig.camera, lobby.ghosts.fx, selfFx, env.resolved, topDown);
  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// for quick checks from the browser console
window.lakeside = { THREE, optimised, rig, quality, stats, loop, car, track, timer, settings, racingLine, reportTool, lobby, board, input, view, scene, dir, renderer, env, carFx, gantryScreen, marshal, globalTimes, boardGhost, simTime: () => simTime };

const shadowAt = { x: 0, y: 0, z: 0 };
// the FPS readout: frame rate and time, the slowest frame, the render scale and what the last frame cost
function perfText() {
  const i = renderer.info.render;
  return stats.text(`${Math.round(quality.ratio * 100) / 100}x ${QUALITY_LABELS[quality.setting]}${quality.setting === 'auto' ? ' ' + quality.tierName : ''}  ${i.calls} calls  ${Math.round(i.triangles / 1000)}k tris`);
}

// Caps texture anisotropy at what the graphics tier allows; a texture built with less keeps it. Only changes (and re-uploads) what differs.
function limitAnisotropy(root, cap) {
  const max = renderer.capabilities.getMaxAnisotropy(), seen = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || !m.map || seen.has(m.map)) continue;
      const t = m.map; seen.add(t);
      t.userData.baseAniso ??= t.anisotropy;
      const want = Math.min(t.userData.baseAniso, cap, max);
      if (t.anisotropy !== want) { t.anisotropy = want; t.needsUpdate = true; }
    }
  });
}

function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + top.getHexString());
  g.addColorStop(1, '#' + bottom.getHexString());
  x.fillStyle = g;
  x.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Blockout view: every textured material swapped for a flat colour (the
// average of its texture), sponsor graphics and fence mesh included. Shows
// the shapes and layout without the dressing.
function setBlockout(root, on) {
  const cache = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    o.userData.fullMaterial ||= o.material;
    if (!on) { o.material = o.userData.fullMaterial; return; }
    const m = o.userData.fullMaterial;
    if (!cache.has(m)) {
      const sponsor = m.map && m.map.image && m.map.image.height === 1024;   // the sponsor sheet
      const col = sponsor ? new THREE.Color(0x9a9a96) : m.map ? averageColour(m.map) : m.color.clone();
      if (m.vertexColors) col.set(0x5a7f42);
      cache.set(m, new THREE.MeshLambertMaterial({
        color: m.map && m.color ? col.multiply(m.color) : col,
        side: m.side, transparent: m.transparent, opacity: m.transparent ? 0.35 : 1, depthWrite: !m.transparent,
      }));
    }
    o.material = cache.get(m);
  });
}

function averageColour(texture) {
  const img = texture.image, c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d');
  try { x.drawImage(img, 0, 0, 1, 1); } catch (e) { return new THREE.Color(0x888888); }
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

// Full, Blockout and the top-down debug colours share one switch.
function applyLook() {
  markers.visible = topDown;
  env.setTopDown(topDown);
  // the race view only looks 2.6 km and starts at 0.5 m: that keeps the depth buffer fine enough that
  // nothing a few millimetres apart flickers
  { rig.camera.near = topDown ? 1 : 0.5; rig.camera.far = topDown ? 6000 : 2600; rig.camera.updateProjectionMatrix(); }
  setDebugColours(world, topDown);
  if (!topDown) setBlockout(world, settings.blockout);
}

// Top-down debug view: every surface and barrier type in its own flat colour
// (the same colours as `npm run trackmap`).
function setDebugColours(root, on) {
  const cache = {};
  root.traverse(o => {
    if (!o.isMesh) return;
    o.userData.fullMaterial ||= o.material;
    if (!on) { o.material = o.userData.fullMaterial; return; }
    let cat = o.userData.debug, p = o.parent;
    while (!cat && p) { cat = p.userData.debug; p = p.parent; }
    const colour = DEBUG_COLOURS[cat] ?? (o.userData.fullMaterial.vertexColors ? 0x2c4a26 : 0x777777);
    cache[colour] ||= new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide, transparent: cat === 'fence', opacity: cat === 'fence' ? 0.6 : 1 });
    o.material = cache[colour];
  });
}

// Tall coloured posts over every board and sign, and over each barrier
// section's centre, so they are easy to spot from above.
function debugMarkers(T) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(1.2, 1.2, 30, 8);
  geo.translate(0, 15, 0);
  for (const f of T.furniture) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: DEBUG_COLOURS[f.type] }));
    m.position.set(f.x, f.y, f.z);
    g.add(m);
  }
  const small = new THREE.CylinderGeometry(0.8, 0.8, 12, 6);
  small.translate(0, 6, 0);
  for (const b of T.barriers) if (b.impact) {
    const k = Math.floor(b.pts.length / 2), [x, y, z] = b.pts[k];
    const m = new THREE.Mesh(small, new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    m.position.set(x, y, z);
    g.add(m);
  }
  return g;
}
