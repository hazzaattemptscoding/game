// The online side of a race start: the host's `race` message, and the clock offset that makes every machine's lights go out
// together. All of it goes through the room's control messages (Multiplayer.sendControl and onControl, over the relay or PeerJS).
//
//   clk   guest -> host   { t:'clk', n, c }          a clock sample request, c = the guest's clock when it was sent
//   clkr  host -> guest   { t:'clkr', n, c, h }      the reply: h = the host's clock when it arrived
//   race  host -> all     { t:'race', laps, assists, racingLine, grid: [ids in slot order], startAt, hold }
//   env   host -> all     { t:'env', weather, time }   the room's weather and time of day (visual only); also inside `race`. Old clients ignore both.
//                         startAt = lights out on the HOST's clock (ms); hold = the random hold before it, so everyone's lights look the same
//
// A guest takes 3 clock samples when it joins (shortest round trip wins, see start.js estimateOffset) and converts startAt to its
// own clock with that offset. A guest that gets no reply trusts its own clock. Ids are the same on every machine (Multiplayer.selfId).
// Pure JavaScript with the transport and clock injected, so tools/session.js tests it with a fake room.

import { cleanEnv, sameEnv } from './weather.js';
import { sampleOffset, estimateOffset, scheduleStart, sequenceFromMessage, pickHold, START } from './start.js';

export const SAMPLES = 3;
const SAMPLE_GAP_MS = 120;

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);

// What a guest accepts from the network: anything else is dropped or clamped.
export function cleanRaceMessage(m) {
  if (!m || m.t !== 'race' || !Number.isFinite(+m.startAt)) return null;
  const grid = Array.isArray(m.grid) ? m.grid.filter(x => typeof x === 'string' && x.length < 60).slice(0, 8) : [];
  return {
    t: 'race',
    laps: Math.round(num(m.laps, 1, 99, 5)),
    assists: m.assists === 'off' ? 'off' : 'any',
    racingLine: m.racingLine !== false,
    ...cleanEnv(m),
    grid,
    startAt: +m.startAt,
    hold: num(m.hold, START.HOLD_MIN_MS, START.HOLD_MAX_MS, START.HOLD_MIN_MS),
  };
}

// o: { mp (a Multiplayer or anything with sendControl, selfId, isHost, peers), now (ms clock), random, setTimeout, onRace({ msg, seq, slot, late }) }
export function createRaceControl(o) {
  const mp = o.mp, now = o.now || (() => performance.now()), random = o.random || Math.random, later = o.setTimeout || ((f, ms) => setTimeout(f, ms));
  const samples = [];
  let est = null, n = 0, current = null, lastStartAt = null, known = new Set(), hostEnv = null, sentEnv = null, envKnown = new Set();

  const api = {
    get offset() { return est ? est.offset : null; },      // host clock = this clock + offset; null until measured
    get estimate() { return est; },
    get current() { return current; },
    get env() { return hostEnv; },                         // the host's weather and time as a guest sees it; null on the host, outside a room or from an old host
    clearEnv() { hostEnv = null; sentEnv = null; envKnown = new Set(); },
    // host: say what the room's weather is (sent when it changes and once to each newcomer)
    hostSetEnv(e) {
      if (!mp.isHost) return;
      const env = cleanEnv(e);
      if (!sameEnv(env, sentEnv)) { sentEnv = env; envKnown = new Set(); }
      for (const p of mp.peers.values()) {
        if (!p.hello || envKnown.has(p.id)) continue;
        envKnown.add(p.id);
        mp.sendControl({ t: 'env', ...env }, p.id);
      }
    },                     // the race message in force (host: the one it sent)

    // guests: ask the host for a few clock samples (the replies come back through handle)
    syncClock() {
      if (mp.isHost) return;
      samples.length = 0; est = null;
      for (let k = 0; k < SAMPLES; k++) later(() => { if (mp.sendControl && !mp.isHost) mp.sendControl({ t: 'clk', n: ++n, c: now() }); }, k * SAMPLE_GAP_MS);
    },

    // host: start a race now. grid = ids in slot order (the host first). Returns { msg, seq, slot } for the host's own game.
    hostStart({ laps = 5, assists = 'any', racingLine = true, weather, time, grid }) {
      if (!mp.isHost) return null;
      const ids = grid || [mp.selfId, ...[...mp.peers.values()].filter(p => p.hello).map(p => p.id)];
      const sc = scheduleStart(now(), pickHold(random));
      const msg = { t: 'race', laps, assists, racingLine, ...cleanEnv({ weather, time }), grid: ids.slice(0, 8), startAt: sc.startAt, hold: sc.hold };
      current = msg; lastStartAt = msg.startAt;
      known = new Set([...mp.peers.values()].filter(p => p.hello).map(p => p.id));
      mp.sendControl(msg);
      return { msg, seq: sequenceFromMessage(msg, 0), slot: Math.max(0, msg.grid.indexOf(mp.selfId)), late: false };
    },

    // host: someone who joined after the start gets the message too (once), and starts as a free drive
    tick() {
      if (!mp.isHost || !current) return;
      for (const p of mp.peers.values()) {
        if (!p.hello || known.has(p.id)) continue;
        known.add(p.id);
        mp.sendControl(current, p.id);
      }
    },
    endRace() { current = null; lastStartAt = null; },

    // everything that arrives from the room
    handle(m, from) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'clk') {
        if (mp.isHost && Number.isFinite(+m.n) && Number.isFinite(+m.c)) mp.sendControl({ t: 'clkr', n: +m.n, c: +m.c, h: now() }, from);
      } else if (m.t === 'clkr') {
        if (mp.isHost || !Number.isFinite(+m.c) || !Number.isFinite(+m.h)) return;
        samples.push(sampleOffset(+m.c, +m.h, now()));
        est = estimateOffset(samples);
      } else if (m.t === 'env') {
        if (!mp.isHost) hostEnv = cleanEnv(m);
      } else if (m.t === 'race') {
        if (mp.isHost) return;
        const msg = cleanRaceMessage(m);
        if (!msg || msg.startAt === lastStartAt) return;
        if ('weather' in m || 'time' in m) hostEnv = cleanEnv(m);
        lastStartAt = msg.startAt;
        current = msg;
        const seq = sequenceFromMessage(msg, api.offset);
        const slot = msg.grid.indexOf(mp.selfId);
        // not on the grid, or the lights went out a while ago: take part as a free drive
        const late = slot < 0 || now() > seq.goAt + 5000;
        o.onRace && o.onRace({ msg, seq, slot: slot < 0 ? Math.min(7, msg.grid.length) : slot, late });
      }
    },
  };
  return api;
}
