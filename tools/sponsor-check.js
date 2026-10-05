// Check that every sponsor brand id in manifest.json has a corresponding file under 300 KB.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const sponsorDir = './public/sponsors';
const manifest = JSON.parse(readFileSync(join(sponsorDir, 'manifest.json'), 'utf8'));
const MAX_SIZE = 300 * 1024; // 300 KB

let passed = true;
for (const id of manifest) {
  const path = join(sponsorDir, `${id}.png`);
  if (!existsSync(path)) {
    console.log(`FAIL: sponsor '${id}' not found at ${path}`);
    passed = false;
    continue;
  }
  const size = statSync(path).size;
  if (size > MAX_SIZE) {
    console.log(`FAIL: sponsor '${id}' is ${(size / 1024).toFixed(1)} KB, exceeds 300 KB limit`);
    passed = false;
  } else {
    console.log(`pass: sponsor '${id}' (${(size / 1024).toFixed(1)} KB)`);
  }
}

if (!passed) {
  console.log('\nFAIL: sponsor check');
  process.exitCode = 1;
} else {
  console.log('\npass: sponsor check');
}
