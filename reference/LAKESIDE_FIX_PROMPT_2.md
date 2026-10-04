# Lakeside fix pass 2

Save as `reference/LAKESIDE_FIX_PROMPT_2.md`, replace `reference/LAKESIDE_SAFETY_LAYOUT.md` with the updated copy, then tell Claude Code: "Read reference/LAKESIDE_FIX_PROMPT_2.md and do it. Plan first."

---

I played the build from fix pass part 1 and the direction is right. These are the problems left. I checked each one against the code, so the causes below are measured, not guessed. Fix the causes, not the symptoms.

Read first: `reference/LAKESIDE_SAFETY_LAYOUT.md` (updated: barriers are never optional, and the pit road never starts at zero width), `src/track.js`, `src/trackMesh.js`, `src/scenery.js`, `src/physics.js`, `src/corners.js`.

Do not start part 2 (Operations Block, grandstands, car, sound). That waits for my sign-off on this pass.

## Root causes

1. **Floating beside the bridge.** `physics.js` sets `this.y = loc.h`, which is the track height at the nearest centreline sample, whatever the sideways distance. Beside the bridge deck that is up to 12.4 m above the rendered terrain, so the car drives on invisible ground. The same mismatch causes "grass I drive over", "grass that isn't collidable" and anything that looks like it floats: physics and the terrain mesh use two different ground heights.
2. **Barriers on the track.** For street corners `buildBarriers()` adds straight 20 m chord sections from `corners.js` (`sections`) on top of the correct curved street wall. On the inside of a tight bend the chord cuts across the road. Measured: concrete barrier points sit 1.07 m and 0.57 m inside the track edge near s=1300 and s=1350 (Nissen Hairpin).
3. **Barriers are optional.** Single armco is only built where another part of the track is within 70 m. Measured: only 33% of the left side and 47% of the right side of the lap has any barrier within 15 m. The rest is open ground, so a car that leaves the track is lost forever.
4. **Random wedges of empty space.** `T.wall` is a per-sample minimum of the run-off, a "room" test against other track sections, and fixed constants, with no smoothing. Measured: the barrier distance jumps up to 38.8 m in one metre, and 192 samples on the left and 221 on the right have steps above 0.5 m per metre. Those jumps are the wedges you circled, and they are why the run-off areas look random.
5. **Pit road starts at zero width.** `buildPit()` grows the road width from 0.01 m over `PIT_GROW` = 60 m with a smoothstep. A car cannot get onto a road that does not exist yet. (This came from my rulebook; it is wrong and now corrected.)
6. **No exit kerbs on the final corner.** Kerbs are only built where the autopilot's body comes within 1 m of an edge. The last long curve onto the main straight is taken flat out in the middle, so it gets nothing, and it is not even listed in `corners.js`.
7. **Run-off does not punish.** `RUNOFF` and `CONCRETE` have grip 0.97 across their full width, so the further out you go there is no extra cost.
8. **The test driver is not a fair test.** The autopilot hands `car.step()` a smooth analog steering value from -1 to 1, bypassing the keyboard model in `input.js` (steering winds on at 3.2 per second, centres at 6, pedals are eased on and off). Most players use a keyboard, which can only press or release, so they tap. Every number built from the autopilot is optimistic for them: the 1:31.0 lap, the corner speeds, braking distances, where the car touches the kerbs, and the run-off sizes. Keyboard drivers brake early, run wide, overshoot and correct, and leave the track more often.

## Do in this order, committing after each item (0 first, because the corner sheet changes)

### 0. Keyboard is the baseline (do this first, it changes the numbers C and E depend on)

Most players use a keyboard, then a tablet, then a pad. Tune and size everything for the keyboard first.

- Move the keyboard model out of `input.js` into a pure module `src/inputModel.js` used by the game and by every tool: the key-to-value easing (`KEY_STEER_IN`, `KEY_STEER_OUT`, throttle and brake rates), with the constants in one place.
- Add `tools/drivers.js` with a **Tapper**. It takes what the autopilot wants (analog steer, throttle, brake) and turns it into key presses the way a person would: hold left or right when the wanted steering is more than a dead band (about 0.12) from the current eased value, otherwise release; a minimum hold time; a limit on taps per second; a reaction delay; steering noise; a brake point error. Throttle and brake are also on or off. The eased values then go into `car.step()` through the same `inputModel.js`.
- Driver profiles, as plain English constants with comments (tune the numbers so they feel right):

| Profile | Reaction | Shortest key hold | Brake point | Steering noise |
|---|---|---|---|---|
| Wheel or pad (the current analog driver) | none | n/a | exact | none |
| Keyboard, good | 120 ms | 60 ms | within 5 m | small |
| Keyboard, average | 200 ms | 90 ms | 8 m early on average, plus or minus 15 m | medium |
| Keyboard, new | 280 ms | 120 ms | 25 m early | large |

- **Regenerate `corners.js` with Keyboard, average.** Entry and minimum speeds, braking distances, kerb contacts and the apex and exit positions all come from that driver. Distance boards use its braking start so they match where people really brake.
- **Run-off sizing uses the worst of Keyboard average and Keyboard new**, with the 30% margin as before. The fan (item C) adds lateral position error from the profile's steering noise and reaction time at launch.
- `tools/laptest.js` prints lap time, off-track share, hits and slide share for all four profiles, with assists on and off. Targets, which mean the keyboard model needs tuning if they are missed (tune the keyboard pipeline in `inputModel.js`, not the circuit):
  - Keyboard good is within 3 s of the analog lap.
  - Keyboard average is within 6 s.
  - Keyboard new finishes three laps with assists on and leaves the track no more than 10 times in total.
- Add a **tap response table** to `tools/laptest.js`: for tap lengths of 50, 100 and 200 ms at 60, 120 and 180 km/h, print the peak yaw change and the sideways movement after one second. A 100 ms tap at 120 km/h with assists on should be a small correction (under 1 m), not a lane change. Holding the key should reach the grip-limited lock in about 0.3 to 0.4 s. If the car is twitchy at speed, scale the key steering rate by speed in `inputModel.js` and say so.
- Keep the old analog lap times as the physics regression (1:31.0, 1:33.9, 1:35.5 within 0.3 s). Do not use them for anything about keyboard players.
- The report tool (item F) records the input device and the key timeline for the last 10 s, so I can see how I was actually driving when something went wrong.

### A. One ground truth

- Add `track.groundAt(x, z, hint)` to `track.js`. Inside the paved width (road, kerbs, sausage kerbs, apron) it returns the track surface height. Beyond that it eases to the terrain height with a cross slope of 12% at most. Where the road is raised above the land (the bridge approaches), the terrain forms an embankment no steeper than 1:3 out to the containment barrier.
- `scenery.js` builds the terrain mesh from `groundAt`. Grass, gravel and apron strips in `trackMesh.js` take their height from `groundAt`, not `T.h[i]`.
- `physics.js` takes the car's height from `groundAt` at the car's position, smoothed over about 50 ms. `locate()` stays height-aware so the road under the bridge and the deck above it are never confused.
- On the bridge, the parapets are solid and the car cannot leave the deck. Beside the bridge the ground is the real terrain.
- Check `tools/audit.js` (item G) against 2,000 random points within 80 m of the track. Physics ground and rendered terrain must agree within 0.05 m.

### B. Containment that cannot be skipped

- Build one **containment boundary per side**, a smooth offset curve covering 100% of the lap on both sides, except under the pit wall and on the bridge where those barriers take over. Its distance is the larger of the run-off sizing from `corners.js` and a default of 18 m on plain stretches.
- Constrain it with the room test, but then **smooth it**: the offset may change by at most 0.25 m per metre of track. If a constraint needs a faster change, start tightening earlier, never step.
- A continuous single armco runs along this boundary. Impact sections (tyre wall in front of double armco, flared ends, catch fence) sit in front of it where the departure fans say cars end up. The containment armco is never removed.
- Delete the straight chord `sections` for street corners in `buildBarriers()`. Street walls come only from the curved `follow()` runs.
- Barriers are built from offset curves sampled every 1 to 2 m (or adaptively so the sagitta stays under 5 cm), never from long chords.
- A solid containment collision line follows the boundary even if the visual barrier is missing, so the car can never leave the map.
- If the car is off the paved surface for more than 4 s, or is stopped, show "Press R to reset" on screen. Touch gets a Reset button. R puts the car back on the track facing the right way.

### C. Run-off designed as one system

- Replace the 7 departure tests per corner with a **fan**: departures launched every 10 m along the braking zone and exit, at 0, 5, 10, 20, 30 and 40 degrees, with the game's own surface drag. Launch them from the Keyboard average and Keyboard new profiles (item 0), including their reaction delay and lateral error. Record where each stops.
- The run-off boundary for a corner is the smoothed envelope of the fan's stopping points plus 30%, as a width profile along the track (a list of [s, apron, gravel, barrier] control points in `corners.js`), blended with the same 0.25 m per metre limit. All band edges are offset curves of the track. No polygons, no per-corner constants, no sharp edges.
- Layers: kerb, paved apron, gravel, grass, barrier. Same order everywhere, consistently drawn.
- **Make the Sebring apron punish.** Split it into three bands by distance from the edge:
  1. inner third: full grip, no penalty;
  2. a rumble strip band 0.6 m wide across the apron at that point (new `SURF.RUMBLE`, high bump, a drag of about 0.02, a visible and audible texture);
  3. outer two thirds: grip falling steadily from 0.95 at the strip to 0.70 at the outer edge, bump rising, with a second rumble strip two thirds of the way out. A car that goes deep must slow clearly before the gravel.
- Add these to the `SURFACE` table in `physics.js` and to `surfaceAt()` with plain English comments. `tools/laptest.js` prints the cost of each band (time and speed lost over 60 m).
- The existing colour-map zones in `layout.js` can only make a run-off deeper.

### D. Pit lane mouth

- Entry and exit roads are **full width (12 m) from the first metre**. For the first 15 m the pit road is one continuous tarmac area merged with the racing surface (no kerb, no edge line). After that, a painted chevron island splits the two roads and the pit road's track-side edge moves away at about 6 degrees (5 degrees at the exit).
- The pit wall starts only where the pit road is 6 m clear of the track edge, with a sloped terminal, and ends at least 20 m before the exit mouth.
- Remove `PIT_GROW`. Update the checks in `tools/laptest.js`: pit road width is at least 10 m at every sample along its length, and the mouth has no kerb, barrier or wall. A car must be able to drive from the track onto the pit road at the entry and back at the exit at 60 km/h without touching grass.

### E. Kerbs

- Add the long final corner (points 59.3 to 62.9) to `corners.js` as a named corner, **Final Approach**, class C. It gets a long apex kerb on the inside and a wide exit kerb on the outside, then a Sebring apron on the outside with a rumble strip.
- Kerb contacts now come from the Keyboard average driver (item 0). Change the kerb rule: contact-based kerbs stay, and any stretch of sustained curvature above 1/400 for more than 60 m also gets an exit kerb on the outside of the exit, whether or not the line touches the edge.

### F. Debug view with reporting

Extend the top-down debug view so it is navigable and can report problems back to me.

- **Open it from the race:** a Report button (key F2, and an on-screen button for touch). It pauses the simulation, captures a screenshot of the 3D view first, and switches to the top-down map centred on the car.
- **Navigate:** drag to pan, wheel or pinch to zoom, a button to recentre on the car and one to follow it. A coordinate readout shows s, d, the nearest point number and the corner name under the cursor.
- **Highlight:** click or tap picks the feature under the cursor (surface band, barrier section, board, sign, building, terrain) and outlines it. A rectangle tool selects everything inside a region. Each pick shows its type, id, corner, dimensions and surface parameters.
- **Report:** a note box and a category (barrier on track, empty space, floating, collision, other). Save collects JSON with: build commit, time, device and quality settings, car state and the surface under each wheel, the input device and the key and pedal timeline for the last 10 s, the last 10 s of telemetry (x, z, y, s, d, speed), the camera pose, every selection with its ids and geometry, my notes, and both screenshots as data URLs.
- **Delivery:** download `lakeside-report-<time>.json`. In dev (`npm run dev`) a small Vite plugin also writes the file to `reports/` in the repo. On a tablet the Web Share sheet is offered where it exists. Unsent reports are kept in localStorage with a counter.
- Add `npm run reports`, which prints a one-page summary of every file in `reports/` (notes, positions, feature ids) so I can say "read the latest reports" and you start with what I found.
- Resuming puts me back in the race exactly where I paused.

### G. Audit tool

Add `tools/audit.js` and `npm run audit`. It fails with the offending s and coordinates if:
- any barrier point (other than the street wall at its gap, the pit wall and the parapets) is closer to a track edge than 4 m, or any street wall is closer than 0.3 m;
- either side has less than 100% containment barrier coverage (the pit and bridge excepted);
- the barrier offset changes by more than 0.3 m per metre anywhere;
- physics ground and terrain differ by more than 0.05 m at any of the 2,000 sample points;
- terrain or a grass, gravel or apron strip is above the road surface anywhere inside the road footprint;
- any bridge part (deck, banner, pillar, parapet, skirt) or any barrier, fence or board has its lowest point more than 0.3 m above the ground with no support under it. List by name so the floating pieces are found;
- the pit road is narrower than 10 m anywhere, or the pit wall comes within 4 m of the track edge;
- two boards, posts or panels are closer than 30 m.

Run `npm run audit` and `npm run laptest`. Both must pass, and the lap times stay within 0.3 s of 1:31.0, 1:33.9 and 1:35.5.

## Constraints

- Fix only what is listed. Do not change handling (`cars.js`, `physics.js` except the ground height, the new surfaces and the barrier collision), the layout points, or the colour-map zones except to deepen them. The keyboard steering and pedal easing in `inputModel.js` may be tuned to meet the item 0 targets.
- No new dependencies. Keep the existing modules and the Blockout setting working. Keep tablet performance: instance repeated objects and respect the quality presets.
- Put every per-corner decision in `corners.js`, with plain English comments.
- No speculative features or extra abstractions.
- If you can render the game headless, take screenshots of the S bend at Nissen Hairpin, the corner after it, the bridge from the side and from the approach, the pit entry, the pit exit and Final Approach, and look at them before saying it is done. If you cannot render, say so and I will send screenshots using the report tool.

## When you finish

Commit, then reply with: a table of what you changed per item 0 to G, the lap table for the four driver profiles and the tap response table, the audit output, the corner sheet changes, anything you could not fix and why, and how to open the report tool.
