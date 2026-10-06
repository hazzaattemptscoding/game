// The in-game track map: a small canvas in a corner of the HUD. The circuit outline, the start/finish line and the sector marks are
// drawn once to an offscreen canvas (again only when the size, zoom or pixel ratio changes); each frame copies that image in
// one drawImage call and adds the dots: your car (a wedge with a white ring), other cars in their livery colour, corner numbers.
// The maths for where the view sits is in viewTransform, which needs no page, so tools/hudsettings.js tests it.

import { CORNERS } from './corners.js';
import { MAP_SIZES } from './hudSettings.js';

export const LOCAL_SPAN = 600;   // metres across the map in the zoomed view
const PAD = 8;                   // CSS pixels kept clear at the edge in the whole circuit view

export function trackBounds(track) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < track.N; i++) {
    x0 = Math.min(x0, track.x[i]); x1 = Math.max(x1, track.x[i]);
    z0 = Math.min(z0, track.z[i]); z1 = Math.max(z1, track.z[i]);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let r = 0;
  for (let i = 0; i < track.N; i++) r = Math.max(r, Math.hypot(track.x[i] - cx, track.z[i] - cz));
  return { x0, x1, z0, z1, cx, cz, radius: r };
}

// Where the view is. Screen = rotate(angle) * k * (world - centre) + (size / 2, size / 2), with x right and z down.
// Returns { k, cx, cz, angle }: k pixels per metre, the world point at the middle of the map and the rotation.
//   mode 'local': centred on the car, LOCAL_SPAN metres across. mode 'circuit': the whole track, centred on its middle.
//   rotate: the car's heading points up the screen. In the whole circuit view the turn is about the middle of the track
//   and the scale fits the track's circumradius, so no part of it leaves the map at any heading.
export function viewTransform({ mode, rotate, size, bounds, car }) {
  const angle = rotate ? -Math.PI / 2 - car.heading : 0;
  if (mode === 'local') return { k: size / LOCAL_SPAN, cx: car.x, cz: car.z, angle };
  const half = size / 2 - PAD;
  const k = rotate ? half / bounds.radius : Math.min(half * 2 / (bounds.x1 - bounds.x0), half * 2 / (bounds.z1 - bounds.z0));
  return { k, cx: bounds.cx, cz: bounds.cz, angle };
}

export const project = (t, size, x, z, out = {}) => {
  const dx = (x - t.cx) * t.k, dz = (z - t.cz) * t.k, c = Math.cos(t.angle), s = Math.sin(t.angle);
  out.x = size / 2 + dx * c - dz * s; out.y = size / 2 + dx * s + dz * c;
  return out;
};

// corner numbers in lap order: [{ n, name, i (track sample), side (+1 right, -1 left, the outside of the bend) }]
export function cornerMarks(track, corners = CORNERS) {
  return [...corners].filter(c => Number.isFinite(c.apexS)).sort((a, b) => a.apexS - b.apexS).map((c, n) => ({
    n: n + 1, name: c.name, i: Math.round(c.apexS / track.ds) % track.N, side: c.outside === 'L' ? -1 : 1,
  }));
}

// minisector colours on the outline (src/minisectors.js)
export const MINI_COLOURS = { purple: '#b36bff', green: '#3ddc84', yellow: '#ffd21f' };

export function createMiniMap(root, { track, car, lobby, settings, ownColour, timer }) {
  const bounds = trackBounds(track), marks = cornerMarks(track);
  const el = document.createElement('div');
  el.id = 'trackmap';
  const canvas = document.createElement('canvas');
  el.append(canvas);
  root.append(el);
  const g = canvas.getContext('2d');
  const base = document.createElement('canvas'), bg = base.getContext('2d');
  let baseKey = '', baseInfo = null, size = 0, dpr = 1, posClass = '', shown = null;
  const pt = {}, pose = {};

  // the outline, drawn in the cache's own pixel space: pixel = (world - (x0, z0)) * kc + margin
  function buildBase(mode, sizeCss, ratio, colours) {
    const k0 = viewTransform({ mode, rotate: false, size: sizeCss, bounds, car }).k;
    const wm = bounds.x1 - bounds.x0, hm = bounds.z1 - bounds.z0, margin = 24;
    const kc = Math.min(k0 * ratio, (2048 - 2 * margin) / Math.max(wm, hm));
    base.width = Math.ceil(wm * kc + 2 * margin); base.height = Math.ceil(hm * kc + 2 * margin);
    const px = x => (x - bounds.x0) * kc + margin, pz = z => (z - bounds.z0) * kc + margin;
    const per = kc / k0;   // cache pixels per CSS pixel of the map, so the line widths below are in CSS pixels
    bg.clearRect(0, 0, base.width, base.height);
    bg.lineJoin = 'round'; bg.lineCap = 'round';
    const step = Math.max(1, Math.round(3 / track.ds));
    bg.beginPath();
    for (let i = 0; i < track.N; i += step) (i ? bg.lineTo : bg.moveTo).call(bg, px(track.x[i]), pz(track.z[i]));
    bg.closePath();
    const wide = mode === 'local';
    bg.strokeStyle = 'rgba(242,239,230,.9)'; bg.lineWidth = (wide ? 7 : 5.5) * per; bg.stroke();
    bg.strokeStyle = 'rgba(20,24,29,.95)'; bg.lineWidth = (wide ? 4.5 : 3) * per; bg.stroke();
    // minisectors of this lap (the last lap's colours for the ones not reached yet) over the dark centre of the outline;
    // the timer counts in lap order, which is mirrored in reverse
    if (colours) {
      const B = timer.minis.bounds, L = track.length, rev = timer.reverse;
      bg.lineCap = 'butt'; bg.lineWidth = (wide ? 4.5 : 3) * per;
      colours.forEach((c, k) => {
        if (!c) return;
        const a = rev ? L - B[k + 1] : B[k], b = rev ? L - B[k] : B[k + 1];
        const i0 = Math.round(a / track.ds), i1 = Math.round(b / track.ds);
        bg.beginPath();
        for (let i = i0; i <= i1; i += step) (i === i0 ? bg.moveTo : bg.lineTo).call(bg, px(track.x[i % track.N]), pz(track.z[i % track.N]));
        bg.lineTo(px(track.x[i1 % track.N]), pz(track.z[i1 % track.N]));
        bg.strokeStyle = MINI_COLOURS[c]; bg.stroke();
      });
      bg.lineCap = 'round';
    }
    // a cross mark over the road at sample i, `len` CSS pixels long
    const tick = (i, len, col, w) => {
      const x = track.x[i], z = track.z[i], nx = track.nx[i] * len / 2 / k0, nz = track.nz[i] * len / 2 / k0;
      bg.beginPath(); bg.moveTo(px(x - nx), pz(z - nz)); bg.lineTo(px(x + nx), pz(z + nz));
      bg.strokeStyle = col; bg.lineWidth = w * per; bg.lineCap = 'butt'; bg.stroke();
    };
    for (const s of track.sectors.slice(1)) tick(Math.round(s / track.ds) % track.N, wide ? 13 : 10, '#ffd21f', 2);
    tick(0, wide ? 15 : 12, '#ffffff', 3.5);
    baseInfo = { kc, margin };
  }

  function layout() {
    const st = settings.trackMap, scale = (settings.hudScale || 100) / 100;
    const want = Math.round(Math.min(MAP_SIZES[st.size] * scale, innerWidth * 0.42));
    const ratio = Math.min(2, devicePixelRatio || 1);
    if (want !== size || ratio !== dpr) {
      size = want; dpr = ratio;
      el.style.width = el.style.height = size + 'px';
      canvas.width = canvas.height = Math.round(size * dpr);
      baseKey = '';
    }
    const cls = 'pos-' + st.position;
    if (cls !== posClass) { if (posClass) el.classList.remove(posClass); el.classList.add(cls); posClass = cls; }
    el.style.opacity = st.opacity;
    const colours = settings.hud.minisectors && timer ? timer.minis.display() : null;
    const key = st.zoom + '|' + size + '|' + dpr + '|' + (colours ? colours.join() : '') + '|' + (timer && timer.reverse);
    if (key !== baseKey) { baseKey = key; buildBase(st.zoom, size, dpr, colours); }
  }

  const dot = (x, y, r, fill, ring, rw) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill(); g.lineWidth = rw; g.strokeStyle = ring; g.stroke();
  };

  function update() {
    const st = settings.trackMap;
    const on = st.on && settings.hud && !document.body.classList.contains('menu-main');
    if (on !== shown) { el.hidden = !on; shown = on; }
    if (!on) return;
    layout();
    const t = viewTransform({ mode: st.zoom, rotate: st.rotate, size, bounds, car });
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath(); g.rect(0, 0, size, size); g.clip();
    g.fillStyle = 'rgba(20,24,29,.5)'; g.fillRect(0, 0, size, size);
    // the cached outline, moved to the view in one call
    const { kc, margin } = baseInfo;
    g.translate(size / 2, size / 2); g.rotate(t.angle); g.scale(t.k / kc, t.k / kc);
    g.drawImage(base, -((t.cx - bounds.x0) * kc + margin), -((t.cz - bounds.z0) * kc + margin));
    g.restore();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (st.labels === 'numbers') {
      g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const m of marks) {
        const off = 11 / t.k * m.side;   // 11 px out from the road, on the outside of the bend
        project(t, size, track.x[m.i] + track.nx[m.i] * off, track.z[m.i] + track.nz[m.i] * off, pt);
        if (pt.x < 4 || pt.y < 4 || pt.x > size - 4 || pt.y > size - 4) continue;
        g.fillStyle = 'rgba(242,239,230,.92)'; g.fillText(m.n, pt.x, pt.y);
      }
    }

    // other cars (online ghosts), in their livery colour
    if (lobby && lobby.ghosts && lobby.ghosts.size) {
      const now = performance.now();
      for (const gh of lobby.ghosts.map.values()) {
        if (!gh.buf.sample(now, pose)) continue;
        project(t, size, pose.x, pose.z, pt);
        if (pt.x < -6 || pt.y < -6 || pt.x > size + 6 || pt.y > size + 6) continue;
        g.globalAlpha = gh.opacity == null ? 1 : gh.opacity;
        dot(pt.x, pt.y, 3.6, (gh.livery && gh.livery.body) || '#ccc', 'rgba(0,0,0,.8)', 1.4);
        g.globalAlpha = 1;
      }
    }

    // your car: a wedge pointing the way it faces, in your livery colour with a white ring
    project(t, size, car.x, car.z, pt);
    const a = car.heading + t.angle;
    g.save(); g.translate(pt.x, pt.y); g.rotate(a);
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-5.5, 5.5); g.lineTo(-2.5, 0); g.lineTo(-5.5, -5.5); g.closePath();
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
    g.restore();
    dot(pt.x, pt.y, 5.2, ownColour ? ownColour() : '#ffd21f', '#fff', 2);
    g.save(); g.translate(pt.x, pt.y); g.rotate(a);
    g.beginPath(); g.moveTo(11, 0); g.lineTo(5, 4.2); g.lineTo(5, -4.2); g.closePath();
    g.fillStyle = '#fff'; g.fill();
    g.restore();
  }

  return { el, update };
}
