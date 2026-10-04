# Codespace copy vs cb28eb1

Codespace copy = `origin/codespace-copy` (4606992), one commit on top of `cb28eb1`. It is now merged into this branch, so this repo is the single source of truth. The Codespace can be retired once this branch is pushed.

Judgment key: keep / fix / revert.

## What the pass 3 prompt believed, checked

| Belief | Result |
|---|---|
| Long final corner was split into a double apex | **No.** `layout.js` control points are unchanged. Only a `Final Approach` name (points 59.3 to 62.9) and two extra apron widths were added. The double apex is still to do (item I). |
| Surface types renamed concrete, concrete outer, kerb | **Partly.** `SURF.RUMBLE` (9) and `SURF.CONCRETE_OUTER` (10) were added; `CONCRETE` and `KERB` already existed. Nothing was renamed. |
| Barrier templates added | **No new template types.** `buildBarriers` was loosened instead: armco now goes along every non-street, non-bridge run (`needs` lost its `room < SEPARATION` and `covered` tests), and the step went from 3 to 1. That is the barrier spam. |

## Files

| File | Change | Verdict |
|---|---|---|
| `src/track.js` | `track.groundAt()`: one ground height function used by barriers, furniture and mesh. | keep (item A builds on it) |
| `src/track.js` | `RUMBLE` and `CONCRETE_OUTER` surfaces, `concreteProgressAt`, rumble bands at 1/3 and 2/3 of the apron. | fix (item C: flat bands, no kerb look, rename) |
| `src/track.js` | `needs` rule for armco removed, `follow` step 1, `tooCloseToRoad` filter, wall slope limit 0.25 m per sample. | fix (item F: spam; keep `tooCloseToRoad` idea) |
| `src/track.js` | `cornersheet widthProfile` support (`cornerWidths`). | keep |
| `src/track.js` | Pit mouth: `pitMouth` flag, `PIT_MOUTH_CLEAR` 15 m, pit road full width from the start, no kerb or line across the mouth. | fix (item H: still not joined) |
| `src/track.js` | `STREET_GAP` 0.4 to 0.8, `MIN_BARRIER` 4 to 5. | keep |
| `src/trackMesh.js` | `P()` uses `groundAt`; rumble material and strips at lift 0.045; line skipped over the pit mouth. | fix (item A) |
| `src/scenery.js` | Terrain height is `T.groundAt`; terrain triangles removed under the paved strip. | fix (item A: this is the likely source of holes, blue) |
| `src/physics.js` | Car height from `groundAt`, smoothed; `RUMBLE` bump 1.2 and `CONCRETE_OUTER` fading grip. | fix (item B) |
| `src/layout.js` | Two extra apron entries, `Final Approach` name. | keep |
| `src/corners.js`, `tools/cornersheet.js`, `docs/corner-sheet.md` | Regenerated with widthProfile support. | keep |
| `src/textures.js` | Pit asphalt darkened to `#45484b`. | keep (item H) |
| `src/main.js`, `src/input.js`, `src/report.js`, `src/style.css`, `index.html`, `vite.config.js` | F2 report tool, writes `reports/*.json`, build commit in reports. | keep |
| `tools/audit.js`, `package.json` | `npm run audit` (geometry and containment). | keep (feeds item J) |
| `tools/laptest.js` | Extra checks (closest barrier and pit wall, pit overlap, boards). | keep |
| `tools/reports.js` | Report summary. | keep |
| `reports/` | 13 play reports (9 older ones from 12:08 to 13:01 included). | keep |
| `reference/LAKESIDE_FIX_PROMPT_2.md`, `LAKESIDE_SAFETY_LAYOUT.md` | Were in repo root, moved to `reference/`. | keep |

## State at this merge

- `npm run audit`: all checks passed.
- `npm run laptest`: **fails**, keyboard new driver leaves the track 14 times in three laps (target 10), and the quick driver, assists off, is 1:35.133 against 1:35.500 (over 0.3 s). Plain `cb28eb1` also fails: 20 off-track, 1:37.067. So the Codespace changes improved it, but it was not green before pass 3 either. Needs a decision (see the reply).

## Reports

Every report is tagged build `cb28eb1` (the build stamp is the last commit, so it does not show the Codespace edits). Assume they describe the Codespace copy.

| s (m) | Note | Item |
|---|---|---|
| 94 | Barrier in pits | H, F |
| 259 | Sand on track | A |
| 130 (twice) | Bridge invisible from below; weird black and green target image | A or E (bridge underside, missing texture) |
| 1716 | Track stupidly bumpy, loads of grass on it | A, B |
| 1431 | Wants more run-off, walls pushed back on purpose; floor as run-off not kerb; squeeze driver back to track; racing line | C, D |
| 2198 | Kerb should be here | C, I |
| 708 | Pointless barriers on the outside | F |
| 1736 | Widen entry on the left | already partly done (apron 18 at points 29.4 to 30.6) |
| 1909 | Grass on track, see debug map | A |
| 1993 | So many pointless barriers | F |
| 3196 | More kerbs, turn this corner into a double apex | I |
| 3814 | Blue, no surface on the left of the start/finish | A (holes), H |
