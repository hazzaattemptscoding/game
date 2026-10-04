// Lakeside circuit layout.
//
// Edit this file to reshape the track. The points come from the original
// sketch: [x, y, height] in sketch units. The game turns them into a smooth
// curve and converts to metres using the scale values below.
//
// Indexes in `sectors`, `drs` and `bridge` refer to positions in the points
// list (0 is the first point). Fractions are allowed, so 30.5 means halfway
// between point 30 and point 31.

export const LAYOUT = {
  scale: 2.0,         // metres per sketch unit. Bigger = longer lap.
  heightScale: 0.3,   // metres per sketch height unit. Bigger = hillier.
  width: 13,          // tarmac width in metres
  minRadius: 16,      // any corner tighter than this (centreline radius, metres) is opened up

  points: [
    // Main straight. Start/finish line is at the first point. Runs downhill.
    [460, 365, 14], [530, 405, 4], [596, 443, 0],
    // Turn 1: heavy braking into a left-hander at the bottom of the hill
    [620, 453, 0], [636, 450, 1], [647, 439, 3], [656, 423, 5],
    // Turn 2: fast uphill right-hand sweep
    [674, 409, 9], [700, 405, 13], [726, 418, 17], [746, 442, 21],
    // Run out to the far hairpin, over a crest
    [770, 480, 26], [788, 512, 30], [796, 536, 31], [788, 553, 30], [770, 557, 28], [752, 543, 26],
    // Technical section: a tight left, then a right that opens onto the lake
    [715, 503, 21], [690, 484, 17], [668, 484, 15], [655, 498, 13], [657, 512, 12], [652, 524, 10],
    [640, 529, 9],
    // Fast run along the lake
    [627, 526, 8], [590, 502, 6], [560, 484, 5], [538, 478, 5],
    // Quick right, then the climb over the bridge across the main straight
    [516, 469, 6], [503, 454, 12], [500, 438, 20], [511, 410, 32], [523, 383, 43], [534, 352, 50], [548, 332, 55],
    // Hilltop hairpin
    [572, 325, 56], [606, 328, 57], [625, 321, 58], [633, 302, 58], [625, 283, 58], [606, 277, 57],
    // Back straight, dipping in the middle
    [520, 278, 38], [452, 280, 50],
    // S-bend up to the esses
    [430, 275, 55], [416, 262, 58], [406, 248, 62], [388, 242, 66],
    // Esses, flat out along the top of the park
    [352, 252, 70], [318, 252, 74], [275, 241, 79], [222, 236, 82],
    // West loop
    [186, 245, 80], [170, 272, 76], [183, 300, 72], [222, 310, 68], [268, 311, 64],
    // Chicane, then the fast final corner onto the main straight
    [285, 313, 60], [298, 322, 57], [312, 322, 54], [324, 314, 50], [345, 312, 46], [368, 322, 40],
    [410, 345, 28],
  ],

  // Sectors and DRS. S1 runs from the start line to the first point listed.
  sectors: [25, 48],          // sector 2 starts at point 25, sector 3 at point 48
  drs: [[59.3, 3.1], [40, 43]],
  bridge: [30.5, 32.7],       // this stretch is the bridge over the main straight

  // Pit lane: leaves the track on the left at `entry`, runs alongside the
  // main straight (under the bridge) and rejoins on the left at `exit`.
  pit: {
    entry: 60.5,
    exit: 4.6,
    offset: 15.5,       // distance from the track centreline to the pit lane centreline, metres
    width: 12,          // pit lane width: 4 m fast lane plus 8 m working lane
    blend: 110,         // length of the entry and exit roads, metres
    speedLimit: 60,     // km/h
  },

  // Corner names (reference/LAKESIDE_REFERENCE_PACK.md). [from point, to point, name]
  corners: [
    [59, 3, 'Runway Straight'], [3, 5, 'Scramble'], [7, 10, 'Hurricane Sweep'],
    [12, 15, 'Windsock Hairpin'], [16, 18, 'Pen Alley'], [19, 21, 'Nissen Hairpin'],
    [22, 23, 'Sandbag'], [28, 30, 'Searchlight'], [31, 32, 'Roundel Bridge'],
    [33, 35, 'Station Corner'], [36, 39, 'Chandelle'], [40, 43, 'Hangar Straight'],
    [43, 45, 'Aileron'], [45, 46, 'Rudder'], [50, 53, 'Boundary Loop'],
    [54, 56, 'Mess Straight'], [57, 58, 'Guardroom Chicane'], [59.3, 62.9, 'Final Approach'],
  ],

  // What sits either side of the track, from Harry's colour map
  // (reference/lakeside-track-colour-map.png and LAKESIDE_ZONES.md).
  // [from point, to point, side]. Side is 'L', 'R' or 'both', as the driver sees it.
  // Anywhere not listed gets kerbs on corners, then grass out to an armco barrier.

  // Purple: gravel traps. Last value is the width in metres. They taper in at both ends.
  gravel: [
    [2.4, 4.6, 'R', 26],
    [7.6, 10.2, 'L', 26],
    [11.8, 15.6, 'L', 42],     // the biggest, outside the far hairpin
    [28.4, 31, 'L', 24],
    [33.3, 35.6, 'L', 24],
    [36.8, 38.8, 'R', 26],
    [43, 45.4, 'L', 22],
    [50.4, 54.8, 'L', 36],     // infield gravel inside the top-left loop
    [53.8, 56.2, 'R', 22],
  ],

  // Blue: walls right at the track edge, street-circuit style, with tyre
  // barriers and catch fencing. No run-off.
  walls: [
    [16, 18.6, 'R'],
    [19, 22.8, 'both'],
    [23, 25.6, 'L'],
    [57.6, 58.6, 'R'],
  ],

  // Green: extra track limits. Tarmac run-off the car can use with no
  // penalty. Last value is the width in metres.
  runoff: [
    [14.2, 15, 'R', 6],
    [16.8, 17.6, 'L', 5],
    [19.5, 21, 'L', 5],
    [22, 23.2, 'R', 5],
    [24.2, 25.0, 'L', 12],     // paved extension beside the Sandbag street wall
    [27.5, 29, 'L', 8],
    [29.6, 30.6, 'R', 6],
    [34.6, 35.6, 'L', 7],
    [38.8, 40.2, 'R', 8],
    [48, 49.2, 'L', 8],
    [56.3, 57.2, 'L', 6],
    [29.4, 30.6, 'L', 18],    // widen Searchlight's outside-left entry apron
    [59, 60.6, 'L', 12],       // widest: chicane exit onto the main straight
  ],

  // Raised sausage kerbs on the inside of the chicane, to stop cars cutting it.
  sausage: [
    [55.7, 56.3, 'R'],
    [57.1, 58.1, 'L'],
  ],
};
