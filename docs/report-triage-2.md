# Triage of the 20 owner reports on build 58cd10f

Method: the owner's exact camera was reproduced (`?view=x,y,z,tx,ty,tz`), track data probed per metre, and the same probes run on ececfb9 to see what the track fixes (b450e8c) changed. Pictures are in `docs/report-triage-2/` (rNN-own is the owner's camera, rNN-top top-down). `tools/sweep.mjs` scans the whole lap for the same patterns (exit 1 on any hit; `SWEEP_ROOT=<checkout>` runs it on another build).

## Groups and causes

A. Wall type joins (reports at s 1238 and 1916). ARMCO ends at 1241 and street concrete starts at 1242, 0.78 m sideways, heights match. The bridge parapet ends at 1920, a TYRES stack runs 1916 to 1920, ARMCO from 1921, joins 1.1 to 1.35 m apart. Pre-existing. Fix in `buildBarriers` (src/track.js, around line 1000): make the offsets match at every change of wall type. Sweep lists more joins at 317, 1025, 1349, 1520, 1703.

B. Sandbag exit apron step (reports at s 1360 and 1365). REGRESSION from b450e8c: `vrunoff [[23,'L',11,75,64]]` (layout.js) starts the hold at point 23 (s 1362), it was point 24.45 (s 1425). The left apron jumps 0 to 11 m in one metre and the street wall 7.3 to 18.3 m, a square cut end, 63 m earlier than before. Fix: move the hold start back to 24.45 or ease the step (buildVRunoff, track.js:634 to 646).

C. Pit entry geometry (reports at s 3433, 3441, 3483, and maybe 3543). Open wide mouth with chevron island. Left apron ramps 0 to 7.3 m over 3434 to 3471, steps to 6.5 at 3472, ramps to 11.5 with a 1.3 m step at 3523. PITWALL/PITOUTER have sample gaps of 3 to 18 samples at 3471 to 3506. Pre-existing. Fix in `buildPit` (track.js:789). The escape lane like Gilles Villeneuve (report 3483) is a new feature, a design decision.

D. Final Approach apron end (report at s 3715). Left apron 7.2 m flat from 3542 ends abruptly at 3668 (7.2 to 0 in one metre) and the rumble and tyre zone runs on to 3707, 38 m past it. Pre-existing end. Fix: taper over about 50 m (buildSides, track.js:470), and stop rumble and tyres where the apron ends.

E. Furniture and boards (reports at s 432 boards, 3612, 334, 2908). Distance boards sit 3 m beyond the white line on the apron (track.js:1321), 16 to 35 m in front of the barrier. Bare stretches: right side 303 to 1951, left side 2673 to 3172 and 3196 to 3507. Design requests, confirmed.

F. Bridge (report at s 1882): deck margin 2.5 m left and 0 right (BRIDGE_RUNOFF = 2.0, track.js:56), parapets at the deck edge, no tyres. Design request.

G. Not reproduced or not confirmed, need a close shot or corrected s from the owner: s 698 barriers, s 432 digiflag (marshal post can slide up to 120 m, marshal.js:21 and 44), s 569 grass spikes, s 1304 floating shape (likely a floodlight mast head), s 3543 old furniture (likely the chevron attenuator at the pit wall start, trackMesh.js:238 and 338), s 66 pit building top grey and black (z-fighting candidate, pitBuilding.js:143 to 163), s 110 target image under a bridge (there is no bridge at s 110; the only deck is the Roundel Bridge at s 1743 to 1880).

## Suggested order
1. B. 2. A. 3. D. 4. C (after D, shared apron ramp 3434 to 3543). 5. E boards decision. 6. E furniture density. 7. F. 8. G z-fighting check on the pit building. 9. Ask the owner about the rest. 10. Escape lane.
