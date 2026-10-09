// Sessions: what the player is doing (free practice, time trial, race, online), the state machine that moves between the
// menu, the start, the drive and the results, lap counting and the finish rule, and the results order.
// Plain JavaScript, no page: tools/session.js tests it in node.

import { StartSequence, START, pickHold } from './start.js';
import { cleanWeather, cleanTime } from './weather.js';
import { timeGained, TOLERANCE } from './trackLimits.js';

export const MODES = ['practice', 'timetrial', 'race', 'online'];
export const MODE_NAMES = { practice: 'Free practice', timetrial: 'Time trial', race: 'Race', online: 'Online race' };
export const LAP_CHOICES = [3, 5, 10, 20];

// A session description. laps 0 = unlimited. start: 'standing' (grid, lights) or 'pit'. assists: 'any' (the player's own settings)
// or 'off' (all three off for this session). racingLine: whether the racing line may be shown. slipstream: whether cars draft behind each other (always false in a time trial; a race takes the setup's choice, online the host's). ai: opponents (0 until they exist).
// slot: grid slot (0 offline, join order online). reverse: the lap driven the other way round (free practice only for now;
// no racing line, it was recorded the normal way). trackLimits: 'penalty' (a race gains time by a cut: time penalty, see
// RaceTracker) or 'warn' (a cut is a warning and makes the lap invalid, nothing more). Races default to 'penalty'; practice,
// time trial and hot laps are always 'warn'.
export function makeSession(mode = 'practice', o = {}) {
  if (!MODES.includes(mode)) mode = 'practice';
  const s = { mode, laps: 0, start: 'pit', assists: 'any', racingLine: true, trackLimits: 'warn', ai: 0, slot: 0, weather: 'clear', time: 'midday', reverse: false, slipstream: true };
  if (mode === 'timetrial') { s.start = 'pit'; s.slipstream = false; }   // a time trial is against the clock: no wake
  if (mode === 'race' || mode === 'online') { s.laps = 5; s.start = 'standing'; s.trackLimits = 'penalty'; }
  if (mode === 'practice' && o.start === 'standing') s.start = 'standing';
  if (mode === 'practice' && o.reverse === true) { s.reverse = true; s.racingLine = false; }
  if (mode === 'practice' && typeof o.slipstream === 'boolean') s.slipstream = o.slipstream;
  if (mode !== 'practice' && mode !== 'timetrial') {
    if (typeof o.slipstream === 'boolean') s.slipstream = o.slipstream;
    if (Number.isFinite(o.laps)) s.laps = Math.max(1, Math.min(99, Math.round(o.laps)));
    if (o.assists === 'off' || o.assists === 'any') s.assists = o.assists;
    if (typeof o.racingLine === 'boolean') s.racingLine = o.racingLine;
    if (o.trackLimits === 'warn' || o.trackLimits === 'penalty') s.trackLimits = o.trackLimits;
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

// --- the race: lap counting, the finish rule, position, track limits penalties ---

export const RACE = { RACING: 'racing', FLAG: 'flag', FINISHED: 'finished' };

export class RaceTracker {
  // o: { laps, length, trackLimits: 'penalty' | 'warn' }
  constructor({ laps = 5, length = 3835, trackLimits = 'warn' } = {}) {
    this.laps = laps;
    this.length = length;
    this.limitRule = trackLimits === 'penalty' ? 'penalty' : 'warn';
    this.limitPenalties = [];  // { corner, gained, seconds, at } for each track limits penalty
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

  // Track limits (rule 'penalty'): each excursion that ended (timer.limits.takeClosed) gains the car time if it covered its
  // stretch faster than the car's best clean lap did (timeGained). A gain over TOLERANCE costs the gain rounded up to the
  // next whole second, shown as 'Track limits +2s'. No gain, no penalty; the warning and the invalid lap apply either way.
  judgeLimits(closed, timer, simTime) {
    for (const ex of closed) {
      const gained = timeGained(ex, timer);
      if (gained === null || gained <= TOLERANCE) continue;
      const seconds = Math.ceil(gained);
      this.addPenalty(seconds, `Track limits +${seconds}s`);
      this.limitPenalties.push({ corner: ex.corner, gained, seconds, at: simTime });
    }
  }

  // Call every frame (or step). me: { laps: completed laps, lap: lap being driven, s }, others: [{ laps (completed), lap, s }].
  // timer (optional, the LapTimer) gives the track limits excursions to judge. The chequered flag falls when the first car
  // completes the distance. We finish when we complete it ourselves (offline that is the same moment), or at our next line
  // crossing once the flag is out. Returns the position: { pos, total, leaderDone }.
  update(simTime, me, others = [], timer = null) {
    this.lapsDone = me.laps;
    const closed = timer && timer.limits ? timer.limits.takeClosed() : [];
    if (this.limitRule === 'penalty' && this.state !== RACE.FINISHED) this.judgeLimits(closed, timer, simTime);
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

// The results table. entries: one per car, flat: { id, name, me, finished, dnf, time (race time with penalties, finished cars),
// dist (race distance: lap * length + s; a finished car's is its full distance), best (best valid lap, s), sec ([s1, s2, s3], 0 = none),
// pen ([{ s, why }]), warn (track limit warnings), grid (grid position, 1-based, or null), colour, num }.
// Order: finished cars by time (penalties in it), then the cars still out by distance driven, then the cars that did not finish
// (DNF) by grid position. The local car is not put first: it sorts like the others.
// Returns new rows: the fields above plus: status ('finished' | 'racing' | 'dnf'), rank (1..n, null for DNF), gap (seconds to the
// winner, finished cars behind it), lapsDown (whole laps behind the leader, cars still out), gained (grid - rank, when both are known),
// penalty (seconds), secCls (per sector: 'best' overall fastest, 'near' within NEAR_S of it, 'slow' otherwise, null: no time) and
// bestCls ('best' for the fastest lap of the race). total is the number of rows.
export const NEAR_S = 0.3;
export function raceRows(entries, { laps = 0, length = 3835 } = {}) {
  const byId = (a, b) => (a.grid ?? 1e6) - (b.grid ?? 1e6) || String(a.id).localeCompare(String(b.id));
  const cls = e => (e.dnf ? 2 : e.finished ? 0 : 1);
  const list = entries.map(e => {
    const dist = e.finished && laps > 0 ? laps * length : (e.dist || 0);   // a finished car is a whole race: the lap counter runs one ahead at the flag
    return { ...e, dist, status: e.dnf ? 'dnf' : e.finished ? 'finished' : 'racing', pen: Array.isArray(e.pen) ? e.pen : [], warn: e.warn || 0 };
  });
  list.sort((a, b) => cls(a) - cls(b) || (cls(a) === 0 ? a.time - b.time || byId(a, b) : cls(a) === 1 ? b.dist - a.dist || byId(a, b) : byId(a, b)));
  const lead = list.find(r => r.status === 'finished') || null;
  const leadDist = Math.max(0, ...list.filter(r => r.status !== 'dnf').map(r => r.dist));
  let rank = 0;
  const rows = list.map(r => {
    const out = { ...r };
    out.rank = r.status === 'dnf' ? null : ++rank;
    out.gap = r.status === 'finished' && lead && r !== lead ? r.time - lead.time : null;
    const down = leadDist - r.dist;
    out.lapsDown = r.status === 'racing' && length > 0 && down >= length ? Math.floor(down / length) : 0;
    out.gained = r.status !== 'dnf' && r.grid != null ? r.grid - out.rank : null;
    out.penalty = r.pen.reduce((a, p) => a + (p.s || 0), 0);
    return out;
  });
  // the timing colours: the fastest of the race in each sector and in the lap, near = within NEAR_S of the fastest
  const bestOf = i => { const v = rows.map(r => (r.sec && r.sec[i]) || 0).filter(x => x > 0); return v.length ? Math.min(...v) : null; };
  const secBest = [0, 1, 2].map(bestOf), lapBest = Math.min(...rows.map(r => r.best || 0).filter(x => x > 0), Infinity);
  const colourOf = (v, top) => (!(v > 0) || top == null ? null : v <= top + 1e-9 ? 'best' : v - top <= NEAR_S ? 'near' : 'slow');
  for (const r of rows) {
    r.secCls = [0, 1, 2].map(i => colourOf((r.sec && r.sec[i]) || 0, secBest[i]));
    r.bestCls = r.best > 0 && r.best <= lapBest + 1e-9 ? 'best' : null;
  }
  return Object.assign(rows, { total: rows.length, leader: lead ? lead.id : null });
}

// Results order: the same rules as raceRows, for the plain entries { id, name, me, finished, time, dist }. Returns the rows with
// `rank` and `gap` (seconds to the winner, for finished cars behind the winner).
export function orderResults(entries) {
  return raceRows(entries);
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
    this.race = isRace(session) ? new RaceTracker({ laps: session.laps, length: o.length || 3835, trackLimits: session.trackLimits }) : null;
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

  // rows: the results table (raceRows); it is kept as it is
  finish(rows) {
    if (this.phase !== PHASE.RUN || !this.race) return false;
    this.results = rows;
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
