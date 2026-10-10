// Build the game once and serve the built files, for the browser tests (tools/smoke.mjs, tools/menuflow.js). The dev server turns
// every module into a separate request and transforms it on the way, which in a test browser costs most of the page load; the built
// bundle is a handful of files. The build goes to a folder of its own (never dist/), made new for each run, and stop() removes it.
// Same rules as tools/lib/vite.mjs: a port that is taken is an error, and the server dies with the test.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

const taken = port => new Promise(resolve => {
  const s = net.connect(+port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

export async function startDist(port) {
  if (await taken(port)) throw new Error(`port ${port} is already in use (a server left running?). Stop it first: a test on it would load whatever that server serves.`);
  const out = mkdtempSync(path.join(tmpdir(), 'lakeside-dist-'));
  const cleanup = () => { try { rmSync(out, { recursive: true, force: true }); } catch { /* already gone */ } };
  try { execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' }); }
  catch (e) { cleanup(); throw new Error('the build for the browser test failed: ' + e.message); }
  const server = createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(out, rel));
    if (!file.startsWith(out + path.sep) && file !== out) { res.statusCode = 403; res.end('no'); return; }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.end(readFileSync(file));
    } catch { res.statusCode = 404; res.end('not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; try { server.close(); server.closeAllConnections?.(); } catch { /* closed */ } cleanup(); };
  process.on('exit', stop);
  return { stop, dir: out };
}
