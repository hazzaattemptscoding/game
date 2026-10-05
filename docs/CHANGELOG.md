# Changelog

## Keep list

Things that are liked and must not change. `npm run check` does not test these; look at them by eye
(`node tools/shot.mjs out.png "viewat=3800,-8,1.8,40"` takes a picture of any spot) after each change.

- The pit barriers on the left of the start straight (pit wall, white top, sponsor panels, catch fence, attenuator).
- The Sebring look: old runway concrete as the run-off at Scramble, Windsock Hairpin and Boundary Loop.
- The debug view (I or F3): top-down, every surface and barrier type in its own colour.
- The Blockout setting.
- Keyboard handling and the keyboard tuning from fix pass 2.

## Menu, sessions, garage, controller (wired in)

- The game opens on the main menu over a slow orbit of the start straight: Free practice, Time trial, Race, Online, Garage, Settings (`src/menu.js`, `src/menuScreens.js`). Arrows and Enter, mouse, touch or a pad; Esc or B goes back.
- `src/director.js` joins the menu, `src/session.js` (state machine, lap counting, results order), `src/start.js` and `src/sessionHud.js` to the game. Esc, P or the pad's Start pause in a session and open the pause menu (Resume, Restart session, Settings, Report a problem, Back to main menu). Offline the game stops; in an online room the car keeps rolling behind the menu.
- Race: setup screen (laps 3, 5, 10, 20 or custom, assists any or all off, racing line allowed or not), then the grid, the start camera, five lights and a random hold. Jumping the start is +5 s. The race ends at the chequered flag and the results screen (`src/results.js`) comes up 3 s later. AI opponents are shown as "Coming soon" and disabled.
- Time trial: starts at the pit exit with a 3, 2, 1 count and a lap list. Free practice has no rules and can start from the pit or the grid.
- Online: the lobby block moved into the Online screen. The host sets laps, assists and the racing line and starts the race; guests start from the host's message on their own clocks (`src/raceControl.js`). A late joiner drives freely.
- Settings (one screen, five tabs): Driving (units, the three assists, steering, cursor sensitivity, racing line), Display, Sound (on or off, volume), Controls (controller, `src/gamepad.js`), Online (name). The old settings panel is gone.
- Garage (`src/garage.js`) is the Garage screen. `settings.livery` paints the player's own car, the garage preview and the standings, and goes out with the hello and every 2 s, so every screen shows each car with the same paint. A player with no saved livery gets the default for their player id.
- Racing line: `createRacingLine(track)` is in the scene; the L key, `settings.racingLine` and the Settings switch drive it, and a race can forbid it.
- Page parameters: `?menu=0` skips the menu and starts free practice (also implied by `?viewat=`, `?view=`, `?topdown` and `?autopilot`). `?menu=race|practice|settings|garage|online|main` opens that screen, `?start=race|timetrial|practice` starts that session, `?garage` opens the garage, `?mute` and `?at=` as before. `node tools/shot.mjs out.png "menu=race"` takes a picture of a screen.
- Fixed: the first frame could carry a time stamp from before the loop started, giving a negative step that wound the keyboard inputs up. The step is now never below zero.
- Tests: `tools/smoke.mjs` opens 11 views (drive, top-down, fixed view, menu, race setup, settings, garage, online, race start, time trial). `tools/cursor.js` expected an empty object for damaged saved settings; `migrateSettings` now always adds the controller defaults, so it expects nothing else. No laptest limit was changed.

## Optional racing line

Off by default. L key, `settings.racingLine`, or the page parameter `?line=1`; a session can forbid it with `session.racingLine === false`.
A 0.9 m ribbon painted on the road (`src/racingLine.js`): green throttle, yellow lift, red brake, drawn from 40 m behind to 350 m ahead of the car.
The line and its classes come from the real autopilot lap (`npm run racingline` writes `src/racingLineData.js`; `npm run check` fails if the track or the physics
changed and the file was not regenerated). `node tools/shot.mjs out.png "viewat=330,0,1.8,40&line=1&at=300"` takes a picture with the line on.

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
