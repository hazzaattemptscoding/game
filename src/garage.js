// The garage: the screen where a player paints their car. Everything inside `container` is built here; the menu (or the
// ?garage overlay in main.js) only supplies the box.
//
//   const g = mountGarage(container, { settings, save, onChange });   ... g.dispose();
//
// settings.livery holds the choice (a livery object, see src/livery.js; null means the default for this browser's player id).
// save() is called after each change so the caller can persist the settings; onChange(livery) is called live with the new
// normalised livery so the car on the track repaints. The room sees the same paint: it is sent with the hello and every 2 s.

import * as THREE from 'three';
import { CarView } from './car.js';
import { GT } from './cars.js';
import { BODY_COLOURS, ACCENT_COLOURS, STRIPE_STYLES, LIVERY_SPONSORS, SPONSOR_NAMES, MAX_NAME, normaliseLivery, cleanLiveryName, ownLivery, localPlayerId, liveryEquals } from './livery.js';
import { sponsorBoard } from './textures.js';

const CSS = `
.gar { box-sizing: border-box; max-width: 980px; margin: 0 auto; padding: 0; color: var(--text); font-variant-numeric: tabular-nums; }
.gar * { box-sizing: border-box; }
.gar h2 { display: none; }
/* a section: a small uppercase title, 12px above its card, 28px between sections (the menu's group treatment) */
.gar-sec { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
.gar-sec + .gar-sec { margin-top: var(--s-7); }
.gar h3 { margin: 0; font-family: var(--f-body); font-size: 11px; font-weight: 600; font-style: normal; line-height: 1.4; letter-spacing: .14em; text-transform: uppercase; color: var(--text-faint); }
.gar-card { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; padding: var(--s-4) var(--s-5); background: var(--pit-1); border: 1px solid var(--line); border-radius: var(--r-card); }
.gar-note { margin: var(--s-2) 0 0; font-size: 13px; color: var(--text-dim); }
.gar-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: var(--s-6); align-items: start; }
@media (max-width: 760px) { .gar-grid { grid-template-columns: 1fr; } .gar-view { height: 30vh; } }
.gar-prev { position: sticky; top: 0; z-index: 1; background: var(--pit-1); padding-bottom: var(--s-2); border-radius: var(--r-card); }
.gar-view { position: relative; width: 100%; height: min(44vh, 400px); min-height: 200px; border-radius: var(--r-card); background: radial-gradient(ellipse at 50% 70%, var(--pit-3), var(--pit-0)); overflow: hidden; }
.gar-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gar-flat { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.gar-flat div { width: 62%; height: 38%; position: relative; border-radius: 18px 40px 10px 10px; }
.gar-flat b { position: absolute; right: 14%; top: 28%; width: 34%; aspect-ratio: 1; border-radius: 50%; background: var(--text); color: var(--pit-0); display: flex; align-items: center; justify-content: center; font-family: var(--f-display); font-size: 28px; }
.gar-name { margin-top: var(--s-2); padding: 0 var(--s-2); font-family: var(--f-display); font-size: 22px; font-weight: 600; min-height: 28px; }
.gar-name em { font-style: normal; color: var(--text-faint); margin-right: var(--s-2); }
/* swatches: 36px circles in a wrapping grid, 10px apart */
.gar-sw { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.gar-sw button { width: 36px; height: 36px; padding: 0; flex: none; border: 2px solid var(--line-strong); border-radius: 50%; cursor: pointer; font: inherit; transition: transform 120ms var(--ease-out); }
.gar-sw button:hover { transform: scale(1.06); }
.gar-sw button:active { transform: scale(.98); }
.gar-sw button.sel { border-color: var(--text); box-shadow: 0 0 0 2px var(--pit-1), 0 0 0 4px var(--accent-soft); }
.gar-sw .gar-custom { display: flex; align-items: center; gap: var(--s-2); margin-left: var(--s-2); font-size: 13px; color: var(--text-dim); cursor: pointer; }
.gar-sw input[type=color] { width: 36px; height: 36px; flex: none; padding: 0; border: 2px solid var(--line-strong); border-radius: 50%; background: var(--pit-0); cursor: pointer; overflow: hidden; }
.gar-sw input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
.gar-sw input[type=color]::-webkit-color-swatch { border: 0; border-radius: 50%; }
.gar-row { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.gar button.opt { flex: 1 1 110px; min-height: 44px; padding: 0 var(--s-3); border: 1px solid var(--line-strong); border-radius: var(--r-ctl); background: transparent; color: var(--text-dim); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: background-color 120ms var(--ease-out), transform 120ms var(--ease-out); }
.gar button.opt:hover { background: var(--pit-3); color: var(--text); }
.gar button.opt:active { transform: scale(.98); }
.gar button.opt.sel { background: var(--accent-tint); border-color: var(--accent); color: var(--text); }
.gar input[type=text] { font: inherit; font-size: 15px; height: 44px; padding: 0 var(--s-3); border: 1px solid var(--line-strong); border-radius: var(--r-ctl); background: var(--pit-0); color: var(--text); user-select: text; -webkit-user-select: text; touch-action: auto; min-width: 0; }
.gar input.num { width: 90px; flex: none; text-align: center; font-family: var(--f-display); font-weight: 600; font-size: 22px; }
.gar input.nm { flex: 1 1 180px; }
/* sponsors: three tiles across, the board picture as wide as the tile */
.gar-spons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.gar-spons button { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 6px; min-width: 0; border: 1px solid var(--line); border-radius: var(--r-ctl); background: var(--pit-2); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; text-align: left; transition: transform 120ms var(--ease-out), background-color 120ms var(--ease-out); }
.gar-spons button:hover { background: var(--pit-3); }
.gar-spons button:active { transform: scale(.98); }
.gar-spons button.sel { border-color: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-soft); }
.gar-spons canvas { width: 100%; height: auto; display: block; background: var(--pit-0); border-radius: 4px; }
.gar-spons span { color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the footer stays at the bottom of the pane while the sections scroll above it */
.gar-foot { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; margin-top: var(--s-6); padding: var(--s-4) 0 var(--s-5); background: var(--pit-1); border-top: 1px solid var(--line); }
.gar-foot p { margin: 0; font-size: 13px; color: var(--text-dim); }
.gar button.reset { min-height: 44px; padding: 0 var(--s-4); border: 1px solid var(--line-strong); border-radius: var(--r-ctl); background: transparent; color: var(--text); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
.gar button.reset:hover { background: var(--pit-3); }
.gar button:focus-visible, .gar input:focus-visible { outline: 2px solid var(--accent-soft); outline-offset: 2px; }
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountGarage(container, { settings, save = () => {}, onChange = () => {} }) {
  const style = el('style'); style.textContent = CSS;
  const root = el('div', 'gar');
  container.append(style, root);
  const pid = localPlayerId();
  let livery = ownLivery(settings.livery, pid);
  let disposed = false;

  // --- header and preview ---
  root.append(el('h2', '', 'Garage'));
  root.append(el('p', 'gar-note', 'Everyone sees your car like this.'));
  const grid = el('div', 'gar-grid'), left = el('div', 'gar-prev'), right = el('div');
  grid.append(left, right);
  root.append(grid);
  const viewBox = el('div', 'gar-view');
  const nameLine = el('div', 'gar-name');
  left.append(viewBox, nameLine);

  // 3D preview, or a flat swatch when WebGL is not there
  let renderer = null, scene = null, camera = null, car = null, raf = 0, ro = null, flat = null;
  try {
    const canvas = el('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    viewBox.append(canvas);
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6a707a, 2.0));
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2); sun.position.set(-4, 7, 5); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9); rim.position.set(5, 3, -6); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshStandardMaterial({ color: 0x1a1e23, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    car = new CarView(GT, livery);
    scene.add(car.root);
    camera = new THREE.PerspectiveCamera(32, 1.6, 0.1, 100);
    const size = () => {
      const w = Math.max(1, viewBox.clientWidth), h = Math.max(1, viewBox.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    size();
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(size); ro.observe(viewBox); }
    let t0 = performance.now(), ang = -0.9;
    const loop = now => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - t0) / 1000); t0 = now;
      if (!document.hidden && viewBox.clientWidth > 0) {
        ang += dt * 0.35;
        const aspect = camera.aspect, dist = aspect < 1.3 ? 8.6 : 6.6;
        camera.position.set(Math.cos(ang) * dist, 2.6, Math.sin(ang) * dist);
        camera.lookAt(0, 0.6, 0);
        for (const w of car.wheels) w.spin.rotation.z = -ang * 2;
        renderer.render(scene, camera);
      }
    };
    raf = requestAnimationFrame(loop);
  } catch (e) {
    if (renderer) { try { renderer.dispose(); } catch (e2) { /* nothing to free */ } }
    renderer = null; scene = null; car = null;
    viewBox.replaceChildren();
    flat = el('div', 'gar-flat');
    flat.append(el('div'));
    viewBox.append(flat);
  }

  function paintFlat() {
    if (!flat) return;
    const d = flat.firstChild;
    const stripe = livery.style === 1 ? `linear-gradient(90deg, transparent 44%, ${livery.stripe} 44% 56%, transparent 56%)` : livery.style === 2 ? `linear-gradient(90deg, transparent 36%, ${livery.stripe} 36% 42%, transparent 42% 58%, ${livery.stripe} 58% 64%, transparent 64%)` : livery.style === 3 ? `linear-gradient(160deg, transparent 55%, ${livery.stripe} 55% 80%, transparent 80%)` : 'none';
    d.style.background = `${stripe}, ${livery.body}`;
    d.style.borderBottom = `10px solid ${livery.wing}`;
    d.replaceChildren();
    if (livery.number >= 0) d.append(el('b', '', String(livery.number)));
  }

  // --- controls: one section per setting, each a title over a card ---
  const swatches = {};        // field -> { buttons, input }
  const sec = title => {
    const s = el('section', 'gar-sec'), card = el('div', 'gar-card');
    s.append(el('h3', '', title), card);
    right.append(s);
    return card;
  };
  function colourRow(title, field, list) {
    const card = sec(title);
    const row = el('div', 'gar-sw');
    const buttons = list.map(c => {
      const b = el('button'); b.type = 'button'; b.style.background = c; b.title = c; b.setAttribute('aria-label', `${title} ${c}`);
      b.addEventListener('click', () => set({ [field]: c }));
      row.append(b);
      return b;
    });
    const lab = el('label', 'gar-custom', 'Custom'), input = el('input'); input.type = 'color'; input.setAttribute('aria-label', `${title}, custom colour`);
    input.addEventListener('input', () => set({ [field]: input.value }));
    lab.prepend(input);
    row.append(lab);
    card.append(row);
    swatches[field] = { buttons, list, input };
  }
  colourRow('Body colour', 'body', BODY_COLOURS);
  colourRow('Stripe colour', 'stripe', ACCENT_COLOURS);
  colourRow('Wing colour', 'wing', ACCENT_COLOURS.concat(['#1b1d20']));

  const styleRow = el('div', 'gar-row');
  const styleBtns = STRIPE_STYLES.map((n, i) => {
    const b = el('button', 'opt', n); b.type = 'button';
    b.addEventListener('click', () => set({ style: i }));
    styleRow.append(b);
    return b;
  });
  sec('Stripe style').append(styleRow);

  const idRow = el('div', 'gar-row');
  const numIn = el('input', 'num'); numIn.type = 'text'; numIn.inputMode = 'numeric'; numIn.maxLength = 2; numIn.placeholder = 'No.'; numIn.setAttribute('aria-label', 'Race number, 0 to 99');
  numIn.autocomplete = 'off'; numIn.spellcheck = false;
  numIn.addEventListener('input', () => {
    const digits = numIn.value.replace(/\D/g, '').slice(0, 2);
    if (digits !== numIn.value) numIn.value = digits;
    set({ number: digits === '' ? -1 : +digits }, true);
  });
  const nameIn = el('input', 'nm'); nameIn.type = 'text'; nameIn.maxLength = MAX_NAME; nameIn.placeholder = 'Name on the car'; nameIn.setAttribute('aria-label', 'Name');
  nameIn.autocomplete = 'off'; nameIn.spellcheck = false;
  nameIn.addEventListener('input', () => set({ name: cleanLiveryName(nameIn.value) }, true));
  nameIn.addEventListener('change', () => { nameIn.value = livery.name; });
  idRow.append(numIn, nameIn);
  sec('Race number and name').append(idRow);

  const sponsRow = el('div', 'gar-spons');
  const sponsBtns = [['', 'None'], ...LIVERY_SPONSORS.map(id => [id, SPONSOR_NAMES[id] || id])].map(([id, label]) => {
    const b = el('button'); b.type = 'button';
    const c = el('canvas'); c.width = 320; c.height = 40;
    drawSponsorPreview(c, id, label);
    b.append(c, el('span', '', label));
    b.addEventListener('click', () => set({ sponsor: id }));
    sponsRow.append(b);
    return [id, b];
  });
  sec('Sponsor').append(sponsRow);

  // the footer: pinned at the bottom of the pane
  const foot = el('div', 'gar-foot');
  foot.append(el('p', '', 'Changes save as you make them.'));
  const reset = el('button', 'reset', 'Reset to default'); reset.type = 'button';
  reset.addEventListener('click', () => {
    settings.livery = null;
    livery = ownLivery(null, pid);
    save();
    sync(true);
    onChange(livery);
  });
  foot.append(reset);
  root.append(foot);

  // --- state ---
  function set(patch, keepFields = false) {
    const next = normaliseLivery({ ...livery, ...patch });
    if (liveryEquals(next, livery)) return;
    livery = next;
    settings.livery = next;
    save();
    sync(!keepFields);
    onChange(next);
  }

  function sync(fields) {
    if (car) car.setLivery(livery); else paintFlat();
    nameLine.replaceChildren();
    if (livery.number >= 0) nameLine.append(el('em', '', '#' + livery.number));
    nameLine.append(document.createTextNode(livery.name || 'Your name'));
    for (const [field, { buttons, list, input }] of Object.entries(swatches)) {
      buttons.forEach((b, i) => b.classList.toggle('sel', list[i] === livery[field]));
      input.value = livery[field];
    }
    styleBtns.forEach((b, i) => b.classList.toggle('sel', i === livery.style));
    for (const [id, b] of sponsBtns) b.classList.toggle('sel', id === livery.sponsor);
    if (fields) {
      numIn.value = livery.number >= 0 ? String(livery.number) : '';
      nameIn.value = livery.name;
    }
  }
  sync(true);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (car) { scene.remove(car.root); car.dispose(); }
      if (scene) scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); } });
      if (renderer) { renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); }
      style.remove(); root.remove();
    },
  };
}

// a small picture of a sponsor board for the picker: the real board from the sponsor sheet, or the name in plain text
function drawSponsorPreview(c, id, label) {
  const x = c.getContext('2d');
  x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height);
  if (!id) {
    x.fillStyle = '#9aa0a6'; x.font = 'bold 20px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('no sponsor', c.width / 2, c.height / 2 + 1);
    return;
  }
  try {
    const b = sponsorBoard(id);
    x.drawImage(b.canvas, 0, b.row * 128, 1024, 128, 0, 0, c.width, c.height);
  } catch (e) {
    x.fillStyle = '#f2efe6'; x.font = 'bold 22px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, c.width / 2, c.height / 2 + 1);
  }
}
