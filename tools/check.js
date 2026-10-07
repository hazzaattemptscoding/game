// Regression guard: runs laptest, audit, bumps, surfaces, venue, smoke, limits, audio, assists, cursor, board, multiplayer, relay, times, globaltimes, relay-client, session, racingline, hudsettings, minisectors, camera, screencontrol, sponsor-check and perf and fails if any of them fails.
// Run with `npm run check` before every commit. Add --quiet to see only the one-line results.
import { spawnSync } from 'node:child_process';

const quiet = process.argv.includes('--quiet');
const steps = [['laptest', 'tools/laptest.js'], ['audit', 'tools/audit.js'], ['bumps', 'tools/bumps.js'], ['surfaces', 'tools/surfaces.js'], ['venue', 'tools/venue.js'], ['smoke', 'tools/smoke.mjs'], ['limits', 'tools/limits.js'], ['audio', 'tools/audio.js'], ['assists', 'tools/assists.js'], ['cursor', 'tools/cursor.js'], ['board', 'tools/board.js'], ['multiplayer', 'tools/multiplayer.js'], ['relay', 'tools/relay.js'], ['times', 'tools/times.js'], ['globaltimes', 'tools/globaltimes.js'], ['live', 'tools/live.js'], ['relay-client', 'tools/relay-client.js'], ['session', 'tools/session.js'], ['racingline', 'tools/racingline-test.js'], ['hudsettings', 'tools/hudsettings.js'], ['minisectors', 'tools/minisectors.js'], ['camera', 'tools/camera.js'], ['screencontrol', 'tools/screencontrol.js'], ['sponsor-check', 'tools/sponsor-check.js'], ['perf', 'tools/perf.js']];
const results = [];
for (const [name, file] of steps) {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  if (!quiet) { console.log(`\n=== ${name} ===`); process.stdout.write(r.stdout); process.stderr.write(r.stderr); }
  results.push([name, r.status === 0]);
}
console.log('\nCHECK');
for (const [name, ok] of results) console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
