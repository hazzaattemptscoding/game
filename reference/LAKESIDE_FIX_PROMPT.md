# Lakeside fix pass

Save as `reference/LAKESIDE_FIX_PROMPT.md`. In Claude Code say: "Read reference/LAKESIDE_FIX_PROMPT.md and do it. Plan first."

---

I drove the current build. The circuit logic reads like a template: every corner gets the same kerbs, the same 300/200/100 boards and the same 14 m of grass before a continuous barrier. Fix the list below. This is an early build, so rough textures are fine, but wrong layout and wrong logic are not.

Read first: `README.md`, `reference/LAKESIDE_SAFETY_LAYOUT.md` (the rules for this pass and what I found in the code), `reference/LAKESIDE_REFERENCE_PACK.md`, `reference/LAKESIDE_ZONES.md`, and `reference/lakeside-track-colour-map.png`.

Think as a circuit safety engineer as well as a developer. Barriers and run-off go where cars end up, which the simulation can tell you. They do not go at a fixed offset from the centreline. That is the main thing the current build gets wrong.

## How to work

Two parts. Do part 1, run the checks, commit, then stop and summarise. Wait for my go-ahead before part 2. Reply to this message with a short plan first.

## Part 1: the circuit

### 0. Corner sheet

Add `tools/cornersheet.js` and `npm run cornersheet`. It drives an autopilot lap with the real physics, the way `tools/laptest.js` does, and records for each corner in `layout.js`:
- entry speed, minimum speed and braking distance, from the actual car (not `speedProfile()`, which caps at 306 km/h when the car tops out at 236);
- where the racing line comes within 1 m of each track edge;
- the straight-on and tangent departure results from item 1.

Write the result to `src/corners.js` (generated and committed, with plain English comments) and `docs/corner-sheet.md`. Every item below reads from this data. Reason: per-corner decisions are what stop it feeling like a template.

### 1. Run-off and gravel

- Replace the fixed `GRASS_RUNOFF = 14` in `buildSides()` in `track.js`. For each corner, size the run-off from the two departure tests in the rulebook (section 3.1), using the game's own surface drag. Depth is the stopping distance plus 30%.
- Layers from the edge: kerb, paved apron (`SURF.RUNOFF`), gravel (`SURF.GRAVEL`), grass, barrier. Use the starting sizes in the rulebook only until the simulation replaces them.
- Keep the colour-map zones in `layout.js`. The simulation can deepen them, never remove them.
- Gravel is in the data already (nine zones, 22 to 42 m) and the ground mesh does not cover it, yet I only see grass. Find the render cause. Likely candidates: the tan texture is too close to the grass in the lighting, depth fighting with the grass strip 0.02 m below, or my zones sit away from where I was looking. Fix it so gravel reads clearly: stronger colour contrast, raked lines, `polygonOffset` or a higher lift, and a visible edge.
- Make the paved apron at the Scramble braking zone, Windsock Hairpin and Boundary Loop read as old runway concrete (the Sebring look in rulebook 3.8): slab joints, cracks, patches, a mild rumble. Say how you interpreted "like Sebring".
- Add a check to `tools/laptest.js`: for every corner, the barrier is beyond the stopping distance of both departure tests, or the corner is listed as constrained with a reason. Do not silently shrink a run-off.

### 2. Barriers and fences

- Build barriers as placed sections from `corners.js`, not as per-sample strips. See rulebook 3.4 for lengths, stagger, overlap, terminals, and the tyre wall in front of double armco at impact zones.
- Barrier faces follow the predicted impact, not the track.
- Between impact zones along a straight, single armco further back, or nothing.
- Catch fences only behind impact zones and in front of grandstands, with posts at both ends. They never run the whole circuit.
- No barrier within 4 m of the track edge except the street section and the pit wall.

### 3. Kerbs

Replace the curvature rule (`want[]` in `buildSides()`) with kerbs from the racing line contacts, per corner (rulebook 3.5).

### 4. Distance boards

Rewrite `distanceBoards()` in `trackMesh.js` to read `corners.js` and follow rulebook 3.6: number and set of boards from the real braking distance, placement rules and skip rules. The old code puts all three boards on every zone and they land in gravel, in walls, and on top of each other.

### 5. Pit lane

Rewrite `buildPit()` in `track.js` and the pit parts of `trackMesh.js` to the rulebook 3.7 design: a pit road that splits from the track, a wall that starts only once it is 6 m clear, a mirrored exit, its own asphalt, and no overlap with the road. Currently 141 of 714 pit samples overlap the racing surface and the closest wall is 1.5 m from the track edge.

Add checks to `tools/laptest.js` that fail if any pit wall vertex is within 4 m of the track edge, if the pit surface overlaps the road, or if two boards, posts or panels are within 30 m of each other.

### Part 1 verification

- A top-down debug view (extend `npm run trackmap` and add an in-game toggle) that colours each surface and barrier type and marks every board, post and panel.
- `npm run laptest` passes, with lap times within 0.3 s of the current 1:31.0, 1:33.9 and 1:35.5.
- If you can render the game headless (Playwright or similar), take screenshots of Scramble, Windsock Hairpin, the pit entry, the pit exit and a gravel trap, and look at them before telling me it is done. If you cannot render, say so and I will send screenshots.

## Part 2: the dressing (after I sign off part 1)

### 6. Operations Block

The garages in `trackMesh.js` are a single strip of texture with a glass band. It looks unfinished and this is a premium circuit. Two storeys, a full-height glass curtain wall with slim mullions, a cantilevered roof canopy, white render with dark cladding and timber accent panels, a roof terrace with a glass balustrade, 18 numbered garage doors, a paved forecourt with planters and flagpoles, a 3D "LAKESIDE" sign, and LED strips under the canopy for dusk. Pit wall gantry as in the reference pack.

### 7. Grandstands

None exist. Build the six from the reference pack in `scenery.js`: raked tiers, a steel frame, a roof on the main one, coloured seat blocks, an instanced crowd about 70% full, a catch fence in front. Use the quality presets to cut crowd detail on low.

### 8. Car

`CarView` in `car.js` is an extruded side profile with boxes. Make a proper GT3-style car about 4.6 m long, 2.0 m wide, 1.2 m high, 2.7 m wheelbase: a lofted body with smooth normals, wheel arches with visible wheels and brake discs, splitter, diffuser, mirrors, tinted glazing, roof scoop, a rear wing with endplates, emissive lights, livery by colour and number. Keep it under about 30,000 triangles for tablets. If lofting still looks poor, use a CC0 model and tell me the source and licence.

### 9. Engine sound

There is no audio code. Add `src/audio.js` with the Web Audio API, fed from the car state in `physics.js` (`rpm`, `gear`, `events.shift`, `events.hit`, `slipR`, `wheelSurf`, throttle). Create or resume the `AudioContext` on the first key press or touch, since browsers keep it suspended. Layered oscillators with frequency from rpm, a low-pass filter opening with throttle, a noise layer for intake, a cut on upshifts and a burble on lift. Tyre squeal from slip, kerb and gravel rumble from `wheelSurf`, impacts from `events.hit`. Add a `?soundtest` page with a rev sweep so I can check it without driving.

## Constraints

- Fix only what is listed. Do not change handling (`cars.js`, `physics.js`), the layout points, or the colour-map zones except to deepen them.
- No new dependencies. Keep the existing modules. Put every per-corner decision in `corners.js` so I can tune it, with comments in plain English.
- Keep the Blockout setting working with every new material.
- Keep tablet performance: instance repeated objects and respect the quality presets.
- No speculative features, abstractions or config layers.

## When you finish each part

Commit, then reply with a table of what you changed per numbered item, the corner sheet, anything you could not fix and why, and how to open the debug view.
