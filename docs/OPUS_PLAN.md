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

Done since this queue was written (see the changelog): infield and Boundary Loop barriers, pit building, pit exit, pit entry before the Guardroom Chicane, global times with ghosts (the old items 6 and the parked leaderboard idea), chase camera free look, camber and more elevation, minisectors and marshal panels, hill camera.

1. **Escape roads** at the three heaviest braking zones: Scramble (end of Runway Straight), Windsock Hairpin, Nissen Hairpin. Owner asked 2026-10-06.
2. **Floodlights**: better modelling and real coverage of the track at night. Owner asked 2026-10-05.
3. **DRS in reverse** (owner, 2026-10-07). Reverse direction has no DRS zones of its own: `layout.drs` holds the two forward zones (points 59.3 to 3.1 and 40 to 43), and `track.inDRS` checks the same stretches whatever the direction. Give reverse its own zones on its long straights (detection before, activation after), shown the same way on the HUD and the track, and keep the forward zones unchanged.
4. **Terrain cliffs near s=50 and s=2045.** Smooth the steep ground beside the road. Tighten the audit slope limit. No lap time change.
5. **Wet grip, wet line and tyre choice.** Per-sample wetness, rising and falling over time. Dry and Wet compounds, with a "wet tyres recommended" hint when it rains. A drier line appears over time where cars have driven. Keep the dry laptest unchanged. (The global times already keep wet and dry laps apart.)
6. **Controller button guide.** While in menus, show a legend bottom left (A select, B back, bumpers for tabs, from the real gamepad mapping).
7. **Track limit penalties.** Warnings exist and already keep a lap off the global times. Add time penalties in races. Confirm the rules with the owner first.
8. **Phone HUD and touch controls** (parked, owner said later): thumb-sized steer, throttle and brake zones, safe-area insets, HUD readable at 360x740, 412x915 and 915x412, menus usable by touch. Then **live chat** in online rooms.
9. **Broadcast cameras and a livestream data feed** (low priority): clean no-UI output, auto director, overlays, a JSON or WebSocket feed of all race data.

Open questions for the owner: the screen control panel's "Something else" option came through blank; what was it meant to be?

Shipping: `main` has not been pushed this week. A push to `main` also redeploys the relay Worker (Cloudflare builds it from `main`), which is what turns on the global times storage (migration v3). The game itself goes to IONOS by hand from the site zip.

Replacing the repo's pale placeholder sponsor artwork is the owner's job (they are adding logos themselves).

## Final pass

When the queue is mostly done, do a whole-codebase clean-up and enhancement pass: remove dead code (for example anything left from the dropped AI opponents), dedupe helpers, tighten tests, keep docs current, review for the unverified items above, and leave `npm run check` green on a clean tree.
