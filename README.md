# design-canvas-lod

Pan/zoom canvas page for a claude.ai/design project, with level of detail.
The screens nearest to the middle of the view are live iframes. All other
screens are placeholders.

- `design-canvas.jsx` — the canvas (sections, artboards as windows, post-its).
  The viewport draws the background dots itself — fatoora's flow map
  dot, 26 screen px apart, the same at every zoom — so they cover the canvas at
  any pan. Pan until no page is on screen and a "Back to
  content" pill appears; a click fits every page and note back into the viewport.
- `canvas-page.jsx` — reads `canvas.json` and lays one page out as a single free
  canvas: every artboard and note at its own x/y. Drag a window by its header to
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
- Every page is a window: a header with a live dot, the name, the variant
  chips, the ⋯ menu and ↗ (open the screen in a new tab), then the screen inset
  in the body (`DC.winHead`, `DC.winPad`, `DC.winBody`). Every option is in the
  header at all times — no drawer, no hover to reveal. The header drags the
  page; Ctrl+left click (⌘ on a Mac) drags it from anywhere on it, the screen
  included. The ⋯ menu holds Open
  screen, Reset position, Reset arrow sides, Download PNG, Download HTML and
  Delete.
  The chrome is world px, so it grows and shrinks with the card, as the flow
  labels do — it no longer counter-scales with the zoom. The screen keeps the
  x/y that canvas.json gives it: the window grows around it, left and up by the
  chrome, into the gutter. Drag a window by its header. The dot is green while
  the screen is a live iframe and grey while it shows the placeholder.
- Variants: copies of one screen fold into one slot. A file whose CamelCase
  name starts with another file's name on the same page is a variant of it
  (`SignInWrong`, `SignInArabic`, `SignInPhone` → `SignIn`; the longest match
  wins, so `UserCreated2K` → `UserCreated`). The primary's header shows one
  chip group per axis that varies: size (`1440 · 2K · 390`, from the width),
  language (`EN · AR`, from an `Arabic` word in the name or `RTL` in the
  title) and state (`Main · Wrong · Locked`, the leftover words). A click swaps
  the file and resizes the frame in place; arrows and the saved position
  follow, and the choice is saved with the section state. Flows
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
- `perf/bench.js` — the measurement harness. The app never loads it. Open the
  sample, then paste the full file into the DevTools console and run
  `await dcBench.all()`. It reports frame times through a pinch, the number of
  `--dc-inv-zoom` writes in a gesture, the live iframe count at five zoom
  levels, the arrow re-route cost, and the render count for one state patch.
  **`all()` writes to saved state.** It drags a card and it clicks variant
  chips, and the canvas keeps both. To undo, delete the page's `dc-state:`
  entry from localStorage and reload.

## How the level of detail works

Nothing to run and no files to add. A slot is a live iframe while two
conditions are true: it is one of the `DC.liveBudget` (8) slots nearest to the
middle of the view, and it is inside `margin` px of the view. All other slots
show a striped placeholder with the name of the screen. Zoom has no part in the
decision.

One registry serves all the slots. A single pass runs `DC.settleMs` after the
last zoom or pan tick. The pass puts the slots in order of their distance from
the middle of the view. It mounts a maximum of one iframe in each pass, because
two mounts in one frame make that frame long. A live slot counts as
`DC.budgetHysteresis` px nearer than it is. The slot in last place thus stays
stable while you pan.

One condition is outside the budget:

- The registry stops while the world moves. A pan, a zoom or a card drag holds
  the canvas in its moving state, and no slot mounts or drops until the world
  stops. A long drag thus keeps the iframes that were live when it started.

`DC.renders` counts the artboard frames that React rendered. Only `perf/bench.js`
reads it.

## Saved state

Section saves contain `sections` and an `updatedAt` millisecond revision. On
opening, the canvas compares the state file with its browser copy and restores
the newer revision. The browser copy wins ties, including legacy saves without
revisions, so edits survive on static servers with a read-only state file.
Local edits are saved to the browser immediately; host file writes are debounced
by 400 ms. Changing `stateFile` starts a fresh restoration lifecycle.

Editing and initial fitting wait for restoration. If the state request fails or
takes more than five seconds, the canvas falls back to browser state.

## Run the sample

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/sample/`.

## Run the regression checks

Run `node tests/run.mjs` to run the suite in headless Chrome. It prints one
line per check and exits 1 on a failure. A hidden browser tab pauses
`requestAnimationFrame`, so two checks fail there; the runner keeps the page
visible. The suite uses the same React/Babel CDN scripts as the sample. The
checks exercise real React lifecycles, connector DOM updates, the live iframe
budget, and export pixels. Fetch responses are controlled, to reproduce the
loading and asset cases.

## Use in claude.ai/design

Copy the two `.jsx` files into the project beside the artboards.
