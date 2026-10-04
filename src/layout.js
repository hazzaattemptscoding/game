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

  // Pit lane centreline, entry to exit, in sketch units. Used from phase 2.
  pit: [
    [316, 316], [328, 304], [345, 301], [390, 312], [440, 333], [500, 360], [560, 392],
    [592, 416], [612, 434], [632, 440], [652, 438], [660, 432],
  ],

  sectors: [24, 47],          // sector 2 starts at point 24, sector 3 at point 47
  drs: [[61, 2], [40, 42]],   // DRS zones as [from, to] point ranges
  bridge: [30.3, 32.7],       // this stretch is the bridge over the main straight
};
