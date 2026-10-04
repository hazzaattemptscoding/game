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
| J regression guard | done | `npm run check` runs laptest, audit, bumps, surfaces. The laptest excursion limit is 14 (was 20 at cb28eb1, aim is 10). |
| A one continuous surface | done | `src/groundRibbon.js`. No lifts; paint decals 6 mm with polygonOffset; terrain sunk not cut; earth plane 5 m below; camera 0.5 to 2600. |
| B bumps | done except the smoothing of elevation, which was already fine (tightest vertical curve 1,123 m) | `npm run bumps`; wheels follow kerb and sausage height; the random shake is a smooth vibration. |
| C run-off surfaces | todo | |
| D double hairpin exit | todo | |
| E bridge approach | todo | |
| F barriers | todo | |
| G sponsors | todo | |
| H pit road joins track | partly: the mouth is the racing surface with a tone fade | drive test still to do |
| I final corner double apex | todo | |

## Cause of the bumps and the holes (found in item A)

- `runs()` in `trackMesh.js` closed every band with one extra sample where the band was zero wide. For gravel and the pit road that put a vertex on the centreline, so a sliver of gravel or pit asphalt was drawn across the road at the end of every run. This was the "gravel on the road" at s=747, 2063, 2721 and 3518.
- Heights came from the nearest centreline sample, not the sample the vertex belonged to. On bends the road edge took the height of a neighbouring sample, up to 3 cm off. That was the bumpy road.
- Wide bands were drawn as one quad, a chord through ground that bends. That put grass strips up to 4 m above the terrain beside the finish straight.
- The terrain was cut out under the circuit by distance from the nearest sample, and the strips did not cover the whole cut. The gap showed the sky colour: the blue.
