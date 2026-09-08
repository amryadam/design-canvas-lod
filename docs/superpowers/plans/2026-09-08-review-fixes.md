# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the review of the merges `7276996..7a7280b` on `main`: 10 correctness bugs, 7 speed items, 10 complexity items, and 5 defects from the two merges that landed mid-review.

**Architecture:** Four phases, each merged to `main` on its own. Phase 1 fixes bugs with a regression check for each. Phase 2 removes the hot paths the bench does not cover. Phase 3 lands tests, docs and the small complexity items. Phase 4 does the four large refactors last, each behind the green suite. All work is in `design-canvas.jsx`, `canvas-page.jsx`, `tests/regressions.js`, `perf/bench.js`, and the docs.

**Tech Stack:** React 18 UMD + Babel standalone (no build step), plain browser tests in `tests/regressions.html`, headless Chrome driven over the DevTools protocol by a Node 26 script (built-in `WebSocket`).

**Spec:** The review findings in this conversation. The perf spec `docs/superpowers/specs/2026-09-08-canvas-performance-design.md` and its plan `docs/superpowers/plans/2026-09-08-canvas-performance.md` are the background for the LOD, moving-flag and zoom-variable rules.

## Context

A review of the six merges on `main` (dev persistence merge, canvas performance work, canvas review fixes, zoom anchor fix, world-units layout, section head fix, LOD moving-guard fix) found real defects. The suite `tests/regressions.html` passes 15 of 15 in headless Chrome, so none of the bugs has a test. The user asked for a plan that fixes all findings and executes it.

## Global Constraints

- **Work in a new worktree.** `git worktree add ../design-canvas-lod-wt/review-fixes -b feature/review-fixes main`. Never edit `/Users/amryadam/Github/design-canvas-lod` directly: another session holds 488 uncommitted lines there.
- **The suite must stay green after every task.** Run `node tests/run.mjs` (Task 0 adds it). Its output must end with `PASS: canvas regressions` and no `FAIL` line.
- **Every bug fix ships with a check in `tests/regressions.js`** that fails before the fix and passes after. Run the check before the fix and record the failure text in the commit body when it is not obvious.
- **The world's layout must not read `--dc-inv-zoom`.** The check "the world layout does not read the zoom" enforces this. No new CSS in the world flow may use the variable.
- **`DC.movingMs` must stay greater than `DC.settleMs`.** The wheel-roll check enforces this.
- **No per-frame DOM reads on the pan or zoom path** other than the ones a task explicitly keeps. `flushNow` writes one transform and arms timers; nothing else.
- **Commit messages** follow `~/.claude/CLAUDE.md`: imperative subject of at most 50 characters, no trailing period, body only when the subject leaves a "why".
- **Prose in comments, docs and commits is ASD-STE100 Simplified Technical English.**
- **Merge each phase into `main` with `git merge --no-ff`** from the worktree branch after the suite is green, then continue on the same branch. If `main` moved, rebase the branch on `main` first and run the suite again.

**User decisions (already made):**
- "New worktree off main": all edits happen in `../design-canvas-lod-wt/review-fixes` on branch `feature/review-fixes`.
- "All, refactors last": the four large refactors are Phase 4 and come after Phases 1 to 3 are merged.
- "Yes, include them": the section head and focus modal defects from `bad4ffb` and `7a7280b` are in scope (Phase 1b).

---

## File map

| File | Role in this plan |
|---|---|
| `tests/run.mjs` | New. Headless runner: serves the repo, opens `tests/regressions.html`, prints the results. |
| `tests/regressions.js` | One new check per bug; timing waits read `DC` constants. |
| `design-canvas.jsx` | Moving flag, LOD registry, `DCStateCanvas`, `DCViewport`, `DCSection`, `dcDragSession`, `DCArtboardFrame`, `DCFocusOverlay`, CSS. Most tasks touch it. |
| `canvas-page.jsx` | `cfRoute` sampling, `CanvasFlows` world lookup and observer churn, `CanvasPage` element memo. |
| `perf/bench.js` | Fail loudly when `cfMeasure` is not patchable; drop the world fallback. |
| `README.md`, `docs/superpowers/plans/2026-09-08-canvas-performance.md`, `docs/superpowers/specs/2026-09-08-canvas-performance-design.md` | Doc drift. |

---

## Phase 0: Runner

### Task 0: Headless test runner

**Goal:** One command runs the browser suite and prints PASS/FAIL per check, so every later task can verify itself.

**Files:**
- Create: `tests/run.mjs`
- Modify: `README.md` (the "Tests" paragraph near line 104)

**Acceptance Criteria:**
- [ ] `node tests/run.mjs` starts `python3 -m http.server` on a free port, opens `tests/regressions.html` in headless Chrome, waits for `window.canvasTestsDone`, prints one line per check, and exits 0 on all PASS and 1 otherwise.
- [ ] The Chrome profile lives under `tests/.chrome-profile/` and that path is in `.gitignore`.
- [ ] The tab is visible to Chrome (headless new mode reports `document.visibilityState === 'visible'`), so `requestAnimationFrame` runs.

**Verify:** `node tests/run.mjs` → last line `PASS: canvas regressions`, exit code 0.

**Steps:**

- [ ] **Step 1: Write the runner**

```js
// tests/run.mjs — run tests/regressions.html in headless Chrome and print the
// results. Node 26+ (built-in WebSocket). Usage: node tests/run.mjs [chrome-path]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.argv[2] || process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const httpPort = await freePort(), dbgPort = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(httpPort)], { cwd: root, stdio: 'ignore' });
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900',
  '--user-data-dir=' + path.join(root, 'tests', '.chrome-profile'),
  '--remote-debugging-port=' + dbgPort, 'about:blank',
], { stdio: 'ignore' });
const stop = (code) => { chrome.kill(); server.kill(); process.exit(code); };

let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json(); } catch {}
  if (!targets.length) await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('no page target'); stop(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/tests/regressions.html` });
const res = await send('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    for (let i = 0; i < 300 && !window.canvasTestsDone; i++) await new Promise((r) => setTimeout(r, 100));
    const results = await Promise.race([window.canvasTestsDone, new Promise((r) => setTimeout(() => r(null), 180000))]);
    return { title: document.title, visibility: document.visibilityState, results };
  })()`,
});
const v = res.result && res.result.result && res.result.result.value;
if (!v || !v.results) { console.error('suite did not finish', JSON.stringify(res).slice(0, 400)); stop(2); }
for (const r of v.results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : ' :: ' + r.error));
console.log('visibility=' + v.visibility);
console.log(v.title);
stop(v.results.every((r) => r.pass) ? 0 : 1);
```

- [ ] **Step 2: Add `tests/.chrome-profile/` to `.gitignore`** (create the file if missing).

- [ ] **Step 3: Run it**

Run: `node tests/run.mjs`
Expected: 15 PASS lines, `visibility=visible`, `PASS: canvas regressions`, exit 0.

- [ ] **Step 4: README** — replace the sentence that tells the reader to open the page by hand with: "Run `node tests/run.mjs` to run the suite in headless Chrome. It prints one line per check and exits 1 on a failure. A hidden browser tab pauses `requestAnimationFrame`, so two checks fail there; the runner keeps the page visible."

- [ ] **Step 5: Commit**

```bash
git add tests/run.mjs .gitignore README.md
git commit -m "Add a headless runner for the regression suite"
```

---

## Phase 1: Bugs

### Task 1: One owner for the moving flag and a drag that always ends

**Goal:** `dcMoving()` and the `.dc-moving` class always agree, and a card drag releases the LOD registry when the pointer is lost.

**Files:**
- Modify: `design-canvas.jsx` — the block `let dcMovingTimer … function dcMarkMoving`, `dcDragSession`, `onMoveDown`, `onGripDown`, the window publish list at the end
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] A grip drag that ends with `window` `blur` (pointer left the window and was released outside) leaves `dcMoving() === false` and no `.dc-moving` class.
- [ ] A pan followed within `DC.movingMs` by a grip drag keeps `.dc-moving` on the viewport for the whole drag.
- [ ] The only code that writes `classList` for `dc-moving` is `dcSyncMoving`.
- [ ] `onMoveDown` and `onGripDown` store the cancel function and call it on unmount.
- [ ] `dcMoving` is on `window` for the tests.

**Verify:** `node tests/run.mjs` → the two new checks PASS and all earlier checks PASS.

**Steps:**

- [ ] **Step 1: Write the failing checks** (append before the `document.title =` line in `tests/regressions.js`)

```js
  async function dragFixture(name) {
    window.fetch = async () => new Response('', { status: 404 });
    draw(name, E(DCSection, { id: 'review', positions: { A: { x: 0, y: 0 }, B: { x: 400, y: 0 } } },
      E(DCArtboard, { id: 'A', width: 200, height: 200 }), E(DCArtboard, { id: 'B', width: 200, height: 200 })));
    await until(() => host.querySelector('[data-dc-slot] .dc-grip'));
    await wait(DC.rescueMs + 200);
    const vp = host.querySelector('.design-canvas');
    const grip = host.querySelector('[data-dc-slot="A"] .dc-grip');
    const r = grip.getBoundingClientRect();
    const at = (type, x, y, target = grip) => target.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    return { vp, grip, r, at };
  }
  await test('a lost pointer ends the card drag', async () => {
    const { vp, r, at } = await dragFixture('review-lostdrag.json');
    at('pointerdown', r.left + 4, r.top + 4);
    at('pointermove', r.left + 60, r.top + 60, document);
    check(dcMoving(), 'the drag did not set the moving flag');
    window.dispatchEvent(new Event('blur'));
    await wait(50);
    check(!dcMoving(), 'dcMoving() stayed true after the pointer was lost');
    check(!vp.classList.contains('dc-moving'), '.dc-moving stayed on after the pointer was lost');
  });
  await test('a pan timer does not strip .dc-moving from a running drag', async () => {
    const { vp, r, at } = await dragFixture('review-pandrag.json');
    vp.dispatchEvent(new WheelEvent('wheel', { deltaX: 3.5, deltaY: 0, deltaMode: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    await wait(20);
    at('pointerdown', r.left + 4, r.top + 4);
    at('pointermove', r.left + 60, r.top + 60, document);
    await wait(DC.movingMs + 60);
    check(vp.classList.contains('dc-moving'), 'the pan timer removed .dc-moving mid-drag');
    at('pointerup', r.left + 60, r.top + 60, document);
    await wait(DC.movingMs + 60);
    check(!dcMoving() && !vp.classList.contains('dc-moving'), 'the flag or class stayed on after the drop');
  });
```

- [ ] **Step 2: Run** `node tests/run.mjs` → both new checks FAIL (`dcMoving is not defined` first; after Step 3's publish, the real failures).

- [ ] **Step 3: Replace the moving-flag block** in `design-canvas.jsx`. First add `rescueMs: 500,        // after the fit: if no slot is on screen, nudge slot 0 into view` to `DC` after `mountGapMs` and use it in the rescue `setTimeout` (the fixture above waits on it; Task 2 changes the rescue body).

```js
// Shared "is the world moving" flag. Two sources set it: a pan or a zoom arms
// dcMarkMoving, which clears itself after DC.movingMs; a card drag holds
// dcDragDepth for the length of the gesture. dcMoving() reads both.
// The .dc-moving class drives CSS only (live iframes lose pointer events).
// dcSyncMoving is the one writer of that class: it copies dcMoving() onto every
// viewport, so the class can never disagree with the flag.
let dcMovingTimer = 0;
let dcDragDepth = 0;
const dcMoving = () => dcMovingTimer !== 0 || dcDragDepth > 0;
function dcSyncMoving() {
  const on = dcMoving();
  document.querySelectorAll('.design-canvas').forEach((vp) => vp.classList.toggle('dc-moving', on));
}
function dcMarkMoving() {
  clearTimeout(dcMovingTimer);
  dcMovingTimer = setTimeout(() => { dcMovingTimer = 0; dcSyncMoving(); dcLodSchedule(); }, DC.movingMs);
  dcSyncMoving();
}
```

Update the two callers: `dcMarkMoving(vpRef.current)` and `dcMarkMoving(vp)` in `DCViewport` become `dcMarkMoving()`.

- [ ] **Step 4: Rewrite `dcDragSession`**

```js
// One pointer drag on a slot. Reports pointer deltas in world px (screen px ÷
// zoom) and cleans up on release, cancel, lost capture or a window blur, so a
// pointer released outside the window cannot hold dcDragDepth for ever.
// `keepMoving` keeps the moving flag armed for DC.movingMs after the drop, so
// the drop animation runs with iframes still inert.
// Returns a cancel function for unmounts.
function dcDragSession(e, me, { move, up, keepMoving }) {
  e.preventDefault(); e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  // One rect and one offsetWidth per event: both are reads, so they share one
  // forced layout.
  const measure = () => { const r = me.getBoundingClientRect(); return { r, z: r.width / me.offsetWidth || 1 }; };
  const scale = measure().z;
  me.classList.add('dc-dragging');
  try { me.setPointerCapture(e.pointerId); } catch {}
  dcDragDepth++; dcSyncMoving();
  const onMove = (ev) => {
    const { r, z } = measure();
    move((ev.clientX - sx) / scale, (ev.clientY - sy) / scale, scale, { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z });
  };
  let done = false;
  const finish = (cancelled) => {
    if (done) return; done = true;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    me.removeEventListener('lostpointercapture', onCancel);
    window.removeEventListener('blur', onCancel);
    try { me.releasePointerCapture(e.pointerId); } catch {}
    me.classList.remove('dc-dragging');
    dcDragDepth = Math.max(0, dcDragDepth - 1);
    if (keepMoving) dcMarkMoving(); else dcSyncMoving();
    dcLodSchedule();
    up(scale, cancelled);
  };
  const onUp = () => finish(false), onCancel = () => finish(true);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  me.addEventListener('lostpointercapture', onCancel);
  window.addEventListener('blur', onCancel);
  return onCancel;
}
```

Note the `up` signature lost the `vp` argument. In `onGripDown`'s `up`, remove `vp && vp.classList.remove('dc-moving');` and change `up: (scale, vp) =>` to `up: (scale) =>`. In `canvas-page.jsx`, `CanvasFlows`'s `up: () => {...}` takes no arguments, so nothing changes there.

`lostpointercapture` fires on a normal `releasePointerCapture` too, but `finish` runs first and sets `done`, so the second call returns at once.

- [ ] **Step 5: Keep the cancel function in the frame**

In `DCArtboardFrame`, add `const cancelDrag = React.useRef(null);` next to `menuRef`, and add
```js
  React.useEffect(() => () => { cancelDrag.current && cancelDrag.current(); }, []);
```
Then in `onMoveDown` and `onGripDown`, write `cancelDrag.current = dcDragSession(e, me, {...})` and set `cancelDrag.current = null` at the start of each `up`.

- [ ] **Step 6: Publish `dcMoving`** — add `dcMoving` to the `Object.assign(window, {...})` list at the end of `design-canvas.jsx`.

- [ ] **Step 7: Run** `node tests/run.mjs` → all PASS.

- [ ] **Step 8: Commit**

```bash
git add design-canvas.jsx tests/regressions.js
git commit -m "Give the moving flag one owner and end lost drags" -m "dcDragDepth had no release path for a pointer let go outside the window, so the LOD registry froze for the page lifetime. The class was written from three places and drifted from the flag."
```

### Task 2: The rescue respects a restored view and the viewport box

**Goal:** The 500 ms rescue nudge does not overwrite a saved pan, and it judges "on screen" against the viewport, not the window.

**Files:**
- Modify: `design-canvas.jsx` — `DC` (add `rescueMs`), the `rescue` timer in `DCViewport`'s fit effect
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] With a saved view whose pan puts every slot off screen, the transform after `DC.rescueMs + 200` ms equals the saved one.
- [ ] `DC.rescueMs` (500) replaces the literal `500`.

**Verify:** `node tests/run.mjs` → new check PASS.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('the rescue nudge keeps a restored pan', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: -5000, y: -5000, scale: 1 }));
    draw('review-rescue.json', E(DCSection, { id: 'review', title: 'Rescue' }, E(DCArtboard, { id: 'a', width: 300, height: 200 })));
    await until(() => host.querySelector('[data-dc-slot]'));
    await wait(DC.rescueMs + 200);
    const world = host.querySelector('[data-dc-world]');
    check(world.style.transform === 'translate3d(-5000px, -5000px, 0) scale(1)', 'the rescue moved a restored view: ' + world.style.transform);
  });
```

- [ ] **Step 2: Run** → FAIL with "the rescue moved a restored view".

- [ ] **Step 3: Fix** — add `rescueMs: 500,        // after the fit: if no slot is on screen, nudge slot 0 into view` to `DC` after `mountGapMs`. Replace the rescue:

```js
    const rescue = setTimeout(() => {
      // A restored view is the user's choice, even one with nothing on screen.
      if (restoredView.current) return;
      const slots = worldRef.current.querySelectorAll('[data-dc-slot]');
      if (!slots.length) return;
      const v = vpRef.current.getBoundingClientRect();
      for (const el of slots) { const r = el.getBoundingClientRect(); if (r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom) return; }
      const r = slots[0].getBoundingClientRect(); const t = tf.current;
      t.x += v.left + 60 - r.left; t.y += v.top + 100 - r.top; apply(true);
    }, DC.rescueMs);
```

- [ ] **Step 4: Run** → PASS. Also replace `await wait(700); // past the first fit, its 500 ms rescue…` in the anchor check with `await wait(DC.rescueMs + 200);`.

- [ ] **Step 5: Commit** `git commit -am "Keep a restored pan through the rescue nudge"`.

### Task 3: The LOD registry ranks against the viewport

**Goal:** `dcLodRun` measures nearness and distance against each slot's own viewport box, not `innerWidth`/`innerHeight`.

**Files:**
- Modify: `design-canvas.jsx` — `dcSlotDistance`, `dcLodRun`, `dcLodSubscribe` entry shape, `DCLazyFrame` subscribe call
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] A 400 × 400 viewport at the top-left of a 1280 px window with a row of `DC.liveBudget + 6` slots makes live exactly the slots nearest to the viewport centre (200, 200), not the window centre.
- [ ] `innerWidth`/`innerHeight` appear nowhere in the registry.

**Verify:** `node tests/run.mjs` → new check PASS; "live iframes stay inside the budget" still PASS.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('the LOD budget ranks against the viewport, not the window', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 6, boards = [];
    for (let i = 0; i < count; i++) boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 300, height: 200 },
      E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 300, height: 200 })));
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    draw('review-lodvp.json', E(DCSection, { id: 'review', title: 'LOD', gap: 20 }, boards),
      { style: { position: 'fixed', top: 0, left: 0, width: 400, height: 400 } });
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(600);
    const live = [...host.querySelectorAll('[data-dc-slot]')].filter((s) => s.querySelector('iframe')).map((s) => s.dataset.dcSlot);
    // Slot b0 sits at x 60 in the viewport; it is the nearest to (200, 200) and must be live.
    check(live.includes('b0'), 'the nearest slot to the viewport centre is not live: ' + live.join(','));
    const far = 'b' + (DC.liveBudget + 5);
    check(!live.includes(far), 'a slot far from the viewport is live because it is near the window centre');
  });
```

- [ ] **Step 2: Run** → FAIL (window centre at 640 ranks slots right of the 400 px viewport ahead of `b0`).

- [ ] **Step 3: Fix** — the entry gets its viewport, and one pass reads one rect per viewport:

```js
function dcSlotDistance(r, v) {
  const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
  const dx = Math.max(r.left - cx, 0, cx - r.right);
  const dy = Math.max(r.top - cy, 0, cy - r.bottom);
  return Math.hypot(dx, dy);
}
```
In `dcLodRun`, before the loop: `const vpRects = new Map();` and inside:
```js
    const vp = s.vp;
    let v = vpRects.get(vp);
    if (!v) { v = vp ? vp.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight }; vpRects.set(vp, v); }
    const r = s.box.getBoundingClientRect();
    const m = s.live ? DC.unmountMargin : s.margin;
    const near = r.right > v.left - m && r.left < v.left + v.width + m && r.bottom > v.top - m && r.top < v.top + v.height + m;
    all.push({ s, near, d: dcSlotDistance(r, v) - (s.live ? DC.budgetHysteresis : 0) });
```
The fallback keeps the `{ left: 0, top: 0, width: innerWidth, height: innerHeight }` object as the one place the window size is read, for a slot outside any `.design-canvas`.

In `DCLazyFrame`: `const off = dcLodSubscribe({ box, vp: box.closest('.design-canvas'), margin, live: false, set: setLive });` and update the comment `// entry is { box, vp, margin, live, set }`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Rank the LOD budget against the viewport box"`.

### Task 4: A stalled state read does not blank the canvas for 5 s

**Goal:** The state-file fetch gives up after `DC.stateTimeoutMs` (1500), and the value lives in `DC`.

**Files:**
- Modify: `design-canvas.jsx` — `DC`, `DCStateCanvas` first effect
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] With a fetch that never resolves, the children render within `DC.stateTimeoutMs + 300` ms.
- [ ] "editing waits for restoration" still passes (a 250 ms delay still gates the children).

**Verify:** `node tests/run.mjs`.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('a hanging state read gives up after DC.stateTimeoutMs', async () => {
    window.fetch = (url, opts) => new Promise((resolve, reject) => { opts && opts.signal && opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
    draw('review-hang.json'); await wait(DC.stateTimeoutMs + 300);
    check(!!api, 'the canvas stayed blank past DC.stateTimeoutMs');
  });
```

- [ ] **Step 2: Run** → FAIL (the abort is at 5000 ms). **Step 3: Fix** — add `stateTimeoutMs: 1500,  // give up on the state file read; the browser copy then wins` to `DC` and use it in `setTimeout(() => controller.abort(), DC.stateTimeoutMs)`. The decision: keep the restoration gate (the suite locks it), shorten the wait. **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Give up on a stalled state read after 1.5 s"`.

### Task 5: A failed host write is not marked as saved

**Goal:** `savedSections` moves only after `writeFile` resolves; a failure is logged once and retried on the next write chance.

**Files:**
- Modify: `design-canvas.jsx` — the `write` closure in `DCStateCanvas`'s save effect
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] With `window.omelette.writeFile` that rejects, a following `pagehide` calls `writeFile` again with the same JSON.
- [ ] With `writeFile` that resolves, `pagehide` does not call it a second time.

**Verify:** `node tests/run.mjs`.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('a failed host write is retried on pagehide', async () => {
    const calls = [];
    window.omelette = { writeFile: async (file, json) => { calls.push(json); throw new Error('disk'); } };
    try {
      window.fetch = async () => json(envelope('file', 10));
      draw('review-writefail.json'); await until(() => api);
      api.patchSection('review', { title: 'edited' }); await wait(DC.saveDebounceMs + 100);
      check(calls.length === 1, 'first write did not run');
      window.dispatchEvent(new Event('pagehide')); await wait(50);
      check(calls.length === 2, 'the failed write was marked saved and not retried');
    } finally { delete window.omelette; }
  });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Fix** — add `saveDebounceMs: 400,   // wait after the last edit before the state file is written` to `DC`, and rewrite `write`:

```js
    const write = () => {
      clearTimeout(t);
      if (savedSections.current === state.sections) return;
      const mine = state.sections;
      fileWrites.current = fileWrites.current
        .then(() => window.omelette?.writeFile(stateFile, json))
        .then(() => { savedSections.current = mine; },
          (err) => { console.warn('[design-canvas] state file write failed; the browser copy holds the edits', err); });
    };
    const t = setTimeout(write, DC.saveDebounceMs);
```
Also replace `wait(450)` in "navigation before debounce retains browser edits" with `wait(DC.saveDebounceMs + 50)`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Mark the state file saved only after the write"`.

### Task 6: Arrow routing compares hit counts at one density

**Goal:** `cfRoute` samples the plain curve at the same density as the candidates.

**Files:**
- Modify: `canvas-page.jsx` — `cfRoute`, the publish list at the end
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] For A at (0,0) side `r`, B at (600,0) side `l`, and an obstacle `{x:250,y:-60,w:100,h:120}`, `cfHits(cfRoute(...), [obs], 96) < cfHits(cfCurve(...), [obs], 96)`.
- [ ] `cfRoute`, `cfCurve`, `cfHits` are published on `window`.

**Verify:** `node tests/run.mjs`.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('cfRoute picks a candidate that crosses less than the plain curve', async () => {
    const a = { x: 0, y: 0 }, b = { x: 600, y: 0 }, obs = [{ x: 250, y: -60, w: 100, h: 120 }];
    const plainHits = cfHits(cfCurve(a, 'r', b, 'l'), obs, 96);
    const routed = cfRoute(a, 'r', b, 'l', obs);
    check(plainHits > 0, 'fixture: the plain curve must cross the obstacle');
    check(cfHits(routed, obs, 96) < plainHits, 'cfRoute kept the plain curve although a clearer candidate exists');
  });
```
Check the real signature of `cfCurve` in `canvas-page.jsx` (`cfCurve(a, fs, b, ts, m)`) before writing the check; the `a`/`b` point shape is `{x, y}` as `cfRoute` passes them.

- [ ] **Step 2: Add `window.cfRoute = cfRoute; window.cfCurve = cfCurve; window.cfHits = cfHits;` under `window.CanvasFlows`**, run → FAIL ("kept the plain curve").

- [ ] **Step 3: Fix** — `let best = plain, bestHits = cfHits(plain, obstacles, CF_SAMPLES * 4);` and change the `cfHits` comment to "Every candidate is sampled at CF_SAMPLES * 4 so the counts compare; CF_SAMPLES alone is for the cheap first pass in cfMeasure."

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Sample the plain arrow at the candidate density"`.

### Task 7: Escape and blur listeners register once

**Goal:** The `keydown`/`pointerdown` effect in `DCStateCanvas` depends on `setFocus`, not `api`.

**Files:**
- Modify: `design-canvas.jsx` — the effect after `api`

**Acceptance Criteria:**
- [ ] The effect reads `setFocus(null)` and its dependency array is `[setFocus]`.

**Verify:** `node tests/run.mjs` all PASS (behaviour is unchanged; no new check).

**Steps:**
- [ ] Replace `api.setFocus(null)` with `setFocus(null)` and `[api]` with `[setFocus]`. Run the suite. Commit `git commit -am "Register the escape listener once per canvas"`.

### Task 8: `sizeCache` evicts removed slots

**Goal:** The per-slot size cache in `DCSection` drops keys that are not in `order`.

**Files:**
- Modify: `design-canvas.jsx` — `sizes` memo in `DCSection`

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] After the `order.forEach` in the `sizes` memo add `for (const k of [...cache.keys()]) if (!(k in out)) cache.delete(k);`. Run the suite. Commit `git commit -am "Evict removed slots from the size cache"`.

### Task 9: `CanvasFlows` finds its own world

**Goal:** `CanvasFlows` resolves the world it is rendered inside, not the first `[data-dc-world]` in the document.

**Files:**
- Modify: `canvas-page.jsx` — `CanvasFlows` world effect and return

**Acceptance Criteria:**
- [ ] `CanvasFlows` renders a zero-size probe `<span data-dc-flows-probe hidden />` in place and sets `world` from `probe.closest('[data-dc-world]')`.
- [ ] The three flow checks still pass.

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Add `const probe = React.useRef(null);`. Replace the world effect body with `const el = probe.current && probe.current.closest('[data-dc-world]'); if (el) setWorld(el);`. Change the two returns: `if (!world || !paths.length) return <span ref={probe} hidden />;` and wrap the portal: `return <>{<span ref={probe} hidden />}{ReactDOM.createPortal(...)}</>;`. Run the suite. Commit `git commit -am "Let CanvasFlows find the world it is rendered in"`.

### Merge Phase 1

- [ ] `node tests/run.mjs` → all PASS. `git checkout main && git merge --no-ff feature/review-fixes -m "Merge the review bug fixes" && git checkout feature/review-fixes`. If `main` moved, rebase first and rerun.

---

## Phase 1b: Section head and focus modal

### Task 10: The section head never clips or covers a neighbour

**Goal:** Cap the section head's counter-scale so the grown head always fits in the space above it.

**Files:**
- Modify: `design-canvas.jsx` — `.dc-sectionhead` CSS and its comment; `DC` gets `sectionHeadMax`
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] With `--dc-inv-zoom` forced to `4` on the world, the first section head's top is at or below the world's top, and the second section head's top is at or below the first section's row bottom.
- [ ] The cap is `1.75`: the head grows up to 1.75× before it follows the world. At 1.75 × a 95 px head, the growth is 71 px, under the 72 px world top padding and the 80 px section gap.

**Verify:** `node tests/run.mjs`.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('a grown section head stays inside its gap', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    draw('review-heads.json', [
      E(DCSection, { key: 'a', id: 'a', title: 'First', subtitle: 'With a subtitle' }, E(DCArtboard, { id: 'a1', width: 300, height: 200 })),
      E(DCSection, { key: 'b', id: 'b', title: 'Second', subtitle: 'With a subtitle' }, E(DCArtboard, { id: 'b1', width: 300, height: 200 })),
    ]);
    await until(() => host.querySelectorAll('.dc-sectionhead').length === 2);
    await wait(DC.rescueMs + 200);
    const world = host.querySelector('[data-dc-world]');
    world.style.setProperty('--dc-inv-zoom', '4'); void world.offsetHeight;
    const [h1, h2] = host.querySelectorAll('.dc-sectionhead');
    const row1 = host.querySelector('[data-dc-section="a"] [data-dc-row]');
    check(h1.getBoundingClientRect().top >= world.getBoundingClientRect().top - 0.5, 'the first head grew above the world top');
    check(h2.getBoundingClientRect().top >= row1.getBoundingClientRect().bottom - 0.5, 'the second head covers the first section cards');
  });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Fix** — CSS: `.dc-sectionhead{transform:scale(min(var(--dc-inv-zoom,1),1.75));transform-origin:bottom left}` and rewrite the comment: "The section head follows the same rule by transform, not by zoom, so the world's layout stays free of the zoom. It grows from its bottom edge, upwards into the gap above it. The cap of 1.75 keeps a 95 px head (title, margin, subtitle, padding) inside the 72 px world top padding and the 80 px section gap. Below 57 % zoom the head follows the world." **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Cap the section head growth to its gap"`.

### Task 11: The focus modal rail, arrows, dismiss and delete

**Goal:** Fix the five focus-modal defects: rail width from one constant, arrows beside the screen, click-outside on the letterbox, a pin that survives navigation, and a delete confirm that disarms.

**Files:**
- Modify: `design-canvas.jsx` — `.dc-shell-body`, `.dc-rail`, `.dc-shell.dc-rail-off .dc-rail` CSS; `DCFocusOverlay`; a module-level `DCFocusArrow`; `dcExportName`; remove `.dc-focus .dc-chips` and `.dc-rail .dc-chips`
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] `.dc-shell` carries `style={{ '--dc-rail': DC.rail + 'px' }}` and the CSS reads `var(--dc-rail)` in the three places `320px` was.
- [ ] `.dc-shell-body` padding is `28px 64px`; the arrows sit at `[dir]: 10` (44 px wide, so they end at 54 px, inside the 64 px padding). `fitTo` subtracts 128 instead of 80.
- [ ] A click on `.dc-shell-body` itself (not a child) closes the modal.
- [ ] `pin` resets on a window resize, not on `auto`.
- [ ] `confirming` resets on any `pointerdown` outside the delete button and after 4 s.
- [ ] `dcExportName(label, id)` is the one filename helper, keeps Unicode letters, and is used in the card menu and the rail.
- [ ] `DCFocusArrow` is declared at module level.
- [ ] The screen box transitions `width, height .18s ease` so it slides with the rail.

**Verify:** `node tests/run.mjs` → the new checks PASS.

**Steps:**

- [ ] **Step 1: Failing checks**

```js
  async function focusFixture() {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-focus.json', E(DCSection, { id: 'review', title: 'Focus' },
      E(DCArtboard, { id: 'wide', label: 'صفحة عربية', width: 1440, height: 400 }), E(DCArtboard, { id: 'tall', width: 390, height: 800 })));
    await until(() => api);
    api.setFocus('review/wide'); await until(() => document.querySelector('.dc-shell'));
    await wait(50);
    return document.querySelector('.dc-focus');
  }
  await test('the focus modal letterbox click closes it', async () => {
    await focusFixture();
    document.querySelector('.dc-shell-body').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await until(() => !document.querySelector('.dc-shell'));
  });
  await test('the focus arrows do not cover the screen', async () => {
    const overlay = await focusFixture();
    const screen = overlay.querySelector('.dc-shell-body > div').getBoundingClientRect();
    overlay.querySelectorAll('.dc-shell-body > button').forEach((b) => {
      const r = b.getBoundingClientRect();
      check(r.right <= screen.left + 0.5 || r.left >= screen.right - 0.5, 'an arrow overlaps the screen');
    });
    api.setFocus(null);
  });
  await test('an Options pin survives arrow navigation', async () => {
    const overlay = await focusFixture();
    const opt = [...overlay.querySelectorAll('.dc-opt')].find((b) => b.textContent === 'Options');
    const before = document.querySelector('.dc-shell').classList.contains('dc-rail-off');
    opt.click(); await wait(20);
    check(document.querySelector('.dc-shell').classList.contains('dc-rail-off') !== before, 'the Options button did nothing');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await wait(50);
    check(document.querySelector('.dc-shell').classList.contains('dc-rail-off') !== before, 'navigation dropped the pin');
    api.setFocus(null);
  });
  await test('the rail delete confirm disarms on an outside click', async () => {
    const overlay = await focusFixture();
    const del = [...overlay.querySelectorAll('.dc-row.dc-danger')][0];
    del.click(); await wait(20);
    check(del.textContent === 'Click again to delete', 'delete did not arm');
    overlay.querySelector('.dc-rail h4').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await wait(20);
    check(del.textContent === 'Delete page', 'delete stayed armed after an outside click');
    api.setFocus(null);
  });
  await test('export names keep non-Latin letters', async () => {
    check(dcExportName('صفحة عربية', 'x') === 'صفحة عربية', 'Arabic label collapsed: ' + dcExportName('صفحة عربية', 'x'));
    check(dcExportName('a/b:c', 'x') === 'a_b_c', 'separators kept');
  });
```

- [ ] **Step 2: Run** → the five checks FAIL (the last with `dcExportName is not defined`).

- [ ] **Step 3: Fix**

CSS: `.dc-shell-body{…padding:28px 64px;…}`, `.dc-rail{…width:var(--dc-rail);flex:0 0 var(--dc-rail);…}`, `.dc-shell.dc-rail-off .dc-rail{margin-right:calc(-1 * var(--dc-rail))}`. Delete the `.dc-focus .dc-chips` and `.dc-rail .dc-chips` rules.

Module level, above `DCFocusOverlay`:
```js
// Export file name: the label, or the id, with path and shell separators
// replaced. \p{L}\p{N} keeps Arabic and every other script.
const dcExportName = (label, id) => String(label || id || 'artboard').replace(/[^\p{L}\p{N}\s.-]+/gu, '_');
function DCFocusArrow({ dir, onClick }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ position: 'absolute', top: '50%', [dir]: 10, transform: 'translateY(-50%)', border: 'none', background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.9)', width: 44, height: 44, borderRadius: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={dir === 'left' ? 'M11 3L5 9l6 6' : 'M7 3l6 6-6 6'} /></svg>
    </button>
  );
}
```
In `DCArtboardFrame`'s two Download buttons and in the overlay's `fileName`, call `dcExportName(label, id)` / `dcExportName(label, aid)`.

In `DCFocusOverlay`:
- `const sOpen = fitTo(shellW - DC.rail - 128), sShut = fitTo(shellW - 128);`
- Replace the `lastAuto` effect with `React.useEffect(() => { setPin(null); }, [vp.w, vp.h]);` and delete `lastAuto`.
- Delete confirm:
```js
  const delRef = React.useRef(null);
  React.useEffect(() => {
    if (!confirming) return;
    const off = (e) => { if (!delRef.current || !delRef.current.contains(e.target)) setConfirming(false); };
    const t = setTimeout(() => setConfirming(false), 4000);
    document.addEventListener('pointerdown', off, true);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', off, true); };
  }, [confirming]);
```
  and `ref={delRef}` on the delete button. Keep the `[aid]` reset.
- `<div className={'dc-shell' …} style={{ '--dc-rail': DC.rail + 'px' }} onClick={(e) => e.stopPropagation()}>`.
- `<div className="dc-shell-body" onClick={(e) => { if (e.target === e.currentTarget) ctx.setFocus(null); }}>`.
- The screen box: `style={{ width: width * scale, height: height * scale, position: 'relative', transition: 'width .18s ease, height .18s ease' }}`.
- Replace `<Arrow …>` with `<DCFocusArrow …>` and delete the inner `Arrow`.
- Publish `dcExportName` on `window`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Fix the focus rail width, arrows, dismiss and delete"`.

### Merge Phase 1b

- [ ] Suite green, then `git checkout main && git merge --no-ff feature/review-fixes -m "Merge the section head and focus modal fixes" && git checkout feature/review-fixes`.

---

## Phase 2: Speed

### Task 12: The lost-pill check reads no rects per frame

**Goal:** While the pill is up, `flushNow` tests a cached world-space content box against the viewport with arithmetic on `tf`; rects are read only on settle.

**Files:**
- Modify: `design-canvas.jsx` — `DCViewport`: `checkLost`, `flushNow`, a new `lostBox` ref
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] `flushNow` calls no `getBoundingClientRect` and no `querySelectorAll` on the lost path.
- [ ] Panning back so a slot enters the viewport hides the pill in the same frame (the existing behaviour).
- [ ] New check: pan far away, wait for the pill, count `Element.prototype.getBoundingClientRect` calls during 10 wheel pans, expect 0.

**Verify:** `node tests/run.mjs`.

**Steps:**

- [ ] **Step 1: Failing check**

```js
  await test('the lost pill costs no rect reads per frame', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-lostcost.json', E(DCSection, { id: 'review', title: 'Lost' }, E(DCArtboard, { id: 'a', width: 300, height: 200 })));
    await until(() => host.querySelector('[data-dc-slot]')); await wait(DC.rescueMs + 200);
    const vp = host.querySelector('.design-canvas');
    const pan = (dx) => vp.dispatchEvent(new WheelEvent('wheel', { deltaX: dx + 0.001, deltaY: 0.001, deltaMode: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    pan(6000); await until(() => host.querySelector('.dc-backto'));
    const orig = Element.prototype.getBoundingClientRect; let reads = 0;
    Element.prototype.getBoundingClientRect = function () { reads++; return orig.call(this); };
    try { for (let i = 0; i < 10; i++) { pan(5); await new Promise((r) => requestAnimationFrame(r)); } }
    finally { Element.prototype.getBoundingClientRect = orig; }
    check(reads === 0, reads + ' rect reads during 10 frames with the pill up');
    check(host.querySelector('.dc-backto'), 'the pill went away while still off content');
  });
```

- [ ] **Step 2: Run** → FAIL (about 30 reads). **Step 3: Fix**

Add `const lostBox = React.useRef(null); const vpSize = React.useRef({ w: 0, h: 0 });` and rewrite `checkLost` to also cache the world-space box when lost:
```js
  const checkLost = React.useCallback(() => {
    const vp = vpRef.current, w = worldRef.current; if (!vp || !w) return;
    const els = boxes(vp);
    let next = els.length > 0;
    const r = vp.getBoundingClientRect(), s = tf.current.scale;
    vpSize.current = { w: r.width, h: r.height };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) { next = false; break; }
      // World-space box of the content, for the per-frame test in flushNow.
      x0 = Math.min(x0, (b.left - r.left - tf.current.x) / s); y0 = Math.min(y0, (b.top - r.top - tf.current.y) / s);
      x1 = Math.max(x1, (b.right - r.left - tf.current.x) / s); y1 = Math.max(y1, (b.bottom - r.top - tf.current.y) / s);
    }
    lostBox.current = next ? { x0, y0, x1, y1 } : null;
    if (lostRef.current !== next) { lostRef.current = next; setLost(next); }
  }, []);
```
In `flushNow`, replace `if (lostRef.current) checkLost();` with:
```js
    // With the pill up, test the cached content box with arithmetic only.
    if (lostRef.current && lostBox.current) {
      const b = lostBox.current, v = vpSize.current;
      const onScreen = b.x1 * scale + x > 0 && b.x0 * scale + x < v.w && b.y1 * scale + y > 0 && b.y0 * scale + y < v.h;
      if (onScreen) { lostRef.current = false; lostBox.current = null; setLost(false); }
    }
```
The settle timer still calls `checkLost`, which re-reads rects once per gesture.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -am "Test the lost pill with arithmetic per frame"`.

### Task 13: Host messages go out on settle, and only when embedded

**Goal:** `__dc_zoom` posts once per settled gesture; no post happens when `window.parent === window`.

**Files:**
- Modify: `design-canvas.jsx` — `flushNow`, `writeInv` (rename to `settle`), the two `__dc_present` posts

**Acceptance Criteria:**
- [ ] A `dcEmbedded` constant `typeof window !== 'undefined' && window.parent !== window` guards every `window.parent.postMessage`.
- [ ] The `__dc_zoom` post moves into the settle callback next to the `--dc-inv-zoom` write.
- [ ] "the settled --dc-inv-zoom write holds the zoom anchor" still passes (it uses `__dc_set_zoom` inbound, which is unchanged).

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Add `const dcEmbedded = typeof window !== 'undefined' && window.parent !== window;` after `DCCtx`. Rename `writeInv` to `onSettle` and append inside it, after the variable write:
```js
    if (dcEmbedded && lastPostedScale.current !== tf.current.scale) {
      lastPostedScale.current = tf.current.scale;
      window.parent.postMessage({ type: '__dc_zoom', scale: tf.current.scale }, '*');
    }
```
  Remove the post block from `flushNow`. Guard the two `__dc_present` posts with `if (dcEmbedded)`. Move `if (lastInv.current === inv) return;` so the post still runs when only the post is stale (`__dc_probe` resets `lastPostedScale`): compute `inv`, write it only if changed, then post if changed. Run the suite. Commit `git commit -am "Post the zoom to the host once per settled gesture"`.

### Task 14: The LOD poll pauses when hidden and the observer is released

**Goal:** No forced layout twice a second in a hidden tab, and no IntersectionObserver left after the last slot unsubscribes.

**Files:**
- Modify: `design-canvas.jsx` — `dcLodSubscribe`, a new `dcLodVisibility`

**Acceptance Criteria:**
- [ ] `visibilitychange` to hidden clears the interval; to visible re-arms it and schedules a pass.
- [ ] The unsubscribe of the last entry calls `dcLod.io.disconnect()` and sets `dcLod.io = null`.

**Verify:** `node tests/run.mjs` (the budget checks still pass).

**Steps:**
- [ ] Replace the subscribe function:
```js
function dcLodPoll(on) {
  clearInterval(dcLod.poll); dcLod.poll = 0;
  if (on) dcLod.poll = setInterval(dcLodRun, 500);
}
function dcLodVisibility() { dcLodPoll(!document.hidden && dcLod.subs.size > 0); dcLodSchedule(); }
function dcLodSubscribe(entry) {
  if (!dcLod.subs.size) {
    dcLodPoll(!document.hidden);
    document.addEventListener('visibilitychange', dcLodVisibility);
    dcLod.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
  dcLod.subs.add(entry); dcLod.io.observe(entry.box);
  return () => {
    dcLod.subs.delete(entry); dcLod.io && dcLod.io.unobserve(entry.box);
    if (!dcLod.subs.size) {
      dcLodPoll(false); clearTimeout(dcLod.timer);
      document.removeEventListener('visibilitychange', dcLodVisibility);
      dcLod.io && dcLod.io.disconnect(); dcLod.io = null;
    }
  };
}
```
  Run the suite. Commit `git commit -am "Pause the LOD poll in a hidden tab"`.

### Task 15: `DCSection` stops stringifying and splitting per render

**Goal:** The size mark is a tuple compared by identity, and `arrowsMoved` comes from one memoised set.

**Files:**
- Modify: `design-canvas.jsx` — `DCSection`: `sizeMark`, `marks`, `sizes`, `arrowsMoved`

**Acceptance Criteria:**
- [ ] No `JSON.stringify` in `DCSection`.
- [ ] `arrowsMovedSet` is a `React.useMemo` on `[sec.arrows]`, and each frame gets `arrowsMoved={arrowsMovedSet.has(k)}`.
- [ ] `perf/bench.js` `patchCost.framesRenderedPerPatch` stays at 1 (run `await dcBench.patchCost()` on the sample; record the number in the commit body).

**Verify:** `node tests/run.mjs`; bench number recorded.

**Steps:**
- [ ] Replace the mark logic:
```js
  const sizeMark = (k) => { const q = byId[k].props; return [q.width, q.height, q.href, q.variants, (sec.variant || {})[k]]; };
  const sameMark = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const sizeCache = React.useRef(new Map());
  // Rebuilt in every render; each slot keeps its object while its mark holds.
  const sizes = {};
  order.forEach((k) => {
    const cache = sizeCache.current, mark = sizeMark(k), hit = cache.get(k);
    sizes[k] = hit && sameMark(hit.mark, mark) ? hit.size : dcSize(byId[k].props, (sec.variant || {})[k]);
    cache.set(k, { mark, size: sizes[k] });
  });
  for (const k of [...sizeCache.current.keys()]) if (!(k in sizes)) sizeCache.current.delete(k);
  const arrowsMovedSet = React.useMemo(() => {
    const s = new Set();
    Object.entries(sec.arrows || {}).forEach(([key, o]) => { const { from, to } = dcFlowKeyParts(key); if (o.fs) s.add(from); if (o.ts) s.add(to); });
    return s;
  }, [sec.arrows]);
```
  `freeBox`'s dependency list loses `sizes` and gains `marksKey` where `const marksKey = order.map((k) => k + ':' + sizes[k].width + 'x' + sizes[k].height).join('|');`. Frame prop: `arrowsMoved={arrowsMovedSet.has(k)}`. Run the suite and the bench. Commit `git commit -am "Drop the per-render stringify in DCSection"`.

### Task 16: Overlay and flow listeners stop churning

**Goal:** `DCFocusOverlay`'s keydown listener and `CanvasFlows`' observers register once per mount.

**Files:**
- Modify: `design-canvas.jsx` — `DCFocusOverlay` keydown effect
- Modify: `canvas-page.jsx` — `CanvasFlows` measure effect

**Acceptance Criteria:**
- [ ] The overlay's keydown effect has `[]` deps and reads `go`/`goSection` through a ref updated each render.
- [ ] `CanvasFlows` keeps observers in an effect on `[world, hasFlows]` and re-schedules a measure in a second effect on `[flows]`.
- [ ] "connector label and dashed style refresh" and "removing all flows clears connector layer" still pass.

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Overlay: `const nav = React.useRef(); nav.current = { go, goSection };` and inside the effect call `nav.current.go(-1)` etc., with `[]` deps.
- [ ] Flows: `const flowsRef = React.useRef(flows); flowsRef.current = flows; const hasFlows = flows.length > 0;` and `const scheduleRef = React.useRef(null);`. In the observer effect use `cfMeasure(world, flowsRef.current)`, store `scheduleRef.current = schedule`, deps `[world, hasFlows]`, and clear `scheduleRef.current = null` in cleanup. Add `React.useEffect(() => { scheduleRef.current && scheduleRef.current(); }, [flows]);`. Run the suite. Commit `git commit -am "Register overlay and flow listeners once"`.

### Task 17: `CanvasPage` keeps element identity across renders

**Goal:** A re-render of `CanvasPage` does not rebuild every `<DCArtboard>` element, so the frame memo keeps holding.

**Files:**
- Modify: `canvas-page.jsx` — `CanvasPage` (read lines 431 to 490 first; the element list is built from `data` and `sizes`)
- Test: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] The artboard elements and the `(s) => …` render prop are built in a `React.useMemo` keyed on the data that produces them (`data`, `page`, `sizes`).
- [ ] New check: render `CanvasPage` twice with the same data (force a re-render by a state setter exposed through a wrapper), and `DC.renders` grows by 0 on the second render.

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Write the check first with a wrapper component that holds a counter state and renders `<CanvasPage page=… data={fixture} />`; if `CanvasPage` only accepts `page` and fetches `canvas.json`, add an optional `data` prop that skips the fetch (this also makes the check deterministic). Record `DC.renders` after the first paint, bump the counter, wait a frame, and check the delta is 0.
- [ ] Wrap the element construction in `React.useMemo(() => …, [data, page, sizes])` where the render prop closes only over the memo inputs.
- [ ] Run, commit `git commit -am "Memoise the CanvasPage artboard elements"`.

### Merge Phase 2

- [ ] Suite green, bench `await dcBench.all()` numbers recorded in the merge commit body (`invWrites`, `liveByZoom`, `framesRenderedPerPatch`), then merge with `--no-ff`.

---

## Phase 3: Tests, docs, small complexity

### Task 18: Tests wait on named constants

**Goal:** Every timing literal in `tests/regressions.js` reads a `DC` or `CF` constant.

**Files:**
- Modify: `design-canvas.jsx` — `DC` gains `dropMs: 180` (the slot transition and the grip drop timeout use it)
- Modify: `canvas-page.jsx` — `CF.remeasureMs = 240` on the existing `CF` object, used by `schedule`
- Modify: `tests/regressions.js`

**Acceptance Criteria:**
- [ ] `grep -nE 'wait\([0-9]+\)' tests/regressions.js` returns only waits under 100 ms (poll steps).
- [ ] The CSS `[data-dc-slot]{transition:transform .18s…}` is emitted from `DC.dropMs` (`${DC.dropMs}ms`).

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Add the constants, template the CSS string, replace `setTimeout(() => {…}, 180)` in `onGripDown` with `DC.dropMs`, replace `timer = setTimeout(measure, 240)` with `CF.remeasureMs`. In the tests: `wait(350)` → `wait(CF.remeasureMs + 110)`, `wait(300)` in `flowFixture` → `wait(CF.remeasureMs + 60)`, `wait(200)` in the fit check → `wait(DC.settleMs + 50)`. Publish `CF` on `window`. Run, commit `git commit -am "Read the test waits from named constants"`.

### Task 19: Explicit test API and a loud bench

**Goal:** The names tests and the bench use are published on purpose, and the bench fails when a patch point is missing.

**Files:**
- Modify: `design-canvas.jsx` — the `Object.assign(window, …)` list
- Modify: `canvas-page.jsx` — publish list
- Modify: `perf/bench.js`

**Acceptance Criteria:**
- [ ] `design-canvas.jsx` publishes `dcFontCss`, `dcInlineCss`, `dcInlineDoc`, `dcMoving`, `dcExportName` in the list, with a comment that names which file reads each.
- [ ] `canvas-page.jsx` publishes `cfMeasure` explicitly.
- [ ] `perf/bench.js` `dragFlowCost` throws `new Error('window.cfMeasure is not patchable')` if `typeof window.cfMeasure !== 'function'`, and the `[...vp().children].find(...)` world fallback is gone.

**Verify:** `node tests/run.mjs`; paste `perf/bench.js` into the sample and run `await dcBench.dragFlowCost()` → `cfCalls` is 2.

**Steps:**
- [ ] Edit the three files as listed. Run. Commit `git commit -am "Publish the test API on purpose"`.

### Task 20: Vestigial code

**Goal:** Remove what nothing uses.

**Files:**
- Modify: `design-canvas.jsx`, `perf/bench.js`, `README.md`

**Acceptance Criteria:**
- [ ] `.dc-nav` is out of the pan ignore list.
- [ ] The `indexedDB.deleteDatabase('dc-snapshots')` runs once: guarded by `localStorage.getItem('dc-snapshots-dropped')`, which it sets.
- [ ] `DCLib` is deleted from the code, the publish list and the README (grep `DCLib` first; if the README says a host may mount it to load the globals, replace with "load the two `.jsx` files as scripts").
- [ ] `size = size || dcSize(artboardProps)` in `DCArtboardFrame` becomes `const { width, height, href } = size;` with `size` required.
- [ ] `dcSetZoom` is renamed `dcLodNoteScale` with the comment "bench telemetry only; the pass does not read it".

**Verify:** `node tests/run.mjs`; `grep -n "DCLib\|dc-nav\|dcSetZoom" *.jsx perf/bench.js README.md` → empty.

**Steps:**
- [ ] Make the edits, run, commit `git commit -am "Remove dead code from the canvas"`.

### Task 21: Documentation drift

**Goal:** The docs describe the code as it is.

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-09-08-canvas-performance.md`, `docs/superpowers/specs/2026-09-08-canvas-performance-design.md`

**Acceptance Criteria:**
- [ ] The plan's gate lines (`11 checks`, `11/11`, `11 of 11`, `12 of 12`) say "every check in `tests/regressions.html`" instead of a count, with a note at line 16 that `node tests/run.mjs` runs it.
- [ ] README's bench paragraph lists all seven measurements (`zoomFrameCost`, `zoomFrames`, `invWrites`, `liveByZoom`, `flowCost`, `dragFlowCost`, `patchCost`).
- [ ] README's tests paragraph names the zoom-invariance checks ("the settled --dc-inv-zoom write holds the zoom anchor", "the world layout does not read the zoom") and the wheel-roll check.
- [ ] Spec F5 (line 212) says the grid is one static `radial-gradient` layer beside the world, painted once, not `background-position`.
- [ ] README gets a "Host protocol" section: `__dc_zoom` out (on settle, only when embedded), `__dc_set_zoom` in, `__dc_probe` in, `__dc_present` out; all with `targetOrigin '*'`.

**Verify:** `grep -n "11 of 11\|11/11\|11 checks\|12 of 12\|background-position" README.md docs -r` → empty.

**Steps:**
- [ ] Edit, commit `git commit -am "Bring the docs in line with the canvas code"`.

### Task 22: Name the variant resolution as such

**Goal:** `dcSize` becomes `dcVariant`, `actions.size` becomes `actions.pickVariant`, and the maps that hold resolved variants are named `variantOf`.

**Files:**
- Modify: `design-canvas.jsx`, `canvas-page.jsx`, `perf/bench.js`, `tests/regressions.js`, `README.md`

**Acceptance Criteria:**
- [ ] `grep -n "dcSize\b\|actions\.size\|\.size(" *.jsx perf/bench.js tests/regressions.js` → empty.
- [ ] The `DC_AXES[0].key === 'size'` chip axis keeps its name (it is the size axis).
- [ ] The frame prop stays `size` (it is the slot's size).

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Rename with `sed` across the files, review the diff by eye, run, commit `git commit -am "Name the variant resolution dcVariant"`.

### Task 23: One slot resolver for the state canvas and the section

**Goal:** `DCStateCanvas` and `DCSection` call one `dcResolveSlots(artboards, persisted)` instead of two copies of the hidden/order/`srcKey` algorithm.

**Files:**
- Modify: `design-canvas.jsx` — new `dcResolveSlots` above `DCStateCanvas`; both call sites

**Acceptance Criteria:**
- [ ] `dcResolveSlots(ids, persisted)` returns `{ srcKey, hidden, srcIds, slotIds }` where `ids` is the ordered artboard id list.
- [ ] `'\x1f'` appears only in `DC_KEY_SEP` and `dcResolveSlots` uses `DC_KEY_SEP`.
- [ ] `DCSection`'s `order` memo depends on `[sec.order, sec.hidden, sec.srcKey, allIds.join('|')]` and calls the resolver.

**Verify:** `node tests/run.mjs`; "switch state file without leaking sections" still passes.

**Steps:**
- [ ] Add:
```js
// One answer for "which slots does this section show, in what order". The
// state canvas needs it for the focus overlay; the section needs it to render.
function dcResolveSlots(ids, persisted) {
  const srcKey = ids.join(DC_KEY_SEP);
  const hidden = persisted.srcKey === srcKey ? (persisted.hidden || []) : [];
  const srcIds = ids.filter((k) => !hidden.includes(k));
  const kept = (persisted.order || []).filter((k) => srcIds.includes(k));
  return { srcKey, hidden, srcIds, slotIds: [...kept, ...srcIds.filter((k) => !kept.includes(k))] };
}
```
  Move `DC_KEY_SEP` above it. Replace both copies. Run, commit `git commit -am "Share one slot resolver"`.

### Task 24: One artboard resolver for the frame and the overlay

**Goal:** `dcResolveArtboard(props, sec)` returns `{ id, label, size, children, href, width, height }` and both `DCArtboardFrame` and `DCFocusOverlay` use it.

**Files:**
- Modify: `design-canvas.jsx`

**Acceptance Criteria:**
- [ ] `props.id ?? props.label` appears only in `dcResolveArtboard` and in `dcResolveSlots`' callers that build the id list.
- [ ] The overlay's `label`, `size`, `children` lines are replaced by one call.

**Verify:** `node tests/run.mjs`.

**Steps:**
- [ ] Add the helper next to `dcVariant`; replace the duplicated lines; run; commit `git commit -am "Share one artboard resolver"`.

### Merge Phase 3

- [ ] Suite green, merge with `--no-ff`.

---

## Phase 4: Large refactors

Each task here is one commit and one merge. Run the suite and the bench after each. If the bench `framesRenderedPerPatch` or `invWrites` regresses, stop and fix before the next task.

### Task 25: Gesture and pill hooks out of `DCViewport`

**Goal:** `DCViewport` reads as transform + children; the wheel/gesture/pointer handling lives in `useCanvasGestures`, and the pill in `useLostPill`.

**Files:**
- Modify: `design-canvas.jsx`

**Acceptance Criteria:**
- [ ] `function useCanvasGestures(vpRef, tf, apply, stopTween, { minScale, maxScale, onSettle })` holds the whole gesture effect (wheel, gesturestart/change/end, pointer drag, host `message`) and returns nothing.
- [ ] `function useLostPill(vpRef, worldRef, tf, apply, { minScale, maxScale })` returns `{ lost, lostRef, checkLost, onFrame, backToContent, stop }`, where `onFrame(x, y, scale)` is the arithmetic test from Task 12 and `stop()` clears its timer and tween.
- [ ] `DCViewport` is under 120 lines and keeps: refs, `flushNow`, `apply`, the restore/fit/rescue effects, the resize observer, and the JSX.

**Verify:** `node tests/run.mjs`; bench `zoomFrames.over16` 0 and `invWrites` 1 on a pinch.

**Steps:**
- [ ] Cut the gesture effect body (from `const zoomAt` to the end of its cleanup) into `useCanvasGestures`; it needs `lastPostedScale` for `__dc_probe`, so pass `onProbe` from the viewport (`() => { lastPostedScale.current = undefined; apply(true); }`).
- [ ] Cut `boxes`, `checkLost`, `lost` state, `lostRef`, `lostT`, `lostBox`, `vpSize`, `tween`, `stopTween`, `backToContent` into `useLostPill`. `flushNow` calls `pill.onFrame(x, y, scale)` and arms `pill.schedule()`.
- [ ] Run, commit `git commit -am "Split DCViewport into gesture and pill hooks"`.

### Task 26: One owner for the view scale

**Goal:** `dcView` is the module object that holds the view transform; every reader of the scale reads it, and every fan-out (transform write, settle timer, host post, LOD note, save) goes through `dcView.set`.

**Files:**
- Modify: `design-canvas.jsx` — replace `dcLod.scale`, `tf` reads in drag code
- Modify: `canvas-page.jsx` — `cfMeasure` scale
- Modify: `perf/bench.js` — `window.dcLod.scale` → `window.dcView.scale`

**Acceptance Criteria:**
- [ ] `const dcView = { x: 0, y: 0, scale: 1 }` at module level; `DCViewport`'s `tf.current` is `dcView` (one object, not a copy), and `flushNow` is the only writer of the world transform.
- [ ] `dcDragSession` uses `dcView.scale` for the world conversion and keeps only the one rect read for the pointer's world position.
- [ ] `cfMeasure` uses `dcView.scale` instead of `wr.width / world.offsetWidth`.
- [ ] `dcLod.scale` is removed; the bench reads `dcView.scale`.

**Verify:** `node tests/run.mjs`; bench `flowCost` and `dragFlowCost` unchanged.

**Steps:**
- [ ] Introduce `dcView`, point `tf` at it, replace the readers, publish `dcView`, delete `dcLodNoteScale`. Run, commit `git commit -am "Hold the view transform in one module object"`.

### Task 27: The arrows feature moves to the page file

**Goal:** `design-canvas.jsx` no longer knows about flows. `DCSection` takes a `slotMenu(slotId, sec)` prop that returns extra menu rows, and the rail renders the same rows.

**Files:**
- Modify: `design-canvas.jsx` — remove `dcFlowKey`, `dcFlowKeyParts`, `actions.resetArrows`, `arrowsMovedSet`, `.dc-flows` from the pan ignore list (replace with a generic `[data-dc-ignore-pan]` attribute the flows layer sets)
- Modify: `canvas-page.jsx` — receives the helpers; `CanvasPage` passes `slotMenu` to each `DCSection`; the flows layer root gets `data-dc-ignore-pan=""`

**Acceptance Criteria:**
- [ ] `grep -n "flow\|arrow" design-canvas.jsx` → only the `slotMenu` prop plumbing and the focus arrows.
- [ ] `slotMenu` returns an array of `{ label, onClick, danger? }`; `DCArtboardFrame` renders them between "Reset position" and the export rows; `DCFocusOverlay` renders them in a "Layout" group.
- [ ] "Reset arrow sides" still appears in both places when an arrow side was moved, and "removing all flows clears connector layer" still passes.

**Verify:** `node tests/run.mjs`; on the sample, drag an arrow handle, open the ⋯ menu → "Reset arrow sides" present and working.

**Steps:**
- [ ] Move the two key helpers and the `resetArrows` patch into `canvas-page.jsx` as `cfResetArrows(patchSection, sid, k)` and `cfArrowsMoved(sec, k)`. In `CanvasPage`, `slotMenu={(k, sec) => cfArrowsMoved(sec, k) ? [{ label: 'Reset arrow sides', onClick: () => cfResetArrows(ctx.patchSection, sid, k) }] : []}`. Thread the prop through `DCSection` → `DCArtboardFrame` (as a memoised `menuRows` per slot, computed in the section so the frame's shallow compare holds: `menuRows={slotMenuRows[k]}` from a `useMemo` on `[slotMenu, sec]`) and into `sectionMeta` for the overlay.
- [ ] Run, commit `git commit -am "Move the arrows feature into the page file"`.

### Merge Phase 4

- [ ] Suite green, bench recorded, merge with `--no-ff`. Delete the worktree: `git worktree remove ../design-canvas-lod-wt/review-fixes`.

---

## Verification (end to end)

1. `node tests/run.mjs` → every check PASS, exit 0. Expect 15 original + 16 new checks.
2. `python3 -m http.server 8000`, open `http://localhost:8000/sample/`, paste `perf/bench.js`, run `await dcBench.all()`. Expect `invWrites` 1 to 3, `liveByZoom` all at or under 8, `patchCost.framesRenderedPerPatch` at most 1, `dragFlowCost.cfCalls` 2.
3. Manual on the sample: pan until the pill shows, reload → the pan is kept. Grab a grip, drag out of the window, release, come back → cards still mount/drop on pan. Open a page's focus, click the dark letterbox → it closes. Press ArrowRight with Options toggled → the rail state holds.
4. Headless visibility sanity: the runner prints `visibility=visible`.

## Findings map

| Finding | Task |
|---|---|
| dcDragDepth leak, .dc-moving desync, drag thrash, two-canvas class | 1 |
| Rescue discards restored view | 2 |
| LOD ranks against window | 3 |
| 5 s blank on stalled fetch | 4 |
| Failed write marked saved | 5 |
| cfRoute sample density | 6 |
| Listener churn on `[api]` | 7 |
| sizeCache never evicts | 8 |
| Two canvases: CanvasFlows world lookup | 9 |
| Section head clip and overlap | 10 |
| Rail width, arrows, dismiss, pin, delete confirm, export name, dead CSS, screen slide | 11 |
| checkLost per frame | 12 |
| postMessage per frame, posts when not embedded | 13 |
| LOD poll forever, IO never disconnected | 14 |
| DCSection stringify and split per patch | 15 |
| Overlay keydown and CanvasFlows observer churn | 16 |
| Memo fragility on CanvasPage re-render | 17 |
| Tests on wall-clock literals | 18 |
| Accidental globals, silent bench | 19 |
| .dc-nav, indexedDB one-shot, DCLib, dead size fallback, dcSetZoom name, bench fallback | 20 |
| Plan gate count, README lists, spec F5, host protocol undocumented | 21 |
| "size" naming | 22 |
| Duplicated slot resolution | 23 |
| Duplicated artboard resolution | 24 |
| DCViewport size | 25 |
| Scale has six owners | 26 |
| Engine/page boundary | 27 |
| Font cache unbounded | Accepted: bounded by distinct font hrefs; no task. |
