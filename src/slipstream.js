// Slipstreaming: a car close behind another, in line and at speed, pushes through thinner air. Plain functions with no page, so
// tools/slipstream.js tests them in node. Three parts:
//   wakeFor(me, others, opts)   how deep in a leader's wake the car is (0..1), from the poses of the live cars
//   easeWake(now, target, dt)   the strength the physics uses: it rises over 0.15 s and falls over 0.3 s, so it never pops
//   draftDragCut / dirtyAirLoss  what the strength does to drag and to front downforce (used by Car.step in src/physics.js)
// Only live cars are passed in (other players online). The ghost lap and the board ghost are never in the list, and a session without
// slipstream (time trial, or the rule off) passes opts.enabled = false.

export const FULL_GAP = 8;        // m, tail to nose: full strength at this gap or less
export const MAX_GAP = 40;        // m: no wake at all from here
export const MIN_LEADER_SPEED = 25;   // m/s: below this the leader makes no useful wake
export const FULL_LEADER_SPEED = 32;  // m/s: full wake from here (the ramp between keeps it from popping)
export const MAX_HEADING = 25 * Math.PI / 180;   // the follower must point within this of the leader
export const LATERAL_NEAR = 1.2, LATERAL_FAR = 2;   // m, how far to the side of the leader's line still counts, at FULL_GAP and at MAX_GAP
export const ATTACK_S = 0.15, RELEASE_S = 0.3;
export const DRAFT_DRAG = 0.25;   // default share of drag removed at full strength; cars.js `draftDrag` sets a class's own
export const MAX_DRAG_CUT = 0.4;  // draft and DRS together never remove more than this share of drag
export const DIRTY_DOWNFORCE = 0.12;   // share of front downforce lost at full strength, close behind a car
export const DIRTY_FULL_GAP = 10, DIRTY_END_GAP = 14;   // m: the loss is complete inside the first, gone at the second

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// me: { x, z, heading, length?, vx?, vz?, speed? }. others: [{ x, z, heading, vx, vz, length?, id?, ghost?, silent?, age? }], poses
// as they are drawn. A car marked ghost, silent for over half a second or younger than 1.5 s (just joined or reset) is skipped,
// as collisions skip them. opts: { enabled = true, length (my length when me has none), out (an object to fill and return, so the
// game's physics loop allocates none) }.
// Returns { strength 0..1, distance (m between my nose and the leader's tail, 0 when none), leaderIndex (-1 when none) }.
const give = (out, strength, distance, leaderIndex) => { out.strength = strength; out.distance = distance; out.leaderIndex = leaderIndex; return out; };
export function wakeFor(me, others, opts = {}) {
  const out = opts.out || {};
  if (opts.enabled === false || !others || !others.length) return give(out, 0, 0, -1);
  const fmx = Math.cos(me.heading), fmz = Math.sin(me.heading);
  const myLen = me.length ?? opts.length ?? 4.6;
  let best = 0, bestGap = 0, bestI = -1;
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    if (!o || o.ghost || o.silent > 0.5 || o.age < 1.5) continue;
    const speed = o.speed ?? Math.hypot(o.vx || 0, o.vz || 0);
    const vs = smooth(MIN_LEADER_SPEED, FULL_LEADER_SPEED, speed);
    if (vs <= 0) continue;
    // heading difference, folded to -pi..pi
    let dh = (o.heading - me.heading) % (2 * Math.PI);
    if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
    const hf = 1 - smooth(MAX_HEADING * 0.5, MAX_HEADING, Math.abs(dh));
    if (hf <= 0) continue;
    // my place in the leader's frame: behind is how far back along its heading, side how far off its line
    const flx = Math.cos(o.heading), flz = Math.sin(o.heading);
    const rx = me.x - o.x, rz = me.z - o.z;
    const back = -(rx * flx + rz * flz) ;
    const side = rx * -flz + rz * flx;
    const gap = back - (o.length ?? myLen) / 2 - myLen / 2;
    if (back <= 0 || gap >= MAX_GAP) continue;
    // I must also be pointing at it: the leader is ahead of my nose, not behind or beside me
    if ((-rx) * fmx + (-rz) * fmz <= 0) continue;
    const g = Math.max(0, gap);
    const df = 1 - smooth(FULL_GAP, MAX_GAP, g);
    const lim = LATERAL_NEAR + (LATERAL_FAR - LATERAL_NEAR) * clamp01((g - FULL_GAP) / (MAX_GAP - FULL_GAP));
    const lf = 1 - smooth(lim * 0.5, lim, Math.abs(side));
    const s = df * lf * hf * vs;
    if (s > best) { best = s; bestGap = g; bestI = i; }
  }
  return best > 0 ? give(out, best, bestGap, bestI) : give(out, 0, 0, -1);
}

// Move the eased strength towards the target by at most the attack or release rate for this time step.
export function easeWake(now, target, dt) {
  const up = dt / ATTACK_S, down = dt / RELEASE_S;
  return target > now ? Math.min(target, now + up) : Math.max(target, now - down);
}

// Share of drag removed by the draft at this eased strength, for a car class (cfg.draftDrag), before DRS is added.
export const draftDragCut = (strength, cfg) => (cfg && cfg.draftDrag !== undefined ? cfg.draftDrag : DRAFT_DRAG) * strength;

// Share of drag removed in all: the draft plus the DRS flap, never over MAX_DRAG_CUT.
export const totalDragCut = (draft, drs) => Math.min(MAX_DRAG_CUT, draft + drs);

// Share of front downforce lost at this strength and gap behind the leader.
export const dirtyAirLoss = (strength, gap) => DIRTY_DOWNFORCE * strength * (1 - smooth(DIRTY_FULL_GAP, DIRTY_END_GAP, gap));
