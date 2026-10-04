// Print a compact index of report JSON files written by the Vite dev server.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
let files = [];
try { files = readdirSync(root).filter(name => name.endsWith('.json')).sort(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

console.log(`Lakeside reports: ${files.length}`);
for (const file of files) {
  try {
    const report = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    const car = report.car || {}, point = `x=${Number(car.x || 0).toFixed(1)}, z=${Number(car.z || 0).toFixed(1)}, s=${Number(car.s || 0).toFixed(1)}, d=${Number(car.d || 0).toFixed(1)}`;
    console.log(`\n${file}`);
    console.log(`  ${report.createdAt || 'unknown time'} · ${report.category || 'uncategorized'} · ${point}`);
    console.log(`  note: ${(report.note || '(none)').replace(/\s+/g, ' ')}`);
    for (const feature of report.selections || []) console.log(`  ${feature.type || 'feature'} ${feature.id || ''}${feature.corner ? ` · ${feature.corner}` : ''}`);
  } catch (error) { console.log(`\n${file}\n  unreadable report: ${error.message}`); }
}