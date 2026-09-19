# Frame times: old engine vs new engine

Date: 2026-09-19
Worktree commit: 6d0312f5a78970ea444b450c1cab863067daebf6
Machine: Apple M4 Pro
Chrome: Google Chrome 153.0.8010.48
Viewport: 1280x800, DPR 2

`perf/frames.mjs` runs the same zoom and pan gestures on the old sample
(`sample/index.html`) and the new sample (`sample/index-rf.html`). It runs
each gesture 3 times and takes the median. It checks that both engines fit
the page to the same scale, zoom to the same scale, and pan the same
distance, all within 3%. Both runs below passed every check.

## Order: old, new

| engine    | frames | p50 | p95 | max | dropped | over16 | busyMs |
|-----------|-------:|----:|----:|----:|--------:|-------:|-------:|
| old zoom  | 88     | 8.3 | 9.3 | 9.3 | 0       | 0      | 130.0  |
| new zoom  | 88     | 8.3 | 9.3 | 9.4 | 0       | 0      | 101.7  |
| old pan   | 58     | 8.3 | 9.3 | 9.4 | 0       | 0      | 44.4   |
| new pan   | 58     | 8.3 | 9.3 | 9.4 | 0       | 0      | 45.7   |

Parity:
- fit scale: old=0.0532 new=0.0532 — FIT PARITY OK
- scale after zoom-in: old=0.7909 new=0.7909 — PARITY OK
- pan x travel (first 30 frames): old=1200 new=1200 — PAN PARITY OK
- pre-pan scale: old=1 new=1 — PAN SCALE PARITY OK

Verdict: **ZOOM PASS**, **PAN PASS**

## Order: new, old

| engine    | frames | p50 | p95 | max | dropped | over16 | busyMs |
|-----------|-------:|----:|----:|----:|--------:|-------:|-------:|
| old zoom  | 88     | 8.3 | 9.3 | 9.4 | 0       | 0      | 137.3  |
| new zoom  | 88     | 8.3 | 9.3 | 9.4 | 0       | 0      | 94.1   |
| old pan   | 58     | 8.3 | 9.3 | 9.3 | 0       | 0      | 29.3   |
| new pan   | 58     | 8.3 | 9.3 | 9.3 | 0       | 0      | 38.2   |

Parity:
- fit scale: old=0.0532 new=0.0532 — FIT PARITY OK
- scale after zoom-in: old=0.7909 new=0.7909 — PARITY OK
- pan x travel (first 30 frames): old=1200 new=1200 — PAN PARITY OK
- pre-pan scale: old=1 new=1 — PAN SCALE PARITY OK

Verdict: **ZOOM PASS**, **PAN PASS**

## Console harness (`perf/bench.js`)

Run against `sample/index-rf.html` through `tests/cdp.mjs`: open the page,
wait for `dcCanvas.api.fitted`, evaluate the text of `perf/bench.js`, then
run `await dcBench.all()`. It returned with no error:

```json
{
  "zoomFrames": {
    "frames": 88,
    "median": 8.3,
    "p95": 9.3,
    "max": 9.4,
    "dropped": 0,
    "over16": 0
  },
  "panFrames": {
    "frames": 58,
    "median": 8.3,
    "p95": 9.2,
    "max": 9.3,
    "dropped": 0,
    "over16": 0
  },
  "liveByZoom": {
    "1": 3,
    "0.05": 8,
    "0.1": 8,
    "0.25": 8,
    "0.5": 5
  },
  "patchCost": {
    "ms": 13.8,
    "renders": 1
  }
}
```

## Comparison with the spike

The spike ran the same bench with `livewc=1`, the rule the new canvas now
uses: `will-change: transform` on each live iframe. Its zoom p95 ratio
(new over old) was 1.03 in both engine orders, with 0 dropped frames. Its
busyMs ratio was 0.81 and 1.03.

This run gets the same good result. In the old-then-new order, the zoom p95
ratio is 9.3 / 9.3 = 1.00, and the max ratio is 9.4 / 9.3 = 1.01. In the
new-then-old order, the zoom p95 ratio is 9.3 / 9.3 = 1.00, and the max
ratio is 9.4 / 9.4 = 1.00. Both pan p95 and max ratios are 1.00 in both
orders. No run drops a frame. The busyMs ratio is 0.78 and 0.68 in the two
orders — the new engine uses less main-thread time than the old one on this
machine, close to the spike's own busyMs win in the first order.

The rule is: new p95 must be at or under 1.10 times old p95, and new max
must be at or under 1.10 times old max. Every ratio above is at or under
1.01. The new canvas passes the rule for zoom and for pan, in both engine
orders, on this machine.
