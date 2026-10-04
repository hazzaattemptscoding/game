// Everything away from the racing surface: the ground, and what is left of
// RAF Stanmere (reference/LAKESIDE_REFERENCE_PACK.md, section 2).
//
// Phase 2 builds the terrain, the old runway slab and perimeter track, the
// Watch Office (now Race Control), the timekeepers' box, the old painted pit
// wall, a Bellman hangar, the Dispersal Nissen huts and the water tower.
// Grandstands, the gate guardian, the chapel, the lake and the rest come in phase 3.

import * as THREE from 'three';
import { wrap } from './track.js';
import * as tex from './textures.js';

// Ground height anywhere, matching the track near it and rolling away from it.
export function createGround(T) {
  const coarse = [];
  for (let i = 0; i < T.N; i += 8) if (!T.isBridge[i]) coarse.push(i);
  // how far the flat ground around the track reaches (the pit side includes the paddock)
  const reach = i => Math.max(T.wall[0][i] + (T.pitOut[i] ? 70 : 0), T.wall[1][i]) + 4;

  function sample(x, z) {
    let best = Infinity, near = 0, sw = 0, sh = 0;
    for (const i of coarse) {
      const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2;
      if (q < best) { best = q; near = i; }
      const w = 1 / ((q + 900) * (q + 900));
      sw += w; sh += w * T.h[i];
    }
    for (let d = -8; d <= 8; d++) {
      const i = wrap(near + d, T.N);
      if (T.isBridge[i]) continue;
      const q = (x - T.x[i]) ** 2 + (z - T.z[i]) ** 2;
      if (q < best) { best = q; near = i; }
    }
    return { dist: Math.sqrt(best), near, smooth: sh / sw };
  }

  function height(x, z) {
    const { dist, near, smooth } = sample(x, z);
    const corridor = reach(near);
    const far = Math.min(1, Math.max(0, (dist - corridor) / 120));
    const blend = far * far * (3 - 2 * far);
    const hills = 18 * Math.max(0, Math.min(1, (dist - 250) / 400)) * (0.6 + 0.4 * Math.sin(x * 0.004 + 1.3) * Math.cos(z * 0.005));
    let h = T.h[near] * (1 - blend) + smooth * blend + hills - 0.35;
    if (dist < corridor) h = Math.min(h, T.h[near] - 0.35);
    return h;
  }

  // free space around a point: metres between it and the nearest barrier (or paddock)
  function clearance(x, z) {
    let best = Infinity;
    for (let i = 0; i < T.N; i += 2) {
      const d = Math.hypot(x - T.x[i], z - T.z[i]) - Math.max(T.wall[0][i], T.wall[1][i]) - (T.pitOut[i] ? 16 : 0);
      if (d < best) best = d;
    }
    return best;
  }

  function mesh() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < T.N; i++) {
      x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]);
      z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]);
    }
    const pad = 700, cell = 12;
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3), ind = [];
    const c1 = new THREE.Color(0x4f7a3a), c2 = new THREE.Color(0x7c8a4a), tmp = new THREE.Color();
    for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) {
      const x = x0 + k * cell, z = z0 + j * cell, n = j * nx + k;
      pos[n * 3] = x; pos[n * 3 + 1] = height(x, z); pos[n * 3 + 2] = z;
      uv[n * 2] = x / 24; uv[n * 2 + 1] = z / 24;
      // mown near the circuit, rougher meadow further out
      const { dist } = sample(x, z);
      const rough = Math.min(1, Math.max(0, (dist - 60) / 200)) * (0.6 + 0.4 * Math.sin(x * 0.013) * Math.cos(z * 0.011));
      tmp.copy(c1).lerp(c2, rough);
      col[n * 3] = tmp.r; col[n * 3 + 1] = tmp.g; col[n * 3 + 2] = tmp.b;
      if (j && k) { const a = (j - 1) * nx + k - 1, b = a + 1, c = j * nx + k - 1, d = c + 1; ind.push(a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    const grass = tex.grassTexture(31);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: grass, roughness: 1 }));
    m.receiveShadow = true;
    return m;
  }

  return { height, clearance, mesh };
}

export function buildScenery(T, ground) {
  const g = new THREE.Group();
  const M = {
    runway: new THREE.MeshStandardMaterial({ map: tex.runwayTexture(), roughness: 0.95, side: THREE.DoubleSide }),
    oldTarmac: new THREE.MeshStandardMaterial({ map: tex.runwayTexture(9), color: 0x8f8a80, roughness: 0.95 }),
    fadedPaint: new THREE.MeshStandardMaterial({ color: 0xcfcbbe, roughness: 0.9, side: THREE.DoubleSide }),
    brick: new THREE.MeshStandardMaterial({ map: tex.brickTexture(), roughness: 0.9 }),
    render: new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x24313b, roughness: 0.15, metalness: 0.5 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x9fb2bc, roughness: 0.5, metalness: 0.4 }),
    roofSlab: new THREE.MeshStandardMaterial({ color: 0x6e6b63, roughness: 0.9 }),
    hangar: new THREE.MeshStandardMaterial({ map: tex.corrugatedTexture('#6f7a6b'), roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
    hut: new THREE.MeshStandardMaterial({ map: tex.corrugatedTexture('#7a7358', 21), roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
    green: new THREE.MeshStandardMaterial({ color: 0x4a5b3f, roughness: 0.8 }),
    timber: new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.85 }),
    darkFrame: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6 }),
    oldWall: new THREE.MeshStandardMaterial({ color: 0xd9d6cb, roughness: 0.95 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x6e7a6c, roughness: 0.7, metalness: 0.3 }),
  };
  const add = (geo, mat, x, y, z, rotY = 0, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = cast; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // a point relative to the track: s along the lap, d to the side
  const at = (s, d) => {
    const i = wrap(Math.round(s / T.ds), T.N);
    const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
    return { x, z, y: ground.height(x, z), yaw: -Math.atan2(T.tz[i], T.tx[i]), i };
  };

  // --- old runway: 45 m wide, 7.5 m slabs, broken up wherever the new circuit cuts it
  {
    const a = T.fromSketch(250, 392), b = T.fromSketch(480, 506);
    const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const vx = -uz, vz = ux, slab = 7.5, half = 22.5;
    const pos = [], uv = [], ind = [];
    const paint = [];
    for (let s = 0; s < len; s += slab) for (let w = -half; w < half; w += slab) {
      const cx = a.x + ux * (s + slab / 2) + vx * (w + slab / 2), cz = a.z + uz * (s + slab / 2) + vz * (w + slab / 2);
      if (ground.clearance(cx, cz) < 4) continue;
      const y = ground.height(cx, cz) + 0.06, base = pos.length / 3;
      for (const [p, q] of [[0, 0], [slab, 0], [slab, slab], [0, slab]]) {
        pos.push(a.x + ux * (s + p) + vx * (w + q), y, a.z + uz * (s + p) + vz * (w + q));
        uv.push(p / 15 + (s % 15) / 15, q / 15 + (w % 15) / 15);
      }
      ind.push(base, base + 2, base + 1, base, base + 3, base + 2);
      // faded centreline dashes and threshold bars
      if (Math.abs(w + slab / 2) < slab / 2 && (s / slab) % 4 < 2) paint.push([cx, y + 0.01, cz, 0.9, slab * 0.8]);
      if (s < slab * 2 && Math.abs(w + slab / 2) > 4) paint.push([cx, y + 0.01, cz, 1.8, slab * 0.9]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(ind);
    geo.computeVertexNormals();
    const runway = new THREE.Mesh(geo, M.runway);
    runway.receiveShadow = true;
    g.add(runway);
    const yaw = -Math.atan2(uz, ux);
    for (const [x, y, z, wid, lng] of paint) {
      const p = add(new THREE.PlaneGeometry(lng, wid), M.fadedPaint, x, y, z, 0, false);
      p.rotation.set(-Math.PI / 2, 0, yaw);
    }
  }

  // --- old perimeter track behind the gravel at Mess Straight (12 m wide, cracked)
  {
    const s0 = T.sAtPointRaw(53.4), s1 = T.sAtPointRaw(57.2), pos = [], uv = [], ind = [];
    for (let s = s0; s <= s1; s += 2) {
      const i = wrap(Math.round(s), T.N), d0 = T.wall[1][i] + 6, d1 = d0 + 12;
      const base = pos.length / 3;
      for (const d of [d0, d1]) {
        const x = T.x[i] + T.nx[i] * d, z = T.z[i] + T.nz[i] * d;
        pos.push(x, ground.height(x, z) + 0.05, z);
        uv.push((s - s0) / 15, (d - d0) / 15);
      }
      if (s > s0) ind.push(base - 2, base, base - 1, base - 1, base, base + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(ind);
    geo.computeVertexNormals();
    const strip = new THREE.Mesh(geo, M.oldTarmac);
    strip.material.side = THREE.DoubleSide;
    strip.receiveShadow = true;
    g.add(strip);
  }

  // --- behind the Operations Block: the Watch Office (Race Control) and Dispersal
  const pitRun = [];
  for (let i = 0; i < T.N; i++) if (T.pitLimiter[i]) pitRun.push(i);
  if (pitRun.length) {
    const mid = T.s[pitRun[Math.floor(pitRun.length * 0.5)]];
    const wo = at(mid - 85, -(T.wall[0][pitRun[0]] + 12));
    g.add(watchOffice(M, wo));
    // six Nissen huts in a row, ends facing the paddock road
    for (let k = 0; k < 6; k++) {
      const p = at(mid + 90 + k * 11, -(T.wall[0][pitRun[0]] + 10));
      g.add(nissenHut(M, p));
    }
  }

  // --- right side of Runway Straight: the timekeepers' box and the old painted pit wall
  {
    const tk = at(18, T.wall[1][18] + 4);
    g.add(timekeepersBox(M, tk));
    const s0 = T.length - 170, s1 = T.length - 50;
    for (let s = s0; s < s1; s += 3) {
      const p = at(s, T.wall[1][wrap(Math.round(s), T.N)] + 8);
      const block = add(new THREE.BoxGeometry(3.05, 1.0, 0.3), M.oldWall, p.x, p.y + 0.5, p.z, p.yaw);
      // flaking: every few blocks a little darker
      if ((s / 3) % 5 < 1) block.material = M.roofSlab;
    }
  }

  // --- infield: a Bellman hangar north of Scramble, and the water tower
  {
    const h = T.fromSketch(600, 382);
    const yaw = -Math.atan2(T.tz[0], T.tx[0]);
    g.add(bellmanHangar(M, { x: h.x, z: h.z, y: ground.height(h.x, h.z), yaw }));
    const w = T.fromSketch(470, 332);
    g.add(waterTower(M, { x: w.x, z: w.z, y: ground.height(w.x, w.z) }));
  }

  return g;
}

// Watch Office: 12 x 9 m brick block, 7 m high, balcony, glazed control room on the roof.
function watchOffice(M, p) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 9), M.brick);
  body.position.y = 3.5;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.3, 9.4), M.roofSlab);
  roof.position.y = 7.15;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.2, 3.5), M.glass);
  cab.position.set(0, 8.4, 0);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.2, 3.9), M.roofSlab);
  cabRoof.position.set(0, 9.6, 0);
  g.add(body, roof, cab, cabRoof);
  // windows on the front (+z faces the track) and back, two floors
  for (const zf of [4.52, -4.52]) for (const y of [1.8, 5.0]) for (let k = 0; k < 4; k++) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 0.05), M.frame);
    frame.position.set(-4.2 + k * 2.8, y, zf);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.06), M.glass);
    pane.position.set(-4.2 + k * 2.8, y, zf + Math.sign(zf) * 0.01);
    g.add(frame, pane);
  }
  // first-floor balcony with a pale blue-grey rail, all along the front
  const slab = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.2, 1.4), M.render);
  slab.position.set(0, 3.5, 5.2);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.06, 0.06), M.rail);
  rail.position.set(0, 4.5, 5.85);
  g.add(slab, rail);
  for (let k = 0; k <= 8; k++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), M.rail);
    post.position.set(-6.1 + k * 1.525, 4.0, 5.85);
    g.add(post);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw - Math.PI / 2;   // front faces the pit lane
  return g;
}

// Nissen hut: 4.9 m wide, 11 m long half-cylinder of corrugated steel, brick ends.
function nissenHut(M, p) {
  const g = new THREE.Group(), r = 2.45, L = 11;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 16, 1, true, -Math.PI / 2, Math.PI), M.hut);
  shell.rotation.z = Math.PI / 2;
  shell.rotation.y = Math.PI / 2;
  const endGeo = new THREE.CircleGeometry(r, 16, 0, Math.PI);
  for (const z of [-L / 2, L / 2]) {
    const end = new THREE.Mesh(endGeo, M.brick);
    end.position.z = z;
    if (z < 0) end.rotation.y = Math.PI;
    g.add(end);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.1), M.green);
  door.position.set(0, 1.0, L / 2 + 0.05);
  g.add(shell, door);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw;
  return g;
}

// Timekeepers' box: 3.6 x 2.4 m white timber hut on 2.5 m stilts, glazed front, ladder.
function timekeepersBox(M, p) {
  const g = new THREE.Group();
  for (const [x, z] of [[-1.6, -1.0], [1.6, -1.0], [-1.6, 1.0], [1.6, 1.0]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), M.darkFrame);
    leg.position.set(x, 1.25, z);
    g.add(leg);
  }
  const hut = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 2.4), M.timber);
  hut.position.y = 3.6;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.15, 2.8), M.darkFrame);
  roof.position.y = 4.78;
  const glazing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.05), M.glass);
  glazing.position.set(0, 3.9, -1.23);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.06), M.darkFrame);
  ladder.position.set(1.0, 1.3, 1.4);
  ladder.rotation.x = -0.25;
  g.add(hut, roof, glazing, ladder);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw + Math.PI / 2;   // glazing faces the track
  return g;
}

// Bellman hangar: 26 m wide, 54 m long, low arched roof to 8 m, doors at one end.
function bellmanHangar(M, p) {
  const g = new THREE.Group(), W = 26, L = 54;
  const prof = new THREE.Shape();
  prof.moveTo(-W / 2, 0); prof.lineTo(-W / 2, 5.5);
  prof.quadraticCurveTo(0, 10.5, W / 2, 5.5);
  prof.lineTo(W / 2, 0); prof.lineTo(-W / 2, 0);
  const geo = new THREE.ExtrudeGeometry(prof, { depth: L, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -L / 2);
  // stretch the corrugation texture over the walls
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 6, uv.getY(k) / 6);
  const body = new THREE.Mesh(geo, M.hangar);
  const doors = new THREE.Mesh(new THREE.PlaneGeometry(W - 3, 5.2), M.green);
  doors.position.set(0, 2.6, L / 2 + 0.05);
  const rust = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.5, L + 0.1), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }));
  rust.position.y = 0.25;
  g.add(body, doors, rust);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw;
  return g;
}

// Water tower: 6 x 6 x 3 m steel tank on four brick legs, 12 m to the top.
function waterTower(M, p) {
  const g = new THREE.Group();
  for (const [x, z] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), M.brick);
    leg.position.set(x, 4.5, z);
    g.add(leg);
  }
  const tank = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), M.tank);
  tank.position.y = 10.5;
  g.add(tank);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(p.x, p.y, p.z);
  return g;
}
