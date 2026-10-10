// Regression guard: runs laptest, audit, bumps, surfaces, venue, nearparity, vehicles, smoke, limits, audio, assists, cursor, board, multiplayer, netsim, relay, times, globaltimes, relay-client, startsync, session, ttstart, results, racingline, hudsettings, drsanim, carmodels, tyreclosed, minisectors, reversedrs, camera, screencontrol, sponsor-check and perf and fails if any of them fails.
// Run with `npm run check` before every commit. Add --quiet to see only the one-line results.
import { spawnSync } from 'node:child_process';

const quiet = process.argv.includes('--quiet');
const steps = [['laptest', 'tools/laptest.js'], ['audit', 'tools/audit.js'], ['bumps', 'tools/bumps.js'], ['surfaces', 'tools/surfaces.js'], ['venue', 'tools/venue.js'], ['nearparity', 'tools/nearparity.js'], ['smoke', 'tools/smoke.mjs'], ['limits', 'tools/limits.js'], ['audio', 'tools/audio.js'], ['assists', 'tools/assists.js'], ['cursor', 'tools/cursor.js'], ['touchinput', 'tools/touchinput.js'], ['board', 'tools/board.js'], ['multiplayer', 'tools/multiplayer.js'], ['netsim', 'tools/netsim.js'], ['relay', 'tools/relay.js'], ['times', 'tools/times.js'], ['globaltimes', 'tools/globaltimes.js'], ['live', 'tools/live.js'], ['relay-client', 'tools/relay-client.js'], ['startsync', 'tools/startsync.js'], ['session', 'tools/session.js'], ['ttstart', 'tools/ttstart.js'], ['results', 'tools/results.mjs'], ['racingline', 'tools/racingline-test.js'], ['hudsettings', 'tools/hudsettings.js'], ['drsanim', 'tools/drsanim.js'], ['cars', 'tools/cars.js'], ['carmodels', 'tools/carmodels.js'], ['tyreclosed', 'tools/tyreclosed.js'], ['sweepcheck', 'tools/sweepcheck.js'], ['gantrystate', 'tools/gantrystate.js'], ['vehicles', 'tools/vehicles.js'], ['menuflow', 'tools/menuflow.js'], ['learn', 'tools/learn.js --test'], ['minisectors', 'tools/minisectors.js'], ['reversedrs', 'tools/reversedrs.js'], ['camera', 'tools/camera.js'], ['screencontrol', 'tools/screencontrol.js'], ['sponsor-check', 'tools/sponsor-check.js'], ['slipstream', 'tools/slipstream.js'], ['perf', 'tools/perf.js']];
const results = [];
for (const [name, file] of steps) {
  const r = spawnSync(process.execPath, file.split(' '), { encoding: 'utf8' });
  if (!quiet) { console.log(`\n=== ${name} ===`); process.stdout.write(r.stdout); process.stderr.write(r.stderr); }
  results.push([name, r.status === 0]);
}
console.log('\nCHECK');
for (const [name, ok] of results) console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
