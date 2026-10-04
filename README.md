# Lakeside

Browser racing game. GT cars, one circuit, solo or online with friends.
Vite, three.js and plain JavaScript. Builds to a static site for Cloudflare Pages.

## Run it

```
npm install
npm run dev        # play at http://localhost:5173
npm run build      # static site in dist/
npm run laptest    # headless handling test, no browser
npm run trackmap   # draws the circuit zones from game data to trackmap.svg
```

Cloudflare Pages: build command `npm run build`, output directory `dist`.

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Steer | Arrows / A D | Left stick |
| Throttle | Up / W | Right trigger |
| Brake (hold when stopped to reverse) | Down / S | Left trigger |
| DRS (in the zones) | Space | A / cross |
| Back on track | R | Y / triangle |
| Camera | C | X / square |
| Settings | Esc | Start |
| Handling readout | I or F3 | |

Touch: drag anywhere on the left half of the screen to steer, pedals and DRS bottom right, Reset, Camera and Settings top right.

URL options: `?autopilot` watches the autopilot drive, `?at=1500` starts 1500 m into the lap.

## Where to tune things

- `src/cars.js`: every number that changes how the car drives (grip, power, brakes, steering, assists). Each one has a plain English note.
- `src/layout.js`: the circuit. Control points from the original sketch, plus scale, width, sectors, DRS zones, the bridge, the pit lane, corner names, and the zones from the colour map: gravel, walls, run-off and sausage kerbs. Change a zone there and run `npm run trackmap` to check it against `reference/lakeside-track-colour-map.png`.
- `src/physics.js`: how the car model works, and the grip of each surface.
- `src/autopilot.js`: the racing line and the autopilot driver (the base for AI later).

After changing handling, run `npm run laptest`. It prints lap times for a quick and a steady driver,
and a stability table showing whether the car sorts itself out when you lift, brake or floor it mid-corner.

## Files

```
src/
  main.js       game loop: fixed 120 Hz physics, rendering, settings
  track.js      centreline, kerbs, barriers, "where am I on the track"
  layout.js     the circuit layout (edit this)
  physics.js    car physics
  cars.js       car tuning (edit this)
  timing.js     laps and sectors
  autopilot.js  racing line and autopilot
  trackMesh.js  the circuit: surfaces, kerbs, barriers, fences, pit lane, bridge, gantry, boards
  scenery.js    terrain and the RAF Stanmere remnants
  textures.js   all textures and sponsor boards, drawn in code
  car.js        car model
  cameras.js    chase and bonnet cameras
  input.js      keyboard and gamepad
  hud.js        HUD
tools/laptest.js   headless lap, stability and run-off test
tools/trackmap.js  zone map from game data
reference/         original prototype, build brief, colour map, zone notes and the venue reference pack
```
