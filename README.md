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
  sample, wait for the cards, then paste the full file into the DevTools
  console and run `await dcBench.all()`. It takes eight measurements:
  `zoomFrameCost` (the cost of one zoom frame, split by what the frame writes),
  `zoomFrames` (frame times through one pinch), `invWrites` (the number of
  `--dc-inv-zoom` writes in a gesture), `liveByZoom` (the live iframe count at
  five zoom levels), `lodPassCost` (the slot rects one level-of-detail pass
  reads, its time, and how many of the passes ranked at all, because a pass
  refuses to run while the world moves), `flowCost` (one full re-route of every
  arrow), `dragFlowCost` (what the arrows cost over a card drag) and
  `patchCost` (the time and the frame count for one state patch).
  **`all()` writes to saved state.** It drags a card and it clicks variant
  chips, and the canvas keeps both. To undo, delete the page's `dc-state:`
  entry from localStorage and reload.

## How the level of detail works

Nothing to run and no files to add. A slot is a live iframe while two
conditions are true: it is one of the `DC.liveBudget` (8) winners of the
budget, and it is inside `margin` px of its own canvas's viewport box. All
other slots show a striped placeholder with the name of the screen. Zoom has
no part in the decision.

One registry serves all the slots. A single pass runs `DC.settleMs` after the
last zoom or pan tick. The pass ranks the slots first by whether they are on
screen, then by distance from their canvas's viewport box: a visible slot
always outranks one that is off-screen. A live slot also counts
`DC.budgetHysteresis` px nearer than it is, which keeps the slot in last
place stable while you pan — but the visible rule comes first, and that is
what stops an off-screen live frame holding the budget while a slot the user
can see waits as a placeholder. The pass mounts a maximum of one iframe,
`DC.mountGapMs` apart from the next, because two mounts in one frame make
that frame long.

**The pass reads one rect, not one per slot.** A slot's box inside the world
does not move when the world pans or zooms, so each slot holds its own box in
world coordinates, and the pass turns it into a screen box by arithmetic on a
single rect read of the world element. This is safe because no reader of
`--dc-inv-zoom` reflows the world: `.dc-sectionhead` reads it through a
transform, and a transform never reflows, while the flow layer in
`canvas-page.jsx` reads it inside an absolute overlay of zero box.

A held box goes stale when a slot mounts, a slot unmounts, a section patch
lands, a card drag ends, a reorder commits, the world resizes, or the camera
changes. The section patch covers the size chips and Reset position. Both move
cards inside a row, and the world keeps its own border box while they do, so
nothing else on that path would notice. The camera is the world element the
held boxes are relative to. `DCViewport` gives the
camera back when it unmounts, so the registry never ranks against a dead one.
A slot the camera's world does not contain — another canvas's slot, or any
slot while no camera is set — is measured from the DOM every pass instead of
held.

The touch mark: a pointer down on a slot, and the pointer up that ends the
gesture, each keep its place in the budget for `DC.stickyMs` (4 s), so a card
you drag, rename or open the ⋯ menu on does not drop while you work on it. The
second mark is what makes a long drag keep its place. No pass runs while a drag
holds the canvas moving, so the mark is first read at the drop, and a drag
longer than 4 s would arrive there stale. The mark biases the distance only. It
never outranks a visible slot, because a slot that has left the screen must
still give its place up. A pointer down inside a live iframe never reaches the
page, so the mark covers the grip, the header and the ⋯ menu only.

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
takes more than `DC.stateTimeoutMs` (1500 ms), the canvas falls back to browser
state.

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

Three checks hold the zoom work in place. "The settled `--dc-inv-zoom` write
holds the zoom anchor" proves that the deferred write moves no content: the
slot stays where the transform alone puts it, during the gesture and after the
settle. "The world layout does not read the zoom" swings `--dc-inv-zoom` over
its whole range with the transform held, and no box in the world may move.
"A wheel roll does not mount or drop iframes mid-gesture" rolls the wheel and
counts the iframes that are added or removed: the moving flag must outlast the
settle timer, or the cards blink between two notches.

## Host protocol

A canvas in an iframe talks to its host with `postMessage`. Every message uses
the target origin `'*'`. The canvas posts nothing when it is not embedded: a
top-level canvas would only talk to itself.

| Message | Direction | When |
|---|---|---|
| `{ type: '__dc_present' }` | canvas → host | on mount, and as the answer to `__dc_probe` |
| `{ type: '__dc_zoom', scale }` | canvas → host | on each settled gesture, and only when embedded. One post for each gesture, not one for each frame. The same scale is not posted twice |
| `{ type: '__dc_set_zoom', scale }` | host → canvas | the host sets the zoom. The canvas anchors on the middle of its viewport, as a pinch does |
| `{ type: '__dc_probe' }` | host → canvas | the host asks whether a canvas is there. The canvas answers `__dc_present` and posts its zoom again |

## Use in claude.ai/design

Copy the two `.jsx` files into the project beside the artboards.
