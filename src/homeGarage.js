// The garage behind the main menu: a modern pit garage with your car in it (your class and your livery), drawn as a small scene of
// its own while the main menu is open instead of the circuit. Light grey epoxy floor with the bay marked in yellow, white wall panels
// with a band in your car's colour, the PowerMedia board on the back wall, strip lights, tool chests, tyre stacks, a workbench and a
// timing screen, and the roller door open onto a bright pit lane. The camera drifts slowly round the front of the car.
//
//   const g = createHomeGarage({ renderer, logo });     // logo: an Image (the PowerMedia logo); built on first use
//   g.frame(dt, cfg, livery, aspect, menuWidth)        // each frame the main menu is open; returns { scene, camera }
//   g.shadowDue()                                      // true when the garage's shadow map wants a refresh
//
// Walls face inwards and are single sided, so the walls between the camera and the car are not drawn (the camera can stand back
// further than the room is wide). About 30 draw calls with the car; nothing in it moves but the camera.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CarView } from './car.js';
import { normaliseLivery, liveryEquals } from './livery.js';

const ROOM = { x0: -8, x1: 8.5, z: 5.4, h: 4.8 };   // the back wall at x0, the door at x1, the side walls at +-z, the ceiling height

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 8;
  return t;
}

// a seeded random, so the speckle is the same every time
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function textures() {
  const r = rng(11);
  const floor = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#b8bbbe'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 150 + r() * 70 | 0; x.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; x.fillRect(r() * w, r() * h, 1.4, 1.4); }
    for (let i = 0; i < 4; i++) { x.fillStyle = `rgba(60,60,64,${0.015 + r() * 0.02})`; x.beginPath(); x.ellipse(r() * w, r() * h, 20 + r() * 50, 8 + r() * 20, r() * 3, 0, 7); x.fill(); }   // faint tyre scuffs
  }, { repeat: [4, 3] });
  const panel = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#e9eaec'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, 0, 2, h); x.fillRect(0, 0, w, 2);   // the panel seams
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.05)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, { repeat: [6, 2] });
  const chest = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#c3141f'; x.fillRect(0, 0, w, h);
    const rows = [0.16, 0.28, 0.4, 0.52, 0.64, 0.8];
    for (let i = 0; i < rows.length - 1; i++) {
      const y0 = rows[i] * h, y1 = rows[i + 1] * h;
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, y0, w, 3);
      x.fillStyle = '#d7d9dc'; x.fillRect(w * 0.18, y0 + (y1 - y0) * 0.35, w * 0.64, Math.max(3, (y1 - y0) * 0.14));   // the handle
    }
    x.fillStyle = '#141518'; x.fillRect(0, 0, w, h * 0.12); x.fillRect(0, h * 0.88, w, h * 0.12);
  });
  const screen = canvasTex(512, 288, (x, w, h) => {
    x.fillStyle = '#05070a'; x.fillRect(0, 0, w, h);
    x.font = '700 22px "Barlow Condensed", Arial, sans-serif'; x.fillStyle = '#ffd21f'; x.fillText('LAKESIDE  TIMING', 20, 34);
    x.font = '600 18px "Barlow Condensed", Arial, sans-serif';
    const rows = [['P1', 'Car 7', '1:30.117'], ['P2', 'Car 23', '1:30.452'], ['P3', 'Car 78', '1:31.006'], ['P4', 'Car 11', '1:31.380'], ['P5', 'Car 4', '1:32.114']];
    rows.forEach((row, i) => {
      const y = 70 + i * 34;
      x.fillStyle = i % 2 ? '#0d1218' : '#111820'; x.fillRect(16, y - 22, w - 32, 30);
      x.fillStyle = i ? '#cfd6de' : '#b36bff'; x.fillText(row[0], 26, y); x.fillText(row[1], 86, y); x.fillText(row[2], w - 120, y);
    });
    x.strokeStyle = '#3ddc84'; x.lineWidth = 2; x.beginPath();
    for (let i = 0; i <= 40; i++) { const px = 20 + i * 11.8, py = 262 - 20 * Math.sin(i * 0.45) - 8 * Math.sin(i * 1.3); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
  });
  const outside = canvasTex(64, 256, (x, w, h) => {      // the pit lane in daylight through the door: bright, overexposed
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f4f7fb'); g.addColorStop(0.55, '#e6ecf2'); g.addColorStop(0.62, '#9aa1a8'); g.addColorStop(1, '#7c838a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  return { floor, panel, chest, screen, outside };
}

// a box geometry moved to a place (and turned about y)
const box = (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); return g.translate(x, y, z); };

function buildRoom(tex, logo) {
  const g = new THREE.Group();
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.32, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ map: tex.panel, roughness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.6 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 0.9 }),
    band: new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.5 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.55 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    chest: new THREE.MeshStandardMaterial({ map: tex.chest, roughness: 0.4, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.3, metalness: 0.7 }),
    screen: new THREE.MeshBasicMaterial({ map: tex.screen }),
    outside: new THREE.MeshBasicMaterial({ map: tex.outside }),
    logo: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
    board: new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.45 }),
  };
  const { x0, x1, z, h } = ROOM, len = x1 - x0;
  const add = (geo, mat, shadow = false) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = shadow; g.add(m); return m; };

  // the floor, the ceiling and the walls: planes facing into the room, so a wall between the camera and the car is not drawn
  const plane = (w, hh, x, y, zz, rx, ry) => { const p = new THREE.PlaneGeometry(w, hh); if (rx) p.rotateX(rx); if (ry) p.rotateY(ry); return p.translate(x, y, zz); };
  add(plane(len, 2 * z, (x0 + x1) / 2, 0, 0, -Math.PI / 2), M.floor);
  add(plane(len, 2 * z, (x0 + x1) / 2, h, 0, Math.PI / 2), M.ceiling);
  add(mergeGeometries([plane(2 * z, h, x0, h / 2, 0, 0, Math.PI / 2), plane(len, h, (x0 + x1) / 2, h / 2, -z), plane(len, h, (x0 + x1) / 2, h / 2, z, 0, Math.PI)]), M.wall);
  // a dark skirting and a band in the car's colour along the walls (the band's material follows the livery)
  add(mergeGeometries([box(0.04, 0.22, 2 * z, x0 + 0.02, 0.11, 0), box(len, 0.22, 0.04, (x0 + x1) / 2, 0.11, -z + 0.02), box(len, 0.22, 0.04, (x0 + x1) / 2, 0.11, z - 0.02)]), M.dark);
  const band = add(mergeGeometries([box(0.03, 0.34, 2 * z, x0 + 0.03, 2.35, 0), box(len, 0.34, 0.03, (x0 + x1) / 2, 2.35, -z + 0.03), box(len, 0.34, 0.03, (x0 + x1) / 2, 2.35, z - 0.03)]), M.band);
  // the door: the pit lane outside, the frame round the opening, the roller door rolled up under the lintel
  add(plane(2 * z - 0.6, h - 0.6, x1 + 0.6, (h - 0.6) / 2, 0, 0, -Math.PI / 2), M.outside);
  add(mergeGeometries([box(0.3, h, 0.3, x1, h / 2, -z + 0.15), box(0.3, h, 0.3, x1, h / 2, z - 0.15), box(0.3, 0.6, 2 * z, x1, h - 0.3, 0)]), M.dark);
  add(new THREE.CylinderGeometry(0.26, 0.26, 2 * z - 0.4, 20).rotateX(Math.PI / 2).translate(x1 - 0.25, h - 0.72, 0), M.steel);
  // the bay: yellow lines round the car, and a line across in front of the door
  const line = (w, d, x, zz) => box(w, 0.004, d, x, 0.002, zz);
  add(mergeGeometries([line(7.2, 0.08, -0.3, -1.9), line(7.2, 0.08, -0.3, 1.9), line(0.08, 3.8, -3.9, 0), line(0.12, 2 * z - 0.6, x1 - 0.7, 0)]), M.yellow);
  // strip lights in two rows along the ceiling
  const lamps = [];
  for (const zz of [-1.5, 1.5]) for (let xx = x0 + 1.5; xx < x1 - 0.8; xx += 2.6) lamps.push(box(1.6, 0.05, 0.16, xx, h - 0.04, zz));
  add(mergeGeometries(lamps), M.lamp);
  // along the wall the camera looks at (-z): tool chests under a PowerMedia banner, a workbench with the timing screen and a laptop,
  // tyres stacked by the door; a rack of wheels by the back wall
  const wz = -z;
  const chests = [];
  for (let k = 0; k < 4; k++) chests.push(box(1.1, 1.05, 0.6, x0 + 1.4 + k * 1.2, 0.525, wz + 0.35));
  add(mergeGeometries(chests), M.chest, true);
  if (logo) {
    add(box(4.6, 1.1, 0.06, x0 + 3.2, 3.15, wz + 0.04), M.board);
    const t = new THREE.Texture(logo); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    M.logo.map = t;
    const banner = add(new THREE.PlaneGeometry(1, 1), M.logo);
    banner.position.set(x0 + 3.2, 3.15, wz + 0.08);
    const fit = () => { t.needsUpdate = true; const asp = logo.naturalWidth / Math.max(1, logo.naturalHeight) || 4; const w = Math.min(4.1, 0.8 * asp); banner.scale.set(w, w / asp, 1); };
    if (logo.complete && logo.naturalWidth) fit(); else logo.addEventListener('load', fit, { once: true });
  }
  const bx = 1.2;
  add(mergeGeometries([box(2.6, 0.06, 0.75, bx, 0.95, wz + 0.45), ...[[-1.2, 0.2], [1.2, 0.2], [-1.2, 0.7], [1.2, 0.7]].map(([dx, dz]) => box(0.06, 0.92, 0.06, bx + dx, 0.46, wz + dz))]), M.steel, true);
  add(box(1.6, 0.9, 0.05, bx, 2.0, wz + 0.06), M.board);
  const scr = add(new THREE.PlaneGeometry(1.5, 0.84), M.screen);
  scr.position.set(bx, 2.0, wz + 0.09);
  add(mergeGeometries([box(0.4, 0.02, 0.28, bx + 0.6, 0.99, wz + 0.45), box(0.4, 0.26, 0.02, bx + 0.6, 1.12, wz + 0.32)]), M.board);
  const tyreGeo = [], rimGeo = [];
  for (const [sx, sz] of [[x1 - 2.2, wz + 0.6], [x1 - 3.0, wz + 0.6], [x1 - 2.6, wz + 1.3]]) {
    for (let k = 0; k < 4; k++) { tyreGeo.push(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 24).translate(sx, 0.15 + k * 0.31, sz)); rimGeo.push(new THREE.CylinderGeometry(0.22, 0.22, 0.31, 16).translate(sx, 0.15 + k * 0.31, sz)); }
  }
  for (let k = 0; k < 4; k++) {
    tyreGeo.push(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 24).rotateZ(Math.PI / 2).translate(x0 + 0.45, 0.36, -2.0 + k * 0.42));
    rimGeo.push(new THREE.CylinderGeometry(0.22, 0.22, 0.31, 16).rotateZ(Math.PI / 2).translate(x0 + 0.45, 0.36, -2.0 + k * 0.42));
  }
  add(mergeGeometries(tyreGeo), M.rubber, true);
  add(mergeGeometries(rimGeo), M.rim);
  // a fire extinguisher by the door
  add(mergeGeometries([new THREE.CylinderGeometry(0.09, 0.09, 0.55, 14).translate(x1 - 0.6, 0.3, wz + 0.3), new THREE.SphereGeometry(0.09, 12, 8).translate(x1 - 0.6, 0.58, wz + 0.3)]), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4 }), true);
  return { group: g, band: M.band, materials: M };
}

export function createHomeGarage({ renderer, logo }) {
  let built = null, car = null, carId = null, livery = null, env = null, shadowFrames = 0, t = 0;
  const camera = new THREE.PerspectiveCamera(36, 1.6, 0.1, 60);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1013);

  function build() {
    const tex = textures();
    built = buildRoom(tex, logo);
    scene.add(built.group);
    scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x4a4d52, 0.55));
    // the strip lights' light: one soft light from above that casts the car's shadow, and a spot on the car from the front
    const top = new THREE.DirectionalLight(0xffffff, 1.6);
    top.position.set(1.5, 8, 2.5); top.target.position.set(0, 0, 0);
    top.castShadow = true; top.shadow.mapSize.set(1024, 1024); top.shadow.radius = 6;
    Object.assign(top.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 14 });
    top.shadow.bias = -0.0005; top.shadow.normalBias = 0.02;
    scene.add(top, top.target);
    const key = new THREE.SpotLight(0xfff4e6, 60, 18, 0.55, 0.7, 1.6);
    key.position.set(4.5, 3.6, 1.8); key.target.position.set(0, 0.4, 0);
    scene.add(key, key.target);
    const daylight = new THREE.PointLight(0xe8f0ff, 20, 14, 1.6);   // the pit lane's daylight through the door
    daylight.position.set(ROOM.x1 + 0.5, 2.2, 0);
    scene.add(daylight);
    const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    env = pm.fromScene(room, 0.04);
    room.dispose(); pm.dispose();
    built.materials.floor.envMap = env.texture; built.materials.floor.envMapIntensity = 0.35;   // the epoxy shows a little of the room
  }

  // the car on show: rebuilt when the class changes, repainted when the livery does
  function setCar(cfg, l) {
    if (!car || carId !== cfg.id) {
      if (car) { scene.remove(car.root); car.dispose(); }
      car = new CarView(cfg, l, { studio: true });
      car.setEnvironment(env.texture);
      car.root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
      for (const w of car.wheels) if (w.front) w.steer.rotation.y = -0.28;   // the front wheels turned, a showroom pose
      car.root.position.set(-0.3, 0, 0);
      scene.add(car.root);
      carId = cfg.id; livery = null; shadowFrames = 3;
    }
    const n = normaliseLivery(l);
    if (!livery || !liveryEquals(livery, n)) { car.setLivery(n); livery = n; built.band.color.set(n.body); shadowFrames = Math.max(shadowFrames, 1); }
  }

  return {
    scene, camera,
    get built() { return !!built; },
    // menuWidth: the share of the screen the menu covers on the left; the car is framed in the rest
    frame(dt, cfg, l, aspect, menuShare = 0.2) {
      if (!built) build();
      setCar(cfg, l);
      t += Math.min(dt, 0.1);
      const len = cfg.length || 4.6, R = 4.6 + len * 1.0;
      const a = 0.68 + 0.36 * Math.sin(t * 0.09), hgt = 1.45 + 0.3 * Math.sin(t * 0.13 + 1);   // drifting round the front three-quarter
      const cx = car.root.position.x;
      camera.position.set(cx + Math.cos(a) * R, hgt, Math.sin(a) * R);
      // aim a little to the left of the car, so it sits in the middle of what the menu leaves visible
      const right = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), shift = R * Math.tan(camera.fov * Math.PI / 360) * aspect * menuShare;
      camera.lookAt(cx - right.x * shift, 0.45, -right.z * shift);
      if (Math.abs(camera.aspect - aspect) > 1e-3) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
      return { scene, camera };
    },
    shadowDue() { if (shadowFrames > 0) { shadowFrames--; return true; } return false; },
  };
}
