// The canvas textures a livery needs: the side panel (sponsor board, race number roundel, side flash) and the number plate
// for the bonnet. Cached by what they show, with a reference count, so eight cars with the same paint share one canvas and
// repainting a car every frame would cost nothing. No image files: everything is drawn, the sponsor boards are cut from
// the sponsor sheet in src/textures.js.

import * as THREE from 'three';
import { normaliseLivery } from './livery.js';
import { sponsorBoard } from './textures.js';

// Hooks so tools/livery.js can count canvases in node. In the browser the defaults are used.
export const deps = {
  canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  sponsorBoard,            // (id) -> { canvas, row } or null: the sponsor sheet from src/textures.js
};
export const stats = { canvases: 0 };

export const SIDE_W = 1152, SIDE_H = 256;       // side panel pixels: 1.8 m by 0.4 m on the car
export const PLATE = 256;

const cache = new Map();   // key -> { tex, refs }

function ref(key, make) {
  let e = cache.get(key);
  if (!e) { e = { tex: make(), refs: 0 }; cache.set(key, e); }
  e.refs++;
  return e.tex;
}
function unref(key) {
  const e = cache.get(key);
  if (!e || --e.refs > 0) return;
  cache.delete(key);
  if (e.tex.dispose) e.tex.dispose();
}

function newCanvas(w, h) {
  stats.canvases++;
  const c = deps.canvas(w, h);
  return [c, c.getContext('2d')];
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const FONT = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';

// A white roundel with the number in black, centred at (cx, cy) with radius r.
function roundel(x, cx, cy, r, number) {
  x.fillStyle = '#f6f4ec'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.lineWidth = r * 0.07; x.strokeStyle = '#111'; x.beginPath(); x.arc(cx, cy, r * 0.93, 0, Math.PI * 2); x.stroke();
  const s = String(number);
  let size = r * 1.35;
  x.font = `900 ${size}px ${FONT}`;
  const w = x.measureText ? x.measureText(s).width : size;
  if (w > r * 1.5) size *= r * 1.5 / w;
  x.font = `900 ${size}px ${FONT}`;
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(s, cx, cy + size * 0.04);
}

function drawSide(l) {
  const [c, x] = newCanvas(SIDE_W, SIDE_H);
  x.clearRect(0, 0, SIDE_W, SIDE_H);
  if (l.style === 3) {                     // side flash: a band rising towards the nose, with a thin edge line
    x.fillStyle = l.stripe;
    x.beginPath(); x.moveTo(0, SIDE_H); x.lineTo(0, 190); x.lineTo(SIDE_W, 20); x.lineTo(SIDE_W, 86); x.lineTo(500, SIDE_H); x.closePath(); x.fill();
    x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.moveTo(0, 190); x.lineTo(SIDE_W, 20); x.lineTo(SIDE_W, 30); x.lineTo(0, 202); x.closePath(); x.fill();
  }
  const board = l.sponsor && deps.sponsorBoard ? deps.sponsorBoard(l.sponsor) : null;
  if (board) {
    const bx = 36, by = 82, bw = 770, bh = 96;
    x.fillStyle = '#000'; x.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
    x.drawImage(board.canvas, 0, board.row * 128, 1024, 128, bx, by, bw, bh);
  }
  if (l.number >= 0) roundel(x, 980, 128, 112, l.number);
  return texture(c);
}

function drawPlate(number) {
  const [c, x] = newCanvas(PLATE, PLATE);
  x.clearRect(0, 0, PLATE, PLATE);
  roundel(x, PLATE / 2, PLATE / 2, PLATE / 2 - 6, number);
  return texture(c);
}

const sideKey = l => `${l.style === 3 ? l.stripe : ''}|${l.number}|${l.sponsor}`;

// The textures for a livery, or null where it needs none. Call releaseTextures() with the same livery when the car stops using them.
export function acquireTextures(livery) {
  const l = normaliseLivery(livery);
  const needSide = l.style === 3 || l.number >= 0 || l.sponsor !== '';
  return {
    side: needSide ? ref(sideKey(l), () => drawSide(l)) : null,
    plate: l.number >= 0 ? ref('p' + l.number, () => drawPlate(l.number)) : null,
  };
}

export function releaseTextures(livery) {
  const l = normaliseLivery(livery);
  if (l.style === 3 || l.number >= 0 || l.sponsor !== '') unref(sideKey(l));
  if (l.number >= 0) unref('p' + l.number);
}

export const cacheSize = () => cache.size;
