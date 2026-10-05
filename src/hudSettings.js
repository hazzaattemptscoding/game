// Which parts of the HUD are shown, the HUD scale and the track map options. Plain data and functions with no page needed,
// so tools/hudsettings.js tests them in node. The settings object keeps three keys: `hud` (one on/off flag per element), `hudScale` (percent) and `trackMap` (the minimap options, src/miniMap.js).
// Anything missing or out of range in a saved file falls back to the default, so saves from before these keys existed still load.

// [key, label, note]. The order is the order of the Interface screen.
export const HUD_ELEMENTS = [
  ['speed', 'Speed, gear and revs', 'Includes the pit limiter and DRS lights.'],
  ['lapTimer', 'Lap timer, last and best', ''],
  ['sectors', 'Sector times', ''],
  ['delta', 'Delta in the sector times', 'The gap to your last lap, beside each sector time.'],
  ['liveDelta', 'Live delta', 'The running gap to your best lap this session: green when you are ahead, red when behind.'],
  ['limits', 'Track limits warnings', 'The banner and the count for this lap.'],
  ['assists', 'Assist indicators', 'The TC, ABS and ESC lights.'],
  ['flags', 'Event messages', 'Lap and sector flashes, session banners and the session line.'],
  ['steerBar', 'Steering bar', 'Shows with cursor steering.'],
  ['pedals', 'Pedal bars', ''],
  ['inputOverlay', 'Input overlay', 'Four keys that light up with steering, throttle and brake.'],
  ['fps', 'FPS counter', ''],
];
export const HUD_KEYS = HUD_ELEMENTS.map(e => e[0]);

// the look the game had before these settings: everything on except the three extras
export const FULL = Object.freeze({ speed: true, lapTimer: true, sectors: true, delta: true, liveDelta: true, limits: true, assists: true, flags: true, steerBar: true, pedals: false, inputOverlay: false, fps: false });
export const MINIMAL = Object.freeze({ speed: true, lapTimer: true, sectors: false, delta: false, liveDelta: true, limits: true, assists: false, flags: true, steerBar: false, pedals: false, inputOverlay: false, fps: false });
export const OFF = Object.freeze(Object.fromEntries(HUD_KEYS.map(k => [k, false])));
export const PRESETS = { full: { hud: FULL, map: true }, minimal: { hud: MINIMAL, map: false }, off: { hud: OFF, map: false } };
export const PRESET_ORDER = ['full', 'minimal', 'off'];
export const PRESET_NAMES = { full: 'Full', minimal: 'Minimal', off: 'Off', custom: 'Custom' };

export const SCALE_MIN = 80, SCALE_MAX = 140;
export const MAP_SIZES = { small: 130, medium: 180, large: 250 };   // CSS pixels on a side at 100% HUD scale
export const MAP_POSITIONS = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };
export const MAP_OPACITY_MIN = 0.3;

export const DEFAULT_TRACK_MAP = Object.freeze({ on: true, size: 'medium', position: 'tr', opacity: 0.85, rotate: false, zoom: 'circuit', labels: 'off' });

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);

export function normaliseHud(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of HUD_KEYS) out[k] = bool(r[k], FULL[k]);
  return out;
}

export function normaliseTrackMap(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, d = DEFAULT_TRACK_MAP;
  return {
    on: bool(r.on, d.on),
    size: r.size in MAP_SIZES ? r.size : d.size,
    position: r.position in MAP_POSITIONS ? r.position : d.position,
    opacity: num(r.opacity, MAP_OPACITY_MIN, 1, d.opacity),
    rotate: bool(r.rotate, d.rotate),
    zoom: r.zoom === 'local' ? 'local' : 'circuit',
    labels: r.labels === 'numbers' ? 'numbers' : 'off',
  };
}

export const normaliseScale = v => Math.round(num(v, SCALE_MIN, SCALE_MAX, 100));

// the three settings keys, filled in. Called by migrateSettings for every save.
export function normaliseHudSettings(s) {
  s.hud = normaliseHud(s.hud);
  s.trackMap = normaliseTrackMap(s.trackMap);
  s.hudScale = normaliseScale(s.hudScale);
  return s;
}

const sameElements = (a, b) => HUD_KEYS.every(k => a[k] === b[k]);

// 'full', 'minimal', 'off' when the current switches match that preset exactly (map included), else 'custom'
export function detectPreset(s) {
  for (const name of PRESET_ORDER) if (sameElements(s.hud, PRESETS[name].hud) && s.trackMap.on === PRESETS[name].map) return name;
  return 'custom';
}

export function applyPreset(s, name) {
  const p = PRESETS[name];
  if (!p) return s;
  for (const k of HUD_KEYS) s.hud[k] = p.hud[k];
  s.trackMap.on = p.map;
  return s;
}

// H: full, then minimal, then off, then full again. A custom set of switches goes to full.
export function cyclePreset(s) {
  const now = detectPreset(s), i = PRESET_ORDER.indexOf(now);
  const next = PRESET_ORDER[(i + 1) % PRESET_ORDER.length];
  applyPreset(s, next);
  return next;
}

export const hudOn = (s, key) => !!(s.hud && s.hud[key]);

// The page classes that hide things: one `hx-no-<key>` for each element that is off, and hx-no-lights when the whole row of
// lights (pit limiter, DRS, assists) has nothing left to show. A string that changes only when the layout would.
export function hudClasses(s) {
  const out = HUD_KEYS.filter(k => !s.hud[k]).map(k => 'hx-no-' + k);
  if (!s.hud.speed && !s.hud.assists) out.push('hx-no-lights');
  return out;
}
