# Lakeside: plan for a fresh session

Written for a model starting with no context. Read this file first, then `README.md` and the top of `docs/CHANGELOG.md`.

## What this is

Lakeside is a browser racing game (Three.js, Vite, plain JS modules) on one fictional circuit. The owner is Harry (PowerMedia, a photographer and business owner). The core of the game is multiplayer and time trials. Single player has free practice, time trial and a race setup. There are no AI opponents (dropped on purpose; an old WIP is in `git stash list` as "wip ai-opponents", ignore it).

- Repo: `hazzaattemptscoding/game`. Work on branch `claude/keen-rubin-ue6z6k`. `main` is behind it. Pushing to `main` redeploys the Cloudflare relay Worker, and the owner has said that is fine once checks pass.
- Static game site: IONOS at `beta.powerrmediaa.com`. The owner uploads `lakeside-site.zip` by hand. It is the plain `npx vite build` output in `dist/` (it includes `.htaccess`, `multiplayer.json`, `live.html` and the sponsor video).
- Relay: Cloudflare Worker `lakeside-relay.harry-eb8.workers.dev` (`worker/`, Durable Objects, WebSocket rooms, a Directory DO for open lobbies, a spectator role).
- Artifact copy (single-file build, no multiplayer): https://claude.ai/artifact/1PS5BXtVjYLi4L7fbfW9oW, built with `node tools/artifact.mjs out.html`. Last published: version 17 from `abbb0cc`.
- Play reports from the owner land in `reports/*.json` (note text, car position `s`/`d`, screenshots). `node tools/reports.js` indexes them.

## Rules from the owner

- No em dashes anywhere (code, UI text, docs, commits). No corny, cringe or marketing text. Never write "I hear you".
- Work one item at a time, not in parallel. Verify before moving on.
- Do not loosen the laptest limits (`EXCURSION_LIMIT` 20, `AVERAGE_LIMIT` 7). Track and physics changes must keep `tools/laptest.js`, `audit`, `bumps`, `surfaces`, `venue` passing.
- Commit with `git add <paths>` only. End commit messages with the attribution lines the harness gives you. Do not open a pull request unless asked.
- The owner usually presents an idea and wants a final verdict. For complex or ambiguous requests, ask a short question first.
- Only the owner can test on real devices (phone, controller, two-device multiplayer, live timing). Say plainly what you could not verify.

## How to work in the repo

- `npm run check` runs 19 steps (laptest, audit, bumps, surfaces, venue, smoke, limits, audio, assists, cursor, board, multiplayer, relay, live, relay-client, session, racingline, hudsettings, perf). Run it in a clean `git worktree` at the commit you are shipping, with `node_modules` symlinked in, in the background (it takes a long time). Do not run it in the working tree while others edit.
- Screenshots: `node tools/shot.mjs out.png "viewat=S,D,HEIGHT,AHEAD"` (header of the file lists URL params: `?menu=...`, `?topdown`, `?weather=...&time=...`, `?start=...`). Headless Chromium has no H.264, so the bridge and gantry video shows its fallback board.
- Measure rendering with `tools/rstats.mjs` (`PORT` env). Frame time there is software GL, only compare runs with each other. Budget: under about 700 draw calls.
- Ports 5198 and 5199 are used by the check and `shot.mjs`. Use other ports for your own servers.
- Key code: `src/main.js` (frame loop wiring), `src/loop.js` (fixed 120 Hz physics step plus interpolation), `src/director.js` + `session.js` + `start.js` + `results.js` (menu and sessions), `src/track.js` + `layout.js` (centreline samples `T.x/z/h/s`, half width `T.hw[i]`), `src/livery.js` + `garage.js`, `src/weather.js` + `environment.js`, `src/cull.js` (splits and merges meshes for culling), `src/quality.js`, `src/bannerVideo.js` (single shared sponsor video), `worker/src/*`, `live.html` + `src/live/*`.

## Where things stand

Pushed to the branch, checked, working: menu and sessions, garage and livery, racing line, controller driving and menu navigation, online rooms over the relay, live timing spectator page, track detail and venue (12 stands, props, floodlights, media tower), weather and time of day (visual only), HUD options and track map, 120 Hz fixed-step loop, graphics quality setting (Auto, High, Medium, Low) and FPS readout (F), PowerMedia logo and DeltaDash sponsor (trackside and as a car sponsor), rebuilt start gantry with the video, one shared sponsor video.

Open problems to settle first:

1. `main`, the zip and the beta site are all behind (`main` is at `b2a1afb`). Run the full check on the branch head, push `main`, rebuild the zip and publish the artifact.
2. The smoke test (`tools/smoke.mjs`) timed out on page loads (`page.goto` 90 s) on the performance commit. The dev-server load event was about 15 s on the Monday-morning build (`b2a1afb`), 25 s on the gantry commit (four copies of the video) and about 17 s on the head. Find out what still delays the load event, and whether the smoke test is just too heavy when pages run three at a time.
3. Commit `56c1e35` (floodlight and headlamp pools hidden in daylight and map view) was written by an agent that hit a rate limit mid-task. Look at it by eye (day, night, `?topdown`) and confirm the pale squares from the report are gone.
4. The new start gantry supports sit about 4 m outside the half width, which still looks close to the road edge in screenshots. The owner called the old one dangerous.
5. The sponsor video playing in a real browser has never been seen. The artifact viewer may also block an embedded video.

## Queue, in order

Each item: do it, verify it, update `docs/CHANGELOG.md`, commit, then ship when a batch is done.

**Idea from the owner, parked (2026-10-05), do not start until asked: live leaderboard with ghosts.** Gather LEGAL laps only (no track limit warnings), tagged wet or dry, and kept separate for single player and online sessions (and normal or reverse direction, which now exists in free practice). Upload them to a database on the relay server so everyone can see the times, load a lap's ghost and race against it. Replaces queue item 6 below when it is picked up.

**Queued by the owner, not started (2026-10-05): move the pit entry earlier.** Report `reports/lakeside-report-2026-10-05T17-23-34-296Z.json`, build cd2f1b1, car at s=3433 d=0.2 on the left of the track after the final turn: "Pitlane entry is here. Makes pit entry much easier and allows for a nice runoff out of the exit of the final turn". Today the pit road leaves at layout `pit.entry` 60.5 (about s=3605), roughly 170 m later. Owner's intent: the pit road splits off on the left from about s=3433, so the paved entry also works as run-off on the exit of the final turn. Things to settle when it is picked up: whether the pit lane (and limiter line) starts earlier too or only the entry road is longer; what happens to the left-side tyre wall and the grandstand on that side; keep `tools/audit.js` pit drive-in passing and the laptest unchanged. Wait for the owner to say go.

1. **Infield surfaces and barriers near s=3149.** Report: the inside of the track should be grass for the nearer half with gravel kept on the far inside, and the inside barriers are "squiggly" (smooth them).
2. **Pit building has no side wall (s=6).** Close the ends and finish the detail.
3. **Pit exit (s=372).** The owner's sketch is `docs/pit-exit-sketch.webp` (view it). Intent: the pit exit runs alongside the track for a stretch, separated by a solid line and painted hatching, then joins at a shallow angle with a long hatched merge zone. It currently cuts onto the track abruptly, which the owner calls too dangerous. Ask whether the separation is paint only or a wall, and whether the car may cross it. Keep the pit drive-in and drive-out audit passing.
4. **Terrain cliffs near s=50 and s=2045.** Smooth the steep ground beside the road. Tighten the audit slope limit (currently 0.84 max). No lap time change.
5. **Wet grip, wet line and tyre choice.** Per-sample wetness, rising and falling over time. Dry and Wet compounds, with a "wet tyres recommended" hint when it rains. A drier line appears over time where cars have driven (per lateral band, shown on the road surface without adding draw calls, remote cars dry it too). Keep the dry laptest unchanged. The owner asked for this explicitly (it changes how the car drives).
6. **Live leaderboard with driver times.** A global best-laps board kept on the relay (Durable Object, HTTP endpoints, CORS, plausibility checks, rate limit, quiet retry when offline). Menu screen, in-game panel, and a live panel on `live.html`. The owner cannot test live timing, so build thorough bot-driven tests (`tools/lib/bots.js`). Document any Worker migration or config step the owner must do in `worker/README.md`.
7. **Controller button guide.** While in menus, show a legend bottom left (A select, B back, bumpers for tabs, from the real gamepad mapping). Xbox navigation already works.
8. **Chase camera free look.** Orbit around the car (mouse drag, right stick), easing back behind the car on release.
9. **Track limit penalties.** Warnings exist. Add time penalties and tie them to the leaderboard (valid laps only). Not started, confirm the rules with the owner first.
10. **Phone HUD and touch controls** (parked, owner said later): thumb-sized steer, throttle and brake zones, safe-area insets, no page zoom or scroll, HUD readable at 360x740, 412x915 and 915x412, menus usable by touch, fullscreen hint. Then **live chat** in online rooms.
11. **Broadcast cameras and a livestream data feed** (low priority): clean no-UI output, auto director, overlays, a JSON or WebSocket feed of all race data.

Replacing the repo's pale placeholder sponsor artwork is the owner's job (they are adding logos themselves).

## Final pass

When the queue is mostly done, do a whole-codebase clean-up and enhancement pass: remove dead code (for example anything left from the dropped AI opponents), dedupe helpers, tighten tests, keep docs current, review for the unverified items above, and leave `npm run check` green on a clean tree.
