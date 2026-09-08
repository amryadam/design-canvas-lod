# Canvas Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the zoomed-out snapshot pictures and land the measured performance fixes plus the arrow regression, so a pinch-zoom over a full page drops no frames. Tasks 6 and 7 were withdrawn during the work; three fixes and the arrow regression landed.

**Architecture:** Local changes to two files. The level-of-detail system stops choosing between a picture and an iframe and instead bounds how many iframes are live at once. The zoom-compensation custom property moves off the per-frame path. React state patches stop re-rendering every artboard frame. Two bugs found while profiling are fixed alongside. Flow re-routing was to get a drag fast path; measurement showed the existing debounce already does that work, so Task 6 is withdrawn and `canvas-page.jsx` is unchanged.

**Tech Stack:** Plain React 18 UMD + Babel standalone, no build step, no package manager, no test runner. Files are served statically and transpiled in the browser. Verification is browser-driven measurement through `perf/bench.js`.

**Spec:** `docs/superpowers/specs/2026-09-08-canvas-performance-design.md`

## Global Constraints

- **No build step exists.** No `package.json`, no bundler, no CLI test runner. Do not add one. Both `.jsx` files are loaded as `<script type="text/babel">` and must stay valid standalone scripts whose top-level `function` declarations land on `window`.
- **There IS a regression suite, and it must stay green.** `tests/regressions.html` runs 11 checks in the browser against real React lifecycles, connector DOM updates, persistence races and snapshot pixels. With the server running, open `http://localhost:8000/tests/regressions.html`; the page title reads `PASS: canvas regressions` or `FAIL: canvas regressions` and `window.canvasTestResults` holds the per-check detail. **Every task must leave it at 11/11 PASS** — run it before you commit, not only at the end.
- **Another session is committing to this repo concurrently.** Three commits landed during profiling (`c7e903c`, `31cfbe0`, `5860a8d`). Before editing either `.jsx` file, run `git log --oneline -3` and re-read the region you are about to change — line numbers in this plan are from `5860a8d` and may have moved. Never `git add -A`; stage only the files you touched.
- **Branch base.** This plan runs on `feature/canvas-performance`, cut from `main` after the `dev` merge (`7276996`). That merge brought revision-based persistence, a restoration-gated first fit, a connector signature change and the regression suite. The earlier `.perf-traces` trace files are gone — the parallel session rebuilt history and dropped them; there is nothing left to clean up.
- **Every measurement runs against the sample** with `python3 -m http.server 8000` from the repo root and `http://localhost:8000/sample/` open. Numbers in acceptance criteria came from a 1066 × 666 viewport, DPR 3, ~144 Hz display, no CPU throttling. On different hardware, compare against the Task 2 baseline captured on *that* machine, not against the absolute numbers here.
- **`dcInlineDoc`, `dcFontCss`, `dcBlobToDataUrl` and `dcExportArtboard` must keep working.** Download PNG and Download HTML in the kebab menu are staying.
- **Keep the house comment style.** Comments explain why, in ASD-STE100 Simplified Technical English, above the block they describe. Match the density of the surrounding code.
- **Commit messages:** max 50-character imperative subject, no trailing period, body only when the subject leaves a reader asking "why", no attribution lines.

**User decisions (already made):**
- "i need to remove the picture funtion when zoom out" — the snapshot system goes.
- Zoomed-out behaviour: **"Always live iframes"** — no snapshot, no zoom threshold. The live budget in Task 4 is the bound that keeps this affordable; it was presented as the replacement for the threshold and approved as part of "add all 6 to the plan".
- PNG/HTML export: **"Keep the export"** — `dcExportArtboard` and the shared inliner stay.
- "profile it first all 6" — every acceptance criterion below is a measured number, not a judgement call.
- "add all 6 to the plan and write it" — all six items of the revised order are in scope; the two withdrawn findings (grid, hover shadow) are not.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `perf/bench.js` | **New.** Measurement harness. Defines `window.dcBench` with one method per measured claim. Never loaded by the app; pasted into the page. | 2 |
| `design-canvas.jsx` | The canvas: LOD registry, viewport transform, sections, artboard frames, export. Carries five of the six changes. | 1, 3, 4, 5, 7 |
| `canvas-page.jsx` | Page layout and `CanvasFlows` arrow routing. Carries the world lookup fix. The Task 6 drag fast path was withdrawn, so nothing else changed here. | 1 |
| `README.md` | Drops the "How snapshots work" section and the LOD sentence. | 4 |
| `docs/superpowers/plans/2026-09-08-canvas-performance.md.tasks.json` | Task state for resume. | — |

---

### Task 1: Fix the CanvasFlows world lookup — DONE (landed in `7276996`)

> Completed while merging `dev` into `main`. `dev`'s regression suite failed
> three checks on the merged tree for exactly this reason — the grid layer had
> taken first place under `.design-canvas`, so both `canvas-page.jsx` and the
> test at `tests/regressions.js:81` were reading the grid instead of the world.
> The world now carries `data-dc-world` and both lookups use it. Verified:
> 11/11 PASS, and the sample shows 24 paths and 12 labels, the value this task
> predicted. No further work.

**Goal:** Arrows render again by finding the transformed world through a stable hook instead of by sibling position.

**Files:**
- Modify: `design-canvas.jsx:643` (the `worldRef` div in `DCViewport`)
- Modify: `canvas-page.jsx:299` (the world lookup in `CanvasFlows`)

**Acceptance Criteria:**
- [ ] `document.querySelectorAll('.dc-flows svg path').length` is greater than 0 on the sample
- [ ] `document.querySelector('[data-dc-world]')` returns the element carrying the `scale(...)` transform, not the grid layer
- [ ] Arrow labels are visible on the sample and follow their pages when a page is dragged
- [ ] Hovering an arrow still shows the two round drag handles

**Verify:** With the sample open, run in the page console:
`({paths: document.querySelectorAll('.dc-flows svg path').length, world: !!document.querySelector('[data-dc-world]'), slotsInWorld: document.querySelector('[data-dc-world]').querySelectorAll('[data-dc-slot]').length})`
→ expected `{paths: 24, world: true, slotsInWorld: 10}` (each flow draws a visible path plus a transparent hit path, so 12 flows give 24)

**Steps:**

- [ ] **Step 1: Start the server and confirm the bug**

```bash
cd /Users/amryadam/Github/design-canvas-lod
python3 -m http.server 8000 &
```

Open `http://localhost:8000/sample/` and run in the console:

```js
({
  firstChildSlots: document.querySelector('.design-canvas > div').querySelectorAll('[data-dc-slot]').length,
  flowsLayer: !!document.querySelector('.dc-flows'),
})
```

Expected before the fix: `{firstChildSlots: 0, flowsLayer: false}` — the first child is the grid, so `CanvasFlows` measures nothing.

- [ ] **Step 2: Mark the world in `design-canvas.jsx`**

Find the `worldRef` div (search for `ref={worldRef}`) and add the `data-dc-world` attribute:

```jsx
      <div ref={worldRef} data-dc-world="" style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform', width: 'max-content', minWidth: '100%', minHeight: '100%', padding: 'calc(72px * var(--dc-inv-zoom,1)) 0 80px' }}>
```

- [ ] **Step 3: Look the world up by its hook in `canvas-page.jsx`**

Replace the lookup inside `CanvasFlows` (search for `.design-canvas > div`):

```js
  // The world is the transformed layer, not whatever sits first under the
  // viewport: the grid layer is a sibling in front of it.
  React.useEffect(() => {
    const el = document.querySelector('[data-dc-world]');
    if (el) setWorld(el);
  }, []);
```

- [ ] **Step 4: Reload and confirm the arrows are back**

Reload `http://localhost:8000/sample/`, wait two seconds, then run:

```js
({
  paths: document.querySelectorAll('.dc-flows svg path').length,
  world: !!document.querySelector('[data-dc-world]'),
  slotsInWorld: document.querySelector('[data-dc-world]').querySelectorAll('[data-dc-slot]').length,
})
```

Expected: `{paths: 24, world: true, slotsInWorld: 10}`

- [ ] **Step 5: Confirm the handles and labels still work**

Hover an arrow. Two white circles must appear at its ends. Drag one to another side of its page — the arrow must re-route and stay there. Drag a page by its grip — the arrows must follow.

- [ ] **Step 6: Commit**

```bash
git add design-canvas.jsx canvas-page.jsx
git commit -m "Find the canvas world by its own hook"
```

---

### Task 2: Add the performance bench harness and record the baseline

**Goal:** A single pasteable script that reproduces every number the later tasks are judged against, plus a recorded baseline for this machine.

**Files:**
- Create: `perf/bench.js`
- Modify: `docs/superpowers/plans/2026-09-08-canvas-performance.md` (fill in the Baseline table below)

**Acceptance Criteria:**
- [ ] `dcBench.all()` returns without throwing on the sample and reports every key listed in the Baseline table
- [ ] `dcBench.zoomFrames()` reports `over16` frames and a median frame time
- [ ] `dcBench.invWrites()` reports how many times `--dc-inv-zoom` changed during one 90-tick gesture
- [ ] `dcBench.liveByZoom()` reports the live iframe count at 0.05, 0.15, 0.3, 0.5 and 0.8
- [ ] `dcBench.flowCost()` reports milliseconds per `cfMeasure` call
- [ ] `dcBench.dragFlowCost()` reports total `cfMeasure` milliseconds over a 40-frame grip drag
- [ ] `dcBench.patchCost()` reports the milliseconds a variant-chip click costs to the next frame
- [ ] The Baseline table in this plan is filled in with the numbers from this machine

**Verify:** `node --check perf/bench.js` → no output (syntax valid), then paste the file into the sample's console and run `await dcBench.all()` → an object with all seven sections populated.

**Steps:**

- [ ] **Step 1: Write the harness**

Create `perf/bench.js`:

```js
// perf/bench.js — measurement harness for the canvas.
//
// Not loaded by the app. Paste the whole file into the page (DevTools console,
// or evaluate_script over the chrome-devtools MCP) with the sample open, then
// run `await dcBench.all()`. Every number the performance plan is judged
// against comes from here, so the same numbers can be taken before and after
// a change on the same machine.
//
//   python3 -m http.server 8000   →   http://localhost:8000/sample/
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const vp = () => document.querySelector('.design-canvas');
  const world = () => document.querySelector('[data-dc-world]')
    || [...vp().children].find((el) => el.style.transform.includes('scale'));
  const slots = () => [...document.querySelectorAll('[data-dc-slot]')];
  const iframes = () => document.querySelectorAll('.dc-card iframe').length;
  const round = (n) => +n.toFixed(2);

  // Screen-space box around every slot, so a fit can put the whole page on screen.
  const bbox = () => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    slots().forEach((el) => {
      const q = el.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top);
      r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    });
    return { l, t, r, b, w: r - l, h: b - t };
  };

  // Fit through the canvas's own zoom and pan paths, so tf stays in step with
  // the DOM and the next gesture does not jump.
  const fit = async (fill = 0.9) => {
    const w = world();
    let box = bbox();
    const cur = w.getBoundingClientRect().width / w.offsetWidth || 1;
    const target = cur * Math.min((innerWidth * fill) / box.w, (innerHeight * fill) / box.h);
    window.postMessage({ type: '__dc_set_zoom', scale: target }, '*');
    await sleep(400);
    box = bbox();
    const dx = (innerWidth - box.w) / 2 - box.l, dy = (innerHeight - box.h) / 2 - box.t;
    // Fractional deltas keep this on the pan branch instead of the wheel-zoom one.
    vp().dispatchEvent(new WheelEvent('wheel', {
      deltaX: -dx - 0.001, deltaY: -dy + 0.001, deltaMode: 0,
      clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true,
    }));
    await sleep(300);
    return { scale: window.dcZoom.scale, onScreen: onScreenCount() };
  };

  const onScreenCount = () => slots().filter((el) => {
    const r = el.getBoundingClientRect();
    return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  }).length;

  // 90 pinch ticks, one per frame: in for the first half, out for the second.
  const gesture = async (n = 90) => {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < n; i++) {
      vp().dispatchEvent(new WheelEvent('wheel', {
        deltaY: i < n / 2 ? -6 : 6, deltaMode: 0, ctrlKey: true,
        clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
      await frame();
    }
  };

  const frameStats = async (fn) => {
    const times = [];
    let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await fn();
    stop = true;
    const s = times.slice(2).sort((a, b) => a - b);
    const q = (p) => round(s[Math.floor(s.length * p)]);
    return {
      frames: s.length, median: q(0.5), p90: q(0.9), max: round(s[s.length - 1]),
      over8: s.filter((f) => f > 8.3).length, over16: s.filter((f) => f > 16.7).length,
    };
  };

  // Frame times through one pinch with the whole page on screen.
  const zoomFrames = async () => {
    await fit();
    await sleep(2500);
    const live = iframes();
    return { ...(await frameStats(() => gesture())), liveAtStart: live, onScreen: onScreenCount() };
  };

  // How often the zoom-compensation property is written during one gesture.
  // Every write invalidates style for the whole world subtree.
  const invWrites = async () => {
    const w = world();
    let writes = 0, lastValue = w.style.getPropertyValue('--dc-inv-zoom');
    const mo = new MutationObserver(() => {
      const v = w.style.getPropertyValue('--dc-inv-zoom');
      if (v !== lastValue) { lastValue = v; writes++; }
    });
    mo.observe(w, { attributes: true, attributeFilter: ['style'] });
    await fit();
    await sleep(600);
    writes = 0;
    await gesture();
    await sleep(400);
    mo.disconnect();
    return { ticks: 90, invWrites: writes };
  };

  // The cost of one zoom frame, split by what the frame writes. Forcing layout
  // after a transform-only write is nearly free; after a custom-property write
  // it is not, whether or not any CSS reads the property.
  const zoomFrameCost = (n = 60) => {
    const w = world();
    const force = () => document.body.getBoundingClientRect().height;
    const bench = (write) => {
      for (let i = 0; i < 8; i++) { w.style.transform = 'translate3d(0px,0px,0) scale(0.4)'; write(2.5); force(); }
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const s = 0.35 + (i % 20) * 0.005;
        w.style.transform = `translate3d(0px, 0px, 0) scale(${s})`;
        write(1 / s);
        force();
      }
      return round((performance.now() - t0) / n);
    };
    const best = (write) => Math.min(bench(write), bench(write));
    const out = {
      transformOnly: best(() => {}),
      withInvZoom: best((v) => w.style.setProperty('--dc-inv-zoom', String(v))),
      withUnusedProp: best((v) => w.style.setProperty('--dc-unused', String(v))),
      slots: slots().length,
      nodes: document.querySelectorAll('.design-canvas *').length,
    };
    w.style.removeProperty('--dc-unused');
    return out;
  };

  // How many iframes are live at each zoom. The budget must hold at every step.
  const liveByZoom = async (list = [0.05, 0.15, 0.3, 0.5, 0.8]) => {
    const out = [];
    await fit();
    for (const s of list) {
      window.postMessage({ type: '__dc_set_zoom', scale: s }, '*');
      await sleep(3000);
      out.push({ zoom: s, live: iframes(), onScreen: onScreenCount() });
    }
    return out;
  };

  // Every flow on this page whose two ends are slots in the DOM.
  const pageFlows = async () => {
    const data = await (await fetch('./canvas.json')).json();
    const files = new Set(slots().map((el) => el.dataset.dcSlot));
    return (data.flows || []).filter((f) => files.has(f.from) && files.has(f.to));
  };

  // Milliseconds for one full re-route of every arrow.
  const flowCost = async (n = 20) => {
    const flows = await pageFlows();
    const fn = window.__cfOrig || window.cfMeasure;
    const w = world();
    fn(w, flows); fn(w, flows);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn(w, flows);
    return { flows: flows.length, slots: slots().length, msPerCall: round((performance.now() - t0) / n) };
  };

  // Drag a card by its grip and count what the arrows cost over the drag.
  const dragFlowCost = async (frames = 40) => {
    if (!window.__cfOrig) window.__cfOrig = window.cfMeasure;
    const acc = { calls: 0, ms: 0 };
    window.cfMeasure = function (...a) {
      const t0 = performance.now();
      const r = window.__cfOrig.apply(this, a);
      acc.calls++; acc.ms += performance.now() - t0;
      return r;
    };
    await fit();
    window.postMessage({ type: '__dc_set_zoom', scale: 0.3 }, '*');
    await sleep(1500);
    const slot = slots().find((el) => {
      const r = el.getBoundingClientRect();
      return r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight;
    }) || slots()[0];
    const grip = slot.querySelector('.dc-grip');
    const r = grip.getBoundingClientRect();
    let x = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (type, el) => (el || document).dispatchEvent(new PointerEvent(type, {
      pointerId: 7, isPrimary: true, button: 0, buttons: 1,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
    acc.calls = 0; acc.ms = 0;
    ev('pointerdown', grip);
    await frame();
    const stats = await frameStats(async () => {
      for (let i = 0; i < frames; i++) { x += 4; y += 2; ev('pointermove'); await frame(); }
    });
    ev('pointerup');
    await sleep(600);
    window.cfMeasure = window.__cfOrig;
    return { dragged: slot.dataset.dcSlot, dragFrames: frames, cfCalls: acc.calls, cfMs: round(acc.ms), frameStats: stats };
  };

  // What one state patch costs. The control is a click on something inert, so
  // the difference is the React render plus the layout it causes.
  const patchCost = async (n = 8) => {
    const chips = [...document.querySelectorAll('.dc-size')];
    if (!chips.length) return { error: 'no variant chips on this page' };
    const inert = document.querySelector('.dc-sectionhead');
    const timeClick = async (el) => {
      await frame();
      const before = window.DC && window.DC.renders;
      const t0 = performance.now();
      el.click();
      await frame();
      const ms = performance.now() - t0;
      const after = window.DC && window.DC.renders;
      return { ms, renders: before == null ? null : after - before };
    };
    const med = (a) => round(a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]);
    const control = [], real = [], renders = [];
    for (let i = 0; i < n; i++) { control.push((await timeClick(inert)).ms); await sleep(80); }
    for (let i = 0; i < n; i++) {
      const r = await timeClick(chips[i % chips.length]);
      real.push(r.ms);
      if (r.renders != null) renders.push(r.renders);
      await sleep(200);
    }
    return {
      slots: slots().length,
      controlMs: med(control),
      variantSwitchMs: med(real),
      framesRenderedPerPatch: renders.length ? med(renders) : null,
    };
  };

  const all = async () => ({
    env: { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, slots: slots().length },
    zoomFrameCost: zoomFrameCost(),
    invWrites: await invWrites(),
    zoomFrames: await zoomFrames(),
    liveByZoom: await liveByZoom(),
    flowCost: await flowCost(),
    dragFlowCost: await dragFlowCost(),
    patchCost: await patchCost(),
  });

  window.dcBench = { fit, gesture, frameStats, zoomFrames, zoomFrameCost, invWrites, liveByZoom, flowCost, dragFlowCost, patchCost, all };
  console.log('[dcBench] ready — run: await dcBench.all()');
})();
```

- [ ] **Step 2: Check the syntax**

Run: `node --check perf/bench.js`
Expected: no output.

- [ ] **Step 3: Confirm the suite is green before measuring**

Open `http://localhost:8000/tests/regressions.html` and wait for the title to
settle. Expected: `PASS: canvas regressions`, 11 of 11. A red suite makes every
later number ambiguous — fix that first.

- [ ] **Step 4: Take the baseline**

With the sample open and settled, paste `perf/bench.js` into the console, then run `await dcBench.all()`. It takes about a minute.

- [ ] **Step 5: Record the baseline in this plan**

Fill the table below in with the numbers you got. Later tasks compare against **these** numbers, not the reference column.

#### Baseline (fill in — reference numbers from the profiling run in brackets)

Taken on 2026-09-08 at base `e8e871c`, worktree served on :8020, viewport
1066 x 666, DPR 3, ~144 Hz display (6.9 ms frame budget), no CPU throttling,
regression suite 11/11 PASS.

| Measure | This machine | Reference | Verdict |
|---|---|---|---|
| `zoomFrameCost.transformOnly` | **0.01 ms** | 0.01 ms | matches |
| `zoomFrameCost.withInvZoom` | **0.31 ms** (0.22 of it from an unread property) | 0.33–0.42 ms | matches |
| `invWrites.invWrites` | **90** of 90 ticks | 90 | matches |
| `zoomFrames.median` / `over16` | **6.9 ms / 0** (max 8.6, 0 live, 10 on screen) | 8.3 ms / 0 | matches |
| `liveByZoom` at 0.05 | **0 live**, 10 on screen | 0 live | matches |
| `flowCost.msPerCall` | **0.8 ms** | 0.51 ms | same order |
| `dragFlowCost.cfCalls` / `cfMs` | **2 calls / 2.3 ms** | 44 / ~22 ms | **contradicts — see below** |
| `patchCost.variantSwitchMs` / `controlMs` | **6.5 / 7.2 ms** — both one frame | 6.7 / 2.0 ms | **harness cannot resolve it — see below** |

**`dragFlowCost` contradicts the spec.** The spec's finding F4 claimed ~1.1
re-routes per drag frame. That was inferred from the MutationObserver batch
count, never measured. Measured directly: a 40-frame drag fires **44 observer
batches but only 2 `cfMeasure` calls**, costing 4 ms in total. `schedule()`
cancels the pending `requestAnimationFrame` and pushes the 240 ms timer on
every mutation, so a continuous drag coalesces to one measure when it pauses
and one after the drop. The existing debounce already does what Task 6 was
going to add.

**`patchCost` measures the wrong thing.** It times from click to the next
`requestAnimationFrame`, which quantises to the frame period: control and
variant both read 6.8 ms, and 20 back-to-back clicks of each gave an identical
6.81 ms per click with zero long tasks. Measured without a frame wait, forcing
layout inside the timing window, a variant switch costs **1.0 ms** against a
control of **0.01 ms**. So F3's 4.7 ms was frame-quantisation noise; the real
cost of one `patchSection` is about 1 ms at 10 slots. Any Task 5 acceptance
criterion must use `framesRenderedPerPatch`, not `variantSwitchMs`.

- [ ] **Step 6: Commit**

```bash
git add perf/bench.js docs/superpowers/plans/2026-09-08-canvas-performance.md
git commit -m "Add a canvas performance bench harness"
```

---

### Task 3: Write the zoom compensation variable only on settle

**Goal:** A pinch stops invalidating style for the whole world on every frame; `--dc-inv-zoom` is written once the gesture settles.

**Files:**
- Modify: `design-canvas.jsx` — `DCViewport`, the `flushNow` callback (search for `--dc-inv-zoom`) and the cleanup in the `useLayoutEffect` that holds the fit and rescue timers

**Acceptance Criteria:**
- [ ] `dcBench.invWrites()` reports **at most 3** writes for a 90-tick gesture (was 90)
- [ ] `dcBench.zoomFrames().median` is no worse than the Task 2 baseline, and `over16` is no higher
- [ ] After a pinch ends, header labels, section gaps and the section title settle to their correct screen size within `DC.settleMs`
- [ ] Headers are the right size on first paint, before any gesture
- [ ] The Back to content pill still appears when the view is panned off the pages, and its tween still lands with the right header sizes

**Verify:** `await dcBench.invWrites()` → `{ticks: 90, invWrites: <= 3}`, then `await dcBench.zoomFrames()` → `median` and `over16` no worse than baseline.

**Steps:**

- [ ] **Step 1: Add the settle-write machinery to `DCViewport`**

Just above the `flushNow` callback (search for `// rAF-coalesced DOM write`), add:

```jsx
  // Zoom-dependent chrome (header sizes, section gaps, world padding) reads
  // --dc-inv-zoom. It is an inherited custom property, so writing it makes
  // Chrome recalculate style for the whole world — 0.4 ms at 10 slots, 1.1 ms
  // at 40, on every frame of a pinch. It is written once the gesture settles
  // instead: during the gesture the world is one composited transform, and the
  // chrome scales with it for a beat before it snaps back to screen size.
  const invT = React.useRef(0);
  const lastInv = React.useRef(null);
  const writeInv = React.useCallback(() => {
    invT.current = 0;
    const el = worldRef.current; if (!el) return;
    const inv = 1 / tf.current.scale;
    if (lastInv.current === inv) return;
    lastInv.current = inv;
    el.style.setProperty('--dc-inv-zoom', String(inv));
  }, []);
```

- [ ] **Step 2: Take the write off the per-frame path**

Inside `flushNow`, replace this line:

```jsx
    el.style.setProperty('--dc-inv-zoom', String(1 / scale));
```

with:

```jsx
    // First paint writes at once, so the chrome is never wrong before a gesture.
    if (lastInv.current === null) writeInv();
    else { clearTimeout(invT.current); invT.current = setTimeout(writeInv, DC.settleMs); }
```

Then add `writeInv` to the `flushNow` dependency array, which becomes:

```jsx
  }, [tfKey, checkLost, writeInv]);
```

- [ ] **Step 3: Clear the timer on unmount**

`DCViewport` has two layout effects. The first one restores the saved view and
owns the mount-lifetime teardown; the second runs the first fit and re-runs
whenever `hasContent`, `apply`, `minScale` or `maxScale` change. `invT` is a
mount-lifetime timer, so it goes in the **first** one, beside `lostT` and
`tween` — not in the fit effect, which would cancel a pending settle write
every time those deps changed.

Find this cleanup (it is the one that removes the `pagehide` listener):

```jsx
    return () => {
      clearTimeout(lostT.current);
      if (tween.current) cancelAnimationFrame(tween.current);
      window.removeEventListener('pagehide', flush); flush();
    };
  }, []);
```

and add the one line:

```jsx
    return () => {
      clearTimeout(lostT.current); clearTimeout(invT.current);
      if (tween.current) cancelAnimationFrame(tween.current);
      window.removeEventListener('pagehide', flush); flush();
    };
  }, []);
```

- [ ] **Step 4: Measure the writes**

Reload the sample, paste `perf/bench.js`, then run:

```js
await dcBench.invWrites()
```

Expected: `{ticks: 90, invWrites: 1}` — one write when the gesture settles. Anything up to 3 passes (a mid-gesture settle can fire).

- [ ] **Step 5: Confirm the frame times did not get worse**

```js
await dcBench.zoomFrames()
```

Expected: `median` and `over16` no worse than the Task 2 baseline.

- [ ] **Step 6: Eyeball the settle**

Pinch-zoom the sample hard and let go. The header labels and section title must scale with the pages during the gesture, then snap to their normal size about 150 ms after you stop. Pan far off the pages until the Back to content pill appears, click it, and confirm the headers are the right size when the tween lands.

- [ ] **Step 7: Commit**

```bash
git add design-canvas.jsx
git commit -m "Write the zoom variable once the view settles"
```

---

### Task 4: Replace the snapshots with a live iframe budget

**Goal:** The zoomed-out picture is gone and a slot is a live iframe at any zoom, with at most `DC.liveBudget` alive at once — the ones nearest the viewport centre.

**Files:**
- Modify: `design-canvas.jsx` — `DC` config, the styles block, the snapshot section (`dcSnap`, `dcHash`, `dcRasterize`), `dcFontCss`, the LOD registry (`dcZoom`, `dcLodRun`, `dcLodSubscribe`), `DCLazyFrame`, and the header comment block at the top
- Modify: `README.md` — the intro sentence, the `design-canvas.jsx` bullet and the whole "How snapshots work" section

**Acceptance Criteria:**
- [ ] `document.querySelectorAll('img.dc-thumb').length` is 0 at every zoom
- [ ] `dcBench.liveByZoom()` reports `live <= 8` at every zoom, including 0.05 where all 10 slots are on screen
- [ ] `dcBench.zoomFrames().over16` is 0 with the whole page on screen (the all-live measurement without a budget gave 14 of 88)
- [ ] `dcBench.zoomFrames().max` is under 20 ms (the unbudgeted all-live measurement gave 83.9 ms)
- [ ] The slot nearest the pointer is always live: zoom to 0.05, then to 0.8 on a page, and that page is an iframe at both ends
- [ ] Download PNG and Download HTML in the kebab menu both still produce a correct file
- [ ] `dcSnap`, `dcHash`, `dcRasterize`, `DC.liveScale` and `DC.snapWidth` no longer appear anywhere in `design-canvas.jsx`
- [ ] No `[dc-snap]` warnings in the console
- [ ] `README.md` no longer describes snapshots
- [ ] `tests/regressions.html` reports 11 of 11 PASS, with the rasterize check rewritten against the export path rather than deleted

**Verify:** `await dcBench.liveByZoom()` → every row has `live <= 8`; `await dcBench.zoomFrames()` → `over16: 0` and `max < 20`; `grep -c "dcSnap\|dcRasterize\|liveScale\|snapWidth\|dc-thumb" design-canvas.jsx` → `0`.

**Steps:**

- [ ] **Step 1: Swap the config keys**

In the `DC` object, delete these two lines:

```js
  liveScale: 0.5,       // live iframe at or above this zoom
  snapWidth: 720,       // snapshot bitmap width; they only show below liveScale
```

and put these in their place:

```js
  liveBudget: 8,        // most live iframes at once; the nearest to the centre win
  budgetHysteresis: 400, // px a live slot counts as nearer, so the last place does not flip
```

- [ ] **Step 2: Delete the thumbnail style**

In the styles block, delete this line:

```css
.dc-card img.dc-thumb{display:block;width:100%;height:100%;object-fit:cover;object-position:top left;background:#fff}
```

- [ ] **Step 3: Delete the snapshot engine**

Delete the whole block from the comment `// In-browser snapshots. dcSnap.want(...` through the closing `};` of `dcSnap`, and the `dcHash` line under it. Delete `dcRasterize` (the function starting `async function dcRasterize(html, baseHref, w, h) {`).

Keep `dcBlobToDataUrl`, `dcFontCss`, `dcInlineDoc` and `dcExportArtboard`.

- [ ] **Step 4: Give `dcFontCss` its own cache**

`dcFontCss` kept its cache on `dcSnap.fontCss`, which is gone. Directly above `function dcFontCss(href)`, add:

```js
// href → Promise<string>, so two artboards on the same font fetch it once.
const dcFontCache = new Map();
```

and then change ONLY the two cache lines inside the function — the first line
and the last. **Leave the body exactly as it is.** The `dev` merge rewrote it:
the subset comment now attaches to the rule that FOLLOWS it, faces with no
subset comment are kept, and the inlining is delegated to `dcInlineCss`. The
regression check "Google Fonts preserves Arabic and final Latin face" asserts
that behaviour, and the older `css.split('@font-face')` version fails it.

```js
function dcFontCss(href) {
  if (!dcFontCache.has(href)) dcFontCache.set(href, (async () => {
    const css = await (await fetch(href)).text();
    // A subset comment belongs to the following rule, including the last face.
    // Some responses have no subset comments; keep those faces as well.
    const blocks = [...css.matchAll(/(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{[^}]*\}/g)]
      .filter((m) => !m[1] || /^(latin|arabic)$/.test(m[1].trim()))
      .map((m) => m[0]);
    return dcInlineCss(blocks.join('\n'), href);
  })().catch(() => ''));
  return dcFontCache.get(href);
}
```

- [ ] **Step 5: Drop the snapshot database**

Right after the styles block's closing `document.head.appendChild(s); }`, add:

```js
// The zoomed-out snapshots are gone; drop the cache they left in the browser.
if (typeof indexedDB !== 'undefined') { try { indexedDB.deleteDatabase('dc-snapshots'); } catch {} }
```

- [ ] **Step 6: Rewrite the LOD pass as a budget**

Replace `dcLodRun` and `dcLodSubscribe` (from the comment `// Mounting an iframe is the one expensive step` through the end of `dcLodSubscribe`) with:

```js
// Distance from the viewport centre to the nearest point of a slot's box; 0
// when the centre is inside it. This is what ranks slots for the budget.
function dcSlotDistance(r) {
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const dx = Math.max(r.left - cx, 0, cx - r.right);
  const dy = Math.max(r.top - cy, 0, cy - r.bottom);
  return Math.hypot(dx, dy);
}

// One pass over every slot. The nearest DC.liveBudget slots that are within
// their margin go live; everything else drops to its placeholder. A live slot
// counts as DC.budgetHysteresis px nearer than it is, so a slot on the last
// place does not flip on every pass. Mounting an iframe is the one expensive
// step (a whole document parses and lays out), so at most one slot mounts per
// pass and the rest wait a beat; dropping is cheap and is not rationed.
function dcLodRun() {
  const all = [];
  dcZoom.subs.forEach((s) => {
    const r = s.box.getBoundingClientRect();
    const m = s.live ? DC.unmountMargin : s.margin;
    const near = r.right > -m && r.left < innerWidth + m && r.bottom > -m && r.top < innerHeight + m;
    all.push({ s, near, d: dcSlotDistance(r) - (s.live ? DC.budgetHysteresis : 0) });
  });
  const ranked = all.filter((e) => e.near).sort((a, b) => a.d - b.d);
  const winners = new Set(ranked.slice(0, DC.liveBudget).map((e) => e.s));
  // Drop first, so a mount never takes the page over the budget for a frame.
  all.forEach(({ s }) => { if (s.live && !winners.has(s)) { s.live = false; s.set(false); } });
  let mounted = false, pending = false;
  for (const { s } of ranked) {
    if (s.live || !winners.has(s)) continue;
    if (mounted) { pending = true; break; }
    s.live = true; s.set(true); mounted = true;
  }
  if (pending) { clearTimeout(dcZoom.timer); dcZoom.timer = setTimeout(dcLodRun, DC.mountGapMs); }
}
function dcLodSchedule() { clearTimeout(dcZoom.timer); dcZoom.timer = setTimeout(dcLodRun, DC.settleMs); }
function dcSetZoom(scale) { dcZoom.scale = scale; dcLodSchedule(); }
// entry is { box, margin, live, set } — the slot element to measure, the px of
// screen space that lets it mount, whether it is live now, and the setter that
// mounts or drops it.
function dcLodSubscribe(entry) {
  if (!dcZoom.subs.size) {
    dcZoom.poll = setInterval(dcLodRun, 500);
    document.addEventListener('visibilitychange', dcLodSchedule);
    if (!dcZoom.io) dcZoom.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
  dcZoom.subs.add(entry); dcZoom.io.observe(entry.box);
  return () => {
    dcZoom.subs.delete(entry); dcZoom.io.unobserve(entry.box);
    if (!dcZoom.subs.size) { clearInterval(dcZoom.poll); clearTimeout(dcZoom.timer); document.removeEventListener('visibilitychange', dcLodSchedule); }
  };
}
```

- [ ] **Step 7: Rewrite `DCLazyFrame`**

Replace the whole component, comment block included:

```jsx
// Lazy frame with two levels of detail:
//   live  — a real iframe. Mounted while the slot is one of the DC.liveBudget
//           slots nearest the viewport centre and within `margin` px of it;
//           dropped once it falls out of the budget or past DC.unmountMargin.
//   placeholder — the striped card, for every slot that is not live.
// `eager` forces a live iframe regardless (focus overlay). The registry runs
// one pass for every slot at once, DC.settleMs after the last zoom or pan tick,
// so a pinch does not thrash iframes.
function DCLazyFrame({ src, title, width, height, eager = false, margin = 600, href }) {
  const ref = React.useRef(null);
  const [live, setLive] = React.useState(eager);
  React.useEffect(() => {
    if (eager || !ref.current) return;
    // Measure the slot, not the inner div: the slot has content-visibility:auto,
    // so reading a descendant's rect would force layout of a skipped subtree.
    const box = ref.current.closest('[data-dc-slot]') || ref.current;
    const off = dcLodSubscribe({ box, margin, live: false, set: setLive });
    dcLodSchedule();
    return off;
  }, [eager, margin]);
  const on = eager || live;
  // Shield: iframes swallow wheel/pinch, so a transparent layer sits over the
  // screen and lets the canvas zoom/pan. A click opens the screen's own file
  // (where it can be edited); the ⋯ menu opens it in a new tab.
  return (
    <div ref={ref} style={{ width, height, position: 'relative' }}>
      {on ? <iframe src={src} title={title} loading="lazy" style={{ width, height }} />
        : <div className="dc-placeholder">{title}</div>}
      {!eager && <div className="dc-shield" title="Open to edit" onClick={() => { if (href) location.href = href; }} />}
    </div>
  );
}
```

- [ ] **Step 8: Update the header comment block**

At the top of `design-canvas.jsx`, replace the two LOD bullets:

```
//   • LOD: below DC.liveScale zoom, or far from the viewport, a slot shows a
//     snapshot instead of a live iframe; iframes mount only near 1:1 or in focus
//   • snapshots are made in the browser, one at a time in idle moments: the
//     .dc.html is fetched, its images and Google Fonts are inlined, and it is
//     rasterized through an SVG <foreignObject> onto a canvas, then cached in
//     IndexedDB keyed by content hash — no build step, no files in the project
```

with:

```
//   • LOD: a slot is a live iframe while it is one of the DC.liveBudget slots
//     nearest the viewport centre; the rest show a placeholder. The budget, not
//     the zoom, is what bounds the cost — everything on screen at 5 % zoom would
//     otherwise mount at once
```

- [ ] **Step 9: Update the README**

Change the opening two lines from:

```
Pan/zoom canvas page for a claude.ai/design project, with level of detail:
live iframes near 1:1 or in focus, snapshots when zoomed out.
```

to:

```
Pan/zoom canvas page for a claude.ai/design project, with level of detail:
the screens nearest the middle of the view are live iframes, the rest are
placeholders.
```

In the `design-canvas.jsx` bullet, change `(sections, artboards, post-its, focus view, snapshots)` to `(sections, artboards, post-its, focus view)`.

Replace the whole `## How snapshots work` section with:

```markdown
## How the level of detail works

Nothing to run and no files to add. A slot is a live iframe while it is one of
the `DC.liveBudget` (8) slots nearest the middle of the view and within
`margin` px of it. Every other slot shows a striped placeholder with its name.

One registry serves every slot: a single pass runs `DC.settleMs` after the last
zoom or pan tick, ranks the slots by distance from the centre of the view, and
mounts at most one iframe per pass so a burst does not jank one frame. A live
slot counts as `DC.budgetHysteresis` px nearer than it is, so the slot in last
place does not flip on and off while you pan.
```

- [ ] **Step 10: Confirm the pictures are gone**

Reload the sample and run:

```js
({ thumbs: document.querySelectorAll('img.dc-thumb').length, live: document.querySelectorAll('.dc-card iframe').length })
```

Expected: `{thumbs: 0, live: <= 8}`.

- [ ] **Step 11: Confirm the budget holds**

```js
await dcBench.liveByZoom()
```

Expected: every row has `live <= 8`, including `zoom: 0.05` where `onScreen` is 10.

- [ ] **Step 12: Confirm the frames**

```js
await dcBench.zoomFrames()
```

Expected: `over16: 0` and `max` under 20 ms.

- [ ] **Step 13: Move the rasterize test onto the export path**

The regression check "CSS backgrounds and imported stylesheet assets rasterize"
(`tests/regressions.js`) calls `dcRasterize`, which this task deletes. What it
guards still matters — that a stylesheet `@import` chain and a relative
`url()` inside it resolve against the artboard's own base and get inlined —
and that behaviour now lives only in the PNG export. Keep the assertions and
change the subject: build the SVG the way `dcExportArtboard` does, from
`dcInlineDoc`'s output, instead of calling `dcRasterize`.

Replace these two lines:

```js
    const image = new Image(); image.src = await dcRasterize(html, location.href, 100, 100); await image.decode();
    ctx.drawImage(image, 0, 0, 10, 10); const pixel = ctx.getImageData(5, 5, 1, 1).data;
```

with:

```js
    // Same path as Download PNG: inline the document, wrap it in a
    // foreignObject, and rasterize that.
    const xhtml = await dcInlineDoc(html, location.href);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject width="100" height="100">${xhtml}</foreignObject></svg>`;
    const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await image.decode();
    ctx.drawImage(image, 0, 0, 10, 10); const pixel = ctx.getImageData(5, 5, 1, 1).data;
```

The `dcInlineDoc` assertion at the end of that test stays exactly as it is.

- [ ] **Step 14: Run the regression suite**

Reload `http://localhost:8000/tests/regressions.html` with cache disabled.

Expected: title `PASS: canvas regressions`, 11 of 11. If the snapshot-related
check fails, fix it here — do not delete the check.

- [ ] **Step 15: Confirm the exports still work**

Open a page's ⋯ menu, click Download PNG, then Download HTML. Both files must download and open correctly. Check the console for `[design-canvas] export failed`.

- [ ] **Step 16: Confirm the code is clean**

```bash
grep -c "dcSnap\|dcRasterize\|liveScale\|snapWidth\|dc-thumb" design-canvas.jsx
```

Expected: `0`.

- [ ] **Step 17: Commit**

```bash
git add design-canvas.jsx README.md tests/regressions.js
git commit -m "Bound live iframes instead of snapshotting"
```

---

### Task 5: Stop a state patch re-rendering every artboard frame

**Goal:** One `patchSection` re-renders the slots it changed, not all of them.

**Files:**
- Modify: `design-canvas.jsx` — the `api` memo in `DesignCanvas`, the body of `DCSection`, and `DCArtboardFrame`'s signature, body and export

**Acceptance Criteria:**
- [ ] `dcBench.patchCost().framesRenderedPerPatch` is **at most 2** on the sample (was 10, one per slot)
- [x] `dcBench.patchCost().framesRenderedPerPatch` falls against the Task 2 baseline (the Task 2 correction rules out `variantSwitchMs`: it is frame-quantised noise)
- [ ] Renaming a page's label, dragging a page, resetting a position, switching a variant, deleting a page and focusing a page all still work
- [ ] Reordering by dragging a grip in a non-free section still works
- [ ] The `DC.renders` counter goes up by 1 for every artboard frame render

**Verify:** `await dcBench.patchCost()` → `{framesRenderedPerPatch: <= 2, variantSwitchMs: <= 0.6 * baseline}`.

**Steps:**

- [ ] **Step 1: Add the render counter**

In the `DC` object, add:

```js
  renders: 0,           // artboard frames rendered; read by perf/bench.js
```

- [ ] **Step 2: Make the context callbacks stable**

In `DesignCanvas`, replace the `api` memo:

```jsx
  const api = React.useMemo(() => ({
    state,
    section: (id) => state.sections[id] || {},
    patchSection: (id, p) => setState((s) => ({
      ...s, updatedAt: Math.max(Date.now(), s.updatedAt + 1),
      sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
    })),
    setFocus: (slotId) => setState((s) => ({ ...s, focus: slotId })),
  }), [state]);
```

with this — **the `updatedAt` line is load-bearing**: it is the save revision
that decides whether the browser copy or the state file wins on the next open,
and three regression checks assert it advances. Carry it over unchanged:

```jsx
  // patchSection and setFocus keep one identity for the life of the canvas, so
  // the per-slot callbacks built on them survive a state change. Only `state`
  // and `section` move, and only the components that read them re-render.
  const patchSection = React.useCallback((id, p) => setState((s) => ({
    ...s, updatedAt: Math.max(Date.now(), s.updatedAt + 1),
    sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
  })), []);
  const setFocus = React.useCallback((slotId) => setState((s) => ({ ...s, focus: slotId })), []);
  const api = React.useMemo(() => ({
    state,
    section: (id) => state.sections[id] || {},
    patchSection,
    setFocus,
  }), [state, patchSection, setFocus]);
```

- [ ] **Step 3: Hoist the per-slot callbacks in `DCSection`**

In `DCSection`, directly above the `return (`, add:

```jsx
  // One stable object of actions, keyed by slot id, instead of eight fresh
  // closures per slot per render. Without this React.memo on the frame can
  // never hit: every prop would be a new function on every state change.
  const patchSection = ctx && ctx.patchSection, setFocus = ctx && ctx.setFocus;
  const actions = React.useMemo(() => ({
    size: (k, file) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'variant', k, file)),
    move: (k, p) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'positions', k, p)),
    rename: (k, v) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'labels', k, v)),
    reorder: (next) => patchSection && patchSection(sid, { order: next }),
    focus: (k) => setFocus && setFocus(`${sid}/${k}`),
    resetPosition: (k) => patchSection && patchSection(sid, (x) => {
      const n = { ...(x.positions || {}) }; delete n[k]; return { positions: n };
    }),
    resetArrows: (k) => patchSection && patchSection(sid, (x) => {
      // Only the end that meets this page: the far page keeps its side.
      const n = {};
      Object.entries(x.arrows || {}).forEach(([key, o]) => {
        const { from, to } = dcFlowKeyParts(key), r = { ...o };
        if (from === k) delete r.fs;
        if (to === k) delete r.ts;
        if (Object.keys(r).length) n[key] = r;
      });
      return { arrows: n };
    }),
    remove: (k) => patchSection && patchSection(sid, (x) => ({
      hidden: [...(x.srcKey === srcKey ? (x.hidden || []) : []), k], srcKey,
    })),
  }), [patchSection, setFocus, sid, srcKey]);

  // One size object per slot, kept across renders that did not change a
  // variant. The artboard elements behind byId are made once by the page and
  // only rebuilt on a reload, which rebuilds `order` too, so they need no dep.
  const sizes = React.useMemo(() => {
    const out = {};
    order.forEach((k) => { out[k] = dcSize(byId[k].props, (sec.variant || {})[k]); });
    return out;
  }, [order.join('|'), sec.variant]);
```

- [ ] **Step 4: Pass the stable props to the frame**

Replace the `order.map(...)` block with:

```jsx
        {order.map((k) => (
          <DCArtboardFrame key={k} sectionId={sid} artboard={byId[k]} order={order}
            size={sizes[k]} actions={actions}
            position={placed && placed[k]} origin={freeBox && freeBox.origin} moved={!!(sec.positions && sec.positions[k])}
            arrowsMoved={Object.entries(sec.arrows || {}).some(([key, o]) => { const { from, to } = dcFlowKeyParts(key); return (from === k && o.fs) || (to === k && o.ts); })}
            label={(sec.labels || {})[k] ?? byId[k].props.label} />
        ))}
```

- [ ] **Step 5: Take the new props in `DCArtboardFrame`**

Change the signature from:

```jsx
function DCArtboardFrame({ sectionId, artboard, label, order, position, origin, moved, size, onSize, onMove, onResetPosition, arrowsMoved, onResetArrows, onRename, onReorder, onFocus, onDelete }) {
```

to this, keeping the two lines that already derive `id` and inserting the eight wrappers straight after them:

```jsx
function DCArtboardFrame({ sectionId, artboard, label, order, position, origin, moved, size, actions, arrowsMoved }) {
  DC.renders++;
  const { id: rawId, label: rawLabel, children: rawChildren, style = {} } = artboard.props;
  const id = rawId ?? rawLabel;
  // The eight callbacks the body already uses, rebuilt per render from one
  // stable actions object. They are cheap; the props that reach React.memo are
  // what has to hold still, and those are actions, size, order and primitives.
  const onSize = (file) => actions.size(id, file);
  const onMove = (p) => actions.move(id, p);
  const onResetPosition = () => actions.resetPosition(id);
  const onResetArrows = () => actions.resetArrows(id);
  const onRename = (v) => actions.rename(id, v);
  const onReorder = (next) => actions.reorder(next);
  const onFocus = () => actions.focus(id);
  const onDelete = () => actions.remove(id);
```

The rest of the body is unchanged: it already calls `onSize`, `onMove`, `onResetPosition`, `onResetArrows`, `onRename`, `onReorder`, `onFocus` and `onDelete`, and it already uses this same local `id` for `data-dc-slot`, the reorder maths and the export file name. Do not add an `id` prop — `DCSection`'s key `k` and this local `id` are the same value.

- [ ] **Step 6: Memoise the component**

Directly after the closing brace of `DCArtboardFrame`, add:

```jsx
// Every prop the frame takes now holds still through a state change that did
// not touch this slot, so the default shallow compare is enough.
DCArtboardFrame = React.memo(DCArtboardFrame);
```

Reassigning a function declaration is legal, and `DCSection` resolves the name
when it renders, so it picks up the memoised version. Leave the `function`
declaration as it is.

- [ ] **Step 7: Measure the renders**

Reload the sample, paste `perf/bench.js`, then run:

```js
await dcBench.patchCost()
```

Expected: `framesRenderedPerPatch` at most 2 and `variantSwitchMs` at most 60 % of the Task 2 baseline.

- [ ] **Step 8: Confirm nothing broke**

On the sample: rename a page label and reload to confirm it persisted; drag a page by its grip and drop it; open ⋯ and click Reset position; switch a size chip; hover an arrow, drag its handle to another side, then use ⋯ → Reset arrow sides; click a label to focus a page and press Escape; open ⋯ → Delete → click again to confirm, then reload.

- [ ] **Step 9: Commit**

```bash
git add design-canvas.jsx
git commit -m "Re-render only the artboards a patch changed"
```

---

### Task 6: Re-route only the arrows a drag moves — WITHDRAWN

> Measurement in Task 2 removed the reason for this task. A 40-frame drag fires
> 44 MutationObserver batches but makes only **2 `cfMeasure` calls**, for 4 ms
> in total, because `schedule()` cancels the pending frame and pushes the 240 ms
> timer on each mutation. The existing debounce already coalesces the drag. Do
> not implement this. `canvas-page.jsx` is unchanged by this plan except for the
> Task 1 world lookup. The steps below are kept only as the record of the idea.

**Goal:** Dragging a page re-routes the arrows that touch it, instead of every arrow on the page, every frame.

**Files:**
- Modify: `canvas-page.jsx` — `cfMeasure` (add the reuse path) and the `measure` callback inside `CanvasFlows`

**Acceptance Criteria:**
- [ ] `dcBench.dragFlowCost().cfMs` is at most 40 % of the Task 2 baseline for the same `dragFrames`
- [ ] Arrows attached to the dragged page follow it while the drag is in progress
- [ ] Arrows not attached to the dragged page do not move during the drag
- [ ] After the drop, every arrow and label is in its final place, including labels that had to move to avoid a collision
- [ ] Dragging an arrow handle to another side still works and still saves

**Verify:** `await dcBench.dragFlowCost()` → `cfMs` at most 40 % of the Task 2 baseline, with `cfCalls` about the same.

**Steps:**

- [ ] **Step 1: Give `cfMeasure` a reuse path**

Change the signature and the box-collecting part of `cfMeasure` from:

```js
function cfMeasure(world, flows) {
  const wr = world.getBoundingClientRect();
  const scale = wr.width / world.offsetWidth || 1;
```

to:

```js
// `reuse` is { prev, only }: the previous pass's result, and the one slot whose
// box can have moved. Only that slot is measured again and only the flows that
// touch it are routed again; every other path is carried over. A drag writes a
// transform on one slot per frame, so this is the whole difference between one
// re-route and all of them.
function cfMeasure(world, flows, reuse) {
  const wr = world.getBoundingClientRect();
  const scale = wr.width / world.offsetWidth || 1;
```

- [ ] **Step 2: Carry the geometry over when reusing**

Immediately after the `const box = (file) => {...}` definition, add:

```js
  // Reusing means the obstacle set is last pass's, with the dragged page's box
  // replaced. Everything else on the canvas held still.
  const carried = reuse && reuse.prev && reuse.prev.geom;
```

Then replace the `allBoxes` build:

```js
  const allBoxes = [];
  slots.forEach((_, file) => { const r = box(file); if (r) allBoxes.push(pad(r, file)); });
  world.querySelectorAll('[data-dc-note]').forEach((el) => {
    const r = el.getBoundingClientRect();
    allBoxes.push(pad(cfRound({ x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale }), null));
  });
```

with:

```js
  let allBoxes;
  if (carried) {
    const moved = box(reuse.only);
    allBoxes = carried.allBoxes.map((r) => (r.file === reuse.only && moved ? pad(moved, reuse.only) : r));
  } else {
    allBoxes = [];
    slots.forEach((_, file) => { const r = box(file); if (r) allBoxes.push(pad(r, file)); });
    world.querySelectorAll('[data-dc-note]').forEach((el) => {
      const r = el.getBoundingClientRect();
      allBoxes.push(pad(cfRound({ x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale }), null));
    });
  }
```

- [ ] **Step 3: Route only the flows that moved**

Replace the `flows.forEach(...)` loop with:

```js
  const kept = carried ? new Map(carried.paths.map((p) => [p.key, p])) : null;
  flows.forEach((f, i) => {
    const key = `${f.from}>${f.to}#${i}`;
    // A flow neither end of which is the dragged page cannot have moved.
    if (kept && f.from !== reuse.only && f.to !== reuse.only) {
      const p = kept.get(key);
      if (p) { out.push(p); return; }
    }
    const fb = box(f.from), tb = box(f.to);
    if (!fb || !tb) return; // slot not in the DOM (hidden, or not this page)
    const a = cfAnchor(fb, f.fs), b = cfAnchor(tb, f.ts);
    // Other pages and notes with their padding, plus the two endpoint pages
    // unpadded, so the curve can leave an anchor but never swing back across
    // its own page.
    const obstacles = allBoxes.filter((r) => r.file !== f.from && r.file !== f.to).concat([{ file: f.from, ...fb }, { file: f.to, ...tb }]);
    const curve = cfRoute(a, f.fs, b, f.ts, obstacles);
    out.push({ key, flowKey: cfFlowKey(f), d: curve.d, mid: curve.mid, angle: curve.angle, start: a, end: b, fb, tb, label: f.label, dashed: !!f.dashed, at: curve.at });
  });
```

- [ ] **Step 4: Keep the labels stable while reusing**

Replace the label placement and signature lines at the end of `cfMeasure`:

```js
  cfPlaceLabels(out, Math.max(scale, 1 / 12));
  // Signature lets the caller skip a React update when nothing moved.
  out.sig = JSON.stringify(out.map((o) => [o.key, o.flowKey, o.label, o.dashed, o.d, Math.round(o.mid.x), Math.round(o.mid.y), o.fb, o.tb]));
  return out;
```

with:

```js
  // Placing labels compares every label against every other, so it runs on the
  // full pass only. Through a drag the carried labels hold their spot and the
  // full pass after the drop settles them.
  if (!carried) cfPlaceLabels(out, Math.max(scale, 1 / 12));
  // Signature lets the caller skip a React update when nothing moved.
  out.sig = JSON.stringify(out.map((o) => [o.key, o.flowKey, o.label, o.dashed, o.d, Math.round(o.mid.x), Math.round(o.mid.y), o.fb, o.tb]));
  out.geom = { allBoxes, paths: out.slice() };
  return out;
```

- [ ] **Step 5: Use the reuse path while a slot is being dragged**

In `CanvasFlows`, add a ref for the last result next to the other refs (near `const cancelDrag = React.useRef(null);`):

```js
  // Last pass's geometry, so a drag can re-route only what moved.
  const lastPaths = React.useRef(null);
```

Then replace the `measure` callback inside the measuring effect:

```js
    const measure = () => {
      if (off) return;
      const next = cfMeasure(world, flows);
      setPaths((prev) => (prev.sig === next.sig ? prev : next));
    };
```

with:

```js
    const measure = () => {
      if (off) return;
      // dcDragSession marks the slot being dragged; only that one can have moved.
      const held = world.querySelector('[data-dc-slot].dc-dragging');
      const only = held && held.dataset.dcSlot;
      const reuse = only && lastPaths.current ? { prev: lastPaths.current, only } : null;
      const next = cfMeasure(world, flows, reuse);
      lastPaths.current = next;
      setPaths((prev) => (prev.sig === next.sig ? prev : next));
    };
```

- [ ] **Step 6: Clear the cache when the flows change**

The effect early-returns when there are no flows, and that path runs no
cleanup, so clear the cache there as well:

```js
    if (!world || !flows.length) { setPaths([]); setHover(null); lastPaths.current = null; return; }
```

Then, in the same effect's cleanup, add the reset:

```js
    return () => {
      off = true; cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(zoomTimer);
      lastPaths.current = null;
      ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', schedule);
    };
```

- [ ] **Step 7: Measure the drag**

Reload the sample, paste `perf/bench.js`, then run:

```js
await dcBench.dragFlowCost()
```

Expected: `cfMs` at most 40 % of the Task 2 baseline with `cfCalls` about the same.

- [ ] **Step 8: Confirm the arrows behave**

Drag a page that has arrows on both sides. Its arrows must follow the card while you drag. Arrows between two other pages must hold still. Let go: every arrow and label must be in a sensible final place. Hover an arrow, drag a handle to another side, and confirm it saves (open ⋯ → Reset arrow sides appears).

- [ ] **Step 9: Commit**

```bash
git add canvas-page.jsx
git commit -m "Re-route only the arrows a drag moves"
```

---

### Task 7: Make the first-load fit survive a slow state read — WITHDRAWN

> `dev`'s `acbba3e` fixed this before the plan was written, and the fix came in
> with the merge. `DCViewport` now holds `restoredView` / `fittedView` refs and
> a `hasContent` flag; the fit runs in its own layout effect gated on
> `hasContent`, as a `requestAnimationFrame` rather than a 60 ms timer racing
> the state read, and it bails once the view is restored or already fitted.
> The regression suite covers it: "fit wide content after delayed restoration"
> renders a 10000 px row behind a 350 ms state request and asserts the world
> settles below scale 0.5. Do not re-implement this. The steps below are kept
> only as the record of what the bug was.

**Goal:** The canvas opens fitted to the page every time, not only when the section state resolves inside 60 ms.

**Files:**
- Modify: `design-canvas.jsx` — the `useLayoutEffect` in `DCViewport` holding the `fit` timer, and the pointer/wheel handlers in the effect below it

**Acceptance Criteria:**
- [ ] With the viewport key cleared, five reloads in a row all open with `dcZoom.scale < 1` and at least one slot on screen
- [ ] With `[data-dc-row]` absent at the 60 ms mark, the fit still lands once the row appears
- [ ] The fit gives up after about 1.5 s rather than retrying forever
- [ ] A pan or zoom made before the fit lands cancels it — the view does not jump out from under the pointer
- [ ] A restored viewport (a reload with the key present) is not re-fitted

**Verify:** Run the reload loop in Step 5 → `scale < 1` and `onScreen >= 1` on all five reloads.

**Steps:**

- [ ] **Step 1: Add a flag for hand-driven movement**

In `DCViewport`, next to the other refs (near `const lastPostedScale = React.useRef();`), add:

```jsx
  // Set by the first hand-driven pan or zoom, so a late fit cannot yank the
  // view out from under the pointer.
  const userMoved = React.useRef(false);
```

- [ ] **Step 2: Set it from the input handlers**

In the effect that installs the wheel and pointer handlers, set the flag at the top of `onWheel` and `onPointerDown`:

```jsx
    const onWheel = (e) => {
      e.preventDefault();
      userMoved.current = true;
      if (isGesturing) return;
```

```jsx
    const onPointerDown = (e) => {
      const onBg = !e.target.closest('[data-dc-slot], .dc-editable, .dc-nav, .dc-flows');
      if (!(e.button === 1 || (e.button === 0 && onBg))) return;
      userMoved.current = true;
```

Also set it in `onGestureStart`:

```jsx
    const onGestureStart = (e) => { e.preventDefault(); userMoved.current = true; isGesturing = true; gsBase = tf.current.scale; };
```

- [ ] **Step 3: Retry the fit until a row exists**

Replace the fit timer:

```jsx
    // First visit: fit the widest section to the viewport width.
    const fit = setTimeout(() => {
      if (restored) return;
      const w = worldRef.current; if (!w) return;
      let maxW = 0;
      w.querySelectorAll('[data-dc-row]').forEach((r) => { maxW = Math.max(maxW, r.scrollWidth + 120); });
      if (!maxW) return;
      const s = Math.min(1, Math.max(minScale, (window.innerWidth) / maxW));
      tf.current = { x: 0, y: 0, scale: s }; apply(true);
    }, 60);
```

with:

```jsx
    // First visit: fit the widest section to the viewport width. The rows only
    // exist once the section state has been read, which can land after this
    // timer, so try again until one shows up or the deadline passes.
    let fitTries = 0, fit = 0;
    const tryFit = () => {
      fit = 0;
      if (restored || userMoved.current) return;
      const w = worldRef.current; if (!w) return;
      let maxW = 0;
      w.querySelectorAll('[data-dc-row]').forEach((r) => { maxW = Math.max(maxW, r.scrollWidth + 120); });
      if (!maxW) { if (++fitTries < 25) fit = setTimeout(tryFit, 60); return; }
      const s = Math.min(1, Math.max(minScale, (window.innerWidth) / maxW));
      tf.current = { x: 0, y: 0, scale: s }; apply(true);
    };
    fit = setTimeout(tryFit, 60);
```

`clearTimeout(fit)` in the cleanup already covers the retry, because every retry writes its handle back into `fit`.

- [ ] **Step 4: Prove the retry path works**

With the sample open, run this to clear the saved viewport and delay the row, then reload:

```js
Object.keys(localStorage).filter((k) => k.startsWith('dc-viewport-v3:')).forEach((k) => localStorage.removeItem(k));
location.reload();
```

After the reload, run:

```js
({ scale: window.dcZoom.scale, rows: document.querySelectorAll('[data-dc-row]').length })
```

Expected: `scale` below 1 and `rows` at least 1.

- [ ] **Step 5: Run the reload loop**

Repeat five times: clear the key, reload, wait two seconds, then check.

```js
Object.keys(localStorage).filter((k) => k.startsWith('dc-viewport-v3:')).forEach((k) => localStorage.removeItem(k));
location.reload();
```

then after each reload:

```js
({
  scale: window.dcZoom.scale,
  onScreen: [...document.querySelectorAll('[data-dc-slot]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  }).length,
})
```

Expected every time: `scale` below 1, `onScreen` at least 1.

- [ ] **Step 6: Confirm a hand-driven move wins**

Clear the key, reload, and immediately scroll-zoom during the first second. The view must stay where you put it — no jump to the fit.

- [ ] **Step 7: Confirm a restored viewport is left alone**

Zoom to something distinctive, reload, and confirm the view comes back exactly where it was.

- [ ] **Step 8: Commit**

```bash
git add design-canvas.jsx
git commit -m "Retry the first-load fit until a row exists"
```

---

## Outcomes

This section is the record the task list points to. There is no separate ledger
file.

**Measured on 2026-09-08, after the review fixes.** Headless Chrome 152,
viewport 1280 × 813, DPR 1, `--headless=new`, sample page, 10 slots, 12 flows.
This is not the machine that took the Task 2 baseline (1066 × 666, DPR 3,
~144 Hz), so compare the counts, not the milliseconds. Headless runs at a
locked 60 Hz, which puts `zoomFrames.median` at the 16.7 ms vsync period by
construction; the frame-time criteria of Tasks 3 and 4 thus cannot be judged
here, and they stay unverified.

| Measure | Criterion | Before | After | Result |
|---|---|---|---|---|
| `invWrites.invWrites` | 1–3 for 90 ticks | 90 | **1** | pass |
| `liveByZoom` live, worst case | at most `DC.liveBudget` (8) | 10 at 0.05 zoom | **8** | pass |
| `patchCost.framesRenderedPerPatch` | at most 2 | 10 | **1** | pass |
| `dragFlowCost.cfCalls` | control; Task 6 withdrawn | 2 | **2** | unchanged, as expected |
| `img.dc-thumb` count | 0 at every zoom | — | **0** | pass |
| `tests/regressions.html` | all checks pass | 11 of 11 | **12 of 12** | pass |
| `zoomFrames.median` / `over16` | no worse than baseline | — | not comparable | not verified |

**Task 5 did not meet its criterion until the review fixes.** Measured at the
merge commit `d5b7f8b`, `framesRenderedPerPatch` was still **10**, one render
for each slot, against a criterion of at most 2. The `React.memo` on
`DCArtboardFrame` never hit. The cause was the `sizes` map: a variant patch
rebuilt the map, and thus a new size object for every slot, so each frame
failed its shallow compare. A per-slot cache of the size object brought the
count to **1**. The plan and the task list had recorded Task 5 as complete on
the strength of the code change alone, because no post-change measurement was
taken.

**Withdrawn during the work:**

- **Task 6 (arrow re-route on drag)** — `dragFlowCost` shows 2 `cfMeasure`
  calls for a 40-frame drag, not the 44 the spec inferred. The existing
  debounce already coalesces the drag. `canvas-page.jsx` is unchanged.
- **Task 7 (first-load fit race)** — fixed before the plan was written by
  `dev`'s `acbba3e`, and covered by the regression suite.

**How to repeat this.** Serve the repo, then run the harness against the sample.
`perf/bench.js` is documented in `README.md`. `all()` writes to saved state, so
use a throwaway browser profile, or clear the page's `dc-state:` entry after.

---

## Final check

- [x] Run `await dcBench.all()` one last time and compare against the Task 2 baseline. Expect: `invWrites` 1–3 (was 90), `liveByZoom` all at or under 8, `zoomFrames.over16` 0, `flowCost` unchanged, `patchCost.framesRenderedPerPatch` at most 2. `dragFlowCost.cfMs` is a control only: Task 6 is withdrawn, so it must stay at its baseline, not fall.
- [ ] `git log --oneline -8` shows one commit per task, no unrelated files staged.
- [ ] `git status --short` shows no leftover working-tree changes beyond the `.perf-traces` deletions this plan inherited.
