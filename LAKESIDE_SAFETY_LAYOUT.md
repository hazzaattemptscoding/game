# Lakeside safety layout rules

Companion to `LAKESIDE_REFERENCE_PACK.md`. That file says what the hardware looks like. This one says where it goes and why, the way a circuit safety engineer would decide it. Save as `reference/LAKESIDE_SAFETY_LAYOUT.md`.

## 1. What the current build does (read from the repo)

These are facts from running the code, not opinions.

- **Barriers are one ribbon.** `buildSides()` in `track.js` sets every barrier to the edge of the run-off plus a fixed `GRASS_RUNOFF = 14` m. On the right side 3,008 of 3,835 samples sit between 10 and 16 m from the track edge. Armco is 3,088 samples on the right and 1,805 on the left. The fence is built per sample along the same line.
- **Gravel exists in the data.** Nine zones, 22 to 42 m deep, and the ground mesh does not cover them. If they are invisible in the game, the cause is how they render (colour contrast, depth fighting with the grass strip 0.02 m below, or the player looking at corners with no zone), not missing data. Check with a screenshot.
- **The braking zones come from the wrong speeds.** `distanceBoards()` reads `speedProfile()`, which caps at 306 km/h. The car actually tops out at 236 km/h. It then places all of 300, 200 and 100 for every zone with a drop over 70 km/h, 30 boards in total, whatever the braking distance (55 to 194 m in the profile).
- **Boards collide.** They are placed at distances measured back from the corner, offset by the run-off width only. They can land inside gravel, inside tyre walls, or inside another corner's zone.
- **Pit lane geometry overlaps the track.** `buildPit()` eases the lane centre from 5.5 m to 15.5 m off the centreline with a smoothstep, at a fixed 12 m width. 141 of 714 pit samples overlap the racing surface. The closest pit wall face is 1.5 m from the track edge at s=328. The pit texture is drawn 0.002 m above the road, so it paints over it.
- **Kerbs come from a curvature rule**, not from where the car uses the edge, so every corner gets the same treatment.
- **No grandstands, no audio, a block car.** `scenery.js` and `car.js` say these are phase 3. `physics.js` already exposes `rpm`, `gear`, `events.shift`, `events.hit`, `slipR` and `wheelSurf` for audio.

## 2. Lakeside corner data (autopilot lap, quick driver, assists on, 1:31)

Regenerate this from the code; do not trust these numbers over a fresh run.

| Corner | Points | Entry km/h | Minimum km/h | Class |
|---|---|---|---|---|
| Scramble | 3 to 5 | 236 | 112 | A, end of the main straight |
| Hurricane Sweep | 7 to 10 | 236 | 135 | C, the quickest real corner |
| Windsock Hairpin | 12 to 15 | 205 | 84 | A |
| Nissen Hairpin | 19 to 21 | 205 | 82 | street section, no run-off |
| Searchlight | 28 to 30 | 190 | 120 | B |
| Station Corner | 33 to 35 | 190 | 130 | B |
| Chandelle | 36 to 39 | 190 | 95 | B |
| Aileron | 43 to 45 | 208 | 110 | A, end of Hangar Straight |
| Boundary Loop | 50 to 53 | 212 | 103 | A |
| Guardroom Chicane | 57 to 58 | 212 | 100 | A, chicane |

The esses (points 46 to 49) and the final kink (60 to 62) are flat out. The circuit has almost no fast corners; the danger is cars arriving at 190 to 236 km/h and failing to stop. That is what the run-off has to cover.

## 3. How a circuit engineer lays it out

### 3.1 Two ways a car leaves

For every corner, size the run-off for the worse of these.

1. **Straight on at the braking point.** The car arrives at entry speed, the brakes lock or fade, and it carries on in a straight line.
2. **Tangent departure at the apex and the exit.** The car runs wide and leaves along its heading, at plus and minus 10 degrees.

Run each as a real simulation with the game's own surface drag, record where the car stops, add a 30% margin, and that is the depth.

### 3.2 Layers, from the track edge outward

1. Kerb.
2. Paved apron (`SURF.RUNOFF`), usable with no penalty.
3. Gravel bed (`SURF.GRAVEL`) to slow the car.
4. Grass or graded earth.
5. Barrier at the end of the stopping distance.

### 3.3 Starting sizes (the simulation overrides these)

| Class | Paved apron | Gravel depth | Barrier distance from edge |
|---|---|---|---|
| A, end of straight, 200 km/h or more | 14 to 18 m | 30 to 40 m | 55 to 70 m at the straight-on point |
| B, medium | 8 to 12 m | 20 to 25 m | 35 to 45 m |
| C, quick sweep | 10 to 12 m | 25 m, plus grass | 40 m |
| Slow hairpin, under 90 km/h | 6 to 10 m | 10 to 15 m | 20 to 25 m |
| Street section | none | none | wall at the edge |

If a run-off cannot fit because another part of the track is close, report it and suggest a layout nudge. Do not silently shrink it.

### 3.4 Barriers go where cars end up

- A protected section is **20 to 40 m long**, centred on a predicted impact point (where the straight-on and tangent departures meet the barrier line).
- Sections are **staggered and overlapped by about 5 m**, with a flared terminal at each end.
- Impact zones get a **conveyor-faced tyre wall in front of double armco**. Between impact zones, a continuous single-armco containment barrier runs the whole lap on both sides. A barrier is never optional: a car that leaves the track must always meet one. Run-off is made bigger by pushing this barrier back, never by removing it.
- Barrier faces are **angled to the likely impact**, not drawn parallel to the track.
- **No barrier closer than 4 m to the track edge**, apart from the street section and the pit wall.
- **Catch fence** only behind impact zones and in front of spectators. 4 m high, 6 m at grandstands. Every run starts and ends at posts.

### 3.5 Kerbs from the racing line

Run the autopilot line and record where it comes within 1 m of each edge. Put the apex kerb there, plus about 10 m either side. Add an exit kerb only where the exit is fast. Sausage kerbs only on the chicanes. None on flat-out sweeps. Inside and outside get different treatment.

### 3.6 Distance boards by braking distance

Measure braking from the actual lap telemetry, not from the speed profile cap.

| Real braking distance | Boards |
|---|---|
| over 150 m | 300, 200, 100 |
| 80 to 150 m | 200, 100 |
| 30 to 80 m | 100 |
| under 30 m, or flat out | none |

Place each set on the outside of its own braking zone. A board is skipped if it would sit within 30 m of any other board, post or panel, inside gravel, within 6 m of a barrier or sign, on the bridge, or in the pit lane. Prefer the largest set that fits.

### 3.7 Pit lane

The pit road is a **deceleration lane** that splits from the track.

- **Mouth:** at entry and exit the pit road is already full width (12 m) and joins the racing surface as one continuous tarmac area for the first 15 m, with no kerb and no edge line. A car can drive straight from the track onto the pit road without crossing grass. The road never starts at zero width.
- **Split:** after the mouth, a painted chevron island (the gore) separates the two roads. The pit road's track-side edge moves away at about 6 degrees. The island is paint and a low kerb, not a wall.
- **Pit wall:** it starts only where the pit road's track-side edge is 6 m or more from the racing surface, with a sloped or attenuator terminal. It is never within 4 m of the track edge, kerbs included.
- **Full separation:** wall face at least 6 m from the track edge. That puts the lane centre around 19 to 20 m off the centreline for a 12 m lane.
- **Exit:** mirrors the entry. The wall ends at least 20 m before the full-width mouth, and the exit mouth joins the track as one continuous surface for 15 m.
- **Surface:** its own lighter grey asphalt (`#6A6D72`), white fast-lane line, white box outlines in each bay, concrete forecourt. No centre dashes and no road markings from the circuit texture. The pit surface and the road never overlap except in the mouth, where they are one surface.

### 3.8 Sebring-style run-off

This is how I read "like Sebring" for a former airfield: broad, flat expanses of old runway concrete and grass beside the track, with visible slab joints, patching and cracks, barriers set far back, and a mild rumble on the concrete. Use it as the look for the paved apron at the two or three places with the most space (the Scramble braking zone, Windsock Hairpin, Boundary Loop). Tell me if you meant something else.

## 4. Lakeside-specific notes

- The colour-map zones in `layout.js` (gravel, walls, run-off, sausage) stay. The simulation can make a zone deeper, never remove it.
- The street section (points 16 to 25) keeps its walls and tyre barriers and has no run-off by design.
- The bridge keeps its parapets. Nothing else is built under or beside it.
- Where space is tight (the area between Searchlight and Station Corner, and Boundary Loop's infield), the run-off may need to be shortened. Report each case.
