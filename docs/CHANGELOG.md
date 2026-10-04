# Changelog

## Keep list

Things that are liked and must not change. `npm run check` does not test these; look at them by eye
(`node tools/shot.mjs out.png "viewat=3800,-8,1.8,40"` takes a picture of any spot) after each change.

- The pit barriers on the left of the start straight (pit wall, white top, sponsor panels, catch fence, attenuator).
- The Sebring look: old runway concrete as the run-off at Scramble, Windsock Hairpin and Boundary Loop.
- The debug view (I or F3): top-down, every surface and barrier type in its own colour.
- The Blockout setting.
- Keyboard handling and the keyboard tuning from fix pass 2.

## Fix pass 3 (in progress)

| Item | State | Notes |
|---|---|---|
| J regression guard | done | `npm run check` runs laptest, audit (geometry, containment, barrier reasons and repeats, 200-car bridge test, pit road drive-ins), bumps, surfaces and a browser smoke test. Laptest limits: 20 excursions (aim 10), average keyboard driver 7 s off the analog lap (aim 6). Both are chaotic: a 2 cm change to a rumble band moves the count between 14 and 19. |
| A one continuous surface | done | `src/groundRibbon.js`. No lifts; paint decals 6 mm with polygonOffset; terrain sunk not cut; earth plane 5 m below; camera 0.5 to 2600. |
| B bumps | done | `npm run bumps`; road height comes from the sample the vertex belongs to; wheels follow kerb, sausage and rumble height; the random shake is a smooth vibration. The elevation data was already smooth (tightest vertical curve 1,123 m), so no spline was added. |
| C run-off surfaces | done | Names: tarmac, kerb, sausage, runoff, runoff-rough, rumble, pit, gravel, grass. Rumble is a flat grooved band, 0.55 m wide, 6 mm high. |
| D double hairpin exit | not started, needs your answer | see the reply |
| E bridge approach | done | Deck margins paved and 2 m wide; parapet funnels in over 40 m each side and ends in a tyre stack; 200 cars at 60 to 200 km/h, none gets off the deck. |
| F barriers | done | Visible barrier is the sponsored tyre wall (bolt-head face, rounded top). The continuous containment rail is hidden. `docs/barrier-log.md` has a reason for every section; the audit fails without one. |
| G sponsors | done | 16 boards in the atlas, PowerMedia 15% of panels, logos override via `public/sponsors/`. |
| H pit road joins track | done | The mouth is the racing surface; the pit asphalt fades in over 10 m; the audit drives 10 paths in and out with no wheel off the paved surface. |
| I final corner double apex | done as kerbs | Boundary Loop is locked with apex kerbs at s=3118 and s=3236 and nothing between. The centreline was not reshaped: it already has three curvature minima (radius 57, 42, 45 m). |

## Cause of the bumps and the holes (found in item A)

- `runs()` in `trackMesh.js` closed every band with one extra sample where the band was zero wide. For gravel and the pit road that put a vertex on the centreline, so a sliver of gravel or pit asphalt was drawn across the road at the end of every run. This was the "gravel on the road" at s=747, 2063, 2721 and 3518.
- Heights came from the nearest centreline sample, not the sample the vertex belonged to. On bends the road edge took the height of a neighbouring sample, up to 3 cm off. That was the bumpy road.
- Wide bands were drawn as one quad, a chord through ground that bends. That put grass strips up to 4 m above the terrain beside the finish straight.
- The terrain was cut out under the circuit by distance from the nearest sample, and the strips did not cover the whole cut. The gap showed the sky colour: the blue.
