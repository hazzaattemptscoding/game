// Time of day and weather: the choices, the numbers behind each, and how they combine. Plain JavaScript with no page and no
// three.js, so tools/weather.js tests it in node. src/environment.js turns the numbers into sky, light, fog, rain and wet road.
//
// Visual only: nothing here touches grip or the physics.
//
// The default (midday, clear) is exactly the look the game had before this existed:
// sky 0x6fa3d6 to 0xd9e6ee, fog 0xcfdde6 from 300 m to 2600 m, sun 0xfff1dc at 2.4 from (-0.5, 0.75, 0.42), hemisphere light 1.1.

export const TIMES = ['morning', 'midday', 'golden', 'dusk', 'night'];
export const WEATHERS = ['clear', 'cloudy', 'overcast', 'fog', 'lightrain', 'heavyrain'];
export const TIME_NAMES = { morning: 'Morning', midday: 'Midday', golden: 'Golden hour', dusk: 'Dusk', night: 'Night' };
export const WEATHER_NAMES = { clear: 'Clear', cloudy: 'Cloudy', overcast: 'Overcast', fog: 'Fog', lightrain: 'Light rain', heavyrain: 'Heavy rain' };
export const DEFAULT_ENV = Object.freeze({ weather: 'clear', time: 'midday' });

const hex = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

// What a time of day looks like with a clear sky.
//   sky / skyBottom: the gradient behind the world (top of the screen, bottom). fog: colour of the distance.
//   sun: colour, intensity (light strength) and the direction the light comes from (towards the sun). hemi: sky and ground colour and strength.
//   night 0..1: how dark it is (stars, lamps and headlamps follow). lamps 0..1: floodlights and stand lights. exposure: tone mapping.
export const TIME_PRESETS = {
  morning: { sky: hex(0x7ba6d8), skyBottom: hex(0xf0dccb), fog: hex(0xe6d8cb), fogNear: 260, fogFar: 2300, sun: hex(0xffe2bd), sunI: 2.0, dir: norm([-0.72, 0.42, 0.34]), hemiSky: hex(0xd8e4f5), hemiGround: hex(0x56583a), hemiI: 1.0, night: 0, lamps: 0, exposure: 1.0 },
  midday: { sky: hex(0x6fa3d6), skyBottom: hex(0xd9e6ee), fog: hex(0xcfdde6), fogNear: 300, fogFar: 2600, sun: hex(0xfff1dc), sunI: 2.4, dir: norm([-0.5, 0.75, 0.42]), hemiSky: hex(0xdfeeff), hemiGround: hex(0x4a5a3a), hemiI: 1.1, night: 0, lamps: 0, exposure: 1.0 },
  golden: { sky: hex(0x5d86bd), skyBottom: hex(0xf5b87a), fog: hex(0xe3b48c), fogNear: 240, fogFar: 2400, sun: hex(0xffb062), sunI: 2.7, dir: norm([-0.86, 0.3, 0.38]), hemiSky: hex(0xe7c9a8), hemiGround: hex(0x4d4a33), hemiI: 0.85, night: 0.05, lamps: 0.12, exposure: 1.0 },
  dusk: { sky: hex(0x1c2955), skyBottom: hex(0xe0784f), fog: hex(0x6b5575), fogNear: 120, fogFar: 1900, sun: hex(0xff7a4a), sunI: 0.75, dir: norm([-0.92, 0.12, 0.3]), hemiSky: hex(0x6d7aa8), hemiGround: hex(0x2c2b33), hemiI: 0.5, night: 0.5, lamps: 0.9, exposure: 1.05 },
  night: { sky: hex(0x050a1a), skyBottom: hex(0x111c38), fog: hex(0x0c1427), fogNear: 80, fogFar: 1500, sun: hex(0x8fa8ff), sunI: 0.32, dir: norm([0.45, 0.6, -0.3]), hemiSky: hex(0x2c3d6b), hemiGround: hex(0x0b1019), hemiI: 0.6, night: 1, lamps: 1, exposure: 1.15 },
};

// What each weather does to any time of day.
//   grey: how far the sky and the fog go to a flat grey of the same brightness; dim: how much darker the sky is (heavy rain is dark).
//   sunK: share of the sun that gets through; hemiK: the same for the sky light. fogK: multiplies the fog distances (near, far).
//   cloud 0..1: cover; cloudDark 0..1: how grey and heavy the cloud underside looks. rain 0..1: streaks and drops. wet 0..1: how wet the road is.
//   skyFog: how far the sky takes the colour of the fog. wind: strength for flags. spray: the mist behind cars (needs wet).
export const WEATHER_PRESETS = {
  clear: { grey: 0, dim: 0, sunK: 1, hemiK: 1, fogNearK: 1, fogFarK: 1, cloud: 0, cloudDark: 0, skyFog: 0, rain: 0, wet: 0, wind: 0.45, spray: 0 },
  cloudy: { grey: 0.22, dim: 0.02, sunK: 0.66, hemiK: 1.03, fogNearK: 1, fogFarK: 0.92, cloud: 0.55, cloudDark: 0.15, skyFog: 0.05, rain: 0, wet: 0, wind: 0.75, spray: 0 },
  overcast: { grey: 0.68, dim: 0.12, sunK: 0.2, hemiK: 1.18, fogNearK: 0.7, fogFarK: 0.7, cloud: 1, cloudDark: 0.45, skyFog: 0.3, rain: 0, wet: 0, wind: 0.9, spray: 0 },
  fog: { grey: 0.85, dim: 0.08, sunK: 0.3, hemiK: 1.12, fogNearK: 0.03, fogFarK: 0.15, cloud: 0.7, cloudDark: 0.2, skyFog: 0.92, rain: 0, wet: 0.1, wind: 0.2, spray: 0 },
  lightrain: { grey: 0.74, dim: 0.2, sunK: 0.16, hemiK: 1.0, fogNearK: 0.45, fogFarK: 0.55, cloud: 1, cloudDark: 0.65, skyFog: 0.4, rain: 0.5, wet: 0.65, wind: 1.1, spray: 0.45 },
  heavyrain: { grey: 0.85, dim: 0.38, sunK: 0.08, hemiK: 0.86, fogNearK: 0.12, fogFarK: 0.34, cloud: 1, cloudDark: 1, skyFog: 0.45, rain: 1, wet: 1, wind: 1.7, spray: 1 },
};

const ALIAS_WEATHER = { rain: 'lightrain', light: 'lightrain', lightrain: 'lightrain', 'light-rain': 'lightrain', light_rain: 'lightrain', heavy: 'heavyrain', heavyrain: 'heavyrain', 'heavy-rain': 'heavyrain', heavy_rain: 'heavyrain', storm: 'heavyrain', mist: 'fog', foggy: 'fog', cloud: 'cloudy', dry: 'clear', sun: 'clear', sunny: 'clear' };
const ALIAS_TIME = { day: 'midday', noon: 'midday', morning: 'morning', dawn: 'morning', golden: 'golden', goldenhour: 'golden', 'golden-hour': 'golden', evening: 'golden', sunset: 'dusk', twilight: 'dusk', dusk: 'dusk', night: 'night', midnight: 'night' };

export const cleanWeather = v => { const k = String(v ?? '').toLowerCase().replace(/\s+/g, ''); return WEATHERS.includes(k) ? k : ALIAS_WEATHER[k] || DEFAULT_ENV.weather; };
export const cleanTime = v => { const k = String(v ?? '').toLowerCase().replace(/\s+/g, ''); return TIMES.includes(k) ? k : ALIAS_TIME[k] || DEFAULT_ENV.time; };
export const cleanEnv = o => ({ weather: cleanWeather(o && o.weather), time: cleanTime(o && (o.time ?? o.timeOfDay)) });
export const sameEnv = (a, b) => !!a && !!b && a.weather === b.weather && a.time === b.time;

// ?weather=rain&time=dusk (also timeOfDay=). Returns null when the address says nothing about either.
export function envFromParams(params) {
  const get = k => (params && params.has && params.has(k) ? params.get(k) : null);
  const w = get('weather'), t = get('time') ?? get('timeofday');
  if (w === null && t === null) return null;
  return { weather: cleanWeather(w), time: cleanTime(t) };
}

const mix = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const grey = (c, k, dim) => { const g = lum(c), m = mixC(c, [g, g * 1.02, g * 1.06], k); return [m[0] * (1 - dim), m[1] * (1 - dim), m[2] * (1 - dim)]; };

// The numbers for a time of day and a weather together. Everything in the result is a plain number or an array of three.
export function resolveEnv(env) {
  const e = cleanEnv(env), T = TIME_PRESETS[e.time], W = WEATHER_PRESETS[e.weather];
  const dayK = 1 - T.night;   // grey weather matters less when it is dark anyway
  const k = W.grey, dim = W.dim * (0.4 + 0.6 * dayK);
  const stars = Math.max(0, T.night - 0.45) / 0.55 * (1 - Math.min(1, W.cloud * 0.9));
  const fogC = grey(T.fog, k, dim * 0.6);
  return {
    time: e.time, weather: e.weather,
    sky: mixC(grey(T.sky, k, dim), fogC, W.skyFog), skyBottom: mixC(grey(T.skyBottom, k * 0.9, dim * 0.8), fogC, Math.min(1, W.skyFog * 1.1)),
    fog: fogC, fogNear: T.fogNear * W.fogNearK, fogFar: T.fogFar * W.fogFarK,
    sun: T.sun.slice(), sunI: T.sunI * W.sunK, dir: T.dir.slice(),
    hemiSky: grey(T.hemiSky, k * 0.5, dim * 0.5), hemiGround: T.hemiGround.slice(), hemiI: T.hemiI * (T.night > 0.3 ? mix(1, 0.8, W.cloud) : W.hemiK),
    exposure: T.exposure,
    night: T.night, lamps: Math.min(1, T.lamps + (T.night < 0.3 ? W.dim * 0.25 : 0)), stars,
    cloud: W.cloud, cloudDark: W.cloudDark, rain: W.rain, wet: W.wet, wind: W.wind, spray: W.spray,
  };
}

// Blend two resolved sets (t 0..1), for the change from one look to another.
export function blendEnv(a, b, t) {
  const out = {};
  for (const key of Object.keys(b)) {
    const x = a[key], y = b[key];
    if (Array.isArray(y)) out[key] = mixC(x, y, t);
    else if (typeof y === 'number') out[key] = mix(x, y, t);
    else out[key] = t < 0.5 ? x : y;
  }
  return out;
}

// the cast shadows only show when the sun is strong enough to make them
export const shadowsOn = r => r.sunI > 0.9;
