// The screens of the menu: main menu, pause, race setup, settings (categories), online lobby, garage, global times and the
// placeholders. Registered on the menu by registerScreens(menu). The game's side of each button is `ctx.api` (director.js).
// The look is the Lakeside UI system (.interface-design/system.md): a rail on the left, groups of rows, one control per setting.

import { LAP_CHOICES } from './session.js';
import { weatherRows, lightningRows } from './weatherMenu.js';
import { QUALITY_SETTINGS, QUALITY_LABELS } from './quality.js';
import { HUD_ELEMENTS, MAP_SIZES, MAP_POSITIONS, PRESET_ORDER, PRESET_NAMES, SCALE_MIN, SCALE_MAX, MAP_OPACITY_MIN, detectPreset, applyPreset } from './hudSettings.js';
import { boardLabel, cleanName as cleanTimesName } from './globalTimes.js';
import { fmtTime } from './hud.js';
import { loadBest, bestKey } from './board.js';
import { ownLivery, localPlayerId, STRIPE_STYLES } from './livery.js';
import { TIME_NAMES, WEATHER_NAMES } from './weather.js';

export const h = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const btn = (label, cls, onClick) => { const b = h('button', cls, label); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };

// The circuit as the gantry shows it. Hard-coded: the track length is 3835 m (src/director.js, session.js).
const CIRCUIT = { name: 'Lakeside Circuit', facts: '3.83 km · 14 turns · 2 DRS zones' };
const DEFAULT_LAP_S = 95;             // the estimate for a lap until the driver has one saved (1:35)

// --- rows: one component for every setting (system.md: row, switch, segmented control, stepper, slider) ----------------------

// A labelled row of choices: opts [[value, label]...]; get() the current value, set(v) stores it. Returns the row with .sync().
export function segRow(label, opts, get, set, { note } = {}) {
  const row = h('div', 'row'), lab = h('div', 'row-l', h('b', '', label));
  if (note) lab.append(h('span', '', note));
  const seg = h('div', 'seg');
  seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', label);
  const bs = opts.map(([v, text]) => { const b = btn(text, '', () => { set(v); sync(); }); b.dataset.v = String(v); b.setAttribute('role', 'radio'); seg.append(b); return b; });
  const sync = () => { for (const b of bs) { const on = b.dataset.v === String(get()); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } };
  row.append(lab, h('div', 'row-c', seg));
  row.sync = sync; row.buttons = bs;
  sync();
  return row;
}

// An on/off row as a switch. get() true or false, set(v) stores it. The row has .sync() and .buttons (the switch).
export function boolRow(label, get, set, { note } = {}) {
  const row = h('div', 'row'), lab = h('div', 'row-l', h('b', '', label));
  if (note) lab.append(h('span', '', note));
  const sw = h('button', 'sw');
  sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', label);
  const sync = () => { const on = !!get(); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); };
  sw.addEventListener('click', () => { set(!get()); sync(); });
  row.append(lab, h('div', 'row-c', sw));
  row.sync = sync; row.buttons = [sw];
  sync();
  return row;
}

// A number with a visible value: a slider and its value. Fills the track in purple as it moves.
export function sliderRow(label, { min, max, step, get, set, fmt = v => `${Math.round(v)}`, note }) {
  const row = h('div', 'row'), lab = h('div', 'row-l', h('b', '', label));
  if (note) lab.append(h('span', '', note));
  const input = h('input', ''), val = h('output', 'val');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.setAttribute('aria-label', label);
  const paint = () => { input.style.setProperty('--fill', `${((+input.value - min) / ((max - min) || 1)) * 100}%`); val.textContent = fmt(+input.value); };
  const sync = () => { input.value = String(get()); paint(); };
  input.addEventListener('input', () => { set(+input.value); paint(); });
  row.append(lab, h('div', 'row-c slider', input, val));
  row.sync = sync; row.input = input;
  sync();
  return row;
}

// A label and a text field or other control on one row
const fieldRow = (label, control) => h('div', 'row', h('div', 'row-l', h('b', '', label)), h('div', 'row-c', control));

// A titled group of rows: the title is a small uppercase label, the rows sit in one card
export function group(title, ...kids) { return h('section', 'group', h('div', 'gtitle', title), h('div', 'rows', ...kids)); }
// the first group of a screen is marked with the chip class on its title (no chip is drawn for it)
const primary = g => { const t = g.querySelector('.gtitle'); if (t) t.classList.add('chip'); return g; };

const setupDefaults = { laps: 5, custom: false, assists: 'any', racingLine: true, trackLimits: 'penalty' };
export const raceSetup = settings => ({ ...setupDefaults, ...(settings.raceSetup || {}) });

// the best valid lap saved in this browser (board.js keeps the list, fastest first), or null
const bestTime = reverse => { const l = loadBest(undefined, bestKey(!!reverse)); return l.length ? l[0].time : null; };

// The circuit outline for the summary card: the track's own points, thinned to about 160 and fitted to the box.
function trackSvg(track) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 120'); svg.setAttribute('aria-hidden', 'true');
  if (!track || !track.N) return svg;
  const step = Math.max(1, Math.floor(track.N / 160));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < track.N; i += step) { x0 = Math.min(x0, track.x[i]); x1 = Math.max(x1, track.x[i]); z0 = Math.min(z0, track.z[i]); z1 = Math.max(z1, track.z[i]); }
  const pad = 10, k = Math.min((200 - 2 * pad) / ((x1 - x0) || 1), (120 - 2 * pad) / ((z1 - z0) || 1));
  const ox = (200 - (x1 - x0) * k) / 2, oz = (120 - (z1 - z0) * k) / 2;
  const pt = i => [ox + (track.x[i] - x0) * k, oz + (track.z[i] - z0) * k];
  let d = '';
  for (let i = 0, n = 0; i < track.N; i += step, n++) { const [x, y] = pt(i); d += `${n ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d + 'Z');
  const [sx, sy] = pt(0), dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', sx.toFixed(1)); dot.setAttribute('cy', sy.toFixed(1)); dot.setAttribute('r', '4'); dot.setAttribute('class', 'start');
  svg.append(path, dot);
  return svg;
}

// --- the rail (main menu, and the other screens of the main menu and the pause menu) ------------------------------------

const HOME = [
  ['practice', 'Free practice'],
  ['timetrial', 'Time trial'],
  ['race', 'Race'],
  ['online', 'Online'],
  ['times', 'Global times'],
  ['garage', 'Garage'],
  ['settings', 'Settings'],
];

// Opens one of the seven entries. Practice and race open their setup; time trial starts at once.
function openEntry(ctx, id) {
  const m = ctx.menu;
  if (id === 'practice') return m.jump('setup', { mode: 'practice' });
  if (id === 'race') return m.jump('setup', { mode: 'race' });
  if (id === 'timetrial') return ctx.api.startTimeTrial();
  return m.jump(id);
}

// The primary button at the top of the main menu: resumes the last mode used (settings.lastMode, saved on each start)
function resumeButton(ctx) {
  const { settings, api } = ctx;
  const mode = settings.lastMode || 'practice';
  const reverse = mode === 'practice' && settings.practiceReverse === true;
  const bests = { practice: () => bestTime(reverse), timetrial: () => bestTime(false) };
  const best = bests[mode] ? bests[mode]() : null;
  const R = {
    practice: ['Drive free practice', () => api.startPractice({ start: settings.practiceStart === 'standing' ? 'standing' : 'pit', reverse })],
    timetrial: ['Drive time trial', () => api.startTimeTrial()],
    race: ['Set up a race', () => openEntry(ctx, 'race')],
    online: ['Go online', () => openEntry(ctx, 'online')],
  };
  const [label, go] = R[mode] || R.practice;
  const b = h('button', 'btn primary resume', h('b', '', label), best ? h('span', '', `Best lap ${fmtTime(best)}`) : null);
  b.type = 'button'; b.dataset.first = '1';
  b.addEventListener('click', go);
  return b;
}

function navList(ctx, activeId) {
  const nav = h('nav', 'nav');
  nav.setAttribute('aria-label', 'Main menu');
  HOME.forEach(([id, label], i) => {
    // Online shows a lake dot while the driver is in a room (live state)
    const live = id === 'online' && ctx.api.inRoom && ctx.api.inRoom() ? h('i', 'live-dot') : null;
    const b = h('button', 'nav-item', h('span', '', label, live), h('kbd', '', String(i + 1)));
    b.type = 'button';
    b.style.setProperty('--i', String(i));
    if (id === activeId) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => openEntry(ctx, id));
    nav.append(b);
  });
  return nav;
}

// the driver: race number and name from the paint (settings.livery), the stripe style under it
function driverChip(ctx) {
  const l = ownLivery(ctx.settings.livery, localPlayerId());
  const lobbyName = ctx.api.lobby && typeof ctx.api.lobby.name === 'function' ? ctx.api.lobby.name() : '';
  const style = l.style ? STRIPE_STYLES[l.style] : null;
  return h('div', 'driver', h('b', 'no', l.number >= 0 ? String(l.number) : '-'),
    h('span', '', h('strong', '', l.name || lobbyName || 'Driver'), h('small', '', style ? `GT · ${style}` : 'GT')));
}

function railNodes(ctx, top) {
  const main = ctx.menu.kind === 'main';
  const brand = h(main ? 'button' : 'div', 'rail-brand', h('b', '', 'Lakeside'), h('span', '', 'GT racing in the browser'));
  if (main) { brand.type = 'button'; brand.addEventListener('click', () => ctx.menu.jump('main')); }
  const out = [brand];
  if (main) {
    if (top.id === 'main') out.push(resumeButton(ctx));
    const active = top.id === 'setup' ? ((top.params && top.params.mode) || 'race') : top.id;
    out.push(navList(ctx, active));
  }
  if (top.id === 'pause') out.push(pauseRail(ctx));
  out.push(driverChip(ctx));
  return out;
}

// --- home -------------------------------------------------------------------------------------------------------------

function homeScreen() {
  return {
    home: true, rail: true, title: '',
    onDigit: (n, mounted, ctx) => { const e = HOME[n - 1]; if (e) openEntry(ctx, e[0]); },
    mount(c) {
      c.append(h('div', 'm-caption', h('b', '', CIRCUIT.name), h('span', '', CIRCUIT.facts)));
      return null;
    },
  };
}

// --- pause ------------------------------------------------------------------------------------------------------------

// the session as the pause screen shows it: the mode, the laps driven, the best lap and the lap in progress (frozen while paused)
const MODE_LABEL = { practice: 'Free practice', timetrial: 'Time trial', race: 'Race', online: 'Online race' };
function sessionCard(ctx) {
  const st = ctx.api.sessionStats ? ctx.api.sessionStats() : null;
  if (!st || !st.mode) return null;
  const race = st.mode === 'race' || st.mode === 'online';
  const name = MODE_LABEL[st.mode] + (race && st.laps ? `, ${st.laps} laps` : '') + (st.reverse ? ', reverse' : '');
  const laps = race && st.laps ? `${Math.min(st.done, st.laps)} of ${st.laps}` : String(st.done);
  return h('div', 'session-card',
    h('p', 'gtitle', 'Session'),
    h('b', 'session-mode', name),
    h('div', 'facts',
      h('span', '', race ? 'Laps' : 'Laps driven'), h('b', '', laps),
      h('span', '', 'Best lap'), h('b', '', st.best ? fmtTime(st.best) : '-:--.---'),
      h('span', '', 'Lap now'), h('b', '', st.current != null ? fmtTime(st.current) : '-:--.---')));
}

// the pause rail's shortcuts: the same actions as the pane, numbered 1 to 4
function pauseActions(ctx) {
  return [
    ['Resume', () => ctx.api.resume()],
    ['Restart session', () => ctx.api.restart()],
    ['Settings', () => ctx.menu.push('settings')],
    ['Global times', () => ctx.menu.push('times')],
  ];
}
function pauseRail(ctx) {
  const nav = h('nav', 'nav');
  nav.setAttribute('aria-label', 'Pause menu');
  pauseActions(ctx).forEach(([label, fn], i) => {
    const b = h('button', 'nav-item', h('span', '', label), h('kbd', '', String(i + 1)));
    b.type = 'button';
    b.addEventListener('click', fn);
    nav.append(b);
  });
  return h('div', 'rail-pause', sessionCard(ctx), nav);
}

function pauseScreen() {
  return {
    title: 'Paused', backable: false, rail: true,
    onDigit: (n, mounted, ctx) => { const a = pauseActions(ctx)[n - 1]; if (a) a[1](); },
    mount(c, ctx) {
      const resume = btn('Resume', 'btn primary', () => ctx.api.resume());
      resume.dataset.first = '1';
      const list = h('div', 'rows');
      const items = [
        ['Restart session', '', () => ctx.api.restart()],
        ['Settings', '', () => ctx.menu.push('settings')],
        ['Global times', '', () => ctx.menu.push('times')],
        ...(ctx.api.screen && ctx.api.screen.canControl() ? [['Screen control', '', () => ctx.menu.push('screen')]] : []),
        ['Report a problem', '', () => ctx.api.report()],
        ['Back to main menu', 'danger quiet', () => confirmLeave()],
      ];
      for (const [label, cls, fn] of items) list.append(btn(label, 'btn-row ' + cls, fn));
      const sure = h('div', 'confirm'); sure.hidden = true;
      function confirmLeave() {
        list.hidden = true; resume.hidden = true; sure.hidden = false;
        sure.replaceChildren(h('p', '', 'Leave this session and go back to the main menu? Your laps in this session are not kept except the ones already saved in Times.'),
          h('div', 'actions', btn('Stay', 'btn', () => { sure.hidden = true; list.hidden = false; resume.hidden = false; ctx.menu.focusFirst(); }), btn('Leave', 'btn danger', () => ctx.api.toMainMenu())));
        sure.querySelector('button').dataset.first = '1';
        ctx.menu.focusFirst();
      }
      c.append(resume, list, sure);
      return null;
    },
    onBack: ctx => { ctx.api.resume(); return true; },
  };
}

// --- setup (race and practice) ----------------------------------------------------------------------------------------
// Three groups on the left, a summary card on the right with the track map, what was chosen, and the Start button.

function setupScreen() {
  return {
    rail: true,
    title: p => (p && p.mode === 'practice' ? 'Free practice' : 'Race setup'),
    mount(c, ctx) {
      const { settings, save, api } = ctx, mode = (ctx.params && ctx.params.mode) || 'race';
      const grid = h('div', 'setup'), groups = h('div', 'setup-groups'), summary = h('div', 'summary');
      const big = h('div', 'big'), facts = h('div', 'facts'), map = h('div', 'track-map');
      map.append(trackSvg(api.track));
      grid.append(groups, summary);
      c.append(h('p', 'm-sub', mode === 'practice' ? 'Drive as long as you like. Reset puts you back on the track anywhere.' : 'Standing start from the grid with the five lights.'), grid);
      const fact = (k, v) => [h('span', '', k), h('b', '', v)];
      const conditions = () => { const e = api.environment ? api.environment() : { weather: settings.weather, time: settings.timeOfDay }; return `${TIME_NAMES[e.time] || ''} · ${WEATHER_NAMES[e.weather] || ''}`; };

      if (mode === 'practice') {
        const refresh = () => {
          big.replaceChildren('Free practice', h('small', '', 'no results'));
          facts.replaceChildren(...fact('Start', settings.practiceStart === 'standing' ? 'Starting grid' : 'Pit lane'), ...fact('Direction', settings.practiceReverse === true ? 'Reverse' : 'Normal'), ...fact('Conditions', conditions()));
        };
        groups.append(primary(group('Start',
          segRow('Start from', [['pit', 'Pit lane'], ['standing', 'Starting grid']], () => settings.practiceStart || 'pit', v => { settings.practiceStart = v; save(settings); refresh(); }),
          segRow('Direction', [[false, 'Normal'], [true, 'Reverse']], () => settings.practiceReverse === true, v => { settings.practiceReverse = v; save(settings); refresh(); }))));
        groups.append(...weatherRows(ctx, segRow, h, 'Conditions'));
        const go = btn('Start practice', 'btn primary', () => api.startPractice({ start: settings.practiceStart === 'standing' ? 'standing' : 'pit', reverse: settings.practiceReverse === true }));
        go.dataset.first = '1';
        summary.append(big, facts, map, go);
        refresh();
        return null;
      }

      const cur = raceSetup(settings);
      const hasLine = !!(api.hasRacingLine && api.hasRacingLine());
      const store = () => { settings.raceSetup = { ...cur }; save(settings); refresh(); };
      const num = h('output', 'stepper-num', String(cur.laps));
      const minus = btn('−', 'step', () => { cur.laps = Math.max(1, cur.laps - 1); upd(); }), plus = btn('+', 'step', () => { cur.laps = Math.min(99, cur.laps + 1); upd(); });
      minus.setAttribute('aria-label', 'One lap fewer'); plus.setAttribute('aria-label', 'One lap more');
      const customRow = fieldRow('Number of laps', h('div', 'stepper', minus, num, plus));
      const lapsOpts = [...LAP_CHOICES.map(n => [n, String(n)]), ['custom', 'Custom']];
      const laps = segRow('Laps', lapsOpts, () => (cur.custom ? 'custom' : cur.laps), v => { if (v === 'custom') cur.custom = true; else { cur.custom = false; cur.laps = v; } upd(); });
      function upd() { num.textContent = String(cur.laps); customRow.hidden = !cur.custom; laps.sync(); store(); }
      const limits = segRow('Track limits', [['warn', 'Warn only'], ['penalty', 'Penalty']], () => cur.trackLimits, v => { cur.trackLimits = v; store(); },
        { note: 'Cutting a corner always warns and voids the lap. In a race, a cut that gains time adds a penalty.' });
      const assists = segRow('Assists', [['any', 'Any'], ['off', 'All off']], () => cur.assists, v => { cur.assists = v; store(); },
        { note: 'All off switches traction control, ABS and stability control off for the race.' });
      const line = segRow('Racing line', [[true, 'Allowed'], [false, 'Not allowed']], () => cur.racingLine, v => { cur.racingLine = v; store(); });

      groups.append(primary(group('Format', laps, customRow, limits)));
      groups.append(group('Rules', assists, ...(hasLine ? [line] : [])));
      groups.append(...weatherRows(ctx, segRow, h, 'Conditions'));

      function refresh() {
        const perLap = bestTime(false) || DEFAULT_LAP_S;
        big.replaceChildren(`${cur.laps} ${cur.laps === 1 ? 'lap' : 'laps'}`, h('small', '', `about ${Math.max(1, Math.round(cur.laps * perLap / 60))} min`));
        facts.replaceChildren(...fact('Start', 'Standing'), ...fact('Conditions', conditions()), ...fact('Assists', cur.assists === 'off' ? 'All off' : 'Any'), ...fact('Track limits', cur.trackLimits === 'warn' ? 'Warn only' : 'Penalty'));
      }
      const go = btn('Start race', 'btn primary', () => api.startRace({ laps: cur.laps, assists: cur.assists, racingLine: hasLine ? cur.racingLine : true, trackLimits: cur.trackLimits }));
      go.dataset.first = '1';
      summary.append(big, facts, map, go);
      upd();
      return null;
    },
  };
}

// --- settings ---------------------------------------------------------------------------------------------------------

function settingsScreen() {
  const TABS = ['Driving', 'Controls', 'Display', 'Interface', 'Weather', 'Sound', 'Online'];
  return {
    rail: true,
    title: 'Settings',
    mount(c, ctx) {
      const { settings, save, api } = ctx;
      c.append(h('p', 'm-sub', 'Changes save as you make them.'));
      const shell = h('div', 'set');
      const tabs = h('nav', 'sub'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Settings categories');
      const panel = h('div', 'set-panel'); panel.setAttribute('role', 'tabpanel');
      shell.append(tabs, panel);
      c.append(shell);
      let current = Math.max(0, TABS.indexOf(ctx.menu.lastSettingsTab || 'Driving')), disposeTab = null;
      const persist = () => save(settings);
      const forced = api.session && api.session() && api.session().assists === 'off';

      // every row of the open category, so a change that moves several switches (a HUD preset) can re-sync them all
      let rows = [];
      const track = row => { rows.push(row); return row; };
      const sync = () => rows.forEach(r => r.sync());
      const onOff = (label, get, set, note) => track(boolRow(label, get, v => { set(v); persist(); sync(); }, { note }));

      const builders = {
        Driving(p) {
          if (forced) p.append(h('p', 'm-note warn', 'This race has all assists off. Your own assist settings come back afterwards.'));
          p.append(group('Units and steering',
            segRow('Speed', [['mph', 'mph'], ['kmh', 'km/h']], () => settings.units, v => { settings.units = v; persist(); }),
            ...(() => {
              const sens = sliderRow('Cursor sensitivity', { min: 50, max: 200, step: 5, get: () => Math.round(settings.steerSens * 100), set: v => { settings.steerSens = Math.max(0.5, Math.min(2, v / 100)); persist(); }, fmt: v => `${Math.round(v)}%` });
              const steer = segRow('Steering', [['keyboard', 'Keyboard'], ['cursor', 'Cursor']], () => settings.steering, v => { settings.steering = v; persist(); sens.input.disabled = v !== 'cursor'; },
                { note: 'Cursor steering follows your mouse across the screen' });
              sens.input.disabled = settings.steering !== 'cursor';
              return [steer, sens];
            })()));
          const assists = [
            onOff('Traction control', () => settings.assistTc, v => { settings.assistTc = v; api.applyAssists(); }, 'Limits wheelspin under power'),
            onOff('ABS', () => settings.assistAbs, v => { settings.assistAbs = v; api.applyAssists(); }, 'Stops the wheels locking under braking'),
            onOff('Stability control', () => settings.assistEsc, v => { settings.assistEsc = v; api.applyAssists(); }, 'Catches slides before they become spins'),
          ];
          if (api.hasRacingLine && api.hasRacingLine()) {
            const allowed = api.racingLineAllowed ? api.racingLineAllowed() : true;
            assists.push(onOff('Racing line', () => settings.racingLine, v => { settings.racingLine = v; }, allowed ? 'Colours show where to brake, lift and push. The L key switches it too.' : 'This race does not allow the racing line.'));
          }
          p.append(group('Driver assists', ...assists));
        },
        Display(p) {
          p.append(group('View',
            segRow('View', [[false, 'Driving'], [true, 'Top-down debug']], () => api.getTopDown(), v => api.setTopDown(v)),
            onOff('Free look', () => settings.freeLook !== false, v => { settings.freeLook = v; }, 'Drag with the mouse (right button with cursor steering) or push the right stick to look round the car. Let go and the camera settles back.'),
            track(segRow('Detail', [[false, 'Full'], [true, 'Blockout']], () => !!settings.blockout, v => { settings.blockout = v; persist(); api.applyLook(); })),
            track(segRow('Graphics quality', QUALITY_SETTINGS.map(k => [k, QUALITY_LABELS[k]]), () => settings.quality, v => { settings.quality = v; persist(); api.qualityChanged(); },
              { note: 'Auto keeps the frame rate up by lowering the render scale when the screen is too demanding. High is the full look; Medium and Low use a smaller shadow map and a lower pixel density.' }))));
          // the autopilot drives the forward line only: in a reverse session it is switched off (main.js) and cannot be turned on
          const reverseNow = !!(api.session && api.session() && api.session().reverse);
          const ap = track(boolRow('Autopilot demo lap', () => api.getAutopilot(), v => api.setAutopilot(v),
            { note: reverseNow ? 'Not in a reverse session: the autopilot drives the forward line only.' : undefined }));
          if (reverseNow) for (const b of ap.buttons) b.disabled = true;
          p.append(group('Readouts',
            onOff('FPS readout', () => !!settings.hud.fps, v => { settings.hud.fps = v; }, 'Frame rate and frame time in the top corner. The F key switches it too.'),
            onOff('Handling readout', () => !!settings.debug, v => { settings.debug = v; }),
            ap));
        },
        Interface(p) {
          // every switch writes into settings.hud / settings.trackMap; the HUD reads them each frame. `rows` are re-synced after any
          // change because a preset changes many switches at once.
          p.append(group('HUD',
            track(segRow('HUD preset', PRESET_ORDER.map(k => [k, PRESET_NAMES[k]]), () => detectPreset(settings), v => { applyPreset(settings, v); persist(); sync(); },
              { note: 'The H key steps through Full, Minimal and Off. Switching a single part below makes it Custom.' })),
            track(sliderRow('HUD scale', { min: SCALE_MIN, max: SCALE_MAX, step: 5, get: () => settings.hudScale, set: v => { settings.hudScale = v; persist(); }, fmt: v => `${Math.round(v)}%` })),
            track(segRow('Speed', [['mph', 'mph'], ['kmh', 'km/h']], () => settings.units, v => { settings.units = v; persist(); }))));
          const info = Object.fromEntries(HUD_ELEMENTS.map(e => [e[0], e]));
          const groups = [['Readouts', ['speed', 'lapTimer', 'sectors', 'minisectors', 'delta']], ['Warnings and messages', ['limits', 'assists', 'flags']], ['Inputs', ['steerBar', 'pedals', 'inputOverlay']], ['Other', ['fps']]];
          for (const [title, keys] of groups) p.append(group(title, ...keys.map(k => onOff(info[k][1], () => settings.hud[k], v => { settings.hud[k] = v; }, info[k][2]))));
          p.append(group('Online', onOff('Ping readout', () => settings.showPing !== false, v => { settings.showPing = v; }, 'The round trip to the relay in ms, in the top corner while online. Green under 60 ms, amber under 120, red above.')));
          const tm = settings.trackMap;
          const set = (k, v) => { tm[k] = v; persist(); sync(); };
          p.append(group('Track map',
            onOff('Show the track map', () => tm.on, v => { tm.on = v; }, 'The M key switches it too.'),
            track(segRow('Size', Object.keys(MAP_SIZES).map(k => [k, k[0].toUpperCase() + k.slice(1)]), () => tm.size, v => set('size', v))),
            track(segRow('Position', Object.entries(MAP_POSITIONS), () => tm.position, v => set('position', v))),
            track(sliderRow('Opacity', { min: Math.round(MAP_OPACITY_MIN * 100), max: 100, step: 5, get: () => Math.round(tm.opacity * 100), set: v => { tm.opacity = v / 100; persist(); }, fmt: v => `${Math.round(v)}%` })),
            track(segRow('Orientation', [[false, 'North up'], [true, 'Rotate with car']], () => tm.rotate, v => set('rotate', v))),
            track(segRow('Zoom', [['circuit', 'Whole circuit'], ['local', 'Local area']], () => tm.zoom, v => set('zoom', v))),
            track(segRow('Corner numbers', [['off', 'Off'], ['numbers', 'On']], () => tm.labels, v => set('labels', v)))));
        },
        Weather(p) { p.append(...weatherRows(ctx, segRow, h), ...lightningRows(ctx, boolRow, h)); },
        Sound(p) {
          p.append(group('Sound',
            boolRow('Sound', () => settings.sound !== false, v => { settings.sound = v; persist(); }),
            sliderRow('Volume', { min: 0, max: 100, step: 1, get: () => Math.round(settings.volume * 100), set: v => { settings.volume = Math.max(0, Math.min(1, v / 100)); persist(); }, fmt: v => `${Math.round(v)}%` })));
        },
        Controls(p) {
          const box = h('div', 'ctl-box', h('p', 'm-note', 'Loading controls...'));
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
          const nameInput = h('input', 'field'); nameInput.type = 'text'; nameInput.maxLength = 16; nameInput.placeholder = 'Your name'; nameInput.setAttribute('aria-label', 'Your name');
          nameInput.autocomplete = 'off'; nameInput.spellcheck = false;
          const lobbyName = document.getElementById('mp-name');
          nameInput.value = lobbyName ? lobbyName.value : '';
          nameInput.addEventListener('change', () => { if (lobbyName) { lobbyName.value = nameInput.value; lobbyName.dispatchEvent(new Event('change', { bubbles: true })); } });
          const info = h('p', 'm-note');
          const via = document.getElementById('mp-via');
          const t = () => { info.textContent = (via && via.textContent) || 'Not in a room. Rooms use a relay server when the site has one set, and peer to peer otherwise. Both work the same in the game.'; };
          t();
          p.append(group('Online', fieldRow('Name in online rooms', nameInput)), info, h('p', 'm-note', 'Host a room or join one from Online in the main menu.'));
        },
      };

      const tabButtons = TABS.map((name, i) => {
        const b = btn(name, 'sub-item', () => show(i)); b.setAttribute('role', 'tab'); b.dataset.tab = name; tabs.append(b); return b;
      });
      function show(i) {
        if (disposeTab) { disposeTab(); disposeTab = null; }
        current = (i + TABS.length) % TABS.length;
        ctx.menu.lastSettingsTab = TABS[current];
        rows = [];
        tabButtons.forEach((b, k) => { b.setAttribute('aria-selected', String(k === current)); });
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
// The lobby block (src/lobby.js finds its elements by id) sits in the summary card on the right; the host's race setup and
// the Start button are with it. Guests see the line about waiting for the host.

function onlineScreen() {
  let timer = 0, holder = null, room = null;
  return {
    rail: true,
    title: 'Online',
    mount(c, ctx) {
      const { settings, save, api } = ctx;
      const mp = document.querySelector('#online-src .mp, .mp');
      holder = mp;
      room = mp ? mp.querySelector('#mp-room') : null;
      const lobby = api.lobby;
      c.append(h('p', 'm-sub', 'Race up to eight people. One person hosts a room and shares the five letter code.'));
      const grid = h('div', 'setup online');
      // left: the connect form (name, host, join, the status lines); under it the host's race setup, shown only in a room
      const form = h('div', 'online-form');
      if (mp) form.append(mp);
      const hostBox = h('div', 'online-host');
      const cur = raceSetup(settings);
      const store = () => { settings.raceSetup = { ...cur }; save(settings); };
      const hostSetup = [
        segRow('Laps', LAP_CHOICES.map(n => [n, String(n)]), () => cur.laps, v => { cur.laps = v; cur.custom = false; store(); }),
        segRow('Assists', [['any', 'Any'], ['off', 'All off']], () => cur.assists, v => { cur.assists = v; store(); }),
      ];
      if (api.hasRacingLine && api.hasRacingLine()) hostSetup.push(segRow('Racing line', [[true, 'Allowed'], [false, 'Not allowed']], () => cur.racingLine, v => { cur.racingLine = v; store(); }));
      const wait = h('p', 'm-note', 'Waiting for the host to start the race.');
      hostBox.append(group('Race setup', ...hostSetup), ...weatherRows(ctx, segRow, h, 'Conditions'), wait);
      form.append(hostBox);
      // right: the summary card. Outside a room it says how it works; in a room it is the room card (code, copy, the table of
      // players) with the host's Start button under it
      const how = h('div', 'how', h('p', 'gtitle', 'How it works'),
        h('ol', 'how-steps', h('li', '', 'Host a room. You get a five letter code to share.'), h('li', '', 'Friends type the code and press Join. Up to eight players.'), h('li', '', 'The host picks the laps and conditions, then starts the race.')));
      const roomSlot = h('div', 'room-slot');
      if (room) roomSlot.append(room);
      const startBtn = btn('Start race', 'btn primary', () => api.hostStartRace({ laps: cur.laps, assists: cur.assists, racingLine: api.hasRacingLine && api.hasRacingLine() ? cur.racingLine : true }));
      const card = h('div', 'summary online-card');
      card.append(how, roomSlot, startBtn);
      grid.append(form, card);
      c.append(grid);
      const drive = btn('Drive around while you wait', 'btn', () => api.startPractice({ start: 'pit' }));
      c.append(h('div', 'm-actions', drive));
      const upd = () => {
        const m = lobby && lobby.mp;
        const inRoom = !!(m && (m.phase === 'hosting' || m.phase === 'joined'));
        hostBox.hidden = !inRoom;
        how.hidden = inRoom;
        roomSlot.hidden = !inRoom;
        wait.hidden = !(inRoom && !m.isHost);
        for (const g of hostBox.querySelectorAll('.group')) g.hidden = !(inRoom && m.isHost);   // the host's setup only
        startBtn.hidden = !inRoom;   // the Start button is in the room card only
        startBtn.disabled = !(inRoom && m.isHost);
      };
      upd();
      timer = setInterval(upd, 300);
      return null;
    },
    unmount() {
      clearInterval(timer);
      // give the lobby block back to its hidden home, the room card to its place inside it, so lobby.js keeps its elements
      const src = document.getElementById('online-src');
      if (holder && room && !holder.contains(room)) holder.insertBefore(room, holder.querySelector('#mp-status'));
      if (holder && src && !src.contains(holder)) src.append(holder);
      holder = null; room = null;
    },
  };
}

// --- global times ----------------------------------------------------------------------------------------------------
// The relay's boards (src/globalTimes.js): four filters pick one of the 16 boards, opening on the one the player is driving
// for now. Rows with a stored ghost have a Race button: the ghost drives that lap on the player's lap clock (src/boardGhost.js).

function timesScreen() {
  let seq = 0;
  return {
    rail: true,
    title: 'Global times',
    mount(c, ctx) {
      const gt = ctx.api.globalTimes, client = gt && gt.client();
      const wait = h('p', 'm-sub', 'Finding the times server...');
      c.append(wait);
      const my = ++seq;
      Promise.resolve(gt && gt.ready ? gt.ready() : null).then(() => { if (my === seq) { wait.remove(); build(); } });
      return null;

      function build() {
      if (!client || !client.available()) {
        c.append(h('p', 'm-sub', 'Global times need the game on its website, where it can reach the times server.'),
          h('p', 'm-note', 'Laps you drive here are still kept on this device (hold Tab for your times).'));
        return;
      }
      const board = { ...gt.currentBoard() };
      c.append(h('p', 'm-sub', 'Every valid lap is posted on its own: no track limit warnings, no reset, no autopilot. One row per driver, their best.'));
      const nameIn = h('input', 'field'); nameIn.type = 'text'; nameIn.maxLength = 16; nameIn.autocomplete = 'off'; nameIn.spellcheck = false;
      nameIn.value = gt.name(); nameIn.setAttribute('aria-label', 'Your name on the boards');
      const nameNote = h('p', 'm-note'); nameNote.hidden = true;
      nameIn.addEventListener('change', () => {
        const v = cleanTimesName(nameIn.value);
        if (!v) { nameIn.value = gt.name(); return; }
        gt.setName(v); nameIn.value = gt.name();
        nameNote.hidden = gt.name() === v;
        nameNote.textContent = 'The name painted on your car is used while it is set (Garage).';
        load();
      });
      c.append(group('Your name', fieldRow('Name on the boards', nameIn)), nameNote);
      const rows = [
        segRow('Weather', [['dry', 'Dry'], ['wet', 'Wet']], () => board.weather, v => { board.weather = v; load(); }),
        segRow('Session', [['solo', 'Solo'], ['online', 'Online']], () => board.mode, v => { board.mode = v; load(); }),
        segRow('Direction', [['fwd', 'Normal'], ['rev', 'Reverse']], () => board.dir, v => { board.dir = v; load(); }),
        segRow('Assists', [['on', 'On'], ['off', 'All off']], () => board.assists, v => { board.assists = v; load(); }),
      ];
      c.append(group('Board', ...rows));
      const ghostLine = h('div', 'row t-ghost');
      const status = h('p', 'm-note t-status');
      const list = h('div', 't-list');
      c.append(ghostLine, list, status);

      const showGhost = () => {
        const g = gt.ghostInfo();
        ghostLine.replaceChildren();
        ghostLine.hidden = !g;
        if (g) ghostLine.append(h('div', 'row-l', h('b', '', `Racing the ghost of ${g.name}, ${fmtTime(g.time)}`)), btn('Remove ghost', 'btn', () => { gt.clearGhost(); showGhost(); }));
      };
      const row = (e, you) => {
        const r = h('div', 't-row' + (you ? ' you' : ''), h('span', 't-rank', String(e.rank)), h('span', 't-name', e.name), h('span', 't-time', fmtTime(e.time)),
          h('span', 't-sec', (e.sectors || []).map(x => x.toFixed(1)).join('  ')));
        const cell = h('span', 't-act');
        if (e.ghost) cell.append(btn('Race', 'btn quiet', async () => {
          status.textContent = `Loading the ghost of ${e.name}...`;
          const got = await client.ghost(board, e.name);
          if (!got || !gt.loadGhost({ ...got, board: { ...board } })) { status.textContent = 'That ghost could not be loaded.'; return; }
          showGhost();
          const s = ctx.api.session && ctx.api.session();
          const wantRev = board.dir === 'rev';
          if (s && s.mode === 'practice' && !!s.reverse === wantRev) ctx.api.resume();
          else ctx.api.startPractice({ start: ctx.settings.practiceStart === 'standing' ? 'standing' : 'pit', reverse: wantRev });
        }));
        r.append(cell);
        return r;
      };
      async function load() {
        const my = ++seq;
        for (const r of rows) r.sync();
        status.textContent = `Loading ${boardLabel(board)}...`;
        const res = await client.top(board, gt.name(), 20);
        if (my !== seq) return;   // a newer filter choice is already loading
        list.replaceChildren();
        if (!res) { status.textContent = 'The times server cannot be reached right now.'; return; }
        if (!res.entries.length) list.append(h('p', 'm-note', 'No times on this board yet. Be the first.'));
        for (const e of res.entries) list.append(row(e, res.you && res.you.name.toLowerCase() === e.name.toLowerCase()));
        if (res.you && !res.entries.some(e => e.name.toLowerCase() === res.you.name.toLowerCase())) list.append(h('div', 't-gap', '...'), row(res.you, true));
        const waiting = client.pending ? ` ${client.pending} lap${client.pending > 1 ? 's' : ''} waiting to be posted.` : '';
        status.textContent = boardLabel(board) + '.' + waiting + (client.status.error ? ` ${client.status.error}.` : '');
      }
      showGhost();
      load();
      client.flush().then(ok => { if (ok) load(); });
      }
    },
    unmount() { seq++; },
  };
}

// --- plug-in screens --------------------------------------------------------------------------------------------------

function comingScreen() {
  return {
    rail: true,
    title: p => (p && p.name ? p.name[0].toUpperCase() + p.name.slice(1) : 'Coming soon'),
    mount(c) { c.append(h('p', 'm-sub', 'Coming soon.'), h('p', 'm-note', 'This part of the game is not ready yet.')); return null; },
  };
}

// Garage: garage.js exports mountGarage(container, { settings, save, onChange }) -> { dispose() }. Missing file: a "Coming soon" panel.
function garageScreen() {
  return {
    rail: true,
    title: 'Garage',
    mount(c, ctx) {
      const box = h('div', 'garage-box', h('p', 'm-note', 'Loading the garage...'));
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

// --- the gantry screen's control panel (src/screenControl.js) ---------------------------------------------------------

const AD_NAMES = { lakeside: 'Lakeside', powermedia: 'PowerMedia', ad1: 'Trophy advert', deltadash: 'DeltaDash', ad2: 'Track day advert' };
const FLAG_NAMES = [['yellow', 'Yellow'], ['red', 'Red'], ['green', 'Track clear'], ['final', 'Final lap'], ['chequered', 'Chequered']];

function screenPanel() {
  return {
    rail: true,
    title: 'Screen control',
    mount(c, ctx) {
      const sc = ctx.api.screen;
      if (!sc || !sc.canControl()) {
        c.append(h('p', 'm-sub', 'The host has not given you the screen. Ask them to tick your name in their Screen control.'));
        return null;
      }
      const send = cmd => sc.command(cmd);
      const seg = (...kids) => h('div', 'seg', ...kids);
      const line = (label, ...kids) => h('div', 'row', h('div', 'row-l', h('b', '', label)), h('div', 'row-c', seg(...kids)));

      const lights = btn('Start lights', '', () => send({ c: 'start' }));
      lights.dataset.first = '1';
      c.append(group('Start lights', line('Lights', lights)),
        h('p', 'm-note', 'Runs the start: five lamps, a short random hold, then GO. The cars are not held: this is the screen only. A flag or Clear stops it.'));

      c.append(group('Flags', line('Flag', ...FLAG_NAMES.map(([name, label]) => btn(label, '', () => send({ c: 'flag', name })))), line('Stop', btn('Clear', '', () => send({ c: 'clear' })))));

      const input = h('input', 'field');
      input.type = 'text'; input.maxLength = 40; input.placeholder = 'Up to 40 characters'; input.setAttribute('aria-label', 'Message');
      input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') send({ c: 'msg', text: input.value }); });
      const msg = h('div', 'row', h('div', 'row-c', input), h('div', 'row-c', seg(btn('Show', '', () => send({ c: 'msg', text: input.value })), btn('Clear', '', () => send({ c: 'clear' })))));
      c.append(group('Message', msg));

      const held = sc.state.scene;
      const ads = [];
      for (const name of sc.scenes) {
        const on = sc.adOn(name);
        ads.push(h('div', 'row', h('div', 'row-l', h('b', '', AD_NAMES[name] || name)), h('div', 'row-c', seg(
          btn(held === name ? 'Showing' : 'Show now', held === name ? 'on' : '', () => send({ c: 'scene', name })),
          btn(on ? 'In the loop' : 'Off', on ? 'on' : '', () => send({ c: 'ad', name, on: !on }))))));
      }
      c.append(group('Adverts', line('Loop', btn('Resume the loop', '', () => send({ c: 'loop' })), btn('Next', '', () => send({ c: 'next' }))), ...ads),
        h('p', 'm-note', 'Show now holds one advert until you resume the loop. At least one advert always stays in the loop.'));

      if (ctx.api.inRoom && ctx.api.inRoom() && sc.isHost()) {
        const people = sc.players();
        const rows = people.map(p => h('div', 'row', h('div', 'row-l', h('b', '', p.name)), h('div', 'row-c', seg(
          btn(p.access ? 'Has access' : 'No access', p.access ? 'on' : '', () => { sc.setAccess(p.id, !p.access); ctx.menu.refresh(); })))));
        if (!people.length) rows.push(h('div', 'row', h('div', 'row-l', h('b', '', 'Nobody else is in the room yet.'))));
        c.append(group('Who can use it', ...rows), h('p', 'm-note', 'You always can. Players you give access see this panel in their pause menu. Everyone in the room sees the same screen.'));
      }
      return null;
    },
  };
}

export function registerScreens(menu) {
  menu.buildRail = (ctx, top) => railNodes(ctx, top);
  menu.addScreen('screen', screenPanel());
  menu.addScreen('main', homeScreen());
  menu.addScreen('pause', pauseScreen());
  menu.addScreen('setup', setupScreen());
  menu.addScreen('settings', settingsScreen());
  menu.addScreen('online', onlineScreen());
  menu.addScreen('garage', garageScreen());
  menu.addScreen('times', timesScreen());
  menu.addScreen('coming', comingScreen());
}
