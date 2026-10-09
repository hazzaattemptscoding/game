# Lakeside UI system

The single source of truth for every UI stage (menus, results, HUD). Read this before touching any UI file. If something here conflicts with an older style in `src/style.css`, this wins.

## Who and feel

A driver at a desk with mouse and keyboard, wanting to be on track in two clicks. After a race they want the result and the next race. The UI is a pit-wall monitor under floodlights: calm and exact, with the circuit and car always visible, and colour doing real work. It is **colourful on a purple base**, not grey and not a rainbow.

Brand source: the PowerMedia and Lakeside colours already in `src/gantryScreen.js` (`C` palette, `SLANT`).

## Signature: the 19% lean

Every edge on the gantry screens leans at 19% (`SLANT = 0.19`, matched to the PowerMedia logo). The UI uses the same lean as its one signature:
- Primary buttons, the selected nav marker, section chips, progress and sector bars, the focus tab on the rail all use a **skewed background** (`transform: skewX(-10.7deg)` on a pseudo-element, text stays upright). 10.7 degrees is atan(0.19).
- Panels, inputs, rows and cards stay rectangular. Only "action and selection" shapes lean, so the lean means something.
- Check: you must be able to point to five places the lean appears (primary button, selected rail item, group label chip, results position badge, HUD sector bar).

## Colour tokens (CSS custom properties on `:root`)

Names come from the venue. Define all of these once, in `src/style.css`, and use only tokens in component rules (no raw hex in components).

```
--pit-0:   #0a0612;  /* deepest: scene shade, input wells */
--pit-1:   #120b20;  /* rail, panels */
--pit-2:   #1b1230;  /* rows, cards */
--pit-3:   #271a44;  /* hover, raised */
--line:    rgba(190,160,255,.12);   /* hairline */
--line-strong: rgba(190,160,255,.24);

--text:       #f4f0ff;
--text-dim:   #b7accf;
--text-faint: #8f84a8;

--purple:        #6d28d9;  /* PowerMedia: selection, active, brand fills */
--purple-deep:   #4c1d95;  /* behind selection, bars */
--purple-bright: #8418f6;  /* Delta violet: hover glow, highlights */
--purple-soft:   #a78bfa;  /* purple used as TEXT or thin lines on dark */

--lake:       #19c8b9;  /* Lakeside teal: secondary accent, info, links, "online" and live state */
--lake-deep:  #06282c;

--gantry:     #ffd400;  /* the ONE primary-action colour (Start, Drive, Join). Dark text on it. */

--timing-best:  #e879f9; /* fastest overall: the fastest of the session (HUD, board) or of the race in that sector (results) */
--timing-pb:    #2fd673; /* personal best, or within 0.3 s of the fastest (results) */
--timing-slow:  #f5c542; /* slower */
--flag-red:     #ff4b3e; /* penalties, warnings, destructive */
```

Rules:
- ~60/30/10: deep purple-black surfaces, purple and lake as the colour, yellow only for the single primary action on a screen.
- Timing colours are semantic. Never use them decoratively. Brand purple is never used for timing state.
- Selection and "on" = `--purple` fill with `--text`. A focus ring is 2px `--gantry` with 2px offset on every focusable control.
- Depth strategy: **surface shifts plus hairlines**, no heavy shadows. Raised = one step lighter surface. Inputs sit darker (`--pit-0`).
- Scene: keep the 3D scene visible. Dim it with a gradient from the left (`rgba(10,6,18,.92)` to transparent), not a flat veil, tinted purple not black.

## Type

- **Display, labels, numbers:** Barlow Condensed (already bundled: 600 normal and 800 italic). Italic 800 for screen titles, wordmark and big numerals. 600 for labels. Always `font-variant-numeric: tabular-nums` for times, gaps, speeds.
- **Body and settings text:** Barlow (non-condensed) 400/500/600 via `@fontsource/barlow` (latin only, self-hosted, no CDN). Add the dependency, import only the weights used.
- Scale (ratio 1.25 from 15px body, round to whole px): caption 11 · small 12 · body 15 · h4 19 · h3 23 · h2 29 · display 46+. Weight and colour carry hierarchy as much as size: value 600/`--text`, label 500/`--text-dim`, meta 400/`--text-faint`.
- Section labels: 11px, uppercase, 0.14em tracking, `--text-faint`, inside a leaning chip only on the primary group of a screen.
- Large titles get slightly negative tracking (-0.01em). Body line-height 1.45. `text-wrap: balance` on headings, `pretty` on paragraphs.

## Space, shape, density

- Base unit 4px, use multiples only. Row height 52px. Panel padding 20 to 24px. Group gap 28px. Rail width 280px at a 1280 window (clamp 240 to 320).
- Radius scale: controls 6px, rows and cards 10px, modals 14px. Leaning shapes have 0 radius.
- Nested radius rule: inner = outer minus padding.
- Hit areas at least 40px high. Never hover-only controls (keyboard and touch must work).
- Layout must fit a 1280x640 window with no page scroll: only the content pane scrolls, and the action footer (Start, Back) stays pinned.

## Components (reuse, do not restyle per screen)

- **Rail**: persistent left column, wordmark (Barlow Condensed italic 800), nav list, driver chip at the bottom. Items show number keys 1 to 7 (`kbd`). The selected item has a leaning `--purple` marker behind it.
- **Resume button** (main menu only): the one yellow leaning button at the top of the rail, resumes the last mode.
- **Row**: label and optional hint left, control right, hairline between rows, inside a `--pit-1` group card. One component for every setting.
- **Switch** for on/off. **Segmented control** for 2 to 5 choices (selected = `--purple`). **Stepper** for laps. **Slider** with a visible value. Never a pair of full-width slabs.
- **Summary card** (race setup, online lobby): a short readout beside the form, with the primary button inside it.
- **Table** (results, times, standings): right-aligned tabular numerals, hairline rows, your row marked with a leaning purple edge, position badge leaning.
- **Banner** (HUD messages): a leaning bar, text upright, colour by meaning (warn `--gantry`, penalty `--flag-red`, info `--lake`).

## Motion

Felt, not watched. Under 300ms. Custom ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, never ease-in. Animate only `transform` and `opacity`, never `transition: all`. Press: `scale(.98)` on `:active`. Screens enter with 8px `translateY` plus fade (180ms), rail items stagger 30ms. Keyboard-repeated actions (arrow nav) get no animation. Honour `prefers-reduced-motion` (drop movement, keep opacity).

## Copy

Plain, short, from the driver's side. No "Welcome", no exclamation marks, no em dashes. Controls say what they do ("Start race", "Host a room"). Errors say what happened and what to do.

## Anti-slop checks (run before presenting any screen)

1. **Swap test**: swap in a default font and a stock dashboard layout. If nothing is lost, you defaulted.
2. **Squint test**: blur it; focal element still obvious, nothing harsh.
3. **Signature test**: five specific places show the lean.
4. **Token test**: read the CSS variables aloud; they should belong to a racing circuit, not a generic app.
5. Not allowed: centred modal-in-a-box, two huge slab buttons for a binary choice, orange section headings, grey-on-grey, gradient hero text, emoji, same card repeated everywhere, accent colours not in the token list.

## Behaviour guardrails (do not break)

- Keep every existing action, setting key, and id/class that tests or code query (`tools/screencontrol.js`, `tools/smoke.mjs`, `tools/hudsettings.js`, `tools/cursor.js`, `tools/board.js`, menu keyboard and gamepad navigation in `src/menuNav.js`). Change a selector only together with its test.
- Menu navigation by keyboard and gamepad must still work exactly (arrows, Enter, Escape, number keys added on top).
- Touch buttons keep working.
- No new network or CDN dependency; fonts are bundled.
