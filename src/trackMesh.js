// The circuit itself: tarmac, kerbs, run-off, gravel, the pit road, the
// placed barrier sections, catch fences, boards and signs, the bridge and the
// start gantry. Positions all come from track.js (and corners.js through it);
// this file only draws them. Scenery away from the track lives in scenery.js.
//
// Every mesh is tagged with a debug category (mesh.userData.debug) so the
// top-down debug view can colour it.

import * as THREE from 'three';
import { wrap, BARRIER } from './track.js';
import * as tex from './textures.js';
import { buildGroundRibbon, buildEntryRoad } from './groundRibbon.js';
import { buildGantry, buildStartPaint } from './gantry.js';
import { buildBridge } from './bridge.js';
import { meadowMaterial } from './scenery.js';
import { garageBay } from './pitBuilding.js';
import { fenceOpenings } from './pitDressing.js';
import { Kit } from './meshKit.js';

const FENCE_HEIGHT = 4;       // catch fence height, metres
const ROAD_TIGHT = 80;       // metres: a cambered bend tighter than this gets four road strips across, not two
const ROAD_TWIST = 0.003;    // ...and so does a stretch where the camber changes faster than this per metre (it twists the road)
const DECAL = 0.006;          // paint sits this far above the surface, drawn with polygonOffset so it never fights
const POWERMEDIA_SHARE = 0.15;   // share of the sponsor panels that are PowerMedia (the start gantry and bridge banners are always PowerMedia)
const SPONSOR_CHUNK = 9;      // length of one sponsor panel, metres (three 3 m wall units)

// colours for the top-down debug view
export const DEBUG_COLOURS = {
  road: 0x3a3a3a, line: 0xffffff, kerb: 0xe03030, sausage: 0xffcc00, runoff: 0xb8b0a0, rumble: 0xe85d4a,
  gravel: 0xf0b040, grass: 0x4f8f3a, pit: 0x8a5cd6, island: 0xc0a8ff, islandPlain: 0xc0a8ff, tyres: 0xff2020, armco: 0x1e5bff,
  armcoSingle: 0x66ccff, street: 0xffffff, parapet: 0xbbbbbb, pitwall: 0xff55ff, fence: 0xffa000,
  board: 0xffff00, sign: 0x00ffff, building: 0x777777,
};
const tag = (mesh, cat) => { mesh.userData.debug = cat; return mesh; };

export function buildTrackScene(T, ground) {
  const group = new THREE.Group();
  const HW = T.hw;
  // A point at sample i, d metres to the side. Every ground surface takes its height from
  // T.groundAt, so neighbouring bands share their edge vertices exactly and nothing is stacked.
  // `lift` is only for real relief (T.relief) and paint decals (DECAL).
  const P = (i, d, lift = 0) => {
    const e = T.reach ? Math.sign(d) * Math.min(Math.abs(d), T.reach[d < 0 ? 0 : 1][i]) : d;   // never fold on the inside of a bend
    const x = T.x[i] + T.nx[i] * e, z = T.z[i] + T.nz[i] * e;
    return [x, T.groundAt(x, z, i) + lift, z];
  };
  const rel = (sd, i, a) => T.relief(sd, i, a);
  const G = (x, z, i) => T.groundAt(x, z, i);
  const all = [];
  for (let i = 0; i <= T.N; i++) all.push(wrap(i, T.N));
  const sOf = (i, j, idx) => (j === idx.length - 1 && i === idx[0] && j > 0 ? T.length : T.s[i]);
  const off = (factor = -2) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor * 2 });

  const sponsorTex = tex.sharedSponsorAtlas();
  const mat = {
    road: new THREE.MeshStandardMaterial({ map: tex.tarmacTexture(), roughness: 0.9 }),
    line: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, ...off(-3) }),
    kerb: new THREE.MeshStandardMaterial({ map: tex.kerbTexture(), roughness: 0.6, ...off(-2) }),
    sausage: new THREE.MeshStandardMaterial({ map: tex.kerbTexture('#f2c200', '#111111'), roughness: 0.6 }),
    apron: new THREE.MeshStandardMaterial({ map: tex.runoffTexture(), roughness: 0.9, ...off(-2) }),
    concrete: new THREE.MeshStandardMaterial({ map: tex.runwayTexture(), roughness: 0.95, ...off(-2) }),
    rumble: new THREE.MeshStandardMaterial({ map: tex.rumbleTexture(), roughness: 0.85, ...off(-3) }),
    grass: new THREE.MeshStandardMaterial({ map: tex.mownGrassTexture(), roughness: 1 }),
    meadow: meadowMaterial(),
    gravel: new THREE.MeshStandardMaterial({ map: tex.gravelTexture(), roughness: 1, ...off(-2) }),
    gravelEdge: new THREE.MeshStandardMaterial({ color: 0x6e5a3c, roughness: 1, ...off(-3) }),
    pit: new THREE.MeshStandardMaterial({ map: tex.pitAsphaltTexture(), vertexColors: true, roughness: 0.85, ...off(-2) }),
    island: new THREE.MeshStandardMaterial({ map: tex.chevronTexture(), roughness: 0.8, ...off(-2) }),
    islandPlain: new THREE.MeshStandardMaterial({ color: 0x5b5e63, roughness: 0.8, ...off(-2) }),     // the island's grey, past the chevrons
    armco: new THREE.MeshStandardMaterial({ map: tex.armcoTexture(), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0x6b7075, roughness: 0.5, metalness: 0.5 }),
    fencePost: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.5 }),
    wallConcrete: new THREE.MeshStandardMaterial({ map: tex.concreteTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    street: new THREE.MeshStandardMaterial({ map: tex.streetWallTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    sponsor: new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.55, side: THREE.DoubleSide }),
    tyre: new THREE.MeshStandardMaterial({ map: tex.tyreWallTexture(), roughness: 0.85, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, side: THREE.DoubleSide }),
    fence: new THREE.MeshStandardMaterial({ map: tex.fenceTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.6 }),
    attenuator: new THREE.MeshStandardMaterial({ map: tex.chevronTexture('#f2c200', '#111111'), roughness: 0.6 }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x2a0606, emissive: 0xff1a1a, emissiveIntensity: 0 }),
  };
  for (const k of ['road', 'line', 'kerb', 'sausage', 'apron', 'concrete', 'rumble', 'pit', 'island', 'islandPlain', 'attenuator']) mat[k].userData.wet = 'road';   // the weather (src/environment.js) makes these glossy and dark in the rain
  const DEBUG_OF = {
    road: 'road', line: 'line', kerb: 'kerb', sausage: 'sausage', apron: 'runoff', concrete: 'runoff', rumble: 'rumble', grass: 'grass',
    gravel: 'gravel', gravelEdge: 'gravel', pit: 'pit', island: 'island', islandPlain: 'island', armco: 'armco', armcoSingle: 'armcoSingle',
    wallConcrete: 'pitwall', meadow: 'grass', street: 'street', parapet: 'parapet', sponsor: 'tyres', tyre: 'tyres', white: 'tyres',
    fence: 'fence', attenuator: 'pitwall', pitOuter: 'pitwall',
  };

  // --- ground-level surfaces, laid side by side so nothing overlaps -----
  const S = {};
  const strips = name => (S[name] ||= new Strips());

  // the tarmac: where the road is cambered, two points across between the edges (four on a bend tighter than ROAD_TIGHT m or
  // where the camber changes quickly),
  // so the road has no crease from one long quad diagonal; where it is level, the edges alone draw it exactly. Each metre is
  // stitched from one row to the next whatever their counts (Strips.stitch), so no crack where the count changes.
  const cutsAt = i => {
    if (!T.bank || !T.bank[i]) return 1;
    for (let k = -8; k <= 8; k++) {
      const j = (i + k + T.N) % T.N, twist = Math.abs(T.bank[(j + 1) % T.N] - T.bank[(j - 1 + T.N) % T.N]) / (2 * T.ds);
      if (Math.abs(T.curv[j]) > 1 / ROAD_TIGHT || twist > ROAD_TWIST) return 4;   // a tight bend, or the camber easing in or out quickly
    }
    return 2;
  };
  const fracs = n => Array.from({ length: n + 1 }, (_, k) => -1 + 2 * k / n);
  const rowAt = (i, u) => { const f = fracs(cutsAt(i)); return { f, row: f.map(x => ({ p: P(i, HW[i] * x), uv: [u, HW[i] * x / 8] })) }; };
  for (let k = 0; k < all.length - 1; k++) {
    const i = all[k], j = all[k + 1], A = rowAt(i, sOf(i, k, all) / 8), B = rowAt(j, sOf(j, k + 1, all) / 8);
    strips('road').stitch(A.row, B.row, A.f, B.f);
  }
  for (const g of [-1, 1]) {
    const lineRuns = g < 0 ? runs(T.N, i => !T.pitMouth[i] && !(T.pitEntryZone[i] && !T.pitEntryRunoff[i])) : [all];
    for (const run of lineRuns) strips('line').strip(run, i => P(i, g * (HW[i] - 0.15), DECAL), i => P(i, g * HW[i], DECAL), () => 0, 0, 1);
  }

  // all the ground beside the tarmac, as one ribbon with shared vertices (groundRibbon.js)
  buildGroundRibbon(T, strips, P, G);
  buildEntryRoad(T, strips, G, DECAL);

  // paint on top of it: rumble bands across the concrete apron, dark edges on the gravel
  for (const sd of [0, 1]) {
    const g = sd ? 1 : -1;
    for (const run of runs(T.N, i => T.concrete[sd][i] && T.runoff[sd][i] > 1.8)) {
      const inner = i => HW[i] + T.kerb[sd][i] + T.sausage[sd][i];
      for (const fraction of [1 / 3, 2 / 3]) {
        strips('rumble').strip(run, i => P(i, g * (inner(i) + T.runoff[sd][i] * fraction - 0.275), 0.006),
          i => P(i, g * (inner(i) + T.runoff[sd][i] * fraction + 0.275), 0.006),
          (i, j) => sOf(i, j, run) / 2, 0, 1);
      }
    }
    for (const run of runs(T.N, i => T.gravelOut[sd][i] > 0)) {
      for (const e of [i => T.gravelIn[sd][i], i => T.gravelOut[sd][i] - 0.35]) {
        strips('gravelEdge').strip(run, i => P(i, g * e(i), DECAL), i => P(i, g * (e(i) + 0.35), DECAL), () => 0, 0, 1);
      }
    }
  }

  // a short grass skirt at the edge of the flat ground, down into the terrain
  for (const sd of [0, 1]) {
    const g = sd ? 1 : -1;
    for (const run of runs(T.N, i => !T.isBridge[i] && !(sd === 0 && T.pitEntryZone[i]))) {   // beside the entry road its own run-off carries on
      strips('meadow').strip(run, i => P(i, g * T.wall[sd][i], -1.5), i => P(i, g * T.wall[sd][i]), (i, j) => sOf(i, j, run) / 24, 0, 0.1);
    }
  }

  // pit road lines and boxes (its surface, and the mouth that joins it to the track, are in the ground ribbon)
  for (const run of runs(T.N, i => T.pitLimiter[i] > 0)) {
    strips('line').strip(run, i => P(i, -(T.pitIn[i] + 4), DECAL), i => P(i, -(T.pitIn[i] + 4.15), DECAL), () => 0, 0, 1);
    strips('line').strip(run, i => P(i, -(T.pitOut[i] - 0.15), DECAL), i => P(i, -T.pitOut[i], DECAL), () => 0, 0, 1);
    // pit box outlines in the working lane, 7 m apart
    for (let k = 0; k < run.length - 6; k += 7) {
      const i = run[k];
      crossLine(strips('line'), T, T.s[i], 0.12, -(T.pitIn[i] + 4.2), -(T.pitOut[i] - 0.2));
    }
  }

  // solid white lines down both edges of the pit entry and exit roads (the merge gore is hatched in the ground ribbon)
  for (const run of runs(T.N, i => T.pitOut[i] > 0 && !T.pitLimiter[i] && !T.pitMouth[i])) {
    strips('line').strip(run, i => P(i, -(T.pitIn[i] + 0.2), DECAL), i => P(i, -(T.pitIn[i] + 0.4), DECAL), () => 0, 0, 1);
    strips('line').strip(run, i => P(i, -(T.pitOut[i] - 0.4), DECAL), i => P(i, -(T.pitOut[i] - 0.2), DECAL), () => 0, 0, 1);
  }

  // the pit exit line along the track edge where the merged exit lane runs beside the track: solid, so cars leaving
  // the pits keep to their lane, then dashed (3 m dashes, 3 m gaps) over the last 60 m before the track is back to its normal width
  if (T.pitRange) {
    const end = T.pitRange[1], DASHED = 60;
    const toEnd = i => ((end - T.s[i]) % T.length + T.length) % T.length;
    const exitMouth = i => T.pitMouth[i] && T.pitOut[i] > 0 && toEnd(i) < (T.pitExitClose || 0) + 20;
    const edge = (run) => strips('line').strip(run, i => P(i, -(HW[i] - 0.1), DECAL), i => P(i, -(HW[i] + 0.15), DECAL), () => 0, 0, 1);
    for (const run of runs(T.N, i => exitMouth(i) && toEnd(i) > DASHED)) edge(run);
    for (const run of runs(T.N, i => exitMouth(i) && toEnd(i) <= DASHED && Math.floor(toEnd(i) / 3) % 2 === 0)) if (run.length > 1) edge(run);
  }

  // start line, grid slots, sector and DRS lines, pit limiter lines
  // (the chequered start line and the grid boxes are painted by gantry.js)
  for (const s of T.sectors.slice(1)) crossLine(strips('line'), T, s, 0.3, -HW[Math.round(s / T.ds) % T.N], HW[Math.round(s / T.ds) % T.N]);
  for (const [a] of T.drs) crossLine(strips('line'), T, a, 0.3, -HW[Math.round(a / T.ds) % T.N], HW[Math.round(a / T.ds) % T.N]);
  const lim = runs(T.N, i => T.pitLimiter[i] > 0)[0];
  if (lim) for (const i of [lim[0], lim[lim.length - 1]]) crossLine(strips('line'), T, T.s[i], 0.5, -T.pitIn[i], -T.pitOut[i]);

  // --- barriers, from the placed sections in track.js ------------------
  const posts = [], fencePosts = [];
  for (const b of T.barriers) {
    const pts = b.pts, nrm = inwardNormals(T, b);
    const at = (k, back, y) => [pts[k][0] - nrm[k][0] * back, pts[k][1] + y, pts[k][2] - nrm[k][1] * back];
    const idx = pts.map((_, k) => k), len = cumulative(pts);
    const wall = (name, back, y0, y1, uScale = 4) => strips(name).strip(idx, k => at(k, back, y0), k => at(k, back, y1), k => len[k] / uScale, 0, 1);
    const cap = (name, b0, b1, y) => strips(name).strip(idx, k => at(k, b0, y), k => at(k, b1, y), () => 0, 0, 1);
    // a tyre block is closed at both ends: the cross-section at each end, from the face back through `stations` ([back, top] pairs,
    // the bottom at y0), is filled, so the run has no open end to see through
    const closeEnds = (name, y0, stations) => {
      for (const k of [0, idx.length - 1]) strips(name).strip(stations.map((_, j) => j), j => at(k, stations[j][0], y0), j => at(k, stations[j][0], stations[j][1]), () => 0, 0, 1);
    };

    if (b.type === BARRIER.TYRES) {
      // impact zone: conveyor-faced tyre wall, double armco 1.2 m behind, catch fence 2 m behind that
      // sponsored tyre wall: conveyor-belt face with bolt heads, a sponsor wrap, a rounded top edge. The armco that
      // used to stand behind it is gone from view (the wall itself is what a car meets).
      wall('tyre', 0, 0.1, 1.78); strips('tyre').strip(idx, k => at(k, 0, 1.78), k => at(k, 0.12, 1.9), k => len[k] / 4, 0.93, 1); cap('tyre', 0.12, 1.2, 1.9);
      wall('tyre', 1.2, 0.1, 1.9); closeEnds('tyre', 0.1, [[0, 1.78], [0.12, 1.9], [1.2, 1.9]]);     // the back of the block and its ends
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0.03, 0.45, 1.45, b.side);
      wall('white', 0.03, 1.6, 1.78);
      if (b.fence) {
        strips('fence').strip(idx, k => at(k, 3.3, 0.2), k => at(k, 3.3, FENCE_HEIGHT), k => len[k] / 2, 0.1, FENCE_HEIGHT / 2);
        for (let m = 0; m <= len[len.length - 1]; m += 5) fencePosts.push([...pointAt(pts, nrm, len, m, 3.3), FENCE_HEIGHT]);
        fencePosts.push([...pointAt(pts, nrm, len, len[len.length - 1], 3.3), FENCE_HEIGHT]);   // a post at both ends
      }
    } else if (b.type === BARRIER.ARMCO && b.tall) {
      // a tall stretch of the containment wall: the same line, 1.2 m at its ends rising to 1.9 m (b.hs is 0 to 1 at each point).
      // Bolt-head tyre face, sponsor wrap, white top band and catch fence behind.
      const hs = b.hs, H = k => 1.2 + 0.7 * hs[k];
      const hAt = m => { let k = 0; while (k < len.length - 2 && len[k + 1] < m) k++; const t = Math.min(1, Math.max(0, (m - len[k]) / ((len[k + 1] - len[k]) || 1))); return hs[k] + (hs[k + 1] - hs[k]) * t; };
      strips('tyre').strip(idx, k => at(k, 0, 0.05), k => at(k, 0, H(k) - 0.1), k => len[k] / 4, 0, 1);
      strips('tyre').strip(idx, k => at(k, 0, H(k) - 0.1), k => at(k, 0.1, H(k)), k => len[k] / 4, 0.93, 1);
      strips('tyre').strip(idx, k => at(k, 0.1, H(k)), k => at(k, 0.9, H(k)), () => 0, 0, 1);
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0.02, m => 0.25 + 0.2 * hAt(m), m => 0.95 + 0.5 * hAt(m), b.side, 1);
      strips('white').strip(idx, k => at(k, 0.03, H(k) - 0.3 * hs[k]), k => at(k, 0.03, H(k) - 0.12 * hs[k]), k => len[k] / 4, 0, 1);
      strips('fence').strip(idx, k => at(k, 3.3, 0.2), k => at(k, 3.3, 0.2 + (FENCE_HEIGHT - 0.2) * hs[k]), k => len[k] / 2, 0.1, FENCE_HEIGHT / 2);
      for (let m = 0; m <= len[len.length - 1]; m += 5) fencePosts.push([...pointAt(pts, nrm, len, m, 3.3), 0.2 + (FENCE_HEIGHT - 0.2) * hAt(m)]);
      fencePosts.push([...pointAt(pts, nrm, len, len[len.length - 1], 3.3), 0.2]);
    } else if (b.type === BARRIER.ARMCO) {
      // the containment wall: a plain sponsored tyre wall, 1.2 m high, rounded top, no armco and no posts
      wall('tyre', 0, 0.05, 1.1); strips('tyre').strip(idx, k => at(k, 0, 1.1), k => at(k, 0.1, 1.2), k => len[k] / 4, 0.93, 1); cap('tyre', 0.1, 0.8, 1.2);
      wall('tyre', 0.8, 0.05, 1.2); closeEnds('tyre', 0.05, [[0, 1.1], [0.1, 1.2], [0.8, 1.2]]);   // the back and the ends
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0.02, 0.25, 0.95, b.side, 1);
    } else if (b.type === BARRIER.CONCRETE) {
      if (b.impact) {
        // tyres stacked in front of the street wall where cars arrive
        wall('tyre', -1.0, 0, 1.0); cap('tyre', -1.0, 0, 1.0);
        wall('tyre', 0.03, 0, 1.0); closeEnds('tyre', 0, [[-1.0, 1.0], [0.03, 1.0]]);                     // the back and the ends
      } else {
        wall('street', 0, -0.3, 1.4, 6);
        sponsorPoly(strips('sponsor'), pts, nrm, len, 0.03, 0.15, 1.05, b.side, 2);
        cap('wallConcrete', 0, 0.35, 1.4);
        if (b.fence) strips('fence').strip(idx, k => at(k, 0.2, 1.4), k => at(k, 0.2, 3.4), k => len[k] / 2, 0.7, 1.7);
      }
    } else if (b.type === BARRIER.PARAPET) {
      wall('parapet', 0, -1.3, 1.1, 6); cap('parapet', 0, 0.35, 1.1);
    } else if (b.type === BARRIER.PITWALL) {
      // pit wall: sponsor panels on the track face, white top, debris fence, attenuator at the start
      sponsorPoly(strips('sponsor'), pts, nrm, len, 0, 0, 0.8, 0, 1);
      wall('white', 0, 0.8, 1.1);
      cap('white', 0, 0.6, 1.1);
      wall('wallConcrete', 0.6, 0, 1.1, 6);
      // the debris fence on top, broken by an opening at each team's stand where the pit boards go out (src/pitDressing.js); the wall
      // under it and its collision faces run on unbroken
      const openings = fenceOpenings(T), sAt = k => T.s[pts[k][3]];
      const gap = k => openings.some(([a, c]) => Math.max(sAt(k), sAt(k + 1)) >= a && Math.min(sAt(k), sAt(k + 1)) <= c && Math.abs(sAt(k + 1) - sAt(k)) < 50);
      let run = [];
      const flush = () => { if (run.length > 1) strips('fence').strip(run, k => at(k, 0.3, 1.1), k => at(k, 0.3, 3.1), k => len[k] / 2, 0.55, 1.55); run = []; };
      for (const k of idx) { run.push(k); if (k < idx.length - 1 && gap(k)) { flush(); } }
      flush();
      for (let m = 0; m <= len[len.length - 1]; m += 5) fencePosts.push([...pointAt(pts, nrm, len, m, 0.3), 3.1]);
      for (const k of idx) if (k < idx.length - 1 && gap(k)) for (const e of [k, k + 1]) fencePosts.push([...at(e, 0.3, 0), 3.1]);   // a post each side of an opening
      group.add(attenuator(pts, nrm, mat.attenuator));
    } else if (b.type === BARRIER.PITOUTER) {
      wall('pitOuter', 0, -0.2, 0.81, 6); cap('pitOuter', 0, 0.3, 0.81);
    } else if (b.type === BARRIER.PITSEP) {
      // the low wall between the pit exit road and the track: concrete both faces, white top, square ends
      const W = T.pitSepWidth, top = 0.55;
      wall('wallConcrete', 0, -0.2, top, 6); wall('wallConcrete', W, -0.2, top, 6); cap('white', 0, W, top);
      for (const k of [0, pts.length - 1]) strips('wallConcrete').strip([0, 1], j => at(k, j * W, -0.2), j => at(k, j * W, top), j => j * W / 6, 0, top / 6);
    }
  }
  mat.armcoSingle = mat.armco; mat.parapet = mat.wallConcrete; mat.pitOuter = mat.wallConcrete;

  // pit garages: the building itself is drawn by buildPitDetail (src/pitBuilding.js); here only the concrete forecourt in front of it
  if (T.pitGarage.some(v => v > 0)) {
    const bay = garageBay(T);
    strips('apron').strip(bay, i => P(i, -T.pitOut[i]), i => P(i, -(T.pitOut[i] + 2)), (i, j) => sOf(i, j, bay) / 8, 0, 1);
  }

  for (const [name, b] of Object.entries(S)) {
    const mesh = tag(new THREE.Mesh(b.geometry(), mat[name]), DEBUG_OF[name] || name);
    mesh.receiveShadow = true;
    mesh.castShadow = ['armco', 'armcoSingle', 'wallConcrete', 'street', 'sponsor', 'tyre', 'parapet', 'pitOuter'].includes(name);
    if (name === 'fence') mesh.renderOrder = 2;
    group.add(mesh);
  }
  group.add(instancedPosts(posts, mat.post, 0.06, 'armco'));
  group.add(instancedPosts(fencePosts, mat.fencePost, 0.06, 'fence'));

  group.add(buildBridge(T, ground, mat, { Strips }));
  const gantryGroup = buildGantry(T, sponsorTex);
  group.add(gantryGroup, buildStartPaint(T));
  group.add(furniture(T));
  group.userData.startLights = gantryGroup.userData.lights;
  group.userData.gantryScreenMaterial = gantryGroup.userData.screenMaterial;
  group.userData.gantryPosition = gantryGroup.position;
  return group;
}

// Per-point unit normals pointing from a barrier towards the track it guards.
function inwardNormals(T, b) {
  const pts = b.pts, g = b.side ? 1 : -1, n = [];
  const seg = k => {
    const [ax, , az, i] = pts[k], [bx, , bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    let nx = -(bz - az) / len, nz = (bx - ax) / len;
    if (nx * -g * T.nx[i] + nz * -g * T.nz[i] < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  };
  for (let k = 0; k < pts.length; k++) {
    const a = k > 0 ? seg(k - 1) : seg(k), c = k < pts.length - 1 ? seg(k) : seg(k - 1);
    const x = a[0] + c[0], z = a[1] + c[1], m = Math.hypot(x, z) || 1;
    n.push([x / m, z / m]);
  }
  return n;
}

function cumulative(pts) {
  const out = [0];
  for (let k = 1; k < pts.length; k++) out.push(out[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
  return out;
}

// the point `m` metres along a polyline, `back` metres behind its face
function pointAt(pts, nrm, len, m, back) {
  let k = 0;
  while (k < len.length - 2 && len[k + 1] < m) k++;
  const t = Math.min(1, Math.max(0, (m - len[k]) / ((len[k + 1] - len[k]) || 1)));
  const lerp = (a, b) => a + (b - a) * t;
  return [lerp(pts[k][0], pts[k + 1][0]) - lerp(nrm[k][0], nrm[k + 1][0]) * back, lerp(pts[k][1], pts[k + 1][1]), lerp(pts[k][2], pts[k + 1][2]) - lerp(nrm[k][1], nrm[k + 1][1]) * back];
}

// sponsor panels along a polyline, SPONSOR_CHUNK metres each
function sponsorPoly(b, pts, nrm, len, inFront, y0, y1, side, every = 1) {
  const rows = tex.SPONSORS.length, modern = tex.MODERN_SPONSORS, total = len[len.length - 1];
  for (let m = 0, n = 0; m < total - 1; m += SPONSOR_CHUNK, n++) {
    const m1 = Math.min(total, m + SPONSOR_CHUNK), steps = Math.max(1, Math.round((m1 - m) / 1.5));
    // pick by a hash of the panel, so every brand appears; PowerMedia gets 15% of the panels
    const hash = Math.imul((n + 1) * 2654435761 ^ (Math.round(pts[0][0] * 7) + side * 977) * 40503, 2246822519) >>> 0;
    const row = hash / 4294967296 < POWERMEDIA_SHARE ? 0 : modern[(hash >>> 8) % modern.length];
    const vTop = 1 - row / rows, vBot = 1 - (row + 1) / rows, idx = [];
    for (let q = 0; q <= steps; q++) idx.push(m + (m1 - m) * q / steps);
    const flipU = side === 1;
    b.strip(idx, mm => { const p = pointAt(pts, nrm, len, mm, -inFront); return [p[0], p[1] + (typeof y0 === 'function' ? y0(mm) : y0), p[2]]; },
      mm => { const p = pointAt(pts, nrm, len, mm, -inFront); return [p[0], p[1] + (typeof y1 === 'function' ? y1(mm) : y1), p[2]]; },
      (mm) => { const u = (mm - m) / (m1 - m); return flipU ? 1 - u : u; }, vBot, vTop);
  }
}

function instancedPosts(list, material, radius, cat) {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 6);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
  const m4 = new THREE.Matrix4();
  list.forEach(([x, y, z, h], k) => { m4.makeScale(1, h, 1).setPosition(x, y, z); mesh.setMatrixAt(k, m4); });
  mesh.count = list.length;
  mesh.castShadow = true;
  return tag(mesh, cat);
}

// a crash attenuator at the start of the pit wall: a flat-faced block from the road up to the top of the wall (1.1 m), its face
// chevron-painted. Closed on every side, so it reads as a solid object and not a ramp.
function attenuator(pts, nrm, material) {
  const [x0, y0, z0] = pts[0], [x1, , z1] = pts[1];
  const dir = Math.atan2(z1 - z0, x1 - x0);
  const geo = new THREE.BoxGeometry(4, 1.1, 0.8);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x0 - Math.cos(dir) * 2 - nrm[0][0] * 0.3, y0 + 0.55, z0 - Math.sin(dir) * 2 - nrm[0][1] * 0.3);
  m.rotation.y = -dir;
  m.castShadow = true;
  return tag(m, 'pitwall');
}

// ---------------------------------------------------------------------------
// Distance boards and signs, as placed by track.js.

// trackside objects placed in track.js to fill the bare stretches (track.js FILL_GAP), three to six to a group: a marshal shelter,
// a bank of tyre stacks, a fire point, a sponsor banner, a storage box, a flag pole, a light mast. They are sized to read from the
// track at speed (a shelter 2.4 m tall, a banner 6 m long). Every part is a box or a cylinder with a vertex colour, merged into one
// mesh; the banner faces are one more mesh with the sponsor atlas. So the whole fill costs two draw calls.
const FILL_TYPES = new Set(['marshal', 'tyres', 'cabinet', 'mast', 'banner', 'store', 'flag']);
const FILL_COLOURS = { metal: 0xdddddd, rubber: 0x1e1e20, red: 0xc8102e, yellow: 0xffd21f, white: 0xeeeeea, orange: 0xff6a13, grey: 0x5b6168, concrete: 0xa9a59c, dark: 0x2a2d31 };
const FILL_HUES = [0xc8102e, 0x1d4e9e, 0xffd21f, 0x3f9d4f];
function fillObjects(T, g) {
  const kit = new Kit(), faces = new Kit(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const part = (colour, geo, x, y, z, rotY = 0) => {
    e.set(0, rotY, 0, 'YXZ');
    m4.compose(v.set(x, y, z), q.setFromEuler(e), one);
    geo.applyMatrix4(m4);
    const c = new THREE.Color(typeof colour === 'number' ? colour : FILL_COLOURS[colour]), n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
    kit.push('fill', geo);
  };
  for (const f of T.furniture) {
    if (!FILL_TYPES.has(f.type)) continue;
    const i = f.i, heading = Math.atan2(T.tz[i], T.tx[i]), rot = -heading;   // local x runs along the track, local z across it
    const g1 = f.d < 0 ? -1 : 1, ax = Math.cos(heading), az = Math.sin(heading), ox = T.nx[i] * g1, oz = T.nz[i] * g1;   // along, and away from the track
    // a box `along` x `up` x `across`, centred `a` along and `b` further from the track than the object's spot, from y0 up
    const box = (colour, along, up, across, a, b, y0) => part(colour, new THREE.BoxGeometry(along, up, across), f.x + ax * a + ox * b, f.y + y0 + up / 2, f.z + az * a + oz * b, rot);
    const cyl = (colour, r, h, a, b, y0, n = 8) => part(colour, new THREE.CylinderGeometry(r, r, h, n), f.x + ax * a + ox * b, f.y + y0 + h / 2, f.z + az * a + oz * b);
    const hue = FILL_HUES[f.hue || 0];
    if (f.type === 'marshal') {
      // a marshal shelter: open to the track, an orange roof, the yellow flag on its pole
      box('concrete', 2.6, 0.15, 1.8, 0, 0.4, -0.05);
      box('white', 2.4, 2.2, 0.08, 0, 1.2, 0.1); box('white', 0.08, 2.2, 1.5, -1.16, 0.45, 0.1); box('white', 0.08, 2.2, 1.5, 1.16, 0.45, 0.1);
      box('white', 2.4, 0.9, 0.06, 0, -0.3, 0.1);
      box('orange', 2.8, 0.14, 1.9, 0, 0.45, 2.3);
      box('metal', 0.07, 3.8, 0.07, 1.5, -0.2, 0); box('yellow', 0.9, 0.6, 0.03, 1.97, -0.2, 3.1);
    } else if (f.type === 'tyres') {
      // a bank of tyre stacks, five high, a white tyre on top of each
      for (const a of [-0.95, 0, 0.95]) { cyl('rubber', 0.45, 1.1, a, 0.2, 0); cyl('white', 0.45, 0.22, a, 0.2, 1.1); }
    } else if (f.type === 'cabinet') {
      // a fire point: a red cabinet on two posts, two extinguishers and a white board with the sign
      box('metal', 0.06, 2.45, 0.06, -0.3, 0.2, 0); box('metal', 0.06, 2.45, 0.06, 0.3, 0.2, 0);
      box('red', 0.8, 1.2, 0.4, 0, 0.3, 0.6);
      cyl('red', 0.12, 0.6, -0.75, 0, 0); cyl('red', 0.12, 0.6, 0.75, 0, 0);
      box('white', 1.0, 0.5, 0.04, 0, 0.3, 1.95);
    } else if (f.type === 'mast') {
      // a light mast with a three lamp head
      part('metal', new THREE.CylinderGeometry(0.1, 0.16, 12, 8), f.x, f.y + 6, f.z);
      box('metal', 2.2, 0.4, 0.5, 0, 0, 12);
    } else if (f.type === 'banner') {
      // a 6 m sponsor banner on three posts, its printed face towards the track and a dark back
      for (const a of [-3, 0, 3]) box('metal', 0.08, 2.6, 0.08, a, 0.25, 0);
      box('dark', 6.0, 1.3, 0.04, 0, 0.27, 1.25);
      const hw = 3, y0 = f.y + 1.25, y1 = f.y + 2.55, cx = f.x + ox * 0.24, cz = f.z + oz * 0.24;
      const row = tex.MODERN_SPONSORS[(Math.round(f.s) * 7) % tex.MODERN_SPONSORS.length], vb = 1 - (row + 1) / tex.SPONSORS.length, vt = 1 - row / tex.SPONSORS.length;
      // seen from the track, the viewer's left is further along the lap on the right side, back along it on the left side
      const L = [cx + ax * hw * g1, cz + az * hw * g1], R = [cx - ax * hw * g1, cz - az * hw * g1];
      faces.quad('sponsor', [L[0], y0, L[1]], [R[0], y0, R[1]], [R[0], y1, R[1]], [L[0], y1, L[1]], [[0, vb], [1, vb], [1, vt], [0, vt]]);
    } else if (f.type === 'store') {
      // a storage box for the marshals' kit, in the group's colour, with a darker door
      box('concrete', 3.2, 0.15, 1.8, 0, 0.5, -0.05);
      box(hue, 3.0, 2.1, 1.4, 0, 0.6, 0.1);
      box('dark', 1.1, 1.8, 0.04, 0.6, -0.12, 0.1);
    } else if (f.type === 'flag') {
      // a tall flag pole with a flag in the group's colour
      box('metal', 0.08, 7.0, 0.08, 0, 0, 0);
      box(hue, 1.8, 1.1, 0.03, 0.92, 0, 5.7);
    }
  }
  if (!kit.parts.size) return;
  g.add(kit.build({ fill: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) }));
  if (faces.parts.size) g.add(faces.build({ sponsor: new THREE.MeshStandardMaterial({ map: tex.sharedSponsorAtlas(), roughness: 0.55 }) }, { sponsor: { cast: false } }));
}

// Boards, bollards and signs are merged into a few meshes (one per material), not one mesh each: the same geometry,
// drawn in far fewer calls. Each part keeps its debug category (boards yellow, bollards and signs cyan) for the top-down view.
function furniture(T) {
  const g = new THREE.Group();
  const boardKit = new Kit(), signKit = new Kit(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  // a geometry turned by rotY and moved to (x, y, z), pushed into the kit under key
  const put = (kit, key, geo, x, y, z, rotY = 0) => {
    e.set(0, rotY, 0, 'YXZ');
    m4.compose(v.set(x, y, z), q.setFromEuler(e), one);
    kit.push(key, geo.applyMatrix4(m4));
  };
  const boardMats = {}, postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
  const signMat = new THREE.MeshStandardMaterial({ map: tex.speedSignTexture(T.layout.pit.speedLimit), roughness: 0.6, side: THREE.DoubleSide });
  for (const f of T.furniture) {
    const i = f.i, heading = Math.atan2(T.tz[i], T.tx[i]);
    if (f.type === 'board') {
      // a 1.2 m by 0.8 m board, faces oncoming cars, angled 10 degrees towards the track; its post stands under it
      const rotY = -heading - Math.PI / 2 + Math.sign(f.d) * 10 * Math.PI / 180;
      const key = `board${f.value}`;
      boardMats[key] ||= new THREE.MeshStandardMaterial({ map: tex.distanceTexture(f.value), roughness: 0.6, side: THREE.DoubleSide });
      const ex = [Math.cos(rotY), -Math.sin(rotY)], cy = f.y + 1.6, hw = 0.6, hh = 0.4;
      const corner = (sx, sy) => [f.x + ex[0] * sx * hw, cy + sy * hh, f.z + ex[1] * sx * hw];
      boardKit.quad(key, corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
      boardKit.box('post', 0.08, 1.25, 0.08, f.x, f.y + 0.6, f.z);
    } else if (f.type === 'bollard') {
      // a flexible white post with an orange band, standing on the kerb (pit exit bollards stand on the low wall)
      const y = f.y + (f.raise || 0);
      put(signKit, 'bollardWhite', new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8), f.x, y + 0.45, f.z);
      put(signKit, 'bollardOrange', new THREE.CylinderGeometry(0.0625, 0.0625, 0.18, 8), f.x, y + 0.72, f.z);
    } else if (f.type === 'sign') {
      // a pit lane speed sign on a pole
      put(signKit, 'signface', new THREE.CircleGeometry(0.6, 24), f.x, f.y + 2.4, f.z, -heading - Math.PI / 2);
      put(signKit, 'post', new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), f.x, f.y + 1.75, f.z);
    }
  }
  const noShadow = keys => Object.fromEntries(keys.map(k => [k, { cast: false, receive: false }]));
  const boards = boardKit.build({ ...boardMats, post: postMat }, { debug: 'board', ...noShadow([...Object.keys(boardMats), 'post']) });
  const signs = signKit.build({ bollardWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }), bollardOrange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.5 }), signface: signMat, post: postMat },
    { debug: 'sign', bollardWhite: { cast: true, receive: false }, ...noShadow(['bollardOrange', 'signface', 'post']) });
  g.add(boards, signs);
  fillObjects(T, g);
  return g;
}

// ---------------------------------------------------------------------------
// Strip builder: quads between two edge lines, merged into one geometry.

class Strips {
  constructor() { this.pos = []; this.uv = []; this.ind = []; this.col = null; }

  // Joins two rows of points across the road (each [{ p: [x, y, z], uv: [u, v] }], in the same order across) with triangles,
  // however many points each has: walks both rows together, so no point of one row sits on the middle of an edge of the other
  // (no T-junction, no crack). Every triangle faces up.
  stitch(rowA, rowB, fa, fb) {
    let i = 0, j = 0;
    const put = q => { const n = this.pos.length / 3; this.pos.push(...q.p); this.uv.push(...q.uv); return n; };
    const tri = (a, b, c) => {
      const ux = b.p[0] - a.p[0], uz = b.p[2] - a.p[2], vx = c.p[0] - a.p[0], vz = c.p[2] - a.p[2];
      const up = uz * vx - ux * vz > 0;   // y of (b - a) x (c - a), from the plan view
      const ia = put(a), ib = put(b), ic = put(c);
      if (up) this.ind.push(ia, ib, ic); else this.ind.push(ia, ic, ib);
    };
    while (i < rowA.length - 1 || j < rowB.length - 1) {
      if (j === rowB.length - 1 || (i < rowA.length - 1 && fa[i + 1] <= fb[j + 1])) { tri(rowA[i], rowA[i + 1], rowB[j]); i++; }
      else { tri(rowA[i], rowB[j + 1], rowB[j]); j++; }
    }
  }

  // a(i), b(i): world positions of the two edges at sample i.
  // u(i, j): texture coordinate along the strip. va, vb: across (number or function of i).
  strip(idx, a, b, u, va, vb, colour) {
    if (idx.length < 2) return;
    const base = this.pos.length / 3;
    const V = (v, i) => (typeof v === 'function' ? v(i) : v);
    idx.forEach((i, j) => {
      this.pos.push(...a(i), ...b(i));
      if (colour) { const c = colour(i, j); (this.col ||= []).push(...c, ...c); }
      const uu = u(i, j);
      this.uv.push(uu, V(va, i), uu, V(vb, i));
    });
    // flat strips must face up: choose the winding for every quad on its own
    // (a run can start or end with a zero-width quad, which says nothing)
    const p = this.pos;
    for (let j = 1; j < idx.length; j++) {
      const k = base + j * 2, o = (k - 2) * 3;
      const ex = p[o + 3] - p[o], ey = p[o + 4] - p[o + 1], ez = p[o + 5] - p[o + 2];   // a -> b, previous sample
      const fx = p[o + 6] - p[o], fz = p[o + 8] - p[o + 2];                             // a(prev) -> a(this)
      const flat = Math.abs(ey) < 0.5 * Math.hypot(ex, ez) + 1e-6;
      const flip = flat && (ez * fx - ex * fz) < 0;
      if (flip) this.ind.push(k - 2, k, k - 1, k - 1, k, k + 1);
      else this.ind.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }

  // Like strip(), but cut across its width into pieces no wider than `maxWidth`, each corner taking
  // its height from `ground(x, z, i)`. A wide band drawn as one quad would cut a straight chord
  // through ground that bends (a bank beside the circuit, a hill beyond the run-off).
  band(idx, a, b, u, va, vb, ground, colour, maxWidth = 6) {
    if (idx.length < 2) return;
    let widest = 0;
    for (const i of idx) { const p = a(i), q = b(i); widest = Math.max(widest, Math.hypot(q[0] - p[0], q[2] - p[2])); }
    const n = Math.max(1, Math.ceil(widest / maxWidth)), V = (v, i) => (typeof v === 'function' ? v(i) : v);
    const at = (i, t) => {
      const p = a(i), q = b(i), x = p[0] + (q[0] - p[0]) * t, z = p[2] + (q[2] - p[2]) * t;
      return [x, t === 0 ? p[1] : t === 1 ? q[1] : ground(x, z, i), z];
    };
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      this.strip(idx, i => at(i, t0), i => at(i, t1), u, i => V(va, i) + (V(vb, i) - V(va, i)) * t0, i => V(va, i) + (V(vb, i) - V(va, i)) * t1, colour);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.ind);
    g.computeVertexNormals();
    return g;
  }
}

// sponsor panels for straight runs are drawn by sponsorPoly above

function crossLine(b, T, s, width, d0, d1, lift = DECAL) {
  const i0 = wrap(Math.round(s / T.ds), T.N), idx = [];
  for (let k = 0; k <= Math.max(1, Math.round(width / T.ds)); k++) idx.push(wrap(i0 + k, T.N));
  const y = (i, d) => T.groundAt(T.x[i] + T.nx[i] * d, T.z[i] + T.nz[i] * d, i) + lift;
  b.strip(idx, i => [T.x[i] + T.nx[i] * d0, y(i, d0), T.z[i] + T.nz[i] * d0], i => [T.x[i] + T.nx[i] * d1, y(i, d1), T.z[i] + T.nz[i] * d1], () => 0, 0, 1);
}

// Is this point on any non-bridge tarmac (track or pit lane), with a margin?
export function onAnyRoad(T, x, z, margin) {
  for (let i = 0; i < T.N; i++) {
    if (T.isBridge[i]) continue;
    const dx = x - T.x[i], dz = z - T.z[i];
    if (dx * dx + dz * dz > 60 * 60) continue;
    const along = dx * T.tx[i] + dz * T.tz[i];
    if (Math.abs(along) > 0.6) continue;
    const d = dx * T.nx[i] + dz * T.nz[i];
    if (Math.abs(d) < T.hw[i] + margin) return true;
    if (T.pitOut[i] && d < 0 && -d > T.pitIn[i] - margin && -d < T.pitOut[i] + margin) return true;
  }
  return false;
}

// Run lengths of consecutive samples where test(i) is true, as index lists.
export function runs(N, test) {
  const out = [];
  let start = 0;
  while (start < N && test(start)) start++;
  if (start === N) { const all = []; for (let i = 0; i <= N; i++) all.push(i % N); return [all]; }
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    // only samples that pass the test: a band must never be closed with a sample where its edges
    // are zero, which would stretch it across the road to the centreline
    if (test(i)) { if (!cur) cur = []; cur.push(i); }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
