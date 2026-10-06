// Tracks made in the track maker, saved in the browser.
//
// A made track is a layout in the same shape as src/layout.js, plus an id and
// a name. The built-in Lakeside circuit is not stored here; it is always
// available as the default. Tracks can be exported to a JSON file and
// imported again to share them.

const KEY = 'lakeside-tracks';

export const ZONE_KINDS = {
  gravel: { label: 'Gravel trap', colour: '#b36bff', sided: true, width: 26 },
  walls: { label: 'Street wall', colour: '#4da3ff', sided: true },
  runoff: { label: 'Tarmac run-off', colour: '#3ddc84', sided: true, width: 6 },
  sausage: { label: 'Sausage kerb', colour: '#ffd21f', sided: true },
};

export function newLayout(name = 'My circuit') {
  // a rounded loop with a long start straight on the left-hand side of the sketch
  const points = [
    [300, 300, 4], [380, 300, 0], [460, 300, 0], [540, 310, 0], [600, 340, 2], [620, 400, 4],
    [590, 450, 6], [520, 470, 8], [470, 520, 8], [400, 540, 6], [330, 520, 4], [290, 470, 4],
    [270, 400, 5], [275, 340, 6],
  ];
  return normalise({ name, points });
}

// Fill in anything missing and clamp values to ranges the track code can build.
export function normalise(l) {
  const n = Math.max(6, (l.points || []).length);
  const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const out = {
    name: String(l.name || 'Untitled').slice(0, 40),
    custom: true,
    scale: num(l.scale, 2, 0.5, 6),
    heightScale: num(l.heightScale, 0.3, 0, 2),
    width: num(l.width, 13, 8, 20),
    minRadius: num(l.minRadius, 16, 8, 60),
    points: (l.points || []).map(p => [num(p[0], 0, -1e5, 1e5), num(p[1], 0, -1e5, 1e5), num(p[2], 0, -200, 400)]),
    sectors: Array.isArray(l.sectors) && l.sectors.length === 2 ? l.sectors.map(Number) : [Math.floor(n / 3), Math.floor(2 * n / 3)],
    drs: Array.isArray(l.drs) ? l.drs.filter(z => z.length === 2).map(z => z.map(Number)) : [],
    bridge: Array.isArray(l.bridge) && l.bridge.length === 2 ? l.bridge.map(Number) : null,
    pit: { entry: n - 1, exit: 1.5, offset: 15.5, width: 12, blend: 110, speedLimit: 60, ...(l.pit || {}) },
    corners: [],
  };
  for (const k of Object.keys(ZONE_KINDS)) {
    out[k] = (Array.isArray(l[k]) ? l[k] : []).filter(z => z.length >= 3).map(z => [Number(z[0]), Number(z[1]), z[2] === 'L' || z[2] === 'R' ? z[2] : 'both', ...(z.length > 3 ? [Number(z[3])] : [])]);
  }
  return out;
}

// Why a layout can't be built, or null if it looks fine.
export function problems(l) {
  if (l.points.length < 6) return 'A circuit needs at least 6 points.';
  const [a, b] = l.sectors;
  if (!(a > 0 && a < b && b < l.points.length)) return 'Sector 2 must start before sector 3, both after the start line.';
  return null;
}

function read() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { tracks: d.tracks || {}, active: d.active || null };
  } catch (e) { return { tracks: {}, active: null }; }
}
function write(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (e) { return false; }
}

export const listTracks = () => Object.values(read().tracks).sort((a, b) => b.saved - a.saved);
export const getTrack = id => read().tracks[id] || null;
export const getActiveId = () => read().active;

export function saveTrack(id, layout) {
  const d = read();
  id ||= 't' + Date.now().toString(36);
  d.tracks[id] = { id, saved: Date.now(), layout: normalise(layout) };
  return write(d) ? id : null;
}

export function setActive(id) { const d = read(); d.active = id; write(d); }

export function deleteTrack(id) {
  const d = read();
  delete d.tracks[id];
  if (d.active === id) d.active = null;
  write(d);
}

export const exportJSON = layout => JSON.stringify({ lakesideTrack: 1, ...normalise(layout) }, null, 1);

export function importJSON(text) {
  const d = JSON.parse(text);
  if (!d || d.lakesideTrack !== 1 || !Array.isArray(d.points)) throw new Error('Not a Lakeside track file');
  return normalise(d);
}
