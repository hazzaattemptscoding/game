# Lakeside: build prompt for Claude Code

Paste everything below into Claude Code in an empty folder. Put the prototype `index.html` in `reference/prototype.html` first.

---

## Goal

Build **Lakeside**, a browser racing game with the look and feel of iRacing Arcade: stylised but not low poly, clean shapes, rich lighting, a racetrack that feels like a real venue. One fictional circuit, GT cars, playable solo or with up to 8 friends online. It must deploy as a static site to Cloudflare Pages.

The owner is Harry, who runs PowerMedia (UK motorsport photography). He judges this by how it looks and how it drives, in that order of pain: the last prototype looked cheap and the car slid on every input. Fixing those two things is the job.

## Reference

`reference/prototype.html` is a rough single-file prototype. Take from it only:
- the track control points (`RAW`, `RAWPIT`) as the starting layout
- the PeerJS room flow (host a room, 4 letter code, invite link)

Do not carry over its visuals, colours, kart, or physics. The blue walls, green strips and purple areas in it came from a colour-coded sketch and were never meant as a look.

## Stack

- Vite, vanilla JavaScript ES modules, three.js (current release), PeerJS.
- No TypeScript, no UI framework, no physics engine, no ECS. Reason: Harry is learning JavaScript and needs to read and tune this code himself, and a custom car model is easier to tune than a general physics engine.
- `npm run build` must produce a static `dist/` that works on Cloudflare Pages with no server.
- Work in metres and seconds throughout.

## The circuit

Name: **Lakeside**. Setting: flat-ish English parkland beside a lake, in the spirit of Silverstone for location and Monza for history. It is an old circuit refurbished into the top track in the country, and remnants of the old layout are still visible: a stretch of cracked, overgrown old tarmac and a section of disused banking in the infield or beyond the run-off.

Layout rules:
- Start from the prototype control points, scaled so a GT lap is about 90 seconds (roughly 4.5 to 5 km). Track width 12 to 14 m.
- Keep the signature features: the crossover where one section bridges over the main straight, the tight technical section near the far hairpin, two DRS straights, the long pit lane alongside the main straight, three sectors.
- You may open up corners that are too tight at this scale and add a few curves for flow. It currently reads a bit too much like Suzuka, so give it its own character, but keep the overall shape recognisable.
- Real elevation change: a downhill main straight, a climb to the bridge, a crest and a dip elsewhere.

Surfaces, each with distinct physics:
- Tarmac: full grip. Painted lines and the wet track are slightly slipperier.
- Kerbs: flat rumble strips are usable with vibration; raised sausage kerbs on the inside of chicanes unsettle the car.
- Tarmac run-off in a few places: usable, no penalty (this is what "track limits" meant in the sketch).
- Grass: low grip, mild slowdown.
- Gravel traps on the outside of fast corners: heavy slowdown, hard to steer out of.
- Armco, tyre walls and concrete walls with catch fencing in the tight section: solid collisions that cost speed.

Trackside dressing:
- Grandstands with crowds on the main straight and at two or three corners.
- Floodlight towers that actually light the track at night.
- Pit building with garages, pit wall, start gantry with five red start lights.
- Sponsor boards, bridge banners and barrier wraps. Use **PowerMedia** branding as the main sponsor, plus a few invented brands for variety. Generate these as canvas textures.
- Marshal posts with marshals, catch fencing, tyre stacks, distance boards before braking zones.
- Digital light panels around the lap that react live: yellow when a car is stopped or off ahead in that zone, blue when a faster car is about to lap you, green after the incident zone, red and green for the start.
- Tyre marks on the racing line and in braking zones, a darker rubbered-in line, skid marks laid by cars in real time.
- The lake, trees, distant hills.

## Look

- Stylised mid-detail, like iRacing Arcade. Smooth shapes, readable silhouettes, good materials. Not flat-shaded low poly, not photoreal.
- Make all assets in code: procedural geometry and canvas-generated textures (tarmac grain, kerb stripes, grass, sponsor art). If something cannot reach a good standard that way, such as the car body, you may use CC0 assets (free, no attribution required) from Kenney or Poly Haven, stored in `public/assets/`, and tell Harry which ones you used.
- Time of day is a choice: day, sunset, night. Sunset is the default and the hero look: low warm sun, long shadows, gradient sky. Night relies on the floodlights, headlights and glowing brake lights.
- Post-processing: bloom on lights, light tone mapping, subtle vignette. Shadows on medium and high quality.
- Weather is a choice: dry, wet, or dynamic (rain arrives mid-session). Wet means visible rain, spray behind cars, reflective tarmac, reduced grip.

## The car

- One GT car for now, built so more classes can be added later through a config object (mass, power, grip, gearing, dimensions).
- Liveries chosen by colour, with a number.
- Working brake lights and headlights, wheels that spin and steer, body roll and pitch.

## Handling

Target: easy to understand, hard to master. A new player should complete a clean lap within a few tries. A good player should find seconds through braking points, lines and throttle control.

- Fixed timestep physics at 120 Hz, decoupled from rendering.
- Bicycle model with a tyre slip curve: grip builds, peaks, then falls off, so the car is planted until overdriven and a slide is recoverable.
- Speed-sensitive steering, so it is stable at high speed and agile in hairpins. The prototype's main fault was constant-rate steering with weak lateral grip.
- Weight transfer under braking and acceleration, trail braking helps rotation, lifting mid-corner tightens the line.
- Automatic gearbox with audible shifts. Top speed around 270 km/h. DRS adds straight-line speed in the two zones.
- Light assists on by default (traction and stability), with an option to turn them off.
- Tune until a lap is about 90 seconds and the car feels good. Write a headless lap test with a simple autopilot so handling changes can be checked without a browser.

## Controls and cameras

- Keyboard, gamepad (analogue steering, triggers, rumble on kerbs where supported), and touch (on-screen steer, throttle and brake that work on a phone in landscape).
- Cameras, switchable: chase, cockpit or bonnet, and a spectator mode with trackside broadcast cameras that cut automatically to follow the action.
- Spectator mode has a live timing tower (positions, gaps, last and best lap, sectors) and a clean layout suitable for capturing in OBS for a live stream.

## Modes

- Hot lap: solo, with your best lap as a ghost.
- Race vs AI: grid start with lights, selectable lap count and difficulty.
- Online: host a room, friends join by code or link, up to 8 drivers plus spectators. Practice by default, host starts a race.
- Car contact is a host option: on (cars collide) or off (ghosts).
- Session options chosen by the host or solo player: time of day, weather, laps, contact, assists.

## HUD and sound

- HUD: speed, gear, rev bar, lap and sector times with deltas, position, minimap, DRS state, weather.
- Sound through the Web Audio API, synthesised so no audio files are needed: engine tied to revs and throttle, gear shifts, tyre squeal tied to slip, kerb rumble, gravel, rain, collisions.

## Multiplayer

- Keep the PeerJS star topology from the prototype, where the host relays state. Send inputs and state at 20 Hz and interpolate remote cars.
- Put networking behind a small transport interface. Reason: PeerJS's public signalling server can be unreliable, and this may move to a Cloudflare Durable Object later without touching game code.
- Leaderboards are per room for now. Persistent leaderboards are out of scope.

## Performance

Most players will be on tablets and phones, some on PCs. Target 60 fps on a mid-range tablet.
- Three quality presets, auto-detected with a manual override. Low drops shadows, post-processing and crowd detail.
- Instance repeated objects. Keep draw calls and texture memory modest.

## How to work

Build in phases. At the end of each phase, run the game, check it yourself, commit, then stop and give Harry a short summary of what works and what to look at. Wait for his go-ahead before the next phase.

1. **Drive feel.** Project setup, a plain grey test track from the control points, the GT car as simple shapes, full physics, keyboard and gamepad, chase camera, headless lap test. Nothing else until this drives well.
2. **The circuit.** Final layout at scale, elevation, surfaces, kerbs, walls, bridge, pit lane, collisions.
3. **The look.** Car model, materials, sky, time of day, floodlights, post-processing, grandstands, sponsors, marshals, tyre marks, lake and scenery, old circuit remnants.
4. **Game.** HUD, sound, hot lap with ghost, weather, start lights, reactive light panels, cockpit camera, touch controls, quality presets.
5. **Racing.** AI opponents, online rooms for 8, contact option, race flow and results.
6. **Broadcast.** Spectator mode, trackside cameras, timing tower.

Keep it simple. Add no features, abstractions, config layers or dependencies beyond what this document asks for. Prefer a few clear modules (`physics`, `track`, `scenery`, `car`, `input`, `net`, `audio`, `hud`, `cameras`) over deep structure. Comment the tuning constants in plain English, since Harry will adjust them.

Before writing code, reply with a short plan and any questions that would change the build. Then start phase 1.
