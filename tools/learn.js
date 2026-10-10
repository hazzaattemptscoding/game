// The learning autopilot, headless (src/learn.js). Usage:
//   node tools/learn.js [--car GT|GT1|CITY] [--budget 60] [--threads 3] [--out best-GT.json] [--seed 1] [--from file.json]
//   node tools/learn.js --test        fast checks (used by tools/check.js): elitism, JSON round trip, genome 0 = the plain autopilot,
//                                     an illegal genome is penalised, assist genes reach the car and the player's settings come back
// It runs the evolution strategy for a wall clock budget (seconds), prints one line per generation, then the lap of the best genome in
// the full two-lap check against the plain autopilot, and the assist choices it ended up with. --threads evaluates a generation's
// children in parallel worker threads (the game uses one Web Worker).

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTrack } from '../src/track.js';
import { CARS } from '../src/cars.js';
import { STEP, Car } from '../src/physics.js';
import { Autopilot } from '../src/autopilot.js';
import * as L from '../src/learn.js';

if (!isMainThread) {
  const ctx = L.makeContext(buildTrack(), CARS[workerData.car]);
  parentPort.on('message', ({ id, x, ref }) => parentPort.postMessage({ id, res: L.evaluate(ctx, x, ref ? { ref } : {}) }));
  parentPort.postMessage({ ready: true });
} else await main();

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] ?? true); }

async function main() {
  if (process.argv.includes('--test')) return test();
  const carId = arg('car', 'GT'), budget = +arg('budget', 60), threads = Math.max(1, +arg('threads', 1)), seed = +arg('seed', 1);
  const out = arg('out', `learned-${carId}.json`);
  const T = buildTrack();
  const ctx = L.makeContext(T, CARS[carId]);
  console.log(`${carId}: line autopilot ${L.fmtLap(ctx.baseTime)}, ${ctx.corners.length} corners, ${ctx.layout.dim} genes, budget ${budget} s, ${threads} thread(s)`);
  let evaluator = L.localEvaluator(ctx), pool = [];
  if (threads > 1) {
    pool = await Promise.all(Array.from({ length: threads }, () => new Promise(res => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { car: carId } }); w.once('message', () => res(w)); })));
    let next = 0;
    evaluator = (xs, ref) => Promise.all(xs.map(x => new Promise(res => {
      const w = pool[next++ % pool.length], id = Math.random();
      const on = m => { if (m.id === id) { w.off('message', on); res(m.res); } };
      w.on('message', on);
      w.postMessage({ id, x, ref });
    })));
  }
  const prev = arg('from', null);
  const state = prev ? L.genomeFromJSON(ctx, readFileSync(prev, 'utf8')) : null;
  const learner = new L.Learner(ctx, { seed, mu: 3, lambda: Math.max(10, threads * 3), state });
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < budget) {
    const g = await learner.generation(evaluator);
    const el = (Date.now() - t0) / 1000;
    console.log(`gen ${String(g.gen).padStart(3)}  best ${L.fmtLap(g.best)}  (${(g.best - ctx.baseTime).toFixed(3)} s)  evals ${g.evals}  ${(g.evals / el).toFixed(1)}/s  sigma ${learner.sigma.toFixed(2)}  wins ${g.wins}`);
  }
  const x = learner.best.x;
  const full = L.fullLap(ctx, x);
  console.log(`\nbest genome, full two-lap check: lap 2 ${L.fmtLap(full.time)} ${full.valid ? 'clean' : 'INVALID (' + full.reason + ')'}; line autopilot ${L.fmtLap(ctx.baseTime)}; gain ${(ctx.baseTime - full.time).toFixed(3)} s`);
  writeFileSync(out, L.genomeToJSON(ctx, x, { gen: learner.gen, evals: learner.evals, fit: learner.best.fit, line: ctx.baseTime }));
  console.log('written ' + out);
  assistReport(ctx, x);
  for (const w of pool) w.terminate();
}

// where each assist is switched off, and what that is worth against all on (the same genome with the assist genes put back to keep)
function assistReport(ctx, x) {
  const base = L.fullLap(ctx, x);
  const names = ['TC', 'ABS', 'ESC'];
  console.log('\nassist choices per segment (' + L.NSEG + ' segments of ' + Math.round(ctx.T.length / L.NSEG) + ' m; . keep, - off, + on)');
  for (let a = 0; a < 3; a++) {
    let row = '';
    for (let s = 0; s < L.NSEG; s++) { const g = x[ctx.layout.assist + s * 3 + a]; row += g <= -0.5 ? '-' : g >= 0.5 ? '+' : '.'; }
    const y = Float64Array.from(x);
    for (let s = 0; s < L.NSEG; s++) y[ctx.layout.assist + s * 3 + a] = 0;
    const r = L.evaluate(ctx, y);
    console.log(`  ${names[a].padEnd(3)} ${row}   without these choices: ${r.time == null ? 'invalid (' + r.reason + ')' : L.fmtLap(r.time) + ' (' + (r.time - L.evaluate(ctx, x).time >= 0 ? '+' : '') + (r.time - L.evaluate(ctx, x).time).toFixed(3) + ' s)'}`);
  }
  const y = Float64Array.from(x);
  for (let k = 0; k < L.NSEG * 3; k++) y[ctx.layout.assist + k] = 0;
  const r = L.evaluate(ctx, y);
  console.log(`  all assist choices removed (assists all on): ${r.time == null ? 'invalid (' + r.reason + ')' : L.fmtLap(r.time)} against ${L.fmtLap(L.evaluate(ctx, x).time)} with them`);
  void base;
}

async function test() {
  let bad = 0;
  const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) bad++; };
  const T = buildTrack();
  const ctx = L.makeContext(T, CARS.GT);
  console.log('LEARNING AUTOPILOT');
  const zero = L.zeros(ctx.layout.dim);
  // genome 0 is the plain autopilot, exactly
  const f0 = L.fullLap(ctx, zero);
  check(f0.valid && Math.abs(f0.time - 90.117) < 0.001, `genome 0 reproduces the line autopilot lap (${L.fmtLap(f0.time)}, 1:30.117)`);
  check(Math.abs(ctx.baseTime - f0.time) < 1e-6, `the flying-start evaluation gives the same lap (${L.fmtLap(ctx.baseTime)})`);
  check(L.makeDriver(ctx, zero).assistPlan === null, 'genome 0 sets no assist plan (the player keeps their assists)');
  // an illegal genome is penalised: all corners taken far too fast with the brakes much too late
  const wild = Float64Array.from(zero);
  for (let c = 0; c < ctx.layout.nCorners; c++) { wild[ctx.layout.speed + c] = 1; wild[ctx.layout.brake + c] = -1; }
  const w = L.evaluate(ctx, wild);
  check(!w.valid && w.fitness >= 1000, `an illegal genome gets the penalty (${w.reason}, fitness ${w.fitness.toFixed(0)})`);
  // JSON round trip
  const lr = new L.Learner(ctx, { seed: 3, mu: 2, lambda: 4 });
  const hist = [];
  for (let g = 0; g < 3; g++) { const r = await lr.generation(L.localEvaluator(ctx)); hist.push(r.best); }
  check(hist.every((v, i) => i === 0 || v <= hist[i - 1] + 1e-9) && hist[0] <= ctx.baseTime + 1e-9, `fitness never rises over generations (${hist.map(L.fmtLap).join(', ')})`);
  const text = L.genomeToJSON(ctx, lr.best.x, { gen: lr.gen });
  const back = L.genomeFromJSON(ctx, text);
  check(back && back.x.length === lr.best.x.length && back.x.every((v, i) => Math.abs(v - lr.best.x[i]) < 1e-6), 'a genome round-trips through JSON');
  check(L.genomeFromJSON(ctx, text.replace('"GT"', '"GT1"')) === null && L.genomeFromJSON(ctx, '{"v":1}') === null && L.genomeFromJSON(ctx, 'nope') === null, 'a genome for another car, or garbage, is refused');
  const again = L.evaluate(ctx, back.x).fitness, was = L.evaluate(ctx, lr.best.x).fitness;
  check(Math.abs(again - was) < 0.01, 'the reloaded genome drives the same lap');
  // assist genes
  const g = Float64Array.from(zero);
  const A = ctx.layout.assist;
  g[A + 5 * 3 + 0] = -1;    // TC off in segment 5
  g[A + 6 * 3 + 1] = -1;    // ABS off in segment 6
  g[A + 7 * 3 + 2] = -1;    // ESC off in segment 7
  g[A + 8 * 3 + 0] = 1;     // TC forced on in segment 8
  const back2 = L.genomeFromJSON(ctx, L.genomeToJSON(ctx, g));
  check(back2 && back2.x[A + 15] === -1 && back2.x[A + 19] === -1 && back2.x[A + 23] === -1 && back2.x[A + 24] === 1, 'assist genes round-trip');
  const player = { tc: true, abs: false, esc: true };      // a player with ABS off
  const car = new Car(CARS.GT, T);
  car.setAssists(player);
  const drv = L.makeDriver(ctx, g, player);
  const seen = {};
  for (const seg of [4, 5, 6, 7, 8, 9]) {
    car.placeAt((seg + 0.5) * T.length / L.NSEG, 0);
    drv.drive(car);
    seen[seg] = car.assists;
  }
  check(seen[4].tc && !seen[4].abs && seen[4].esc, 'a segment with no choice keeps the player\'s assists (ABS stays off)');
  check(!seen[5].tc && seen[5].esc, 'TC off in its segment reaches the car');
  check(!seen[6].abs && seen[6].tc, 'ABS off in its segment reaches the car');
  check(!seen[7].esc && seen[7].tc, 'ESC off in its segment reaches the car');
  check(seen[8].tc && seen[8].abs === false, 'forced on and keep work independently');
  check(seen[9].tc && !seen[9].abs && seen[9].esc, 'the plan ends with its segment');
  check(player.tc && !player.abs && player.esc, 'the player\'s own settings object is never written');
  car.setAssists(player);
  check(JSON.stringify(car.assists) === JSON.stringify(player), 'switching the autopilot off puts the player\'s assists back (Car.setAssists with the saved settings)');
  const plain = new Autopilot(T, CARS.GT, { skill: 0.9 });
  car.setAssists({ tc: false, abs: false, esc: false });
  plain.drive(car);
  check(!car.assistTc && !car.assistAbs && !car.assistEsc, 'the plain autopilot leaves the assists alone');
  const withAssists = L.evaluate(ctx, g);
  check(withAssists.valid || withAssists.reason, 'a genome with assist choices can be evaluated');
  console.log(bad ? `${bad} FAILED` : 'all passed');
  if (bad) process.exitCode = 1;
}

void STEP;
