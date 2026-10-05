// The gantry screen's control panel (src/screenControl.js): commands, access and the room messages, with a fake screen and
// a fake room of three (host, a guest with access, a guest without). Run with `npm run screencontrol`.
import { createScreenControl, cleanCommand } from '../src/screenControl.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const SCENES = ['lakeside', 'powermedia', 'ad1', 'deltadash', 'ad2'];

function fakeScreen() {
  const off = new Set(), log = [];
  return {
    scenes: SCENES, log,
    lights: n => log.push('lights' + n), go: () => log.push('go'), flag: n => log.push('flag:' + n), message: t => log.push('msg:' + t),
    clear: () => log.push('clear'), showScene: n => log.push('scene:' + n), next: () => log.push('next'),
    setAd: (n, on) => { if (on) off.delete(n); else off.add(n); log.push(`ad:${n}:${on}`); }, adOn: n => !off.has(n),
  };
}

// a room: every sendControl reaches the others' handle (or only `to`), with the sender's id, like the relay and PeerJS do
function room(ids, hostId) {
  const members = new Map();
  for (const id of ids) {
    const mp = {
      isHost: id === hostId, selfId: id, hostPeerId: hostId, peers: new Map(),
      sendControl(m, to) { for (const [other, x] of members) if (other !== id && (to === undefined || to === other)) x.inbox.push([JSON.parse(JSON.stringify(m)), id]); return true; },
    };
    for (const o of ids) if (o !== id) mp.peers.set(o, { id: o, name: 'P' + o, hello: true });
    const screen = fakeScreen();
    const sc = createScreenControl({ screen, mp, inRoom: () => true });
    members.set(id, { mp, screen, sc, inbox: [] });
  }
  const flush = () => { for (let k = 0; k < 6; k++) for (const x of members.values()) { for (const x2 of members.values()) x2.sc.tick(); while (x.inbox.length) { const [m, from] = x.inbox.shift(); x.sc.handle(m, from); } } };
  return { members, flush, get: id => members.get(id) };
}

// commands are cleaned
check(cleanCommand({ c: 'lights', n: 9 }, SCENES).n === 5, 'lights clamp to 5');
check(cleanCommand({ c: 'flag', name: 'purple' }, SCENES) === null, 'unknown flag refused');
check(cleanCommand({ c: 'msg', text: '  hi\u0007 there ' + 'x'.repeat(80) }, SCENES).text.length === 40, 'message cut to 40');
check(cleanCommand({ c: 'msg', text: '   ' }, SCENES) === null, 'empty message refused');
check(cleanCommand({ c: 'scene', name: 'nope' }, SCENES) === null, 'unknown advert refused');
check(cleanCommand({ c: 'rm -rf' }, SCENES) === null, 'unknown command refused');

// single player: always yours, applied at once
{
  const screen = fakeScreen(), sc = createScreenControl({ screen, mp: {}, inRoom: () => false });
  check(sc.canControl(), 'single player can control');
  sc.command({ c: 'lights', n: 3 }); sc.command({ c: 'go' }); sc.command({ c: 'msg', text: 'Welcome' });
  check(screen.log.join() === 'lights3,go,msg:Welcome', 'single player applies commands: ' + screen.log.join());
}

// a room: host H, guests A and B
{
  const r = room(['H', 'A', 'B'], 'H'), H = r.get('H'), A = r.get('A'), B = r.get('B');
  r.flush();
  check(H.sc.canControl() && !A.sc.canControl() && !B.sc.canControl(), 'only the host has it at first');
  H.sc.command({ c: 'flag', name: 'yellow' }); r.flush();
  check(A.screen.log.includes('flag:yellow') && B.screen.log.includes('flag:yellow'), 'host command reaches everyone');
  // B without access: refused locally, and a forged scrc is ignored by the host
  check(B.sc.command({ c: 'go' }) === false, 'guest without access cannot command');
  B.mp.sendControl({ t: 'scrc', cmd: { c: 'msg', text: 'SPAM' } }); r.flush();
  check(!H.screen.log.some(l => l === 'msg:SPAM'), 'host ignores a guest without access');
  // B forging a host message is ignored by A
  B.mp.sendControl({ t: 'scr', cmd: { c: 'msg', text: 'FAKE' } }); r.flush();
  check(!A.screen.log.some(l => l === 'msg:FAKE'), 'guests ignore scr not from the host');
  // the host gives A access
  H.sc.setAccess('A', true); r.flush();
  check(A.sc.canControl() && !B.sc.canControl(), 'A has access after the host grants it');
  check(H.sc.players().find(p => p.id === 'A').access === true, 'host list shows A with access');
  A.sc.command({ c: 'msg', text: 'Hello Lakeside' }); r.flush();
  check([H, A, B].every(x => x.screen.log.includes('msg:Hello Lakeside')), 'a granted guest command reaches everyone, the host included');
  A.sc.command({ c: 'ad', name: 'ad1', on: false }); r.flush();
  check([H, A, B].every(x => !x.screen.adOn('ad1')), 'advert switched off everywhere');
  // the host takes it back
  H.sc.setAccess('A', false); r.flush();
  check(!A.sc.canControl(), 'access taken back');
  A.mp.sendControl({ t: 'scrc', cmd: { c: 'go' } }); r.flush();
  check(!H.screen.log.slice(-3).includes('go'), 'host ignores A after taking access back');
  // a newcomer gets what is on screen now
  const C = { inbox: [] };
  {
    const mp = { isHost: false, selfId: 'C', hostPeerId: 'H', peers: new Map([['H', { id: 'H', hello: true }]]), sendControl: () => true };
    C.screen = fakeScreen(); C.sc = createScreenControl({ screen: C.screen, mp, inRoom: () => true });
    H.mp.peers.set('C', { id: 'C', name: 'PC', hello: true });
    const sent = []; const real = H.mp.sendControl; H.mp.sendControl = (m, to) => { sent.push([m, to]); return real.call(H.mp, m, to); };
    H.sc.tick();
    for (const [m, to] of sent) if (to === undefined || to === 'C') C.sc.handle(JSON.parse(JSON.stringify(m)), 'H');
    H.mp.sendControl = real;
  }
  check(!C.screen.adOn('ad1') && C.screen.log.includes('msg:Hello Lakeside'), 'newcomer sees the message and the advert off: ' + C.screen.log.join());
}

console.log('SCREEN CONTROL: commands, access and the room messages');
if (fails.length) { console.log('\nFAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('  all passed');
