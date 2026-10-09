// Contact between two cars seen from above. Each car is a rounded box: a rectangle shrunk by RADIUS on every side,
// then grown back by RADIUS, so corners are round and a nose never catches on a corner.
//
// carContact(a, b, length, width) returns null, or { nx, nz, depth, px, pz } where (nx, nz) is the unit normal pointing
// from b into a, depth is how far they overlap (m) and (px, pz) is the middle of the overlap, where the force acts.
// a and b are { x, z, heading }. Pure maths, no THREE, so the browser, the physics and the tests share it.

export const RADIUS = 0.25;

function box(c, hl, hw, out) {
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  // counter-clockwise in the x-z plane
  const t = [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]];
  for (let i = 0; i < 4; i++) {
    const [lx, ly] = t[i];
    out[i] = [c.x + lx * ch - ly * sh, c.z + lx * sh + ly * ch];
  }
  return out;
}

function segDist(px, pz, ax, az, bx, bz, hit) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t, qz = az + dz * t;
  hit.qx = qx; hit.qz = qz;
  return Math.hypot(px - qx, pz - qz);
}

// middle of the overlap of two convex counter-clockwise polygons (Sutherland-Hodgman), or null
function overlapCentre(subject, clip) {
  let poly = subject;
  for (let i = 0; i < clip.length && poly.length; i++) {
    const [ax, az] = clip[i], [bx, bz] = clip[(i + 1) % clip.length];
    const side = p => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax);
    const next = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j], q = poly[(j + 1) % poly.length], sp = side(p), sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); next.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
    }
    poly = next;
  }
  if (!poly.length) return null;
  let cx = 0, cz = 0, area = 0;
  for (let j = 0; j < poly.length; j++) {
    const p = poly[j], q = poly[(j + 1) % poly.length], w = p[0] * q[1] - q[0] * p[1];
    area += w; cx += (p[0] + q[0]) * w; cz += (p[1] + q[1]) * w;
  }
  if (Math.abs(area) < 1e-6) {
    cx = 0; cz = 0;
    for (const p of poly) { cx += p[0]; cz += p[1]; }
    return [cx / poly.length, cz / poly.length];
  }
  return [cx / (3 * area), cz / (3 * area)];
}

// lengthB and widthB are b's own size when it is another class (src/cars.js); they default to a's, the same car.
export function carContact(a, b, length, width, lengthB = length, widthB = width) {
  const dxc = a.x - b.x, dzc = a.z - b.z;
  // the largest car's diagonal bounds both (the early out only needs to be generous)
  const L = Math.max(length, lengthB), W = Math.max(width, widthB);
  if (dxc * dxc + dzc * dzc > L * L + W * W) return null;
  const A = box(a, length / 2 - RADIUS, width / 2 - RADIUS, []), B = box(b, lengthB / 2 - RADIUS, widthB / 2 - RADIUS, []);

  // separating axis test on the shrunk rectangles
  let best = Infinity, bnx = 0, bnz = 0, overlapping = true;
  for (const c of [a, b]) {
    const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    for (const [ux, uz] of [[ch, sh], [-sh, ch]]) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < 4; i++) {
        const pa = A[i][0] * ux + A[i][1] * uz, pb = B[i][0] * ux + B[i][1] * uz;
        if (pa < a0) a0 = pa; if (pa > a1) a1 = pa; if (pb < b0) b0 = pb; if (pb > b1) b1 = pb;
      }
      const ov = Math.min(a1, b1) - Math.max(a0, b0);
      if (ov <= 0) { overlapping = false; break; }
      if (ov < best) { best = ov; const s = (dxc * ux + dzc * uz) >= 0 ? 1 : -1; bnx = ux * s; bnz = uz * s; }
    }
    if (!overlapping) break;
  }

  let nx, nz, depth, mid = null;
  if (overlapping) {
    nx = bnx; nz = bnz; depth = best + 2 * RADIUS;
  } else {
    // apart by their cores: the closest pair of points on the two rectangles
    let d = Infinity, pa = null, pb = null; const h = {};
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const k1 = segDist(A[i][0], A[i][1], B[j][0], B[j][1], B[(j + 1) % 4][0], B[(j + 1) % 4][1], h);
        if (k1 < d) { d = k1; pa = [A[i][0], A[i][1]]; pb = [h.qx, h.qz]; }
        const k2 = segDist(B[i][0], B[i][1], A[j][0], A[j][1], A[(j + 1) % 4][0], A[(j + 1) % 4][1], h);
        if (k2 < d) { d = k2; pb = [B[i][0], B[i][1]]; pa = [h.qx, h.qz]; }
      }
    }
    if (d >= 2 * RADIUS) return null;
    depth = 2 * RADIUS - d;
    if (d > 1e-6) { nx = (pa[0] - pb[0]) / d; nz = (pa[1] - pb[1]) / d; }
    else { const l = Math.hypot(dxc, dzc) || 1; nx = dxc / l; nz = dzc / l; }
    mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  }
  // where the force acts: the middle of the overlap of the full outlines
  const fa = box(a, length / 2, width / 2, []), fb = box(b, lengthB / 2, widthB / 2, []);
  const c = overlapCentre(fa, fb) || mid || [(a.x + b.x) / 2, (a.z + b.z) / 2];
  return { nx, nz, depth, px: c[0], pz: c[1] };
}
