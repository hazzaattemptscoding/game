// Trackside detail: marshal posts, 50 m distance boards, lamp posts, flag masts, advertising hoardings and tree lines.
//
// Everything here is placed behind the containment wall and checked against the barrier lines, the pit lane, the
// grandstands and the buildings before it is drawn; whatever fails the check is simply left out. Repeated things are
// merged into a few meshes (Kit) or drawn as InstancedMesh, so the whole lot costs a handful of draw calls.

import * as THREE from 'three';
import * as tex from './textures.js';
import { Kit, trackPoint, hash01, sponsorRow } from './meshKit.js';
import { wallClearance } from './grandstands.js';
import { garageBay } from './pitBuilding.js';
import { flagMaterial, addFlag } from './lamps.js';

const wrapN = (i, n) => ((i % n) + n) % n;

function segDist(x, z, sg) {
  const t = Math.max(0, Math.min(1, ((x - sg.ax) * (sg.bx - sg.ax) + (z - sg.az) * (sg.bz - sg.az)) / (sg.len * sg.len)));
  return Math.hypot(x - sg.ax - t * (sg.bx - sg.ax), z - sg.az - t * (sg.bz - sg.az));
}

// is a stand footprint (grown by `m`) over this point
function inStand(stands, x, z, m) {
  for (const o of stands) {
    const a = (x - o.x) * o.ex[0] + (z - o.z) * o.ex[1], b = (x - o.x) * o.ez[0] + (z - o.z) * o.ez[1];
    if (Math.abs(a) < o.len / 2 + m && b > -8 - m && b < o.depth + m) return true;
  }
  return false;
}

export function buildProps(T, ground, blockers, stands) {
  const g = new THREE.Group();
  const stats = {};

  // Is a spot free for a small object: behind the wall by `behind` m, `fromBarrier` m from every barrier line, clear of
  // buildings and stands.
  const free = (x, z, { behind = 3, fromBarrier = 3, pad = 3 } = {}) => {
    if (wallClearance(T, x, z) < behind) return false;
    for (const sg of T.segs) if (segDist(x, z, sg) < fromBarrier) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < b.r + pad) return false;
    return !inStand(stands, x, z, 6 + pad);
  };
  const yAt = (x, z) => ground.meshHeight(x, z);

  // ---- marshal posts ------------------------------------------------------------------------------------------------
  {
    const kit = new Kit(), posts = [];
    for (let s = 60; s < T.length - 40; s += 105) {
      let placed = null;
      for (const off of [0, 12, -12, 25, -25, 40, -40, 60, -60]) {
        const c = trackPoint(T, s + off, 0), i = c.i;
        if (T.isBridge[i]) continue;
        const outside = T.curv[i] > 0 ? 0 : 1;   // the outside of the bend (curvature is positive for a left-hander)
        for (const side of Math.abs(T.curv[i]) < 0.002 ? [1, 0] : [outside, 1 - outside]) {
          const sg = side ? 1 : -1;
          if (side === 0 && T.pitOut[i]) continue;
          const p = trackPoint(T, s + off, sg * (T.wall[side][i] + 7));
          if (!free(p.x, p.z, { behind: 6, fromBarrier: 5, pad: 4 })) continue;
          placed = { p, side, c };
          break;
        }
        if (placed) break;
      }
      if (!placed) continue;
      const { p, side, c } = placed, ex = side ? [c.tx, c.tz] : [-c.tx, -c.tz], ez = [-ex[1], ex[0]], yaw = Math.atan2(-ex[1], ex[0]);
      const y = yAt(p.x, p.z) - 0.15;
      const at = (key, w, h, d, a, yy, cc) => kit.box(key, w, h, d, p.x + ex[0] * a + ez[0] * cc, y + yy, p.z + ex[1] * a + ez[1] * cc, yaw);
      at('concrete', 3.2, 0.3, 2.6, 0, 0.1, 0);
      at('white', 3.0, 2.0, 0.1, 0, 1.25, 1.15);
      at('white', 0.1, 2.0, 2.2, -1.45, 1.25, 0.1);
      at('white', 0.1, 2.0, 2.2, 1.45, 1.25, 0.1);
      at('white', 3.0, 0.8, 0.08, 0, 0.7, -1.1);
      at('orange', 3.5, 0.12, 3.0, 0, 2.35, 0.1);
      at('steel', 0.07, 4.2, 0.07, 1.9, 2.1, 0.9);
      const W = (a, yy, cc) => [p.x + ex[0] * a + ez[0] * cc, y + yy, p.z + ex[1] * a + ez[1] * cc];
      const flag = hash01(Math.round(s), 3) < 0.5 ? 'flagY' : 'flagG', fw = W(1.93, 3.9, 0.9);
      addFlag(kit, flag, fw[0], fw[1], fw[2], ex[0], ex[1], 1.0, 0.7, 4);
      // the flag stand in front of the post: a rack of poles with the yellow, red and blue flags on it
      at('steel', 2.4, 0.08, 0.08, 0, 0.5, 2.2);
      [['flagY', -1], ['flagR', 0], ['flagB', 1]].forEach(([fk, a]) => {
        at('steel', 0.04, 2.6, 0.04, a * 0.8, 1.6, 2.2);
        const fp = W(a * 0.8 + 0.02, 1.9, 2.2);
        addFlag(kit, fk, fp[0], fp[1], fp[2], ex[0], ex[1], 0.7, 0.5, 3);
      });
      posts.push([p.x, p.z]);
    }
    const mats = {
      concrete: new THREE.MeshStandardMaterial({ map: tex.standConcreteTexture(), roughness: 0.9 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.5 }),
      flagY: flagMaterial({ color: 0xffd21f }),
      flagG: flagMaterial({ color: 0x2fb04a }),
      flagR: flagMaterial({ color: 0xc8102e }),
      flagB: flagMaterial({ color: 0x1d4e9e }),
    };
    const mesh = kit.build(mats);
    mesh.traverse(o => { if (o.isMesh) o.userData.debug = 'sign'; });
    g.add(mesh);
    stats.marshalPosts = posts.length;
    stats.marshalSpots = posts;
  }

  // ---- 50 m boards, to go with the 300, 200 and 100 m boards track.js places before the main braking zones ------------
  {
    const kit = new Kit(), boards = [];
    for (const f of T.furniture || []) {
      if (f.type !== 'board' || f.value !== 100) continue;
      const i = wrapN(f.i + 50, T.N), sd = f.d < 0 ? 0 : 1;
      if (T.isBridge[i] || T.street[sd][i] || (sd === 0 && T.pitOut[i]) || T.gravelOut[sd][i] > 0 && Math.abs(f.d) >= T.gravelIn[sd][i] - 1) continue;
      const p = trackPoint(T, T.s[i], f.d);
      if (T.segs.some(sg => segDist(p.x, p.z, sg) < 6)) continue;
      if (T.furniture.some(o => o !== f && Math.hypot(o.x - p.x, o.z - p.z) < 6)) continue;
      const y = T.groundAt(p.x, p.z, i), heading = Math.atan2(T.tz[i], T.tx[i]);
      const rot = -heading - Math.PI / 2 + Math.sign(f.d) * 10 * Math.PI / 180;
      kit.box('board', 1.2, 0.8, 0.04, p.x, y + 1.6, p.z, rot);
      kit.box('post', 0.08, 1.25, 0.08, p.x, y + 0.6, p.z);
      boards.push([p.x, p.z]);
    }
    const mesh = kit.build({ board: new THREE.MeshStandardMaterial({ map: tex.distanceTexture(50), roughness: 0.6 }), post: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 }) });
    mesh.traverse(o => { if (o.isMesh) o.userData.debug = 'board'; });
    g.add(mesh);
    stats.boards50 = boards.length;
  }

  // ---- lamp posts: behind the garages, at the ends of each stand and along the street section ---------------------------
  {
    const lamps = [];   // [x, z, yaw]: the arm points along local +x, turned towards the track
    for (const st of stands) {
      for (const a of [-st.len / 2 - 3, st.len / 2 + 3]) {
        lamps.push([st.x + st.ex[0] * a + st.ez[0], st.z + st.ex[1] * a + st.ez[1], Math.atan2(st.ez[1], -st.ez[0])]);
      }
    }
    // behind the pit building, the arm over the paddock road side
    const bay = garageBay(T);
    for (let k = 10; k < bay.length - 10; k += 28) {
      const i = bay[k], p = trackPoint(T, T.s[i], -(T.pitOut[i] + 2 + 14 + 4));
      lamps.push([p.x, p.z, Math.atan2(-p.nz, p.nx)]);
    }
    // along the street section, outside the walls
    let lastS = -1e9;
    for (let i = 0; i < T.N; i++) {
      if (!(T.street[0][i] || T.street[1][i]) || T.isBridge[i] || T.s[i] - lastS < 55) continue;
      const side = T.street[1][i] ? 1 : 0, sg = side ? 1 : -1;
      const p = trackPoint(T, T.s[i], sg * (T.wall[side][i] + 3));
      if (!free(p.x, p.z, { behind: 2.2, fromBarrier: 2.2, pad: 2 })) continue;
      lamps.push([p.x, p.z, Math.atan2(sg * p.nz, -sg * p.nx)]);
      lastS = T.s[i];
    }
    if (lamps.length) {
      const pole = new THREE.CylinderGeometry(0.07, 0.11, 7.2, 6); pole.translate(0, 3.6, 0);
      const arm = new THREE.BoxGeometry(1.5, 0.08, 0.08); arm.translate(0.75, 7.15, 0);
      const poleAll = mergeTwo(pole, arm);
      const head = new THREE.BoxGeometry(0.8, 0.1, 0.34); head.translate(1.45, 7.08, 0);
      const mp = new THREE.InstancedMesh(poleAll, new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.5 }), lamps.length);
      const mh = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xdfe3e6, emissive: 0xfff2cf, emissiveIntensity: 0.5, roughness: 0.4 }), lamps.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
      lamps.forEach(([x, z, yaw], k) => {
        e.set(0, yaw, 0); m4.compose(new THREE.Vector3(x, yAt(x, z) - 0.1, z), q.setFromEuler(e), one);
        mp.setMatrixAt(k, m4); mh.setMatrixAt(k, m4);
      });
      mp.castShadow = true; mp.userData.debug = mh.userData.debug = 'sign';
      g.add(mp, mh);
    }
    stats.lamps = lamps.length;
  }

  // ---- flag masts at the ends of the main stand, and a chequered flag at the start line ------------------------------------
  {
    const kit = new Kit();
    const masts = [];
    for (const main of stands.filter(s => s.kind === 'main' || s.name === 'Main Grandstand')) for (const a of [-main.len / 2 - 6, main.len / 2 + 6]) masts.push({ x: main.x + main.ex[0] * a + main.ez[0] * 6, z: main.z + main.ex[1] * a + main.ez[1] * 6, ex: main.ex, ez: main.ez });
    masts.forEach((m, k) => {
      const y = yAt(m.x, m.z) - 0.2, key = ['flagR', 'flagB'][k % 2];
      kit.box('steel', 0.14, 11, 0.14, m.x, y + 5.5, m.z);
      addFlag(kit, key, m.x + m.ex[0] * 0.07, y + 9.3, m.z + m.ex[1] * 0.07, m.ex[0], m.ex[1], 3.2, 1.6, 6);
    });
    const mats = {
      steel: new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.5, metalness: 0.4 }),
      flagR: flagMaterial({ color: 0xc8102e }),
      flagB: flagMaterial({ color: 0x1d4e9e }),
    };
    const mesh = kit.build(mats, { debug: 'sign' });
    g.add(mesh);
    stats.masts = masts.length;
  }

  // ---- advertising hoardings along the straights, behind the barrier and its catch fence -------------------------------------
  {
    const kit = new Kit(), rows = tex.MODERN_SPONSORS;
    let count = 0;
    // straights: runs of 150 m or more with almost no curvature
    const straight = new Uint8Array(T.N);
    for (let i = 0; i < T.N; i++) straight[i] = Math.abs(T.curv[i]) < 0.0012 ? 1 : 0;
    let run = [];
    const runs = [];
    for (let i = 0; i <= T.N; i++) {
      if (i < T.N && straight[i]) run.push(i); else { if (run.length > 150) runs.push(run); run = []; }
    }
    runs.sort((a, b) => b.length - a.length);
    for (const r of runs.slice(0, 4)) {
      let n = 0;
      for (let k = 20; k < r.length - 20; k += 6) {
        const i = r[k], j = r[Math.min(r.length - 1, k + 5)];
        for (const side of [1, 0]) {
          if (side === 0 && (T.pitOut[i] || T.pitOut[j])) continue;
          const sg = side ? 1 : -1;
          if (T.street[side][i] || T.isBridge[i]) continue;
          const a = trackPoint(T, T.s[i], sg * (T.wall[side][i] + 5.4)), b = trackPoint(T, T.s[j], sg * (T.wall[side][j] + 5.4));
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          if (!free(a.x, a.z, { behind: 4, fromBarrier: 4.5, pad: 1 }) || !free(b.x, b.z, { behind: 4, fromBarrier: 4.5, pad: 1 }) || !free(mx, mz, { behind: 4, fromBarrier: 4.5, pad: 1 })) continue;
          const ya = yAt(a.x, a.z), yb = yAt(b.x, b.z);
          const rowIdx = hash01(Math.round(T.s[i]), side) < 0.2 ? 0 : rows[Math.floor(hash01(Math.round(T.s[i]), side, 2) * rows.length)];
          const [vb, vt] = sponsorRow(rowIdx);
          // a board standing 0.5 m off the ground, 1.4 m tall, facing the track
          const flip = side === 1;
          const A = [a.x, ya + 0.5, a.z], B = [b.x, yb + 0.5, b.z], A2 = [a.x, ya + 1.9, a.z], B2 = [b.x, yb + 1.9, b.z];
          if (flip) kit.quad('sponsor', B, A, A2, B2, [[0, vb], [1, vb], [1, vt], [0, vt]]);
          else kit.quad('sponsor', A, B, B2, A2, [[0, vb], [1, vb], [1, vt], [0, vt]]);
          kit.quad('back', A, B, B2, A2);
          kit.box('post', 0.1, 1.9, 0.1, a.x, ya + 0.95, a.z);
          n++; count++;
        }
        if (n > 70) break;
      }
    }
    // and round the corners: shorter runs of boards on the outside of the bends, behind the catch fence
    {
      let k = 0;
      for (let i = 0; i < T.N - 8 && k < 80; i += 9) {
        const j = i + 8;
        if (Math.abs(T.curv[i]) < 0.004 || T.isBridge[i] || T.isBridge[j]) continue;
        const side = T.curv[i] > 0 ? 0 : 1, sg = side ? 1 : -1;
        if ((side === 0 && (T.pitOut[i] || T.pitOut[j])) || T.street[side][i] || T.street[side][j]) continue;
        const a = trackPoint(T, T.s[i], sg * (T.wall[side][i] + 5.4)), b = trackPoint(T, T.s[j], sg * (T.wall[side][j] + 5.4)), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const rule = { behind: 4, fromBarrier: 4.5, pad: 1 };
        if (!free(a.x, a.z, rule) || !free(b.x, b.z, rule) || !free(mx, mz, rule)) continue;
        const ya = yAt(a.x, a.z), yb = yAt(b.x, b.z), [vb, vt] = sponsorRow(rows[Math.floor(hash01(i, side, 5) * rows.length)]);
        const A = [a.x, ya + 0.5, a.z], B = [b.x, yb + 0.5, b.z], A2 = [a.x, ya + 1.9, a.z], B2 = [b.x, yb + 1.9, b.z];
        if (side === 1) kit.quad('sponsor', B, A, A2, B2, [[0, vb], [1, vb], [1, vt], [0, vt]]); else kit.quad('sponsor', A, B, B2, A2, [[0, vb], [1, vb], [1, vt], [0, vt]]);
        kit.quad('back', A, B, B2, A2);
        kit.box('post', 0.1, 1.9, 0.1, a.x, ya + 0.95, a.z);
        k++; count++;
      }
    }
    const mats = {
      sponsor: new THREE.MeshStandardMaterial({ map: tex.sharedSponsorAtlas(), roughness: 0.55, side: THREE.FrontSide }),
      back: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8, side: THREE.DoubleSide }),
      post: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.5 }),
    };
    const mesh = kit.build(mats, { debug: 'tyres' });
    g.add(mesh);
    stats.hoardings = count;
  }

  // ---- tree lines, well away from the circuit ------------------------------------------------------------------------------
  {
    const trees = [];
    for (let s = 0; s < T.length; s += 11) {
      for (const side of [0, 1]) {
        const seg = Math.floor(s / 160);
        if (hash01(seg, side, 11) > 0.42) continue;
        const i = wrapN(Math.round(s / T.ds), T.N), sg = side ? 1 : -1;
        const d = sg * (T.wall[side][i] + 46 + hash01(Math.round(s), side, 4) * 22);
        const p = trackPoint(T, s + (hash01(Math.round(s), side, 6) - 0.5) * 8, d);
        if (wallClearance(T, p.x, p.z) < 34) continue;
        if (blockers.some(b => Math.hypot(p.x - b.x, p.z - b.z) < b.r + 10)) continue;
        if (inStand(stands, p.x, p.z, 25)) continue;
        trees.push([p.x, p.z, 0.8 + hash01(Math.round(s), side, 8) * 0.9, hash01(Math.round(s), side, 9)]);
        if (trees.length >= 900) break;
      }
    }
    if (trees.length) {
      // five kinds: oak, pine, poplar, birch and a low bush, each an instanced trunk and crown
      const crownOf = (...parts) => mergeTwo(parts[0], parts[1] || parts[0]);
      const oakC = crownOf((() => { const c = new THREE.IcosahedronGeometry(2.7, 0); c.translate(0, 5.4, 0); return c; })(), (() => { const c = new THREE.IcosahedronGeometry(1.9, 0); c.translate(0.5, 7.4, 0.3); return c; })());
      const pineC = (() => { const a1 = new THREE.ConeGeometry(2.6, 4.2, 7); a1.translate(0, 4.2, 0); const a2 = new THREE.ConeGeometry(1.8, 3.6, 7); a2.translate(0, 6.9, 0); return mergeTwo(a1, a2); })();
      const popC = (() => { const c = new THREE.IcosahedronGeometry(1.5, 0); c.scale(1, 3.4, 1); c.translate(0, 7.2, 0); return c; })();
      const birchC = (() => { const c = new THREE.IcosahedronGeometry(1.9, 0); c.scale(1, 1.3, 1); c.translate(0, 5.8, 0); return c; })();
      const trunk = (r, h, c) => ({ g: (() => { const t = new THREE.CylinderGeometry(r * 0.65, r, h, 6); t.translate(0, h / 2, 0); return t; })(), c });
      const kinds = [
        { crown: oakC, ...trunk(0.34, 3.2, 0x5b4632), hue: [0.24, 0.07], l: [0.2, 0.08] },
        { crown: pineC, ...trunk(0.3, 2.4, 0x4a3a2a), hue: [0.36, 0.04], l: [0.13, 0.05] },
        { crown: popC, ...trunk(0.22, 3.0, 0x6a5a44), hue: [0.2, 0.06], l: [0.22, 0.08] },
        { crown: birchC, ...trunk(0.2, 3.6, 0xdad6cc), hue: [0.18, 0.06], l: [0.28, 0.08] },
      ];
      const byKind = kinds.map(() => []);
      trees.forEach(t => { const r = hash01(Math.round(t[0] * 3), Math.round(t[1] * 3), 12); byKind[r < 0.4 ? 0 : r < 0.62 ? 1 : r < 0.8 ? 2 : 3].push(t); });
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
      kinds.forEach((kd, ki) => {
        const list = byKind[ki];
        if (!list.length) return;
        const tr = new THREE.InstancedMesh(kd.g, new THREE.MeshLambertMaterial({ color: kd.c }), list.length);
        const lv = new THREE.InstancedMesh(kd.crown, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), list.length);
        list.forEach(([x, z, sc, h], k) => {
          e.set(0, h * 6.28, 0);
          m4.compose(new THREE.Vector3(x, yAt(x, z) - 0.2, z), q.setFromEuler(e), new THREE.Vector3(sc, sc * (0.9 + h * 0.3), sc));
          tr.setMatrixAt(k, m4); lv.setMatrixAt(k, m4);
          lv.setColorAt(k, c.setHSL(kd.hue[0] + h * kd.hue[1], 0.42, kd.l[0] + ((h * 31) % 1) * kd.l[1]));
        });
        tr.userData.debug = lv.userData.debug = 'grass';
        g.add(tr, lv);
      });
      // bushes close to the fence line, behind the catch fence
      const bushes = [];
      for (let s = 0; s < T.length; s += 23) for (const side of [0, 1]) {
        if (hash01(Math.round(s), side, 21) > 0.3) continue;
        const i = wrapN(Math.round(s / T.ds), T.N), sg = side ? 1 : -1;
        const p = trackPoint(T, s, sg * (T.wall[side][i] + 14 + hash01(Math.round(s), side, 22) * 12));
        if (free(p.x, p.z, { behind: 11, fromBarrier: 9, pad: 4 }) && !T.street[side][i] && !T.isBridge[i]) bushes.push([p.x, p.z, 0.7 + hash01(Math.round(s), side, 23) * 0.8, hash01(Math.round(s), side, 24)]);
      }
      if (bushes.length) {
        const bg = new THREE.IcosahedronGeometry(1.1, 0); bg.scale(1.3, 0.8, 1.1); bg.translate(0, 0.7, 0);
        const bm = new THREE.InstancedMesh(bg, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), bushes.length);
        bushes.forEach(([x, z, sc, h], k) => { e.set(0, h * 6.28, 0); m4.compose(new THREE.Vector3(x, yAt(x, z) - 0.15, z), q.setFromEuler(e), new THREE.Vector3(sc, sc, sc)); bm.setMatrixAt(k, m4); bm.setColorAt(k, c.setHSL(0.22 + h * 0.08, 0.4, 0.17 + ((h * 17) % 1) * 0.08)); });
        bm.userData.debug = 'grass';
        g.add(bm);
        stats.bushes = bushes.length;
      }
    }
    stats.trees = trees.length;
  }

  g.userData.stats = stats;
  return g;
}

function mergeTwo(a, b) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const geo of [a, b]) {
    const g = geo.index ? geo : geo.toNonIndexed();
    for (let k = 0; k < g.attributes.position.count; k++) {
      pos.push(g.attributes.position.getX(k), g.attributes.position.getY(k), g.attributes.position.getZ(k));
      nor.push(g.attributes.normal.getX(k), g.attributes.normal.getY(k), g.attributes.normal.getZ(k));
      uv.push(g.attributes.uv ? g.attributes.uv.getX(k) : 0, g.attributes.uv ? g.attributes.uv.getY(k) : 0);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx.push(g.index.getX(k) + base);
    else for (let k = 0; k < g.attributes.position.count; k++) idx.push(base + k);
    base += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
