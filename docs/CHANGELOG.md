# Changelog

## Keep list

Things that are liked and must not change. `npm run check` does not test these; look at them by eye
(`node tools/shot.mjs out.png "viewat=3800,-8,1.8,40"` takes a picture of any spot) after each change.

- The pit barriers on the left of the start straight (pit wall, white top, sponsor panels, catch fence, attenuator).
- The Sebring look: old runway concrete as the run-off at Scramble, Windsock Hairpin and Boundary Loop.
- The debug view (I or F3): top-down, every surface and barrier type in its own colour.
- The Blockout setting.
- Keyboard handling and the keyboard tuning from fix pass 2.

## Track fixes: chicane, street section, bridge ground

- Guardroom Chicane is narrower. The tarmac is 10.5 m wide (13 m elsewhere) from point 56.1 to 59.1 (s 3452 to 3542), easing back to full width over 60 m before and 50 m after (smoothstep, no step in the edge; the pit road entry at s 3605 is on full width). `LAYOUT.narrow` holds it. `T.hw[i]` is the half width at each sample and is used by the surfaces, kerbs, run-off, wall line, bollards, ground ribbon, racing line and the audits; `T.halfWidth` is still the full layout half width. Kerbs, apron, gravel and the wall line are measured from the edge, so they move in with it; the track limits bollards stay on the inside kerb. `src/racingLineData.js` regenerated (`tools/racingline.js` now rounds the offsets to 5 cm without going past the per-sample limit). Laptest (analog laps 1:30.942 / 1:33.958 / 1:34.975 before): 1:30.925 / 1:33.925 / 1:34.958 after; keyboard excursions 17 before, 14 after, none in the chicane; keyboard average +5.2 s before, +5.3 s after. 10 m and 9.5 m wide gave +7.3 s and +7.1 s for the average keyboard driver, over the 7 s limit; the limit was left alone and 10.5 m kept.

## Track detail pass (venue)

Visual only. Nothing in `track.js`, the physics, the surfaces or the barrier audit changed; the placement rules are checked by `npm run venue` (also in `npm run check`).

- Start gantry (`src/gantry.js`): a steel truss over the straight on legs 4 m outside the white lines (1.7 m clear of the pit wall), soffit 7.0 m above the road and nothing hanging below 6.25 m. START / FINISH timing banner with chequered ends facing the grid, PowerMedia on the other face, sponsor boards along both faces of the truss, one long lamp housing with five modules of two lamps each. `group.userData.lights` is unchanged (five pairs of lamp meshes, emissive off), so the start lights wiring is not affected. The start line is now a chequered band and every grid slot has a painted box (front bar, two side bars, closing bar), on the same slots as before.
- Bridge (`src/bridge.js`): deck soffit with edge girders, PowerMedia banners on the girders, expansion joints across the deck, debris fence on the parapets, abutment walls at both deck ends and where the deck leaves the embankment to span the straight, concrete footings that run down into the terrain, tyre stacks (three high, the existing tyre wall texture, white top tyre) on flat ground at the foot of the abutment walls. Piers are only placed 6 m beyond the containment wall of any part of the circuit; on this layout the span over the straight leaves none, so the abutments carry the deck. The pit garages now stop short of the deck (their roof was level with it).
- Grass: the ribbon's grass band is mown in 5 m stripes along the track (`mownGrassTexture`), the band beyond the containment wall and the terrain use a rougher meadow texture with a second look at the same texture at another scale to break up the repeat, and the terrain tint drifts into lush and dry patches with distance. Band borders and surface names are untouched (`groundRibbon.js` only names the outer band `meadow`).
- Grandstands (`src/grandstands.js`): five stands (main straight, Scramble, Windsock Hairpin, the street section, the final chicane) with stepped seat tiers, front sponsor hoarding, aisles, a roof on columns with a sponsor fascia, a spectator fence behind the barrier line, and about 5,000 spectators as two InstancedMeshes per stand (torsos and heads, colour per instance). Each stand is at least 11 m behind the containment wall, 6 m from every barrier line, and clear of the pit lane, buildings, the bridge and the other stands. If a place fails the check the planner shortens the stand or moves it along the lap.
- Props (`src/props.js`): marshal posts every 170 m on the outside of the bend, 50 m boards after each 100 m board, lamp posts (stand ends, behind the pit building, along the street section), two flag masts at the main stand, advertising hoardings on the longest straights behind the catch fence line, and tree lines well away from the circuit (instanced). Each item is checked against the walls, barrier lines, stands and buildings and left out if it fails.
- Pit building (`src/pitBuilding.js`): garage number plates, roof parapet and rooftop plant. `garageBay` (which samples the block stands on) moved here from `trackMesh.js`.
- Other: the timekeepers' box moved from s = 18 to s = 4 to make room for the main stand. `createGround` has `meshHeight(x, z)`, the terrain height exactly as drawn (same grid and triangles as the mesh); things that stand on the ground use it so nothing floats. `sceneryLayout` and `sceneryFootprints` give the building positions as numbers. The sponsor atlas is one shared canvas (`sharedSponsorAtlas`).
- Cost: everything repeated is merged or instanced. The venue adds roughly 40 draw calls and under 250,000 triangles; the crowd, trees, lamps and tyres are instanced and cast no shadows.
- Not done: the gantry legs have no collision (as before: they stand on the grass beside the kerbs, outside the racing surface), the stands, props and bridge parts are behind the containment walls so cars cannot reach them; kerb paint beyond the existing red and white.

## Live timing and spectators (todo 20)

- New page `live.html` (built to `dist/live.html`; `vite.config.js` lists it next to `index.html`, the single file artifact build stays game only). It lists every open online lobby (code, host, players, mode, laps, Lobby or Racing, relay ping, refreshed every 3 s) and opens one as a spectator: `live.html#ABCDE`. Relay address: `?relay=` or `relay` in `multiplayer.json`, like the game.
- Live view (`src/live/`): the real track and scenery, all cars with their liveries drawn by `Ghosts` and `CarView` with the game's interpolation (the stream is 10 Hz, so they are drawn 0.3 s late). Cameras: TV director (`tv.js`: leader 7 to 12 s, battles up to 18 s, an incident after 3 s, the start and the flag cut in at once), onboard, chase, trackside (10 fixed cameras on the outside of the sharpest corners, `[` and `]` or a second click change camera), heli, free (drag, WASD, Q and E, Shift; buttons on a phone). Keys 1 to 6 pick the camera, N and P the driver.
- Panels: timing tower (position, name, gap, interval, three sector colours, last and best lap, purple for the fastest lap), telemetry of the shown driver (speed, gear, rpm, throttle, brake, steering, g, TC, ABS, DRS, pit limiter, off track surfaces), track map with car dots, event feed (joined, left, fastest lap, race start and end, finishes). On a phone the panels are tabs under the picture.
- Gaps and sector times come from the state stream only (`src/live/model.js`): sector and lap times from each car's own clock, gaps from checkpoint passing times every 100 m on a shared clock, so a gap is a time, not distance over speed. Outside a race the tower orders by best lap.
- Game side: the host sends the room details (`meta`: mode, laps, started) every 5 s and when they change; every player sends a 14 byte telemetry frame 10 times a second, only while a spectator is in the room (`src/shared/telemetry.js`); a room with only one player now sends state while somebody watches. `Ghosts` takes a `max` option (the live page shows 8 cars).
- Relay (`worker/src/protocol.js`): spectators (role join `spectator:true` or `?spectator=1`) do not use player seats, at most 50 per room, receive only (every other message from them is ignored, rate limit and size limit apply), get a snapshot on joining (livery, names, events, last state and telemetry per car). Telemetry is forwarded to spectators only. The host's `meta` is cleaned and bounded. The lobby entry now includes the host name. `GET /lobbies` and `/lobbies/CODE` were finished and are cached 3 s.
- Tests: `tools/live.js` (in `npm run check`, 217 checks): spectator protocol, limits, directory and publisher, the dev relay end to end with bot cars (`tools/lib/bots.js`: real physics and autopilot talking the real protocol) and a real `SpectatorRoom`, telemetry codec with hostile input, the race model, the TV director, camera spots. `node tools/live-shot.mjs outdir` takes screenshots of the lobby list and every camera, desktop and phone, against the dev relay with bots.
- Worker: no manual step. The Worker redeploys on a push to `main`; the new `Directory` Durable Object is already in `wrangler.toml` (migration v2). Check `https://<worker>/lobbies` after the deploy. Old game builds keep working but show no telemetry and list as Free practice. See worker/README.md.
- Not done: no finish line crossing events from the game (the page works out laps and finishes from the state stream), no replay, no chat. The relay ping column is the page's round trip to the relay, the same for every row.

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
