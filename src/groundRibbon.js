// The ground beside the tarmac, built as ONE continuous ribbon per side.
//
// At every sample along the track, each side has a row of vertices at every band border
// (kerb, sausage, apron, gravel, grass, pit road, outer grass). Neighbouring bands share
// those vertices exactly, so there is no overlap, no gap, no stacked layer and no height step
// at a border. Which material a band takes is decided per sample (concrete or tarmac apron,
// island or grass beside the pit road, ...); a band that is zero wide at a sample simply
// collapses to nothing there. Heights all come from T.groundAt (plus real relief for the
// kerb and sausage, T.relief), never from a lift.
//
// Wide bands are cut across their width into pieces of at most MAX_PIECE metres, each corner
// taking its own ground height, so a 60 m grass band follows a bank instead of cutting a chord.

const MAX_PIECE = 6;
const BANDS = 9;                       // kerb, sausage up, sausage down, apron, gravel, grass A, pit, grass B, outer grass
const U_SCALE = { kerb: 2, sausage: 1.6, apron: 8, concrete: 15, gravel: 6, grass: 40, pit: 16, road: 8, island: 4 };
const PIT_FADE = 10, TARMAC_TONE = 0.76;   // the pit asphalt takes its own tone over 10 m after the mouth

const wrap = (i, n) => ((i % n) + n) % n;

export function buildGroundRibbon(T, strips, P, G) {
  const { N } = T, hw = T.halfWidth;

  // how far each pit sample is from the mouth, for the tone fade
  const fromMouth = new Float64Array(N).fill(1e9);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) if (T.pitMouth[i]) fromMouth[i] = 0; else if (T.pitOut[i] > 0) fromMouth[i] = Math.min(fromMouth[i], fromMouth[wrap(i - 1, N)] + 1);
    for (let i = N - 1; i >= 0; i--) if (!T.pitMouth[i] && T.pitOut[i] > 0) fromMouth[i] = Math.min(fromMouth[i], fromMouth[wrap(i + 1, N)] + 1);
  }
  const tone = i => { const f = Math.min(1, fromMouth[wrap(i, N)] / PIT_FADE), v = TARMAC_TONE + (1 - TARMAC_TONE) * f * f * (3 - 2 * f); return [v, v, v]; };

  for (const sd of [0, 1]) {
    const g = sd ? 1 : -1;
    const E = [], MAT = [];
    for (let i = 0; i < N; i++) {
      let c = hw;
      const e = [c], m = [];
      const push = (w, mat) => { c += Math.max(0, w); e.push(c); m.push(mat); };
      const wall = T.wall[sd][i];
      if (T.isBridge[i]) for (let k = 0; k < BANDS; k++) push(0, 'grass');
      else {
        push(T.kerb[sd][i], 'kerb');
        push(T.sausage[sd][i] / 2, 'sausage'); push(T.sausage[sd][i] / 2, 'sausage');
        push(T.runoff[sd][i], T.concrete[sd][i] ? 'concrete' : 'apron');
        push(T.gravelOut[sd][i] > 0 ? T.gravelOut[sd][i] - c : 0, 'gravel');
        if (sd === 0 && T.pitMouth[i] && T.pitOut[i] > 0) { push(0, 'grass'); push(T.pitOut[i] - c, 'road'); push(wall - c, 'grass'); }
        else if (sd === 0 && T.pitOut[i] > 0) { push(T.pitIn[i] - c, T.pitIsland[i] ? 'island' : 'grass'); push(T.pitOut[i] - c, 'pit'); push(wall - c, 'grass'); }
        else { push(wall - c, 'grass'); push(0, 'pit'); push(0, 'grass'); }
        push(Math.min(wall + 15, T.room[sd][i]) - c, 'grass');
      }
      E.push(e); MAT.push(m);
    }

    // pieces per band: one for kerbs and sausage, otherwise by the widest the band ever gets
    const pieces = [];
    for (let k = 0; k < BANDS; k++) {
      let widest = 0;
      for (let i = 0; i < N; i++) widest = Math.max(widest, E[i][k + 1] - E[i][k]);
      pieces.push(k < 3 ? 1 : Math.max(1, Math.ceil(widest / MAX_PIECE)));
    }
    const first = []; let total = 0;
    for (let k = 0; k < BANDS; k++) { first.push(total); total += pieces[k]; }
    total += 1;                                                    // vertices per row

    // vertex rows: position and distance from the centreline
    const ROW = [], DIST = [];
    for (let i = 0; i < N; i++) {
      const row = new Array(total), dist = new Float64Array(total);
      for (let k = 0; k < BANDS; k++) for (let j = 0; j < pieces[k]; j++) {
        const dd = E[i][k] + (E[i][k + 1] - E[i][k]) * j / pieces[k];
        row[first[k] + j] = P(i, g * dd, T.relief(sd, i, dd)); dist[first[k] + j] = dd;
      }
      const last = E[i][BANDS];
      row[total - 1] = P(i, g * last, T.relief(sd, i, last)); dist[total - 1] = last;
      ROW.push(row); DIST.push(dist);
    }
    ROW.push(ROW[0]); DIST.push(DIST[0]);

    for (let k = 0; k < BANDS; k++) for (let j = 0; j < pieces[k]; j++) {
      const v = first[k] + j, n = pieces[k];
      const width = i => (E[wrap(i, N)][k + 1] - E[wrap(i, N)][k]) / n;
      const matOf = L => {
        const a = wrap(L, N), b = wrap(L + 1, N);
        return width(a) > 1e-6 ? MAT[a][k] : width(b) > 1e-6 ? MAT[b][k] : null;
      };
      for (let L = 0; L < N;) {
        const mat = matOf(L);
        if (!mat) { L++; continue; }
        let end = L;
        while (end + 1 < N && matOf(end + 1) === mat) end++;
        const idx = []; for (let q = L; q <= end + 1; q++) idx.push(q);
        const sAt = q => (q < N ? T.s[q] : T.length);
        const vOf = (q, vv) => {
          const d = DIST[q][vv], e0 = E[wrap(q, N)][k], e1 = E[wrap(q, N)][k + 1];
          const t = (d - e0) / ((e1 - e0) || 1);
          if (mat === 'kerb' || mat === 'island') return t;
          if (mat === 'sausage') return (k === 1 ? 0 : 0.5) + 0.5 * t;
          return d / U_SCALE[mat];
        };
        strips(mat).strip(idx, q => ROW[q][v], q => ROW[q][v + 1], q => sAt(q) / U_SCALE[mat], q => vOf(q, v), q => vOf(q, v + 1), mat === 'pit' ? tone : undefined);
        L = end + 1;
      }
    }
  }
}
