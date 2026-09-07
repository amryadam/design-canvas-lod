# design-canvas-lod

Pan/zoom canvas page for a claude.ai/design project, with level of detail:
the screens nearest the middle of the view are live iframes, the rest are
placeholders.

- `design-canvas.jsx` — the canvas (sections, artboards, post-its, focus view).
  The viewport draws the background dots itself — fatoora's flow map
  dot, 26 screen px apart, the same at every zoom — so they cover the canvas at
  any pan. Pan until no page is on screen and a "Back to
  content" pill appears; a click fits every page and note back into the viewport.
- `canvas-page.jsx` — reads `canvas.json` and lays one page out as a single free
  canvas: every artboard and note at its own x/y. Drag a card by its grip to
  move it; the spot is saved to the section state file and to the browser, so
  it survives a reload even where the file cannot be written.
  Its `flows` array draws arrows between artboards on the canvas itself
  (`CanvasFlows`): `{ page, from, to, label, fs, ts, dashed }`, where `fs`/`ts`
  are the source/target anchor sides (`l`, `r`, `t`, `b`). Hover an arrow and
  drag the handle at either end to another side of its page; the choice is
  saved with the section state and wins over canvas.json (the page's ⋯ menu
  has "Reset arrow sides"). Curves route through
  the gutters around every page and note they would otherwise cross (shortest
  clear path over the page corners, then smoothed).
- Variants: copies of one screen fold into one slot. A file whose CamelCase
  name starts with another file's name on the same page is a variant of it
  (`SignInWrong`, `SignInArabic`, `SignInPhone` → `SignIn`; the longest match
  wins, so `UserCreated2K` → `UserCreated`). The primary's header shows one
  chip group per axis that varies: size (`1440 · 2K · 390`, from the width),
  language (`EN · AR`, from an `Arabic` word in the name or `RTL` in the
  title) and state (`Main · Wrong · Locked`, the leftover words). A click swaps
  the file and resizes the frame in place; arrows, the saved position and the
  focus view follow, and the choice is saved with the section state. Flows
  drawn on a variant land on the primary, and one that then loops back on
  itself is dropped, so the canvas shows the main flow. Optional fields in
  canvas.json override the guess: `variantOf` (a file, or `null` to keep a
  slot), `lang`, `state` (free text, shown as the chip).
- `flow-layout.js` — `node flow-layout.js canvas.json [page-id]` lays a page out
  the way fatoora's flow map does: stages left to right, branches stacked under
  each other, a gutter of 0.35 of a card width between stages and 0.3 of a
  card height between rows, anchors chosen from geometry. Rewrites x/y and fs/ts in
  place. Positions saved in the browser win over canvas.json, so clear the
  page's saved layout (localStorage key `dc-state:…`) to see the new one.
- `sample/` — one example page: 11 `.dc.html` artboards, a `canvas.json` with
  `flows`, and an `index.html` that runs the canvas on them.

## How the level of detail works

Nothing to run and no files to add. A slot is a live iframe while it is one of
the `DC.liveBudget` (8) slots nearest the middle of the view and within
`margin` px of it. Every other slot shows a striped placeholder with its name.

One registry serves every slot: a single pass runs `DC.settleMs` after the last
zoom or pan tick, ranks the slots by distance from the centre of the view, and
mounts at most one iframe per pass so a burst does not jank one frame. A live
slot counts as `DC.budgetHysteresis` px nearer than it is, so the slot in last
place does not flip on and off while you pan.

## Saved state

Section saves contain `sections` and an `updatedAt` millisecond revision. On
opening, the canvas compares the state file with its browser copy and restores
the newer revision. The browser copy wins ties, including legacy saves without
revisions, so edits survive on static servers with a read-only state file.
Local edits are saved to the browser immediately; host file writes are debounced
by 400 ms. Changing `stateFile` starts a fresh restoration and focus lifecycle.

Editing and initial fitting wait for restoration. If the state request fails or
takes more than five seconds, the canvas falls back to browser state.

## Run the sample

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/sample/`.

## Run the regression checks

With the same server running, open
`http://localhost:8000/tests/regressions.html`. The page reports each result and
sets its title to PASS or FAIL. It uses the same React/Babel CDN scripts as the
sample. The checks exercise real React lifecycles, connector DOM updates, and
snapshot pixels, with controlled fetch responses for loading and asset cases.

## Use in claude.ai/design

Copy the two `.jsx` files into the project beside the artboards.
