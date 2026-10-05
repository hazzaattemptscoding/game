// Screenshots the game from a track position, for checking the look by eye.
// node tools/shot.mjs out.png "viewat=s,d,height,ahead" [topdown] [blockout]
// The menu is skipped (menu=0) unless the view string names a menu: "menu=race", "menu=garage", "menu=settings", "menu=online", "menu=main" (main menu is the default with no viewat) or "start=race" for the lights.
// Add &line=1 to the view string to switch the racing line on, and &at=S to put the car at s=S (the line is drawn around the car): "viewat=330,0,1.8,40&line=1&at=300"
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const [out, viewArg = 'viewat=100,0,2,40', ...flags] = process.argv.slice(2);
const view = /(^|&)(menu|start)=/.test(viewArg) ? viewArg : `${viewArg}&menu=0`;
const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto(`http://localhost:5199/?${view}${flags.includes('topdown') ? '&topdown' : ''}`);
await page.waitForTimeout(+(process.env.SHOT_WAIT || 6000));
await page.screenshot({ path: out });
await browser.close(); server.kill();
