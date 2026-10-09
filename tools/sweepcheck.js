// The track fixes from the owner's reports (triage groups B, A, D and C), held as asserts: runs tools/sweep.mjs on this checkout
// and fails if any hit remains in the stretches that were fixed. The other sweep checks (gap, far) are design requests and are not here.
//   node tools/sweepcheck.js
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'sweepcheck-'));
const out = join(dir, 'hits.json');
spawnSync(process.execPath, [join(here, 'sweep.mjs'), '--json', out], { encoding: 'utf8' });   // exit 1 when hits remain: read the list instead
const hits = JSON.parse(readFileSync(out, 'utf8'));
rmSync(dir, { recursive: true, force: true });

// [label, checks, from s, to s] (the stretch each report was about, with a margin)
const FIXED = [
  ['B Sandbag exit apron and wall', ['runoff', 'wall', 'seam'], 1340, 1400],
  ['A wall joins at 1242', ['seam'], 1230, 1255],
  ['A wall joins at 1349', ['seam'], 1340, 1360],
  ['A wall joins at 1520', ['seam'], 1510, 1530],
  ['A wall joins at 1703 (bridge end)', ['seam'], 1695, 1712],
  ['A wall joins at 1920 (bridge end)', ['seam'], 1912, 1928],
  ['A wall joins at 1025', ['seam'], 1015, 1035],
  ['A pit mouth join at 317', ['seam'], 305, 325],
  ['D Final Approach apron end', ['runoff'], 3600, 3690],
  ['C pit entry wall, mouth and exit', ['seam', 'runoff', 'wall'], 3420, 3550],
];

let bad = 0;
for (const [label, checks, from, to] of FIXED) {
  const inside = hits.filter(h => checks.includes(h.check) && h.s >= from && h.s <= to);
  if (inside.length) { bad++; console.log(`  FAIL ${label}: ${inside.length} hit(s), e.g. s=${inside[0].s} ${inside[0].msg}`); }
  else console.log(`  ok   ${label}`);
}
if (bad) process.exitCode = 1;
console.log(bad ? `SWEEPCHECK FAILED: ${bad} stretch(es) with hits` : 'SWEEPCHECK OK: no hits in the fixed stretches');
