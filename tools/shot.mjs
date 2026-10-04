// Screenshots the game from a track position, for checking the look by eye.
// node tools/shot.mjs out.png "viewat=s,d,height,ahead" [topdown] [blockout]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const [out, view = 'viewat=100,0,2,40', ...flags] = process.argv.slice(2);
const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto(`http://localhost:5199/?${view}${flags.includes('topdown') ? '&topdown' : ''}`);
await page.waitForTimeout(6000);
await page.screenshot({ path: out });
await browser.close(); server.kill();
