// Smooth body surfaces for the car classes other than the GT: a body built as a loft (a row of cross-sections along the car,
// joined into one skin), a greenhouse the same way, and glass patches that lie on the greenhouse. All numbers are metres in the
// car's own axes: +x forward, +y up, +z right.

import * as THREE from 'three';

// A smooth curve through [x, y] points given in rising x (a cubic through the points that does not overshoot between them),
// flat beyond the ends.
export function curve(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// Stations along x from a to b: even steps, and a finer run at each end where the shape turns fastest.
// `edges` are x positions where the shape has a sharp step (the ends of a wheel arch): each gets a few stations close to it on both sides.
export function stations(a, b, step = 0.02, fine = 0.12, fineStep = 0.008, edges = []) {
  const out = new Set([a, b]);
  for (const e of edges) for (const d of [0, 0.003, 0.009, 0.02]) { out.add(+(e + d).toFixed(5)); out.add(+(e - d).toFixed(5)); }
  for (let x = a; x <= b + 1e-9; x += step) out.add(+x.toFixed(5));
  for (let d = 0; d <= fine; d += fineStep) { out.add(+(a + d).toFixed(5)); out.add(+(b - d).toFixed(5)); }
  return [...out].filter(v => v >= a - 1e-9 && v <= b + 1e-9).sort((p, q) => p - q);
}

const arc = (cz, cy, r, a0, a1, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
};

// The cross-section of a body at one station, as a closed ring of [z, y] points running anticlockwise seen from +x (the right
// side is climbed first). p: y0 bottom, ys shoulder height at the side, yc height on the centre line, w half width, rt top corner
// radius, rb bottom corner radius, z0 half width of the flat centre of the deck. The deck falls (or rises) from the centre
// height to the shoulder height between z0 and the corner.
export function bodyRing(p) {
  const { y0, ys, yc, w } = p;
  const tall = Math.max(0.02, ys - y0);
  const rt = Math.min(p.rt, w * 0.6, tall * 0.5), rb = Math.min(p.rb, w * 0.6, tall * 0.4);
  const z0 = Math.min(p.z0, w - rt - 0.01);
  const ring = [];
  // bottom right corner up to the side
  ring.push(...arc(w - rb, y0 + rb, rb, -Math.PI / 2, 0, 4));
  // top right corner
  ring.push(...arc(w - rt, ys - rt, rt, 0, Math.PI / 2, 5));
  // the deck, right to left
  const zt = w - rt, n = 14;
  for (let i = 1; i < n; i++) {
    const z = zt * (1 - 2 * i / n), t = smooth((Math.abs(z) - z0) / Math.max(1e-3, zt - z0));
    ring.push([z, yc + (ys - yc) * t]);
  }
  ring.push(...arc(-(w - rt), ys - rt, rt, Math.PI / 2, Math.PI, 5));
  ring.push(...arc(-(w - rb), y0 + rb, rb, Math.PI, Math.PI * 1.5, 4));
  return ring;
}

// The greenhouse's cross-section: a trapezoid leaning in, a rounded roof corner and a slightly arched roof. p: yB the base, yR
// the roof, wb the half width at the base, wr the half width of the flat roof, crown how much the roof falls at its edge.
// The ring runs: right base, up the right side (SIDE segments), round the corner (CORNER), across the roof (ROOF), and down the left.
export const CAB = { SIDE: 8, CORNER: 4, ROOF: 12 };
export function cabRing(p) {
  const { yB, yR, wb, wr } = p;
  const h = Math.max(1e-3, yR - yB);
  const rr = Math.min(0.1, h * 0.6, wr * 0.6);
  const wk = wr + rr;                                        // where the side line meets the roof line
  const ring = [];
  const sideAt = t => [wb + (wk - wb) * t, yB + h * t];
  const tS = Math.max(0, 1 - rr / h);                         // the side line ends where the corner starts
  for (let i = 0; i <= CAB.SIDE; i++) ring.push(sideAt(tS * i / CAB.SIDE));
  const a = sideAt(tS), k = [wk, yR], r = [wr, yR - 0];
  for (let i = 1; i <= CAB.CORNER; i++) {                     // quadratic curve from the side to the roof edge
    const u = i / CAB.CORNER, v = 1 - u;
    ring.push([v * v * a[0] + 2 * v * u * k[0] + u * u * r[0], v * v * a[1] + 2 * v * u * k[1] + u * u * r[1]]);
  }
  const mirror = ring.slice().reverse().map(([z, y]) => [-z, y]);
  const roof = [];
  for (let i = 1; i < CAB.ROOF; i++) { const z = wr * (1 - 2 * i / CAB.ROOF); roof.push([z, yR - (p.crown || 0) * (z / wr) * (z / wr)]); }
  return [...ring, ...roof, ...mirror];
}

// Join rings (arrays of [z, y], all the same length) at the given x stations into one closed skin with flat end caps.
export function loft(xs, ringAt) {
  const rings = xs.map(ringAt), n = rings[0].length, m = xs.length;
  const pos = [], idx = [];
  for (let i = 0; i < m; i++) for (const [z, y] of rings[i]) pos.push(xs[i], y, z);
  const quads = [];
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n, c = (i + 1) * n + j, d = (i + 1) * n + (j + 1) % n;
    quads.push([a, b, c, d]);
  }
  // orientation: every face's normal should point away from its ring's middle
  let score = 0;
  const P = i => new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
  for (const [a, b, c] of quads) {
    const pa = P(a), nrm = P(b).sub(pa).cross(P(c).sub(pa));
    const mid = rings[Math.floor(a / n)].reduce((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n], [0, 0]);
    score += nrm.y * (pa.y - mid[1]) + nrm.z * (pa.z - mid[0]);
  }
  const flip = score < 0;
  for (const [a, b, c, d] of quads) {
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  // end caps: a fan round the middle, with their own vertices so the faces stay flat
  for (const [i, dir] of [[0, -1], [m - 1, 1]]) {
    const r = rings[i], cz = r.reduce((s, q) => s + q[0], 0) / n, cy = r.reduce((s, q) => s + q[1], 0) / n;
    const base = pos.length / 3;
    pos.push(xs[i], cy, cz);
    for (const [z, y] of r) pos.push(xs[i], y, z);
    for (let j = 0; j < n; j++) {
      const a = base, b = base + 1 + j, c = base + 1 + (j + 1) % n;
      const nx = (P2(pos, b).sub(P2(pos, a))).cross(P2(pos, c).sub(P2(pos, a))).x;
      if (nx * dir > 0) idx.push(a, b, c); else idx.push(a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const P2 = (pos, i) => new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);

// A patch of glass lying on the greenhouse: f(u, v) -> [x, y, z] for u, v in 0..1, on an nu by nv grid. `inside` is a point inside
// the car, so the faces can be turned outwards.
export function patch(nu, nv, f, inside) {
  const pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...f(i / nu, j / nv));
  const quads = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; quads.push([a, a + 1, a + nu + 1, a + nu + 2]); }
  let score = 0;
  for (const [a, b, c] of quads) {
    const pa = P2(pos, a), nrm = P2(pos, b).sub(pa).cross(P2(pos, c).sub(pa));
    score += nrm.dot(pa.clone().sub(new THREE.Vector3(...inside)));
  }
  for (const [a, b, c, d] of quads) { if (score < 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Several geometries as one (positions, normals and indices joined).
export function merge(geos) {
  const pos = [], nor = [], idx = [];
  for (const g of geos) {
    const base = pos.length / 3, p = g.getAttribute('position'), n = g.getAttribute('normal'), ix = g.getIndex();
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

// A point on a greenhouse ring at fractional index jf (the ring's points joined by straight lines), pushed out along the skin by `lift`.
export function ringPoint(ring, jf, lift = 0) {
  const n = ring.length, j0 = Math.floor(jf), t = jf - j0, a = ring[j0 % n], b = ring[(j0 + 1) % n];
  let tz = b[0] - a[0], ty = b[1] - a[1];
  const m = Math.hypot(tz, ty) || 1; tz /= m; ty /= m;
  return [a[0] + (b[0] - a[0]) * t + ty * lift, a[1] + (b[1] - a[1]) * t - tz * lift];       // outward is the tangent turned a quarter clockwise
}
