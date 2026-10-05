// The start / finish line: gantry over the straight, the painted chequered line and the grid boxes.
//
// The gantry spans the track AND the pit lane: the left tower stands behind the low wall on the garage side of the pit
// lane, the right tower behind the containment wall, so nothing a car can reach is anywhere near a leg. Everything over
// the road is 6.25 m or more above it, so a car, a mirror or a roll hoop can never touch it.
// Frame, in local axes: x along the direction of travel, y up from the road at the centre line, z to the right.
//
// Seen by the cars coming down the straight (the -x face): the start lights under a 22.5 m by 5 m LED screen hung on the truss, sponsor panels either side, and a LAKESIDE crown on top. The back (+x) face carries the
// other face of the same screen and a START / FINISH crown, for the cars leaving and the stands.

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit, sponsorRow, trackPoint, beam } from './meshKit.js';

export const GANTRY_S = 2;          // metres past the start line, the lights hang just before it
export const GANTRY_CLEAR = 7.0;    // underside of the truss above the road
export const GANTRY_LOWEST = 6.25;  // lowest point of anything hanging from it (the lamp housing)
export const TOWER_HALF = 1.2;      // half the tower footprint across the track, metres
const TOWER_BEHIND = 0.8;           // clear space between a wall and the tower, metres

const DECAL = 0.006;
const DEPTH = 2.6, TRUSS_H = 3.0;   // box truss: front to back, bottom chord to top chord
const SCREEN_W = 22.5, SCREEN_H = 5, SCREEN_Y0 = 7.65;   // the LED screen, 9:2; its foot clears the start light pods (top at 7.58 m)

// Where the two towers stand (d of their centres, left negative): behind the pit lane's outer wall on the left and
// behind the containment wall on the right.
export function gantryLegs(T) {
  const i = trackPoint(T, GANTRY_S, 0).i;
  const leftWall = T.pitOut[i] ? T.pitOut[i] + (T.pitGarage[i] ? 2 : 0.5) + 0.3 : T.wall[0][i] + 0.8;
  return [-(leftWall + TOWER_BEHIND + TOWER_HALF), T.wall[1][i] + 0.8 + TOWER_BEHIND + TOWER_HALF];
}

// A crown board: a heavy, slanted display word with a white keyline, chequers at both ends and speed stripes.
function crownTexture(word, sub) {
  const W = 2048, H = 320, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1f27'); bg.addColorStop(1, '#0b0d11');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const sq = 26;
  for (const x0 of [0, W - 4 * sq]) for (let a = 0; a < 4; a++) for (let b = 0; b < Math.ceil(H / sq); b++) {
    x.fillStyle = (a + b) % 2 ? '#f2f2ee' : '#14161a'; x.fillRect(x0 + a * sq, b * sq, sq, sq);
  }
  x.fillStyle = '#ffd21f'; x.fillRect(4 * sq, 0, W - 8 * sq, 10); x.fillRect(4 * sq, H - 10, W - 8 * sq, 10);
  // speed stripes behind the word, slanted like the type
  x.save(); x.beginPath(); x.rect(4 * sq, 10, W - 8 * sq, H - 20); x.clip();
  x.fillStyle = 'rgba(255,210,31,0.13)';
  for (let k = 0; k < 14; k++) { const x0 = 160 + k * 135; x.beginPath(); x.moveTo(x0, H); x.lineTo(x0 + 70, H); x.lineTo(x0 + 160, 0); x.lineTo(x0 + 90, 0); x.fill(); }
  x.restore();
  x.save();
  x.translate(W / 2, H / 2 + (sub ? -18 : 6));
  x.transform(1, 0, -0.22, 1, 0, 0);   // italic by shear, whatever font the device has
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `900 ${sub ? 200 : 230}px Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const tracking = sub ? 18 : 26, letters = [...word];
  const widths = letters.map(ch => x.measureText(ch).width), total = widths.reduce((a, b) => a + b, 0) + tracking * (letters.length - 1);
  let px = -total / 2;
  for (let k = 0; k < letters.length; k++) {
    const cx = px + widths[k] / 2;
    x.lineJoin = 'round';
    x.lineWidth = 16; x.strokeStyle = '#0b0d11'; x.strokeText(letters[k], cx + 8, 8);          // drop shadow
    x.lineWidth = 9; x.strokeStyle = '#f2f2ee'; x.strokeText(letters[k], cx, 0);               // keyline
    const fill = x.createLinearGradient(0, -100, 0, 100);
    fill.addColorStop(0, '#ffe46b'); fill.addColorStop(0.55, '#ffd21f'); fill.addColorStop(1, '#e09a00');
    x.fillStyle = fill; x.fillText(letters[k], cx, 0);
    px += widths[k] + tracking;
  }
  if (sub) {
    x.font = '700 54px "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
    x.fillStyle = '#f2f2ee';
    x.fillText(sub.split('').join(String.fromCharCode(8202)), 0, 128);
  }
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A flat quad facing +x or -x (dir), spanning z0..z1 and y0..y1, reading left to right for a viewer in front of it.
function faceX(kit, key, x, y0, y1, z0, z1, dir, vb = 0, vt = 1, u0 = 0, u1 = 1) {
  if (dir < 0) kit.quad(key, [x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
  else kit.quad(key, [x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], [[u0, vb], [u1, vb], [u1, vt], [u0, vt]]);
}

export function buildGantry(T, sponsorTex) {
  const g = new THREE.Group();
  const c = trackPoint(T, GANTRY_S, 0), i = c.i;
  const roadY = T.groundAt(c.x, c.z, i);
  const [zL, zR] = gantryLegs(T);
  const kit = new Kit(), screens = new Kit();
  const y0 = GANTRY_CLEAR, y1 = GANTRY_CLEAR + TRUSS_H, hx = DEPTH / 2;
  const zA = zL - TOWER_HALF + 0.3, zB = zR + TOWER_HALF - 0.3;   // the truss runs into both towers

  // --- towers: four box-section posts on a concrete plinth, ringed every 2.5 m, X-braced on every face ------------
  const towerTop = y1 + 1.4;
  for (const zc of [zL, zR]) {
    const p = trackPoint(T, GANTRY_S, zc), base = T.groundAt(p.x, p.z, p.i) - roadY;
    const ax = hx + 0.2, az = TOWER_HALF - 0.25;
    kit.column('concrete', DEPTH + 1.6, TOWER_HALF * 2 + 1.0, base - 0.6, base + 1.1, 0, zc, 0, 2);
    kit.column('concrete', DEPTH + 1.9, TOWER_HALF * 2 + 1.3, base + 1.1, base + 1.25, 0, zc, 0, 2);   // plinth lip
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.column('steel', 0.42, 0.42, base + 1.1, towerTop, sx * ax, zc + sz * az);
    const rings = []; for (let y = base + 1.1; y < towerTop - 0.5; y += 2.5) rings.push(y);
    rings.push(towerTop - 0.1);
    for (const y of rings) {
      for (const sx of [-1, 1]) kit.box('steel', 0.2, 0.2, az * 2, sx * ax, y, zc);
      for (const sz of [-1, 1]) kit.box('steel', ax * 2, 0.2, 0.2, 0, y, zc + sz * az);
    }
    for (let r = 0; r < rings.length - 1; r++) {
      const ya = rings[r], yb = rings[r + 1];
      for (const sx of [-1, 1]) { beam(kit, 'steel', [sx * ax, ya, zc - az], [sx * ax, yb, zc + az], 0.12); beam(kit, 'steel', [sx * ax, ya, zc + az], [sx * ax, yb, zc - az], 0.12); }
      for (const sz of [-1, 1]) { beam(kit, 'steel', [-ax, ya, zc + sz * az], [ax, yb, zc + sz * az], 0.12); beam(kit, 'steel', [ax, ya, zc + sz * az], [-ax, yb, zc + sz * az], 0.12); }
    }
    kit.box('housing', ax * 2 + 0.6, 0.35, az * 2 + 0.6, 0, towerTop + 0.1, zc);    // cap
    // sponsor wrap round the foot of each tower, all four sides
    const wy0 = base + 1.35, wy1 = base + 4.1, k = zc < 0 ? 0 : 1;
    const [b0, t0] = sponsorRow(0), [b1, t1] = sponsorRow(tex.MODERN_SPONSORS[(k * 5 + 3) % tex.MODERN_SPONSORS.length]);
    faceX(kit, 'sponsor', -ax - 0.23, wy0, wy1, zc - az - 0.2, zc + az + 0.2, -1, b0, t0);
    faceX(kit, 'sponsor', ax + 0.23, wy0, wy1, zc - az - 0.2, zc + az + 0.2, 1, b1, t1);
    const sg = zc < 0 ? 1 : -1, zf = zc + sg * (az + 0.23), e = ax + 0.2;   // the face towards the track, facing sg * z
    const uv = [[0, b1], [1, b1], [1, t1], [0, t1]];
    if (sg > 0) kit.quad('sponsor', [-e, wy0, zf], [e, wy0, zf], [e, wy1, zf], [-e, wy1, zf], uv);
    else kit.quad('sponsor', [e, wy0, zf], [-e, wy0, zf], [-e, wy1, zf], [e, wy1, zf], uv);
    // a maintenance ladder up the back of the tower, and a timing cabinet at its foot
    for (const lz of [-0.25, 0.25]) kit.column('steel', 0.05, 0.05, base + 1.25, towerTop, ax + 0.45, zc + lz);
    for (let y = base + 1.5; y < towerTop; y += 0.35) kit.box('steel', 0.04, 0.04, 0.5, ax + 0.45, y, zc);
    kit.box('housing', 0.9, 1.4, 0.6, -ax - 0.2, base + 1.95, zc - sg * (az + 0.5));
  }

  // --- the box truss: four chords, verticals, diagonals on both faces and on top -------------------------------------
  for (const sx of [-1, 1]) for (const y of [y0, y1]) kit.box('steel', 0.3, 0.3, zB - zA, sx * hx, y, (zA + zB) / 2);
  const bays = Math.round((zB - zA) / 2.2), bay = (zB - zA) / bays;
  for (let k = 0; k <= bays; k++) {
    const z = zA + k * bay;
    for (const sx of [-1, 1]) kit.column('steel', 0.16, 0.16, y0, y1, sx * hx, z);
    kit.box('steel', DEPTH, 0.14, 0.14, 0, y1, z);
    kit.box('steel', DEPTH, 0.14, 0.14, 0, y0, z);
    if (k < bays) {
      for (const sx of [-1, 1]) beam(kit, 'steel', [sx * hx, k % 2 ? y0 : y1, z], [sx * hx, k % 2 ? y1 : y0, z + bay], 0.12);
      beam(kit, 'steel', [-hx, y1, z], [hx, y1, z + bay], 0.1);
      beam(kit, 'steel', [-hx, y0, z + bay], [hx, y0, z], 0.1);
    }
  }
  // catwalk grating along the top with a handrail on the back edge
  kit.box('grate', DEPTH - 0.6, 0.06, zB - zA - 1, 0, y1 + 0.2, (zA + zB) / 2);
  for (let z = zA + 0.5; z <= zB - 0.4; z += 2.2) kit.column('steel', 0.05, 0.05, y1 + 0.2, y1 + 1.25, hx - 0.15, z);
  kit.box('steel', 0.06, 0.06, zB - zA - 1, hx - 0.15, y1 + 1.25, (zA + zB) / 2);

  // --- fascia: dark cladding on both faces, sponsor panels either side of the LED screen -------------------------------
  const fy0 = y0 + 0.35, fy1 = y1 - 0.35;
  const rz0 = -SCREEN_W / 2, rz1 = SCREEN_W / 2;
  for (const dir of [-1, 1]) {
    const fx = dir * (hx + 0.17);
    kit.box('housing', 0.12, fy1 - fy0, zB - zA - 0.6, dir * (hx + 0.08), (fy0 + fy1) / 2, (zA + zB) / 2);
    // sponsor panels out to the screen's edges, as many as fit at a 3:1 board shape
    let n = 0;
    for (const [za, zb] of [[zA + 0.8, rz0 - 0.6], [rz1 + 0.6, zB - 0.8]]) {
      const len = zb - za, h = fy1 - fy0 - 0.3, count = Math.max(1, Math.round(len / (h * 3.2))), w = len / count;
      for (let q = 0; q < count; q++, n++) {
        const [b0, t0] = sponsorRow(tex.MODERN_SPONSORS[(n * 3 + (dir > 0 ? 5 : 0)) % tex.MODERN_SPONSORS.length]);
        faceX(kit, 'sponsor', fx, fy0 + 0.15, fy1 - 0.15, za + q * w + 0.15, za + (q + 1) * w - 0.15, dir, b0, t0);
      }
    }
  }

  // --- LED screen hung on both faces of the truss, 22.5 m by 5 m, centred over the track. main.js draws onto
  // screenMaterial (see gantryScreen.js); it stays dark until a map is assigned. A thin dark frame sits behind each face
  // and a solid block carries the part that stands above the truss; the faces are 6 cm proud of the frame. ------------
  const sy0 = SCREEN_Y0, sy1 = SCREEN_Y0 + SCREEN_H, slabTop = sy1 + 0.15, fw = SCREEN_W + 0.3, fxr = hx + 0.14;
  for (const dir of [-1, 1]) {
    kit.box('housing', 0.08, y1 - sy0 + 0.15, fw, dir * fxr, (y1 + sy0 - 0.15) / 2, 0);
    faceX(screens, 'led', dir * (fxr + 0.06), sy0, sy1, -SCREEN_W / 2, SCREEN_W / 2, dir);
  }
  kit.box('housing', fxr * 2, slabTop - y1, fw, 0, (y1 + slabTop) / 2, 0);

  // --- crowns on top: LAKESIDE to the cars arriving, START / FINISH to the cars leaving, above the screen ------------
  const cw = 17, ch = cw * 320 / 2048, cy0 = slabTop + 0.35, cy1 = cy0 + ch;
  for (const z of [-cw / 2 + 1.5, -cw / 6, cw / 6, cw / 2 - 1.5]) {
    kit.column('steel', 0.2, 0.2, slabTop, cy0 + 0.2, -0.35, z);
    beam(kit, 'steel', [-0.35, slabTop, z], [0.6, slabTop + 1.3, z], 0.1);
  }
  kit.box('housing', 0.4, ch + 0.3, cw + 0.3, -0.15, (cy0 + cy1) / 2, 0);
  kit.box('trim', 0.42, 0.08, cw + 0.34, -0.15, cy1 + 0.17, 0);
  faceX(kit, 'crownFront', -0.36, cy0, cy1, -cw / 2, cw / 2, -1);
  faceX(kit, 'crownBack', 0.06, cy0, cy1, -cw / 2, cw / 2, 1);

  // --- start lights: five pods under the truss on the grid side, a bar of red lamps each -----------------------------
  const hy = 7.0;
  kit.box('housing', 0.7, 0.3, 11.2, -0.9, y0 - 0.12, 0);
  const lamp = new THREE.CircleGeometry(0.22, 24);
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const z = (k - 2) * 2.1;
    kit.box('housing', 0.5, 1.15, 1.5, -1.2, hy, z);
    kit.box('steel', 0.1, y0 - hy - 0.5, 0.1, -1.0, (hy + 0.55 + y0) / 2, z);
    const pair = [];
    for (const y of [-0.28, 0.28]) {
      const m = new THREE.Mesh(lamp, new THREE.MeshStandardMaterial({ color: 0x5a0f0f, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.4 }));
      m.position.set(-1.5, hy + y, z);
      m.rotation.y = -Math.PI / 2;
      g.add(m);
      pair.push(m);
      kit.box('housing', 0.16, 0.04, 0.54, -1.58, hy + y + 0.25, z);   // visor
    }
    lights.push(pair);
  }
  // TV camera pods on the front chord, aimed down the straight
  for (const z of [-11, 11]) { kit.box('housing', 0.7, 0.5, 0.5, -hx - 0.5, y0 + 0.4, z); kit.box('housing', 0.3, 0.3, 0.3, -hx - 1.0, y0 + 0.4, z); }

  // --- materials -----------------------------------------------------------------------------------------------------
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.5, metalness: 0.6 });
  const mats = {
    steel,
    housing: new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.55, metalness: 0.2 }),
    grate: new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.7, metalness: 0.5 }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.92 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xffd21f, emissive: 0xffd21f, emissiveIntensity: 0.25, roughness: 0.4 }),
    crownFront: new THREE.MeshStandardMaterial({ map: crownTexture('LAKESIDE', 'S T A R T  /  F I N I S H'), roughness: 0.45 }),
    crownBack: new THREE.MeshStandardMaterial({ map: crownTexture('FINISH', null), roughness: 0.45 }),
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.48 }),
  };
  for (const k of ['steel', 'grate', 'concrete']) mats[k].userData.wet = 'surface';
  const body = kit.build(mats);
  body.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  g.add(body);

  // the LED screen: one mesh per face on one material, dark until main.js gives it the canvas
  const screenMaterial = new THREE.MeshBasicMaterial({ color: 0x08090b, toneMapped: false });
  const ribbons = screens.build({ led: screenMaterial });
  ribbons.traverse(o => { if (o.isMesh) o.userData.debug = 'building'; });
  g.add(ribbons);

  g.userData.lights = lights;
  g.userData.screenMaterial = screenMaterial;
  g.userData.bounds = { s: GANTRY_S, span: Math.max(-zA, zB), legs: [zL, zR], clear: GANTRY_LOWEST };
  g.position.set(c.x, roadY, c.z);
  g.rotation.y = -Math.atan2(c.tz, c.tx);
  for (const l of lights) for (const m of l) m.castShadow = false;
  return g;
}

// ---------------------------------------------------------------------------
// Paint: the chequered start line and the grid boxes, as flat decals following the road.

class Paint {
  constructor(T) { this.T = T; this.pos = []; this.uv = []; this.ind = []; }
  // the rectangle s0..s1 along, d0..d1 across (d positive right), cut every metre along the road. uv in metres / tile.
  rect(s0, s1, d0, d1, tile = 0) {
    const { T } = this;
    const steps = Math.max(1, Math.ceil((s1 - s0) / 1.0));
    for (let k = 0; k <= steps; k++) {
      const s = s0 + (s1 - s0) * k / steps;
      for (const d of [d0, d1]) {
        const p = trackPoint(T, s, d);
        this.pos.push(p.x, T.groundAt(p.x, p.z, p.i) + DECAL, p.z);
        this.uv.push(tile ? (d - d0) / tile : 0, tile ? (s - s0) / tile : 0);
      }
    }
    const base = this.pos.length / 3 - (steps + 1) * 2;
    for (let k = 0; k < steps; k++) {
      const a = base + k * 2;
      this.ind.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  geometry() {
    // indices were built for the winding of a quad whose first edge runs across; flip any triangle facing down
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const idx = this.ind.slice(), p = this.pos;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
      if (uz * vx - ux * vz < 0) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

const off = f => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f * 2 });

// The painted start line (a 0.9 m chequered band, edge to edge) and the grid: 12 boxes, front line plus two side lines,
// staggered left and right 8 m apart on the same slots the cars are placed on.
export function buildStartPaint(T) {
  const g = new THREE.Group(), hw = T.halfWidth;
  const line = new Paint(T), cheq = new Paint(T);
  cheq.rect(0, 0.9, -hw, hw, 0.9);
  for (let slot = 0; slot < 12; slot++) {
    const s = -10 - slot * 8, d = (slot % 2 ? 1 : -1) * 3, w = 1.15;
    line.rect(s - 0.16, s, d - w, d + w);                  // front bar
    line.rect(s - 5.6, s, d - w, d - w + 0.14);            // side bars
    line.rect(s - 5.6, s, d + w - 0.14, d + w);
    line.rect(s - 5.6, s - 5.44, d - w, d + w);            // closing bar behind
  }
  const a = new THREE.Mesh(line.geometry(), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, ...off(-3) }));
  const b = new THREE.Mesh(cheq.geometry(), new THREE.MeshStandardMaterial({ map: tex.chequerTexture(), roughness: 0.6, ...off(-4) }));
  a.userData.debug = b.userData.debug = 'line';
  a.receiveShadow = b.receiveShadow = true;
  g.add(a, b);
  return g;
}
