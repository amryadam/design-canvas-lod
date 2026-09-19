# Canvas GPU Layer-Limit Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the tall-page "bottom half flickers on zoom-in" by not promoting the whole world into a single GPU layer that exceeds the browser's max layer size.

**Architecture:** The world is one `will-change: transform`, `max-content`-sized element (`design-canvas.jsx:1046`) transformed by `translate3d(x,y,0) scale(s)` (`design-canvas.jsx:952`). That makes it one composited GPU layer. A GPU stops drawing a layer past its max texture size (~16,384 CSS px, lower on some GPUs/Safari), so on a tall page the region past the limit drops out as a zoom-in crosses it — a compositor artifact (no repaint, invisible to Paint flashing). Fix: in the transform-write path, when `contentSize × scale` would exceed the limit, drop the promotion (no `will-change`, a 2D `translate`) so the content paints tiled into the viewport surface. The existing `content-visibility: auto` culling keeps only visible cards painted, so the tiled repaint stays cheap. Below the limit (all normal/zoomed-out views) nothing changes — the smooth GPU path is kept.

**Tech Stack:** React (via global `window.React`), plain DOM/CSS, headless-Chrome regression harness (`tests/run.mjs` + `tests/regressions.js`).

**Spec:** This document. Root cause was established empirically in the originating conversation: engine runs in a sandbox iframe; probes cleared iframes, `content-visibility`, and the `--dc-inv-zoom` write; Paint flashing showed no repaint; measurement of the export (identical engine + artboards) gave world content **12,216 × 16,222 px**, `will-change: transform`, GPU `MAX_TEXTURE_SIZE` **16,384** → the layer height crosses the limit the moment zoom passes ~1:1. Cross-checked against how tldraw (DOM culling, no giant layer) and Excalidraw (viewport-sized canvas) avoid the same limit, and W3C csswg-drafts #7848 (no CSS-only fix ships today).

## Global Constraints

- Work on a new branch `fix-canvas-layer-limit` off `main`. Do NOT commit to `main`.
- Below `DC.maxLayerPx`, behavior is byte-for-byte unchanged: `translate3d(...)` + `will-change: transform`. The un-promoted path is reached ONLY when `contentSize × scale` exceeds the limit. This keeps normal-zoom smoothness and is the safety argument for the change.
- Do not touch the already-merged #1 (hover) / #3 (`--dc-inv-zoom`) work — it is correct and unrelated to this compositor issue.
- The regression harness must stay green: `node tests/run.mjs` → `PASS: canvas regressions`, 0 FAIL.
- Read `world.scrollWidth`/`scrollHeight` for the UNSCALED content size (a transform does not affect them, nor dirty layout), so the per-frame promotion check does not force a reflow in the steady pan/zoom loop.

**User decisions (already made):**
- "drop the giant world layer, rely on existing culling" — the chosen fix direction (over per-page zoom-cap, or an Excalidraw-style canvas rewrite).
- The live claude.ai/design app is the only place the flicker reproduces; "your deploy-and-check is the real verification." → Task 2 is a user-run verification gate.

---

### Task 1: Un-promote the world above the GPU layer-size limit

**Goal:** In the transform-write path, keep the GPU layer only while `contentSize × scale` is within `DC.maxLayerPx`; above it, drop `will-change` and use a 2D transform so no single layer exceeds the limit.

**Files:**
- Modify: `design-canvas.jsx` — add `DC.maxLayerPx` (near `mountGapMs`, ~line 50); add a GPU-limit read after the DC literal; change the flush write (`design-canvas.jsx:952`); remove the static `willChange: 'transform'` from the world element (`design-canvas.jsx:1046`).
- Test: `tests/regressions.js` — add one guard test.

**Acceptance Criteria:**
- [ ] Below `DC.maxLayerPx`: `getComputedStyle(world).willChange === 'transform'` and the computed transform is `matrix3d(...)` (promoted, translate3d) — unchanged from today.
- [ ] Above `DC.maxLayerPx`: `getComputedStyle(world).willChange === 'auto'` and the computed transform is `matrix(...)` (2D translate, not `matrix3d`).
- [ ] `DC.maxLayerPx` defaults to 16384 and is lowered to `floor(0.95 × MAX_TEXTURE_SIZE)` when WebGL reports a smaller limit.
- [ ] Full suite green: `node tests/run.mjs` → `PASS: canvas regressions`, 0 FAIL.

**Verify:** `node tests/run.mjs 2>&1 | tail -1` → `PASS: canvas regressions`; and `node tests/run.mjs 2>&1 | grep 'GPU layer'` → `PASS the world drops its GPU layer above the size limit`.

**Steps:**

- [ ] **Step 1: Write the failing guard test** — append after the last test in `tests/regressions.js` (inside the same async IIFE, before its closing).

```js
  await test('the world drops its GPU layer above the size limit', async () => {
    // The world is one composited layer. A GPU stops drawing a layer past its
    // max texture size, so a tall page's bottom blanks as a zoom-in crosses the
    // line. Past DC.maxLayerPx the world must not be promoted: no will-change,
    // and a 2D transform (matrix, not matrix3d), so the content paints tiled.
    window.fetch = async () => new Response('', { status: 404 });
    const saved = DC.maxLayerPx;
    try {
      draw('review-layerlimit.json',
        E(DCSection, { id: 'review', title: 'Layer' },
          E(DCArtboard, { id: 'a', width: 1440, height: 4000 }),
          E(DCArtboard, { id: 'b', width: 1440, height: 4000 })));
      await until(() => host.querySelector('[data-dc-world]'));
      await wait(DC.rescueMs + 200);
      const world = host.querySelector('[data-dc-world]');
      const scaleOf = () => new DOMMatrix(getComputedStyle(world).transform).a;
      const promoted = () => getComputedStyle(world).willChange === 'transform'
        && getComputedStyle(world).transform.startsWith('matrix3d');
      const s0 = scaleOf();
      // Under the limit: keep the GPU layer (translate3d + will-change).
      DC.maxLayerPx = 1e9;
      window.postMessage({ type: '__dc_set_zoom', scale: s0 * 0.9 }, '*');
      await until(() => Math.abs(scaleOf() - s0 * 0.9) < s0 * 0.05); await wait(40);
      check(promoted(), 'under the limit the world lost its GPU layer: '
        + getComputedStyle(world).willChange + ' / ' + getComputedStyle(world).transform.slice(0, 12));
      // Over the limit: drop the layer (2D transform, no will-change).
      DC.maxLayerPx = 10;
      window.postMessage({ type: '__dc_set_zoom', scale: s0 * 1.1 }, '*');
      await until(() => Math.abs(scaleOf() - s0 * 1.1) < s0 * 0.05); await wait(40);
      check(!promoted(), 'over the limit the world kept its GPU layer: '
        + getComputedStyle(world).willChange + ' / ' + getComputedStyle(world).transform.slice(0, 12));
    } finally { DC.maxLayerPx = saved; }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/run.mjs 2>&1 | grep -E 'GPU layer|FAIL'`
Expected: `FAIL the world drops its GPU layer above the size limit :: over the limit the world kept its GPU layer: transform / matrix3d(...` (today the world is always `translate3d` + `will-change: transform`).

- [ ] **Step 3: Add the `DC.maxLayerPx` config** — in the `DC` object literal, right before `mountGapMs:` (~line 50).

```js
  maxLayerPx: 16384,    // the world is one composited layer (its transform). A
                        // GPU stops drawing a layer past its max texture size --
                        // commonly 16384 CSS px, lower on some GPUs and Safari --
                        // so the part beyond it drops out. That is the tall-page
                        // "bottom half flickers on zoom-in". Past this size the
                        // world drops its promotion and paints tiled instead
                        // (see flushNow). The block below lowers it to the real
                        // GPU limit at load.
```

- [ ] **Step 4: Lower it to the real GPU limit at load** — add this guarded block just after the `DC` object literal closes (before or alongside the existing `if (typeof document !== 'undefined')` style block).

```js
// Lower DC.maxLayerPx to this GPU's real max texture size, held a margin below
// the edge so a zoom that lands exactly on the limit still has room.
if (typeof document !== 'undefined') {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    const m = gl && gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (m) DC.maxLayerPx = Math.min(DC.maxLayerPx, Math.floor(m * 0.95));
  } catch {}
}
```

- [ ] **Step 5: Make the flush write conditional** — in `flushNow`, replace the single transform line (`design-canvas.jsx:952`).

Replace:
```js
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
```
With:
```js
    // The world is one composited layer. Above DC.maxLayerPx in either axis a
    // GPU stops drawing the layer and the far edge blanks, so past the limit
    // drop the promotion (no will-change, a 2D transform) and let the content
    // paint tiled into the viewport surface -- content-visibility already keeps
    // only the visible cards painted. scrollWidth/scrollHeight are the unscaled
    // layout size and a transform does not dirty layout, so this reads clean.
    const promote = el.scrollWidth * scale <= DC.maxLayerPx
                 && el.scrollHeight * scale <= DC.maxLayerPx;
    el.style.willChange = promote ? 'transform' : 'auto';
    el.style.transform = promote
      ? `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      : `translate(${x}px, ${y}px) scale(${scale})`;
```

- [ ] **Step 6: Remove the static `will-change`** — the world element style (`design-canvas.jsx:1046`). Delete `willChange: 'transform', ` from the style object so promotion is owned only by `flushNow`.

From:
```jsx
      <div ref={worldRef} data-dc-world="" style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform', width: 'max-content', minWidth: '100%', minHeight: '100%', padding: '72px 0 80px' }}>
```
To:
```jsx
      <div ref={worldRef} data-dc-world="" style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', width: 'max-content', minWidth: '100%', minHeight: '100%', padding: '72px 0 80px' }}>
```

- [ ] **Step 7: Run the test to verify it passes + no regressions**

Run: `node tests/run.mjs 2>&1 | tail -1 && node tests/run.mjs 2>&1 | grep -c '^FAIL'`
Expected: `PASS: canvas regressions` and `0`.

- [ ] **Step 8: Commit**

```bash
git add design-canvas.jsx tests/regressions.js
git commit -m "Drop the world GPU layer past the max size"
```

---

### Task 2: Verify the fix in the live app (user-run gate)

**Goal:** Confirm on the deployed claude.ai/design app that the tall-page zoom-in flicker is gone and normal-zoom pan/zoom stays smooth.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured. The flicker is a compositor artifact that does NOT reproduce in the headless harness or in screenshots — only a human watching the live app can confirm it. The agent cannot deploy to claude.ai/design; it hands off to the user and waits.

**Files:** none (deploy + manual verification).

**Acceptance Criteria:**
- [ ] Branch `fix-canvas-layer-limit` is deployed to the environment that serves claude.ai/design (user's normal deploy path).
- [ ] On the "Users and roles" page: zoom in past ~100% and pan to the lower artboards — the bottom no longer blanks/flickers.
- [ ] Repeat on the taller pages ("Sign-up and sign-in", "Navigation") — no bottom blanking on zoom-in.
- [ ] At normal/fit zoom on those pages, pan and zoom feel as smooth as before (no new jank). If a page feels janky only when zoomed in past the limit, that is expected (tiled repaint replaces a blank) and acceptable.

**Verify:** Manual — user zooms in past 100% on Users and roles / Sign-up / Navigation in the live app and confirms the bottom renders instead of dropping out.

**Steps:**

- [ ] **Step 1: Deploy the branch** to wherever claude.ai/design serves the engine from (user's path).
- [ ] **Step 2: Reproduce the old trigger** — open Users and roles, zoom in past ~100%, pan down to the 2K/desktop/tablet boards.
- [ ] **Step 3: Confirm** the bottom renders (no flicker), and check Sign-up and Navigation the same way.
- [ ] **Step 4: Smoothness check** — pan/zoom at normal levels; confirm no new stutter.
- [ ] **Step 5: Report back.** If confirmed → done. If the flicker persists or the device's real limit is lower than detected, the fallbacks are: (a) lower the `0.95` margin in Step 4 of Task 1, or set `DC.maxLayerPx` to a fixed conservative value (e.g. 8192); (b) if un-promoted zoom-in feels janky, add `content-visibility` culling to the whole slot (not only `.dc-card`) so fewer nodes repaint; (c) last resort, add a per-page zoom cap so `contentSize × scale` never reaches the limit.

```json:metadata
{"userGate": true, "tags": ["user-gate"], "files": [], "verifyCommand": "", "acceptanceCriteria": ["fix-canvas-layer-limit deployed to the live app", "Users and roles: zoom past ~100% and pan down, bottom no longer blanks", "Sign-up and Navigation: no bottom blanking on zoom-in", "normal-zoom pan/zoom stays smooth"], "modelTier": "standard"}
```

---

## Notes

- **Why this is low-risk:** the un-promoted path is reached ONLY when `contentSize × scale` exceeds the GPU limit — i.e. exactly the zoom range that already renders blank. Every view below the limit keeps the identical `translate3d` + `will-change` fast path, so normal use is unchanged.
- **Why not verifiable locally:** the flicker is a compositor artifact — it produces no paint (so Paint flashing shows nothing) and a screenshot forces a full render that hides it. The headless harness cannot render it either. Task 1's guard test asserts the *mechanism* (promotion toggles at the limit); Task 2 (live) confirms the *symptom* is gone.
