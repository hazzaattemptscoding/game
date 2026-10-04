// Phase 1 HUD: speed, gear, revs, lap and sector times with deltas, DRS and
// assist lights, plus a handling readout (I or F3) for tuning. The full HUD
// with position, minimap and weather comes in phase 4.

import { SURF, SURF_NAMES } from './track.js';

const SURF_NAME = SURF_NAMES;

export function fmtTime(t) {
  if (t == null) return '-:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

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
        <div class="hud-sectors" id="h-sec"></div>
        <div class="hud-limits" id="h-limits" hidden></div>
        <div class="hud-stand" id="h-stand" hidden></div>
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
      <pre class="hud-debug" id="h-debug"></pre>
      <div class="hud-help" id="h-help">Arrows or WASD to drive · Space for DRS · R reset · C camera · Esc settings</div>`;
    const $ = id => root.querySelector('#' + id);
    this.el = { lap: $('h-lap'), last: $('h-last'), best: $('h-best'), sec: $('h-sec'), flash: $('h-flash'), warn: $('h-warn'), limits: $('h-limits'), rev: $('h-rev'), speed: $('h-speed'), unit: $('h-unit'), gear: $('h-gear'), pit: $('h-pit'), drs: $('h-drs'), tc: $('h-tc'), abs: $('h-abs'), esc: $('h-esc'), debug: $('h-debug'), help: $('h-help') };
    this.flashUntil = 0;
    this.warnUntil = 0;
    this.warnLap = -1;   // the lap the counter was last drawn for
    // ?warn=Aileron shows the track limits banner at the start, for checking how it looks
    const forced = new URLSearchParams(location.search).get('warn');
    if (forced) { this.warn(forced, 0); this.forcedWarn = forced; }
    this.sectorCells = [];
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

  update(car, timer, track, simTime) {
    const e = this.el, s = this.settings;
    const mph = s.units === 'mph';
    e.speed.textContent = Math.round(Math.abs(car.fwdSpeed) * (mph ? 2.23694 : 3.6));
    e.unit.textContent = mph ? 'mph' : 'km/h';
    e.gear.textContent = car.gear < 0 ? 'R' : car.gear;
    const rev = Math.max(0, (car.rpm - car.cfg.idleRpm) / (car.cfg.redline - car.cfg.idleRpm));
    e.rev.style.transform = `scaleX(${Math.min(1, rev).toFixed(3)})`;
    e.rev.className = car.rpm > car.cfg.upshiftRpm - 300 ? 'hot' : '';

    e.drs.className = car.drs ? 'on' : track.inDRS(car.loc.s) ? 'zone' : '';
    e.pit.className = car.pitLimiter ? 'on' : '';
    e.tc.className = car.assists ? (car.tc ? 'act' : 'arm') : '';
    e.abs.className = car.assists ? (car.abs ? 'act' : 'arm') : '';
    e.esc.className = car.assists ? (car.esc ? 'act' : 'arm') : '';

    e.lap.textContent = fmtTime(timer.running(simTime));
    e.last.textContent = fmtTime(timer.last);
    e.best.textContent = fmtTime(timer.best);

    // sector splits for the current lap, coloured against your best
    const cells = [];
    for (let i = 0; i < 3; i++) {
      const t = timer.current[i], best = timer.bestSectors[i];
      if (t == null) { cells.push(`<i>S${i + 1}</i>`); continue; }
      const cls = best != null && t <= best + 1e-6 ? 'pb' : 'slow';
      const d = timer.lastSectors && timer.lastSectors[i] != null ? ' ' + fmtDelta(t - timer.lastSectors[i]) : '';
      cells.push(`<i class="${cls}">S${i + 1} ${t.toFixed(2)}${d}</i>`);
    }
    const html = cells.join('');
    if (html !== this._secHtml) { e.sec.innerHTML = html; this._secHtml = html; }

    for (const ev of timer.takeEvents()) {
      if (ev.type === 'lap') this.flash((ev.best ? 'Best lap ' : 'Lap ') + fmtTime(ev.time), simTime, ev.best ? 'pb' : '');
      else if (ev.index < 2) {
        const best = timer.bestSectors[ev.index];
        this.flash(`S${ev.index + 1}  ${ev.time.toFixed(3)}`, simTime, ev.time <= best + 1e-6 ? 'pb' : '');
      }
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
