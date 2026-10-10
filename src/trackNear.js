// Spatial lookups on the track for the venue planners (stands, extras, masts, marshal posts, props). The planners ask "is this
// point within r metres of a barrier line" and "how far behind the containment wall is this point" thousands of times, and the
// plain loops over every barrier segment and every track sample cost several seconds at start-up. The grids are built once per
// track, on first use, and kept on the track object (T.nearGrid). Every answer is exactly what the plain loop gives: the grid only
// decides which candidates are looked at, the arithmetic on them is the same.

const SEG_CELL = 24, SAMPLE_CELL = 16, WALL_CELL = 16;
const key = (gx, gz) => gx * 65536 + gz;

function build(T) {
  // barrier segments: each is listed in every cell its bounding box touches
  const segCells = new Map();
  T.segs.forEach((sg, n) => {
    const x0 = Math.floor(Math.min(sg.ax, sg.bx) / SEG_CELL), x1 = Math.floor(Math.max(sg.ax, sg.bx) / SEG_CELL);
    const z0 = Math.floor(Math.min(sg.az, sg.bz) / SEG_CELL), z1 = Math.floor(Math.max(sg.az, sg.bz) / SEG_CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = key(gx, gz); let l = segCells.get(k); if (!l) segCells.set(k, l = []); l.push(n);
    }
  });
  // track samples, and the points of the two walls the clearance is measured to (j * 2 + side)
  const sampleCells = new Map(), wallCells = new Map();
  let wmax = 0;
  const add = (map, cell, x, z, v) => { const k = key(Math.floor(x / cell), Math.floor(z / cell)); let l = map.get(k); if (!l) map.set(k, l = []); l.push(v); };
  for (let j = 0; j < T.N; j++) {
    add(sampleCells, SAMPLE_CELL, T.x[j], T.z[j], j);
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd ? 1 : -1, w = Math.max(T.wall[sd][j], sd === 0 && T.pitOut[j] ? T.pitOut[j] + 2 : 0);
      if (w > wmax) wmax = w;
      add(wallCells, WALL_CELL, T.x[j] + T.nx[j] * sg * w, T.z[j] + T.nz[j] * sg * w, j * 2 + sd);
    }
  }
  return { segCells, sampleCells, wallCells, wmax };
}

const grid = T => T.nearGrid || (T.nearGrid = build(T));

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

// Is any barrier segment closer than r metres to (x, z)?
export function nearBarrier(T, x, z, r) {
  const { segCells } = grid(T), segs = T.segs;
  const x0 = Math.floor((x - r) / SEG_CELL), x1 = Math.floor((x + r) / SEG_CELL), z0 = Math.floor((z - r) / SEG_CELL), z1 = Math.floor((z + r) / SEG_CELL);
  for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
    const l = segCells.get(key(gx, gz));
    if (l) for (let n = 0; n < l.length; n++) if (segDist(x, z, segs[l[n]]) < r) return true;
  }
  return false;
}

// Signed distance from a point to the nearest containment wall (or the pit lane's outer edge) of any part of the circuit:
// positive behind the wall, negative between the wall and the track. Samples further than 200 m from the point do not count.
export function wallClearance(T, x, z, ignoreBridge = false) {
  const G = grid(T), { sampleCells, wallCells } = G;
  // the nearest track sample (the lowest index on a tie), searched outwards until the nearest found is inside the searched square
  let nearest = -1, nq = Infinity;
  for (let r = SAMPLE_CELL; ; r *= 2) {
    const x0 = Math.floor((x - r) / SAMPLE_CELL), x1 = Math.floor((x + r) / SAMPLE_CELL), z0 = Math.floor((z - r) / SAMPLE_CELL), z1 = Math.floor((z + r) / SAMPLE_CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const l = sampleCells.get(key(gx, gz));
      if (!l) continue;
      for (let n = 0; n < l.length; n++) {
        const j = l[n];
        if (ignoreBridge && T.isBridge[j]) continue;
        const dx = x - T.x[j], dz = z - T.z[j], q = dx * dx + dz * dz;
        if (q < nq || (q === nq && j < nearest)) { nq = q; nearest = j; }
      }
    }
    if (nq <= r * r || r > 8192) break;
  }
  // the nearest wall point among the samples within 200 m, searched outwards the same way
  let best = Infinity;
  const rMax = 200 + G.wmax + 1;
  for (let r = WALL_CELL * 2; ; r *= 2) {
    best = Infinity;
    const x0 = Math.floor((x - r) / WALL_CELL), x1 = Math.floor((x + r) / WALL_CELL), z0 = Math.floor((z - r) / WALL_CELL), z1 = Math.floor((z + r) / WALL_CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const l = wallCells.get(key(gx, gz));
      if (!l) continue;
      for (let n = 0; n < l.length; n++) {
        const j = l[n] >> 1, sd = l[n] & 1;
        if (ignoreBridge && T.isBridge[j]) continue;
        const dx = x - T.x[j], dz = z - T.z[j];
        if (dx * dx + dz * dz > 200 * 200) continue;
        const sg = sd ? 1 : -1, w = Math.max(T.wall[sd][j], sd === 0 && T.pitOut[j] ? T.pitOut[j] + 2 : 0);
        const wx = dx - T.nx[j] * sg * w, wz = dz - T.nz[j] * sg * w, d = wx * wx + wz * wz;
        if (d < best) best = d;
      }
    }
    if (best <= r * r || r >= rMax) break;
  }
  const j = nearest, dx = x - T.x[j], dz = z - T.z[j], lat = dx * T.nx[j] + dz * T.nz[j], sd = lat < 0 ? 0 : 1;
  const w = Math.max(T.wall[sd][j], sd === 0 && T.pitOut[j] ? T.pitOut[j] + 2 : 0);
  return Math.abs(lat) < w ? -Math.sqrt(best) : Math.sqrt(best);
}
