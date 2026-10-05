// The 3D world of the live page: the same track, ground and scenery the game builds, a sky, a sun that follows the action, and a camera.
// Nothing here knows about the network. The cars are added to `scene` by the Ghosts factory (src/ghosts.js threeFactory).

import * as THREE from 'three';
import { buildTrack } from '../track.js';
import { buildTrackScene } from '../trackMesh.js';
import { createGround, buildScenery } from '../scenery.js';

const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.42).normalize();

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

export function createLiveScene(canvas) {
  const track = buildTrack();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = skyTexture(new THREE.Color(0x6fa3d6), new THREE.Color(0xd9e6ee));
  scene.fog = new THREE.Fog(0xcfdde6, 300, 2600);
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a3a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const ground = createGround(track);
  const world = new THREE.Group();
  world.add(ground.mesh(), buildTrackScene(track, ground), buildScenery(track, ground));
  scene.add(world);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2600);
  const size = { w: 0, h: 0 };
  return {
    track, scene, renderer, camera, size,
    resize(w, h) {
      if (size.w === w && size.h === h) return;
      size.w = w; size.h = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    },
    // the shadow of the sun is cast around the point the viewer is looking at
    sunAt(x, y, z) { sun.target.position.set(x, y, z); sun.position.set(x, y, z).addScaledVector(SUN_DIR, 150); },
    render() { renderer.render(scene, camera); },
  };
}
