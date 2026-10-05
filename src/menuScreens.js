// The screens of the menu: main menu, pause, race setup, settings (tabs), online lobby, garage and the placeholders.
// Registered on the menu by registerScreens(menu). The game's side of each button is `ctx.api` (director.js).

import { LAP_CHOICES } from './session.js';
import { weatherRows, lightningRows } from './weatherMenu.js';
import { QUALITY_SETTINGS, QUALITY_LABELS } from './quality.js';
import { HUD_ELEMENTS, MAP_SIZES, MAP_POSITIONS, PRESET_ORDER, PRESET_NAMES, SCALE_MIN, SCALE_MAX, MAP_OPACITY_MIN, detectPreset, applyPreset } from './hudSettings.js';

export const h = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const btn = (label, cls, onClick) => { const b = h('button', cls, label); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };

// A labelled row of choices: opts [[value, label]...]; get() the current value, set(v) stores it. Returns the row element with .sync().
export function segRow(label, opts, get, set, { note } = {}) {
  const row = h('div', 'm-row'), lab = h('div', 'm-label', label), seg = h('div', 'm-seg');
  seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', label);
  const bs = opts.map(([v, text]) => { const b = btn(text, 'm-opt', () => { set(v); sync(); }); b.dataset.v = String(v); b.setAttribute('role', 'radio'); seg.append(b); return b; });
  const sync = () => { for (const b of bs) { const on = b.dataset.v === String(get()); b.classList.toggle('sel', on); b.setAttribute('aria-checked', String(on)); } };
  row.append(lab, seg);
  if (note) row.append(h('div', 'm-note', note));
  row.sync = sync; row.buttons = bs;
  sync();
  return row;
}

export function sliderRow(label, { min, max, step, get, set, fmt = v => `${Math.round(v)}` }) {
  const row = h('div', 'm-row'), lab = h('div', 'm-label', label), val = h('span', 'm-val'), input = h('input', 'm-range');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = get(); input.setAttribute('aria-label', label);
  const sync = () => { input.value = get(); val.textContent = fmt(+input.value); };
  input.addEventListener('input', () => { set(+input.value); val.textContent = fmt(+input.value); });
  lab.append(val);
  row.append(lab, input);
  row.sync = sync; row.input = input;
  sync();
  return row;
}

const setupDefaults = { laps: 5, custom: false, assists: 'any', racingLine: true };
export const raceSetup = settings => ({ ...setupDefaults, ...(settings.raceSetup || {}) });

// --- home -------------------------------------------------------------------------------------------------------------

const HOME = [
  ['practice', 'Free practice', 'The whole circuit to yourself. No rules, no results.'],
  ['timetrial', 'Time trial', 'A standing start from the pit exit. Every lap counted and saved.'],
  ['race', 'Race', 'Set up a race: laps, assists, the racing line. Lights and a start.'],
  ['online', 'Online', 'Host a room or join one with a code and race your friends.'],
  ['garage', 'Garage', 'Paint your car: colours, number, stripes and sponsors.'],
  ['settings', 'Settings', 'Units, assists, steering, display, sound, controls.'],
];

function homeScreen() {
  return {
    home: true, title: '',
    mount(c, ctx) {
      const brand = h('div', 'home-brand', h('h1', '', 'Lakeside'), h('p', '', 'GT racing in the browser'));
      const list = h('nav', 'home-list');
      for (const [id, label, text] of HOME) {
        const b = h('button', 'home-item', h('b', '', label), h('span', '', text));
        b.type = 'button'; b.dataset.go = id;
        b.addEventListener('click', () => ctx.api.go(id));
        list.append(b);
      }
      const foot = h('p', 'home-foot', h('span', '', 'Arrows and Enter, mouse, touch or a gamepad. Esc goes back.'), h('span', 'home-build', ctx.build ? `Build ${ctx.build}` : 'Development build'));
      c.append(brand, list, foot);
      list.firstChild.dataset.first = '1';
      return null;
    },
  };
}

// --- pause ------------------------------------------------------------------------------------------------------------

function pauseScreen() {
  return {
    title: 'Paused', backable: false,
    mount(c, ctx) {
      const s = ctx.api.session && ctx.api.session();
      const info = s ? h('p', 'm-sub', ({ practice: 'Free practice', timetrial: 'Time trial', race: s.laps ? `Race, ${s.laps} laps` : 'Race', online: s.laps ? `Online race, ${s.laps} laps` : 'Online' })[s.mode]) : null;
      const list = h('div', 'm-list');
      const online = ctx.api.inRoom && ctx.api.inRoom();
      const items = [
        ['Resume', 'primary', () => ctx.api.resume()],
        ['Restart session', '', () => ctx.api.restart()],
        ['Settings', '', () => ctx.menu.push('settings')],
        ['Report a problem', '', () => ctx.api.report()],
        ['Back to main menu', 'danger', () => confirmLeave()],
      ];
      if (online) items[1] = ['Restart session', '', () => ctx.api.restart()];
      for (const [label, cls, fn] of items) { const b = btn(label, 'm-btn ' + cls, fn); list.append(b); if (label === 'Resume') b.dataset.first = '1'; }
      const sure = h('div', 'm-confirm'); sure.hidden = true;
      function confirmLeave() {
        list.hidden = true; sure.hidden = false;
        sure.replaceChildren(h('p', '', 'Leave this session and go back to the main menu? Your laps in this session are not kept except the ones already saved in Times.'),
          h('div', 'm-actions', btn('Stay', 'm-btn', () => { sure.hidden = true; list.hidden = false; ctx.menu.focusFirst(); }), btn('Leave', 'm-btn danger', () => ctx.api.toMainMenu())));
        sure.querySelector('button').dataset.first = '1';
        ctx.menu.focusFirst();
      }
      if (info) c.append(info);
      c.append(list, sure);
      return null;
    },
    onBack: ctx => { ctx.api.resume(); return true; },
  };
}

// --- setup (race and practice) ----------------------------------------------------------------------------------------

function setupScreen() {
  return {
    title: p => (p && p.mode === 'practice' ? 'Free practice' : 'Race setup'),
    mount(c, ctx) {
      const { settings, save, api } = ctx, mode = (ctx.params && ctx.params.mode) || 'race';
      if (mode === 'practice') {
        c.append(h('p', 'm-sub', 'Drive as long as you like. Reset puts you back on the track anywhere.'));
        c.append(segRow('Start from', [['pit', 'Pit lane'], ['standing', 'Starting grid']], () => settings.practiceStart || 'pit', v => { settings.practiceStart = v; save(settings); }));
        const go = btn('Start practice', 'm-btn primary', () => api.startPractice({ start: settings.practiceStart === 'standing' ? 'standing' : 'pit' }));
        go.dataset.first = '1';
        c.append(h('div', 'm-actions', go));
        return null;
      }
      const cur = raceSetup(settings);
      const store = () => { settings.raceSetup = { ...cur }; save(settings); };
      c.append(h('p', 'm-sub', 'Standing start from the grid with the five lights.'));
      const lapsOpts = [...LAP_CHOICES.map(n => [n, String(n)]), ['custom', 'Custom']];
      const customRow = h('div', 'm-row m-custom');
      const num = h('output', 'm-num', String(cur.laps));
      const minus = btn('−', 'm-step', () => { cur.laps = Math.max(1, cur.laps - 1); upd(); }), plus = btn('+', 'm-step', () => { cur.laps = Math.min(99, cur.laps + 1); upd(); });
      minus.setAttribute('aria-label', 'One lap fewer'); plus.setAttribute('aria-label', 'One lap more');
      customRow.append(h('div', 'm-label', 'Number of laps'), h('div', 'm-stepper', minus, num, plus));
      const laps = segRow('Laps', lapsOpts, () => (cur.custom ? 'custom' : cur.laps), v => { if (v === 'custom') cur.custom = true; else { cur.custom = false; cur.laps = v; } upd(); });
      function upd() { num.textContent = String(cur.laps); customRow.hidden = !cur.custom; laps.sync(); store(); }
      c.append(laps, customRow);
      const start = segRow('Start', [['standing', 'Standing start']], () => 'standing', () => {});
      c.append(start);
      c.append(segRow('Assists', [['any', 'Any'], ['off', 'All off']], () => cur.assists, v => { cur.assists = v; store(); }, { note: 'All off switches traction control, ABS and stability control off for the race.' }));
      if (api.hasRacingLine && api.hasRacingLine()) c.append(segRow('Racing line', [[true, 'Allowed'], [false, 'Not allowed']], () => cur.racingLine, v => { cur.racingLine = v; store(); }));
      c.append(...weatherRows(ctx, segRow, h));
      c.append(segRow('Track limits', [['warn', 'Warnings']], () => 'warn', () => {}, { note: 'Cutting a corner shows a warning and makes the lap invalid.' }));
      const go = btn('Start race', 'm-btn primary', () => api.startRace({ laps: cur.laps, assists: cur.assists, racingLine: api.hasRacingLine && api.hasRacingLine() ? cur.racingLine : true }));
      go.dataset.first = '1';
      c.append(h('div', 'm-actions', go));
      upd();
      return null;
    },
  };
}

// --- settings ---------------------------------------------------------------------------------------------------------

function settingsScreen() {
  const TABS = ['Driving', 'Display', 'Weather', 'Interface', 'Sound', 'Controls', 'Online'];
  return {
    title: 'Settings',
    mount(c, ctx) {
      const { settings, save, api } = ctx;
      const tabs = h('div', 'm-tabs'); tabs.setAttribute('role', 'tablist');
      const panel = h('div', 'm-panel'); panel.setAttribute('role', 'tabpanel');
      c.append(tabs, panel);
      let current = Math.max(0, TABS.indexOf(ctx.menu.lastSettingsTab || 'Driving')), disposeTab = null;
      const persist = () => save(settings);
      const forced = api.session && api.session() && api.session().assists === 'off';

      const builders = {
        Driving(p) {
          p.append(segRow('Speed', [['mph', 'mph'], ['kmh', 'km/h']], () => settings.units, v => { settings.units = v; persist(); }));
          if (forced) p.append(h('p', 'm-note warn', 'This race has all assists off. Your own assist settings come back afterwards.'));
          const assists = h('div', 'm-group', h('div', 'm-gtitle', 'Assists'));
          for (const [key, label] of [['assistTc', 'Traction control'], ['assistAbs', 'ABS'], ['assistEsc', 'Stability control']]) {
            assists.append(segRow(label, [[true, 'On'], [false, 'Off']], () => settings[key], v => { settings[key] = v; persist(); api.applyAssists(); }));
          }
          p.append(assists);
          const sens = sliderRow('Cursor sensitivity', { min: 50, max: 200, step: 5, get: () => Math.round(settings.steerSens * 100), set: v => { settings.steerSens = Math.max(0.5, Math.min(2, v / 100)); persist(); }, fmt: v => `${Math.round(v)}%` });
          const steer = segRow('Steering', [['keyboard', 'Keyboard'], ['cursor', 'Cursor']], () => settings.steering, v => { settings.steering = v; persist(); sens.input.disabled = v !== 'cursor'; });
          sens.input.disabled = settings.steering !== 'cursor';
          p.append(steer, sens);
          if (api.hasRacingLine && api.hasRacingLine()) {
            const allowed = api.racingLineAllowed ? api.racingLineAllowed() : true;
            p.append(segRow('Racing line', [[false, 'Off'], [true, 'On']], () => settings.racingLine, v => { settings.racingLine = v; persist(); }, { note: allowed ? 'Colours show where to brake, lift and push. The L key switches it too.' : 'This race does not allow the racing line.' }));
          }
        },
        Display(p) {
          p.append(segRow('View', [[false, 'Driving'], [true, 'Top-down debug']], () => api.getTopDown(), v => api.setTopDown(v)));
          p.append(segRow('Detail', [[false, 'Full'], [true, 'Blockout']], () => !!settings.blockout, v => { settings.blockout = v; persist(); api.applyLook(); }));
          p.append(segRow('Graphics quality', QUALITY_SETTINGS.map(k => [k, QUALITY_LABELS[k]]), () => settings.quality, v => { settings.quality = v; persist(); api.qualityChanged(); },
            { note: 'Auto keeps the frame rate up by lowering the render scale when the screen is too demanding. High is the full look; Medium and Low use a smaller shadow map and a lower pixel density.' }));
          p.append(segRow('FPS readout', [[false, 'Hide'], [true, 'Show']], () => !!settings.hud.fps, v => { settings.hud.fps = v; persist(); }, { note: 'Frame rate and frame time in the top corner. The F key switches it too.' }));
          p.append(segRow('Handling readout', [[false, 'Hide'], [true, 'Show']], () => !!settings.debug, v => { settings.debug = v; persist(); }));
          p.append(segRow('Autopilot demo lap', [[false, 'Off'], [true, 'On']], () => api.getAutopilot(), v => api.setAutopilot(v)));
        },
        Interface(p) {
          // every switch writes into settings.hud / settings.trackMap; the HUD reads them each frame. `rows` are re-synced after any
          // change because a preset changes many switches at once.
          const rows = [], sync = () => rows.forEach(r => r.sync()), add = (parent, row) => { rows.push(row); parent.append(row); return row; };
          const onOff = (label, get, set, note) => segRow(label, [[true, 'On'], [false, 'Off']], get, v => { set(v); persist(); sync(); }, { note });
          add(p, segRow('HUD preset', PRESET_ORDER.map(k => [k, PRESET_NAMES[k]]), () => detectPreset(settings), v => { applyPreset(settings, v); persist(); sync(); }, { note: 'The H key steps through Full, Minimal and Off. Switching a single part below makes it Custom.' }));
          add(p, sliderRow('HUD scale', { min: SCALE_MIN, max: SCALE_MAX, step: 5, get: () => settings.hudScale, set: v => { settings.hudScale = v; persist(); }, fmt: v => `${Math.round(v)}%` }));
          add(p, segRow('Speed', [['mph', 'mph'], ['kmh', 'km/h']], () => settings.units, v => { settings.units = v; persist(); }));
          const groups = [['Readouts', ['speed', 'lapTimer', 'sectors', 'delta']], ['Warnings and messages', ['limits', 'assists', 'flags']], ['Inputs', ['steerBar', 'pedals', 'inputOverlay']], ['Other', ['fps']]];
          const info = Object.fromEntries(HUD_ELEMENTS.map(e => [e[0], e]));
          for (const [title, keys] of groups) {
            const grp = h('div', 'm-group', h('div', 'm-gtitle', title));
            for (const k of keys) add(grp, onOff(info[k][1], () => settings.hud[k], v => { settings.hud[k] = v; }, info[k][2]));
            p.append(grp);
          }
          const tm = settings.trackMap, mg = h('div', 'm-group', h('div', 'm-gtitle', 'Track map'));
          const mrow = row => add(mg, row);
          const set = (k, v) => { tm[k] = v; persist(); sync(); };
          add(mg, onOff('Show the track map', () => tm.on, v => { tm.on = v; }, 'The M key switches it too.'));
          mrow(segRow('Size', Object.keys(MAP_SIZES).map(k => [k, k[0].toUpperCase() + k.slice(1)]), () => tm.size, v => set('size', v)));
          mrow(segRow('Position', Object.entries(MAP_POSITIONS), () => tm.position, v => set('position', v)));
          mrow(sliderRow('Opacity', { min: Math.round(MAP_OPACITY_MIN * 100), max: 100, step: 5, get: () => Math.round(tm.opacity * 100), set: v => { tm.opacity = v / 100; persist(); }, fmt: v => `${Math.round(v)}%` }));
          mrow(segRow('Orientation', [[false, 'North up'], [true, 'Rotate with car']], () => tm.rotate, v => set('rotate', v)));
          mrow(segRow('Zoom', [['circuit', 'Whole circuit'], ['local', 'Local area']], () => tm.zoom, v => set('zoom', v)));
          mrow(segRow('Corner numbers', [['off', 'Off'], ['numbers', 'On']], () => tm.labels, v => set('labels', v)));
          p.append(mg);
        },
        Weather(p) { p.append(...weatherRows(ctx, segRow, h), ...lightningRows(ctx, segRow, h)); },
        Sound(p) {
          p.append(segRow('Sound', [[true, 'On'], [false, 'Off']], () => settings.sound !== false, v => { settings.sound = v; persist(); }));
          p.append(sliderRow('Volume', { min: 0, max: 100, step: 1, get: () => Math.round(settings.volume * 100), set: v => { settings.volume = Math.max(0, Math.min(1, v / 100)); persist(); }, fmt: v => `${Math.round(v)}%` }));
        },
        Controls(p) {
          const box = h('div', 'm-controls', h('p', 'm-note', 'Loading controls...'));
          p.append(box);
          let dead = false, inst = null;
          import('./gamepad.js').then(m => {
            if (dead) return;
            box.replaceChildren();
            inst = m.mountControls(box, { settings, save });
          }).catch(() => { if (!dead) box.replaceChildren(h('p', 'm-note', 'Controls: coming soon.')); });
          return () => { dead = true; if (inst && inst.dispose) inst.dispose(); };
        },
        Online(p) {
          const nameInput = h('input', 'm-text'); nameInput.type = 'text'; nameInput.maxLength = 16; nameInput.placeholder = 'Your name'; nameInput.setAttribute('aria-label', 'Your name');
          nameInput.autocomplete = 'off'; nameInput.spellcheck = false;
          const lobbyName = document.getElementById('mp-name');
          nameInput.value = lobbyName ? lobbyName.value : '';
          nameInput.addEventListener('change', () => { if (lobbyName) { lobbyName.value = nameInput.value; lobbyName.dispatchEvent(new Event('change', { bubbles: true })); } });
          p.append(h('div', 'm-row', h('label', 'm-label', 'Name in online rooms'), nameInput));
          const info = h('p', 'm-note');
          const via = document.getElementById('mp-via'), status = document.getElementById('mp-status');
          const t = () => { info.textContent = (via && via.textContent) || 'Not in a room. Rooms use a relay server when the site has one set, and peer to peer otherwise. Both work the same in the game.'; };
          t();
          p.append(info, h('p', 'm-note', 'Host a room or join one from Online in the main menu.'));
          void status;
        },
      };

      const tabButtons = TABS.map((name, i) => {
        const b = btn(name, 'm-tab', () => show(i)); b.setAttribute('role', 'tab'); b.dataset.tab = name; tabs.append(b); return b;
      });
      function show(i) {
        if (disposeTab) { disposeTab(); disposeTab = null; }
        current = (i + TABS.length) % TABS.length;
        ctx.menu.lastSettingsTab = TABS[current];
        tabButtons.forEach((b, k) => { b.classList.toggle('sel', k === current); b.setAttribute('aria-selected', String(k === current)); });
        panel.replaceChildren();
        const f = builders[TABS[current]](panel);
        if (typeof f === 'function') disposeTab = f;
      }
      show(current);
      tabButtons[current].dataset.first = '1';
      return { show, step: d => show(current + d), dispose() { if (disposeTab) disposeTab(); } };
    },
    onTab: (d, m) => { if (m) { m.step(d); } },
    unmount(m) { if (m && m.dispose) m.dispose(); },
  };
}

// --- online -----------------------------------------------------------------------------------------------------------

function onlineScreen() {
  let timer = 0, holder = null, home = null;
  return {
    title: 'Online',
    mount(c, ctx) {
      const { settings, save, api } = ctx;
      const mp = document.querySelector('#online-src .mp, .mp');
      home = mp ? mp.parentElement : null;
      holder = mp;
      const lobby = api.lobby;
      c.append(h('p', 'm-sub', 'Race up to eight people. One person hosts a room and shares the five letter code.'));
      if (mp) c.append(mp);
      // the host's race setup and Start button, or a line for guests
      const box = h('div', 'm-online-race');
      const cur = raceSetup(settings);
      const store = () => { settings.raceSetup = { ...cur }; save(settings); };
      const setup = h('div', 'm-hostsetup');
      setup.append(h('div', 'm-gtitle', 'Race setup'));
      setup.append(segRow('Laps', LAP_CHOICES.map(n => [n, String(n)]), () => cur.laps, v => { cur.laps = v; cur.custom = false; store(); }));
      setup.append(segRow('Assists', [['any', 'Any'], ['off', 'All off']], () => cur.assists, v => { cur.assists = v; store(); }));
      if (api.hasRacingLine && api.hasRacingLine()) setup.append(segRow('Racing line', [[true, 'Allowed'], [false, 'Not allowed']], () => cur.racingLine, v => { cur.racingLine = v; store(); }));
      setup.append(...weatherRows(ctx, segRow, h));
      const startBtn = btn('Start race', 'm-btn primary', () => api.hostStartRace({ laps: cur.laps, assists: cur.assists, racingLine: api.hasRacingLine && api.hasRacingLine() ? cur.racingLine : true }));
      setup.append(h('div', 'm-actions', startBtn));
      const wait = h('p', 'm-note', 'Waiting for the host to start the race.');
      box.append(setup, wait);
      c.append(box);
      const drive = btn('Drive around while you wait', 'm-btn', () => api.startPractice({ start: 'pit' }));
      c.append(h('div', 'm-actions', drive));
      const upd = () => {
        const m = lobby && lobby.mp;
        const inRoom = !!(m && (m.phase === 'hosting' || m.phase === 'joined'));
        box.hidden = !inRoom;
        setup.hidden = !(inRoom && m.isHost);
        wait.hidden = !(inRoom && !m.isHost);
        startBtn.disabled = !(inRoom && m.isHost);
      };
      upd();
      timer = setInterval(upd, 300);
      return null;
    },
    unmount() {
      clearInterval(timer);
      // give the lobby block back to its hidden home so lobby.js keeps its elements
      const src = document.getElementById('online-src');
      if (holder && src && !src.contains(holder)) src.append(holder);
      holder = null;
    },
  };
}

// --- plug-in screens --------------------------------------------------------------------------------------------------

function comingScreen() {
  return {
    title: p => (p && p.name ? p.name[0].toUpperCase() + p.name.slice(1) : 'Coming soon'),
    mount(c) { c.append(h('p', 'm-sub', 'Coming soon.'), h('p', 'm-note', 'This part of the game is not ready yet.')); return null; },
  };
}

// Garage: garage.js exports mountGarage(container, { settings, save, onChange }) -> { dispose() }. Missing file: a "Coming soon" panel.
function garageScreen() {
  return {
    title: 'Garage',
    mount(c, ctx) {
      const box = h('div', 'm-garage', h('p', 'm-note', 'Loading the garage...'));
      c.append(box);
      let dead = false, inst = null;
      import('./garage.js').then(m => {
        if (dead) return;
        box.replaceChildren();
        inst = m.mountGarage(box, { settings: ctx.settings, save: ctx.save, onChange: () => { ctx.api.livery && ctx.api.livery(); } });
      }).catch(() => { if (!dead) box.replaceChildren(h('p', 'm-sub', 'Coming soon.'), h('p', 'm-note', 'The garage is not ready yet.')); });
      return { dispose() { dead = true; if (inst && inst.dispose) inst.dispose(); } };
    },
  };
}

export function registerScreens(menu) {
  menu.addScreen('main', homeScreen());
  menu.addScreen('pause', pauseScreen());
  menu.addScreen('setup', setupScreen());
  menu.addScreen('settings', settingsScreen());
  menu.addScreen('online', onlineScreen());
  menu.addScreen('garage', garageScreen());
  menu.addScreen('coming', comingScreen());
}
