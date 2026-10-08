// Phase 1 HUD: speed, gear, revs, lap and sector times with deltas, DRS and
// assist lights, plus a handling readout (I or F3) for tuning. The full HUD
// with position, minimap and weather comes in phase 4.

import { SURF, SURF_NAMES } from './track.js';
import { hudClasses, HUD_KEYS } from './hudSettings.js';
import { MINISECTORS } from './minisectors.js';

const SURF_NAME = SURF_NAMES;

export function fmtTime(t) {
  if (t == null) return '-:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// DOM writes only when the value changed: at 120 Hz and up most frames repeat the last text, class or transform.
const text = (el, v) => { v = String(v); if (el._t !== v) { el._t = v; el.textContent = v; } };
const cls = (el, v) => { if (el._c !== v) { el._c = v; el.className = v; } };
const style = (el, v) => { if (el._s !== v) { el._s = v; el.style.transform = v; } };

const fmtDelta = d => (d < 0 ? '-' : '+') + Math.abs(d).toFixed(3);

export class Hud {
  constructor(root, settings) {
    this.settings = settings;
    root.innerHTML = `
      <div class="hud-times">
        <div class="hud-lap" id="h-lap">-:--.---</div>
        <div class="hud-rows">
          <div><span>Last</span><b id="h-last">-:--.---</b></div>
          <div><span>Best</span><b id="h-best">-:--.---</b></div>
        </div>
        <div class="hud-live" id="h-live" hidden><b id="h-live-t">+0.000</b><span class="hud-live-bar"><i id="h-live-bar"></i></span></div>
        <div class="hud-sectors" id="h-sec"></div>
        <div class="hud-mini" id="h-mini">${'<i></i>'.repeat(MINISECTORS)}</div>
        <div class="hud-limits" id="h-limits" hidden></div>
        <div class="hud-stand" id="h-stand" hidden></div>
        <div class="hud-fps" id="h-fps">FPS 0</div>
      </div>
      <div class="hud-flash" id="h-flash"></div>
      <div class="hud-warn" id="h-warn"></div>
      <div class="hud-dash">
        <div class="hud-rev"><i id="h-rev"></i></div>
        <div class="hud-main">
          <div class="hud-speed"><b id="h-speed">0</b><span id="h-unit">mph</span></div>
          <div class="hud-gear" id="h-gear">1</div>
        </div>
        <div class="hud-lights">
          <span id="h-pit">PIT</span><span id="h-drs">DRS</span><span id="h-tc">TC</span><span id="h-abs">ABS</span><span id="h-esc">ESC</span>
        </div>
      </div>
      <div class="hud-inputs">
        <div class="hud-pedals"><span><i id="h-brk"></i></span><span><i id="h-thr"></i></span></div>
        <div class="hud-keys"><b id="h-ku">W</b><b id="h-kl">A</b><b id="h-kd">S</b><b id="h-kr">D</b></div>
      </div>
      <pre class="hud-debug" id="h-debug"></pre>
      <div class="hud-help" id="h-help">Arrows or WASD to drive · Space for DRS · R reset · C camera · L racing line · Esc menu</div>`;
    const $ = id => root.querySelector('#' + id);
    this.el = { lap: $('h-lap'), last: $('h-last'), best: $('h-best'), sec: $('h-sec'), mini: $('h-mini'), flash: $('h-flash'), warn: $('h-warn'), limits: $('h-limits'), rev: $('h-rev'), speed: $('h-speed'), unit: $('h-unit'), gear: $('h-gear'), pit: $('h-pit'), drs: $('h-drs'), tc: $('h-tc'), abs: $('h-abs'), esc: $('h-esc'), debug: $('h-debug'), help: $('h-help'), fps: $('h-fps'), live: $('h-live'), liveT: $('h-live-t'), liveBar: $('h-live-bar'), brk: $('h-brk'), thr: $('h-thr'), ku: $('h-ku'), kl: $('h-kl'), kd: $('h-kd'), kr: $('h-kr') };
    this.root = root;
    this._layout = '';
    this.perf = 'FPS';    // the FPS readout text, set from the loop (src/main.js)
    this.flashUntil = 0;
    this.warnUntil = 0;
    this.warnLap = -1;   // the lap the counter was last drawn for
    // ?warn=Aileron shows the track limits banner at the start, for checking how it looks
    const forced = new URLSearchParams(location.search).get('warn');
    if (forced) { this.warn(forced, 0); this.forcedWarn = forced; }
    this.sectorCells = [];
    this.miniCells = [...this.el.mini.children];
    this._miniKey = '';
    setTimeout(() => this.el.help.classList.add('fade'), 9000);
  }

  flash(text, now, cls = '') {
    this.el.flash.textContent = text;
    this.el.flash.className = 'hud-flash show ' + cls;
    this.flashUntil = now + 2.5;
  }

  // track limits banner: amber on the dark HUD, 2.5 s
  warn(corner, now) {
    this.el.warn.textContent = 'Track limits: ' + corner;
    this.el.warn.className = 'hud-warn show';
    this.warnUntil = now + 2.5;
  }

  // Which parts show: classes on the body (src/style.css) and the HUD scale. Cheap, so it runs every frame and the settings
  // screen needs no hook into the HUD.
  applyLayout() {
    const s = this.settings, key = hudClasses(s).join(' ') + '|' + s.hudScale;
    if (key === this._layout) return;
    this._layout = key;
    const body = document.body;
    for (const k of [...HUD_KEYS, 'lights']) body.classList.remove('hx-no-' + k);
    for (const c of hudClasses(s)) body.classList.add(c);
    this.root.style.setProperty('--hs', (s.hudScale / 100).toFixed(2));
  }

  update(car, timer, track, simTime, input) {
    const e = this.el, s = this.settings;
    this.applyLayout();
    if (s.hud.fps) text(e.fps, this.perf);
    if (input && (s.hud.pedals || s.hud.inputOverlay)) {
      style(e.thr, `scaleY(${Math.max(0, Math.min(1, input.throttle)).toFixed(2)})`);
      style(e.brk, `scaleY(${Math.max(0, Math.min(1, input.brake)).toFixed(2)})`);
      cls(e.ku, input.throttle > 0.05 ? 'on' : ''); cls(e.kd, input.brake > 0.05 ? 'on' : '');
      cls(e.kl, input.steer < -0.05 ? 'on' : ''); cls(e.kr, input.steer > 0.05 ? 'on' : '');
    }
    const mph = s.units === 'mph';
    text(e.speed, Math.round(Math.abs(car.fwdSpeed) * (mph ? 2.23694 : 3.6)));
    text(e.unit, mph ? 'mph' : 'km/h');
    text(e.gear, car.gear < 0 ? 'R' : car.gear);
    const rev = Math.max(0, (car.rpm - car.cfg.idleRpm) / (car.cfg.redline - car.cfg.idleRpm));
    style(e.rev, `scaleX(${Math.min(1, rev).toFixed(3)})`);
    cls(e.rev, car.rpm > car.cfg.upshiftRpm - 300 ? 'hot' : '');

    cls(e.drs, car.drs ? 'on' : track.inDRS(car.loc.s) ? 'zone' : '');
    cls(e.pit, car.pitLimiter ? 'on' : '');
    // each assist chip: struck through and dim when that assist is switched off, lit when it is working, grey when it is ready
    cls(e.tc, car.assistTc ? (car.tc ? 'act' : 'arm') : 'off');
    cls(e.abs, car.assistAbs ? (car.abs ? 'act' : 'arm') : 'off');
    cls(e.esc, car.assistEsc ? (car.esc ? 'act' : 'arm') : 'off');

    text(e.lap, fmtTime(timer.running(simTime)));
    text(e.last, fmtTime(timer.last));
    text(e.best, fmtTime(timer.best));

    // live delta to the session's best lap: hidden until there is one, held to 1 decimal place of change per frame
    const ld = timer.delta ? timer.delta(simTime) : null;
    if (ld === null) { if (!e.live.hidden) e.live.hidden = true; }
    else {
      if (e.live.hidden) e.live.hidden = false;
      text(e.liveT, fmtDelta(ld));
      const cls = ld <= 0 ? 'ahead' : 'behind';
      if (e.live.dataset.s !== cls) e.live.dataset.s = cls;
      const w = Math.min(1, Math.abs(ld) / 2) * 50;   // a full half-bar at 2 s
      const style = ld <= 0 ? `left:${50 - w}%;width:${w}%` : `left:50%;width:${w}%`;
      if (e.liveBar.getAttribute('style') !== style) e.liveBar.setAttribute('style', style);
    }

    // sector splits for the current lap, coloured against your best
    const cells = [];
    for (let i = 0; i < 3; i++) {
      const t = timer.current[i];
      if (t == null) { cells.push(`<i>S${i + 1}</i>`); continue; }
      const cls = timer.sectorPB[i] ? 'pb' : 'slow';   // purple, decided when the sector ended (src/timing.js)
      const d = s.hud.delta && timer.lastSectors && timer.lastSectors[i] != null ? ' ' + fmtDelta(t - timer.lastSectors[i]) : '';
      cells.push(`<i class="${cls}">S${i + 1} ${t.toFixed(2)}${d}</i>`);
    }
    const html = cells.join('');
    if (html !== this._secHtml) { e.sec.innerHTML = html; this._secHtml = html; }

    // minisectors: one segment each, purple / green / yellow like the sector times, the one being driven outlined; redrawn only on a change
    if (s.hud.minisectors) {
      const m = timer.minis, shown = m.display(), cur = m.on ? m.index : -1, key = shown.join() + '|' + cur;
      if (key !== this._miniKey) {
        this._miniKey = key;
        this.miniCells.forEach((c, i) => { c.className = (shown[i] || '') + (i === cur ? ' cur' : ''); });
      }
    }

    for (const ev of timer.takeEvents()) {
      if (ev.type === 'lap') this.flash((ev.best ? 'Best lap ' : 'Lap ') + fmtTime(ev.time) + (ev.valid ? '' : ' invalid'), simTime, ev.best ? 'pb' : '');
      else if (ev.index < 2) this.flash(`S${ev.index + 1}  ${ev.time.toFixed(3)}`, simTime, ev.best ? 'pb' : '');
    }
    if (this.flashUntil && simTime > this.flashUntil) { e.flash.className = 'hud-flash'; this.flashUntil = 0; }

    // track limits: banner for each new warning, and the count for this lap beside the lap timer
    for (const ev of timer.limits.takeNew()) this.warn(ev.corner, simTime);
    if (this.forcedWarn) { this.warnUntil = simTime + 2.5; }   // ?warn= keeps the banner up
    if (this.warnUntil && simTime > this.warnUntil) { e.warn.className = 'hud-warn'; this.warnUntil = 0; }
    const lap = timer.currentLap(), n = timer.limits.countFor(lap);
    if (n !== this._limN || lap !== this._limLap) {
      this._limN = n; this._limLap = lap;
      e.limits.hidden = n === 0;
      e.limits.textContent = `Track limits ${n}`;
    }

    if (s.debug) {
      e.debug.style.display = 'block';
      e.debug.textContent =
        `slip F ${car.slipF.toFixed(2)}  R ${car.slipR.toFixed(2)}  (1.00 = peak grip)\n` +
        `lat ${(car.ay / 9.81).toFixed(2)} g  long ${(car.ax / 9.81).toFixed(2)} g\n` +
        `steer ${(car.steer * 57.3).toFixed(1)}°  limit ${(car.steerRange * 57.3).toFixed(1)}°\n` +
        `rpm ${car.rpm.toFixed(0)}  yaw ${car.yawRate.toFixed(2)}\n` +
        `wheels ${car.wheelSurf.map(w => SURF_NAME[w]).join(' ')}\n` +
        `s ${car.loc.s.toFixed(0)} m  d ${car.loc.d.toFixed(1)} m  h ${car.y.toFixed(1)} m`;
    } else e.debug.style.display = 'none';
  }
}
