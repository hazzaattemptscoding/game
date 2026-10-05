// A car's livery: the paint a player chose, and the one place that decides what it is. Plain JavaScript with no DOM or
// WebGL, so tools/livery.js runs it in node.
//
// What a livery is: body, stripe and wing colours, a stripe style, a race number, a name and a sponsor. It travels with the
// player (src/ghosts.js, src/multiplayer.js) in a string of at most 40 characters, and a remote car is painted from that
// string and from nothing else, so every screen shows the same car. Until the string arrives the car wears the default for
// that player's id (defaultLivery), which every client computes the same way.

export const STRIPE_STYLES = ['None', 'Centre stripe', 'Twin stripes', 'Side flash'];   // style 0..3
export const MAX_NAME = 16;
export const MAX_STRING = 40;

// 12 body colours (the first is the original yellow) and 8 accent colours for the stripe and the wing.
export const BODY_COLOURS = ['#ffd21f', '#e23b3b', '#2f8fe0', '#3cc46a', '#e8863a', '#b15fe0', '#2fd0c8', '#f06fb0', '#f2f2ee', '#1b1d20', '#9aa0a6', '#1f3f9e'];
export const ACCENT_COLOURS = ['#f4f4f0', '#111111', '#d3202b', '#ffd21f', '#1f6fd0', '#ff6a13', '#1fa05a', '#6a6d72'];

// Sponsors a player can carry: the modern brands from the sponsor sheet in src/textures.js (not the faded 1950s and 60s ones).
// The wire carries the position in this list, so only ever append to it.
export const LIVERY_SPONSORS = ['powermedia', 'veyra', 'norrland', 'merrow', 'quillon', 'tarnwick', 'zephra', 'corvane', 'lumenor', 'oxley', 'brightfold', 'powermedia-yellow'];
export const SPONSOR_NAMES = { powermedia: 'PowerMedia', veyra: 'Veyra Tyres', norrland: 'Norrland Energy', merrow: 'Merrow Mutual', quillon: 'Quillon Mobile', tarnwick: 'Tarnwick Bank',
  zephra: 'Zephra Sportswear', corvane: 'Corvane Fuels', lumenor: 'Lumenor Lighting', oxley: 'Oxley Freight', brightfold: 'Brightfold Energy', 'powermedia-yellow': 'PowerMedia Yellow' };

export const DEFAULT_LIVERY = Object.freeze({ body: '#ffd21f', stripe: '#111111', wing: '#1b1d20', style: 0, number: -1, sponsor: '', name: '' });

// --- cleaning ---

// '#rrggbb' lowercase from '#rgb', '#rrggbb', 'rrggbb' or a number 0..0xffffff; anything else gives `fallback`.
export function cleanColour(v, fallback) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return '#' + v.toString(16).padStart(6, '0');
  if (typeof v === 'string') {
    let s = v.trim().toLowerCase();
    if (s[0] === '#') s = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (/^[0-9a-f]{6}$/.test(s)) return '#' + s;
  }
  return fallback;
}

// Printable Latin-1 only (so a name is one byte a character on the wire), no markup characters, single spaces, at most 16.
export function cleanLiveryName(s) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)) { if (!'<>&"\'`\\'.includes(ch)) out += ch; }
    else if (c === 0xa0 || c === 9) out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

// Any input to a valid livery. Never throws; every bad field falls back to the default's.
export function normaliseLivery(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULT_LIVERY;
  let style = typeof r.style === 'number' && Number.isFinite(r.style) ? Math.round(r.style) : D.style;
  if (style < 0 || style > 3) style = D.style;
  let number = typeof r.number === 'number' && Number.isFinite(r.number) ? Math.round(r.number) : D.number;
  if (number < 0 || number > 99) number = -1;
  return {
    body: cleanColour(r.body, D.body), stripe: cleanColour(r.stripe, D.stripe), wing: cleanColour(r.wing, D.wing),
    style, number,
    sponsor: typeof r.sponsor === 'string' && LIVERY_SPONSORS.includes(r.sponsor) ? r.sponsor : '',
    name: cleanLiveryName(r.name),
  };
}

export function liveryEquals(a, b) {
  const x = normaliseLivery(a), y = normaliseLivery(b);
  return x.body === y.body && x.stripe === y.stripe && x.wing === y.wing && x.style === y.style && x.number === y.number && x.sponsor === y.sponsor && x.name === y.name;
}

// --- the wire string ---
// 30 bytes at most, as base64url (40 characters): [version 1, body rgb, stripe rgb, wing rgb, style, number + 1, sponsor index + 1, name length, name as Latin-1].

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
  }
  return s;
}
function fromB64(s) {
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
  }
  return out;
}
const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

export function encodeLivery(l) {
  const n = normaliseLivery(l);
  const name = [...n.name].map(ch => ch.codePointAt(0));
  return toB64([1, ...rgb(n.body), ...rgb(n.stripe), ...rgb(n.wing), n.style, n.number + 1, n.sponsor ? LIVERY_SPONSORS.indexOf(n.sponsor) + 1 : 0, name.length, ...name]);
}

// From the wire string (or bytes, or an object): always a valid livery, the default when it makes no sense. Never throws.
export function decodeLivery(x) {
  try {
    if (x && typeof x === 'object' && !(x instanceof Uint8Array) && !Array.isArray(x)) return normaliseLivery(x);
    let b = null;
    if (typeof x === 'string' && x.length <= 64) b = fromB64(x);
    else if (x instanceof Uint8Array && x.length <= 48) b = [...x];
    else if (Array.isArray(x) && x.length <= 48 && x.every(v => Number.isInteger(v) && v >= 0 && v < 256)) b = x;
    if (!b || b.length < 14 || b[0] !== 1) return normaliseLivery(null);
    const len = b[13];
    if (len > MAX_NAME || b.length < 14 + len) return normaliseLivery(null);
    return normaliseLivery({
      body: hex(b[1], b[2], b[3]), stripe: hex(b[4], b[5], b[6]), wing: hex(b[7], b[8], b[9]), style: b[10], number: b[11] - 1,
      sponsor: LIVERY_SPONSORS[b[12] - 1] || '', name: String.fromCharCode(...b.slice(14, 14 + len)),
    });
  } catch (e) {
    return normaliseLivery(null);
  }
}

// --- defaults and the player's own ---

// FNV-1a over the id: the same number on every machine.
export function hashId(id) {
  let h = 0x811c9dc5;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// The livery of a player who has not chosen one (or whose livery has not arrived yet), from their stable player id only.
// Never from the order in which cars appeared, so every client picks the same paint for the same player.
export function defaultLivery(id) {
  const h = hashId(id), h2 = hashId('b' + id), h3 = hashId('c' + id);
  const body = BODY_COLOURS[h % BODY_COLOURS.length];
  const style = 1 + (h2 % 3);
  let stripe = ACCENT_COLOURS[(h2 >>> 4) % ACCENT_COLOURS.length];
  if (stripe === body) stripe = ACCENT_COLOURS[((h2 >>> 4) + 1) % ACCENT_COLOURS.length];
  return normaliseLivery({ body, stripe, wing: h3 % 2 ? '#1b1d20' : stripe, style, number: 1 + (h3 >>> 3) % 98, sponsor: '', name: '' });
}

// The livery to show and send for this player: their saved choice, or the default for their id.
export function ownLivery(saved, id) {
  return saved && typeof saved === 'object' ? normaliseLivery(saved) : defaultLivery(id);
}

// The css colour of a livery's body, for dots in the standings.
export const liveryColour = l => normaliseLivery(l).body;

// A random id for this browser, kept in localStorage, so the default livery of someone who never customises stays the same
// from one visit to the next. Falls back to a fresh random id when storage is not available.
export function localPlayerId(storage) {
  const KEY = 'lakeside-player-id';
  let id = '';
  try { id = (storage || localStorage).getItem(KEY) || ''; } catch (e) { /* private mode */ }
  if (!/^[a-z0-9]{6,24}$/.test(id)) {
    id = '';
    for (let i = 0; i < 12; i++) id += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    try { (storage || localStorage).setItem(KEY, id); } catch (e) { /* private mode */ }
  }
  return id;
}
