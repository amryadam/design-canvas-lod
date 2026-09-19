# React Flow spike — report

**Date:** 2026-09-19
**Spec:** `2026-09-19-react-flow-canvas-design.md` (Phase 0 — the spike gate)
**Plan:** `../plans/2026-09-19-react-flow-spike.md`
**Spike code:** branch `spike/react-flow`, commit `f5778f5`, worktree
`design-canvas-lod-wt/spike-react-flow`. It is throwaway and is never merged.

## Summary

- **The spike passes, with one condition.** React Flow must hide the live
  iframes while a pan or a zoom runs (`freeze`), and must NOT put
  `will-change: transform` on its viewport. In that form it has no tall-page
  blank, it passes the frame-time rule in every run of the sample-page bench,
  and it does about 40% less main-thread work than the old engine on the
  tall page.
- React Flow as it ships, with 8 live iframes visible during a zoom, is
  slower than the old engine: a small gap on the sample page, 2.6–2.8 × the
  work on the tall page. The cause is the live iframes, which Chrome rasters
  again at each zoom step. It is not React Flow's own rendering.
- `will-change: transform` on the React Flow viewport gives the old engine's
  speed and brings a blank back: 91% of the arrows are gone after a zoom-in
  and zoom-out, and they are still gone 5 s later.
- The old engine's tall-page blank is reproduced on this machine for the
  first time outside claude.ai/design, by a zoom-in and then a zoom-out.
- `freeze` changes the look: live screens show their placeholder during a
  gesture and come back when it ends. The user must judge that.

## Conditions

| Item | Value |
|---|---|
| Machine | Apple M4 Pro, macOS 27.0, display at 144 Hz |
| Browser | Google Chrome 153.0.8010.48, headful, GPU on |
| Viewport | 1280 × 800 CSS px, DPR 2 (emulated) |
| Old engine | `main` at `1d842b6`, not changed |
| Spike | React 18.3.1, `@xyflow/react` 12.11.6, built-in bezier edges, budget of 8 live iframes, `onlyRenderVisibleElements` off |
| Validity guard | `visibilityState = visible` and an idle `requestAnimationFrame` rate over 50 fps (measured: 144–146). The sample-page bench and the ablation check before and after each engine's gestures; the final tall-page check (`wc-check.mjs`) checks before and after each variant; the first tall-page check (`tall-check.mjs`) checks once at the start |

At 144 Hz a frame is 6.9 ms. A dropped frame shows as ~13.9 ms. No run had a
frame over 16.7 ms in the sample-page bench, so a 60 Hz display would show
none of the sample-page differences below.

## Frame times — the sample page

11 screens (the old engine folds one variant, so it has 10 slots), 12 flows,
8 live iframes in both engines at the start. Zoom: 90 `ctrl+wheel` ticks, one
for each frame, 45 in and 45 out, each tick a factor of e^0.06 (fit scale
0.053 → 0.79 → 0.053). Pan: 60 frames at scale 1, 40 screen px for each
frame. The script calibrates the two engines to equal gestures and refuses to
write a result if they are not equal (fit scale, scale after the zoom-in, pan
travel, pan scale: all agreed within 3%). Each number is the median of 3
runs. `dropped` = frames longer than 1.5 × that run's p50.

Source: `spike/out/frames.json`, `spike/out/frames-reversed.json`.

| Order | Gesture | Engine | p50 | p95 | max | dropped | busyMs |
|---|---|---|---|---|---|---|---|
| old, new | zoom | old | 6.9 | 8.5 | 14 | 1 of 88 | 135.7 |
| old, new | zoom | new | 6.9 | 13.8 | 14.2 | 6 of 88 | 184.4 |
| old, new | pan | old | 6.9 | 8.5 | 8.6 | 0 of 58 | 53.1 |
| old, new | pan | new | 6.9 | 7.8 | 8.6 | 0 of 58 | 43.6 |
| new, old | zoom | old | 6.9 | 7.5 | 13.9 | 1 of 88 | 146.2 |
| new, old | zoom | new | 6.9 | 8.4 | 14.1 | 3 of 88 | 158.5 |
| new, old | pan | old | 6.9 | 8.2 | 8.5 | 0 of 58 | 40.4 |
| new, old | pan | new | 6.9 | 8.1 | 8.4 | 0 of 58 | 48.6 |

Verdicts by the approved rule (spike p95 ≤ 1.10 × old and spike max ≤ 1.10 ×
old): **PAN PASS** in both orders. **ZOOM FAIL** on p95 in both orders (ratio
1.62 and 1.12); `max` passes in both orders (1.01). The 1.12 margin is inside
this bench's ~10% noise, so only the 1.62 result is firm. A third pair of
plain runs (next table) gave one FAIL and one PASS.

The engine order changes the size of the zoom gap a lot. With 88 frames the
p95 is the fifth-worst frame, so p95 is bimodal here: ~8 ms or ~13.8 ms. The
`dropped` count and `busyMs` are the steadier signals: the spike drops 3–6
frames where the old engine drops 1, and does 8–36% more main-thread work.

### The same bench with the spike page flags

All six runs come from one session. `freeze=1` hides the live iframes between
React Flow's `onMoveStart` and `onMoveEnd` (they stay mounted, so they do not
load again). `livewc=1` puts `will-change: transform` on each live iframe
only. The bench checked that `freeze` engaged under synthetic wheel events: 8
of 8 iframes hidden at the middle tick, 0 hidden 1.5 s after the gesture.
Source: `spike/out/frames-plain-again*.json`, `frames-freeze-1*.json`,
`frames-livewc-1*.json`.

| Spike flags | Order | zoom p95 old / new (ratio) | zoom max old / new (ratio) | dropped old / new | zoom busyMs old / new (ratio) | ZOOM | PAN |
|---|---|---|---|---|---|---|---|
| none | old, new | 7.4 / 8.8 (1.19) | 8.5 / 14.5 (1.71) | 0 / 4 | 131.0 / 181.2 (1.38) | FAIL | PASS |
| none | new, old | 8.3 / 7.7 (0.93) | 14.0 / 13.9 (0.99) | 2 / 4 | 155.2 / 163.9 (1.06) | PASS | PASS |
| `freeze=1` | old, new | 7.6 / 7.2 (0.95) | 8.6 / 8.4 (0.98) | 0 / 0 | 129.8 / 83.3 (0.64) | PASS | PASS |
| `freeze=1` | new, old | 7.9 / 8.2 (1.04) | 13.9 / 8.7 (0.63) | 1 / 0 | 153.7 / 143.3 (0.93) | PASS | PASS |
| `livewc=1` | old, new | 7.7 / 7.9 (1.03) | 13.8 / 8.6 (0.62) | 1 / 0 | 136.0 / 109.5 (0.81) | PASS | PASS |
| `livewc=1` | new, old | 8.0 / 8.2 (1.03) | 13.9 / 8.8 (0.63) | 2 / 0 | 151.1 / 155.8 (1.03) | PASS | PASS |

The plain spike fails the zoom rule in 3 of its 4 runs. With either flag it
passes in all runs and drops no frame. Two runs for each flag is a small
sample.

## Where the zoom cost comes from — the ablation

URL flags on the spike page switch one suspect off at a time. Sample page,
zoom gesture as above, median of 5 runs, the old engine measured at the start
and the end of the run. Source: `spike/out/ablate.json` (the second of two
full runs; the first gave the same picture and is recorded in prose only).

| Variant | p95 | dropped | busyMs |
|---|---|---|---|
| old engine, start | 7.5 | 0 | 121.7 |
| old engine, end | 7.9 | 0 | 134.7 |
| spike, as it is | 13.8 | 5 | 186.9 |
| spike, as it is, again | 13.9 | 7 | 201.1 |
| spike, no live iframes | 7.7 | 0 | 71.9 |
| spike, `will-change: transform` on the viewport | 8.1 | 0 | 155.5 |
| spike, background + edges + handles + shadow + `content-visibility` + iframes off | 8.3 | 0 | 48.8 |

Only two flags moved both p95 and `busyMs` clear of the noise (~10%, from the
old engine's own start/end spread): no live iframes, and `will-change` on the
viewport. The background, the edge labels, the 8 handles, the box shadow,
`content-visibility` and `contain-intrinsic-size` made no consistent
difference. `contain: layout paint` was 16% worse on `busyMs`; `off-labels`
landed on the fast p95 mode in one run. Two runs cannot separate those from
the bimodal p95.

Reading: without a promoted world layer, Chrome rasters the viewport's
content again at each zoom step, and that includes the 8 live iframes. The
old engine's world is a GPU layer, so a zoom only scales a texture. This is
an inference from the ablation; no trace was taken to confirm it.

## Tall page

A synthetic page of 50 screens, 12,200 × 16,200 world px: the size of the
real page that blanks in claude.ai/design. Both engines render it from the
same data, but not to the same picture: the old engine's placeholders are
near the background colour.

### Static zoom steps

At 8 zoom steps from 0.1 to 4 the script puts the bottom-right screen in the
middle of the viewport, reads the view back, and measures the fraction of
non-background pixels in the screen's rect. Source: `spike/out/tall.json`.

| Zoom | 0.1 | 0.25 | 0.5 | 1 | 1.5 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|---|
| old | 0.845 | 0.874 | 0.875 | 0.976 | 0.982 | 0.986 | 0.992 | 0.994 |
| new | 0.938 | 0.928 | 0.964 | 0.976 | 0.982 | 0.987 | 0.992 | 0.994 |

Both engines draw the screen at every step. A static view does **not**
reproduce the blank on this machine, and neither does a plain 60-tick
zoom-in.

### Zoom in, then zoom out

Fit → zoom in to scale 3.54 (one tick for each frame) → zoom out the same
ticks → wait 1 s → screenshot → wait 5 s more → screenshot. The old engine's
own code comment names this sequence as the trigger: a promoted layer keeps
the raster scale it had when zoomed in. Three runs; the table gives the
median. Source: `spike/out/wc-check-r1.json`, `-r2`, `-r3`.

Metrics: `missing` / `partial` = cards whose frame is gone / partly gone
against the picture before the gesture (of 50). `edgesVsBase` = how much of
the arrows between the cards is still drawn (1 = all). `diffVsBase` = the
fraction of all pixels that differ from the picture before the gesture.
`busy vs old` = main-thread work for the whole gesture against the old
engine in the same run.

| Variant | zoom-in p95 | dropped in | busyMs | busy vs old | missing | partial | edgesVsBase | diffVsBase | at 1 s | at 5 s |
|---|---|---|---|---|---|---|---|---|---|---|
| old engine (control) | 7.5 | 0 | 275.5 | – | 6 | 10 | 1.00 | 0.0019 | BLANK | BLANK |
| React Flow, plain | 20.9 | 27 | 754.1 | 2.79 | 0 | 0 | 1 | 0 | OK | OK |
| React Flow, `will-change` on the viewport | 8.2 | 1 | 287.8 | 1.04 | 0 | 2 | 0.09 | 0.0058 | BLANK | BLANK |
| React Flow, no live iframes | 7.1 | 0 | 150.7 | 0.54 | 0 | 0 | 1 | 0 | OK | OK |
| React Flow, `livewc=1` | 8.1 | 1 | 238.4 | 0.86 | 0 | 0 | 1 | 0.0017 | OK | OK |
| React Flow, `freeze=1` | 7.9 | 0 | 168.3 | 0.62 | 0 | 0 | 1 | 0 | OK | OK |

The 1.10 rule on the zoom-in leg, run by run (p95 ratio / max ratio):

| Variant | run 1 | run 2 | run 3 |
|---|---|---|---|
| plain | 2.79 / 2.67 FAIL | 2.61 / 2.22 FAIL | 2.79 / 2.62 FAIL |
| `will-change` on the viewport | 1.09 / 1.60 FAIL | 1.03 / 1.46 FAIL | 1.13 / 1.60 FAIL |
| no live iframes | 0.95 / 0.95 PASS | 0.93 / 0.87 PASS | 0.95 / 1.02 PASS |
| `livewc=1` | 0.95 / 1.64 FAIL | 1.08 / 1.31 FAIL | 1.08 / 1.56 FAIL |
| `freeze=1` | 1.05 / 1.02 PASS | 0.91 / 0.87 PASS | 1.13 / 0.99 FAIL |

`livewc=1` fails on `max`: one long frame in each run. `freeze=1` is at the
line on p95 (0.91 – 1.13) and well under the old engine on work.

The pictures, cropped at full resolution from the bottom two rows of the
page (a downscaled full view hides the damage). The two old-engine crops come
from the earlier `tall-check.mjs` run; the React Flow crops come from the
first `wc-check.mjs` run. The three later runs gave the same pictures.

- Old engine, before: `assets/2026-09-19-spike-old-before.png` — 10 complete
  cards.
- Old engine, after: `assets/2026-09-19-spike-old-after.png` — row 9 is cut
  off part-way in a staircase that follows the raster-tile edges; row 10 is
  gone, headers and bodies; the arrows remain. This matches the symptom
  reported from claude.ai/design. The production case itself, inside a
  sandbox iframe, is not measured here.
- React Flow plain, after: `assets/2026-09-19-spike-rf-plain-after.png` —
  complete, the same as before the gesture.
- React Flow + `will-change` on the viewport, before and after:
  `assets/2026-09-19-spike-rf-wc-before.png`,
  `assets/2026-09-19-spike-rf-wc-after.png` — the bottom-right card keeps a
  thin strip and loses its body; the bottom-left card has a notch; every
  arrow is gone; the text is soft. The picture 5 s later is the same, so
  this is lasting damage, not a texture that waits for a re-raster. The
  damage differs from the old engine's: the old engine loses rows of cards
  and keeps its arrows; React Flow keeps its cards and loses its arrows. No
  root cause was established for either.

One automated reading was wrong and is corrected here. The first check
compared one pixel fraction over the whole content, and a reviewer read the
old engine's loss as "live iframes went back to placeholders". The
full-resolution crops show cards cut at tile edges and cards with no frame at
all, which a placeholder cannot produce. The per-card, arrow and whole-view
metrics were added for that reason. The per-card metric alone under-reports
the `will-change` damage (2 cards); `edgesVsBase` and the crops show it.

## Text sharpness

Crops at zoom 0.73 and 1.37 (`spike/out/sharp-*.png`): the text in React
Flow without `will-change` is as sharp as in the old engine. React Flow issue
#3282 did not show. The two engines' crops show different screens, so this
compares the rendering, not identical text.

## Limits of the spike

- 11 nodes against the old engine's 10 slots: the spike does not fold
  variants.
- The spike's budget has no hysteresis, no touch mark and no mount gap.
- Wheel events are synthetic (dispatched in the page, one for each frame),
  the same way for both engines. A real pinch was not measured.
- The tall page is synthetic, with a budget of 8. Other densities were not
  measured.
- `freeze` was measured for cost and for the blank, not for how it looks or
  feels. With a real pinch, `onMoveStart` and `onMoveEnd` timing can differ.
- Small samples: two runs for each flag on the sample page, three on the
  tall page. p95 over 88 frames is the fifth-worst frame and is bimodal
  (~8 ms or ~13.8 ms), so `dropped` and `busyMs` are the steadier signals.
- One transient failure in each of three scripts on a first run (a driver
  not yet injected, a fit against a not-yet-stable layout, one off-screen
  rect). None came back. The bench now waits for a stable layout and refuses
  unequal gestures; the tall checks read each view back.
- One machine, one GPU (Apple M4 Pro). The production blank was reported in
  claude.ai/design, inside a sandbox iframe, where the numbers can differ.

## Recommendation

**Recommendation: GO, on one condition, and subject to the user's check.**

By the approved rule: the tall page has no blank (static steps, and the
harder in-out gesture), the control reproduced the blank, and zoom and pan
pass on the sample page — but only with `freeze=1` (4 of 4 runs) or
`livewc=1` (4 of 4 runs). The plain spike fails zoom in 3 of 4 runs. On the
tall page `freeze=1` passes 2 of 3 runs at the 1.10 line and does 0.62 × the
old engine's work; `livewc=1` fails there on one long frame in each run.

Thus the condition, which becomes a requirement of the phase 1 spec:

1. The live iframes are hidden while a pan or a zoom runs, and stay mounted
   (`freeze`). `liveBudget.js` already must not mount or drop during a
   gesture; this adds "and not painted during one".
2. No `will-change: transform` on the React Flow viewport, ever. It brings a
   blank back.

What the user must judge in the check (Task 6 of the plan), because no
number here can:

- Is it acceptable that live screens show their placeholder during a pan or
  a zoom and come back when it ends? The old engine keeps them visible. If
  it is not acceptable, `livewc=1` keeps them visible and passed the
  sample-page bench, but it is not proven on the tall page.
- Does the real "Users and roles" page stay drawn after a zoom-in and
  zoom-out in claude.ai/design? Open `spike.html?page=<id>&freeze=1`.

What the spike changes in the design spec, if GO: the ranking "the live
iframes stay the largest cost, and no library changes that" holds, and the
answer is `freeze`, not a GPU layer for the world. The fallback plan
(`../plans/2026-09-09-canvas-layer-limit.md`) stays valid for the old engine
if the answer is NO-GO. In both cases `spike/wc-check.mjs` is worth keeping
as a regression check: it is the first check that reproduces the blank
outside claude.ai/design.
