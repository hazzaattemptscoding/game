// Player settings, saved in the browser: units, the three assists, steering
// device, the handling readout, sound and which HUD parts show.

import { normaliseControllerSettings } from './gamepad.js';
import { normaliseLivery } from './livery.js';
import { cleanWeather, cleanTime } from './weather.js';
import { normaliseHudSettings } from './hudSettings.js';
import { cleanQuality, isPhone } from './quality.js';

const KEY = 'lakeside-settings';
const DEFAULTS = { units: 'mph', assistTc: true, assistAbs: true, assistEsc: true, steering: 'keyboard', steerSens: 1, debug: false, blockout: false, racingLine: false, sound: true, volume: 0.7, livery: null, weather: 'clear', timeOfDay: 'midday', lightning: true, quality: 'auto', freeLook: true, lastMode: 'practice' };   // hud, hudScale and trackMap are filled in by migrateSettings (src/hudSettings.js)

// Older saves had one `assists` switch for all three. If that is all there is, it sets the three; then it goes.
export function migrateSettings(saved) {
  const s = saved && typeof saved === 'object' ? { ...saved } : {};
  if (typeof s.assists === 'boolean') {
    for (const k of ['assistTc', 'assistAbs', 'assistEsc']) if (typeof s[k] !== 'boolean') s[k] = s.assists;
  }
  delete s.assists;
  s.controller = normaliseControllerSettings(s.controller);   // gamepad: validated, missing parts take the defaults
  if (s.livery && typeof s.livery === 'object') s.livery = normaliseLivery(s.livery); else delete s.livery;   // the player's own car paint (src/livery.js); null = the default for their id
  if ('weather' in s) s.weather = cleanWeather(s.weather);   // visual only (src/weather.js)
  if ('timeOfDay' in s) s.timeOfDay = cleanTime(s.timeOfDay);
  if ('lightning' in s) s.lightning = s.lightning !== false;   // cosmetic flashes and thunder in heavy rain; anything but false is on
  if ('quality' in s) s.quality = cleanQuality(s.quality);   // graphics: auto, high, medium or low (src/quality.js)
  if (s.steering !== 'keyboard' && s.steering !== 'cursor') delete s.steering;
  if (!['practice', 'timetrial', 'race', 'online'].includes(s.lastMode)) s.lastMode = 'practice';   // the main menu's Resume button (menuScreens.js)
  if (typeof s.steerSens !== 'number' || !(s.steerSens >= 0.5 && s.steerSens <= 2)) delete s.steerSens;
  return normaliseHudSettings(s);   // the HUD switches, scale and track map options: missing or invalid parts take the defaults
}

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* private mode */ }
  const m = migrateSettings(saved), out = { ...DEFAULTS, ...m };
  if (!('quality' in m) && isPhone()) out.quality = 'medium';   // a phone that has not chosen starts on Medium
  return out;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
}
