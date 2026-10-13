# Lakeside to-do

Kept in step with the session task list. Top of the list is what the owner asked for most recently.

## Now
- [x] **Visual pass** (branch `claude/modest-franklin-cfflad`, see `docs/CHANGELOG.md`): sky reflections, clear coat paint, rubbered-in racing line, the whole circuit floodlit at night, the GT rebuilt as a GT4, real wheels, Formula 4 and Formula 1 classes, a pit garage behind the main menu, new trees and crowds, shift lights.
- [ ] **Deploy the relay worker before the game**: until it lists F4 and F1, laps in those classes stay queued.
- [ ] **UI flow**: the owner says the v2 UI "makes no sense". Walk the real flow on a tablet with keyboard and mouse, collect the specific complaints, fix the flow before any more restyling.
- [x] **DRS animation** (`src/drsFlap.js`): the rear wing flap opens and closes. DRS currently has physics only (`physics.js`: drag and downforce cut) and no visual. Needs the flap on the player car (`car.js`), the DRS state in the state packet so remote cars and ghosts show it, an easing, and a HUD cue. Works in reverse as well.
- [ ] **Report delivery**: `src/report.js` writes reports to the artifact database, with a download fallback; the test artifact is published with the `db` and `downloads` capabilities. Still to do: an F2 hint, check the Report button is reachable on a tablet with a keyboard.

## Next
- [ ] **Track fixes from the owner's reports** (read from the artifact database, collection `reports`):
  - s=56: the left kerb on the main straight is useless.
  - s=1375: the run-off should be further down the track (a fence and a run-off were selected).
  - s=3359: the pit entry sign points the wrong direction.
  - s=3442: no-collide fencing blocks the pit lane entry.
  - s=3605: extend the run-off, add rumble strips, add tyre barriers on the exit wall that slow the car less than concrete.
  - The report at s=326 (in the pit lane, "barrier on track") has no note.
- [x] **Cars**: car abstraction (`cars.js`, `physics.js`, `car.js`, lobby sync, livery, ghost lines, global times boards per car); convert the current GT into a GT1; add a city cup car (Peugeot 108 style).
- [ ] **Remove PeerJS**: online play is Cloudflare only; removing it closes the last host-takeover gap.

## Verify on real devices
- [ ] Touch and keyboard switching on a real tablet.
- [ ] A real two-player race to the flag (finish messages, results ranking).
- [ ] Cloudflare location hint on a deployed room.
- [ ] A populated global times board, roster ping and host states.
- [ ] The night light's cost on phones (one more light in every lit shader), and shader compile time on a real GPU (`docs/perf.md`).
- [ ] The F1 on a keyboard with assists off: very hard in the headless driver tests.

## Polish
- [ ] Garage pinned footer looks clumsy.
- [ ] Pause: Resume sits too close to the title; the rail is mostly empty.
- [ ] Per-player ping is not sent, so only your own shows in the roster.
- [ ] Italic lettering in the 3D scene (gantry sign, textures) was left alone on purpose.
- [ ] Race setup Warn/Penalty is not in the online host setup.

## Release
- [ ] Pull requests for `claude/bug-pass-1` and `claude/ui-pass` when the owner says so. Not opened yet.
- [ ] `claude/relaxed-lamport-jyykn6` still holds the track maker commit, which is not on `main`.
