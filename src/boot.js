// The loading screen (#boot in index.html). Building the world runs on the main thread before the first frame; bootStep() lets
// the page paint the current step (two animation frames, with a timer for a hidden tab where frames do not run) before the
// next piece of work starts, and bootDone() takes the screen away once the first frame is on the canvas.

const el = () => document.getElementById('boot');

export function bootStep(label, fraction) {
  const b = el();
  if (!b) return Promise.resolve();
  const text = b.querySelector('.boot-step'), bar = b.querySelector('.boot-bar i');
  if (text) text.textContent = label;
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 120);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
}

export function bootDone() {
  const b = el();
  if (b) b.remove();
}
