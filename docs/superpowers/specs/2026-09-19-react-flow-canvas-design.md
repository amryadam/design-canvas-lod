# React Flow canvas — design

**Date:** 2026-09-19
**Status:** design approved; phase 0 (the spike gate) is done: **GO**
**Spike report:** `2026-09-19-react-flow-spike-report.md`
**Plan:** phase 0 `../plans/2026-09-19-react-flow-spike.md`; phase 1 to be written

## Why

The custom canvas (`design-canvas.jsx` and `canvas-page.jsx`, about 125 KB)
has two problems:

1. **Performance bugs.** The world is one `will-change: transform` element.
   On a tall page the layer goes past the GPU max texture size (16,384 px)
   and the bottom of the page blanks on zoom-in. A zoom-in and then a
   zoom-out also makes the raster memory very large.
2. **Too much custom code.** The viewport, the gestures, the camera, the GPU
   layer logic, the level-of-detail registry, the arrow router and the drag
   sessions are all custom.

The decision is to replace the canvas engine with **React Flow**
(`@xyflow/react` 12, MIT). Its nodes are DOM elements, so a node can hold a
live iframe. Its viewport is one transformed element without `will-change`,
so no single GPU layer holds the whole world. The spike showed that this
alone is not enough: see "Requirements from the spike".

## Decisions made with the user

- A build step (npm + Vite) is permitted.
- Keep: live screens with the budget of 8, windows with variants, arrows with
  anchor sides and labels.
- Arrows use React Flow **built-in edges only**. An arrow can cross a
  window. `@tisoap/react-flow-smart-edge` is not used, and the custom router
  (`cfRoute`) is not ported.
- The state file, the PNG/HTML export and the host protocol stay, because
  each is cheap to keep.
- `canvas.json` can change format, but this design keeps the current format,
  because it already maps cleanly to nodes and edges.
- Old saved browser state can reset once.
- Success is: the same look (arrows excepted), frame times at or under
  today's, and no blank on the tall page.

## Candidates that were rejected

| Candidate | Reason |
|---|---|
| tldraw | Production use needs a license key; the free key shows a watermark. About 524 KB. |
| Excalidraw | The scene is a `<canvas>`; windows cannot be native elements; iframes never unmount. |
| react-zoom-pan-pinch | Keeps the one-big-layer model that causes the blank. No culling, no edges. |
| No library (finish the layer-limit fix) | Fixes the blank but not the code size. It is the **fallback** if the spike fails. |

## Requirements from the spike

The spike (phase 0) measured the risk that this section named before: without
`will-change`, Chrome rasters the viewport again at each zoom step, and that
includes the live iframes. Its results, all in the spike report, make these
rules binding for phase 1:

1. **No `will-change: transform` on the React Flow viewport, ever.** With it,
   React Flow is fast and loses its arrows after a zoom-in and zoom-out (the
   same class of bug as the old engine's blank).
2. **`will-change: transform` on each live iframe (`live-wc`).** Each live
   screen is its own small GPU layer, so a zoom does not raster it again. The
   screens stay visible during a gesture. The user checked this on the real
   "Users and roles" page: no blank, smooth.
3. **The `sticky` budget rule.** A live window that is on screen is never
   dropped by a pass. A pass runs only when nothing has moved for
   `stickySettleMs` (600 ms), and never between `onMoveStart` and
   `onMoveEnd`. Without it, a zoom in several pinches swapped visible live
   screens to their placeholder (18 swaps in the local check; the user saw
   it). The user checked `live-wc` with `sticky`: the live screens stay live.
4. **No `freeze`.** Hiding the live iframes during a gesture is fast and
   clean, but the user rejected the look.

What the spike did not settle: a real pinch was not measured by a bench (only
synthetic wheel events and the user's eye); `live-wc` had one long frame in
each zoom on the synthetic tall page (worst frame 1.3–1.6 × the old
engine's), which the user did not notice on the real page.

## Phase 0 — the spike gate

**Done: GO.** Results and the user's three checks are in the spike report.
The text below is the plan as approved before the spike.

A throwaway Vite app in a git worktree off `main`, on the branch
`spike/react-flow`. It is never merged. Only its report moves forward.

**It builds:**
- React Flow 12 with built-in bezier edges.
- The 11 sample screens as nodes with live iframes and a simple budget of 8.
- The 12 sample flows as edges.
- A synthetic tall page of about 12,200 × 16,200 px of screens.

**It measures**, for the spike and for today's `main`, on the same machine,
viewport and DPR:
1. Zoom: 90 `ctrl+wheel` ticks, one for each frame, in and then out. Frame
   times (p50, p95, worst, count over 16.7 ms) and main-thread busy time.
2. Pan: 60 frames, the same numbers.
3. Tall page: a screenshot at each zoom step from 0.1 to 4, with a pixel
   check that the bottom area is not blank.
4. Text sharpness at zoom levels that are not whole numbers (React Flow
   issue #3282).

**Pass criteria:**
- The tall page has no blank at any zoom step.
- The zoom and pan p95 and worst frame are at or under today's numbers, with
  a 10% band for measurement noise.
- If the text is not sharp, the report gives a workaround and the user
  decides.

**Output:** a short report with the numbers and a go/no-go recommendation.
The last check is the user's: load the spike bundle in claude.ai/design on
the real "Users and roles" page.

**If the spike fails:** finish the staged layer-limit fix on
`fix-canvas-layer-limit` (see
`docs/superpowers/plans/2026-09-09-canvas-layer-limit.md`).

## Phase 1 — architecture

### Build

`package.json`, Vite in library mode, Vitest. The build makes one file,
`dist/design-canvas.js`: an IIFE that contains React 18, React Flow 12 and
the CSS. A page loads this one script and calls
`DesignCanvas.mount(el, { page, stateFile, data })`. Babel standalone and the
CDN React scripts go away.

### Source files (`src/`)

| File | Job |
|---|---|
| `main.jsx` | The mount API and the globals the tests read |
| `CanvasPage.jsx` | Reads `canvas.json`, builds the nodes and edges, renders `<ReactFlow>` |
| `variants.js` | `cpVariants` and the chip helpers, moved without change |
| `mapping.js` | The pure mapping from `canvas.json` to nodes and edges |
| `WindowNode.jsx` | The window: header and screen |
| `NoteNode.jsx` | The post-it; it drags as a whole and its position is saved |
| `SectionHead.jsx` | The page name and the "N screens · N variants" line: a node above the content that cannot be dragged or selected |
| `liveBudget.js` | The budget of 8 live iframes |
| `DotBackground.jsx` | Dots 26 screen px apart at every zoom |
| `BackPill.jsx` | The "Back to content" pill; calls `fitView` |
| `persist.js` | The browser copy and the state file |
| `host.js` | The postMessage host protocol |
| `export.js` | PNG/HTML export, moved without change |

`DotBackground` is custom because React Flow's own dots grow with the zoom.

### WindowNode

- A React Flow custom node in `React.memo`. It subscribes only to its own
  data.
- The header holds the live dot, the name, the variant chips, ⋯ and ↗.
  `dragHandle: '.dc-winhead'` makes the header the drag area. The chips and
  the menu have the `nodrag` class.
- Ctrl/⌘ + drag from anywhere on the window stays: while the key is down, the
  shield on the screen becomes a drag area.
- A chip click changes the node's `data.cur` and its `width`/`height`. React
  Flow moves the edges.
- The iframe shield stays: it lets wheel and pinch events reach the canvas,
  and a click opens the screen file.
- The ⋯ menu: Open screen, Reset position, Reset arrow sides, Download PNG,
  Download HTML, Delete.
- The chrome is in world px and grows with the zoom, as today.
- Four handles with the ids `l`, `r`, `t`, `b`.

### liveBudget.js

- One store and one pass. The pass runs `stickySettleMs` (600 ms) after the
  last `onMove`, node drag or chip change. It does not run between
  `onMoveStart` and `onMoveEnd`, so no iframe mounts or drops in the middle
  of a gesture.
- The `sticky` rule: a pass never drops a live window that is on screen. It
  drops only off-screen live windows, and fills free places by the ranking
  below. The kept windows are a subset of the previous live set, so the live
  count never goes above 8.
- Inputs: the viewport `{x, y, zoom}`, the pane size and the node boxes from
  React Flow's store. Arithmetic only; no DOM rect reads.
- The ranking rules stay: visible slots first, then the distance from the
  viewport box; a live slot counts 400 px nearer; the touch mark lasts 4 s and
  never outranks a visible slot; a maximum of one mount each `mountGapMs`; a
  live iframe beyond `unmountMargin` is dropped.
- Each live iframe has `will-change: transform`. The React Flow viewport has
  none.
- Each `WindowNode` reads `isLive(id)` through `useSyncExternalStore`, so a
  pass re-renders only the nodes whose state changes.
- `onlyRenderVisibleElements` stays **off**: it unmounts nodes, and that
  reloads iframes. `content-visibility: auto` on the node body keeps the
  paint cost low.

### Arrows

- Built-in bezier edges with a label. `fs`/`ts` in `canvas.json` become
  `sourceHandle`/`targetHandle`.
- An arrow end can be dragged to a different side of the same window
  (`reconnectable` edges and `onReconnect`, limited to the same node). The
  choice is saved and wins over `canvas.json`.

### Data flow

1. `CanvasPage` gets `canvas.json` by fetch, or from the host through the
   `data` prop.
2. `variants.js` folds the variants into their primary screens.
3. `mapping.js` builds the nodes (windows and notes at their x/y) and the
   edges. A flow on a variant moves to the primary. Loops, duplicates and
   flows to unknown screens are dropped; an unknown screen gives one
   `console.warn`.
4. `persist.js` loads the saved state; the page puts it on top.
5. The page renders `<ReactFlow>` with controlled `nodes` and `edges`.

### Saved state

- Format: `{ updatedAt, positions, variants, arrowSides, deleted }`, keyed by
  the screen file. The viewport has its own browser key.
- The restore rules stay: the newer `updatedAt` wins; the browser copy wins a
  tie. Browser saves are immediate; `omelette.writeFile` saves have a 400 ms
  debounce.
- The new browser key is `dc2-state:…`. Old saves are ignored.
- The first `fitView` and all edits wait for the restore. If the state
  request fails or takes more than 1500 ms, the page uses the browser copy.

### Error handling

| Condition | Result |
|---|---|
| The `canvas.json` fetch fails | A plain message on the page with the error |
| The state file is missing or not valid JSON | The browser copy is used; no error shown |
| `localStorage` throws | Caught; the page continues without saves |
| `omelette.writeFile` is absent or fails | No error shown; the browser copy is the source of truth |
| A flow refers to an unknown screen | The flow is dropped; one `console.warn` |
| An export fails | The ⋯ menu shows the error in its row |

### Host protocol

Unchanged for the host. `host.js` posts `__dc_present` on mount; posts
`__dc_zoom` on `onMoveEnd`, only when embedded, and never the same scale
twice; answers `__dc_probe`; on `__dc_set_zoom` calls `zoomTo` anchored on the
middle of the viewport.

## Tests

### Unit tests (Vitest)

- `variants.js`: the fold rules, the longest match, `variantOf: null`, the
  `lang`/`state` overrides, the chip axes.
- `liveBudget.js`: the ranking as a pure function. Visible outranks
  off-screen; the hysteresis keeps the last place stable; the touch mark never
  outranks a visible slot; the budget is 8; the `sticky` rule never drops an
  on-screen live window, and the extra ones drop first when they leave the
  screen.
- `persist.js`: the newer revision wins; the browser copy wins a tie; the
  timeout fallback; a `localStorage` that throws.
- `mapping.js`: a flow on a variant moves to the primary; loops, duplicates
  and unknown screens are dropped.

### Browser suite (headless Chrome)

`tests/run.mjs` stays and loads the built bundle. `tests/regressions.js` is
rewritten. The checks of engine internals that go away (`--dc-inv-zoom`, the
held boxes, the GPU layer, `cfRoute`) are deleted with the code they test.
These behaviour checks are ported:

- the live iframe budget under pan and zoom
- no iframe mounts or drops in the middle of a wheel gesture
- a header drag moves the window and the position is saved
- a chip click changes the file and the size, and the arrows follow
- an arrow side change is saved
- the state restore lifecycle
- the export pixels
- the host protocol messages
- the "Back to content" pill

- a zoom in several pinches, each at a different point, with 400 ms pauses:
  no on-screen live window turns into its placeholder (port of
  `spike/sticky-check.mjs`)
- the React Flow viewport has no `will-change`; each live iframe has
  `will-change: transform`

One new check, outside the headless suite because it needs the GPU:
`tests/blank-check.mjs`, a port of `spike/wc-check.mjs`. It runs a headful
Chrome with the GPU on, on a synthetic tall page (50 screens, 12,200 ×
16,200 px): fit, zoom in to 3.5 ×, zoom out, then screenshots at 1 s and
5 s. It fails if a card frame is missing or cut, if the arrows between the
cards are gone, or if more than 2% of the pixels differ from the picture
before the gesture. It is the first check that reproduces the old engine's
blank outside claude.ai/design.

### Performance

`perf/bench.js` is rewritten. It keeps `zoomFrames`, `liveByZoom` and
`patchCost`, and adds `panFrames`. It drops `zoomFrameCost`, `invWrites`,
`lodPassCost`, `flowCost` and `dragFlowCost`. The baseline is the spike's
`live-wc` numbers against the old engine, from `spike/frames.mjs` in both
engine orders.

### Same look

Before the old code is deleted, screenshots of the old and the new sample at
three zoom levels go side by side for the user's review. This is a check by
eye, because the arrows change on purpose.

## Migration order

Branch `react-flow-canvas` off `main`. Each step leaves the suite green.

1. Add the build: `package.json`, Vite, Vitest. The old canvas is not touched.
2. Write the pure modules with their unit tests: `variants.js`, `mapping.js`,
   `liveBudget.js`, `persist.js`.
3. Write `CanvasPage`, `WindowNode`, `NoteNode`, `SectionHead` and the edges with side
   handles. Add `sample/index-rf.html`, which runs beside the old page.
4. Add `DotBackground`, `BackPill`, `host.js`, `export.js` and the arrow side
   reconnect.
5. Add the new browser suite and the new `perf/bench.js`. Measure against the
   spike baseline.
6. The side-by-side screenshot review. The user's OK is necessary.
7. Make the change: `sample/index.html` loads the bundle; delete
   `design-canvas.jsx`, `canvas-page.jsx` and the old tests; rewrite the
   README.
8. The user deploys to claude.ai/design and checks the real "Users and roles"
   page. This is the last verification.

## Out of scope

- Arrow routing around windows.
- Migration of the old saved state.
- Multi-select, undo, a minimap.
- Removal of the React Flow attribution. The docs ask for a Pro subscription
  before it is hidden, so the mark stays in a corner of the canvas.
