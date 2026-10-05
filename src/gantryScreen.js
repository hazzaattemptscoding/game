// LED screen on the start/finish gantry, drawn every frame onto a canvas.
// 4.5:1, no three.js in here: main.js wraps `screen.canvas` in a CanvasTexture.
//
// Left alone it loops: Lakeside ident, PowerMedia, a circuit advert, DeltaDash,
// a second circuit advert. The race can interrupt it:
//
//   screen.lights(n)            n red lights lit, 0 to 5 (start sequence)
//   screen.go()                 lights out: green GO, then back to the loop
//   screen.lap({ lap, of, time, kind, delta })
//                               lap board as a car crosses the line.
//                               kind: 'fastest' (purple), 'pb' (green) or none;
//                               delta in seconds to the best lap; `of` is the race length
//   screen.flag('yellow' | 'red' | 'green' | 'final' | 'chequered', { text })
//   screen.clear()              drop any flag or board and go back to the loop
//   screen.message(text)        a line of text on a plain board, held until clear() (the control panel's custom message)
//   screen.setAd(name, on)      take one loop scene out of (or back into) the loop; at least one always stays in
//   screen.next()               skip to the next scene in the loop
//   screen.draw(seconds)        call once per rendered frame
//
// Edit COPY to change the adverts. Edit LOOP to change the order and timings.

export const SCREEN_W = 1440, SCREEN_H = 320;
const W = SCREEN_W, H = SCREEN_H;
const SLANT = 0.19;   // lean of every edge, matched to the PowerMedia logo

const C = {
  ink: '#0b0c10', panel: '#15171d', white: '#f8f8f8', dim: '#a9adb8',
  purple: '#6d28d9', purpleDeep: '#4c1d95', delta: '#8418f6',
  lake: '#19c8b9', lakeDeep: '#06282c',
  red: '#ff2a1a', redOff: '#2a0808', green: '#00c853', yellow: '#ffd400',
};

export const COPY = {
  circuit: 'LAKESIDE',
  strap: 'KENT  ·  ENGLAND  ·  EST. 1952',
  ad1: { eyebrow: 'RACING RETURNS TO THE RUNWAY', headline: 'INTERNATIONAL TROPHY', action: 'TICKETS ON SALE NOW' },
  ad2: { eyebrow: 'TRACK DAYS  ·  EXPERIENCES  ·  HOSPITALITY', headline: 'DRIVE LAKESIDE', action: 'BOOK YOUR LAP' },
};

// [scene, seconds on screen]
export const LOOP = [['lakeside', 4.5], ['powermedia', 5], ['ad1', 6], ['deltadash', 5], ['ad2', 6]];

const font = (weight, size, italic = true) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px "Barlow Condensed", "Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
const clamp01 = v => Math.max(0, Math.min(1, v));
const outCubic = v => 1 - Math.pow(1 - clamp01(v), 3);
const inOut = v => { v = clamp01(v); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };

export function fmtLap(t) {
  if (t == null) return '-:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// trackPath: [[x, y], ...] centreline points, any units. logos: { powermedia, deltadash } images.
// facts: { km, turns, drs } for the circuit advert.
export function createGantryScreen({ canvas, logos = {}, trackPath = [], facts = {}, led = true } = {}) {
  canvas ||= document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d');
  const map = fitPath(trackPath, 470, 236);
  const grid = led ? ledGrid() : null;

  // ---- drawing helpers ----------------------------------------------------
  const ready = img => img && (img.complete === undefined || img.complete) && (img.naturalWidth || img.width) > 0;

  function text(str, px, py, f, colour, align = 'left', spacing = 0) {
    x.font = f; x.fillStyle = colour; x.textAlign = align; x.textBaseline = 'alphabetic';
    if ('letterSpacing' in x) x.letterSpacing = spacing + 'px';
    x.fillText(str, px, py);
    if ('letterSpacing' in x) x.letterSpacing = '0px';
  }
  // biggest size up to `size` at which `str` fits in `max` pixels
  function fit(str, weight, size, max, spacing = 0) {
    x.font = font(weight, size);
    const w = x.measureText(str).width + spacing * str.length;
    return w > max ? Math.floor(size * max / w) : size;
  }
  // parallelogram leaning with SLANT, x measured along the bottom edge
  function slab(x0, x1, colour, y0 = 0, y1 = H) {
    x.fillStyle = colour;
    x.beginPath();
    x.moveTo(x0 + (H - y0) * SLANT, y0); x.lineTo(x1 + (H - y0) * SLANT, y0);
    x.lineTo(x1 + (H - y1) * SLANT, y1); x.lineTo(x0 + (H - y1) * SLANT, y1);
    x.closePath(); x.fill();
  }
  function clipSlab(x0, x1) {
    x.beginPath();
    x.moveTo(x0 + H * SLANT, 0); x.lineTo(x1 + H * SLANT, 0); x.lineTo(x1, H); x.lineTo(x0, H);
    x.closePath(); x.clip();
  }
  // faint leaning bars drifting sideways behind a scene
  function bars(t, colour, alpha, speed = 26, gap = 150, width = 46) {
    x.globalAlpha = alpha;
    const off = (t * speed) % gap;
    for (let bx = -gap * 2 + off; bx < W + gap; bx += gap) slab(bx, bx + width, colour);
    x.globalAlpha = 1;
  }
  function logo(img, cx, cy, width, reveal = 1) {
    if (!ready(img)) return;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const h = width * ih / iw, lx = cx - width / 2;
    x.save();
    if (reveal < 1) clipSlab(lx - H * SLANT - 20, lx - H * SLANT - 20 + (width + H * SLANT + 40) * reveal);
    x.drawImage(img, lx, cy - h / 2, width, h);
    x.restore();
  }
  function pill(str, px, py, bg, fg, size = 40) {
    x.font = font(800, size);
    const w = x.measureText(str).width + 3 * str.length + 56;
    slab(px - (H - py) * SLANT, px + w - (H - py) * SLANT, bg, py - size * 0.95, py + size * 0.42);
    text(str, px + 30, py, font(800, size), fg, 'left', 3);
    return w;
  }

  // ---- loop scenes --------------------------------------------------------
  const scenes = {
    lakeside(t) {
      x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
      bars(t, C.lake, 0.07);
      const p = outCubic(t / 0.7);
      slab(-80, -80 + 230 * p, C.lake);
      slab(170 * p - 20, 170 * p + 8, C.white);
      x.save();
      clipSlab(-200, -200 + (W + 400) * p);
      const size = fit(COPY.circuit, 800, 252, 1020, 6);
      text(COPY.circuit, W / 2 + 96 + (1 - p) * 70, 118 + size * 0.36, font(800, size), C.white, 'center', 6);
      x.restore();
      x.globalAlpha = outCubic((t - 0.5) / 0.6);
      text(COPY.strap, W / 2 + 96, 272, font(600, 38, false), C.lake, 'center', 7);
      x.globalAlpha = 1;
    },

    powermedia(t) {
      x.fillStyle = C.purple; x.fillRect(0, 0, W, H);
      bars(t, C.purpleDeep, 0.55, 34, 360, 150);
      logo(logos.powermedia, W / 2, H / 2 + 2, 800, inOut((t - 0.25) / 0.7));
    },

    deltadash(t) {
      x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
      // rising chevrons, the shape of the logo's A
      x.strokeStyle = C.delta; x.lineWidth = 26; x.lineJoin = 'miter';
      for (let k = 0; k < 2; k++) {
        const cx = k ? W - 96 : 96;
        for (let j = -1; j < 5; j++) {
          const y = H + 30 - ((t * 44 + j * 90) % 450);
          x.globalAlpha = 0.5 * clamp01(y / H + 0.15);
          x.beginPath(); x.moveTo(cx - 62, y + 58); x.lineTo(cx, y - 58); x.lineTo(cx + 62, y + 58); x.stroke();
        }
      }
      x.globalAlpha = 1;
      logo(logos.deltadash, W / 2, H / 2, 1010, inOut((t - 0.25) / 0.8));
    },

    ad1(t) {
      x.fillStyle = C.lakeDeep; x.fillRect(0, 0, W, H);
      bars(t, C.lake, 0.06);
      const a = COPY.ad1, p = outCubic(t / 0.6), q = outCubic((t - 0.25) / 0.6), r = outCubic((t - 0.6) / 0.5);
      x.globalAlpha = p;
      text(a.eyebrow, 76, 82, font(600, 34, false), C.lake, 'left', 5);
      x.globalAlpha = q;
      const size = fit(a.headline, 800, 150, 820, 2);
      text(a.headline, 72 + (1 - q) * 50, 82 + size * 0.88 + 12, font(800, size), C.white, 'left', 2);
      x.globalAlpha = r;
      pill(a.action, 96, 268, Math.floor(t * 1.6) % 2 ? C.white : C.lake, C.ink);
      x.globalAlpha = 1;
      trackMap(940, 42, t, 0.5);
    },

    ad2(t) {
      x.fillStyle = C.white; x.fillRect(0, 0, W, H);
      slab(880, W + 100, C.ink);
      slab(852, 872, C.lake);
      const a = COPY.ad2, p = outCubic(t / 0.6), q = outCubic((t - 0.25) / 0.6), r = outCubic((t - 0.6) / 0.5);
      x.globalAlpha = p;
      text(a.eyebrow, 76, 82, font(600, 30, false), '#0d6f68', 'left', 3);
      x.globalAlpha = q;
      const size = fit(a.headline, 800, 160, 760, 2);
      text(a.headline, 72 + (1 - q) * 50, 82 + size * 0.88 + 8, font(800, size), C.ink, 'left', 2);
      x.globalAlpha = r;
      pill(a.action, 96, 270, C.ink, C.white);
      // circuit facts count up on the dark side
      const stats = [[facts.km, 'KM', 2], [facts.turns, 'TURNS', 0], [facts.drs, 'DRS ZONES', 0]].filter(s => s[0] != null);
      stats.forEach(([v, label, dp], k) => {
        const s = outCubic((t - 0.5 - k * 0.18) / 0.9), cx = 1010 + k * 172;
        x.globalAlpha = clamp01(s * 3);
        const big = fit(v.toFixed(dp), 800, 118, 150);
        text((v * s).toFixed(dp), cx, 184, font(800, big), C.white, 'center');
        text(label, cx - 8, 228, font(600, fit(label, 600, 28, 150, 2), false), C.lake, 'center', 2);
      });
      x.globalAlpha = 1;
    },
  };

  // circuit outline that draws itself, then a car dot lapping it
  function trackMap(ox, oy, t, delay) {
    if (!map) return;
    const p = inOut((t - delay) / 1.6);
    x.save();
    x.translate(ox, oy);
    x.lineJoin = x.lineCap = 'round';
    const trace = () => { x.beginPath(); map.pts.forEach(([px, py], k) => k ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); };
    x.setLineDash([map.length * p, map.length]);
    trace(); x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 17; x.stroke();
    trace(); x.strokeStyle = C.white; x.lineWidth = 7; x.stroke();
    x.setLineDash([]);
    if (p >= 1) {
      const [sx, sy] = map.pts[0], [nx, ny] = map.pts[1], l = Math.hypot(nx - sx, ny - sy) || 1;
      x.strokeStyle = C.lake; x.lineWidth = 6; x.beginPath();   // start/finish tick
      x.moveTo(sx - (ny - sy) / l * 15, sy + (nx - sx) / l * 15); x.lineTo(sx + (ny - sy) / l * 15, sy - (nx - sx) / l * 15); x.stroke();
      const at = ((t - delay - 1.6) / 3.4) % 1;
      for (let k = 8; k >= 0; k--) {
        const [px, py] = map.at((at - k * 0.006 + 1) % 1);
        x.globalAlpha = 1 - k / 9; x.fillStyle = C.lake;
        x.beginPath(); x.arc(px, py, 11 - k * 0.7, 0, 7); x.fill();
      }
      x.globalAlpha = 1;
    }
    x.restore();
  }

  // ---- race boards --------------------------------------------------------
  const boards = {
    lights(t, d) {
      x.fillStyle = '#050506'; x.fillRect(0, 0, W, H);
      const size = 176, gap = 62, x0 = (W - 5 * size - 4 * gap) / 2, y0 = (H - size) / 2;
      for (let k = 0; k < 5; k++) {
        const cx = x0 + k * (size + gap) + size / 2, cy = y0 + size / 2, on = k < d.n;
        x.fillStyle = '#17181c';
        x.beginPath(); x.roundRect(cx - size / 2 - 14, cy - size / 2 - 14, size + 28, size + 28, 26); x.fill();
        if (on) {
          const g = x.createRadialGradient(cx - 18, cy - 22, 8, cx, cy, size * 0.56);
          g.addColorStop(0, '#ff8a70'); g.addColorStop(0.35, C.red); g.addColorStop(1, '#b30c00');
          x.fillStyle = g;
        } else x.fillStyle = C.redOff;
        x.beginPath(); x.arc(cx, cy, size / 2, 0, 7); x.fill();
      }
    },

    go(t) {
      const flash = t < 0.5 && Math.floor(t * 12) % 2 === 1;
      x.fillStyle = flash ? C.white : C.green; x.fillRect(0, 0, W, H);
      x.globalAlpha = 0.16;
      const off = (t * 900) % 220;
      for (let bx = -400 + off; bx < W + 220; bx += 220) slab(bx, bx + 90, '#003d18');
      x.globalAlpha = 1;
      const s = 1 + 0.5 * (1 - outCubic(t / 0.25));
      x.save(); x.translate(W / 2, H / 2); x.scale(s, s);
      text('GO', 0, 104, font(800, 300), C.ink, 'center', 10);
      x.restore();
    },

    lap(t, d) {
      x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
      const p = outCubic(t / 0.45), q = outCubic((t - 0.2) / 0.5), r = outCubic((t - 0.5) / 0.45);
      const tone = d.kind === 'fastest' ? C.delta : d.kind === 'pb' ? C.green : C.lake;
      slab(-120, -120 + 420 * p, tone);
      slab(318 * p - 4, 318 * p + 14, C.white);
      x.globalAlpha = p;
      const onTone = d.kind === 'pb' || !d.kind ? C.ink : C.white;
      text('LAP', 58, 96, font(600, 46, false), onTone, 'left', 6);
      const num = fit(String(d.lap), 800, 190, d.of ? 130 : 210);
      text(String(d.lap), 50, 264, font(800, num), onTone);
      if (d.of) { x.font = font(800, num); const w = x.measureText(String(d.lap)).width; text('/' + d.of, 60 + w, 264, font(800, fit('/' + d.of, 800, 62, 80)), onTone); }
      x.globalAlpha = q;
      const big = fit(fmtLap(d.time), 800, 250, 650);
      text(fmtLap(d.time), 396 + (1 - q) * 60, H / 2 + big * 0.35, font(800, big), C.white);
      x.globalAlpha = r;
      if (d.kind) {
        const label = d.kind === 'fastest' ? ['FASTEST', 'LAP'] : ['PERSONAL', 'BEST'];
        const blink = t < 1.6 && Math.floor(t * 6) % 2 === 0 ? 0.55 : 1;
        x.globalAlpha = r * blink;
        slab(1070, W + 100, tone);
        const sz = fit(label[0], 800, 84, 250, 2);
        text(label[0], 1150, 150, font(800, sz), d.kind === 'pb' ? C.ink : C.white, 'left', 2);
        text(label[1], 1136, 226, font(800, sz), d.kind === 'pb' ? C.ink : C.white, 'left', 2);
      } else if (d.delta != null) {
        const faster = d.delta < 0;
        const str = (faster ? '-' : '+') + Math.abs(d.delta).toFixed(3);
        text('TO BEST', 1404, 112, font(600, 38, false), C.dim, 'right', 4);
        text(str, 1410, 224, font(800, fit(str, 800, 124, 310)), faster ? C.green : C.yellow, 'right');
      }
      x.globalAlpha = 1;
    },

    yellow(t, d) {
      const on = Math.floor(t * 3) % 2 === 0;
      x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
      slab(-100, 230, on ? C.yellow : '#3a3000');
      slab(W - 230 - H * SLANT, W + 100, on ? '#3a3000' : C.yellow);
      slab(256, W - 256 - H * SLANT, C.yellow);
      const label = d.text || 'YELLOW FLAG', size = fit(label, 800, 200, 780, 4);
      text(label, W / 2, H / 2 + size * 0.34, font(800, size), C.ink, 'center', 4);
    },

    red(t, d) {
      const pulse = 0.82 + 0.18 * Math.sin(t * 7);
      x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
      x.globalAlpha = pulse; x.fillStyle = '#e10600'; x.fillRect(0, 0, W, H); x.globalAlpha = 1;
      const label = d.text || 'RED FLAG', size = fit(label, 800, 230, 1200, 8);
      text(label, W / 2, H / 2 + size * 0.34, font(800, size), C.white, 'center', 8);
    },

    green(t, d) {
      x.fillStyle = C.green; x.fillRect(0, 0, W, H);
      bars(t, '#003d18', 0.14, 300, 220, 90);
      const label = d.text || 'TRACK CLEAR', size = fit(label, 800, 210, 1200, 6);
      text(label, W / 2, H / 2 + size * 0.34, font(800, size), C.ink, 'center', 6);
    },

    final(t, d) {
      x.fillStyle = C.white; x.fillRect(0, 0, W, H);
      // chevrons running towards the middle from both ends
      x.strokeStyle = C.ink; x.lineWidth = 30;
      for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
        const cx = W / 2 + side * (720 - ((t * 150 + k * 95) % 190));
        x.globalAlpha = clamp01((Math.abs(cx - W / 2) - 540) / 50);
        x.beginPath(); x.moveTo(cx + side * 50, 40); x.lineTo(cx - side * 50, H / 2); x.lineTo(cx + side * 50, H - 40); x.stroke();
      }
      x.globalAlpha = 1;
      const label = d.text || 'FINAL LAP', s = 1 + 0.25 * (1 - outCubic(t / 0.3));
      x.save(); x.translate(W / 2, H / 2); x.scale(s, s);
      const size = fit(label, 800, 230, 900, 6);
      text(label, 0, size * 0.35, font(800, size), C.ink, 'center', 6);
      x.restore();
    },

    message(t, d) {
      x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
      bars(t, C.purple, 0.12);
      const p = outCubic(t / 0.45);
      slab(-100, -100 + 190 * p, C.purple);
      slab(120 * p - 20, 120 * p + 6, C.white);
      const label = String(d.text || '').toUpperCase(), size = fit(label, 800, 190, 1160, 5);
      x.globalAlpha = p;
      text(label, W / 2 + 70, H / 2 + size * 0.34, font(800, size), C.white, 'center', 5);
      x.globalAlpha = 1;
    },

    chequered(t) {
      const cell = 64, rows = Math.ceil(H / cell) + 2;
      x.fillStyle = C.white; x.fillRect(0, 0, W, H);
      const scroll = t * 150;
      for (let cx = -cell; cx < W + cell; cx += 8) {
        const wave = Math.sin(cx * 0.011 - t * 3.6), yo = wave * 20 - 40;
        const col = Math.floor((cx + scroll) / cell);
        x.fillStyle = C.ink;
        for (let r = (col & 1); r < rows; r += 2) x.fillRect(cx, yo + r * cell, 8, cell);
        x.fillStyle = `rgba(0,0,0,${0.16 * (1 - Math.cos(cx * 0.011 - t * 3.6)) / 2})`;
        x.fillRect(cx, 0, 8, H);
      }
    },
  };

  // ---- what is on screen ---------------------------------------------------
  // `cur` is the layer showing, `prev` the one it is wiping over.
  let now = 0, cur = null, prev = null, wipeAt = -9, wipeFor = 0.55, loopAt = -1, pinned = false;
  const off = new Set();   // loop scenes switched off from the control panel

  function show(kind, name, data, { hold = Infinity, wipe = 0.55 } = {}) {
    prev = cur;
    cur = { kind, name, data, t0: now, hold };
    wipeAt = now; wipeFor = prev ? wipe : 0;
  }
  function nextLoop() {
    for (let k = 0; k < LOOP.length; k++) { loopAt = (loopAt + 1) % LOOP.length; if (!off.has(LOOP[loopAt][0])) break; }
    show('scene', LOOP[loopAt][0], null, { hold: LOOP[loopAt][1] });
  }
  const paint = l => (l.kind === 'scene' ? scenes : boards)[l.name](now - l.t0, l.data || {});

  const api = {
    canvas,
    scenes: LOOP.map(s => s[0]),

    draw(seconds) {
      now = seconds;
      if (!cur) nextLoop();
      else if (now - cur.t0 > cur.hold && !pinned) nextLoop();

      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1;
      const w = (now - wipeAt) / wipeFor;
      if (prev && wipeFor > 0 && w < 1) {
        paint(prev);
        // leaning wipe, left to right, led by a white and a purple band
        const edge = -H * SLANT - 160 + (W + H * SLANT + 320) * inOut(w);
        x.save(); clipSlab(-W, edge); paint(cur); x.restore();
        x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1;
        slab(edge, edge + 70, C.purple);
        slab(edge + 70, edge + 96, C.white);
      } else { prev = null; paint(cur); }
      if (grid) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.fillStyle = grid; x.fillRect(0, 0, W, H); }
    },

    lights(n) {
      n = Math.max(0, Math.min(5, n | 0));
      if (cur && cur.name === 'lights') cur.data.n = n;
      else show('board', 'lights', { n }, { wipe: 0.3 });
    },
    go() { show('board', 'go', null, { hold: 1.8, wipe: 0 }); },
    lap(d) { if (!cur || !['lights', 'go', 'red', 'chequered', 'message'].includes(cur.name)) show('board', 'lap', d, { hold: 5, wipe: 0.35 }); },
    flag(name, d = {}) {
      if (!name) return api.clear();
      if (!boards[name] || name === 'lights' || name === 'go' || name === 'lap' || name === 'message') return;
      const hold = name === 'green' ? 3 : name === 'final' ? 5 : Infinity;
      show('board', name, d, { hold, wipe: 0.25 });
    },
    clear() { pinned = false; if (cur && cur.kind === 'board') nextLoop(); },
    message(str) {
      const t = String(str || '').trim().slice(0, 40);
      if (!t) return api.clear();
      show('board', 'message', { text: t }, { wipe: 0.35 });
    },
    setAd(name, on) {
      if (!LOOP.some(l => l[0] === name)) return;
      if (on) off.delete(name);
      else if (LOOP.filter(l => !off.has(l[0])).length > 1) off.add(name);
      if (!on && cur && cur.kind === 'scene' && cur.name === name && !pinned) nextLoop();
    },
    adOn: name => !off.has(name),
    next() { pinned = false; nextLoop(); },
    get showing() { return cur ? { kind: cur.kind, name: cur.name } : null; },

    // hold one loop scene on screen (for previews); showScene() with no name resumes the loop
    showScene(name) {
      pinned = !!name;
      if (!name) return nextLoop();
      loopAt = LOOP.findIndex(s => s[0] === name);
      show('scene', name, null, { hold: Infinity });
    },
  };
  return api;
}

// Scale a list of [x, y] points into a w by h box. Returns the points, the
// outline length and at(f): the point a fraction f of the way round.
function fitPath(points, w, h) {
  if (!points || points.length < 3) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [px, py] of points) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  const s = Math.min(w / (x1 - x0), h / (y1 - y0)), ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  const pts = points.map(([px, py]) => [ox + (px - x0) * s, oy + (py - y0) * s]);
  const cum = [0];
  for (let k = 1; k <= pts.length; k++) {
    const a = pts[k - 1], b = pts[k % pts.length];
    cum.push(cum[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[pts.length];
  return {
    pts, length,
    at(f) {
      const d = f * length;
      let k = 1;
      while (k < pts.length && cum[k] < d) k++;
      const a = pts[k - 1], b = pts[k % pts.length], u = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    },
  };
}

// Dark lines every 4 pixels so the screen reads as LED modules up close.
function ledGrid() {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.2)';
  g.fillRect(3, 0, 1, 4); g.fillRect(0, 3, 3, 1);
  return g.createPattern(c, 'repeat');
}
