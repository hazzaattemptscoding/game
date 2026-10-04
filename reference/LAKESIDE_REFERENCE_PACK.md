# Lakeside reference pack

Venue reference for the Lakeside racing game. Everything here is built in code (extruded profiles, instanced boxes and cylinders, canvas textures), in a stylised mid-detail look. Sizes are modelling sizes, not homologation figures.

## Conventions

- Units are metres. Y is up. Colours are sRGB hex.
- Left and right are as seen by a driver going in the direction of travel.
- Control point numbers (0 to 62) match `LAKESIDE_ZONES.md` and the colour map.
- Circuit, airfield, village and all brands are fictional. PowerMedia stays as the title partner and is not one of the eight sponsors in section 3.
- Rule for detail: every object needs a readable silhouette at 50 m and one texture trick (stripes, decals, wear). Skip anything smaller than 0.05 m.

---

## 1. Modern circuit hardware

### 1.1 Armco (steel W-beam rail)

- **Look:** galvanised steel rail with two rounded humps along its length, lapped and bolted every 4.3 m, carried on short posts through spacer blocks.
- **Profile:** W section, 3 mm steel, 0.31 m deep per beam, each hump 0.08 m proud of the flat.

| Type | Beams | Bottom edge | Top edge | Face height |
|---|---|---|---|---|
| Single | 1 | 0.44 | 0.75 | 0.31 |
| Double | 2 | 0.44 | 1.06 | 0.62 |
| Triple | 3 | 0.44 | 1.37 | 0.93 |

- **Posts:** 0.15 m steel section, tops flush with the top beam. Spacer block 0.20 m deep between post and rail.
- **Spacing:** 2.0 m between posts normally, 1.0 m on the outside of tight corners and next to walls.
- **Panels:** 4.3 m long, lapped 0.3 m. Rail ends curve down into the ground over 4 m. Bolt heads 0.03 m, six per lap.
- **Colour:** new galvanised `#B7BCC0`, weathered `#8C9296`, scuffed paint streaks `#C8CCCF`.
- **Where:** 2 m behind gravel at fast corners, in front of tyre walls, along the pit exit, in front of catch fences.

### 1.2 Concrete walls

- **Look:** precast units in 3.0 m lengths with a 0.02 m dark joint between each. F-shaped profile: sloped lower face, vertical upper face.
- **Profile (standard):** 1.0 m high, 0.55 m wide at the base. Bottom 0.25 m slopes in 0.20 m, the top 0.75 m is vertical and 0.35 m thick.
- **Variants:** low 0.81 m (pit exit, paddock), standard 1.0 m, tall 1.4 m (street section, with debris fence on top).
- **Colour:** new `#B9B7AF`, old `#8C897F`, stained base `#77756C`. Optional 0.15 m painted top band, red `#C8102E` and white `#EDEDEA` in 1.0 m blocks, on the street section corners.
- **Decals:** sponsor panels 1.0 m high by 3.0 m long, one per unit.
- **Where:** street section (points 16 to 25), bridge abutments, pit wall, spectator side of fast corners.

### 1.3 Tyre walls

- **Look:** a black rubber wall. The tyres are hidden behind a conveyor-belt facing on modern barriers.
- **Block size:** 4.0 m long, 1.9 m high, 1.2 m deep. Car tyres 0.62 m diameter by 0.20 m wide, axis pointing at the track, 3 high with alternate columns offset by half a tyre, 6 deep.
- **Fixing:** 20 mm threaded rods through the length every 1.0 m, nuts visible on the back. Tyres in the block tied with 8 mm cable.
- **Conveyor-belt facing:** black rubber sheet 12 mm thick, 4.0 m by 1.9 m panels, bolted every 0.5 m with 0.04 m round bolt heads, small gap between panels. The belt stops 0.1 m above the ground and wraps 0.3 m over the top.
- **Older style:** bare tyres showing round sidewalls, top row painted white, no belt.
- **Colour:** belt `#1B1C1E` with wear `#2B2C2F`. Top band 0.3 m in white `#E8E6DE` or red `#C8102E`.
- **Build:** model the face as instanced discs (older style) or a flat panel plus bolt instances (modern). Fill the back as one dark box.
- **Where:** in front of concrete walls at the street section hairpins, outside Windsock Hairpin and Chandelle, in front of catch fences at fast corners.

### 1.4 Catch fences

- **Height:** 4.0 m standard, 6.0 m at spectator corners and the main grandstand.
- **Posts:** 0.12 m steel tube, dark grey `#3A3F44`, every 5.0 m, vertical. Back-stay at 45° on every second post.
- **Cables:** 12 mm steel cable, silver `#A9AFB3`, one every 0.75 m up the fence.
- **Mesh:** 3 mm wire, 50 mm diamond, black coated `#202326`. Reads as a dark haze from a distance, so use a semi-transparent plane with a mesh texture.
- **Where:** behind armco at fast corners, along the main straight, in front of every grandstand, at the edge of Boundary Loop.

### 1.5 Debris fencing

- **Look:** lighter fence fixed to the top of a concrete wall or tyre wall.
- **Size:** 2.0 m high, posts every 2.5 m, top 0.6 m leaning 45° toward the track.
- **Mesh:** 50 mm, galvanised `#A9AFB3` or black coated `#1F2327`.
- **Where:** tall concrete walls at the street section, pit wall ends, bridge parapets.

### 1.6 Kerbs

| Type | Width | Height | Unit length | Colours | Use |
|---|---|---|---|---|---|
| Flat kerb | 1.0 | 0.012 | 1.0 stripes | red `#C8102E`, white `#EDEDEA` | apexes and exits, with a gentle rumble from 0.02 m ribs every 0.25 m |
| Sausage kerb | 0.45 | 0.12 peak | 0.8 per unit | red/white, or yellow `#F2C200` and black `#111111` | inside of chicanes only |

- **Sausage profile:** half-ellipse, 0.45 m wide and 0.12 m tall, 0.05 m gap between units, set directly beside the white line.
- **Flat kerb:** starts right at the outside edge of the white track-limit line. Slightly lighter than the road.
- **Physics note:** flat kerbs rumble but are drivable. Sausage kerbs unsettle the car and should punish carrying speed over them.
- **Where:** every apex and exit; sausage kerbs on Guardroom Chicane, Aileron and Rudder, Nissen Hairpin and Sandbag.

### 1.7 Gravel traps

- **Depth:** 0.30 m layer, rounded stones 8 to 16 mm.
- **Width:** 20 m at fast corners, 10 m at slow corners, 30 m at Windsock Hairpin. Tapers in at both ends.
- **Surface:** starts 0.05 m below the tarmac edge, rises slowly outward and finishes at a 0.5 m earth bund or the armco line.
- **Texture:** raked lines across the trap every 0.3 m, darker wheel ruts where cars have run through.
- **Colour:** fresh `#CBB98B`, dusty `#B6A67C`, wet `#8F8268`. Pale grey `#B8B2A4` variant for the old circuit side.

### 1.8 Tarmac run-off

- **Width:** 10 to 15 m at most corners, up to 20 m on the braking zone into Scramble.
- **Surface:** the same asphalt as the circuit but coarser and lighter. A white track-limit line at the join. Optionally a darker scrub line where cars have run wide.
- **Colour:** `#5B5E63`. The green strips on the colour map are only a code; in game this is plain tarmac.

### 1.9 Marshal posts and flag points

- **Spacing:** every 120 to 200 m, always in sight of the previous and next post. Sited on the outside of corners, 4 to 6 m behind the barrier.
- **Booth:** 2.0 m by 2.0 m platform raised 0.3 m, open front, lean-to roof from 2.4 m at the front to 2.0 m at the back. White painted timber `#E9E6DC` or orange `#F26A1B` steel.
- **Furniture:** two red fire extinguishers (0.12 m diameter, 0.6 m tall) on a stand, a yellow broom, an oil-dry bin.
- **Post number sign:** 0.7 m square, white board, black number 0.4 m tall, on a 3.0 m pole.
- **Marshals:** two per post, 1.75 m tall, orange overalls `#F26A1B` with silver reflective bands, white helmet `#F2F2F2`.
- **Flags:** 0.8 m by 0.6 m on a 1.2 m pole. Yellow `#FFD500`, red `#D4141C`, blue `#1F5BFF`, green `#1BA33A`, white `#F2F2F2`, black `#111111`, chequered 8 by 6 squares.

### 1.10 Distance boards (300, 200, 100)

- **Board:** 1.2 m wide by 0.8 m high, white `#F2F0E8`, 0.06 m red border `#C8102E`, black numerals 0.5 m high.
- **Mount:** steel post, board centre 1.6 m above ground, angled slightly toward oncoming cars.
- **Spacing:** 300, 200 and 100 m before the braking point, measured along the centreline, on the outside of the braking zone, 3 m or more beyond the white line.
- **Where:** Scramble, Windsock Hairpin, Nissen Hairpin, Chandelle, Aileron, Guardroom Chicane.

### 1.11 Start gantry and five-light system

- **Gantry:** spans 17 m, pillars 0.6 m square set 2.0 m beyond the track edge. Beam underside 6.0 m above the track, beam 1.0 m high by 0.9 m deep, dark grey `#2B2E33`. Sponsor banner 14 m by 1.2 m on the front.
- **Lights:** five pods, 1.6 m centre to centre, each 0.9 m by 0.9 m by 0.3 m in a black housing `#1A1B1E`. Each pod holds two stacked red lights, 0.30 m diameter, with a 0.1 m visor hood.
- **Light colours:** off `#5A0F0F`, on `#FF2A1A` with bloom.
- **Sequence:** one pod lights per second, five seconds, a random hold between 0.2 and 3.0 s, then all five go out and the race starts.
- **Repeaters:** a red light pair on a 3 m pole each side of the grid for cars further back.
- **Where:** straight over the start/finish line at point 0, just before Roundel Bridge.

### 1.12 Pit wall, pit lane and gantry

- **Pit wall:** concrete, 1.1 m high by 0.5 m thick, white top band 0.3 m, grey `#B9B7AF`. Runs the full pit lane length.
- **Pit lane (14.5 m total):** 4.0 m fast lane beside the wall, a 0.15 m white line, 8.0 m working lane, 2.0 m apron to the garage doors.
- **Speed limit:** 60 km/h. Round signs 1.5 m across, red ring, white face, black "60", at pit entry (point 59) and every 100 m.
- **Gantry:** steel truss frame 3.0 m above the wall, 1.0 m deep, 9 m wide per bay with a thin roof canopy, a timing screen 1.2 m by 0.7 m on the front, and a pit board holder at each bay.
- **Garages:** 7 m wide by 14 m deep, 5.5 m by 3.8 m roller door. 18 bays under the Operations Block (two storeys, glass front, roof terrace).
- **Pit exit signal:** red and green lights on a 3 m pole at the end of the lane, lens 0.3 m. Red while cars are passing on the track.
- **Colours:** render `#E6E3DA`, frames `#2A2D31`, roller doors `#8A9097`.

### 1.13 Digital light panels

- **Size:** 1.0 m wide by 0.7 m high, dark bezel `#1C1E22`, LED matrix face.
- **Mount:** 3.2 m pole beside every marshal post, angled toward oncoming cars, visible from 200 m.
- **States:** yellow `#FFD500` steady (hazard ahead), double yellow flashing at 2 Hz (stop possible), blue `#1F5BFF` flashing (faster car behind), green `#1BA33A` (clear), red `#D4141C` (stopped), white `#F2F2F2` (slow vehicle), text "SC" in yellow (safety car).
- **Look:** emissive with bloom at night and in rain. Off state is a dark glass panel.

### 1.14 Track-limit lines and painted markings

- **Edge lines:** white, 0.15 m wide, along both edges. `#F2F2EE`, faded to `#CFCBBE` where worn.
- **Start/finish line:** 0.9 m wide chequer, 0.225 m squares in four rows, across the full track at point 0.
- **Sector lines:** 0.3 m white line with a small yellow tick on the left at points 25 and 48.
- **DRS lines:** 0.3 m white detection line across the track at point 59 and activation at point 0.
- **Grid slots:** white outlines 0.15 m wide, 2.0 m by 5.0 m, staggered, rows every 8 m, alternating 3 m left and right of the centreline.
- **Pit lane markings:** solid white fast-lane line, white box outlines in each bay, yellow speed-limit start line.

### Placement rules (quick reference)

1. Gravel always sits between the track and a barrier. Armco goes behind gravel, not in front of it.
2. The street section (points 16 to 25) has no run-off. Concrete or armco directly behind the white line, tyre walls on the outside of each hairpin.
3. Catch fences only where spectators are, or behind fast-corner barriers.
4. Every corner exit and apex gets a kerb. Sausage kerbs only on chicanes and tight hairpins.
5. A marshal post, flag panel and distance boards go with every braking zone.

---

## 2. Airfield heritage props

Corner and building names are defined in section 3. "Infield" means the area inside the circuit loop.

### 2.1 Wartime and RAF station

| # | Prop | Size (m) | Materials | Colours | Where it sits |
|---|---|---|---|---|---|
| 1 | Watch office (control tower) | 12 by 9, 7 high, plus glazed control room 4.5 by 3.5 by 2.2 on the roof | brick, concrete roof, steel-framed glazing, iron balcony rail | brick `#8A4B3C`, white window frames `#E6E3DA`, balcony pale blue-grey `#9FB2BC`, roof `#6E6B63` | behind the Operations Block, now Race Control |
| 2 | Bellman hangar | 26 wide, 54 long, 8 to the crown | arched steel trusses, corrugated sheet, sliding doors on one end | weathered grey-green `#6F7A6B`, rust at the base `#8A5A3A`, doors `#4A5B3F` | infield beside Hangar Straight, 30 m back |
| 3 | Blister hangars (3) | 18 by 12, 4.5 high | curved corrugated steel on a timber frame | dark green `#4A5B3F`, rust patches `#8A5A3A` | paddock, used as classic car garages |
| 4 | Nissen huts (6) | 4.9 wide, 11 long, 3.0 high | semicircular corrugated steel, brick end walls, small windows, door | steel `#7A7358`, brick ends `#7C4A3A`, door `#4A5B3F` | paddock rows named Dispersal |
| 5 | Blast pens (4) | horseshoe, 12 wide, 15 deep, banks 3 high | earth bank, brick or concrete revetment, concrete apron | grass bank `#5E7A3C`, concrete `#8F8C82` | outside Chandelle and Hangar Straight, used as spectator mounds |
| 6 | Runway and perimeter concrete | runway 45 wide, perimeter track 12 wide, slabs 7.5 by 7.5 | concrete with expansion joints, tar-filled cracks | old concrete `#8F8C82`, cracks `#3E3B36`, faded markings `#CFCBBE` | infield runway slab, old perimeter strip behind the gravel at Mess Straight |
| 7 | Windsock | pole 8 high, sock 3.6 long tapering 0.9 to 0.4 | steel pole, cotton sock, white concrete ring 6 across | pole `#EDEDEA`, sock orange `#E8641B` and white bands | inside Windsock Hairpin |
| 8 | Gate guardian (Spitfire Mk IX) | span 11.2, length 9.5, height 3.9, plinth 1.5 high | painted aluminium, brick plinth | camouflage green `#3F4F2E`, dark earth `#6A5B3D`, underside `#A4B7B8`, roundel blue `#1E3F8F`, red `#CC2A2A` | main entrance roundabout. A Hurricane (span 12.2, length 9.8) is a swap |
| 9 | Memorial chapel | 14 by 6, ridge 7, bell-cote 2 | brick, slate roof, stained glass | brick `#B89B66`, slate `#4A4E55`, glass `#3C6F9E` | rise by the lake, beside the main entrance |
| 10 | Fuel bowsers (2) | 7.5 long, 2.5 wide, 2.8 high | steel tank on a lorry chassis | dull green `#4C5B3A`, rust `#8A5A3A`, stencil `#D9D6CB` | parked beside the Bellman hangar |
| 11 | AA gun pit and searchlight site | gun pit 7 across, walls 1.3 high; searchlight pad 5 across | concrete ring with ammo recesses, sandbag top | concrete `#8C8A80`, moss `#6D7A58` | outer boundary near Searchlight corner |
| 12 | Pillbox (hexagonal) | 5.5 across, 2.2 high, six slits 0.9 by 0.3 | shuttered concrete, brick facing | concrete `#8C8A80`, shuttering lines `#6F6D64` | by hedges on the airfield boundary |
| 13 | Battle HQ bunker | 7 by 5, 2.2 high, earth-covered | concrete roof under turf, steps down | turf `#66823F`, concrete `#8C8A80` | infield, a small mound with a vent chimney |
| 14 | Crash tender house | 16 by 9, 6 high | brick, double doors 4 wide | brick `#8A4B3C`, doors red `#B02A2A` | near pit exit, now the medical centre |
| 15 | Boundary fence posts | 2.4 high, 2.8 spacing, angled arm 0.5 | concrete posts with 6 strands of wire | concrete `#9C9A90`, wire `#4A4C50` | outer perimeter, doubles as fence line |
| 16 | Water tower | tank 6 by 6 by 3 on legs, total height 12 | pressed steel tank, brick legs | tank `#6E7A6C`, rust `#8A5A3A`, brick `#7C4A3A` | infield landmark seen from the bridge |
| 17 | Station HQ and Officers' Mess | 36 by 14, two storeys, hipped roof | red brick, white sash windows, slate | brick `#8A4B3C`, trim `#E6E3DA`, slate `#4A4E55` | beside the paddock, now the Mess hospitality |
| 18 | Dispersal hut | 7 by 3.5, 3 high | timber hut, felt roof | dark green `#4A5B3F`, stencil `#D9D6CB` | a marshals' hut near Windsock Hairpin |
| 19 | Runway control caravan | 4.5 by 2.2, 2.6 high | timber cabin on wheels | black and white chequer, 0.6 squares | start line, used by the starter |
| 20 | Dragon's teeth (anti-tank cubes) | cubes 0.9, 3 rows, 1.0 gaps | concrete | `#9C9A90`, moss `#6D7A58` | row beside the gate guardian |

### 2.2 1950s and 60s racing remnants

| # | Prop | Size (m) | Materials | Colours | Where it sits |
|---|---|---|---|---|---|
| 21 | Timekeepers' box | 3.6 by 2.4, 2.5 high on stilts, ladder | white timber, glazed front, flat roof | white `#E9E6DC` flaking to grey, frames `#2A2D31` | beside the start line, preserved |
| 22 | Painted pit wall | 120 long, 1.0 high, 0.3 thick | breeze block with paint | white `#D9D6CB` flaking, numbers black 0.4 tall | old pit strip parallel to the modern one |
| 23 | Wooden spectator banking | 40 long, 6 rows, rise 0.3, tread 0.9 | railway sleepers on earth, angle iron | weathered timber `#8B7D68`, iron `#7A4A2F` | outside Hurricane Sweep |
| 24 | Period advertising hoardings | 6.0 by 1.8 on posts 2.4 high | painted enamel on timber | the four period brands in section 3, faded 35% | along the old circuit edge |
| 25 | Lap scoreboard | 9 by 3.5 | timber board with numbered slots | green `#2F4A3A`, white numerals `#D9D6CB` | beside the timekeepers' box |

---

## 3. Lakeside backstory

### 3.1 History

Lakeside sits on the North Downs edge in Kent, at the fictional village of Stanmere Green. The airfield was RAF Stanmere.

| Year | Event |
|---|---|
| 1917 | Royal Flying Corps landing ground opens on farmland at Stanmere Green. |
| 1937 | Station expansion: brick Station HQ, Officers' Mess, a Type C hangar and the gate lodge. |
| 1940 | Sector fighter station in the Battle of Britain. Bombed twice in late August; the operations room moves to a requisitioned village hall. |
| 1941 | New Watch Office, Bellman hangars, blast pens and concrete runway built. Spitfires replace Hurricanes. |
| 1950 | Flying ends. The station goes to care and maintenance. |
| 1951 | The Stanmere Motor Club leases the perimeter track and part of the runway. |
| 14 June 1952 | First race meeting. 8,000 spectators. The circuit is 2.1 miles (3.4 km), the perimeter track plus a runway section. |
| 1953 to 1961 | Golden age: sports cars, saloons, Formula Junior and the International Trophy, with crowds up to 30,000. Timber spectator banking, a Bailey bridge (1958) and a lap scoreboard are added. |
| 1957 | The Defence White Paper closes the station. The Ministry sells the freehold to a gravel company, with the club on a short lease. |
| 1962 | A car leaves the circuit at the end of the Runway Straight and hits the timber banking, injuring three spectators. |
| 1963 | The RAC withdraws the circuit licence pending safety works the club cannot afford. Last meeting 5 October 1963. |
| 1964 | The circuit closes. |
| 1971 | Gravel extraction stops. The pumps are switched off and the pits flood, forming Stanmere Water, the lake. |
| 1971 to 2007 | Derelict. Used as a scrapyard, a car boot sale site and a film location. The Watch Office is listed in 1998. |
| 2007 | Friends of Stanmere campaign and the Stanmere Heritage Trust formed. |
| 2014 | Trust partners with a developer, Lakeside Circuit Ltd. Rebuild begins. |
| 2018 | New circuit completed at 3.83 km, with the old banking, pit wall, timekeepers' box and Watch Office kept. FIA Grade 1 licence granted. |
| 2019 | First race: the revived Lakeside International Trophy. |

### 3.2 Names

**Corners and straights**

| Points | Name | Notes |
|---|---|---|
| 59 to 3 | Runway Straight | main straight, DRS 1, passes the start/finish line at 0 |
| 3 to 5 | Scramble | first left-hander, big braking zone |
| 7 to 10 | Hurricane Sweep | long right-hand sweep |
| 12 to 15 | Windsock Hairpin | big right-hand hairpin, largest gravel trap |
| 16 to 18 | Pen Alley | walled sweep, start of street section |
| 19 to 21 | Nissen Hairpin | tight left, walls both sides |
| 22 to 23 | Sandbag | tight right, walls |
| 28 to 30 | Searchlight | right-hander before the bridge |
| 31 to 32 | Roundel Bridge | the crossover |
| 33 to 35 | Station Corner | right-hander after the bridge |
| 36 to 39 | Chandelle | tight loop at the end of the climb |
| 40 to 43 | Hangar Straight | DRS 2 |
| 43 to 45 | Aileron | left-hand part of the S bend |
| 45 to 46 | Rudder | exit of the S bend |
| 50 to 53 | Boundary Loop | big top-left loop, infield gravel pit |
| 54 to 56 | Mess Straight | bottom of the loop |
| 57 to 58 | Guardroom Chicane | before the pit entry |

**Grandstands**

| Name | Where | Size |
|---|---|---|
| Fighter Command Grandstand | main straight, opposite the pits | 120 m long, 14 rows, covered |
| Scramble Stand | outside Scramble | 50 m, 10 rows |
| Hurricane Terrace | Hurricane Sweep | 60 m, 8 rows |
| Pilots' Bank | grass banking inside Windsock Hairpin | open grass |
| Hangar Stand | beside Hangar Straight | 80 m, 10 rows |
| Boundary Terrace | outside Boundary Loop | 60 m, 8 rows |

**Buildings**

- Pit building: **The Operations Block**.
- Race Control: **the Watch Office**.
- Paddock: **Dispersal**.
- Hospitality: **The Mess** (Station HQ and Officers' Mess).
- Medical centre: **the Crash House**.
- Bridge: **Roundel Bridge**, a concrete deck on pillars with a large RAF-style roundel painted on the underside.

### 3.3 Plaques

**Gate guardian plinth**

> RAF STANMERE 1917 to 1957
> From this ground the fighter squadrons of the Weald flew in 1940 and 1941.
> Those who did not return are remembered in the chapel behind.

**Roundel Bridge, beside the preserved truss panel**

> ROUNDEL BRIDGE
> The first bridge on this line, a steel Bailey structure, was built by the Stanmere Motor Club in 1958 so the circuit could cross itself without a level crossing.
> This bridge replaced it in 2018. One original panel is preserved beside you.

**Timekeepers' box**

> THE STANMERE MEETING
> First race on the airfield perimeter, 14 June 1952. Last race, 5 October 1963.
> The timekeepers' box, the banking and the pit wall are original.

### 3.4 Sponsors (8, invented)

| # | Brand | Era | Colours | One line |
|---|---|---|---|---|
| 1 | Veyra Tyres | modern | teal `#0E7C86`, white `#F2F2F2`, orange accent `#FF5A1F` | Performance tyres, wavy "V" mark. |
| 2 | Norrland Energy | modern | lime `#C6F432`, black `#101214` | Energy drink, hard-edged sans type. |
| 3 | Merrow Mutual Insurance | modern | navy `#1D2E5C`, gold `#E4B64A` | Insurer, calm serif wordmark and shield. |
| 4 | Quillon Mobile | modern | magenta `#D4145A`, white `#F2F2F2` | Mobile network, rounded lowercase type. |
| 5 | Pennant Petroleum | 1950s | cream `#EDE3C8`, red `#D9381E`, blue `#2A4A7A` | Petrol brand with a red pennant flag. |
| 6 | Brannock's Pale Ale | 1950s | deep green `#1F4D36`, gold `#D8A83A`, cream `#EDE3C8` | Brewery, serif type in a gold frame. |
| 7 | Kingsbury Plugs | 1960s | blue `#1B4F9C`, white `#F4F1E6`, red `#C8102E` | Spark plugs, chunky block capitals. |
| 8 | Aldershaw Radio and Television | 1960s | teal `#2E7D74`, cream `#EDE3C8`, black `#16181B` | Radio and TV sets, script logo with a dial graphic. |

**Placement**

- Modern brands: bridge banners, barrier wraps, gantry banners, grandstand roof boards, tyre wall bands.
- Period brands: hoardings on the old circuit, Pilots' Bank fence, painted gable ends on Nissen huts and the old pit wall.

**Fade recipe for period adverts (canvas):** desaturate 35%, lift blacks to `#2A2A2A`, add vertical rust streaks (`#7A4A2F`, 15% opacity) from rivets and panel joins, lichen patches (`#7F8A5C`) at the bottom corners, and break the lettering with a noise mask at 20%.

---

## 4. Colour palette

**Tarmac**

| Use | Hex |
|---|---|
| New racing surface | `#2B2D31` |
| Standard circuit | `#34363B` |
| Worn circuit | `#4A4C50` |
| Rubbered-in racing line | `#1E2023` |
| Run-off tarmac | `#5B5E63` |
| Old cracked tarmac | `#6E6A62` |
| Cracks and tar fill | `#3E3B36` |
| Wet tarmac | `#202226` |

**Concrete**

| Use | Hex |
|---|---|
| New | `#BDBBB3` |
| Old | `#8F8C82` |
| Stained | `#77756C` |
| Moss overlay | `#6D7A58` |
| Runway slab (old) | `#8F8C82` with joints `#3E3B36` |

**Faded paint**

| Use | Hex |
|---|---|
| White line (worn) | `#CFCBBE` |
| Red | `#A8483A` |
| Blue | `#4B6A94` |
| Yellow | `#C8AE55` |
| Green | `#5E7A5A` |
| Rust streak | `#7A4A2F` |
| Lichen | `#7F8A5C` |

**Grass**

| Use | Hex |
|---|---|
| Mown | `#4F7A3A` |
| Rough | `#66823F` |
| Meadow | `#7C8A4A` |
| Dried | `#8D8B52` |
| Dark verge | `#3E5F2F` |

**Gravel**

| Use | Hex |
|---|---|
| Fresh | `#CBB98B` |
| Dusty | `#B6A67C` |
| Wet | `#8F8268` |
| Pale grey | `#B8B2A4` |

**Hangar metal**

| Use | Hex |
|---|---|
| New galvanised | `#A8ADB0` |
| Weathered | `#7E8386` |
| Rusted | `#8A5A3A` |
| Painted green | `#4A5B3F` |
| Dark roof | `#3F444A` |

**Brick**

| Use | Hex |
|---|---|
| Red | `#8A4B3C` |
| Weathered red | `#7C4A3A` |
| Yellow stock | `#B89B66` |
| Mortar | `#B8B0A0` |

**Extras**

| Use | Hex |
|---|---|
| Lake water | `#3F6F7A` |
| Weathered timber | `#8B7D68` |
| RAF camo green | `#3F4F2E` |
| RAF dark earth | `#6A5B3D` |
| Roundel blue | `#1E3F8F` |
| Roundel red | `#CC2A2A` |
