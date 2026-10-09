// Whole-lap sweep for the trackside problems the owner keeps reporting. Headless: it builds the track data (src/track.js)
// and scans it, no WebGL needed. Every hit is printed with its s (metres along the lap) and the reason.
//   node tools/sweep.mjs                 print every hit, grouped by check
//   node tools/sweep.mjs --json out.json also write the hits as JSON (for a regression test to compare against)
//   node tools/sweep.mjs --check seam    run one check only (seam, runoff, wall, furniture, gap, far)
//   SWEEP_ROOT=/path/to/other/checkout node tools/sweep.mjs   the same checks on another checkout
// Checks (thresholds are at the top; tune them only with a picture in hand):
//   seam     a barrier line breaks: a gap in the sample indices of one barrier, or a jump in position or height between
//            two neighbouring points, or two barriers on one side that meet with a step
//   runoff   a paved run-off or apron ends in one sample (no taper), or its width jumps
//   wall     the street or containment wall steps sideways by more than a metre in one metre of lap
//   furniture a piece of trackside furniture stands on paved track surface (run-off or pit) or hard against the kerb
//   gap      a stretch of more than GAP_LIMIT metres on one side with no furniture at all (sparse trackside)
//   far      a sign, board or flag stands more than FAR_LIMIT metres from the nearest barrier on its side
// Exit status is 1 when any hit is found, so it can run as a test once the known hits are fixed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// SWEEP_ROOT=<checkout> runs the same checks on another checkout (e.g. the build before a commit) to tell old problems from new
const root = process.env.SWEEP_ROOT || join(here, '..');
const { buildTrack, BARRIER, SURF } = await import(join(root, 'src', 'track.js'));

const SEAM_XZ = 2.5;        // metres between neighbouring barrier points (they are 1 m apart; more is a hole)
const SEAM_Y = 0.35;        // metres of height between neighbouring points (a 1 m step; this is steeper than any ground)
const WALL_STEP = 1.0;      // metres of sideways wall movement in one sample
const RUNOFF_STEP = 2.0;    // metres of paved run-off width lost in one sample (a taper of up to ~1 m per metre is normal)
const RUNOFF_END = 1.0;     // a run-off wider than this that drops to nothing in one sample has no taper at all
const GAP_LIMIT = 300;      // metres of a side with no furniture
const FAR_LIMIT = 12;
const BOARD_FAR_LIMIT = 20;   // distance boards stand just past the paved apron when the barrier is further out (boardOffset), so a driver can read them       // metres from the nearest barrier
const CAT = { seam: 'seam', runoff: 'runoff', wall: 'wall', furniture: 'furniture', gap: 'gap', far: 'far' };

const args = process.argv.slice(2);
const only = args.includes('--check') ? args[args.indexOf('--check') + 1] : null;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const T = buildTrack();
const L = T.length;
const BN = Object.fromEntries(Object.entries(BARRIER).map(([k, v]) => [v, k]));
const hits = [];
const hit = (check, s, sd, msg) => hits.push({ check, s: Math.round(((s % L) + L) % L), side: sd, msg });
const wrapI = i => ((i % T.N) + T.N) % T.N;
const want = c => !only || only === c;

// 1. seams in barrier lines
if (want('seam')) {
  for (const b of T.barriers) {
    const pts = b.pts;
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay, az, ai] = pts[k - 1], [bx, by, bz, bi] = pts[k];
      const di = ((bi - ai) % T.N + T.N) % T.N;
      const dxz = Math.hypot(bx - ax, bz - az), dy = Math.abs(by - ay);
      if (di > 3 || di < 1) hit(CAT.seam, T.s[ai], b.side, `${BN[b.type]} run jumps ${di} samples (${dxz.toFixed(1)} m) at s=${T.s[ai].toFixed(0)}, ${dy.toFixed(2)} m height step`);
      else if (dxz > SEAM_XZ * di) hit(CAT.seam, T.s[ai], b.side, `${BN[b.type]} gap of ${dxz.toFixed(1)} m between points at s=${T.s[ai].toFixed(0)}`);
      else if (dy > SEAM_Y * di) hit(CAT.seam, T.s[ai], b.side, `${BN[b.type]} height step ${dy.toFixed(2)} m over ${di} m at s=${T.s[ai].toFixed(0)}`);
    }
  }
  // two barriers on one side meeting: an end of one barrier against an end of another, within 3 m of lap, with a step
  for (const sd of [0, 1]) {
    const ends = [];
    for (const b of T.barriers.filter(b => b.side === sd && b.pts.length > 1)) {
      ends.push({ b, p: b.pts[0] }, { b, p: b.pts[b.pts.length - 1] });
    }
    for (let k = 0; k < ends.length; k++) for (let m = k + 1; m < ends.length; m++) {
      const A = ends[k], B = ends[m];
      if (A.b === B.b) continue;
      const ds = Math.abs(((T.s[A.p[3]] - T.s[B.p[3]]) % L + L + L / 2) % L - L / 2);
      if (ds > 3) continue;
      const gap = Math.hypot(A.p[0] - B.p[0], A.p[2] - B.p[2]), dy = Math.abs(A.p[1] - B.p[1]);
      // a join is two ends that should touch: a hole of 0.3 to 1.5 m, or a height step; walls running side by side (gap > 1.5 m) are not joins
      if (gap < 1.5 && (gap > 0.3 || dy > 0.3)) hit(CAT.seam, T.s[A.p[3]], sd, `${BN[A.b.type]} joins ${BN[B.b.type]} at s=${T.s[A.p[3]].toFixed(0)} with a ${gap.toFixed(2)} m hole and ${dy.toFixed(2)} m height step`);
    }
  }
}

// 2. run-off that ends or steps in one sample
if (want('runoff')) {
  for (const sd of [0, 1]) {
    for (let i = 0; i < T.N; i++) {
      const a = T.runoff[sd][i], b = T.runoff[sd][wrapI(i + 1)];
      if (Math.abs(a - b) > RUNOFF_STEP || (Math.min(a, b) < 0.01 && Math.max(a, b) > RUNOFF_END)) hit(CAT.runoff, T.s[i], sd, `run-off ${a.toFixed(1)} m -> ${b.toFixed(1)} m in one metre (no taper)`);
    }
  }
}

// 3. wall steps sideways
if (want('wall')) {
  for (const sd of [0, 1]) {
    for (let i = 0; i < T.N; i++) {
      const a = T.wall[sd][i], b = T.wall[sd][wrapI(i + 1)];
      if (Math.abs(a - b) > WALL_STEP) hit(CAT.wall, T.s[i], sd, `wall moves ${(b - a).toFixed(2)} m in one metre`);
    }
  }
}

// 4. furniture on paved track surface
if (want('furniture')) {
  for (const f of T.furniture) {
    const i = f.i;
    const edge = T.hw[i] + T.kerb[f.d < 0 ? 0 : 1][i] + T.sausage[f.d < 0 ? 0 : 1][i];
    const sd = f.d < 0 ? 0 : 1;
    // paved: inside the run-off's own width (from the kerb out), so an object standing behind the barrier is not on it
    const paved = T.runoff[sd][i] > 1.8 && Math.abs(f.d) < edge + T.runoff[sd][i] || T.pitIn?.[i] !== undefined && Math.abs(f.d) < T.pitWidth?.[i] + 0.5 && f.pit;
    if (Math.abs(f.d) < edge) hit(CAT.furniture, f.s, sd, `${f.type} at d=${f.d.toFixed(1)} is inside the kerb line (edge ${edge.toFixed(1)} m)`);
    else if (paved && !f.pit && !f.corner) hit(CAT.furniture, f.s, sd, `${f.type} (${f.corner || 'no corner'}) stands on the paved run-off at d=${f.d.toFixed(1)}`);
  }
}

// 5. long stretches with no furniture on a side
if (want('gap')) {
  for (const sd of [0, 1]) {
    const s = T.furniture.filter(f => (f.d < 0 ? 0 : 1) === sd).map(f => f.s).sort((a, b) => a - b);
    if (!s.length) { hit(CAT.gap, 0, sd, 'no furniture at all on this side'); continue; }
    for (let k = 0; k < s.length; k++) {
      const next = k + 1 < s.length ? s[k + 1] : s[0] + L;
      const len = next - s[k];
      if (len > GAP_LIMIT) hit(CAT.gap, s[k], sd, `${len.toFixed(0)} m with no furniture on this side (from s=${s[k].toFixed(0)} to ${(next % L).toFixed(0)})`);
    }
  }
}

// 6. furniture far from any barrier on its side
if (want('far')) {
  const bpts = [[], []];
  for (const b of T.barriers) for (const p of b.pts) bpts[b.side].push(p);
  for (const f of T.furniture) {
    const sd = f.d < 0 ? 0 : 1;
    let best = Infinity;
    for (const p of bpts[sd]) { const d = Math.hypot(p[0] - f.x, p[2] - f.z); if (d < best) best = d; }
    if (best > (/board/i.test(f.type) ? BOARD_FAR_LIMIT : FAR_LIMIT)) hit(CAT.far, f.s, sd, `${f.type} is ${best.toFixed(0)} m from the nearest barrier on its side`);
  }
}

const bySeen = {};
for (const h of hits) (bySeen[h.check] ||= []).push(h);
for (const [c, list] of Object.entries(bySeen)) {
  console.log(`\n${c}: ${list.length} hit(s)`);
  for (const h of list) console.log(`  s=${String(h.s).padStart(5)} side=${h.side}  ${h.msg}`);
}
console.log(`\ntotal ${hits.length} hits over ${L.toFixed(0)} m`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(hits, null, 1));
process.exit(hits.length ? 1 : 0);
