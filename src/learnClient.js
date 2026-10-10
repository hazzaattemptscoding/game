// The game's side of the learning autopilot (experimental, src/learn.js): owns the training worker, keeps the best genome of each car
// class in localStorage (one key per track build and class), and builds the driver that follows it. Nothing here touches lap times,
// boards or global times: a lap with the autopilot is flagged exactly as before (timer.noteAutopilot in main.js).

import LearnWorker from './learnWorker.js?worker&inline';
import { Autopilot } from './autopilot.js';
import { makeContext, makeDriver, genomeFromJSON, genomeKey } from './learn.js';

const read = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
const write = (key, v) => { try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (e) { /* private mode */ } };

export function createLearning({ track, getCarId, phone = false }) {
  const st = { carId: null, running: false, ready: false, gen: 0, best: null, line: null, rate: 0, error: null };
  const listeners = new Set();
  let worker = null, want = false, canRun = true, hidden = false, lineCache = null, ctxCache = {}, version = 0;
  const emit = () => listeners.forEach(f => f(st));

  function loadStored(carId) {
    const text = read(genomeKey(track, carId));
    let o = null;
    try { o = text ? JSON.parse(text) : null; } catch (e) { /* damaged */ }
    st.carId = carId;
    st.gen = o ? o.gen || 0 : 0; st.best = o ? o.fit : null; st.line = o ? o.line : null;
    return text;
  }

  function killWorker() { if (worker) { worker.terminate(); worker = null; } st.ready = false; st.running = false; }

  function ensureWorker() {
    const carId = getCarId();
    if (worker && st.carId === carId) return;
    killWorker();
    const saved = loadStored(carId);
    st.error = null;
    try { worker = new LearnWorker(); } catch (e) { st.error = 'Training is not available in this browser.'; emit(); return; }
    const w = worker;
    w.onmessage = ({ data: m }) => {
      if (w !== worker) return;
      if (m.type === 'ready') { st.ready = true; st.line = m.base; apply(); }
      else if (m.type === 'gen') {
        st.gen = m.gen; st.best = m.best; st.rate = m.rate;
        if (m.record) { write(genomeKey(track, st.carId), m.record); version++; }
        emit();
      } else if (m.type === 'reset') { st.gen = 0; st.best = null; emit(); }
      else if (m.type === 'error') { st.error = m.message; st.running = false; emit(); }
    };
    w.onerror = e => { st.error = 'Training stopped: ' + (e.message || 'worker error'); st.running = false; emit(); };
    w.postMessage({ type: 'init', car: carId, saved });
  }

  // run or sleep the worker to match what is wanted now
  function apply() {
    const go = want && canRun && !hidden && !st.error;
    if (go) {
      ensureWorker();
      if (worker && st.ready && !st.running) { worker.postMessage({ type: 'run', duty: phone ? 0.4 : 0.7 }); st.running = true; emit(); }
    } else if (worker && st.running) { worker.postMessage({ type: 'pause' }); st.running = false; emit(); }
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { hidden = document.visibilityState === 'hidden'; apply(); });

  const api = {
    status: () => st,
    onChange: f => { listeners.add(f); return () => listeners.delete(f); },
    // bumps whenever a better genome has been stored, so main.js can pick it up at the start line
    get version() { return version; },
    refresh() { loadStored(getCarId()); apply(); emit(); },     // the class changed: the chip and the trainer follow it
    get training() { return want; },
    // the game says whether training may run now (a session is running or the menu is open)
    allow(v) { if (v !== canRun) { canRun = v; apply(); } },
    train() { want = true; st.error = null; apply(); emit(); },
    pause() { want = false; apply(); emit(); },
    reset() {
      write(genomeKey(track, getCarId()), null);
      ctxCache = {}; version++;
      if (worker && st.carId === getCarId()) worker.postMessage({ type: 'reset' });
      loadStored(getCarId());
      emit();
    },
    hasGenome: () => !!read(genomeKey(track, getCarId())),
    // The driver for the best stored genome of this class, or null (then the plain autopilot is used). base: the player's assists.
    makeAutopilot(cfg, base) {
      const text = read(genomeKey(track, cfg.id));
      if (!text) return null;
      try {
        lineCache = lineCache || new Autopilot(track, cfg, { skill: 0.9 }).line;
        const ctx = ctxCache[cfg.id] || (ctxCache[cfg.id] = makeContext(track, cfg, { light: true, baseLine: lineCache }));
        const rec = genomeFromJSON(ctx, text);
        return rec ? makeDriver(ctx, rec.x, base) : null;
      } catch (e) { return null; }
    },
  };
  loadStored(getCarId());
  return api;
}
