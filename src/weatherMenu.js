// The Weather and time of day rows, shared by the race setup, the online host setup and Settings. Visual only.
// Rows write settings.timeOfDay and settings.weather (saved); the game reads them each frame (director.js environment()).
// A guest in an online room cannot change them: the host's choice is shown instead.

import { TIMES, WEATHERS, TIME_NAMES, WEATHER_NAMES } from './weather.js';

// segRow and h come from menuScreens.js (passed in, to avoid a circular import). Returns an array with one group element.
export function weatherRows({ settings, save, api }, segRow, h, title = 'Weather and time of day') {
  const locked = () => !!(api.envLocked && api.envLocked());
  const get = k => () => (locked() ? api.environment()[k === 'timeOfDay' ? 'time' : 'weather'] : settings[k]);
  const rows = [
    segRow('Time of day', TIMES.map(k => [k, TIME_NAMES[k]]), get('timeOfDay'), v => { if (locked()) return; settings.timeOfDay = v; save(settings); }),
    segRow('Weather', WEATHERS.map(k => [k, WEATHER_NAMES[k]]), get('weather'), v => { if (locked()) return; settings.weather = v; save(settings); }),
  ];
  const note = h('p', 'm-note', locked() ? 'The host chooses the weather and time of day for the room.' : 'Looks only. Grip and handling do not change. In an online room everybody sees the host\'s choice. ?weather=rain&time=dusk in the address also works.');
  const grp = h('section', 'group', h('div', 'gtitle', title), h('div', 'rows', ...rows));
  return [grp, note];
}

// Settings > Weather only: the cosmetic lightning and thunder in heavy rain. Saved as settings.lightning (default on).
// boolRow comes from menuScreens.js too.
export function lightningRows({ settings, save }, boolRow, h) {
  return [h('section', 'group', h('div', 'gtitle', 'Lightning'), h('div', 'rows',
    boolRow('Lightning and thunder', () => settings.lightning !== false, v => { settings.lightning = v; save(settings); },
      { note: 'In heavy rain, now and then a flash lights the sky and thunder follows a moment later. Looks and sound only.' })))];
}
