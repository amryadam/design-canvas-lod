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

**Added during implementation: the registry stops while the world moves.** A pan
or a pinch changes the ranking in each frame, and a drop removes a full iframe.
The first build measured every slot inside the gesture and dropped several of
them mid-pinch. The pass thus makes no decision while the canvas is in its
moving state, and `dcLodSchedule` runs it again when the world stops. The
registry is one module-level object shared by every canvas on the page, so the
freeze is document-wide, in the same way as the budget itself.

The moving state is module state (`dcMovingTimer`, `dcDragDepth`), not a DOM
class read back with `querySelector`. An early build read the class, and a
`.dc-moving` class left behind by a gesture that did not finish stopped the
registry for the life of the page (`fd0eaf0`).

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

**Correction (F2a).** Three of those consumers changed the box model — world
`padding`, section `marginBottom`, `.dc-sectionhead zoom` — so the settled write
moved every card in world space. `.dc-header width` did not: the header is
`position:absolute`, so it adds nothing to any ancestor height or intrinsic
width. Moving the write without moving the anchor correction in `zoomAt` left
nothing watching the moment the layout actually moved. Measured on the sample:
**0.00 px of error during the gesture, and 32.9 px when the variable settled.**
A slow mouse-wheel roll puts more than `DC.settleMs` between notches, so the
write lands between them and every notch gets its own step. That reads as a
drift through the whole gesture.

**Decision (F2b): the world's layout no longer reads the zoom at all.** The
three box-model consumers are now in world units — `72px` of world padding,
`80px` / `540px` section gaps, `40px` of notes padding — and `.dc-sectionhead`
has no `zoom`. Section heads and gaps scale with the pages, in the same way that
`d37bd15` put the flow label pills in world units. `--dc-inv-zoom` now feeds only
`.dc-header` (out of flow) and the SVG arrowheads and stroke widths, none of
which the world's flow can see.

This removes the defect by construction rather than by correcting it: a world
point below the pointer stays below the pointer because nothing can move it.
The settled write becomes harmless, so it keeps the per-frame saving, and
`zoomAt` needs no drift correction — which takes the zoom tick from three forced
layouts to one and drops the throttled `elementFromPoint` hit test. The
"183–192 `Layout` events for 90 ticks" above was that correction.

Verified with the transform held still and `--dc-inv-zoom` swung over its whole
range, 0.25 to 20: every slot, section and row moves **0.000 px**. Zooming at
the viewport centre is 0.000 px over 10 and over 30 notches. Guarded by *"the
world layout does not read the zoom"* in `tests/regressions.js`, which names the
offending box if a zoom-dependent layout rule comes back.

Frame cost is unchanged. With the live budget at zero, so no iframe mount can
land inside the measurement, five runs each: median 6.9 ms both ways, p90
7.0–7.4 against 7.2–7.6, and no frame over 16 ms against one in five. The
34–62 ms frames seen while investigating this were the raster cost of the eight
live iframes (F1), not the zoom path.

**Correction (F2c): the section head keeps its screen size, by transform.**
Dropping `zoom` outright made section titles scale with the world, so they were
1.7 px tall at 5 % zoom and 132 px at 4x — unreadable when zoomed out, and the
first thing reported after F2b shipped. Measured against the previous build,
which held them at 33 px at every zoom.

`.dc-sectionhead` now carries `transform: scale(min(var(--dc-inv-zoom,1),4))`
with `transform-origin: bottom left`, the same rule and the same clamp as
`.dc-header`. A transform never reflows, so the head keeps a fixed world box and
F2b's guarantee is untouched — the layout still moves 0.000 px across the whole
range of the variable. The origin is the bottom edge, so the head grows upwards
into the section gap and a title never covers its own cards. Titles now measure
33 px from 0.25x up to 4x, and shrink with the world below that, which is what
the clamp is for: heads must not balloon over the neighbouring cards.

**The remaining cost of F2b is visual.** Section gaps are in world units now, so
at 5 % zoom the 80 px gap is 4 px on screen and sections read as one block when
zoomed far out. That is the same trade `d37bd15` accepted for the flow label
pills: they read as part of the map rather than as chrome.

**Not caused by F2b.** A whole-canvas flash was also reported. It could not be
reproduced in automation, and the level-of-detail behaviour is identical between
the two builds — `liveByZoom` gives 8/8/8/5/3 at 0.05/0.15/0.3/0.5/0.8 either
way, with no idle mount or drop churn at any zoom and no
`contentvisibilityautostatechange` events through a zoom cycle. The live iframes
re-rastering as the world scales (F1) remains the most likely source, and it
predates all of this work.

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

**Decision (withdrawn on measurement):** the plan was to reuse the previous
pass's geometry while a slot carries `.dc-dragging`, and to re-route only the
flows that touch it.

**Correction, 2026-09-08.** The 1.1 re-routes per frame above were inferred
from the MutationObserver batch count. They were never measured. Measured
directly, a 40-frame drag fires 44 observer batches but makes only **2
`cfMeasure` calls**, and costs 4 ms in total. `schedule()` cancels the pending
`requestAnimationFrame` and pushes the 240 ms timer on each mutation. A
continuous drag thus coalesces to one measure when it stops, and one after the
drop. The existing debounce already does the work of the fast path, so Task 6
is withdrawn and `canvas-page.jsx` keeps its current routing.

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
