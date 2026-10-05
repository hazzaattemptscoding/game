# Performance

Measured with `node tools/rstats.mjs` (draw calls and triangles from `renderer.info`, shadow pass included; `--sweep` walks the lap every 250 m). `ms` is software GL in headless Chromium at 1280x640: only compare runs with each other. It did not change measurably (about 900 ms a frame before and after), so it says nothing about a real GPU. Draw calls and triangles do carry over.

## Before and after (High quality, default weather unless noted)

| View | Calls before | Calls after | Triangles before | Triangles after |
| --- | --- | --- | --- | --- |
| Start grid (s 100) | 298 | 382 | 615144 | 469504 |
| Bridge (s 1650) | 399 | 481 | 634878 | 534086 |
| Stands (s 1250) | 180 | 194 | 518956 | 231338 |
| Far stands (s 2750) | 208 | 224 | 511364 | 268327 |
| Night and heavy rain | 214 | 293 | 561866 | 434094 |
| Seven remote cars | 453 | 537 | 625154 | 479514 |
| Lap sweep, most calls | 435 | 553 | | |
| Lap sweep, most triangles | | | 704436 | 623075 |

Calls went up because the long lap meshes are now pieces; each piece the camera cannot see is skipped, which is where the triangles went. Every view stays under the 700 call budget in `tools/perf.js`; the busiest spots (s 1000 and s 3500) are 553 and 523. Triangle budget in `tools/perf.js` is 700000.

## What changed

- Loop (`src/loop.js`, `src/main.js`): physics was already a fixed 120 Hz step with an accumulator and render interpolation. Kept as is, so lap times are unchanged. The loop runs on requestAnimationFrame only, the frame time is clamped to 0.1 s, and the clock restarts when the tab becomes visible. Camera, vibration and other easing use `1 - exp(-k dt)` (`ease`). HUD text, the track map and the audio parameters update at most 60 times a second (30 and 20 on Medium and Low); the HUD only writes the DOM when a value changed.
- Parity (`tools/perf.js`): the same autopilot drive at 60, 120, 144, 240 Hz and with uneven 3 to 25 ms frames gives bit-identical car state after 6000 steps and the same first lap time (92.9917 s).
- Culling and batching (`src/cull.js`): the lap-long ribbons (terrain, grass, gravel, run-off, kerbs, tyres, fence) and long instanced runs are cut into pieces on a grid that grows for light geometry; small meshes are merged per material and cell. Originals stay in the scene hidden. The report tool (F2) swaps them back. The world's matrices are frozen. Small instanced props (crowds, trees, bins) are hidden beyond a distance on Medium and Low.
- Shadows (`src/quality.js`): the shadow map is refreshed from the loop (every frame on High, at most 60 or 30 times a second on Medium and Low), centred on whole shadow pixels so the edges do not shimmer. Night and rain use no per-light shadows: there is one sun shadow, the headlamp spot light does not cast, and floodlights are emissive heads plus a glow sprite and a light pool on the ground.
- Graphics quality (Settings, Display; Auto by default, Medium on a phone that has not chosen): High is the old look (pixel ratio up to 2, 2048 shadow map, anisotropy as built). Medium: ratio up to 1.5, 1024 shadow map, anisotropy 4. Low: ratio 1 at 0.85 scale, anisotropy 2. Auto starts at High (Medium on phones) and lowers the render scale from 1 down to 0.6 (0.5 on phones) when frames run over the display's frame interval, tries a step back up after holding it, and drops a tier if the scale is at its floor and still too slow. Antialiasing is off on phones.
- FPS readout: F key or Settings, Display or Interface. Shows fps, average and worst frame ms, render scale, quality, draw calls and triangles of the last frame.

## Needs real hardware

- Actual frame rates at 120, 144, 240 Hz, and how the Auto scaler behaves with real vsync (it estimates the display interval from the fastest frames it sees).
- Phones: Medium defaults, the antialiasing change, thermal behaviour.
- Whether shadows refreshed at 60 Hz on Medium show a lag at high speed on a 120 Hz display.
- Look at High against the old build by eye; nothing was compared pixel by pixel.
- Texture sizes were not reduced (they are 512 px canvases).
