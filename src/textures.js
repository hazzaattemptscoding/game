// Canvas-generated textures: no image files needed.
// Every function returns a three.js CanvasTexture.

import * as THREE from 'three';

// A small seeded random so textures look the same every load.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = true, srgb = true, nearest = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) t.magFilter = THREE.NearestFilter;
  t.anisotropy = aniso;
  return t;
}

// Speckle a canvas with aggregate: lots of tiny light and dark stones.
function speckle(x, w, h, rand, count, colours, size = 1.6) {
  for (let i = 0; i < count; i++) {
    x.fillStyle = colours[(rand() * colours.length) | 0];
    const s = size * (0.5 + rand());
    x.fillRect(rand() * w, rand() * h, s, s);
  }
}

// Race tarmac: dark, fine aggregate, faint patches. Tiles every 8 m.
export function tarmacTexture(base = '#34363b', seed = 1) {
  const [c, x] = canvas(512, 512), r = rng(seed);
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14; i++) {
    x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.025 + r() * 0.03})`;
    x.beginPath(); x.ellipse(r() * 512, r() * 512, 40 + r() * 120, 20 + r() * 60, r() * 3, 0, 7); x.fill();
  }
  speckle(x, 512, 512, r, 26000, ['#2b2d31', '#44474c', '#4f5257', '#232528', '#5a5b5f']);
  return finish(c);
}

// Old runway concrete: pale slabs with joints, cracks, oil stains and weeds.
export function runwayTexture(seed = 7) {
  const [c, x] = canvas(512, 512), r = rng(seed);
  x.fillStyle = '#a9a69c'; x.fillRect(0, 0, 512, 512);
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    const v = 150 + r() * 30 | 0;
    x.fillStyle = `rgba(${v},${v - 4},${v - 14},0.5)`;
    x.fillRect(a * 256 + 2, b * 256 + 2, 252, 252);
  }
  speckle(x, 512, 512, r, 18000, ['#8f8c83', '#b8b5ab', '#9e9b91', '#7c7a73']);
  x.strokeStyle = 'rgba(40,38,34,.8)'; x.lineWidth = 3;
  x.strokeRect(0, 0, 256, 256); x.strokeRect(256, 0, 256, 256); x.strokeRect(0, 256, 256, 256); x.strokeRect(256, 256, 256, 256);
  // cracks
  x.lineWidth = 1.4;
  for (let i = 0; i < 26; i++) {
    let px = r() * 512, py = r() * 512;
    x.strokeStyle = `rgba(30,28,25,${0.4 + r() * 0.4})`;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 8; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  // weeds in the joints and cracks
  for (let i = 0; i < 900; i++) {
    const onJoint = r() < 0.7;
    const px = onJoint ? (r() < 0.5 ? (r() < 0.5 ? 0 : 256) + (r() - 0.5) * 8 : r() * 512) : r() * 512;
    const py = onJoint ? (px % 256 < 6 || px % 256 > 250 ? r() * 512 : (r() < 0.5 ? 0 : 256) + (r() - 0.5) * 8) : r() * 512;
    x.fillStyle = ['#5d7a35', '#6f8c3f', '#4b6a2c', '#7d9446'][(r() * 4) | 0];
    x.beginPath(); x.arc(px, py, 1 + r() * 3.5, 0, 7); x.fill();
  }
  for (let i = 0; i < 6; i++) {
    x.fillStyle = `rgba(20,20,20,${0.06 + r() * 0.08})`;
    x.beginPath(); x.ellipse(r() * 512, r() * 512, 10 + r() * 30, 6 + r() * 20, r() * 3, 0, 7); x.fill();
  }
  return finish(c);
}

// Mown grass with stripes running along the track. u = along, v = across.
export function grassTexture(seed = 3) {
  const [c, x] = canvas(256, 256), r = rng(seed);
  for (let i = 0; i < 4; i++) {
    x.fillStyle = i % 2 ? '#5c8a3e' : '#4f7d36';
    x.fillRect(i * 64, 0, 64, 256);
  }
  speckle(x, 256, 256, r, 9000, ['#46702f', '#6a9a48', '#3e6629', '#78a352'], 1.4);
  return finish(c);
}

// Gravel: rounded stones with raked lines across the trap.
export function gravelTexture(seed = 5) {
  const [c, x] = canvas(256, 256), r = rng(seed);
  x.fillStyle = '#d4b06c'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 10) {
    x.fillStyle = 'rgba(110,85,50,.3)'; x.fillRect(i, 0, 3, 256);
    x.fillStyle = 'rgba(255,245,215,.12)'; x.fillRect(i + 4, 0, 3, 256);
  }
  speckle(x, 256, 256, r, 14000, ['#b6a67c', '#d6c69c', '#a8986f', '#e0d3ad', '#9c8d68', '#8f8268'], 2.2);
  return finish(c);
}

// Red and white kerb, 2 m per repeat (1 m of each colour), with an edge shadow.
export function kerbTexture(a = '#c8102e', b = '#ededea') {
  const [c, x] = canvas(128, 32);
  x.fillStyle = a; x.fillRect(0, 0, 64, 32);
  x.fillStyle = b; x.fillRect(64, 0, 64, 32);
  const g = x.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 32);
  return finish(c, { nearest: false });
}

// Run-off tarmac: coarser and lighter than the track, no paint.
export function runoffTexture() {
  const [c, x] = canvas(256, 256), r = rng(11);
  x.fillStyle = '#5b5e63'; x.fillRect(0, 0, 256, 256);
  speckle(x, 256, 256, r, 12000, ['#4a4c50', '#6a6d72', '#737679', '#45474b'], 1.8);
  for (let i = 0; i < 5; i++) {
    x.fillStyle = 'rgba(20,20,22,.12)';
    x.fillRect(0, 40 + r() * 170, 256, 6 + r() * 10);   // scrub marks where cars ran wide
  }
  return finish(c);
}

// Armco: galvanised W-beam rail. v runs bottom to top of the rail.
export function armcoTexture() {
  const [c, x] = canvas(256, 64);
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#7e8488'); g.addColorStop(0.18, '#c8ccce'); g.addColorStop(0.35, '#8c9296');
  g.addColorStop(0.5, '#62686c'); g.addColorStop(0.65, '#8c9296'); g.addColorStop(0.82, '#c8ccce'); g.addColorStop(1, '#7e8488');
  x.fillStyle = g; x.fillRect(0, 0, 256, 64);
  x.fillStyle = 'rgba(60,40,20,.25)';
  for (let i = 0; i < 40; i++) x.fillRect(Math.random() * 256, Math.random() * 64, 2, 1);
  for (const px of [0, 128]) { x.fillStyle = '#4c5156'; x.fillRect(px, 0, 3, 64); x.beginPath(); x.arc(px + 12, 32, 3, 0, 7); x.fill(); }
  return finish(c);
}

// Catch fence: diamond mesh on a transparent background.
export function fenceTexture() {
  const [c, x] = canvas(128, 128);
  x.clearRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(32,35,38,0.95)'; x.lineWidth = 1.6;
  for (let i = -128; i < 256; i += 16) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 128, 128); x.stroke();
    x.beginPath(); x.moveTo(i + 128, 0); x.lineTo(i, 128); x.stroke();
  }
  return finish(c, { srgb: true });
}

// Concrete wall panels, 4 m each, with seams and a weathered base.
export function concreteTexture(seed = 13) {
  const [c, x] = canvas(256, 64), r = rng(seed);
  x.fillStyle = '#b9b7b0'; x.fillRect(0, 0, 256, 64);
  speckle(x, 256, 64, r, 3000, ['#a8a69f', '#c6c4bd', '#9d9b94'], 1.3);
  const g = x.createLinearGradient(0, 40, 0, 64);
  g.addColorStop(0, 'rgba(70,60,45,0)'); g.addColorStop(1, 'rgba(70,60,45,.45)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 64);
  x.fillStyle = 'rgba(60,60,60,.6)';
  x.fillRect(0, 0, 2, 64); x.fillRect(128, 0, 2, 64);
  return finish(c);
}

// Corrugated metal for hangars and Nissen huts, weathered.
export function corrugatedTexture(base = '#7b8078', seed = 17) {
  const [c, x] = canvas(256, 256), r = rng(seed);
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 8) {
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(i, 0, 3, 256);
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i + 4, 0, 3, 256);
  }
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(${110 + r() * 40 | 0},${60 + r() * 20 | 0},30,${0.15 + r() * 0.25})`;
    x.fillRect(r() * 256, r() * 256, 4 + r() * 30, 10 + r() * 80);
  }
  return finish(c);
}

// Brick, for the old watch office and pit building ends.
export function brickTexture() {
  const [c, x] = canvas(256, 256), r = rng(19);
  x.fillStyle = '#8b8174'; x.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 32; row++) for (let col = -1; col < 9; col++) {
    const off = row % 2 ? 16 : 0, v = r();
    x.fillStyle = `rgb(${150 + v * 40 | 0},${70 + v * 25 | 0},${50 + v * 15 | 0})`;
    x.fillRect(col * 32 + off + 1, row * 8 + 1, 30, 6);
  }
  return finish(c);
}

// Painted render with a row of windows (watch office, pit building).
export function facadeTexture({ wall = '#e8e2d2', glass = '#2b3640', frame = '#f6f3ea', cols = 6, rows = 2, seed = 23 } = {}) {
  const [c, x] = canvas(512, 256), r = rng(seed);
  x.fillStyle = wall; x.fillRect(0, 0, 512, 256);
  speckle(x, 512, 256, r, 2500, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.08)'], 2);
  const cw = 512 / cols, rh = 256 / rows;
  for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
    x.fillStyle = frame; x.fillRect(a * cw + cw * 0.18 - 4, b * rh + rh * 0.22 - 4, cw * 0.64 + 8, rh * 0.5 + 8);
    x.fillStyle = glass; x.fillRect(a * cw + cw * 0.18, b * rh + rh * 0.22, cw * 0.64, rh * 0.5);
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(a * cw + cw * 0.18, b * rh + rh * 0.22, cw * 0.64, rh * 0.12);
  }
  const g = x.createLinearGradient(0, 200, 0, 256);
  g.addColorStop(0, 'rgba(60,50,40,0)'); g.addColorStop(1, 'rgba(60,50,40,.3)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  return finish(c);
}

// Pit garages: roller doors with team colour panels above.
export function garageTexture() {
  const [c, x] = canvas(512, 256);
  x.fillStyle = '#d8d8d4'; x.fillRect(0, 0, 512, 256);
  const team = ['#1d4e9e', '#c8102e', '#111111', '#f2b705', '#0d7a4f', '#6b2c91', '#e85d04', '#2b2d42'];
  for (let i = 0; i < 4; i++) {
    const x0 = i * 128;
    x.fillStyle = team[i * 2 % team.length]; x.fillRect(x0 + 6, 18, 116, 34);
    x.fillStyle = '#fff'; x.font = 'bold 18px Arial'; x.textAlign = 'center'; x.fillText('LAKESIDE', x0 + 64, 41);
    x.fillStyle = '#5d6166'; x.fillRect(x0 + 10, 62, 108, 194);
    for (let y = 66; y < 256; y += 7) { x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(x0 + 10, y, 108, 2); }
  }
  return finish(c);
}

// One sheet for the pit building front (src/pitBuilding.js), 1024 x 512: two roller doors (top left, 256 px each), the end sign
// (top right) and eight team colour boards (the bottom half, 128 px each, a stripe low on the board).
export function pitFacadeTexture() {
  const [c, x] = canvas(1024, 512);
  x.fillStyle = '#d8d8d4'; x.fillRect(0, 0, 1024, 512);
  [['#9a9ea3', '#6f7378'], ['#cfd1cc', '#9ea29d']].forEach(([a, b], k) => {
    const x0 = k * 256;
    x.fillStyle = a; x.fillRect(x0, 0, 256, 256);
    for (let y = 0; y < 256; y += 12) { x.fillStyle = b; x.fillRect(x0, y + 9, 256, 3); x.fillStyle = 'rgba(255,255,255,.16)'; x.fillRect(x0, y, 256, 2); }
    x.fillStyle = '#3a3d41'; x.fillRect(x0, 240, 256, 16);
    x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(x0, 0, 256, 6);
  });
  x.fillStyle = '#1b1e22'; x.fillRect(512, 0, 512, 128);
  x.fillStyle = '#f2f2ee'; x.font = 'bold 88px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  if ('letterSpacing' in x) x.letterSpacing = '6px';
  x.fillText('LAKESIDE', 768, 68);
  const team = ['#1d4e9e', '#c8102e', '#111111', '#f2b705', '#0d7a4f', '#6b2c91', '#e85d04', '#2b2d42'];
  team.forEach((col, k) => {
    const x0 = k * 128;
    x.fillStyle = col; x.fillRect(x0, 256, 128, 256);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.fillRect(x0, 256 + 196, 128, 28);
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(x0, 256, 128, 24);
  });
  return finish(c, { repeat: false });
}

// Sponsor sheet: one board per row, 1024 x 128 each. PowerMedia is the
// title partner; the rest are the invented brands from the reference pack.
// Rows 6 and 7 are 1950s and 60s brands, faded, for the old circuit.
export const SPONSORS = ['powermedia', 'veyra', 'norrland', 'merrow', 'quillon', 'tarnwick', 'deltadash', 'pennant', 'brannocks',
  'zephra', 'corvane', 'lumenor', 'oxley', 'brightfold', 'kingsbury', 'aldershaw', 'powermedia-yellow'];
// Row numbers of the brands that appear on today's circuit (everything but PowerMedia, which has its
// own share of the boards, and the faded 1950s and 60s boards kept for the old circuit)
export const MODERN_SPONSORS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13];
export const PERIOD_SPONSORS = [7, 8, 14, 15];
const BRAND_BG = { powermedia: '#111111', veyra: '#0e7c86', norrland: '#101214', merrow: '#1d2e5c', quillon: '#d4145a', tarnwick: '#0B6B4F',
  deltadash: '#1a1a2e', zephra: '#FF6A13', corvane: '#D3202B', lumenor: '#FFC93C', oxley: '#1F4E9E', brightfold: '#19B5C9', 'powermedia-yellow': '#ffd21f' };

// A logo file at public/sponsors/<id>.png replaces the generated board for that brand, scaled to fit on the
// brand colour. public/sponsors/manifest.json lists the ids that have a file (so nothing 404s).
function loadSponsorFiles(x, texture) {
  const base = import.meta.env?.BASE_URL ?? './';
  fetch(base + 'sponsors/manifest.json').then(r => (r.ok ? r.json() : [])).then(ids => {
    for (const id of ids) {
      const row = SPONSORS.indexOf(id);
      if (row < 0) continue;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(960 / img.width, 108 / img.height), w = img.width * scale, h = img.height * scale;
        x.save(); x.translate(0, row * 128); x.fillStyle = BRAND_BG[id] || '#222'; x.fillRect(0, 0, 1024, 128);
        x.drawImage(img, (1024 - w) / 2, (128 - h) / 2, w, h); x.restore();
        texture.needsUpdate = true;
      };
      img.src = base + `sponsors/${id}.png`;
    }
  }).catch(() => {});
}

export function sponsorAtlas() {
  const rows = SPONSORS.length, [c, x] = canvas(1024, 128 * rows);
  const sans = (w, s) => `${w} ${s}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
  const serif = (w, s) => `${w} ${s}px Georgia, "Times New Roman", serif`;
  const board = (id, bg, draw) => {
    x.save(); x.translate(0, SPONSORS.indexOf(id) * 128);
    x.fillStyle = bg; x.fillRect(0, 0, 1024, 128);
    x.textBaseline = 'middle'; x.textAlign = 'center';
    draw();
    x.restore();
  };

  board('powermedia', '#111111', () => {          // PowerMedia, black
    x.fillStyle = '#ffd21f'; x.fillRect(0, 0, 1024, 14); x.fillRect(0, 114, 1024, 14);
    x.font = 'italic ' + sans('900', 84);
    x.fillStyle = '#fff'; x.fillText('POWER', 400, 66);
    x.fillStyle = '#ffd21f'; x.fillText('MEDIA', 640, 66);
  });
  board('veyra', '#0e7c86', () => {          // Veyra Tyres: wavy V mark
    x.strokeStyle = '#ff5a1f'; x.lineWidth = 10; x.beginPath();
    x.moveTo(90, 34); x.quadraticCurveTo(120, 60, 140, 98); x.quadraticCurveTo(165, 55, 200, 34); x.stroke();
    x.font = sans('900', 86); x.fillStyle = '#f2f2f2'; x.fillText('VEYRA', 470, 66);
    x.font = sans('bold', 40); x.fillStyle = '#ff5a1f'; x.fillText('TYRES', 790, 68);
  });
  board('norrland', '#101214', () => {          // Norrland Energy
    x.font = sans('900', 90); x.fillStyle = '#c6f432'; x.fillText('NORRLAND', 440, 66);
    x.fillStyle = '#c6f432'; x.fillRect(780, 36, 170, 56);
    x.font = sans('900', 40); x.fillStyle = '#101214'; x.fillText('ENERGY', 865, 66);
  });
  board('merrow', '#1d2e5c', () => {          // Merrow Mutual Insurance: serif and shield
    x.fillStyle = '#e4b64a'; x.beginPath(); x.moveTo(80, 24); x.lineTo(150, 24); x.lineTo(150, 70); x.quadraticCurveTo(150, 100, 115, 110); x.quadraticCurveTo(80, 100, 80, 70); x.closePath(); x.fill();
    x.font = serif('normal', 64); x.fillStyle = '#e4b64a'; x.fillText('Merrow Mutual', 520, 56);
    x.font = sans('normal', 26); x.fillStyle = '#d9dde8'; x.fillText('I N S U R A N C E', 520, 102);
  });
  board('quillon', '#d4145a', () => {          // Quillon Mobile: rounded lowercase
    x.font = sans('bold', 92); x.fillStyle = '#f2f2f2'; x.fillText('quillon', 470, 62);
    x.beginPath(); x.arc(800, 64, 34, 0, 7); x.fillStyle = '#f2f2f2'; x.fill();
    x.font = sans('bold', 26); x.fillStyle = '#d4145a'; x.fillText('5G', 800, 66);
  });
  board('tarnwick', '#0B6B4F', () => {          // Tarnwick Bank: green and white, a bank
    x.fillStyle = '#fff'; x.fillRect(70, 84, 120, 10); x.fillRect(78, 40, 12, 40); x.fillRect(104, 40, 12, 40); x.fillRect(130, 40, 12, 40); x.fillRect(156, 40, 12, 40);
    x.beginPath(); x.moveTo(62, 40); x.lineTo(130, 14); x.lineTo(198, 40); x.closePath(); x.fill();
    x.font = serif('bold', 74); x.fillStyle = '#fff'; x.fillText('Tarnwick', 530, 54);
    x.font = sans('bold', 34); x.fillText('B A N K', 810, 98);
  });
  board('zephra', '#FF6A13', () => {          // Zephra Sportswear: black, slanted
    x.save(); x.transform(1, 0, -0.25, 1, 30, 0);
    x.font = sans('900', 96); x.fillStyle = '#000'; x.fillText('ZEPHRA', 470, 62);
    x.restore();
    x.fillStyle = '#000'; x.fillRect(740, 40, 220, 8); x.fillRect(740, 80, 220, 8);
    x.font = sans('bold', 28); x.fillText('SPORTSWEAR', 850, 64);
  });
  board('corvane', '#D3202B', () => {          // Corvane Fuels: red with a grey band
    x.fillStyle = '#6A6D72'; x.fillRect(0, 96, 1024, 32);
    x.font = sans('900', 86); x.fillStyle = '#fff'; x.fillText('CORVANE', 420, 50);
    x.font = sans('bold', 32); x.fillStyle = '#d9dadd'; x.fillText('FUELS', 770, 52);
    x.beginPath(); x.arc(930, 50, 26, 0, 7); x.fillStyle = '#6A6D72'; x.fill();
  });
  board('lumenor', '#FFC93C', () => {          // Lumenor Lighting: navy on yellow, a bulb
    x.fillStyle = '#14264A'; x.beginPath(); x.arc(120, 54, 34, 0, 7); x.fill(); x.fillRect(104, 88, 32, 14);
    x.font = sans('bold', 84); x.fillText('LUMENOR', 500, 58);
    x.font = sans('normal', 30); x.fillText('L I G H T I N G', 800, 100);
  });
  board('oxley', '#1F4E9E', () => {          // Oxley Freight: white, a lorry
    x.fillStyle = '#fff'; x.fillRect(60, 44, 90, 44); x.fillRect(154, 58, 36, 30); x.beginPath(); x.arc(86, 92, 12, 0, 7); x.arc(170, 92, 12, 0, 7); x.fill();
    x.font = sans('900', 84); x.fillText('OXLEY', 460, 58);
    x.font = sans('bold', 40); x.fillText('FREIGHT', 770, 62);
  });
  board('brightfold', '#19B5C9', () => {          // Brightfold Energy: dark on cyan, folded flame
    x.fillStyle = '#0E2A33'; x.beginPath(); x.moveTo(70, 100); x.lineTo(110, 20); x.lineTo(150, 100); x.lineTo(110, 78); x.closePath(); x.fill();
    x.font = sans('900', 80); x.fillText('BRIGHTFOLD', 520, 56);
    x.font = sans('bold', 30); x.fillText('E N E R G Y', 770, 100);
  });
  board('powermedia-yellow', '#ffd21f', () => {          // PowerMedia, yellow variant (gantry and bridge only)
    x.font = 'italic ' + sans('900', 80); x.fillStyle = '#111';
    x.fillText('POWERMEDIA', 420, 62); x.font = sans('bold', 30); x.fillText('MOTORSPORT PHOTOGRAPHY', 820, 64);
  });
  board('pennant', '#ede3c8', () => {          // Pennant Petroleum, 1950s
    x.fillStyle = '#d9381e'; x.beginPath(); x.moveTo(70, 24); x.lineTo(200, 64); x.lineTo(70, 104); x.closePath(); x.fill();
    x.fillStyle = '#2a4a7a'; x.fillRect(62, 18, 8, 96);
    x.font = serif('bold', 72); x.fillStyle = '#2a4a7a'; x.fillText('PENNANT', 520, 58);
    x.font = serif('italic', 30); x.fillStyle = '#d9381e'; x.fillText('Petroleum Spirit', 520, 104);
  });
  board('brannocks', '#1f4d36', () => {          // Brannock's Pale Ale, 1950s
    x.strokeStyle = '#d8a83a'; x.lineWidth = 6; x.strokeRect(14, 12, 996, 104);
    x.font = serif('bold', 70); x.fillStyle = '#d8a83a'; x.fillText("BRANNOCK'S", 512, 56);
    x.font = serif('italic', 30); x.fillStyle = '#ede3c8'; x.fillText('Pale Ale  ·  Brewed in the Weald', 512, 100);
  });
  board('kingsbury', '#1B4F9C', () => {          // Kingsbury Plugs, 1960s: chunky block capitals
    x.fillStyle = '#C8102E'; x.fillRect(0, 0, 1024, 16); x.fillRect(0, 112, 1024, 16);
    x.font = sans('900', 94); x.fillStyle = '#F4F1E6'; x.fillText('KINGSBURY', 440, 60);
    x.font = sans('900', 46); x.fillStyle = '#F4F1E6'; x.fillText('PLUGS', 870, 62);
  });
  board('aldershaw', '#2E7D74', () => {          // Aldershaw Radio and Television, 1960s: script and a dial
    x.fillStyle = '#EDE3C8'; x.beginPath(); x.arc(110, 64, 40, 0, 7); x.fill();
    x.strokeStyle = '#16181B'; x.lineWidth = 6; x.beginPath(); x.moveTo(110, 64); x.lineTo(132, 40); x.stroke();
    x.font = 'italic bold 78px Georgia, "Times New Roman", serif'; x.fillStyle = '#EDE3C8'; x.fillText('Aldershaw', 520, 52);
    x.font = sans('bold', 28); x.fillStyle = '#16181B'; x.fillText('RADIO  ·  TELEVISION', 560, 102);
  });

  // fade the period boards: desaturate, rust streaks, lichen, broken paint
  const r = rng(53);
  for (const row of PERIOD_SPONSORS) {
    const y0 = row * 128, img = x.getImageData(0, y0, 1024, 128), d = img.data;
    for (let k = 0; k < d.length; k += 4) {
      const grey = (d[k] + d[k + 1] + d[k + 2]) / 3;
      for (let ch = 0; ch < 3; ch++) d[k + ch] = Math.max(42, d[k + ch] * 0.65 + grey * 0.35);
      if (r() < 0.2) for (let ch = 0; ch < 3; ch++) d[k + ch] = d[k + ch] * 0.85 + 160 * 0.15;
    }
    x.putImageData(img, 0, y0);
    for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(122,74,47,.15)'; x.fillRect(r() * 1024, y0, 3 + r() * 5, 30 + r() * 90); }
    for (const cx of [20, 1004]) { x.fillStyle = 'rgba(127,138,92,.45)'; x.beginPath(); x.arc(cx, y0 + 118, 30 + r() * 20, 0, 7); x.fill(); }
  }
  const t = finish(c, { repeat: false });
  t.wrapS = THREE.RepeatWrapping;
  loadSponsorFiles(x, t);
  return t;
}

// One sponsor board for a car decal: { canvas, row } where row is the board's row in the shared sheet (128 px high, 1024 wide).
// The sheet is drawn once, on first use, and kept; null for an unknown id.
let boardSheet = null;
export function sponsorBoard(id) {
  const row = SPONSORS.indexOf(id);
  if (row < 0) return null;
  boardSheet ||= sponsorAtlas();
  return { canvas: boardSheet.image, row };
}

// Distance boards: white with a red border and black numerals (1.2 by 0.8 m).
export function distanceTexture(n) {
  const [c, x] = canvas(192, 128);
  x.fillStyle = '#c8102e'; x.fillRect(0, 0, 192, 128);
  x.fillStyle = '#f2f0e8'; x.fillRect(10, 10, 172, 108);
  x.fillStyle = '#111'; x.font = 'bold 74px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 96, 68);
  return finish(c, { repeat: false });
}

// RAF-style roundel for the underside of Roundel Bridge.
export function roundelTexture() {
  const [c, x] = canvas(512, 512);
  x.fillStyle = '#9a978d'; x.fillRect(0, 0, 512, 512);
  speckle(x, 512, 512, rng(41), 6000, ['#8a877e', '#a6a399'], 2);
  for (const [rad, col] of [[240, '#e8e2c8'], [200, '#1e3f8f'], [130, '#e8e2c8'], [80, '#cc2a2a']]) {
    x.fillStyle = col; x.beginPath(); x.arc(256, 256, rad, 0, 7); x.fill();
  }
  return finish(c, { repeat: false });
}

// Concrete wall with the red and white top band used on the street section.
export function streetWallTexture() {
  const [c, x] = canvas(256, 64), r = rng(43);
  x.fillStyle = '#b9b7af'; x.fillRect(0, 0, 256, 64);
  speckle(x, 256, 64, r, 3000, ['#a8a69f', '#c6c4bd', '#9d9b94'], 1.3);
  for (let i = 0; i < 256; i += 43) { x.fillStyle = (i / 43) % 2 ? '#ededea' : '#c8102e'; x.fillRect(i, 0, 43, 10); }
  x.fillStyle = 'rgba(60,60,60,.6)'; x.fillRect(0, 0, 2, 64); x.fillRect(128, 0, 2, 64);
  return finish(c);
}

// Pit lane markings: white edge line, dashed lane divider. v = 0 at the track side.
export function pitLaneTexture() {
  const [c, x] = canvas(256, 256), r = rng(29);
  x.fillStyle = '#44474b'; x.fillRect(0, 0, 256, 256);
  speckle(x, 256, 256, r, 9000, ['#36383c', '#55585c', '#5d6064'], 1.4);
  x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, 256, 6); x.fillRect(0, 250, 256, 6);
  for (let i = 0; i < 256; i += 64) x.fillRect(i, 128, 34, 4);
  return finish(c);
}

// Conveyor-belt tyre barrier face: black rubber, a seam every 1.2 m, rows of bolt heads. One tile is 4 m by 1.8 m.
export function tyreWallTexture() {
  const [c, x] = canvas(512, 256), r = rng(67);
  x.fillStyle = '#1d1e20'; x.fillRect(0, 0, 512, 256);
  speckle(x, 512, 256, r, 5000, ['#151617', '#27282b', '#303134'], 1.6);
  for (let i = 0; i < 512; i += 154) { x.fillStyle = '#0c0c0d'; x.fillRect(i, 0, 3, 256); }      // belt seams
  for (const y of [34, 222]) for (let i = 8; i < 512; i += 32) {                                   // bolt heads
    x.fillStyle = '#0a0a0b'; x.beginPath(); x.arc(i + 1, y + 1.5, 6, 0, 7); x.fill();
    x.fillStyle = '#5a5d62'; x.beginPath(); x.arc(i, y, 5, 0, 7); x.fill();
    x.fillStyle = '#8a8d92'; x.beginPath(); x.arc(i - 1.5, y - 1.5, 1.8, 0, 7); x.fill();
  }
  return finish(c);
}

// A rumble band across a concrete apron: flat, with fine grooves across the direction of travel.
// One tile is 2 m of track long and 0.55 m wide.
export function rumbleTexture() {
  const [c, x] = canvas(256, 64), r = rng(61);
  x.fillStyle = '#b4aea0'; x.fillRect(0, 0, 256, 64);
  speckle(x, 256, 64, r, 1200, ['#a29c8e', '#c3bdb0', '#8f897c'], 1.2);
  for (let i = 0; i < 256; i += 8) { x.fillStyle = '#6a665c'; x.fillRect(i, 0, 3, 64); x.fillStyle = '#d2ccbf'; x.fillRect(i + 3, 0, 1, 64); }
  return finish(c);
}

// Pit lane asphalt: lighter than the circuit, no markings (lines are drawn separately).
export function pitAsphaltTexture() {
  const [c, x] = canvas(256, 256), r = rng(37);
  x.fillStyle = '#45484b'; x.fillRect(0, 0, 256, 256);
  speckle(x, 256, 256, r, 10000, ['#3b3e41', '#505356', '#595c5f', '#424548'], 1.5);
  return finish(c);
}

// Painted chevrons, for the pit entry island and the pit wall attenuator.
export function chevronTexture(a = '#f2f2ee', b = '#5b5e63') {
  const [c, x] = canvas(128, 128);
  x.fillStyle = b; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = a; x.lineWidth = 14;
  for (let k = -128; k < 256; k += 48) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 64, 64); x.lineTo(k, 128); x.stroke(); }
  return finish(c);
}

// Round speed-limit sign: red ring, white face, black number.
export function speedSignTexture(n) {
  const [c, x] = canvas(128, 128);
  x.fillStyle = '#c8102e'; x.beginPath(); x.arc(64, 64, 64, 0, 7); x.fill();
  x.fillStyle = '#f2f0e8'; x.beginPath(); x.arc(64, 64, 48, 0, 7); x.fill();
  x.fillStyle = '#111'; x.font = 'bold 52px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 64, 68);
  return finish(c, { repeat: false });
}

// ---------------------------------------------------------------------------
// Venue textures: grass, gantry banner, start line, grandstand seating.

// draw `fn(dx, dy)` at the canvas position and at its wrapped copies, so the texture tiles without a seam
function wrapped(w, h, px, py, reach, fn) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const x = px + dx, y = py + dy;
    if (x < -reach || x > w + reach || y < -reach || y > h + reach) continue;
    fn(x, y);
  }
}

// Mown grass beside the circuit. One tile is 12 m along by 12 m across (u along, v across): two 6 m mowing stripes across, a
// lighter and a darker one (about a fifth apart in tone), each with a faint lean in the nap, then two scales of mottling and
// fine blades on top. Rows of the canvas are across the track.
export function mownGrassTexture(seed = 3) {
  const W = 512, H = 512, [c, x] = canvas(W, H), r = rng(seed);
  const stripe = H / 2;
  for (let i = 0; i < 2; i++) {
    const g = x.createLinearGradient(0, i * stripe, 0, (i + 1) * stripe);
    const a = i % 2 ? ['#76a64b', '#6b9b43'] : ['#5a8c38', '#4d8030'];
    g.addColorStop(0, a[0]); g.addColorStop(1, a[1]);
    x.fillStyle = g; x.fillRect(0, i * stripe, W, stripe);
  }
  // soft mottling at two scales: patches of a metre or two, and fine speckle of a hand's width
  const blobs = (n, r0, r1, dark, light) => {
    for (let i = 0; i < n; i++) {
      const px = r() * W, py = r() * H, rad = r0 + r() * (r1 - r0), d = r() < 0.5;
      wrapped(W, H, px, py, rad, (qx, qy) => {
        const g = x.createRadialGradient(qx, qy, 0, qx, qy, rad);
        g.addColorStop(0, d ? dark : light); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(qx - rad, qy - rad, rad * 2, rad * 2);
      });
    }
  };
  blobs(36, 60, 130, 'rgba(30,60,20,.10)', 'rgba(140,175,80,.09)');
  blobs(160, 7, 18, 'rgba(30,60,20,.11)', 'rgba(150,185,90,.10)');
  // blades, lying along the direction of the cut (along the track)
  const tones = ['#41702a', '#6aa045', '#3a6626', '#78ad4f', '#5f9540'];
  for (let i = 0; i < 6000; i++) {
    const px = r() * W, py = r() * H, len = 3 + r() * 5;
    x.strokeStyle = tones[(r() * tones.length) | 0]; x.globalAlpha = 0.5; x.lineWidth = 1.1;
    wrapped(W, H, px, py, len, (qx, qy) => { x.beginPath(); x.moveTo(qx, qy); x.lineTo(qx + len, qy + (r() - 0.5) * 2); x.stroke(); });
  }
  x.globalAlpha = 1;
  return finish(c, { aniso: 16 });
}

// Longer, rougher meadow grass for the ground further out. 12 m a tile, no stripes: big patches, clumps, seed heads and bare patches.
export function meadowTexture(seed = 31) {
  const W = 512, H = 512, [c, x] = canvas(W, H), r = rng(seed);
  x.fillStyle = '#5d8240'; x.fillRect(0, 0, W, H);
  const blob = (n, r0, r1) => {
    for (let i = 0; i < n; i++) {
      const px = r() * W, py = r() * H, rad = r0 + r() * (r1 - r0), k = r();
      const col = k < 0.35 ? 'rgba(36,66,26,.15)' : k < 0.7 ? 'rgba(150,170,80,.12)' : 'rgba(120,100,50,.08)';
      wrapped(W, H, px, py, rad, (qx, qy) => {
        const g = x.createRadialGradient(qx, qy, 0, qx, qy, rad);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(qx - rad, qy - rad, rad * 2, rad * 2);
      });
    }
  };
  blob(40, 90, 190);     // broad patches
  blob(110, 22, 70);     // clumps
  blob(150, 6, 16);      // fine speckle
  const tones = ['#3b6427', '#6f9a45', '#4a7a30', '#86a655', '#a39c58', '#2f5520'];
  for (let i = 0; i < 9000; i++) {
    const px = r() * W, py = r() * H, len = 4 + r() * 7, ang = -Math.PI / 2 + (r() - 0.5) * 2.6;
    x.strokeStyle = tones[(r() * tones.length) | 0]; x.globalAlpha = 0.55; x.lineWidth = 0.9 + r() * 0.8;
    wrapped(W, H, px, py, len, (qx, qy) => {
      x.beginPath(); x.moveTo(qx, qy); x.quadraticCurveTo(qx + Math.cos(ang) * len * 0.5, qy + Math.sin(ang) * len * 0.5, qx + Math.cos(ang) * len + (r() - 0.5) * 2, qy + Math.sin(ang) * len); x.stroke();
    });
  }
  x.globalAlpha = 1;
  return finish(c, { aniso: 16 });
}

// Chequered start line: two rows of squares. One tile is 2 squares wide (u) and 2 deep (v).
export function chequerTexture() {
  const [c, x] = canvas(64, 64);
  x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#16171a'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
  return finish(c, { nearest: true, aniso: 4 });
}

// The timing banner on the start gantry: START / FINISH between chequered ends, with a row of lap-clock style digits.
export function gantryBannerTexture() {
  const [c, x] = canvas(2048, 160);
  x.fillStyle = '#0d0e10'; x.fillRect(0, 0, 2048, 160);
  const sq = 20;
  for (const x0 of [0, 2048 - 8 * sq]) for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    x.fillStyle = (i + j) % 2 ? '#f2f2ee' : '#16171a'; x.fillRect(x0 + i * sq, j * sq, sq, sq);
  }
  x.fillStyle = '#ffd21f'; x.fillRect(8 * sq, 0, 2048 - 16 * sq, 8); x.fillRect(8 * sq, 152, 2048 - 16 * sq, 8);
  x.textBaseline = 'middle'; x.textAlign = 'center';
  x.fillStyle = '#f2f2ee'; x.font = 'bold 92px "Arial Narrow", Arial, sans-serif';
  x.fillText('LAKESIDE   START / FINISH', 1024, 82);
  return finish(c, { repeat: false });
}

// Grandstand seating, seen from the front: a row of seat blocks in club colours. One tile is 8 seats wide (u) and one row deep (v).
export function seatTexture() {
  const [c, x] = canvas(256, 64), r = rng(77);
  x.fillStyle = '#3a3d42'; x.fillRect(0, 0, 256, 64);
  const cols = ['#1d4e9e', '#c8102e', '#e8e6de', '#1d4e9e'];
  for (let i = 0; i < 8; i++) {
    const col = cols[(i >> 1) % cols.length];
    x.fillStyle = col; x.fillRect(i * 32 + 3, 22, 26, 36);          // back rest
    x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(i * 32 + 3, 52, 26, 6);
    x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(i * 32 + 3, 22, 26, 3);
  }
  speckle(x, 256, 64, r, 500, ['rgba(0,0,0,.12)', 'rgba(255,255,255,.08)'], 1.2);
  return finish(c, { aniso: 4 });
}

// Painted concrete for stands and walls: pale, panel seams every 3 m.
export function standConcreteTexture() {
  const [c, x] = canvas(256, 256), r = rng(81);
  x.fillStyle = '#c3c1ba'; x.fillRect(0, 0, 256, 256);
  speckle(x, 256, 256, r, 4000, ['#b2b0a9', '#cfcdc6', '#a6a49d'], 1.3);
  x.fillStyle = 'rgba(60,60,60,.45)'; x.fillRect(0, 0, 2, 256); x.fillRect(0, 0, 256, 2);
  return finish(c);
}

// A numbered plate for a pit garage or a grid slot. Several numbers on one sheet: 8 columns by 4 rows, 1 to 32.
export function numberSheet() {
  const [c, x] = canvas(512, 256);
  x.fillStyle = '#16181b'; x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#f2f2ee'; x.font = 'bold 40px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let n = 0; n < 32; n++) {
    const cx = (n % 8) * 64 + 32, cy = Math.floor(n / 8) * 64 + 34;
    x.strokeStyle = '#ffd21f'; x.lineWidth = 3; x.strokeRect(cx - 28, cy - 24, 56, 48);
    x.fillText(String(n + 1), cx, cy + 2);
  }
  return finish(c, { repeat: false });
}

// One sponsor atlas shared by everything that draws boards (the canvas is big, and logo files are fetched into it once).
let sharedAtlas = null;
export function sharedSponsorAtlas() { return (sharedAtlas ||= sponsorAtlas()); }
