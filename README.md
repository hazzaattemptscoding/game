# Lakeside

Browser racing game. GT cars, one circuit, solo or online with friends.
Vite, three.js and plain JavaScript. Builds to a static site for Cloudflare Pages.

## Run it

```
npm install
npm run dev        # play at http://localhost:5173
npm run build      # static site in dist/
npm run laptest    # headless handling test, no browser
npm run trackmap   # debug map of surfaces, barriers, boards and signs from game data, to trackmap.svg
npm run cornersheet  # measures every corner with the real car and rewrites src/corners.js
```

Cloudflare Pages: build command `npm run build`, output directory `dist`. Full steps in "Deploying" below.

## Multiplayer

Optional. Open Settings (Esc), scroll to Multiplayer, type a name, then either Host a room (shows a 5 letter code, with a copy button) or type someone's code and press Join. Up to 8 players. With no room open the game behaves exactly as before.

- It is peer to peer over WebRTC with PeerJS, so the game stays plain static files: there is no game server. Each player's browser sends its own car (position, speed, steering, pedals, lap, name and colour, 20 times a second) straight to every other player's browser.
- A small public "broker" is used once, to introduce the browsers to each other. The default is the free public PeerJS broker (`0.peerjs.com`). The settings live in one object, `BROKER` in `src/multiplayer.js`, and can be overridden from the address bar: `?broker=host:port/path` (add `http://` for a plain connection, for example `?broker=http://192.168.1.20:9000`), `?brokerkey=key`, `?ice=none` (local network, no STUN) or `?ice=stun:host:3478`. Send a friend `https://your-site/?room=ABCDE` to pre-fill the code.
- Other cars are solid. There is no referee: each game works out contact for its own car only, against the other cars as drawn (interpolated 100 ms behind real time), and applies half of the collision impulse; the other player's game applies the other half. Code in `Car.collideCars` (`src/physics.js`) and `src/carContact.js`.
- **The live claude.ai artifact blocks outside connections, so multiplayer only works on a real host** (IONOS, Cloudflare Pages, or `npm run dev` on your own machine). The lobby says so if the connection is blocked and the game carries on single player.
- **Connection helpers (ICE).** Two browsers find a route to each other with STUN (learn your outside address) and, when that is not enough, TURN (relay the traffic). The game lists them explicitly: Google and Cloudflare STUN, plus the free Open Relay TURN servers from metered.ca. Those TURN servers are a shared free service, best effort only, so for reliable play with friends on mobile data, school or office Wi-Fi, add your own (see below). When joining fails the lobby explains why, and "Connection details" under the status shows the broker, the ICE states and which address types were found (host = this device, srflx = STUN worked, relay = TURN worked). A join waits 25 s, then retries once with a fresh connection (relay only when no relay address was seen and a TURN server is configured). The host should keep the game tab in the foreground while friends join, because browsers slow down background tabs.
- **`multiplayer.json`** sits next to `index.html` (source: `public/multiplayer.json`, copied to `dist/`). It is read each time someone hosts or joins, with the build id as a cache buster, so it can be edited on the web space with no rebuild. A missing or broken file is ignored. Order of precedence: built in defaults, then the file, then the address bar (`?broker=`, `?brokerkey=`, `?ice=`, `?relay=1`).

  ```json
  { "broker": { "host": "0.peerjs.com", "port": 443, "path": "/", "secure": true, "key": "peerjs" },
    "iceServers": [ { "urls": "stun:stun.l.google.com:19302" }, { "urls": "turn:host:3478", "username": "name", "credential": "secret" } ],
    "relayOnly": false }
  ```

  Every key is optional. `iceServers`, if present, replaces the whole default list (so include a STUN entry too). `relayOnly: true` makes every connection go through TURN, which is how to test that your TURN works (`?relay=1` does the same for one visit).

  Worked example, Cloudflare Calls TURN: in the Cloudflare dashboard open Calls, create a TURN key, and note the Turn Token ID and API token. Ask for credentials with a lifetime you choose (`ttl` is in seconds; a long one means you renew rarely):

  ```
  curl -X POST https://rtc.live.cloudflare.com/v1/turn/keys/TURN_KEY_ID/credentials/generate-ice-servers \
    -H "Authorization: Bearer TURN_KEY_API_TOKEN" -H "Content-Type: application/json" -d '{"ttl": 2592000}'
  ```

  The answer holds an `iceServers` list with `urls`, `username` and `credential` (check the Cloudflare Calls TURN docs if the endpoint has changed). Put them into the file:

  ```json
  { "iceServers": [
      { "urls": ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
      { "urls": ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp"],
        "username": "USERNAME_FROM_THE_ANSWER", "credential": "CREDENTIAL_FROM_THE_ANSWER" } ] }
  ```

  Credentials in this file are visible to everyone who opens the page, so use a key with a limited ttl and renew it before it runs out.

  Worked example, your own coturn (a small VPS, port 3478 and a relay range open in the firewall): install coturn, then in `/etc/turnserver.conf` set `listening-port=3478`, `realm=turn.example.com`, `fingerprint`, `lt-cred-mech`, `user=lakeside:a-long-random-password`, `min-port=49152`, `max-port=65535`, `no-multicast-peers`, and for TLS `tls-listening-port=5349` with `cert=` and `pkey=`. Then:

  ```json
  { "iceServers": [
      { "urls": "stun:turn.example.com:3478" },
      { "urls": ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp", "turns:turn.example.com:5349?transport=tcp"],
        "username": "lakeside", "credential": "a-long-random-password" } ] }
  ```

  Test it: open the game with `?relay=1` on two devices on different networks and join a room. The connection details should list `relay` among the addresses found.
- Tests: `npm run multiplayer` (part of `npm run check`, no network needed) and `npm run multiplayer-live` (two real browser pages through a local test broker).

## Deploying

The build is static files only, so any web host works. First, once: `npm install`, then `npm run build`. Everything to upload is in `dist/` (it includes `.htaccess` and `_headers`, which come from `public/`).

**IONOS web hosting (Apache)**

1. `npm run build`.
2. In the IONOS control panel open Hosting, then your web space, then SFTP or the file manager (or any SFTP client with the details shown there).
3. Upload the contents of `dist/` (not the `dist` folder itself; `multiplayer.json` is a small settings file you can edit later in place) into the web space root, or into a sub folder if the game lives at `example.com/lakeside/`. Make sure the hidden file `.htaccess` goes up too. It sets the right MIME types, gzip and caching.
4. Turn on SSL for the domain in IONOS (free for most plans) and open `https://your-domain/`. Edit `.htaccess` to uncomment the HTTPS redirect if you want it forced.
5. To update: build again and upload `dist/` over the top. The page is never cached for long; the hashed files under `assets/` are replaced by new names.

**Cloudflare Pages**

1. Push the repo to GitHub (or GitLab).
2. In Cloudflare: Workers and Pages, Create, Pages, Connect to Git, pick the repo.
3. Build command `npm run build`, build output directory `dist`, no framework preset needed. Node 18 or newer (set the variable `NODE_VERSION` to `22` if the default is older).
4. Save and deploy. Every push to the branch redeploys. `public/_headers` sets caching (long for the hashed files in `assets/`, none for the page).
5. To upload by hand instead: `npx wrangler pages deploy dist`.

**If the public PeerJS broker is down** (the lobby says it could not reach it), run your own. It is one command on any machine, and players just need to be able to reach it:

```
npx peer --port 9000
```

then open the game with `?broker=your-machine:9000` (for a quick test on one network: `http://localhost:5173/?broker=http://localhost:9000`). For friends over the internet put it behind HTTPS (a small VPS with a reverse proxy, or any Node host) and use `?broker=your-host.example.com` (port 443, path `/`), or change `BROKER` in `src/multiplayer.js` and rebuild.

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
| Lap times, sectors, leaderboard (hold) | Tab | |

Touch: drag anywhere on the left half of the screen to steer, pedals and DRS bottom right, Reset, Camera, Times (the Tab board) and Settings top right.

Settings has traction control, ABS and stability control as three separate switches, and Steering: Keyboard or Cursor. In Cursor mode the mouse's sideways position in the window steers (a small dead zone in the middle, full lock at the edges, sensitivity slider); the pedals stay on the keyboard and the steering keys add to the cursor.

URL options: `?autopilot` watches the autopilot drive, `?at=1500` starts 1500 m into the lap, `?topdown` opens the top-down debug view.

Debug view: Settings, View, Top-down debug. Same colours as `npm run trackmap`.

## Where to tune things

- `src/cars.js`: every number that changes how the car drives (grip, power, brakes, steering, assists). Each one has a plain English note.
- `src/layout.js`: the circuit. Control points from the original sketch, plus scale, width, sectors, DRS zones, the bridge, the pit lane, corner names, and the zones from the colour map: gravel, walls, run-off and sausage kerbs. Change a zone there and run `npm run trackmap` to check it against `reference/lakeside-track-colour-map.png`.
- `src/corners.js`: per-corner decisions (kerbs, apron, gravel, barrier distance, barrier sections, boards), generated by `npm run cornersheet`. Edit a corner and add `locked: true` to keep your numbers. `docs/corner-sheet.md` is the readable version.
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
  board.js      the Tab times board: lap history, sector colours, local top 10
  multiplayer.js  rooms, connections and broker settings (PeerJS, peer to peer)
  ghosts.js     other players' cars: wire format, interpolation, name tags, standings data
  lobby.js      the Multiplayer part of the settings panel, and the standings list
  carContact.js car to car contact shapes (rounded boxes)
tools/laptest.js   headless lap, stability and run-off test
tools/trackmap.js  debug map from game data
tools/cornersheet.js  corner measurements, departure tests and run-off decisions
reference/         original prototype, build brief, colour map, zone notes and the venue reference pack
```
