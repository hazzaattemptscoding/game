// Lakeside, phase 1: drive feel on the test track.
//
// Physics runs at a fixed 120 steps per second, separate from the frame
// rate. Rendering blends between the last two physics steps so motion stays
// smooth on any screen.

import * as THREE from 'three';
import { buildTrack } from './track.js';
import { Car, STEP } from './physics.js';
import { GT } from './cars.js';
import { LapTimer } from './timing.js';
import { Autopilot } from './autopilot.js';
import { buildTrackScene } from './trackMesh.js';
import { createGround, buildScenery } from './scenery.js';
import { CarView } from './car.js';
import { CameraRig } from './cameras.js';
import { createInput } from './input.js';
import { Hud } from './hud.js';
import { loadSettings, saveSettings } from './settings.js';

const params = new URLSearchParams(location.search);
const settings = loadSettings();

// --- world ---
const track = buildTrack();
const car = new Car(GT, track);
car.assists = settings.assists;
car.placeAt(params.has('at') ? +params.get('at') : -20, 0);  // ?at=1500 starts the car 1500 m into the lap
const timer = new LapTimer(track);
let autopilot = params.has('autopilot') ? new Autopilot(track, GT, { skill: 0.9 }) : null;

// --- rendering ---
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const skyTop = new THREE.Color(0x6fa3d6), skyBottom = new THREE.Color(0xd9e6ee);
scene.background = skyTexture(skyTop, skyBottom);
scene.fog = new THREE.Fog(0xcfdde6, 300, 2600);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();

const ground = createGround(track);
const world = new THREE.Group();
world.add(ground.mesh(), buildTrackScene(track, ground), buildScenery(track, ground));
scene.add(world);
setBlockout(world, settings.blockout);
const view = new CarView(GT, 0xffd21f);
scene.add(view.root);

const rig = new CameraRig(innerWidth / innerHeight);
// ?view=x,y,z,tx,ty,tz pins the camera (for screenshots); ?viewat=s,d,height,lookahead places it by track position
let fixedView = params.has('view') ? params.get('view').split(',').map(Number) : null;
if (params.has('viewat')) {
  const [s, d, hgt, ahead] = params.get('viewat').split(',').map(Number);
  const i = Math.round(((s % track.length) + track.length) % track.length) % track.N, j = (i + Math.round(ahead)) % track.N;
  fixedView = [track.x[i] + track.nx[i] * d, track.h[i] + hgt, track.z[i] + track.nz[i] * d, track.x[j], track.h[j], track.z[j]];
}
const input = createInput();
const hud = new Hud(document.getElementById('hud'), settings);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  rig.camera.aspect = innerWidth / innerHeight;
  rig.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- settings panel ---
const panel = document.getElementById('settings');
function syncPanel() {
  panel.querySelectorAll('[data-units]').forEach(b => b.classList.toggle('sel', b.dataset.units === settings.units));
  panel.querySelectorAll('[data-assists]').forEach(b => b.classList.toggle('sel', String(settings.assists) === b.dataset.assists));
  panel.querySelectorAll('[data-debug]').forEach(b => b.classList.toggle('sel', String(settings.debug) === b.dataset.debug));
  panel.querySelectorAll('[data-blockout]').forEach(b => b.classList.toggle('sel', String(!!settings.blockout) === b.dataset.blockout));
  panel.querySelectorAll('[data-auto]').forEach(b => b.classList.toggle('sel', String(!!autopilot) === b.dataset.auto));
}
panel.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.units) settings.units = b.dataset.units;
  if (b.dataset.assists) { settings.assists = b.dataset.assists === 'true'; car.assists = settings.assists; }
  if (b.dataset.debug) settings.debug = b.dataset.debug === 'true';
  if (b.dataset.blockout) { settings.blockout = b.dataset.blockout === 'true'; setBlockout(world, settings.blockout); }
  if (b.dataset.auto) autopilot = b.dataset.auto === 'true' ? new Autopilot(track, GT, { skill: 0.9 }) : null;
  if (b.id === 'close') togglePanel(false);
  saveSettings(settings);
  syncPanel();
});
function togglePanel(open = panel.hidden) { panel.hidden = !open; syncPanel(); }
syncPanel();

// --- loop ---
let simTime = 0, acc = 0, last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  for (const a of input.takeActions()) {
    if (a === 'reset') car.resetToTrack();
    if (a === 'camera') rig.next();
    if (a === 'settings') togglePanel();
    if (a === 'debug') { settings.debug = !settings.debug; saveSettings(settings); syncPanel(); }
  }

  const paused = !panel.hidden;
  const playerInput = input.read(dt);
  if (!paused) {
    acc += dt;
    while (acc >= STEP) {
      car.step(autopilot ? autopilot.drive(car) : playerInput);
      simTime += STEP;
      timer.update(car.loc.s, simTime);
      acc -= STEP;
    }
  }

  view.update(car, acc / STEP);
  if (fixedView) { rig.camera.position.set(fixedView[0], fixedView[1], fixedView[2]); rig.camera.lookAt(fixedView[3], fixedView[4], fixedView[5]); }
  else rig.update(view, car, dt);

  // keep the shadow map centred on the car
  const p = view.root.position;
  sun.target.position.copy(p);
  sun.position.copy(p).addScaledVector(SUN_DIR, 150);

  hud.update(car, timer, track, simTime);
  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for quick checks from the browser console
window.lakeside = { car, track, timer, settings };

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
