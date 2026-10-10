# Lakeside UI system (v2: quiet)

The single source of truth for every UI screen (menus, results, HUD). Read this before touching any UI file. This version REPLACES the first loud one (slanted yellow buttons, italic titles, saturated purple fills, glows), which the owner rejected: "feels like Fortnite". Where `src/style.css` still has those, they are bugs.

## Who and feel

A driver at a desk with mouse and keyboard, wanting to be on track in two clicks. After a race they want the result and the next race. The reference is **iRacing**: flat dark panels, thin borders, small rectangular controls, regular-weight type, dense but tidy, nothing shouting. The circuit and car stay visible. Purple (the PowerMedia brand) is the quiet base. Colour lives in small details that mean something: timing colours, livery chips, status dots, one selection bar.

## What is banned (the owner named these)

1. Slanted shapes of any kind: no `skewX`, no leaning plates, bars, chips or badges. Everything is rectangular.
2. Bold italic condensed titles. No italic text anywhere. Titles are upright, regular to semibold.
3. Glows: no coloured `box-shadow` halos, no `text-shadow` glow. Shadows only for real elevation (menus over scene) and subtle.
4. Yellow action buttons. Yellow is not a button colour any more.
5. Saturated purple fills for selection, plates and badges. Selection is a tint plus a thin bar.
6. Also still banned: centred modal-in-a-box, two huge slab buttons for a binary choice, gradient text, emoji, accent colours outside the token list.

## Colour tokens (CSS custom properties on `:root`)

Keep the existing token NAMES where they exist (components already use them) and change their VALUES and roles. Add the new ones.

```
--pit-0: #0d0b14;   /* deepest: input wells, scene shade */
--pit-1: #141120;   /* rail, panels */
--pit-2: #1b1729;   /* rows, cards */
--pit-3: #241f36;   /* hover, raised */
--line:  #2c2740;   /* hairline borders */
--line-strong: #3a3454;

--text:       #ebe9f3;
--text-dim:   #aaa6bd;
--text-faint: #8a86a0;   /* at least 4.5:1 on --pit-1; check with a script */

--accent:       #7c5cf0;              /* quiet purple: selection bar, links, outlines */
--accent-fill:  #6d28d9;              /* PowerMedia purple: the ONE primary button and switch-on */
--accent-tint:  rgba(124, 92, 240, .16); /* selected row/option background */
--accent-soft:  #b9a4ff;              /* focus ring (2px outline, 2px offset) and purple text */

--lake: #19c8b9;      /* status: online, live, DRS available, info */
--warn: #f0b429;      /* warnings (this replaces the old yellow gantry token) */
--bad:  #ff5d52;      /* penalties, invalid, destructive */

--timing-best: #e879f9;  /* fastest of everyone */
--timing-pb:   #3ddc84;  /* personal best, or within 0.3 s of the fastest */
--timing-slow: #e8c04a;  /* slower */
```

The old `--purple`, `--purple-deep`, `--purple-bright`, `--purple-soft`, `--gantry`, `--lake-deep`, `--flag-red` and `--on-gantry` tokens must be removed or mapped onto the new ones (grep every use; do not leave two names for the same role). Timing colours are semantic only, never decoration. Brand purple is never used for timing state.

Rules:
- Purple appears as: the dark surfaces (they carry a purple tint), the selection tint and left bar, the primary button, a switch that is on, links, the focus ring. Nothing else.
- Depth is surface shifts plus hairlines, not shadows. Inputs sit darker (`--pit-0`).
- Scene: keep the 3D scene visible. Dim it with a left-to-right gradient from `rgba(10,8,18,.94)` to transparent. No coloured veils.

## Type

- Body, labels, titles: **Barlow** (regular 400, medium 500, semibold 600). Self-hosted already.
- Numbers (times, speeds, gaps, positions, HUD readouts) and the wordmark: **Barlow Condensed** 500/600/700, upright, `font-variant-numeric: tabular-nums`.
- Wordmark: Barlow Condensed 700, uppercase, letter-spacing 0.14em, about 20px. Not italic, not large.
- Scale (px): 11 caption · 12 small · 14 body · 16 row label · 20 screen title (weight 600, upright, letter-spacing -0.005em) · 28 section hero · 44 big numerals (HUD lap time, result position).
- Group labels: 11px uppercase, letter-spacing 0.1em, `--text-faint`, weight 600. No chip behind them.
- Hierarchy comes from weight and colour as much as size: value 500/`--text`, label 400/`--text-dim`, meta 400/`--text-faint`.

## Space, shape

- Base unit 4px. Row min-height 48px. Panel padding 16 to 20px. Group gap 24px. Rail 240px wide at a 1280 window (clamp 220 to 280).
- Radius: controls 4px, rows and cards 6px, menus and dialogs 8px. Circles only for swatches, dots, switch knobs.
- Hit areas at least 40px high. Nothing hover-only. Keyboard and touch must work.
- Must fit 1280x640 with no page scroll: only the content pane scrolls, and the action footer stays pinned.

## Components (one version of each, reused everywhere)

- **Rail**: flat `--pit-1`, 1px right border `--line`. Wordmark, optional primary button, nav list, driver chip at the bottom. Nav item: padding 8px 10px, `--text-dim`; selected = `--accent-tint` background, `--text`, 3px left bar `--accent`. Number keys shown as a small outlined `kbd`.
- **Primary button** (one per screen at most): solid `--accent-fill`, white text 600, radius 4px, no border glow, no shadow. Hover: lighten 6%. Active: darken, `scale(.98)`. **Secondary**: `--pit-2` background, 1px `--line-strong`, `--text`. **Quiet/destructive**: text only, `--bad` for destructive.
- **Row** (every setting): label 16/500 and optional hint 12/`--text-faint` on the left, control on the right, hairline between rows, inside a `--pit-1` group card with 1px `--line` border and 6px radius.
- **Switch**: 36x20 pill, off = `--pit-3` with `--line-strong` border, on = `--accent-fill`, knob white. **Segmented**: inset `--pit-0` well, 1px `--line-strong`, options `--text-dim`; selected = `--accent-tint` fill, white text, inset 1px `--accent`. **Stepper** = segmented. **Slider**: 3px track, filled part `--accent`, 12px knob `--text`, value in Barlow Condensed on the right.
- **Chip** (race number, tags): Barlow Condensed 700, white on the livery colour, 3px radius. Host/you tags: outlined, `--text-dim`.
- **Banner** (HUD messages): a rectangle with `--pit-1` at 88% opacity, 1px `--line-strong`, 6px radius and a 4px coloured LEFT EDGE carrying the meaning (info `--lake`, warn `--warn`, penalty/invalid `--bad`, best lap `--timing-best`, personal best `--timing-pb`). Text 16/600 upright.
- **HUD panel**: `--pit-1` at 82% opacity, 1px `--line-strong`, 6px radius, light backdrop blur. Sector bars are 4px-high flat rectangles in the timing colours with the time below.
- **Table** (results, times, Tab board): right-aligned tabular numerals, hairline rows, header 11px uppercase faint. Your row: `--accent-tint` plus a 3px left bar `--accent`. Position is plain Barlow Condensed in `--text-dim`, no badge.
- **Card / summary**: `--pit-1`, 1px `--line`, 6px radius, 16 to 20px padding.

## Motion

Quiet. 120 to 160ms. Ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, never ease-in. Animate only `opacity` and `transform` (4px translate at most). No stagger, no bounce, no scale-in. Press: `scale(.98)`. Arrow-key navigation: no animation. Honour `prefers-reduced-motion` (opacity only).

## Copy

Plain, short, from the driver's side. No em dashes, no exclamation marks, no "Welcome". Controls say what they do ("Start race", "Host a room").

## Checks before presenting any screen

1. **Fortnite test**: grep the CSS for `skew`, `italic`, `text-shadow`, glow-style `box-shadow` (coloured, blur over 8px), `--gantry` fills, `font-weight: 800`. Any hit is a bug unless it is a livery or sponsor colour.
2. **Squint test**: blurred, the layout still reads: rail, content, one primary action. Nothing shouts.
3. **Token test**: every colour in component CSS comes from a token. No raw hex outside the token block and livery content.
4. **Contrast**: body text and `--text-faint` at least 4.5:1 on the surface they sit on.
5. Compare with the approved mockup: /tmp/claude-0/-home-user-game/58c1e60f-5d06-5158-8b00-69725614967c/scratchpad/ui-v2-template.html (its CSS is the visual reference; it is written in container units, translate to px).

## HUD exception (the in-game HUD only)

The owner asked for the old in-game HUD look back after driving the quiet version: "the old appearance, actual colour and visual effects were better". So the in-game HUD is the one place where the old look stays. Menus, results, settings and screens are still quiet, with every ban above.

The HUD (`src/hud.js`, `src/sessionHud.js`, the HUD blocks of `src/style.css`, the Tab board's blocks) keeps the NEW layout, element set, ids, classes and behaviour (positions, what shows, the steady no-jump rule, the HUD settings and toggles). Its appearance is the old game's:

- Numerals (lap time, speed, gear, sector times, the flash and banner text) are Barlow Condensed 800 italic with a soft shade, `0 1px 3px rgba(0,0,0,.6)`. Labels stay upright, small and tracked.
- Plates are dark, translucent and tinted with the settings' purple (`--hud-card`, `--pit-1` at 80%), with 2px corners and no border. Wells inside a plate are `--hud-well`.
- Timing keeps its tokens: best magenta, personal best green, slower yellow, as solid sector plates. The live delta is green ahead and `--bad` red behind.
- Gear, lit items (DRS open, pit limiter, a lit start) and the DRS-available text are yellow (`--hud-yel`). An assist that is working is a paper fill with dark text, and an assist switched off is struck through and dim.
- Track limits are amber (`--hud-amber`). Start lights are red and glow when lit. This is the only glow allowed.
- The brand purple (`--accent-fill`) fills the best and personal-best lap message, so the HUD belongs with the settings menu. The slipstream dot and bar use `--accent-soft`.
- Pedal readouts and the touch pedals: throttle green, brake red, a pressed key paper.

Rules that still hold in the HUD: every colour is a token (the `--hud-*` tokens on `:root` in `src/style.css`, the menu tokens otherwise), no raw hex in a rule, no text shadow except the shade above, `prefers-reduced-motion` keeps the fades and drops the travel. Text on a plate keeps 4.5:1 against bright sky (the labels measure about 6:1 on it); large numerals in red may sit a little under that. The slant of the old HUD is the italic only: the old plates were not skewed, so no plate is skewed.

## Behaviour guardrails

- Keep every existing action, setting key, id and class that tests or code query. Change a selector only together with its test.
- Keyboard and gamepad navigation (`src/menuNav.js`) unchanged. Number keys 1 to 7 on the main menu stay.
- Touch controls keep working. The touch/keyboard switching fix in `src/input.js` stays.
- No new network or CDN dependency.
