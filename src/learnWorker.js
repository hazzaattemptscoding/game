// The learning autopilot's worker (src/learn.js): builds the track and the car's context, then runs generations of the evolution
// strategy while it is told to, and posts the best genome after every generation. The game talks to it through src/learnClient.js.
//   in:  { type: 'init', car, saved, epoch }   saved: the stored genome record or null; epoch: the game's session number
//        { type: 'run', duty }          train (duty: the share of the time the worker computes, the rest it sleeps)
//        { type: 'pause' }  { type: 'reset', epoch }
//   out: { type: 'ready', base }  { type: 'gen', gen, best, evals, rate, record }  { type: 'reset' }  { type: 'error', message }
// Every message out carries `epoch`, the session the work belongs to. A reset starts a new one (the game sends its number): the
// generation that is still running finishes under the old number, so the game can tell its record is from before the reset and drop it.

import { buildTrack } from './track.js';
import { carById } from './cars.js';
import { makeContext, Learner, evaluate, fullLap, genomeToJSON, genomeFromJSON } from './learn.js';

let ctx = null, learner = null, running = false, duty = 0.6, loop = null, clean = null, seed = 1, epoch = 0, resetting = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (m, ep = epoch) => self.postMessage({ ...m, epoch: ep });

// one evaluation at a time, with a breath between them so a pause or a reset is heard within a fraction of a second
const evaluator = async (xs, ref) => {
  const out = [];
  for (const x of xs) { out.push(evaluate(ctx, x, ref ? { ref } : {})); await sleep(0); }
  return out;
};

function start(saved) {
  const rec = saved ? genomeFromJSON(ctx, saved) : null;
  clean = rec ? { x: rec.x, time: rec.fit, gen: rec.gen || 0, evals: rec.evals || 0 } : null;
  learner = new Learner(ctx, { seed: seed++, mu: 3, lambda: 10, state: rec ? { x: rec.x, fit: rec.fit, gen: rec.gen, evals: rec.evals } : undefined });
}

async function run() {
  if (loop) return;
  loop = (async () => {
    const t0 = performance.now(), e0 = learner.evals;
    while (running) {
      const a = performance.now();
      const ep = epoch;      // this generation belongs to the session it started in, even if a reset arrives while it runs
      const g = await learner.generation(evaluator);
      if (ep !== epoch || resetting) break;      // a reset came in: the work is of the old session, drop it
      const x = learner.best.x;
      let record = null;
      // a new best is only handed to the game after it has driven a clean lap in the full check (standing start, two laps)
      if (learner.best.fit < (clean ? clean.time : ctx.baseTime) - 1e-6) {
        const f = fullLap(ctx, x);
        if (f.valid && f.time != null) { clean = { x, time: f.time }; record = genomeToJSON(ctx, x, { gen: g.gen, evals: g.evals, fit: f.time, line: ctx.baseTime }); }
      }
      post({ type: 'gen', gen: g.gen, best: clean ? clean.time : ctx.baseTime, evals: g.evals, rate: (learner.evals - e0) / ((performance.now() - t0) / 1000), record }, ep);
      const spent = performance.now() - a;
      await sleep(Math.max(0, spent * (1 - duty) / duty));
    }
    loop = null;
  })().catch(e => { loop = null; running = false; post({ type: 'error', message: String(e && e.message || e) }); });
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      epoch = m.epoch | 0;
      ctx = makeContext(buildTrack(), carById(m.car));
      start(m.saved);
      post({ type: 'ready', base: ctx.baseTime });
    } else if (!ctx) return;
    else if (m.type === 'run') { if (resetting) return; duty = Math.max(0.1, Math.min(1, m.duty || 0.6)); running = true; run(); }
    else if (m.type === 'pause') running = false;
    else if (m.type === 'reset') {
      // a reset wins over everything: no run is taken while it waits for the generation in flight, and that generation's result is dropped
      resetting = true; running = false; epoch = m.epoch | 0;
      while (loop) await sleep(20);
      running = false;
      start(null);
      resetting = false;
      post({ type: 'reset' });
    }
  } catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
};
