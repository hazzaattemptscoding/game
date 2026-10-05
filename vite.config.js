// Static build for Cloudflare Pages: `npm run build` outputs dist/.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}

function localReportWriter() {
  return {
    name: 'lakeside-local-reports',
    configureServer(server) {
      server.middlewares.use('/__lakeside-report', (req, res, next) => {
        if (req.method !== 'POST') return next();
        const chunks = [];
        let bytes = 0;
        req.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 80 * 1024 * 1024) { res.statusCode = 413; res.end('Report too large'); req.destroy(); }
          else chunks.push(chunk);
        });
        req.on('end', () => {
          try {
            const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const folder = path.join(root, 'reports');
            mkdirSync(folder, { recursive: true });
            const stamp = String(report.createdAt || new Date().toISOString()).replace(/[:.]/g, '-');
            const name = `lakeside-report-${stamp}.json`;
            writeFileSync(path.join(folder, name), JSON.stringify(report, null, 2));
            res.statusCode = 201;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ file: name }));
          } catch (error) {
            res.statusCode = 400;
            res.end(error.message);
          }
        });
      });
    },
  };
}

export default {
  base: './',
  define: { __BUILD_COMMIT__: JSON.stringify(commit) },
  plugins: [localReportWriter()],
  // ARTIFACT=1 packs everything, PeerJS included, into one file (the claude.ai artifact is a single html page and has no live page).
  // It also inlines every imported asset (the gantry screen's logos and fonts) as data: URLs, since nothing sits beside the page.
  build: { chunkSizeWarningLimit: 900, ...(process.env.ARTIFACT ? { assetsInlineLimit: () => true } : {}), rollupOptions: process.env.ARTIFACT ? { output: { inlineDynamicImports: true } } : { input: { main: path.join(root, 'index.html'), live: path.join(root, 'live.html') } } },
};
