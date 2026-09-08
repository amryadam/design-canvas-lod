# Level-of-detail ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank the level-of-detail budget from held world boxes instead of a DOM measurement of every slot, and keep a slot you just touched inside the budget.

**Architecture:** A slot's box inside the world does not move when the world pans or zooms, because the world carries `transform-origin: 0 0` and nothing in its layout reads `--dc-inv-zoom`. Each registry entry therefore holds its world box and a generation number. One pass reads one rect — the world's — turns every held box into screen space by arithmetic, and measures again only the entries whose generation is stale. `dcLodInvalidate()` bumps the generation from the four places that move a slot. A second, independent change gives each entry a `touchedAt` stamp from a capture-phase `pointerdown`, and a stamped entry sorts first for `DC.stickyMs`.

**Tech Stack:** Plain React 18 over Babel standalone from a CDN, no build step, no package manager. `design-canvas.jsx`, `perf/bench.js`, `tests/regressions.js`. Served by `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-09-08-lod-ranking-design.md`

## Global Constraints

- **Do not change the budget behaviour.** `DC.liveBudget`, `DC.unmountMargin`, `DC.budgetHysteresis`, `DC.settleMs`, `DC.mountGapMs` and the one-mount-per-pass rule keep their current values and meaning. The existing test `budget bounds the live iframes` must keep passing unchanged.
- **The registry stays one module-level object with one camera.** Multiple canvases in one document are out of scope, exactly as they are today.
- **The pass must still make no decision while the world moves.** The `dcMoving()` guard at the top of `dcLodRun` is untouched.
- **The moving state stays module state.** Never read `.dc-moving` back from the DOM to decide; that regression is recorded in the previous spec (`fd0eaf0`).
- **No new dependencies, no build step.** Every file stays loadable by `<script type="text/babel">`.
- **`perf/bench.js` is never loaded by the app.** It stays a paste-in file.
- Comments follow the file's house style: say why, in Simplified Technical English, not what the line does.

**User decisions (already made):**
- Keep our count budget. The large projects do not have one, and F1 measured why we need it.
- Do not add stepped distance bands. `DC.budgetHysteresis` already holds the last place stable; two mechanisms for one job is worse than one.
- Do not try to catch a pointer down inside a live iframe.
- Measure before and after, and record the outcome — including a withdrawal if the number does not justify the change.

---

### Task 1: Measure the pass as it is today

**Goal:** A bench function that reports what one settled level-of-detail pass costs and how many slot rects it reads, so Task 2 has a baseline.

**Files:**
- Modify: `design-canvas.jsx:1316` (the `Object.assign(window, …)` export line)
- Modify: `perf/bench.js:257` (the `dcBench` export) and the `all()` object
- Create: nothing

**Acceptance Criteria:**
- [ ] `window.dcLodRun` exists and runs one pass when called.
- [ ] `await dcBench.lodPassCost()` returns `{ slots, msPerPass, slotRectsPerPass }`.
- [ ] On the sample page `slotRectsPerPass` equals `slots` (10). This is the baseline the plan is judged against.
- [ ] `dcBench.all()` includes `lodPassCost`.
- [ ] `Element.prototype.getBoundingClientRect` is restored even if the pass throws.

**Verify:** `python3 -m http.server 8000`, open `http://localhost:8000/sample/`, paste the whole of `perf/bench.js` into the console, then run `await dcBench.lodPassCost()` → `{ slots: 10, msPerPass: <number>, slotRectsPerPass: 10 }`

**Steps:**

- [ ] **Step 1: Export the pass so a tool can run it**

In `design-canvas.jsx`, change the export line (currently line 1316) to add `dcLodRun`:

```js
Object.assign(window, { DesignCanvas, DCSection, DCArtboard, DCPostIt, DCLazyFrame, DCCtx, DCLib, dcDragSession, dcFlowKey, dcMapPatch, DC, dcLod, dcLodRun, dcArtboardSvg, dcSvgUrl });
```

Update the comment two lines above it so it stays true:

```js
// A top-level const does not land on window, so the names a host page or a
// tool needs are published here. DC, dcLod, dcLodRun and dcArtboardSvg are
// read by perf/bench.js and tests/regressions.js.
```

- [ ] **Step 2: Add the bench function**

In `perf/bench.js`, add this immediately before `const patchCost = async (n = 8) => {`:

```js
  // What one settled level-of-detail pass costs, and how many slot rects it
  // reads. The pass runs directly, so nothing else is in the sample.
  // slotRectsPerPass is the structural number and it is exact. msPerPass is
  // indicative only: a pass over a clean layout is cheap whatever it reads, so
  // read it beside the count and not on its own.
  const lodPassCost = async (n = 40) => {
    await fit();
    await sleep(600);
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-dc-slot')) reads++;
      return original.apply(this, arguments);
    };
    try {
      window.dcLodRun();   // settle a pending mount first, then start clean
      reads = 0;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) window.dcLodRun();
      return {
        slots: slots().length,
        msPerPass: round((performance.now() - t0) / n),
        slotRectsPerPass: round(reads / n),
      };
    } finally { Element.prototype.getBoundingClientRect = original; }
  };
```

- [ ] **Step 3: Put it in `all()` and in the export**

In `perf/bench.js`, add the line `lodPassCost: await lodPassCost(),` to the `all()` object, immediately after `liveByZoom: await liveByZoom(),`:

```js
  const all = async () => ({
    env: { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, slots: slots().length },
    zoomFrameCost: zoomFrameCost(),
    invWrites: await invWrites(),
    zoomFrames: await zoomFrames(),
    liveByZoom: await liveByZoom(),
    lodPassCost: await lodPassCost(),
    flowCost: await flowCost(),
    dragFlowCost: await dragFlowCost(),
    patchCost: await patchCost(),
  });
```

Then add the name to the export line:

```js
  window.dcBench = { fit, gesture, frameStats, zoomFrames, zoomFrameCost, invWrites, liveByZoom, lodPassCost, flowCost, dragFlowCost, patchCost, all };
```

- [ ] **Step 4: Take the baseline**

Run the server, open the sample, paste `perf/bench.js`, and run:

```js
await dcBench.lodPassCost()
```

Expected: `slots` is 10 and `slotRectsPerPass` is 10 — one rect read per slot per pass, which is what Task 2 removes. Write the whole returned object into the plan's Task 4 record; it is the "before" half of the comparison.

- [ ] **Step 5: Commit**

```bash
git add design-canvas.jsx perf/bench.js
git commit -m "Measure the level of detail pass"
```

---

### Task 2: Rank from held world boxes

**Goal:** One pass reads one rect instead of one per slot, and the ranking it produces is identical.

**Files:**
- Modify: `design-canvas.jsx:124-188` (the `dcLod` object, `dcSlotDistance`, `dcLodRun`, `dcLodSchedule`, `dcSetZoom`, `dcLodSubscribe`)
- Modify: `design-canvas.jsx:1004-1027` (`DCLazyFrame`, the subscribe call)
- Modify: `design-canvas.jsx:1029-1066` (`dcDragSession`, the finish path)
- Modify: `design-canvas.jsx` inside `DCViewport` — the `flushNow` callback and the `ResizeObserver` effect
- Modify: `design-canvas.jsx:1316` (the export line)
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] A settled pass with no invalidation reads **zero** slot rects.
- [ ] A pass straight after `dcLodInvalidate()` reads exactly one rect per subscribed slot.
- [ ] The existing test `budget bounds the live iframes` still passes, unchanged.
- [ ] Every other test on `tests/regressions.html` still passes; the page title is `PASS`.
- [ ] `await dcBench.lodPassCost()` reports `slotRectsPerPass: 0` on the sample.
- [ ] Panning the sample by hand still mounts and drops iframes as before, and the striped placeholder still appears for every slot outside the budget.

**Verify:** `python3 -m http.server 8000`, then open `http://localhost:8000/tests/regressions.html` → the document title is `PASS` and both new rows report `"pass": true`

**Steps:**

- [ ] **Step 1: Write the failing test**

Add this test to `tests/regressions.js`, immediately after the existing `budget bounds the live iframes` test:

```js
  await test('the settled pass ranks without measuring every slot', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 4;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 300, height: 200 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 300, height: 200 })));
    }
    draw('review-ranking.json', E(DCSection, { id: 'review', title: 'Ranking' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(400);
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-dc-slot')) reads++;
      return original.apply(this, arguments);
    };
    let held, fresh;
    try {
      dcLodRun(); reads = 0;      // let any pending mount settle first
      dcLodRun(); held = reads;
      dcLodInvalidate(); reads = 0;
      dcLodRun(); fresh = reads;
    } finally { Element.prototype.getBoundingClientRect = original; }
    check(held === 0, 'a settled pass measured ' + held + ' slots');
    check(fresh === count, 'an invalidated pass measured ' + fresh + ' of ' + count);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run `python3 -m http.server 8000`, open `http://localhost:8000/tests/regressions.html`.
Expected: the new row reports `"pass": false` with `dcLodInvalidate is not defined`, and the page title is `FAIL`.

- [ ] **Step 3: Hold a world box on every registry entry**

In `design-canvas.jsx`, replace the `dcLod` declaration and its comment (currently lines 122-129) with:

```js
// The level-of-detail registry. Every slot subscribes to it. One settle timer,
// one poll and one IntersectionObserver serve them all, instead of N timers
// that fire per frame.
// `world` is the transformed element the slots sit in, and `gen` is the
// measurement generation. DCViewport writes both through dcSetCamera on every
// flushed frame. `scale` drives no decision in the app: dcLodRun ranks slots by
// distance and budget only. The field is kept because perf/bench.js reads it to
// know where the view is.
const dcLod = { scale: 1, world: null, gen: 0, subs: new Set(), timer: 0, poll: 0, io: null };

// A slot's box inside the world does not move when the world pans or zooms.
// The world carries transform-origin 0 0, and since the anchor fix only
// .dc-header reads --dc-inv-zoom, and it is position:absolute — so the world
// layout is the same at every zoom. Each entry therefore holds its world box
// and the generation it was measured in, and one pass turns the held boxes
// into screen space with one rect read of the world itself.
// Call dcLodInvalidate whenever the DOM moves a slot. A missed call costs a
// slightly wrong ranking until the next real one, never a wrong render.
function dcLodInvalidate() { dcLod.gen++; dcLodSchedule(); }
```

- [ ] **Step 4: Rank from the held boxes**

In `design-canvas.jsx`, replace the body of `dcLodRun` down to the `const ranked = …` line. The whole function becomes:

```js
function dcLodRun() {
  // A pan or a pinch changes the ranking in each frame, and a drop removes a
  // full iframe. Do not measure the slots during the gesture. Wait until the
  // world stops. dcLodSchedule then runs this pass again.
  if (dcMoving()) { clearTimeout(dcLod.timer); dcLod.timer = setTimeout(dcLodRun, DC.settleMs); return; }
  const world = dcLod.world; if (!world) return;
  // One rect read for the whole pass. The scale comes from the same read, so
  // it cannot fall out of step with the DOM the way a stored copy can.
  const wr = world.getBoundingClientRect();
  const scale = world.offsetWidth ? wr.width / world.offsetWidth : dcLod.scale;
  const all = [];
  dcLod.subs.forEach((s) => {
    if (s.gen !== dcLod.gen) {
      const b = s.box.getBoundingClientRect();
      s.wx = (b.left - wr.left) / scale; s.wy = (b.top - wr.top) / scale;
      s.ww = b.width / scale; s.wh = b.height / scale;
      s.gen = dcLod.gen;
    }
    const left = wr.left + s.wx * scale, top = wr.top + s.wy * scale;
    const r = { left, top, right: left + s.ww * scale, bottom: top + s.wh * scale };
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
  if (pending) { clearTimeout(dcLod.timer); dcLod.timer = setTimeout(dcLodRun, DC.mountGapMs); }
}
```

`dcSlotDistance` above it is unchanged — it already takes a rect-like object with `left`, `top`, `right` and `bottom`.

- [ ] **Step 5: Give the registry the world element**

In `design-canvas.jsx`, replace `dcSetZoom` with:

```js
function dcSetCamera(world, scale) { dcLod.world = world; dcLod.scale = scale; dcLodSchedule(); }
```

In `DCViewport`'s `flushNow`, replace the line `dcSetZoom(scale);` with:

```js
    dcSetCamera(el, scale);
```

`el` is `worldRef.current` and is already in scope on the line above.

- [ ] **Step 6: Invalidate from the four places that move a slot**

a) In `dcLodSubscribe`, a new or removed slot shifts its siblings, so both ends invalidate. Replace the function with:

```js
// entry is { box, margin, live, set } — the slot element to measure, the px of
// screen space that lets it mount, whether it is live now, and the setter that
// mounts or drops it. dcLodRun adds the held world box and its generation.
function dcLodSubscribe(entry) {
  if (!dcLod.subs.size) {
    dcLod.poll = setInterval(dcLodRun, 500);
    document.addEventListener('visibilitychange', dcLodSchedule);
    if (!dcLod.io) dcLod.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
  dcLod.subs.add(entry); dcLod.io.observe(entry.box);
  dcLodInvalidate();
  return () => {
    dcLod.subs.delete(entry); dcLod.io.unobserve(entry.box);
    dcLodInvalidate();
    if (!dcLod.subs.size) { clearInterval(dcLod.poll); clearTimeout(dcLod.timer); document.removeEventListener('visibilitychange', dcLodSchedule); }
  };
}
```

b) In `DCLazyFrame`, the subscribe effect now schedules through the invalidation, so drop its own schedule. Replace:

```js
    const off = dcLodSubscribe({ box, margin, live: false, set: setLive });
    dcLodSchedule();
    return off;
```

with:

```js
    return dcLodSubscribe({ box, margin, live: false, set: setLive });
```

c) In `dcDragSession`, a drag moves a card, so `finish` invalidates instead of scheduling. Replace `dcLodSchedule();` in `finish` with:

```js
    dcLodInvalidate();
```

d) In `DCViewport`, the `ResizeObserver` effect already watches the world for the lost pill. A world that resizes has re-laid out its slots, so add the invalidation to the same handler:

```js
  React.useEffect(() => {
    const schedule = () => {
      dcLodInvalidate();
      clearTimeout(lostT.current); lostT.current = setTimeout(checkLost, DC.settleMs);
    };
    const ro = new ResizeObserver(schedule);
    if (worldRef.current) ro.observe(worldRef.current);
    window.addEventListener('resize', schedule);
    return () => { ro.disconnect(); window.removeEventListener('resize', schedule); };
  }, [checkLost]);
```

- [ ] **Step 7: Export the two names the test uses**

In `design-canvas.jsx`, change the export line to:

```js
Object.assign(window, { DesignCanvas, DCSection, DCArtboard, DCPostIt, DCLazyFrame, DCCtx, DCLib, dcDragSession, dcFlowKey, dcMapPatch, DC, dcLod, dcLodRun, dcLodInvalidate, dcArtboardSvg, dcSvgUrl });
```

- [ ] **Step 8: Run the tests to verify they pass**

Open `http://localhost:8000/tests/regressions.html`.
Expected: the page title is `PASS`, the new row reports `"pass": true`, and `budget bounds the live iframes` still reports `"pass": true`.

- [ ] **Step 9: Take the after number and check the canvas by hand**

Open `http://localhost:8000/sample/`, paste `perf/bench.js`, run:

```js
await dcBench.lodPassCost()
```

Expected: `slotRectsPerPass: 0`. Record the whole object for Task 4.

Then pan and pinch the sample by hand. Iframes must still mount and drop, and a slot outside the budget must still show its striped placeholder. Drag a card by its grip to the far side of a row, let go, and confirm the budget re-ranks around its new place — that is the drag invalidation.

- [ ] **Step 10: Commit**

```bash
git add design-canvas.jsx tests/regressions.js
git commit -m "Rank the live budget from held world boxes"
```

---

### Task 3: Keep a slot you just touched

**Goal:** A slot that had a pointer down on it in the last `DC.stickyMs` sorts first, so a card you drag or rename does not drop while you work on it.

**Files:**
- Modify: `design-canvas.jsx:16-33` (the `DC` constants)
- Modify: `design-canvas.jsx` — `dcLodRun` (the ranking line) and `dcLodSubscribe` (the listener)
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] `DC.stickyMs` is 4000 and `DC.stickyBias` is 1e6.
- [ ] A pointer down on a slot outside the budget makes that slot live on the next pass.
- [ ] The live count never goes over `DC.liveBudget` to make room for it.
- [ ] The listener is capture phase, so the `stopPropagation` in `.dc-header` cannot hide the touch.
- [ ] The listener is added with the first subscriber and removed with the last.
- [ ] Every test on `tests/regressions.html` still passes; the page title is `PASS`.

**Verify:** `python3 -m http.server 8000`, then open `http://localhost:8000/tests/regressions.html` → the document title is `PASS` and the row `a slot you touch keeps its place in the budget` reports `"pass": true`

**Steps:**

- [ ] **Step 1: Write the failing test**

Add this test to `tests/regressions.js`, immediately after the ranking test from Task 2:

```js
  await test('a slot you touch keeps its place in the budget', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 4;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 300, height: 200 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 300, height: 200 })));
    }
    draw('review-sticky.json', E(DCSection, { id: 'review', title: 'Sticky' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(400);
    const cold = [...host.querySelectorAll('[data-dc-slot]')].filter((el) => !el.querySelector('iframe'));
    check(cold.length > 0, 'every slot was live, so the budget never bound');
    const target = cold[cold.length - 1];
    // A pointer up as well, so a pan session opened by the down cannot hold
    // the registry in its moving state for the rest of the test.
    const ev = (type, el) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, isPrimary: true, bubbles: true }));
    ev('pointerdown', target); ev('pointerup', document);
    await until(() => target.querySelector('iframe'));
    const live = host.querySelectorAll('.dc-card iframe').length;
    check(live <= DC.liveBudget, 'the budget grew to ' + live + ' to keep the touched slot');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Open `http://localhost:8000/tests/regressions.html`.
Expected: the new row reports `"pass": false` with `Timed out waiting for DOM/state`, and the page title is `FAIL`.

- [ ] **Step 3: Add the two constants**

In `design-canvas.jsx`, add these two lines to the `DC` object, immediately after `budgetHysteresis`:

```js
  stickyMs: 4000,       // a slot keeps its place in the budget this long after a
                        // pointer goes down on it, so a card you are working on
                        // does not drop under you
  stickyBias: 1e6,      // px a touched slot counts as nearer; large enough to
                        // outrank every real distance, so it is a pin
```

- [ ] **Step 4: Mark a slot on pointer down**

In `design-canvas.jsx`, add this function immediately after `dcLodInvalidate`:

```js
// A pointer down anywhere in a slot marks it. The mark wins the budget for
// DC.stickyMs, so a card you drag, rename or open the ⋯ menu on does not drop
// while you work on it. It does not win the margin: a slot more than
// DC.unmountMargin px away still drops.
// Capture phase, because .dc-header stops propagation on its own pointer down.
// A pointer down inside a live iframe never reaches this document, which is why
// the mark protects the parent-side gestures only. The mark needs no clean-up:
// the 500 ms poll re-ranks within 500 ms of it going stale.
function dcTouch(e) {
  const box = e.target.closest && e.target.closest('[data-dc-slot]');
  if (!box) return;
  let hit = false;
  dcLod.subs.forEach((s) => { if (s.box === box) { s.touchedAt = performance.now(); hit = true; } });
  if (hit) dcLodSchedule();
}
```

- [ ] **Step 5: Sort a marked slot first**

In `dcLodRun`, add the clock read immediately before `const all = [];`:

```js
  const now = performance.now();
```

Then replace the `all.push(…)` line with:

```js
    const sticky = s.touchedAt !== undefined && now - s.touchedAt < DC.stickyMs;
    all.push({ s, near, d: dcSlotDistance(r) - (s.live ? DC.budgetHysteresis : 0) - (sticky ? DC.stickyBias : 0) });
```

- [ ] **Step 6: Add and remove the listener with the registry**

In `dcLodSubscribe`, add the listener beside the others in the first-subscriber branch:

```js
  if (!dcLod.subs.size) {
    dcLod.poll = setInterval(dcLodRun, 500);
    document.addEventListener('visibilitychange', dcLodSchedule);
    document.addEventListener('pointerdown', dcTouch, true);
    if (!dcLod.io) dcLod.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
```

and remove it in the last-subscriber branch:

```js
    if (!dcLod.subs.size) {
      clearInterval(dcLod.poll); clearTimeout(dcLod.timer);
      document.removeEventListener('visibilitychange', dcLodSchedule);
      document.removeEventListener('pointerdown', dcTouch, true);
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Open `http://localhost:8000/tests/regressions.html`.
Expected: the page title is `PASS` and every row reports `"pass": true`.

- [ ] **Step 8: Check it by hand**

Open `http://localhost:8000/sample/`. Zoom out until some slots show their placeholder. Drag a placeholder slot's card by its grip a short way and let go: it must be live and stay live. Pan far away from it: it must drop, because the mark does not win the margin.

- [ ] **Step 9: Commit**

```bash
git add design-canvas.jsx tests/regressions.js
git commit -m "Keep a touched slot in the live budget"
```

---

### Task 4: Record the outcome

**Goal:** The README describes what the registry now does, and the design doc carries the before and after numbers — including a withdrawal if the numbers do not justify a change.

**Files:**
- Modify: `README.md` (the "How the level of detail works" section)
- Modify: `docs/superpowers/specs/2026-09-08-lod-ranking-design.md` (add a "Measured outcome" section)

**Acceptance Criteria:**
- [ ] The README says a slot's world box is held and re-measured on invalidation, and lists the four places that invalidate.
- [ ] The README describes `DC.stickyMs`.
- [ ] The design doc has a "Measured outcome" section with the `lodPassCost` object from Task 1 Step 4 and from Task 2 Step 9, on the same machine.
- [ ] If `msPerPass` did not improve, the section says so plainly and states that the change was kept for the rect count alone, or that it was reverted. Do not report an improvement the numbers do not show.

**Verify:** `git diff --stat HEAD~1` shows only `README.md` and the design doc, and `grep -c "Measured outcome" docs/superpowers/specs/2026-09-08-lod-ranking-design.md` → `1`

**Steps:**

- [ ] **Step 1: Update the README**

In `README.md`, in the "How the level of detail works" section, add these two paragraphs after the paragraph that ends "The slot in last place thus stays stable while you pan."

```markdown
The pass reads one rect, not one per slot. A slot's box inside the world does
not move when the world pans or zooms, so each slot holds its world box and the
pass turns it into screen space by arithmetic. Four things measure the slots
again: a slot mounts, a slot unmounts, a card drag ends, or the world resizes.

A slot that had a pointer down on it in the last `DC.stickyMs` (4 s) sorts
first, so a card you drag or rename does not drop under you. The mark wins the
budget, not the margin — pan more than `DC.unmountMargin` px away and the slot
still drops. A pointer down inside a live iframe never reaches the page, so the
mark covers the grip, the header and the ⋯ menu only.
```

- [ ] **Step 2: Record the numbers**

Append this section to `docs/superpowers/specs/2026-09-08-lod-ranking-design.md`, before the "Not doing" heading. Fill in the real objects from Task 1 Step 4 and Task 2 Step 9.

```markdown
## Measured outcome

`dcBench.lodPassCost()` on the sample, same machine, same viewport:

| | before | after |
|---|---|---|
| slots | 10 | 10 |
| `slotRectsPerPass` | 10 | 0 |
| `msPerPass` | … | … |

The rect count is the number the change was made for, and it is exact. The
millisecond number is indicative: a pass over a clean layout is cheap whatever
it reads, so a small difference here is not evidence either way. What the change
removes is the layout read from N `content-visibility:auto` subtrees on a 500 ms
poll that runs for the life of the page, and that cost grows with the slot count
while the poll does not.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-08-lod-ranking-design.md
git commit -m "Record the ranking measurements"
```

---

## Self-review

**Spec coverage.** C1 needs no work and the spec says so. C2 is Task 1 (measure) and Task 2 (change). C3 is Task 3. The spec's "measure before and after, and record the outcome" is Task 4. Both "Not doing" items produce no task, by design.

**Placeholders.** Every step carries the code it needs. The only blank is the `msPerPass` pair in Task 4, which is a measurement that cannot exist before the work runs; the step says exactly where each number comes from.

**Type consistency.** `dcLodInvalidate` is defined in Task 2 Step 3 and used in Steps 6a, 6b, 6c and 6d. `dcSetCamera(world, scale)` is defined in Step 5 and called in the same step. `dcTouch` is defined in Task 3 Step 4 and registered in Step 6. The entry fields `wx`, `wy`, `ww`, `wh`, `gen` are written and read in `dcLodRun` alone; `touchedAt` is written in `dcTouch` and read in `dcLodRun`. `dcSetZoom` is removed in Task 2 Step 5 and has no other caller — `perf/bench.js` reads `dcLod.scale`, which `dcSetCamera` still writes.

**Risk.** A missed invalidation leaves a stale world box, which ranks a slot from where it used to be. The four call sites cover every way a slot moves today. The failure is a wrong ranking for one pass, not a wrong render, and the next real invalidation clears it.
