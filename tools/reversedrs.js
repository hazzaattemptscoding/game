// Reverse DRS test. Run with `npm run reversedrs` (also part of `npm run check`). No browser needed.
// A DRS zone is a stretch of road, not a direction, so a car driven the other way round has DRS wherever it is in one.
// The zone opens on the button anywhere inside it, so from the reverse end it opens at the end the car reaches first.
//   1. forward: flat out through the main straight's zone with the button held, DRS opens at the zone's start and shuts at its end
//   2. reverse: the same stretch driven the other way round, DRS opens at the zone's end and shuts at its start
//   3. mirror: the distance with DRS open is the same both ways
//   4. no button, no DRS; braking shuts it, and it never opens outside the zone
//   5. the map numbers the corners in the order the reverse lap meets them

import { buildTrack } from '../src/track.js';
import { Car, STEP } from '../src/physics.js';
import { GT } from '../src/cars.js';
import { CORNERS } from '../src/corners.js';
import { cornerMarks } from '../src/miniMap.js';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const T = buildTrack(), L = T.length;
const [za, zb] = T.drs[0];                       // the main straight: it wraps over the line, so zb is below za
const zoneLen = zb > za ? zb - za : zb + L - za;
const wrap = d => ((d % L) + L) % L;

// Drive the car from `lead` metres before the zone end it reaches first, at 30 m/s, flat out.
// Returns where DRS opened and shut (metres into the zone, in the driving direction) and how far it was open.
function drive({ reverse, button, brakeAt = null, lead = 150 }) {
  const car = new Car(GT, T);
  const enter = reverse ? zb : za;
  car.placeAt(reverse ? (enter + lead) % L : wrap(enter - lead), 0, reverse);
  car.vx = 30 * Math.cos(car.heading); car.vz = 30 * Math.sin(car.heading); car.speed = 30; car.fwdSpeed = 30;
  const along = s => (reverse ? wrap(zb - s) : wrap(s - za));   // metres into the zone the car is at, in its own direction
  let prevS = car.loc.s, dist = 0, wasOpen = false;
  const opens = [], shuts = [];
  let openDist = 0, braked = false;
  const limit = lead + zoneLen + 150;
  for (let k = 0; dist < limit && k < 200000; k++) {
    const brake = brakeAt != null && dist >= brakeAt ? 1 : 0;
    if (brake) braked = true;
    car.step({ steer: 0, throttle: brake ? 0 : 1, brake, drs: button });
    const s = car.loc.s, moved = Math.abs(((s - prevS) + L / 2 + L) % L - L / 2);
    dist += moved; prevS = s;
    if (car.drs) openDist += moved;
    if (car.drs && !wasOpen) opens.push(along(s));
    if (!car.drs && wasOpen) shuts.push(along(s));
    wasOpen = car.drs;
  }
  return { opens, shuts, openDist, braked };
}

console.log('ZONE');
console.log(`  main straight zone: ${za.toFixed(0)} m to ${zb.toFixed(0)} m, ${zoneLen.toFixed(0)} m long (wraps the line)`);
check(T.inDRS(za + 1) && T.inDRS(wrap(zb - 1)) && !T.inDRS(wrap(zb + 40)), 'the zone covers its own stretch and nothing just past it');

console.log('OPENING AND SHUTTING');
const fwd = drive({ reverse: false, button: true });
const rev = drive({ reverse: true, button: true });
const show = (name, r) => console.log(`  ${name.padEnd(8)} opens at ${r.opens.map(x => x.toFixed(1) + ' m').join(', ') || 'never'}, shuts at ${r.shuts.map(x => x.toFixed(1) + ' m').join(', ') || 'never'}, open for ${r.openDist.toFixed(1)} m`);
show('forward', fwd);
show('reverse', rev);
check(fwd.opens.length === 1 && fwd.opens[0] < 3, `forward: DRS opens once, at the start of the zone (got ${fwd.opens.map(x => x.toFixed(1))})`);
check(fwd.shuts.length === 1 && Math.abs(fwd.shuts[0] - zoneLen) < 3, `forward: DRS shuts at the end of the zone (got ${fwd.shuts.map(x => x.toFixed(1))})`);
check(rev.opens.length === 1 && rev.opens[0] < 3, `reverse: DRS opens once, at the zone end the car reaches first (got ${rev.opens.map(x => x.toFixed(1))})`);
check(rev.shuts.length === 1 && Math.abs(rev.shuts[0] - zoneLen) < 3, `reverse: DRS shuts at the far end of the zone (got ${rev.shuts.map(x => x.toFixed(1))})`);

console.log('MIRROR');
check(Math.abs(fwd.openDist - zoneLen) < 3 && Math.abs(rev.openDist - zoneLen) < 3, `DRS is open for the whole zone both ways (${fwd.openDist.toFixed(1)} m and ${rev.openDist.toFixed(1)} m, zone ${zoneLen.toFixed(1)} m)`);
check(Math.abs(fwd.openDist - rev.openDist) < 2, 'the same stretch is open the same distance driven either way');

console.log('NO BUTTON, BRAKING');
const idle = drive({ reverse: true, button: false });
const brakeRun = drive({ reverse: true, button: true, brakeAt: 150 + zoneLen * 0.4 });
console.log(`  reverse, button up: opened ${idle.opens.length} times    reverse, braking in the zone: open for ${brakeRun.openDist.toFixed(1)} m`);
check(idle.opens.length === 0 && idle.openDist === 0, 'reverse with the button up: DRS stays shut');
check(brakeRun.braked && brakeRun.openDist < zoneLen * 0.5 && brakeRun.openDist > 1, 'reverse: braking in the zone shuts DRS, and it opens before the brake');

console.log('MAP NUMBERS');
const fm = cornerMarks(T), bm = cornerMarks(T, CORNERS, true);
console.log(`  forward: ${fm.slice(0, 6).map(m => m.n + ' ' + m.name).join(', ')} ...`);
console.log(`  reverse: ${bm.slice(0, 6).map(m => m.n + ' ' + m.name).join(', ')} ...`);
check(fm.length === bm.length && fm.length > 1, 'the same corners in both directions');
check(bm.map(m => m.name).join('|') === fm.map(m => m.name).reverse().join('|'), 'reverse numbers run in the reverse of the forward order');
check(bm.every((m, k) => m.n === k + 1) && fm.every((m, k) => m.n === k + 1), 'numbers run 1, 2, 3 in each direction');

console.log(fails.length ? `FAILED\n  ${fails.join('\n  ')}` : '\nreversedrs: all checks passed');
if (fails.length) process.exitCode = 1;
