// Sessions: what the player is doing (free practice, time trial, race, online), the state machine that moves between the
// menu, the start, the drive and the results, lap counting and the finish rule, and the results order.
// Plain JavaScript, no page: tools/session.js tests it in node.

import { StartSequence, START, pickHold } from './start.js';
import { cleanWeather, cleanTime } from './weather.js';

export const MODES = ['practice', 'timetrial', 'race', 'online'];
export const MODE_NAMES = { practice: 'Free practice', timetrial: 'Time trial', race: 'Race', online: 'Online race' };
export const LAP_CHOICES = [3, 5, 10, 20];

// A session description. laps 0 = unlimited. start: 'standing' (grid, lights) or 'pit'. assists: 'any' (the player's own settings)
// or 'off' (all three off for this session). racingLine: whether the racing line may be shown. ai: opponents (0 until they exist).
// slot: grid slot (0 offline, join order online).
export function makeSession(mode = 'practice', o = {}) {
  if (!MODES.includes(mode)) mode = 'practice';
  const s = { mode, laps: 0, start: 'pit', assists: 'any', racingLine: true, trackLimits: 'warn', ai: 0, slot: 0, weather: 'clear', time: 'midday' };
  if (mode === 'timetrial') s.start = 'pit';
  if (mode === 'race' || mode === 'online') { s.laps = 5; s.start = 'standing'; }
  if (mode === 'practice' && o.start === 'standing') s.start = 'standing';
  if (mode !== 'practice' && mode !== 'timetrial') {
    if (Number.isFinite(o.laps)) s.laps = Math.max(1, Math.min(99, Math.round(o.laps)));
    if (o.assists === 'off' || o.assists === 'any') s.assists = o.assists;
    if (typeof o.racingLine === 'boolean') s.racingLine = o.racingLine;
  }
  if (Number.isFinite(o.slot)) s.slot = Math.max(0, Math.min(7, Math.floor(o.slot)));
  s.weather = cleanWeather(o.weather); s.time = cleanTime(o.time ?? o.timeOfDay);   // visual only; online the host's choice
  s.ai = 0;
  return s;
}

export const hasStartLights = s => !!s && (s.mode === 'race' || s.mode === 'online');
export const isRace = s => !!s && (s.mode === 'race' || s.mode === 'online');

// race distance: laps driven (the lap being driven, 0 on the out lap) and metres into it, as ghosts.js raceDistance does
export const raceDistance = (lap, s, length) => lap * length + s;

// --- the race: lap counting, the finish rule, position ---

export const RACE = { RACING: 'racing', FLAG: 'flag', FINISHED: 'finished' };

export class RaceTracker {
  // o: { laps, length }
  constructor({ laps = 5, length = 3835 } = {}) {
    this.laps = laps;
    this.length = length;
    this.startSim = null;     // sim time of lights out
    this.finishSim = null;    // sim time we finished
    this.state = RACE.RACING;
    this.flagAt = null;       // our completed laps when the leader finished
    this.penalties = [];      // { seconds, reason }
    this.lapsDone = 0;
  }

  start(simTime) { this.startSim = simTime; }
  addPenalty(seconds, reason) { this.penalties.push({ seconds, reason }); }
  get penalty() { return this.penalties.reduce((a, p) => a + p.seconds, 0); }
  get finished() { return this.state === RACE.FINISHED; }

  // Call every frame (or step). me: { laps: completed laps, lap: lap being driven, s }, others: [{ laps (completed), lap, s }].
  // The chequered flag falls when the first car completes the distance. We finish when we complete it ourselves (offline that
  // is the same moment), or at our next line crossing once the flag is out. Returns the position: { pos, total, leaderDone }.
  update(simTime, me, others = []) {
    this.lapsDone = me.laps;
    const leaderDone = me.laps >= this.laps || others.some(o => o.laps >= this.laps);
    if (this.state === RACE.RACING && leaderDone) { this.state = RACE.FLAG; this.flagAt = me.laps; }
    if (this.state === RACE.FLAG && (me.laps >= this.laps || me.laps > this.flagAt) && this.finishSim === null) {
      this.state = RACE.FINISHED;
      this.finishSim = simTime;
    }
    return { ...this.position(me, others), leaderDone };
  }

  position(me, others = []) {
    const L = this.length, mine = raceDistance(me.lap, me.s, L);
    let ahead = 0;
    for (const o of others) if (raceDistance(o.lap, o.s, L) > mine) ahead++;
    return { pos: ahead + 1, total: others.length + 1 };
  }

  // race time: lights out to our finish, plus the penalties; null until we finish
  get time() { return this.finishSim === null || this.startSim === null ? null : this.finishSim - this.startSim + this.penalty; }
  // running race time at simTime (without penalties until the finish)
  elapsed(simTime) { return this.startSim === null ? 0 : Math.max(0, (this.finishSim === null ? simTime : this.finishSim) - this.startSim); }
}

// Results order. Finished cars first by total time (penalties included), then the cars still racing by distance driven.
// entries: [{ id, name, me, finished, time, dist, ... }]. Returns a new list with `rank` and `gap` (seconds to the winner, for
// finished cars; laps behind otherwise is left to the caller).
export function orderResults(entries) {
  const list = entries.map((e, i) => ({ ...e, _i: i }));
  list.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.time - b.time || a._i - b._i;
    return (b.dist || 0) - (a.dist || 0) || a._i - b._i;
  });
  const lead = list.length && list[0].finished ? list[0].time : null;
  return list.map((e, k) => { const { _i, ...r } = e; return { ...r, rank: k + 1, gap: r.finished && lead !== null && k > 0 ? r.time - lead : null }; });
}

// --- the flow ---

export const PHASE = { MENU: 'menu', SETUP: 'setup', START: 'start', RUN: 'run', PAUSED: 'paused', RESULTS: 'results' };

// The state machine. It holds no page and no car: main.js asks it what phase we are in and tells it what happened.
//   menu -> setup (race, practice) or straight on -> start (race: lights, time trial: countdown; practice skips it) -> run
//   run -> paused -> run | start (restart) | menu;   run -> results (race finished) -> start (race again) | menu
export class Flow {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.phase = PHASE.MENU;
    this.session = null;
    this.seq = null;
    this.race = null;
    this.results = null;
    this.pausedFrom = null;
    this.setupMode = null;
    this.log = [];            // phase changes, for tests: 'menu', 'setup:race', 'start', 'run', ...
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); }
  get(phase = this.phase) { return phase; }
  go(phase, note = '') {
    this.phase = phase;
    this.log.push(note ? `${phase}:${note}` : phase);
    for (const fn of this.listeners) fn(phase, this);
  }

  // menu -> the setup screen of a mode
  openSetup(mode) {
    if (this.phase !== PHASE.MENU && this.phase !== PHASE.RESULTS) return false;
    this.setupMode = mode;
    this.go(PHASE.SETUP, mode);
    return true;
  }
  cancelSetup() { if (this.phase !== PHASE.SETUP) return false; this.setupMode = null; this.go(PHASE.MENU); return true; }

  // Start a session at `now` (the caller's clock, ms). o: { t0, hold } to schedule the start (online); otherwise it begins now with a random hold.
  begin(session, now, o = {}) {
    if (this.phase === PHASE.START || this.phase === PHASE.RUN) return false;
    this.session = session;
    this.results = null;
    this.race = isRace(session) ? new RaceTracker({ laps: session.laps, length: o.length || 3835 }) : null;
    const t0 = o.t0 ?? now;
    if (hasStartLights(session)) this.seq = new StartSequence({ t0, hold: o.hold ?? pickHold(this.random), kind: 'lights' });
    else if (session.mode === 'timetrial') this.seq = new StartSequence({ t0, kind: 'ready' });
    else this.seq = null;
    this.go(this.seq ? PHASE.START : PHASE.RUN, session.mode);
    return true;
  }

  // Advance. Returns what changed: 'run' when lights go out (or the countdown ends), else null. simTime is the sim clock for the race.
  update(now, simTime = 0) {
    if (this.phase !== PHASE.START) return null;
    if (this.seq.state(now).released) {
      if (this.race) { this.race.start(simTime); if (this.seq.penalty) this.race.addPenalty(this.seq.penalty, 'Jump start'); }
      this.go(PHASE.RUN);
      return 'run';
    }
    return null;
  }

  // a jump start recorded by the sequence while we are still in START: its penalty goes on at release
  addJumpPenalty() { if (this.race && this.seq && this.seq.jump && !this.race.penalties.some(p => p.reason === 'Jump start')) this.race.addPenalty(START.PENALTY_S, 'Jump start'); }

  pause() { if (this.phase !== PHASE.RUN && this.phase !== PHASE.START) return false; this.pausedFrom = this.phase; this.go(PHASE.PAUSED); return true; }
  resume() { if (this.phase !== PHASE.PAUSED) return false; this.go(this.pausedFrom || PHASE.RUN, 'resume'); this.pausedFrom = null; return true; }

  // start the same session again, from the paused menu or the results screen
  restart(now, o = {}) {
    if (this.phase !== PHASE.PAUSED && this.phase !== PHASE.RESULTS) return false;
    const s = this.session;
    this.phase = PHASE.MENU;           // begin() refuses to start over a running session
    this.pausedFrom = null;
    return this.begin(s, now, o);
  }

  finish(entries) {
    if (this.phase !== PHASE.RUN || !this.race) return false;
    this.results = orderResults(entries);
    this.go(PHASE.RESULTS);
    return true;
  }

  toMenu() {
    this.session = null; this.seq = null; this.race = null; this.results = null; this.pausedFrom = null; this.setupMode = null;
    this.go(PHASE.MENU);
    return true;
  }

  get driving() { return this.phase === PHASE.RUN || this.phase === PHASE.START; }
}

// --- the time trial ---

// Laps of a time trial for the lap list: newest first, with the best valid lap marked. history is LapTimer.history.
export function timeTrialRows(history, n = 8) {
  const valid = history.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.time)) : null;
  return history.map(l => ({ lap: l.lap, time: l.time, sectors: l.sectors, valid: l.valid, warnings: l.warnings, best: l.valid && best !== null && l.time <= best + 1e-9 })).slice(-n).reverse();
}
