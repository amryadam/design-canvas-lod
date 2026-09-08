# Level-of-detail ranking — design

**Date:** 2026-09-08
**Status:** approved, ready to implement
**Plan:** `docs/superpowers/plans/2026-09-08-lod-ranking.md`
**Follows:** `docs/superpowers/specs/2026-09-08-canvas-performance-design.md`

## Why

The user asked how other open-source projects solve the canvas preview problem.
The source of the four largest projects was read. The comparison found one real
gap in our registry and one cheap behaviour improvement. This document records
what was found and what we decided to do about it.

## What the other projects do

| Project | Stars | Off-screen | Count budget | Eviction | Interaction |
|---|---|---|---|---|---|
| tldraw | 50k | `display:none` | no | no | iframe live only while editing |
| Excalidraw | 131k | not rendered | no | **no** | `activeEmbeddable` hover/active |
| AFFiNE | 72k | — | no | no | user switches card ↔ iframe |
| Onlook | 26k | — | no | no | all frames live |
| crs48/xNet | 7 | tiered | **yes** | yes | — |
| **ours** | — | placeholder | **yes** | yes | `.dc-shield` |

Three points came out of the reading.

### C1 — Nobody large bounds the live count

Excalidraw is the clearest case. `renderEmbeddables()` in
`packages/excalidraw/components/App.tsx:1779` reads:

```js
const isVisible = isElementInViewport(el, w, h, this.state, map);
const hasBeenInitialized = this.initializedEmbeds.has(el.id);
if (isVisible && !hasBeenInitialized) this.initializedEmbeds.add(el.id);
const shouldRender = isVisible || hasBeenInitialized;
```

An embed mounts when it first enters the viewport and then never unmounts.
`initializedEmbeds` only grows. tldraw culls with `display:none` but keeps the
iframe. Neither carries a cap.

Their content is light — a YouTube embed, a bookmark card. Ours is a full page
document. F1 in the performance design measured what that costs: 10 live
iframes took the main thread from 32 % busy to 71 % busy through one pinch.

**Decision:** keep our budget. No change.

### C2 — The pass measures every slot from the DOM

`dcLodRun` calls `getBoundingClientRect()` on every subscribed slot in each
pass, and the pass also runs on a 500 ms poll for the life of the page. tldraw
keeps a spatial index in world coordinates and reads no DOM to decide.

A slot's box **inside the world** does not change when the world pans or zooms.
The world element carries `transformOrigin: '0 0'`, and since the F2a
correction no reader of `--dc-inv-zoom` reflows the world. `.dc-sectionhead`
reads the variable, and it reads it through a `transform`, which never reflows.
The flow layer in `canvas-page.jsx` reads it as well, inside an absolute
overlay of zero box, so its own layout moves nothing. The world layout is
therefore the same at every zoom. A slot's world box is thus stable, and it
only has to be measured again when the DOM moves it.

This is the single point of failure of the design, so one check guards it:
"the world layout does not read the zoom" in `tests/regressions.js` swings the
variable over its whole range and compares all four edges of every world box.
The four edges matter. A held box carries a size as well as an origin, and
`near` and `visible` both read the far edges.

**Decision:** cache each slot's world box, and rank from arithmetic. One rect
read of the world element per pass replaces N rect reads of slots.

The size of the win is not yet known, so the plan measures it first and records
the result. The rect count is the structural number and it is exact; the
millisecond number is indicative, because a pass over a clean layout is cheap
whatever it reads.

### C3 — A slot you just touched can drop

`crs48/xNet`'s `dom-island-pool.ts` keeps a `RECENT_INTERACTION_WINDOW_MS` of
4000 in its ranking. We have no equivalent. Drag a card to the edge of the view
and it can leave the budget while you are still working on it.

**Decision:** a slot that had a pointer down or a pointer up in the last
`DC.stickyMs` sorts first. It wins the budget, not the margin: a slot more than
`DC.unmountMargin` px away still drops. The pointer up matters as much as the
pointer down. No pass runs while a drag holds the registry moving, so the mark
is first read at the drop, and a drag longer than `DC.stickyMs` would reach
that moment with a stale mark.

## Measured outcome

`dcBench.lodPassCost()` on the sample: `slotRectsPerPass` went from 10 before
this work to 0 after. That is the number the change was made for, and it is
exact. The instrument now reports `rankedPasses` beside it, and the last run
gives `{"slots":10,"passes":40,"rankedPasses":40,"msPerPass":0,
"slotRectsPerPass":0}`. All 40 passes reached the ranking loop, so the zero is
a pass that read no slot rect and not a pass that never ran.

`msPerPass` is not measurable with the tools used. The workspace harness ran
Chrome with `--virtual-time-budget`, which distorts `performance.now`, and it
reads 0. Do not read this as an improvement. The millisecond cost of a pass
was never measured.

This branch added 7 tests. The suite is 34 under `node tests/run.mjs`, and all
pass. The count at the branch point was 14, and the merge from main brought the
other 13.

### Corrections

1. The plan's original claim that a headless run had "one known pre-existing
   failure" was wrong. Both failures came from the virtual-time harness built
   for this work. Under main's real-time runner (`tests/run.mjs`), both pass.
2. An interim conclusion that this work had introduced a flake in `live
   iframes stay inside the budget` was wrong. That test fails 4 of 6 runs on
   pristine pre-change code. The cause is the first-load fit's animation
   frame not being delivered under virtual time.
3. This plan and another session rewrote `dcLodRun` at the same time. The
   designs combined: main's viewport-box ranking and visible-first sort were
   kept, with the slot rect sourced from the held box.
4. The first cut of the held boxes invalidated on five events, and a section
   state patch was not one of them. A size chip changes a card's width inside a
   flex row, and every sibling to its right moves. The world keeps its own
   border box while that happens, so its `ResizeObserver` does not fire, and no
   pan or zoom puts the generation up. The error thus held for the rest of the
   session. `patchSection` now invalidates, which covers every action that
   writes section state.
5. The C2 text above first said that `.dc-header` reads `--dc-inv-zoom`, and
   that `position: absolute` is what makes it safe. Neither half was true. The
   reader is `.dc-sectionhead`, and the `transform` is what makes it safe.

## Not doing

**Stepped distance bands.** tldraw steps its zoom-derived scale up to the next
power of two, so an image does not thrash between sizes. That is the right tool
for a continuous quantity that feeds a discrete request. Our ranking is not that
shape: stepping the distance makes slots tie, and a tie needs its own stable
order. `DC.budgetHysteresis` already holds the last place stable, and F1
measured it doing so. Adding bands on top would be two mechanisms for one job.

**Catching a click inside a live iframe.** A `pointerdown` in an iframe does not
reach the parent document, so C3 cannot see it. A `window.blur` plus an
`activeElement` test would find it. It is not worth the complexity: a live slot
is live already, and the case C3 protects is a slot you drag, rename or open the
⋯ menu on, all of which are parent-document events.

## Out of scope

- Any change to the budget, the margins, the mount gap or the settle time.
- Any change to the focus overlay, the export path, variants or flow routing.
- Multiple canvases in one document. The registry is already one module-level
  object with one camera, and this work does not change that.
