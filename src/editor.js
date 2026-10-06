// Track maker: a top-down editor for the circuit layout.
//
// Edits the same data as src/layout.js (control points, sectors, DRS, bridge,
// pit lane and the gravel, wall, run-off and sausage zones) and saves it in
// the browser (src/trackStore.js). "Drive it" reloads the game on that track.
// Everything is measured in sketch units like layout.js: positions on screen
// are sketch units times the zoom.

import { previewCentreline, buildTrack } from './track.js';
import { ZONE_KINDS, newLayout, normalise, problems, listTracks, getTrack, saveTrack, setActive, deleteTrack, exportJSON, importJSON } from './trackStore.js';

const TOOLS = [
  ['points', 'Points', 'Drag a point to move it. Drag empty space to pan, scroll to zoom. Double-click the track to add a point.'],
  ['add', 'Add point', 'Click anywhere to add a point after the nearest part of the track.'],
  ['sectors', 'Sectors', 'Click the start of sector 2, then the start of sector 3.'],
  ['drs', 'DRS', 'Click the start and end of a DRS zone.'],
  ['bridge', 'Bridge', 'Click the start and end of the bridge. Use it where the track crosses itself.'],
  ['pit', 'Pit lane', 'Click where the pit lane leaves the track, then where it rejoins. It runs down the left of the track.'],
  ...Object.entries(ZONE_KINDS).map(([k, z]) => [k, z.label, `Click the start and end of the zone. Side and width are set below.`]),
];

let root = null, S = null;

export function openTrackMaker(current) {
  root = document.getElementById('maker');
  let layout, id = null;
  if (current) { layout = JSON.parse(JSON.stringify(current.layout)); id = current.id; }
  else layout = newLayout();
  S = {
    layout, id, tool: 'points', sel: -1, pending: null, side: 'both', zoneWidth: 20,
    view: { x: 0, y: 0, zoom: 1 }, centre: null, line: null, dirty: false, msg: '',
  };
  root.hidden = false;
  root.innerHTML = markup();
  wire();
  rebuild();
  fit();
  syncPanel();
  say(TOOLS[0][2]);
  draw();
}

export const isMakerOpen = () => !!root && !root.hidden;

function close() { root.hidden = true; root.innerHTML = ''; }

// ---------------------------------------------------------------------------
// Layout edits

const pts = () => S.layout.points;
const nPts = () => S.layout.points.length;
const mod = (v, n) => ((v % n) + n) % n;

// every place the layout refers to a point by index
function eachParam(fn) {
  const L = S.layout;
  L.sectors = L.sectors.map(fn);
  L.drs = L.drs.map(z => z.map(fn));
  if (L.bridge) L.bridge = L.bridge.map(fn);
  L.pit.entry = fn(L.pit.entry); L.pit.exit = fn(L.pit.exit);
  for (const k of Object.keys(ZONE_KINDS)) L[k] = L[k].map(z => [fn(z[0]), fn(z[1]), ...z.slice(2)]);
}

function insertPoint(after, x, y) {
  const n = nPts(), h = (pts()[after][2] + pts()[(after + 1) % n][2]) / 2;
  pts().splice(after + 1, 0, [Math.round(x), Math.round(y), Math.round(h)]);
  eachParam(p => (p > after + 0.5 ? p + 1 : p));
  S.sel = after + 1;
}

function deletePoint(k) {
  if (nPts() <= 6) return say('A circuit needs at least 6 points.');
  pts().splice(k, 1);
  const n = nPts();
  eachParam(p => mod(p > k ? p - 1 : p, n));
  S.sel = -1;
}

function startHere(k) {
  const n = nPts();
  S.layout.points = [...pts().slice(k), ...pts().slice(0, k)];
  eachParam(p => mod(p - k, n));
  S.sel = 0;
}

function say(m) { S.msg = m; const el = root.querySelector('#m-msg'); if (el) el.textContent = m; }

// ---------------------------------------------------------------------------
// Preview geometry

function rebuild() {
  const L = S.layout;
  S.line = previewCentreline(L);
  const { x, z, centre } = S.line, sc = L.scale;
  S.sx = Float64Array.from(x, v => v / sc + centre.x);
  S.sy = Float64Array.from(z, v => v / sc + centre.y);
  S.checks = analyse();
  updateInfo();
}

// where a parameter sits on the preview line
function indexOfParam(p) {
  const u = S.line.u, N = S.line.N, n = nPts();
  p = mod(p, n);
  let lo = 0, hi = N - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (u[m] <= p) lo = m; else hi = m; }
  return u[hi] <= p ? hi : lo;
}

function paramAtScreen(sx, sy, maxPx = 24) {
  const w = toWorld(sx, sy), { N } = S.line;
  let best = Infinity, bi = -1;
  for (let i = 0; i < N; i += 2) {
    const q = (S.sx[i] - w.x) ** 2 + (S.sy[i] - w.y) ** 2;
    if (q < best) { best = q; bi = i; }
  }
  if (Math.sqrt(best) * S.view.zoom > maxPx) return null;
  return { i: bi, p: mod(Math.round(S.line.u[bi] * 10) / 10, nPts()) };
}

function analyse() {
  const out = [];
  const { N, length } = S.line, L = S.layout;
  out.push(`${(length / 1000).toFixed(2)} km, ${nPts()} points`);
  // crossings at the same height with no bridge
  const step = 8, M = Math.floor(N / step), X = i => S.line.x[i * step], Z = i => S.line.z[i * step], H = i => S.line.h[i * step];
  let bad = 0;
  const onBridge = i => L.bridge && inRangeParam(S.line.u[i * step], L.bridge[0], L.bridge[1]);
  for (let a = 0; a < M; a++) for (let b = a + 3; b < M; b++) {
    if (a === 0 && b >= M - 3) continue;
    if (segCross(X(a), Z(a), X((a + 1) % M), Z((a + 1) % M), X(b), Z(b), X((b + 1) % M), Z((b + 1) % M)) &&
        Math.abs(H(a) - H(b)) < 6 && !onBridge(a) && !onBridge(b)) bad++;
  }
  if (bad) out.push('WARN The track crosses itself at the same height. Raise one point, or set a bridge.');
  const [s1, s2] = L.sectors;
  if (!(s1 > 0 && s1 < s2 && s2 < nPts())) out.push('WARN Sectors must run in order after the start line.');
  return out;
}

function inRangeParam(p, a, b) { const n = nPts(); return mod(b - a, n) >= mod(p - a, n); }
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (!d) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

// ---------------------------------------------------------------------------
// View

let cv, cx;

const toScreen = (x, y) => [(x - S.view.x) * S.view.zoom + cv.width / 2, (y - S.view.y) * S.view.zoom + cv.height / 2];
const toWorld = (sx, sy) => ({ x: (sx - cv.width / 2) / S.view.zoom + S.view.x, y: (sy - cv.height / 2) / S.view.zoom + S.view.y });

function fit() {
  if (!cv) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts()) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  S.view.x = (x0 + x1) / 2; S.view.y = (y0 + y1) / 2;
  S.view.zoom = Math.min(cv.width / (x1 - x0 + 120), cv.height / (y1 - y0 + 120));
}

function sizeCanvas() {
  const r = cv.getBoundingClientRect(), k = devicePixelRatio || 1;
  cv.width = Math.max(100, Math.round(r.width * k)); cv.height = Math.max(100, Math.round(r.height * k));
}

function draw() {
  if (!isMakerOpen() || !cv) return;
  const L = S.layout, { N } = S.line, k = devicePixelRatio || 1, z = S.view.zoom;
  cx.fillStyle = '#26301f'; cx.fillRect(0, 0, cv.width, cv.height);
  drawGrid();

  const path = (a, b) => {   // sample range a..b along the line, as a canvas path
    cx.beginPath();
    let i = a, first = true;
    for (let n = 0; n <= N; n++) {
      const [px, py] = toScreen(S.sx[i], S.sy[i]);
      if (first) { cx.moveTo(px, py); first = false; } else cx.lineTo(px, py);
      if (i === b) break;
      i = (i + 1) % N;
    }
  };
  const widthPx = L.width / L.scale * z;
  cx.lineJoin = 'round'; cx.lineCap = 'butt';

  // zones, drawn as bands beside the track
  for (const [kind, def] of Object.entries(ZONE_KINDS)) {
    for (const zn of L[kind]) {
      const a = indexOfParam(zn[0]), b = indexOfParam(zn[1]), width = kind === 'gravel' || kind === 'runoff' ? zn[3] || def.width : 2;
      for (const sd of zn[2] === 'both' ? [-1, 1] : [zn[2] === 'L' ? -1 : 1]) {
        const off = sd * (L.width / 2 + width / 2) / L.scale;
        cx.beginPath();
        let i = a;
        for (let n = 0; n <= N; n++) {
          const j = (i + 1) % N, dx = S.sx[j] - S.sx[i], dy = S.sy[j] - S.sy[i], m = Math.hypot(dx, dy) || 1;
          const [px, py] = toScreen(S.sx[i] - dy / m * off, S.sy[i] + dx / m * off);
          n ? cx.lineTo(px, py) : cx.moveTo(px, py);
          if (i === b) break;
          i = j;
        }
        cx.strokeStyle = def.colour; cx.globalAlpha = 0.75;
        cx.lineWidth = Math.max(3, width / L.scale * z);
        cx.stroke();
        cx.globalAlpha = 1;
      }
    }
  }

  // tarmac
  path(0, N - 1); cx.closePath();
  cx.strokeStyle = '#d8d6cc'; cx.lineWidth = widthPx + 3 * k; cx.stroke();
  cx.strokeStyle = '#3b3f45'; cx.lineWidth = widthPx; cx.stroke();

  // DRS, bridge, pit on top of the tarmac
  const band = (zn, colour, w, dash) => {
    path(indexOfParam(zn[0]), indexOfParam(zn[1]));
    cx.strokeStyle = colour; cx.lineWidth = w; cx.setLineDash(dash || []); cx.stroke(); cx.setLineDash([]);
  };
  for (const zn of L.drs) band(zn, '#3ddc84', Math.max(3, widthPx * 0.4));
  if (L.bridge) band(L.bridge, '#c9a66b', Math.max(3, widthPx * 0.7), [8 * k, 4 * k]);
  {
    const a = indexOfParam(L.pit.entry), b = indexOfParam(L.pit.exit), off = -L.pit.offset / L.scale;
    cx.beginPath();
    let i = a;
    for (let n = 0; n <= N; n++) {
      const j = (i + 1) % N, dx = S.sx[j] - S.sx[i], dy = S.sy[j] - S.sy[i], m = Math.hypot(dx, dy) || 1;
      const [px, py] = toScreen(S.sx[i] - dy / m * off, S.sy[i] + dx / m * off);
      n ? cx.lineTo(px, py) : cx.moveTo(px, py);
      if (i === b) break;
      i = j;
    }
    cx.strokeStyle = '#ff9f43'; cx.lineWidth = Math.max(2, L.pit.width / L.scale * z * 0.6); cx.stroke();
  }

  // direction arrows every 150 m, start line, sector marks
  cx.fillStyle = '#f2efe6';
  for (let i = 60; i < N; i += 150) arrow(i);
  tick(0, '#fff', 'S/F');
  L.sectors.forEach((p, n) => tick(indexOfParam(p), '#ffd21f', 'S' + (n + 2)));

  // control points
  pts().forEach((p, n) => {
    const [px, py] = toScreen(p[0], p[1]), sel = n === S.sel;
    cx.beginPath(); cx.arc(px, py, (sel ? 9 : 6) * k, 0, 7);
    cx.fillStyle = sel ? '#ffd21f' : n === 0 ? '#fff' : '#14181d'; cx.fill();
    cx.lineWidth = 2 * k; cx.strokeStyle = '#f2efe6'; cx.stroke();
    if (z > 0.5 || sel) { cx.fillStyle = '#f2efe6'; cx.font = `${11 * k}px sans-serif`; cx.fillText(String(n), px + 9 * k, py - 7 * k); }
  });

  if (S.pending !== null) {
    const i = indexOfParam(S.pending), [px, py] = toScreen(S.sx[i], S.sy[i]);
    cx.beginPath(); cx.arc(px, py, 10 * k, 0, 7); cx.strokeStyle = '#ffd21f'; cx.lineWidth = 3 * k; cx.stroke();
  }
}

function drawGrid() {
  const k = devicePixelRatio || 1, step = 50 * S.view.zoom >= 18 ? 50 : 200, tl = toWorld(0, 0), br = toWorld(cv.width, cv.height);
  cx.strokeStyle = 'rgba(255,255,255,.06)'; cx.lineWidth = k;
  cx.beginPath();
  for (let x = Math.floor(tl.x / step) * step; x < br.x; x += step) { const [a] = toScreen(x, 0); cx.moveTo(a, 0); cx.lineTo(a, cv.height); }
  for (let y = Math.floor(tl.y / step) * step; y < br.y; y += step) { const [, b] = toScreen(0, y); cx.moveTo(0, b); cx.lineTo(cv.width, b); }
  cx.stroke();
}

function arrow(i) {
  const j = (i + 6) % S.line.N, [ax, ay] = toScreen(S.sx[i], S.sy[i]), [bx, by] = toScreen(S.sx[j], S.sy[j]), k = devicePixelRatio || 1;
  const a = Math.atan2(by - ay, bx - ax), r = 6 * k;
  cx.beginPath();
  cx.moveTo(ax + Math.cos(a) * r, ay + Math.sin(a) * r);
  cx.lineTo(ax + Math.cos(a + 2.4) * r, ay + Math.sin(a + 2.4) * r);
  cx.lineTo(ax + Math.cos(a - 2.4) * r, ay + Math.sin(a - 2.4) * r);
  cx.fill();
}

function tick(i, colour, label) {
  const j = (i + 1) % S.line.N, k = devicePixelRatio || 1;
  const dx = S.sx[j] - S.sx[i], dy = S.sy[j] - S.sy[i], m = Math.hypot(dx, dy) || 1;
  const r = (S.layout.width / 2 + 4) / S.layout.scale;
  const [ax, ay] = toScreen(S.sx[i] + dy / m * r, S.sy[i] - dx / m * r), [bx, by] = toScreen(S.sx[i] - dy / m * r, S.sy[i] + dx / m * r);
  cx.beginPath(); cx.moveTo(ax, ay); cx.lineTo(bx, by);
  cx.strokeStyle = colour; cx.lineWidth = 3 * k; cx.stroke();
  cx.fillStyle = colour; cx.font = `bold ${12 * k}px sans-serif`; cx.fillText(label, ax + 4 * k, ay - 4 * k);
}

// ---------------------------------------------------------------------------
// Pointer handling

function wire() {
  cv = root.querySelector('canvas');
  cx = cv.getContext('2d');
  sizeCanvas();
  fit();

  const own = e => e.stopPropagation();       // keep typing and clicks from reaching the game
  root.addEventListener('keydown', own); root.addEventListener('keyup', own);

  let drag = null, lastTap = 0;
  const pos = e => { const r = cv.getBoundingClientRect(), k = devicePixelRatio || 1; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
  const hitPoint = (sx, sy) => {
    const k = devicePixelRatio || 1;
    let best = -1, bd = (16 * k) ** 2;
    pts().forEach((p, n) => { const [px, py] = toScreen(p[0], p[1]); const d = (px - sx) ** 2 + (py - sy) ** 2; if (d < bd) { bd = d; best = n; } });
    return best;
  };

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const [sx, sy] = pos(e), hit = hitPoint(sx, sy);
    drag = { sx, sy, moved: false, hit, vx: S.view.x, vy: S.view.y };
    if (S.tool === 'points' && hit >= 0) { S.sel = hit; syncPanel(); }
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const [sx, sy] = pos(e);
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (S.tool === 'points' && drag.hit >= 0) {
      const w = toWorld(sx, sy), p = pts()[drag.hit];
      p[0] = Math.round(w.x); p[1] = Math.round(w.y);
      S.dirty = true; rebuild();
    } else {
      S.view.x = drag.vx - (sx - drag.sx) / S.view.zoom;
      S.view.y = drag.vy - (sy - drag.sy) / S.view.zoom;
    }
    draw();
  });
  cv.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) { syncPanel(); return; }
    const [sx, sy] = pos(e), now = performance.now(), dbl = now - lastTap < 350;
    lastTap = now;
    click(sx, sy, d.hit, dbl);
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = pos(e), before = toWorld(sx, sy);
    S.view.zoom = Math.min(8, Math.max(0.1, S.view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(sx, sy);
    S.view.x += before.x - after.x; S.view.y += before.y - after.y;
    draw();
  }, { passive: false });
  addEventListener('resize', () => { if (isMakerOpen()) { sizeCanvas(); draw(); } });
  root.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if ((e.code === 'Delete' || e.code === 'Backspace') && S.sel >= 0) { deletePoint(S.sel); changed(); }
    if (e.code === 'Escape') { if (S.pending !== null) { S.pending = null; draw(); } else close(); }
  });

  root.addEventListener('click', onButton);
  root.addEventListener('input', onInput);
}

function click(sx, sy, hit, dbl) {
  const L = S.layout;
  if (S.tool === 'points') {
    if (hit >= 0) return;
    const near = paramAtScreen(sx, sy);
    if (dbl && near) { const w = toWorld(sx, sy); insertPoint(Math.floor(near.p) % nPts(), w.x, w.y); changed(); return; }
    S.sel = -1; syncPanel(); draw();
    return;
  }
  if (S.tool === 'add') {
    const near = paramAtScreen(sx, sy, 1e5);
    const w = toWorld(sx, sy);
    insertPoint(Math.floor(near.p) % nPts(), w.x, w.y);
    S.tool = 'points'; changed();
    return;
  }
  const near = paramAtScreen(sx, sy, 40);
  if (!near) return say('Click on the track.');
  if (S.pending === null) { S.pending = near.p; say('Now click where it ends.'); draw(); return; }
  const a = S.pending, b = near.p;
  S.pending = null;
  if (S.tool === 'sectors') {
    L.sectors = [a, b].sort((p, q) => p - q);
    if (L.sectors[0] < 0.5) say('Sector 2 must start after the start line.');
  } else if (S.tool === 'drs') L.drs.push([a, b]);
  else if (S.tool === 'bridge') L.bridge = [a, b];
  else if (S.tool === 'pit') { L.pit.entry = a; L.pit.exit = b; }
  else {
    const def = ZONE_KINDS[S.tool];
    L[S.tool].push(def.width ? [a, b, S.side, S.zoneWidth] : [a, b, S.side]);
  }
  changed();
  say('Added.');
}

function onButton(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const L = S.layout;
  if (b.dataset.tool) { S.tool = b.dataset.tool; S.pending = null; say(TOOLS.find(t => t[0] === S.tool)[2]); syncPanel(); draw(); return; }
  if (b.dataset.side) { S.side = b.dataset.side; syncPanel(); return; }
  if (b.dataset.del) {
    const [kind, n] = b.dataset.del.split(':');
    if (kind === 'drs') L.drs.splice(+n, 1);
    else if (kind === 'bridge') L.bridge = null;
    else L[kind].splice(+n, 1);
    changed(); return;
  }
  if (b.dataset.load) { const t = getTrack(b.dataset.load); if (t) { S.layout = JSON.parse(JSON.stringify(t.layout)); S.id = t.id; S.sel = -1; changed(); fit(); draw(); say('Loaded.'); } return; }
  if (b.dataset.remove) { deleteTrack(b.dataset.remove); if (S.id === b.dataset.remove) S.id = null; syncPanel(); return; }
  switch (b.id) {
    case 'm-close': close(); break;
    case 'm-fit': fit(); draw(); break;
    case 'm-new': S.layout = newLayout(); S.id = null; S.sel = -1; changed(); fit(); draw(); break;
    case 'm-del': if (S.sel >= 0) { deletePoint(S.sel); changed(); } else say('Select a point first.'); break;
    case 'm-start': if (S.sel >= 0) { startHere(S.sel); changed(); } else say('Select a point first.'); break;
    case 'm-save': save(); break;
    case 'm-drive': drive(); break;
    case 'm-lakeside': setActive(null); location.href = location.pathname; break;
    case 'm-export': download(); break;
    case 'm-import': root.querySelector('#m-file').click(); break;
  }
}

function onInput(e) {
  const t = e.target, L = S.layout;
  if (t.id === 'm-file') {
    const f = t.files[0];
    if (!f) return;
    f.text().then(txt => {
      try { S.layout = importJSON(txt); S.id = null; S.sel = -1; changed(); fit(); draw(); say(`Imported ${S.layout.name}. Save it to keep it.`); } catch (err) { say(err.message); }
    });
    t.value = '';
    return;
  }
  if (t.id === 'm-name') L.name = t.value.slice(0, 40);
  else if (t.id === 'm-width') L.width = +t.value;
  else if (t.id === 'm-scale') L.scale = +t.value;
  else if (t.id === 'm-hills') L.heightScale = +t.value;
  else if (t.id === 'm-height' && S.sel >= 0) pts()[S.sel][2] = +t.value;
  else if (t.id === 'm-zw') { S.zoneWidth = +t.value; syncPanel(); return; }
  else return;
  S.dirty = true;
  rebuild(); syncPanel(false); draw();
}

function changed() { S.dirty = true; rebuild(); syncPanel(); draw(); }

// ---------------------------------------------------------------------------
// Saving and driving

function save() {
  const L = S.layout, bad = problems(L);
  if (bad) { say(bad); return null; }
  const id = saveTrack(S.id, L);
  if (!id) { say('The browser would not save it (private mode or storage full). Use Export to keep a copy.'); return null; }
  S.id = id; S.dirty = false;
  say('Saved.');
  syncPanel();
  return id;
}

function drive() {
  try { buildTrack(normalise(S.layout), []); } catch (err) { return say('This layout cannot be built: ' + err.message); }
  const id = save();
  if (!id) return;
  setActive(id);
  location.href = location.pathname + '?track=' + id;
}

function download() {
  const blob = new Blob([exportJSON(S.layout)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.layout.name || 'track').replace(/[^\w-]+/g, '-').toLowerCase() + '.lakeside.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------------------
// Panel

function markup() {
  return `
<div class="m-wrap">
  <canvas></canvas>
  <aside class="m-panel">
    <div class="m-head"><h2>Track maker</h2><button id="m-close" class="m-x" aria-label="Close">Close</button></div>
    <input id="m-name" class="m-text" maxlength="40" aria-label="Track name">
    <div class="m-tools">${TOOLS.map(([k, label]) => `<button data-tool="${k}">${label}</button>`).join('')}</div>
    <p id="m-msg" class="m-hint"></p>
    <div id="m-zone-opts" class="m-row">
      <span>Side</span><button data-side="L">Left</button><button data-side="R">Right</button><button data-side="both">Both</button>
      <span id="m-zw-wrap">Width <input id="m-zw" type="range" min="3" max="50" step="1"><b id="m-zw-v"></b></span>
    </div>
    <div id="m-point" class="m-box">
      <div class="m-row"><span>Point <b id="m-pn"></b></span><button id="m-start">Start line here</button><button id="m-del">Delete</button></div>
      <label>Height <input id="m-height" type="range" min="0" max="120" step="1"><b id="m-hv"></b></label>
    </div>
    <div class="m-box">
      <label>Track width <input id="m-width" type="range" min="9" max="18" step="0.5"><b id="m-wv"></b></label>
      <label>Size <input id="m-scale" type="range" min="1" max="4" step="0.1"><b id="m-sv"></b></label>
      <label>Hills <input id="m-hills" type="range" min="0" max="1" step="0.05"><b id="m-hl"></b></label>
    </div>
    <div id="m-info" class="m-info"></div>
    <div id="m-zones" class="m-zones"></div>
    <div class="m-row m-actions">
      <button id="m-save">Save</button><button id="m-drive" class="m-go">Drive it</button>
    </div>
    <div class="m-row">
      <button id="m-new">New</button><button id="m-export">Export</button><button id="m-import">Import</button><button id="m-fit">Fit view</button>
      <input id="m-file" type="file" accept=".json,application/json" hidden>
    </div>
    <div class="m-label">Saved tracks</div>
    <div id="m-saved" class="m-saved"></div>
    <button id="m-lakeside" class="m-lake">Back to Lakeside</button>
  </aside>
</div>`;
}

function updateInfo() {
  const el = root && root.querySelector('#m-info');
  if (el) el.innerHTML = S.checks.map(c => c.startsWith('WARN ') ? `<div class="m-warn">${c.slice(5)}</div>` : `<div>${c}</div>`).join('');
}

function syncPanel(full = true) {
  const L = S.layout, q = s => root.querySelector(s), set = (id, v, out, fmt) => { const el = q(id); if (el && document.activeElement !== el) el.value = v; if (out) q(out).textContent = fmt; };
  if (document.activeElement !== q('#m-name')) q('#m-name').value = L.name;
  root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('sel', b.dataset.tool === S.tool));
  root.querySelectorAll('[data-side]').forEach(b => b.classList.toggle('sel', b.dataset.side === S.side));
  const zoneTool = ZONE_KINDS[S.tool];
  q('#m-zone-opts').hidden = !zoneTool;
  q('#m-zw-wrap').hidden = !(zoneTool && zoneTool.width);
  set('#m-zw', S.zoneWidth, '#m-zw-v', ` ${S.zoneWidth} m`);
  q('#m-point').hidden = S.sel < 0;
  if (S.sel >= 0) {
    q('#m-pn').textContent = S.sel;
    set('#m-height', pts()[S.sel][2], '#m-hv', ` ${(pts()[S.sel][2] * L.heightScale).toFixed(0)} m`);
  }
  set('#m-width', L.width, '#m-wv', ` ${L.width} m`);
  set('#m-scale', L.scale, '#m-sv', ` ${L.scale.toFixed(1)}`);
  set('#m-hills', L.heightScale, '#m-hl', ` ${L.heightScale.toFixed(2)}`);
  if (!full) return;
  const rows = [];
  L.drs.forEach((z, n) => rows.push(['drs:' + n, `DRS ${z[0].toFixed(1)} to ${z[1].toFixed(1)}`]));
  if (L.bridge) rows.push(['bridge:0', `Bridge ${L.bridge[0].toFixed(1)} to ${L.bridge[1].toFixed(1)}`]);
  for (const [kind, def] of Object.entries(ZONE_KINDS)) L[kind].forEach((z, n) => rows.push([`${kind}:${n}`, `${def.label} ${z[0].toFixed(1)} to ${z[1].toFixed(1)} ${z[2]}${z[3] ? ' ' + z[3] + ' m' : ''}`]));
  q('#m-zones').innerHTML = rows.map(([k, t]) => `<div class="m-zone"><span>${t}</span><button data-del="${k}" aria-label="Remove">x</button></div>`).join('')
    || '<div class="m-none">No zones yet.</div>';
  q('#m-saved').innerHTML = listTracks().map(t => `<div class="m-zone"><button data-load="${t.id}" class="m-name${t.id === S.id ? ' sel' : ''}">${escape(t.layout.name)}</button><button data-remove="${t.id}" aria-label="Delete saved track">x</button></div>`).join('')
    || '<div class="m-none">Nothing saved yet.</div>';
  updateInfo();
  if (S.msg) q('#m-msg').textContent = S.msg;
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
