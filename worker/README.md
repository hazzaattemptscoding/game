# Lakeside relay (Cloudflare Worker)

A small message relay for the online mode. It is for players who cannot connect peer to peer, for example behind a
carrier-grade NAT (double NAT, no public IP, no port forwarding). Everybody connects OUT to the relay over `wss://`, and the
relay passes messages between the players in a room. The relay itself stores nothing and logs nothing: it only holds the live connections.
The same Worker also keeps the global lap times, see "Global times" below.

The game itself stays on your IONOS web space. Only this folder goes to Cloudflare. It is not part of the Vite build.

## What you need

* A Cloudflare account (the free plan is enough).
* Node.js 20 or newer on your computer (https://nodejs.org, the LTS download). Check with `node -v`.
* The `worker` folder of this project.

## Deploy

1. Open `worker/wrangler.toml` and change this line to the address of the website that hosts the game, exactly as it shows in
   the browser address bar, with `https://` and without a trailing slash:
   `ALLOWED_ORIGINS = "https://your-domain.example"`.
   Several sites: separate with commas, `"https://a.example,https://www.a.example"`. If you use both `example.com` and
   `www.example.com`, list both. (`*` allows every site, use it only for a quick test.)
2. Open a terminal in the project and run:
   ```
   cd worker
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   `wrangler login` opens a browser window, log in to Cloudflare and click Allow.
   The first time, Cloudflare may ask you to pick a free `workers.dev` subdomain: choose a name.
3. `wrangler deploy` prints a line like `https://lakeside-relay.<your-subdomain>.workers.dev`. Copy it.
   If `wrangler` complains that the `compatibility_date` is too new, put an earlier date in `wrangler.toml` and deploy again.
4. Check it: open `https://lakeside-relay.<your-subdomain>.workers.dev/health` in a browser. It must show `ok`.
5. On your IONOS web space, edit `multiplayer.json` (next to `index.html`) and add the relay with `wss://` instead of `https://`:
   ```
   { "relay": "wss://lakeside-relay.<your-subdomain>.workers.dev" }
   ```
   Keep the other lines of the file, just add this one (mind the commas). No rebuild and no upload of the game is needed.
6. Open the game, Esc, Online play. The lobby should say "Via relay". Test with a friend: one hosts, the other joins with the code.

If the relay cannot be reached within 6 seconds, the game falls back to peer to peer and says so in the lobby.
In the address bar you can also try `?relay=wss://lakeside-relay.<your-subdomain>.workers.dev/` (one visit, nothing saved)
or force a mode with `?transport=relay` or `?transport=peer`.

## Changing the allowed websites later

Edit `ALLOWED_ORIGINS` in `wrangler.toml` and run `npx wrangler deploy` again (inside the `worker` folder). If the lobby
shows an error right away and `/health` works, the most likely reason is that the site address is not in this list
(`http` versus `https`, or `www.` missing).

## Free plan limits

Cloudflare's numbers at the time of writing (check https://developers.cloudflare.com/durable-objects/platform/pricing/ ):

* 100,000 requests per day. A connection counts as 1 request, and every 20 messages RECEIVED by the relay count as 1 request.
  Messages the relay sends out are free.
* 13,000 GB-seconds of Durable Object running time per day. A room that is busy counts as 128 MB, so about 450 GB-seconds
  per busy room hour.
* The counters reset at 00:00 UTC.

What that means for the game: each player sends 20 car updates per second plus one ping per 15 seconds, so one player costs about
3,600 requests per hour. The free plan therefore covers about 27 player hours per day in total, for example 4 friends for
almost 7 hours. The running time limit is about 28 busy room hours per day, which is not the one you will hit first.

If you go over: Cloudflare refuses new connections until 00:00 UTC. The game then falls back to peer to peer (which may not
work for you). Options: wait until the next day, or switch the plan to Workers Paid in the Cloudflare dashboard (about 5 US
dollars a month at the time of writing, with several million requests included).

## See what is happening (logs)

```
cd worker
npx wrangler tail
```
It shows requests and errors live while you play (Ctrl+C to stop). The relay itself never logs player names, codes or messages.
The Cloudflare dashboard (Workers & Pages, lakeside-relay, Metrics) shows requests per day against the free limit.

## Remove it

```
cd worker
npx wrangler delete
```
Then delete the `"relay"` line from `multiplayer.json` on IONOS. (Or in the Cloudflare dashboard: Workers & Pages, lakeside-relay,
Settings, Delete.) The only stored data is the global times (see above); deleting the Worker deletes them.

## Try it on your own computer, without Cloudflare

```
node worker/dev-relay.mjs 8787
```
starts a stand-in server with the same rules. Open the game with `?relay=ws://localhost:8787/`. The relay tests are
`node tools/relay.js` (they also run in `npm run check`).

## Live timing: spectators and the lobby list

The page `live.html` (next to `index.html` on the game's website) lists every open online lobby and lets anybody watch one:
timing tower, telemetry, track map, TV director and free cameras. It needs this Worker and nothing else.

* `GET /lobbies` answers a JSON list of the open rooms: `code, host, players [{name}], count, max, mode, laps, started, spectators, createdAt`.
  `GET /lobbies/<CODE>` answers one. Every room with a player in it is listed; there are no private rooms. A room is dropped from the
  list when it empties, or 90 seconds after its last heartbeat. The list is kept by one extra Durable Object (`Directory`).
* A spectator connects to `wss://HOST/room/<CODE>?spectator=1` and sends `{"t":"join","spectator":true,"name":"..."}`. It never takes one
  of the 8 player seats, up to 50 watch one room (`MAX_SPECTATORS`), it cannot send anything but a ping, and it receives the room's
  cars at 10 Hz (`SPECTATOR_STATE_DIVIDER` = 2 of the players' 20 Hz), liveries, names, who joins and leaves, the race details and the
  telemetry frames. Telemetry is sent by the game only while somebody is watching.
* The host's game tells the relay what the room is doing with `{"t":"meta","mode":"Online race","laps":5,"started":true}` (cleaned and
  bounded by the relay; ignored from anybody but the host). The full wire description is at the top of `src/protocol.js`.

Deploying: the Worker redeploys by itself when this folder changes on `main` (Cloudflare Workers Builds). The change adds one
Durable Object class, `Directory`, which `wrangler.toml` already declares in migration `v2`, so no manual step is needed. If you deploy
by hand: `cd worker && npx wrangler deploy`. Check it with `https://<worker>/lobbies` (must answer `[]` or a list) and open
`https://<game site>/live.html`. Old game versions keep working: they never send `meta` or telemetry, so their lobbies are listed as
"Free practice" with the player names, and the live view shows cars and gaps but no throttle, brake or gear.

Free plan cost: every spectator connection is one request plus one per 20 messages it SENDS (only pings), and the messages the Worker
sends out are free, so watching is cheap. The lobby list is cached for 3 seconds per Worker instance and the directory is updated
at most every 5 seconds per room.

## Global times

The Worker also keeps the global lap-times leaderboard, in one more Durable Object (`Times`, binding `TIMES`, code in `src/times.js` and
`src/times-do.js`). It is on the same Worker and the same `ALLOWED_ORIGINS` list, so nothing new has to be set up.

* `POST /times` takes a finished lap (`{name, time, sectors:[s1,s2,s3], board:{weather,mode,dir,assists}, build, ghost?}` as JSON, at most 64 KB)
  and answers `{ok, improved, rank, best, entries}`. It needs an allowed `Origin` (403 otherwise) and refuses invalid laps with 400 and
  a plain reason. At most 20 laps per 10 minutes per client address (429 after that).
* `GET /times?board=dry-solo-fwd-on&n=50&name=Harry` answers the top `n` (default 20, at most 100) of one board and the row of `name`.
* `GET /ghost?board=dry-solo-fwd-on&name=Harry` answers that driver's stored ghost line, or 404.
* There are 16 boards: weather (`dry`, `wet`) x mode (`solo`, `online`) x direction (`fwd`, `rev`) x assists (`on`, `off`).

What is stored, per driver and board (their best lap only): the name, the lap time, the three sector times, the time the lap was set,
and the ghost line (position and heading about 10 times a second) for the top 10 of the board only. Nothing else. IP addresses are
used for the rate limit in memory only and are never stored. A driver is the lowercase name, so "Harry" and "harry" are one row.
The Worker checks every lap before keeping it (time and sector limits, and a ghost that has to be a plausible full lap).

Deploying: the next deploy creates the new storage by itself, through migration `v3` in `wrangler.toml`. A push to `main` redeploys
the Worker, or run `cd worker && npx wrangler deploy`. Check it with `https://<worker>/times?board=dry-solo-fwd-on` (must answer
`{"board":"dry-solo-fwd-on","entries":[],"you":null}`). The relay and the lobby list keep working as before.

Free plan cost: one request per finished valid lap, plus one per time someone opens a leaderboard page (a ghost download is one more).
It runs in one object that sleeps when nobody asks, so it is far below the daily limits next to the relay's 3,600 requests per player
hour. Storage is a few kilobytes per ghost and 160 ghosts at most (10 on each of the 16 boards).

Clearing the board: there is no admin route. To wipe everything, delete the `Times` class and create it again with two more migrations
in `wrangler.toml`, deployed one after the other: first `tag = "v4"` with `deleted_classes = ["Times"]` (this deletes all its data and
cannot be undone), deploy, then `tag = "v5"` with `new_sqlite_classes = ["Times"]`, deploy again. The Cloudflare dashboard (Workers & Pages,
lakeside-relay, Durable Objects) can also remove a Durable Object namespace, which is the same thing. Tests: `node tools/times.js`.

## How it works (for developers)

One WebSocket per player to `wss://HOST/room/<CODE>`, CODE = 5 letters A to Z. The code is the room name: the first player
who joins with `host:true` opens the room, guests join the same code. The Worker (`src/index.js`) checks the origin and
passes the connection to the Durable Object `Room` (`src/room.js`), one instance per code, which uses the WebSocket Hibernation
API (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`, per-socket attachments), so it holds only the live sockets
and is evicted from memory when quiet. The rules live in `src/protocol.js`, shared with `dev-relay.mjs`.

Frames, all limited to 2048 bytes (bigger ones are dropped), 40 per second per socket (extras are dropped), 60 s of silence
closes the socket (the game pings every 15 s):

| Direction | Frame | Meaning |
| --- | --- | --- |
| client to relay | `{t:'join', name, id, host?}` | first frame; `id` is a random token so a reconnect gets the same slot; `host:true` opens the room |
| client to relay | `{t:'ping', n}` | answered with `{t:'pong', n}` to the sender only |
| client to relay | any other JSON object | forwarded to everyone else as `{...it, from:<sender id>}`; with `to:<id>` to that player only |
| client to relay | binary | forwarded to everyone else as one byte (the sender id, 0 to 7) followed by the same bytes |
| relay to client | `{t:'welcome', you, host, players:[{id,name,host}]}` | your id, the host's id, everybody else in the room |
| relay to client | `{t:'peer', id, name, host}` / `{t:'bye', id}` | somebody joined / left |
| relay to client | `{t:'full'}` (close 4001) | 8 players already |
| relay to client | `{t:'nohost'}` (close 4002) | a guest joined a code nobody is hosting |
| relay to client | `{t:'taken'}` (close 4003) | a second host for the same code (pick another code) |

Close code 4004 means the same player token connected again and replaced this socket, 4008 means idle for 60 s.
Player ids are the slot numbers 0 to 7. Message types `join`, `welcome`, `peer`, `bye`, `full`, `nohost`, `taken`, `pong`,
`ping` are reserved: a client cannot send them to other players.
