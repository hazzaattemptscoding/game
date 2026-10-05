// Builds the game and packs it into ONE html file (no skeleton tags), for publishing as a live artifact.
// node tools/artifact.mjs out.html
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || 'lakeside-artifact.html';
execSync('npx vite build', { stdio: 'ignore', env: { ...process.env, ARTIFACT: '1' } });
const files = readdirSync('dist/assets');
const css = readFileSync('dist/assets/' + files.find(f => f.endsWith('.css')), 'utf8');
let js = readFileSync('dist/assets/' + files.find(f => f.endsWith('.js')), 'utf8').replace(/<\/script/gi, '<\\/script');
// the artifact is one page with no files beside it, so the bridge banner video goes in as a data: URL
const video = 'sponsors/powermedia-bridge-30x1-loop-1.mp4';
if (existsSync('public/' + video)) js = js.split(video).join('data:video/mp4;base64,' + readFileSync('public/' + video).toString('base64'));
const body = readFileSync('index.html', 'utf8').match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[^>]*src=[^>]*><\/script>/, '');
const commit = execSync('git rev-parse --short HEAD').toString().trim();
writeFileSync(out, `<title>Lakeside</title>
<style>${css}
html,body{height:100%;background:#0d1117;color:#e8edf2;overflow:hidden}</style>
${body}
<script type="module">${js}</script>
<!-- build ${commit} -->
`);
console.log('wrote', out, (readFileSync(out).length / 1e6).toFixed(2), 'MB, build', commit);
