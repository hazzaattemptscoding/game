import * as THREE from 'three';

// The sponsor loop as a texture, or null where there is no browser video (the headless tools). There is one video element
// and one texture for the whole circuit (bridge, gantry, footbridges all share it), so the file loads once and mobile
// browsers see a single playing video. Each caller's onReady fires once a frame is available, or at once if it already is.
let shared = null;

// The one place the file name appears, so tools/artifact.mjs swaps in the embedded copy exactly once.
export const SPONSOR_LOOP = 'sponsors/powermedia-bridge-30x1-loop-1.mp4';

export function bannerVideo(onReady, url = SPONSOR_LOOP) {
  if (typeof document === 'undefined' || typeof document.createElement('video').play !== 'function') return null;
  if (!shared) {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.src = url.startsWith('data:') ? url : (import.meta.env?.BASE_URL ?? './') + url;   // tools/artifact.mjs swaps the path for a data: URL
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    shared = { tex, ready: false, waiting: [] };
    v.addEventListener('loadeddata', () => {
      v.play().then(() => { shared.ready = true; for (const f of shared.waiting.splice(0)) f(); }, () => {});
    });
    v.addEventListener('error', () => {});
  }
  if (onReady) { if (shared.ready) queueMicrotask(onReady); else shared.waiting.push(onReady); }
  return shared.tex;
}
