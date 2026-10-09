// What the driver sees while drafting (strength from Car.wake, src/physics.js): thin white speed lines at the screen edges and a
// slight widening of the field of view. Both follow the eased strength, so they come and go smoothly, and both are off with
// prefers-reduced-motion. The lines are a 2D canvas under the HUD: no blur, no glow, opacity under 0.35.
//
//   const fx = createSlipFx(document.body.querySelector('#view'));
//   fx.update(strength, dt, now)     // every frame; returns the extra field of view in degrees (0..FOV_MAX)

export const FOV_MAX = 3;      // degrees added at full strength
export const LINE_ALPHA = 0.3; // opacity of the lines at full strength
const LINES = 18;
const FOV_EASE = 2.5;          // per second, how quickly the field of view follows

export function createSlipFx(after) {
  const canvas = document.createElement('canvas');
  canvas.id = 'slipfx';
  canvas.setAttribute('aria-hidden', 'true');
  after.insertAdjacentElement('afterend', canvas);
  const g = canvas.getContext('2d');
  let reduced = false;
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    mq.addEventListener('change', e => { reduced = e.matches; });
  } catch (err) { /* no matchMedia */ }
  // each line: an angle round the centre of the screen, how far out it starts, how long it is and where it is in its cycle
  const lines = Array.from({ length: LINES }, (_, i) => ({
    a: (i + 0.5 + ((i * 7) % 5) * 0.11) / LINES * Math.PI * 2,
    r0: 0.66 + ((i * 13) % 7) / 7 * 0.16, len: 0.1 + ((i * 5) % 6) / 6 * 0.1, ph: (i * 0.618) % 1, speed: 1.1 + ((i * 3) % 4) * 0.25,
  }));
  let w = 0, h = 0, drawn = false, fov = 0;

  return {
    canvas,
    update(strength, dt, now) {
      const s = reduced ? 0 : Math.max(0, strength);
      const target = s > 0.1 ? FOV_MAX * s : 0;
      fov += (target - fov) * Math.min(1, FOV_EASE * dt);
      if (fov < 0.002) fov = 0;
      if (s <= 0.1) {
        if (drawn) { g.clearRect(0, 0, canvas.width, canvas.height); drawn = false; }
        return fov;
      }
      if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = w = innerWidth; canvas.height = h = innerHeight; }
      g.clearRect(0, 0, w, h);
      g.lineWidth = 2; g.lineCap = 'butt';
      const cx = w / 2, cy = h / 2, t = now / 1000;   // the lines run out along the screen's own proportions, so they sit at all four edges
      const shown = Math.ceil(LINES * Math.min(1, 0.3 + s * 0.7));
      for (let i = 0; i < shown; i++) {
        const L = lines[i], p = (L.ph + t * L.speed) % 1;           // 0..1 along its run outwards
        const a0 = Math.min(1, p * 4) * Math.min(1, (1 - p) * 4);   // fades in and out over a run
        const r1 = L.r0 + p * 0.2, r2 = r1 + L.len * (0.5 + p * 0.5);
        const ca = Math.cos(L.a), sa = Math.sin(L.a);
        g.strokeStyle = `rgba(255,255,255,${(LINE_ALPHA * s * a0).toFixed(3)})`;
        g.beginPath(); g.moveTo(cx + ca * r1 * cx * 1.1, cy + sa * r1 * cy * 1.1); g.lineTo(cx + ca * r2 * cx * 1.1, cy + sa * r2 * cy * 1.1); g.stroke();
      }
      drawn = true;
      return fov;
    },
  };
}
