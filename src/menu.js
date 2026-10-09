// The menu: a full screen overlay with a stack of screens. The main menu sits over a slowly orbiting view of the circuit; the
// pause menu, race setup, settings, online lobby, garage and results are screens on the same overlay.
//
// Layout: a rail (wordmark, nav, driver chip) on the left and the screen's pane on the right, for the screens that set
// `rail: true`. The rail is inside the card, so arrow keys and the gamepad reach its items like any other control.
//
// Plugging in a screen:   menu.addScreen('garage', { title: 'Garage', rail: true, mount(container, ctx) { ... }, unmount() { ... } })
// and opening it:         menu.push('garage')            (the Back button, Esc and the pad's B button pop it again)
// menu.jump(id) replaces everything above the main menu with one screen (the rail uses it), so Back returns to the main menu.
// ctx = { menu, settings, save, api, params, close() }. `api` is what the game gives the menu (see director.js).
//
// Navigation (arrows, Enter, Esc, a gamepad, number keys) comes from createMenuNav in menuNav.js, loaded with a dynamic import.
// If that file is missing, a small keyboard-only version in this file takes over, so the menu works whichever lands first.

const FOCUSABLE = 'button, input, select, [tabindex]';

const visible = el => !el.disabled && !el.hidden && el.getAttribute('tabindex') !== '-1' && el.getClientRects().length > 0;

// The fallback for focusMove: up and left go to the previous control, down and right to the next, in page order.
// Left and right on a slider change it.
function simpleFocusMove(container, dir) {
  const list = [...container.querySelectorAll(FOCUSABLE)].filter(visible);
  if (!list.length) return null;
  const cur = list.indexOf(document.activeElement);
  const ring = el => { for (const o of list) o.classList.toggle('pad-focus', o === el); el.focus(); return el; };
  if (cur < 0) return ring(list[0]);
  const el = list[cur];
  if ((dir === 'left' || dir === 'right') && el.tagName === 'INPUT' && el.type === 'range') {
    const step = +el.step || 1, v = Math.max(+el.min, Math.min(+el.max, +el.value + (dir === 'right' ? step : -step) * 5));
    el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
    return el;
  }
  const next = list[Math.max(0, Math.min(list.length - 1, cur + (dir === 'down' || dir === 'right' ? 1 : -1)))];
  return ring(next);
}

export function createMenu({ root, settings, save, api = {}, params = {}, build = '' }) {
  root.innerHTML = `
    <div class="m-shade"></div>
    <div class="m-wrap">
      <section class="m-card" role="dialog" aria-modal="true" aria-labelledby="m-title">
        <aside class="rail" hidden></aside>
        <div class="m-pane">
          <header class="m-head"><button type="button" class="m-back" data-back aria-label="Back">Back</button><h2 id="m-title"></h2></header>
          <div class="m-body"></div>
        </div>
      </section>
    </div>`;
  const card = root.querySelector('.m-card'), rail = root.querySelector('.rail'), body = root.querySelector('.m-body'), title = root.querySelector('#m-title'), backBtn = root.querySelector('.m-back');
  const screens = new Map();
  const stack = [];            // { id, def, mounted }
  const menu = {
    root, card, body, screens,
    isOpen: false,
    tick: 0,                   // counts opens and closes: the game uses it to ignore the key press that closed the menu
    kind: 'main',              // 'main' (over the orbiting circuit) or 'pause' (over the stopped game)
    build,
    onClose: null,
    buildRail: null,           // set by registerScreens: (ctx, top) => the rail's nodes
  };
  const ctx = { menu, settings, save, api, params, close: () => menu.close(), build };

  menu.addScreen = (id, def) => { screens.set(id, def); return menu; };
  menu.hasScreen = id => screens.has(id);
  menu.get = id => screens.get(id);
  menu.current = () => (stack.length ? stack[stack.length - 1] : null);

  function mountTop(opts = {}) {
    const top = menu.current();
    for (const c of [...body.children]) c.remove();
    body.scrollTop = 0;
    rail.replaceChildren();
    if (!top) return;
    const def = top.def;
    root.dataset.screen = top.id;
    root.dataset.home = def.home ? '1' : '0';
    const railOn = !!def.rail && typeof menu.buildRail === 'function';
    root.dataset.rail = railOn ? '1' : '0';
    rail.hidden = !railOn;
    if (railOn) rail.append(...menu.buildRail(ctx, top));
    title.textContent = typeof def.title === 'function' ? def.title(top.params) : def.title || '';
    card.setAttribute('aria-label', title.textContent);
    backBtn.hidden = !!def.home || (stack.length < 2 && !def.backable);
    backBtn.textContent = def.backLabel || 'Back';
    const holder = document.createElement('div');
    holder.className = 'm-screen' + (opts.keepFocus ? '' : ' m-screen-in');   // the enter motion plays on a new screen, not on a refresh
    body.append(holder);
    top.holder = holder;
    try { top.mounted = def.mount(holder, { ...ctx, params: top.params || {}, screenId: top.id }) || null; } catch (e) { console.error(e); holder.textContent = 'This screen could not be opened.'; }
    if (!opts.keepFocus) focusFirst();
  }
  function unmountTop() {
    const top = menu.current();
    if (!top) return;
    try { if (def_unmount(top)) { /* done */ } } catch (e) { console.error(e); }
    top.holder && top.holder.remove();
  }
  function def_unmount(top) {
    if (top.def.unmount) top.def.unmount(top.mounted);
    else if (top.mounted && typeof top.mounted.dispose === 'function') top.mounted.dispose();
    return true;
  }

  // focus the main control of the screen: [data-first] (the rail's resume button counts), else the first control
  function focusFirst() {
    const first = card.querySelector('[data-first]:not([disabled])') || [...body.querySelectorAll(FOCUSABLE)].find(visible);
    if (!first) return;
    for (const o of card.querySelectorAll('.pad-focus')) o.classList.remove('pad-focus');
    first.classList.add('pad-focus');
    try { first.focus({ preventScroll: true }); } catch (e) { /* not focusable yet */ }
  }
  menu.focusFirst = focusFirst;

  // show the menu: kind 'main' or 'pause', starting at screen `id`
  menu.open = (id = 'main', kind = 'main', params) => {
    if (menu.isOpen) { for (const t of stack.splice(0).reverse()) { try { def_unmount(t); } catch (e) { /* closing */ } } }
    menu.kind = kind;
    root.dataset.kind = kind;
    root.hidden = false;
    menu.isOpen = true;
    menu.tick++;
    document.body.classList.add('menu-open', kind === 'main' ? 'menu-main' : 'menu-pause');
    document.body.classList.remove(kind === 'main' ? 'menu-pause' : 'menu-main');
    stack.length = 0;
    stack.push({ id, def: screens.get(id) || screens.get('coming'), params });
    mountTop();
    return menu;
  };
  menu.push = (id, params) => {
    const def = screens.get(id) || screens.get('coming');
    unmountTop();
    stack.push({ id, def, params: params || (screens.has(id) ? undefined : { name: id }) });
    mountTop();
    return menu;
  };
  // from the main menu: show `id` directly above the main menu (the stack is never deeper than two), so Back goes home
  menu.jump = (id, params) => {
    if (!menu.isOpen || menu.kind !== 'main') return menu.push(id, params);
    unmountTop();
    stack.length = id === 'main' ? 0 : Math.min(stack.length, 1);
    if (!stack.length) stack.push({ id: 'main', def: screens.get('main') });
    if (id !== 'main') stack.push({ id, def: screens.get(id) || screens.get('coming'), params: params || (screens.has(id) ? undefined : { name: id }) });
    mountTop();
    return menu;
  };
  // back one screen; from the first screen of a pause menu that resumes, from the main menu it does nothing
  menu.pop = () => {
    if (stack.length > 1) { unmountTop(); stack.pop(); mountTop(); return true; }
    const top = menu.current();
    if (top && top.def.onBack) return top.def.onBack(ctx) !== false;
    if (menu.kind === 'pause') { menu.close(); return true; }
    return false;
  };
  // replace the current screen
  menu.replace = (id, params) => { unmountTop(); stack.pop(); stack.push({ id, def: screens.get(id) || screens.get('coming'), params }); mountTop(); return menu; };
  menu.close = () => {
    if (!menu.isOpen) return;
    for (const t of stack.splice(0).reverse()) { try { def_unmount(t); } catch (e) { /* closing */ } }
    menu.isOpen = false;
    menu.tick++;
    root.hidden = true;
    document.body.classList.remove('menu-open', 'menu-main', 'menu-pause');
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
    menu.onClose && menu.onClose();
  };
  // rebuild only the rail (the driver chip shows the car and the paint), leaving the screen as it is
  menu.refreshRail = () => { const top = menu.current(); if (menu.isOpen && top && !rail.hidden && typeof menu.buildRail === 'function') rail.replaceChildren(...menu.buildRail(ctx, top)); };
  menu.refresh = () => { if (menu.isOpen) { unmountTop(); mountTop({ keepFocus: true }); } };

  backBtn.addEventListener('click', () => menu.pop());

  // --- navigation ---
  let navMod = null, nav = null, fallbackKeys = null;
  const handle = dir => {
    if (!menu.isOpen) return;
    const top = menu.current();
    if (typeof dir === 'string' && dir.startsWith('digit:')) { if (top && top.def.onDigit) top.def.onDigit(+dir.slice(6), top.mounted, ctx); return; }
    if (top && top.def.onNav && top.def.onNav(dir, top.mounted, ctx) === true) return;
    if (dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right') {
      if (navMod) navMod.focusMove(card, dir); else simpleFocusMove(card, dir);
    } else if (dir === 'confirm') {
      const el = document.activeElement;
      if (navMod && navMod.activateFocused(card)) return;
      if (!navMod && el && card.contains(el) && el.tagName !== 'INPUT') el.click();
      else if (!card.contains(el)) focusFirst();
    } else if (dir === 'back') menu.pop();
    else if (dir === 'start') { if (menu.kind === 'pause') menu.close(); }
    else if (dir === 'tab-left' || dir === 'tab-right') { if (top && top.def.onTab) top.def.onTab(dir === 'tab-right' ? 1 : -1, top.mounted); }
  };
  menu.handle = handle;

  function useFallback() {
    if (fallbackKeys) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Escape: 'back', KeyQ: 'tab-left', KeyE: 'tab-right' };
    fallbackKeys = e => {
      if (!menu.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = document.activeElement, typing = t && (t.isContentEditable || (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !['range', 'button', 'checkbox'].includes(t.type)));
      const dir = map[e.code];
      if (!dir || (typing && e.code !== 'Escape')) return;
      if (e.repeat && dir === 'confirm') return;
      e.preventDefault();
      handle(dir);
    };
    addEventListener('keydown', fallbackKeys);
  }
  import('./menuNav.js').then(m => {
    if (typeof m.createMenuNav !== 'function' || typeof m.focusMove !== 'function') throw new Error('menuNav.js has no createMenuNav');
    navMod = m;
    nav = m.createMenuNav(handle);
    nav.enabled = menu.isOpen;
  }).catch(() => useFallback());

  // every frame: polls the pad while the menu is open, and keeps the nav off while the game is being driven
  menu.update = dt => {
    if (!nav) return;
    nav.enabled = menu.isOpen;
    if (menu.isOpen) nav.update(dt);
  };

  // clicking anywhere inside the card gives the focus ring to what was clicked, so the keys carry on from there
  card.addEventListener('pointerdown', e => {
    const b = e.target.closest(FOCUSABLE);
    for (const o of card.querySelectorAll('.pad-focus')) o.classList.remove('pad-focus');
    if (b) b.classList.remove('pad-focus');
  });

  return menu;
}
