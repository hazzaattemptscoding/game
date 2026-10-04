// Player settings, saved in the browser. Phase 1 has units, assists and the
// handling readout; more arrive with later phases.

const KEY = 'lakeside-settings';
const DEFAULTS = { units: 'mph', assists: true, debug: false, blockout: false };

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* private mode */ }
  return { ...DEFAULTS, ...saved };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
}
