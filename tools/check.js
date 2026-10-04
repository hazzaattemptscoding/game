// Regression guard: runs laptest, audit, bumps, surfaces, smoke, limits, audio, assists, cursor, board, multiplayer, relay and relay-client and fails if any of them fails.
// Run with `npm run check` before every commit. Add --quiet to see only the one-line results.
import { spawnSync } from 'node:child_process';

const quiet = process.argv.includes('--quiet');
const steps = [['laptest', 'tools/laptest.js'], ['audit', 'tools/audit.js'], ['bumps', 'tools/bumps.js'], ['surfaces', 'tools/surfaces.js'], ['smoke', 'tools/smoke.mjs'], ['limits', 'tools/limits.js'], ['audio', 'tools/audio.js'], ['assists', 'tools/assists.js'], ['cursor', 'tools/cursor.js'], ['board', 'tools/board.js'], ['multiplayer', 'tools/multiplayer.js'], ['relay', 'tools/relay.js'], ['relay-client', 'tools/relay-client.js']];
const results = [];
for (const [name, file] of steps) {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  if (!quiet) { console.log(`\n=== ${name} ===`); process.stdout.write(r.stdout); process.stderr.write(r.stderr); }
  results.push([name, r.status === 0]);
}
console.log('\nCHECK');
for (const [name, ok] of results) console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
