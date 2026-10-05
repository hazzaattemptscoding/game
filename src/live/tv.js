// The TV director of the live page: decides which car to show and from which kind of camera, and for how long. Pure logic (no page),
// tested in tools/live.js. It is fed the timing rows (RaceModel.rows) a few times a second and answers with a shot.
//
// A shot is { kind, id, spot, why, until }. kind: 'trackside' (a fixed camera that follows the car by turning), 'chase', 'onboard' or 'heli'.
// Rules:
//   - an incident (a car stopped on the track while others are racing) beats everything, but only after the current shot has been
//     held for HOLD.incident_after seconds, and is held HOLD.incident seconds
//   - a battle (two cars within BATTLE_M of each other and not far apart in speed) is shown while it lasts, 7 to 18 seconds
//   - otherwise the leader (or in practice the car with the fastest lap) for 8 to 12 seconds, then the next most interesting car
//   - after the lights go out the field is shown from a trackside camera for START_S seconds
//   - the camera kind changes with every shot: trackside most of the time, now and then chase, onboard or heli

export const HOLD = { min: 7, max: 12, battle: 18, incident: 9, incidentAfter: 3, start: 10, finish: 12 };
export const BATTLE_M = 45;          // metres between two cars that count as a battle
export const STOPPED_MS = 3;         // m/s under which a car on the lap counts as stopped, when the pack is moving

const KINDS = ['trackside', 'chase', 'trackside', 'onboard', 'trackside', 'heli', 'chase'];

export class TVDirector {
  // o: { random (a function), spots (how many trackside cameras there are) }
  constructor({ random = Math.random, spots = 8 } = {}) {
    this.random = random; this.spots = spots;
    this.shot = null; this.since = 0; this.kindIx = Math.floor(random() * KINDS.length);
    this.startedAt = null; this.lastStarted = false; this.finishSeen = false;
  }

  // now in seconds. rows: RaceModel.rows(). meta: { started, laps }. Returns the current shot (the same object while it holds).
  update(now, rows, meta = {}) {
    const live = rows.filter(r => r.signal);
    if (!live.length) { this.shot = null; return null; }
    if (meta.started && !this.lastStarted) { this.startedAt = now; this.finishSeen = false; }
    this.lastStarted = !!meta.started;
    const cur = this.shot, held = cur ? now - this.since : Infinity;
    const incident = this.findIncident(live), battle = this.findBattle(live);
    const winner = this.finishSeen ? null : live.find(r => r.finished);
    let want;
    if (meta.started && this.startedAt !== null && now - this.startedAt < HOLD.start) want = { id: live[0].id, why: 'start', kind: 'trackside', hold: HOLD.start - (now - this.startedAt) };
    else if (winner) want = { id: winner.id, why: 'finish', kind: 'chase', hold: HOLD.finish };
    else if (incident) want = { id: incident.id, why: 'incident', hold: HOLD.incident };
    else if (battle) want = { id: battle.back.id, why: 'battle', hold: HOLD.battle };
    else want = { id: live[0].id, why: 'leader', hold: HOLD.min + this.random() * (HOLD.max - HOLD.min) };

    if (!cur || !live.some(r => r.id === cur.id)) return this.cut(now, want);
    if (cur.why === 'finish' && held >= HOLD.finish) this.finishSeen = true;
    if (want.why === 'incident' && cur.why !== 'incident' && held >= HOLD.incidentAfter) return this.cut(now, want);
    if ((want.why === 'start' || want.why === 'finish') && cur.why !== want.why) return this.cut(now, want);     // the lights and the flag cut in at once
    if (held < cur.hold) {
      // a battle that starts while a leader shot is on air takes over once the minimum hold is over
      if (want.why === 'battle' && cur.why === 'leader' && held >= HOLD.min) return this.cut(now, want);
      return cur;
    }
    // the shot has run its time: carry on with the same fight while it lasts, else the best choice, never the same leader shot twice in a row
    if (cur.why === 'battle' && battle && held < HOLD.battle && (battle.back.id === cur.id || battle.front.id === cur.id)) return cur;
    if (want.why === 'leader' && cur.why === 'leader' && want.id === cur.id) want = { ...want, id: live[(live.findIndex(r => r.id === cur.id) + 1) % live.length].id, why: 'field' };
    return this.cut(now, want);
  }

  cut(now, want) {
    const kind = want.kind || KINDS[this.kindIx++ % KINDS.length];
    this.since = now;
    this.shot = { kind, id: want.id, why: want.why, spot: Math.floor(this.random() * this.spots), hold: want.hold, until: now + want.hold };
    return this.shot;
  }

  // two neighbours in the order that are close and about as fast as each other: the cars on the same bit of track
  findBattle(rows) {
    let best = null;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (a.finished || b.finished) continue;
      const gap = a.dist - b.dist;
      if (gap < 0 || gap > BATTLE_M || Math.max(a.speed, b.speed) < 15) continue;
      const score = 1 - gap / BATTLE_M + (i === 1 ? 0.25 : 0) / i;
      if (!best || score > best.score) best = { front: a, back: b, score };
    }
    return best;
  }

  // a car that is stopped (or crawling) while another car is going fast
  findIncident(rows) {
    if (rows.length < 2 || Math.max(...rows.map(r => r.speed)) < 20) return null;
    return rows.find(r => r.speed < STOPPED_MS && !r.finished) || null;
  }
}
