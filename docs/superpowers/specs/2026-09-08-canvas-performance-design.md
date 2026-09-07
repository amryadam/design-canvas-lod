# Canvas performance — design

**Date:** 2026-09-08
**Status:** approved, ready to implement
**Plan:** `docs/superpowers/plans/2026-09-08-canvas-performance.md`

## Why

The user asked to remove the zoomed-out snapshot picture and to make the canvas
snappier. Six candidate costs were read out of the code and then measured in a
real browser. Two of the six did not survive measurement, one changed cause, and
two new problems showed up that were not on the list.

## How it was measured

- Sample page: 10 artboards (mostly 1440 px wide), 12 flows, 1 note.
- Chrome through the chrome-devtools MCP, viewport 1066 × 666, DPR 3,
  ~144 Hz display, so the frame budget is ~7 ms. No CPU throttling.
- Gesture: 90 `ctrl+wheel` ticks, one per animation frame, zoom in then out.
- Numbers come from in-page micro-benchmarks (A/B with one cause neutralised)
  plus DevTools traces parsed for `Layout`, `UpdateLayoutTree`, `Paint`,
  `Layerize` and `RasterTask`.

The harness that reproduces every number is `perf/bench.js` (Task 2).

## Findings

### F1 — Live iframes are unbounded (the largest cost)

Same gesture, same fit, all 10 slots on screen:

| | snapshots (today) | all live (no threshold) |
|---|---|---|
| gesture wall clock | 747 ms | 992 ms |
| main-thread busy | 242 ms (32 %) | 702 ms (71 %) |
| Paint | 37.8 ms | 145.5 ms |
| Layerize | 9.1 ms | 34.4 ms |
| Raster (off main) | 131 ms | 685 ms |
| frames over 16.7 ms | 0 of 88 | 14 of 88 |
| worst frame | 9.4 ms | 83.9 ms |

With `DC.liveScale` set to 0, live iframes by zoom: 0.05 → 10 of 10, 0.15 → 9,
0.3 → 6, 0.5 → 5, 0.8 → 2. Removing the zoom threshold without another bound
mounts the whole page at once.

**Decision:** remove the snapshots as asked, and replace the zoom threshold with
a *live budget* — at most `DC.liveBudget` iframes, the ones nearest the viewport
centre. Slots outside the budget show the existing striped placeholder.

### F2 — Writing `--dc-inv-zoom` every frame invalidates the whole tree

Per zoom frame, with a forced layout each time:

- transform only — **0.01 ms**
- transform + `--dc-inv-zoom` — **0.33–0.42 ms**
- transform + a custom property nothing reads — **0.23–0.33 ms**

About three quarters of the cost is Chrome invalidating style for the whole
subtree because an *inherited custom property* changed, not the four
layout-affecting consumers (`padding`, section `marginBottom`,
`.dc-header width`, `.dc-sectionhead zoom`). Neutralising all four moved
0.45 → 0.33 ms.

It scales with the tree: 0.42 ms at 10 slots, 0.65 at 20, 0.85 at 30, 1.09 at 40.
The trace shows 183–192 `Layout` events for 90 ticks — two per tick, from the
double `apply(true)` in `zoomAt`. In the baseline trace, `Layout` plus style
recalc is 105 ms of 242 ms main-thread busy: **43 % of the zoom's work**.

**Decision:** write the variable once the gesture settles, not every frame.
Making its consumers layout-free would recover only about a quarter of the cost.
The visible consequence is that headers and section gaps keep their old size for
`DC.settleMs` after a gesture ends, then snap to the right size.

### F3 — One state patch costs a whole frame

A single variant-chip click — one `patchSection` — takes **6.7 ms** to the next
frame against **2.0 ms** for an inert click: about 4.7 ms of React render plus
layout, at only 10 slots. Every drop, rename and arrow-side change pays it.
`DCArtboardFrame` is not memoised, and `DCSection` builds fresh callbacks and a
fresh `size` object for every slot on every render, so memoising alone would not
help.

**Decision:** make `patchSection`/`setFocus` stable, hoist the per-slot
callbacks into one stable `actions` object, memoise the `size` map, and wrap
`DCArtboardFrame` in `React.memo`. Add a `DC.renders` counter so the effect is
mechanically checkable.

### F4 — Dragging a card re-routes every arrow, every frame

`cfMeasure` costs **0.51 ms** per call at 10 slots / 12 flows. A 40-frame card
drag fires the `MutationObserver` 44 times and every one of them would schedule
a re-route (~1.1 per frame), each also arming a 240 ms follow-up measure. The
cost grows with slots × flows.

**Decision:** while a slot carries `.dc-dragging`, reuse the previous pass's
geometry, re-measure only the dragged slot, and re-route only the flows that
touch it. The drop clears the class, so the next pass is a full measure.

### F5 — The background grid (withdrawn)

Commits `c7e903c` and `5860a8d` landed during the profiling session and already
moved the grid out of the transformed world onto a viewport-anchored layer
driven by `background-position`/`background-size`. No work left.

### F6 — The hover shadow (withdrawn)

Toggling the hover shadow and 3 px lift on an 864 × 540 on-screen card measures
**8.3 ms** median per frame — identical to idle (8.3) and to a trivial opacity
toggle (8.3). No measurable cost. Leave it alone.

## Problems found while profiling

### P1 — Every arrow is missing right now

`canvas-page.jsx:299` finds the world with
`document.querySelector('.design-canvas > div')`. Since `c7e903c` the grid layer
is the first child of `.design-canvas`, so `CanvasFlows` measures the grid,
finds zero slots, and renders nothing. Verified in the DOM: the first child has
0 `[data-dc-slot]`, the world has 10, and `.dc-flows` is absent.

**Decision:** mark the world with `data-dc-world` in `design-canvas.jsx` and
query that hook, so the lookup cannot be captured by a new sibling again.

### P2 — The first-load fit is racy

The fit timer runs 60 ms after mount, but children only render once `ready`
flips (state fetch, else a 150 ms timeout). When the fetch is slow the row does
not exist yet, `maxW` is 0, the fit returns early, and the canvas opens at scale
1. Reproduced on one reload during profiling.

**Decision:** retry the fit until a row exists, with a deadline, and skip it once
the user has panned or zoomed.

## Out of scope

- Rewriting history to drop the 65 MB of trace JSON that commit `c7e903c`
  swept into the repo. Raised separately; it is the other session's commit.
- Any change to the focus overlay, variants, flow routing geometry or the
  arrow-handle drag behaviour.
