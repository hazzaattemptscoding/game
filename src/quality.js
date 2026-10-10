// Graphics quality: the four settings (Auto, High, Medium, Low), what each one means, and the render scaler that Auto uses to
// hold the display's frame rate. The maths is plain data with no page needed (tools/perf.js tests it in node); `createQuality`
// applies the result to the renderer and the sun shadow.
//
//   pixelCap   most device pixels per CSS pixel the canvas gets (2 = retina sharp, 1 = no extra sharpness)
//   scale      fixed share of that, for the Low tier
//   shadowSize sun shadow map size in pixels (it covers 80 m round the car)
//   shadowHz   most shadow map refreshes per second, 0 = every frame
//   aniso      texture anisotropy cap (a texture keeps a lower value it was built with)
//   propDist   small props (crowds, trees, bushes, bins, signs) are not drawn beyond this many metres; Infinity = no limit
//   hudHz      how often the HUD text and the track map are redrawn
// High is how the game looked before this setting existed.

export const TIERS = {
  high: { pixelCap: 2, scale: 1, shadowSize: 2048, shadowHz: 0, aniso: 16, propDist: Infinity, hudHz: 60 },
  medium: { pixelCap: 1.5, scale: 1, shadowSize: 1024, shadowHz: 60, aniso: 4, propDist: 1400, hudHz: 30 },
  low: { pixelCap: 1, scale: 0.85, shadowSize: 1024, shadowHz: 30, aniso: 2, propDist: 800, hudHz: 20 },
};
export const TIER_ORDER = ['high', 'medium', 'low'];
export const QUALITY_SETTINGS = ['auto', 'high', 'medium', 'low'];
export const QUALITY_LABELS = { auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' };

export const cleanQuality = (v, fallback = 'auto') => (QUALITY_SETTINGS.includes(v) ? v : fallback);

// phones and tablets: a touch screen as the main pointer
export function isPhone(nav = typeof navigator !== 'undefined' ? navigator : null, mm = typeof matchMedia !== 'undefined' ? matchMedia : null) {
  if (!nav) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '')) return true;
  return !!(nav.maxTouchPoints > 1 && mm && mm('(pointer: coarse)').matches);
}

// The tier a setting stands for on this device. Auto starts from High on a desktop and Medium on a phone, then the scaler works on it.
export const baseTier = (setting, phone) => (setting === 'auto' ? (phone ? 'medium' : 'high') : TIERS[setting] ? setting : 'high');

export const SCALE_MIN = 0.6, SCALE_MAX = 1;

// Auto's render scale. Feed it each frame time; it answers with a new scale when it wants one (else null).
// It aims for the display's frame interval (the quickest the page has seen frames arrive, never longer than 16.7 ms): over that for
// a second, the scale steps down; holding that interval for four seconds it tries a step back up, but not past a scale that already failed.
export class Scaler {
  constructor(o = {}) {
    this.min = o.min ?? SCALE_MIN; this.max = o.max ?? SCALE_MAX;
    this.scale = this.max;
    this.t = 0; this.n = 0; this.sum = 0;          // the current one second window
    this.good = 0;                                  // seconds of headroom in a row
    this.cap = this.max; this.capUntil = 0;         // a scale that was too much, and until when to remember that
    this.clock = 0;
    this.refresh = Infinity;                        // quickest frame seen, ms (a slow average of the lowest percentile)
    this.low = [];
    this.pinned = 0;                                // seconds spent over budget with the scale already at its floor
  }
  get budget() { return Math.min(16.7, Math.max(4.1, this.refresh)); }
  push(dtMs) {
    this.clock += dtMs / 1000;
    this.low.push(dtMs); if (this.low.length > 240) this.low.shift();
    this.t += dtMs / 1000; this.n++; this.sum += dtMs;
    if (this.t < 1 || this.n < 20) return null;
    const avg = this.sum / this.n;
    this.t = 0; this.n = 0; this.sum = 0;
    const sorted = this.low.slice().sort((a, b) => a - b);
    this.refresh = Math.min(this.refresh, sorted[Math.floor(sorted.length * 0.1)]);
    const b = this.budget;
    if (this.clock > this.capUntil) this.cap = this.max;
    if (avg > b * 1.15) {
      this.good = 0;
      if (this.scale <= this.min + 1e-6) { this.pinned++; return null; }
      this.pinned = 0;
      // closer to the budget the further over it is, never a step bigger than 0.15
      const next = Math.max(this.min, this.scale - Math.min(0.15, Math.max(0.05, (1 - Math.sqrt(b / avg)) * this.scale)));
      this.cap = Math.max(this.min, this.scale - 0.05); this.capUntil = this.clock + 20;
      return this.set(next);
    }
    this.pinned = 0;
    if (avg <= b * 1.05 && this.scale < Math.min(this.max, this.cap)) {
      if (++this.good >= 4) { this.good = 0; return this.set(Math.min(this.max, this.cap, this.scale + 0.05)); }
    } else this.good = 0;
    return null;
  }
  set(s) { s = Math.round(s * 100) / 100; if (s === this.scale) return null; this.scale = s; return s; }
}

// The shadow centre snapped to whole shadow map pixels along the light's own axes, so the edges do not shimmer as the car moves.
// p: {x, y, z} the point to centre on; dir: the unit vector towards the sun; size: map pixels; extent: width of the map in metres.
export function snapShadowCentre(p, dir, size, extent, out = {}) {
  // right = up x dir, normalised; up2 = dir x right
  let rx = dir.z, rz = -dir.x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = dir.y * rz, uy = dir.z * rx - dir.x * rz, uz = -dir.y * rx;
  const texel = extent / size;
  const a = p.x * rx + p.z * rz, b = p.x * ux + p.y * uy + p.z * uz;
  const da = Math.round(a / texel) * texel - a, db = Math.round(b / texel) * texel - b;
  out.x = p.x + rx * da + ux * db; out.y = p.y + uy * db; out.z = p.z + rz * da + uz * db;
  return out;
}

export function createQuality({ renderer, sun, settings, phone, onResize, ready }) {
  const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
  const scaler = new Scaler({ min: phone ? 0.5 : SCALE_MIN });
  let setting = cleanQuality(settings.quality), shift = 0, tierName = baseTier(setting, phone), tier = TIERS[tierName];
  let lastShadow = -Infinity, ratio = 0, scale = 1;

  const maxAniso = () => (renderer.capabilities && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);

  function applyRatio() {
    const r = Math.max(0.5, Math.min(tier.pixelCap, dpr()) * (setting === 'auto' ? scale : 1) * tier.scale);
    if (Math.abs(r - ratio) < 0.01) return;
    ratio = r;
    renderer.setPixelRatio(ratio);
    onResize();
  }
  function applyShadow() {
    if (sun.shadow.mapSize.x !== tier.shadowSize) {
      sun.shadow.mapSize.set(tier.shadowSize, tier.shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    lastShadow = -Infinity;
  }
  function pick() {
    setting = cleanQuality(settings.quality);
    const base = TIER_ORDER.indexOf(baseTier(setting, phone));
    tierName = TIER_ORDER[Math.min(TIER_ORDER.length - 1, base + (setting === 'auto' ? shift : 0))];
    tier = TIERS[tierName];
    if (setting !== 'auto') { scale = 1; scaler.scale = 1; }
    applyRatio(); applyShadow();
    if (ready) ready(tier);
  }
  pick();

  return {
    get tier() { return tier; }, get tierName() { return tierName; }, get setting() { return setting; }, get scale() { return setting === 'auto' ? scale : tier.scale; }, get ratio() { return ratio; },
    maxAniso,
    // the settings menu changed `settings.quality`, or the window moved to a screen with another pixel ratio
    refresh() { shift = 0; scaler.scale = scale = 1; pick(); },
    // every frame, with the real frame time in ms: Auto adjusts the render scale, and drops a tier when the scale is at its floor and still too slow
    frame(dtMs) {
      if (setting !== 'auto' || !(dtMs > 0) || dtMs > 250) return;
      const s = scaler.push(dtMs);
      if (s !== null) { scale = s; applyRatio(); }
      if (scaler.pinned >= 3 && tierName !== 'low') { shift++; scaler.pinned = 0; scaler.scale = scale = 1; pick(); }
    },
    // true when the shadow map is due a refresh (now in ms)
    shadowDue(now) {
      if (tier.shadowHz && now - lastShadow < 1000 / tier.shadowHz - 1) return false;
      lastShadow = now;
      return true;
    },
  };
}
