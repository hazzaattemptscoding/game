// Player settings, saved in the browser: units, the three assists, steering
// device, the handling readout and sound.

const KEY = 'lakeside-settings';
const DEFAULTS = { units: 'mph', assistTc: true, assistAbs: true, assistEsc: true, steering: 'keyboard', steerSens: 1, debug: false, blockout: false, sound: true, volume: 0.7 };

// Older saves had one `assists` switch for all three. If that is all there is, it sets the three; then it goes.
export function migrateSettings(saved) {
  const s = saved && typeof saved === 'object' ? { ...saved } : {};
  if (typeof s.assists === 'boolean') {
    for (const k of ['assistTc', 'assistAbs', 'assistEsc']) if (typeof s[k] !== 'boolean') s[k] = s.assists;
  }
  delete s.assists;
  if (s.steering !== 'keyboard' && s.steering !== 'cursor') delete s.steering;
  if (typeof s.steerSens !== 'number' || !(s.steerSens >= 0.5 && s.steerSens <= 2)) delete s.steerSens;
  return s;
}

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* private mode */ }
  return { ...DEFAULTS, ...migrateSettings(saved) };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
}
