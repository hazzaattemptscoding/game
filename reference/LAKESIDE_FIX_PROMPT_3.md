# Lakeside fix pass 3

Save as `reference/LAKESIDE_FIX_PROMPT_3.md`. In Claude Code say: "Read reference/LAKESIDE_FIX_PROMPT_3.md and do it. Plan first, and do step 0 before anything else."

---

I scanned the repo at commit `cb28eb1` (fix pass 2, item 0). Some of what I describe below was also tested by me against the real geometry, with the numbers given. Some of what I describe was observed by me playing a copy that was edited in a Codespace with a different model (GPT-6 Luna). That copy is **not on GitHub**: the repo has one branch and no `reports/` folder. So my numbers describe `cb28eb1`, and my observations describe the Codespace copy. Reconcile them first.

## Step 0: reconcile and read

1. Run `git status`, `git log` and `git diff` against `cb28eb1`. If this working copy has uncommitted or unpushed changes, commit them to a branch `snapshot-before-pass-3` and push it. Do not discard anything.
2. Write `docs/codespace-diff.md`: every file that differs from `cb28eb1`, one line each, with your judgment keep, fix or revert. I believe the Codespace copy changed the layout (the long final corner was split into a double apex), renamed surface types (concrete, concrete outer, kerb) and added barrier templates. Check each belief.
3. Read every file in `reports/` (`npm run reports`). Those are my notes from playing. If the folder is missing, say so and stop; I will paste them.
4. From now on this repo is the only source of truth. Tell me if the Codespace copy still needs to be merged or retired.

## What I found at `cb28eb1`

Measured by building the real geometry headlessly and raycasting it.

1. **Surface layers are stacked 0 to 6 cm apart.** Road 0.03, edge line 0.035, kerb 0.04 to 0.06, apron 0.035, gravel 0.05, grass 0.0, pit 0.035. Every border is a small step, and several overlap (`line` sits 5 mm above `road` at 5 places).
2. **The depth buffer cannot separate layers that close.** The camera is near 0.3, far 6000, with a 24-bit depth buffer and no logarithmic depth. Depth resolution is about 8 mm at 200 m and 5 cm at 500 m, so layers 5 mm apart flicker. The road, sausage and grass materials have no `polygonOffset`.
3. **Gravel is drawn over the road** on the centreline at four places (a 2 to 3 cm step): s=747 (point 10.7), s=2063 (Chandelle, point 35.9), s=2721 (point 46.3) and s=3518 (point 58.3). The offset curve folds on the inside of a bend and sweeps across the road.
4. **A tyre barrier is on the road edge** at Pen Alley, s=1193 to 1202, 0.9 to 1.0 m inside the racing surface.
5. **Holes.** 3 rays hit nothing at paved-edge points, and 12 of 552 points inside the flat corridor have the terrain mesh as the top surface. A hole shows the sky colour, which is the blue I saw.
6. **Sausage kerbs are 13 cm tall in the mesh but the physics ground is flat**, so the wheels sit inside the hump. Kerb width jumps by 1.0 m between neighbouring samples at 32 places, so kerb and sausage strips start and stop with a hard step.
7. **The car is shaken with white noise.** `car.js` line 120 sets `body.position.y = (Math.random() - 0.5) * 0.02 * bump` every frame. Random per frame is a buzz, not a bump. Grass (0.2), concrete (0.25), gravel (0.6) and kerb (0.35) all trigger it.
8. **The elevation data is smooth** (tightest vertical curvature radius 1,106 m, largest deviation from a 30 m average 3.6 cm). So the bumps I felt are not in the height profile at `cb28eb1`. They come from items 1 to 7, or from the layout and height changes in the Codespace copy. Find out which.
9. **PowerMedia dominates the sponsor boards.** `sponsorPoly()` forces every second panel on tyre walls to row 0 (PowerMedia), and the picker chooses from `MODERN_SPONSORS`, where indices 0 and 5 are both PowerMedia. About two thirds of panels are PowerMedia. Also, only 2 of the 4 period brands in the reference pack exist.

## What I see in the Codespace copy

- Bumps I did not have before. They affect the car only in some corners but are visible and look bad.
- The run-off has little kerb-like raised strips, named in the debug view concrete, concrete outer (twice) and kerb. They are meant as rumble strips. They look wrong.
- Some surfaces sit above each other, and I can see blue below the map.
- The run-off out of the double hairpin complex is a V.
- The bridge entry is too narrow, it is easy to drive off the road before the bridge, and there is a gap with no barrier that a car can drive through.
- The same barrier template is spammed in many places, and many do nothing.
- The armco looks bad.
- The pit road mouth is no longer zero width, but it still does not join the track cleanly.
- The pit barriers on the left of the start straight look good.
- The project has gone forwards and backwards.

## Work, in order. Commit after each item. Run `npm run check` (item J) at each commit.

### A. One continuous ground surface

Stop stacking material strips at different heights.
- Build the ground surfaces (road, kerb, sausage, apron, concrete, rumble, gravel, grass, pit) as **one watertight ribbon mesh per side with shared vertices at every band border**. Surface type is a vertex attribute or material group, not a separate offset layer. All bands take their height from `track.groundAt()` (fix pass 2, item A). No lifts of 0.03, 0.035 or 0.05 m.
- Raised features are real and have their own profile: kerb up to 3 cm, with a 1 m ramp at every start and end. Sausage kerbs 5 cm at most, and the physics ground follows the profile.
- Line markings, edge lines and arrows are decals, drawn with `polygonOffset` and `depthWrite: false`, or baked into the road texture. Nothing within 1 cm of another layer without an offset.
- Camera near 0.5, far 2,600 in the race view. If z-fighting remains, use a reversed or logarithmic depth buffer only on high quality.
- Fix finding 3: clip offset curves against the road footprint and detect folds on the inside of bends. Fix finding 4.
- No holes. Add a huge dark earth plane 5 m below the lowest terrain as a last resort so a hole can never show the sky.
- Kerb widths change at most 0.2 m per metre of track.

### B. Bumps

1. Add `tools/bumps.js` and `npm run bumps`. It builds the geometry headlessly (stub the canvas) and raycasts down along both wheel tracks, the centreline and the kerb edge, every 0.25 m, across the lap. It reports surface height relative to the centreline height by s, d and mesh name. Pass: on paved surfaces the relative height varies by less than 5 mm along a wheel track, and no step is above 1 cm anywhere except real kerbs.
2. Run it on the Codespace copy and on `cb28eb1`. Report which bumps are new, where, and the cause. Check the height at the control points near the changed final corner.
3. Smooth the elevation: spline the heights over the whole lap with a vertical curvature limit (radius 300 m or more, 120 m at the one crest and one dip).
4. Replace the random jitter in `car.js` with a smooth vibration: low-passed, with a frequency tied to the speed and the surface's rumble spacing, and amplitude in millimetres. It also feeds the camera and the sound later.
5. Wheels follow the actual surface at each wheel (kerb and rumble profiles included), not just the centreline.

### C. Run-off surfaces and rumble strips

- Rumble strips are **flat bands in the surface**: a texture with a grooved look and a physics bump, at most 8 mm of relief, 0.5 to 0.6 m wide across the apron, with no kerb geometry and no red and white. They sit 1/3 and 2/3 of the way out as in fix pass 2, item C.
- Rename surface types in code and the debug view: `tarmac`, `kerb`, `sausage`, `runoff`, `runoff-rough`, `rumble`, `gravel`, `grass`, `pit`. Remove concrete, concrete outer and any duplicate. One name, one meaning.

### D. Double hairpin exit: Monza-style chicane run-off

Replace the V-shaped run-off at the exit of the double hairpin complex (Nissen Hairpin and Sandbag, points 19 to 23) with a Monza-chicane-style escape. My reading, tell me if wrong: a flat paved cut-through lane beside the corner that cars can take if they miss it, marked with a bollard and tyre stack at the entry and a kerbed rejoin that merges back into the track at a shallow angle. Using it adds a time penalty. The lane has full grip, a rumble strip at each end, and gravel and grass beyond it. Build it from a width profile, not a polygon.

### E. Bridge approach

- The bridge deck and its approach are at least 2 m wider on each side than the track. The parapets begin 30 m before the deck, with a flared, ramped terminal and tyre stacks at the ends.
- No gap: run containment barrier right up to the parapet on both sides, with continuous barrier at the joins. A car must not be able to leave the road before or after the bridge.
- The embankment is no steeper than 1:3, with armco or tyre barrier at the toe.
- Add an audit that sends 200 cars at random angles toward the bridge approach at 60 to 200 km/h. None may reach the drop.

### F. Barriers: stop the template spam, and replace the armco look

- Barrier sections come only from the departure fan (fix pass 2, item C). Write `docs/barrier-log.md` with one line per section: s range, side, type, and the stopping point that justified it. A section with no justification is deleted.
- Fail the audit if any (type, length, offset, angle) combination, rounded to 5%, appears more than twice, or if any section has no log entry.
- **Visible barrier = sponsored tyre wall.** Conveyor-belt-faced tyre barrier panels with bolt heads and a sponsor wrap, 1.2 m high on plain stretches, 1.9 m at impact zones, with a rounded top edge. Armco becomes the hidden rear rail behind them, and the visible armco with posts is removed except at attenuator ends. Where cost matters, use instanced panels; do not model individual tyres.
- Leave the pit wall and pit-side barriers on the left of the start straight as they are. I like them. Take a screenshot as a reference before touching anything near them, and compare after.

### G. Sponsors

- Fix the picker: pick by a hash of the panel index so every brand appears, and cap PowerMedia at 15% of panels. PowerMedia keeps the start gantry and the bridge banners. Remove the duplicate `powermedia2`.
- Add these fictional brands to the atlas (name, colours, one line): Tarnwick Bank (green `#0B6B4F`, white; a bank), Zephra Sportswear (orange `#FF6A13`, black; sportswear), Corvane Fuels (red `#D3202B`, grey `#6A6D72`; fuel), Lumenor Lighting (yellow `#FFC93C`, navy `#14264A`; lighting), Oxley Freight (blue `#1F4E9E`, white; haulage), Brightfold Energy (cyan `#19B5C9`, dark `#0E2A33`; energy supplier). Add the two missing period brands from `LAKESIDE_REFERENCE_PACK.md`: Kingsbury Plugs and Aldershaw Radio and Television. Total 16 with the current ones.
- Add `public/sponsors/<id>.png`. If a file exists for a brand it replaces the generated board, scaled to fit with the brand colour as the background. I will supply logos.

### H. Pit road joins the track

- At entry and exit the pit road is one continuous surface with the racing surface: same height, same material, same texture, no edge line and no kerb across the mouth, for the first 15 m. The lighter pit asphalt fades in over 10 m after that with a vertex blend, not a hard edge. The gore (chevron island) then separates the two roads.
- Test: at 60 km/h, drive from the track into the pit road from five lateral offsets at the entry, and from the pit road onto the track at the exit. No wheel may touch grass or a kerb.
- Do not touch the left pit barriers (see F).

### I. Final corner double apex

Record the changed layout (the long final corner split into a double apex) in `layout.js` and `corners.js`. Rerun `npm run cornersheet` with the Keyboard average driver. All run-off, kerbs and barriers there must come from the new data, not from the old shape.

### J. Regression guard

I keep losing things that worked. Add `npm run check` that runs `laptest`, `audit`, `bumps` and a new `surfaces` scan (overlaps within 3 cm, holes, gravel or tyres on the road, unsupported floating parts). All must pass before any commit. Add `docs/CHANGELOG.md` and a **keep list** at the top: things I like that must not change (the left pit barriers on the start straight, the Sebring concrete look, the debug view). Tag the current good states with `git tag`. If you can render the game headless, save a golden screenshot of each keep-list item and compare after each item.

## Constraints

- Fix only what is listed. Do not change handling, except that the keyboard tuning from fix pass 2 item 0 stays.
- Do not start the Operations Block, grandstands, car or sound.
- No new dependencies. Keep the Blockout setting working. Keep tablet performance: instance repeated objects and respect the quality presets.
- Put every per-corner decision in `corners.js`, with comments in plain English.

## When you finish

Commit and reply with: the contents of `docs/codespace-diff.md`, a table of what changed per item A to J, the output of `npm run check`, the bump report (what was new and why), anything you could not fix, and anything I need to decide.
