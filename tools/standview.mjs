// Prints a ?view=... string that looks at a named stand from the track side: node tools/standview.mjs "Hairpin Terrace" [back] [side]
import { buildTrack } from '../src/track.js';
import { createGround, sceneryFootprints } from '../src/scenery.js';
import { planStands, trackBlockers } from '../src/grandstands.js';
import { planExtras } from '../src/venueExtras.js';
const T = buildTrack(), g = createGround(T);
const bl = [...trackBlockers(T), ...sceneryFootprints(T)], { stands } = planStands(T, g, bl);
const st = [...stands, ...planExtras(T, g, bl, stands).items].find(s => s.name === process.argv[2]);
const dist = +(process.argv[3] || 38), off = +(process.argv[4] || 0);
const cx = st.x + st.ez[0] * st.depth * 0.4, cz = st.z + st.ez[1] * st.depth * 0.4, y = st.y0 + 3;
const px = st.x - st.ez[0] * dist + st.ex[0] * off, pz = st.z - st.ez[1] * -dist * -1 + st.ex[1] * off;
console.log(`view=${px.toFixed(1)},${(g.meshHeight(px, pz) + 5).toFixed(1)},${pz.toFixed(1)},${cx.toFixed(1)},${y.toFixed(1)},${cz.toFixed(1)}`);
