// The learning autopilot's small pieces of interface: the HUD chip and the settings group (experimental, src/learn.js).
// They are built here so the HUD and the menu files only get a line each.

import { fmtLap } from './learn.js';

const statusText = st => {
  if (st.error) return st.error;
  const head = st.running ? 'LEARNING' : 'LEARNED';
  if (st.gen === 0 && st.best == null) return st.running ? 'LEARNING, starting' : 'Nothing learned yet';
  return `${head} gen ${st.gen}, best ${fmtLap(st.best)}${st.line ? `, line ${fmtLap(st.line)}` : ''}`;
};

// The chip over the HUD: shown while the autopilot drives in learning mode or the worker trains. Same look as the slipstream chip.
export function createLearnChip(root, learn, { settings, autopilotOn }) {
  const el = document.createElement('div');
  el.className = 'hud-learn';
  el.hidden = true;
  el.innerHTML = '<div class="hud-slip"><i class="hud-slip-dot"></i><span class="hud-learn-text"></span><em class="hud-learn-tag">Experimental</em><button type="button" class="hud-learn-btn"></button></div>';
  root.append(el);
  const text = el.querySelector('.hud-learn-text'), button = el.querySelector('button');
  button.addEventListener('click', () => (learn.training ? learn.pause() : learn.train()));
  const draw = () => {
    const st = learn.status(), show = learn.training || (autopilotOn() && settings.autopilotMode === 'learn');
    el.hidden = !show;
    if (!show) return;
    el.classList.toggle('idle', !st.running);
    const t = statusText(st);
    if (text._t !== t) { text._t = t; text.textContent = t; }
    const b = learn.training ? 'Pause' : 'Train';
    if (button._t !== b) { button._t = b; button.textContent = b; }
  };
  learn.onChange(draw);
  return { draw };
}

// The settings group: the autopilot style, what it has learned, Train / Pause and Reset. h, btn, group, segRow come from menuScreens.js.
// Returns { el, dispose }: call dispose when the tab is left, it removes the change listener.
export function learnGroup({ h, btn, group, segRow }, learn, settings, persist, styleChanged) {
  const style = segRow('Autopilot style', [['line', 'Racing line'], ['learn', 'Learning (experimental)']], () => settings.autopilotMode || 'line', v => { settings.autopilotMode = v; persist(); styleChanged(); },
    { note: 'Learning drives a line and a pace it works out for itself, trying laps in the background and keeping the fastest clean one. It starts as the racing line. Laps with the autopilot never count for boards or global times.' });
  const status = h('div', 'row-l', h('b', '', 'Learned so far'), h('span', '', ''));
  const line = status.querySelector('span');
  const train = btn('Train now', 'btn', () => (learn.training ? learn.pause() : learn.train()));
  const reset = btn('Reset learning', 'btn danger', () => learn.reset());
  const paint = () => {
    const st = learn.status();
    line.textContent = statusText(st) + (learn.training && !st.ready ? ' (preparing)' : '');
    train.textContent = learn.training ? 'Pause training' : 'Train now';
    reset.disabled = !learn.hasGenome() && st.gen === 0;
  };
  learn.refresh();
  const off = learn.onChange(() => { if (!status.isConnected) off(); else paint(); });
  paint();
  const actions = h('div', 'row', status, h('div', 'row-c', train, reset));
  return { el: group('Experimental autopilot', style, actions), dispose: off };     // dispose: the tab is left, so the listener goes
}
