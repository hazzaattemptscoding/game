// What the gantry screen (src/gantryScreen.js) shows for the session in progress, worked out from the race state. Pure JavaScript:
// tools/gantrystate.js tests it in node with a fake screen.
//
//   statusOf(s)           the resting board for the session: { eyebrow, value, sub }, or null with no session.
//                         A race shows its lap ("LAP 3 / 5"); free practice and time trial show the lap and the best lap.
//   GantryFeed            turns the race state into the screen's calls, frame by frame (update). Each board that happens once
//                         in a session is sent once: the lights step as they light, GO when the lights go out, LAST LAP when the
//                         leader starts the last lap, CHEQUERED FLAG when the leader finishes. The chequered flag is held until
//                         the session is left (or a new start begins).
//
// Online, every player's screen is driven by the same synced start (src/raceControl.js) and the same finishes (src/lobby.js):
// the leader's laps come from the room's packets, and the first finish message (the room's) puts the flag out for everyone.
import { fmtLap } from './gantryScreen.js';

const isRace = m => m === 'race' || m === 'online';

// the resting board. s: { mode, laps, reverse, lap (the lap being driven, 0 on the out lap), leadLap (the race's lead lap), best (s) }
export function statusOf(s) {
  if (!s) return null;
  const best = s.best > 0 ? `BEST ${fmtLap(s.best)}` : null;
  if (isRace(s.mode)) {
    const lap = Math.max(1, Math.min(s.laps, s.leadLap || s.lap || 1));
    return { eyebrow: s.mode === 'online' ? 'ONLINE RACE' : 'RACE', value: `LAP ${lap} / ${s.laps}`, sub: null };
  }
  if (s.mode === 'timetrial') return { eyebrow: 'TIME TRIAL', value: s.lap ? `LAP ${s.lap}` : 'OUT LAP', sub: best };
  if (s.mode === 'practice') return { eyebrow: s.reverse ? 'FREE PRACTICE, REVERSE' : 'FREE PRACTICE', value: s.lap ? `LAP ${s.lap}` : 'OUT LAP', sub: best };
  return null;
}

// Keeps what the screen has been told this session, so each step is sent once. screen: the gantry screen (createGantryScreen's api).
export class GantryFeed {
  constructor(screen) { this.screen = screen; this.reset(null); this.phase = 'menu'; }

  reset(session) {
    this.session = session;
    this.lights = -1;        // the last lit count sent, -1 before the first
    this.went = false;       // GO sent for this start
    this.lastLap = false;    // LAST LAP sent for this race
    this.flagOn = null;      // a flag this feed put up and holds ('chequered'): cleared when the session is left
  }

  // i: { session, phase ('menu' | 'setup' | 'start' | 'run' | 'paused' | 'results'), lights (the start sequence's state, or null),
  //      lap (the lap being driven, 0 on the out lap), leadLap, best (the session best lap, s), flagOut (the chequered flag is out) }
  // Returns the board the screen should show (statusOf), or null.
  update(i) {
    const s = i.session, live = !!s && i.phase !== 'menu' && i.phase !== 'setup', prev = this.phase;
    this.phase = i.phase;
    const restart = i.phase === 'start' && prev !== 'start';   // a race started again from the results or the pause menu
    if (!live || restart || s !== this.session) {
      if (this.flagOn) { this.screen.clear(); this.flagOn = null; }
      this.reset(live ? s : null);
      if (!live) { this.screen.status(null); return null; }
    }
    const race = isRace(s.mode);
    if (race && i.phase === 'start' && i.lights && (i.lights.phase === 'lights' || i.lights.phase === 'hold')) {
      if (i.lights.lit !== this.lights) { this.lights = i.lights.lit; this.screen.lights(i.lights.lit); }
    }
    if (race && prev === 'start' && i.phase === 'run' && !this.went) { this.went = true; this.screen.go(); }   // lights out: the start hands over to the run
    if (race && i.phase === 'run' && !this.lastLap && !i.flagOut && i.leadLap >= s.laps) { this.lastLap = true; this.screen.flag('final', { text: 'LAST LAP' }); }
    if (race && i.flagOut && this.flagOn !== 'chequered') { this.flagOn = 'chequered'; this.screen.flag('chequered', { text: 'CHEQUERED FLAG' }); }
    const board = statusOf({ mode: s.mode, laps: s.laps, reverse: s.reverse, lap: i.lap, leadLap: i.leadLap, best: i.best });
    this.screen.status(board);
    return board;
  }
}
