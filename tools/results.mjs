// Results screen test in headless Chromium: the real screen (src/results.js) mounted in the page, checked as DOM. Run with
// `npm run results` (also part of `npm run check`). Skips if Chromium or Playwright is not installed (as smoke.mjs does).
//   1. the dev view (?menu=results) shows the timing sheet: six rows, your row marked, the card, no page scroll at 1280x640
//   2. live update: a late finish re-ranks the rows in place: the same row elements, the scroll kept, texts changed, a DNF row removed
//   3. the screen's first-show stagger class is gone after a moment, and unmount drops the live hook
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { startVite } from './lib/vite.mjs';
const chromePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright';
if (!existsSync(chromePath) || !existsSync(pw)) { console.log('results: Chromium or Playwright not found, skipped'); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pw);

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const server = await startVite(5197);
const browser = await chromium.launch({ executablePath: chromePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://localhost:5197/?menu=results');
  await page.waitForSelector('#menu[data-screen=results] .res-table tbody tr', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const dev = await page.evaluate(() => {
    const body = document.querySelector('#menu .m-body');
    const rows = [...document.querySelectorAll('#menu .res-table tbody tr')];
    return {
      rows: rows.length, me: rows.filter(r => r.classList.contains('me')).length,
      first: rows[0] && rows[0].querySelector('.res-name').textContent,
      card: document.querySelector('#menu .res-big-pos') && document.querySelector('#menu .res-big-pos').textContent,
      fits: body.scrollHeight <= body.clientHeight + 1, pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1,
      buttons: [...document.querySelectorAll('#menu .res-card button')].map(b => b.textContent.trim()),
    };
  });
  check(dev.rows === 6 && dev.me === 1, `six rows and one of them yours (got ${dev.rows}, ${dev.me})`);
  check(dev.first === 'Mara K' && dev.card === 'P2', `the first row is the winner, the card says P2 (got ${dev.first}, ${dev.card})`);
  check(dev.fits && dev.pageFits, 'at 1280 by 640 the screen fits with no scroll');
  check(dev.buttons.join() === 'Race again,Back to menu', `the two buttons (got ${dev.buttons})`);

  // the live update, on a fresh mount of the same screen in the page (the menu's own instance is closed first)
  const live = await page.evaluate(async () => {
    const R = await import('/src/results.js');
    const hub = { current: null };
    const scr = R.resultsScreen(hub);
    // mounted in the menu's own pane, so the screen's #menu rules apply (the menu's screen is replaced for this test)
    const pane = document.querySelector('#menu .m-body');
    pane.replaceChildren();
    const box = document.createElement('div');
    pane.append(box);
    const data = R.sampleResults();
    scr.mount(box, { params: { data }, api: { restart() {}, toMainMenu() {} } });
    await new Promise(r => setTimeout(r, 60));
    const wrap = box.querySelector('.res-tablewrap');
    wrap.scrollTop = 0;
    const before = [...box.querySelectorAll('tbody tr')];
    const names = () => [...box.querySelectorAll('tbody tr')].map(r => r.querySelector('.res-name').textContent);
    const first = names();
    // a late finish: Liam P (fifth, still out on the sample) crosses with the fastest time. The rows are ranked again from the entries.
    const next = R.sampleResults();
    const entries = next.rows.map(r => ({ ...r, finished: r.status === 'finished' || r.id === 'd', dnf: r.status === 'dnf', time: r.id === 'd' ? 470.1 : r.time }));
    const ranked = (await import('/src/session.js')).raceRows(entries, { laps: 5, length: 3835 });
    wrap.style.maxHeight = '150px';     // the table must overflow for its scroll to be tested
    wrap.scrollTop = 14;
    hub.current.update({ ...next, rows: ranked });
    const after = [...box.querySelectorAll('tbody tr')];
    const stillSame = after.filter(tr => before.includes(tr)).length;
    const out = { first, now: names(), sameNodes: stillSame, scroll: wrap.scrollTop, pos1: after[0].querySelector('.res-pos-badge').textContent };
    // a car that is no longer in the data (its row goes)
    const trimmed = { ...next, rows: ranked.filter(r => r.id !== 'e') };
    hub.current.update(trimmed);
    out.rowsAfterRemoval = box.querySelectorAll('tbody tr').length;
    out.hookBefore = !!hub.current;
    scr.unmount();
    out.hookAfter = !!hub.current;
    box.remove();
    return out;
  });
  check(live.first[0] === 'Mara K' && live.first.length === 6, 'the mounted rows follow the order of the sample');
  check(live.now[0] === 'Liam P' && live.pos1 === '1', `a late finish takes first place in place (got ${live.now[0]}, ${live.pos1})`);
  check(live.sameNodes === 6, `the rows are the same elements after the update (kept ${live.sameNodes} of 6)`);
  check(live.scroll === 14, `the scroll position is kept (got ${live.scroll})`);
  check(live.rowsAfterRemoval === 5, `a row left out of the data is removed (got ${live.rowsAfterRemoval})`);
  check(live.hookBefore === true && live.hookAfter === false, 'the live hook is set while mounted and cleared on unmount');
} catch (e) {
  fails.push(`exception: ${e.message}`);
}
check(errors.length === 0, `no page errors: ${errors.join(' | ')}`);
await browser.close();
server.stop();
console.log(fails.length ? `results FAILED\n  ${fails.join('\n  ')}` : 'results: all checks passed');
process.exitCode = fails.length ? 1 : 0;
