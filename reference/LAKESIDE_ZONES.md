# Lakeside: zone map (use with lakeside-track-colour-map.png)

Read `reference/lakeside-track-colour-map.png` first. It shows the current adapted layout with Harry's colour code applied. This file says the same thing in text so nothing is missed.

## Why this exists

Harry sketched the original track with colours. The colours were only a code for what each part of the track is. They were never a visual style. The earlier prompt lost this, so the walls, gravel and track limits were not built where he drew them. Apply the zones below to the current layout.

## Reading the numbers

- Numbers are the control point indices in the current track debug view (0 to 62).
- Cars drive in increasing order: 0, 1, 2 ... 62, then back to 0.
- Fractions like 59.5 mean halfway between points 59 and 60.
- Left and right are as seen by a driver going in the direction of travel.
- Start/finish is at point 0, just before the crossover.

## Colour code and what to build

| Colour | Meaning | Build as |
|---|---|---|
| Yellow | DRS zone | DRS detection and activation zone, painted on the track |
| Purple | Gravel trap | Gravel surface: heavy slowdown, hard to steer out of |
| Blue | Tight walls | Solid barriers right at the track edge: armco or concrete, with tyre walls and catch fencing. This is a street style section with no run-off. |
| Green | Extra track limits | Tarmac or painted run-off the car can use with no penalty, up to the width shown |
| Red | Pit lane | Pit lane road alongside the main straight, speed limited |

Anywhere there is no colour, use the normal setup: kerbs on corner apexes and exits, then grass beyond.

## Zones by control point

### DRS (yellow)
- DRS 1: points 59.3 to 3.1 (the whole main straight, through the start/finish line)
- DRS 2: points 40 to 43 (the straight along the top)

### Gravel traps (purple)
| Points | Side | Where | Size |
|---|---|---|---|
| 2.4 to 4.6 | right | outside of the first corner after the main straight | medium |
| 7.6 to 10.2 | left | outside of the right-hand sweep | medium |
| 11.8 to 15.6 | left | outside of the big bottom-right hairpin | largest on the track |
| 28.4 to 31 | left | outside of the corner before the crossover | medium |
| 33.3 to 35.6 | left | outside of the corner after the crossover | medium |
| 36.8 to 38.8 | right | outside of the tight loop at the end of the climb | medium |
| 43 to 45.4 | left | outside of the left-right S bend after DRS 2 | medium |
| 50.4 to 54.8 | left | inside of the big top-left loop, a large infield gravel pit | large |
| 53.8 to 56.2 | right | outside of the bottom of the top-left loop | medium |

Gravel should taper in at both ends rather than start with a hard edge.

### Tight walls (blue): the street section
| Points | Side |
|---|---|
| 16 to 18.6 | right |
| 19 to 22.8 | both |
| 23 to 25.6 | left |

This is the section after the bottom-right hairpin, running into the tight second hairpin and out the other side. No gravel, no run-off. Walls, tyre barriers and catch fencing hard against the track.

### Bridge abutments (blue)
- Points 30.6 to 32.6, both sides. The back section (points 31 to 33) is on a bridge and goes over the main straight, which passes underneath near point 0.85. Walls run along both sides of the bridge deck.

### Small wall piece (blue)
- Points 57.6 to 58.6, right: short section of barrier at the bottom of the chicane before the pit entry.

### Extra track limits (green)
| Points | Side |
|---|---|
| 14.2 to 15 | right |
| 16.8 to 17.6 | left |
| 19.5 to 21 | left |
| 22 to 23.2 | right |
| 27.5 to 29 | left |
| 29.6 to 30.6 | right |
| 34.6 to 35.6 | left |
| 38.8 to 40.2 | right |
| 48 to 49.2 | left |
| 56.3 to 57.2 | left |
| 59 to 60.6 | left (widest one, the exit of the chicane onto the main straight, on the pit lane side) |

### Pit lane (red)
- Entry at point 59 (just after the chicane), runs on the left of the main straight, exit at point 4 (just after the first corner).
- Pit lane passes under the bridge.

### Sectors
- Start/finish: point 0
- S1/S2 line: point 25
- S2/S3 line: point 48

## What to check when done

1. Drive each walled section. Hitting the wall should cost speed and feel like a street circuit.
2. Drive each gravel trap. It should cost real time compared with the green strips next to it.
3. Compare the map in the game with the PNG side by side. Every colour should be in the same place.
