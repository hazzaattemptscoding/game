// Fake players for the live page: each bot is a real physics car driven by the autopilot that talks the real relay protocol
// (join, livery, state at 20 Hz as binary frames, telemetry while somebody watches, the host's room details), as the game does except
// the rate: the game sends state at 30 Hz, the bots stay at 20 Hz.
// Used by tools/live.js and tools/live-shot.mjs against worker/dev-relay.mjs. Plain Node (22+, global WebSocket).
import { buildTrack } from '../../src/track.js';
import { Car, STEP } from '../../src/physics.js';
import { GT } from '../../src/cars.js';
import { LapTimer } from '../../src/timing.js';
import { Autopilot, computeRacingLine } from '../../src/autopilot.js';
import { stateFromCar, encodeState, packState } from '../../src/ghosts.js';
import { encodeLivery } from '../../src/livery.js';
import { encodeTelemetry, telemetryFromCar } from '../../src/shared/telemetry.js';

export const BOTS = [
  { name: 'Alice', body: '#e23b3b', stripe: '#f4f4f0', number: 7, skill: 0.9 },
  { name: 'Bram', body: '#2f8fe0', stripe: '#111111', number: 21, skill: 0.89 },
  { name: 'Chiara', body: '#3cc46a', stripe: '#f4f4f0', number: 33, skill: 0.86 },
  { name: 'Dev', body: '#ffd21f', stripe: '#111111', number: 44, skill: 0.82 },
  { name: 'Eli', body: '#b15fe0', stripe: '#f4f4f0', number: 55, skill: 0.8 },
  { name: 'Fumi', body: '#e8863a', stripe: '#111111', number: 66, skill: 0.78 },
  { name: 'Gus', body: '#2fd0c8', stripe: '#111111', number: 77, skill: 0.75 },
  { name: 'Hana', body: '#f06fb0', stripe: '#f4f4f0', number: 88, skill: 0.72 },
];

let cache = null;
const world = () => cache || (cache = (() => { const track = buildTrack(); return { track, line: computeRacingLine(track) }; })());

// o: { url: 'ws://127.0.0.1:PORT', code, count (1 to 8), laps, mode, started, gap (metres between cars on the grid), startS, rate (real time speed, 1) }
export function startBots(o) {
  const { track, line } = world();
  const { url, code = 'LIVEA', count = 4, laps = 3, mode = 'Race', started = true, gap = 14, startS = -10 } = o;
  const log = { sent: 0, telemetry: 0, specSeen: 0 };
  const bots = [];
  let stopped = false;
  for (let i = 0; i < count; i++) {
    const spec = BOTS[i % BOTS.length];
    const car = new Car(GT, track);
    car.setAssists({ tc: true, abs: true, esc: true });
    car.placeAt(startS - i * gap, i % 2 ? 2.5 : -2.5);
    const bot = { spec, car, timer: new LapTimer(track), ap: new Autopilot(track, GT, { skill: spec.skill, line }), simT: 0, spectators: 0, ws: null, open: false, timers: [] };
    bots.push(bot);
    const ws = bot.ws = new WebSocket(`${url}/room/${code}`);
    ws.binaryType = 'arraybuffer';
    const send = x => { if (ws.readyState === 1) ws.send(typeof x === 'string' ? x : x); };
    const livery = encodeLivery({ body: spec.body, stripe: spec.stripe, wing: '#1b1d20', style: 1, number: spec.number, name: spec.name });
    ws.addEventListener('open', () => {
      bot.open = true;
      send(JSON.stringify({ t: 'join', name: spec.name, id: 'bot' + i + code, host: i === 0 }));
      const every = (ms, f) => bot.timers.push(setInterval(() => { if (!stopped && ws.readyState === 1) f(); }, ms));
      every(15000, () => send(JSON.stringify({ t: 'ping', n: 1 })));
      every(2000, () => send(JSON.stringify({ t: 'lv', l: livery })));
      if (i === 0) every(1000, () => send(JSON.stringify({ t: 'meta', mode, laps, started })));
      send(JSON.stringify({ t: 'lv', l: livery }));
      if (i === 0) send(JSON.stringify({ t: 'meta', mode, laps, started }));
    });
    ws.addEventListener('message', e => {
      if (typeof e.data !== 'string') return;
      try { const m = JSON.parse(e.data); if (m.t === 'spec') { bot.spectators = m.n; log.specSeen = m.n; } else if (m.t === 'welcome' && m.spectators) bot.spectators = m.spectators; } catch { /* not ours */ }
    });
    // physics in real time, the state 20 times a second (the game sends 30), telemetry 10 times a second while somebody watches
    let last = Date.now(), acc = 0, n = 0;
    bot.timers.push(setInterval(() => {
      if (stopped) return;
      const now = Date.now();
      acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= STEP) { bot.car.step(bot.ap.drive(bot.car)); bot.simT += STEP; bot.timer.update(bot.car.loc.s, bot.simT); acc -= STEP; }
      n++;
      if (!bot.open || ws.readyState !== 1) return;
      if (n % 3 === 0) { send(packState(encodeState(stateFromCar(bot.car, bot.timer.currentLap(), i, spec.name, bot.simT * 1000, bot.timer.best, bot.timer.last)))); log.sent++; }
      if (n % 6 === 0 && bot.spectators > 0) { send(encodeTelemetry(telemetryFromCar(bot.car))); log.telemetry++; }
    }, 1000 / 60));
  }
  return {
    bots, track, log,
    stop() { stopped = true; for (const b of bots) { b.timers.forEach(clearInterval); try { b.ws.close(); } catch { /* closed */ } } },
  };
}
