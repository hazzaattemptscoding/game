// Prints a one-screen summary of every play report in reports/ (no screenshots, no timelines).
// Usage: npm run reports
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
if (!fs.existsSync(dir)) { console.log('No reports/ folder.'); process.exit(0); }

for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const t = r.telemetry || [];
  const ds = t.map(p => p.d).filter(Number.isFinite);
  const ss = t.map(p => p.s).filter(Number.isFinite);
  console.log(`${r.id}  build ${r.build}  ${r.device}  debug=${r.quality?.settings?.debug}`);
  console.log(`  note: ${r.note}`);
  console.log(`  car at s=${r.car?.s?.toFixed(0)} (x ${r.car?.x?.toFixed(0)}, z ${r.car?.z?.toFixed(0)}, y ${r.car?.y?.toFixed(1)})`);
  if (ss.length) console.log(`  telemetry: ${t.length} samples, s ${Math.min(...ss).toFixed(0)}..${Math.max(...ss).toFixed(0)}, d ${Math.min(...ds).toFixed(1)}..${Math.max(...ds).toFixed(1)}`);
}
