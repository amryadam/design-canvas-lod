# React Flow Canvas (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom canvas (`design-canvas.jsx`, `canvas-page.jsx`) with a React Flow canvas built as one file, `dist/design-canvas.js`, that keeps the windows, variants, arrows, live screens, saved state, export and host protocol, and obeys the four rules the spike proved.

**Architecture:** Pure modules (variants, mapping, live budget, saved state, view math, host protocol, export) each with Vitest unit tests; a thin React layer (`CanvasPage.jsx` and the node/edge components) wires them to React Flow 12. A headless browser suite checks behaviour; a headful GPU check reproduces the tall-page blank; a frame bench compares against the old engine. The old canvas runs beside the new one until the switch-over task.

**Tech Stack:** React 18.3.1, `@xyflow/react` 12.11.6, Vite 7.3.1 (library mode, IIFE, CSS inlined with `?inline`), Vitest 4.1.0, Node 26 (built-in `WebSocket`, `fetch`, `EventTarget`), Google Chrome via the DevTools protocol, `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-09-19-react-flow-canvas-design.md` (section "Requirements from the spike" is binding). **Evidence:** `docs/superpowers/specs/2026-09-19-react-flow-spike-report.md`. Both live on branch `fix-canvas-layer-limit` in the main checkout `/Users/amryadam/Github/design-canvas-lod`; read them there.

## Global Constraints

- **Where:** all code goes on a new branch `react-flow-canvas` off `main`, in the worktree `/Users/amryadam/Github/design-canvas-lod-wt/react-flow-canvas`. Do not commit to `main`, `fix-canvas-layer-limit` or `spike/react-flow`. Do not touch the worktrees `spike-react-flow` or `react-flow-workspace`.
- **The four spike rules (binding):**
  1. No `will-change` on the React Flow viewport (`.react-flow__viewport` computed `will-change` is `auto`).
  2. Each live iframe has `will-change: transform`.
  3. The sticky budget: a pass never drops a live window that is on screen; a pass runs only after `DC.stickySettleMs` (600 ms) with no move, and never between `onMoveStart` and `onMoveEnd`.
  4. No `freeze`: live screens stay painted during a gesture.
- **Numbers (from the old engine unless noted):** window header `DC.winHead = 64`, window padding `DC.winPad = 36`, body colour `#eae7e1`; live budget 8; mount margin 600 screen px; unmount margin 1600; hysteresis 400; touch mark 4000 ms with bias 1e6; mount gap 60 ms; state read timeout 1500 ms; file-save debounce 400 ms; fit padding 80 px, fit never above 1:1; Back to content tween 300 ms; zoom 0.05–4; `--dc-inv-zoom` written each 1.25× change and on settle; section head counter-scale cap 1.75; dots `rgba(70,58,46,.16)` 26 screen px apart on `#f0eee9`; mouse-wheel notch factor `exp(∓0.18)`.
- **Geometry:** `canvas.json` x/y is the SCREEN's top-left. The window grows around it: node position = `(x − 36, y − 100)`, node size = `(w + 72, h + 136)`. Saved positions store the screen x/y.
- **Keys:** browser state `dc2-state:${location.pathname}:${stateFile}`; view `dc2-view:${location.pathname}:${pageId}`; default state file `.design-canvas.${pageId}.v2.state.json` (matches `.gitignore`'s `.design-canvas.*.state.json`).
- **State format:** `{ updatedAt, positions, variants, arrowSides, deleted }`. `positions` keys: a window's primary file, or `note:<id>` for a note. `arrowSides` key: `from \x1f to \x1f label` → `{ fs?, ts? }`.
- **Arrows:** React Flow's built-in bezier path (`getBezierPath`) in a custom edge only for the label pill. No routing. `onlyRenderVisibleElements` stays off.
- **Root `package.json` has no `"type": "module"`** (`flow-layout.js` is CommonJS). Configs and scripts use `.mjs`.
- **Old canvas untouched until Task 14:** `node tests/run.mjs` (old suite) must still print `PASS: canvas regressions` at the end of every task before 14.
- **Chrome runs:** the browser suite is headless (`tests/run.mjs`). The blank check (Task 11), the frame bench (Task 12) and the look review (Task 13) are HEADFUL with the GPU on (never `--headless` or `--disable-gpu`), viewport 1280×800, DPR 2.
- **This Mac sleeps when idle and a headful Chrome then hangs.** Run every Chrome script under `caffeinate` with a hard kill timer, and clean up after: `caffeinate -dimsu -t 900 & ( node <script> & p=$!; ( sleep <limit>; kill -9 $p 2>/dev/null ) & wait $p ); pkill -f "\.chrome-profile"; pkill -f "http.server"; pkill caffeinate`.
- **Commits:** imperative subject, max 50 characters, no trailing period, no type prefix, no attribution or co-author lines. One commit per task unless a step says otherwise.
- **Language:** comments and docs in Simplified Technical English, like the existing code.

**User decisions (already made):**
- "A with the spike gate" → React Flow; phase 0 done: GO.
- "Built-in edges only" → an arrow can cross a window; no smart-edge, no custom router.
- "A build step is OK" → npm + Vite, one built file.
- "Keep: Live screens, Windows + variants, Routed arrows"; "Host + export: Keep if cheap".
- "New format OK"; the spec keeps `canvas.json` as it is; old saved browser state resets once.
- "Success: Same look, Frame times, No tall-page blank".
- freeze: b "no" → rejected. live-wc with sticky: a "no" blank, b "yes" live screens stay live, c "yes" smooth → the rules above.
- "Write the phase 1 plan" on the updated spec.

**Deferred decisions (asked in Task 13, not before):**
- The window name was editable in the old canvas (`labels` in its section state). The spec's window has a plain name and its state format has no `labels`. Task 13 asks the user whether renaming must come back. It is still open because the spec was written from the feature list the user approved, and that list did not name renaming. Nothing else changes with either answer.

---

## File Structure

All paths are relative to the worktree root.

| File | Job |
|---|---|
| `package.json`, `vite.config.mjs`, `vitest.config.mjs` | Build and unit-test setup |
| `src/constants.js` | Every bound number (`DC`) |
| `src/variants.js` | Variant folding and chip axes, moved from the old files |
| `src/mapping.js` | `canvas.json` + saved state → nodes and edges; the state patches |
| `src/liveBudget.js` | The live-iframe ranking (old rules + sticky) and its store |
| `src/persist.js` | State restore (file vs browser copy) and the saver |
| `src/view.js` | Fit math, on-screen test, mouse-wheel zoom, `--dc-inv-zoom` writer |
| `src/host.js` | The postMessage host protocol |
| `src/export.js` | PNG/HTML export, moved without change |
| `src/context.js` | The React context that carries the budget and the actions |
| `src/WindowNode.jsx`, `src/NoteNode.jsx`, `src/SectionHead.jsx`, `src/FlowEdge.jsx`, `src/BackPill.jsx` | The node, edge and pill components |
| `src/CanvasPage.jsx` | Loads the data, restores the state, renders `<ReactFlow>` |
| `src/styles.css` | All canvas CSS (injected by `mount`) |
| `src/main.jsx` | `DesignCanvas.mount(el, opts)`, `DesignCanvas.last()`, test hooks |
| `src/canvas.html` | The host page for claude.ai/design (copied to `dist/canvas.html`) |
| `sample/index-rf.html` | The sample on the new canvas (until Task 14) |
| `tests/run.mjs` | The headless runner (gains `--page=`) |
| `tests/rf/regressions.html`, `harness.js`, `checks-page.js`, `checks-window.js`, `checks-view.js`, `run-all.js` | The new browser suite (moved to `tests/` in Task 14) |
| `tests/cdp.mjs`, `tests/fixtures/tall.js`, `tests/blank.html`, `tests/blank-check.mjs` | The headful GPU blank check |
| `perf/frames.mjs`, `perf/bench.js`, `perf/results.md` | The frame bench, the console harness, the recorded numbers |
| `tests/look.mjs` | Side-by-side screenshots for the look review (deleted in Task 14) |

Two small differences from the spec's file table: the spec's `DotBackground.jsx` is a CSS background on `.dc-root` (the dots never move, so no component is necessary), and `src/context.js` is new (the React context for the budget and the actions).

---

### Task 1: Worktree, build and unit-test setup

**Goal:** A worktree on branch `react-flow-canvas` where `npm run build` writes `dist/design-canvas.js` (an IIFE that defines `window.DesignCanvas`) and `npm run test:unit` runs Vitest, with the old canvas and its suite unchanged.

**Files:**
- Create: `package.json`, `vite.config.mjs`, `vitest.config.mjs`, `src/constants.js`, `src/constants.test.js`, `src/main.jsx`
- Modify: `.gitignore`

**Acceptance Criteria:**
- [ ] `npm run build` exits 0 and `grep -c "var DesignCanvas" dist/design-canvas.js` prints `1`.
- [ ] `npm run test:unit` prints `2 passed`.
- [ ] `node tests/run.mjs 2>&1 | tail -1` prints `PASS: canvas regressions` (old suite untouched).
- [ ] `node flow-layout.js; echo $?` prints the usage line and `2` (CommonJS still works).
- [ ] `git status --short` shows no `node_modules/` or `dist/`.

**Verify:** `npm run build && npm run test:unit && node tests/run.mjs 2>&1 | tail -1` → `2 passed` … `PASS: canvas regressions`

**Steps:**

- [ ] **Step 1: Make the worktree**

```bash
cd /Users/amryadam/Github/design-canvas-lod
git worktree add -b react-flow-canvas ../design-canvas-lod-wt/react-flow-canvas main
cd ../design-canvas-lod-wt/react-flow-canvas
```

- [ ] **Step 2: Write the build files**

`package.json`:

```json
{
  "name": "design-canvas-lod",
  "private": true,
  "scripts": {
    "build": "vite build --config vite.config.mjs",
    "test:unit": "vitest run --config vitest.config.mjs",
    "test:browser": "npm run build && node tests/run.mjs --page=tests/rf/regressions.html",
    "test": "npm run test:unit && npm run test:browser"
  },
  "dependencies": {
    "@xyflow/react": "12.11.6",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "vite": "7.3.1",
    "vitest": "4.1.0"
  }
}
```

`vite.config.mjs`:

```js
import { defineConfig } from 'vite';

// One IIFE file with React, React Flow and the CSS inside (the CSS is
// imported as a string with ?inline and injected by mount()). The global
// name is DesignCanvas: a page calls DesignCanvas.mount(el, opts).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/main.jsx', name: 'DesignCanvas', formats: ['iife'], fileName: () => 'design-canvas.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

`vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

// The unit tests cover the pure modules only; the React layer is checked in
// a real browser by tests/rf.
export default defineConfig({
  test: { include: ['src/**/*.test.js'], environment: 'node' },
});
```

Append to `.gitignore`:

```
node_modules/
dist/
tests/out/
perf/out/
```

- [ ] **Step 3: Write the failing test for the constants**

`src/constants.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { DC } from './constants.js';

describe('DC', () => {
  it('holds the numbers the spike made binding', () => {
    expect(DC.liveBudget).toBe(8);
    expect(DC.stickySettleMs).toBe(600);
  });
  it('keeps the old window chrome, view limits and saved-state timing', () => {
    expect([DC.winHead, DC.winPad, DC.minZoom, DC.maxZoom, DC.fitPad]).toEqual([64, 36, 0.05, 4, 80]);
    expect([DC.stateTimeoutMs, DC.saveDebounceMs, DC.mountGapMs]).toEqual([1500, 400, 60]);
  });
});
```

- [ ] **Step 4: Install and see it fail**

Run: `npm install && npm run test:unit`
Expected: FAIL, `Failed to resolve import "./constants.js"`.

- [ ] **Step 5: Write the constants and a stub entry**

`src/constants.js`:

```js
// Every number the canvas binds. The old design-canvas.jsx is the source of
// each one, except the ones the React Flow spike added (see its report).
export const DC = {
  // Look.
  bg: '#f0eee9', dot: 'rgba(70,58,46,.16)', dotSize: 26,
  winHead: 64,          // the window header, world px
  winPad: 36,           // the padding around the screen, world px
  winBody: '#eae7e1',
  sectionHeadMax: 1.75, // the most the section head counter-scales
  sectionHeadGap: 36,   // world px between the head and the content
  // View.
  minZoom: 0.05, maxZoom: 4,
  fitPad: 80,           // screen px left around the content by a fit
  backToMs: 300,        // Back to content tween
  lostSettleMs: 150,    // wait after a move before the lost-pill test
  invZoomStep: 1.25,    // --dc-inv-zoom is written each 1.25x change and on settle
  wheelZoomStep: 0.18,  // one mouse-wheel notch zooms by exp(0.18)
  // The live budget: the old rules plus the spike's sticky rule.
  liveBudget: 8,
  mountMargin: 600,     // screen px: a window this near the view can mount
  unmountMargin: 1600,  // screen px: a live window this far from the view drops
  budgetHysteresis: 400,// screen px a live window counts as nearer
  touchMs: 4000,        // a touched window keeps its place this long
  touchBias: 1e6,       // px a touched window counts as nearer
  stickySettleMs: 600,  // quiet time before a pass (spike rule 3)
  mountGapMs: 60,       // one iframe mount per gap
  // Saved state.
  stateTimeoutMs: 1500, // give up on the state file read
  saveDebounceMs: 400,  // wait after the last edit before the file write
};
```

`src/main.jsx` (Task 8 replaces it):

```jsx
// The entry of dist/design-canvas.js. Task 8 puts the canvas here.
export function mount() {
  throw new Error('design-canvas: the canvas is not built yet');
}
```

- [ ] **Step 6: Run the checks**

Run: `npm run test:unit` → `2 passed`.
Run: `npm run build && grep -c "var DesignCanvas" dist/design-canvas.js` → `1`.
Run: `node tests/run.mjs 2>&1 | tail -1` → `PASS: canvas regressions`.
Run: `node flow-layout.js; echo $?` → the usage line, then `2`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.mjs vitest.config.mjs .gitignore src/constants.js src/constants.test.js src/main.jsx
git commit -m "Add the React Flow canvas build"
```

---

### Task 2: Variant folding

**Goal:** `src/variants.js` holds the old variant rules (`cpVariants`, the chip helpers, `DC_AXES`, `dcVariant`) moved without change, with unit tests that the old code never had.

**Files:**
- Create: `src/variants.js`, `src/variants.test.js`

**Acceptance Criteria:**
- [ ] The function bodies are byte-identical to `main`'s `canvas-page.jsx` lines 457–495 and `design-canvas.jsx` lines 1069–1096; only `export` keywords are added.
- [ ] `npx vitest run src/variants.test.js` prints `7 passed`.

**Verify:** `npx vitest run --config vitest.config.mjs src/variants.test.js` → `7 passed`

**Steps:**

- [ ] **Step 1: Write the failing tests**

`src/variants.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { cpVariants, cpChip, cpStripSize, dcVariant } from './variants.js';

const ab = (file, extra = {}) => ({ file, x: 0, y: 0, w: 1440, h: 900, ...extra });

describe('cpVariants', () => {
  it('folds a file whose CamelCase name starts with another file name', () => {
    const { primaryOf } = cpVariants([ab('SignIn.dc.html'), ab('SignInWrong.dc.html'), ab('SignInArabic.dc.html'), ab('SignInPhone.dc.html')]);
    expect(['SignInWrong.dc.html', 'SignInArabic.dc.html', 'SignInPhone.dc.html'].map(primaryOf)).toEqual(Array(3).fill('SignIn.dc.html'));
  });
  it('takes the longest match and walks to the root', () => {
    const { primaryOf } = cpVariants([ab('UserCreate.dc.html'), ab('UserCreateMinimized.dc.html'), ab('UserCreateMinimizedPhone.dc.html'), ab('UserCreated.dc.html'), ab('UserCreated2K.dc.html')]);
    expect(primaryOf('UserCreateMinimizedPhone.dc.html')).toBe('UserCreate.dc.html');
    expect(primaryOf('UserCreated2K.dc.html')).toBe('UserCreated.dc.html');
  });
  it('keeps a slot when variantOf is null', () => {
    const { primaryOf } = cpVariants([ab('SignIn.dc.html'), ab('SignInWrong.dc.html', { variantOf: null })]);
    expect(primaryOf('SignInWrong.dc.html')).toBe('SignInWrong.dc.html');
  });
  it('reads the language and state axes from the name and the overrides', () => {
    const list = [ab('SignIn.dc.html'), ab('SignInWrong.dc.html'), ab('SignInArabic.dc.html'), ab('SignInPhone.dc.html'), ab('SignInOdd.dc.html', { lang: 'ar', state: 'Locked' })];
    const { axesOf } = cpVariants(list);
    const root = list[0];
    expect(axesOf(list[1], root)).toEqual({ lang: 'en', state: 'Wrong' });
    expect(axesOf(list[2], root)).toEqual({ lang: 'ar', state: '' });
    expect(axesOf(list[3], root)).toEqual({ lang: 'en', state: '' });
    expect(axesOf(list[4], root)).toEqual({ lang: 'ar', state: 'Locked' });
  });
});

describe('chip helpers', () => {
  it('names the wide sizes and strips the size from a title', () => {
    expect([cpChip(2560), cpChip(3840), cpChip(390)]).toEqual(['2K', '4K', '390']);
    expect(cpStripSize('Sign in · 1440×900')).toBe('Sign in');
    expect(cpStripSize('1440×900')).toBe('1440×900');
  });
});

describe('dcVariant', () => {
  const variants = [
    { file: 'A.dc.html', w: 1440, h: 900, href: './A.dc.html', chip: '1440', primary: true, lang: 'en', state: '' },
    { file: 'AWrong.dc.html', w: 1440, h: 900, href: './AWrong.dc.html', chip: '1440', lang: 'en', state: 'Wrong' },
    { file: 'APhone.dc.html', w: 390, h: 844, href: './APhone.dc.html', chip: '390', lang: 'en', state: '' },
  ];
  it('gives the primary and one chip group per axis that varies', () => {
    const v = dcVariant({ variants }, undefined);
    expect([v.width, v.height, v.href]).toEqual([1440, 900, './A.dc.html']);
    expect(v.axes.map((a) => a.key)).toEqual(['size', 'state']);
    expect(v.axes[0].chips.map((c) => c.label)).toEqual(['1440', '390']);
    expect(v.axes[1].chips.map((c) => c.label)).toEqual(['Main', 'Wrong']);
  });
  it('follows the chosen file and falls back to the size props', () => {
    expect(dcVariant({ variants }, 'APhone.dc.html').width).toBe(390);
    expect(dcVariant({ width: 800, height: 600, href: './B.dc.html' }, undefined)).toMatchObject({ width: 800, height: 600, href: './B.dc.html', axes: [] });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --config vitest.config.mjs src/variants.test.js`
Expected: FAIL, `Failed to resolve import "./variants.js"`.

- [ ] **Step 3: Move the code**

```bash
{
  echo "// Variant folding and chip axes, moved without change from the old"
  echo "// canvas-page.jsx (main, lines 457-495) and design-canvas.jsx (main,"
  echo "// lines 1069-1096). Only the export keywords are new."
  echo
  git show main:canvas-page.jsx | sed -n '457,495p'
  echo
  git show main:design-canvas.jsx | sed -n '1069,1096p'
} > src/variants.js
```

Then add `export ` in front of these seven declarations, and change nothing else: `const CP_CHIPS`, `const cpChip`, `const cpStripSize`, `const CP_SIZE_WORDS`, `function cpVariants`, `const DC_AXES`, `function dcVariant`. (`cpTokens` stays private.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.config.mjs src/variants.test.js` → `7 passed`.
Run: `diff <(git show main:canvas-page.jsx | sed -n '457,495p') <(sed -n '5,43p' src/variants.js | sed 's/^export //')` → no output (adjust the line numbers of the second range if the header is not 4 lines; the point is that only `export ` differs).

- [ ] **Step 5: Commit**

```bash
git add src/variants.js src/variants.test.js
git commit -m "Move the variant rules into a module"
```

---

### Task 3: The page model

**Goal:** `src/mapping.js` turns `canvas.json` and the saved state into React Flow nodes and edges, and holds the pure state patches the window actions use.

**Files:**
- Create: `src/mapping.js`, `src/mapping.test.js`

**Acceptance Criteria:**
- [ ] Variants fold into their primary; a flow on a variant moves to the primary; loops and duplicates are dropped; a flow that names a screen not on the page is dropped with exactly one `console.warn` for each such flow.
- [ ] A window node sits at `(x − 36, y − 100)` with size `(w + 72, h + 136)` of the chosen variant; a saved position wins over `canvas.json`.
- [ ] A deleted window and its edges are gone; saved arrow sides win over `canvas.json`.
- [ ] `buildNodes` keeps a window's `data` object identity when nothing about that window changed.
- [ ] `npx vitest run src/mapping.test.js` prints `13 passed`.

**Verify:** `npx vitest run --config vitest.config.mjs src/mapping.test.js` → `13 passed`

**Steps:**

- [ ] **Step 1: Write the failing tests**

`src/mapping.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { readPage, buildNodes, buildEdges, actions, flowKey, screenOf, windowBox } from './mapping.js';

const empty = () => ({ updatedAt: 0, positions: {}, variants: {}, arrowSides: {}, deleted: [] });
const DATA = {
  pages: [{ id: 'p', name: 'Sign in' }],
  artboards: [
    { file: 'SignIn.dc.html', x: 0, y: 0, w: 1440, h: 900, title: 'Sign in · 1440×900', page: 'p' },
    { file: 'SignInWrong.dc.html', x: 0, y: 1200, w: 1440, h: 900, title: 'Sign in · wrong · 1440×900', page: 'p' },
    { file: 'SignInPhone.dc.html', x: 0, y: 2400, w: 390, h: 844, title: 'Sign in · 390×844', page: 'p' },
    { file: 'Home.dc.html', x: 3000, y: 0, w: 1440, h: 1000, title: 'Home', page: 'p' },
    { file: 'Other.dc.html', x: 0, y: 0, w: 100, h: 100, page: 'q' },
  ],
  annotations: [{ id: 'n1', x: 0, y: -300, w: 980, text: 'Note', page: 'p' }],
  flows: [
    { page: 'p', from: 'SignIn.dc.html', to: 'Home.dc.html', label: 'Next', fs: 'r', ts: 'l' },
    { page: 'p', from: 'SignInWrong.dc.html', to: 'Home.dc.html', label: 'Next', fs: 'r', ts: 'l' },
    { page: 'p', from: 'SignInWrong.dc.html', to: 'SignIn.dc.html', label: 'Retry' },
    { page: 'p', from: 'Home.dc.html', to: 'Gone.dc.html', label: 'x' },
    { page: 'p', from: 'Home.dc.html', to: 'SignIn.dc.html', label: 'Back', dashed: true, fs: 'b', ts: 't' },
  ],
};
const page = (warn = () => {}) => readPage(DATA, 'p', { base: './s/', warn });
const K0 = flowKey({ from: 'SignIn.dc.html', to: 'Home.dc.html', label: 'Next' });
const K1 = flowKey({ from: 'Home.dc.html', to: 'SignIn.dc.html', label: 'Back' });

describe('readPage', () => {
  it('folds the variants into their primary window', () => {
    const { windows } = page();
    expect(windows.map((w) => w.id)).toEqual(['SignIn.dc.html', 'Home.dc.html']);
    expect(windows[0]).toMatchObject({ label: 'Sign in', title: 'Sign in · 1440×900', href: './s/SignIn.dc.html' });
    expect(windows[0].variants.map((v) => v.file)).toEqual(['SignIn.dc.html', 'SignInWrong.dc.html', 'SignInPhone.dc.html']);
    expect(windows[0].variants[2]).toMatchObject({ href: './s/SignInPhone.dc.html', chip: '390', primary: false });
    expect(windows[1]).toMatchObject({ label: 'Home', variants: null });
  });
  it('reads the head and the notes of the page only', () => {
    const p = page();
    expect(p.head).toEqual({ name: 'Sign in', subtitle: '2 screens · 2 variants' });
    expect(p.notes).toEqual([{ id: 'n1', x: 0, y: -300, w: 760, text: 'Note' }]);
  });
  it('moves flows onto primaries and drops loops, duplicates and unknown screens', () => {
    const warn = vi.fn();
    const { flows } = page(warn);
    expect(flows.map((f) => [f.from, f.to, f.label, f.fs, f.ts, f.dashed])).toEqual([
      ['SignIn.dc.html', 'Home.dc.html', 'Next', 'r', 'l', false],
      ['Home.dc.html', 'SignIn.dc.html', 'Back', 'b', 't', true],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Gone.dc.html');
  });
});

describe('buildNodes', () => {
  it('grows each window around its screen and puts the head above the content', () => {
    const nodes = buildNodes(page(), empty());
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['SignIn.dc.html']).toMatchObject({ type: 'window', position: { x: -36, y: -100 }, width: 1512, height: 1036 });
    expect(byId['Home.dc.html']).toMatchObject({ position: { x: 2964, y: -100 }, width: 1512, height: 1136 });
    expect(byId['note:n1']).toMatchObject({ type: 'note', position: { x: 0, y: -300 }, data: { w: 760, text: 'Note' } });
    expect(byId['dc-head']).toMatchObject({ type: 'head', position: { x: -36, y: -336 }, origin: [0, 1], draggable: false });
  });
  it('uses the saved position and the chosen variant', () => {
    const s = { ...empty(), positions: { 'SignIn.dc.html': { x: 100, y: 200 } }, variants: { 'SignIn.dc.html': 'SignInPhone.dc.html' } };
    const n = buildNodes(page(), s).find((x) => x.id === 'SignIn.dc.html');
    expect(n).toMatchObject({ position: { x: 64, y: 100 }, width: 462, height: 980 });
    expect(n.data.moved).toBe(true);
    expect(n.data.size.href).toBe('./s/SignInPhone.dc.html');
  });
  it('drops a deleted window', () => {
    const nodes = buildNodes(page(), { ...empty(), deleted: ['Home.dc.html'] });
    expect(nodes.map((n) => n.id)).toEqual(['SignIn.dc.html', 'note:n1', 'dc-head']);
  });
  it('keeps the data of a window that did not change', () => {
    const p = page(), cache = new Map();
    const a = buildNodes(p, empty(), cache);
    const b = buildNodes(p, { ...empty(), variants: { 'Home.dc.html': 'Home.dc.html' } }, cache);
    expect(b[0].data).toBe(a[0].data);
  });
});

describe('buildEdges', () => {
  it('gives each flow its authored sides', () => {
    const edges = buildEdges(page(), empty());
    expect(edges.map((e) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data.dashed])).toEqual([
      ['flow-0', 'SignIn.dc.html', 'Home.dc.html', 'r', 'l', false],
      ['flow-1', 'Home.dc.html', 'SignIn.dc.html', 'b', 't', true],
    ]);
    expect(buildEdges(page(), { ...empty(), deleted: ['Home.dc.html'] })).toEqual([]);
  });
  it('lets saved sides win and marks the windows whose sides moved', () => {
    const s = { ...empty(), arrowSides: { [K0]: { fs: 'b' } } };
    const e = buildEdges(page(), s)[0];
    expect([e.sourceHandle, e.targetHandle]).toEqual(['b', 'l']);
    const nodes = buildNodes(page(), s);
    expect(nodes.find((n) => n.id === 'SignIn.dc.html').data.sidesMoved).toBe(true);
    expect(nodes.find((n) => n.id === 'Home.dc.html').data.sidesMoved).toBe(false);
  });
});

describe('actions', () => {
  it('moves, resets and deletes, and bumps the revision', () => {
    let s = actions.move(empty(), 'A', { x: 1, y: 2 });
    expect(s.positions.A).toEqual({ x: 1, y: 2 });
    expect(s.updatedAt).toBeGreaterThan(0);
    const before = s.updatedAt;
    s = actions.resetPosition(s, 'A');
    expect(s.positions).toEqual({});
    expect(s.updatedAt).toBeGreaterThan(before);
    s = actions.remove(actions.remove(s, 'B'), 'B');
    expect(s.deleted).toEqual(['B']);
    expect(actions.pickVariant(s, 'A', 'A2').variants).toEqual({ A: 'A2' });
  });
  it('sets arrow sides and resets only the sides of one window', () => {
    let s = actions.setSides(empty(), K0, { fs: 'b' });
    s = actions.setSides(s, K0, { ts: 't' });
    s = actions.setSides(s, K1, { ts: 'r' });
    expect(s.arrowSides[K0]).toEqual({ fs: 'b', ts: 't' });
    expect(actions.resetSides(s, 'SignIn.dc.html').arrowSides).toEqual({ [K0]: { ts: 't' } });
  });
  it('maps a node position to the screen and back', () => {
    const size = { width: 1440, height: 900 };
    const box = windowBox({ x: 10, y: 20 }, size);
    expect(box).toEqual({ x: -26, y: -80, w: 1512, h: 1036 });
    expect(screenOf({ x: box.x, y: box.y })).toEqual({ x: 10, y: 20 });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --config vitest.config.mjs src/mapping.test.js`
Expected: FAIL, `Failed to resolve import "./mapping.js"`.

- [ ] **Step 3: Write the module**

`src/mapping.js`:

```js
import { DC } from './constants.js';
import { cpVariants, cpChip, cpStripSize, dcVariant } from './variants.js';

// The key of an arrow in the saved arrowSides map. No file name and no label
// carries the separator.
export const FLOW_KEY_SEP = '\x1f';
export const flowKey = (f) => [f.from, f.to, f.label || ''].join(FLOW_KEY_SEP);
const flowKeyParts = (key) => { const [from, to] = key.split(FLOW_KEY_SEP); return { from, to }; };

// canvas.json gives the screen's top-left corner. The window grows around it:
// the header and the padding go left and up, into the gutter.
export const windowBox = (screen, size) => ({
  x: screen.x - DC.winPad,
  y: screen.y - DC.winHead - DC.winPad,
  w: size.width + DC.winPad * 2,
  h: size.height + DC.winHead + DC.winPad * 2,
});
export const screenOf = (position) => ({ x: position.x + DC.winPad, y: position.y + DC.winHead + DC.winPad });

// canvas.json → the page as authored. Variants fold into their primary
// window. Flows drawn on a variant land on the primary; a flow that then
// loops back on itself, a duplicate, and a flow to a screen that is not on
// the page are dropped.
export function readPage(data, pageId, { base = './', warn = console.warn } = {}) {
  const onPage = data.artboards.filter((a) => a.page === pageId);
  const { primaryOf, axesOf } = cpVariants(onPage);
  const boards = onPage.filter((a) => primaryOf(a.file) === a.file);
  const sizesOf = Object.fromEntries(boards.map((b) => [b.file, [b]]));
  onPage.forEach((a) => { const p = primaryOf(a.file); if (p !== a.file) sizesOf[p].push(a); });
  const windows = boards.map((b) => {
    const stem = b.file.split('/').pop().replace('.dc.html', '');
    const list = sizesOf[b.file];
    let variants = null;
    if (list.length > 1) {
      list.sort((p, q) => (q.w - p.w) || (q.h - p.h));
      variants = list.map((s) => ({
        file: s.file, w: s.w, h: s.h, href: base + s.file, title: s.title || s.file,
        chip: cpChip(s.w), primary: s.file === b.file, ...axesOf(s, b),
      }));
    }
    return {
      id: b.file, x: b.x, y: b.y, w: b.w, h: b.h, href: base + b.file, variants,
      label: variants ? cpStripSize(b.title || stem) : (b.title || stem),
      title: b.title || b.file,
    };
  });
  const notes = (data.annotations || []).filter((n) => n.page === pageId)
    .map((n) => ({ id: n.id, x: n.x, y: n.y, w: Math.min(n.w || 480, 760), text: n.text }));
  const known = new Set(boards.map((b) => b.file));
  const seen = new Set();
  const flows = [];
  (data.flows || []).filter((f) => f.page === pageId).forEach((f) => {
    const from = primaryOf(f.from), to = primaryOf(f.to);
    if (!known.has(from) || !known.has(to)) {
      warn(`[design-canvas] the flow ${f.from} → ${f.to} names a screen that is not on page ${pageId}; it is dropped`);
      return;
    }
    if (from === to) return;
    const flow = { from, to, label: f.label || '', dashed: !!f.dashed, fs: f.fs || 'r', ts: f.ts || 'l' };
    const key = flowKey(flow);
    if (seen.has(key)) return;
    seen.add(key);
    flows.push({ ...flow, key });
  });
  const meta = (data.pages || []).find((p) => p.id === pageId);
  const variantCount = onPage.length - boards.length;
  const head = {
    name: (meta && meta.name) || pageId,
    subtitle: `${boards.length} screens` + (variantCount ? ` · ${variantCount} variant${variantCount === 1 ? '' : 's'}` : ''),
  };
  return { windows, notes, flows, head };
}

// The windows whose arrow sides the user moved: "Reset arrow sides" shows
// in their menu only.
export function movedSides(arrowSides) {
  const out = new Set();
  Object.entries(arrowSides || {}).forEach(([key, o]) => {
    const { from, to } = flowKeyParts(key);
    if (o.fs) out.add(from);
    if (o.ts) out.add(to);
  });
  return out;
}

const DATA_KEYS = ['label', 'title', 'size', 'moved', 'sidesMoved'];
const sameData = (a, b) => DATA_KEYS.every((k) => a[k] === b[k]);

// The page plus the saved edits → React Flow nodes. `cache` lives as long as
// the page: a window keeps its size and data objects while its own inputs do
// not change, so a patch re-renders only the windows it touches.
export function buildNodes(page, state, cache = new Map()) {
  const deleted = new Set(state.deleted);
  const sides = movedSides(state.arrowSides);
  const nodes = [];
  let x0 = Infinity, y0 = Infinity;
  for (const w of page.windows) {
    if (deleted.has(w.id)) continue;
    const chosen = state.variants[w.id];
    let hit = cache.get(w.id);
    if (!hit || hit.chosen !== chosen) {
      hit = { chosen, size: dcVariant({ variants: w.variants, width: w.w, height: w.h, href: w.href }, chosen), data: null };
      cache.set(w.id, hit);
    }
    const saved = state.positions[w.id];
    const data = { label: w.label, title: w.title, size: hit.size, moved: !!saved, sidesMoved: sides.has(w.id) };
    if (!hit.data || !sameData(hit.data, data)) hit.data = data;
    const box = windowBox(saved || { x: w.x, y: w.y }, hit.size);
    x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y);
    nodes.push({
      id: w.id, type: 'window', position: { x: box.x, y: box.y }, width: box.w, height: box.h,
      // The header drags the window. With Ctrl or ⌘ held the screen does too.
      dragHandle: '.dc-winhead, .dc-grab .dc-shield', data: hit.data,
    });
  }
  for (const n of page.notes) {
    const id = 'note:' + n.id;
    const p = state.positions[id] || { x: n.x, y: n.y };
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    let hit = cache.get(id);
    if (!hit || hit.data.w !== n.w || hit.data.text !== n.text) { hit = { data: { w: n.w, text: n.text } }; cache.set(id, hit); }
    nodes.push({ id, type: 'note', position: { x: p.x, y: p.y }, connectable: false, data: hit.data });
  }
  if (Number.isFinite(x0)) {
    nodes.push({
      id: 'dc-head', type: 'head', position: { x: x0, y: y0 - DC.sectionHeadGap }, origin: [0, 1],
      draggable: false, selectable: false, connectable: false, focusable: false, data: page.head,
    });
  }
  return nodes;
}

// The flows → React Flow edges. Saved sides win over canvas.json.
export function buildEdges(page, state) {
  const deleted = new Set(state.deleted);
  const out = [];
  page.flows.forEach((f, i) => {
    if (deleted.has(f.from) || deleted.has(f.to)) return;
    const o = state.arrowSides[f.key] || {};
    out.push({
      id: 'flow-' + i, type: 'flow', source: f.from, target: f.to,
      sourceHandle: o.fs || f.fs, targetHandle: o.ts || f.ts, reconnectable: true,
      data: { key: f.key, label: f.label, dashed: f.dashed },
    });
  });
  return out;
}

// Every patch bumps the revision: the newer revision wins on the next load.
const bump = (s, p) => ({ ...s, ...p, updatedAt: Math.max(Date.now(), s.updatedAt + 1) });
export const actions = {
  move: (s, id, p) => bump(s, { positions: { ...s.positions, [id]: { x: p.x, y: p.y } } }),
  resetPosition: (s, id) => { const positions = { ...s.positions }; delete positions[id]; return bump(s, { positions }); },
  pickVariant: (s, id, file) => bump(s, { variants: { ...s.variants, [id]: file } }),
  remove: (s, id) => bump(s, { deleted: [...s.deleted.filter((d) => d !== id), id] }),
  setSides: (s, key, sides) => bump(s, { arrowSides: { ...s.arrowSides, [key]: { ...(s.arrowSides[key] || {}), ...sides } } }),
  resetSides: (s, id) => {
    const arrowSides = {};
    Object.entries(s.arrowSides).forEach(([key, o]) => {
      const { from, to } = flowKeyParts(key), r = { ...o };
      if (from === id) delete r.fs;
      if (to === id) delete r.ts;
      if (Object.keys(r).length) arrowSides[key] = r;
    });
    return bump(s, { arrowSides });
  },
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.config.mjs src/mapping.test.js` → `13 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/mapping.js src/mapping.test.js
git commit -m "Map canvas.json and saved edits to nodes"
```

---

### Task 4: The live budget

**Goal:** `src/liveBudget.js` ranks the windows that hold a live iframe with the old engine's rules plus the spike's sticky rule, and a small store runs the pass: 600 ms after the last move, never during a gesture, one mount each 60 ms.

**Files:**
- Create: `src/liveBudget.js`, `src/liveBudget.test.js`

**Acceptance Criteria:**
- [ ] `rankLive` is pure: visible windows first, then the distance from the view middle; a live window counts 400 px nearer; a touched window counts 1e6 px nearer but never outranks a visible one; a window mounts only within 600 px of the view and a live one drops beyond 1600 px; a live window that is on screen is never dropped; the result never has more than 8 ids.
- [ ] The store runs no pass between `moveStart` and `moveEnd`, runs one 600 ms after the last `schedule`/`moveEnd`, and mounts at most one window each 60 ms.
- [ ] `npx vitest run src/liveBudget.test.js` prints `13 passed`.

**Verify:** `npx vitest run --config vitest.config.mjs src/liveBudget.test.js` → `13 passed`

**Steps:**

- [ ] **Step 1: Write the failing tests**

`src/liveBudget.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET, rankLive, createLiveBudget, boxesOf } from './liveBudget.js';

// A 1000 × 800 view at zoom 1, so world px = screen px. Its middle is (500, 400).
const V = { x: 0, y: 0, zoom: 1 }, P = { w: 1000, h: 800 };
const box = (id, x, y, w = 200, h = 200) => ({ id, x, y, w, h });
const one = { ...BUDGET, size: 1 };
const rank = (prev, boxes, cfg = BUDGET, touched = new Map(), now = 0, view = V) => rankLive(new Set(prev), view, P, boxes, touched, now, cfg);

describe('rankLive', () => {
  it('puts a visible window before a nearer window off screen', () => {
    // A: visible in the corner, 612 px from the middle. B: above the view, 450 px.
    expect(rank([], [box('A', 980, 780), box('B', 400, -250)], one)).toEqual(['A']);
  });
  it('keeps the budget of 8', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => box('w' + i, i * 60, 100, 50, 50));
    expect(rank([], boxes)).toHaveLength(8);
  });
  it('lets a live window count 400 px nearer, and drops it only past 1600 px', () => {
    // Z is 600 px left of the view (1100 px from the middle), W is 300 px right (800 px).
    const boxes = [box('Z', -800, 350, 200, 100), box('W', 1300, 350, 200, 100)];
    expect(rank(['Z'], boxes, one)).toEqual(['Z']);
    expect(rank([], boxes, one)).toEqual(['W']);   // not live, Z is past the 600 px mount margin
  });
  it('drops a live window more than 1600 px outside the view', () => {
    expect(rank(['F'], [box('F', 2700, 300)], one)).toEqual([]);
  });
  it('lets a touched window outrank other off-screen windows, never a visible one', () => {
    const touched = new Map([['T', 1000]]);
    expect(rank([], [box('V', 980, 780), box('T', 1300, 350, 200, 100)], one, touched, 2000)).toEqual(['V']);
    expect(rank([], [box('U', 400, -250), box('T', 1300, 350, 200, 100)], one, touched, 2000)).toEqual(['T']);
    expect(rank([], [box('U', 400, -250), box('T', 1300, 350, 200, 100)], one, touched, 6000)).toEqual(['U']);
  });
  it('never drops a live window that is on screen (the sticky rule)', () => {
    const boxes = [box('A', 980, 780), box('C', 450, 350, 100, 100)];
    expect(rank(['A'], boxes, one)).toEqual(['A']);
    expect(rank([], boxes, one)).toEqual(['C']);
  });
  it('never returns more than the budget', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => box('w' + i, i * 60, 100, 50, 50));
    const prev = ['w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w11'];
    const got = rank(prev, boxes);
    expect(got).toHaveLength(8);
    expect(new Set(got)).toEqual(new Set(prev));
  });
  it('maps world boxes through the view', () => {
    expect(rank([], [box('X', 2000, 0)], one, new Map(), 0, { x: -1000, y: 0, zoom: 0.5 })).toEqual(['X']);
  });
});

describe('createLiveBudget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const tenVisible = Array.from({ length: 10 }, (_, i) => box('w' + i, i * 90, 100, 80, 80));

  it('runs a pass 600 ms after the last call and mounts one window each 60 ms', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.schedule(); vi.advanceTimersByTime(300); b.schedule();
    vi.advanceTimersByTime(599); expect(b.liveIds()).toEqual([]);
    vi.advanceTimersByTime(1); expect(b.liveIds()).toHaveLength(1);
    vi.advanceTimersByTime(60); expect(b.liveIds()).toHaveLength(2);
    vi.advanceTimersByTime(60 * 6); expect(b.liveIds()).toHaveLength(8);
    vi.advanceTimersByTime(5000); expect(b.liveIds()).toHaveLength(8);
  });
  it('runs no pass between moveStart and moveEnd', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.schedule(); vi.advanceTimersByTime(300);
    b.moveStart(); b.schedule(); vi.advanceTimersByTime(5000);
    expect(b.liveIds()).toEqual([]);
    b.moveEnd(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toHaveLength(1);
  });
  it('tells the subscribers of each change', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible.slice(0, 2) }), now: () => Date.now() });
    const heard = vi.fn();
    const off = b.subscribe(heard);
    b.schedule(); vi.advanceTimersByTime(600 + 60);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(b.isLive('w0') && b.isLive('w1')).toBe(true);
    off(); b.dispose();
  });
  it('keeps a touched window off screen in the budget', () => {
    const boxes = [box('U', 400, -250), box('T', 1300, 350, 200, 100)];
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes }), cfg: one, now: () => Date.now() });
    b.touch('T'); b.schedule(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toEqual(['T']);
  });
});

describe('boxesOf', () => {
  it('gives the window boxes only', () => {
    const nodes = [
      { id: 'a', type: 'window', position: { x: 1, y: 2 }, width: 3, height: 4 },
      { id: 'note:n', type: 'note', position: { x: 0, y: 0 } },
    ];
    expect(boxesOf(nodes)).toEqual([{ id: 'a', x: 1, y: 2, w: 3, h: 4 }]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --config vitest.config.mjs src/liveBudget.test.js`
Expected: FAIL, `Failed to resolve import "./liveBudget.js"`.

- [ ] **Step 3: Write the module**

`src/liveBudget.js`:

```js
import { DC } from './constants.js';

// The live budget. At most DC.liveBudget windows hold a live iframe; all
// other windows show a placeholder. The rules are the old engine's, plus the
// sticky rule the React Flow spike proved necessary: a zoom in several
// pinches moved the view middle between the pinches, and the old ranking then
// swapped screens the user could still see for their placeholder.
export const BUDGET = {
  size: DC.liveBudget,
  margin: DC.mountMargin,
  unmountMargin: DC.unmountMargin,
  hysteresis: DC.budgetHysteresis,
  touchMs: DC.touchMs,
  touchBias: DC.touchBias,
  settleMs: DC.stickySettleMs,
  mountGapMs: DC.mountGapMs,
};

export const boxesOf = (nodes) => nodes.filter((n) => n.type === 'window')
  .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height }));

// Pure. The live set this pass wants, in rank order.
// prev: Set of live ids. view: { x, y, zoom }. pane: { w, h } screen px.
// boxes: [{ id, x, y, w, h }] world px. touched: Map id → time. now: ms.
export function rankLive(prev, view, pane, boxes, touched, now, cfg = BUDGET) {
  const { x, y, zoom } = view;
  const cx = pane.w / 2, cy = pane.h / 2;
  const rows = [];
  for (const b of boxes) {
    const l = b.x * zoom + x, t = b.y * zoom + y, r = l + b.w * zoom, btm = t + b.h * zoom;
    const live = prev.has(b.id);
    const m = live ? cfg.unmountMargin : cfg.margin;
    if (!(r > -m && l < pane.w + m && btm > -m && t < pane.h + m)) continue;
    const visible = r > 0 && l < pane.w && btm > 0 && t < pane.h;
    const at = touched.get(b.id);
    const d = Math.hypot(Math.max(l - cx, 0, cx - r), Math.max(t - cy, 0, cy - btm))
      - (live ? cfg.hysteresis : 0)
      - (at !== undefined && now - at < cfg.touchMs ? cfg.touchBias : 0);
    rows.push({ id: b.id, live, visible, d });
  }
  rows.sort((a, b) => Number(b.visible) - Number(a.visible) || a.d - b.d);
  // The sticky rule. `keep` is a subset of the previous live set, so the
  // result never grows past the budget.
  const keep = rows.filter((r) => r.visible && r.live).map((r) => r.id);
  const kept = new Set(keep);
  const fill = rows.filter((r) => !kept.has(r.id)).slice(0, Math.max(0, cfg.size - keep.length)).map((r) => r.id);
  return [...keep, ...fill];
}

// The store. `read()` returns { view, pane, boxes } at the time of the pass.
// A pass drops at once, but mounts one window only; if more wait, the next
// pass runs cfg.mountGapMs later, because two mounts in one frame make it long.
export function createLiveBudget({ read, cfg = BUDGET, now = () => performance.now() }) {
  const live = new Set();
  const touched = new Map();
  const subs = new Set();
  let moving = false, timer = 0;
  const emit = () => subs.forEach((fn) => fn());
  const run = () => {
    timer = 0;
    if (moving) return;
    const { view, pane, boxes } = read();
    const target = rankLive(live, view, pane, boxes, touched, now(), cfg);
    const want = new Set(target);
    let changed = false;
    for (const id of live) if (!want.has(id)) { live.delete(id); changed = true; }
    const next = target.find((id) => !live.has(id));
    if (next !== undefined) {
      live.add(next); changed = true;
      if (target.some((id) => !live.has(id))) timer = setTimeout(run, cfg.mountGapMs);
    }
    if (changed) emit();
  };
  const schedule = () => { clearTimeout(timer); timer = moving ? 0 : setTimeout(run, cfg.settleMs); };
  return {
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    isLive: (id) => live.has(id),
    liveIds: () => [...live],
    schedule,
    moveStart: () => { moving = true; clearTimeout(timer); timer = 0; },
    moveEnd: () => { moving = false; schedule(); },
    touch: (id) => { touched.set(id, now()); },
    dispose: () => { clearTimeout(timer); timer = 0; subs.clear(); },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.config.mjs src/liveBudget.test.js` → `13 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/liveBudget.js src/liveBudget.test.js
git commit -m "Add the sticky live budget"
```

---

### Task 5: Saved state

**Goal:** `src/persist.js` restores the page state (state file against the browser copy, the newer revision wins, the browser copy wins a tie, give up on the file after 1500 ms) and saves it (browser copy at once, file 400 ms after the last edit, a failed file write is sent again on `pagehide`).

**Files:**
- Create: `src/persist.js`, `src/persist.test.js`

**Acceptance Criteria:**
- [ ] `pickNewer` returns the newer valid state, the browser copy on a tie, and an empty state when neither is valid; a state in the old `{ sections }` format is not valid.
- [ ] `restoreState` resolves with the browser copy after 1500 ms when the file read hangs.
- [ ] The saver writes the browser copy at once, the file once for a burst of saves, sends a failed write again on `pagehide`, does not send a written state again, and survives a `localStorage` that throws.
- [ ] `npx vitest run src/persist.test.js` prints `11 passed`.

**Verify:** `npx vitest run --config vitest.config.mjs src/persist.test.js` → `11 passed`

**Steps:**

- [ ] **Step 1: Write the failing tests**

`src/persist.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, pickNewer, restoreState, createSaver, stateKey } from './persist.js';

const st = (updatedAt, extra = {}) => ({ updatedAt, positions: {}, variants: {}, arrowSides: {}, deleted: [], ...extra });
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};
const res = (body, ok = true) => ({ ok, json: async () => body });
const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pickNewer', () => {
  it('takes the newer revision, and the browser copy on a tie', () => {
    expect(pickNewer(st(10), st(20)).updatedAt).toBe(20);
    expect(pickNewer(st(20), st(10)).updatedAt).toBe(20);
    const local = st(5, { deleted: ['L'] });
    expect(pickNewer(st(5), local)).toBe(local);
  });
  it('ignores a state that is not valid, including the old format', () => {
    expect(pickNewer({ sections: { p: {} }, updatedAt: 99 }, st(1)).updatedAt).toBe(1);
    expect(pickNewer(st(3), 'junk').updatedAt).toBe(3);
    expect(pickNewer(null, null)).toEqual(emptyState());
  });
});

describe('restoreState', () => {
  it('reads the state file beside the page and keeps the newer copy', async () => {
    const fetchImpl = vi.fn(async () => res(st(30)));
    const storage = memStorage({ k: JSON.stringify(st(20)) });
    const s = await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl, storage });
    expect(fetchImpl.mock.calls[0][0]).toBe('./f.json');
    expect(s.updatedAt).toBe(30);
  });
  it('uses the browser copy when the file is missing or the read fails', async () => {
    const storage = memStorage({ k: JSON.stringify(st(20)) });
    expect((await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: async () => res(null, false), storage })).updatedAt).toBe(20);
    expect((await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: async () => { throw new Error('offline'); }, storage })).updatedAt).toBe(20);
  });
  it('uses the file when the browser storage throws', async () => {
    expect((await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: async () => res(st(7)), storage: throwing })).updatedAt).toBe(7);
  });
  it('gives up on a file read that hangs after 1500 ms', async () => {
    const storage = memStorage({ k: JSON.stringify(st(20)) });
    let done = null;
    restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: () => new Promise(() => {}), storage }).then((s) => { done = s; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(null);
    await vi.advanceTimersByTimeAsync(1);
    expect(done.updatedAt).toBe(20);
  });
});

describe('createSaver', () => {
  const make = (writeFile, storage = memStorage()) => {
    const events = new EventTarget();
    return { events, storage, saver: createSaver({ stateFile: 'f.json', key: 'k', storage, events, writeFile, warn: () => {} }) };
  };
  it('writes the browser copy at once and the file once after 400 ms', async () => {
    const writes = [];
    const { storage, saver } = make(async (file, text) => { writes.push([file, JSON.parse(text).updatedAt]); });
    saver.save(st(1)); saver.save(st(2));
    expect(JSON.parse(storage.getItem('k')).updatedAt).toBe(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([['f.json', 2]]);
  });
  it('sends a failed file write again on pagehide', async () => {
    let fail = true;
    const writes = [];
    const { events, saver } = make(async (file, text) => { writes.push(JSON.parse(text).updatedAt); if (fail) throw new Error('read-only'); });
    saver.save(st(3));
    await vi.advanceTimersByTimeAsync(400);
    fail = false;
    events.dispatchEvent(new Event('pagehide'));
    await saver.settled();
    expect(writes).toEqual([3, 3]);
  });
  it('does not send a written state again, also when the host has no writeFile', async () => {
    const writeFile = vi.fn(() => undefined);
    const { events, saver } = make(writeFile);
    saver.save(st(4));
    await vi.advanceTimersByTimeAsync(400);
    events.dispatchEvent(new Event('pagehide'));
    await saver.settled();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
  it('survives a browser storage that throws', async () => {
    const writeFile = vi.fn(async () => {});
    const { saver } = make(writeFile, throwing);
    expect(() => saver.save(st(5))).not.toThrow();
    await vi.advanceTimersByTimeAsync(400);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe('stateKey', () => {
  it('scopes the browser copy by page path and state file', () => {
    expect(stateKey('f.json', '/sample/index.html')).toBe('dc2-state:/sample/index.html:f.json');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --config vitest.config.mjs src/persist.test.js`
Expected: FAIL, `Failed to resolve import "./persist.js"`.

- [ ] **Step 3: Write the module**

`src/persist.js`:

```js
import { DC } from './constants.js';

// The saved edits of one page. canvas.json stays the authored baseline; this
// is the layer on top of it.
export const emptyState = () => ({ updatedAt: 0, positions: {}, variants: {}, arrowSides: {}, deleted: [] });
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const isState = (s) => isMap(s) && isMap(s.positions) && isMap(s.variants) && isMap(s.arrowSides) && Array.isArray(s.deleted);
const revision = (s) => (Number.isFinite(s.updatedAt) ? s.updatedAt : 0);

// The newer revision wins. The browser copy wins a tie: it can hold edits
// made where the state file cannot be written.
export function pickNewer(file, local) {
  const f = isState(file) ? file : null;
  const l = isState(local) ? local : null;
  if (l && (!f || revision(l) >= revision(f))) return l;
  return f || emptyState();
}

export const stateKey = (stateFile, path = location.pathname) => 'dc2-state:' + path + ':' + stateFile;

// Reads the state file beside the page and the browser copy. A file read
// that fails or takes longer than DC.stateTimeoutMs counts as no file.
export async function restoreState({ stateFile, key, fetchImpl = (...args) => fetch(...args),
  storage = globalThis.localStorage, timeoutMs = DC.stateTimeoutMs }) {
  const controller = new AbortController();
  let timer;
  const read = (async () => {
    const r = await fetchImpl('./' + stateFile, { signal: controller.signal });
    return r.ok ? r.json() : null;
  })().catch(() => null);
  const giveUp = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
  const file = await Promise.race([read, giveUp]);
  clearTimeout(timer);
  let local = null;
  try { local = JSON.parse(storage.getItem(key) || 'null'); } catch {}
  return pickNewer(file, local);
}

// Saves each new state. The browser copy is written at once, so a reload
// before the debounce keeps the edit. The host file (claude.ai/design's
// window.omelette.writeFile) is written DC.saveDebounceMs after the last
// save. A state counts as written only after the host write ends, so a
// failed write stays pending and pagehide sends it again.
export function createSaver({ stateFile, key, storage = globalThis.localStorage,
  events = globalThis.window || new EventTarget(),
  writeFile = (file, text) => globalThis.window?.omelette?.writeFile(file, text),
  debounceMs = DC.saveDebounceMs, warn = console.warn }) {
  let pending = null, written = null, timer = 0, chain = Promise.resolve();
  const write = () => {
    clearTimeout(timer); timer = 0;
    if (!pending || pending === written) return chain;
    const mine = pending, text = JSON.stringify(mine);
    chain = chain.then(() => writeFile(stateFile, text)).then(
      () => { written = mine; },
      (err) => warn('[design-canvas] the state file write failed; the browser copy holds the edits', err));
    return chain;
  };
  events.addEventListener('pagehide', write);
  return {
    save(state) {
      pending = state;
      try { storage.setItem(key, JSON.stringify(state)); } catch {}
      clearTimeout(timer);
      timer = setTimeout(write, debounceMs);
    },
    flush: write,
    settled: () => chain,
    dispose() { clearTimeout(timer); events.removeEventListener('pagehide', write); },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.config.mjs src/persist.test.js` → `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/persist.js src/persist.test.js
git commit -m "Add the saved-state restore and saver"
```

---

### Task 6: View math and the host protocol

**Goal:** `src/view.js` holds the old fit, the on-screen test for the lost pill, the mouse-wheel zoom and the `--dc-inv-zoom` writer; `src/host.js` holds the postMessage host protocol, unchanged for the host.

**Files:**
- Create: `src/view.js`, `src/view.test.js`, `src/host.js`, `src/host.test.js`

**Acceptance Criteria:**
- [ ] `fitView` leaves 80 px around the content and never goes above 1:1; `zoomAround` keeps the world point under the pointer and clamps the zoom to 0.05–4.
- [ ] `isMouseWheel` is the old test: a line or page wheel, or a whole `deltaY` of 40 px or more with no `deltaX`.
- [ ] The `--dc-inv-zoom` writer writes on the first call, on each 1.25× change and on `force`, and skips smaller changes.
- [ ] The host posts `__dc_present` on start and on `__dc_probe`, posts `__dc_zoom` once per new settled scale and again after a probe, only when embedded; `__dc_set_zoom` with a finite positive scale calls `zoomTo`.
- [ ] `npx vitest run src/view.test.js src/host.test.js` prints `11 passed`.

**Verify:** `npx vitest run --config vitest.config.mjs src/view.test.js src/host.test.js` → `11 passed`

**Steps:**

- [ ] **Step 1: Write the failing tests**

`src/view.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { fitView, anyOnScreen, isMouseWheel, zoomAround, createInvZoom } from './view.js';

const P = { w: 1280, h: 800 };

describe('fitView', () => {
  it('leaves 80 px around the content', () => {
    const v = fitView({ x: 0, y: 0, width: 2000, height: 1000 }, P);
    expect(v.zoom).toBeCloseTo(0.56, 10);
    expect(v.x).toBeCloseTo(80, 6);
    expect(v.y).toBeCloseTo(120, 6);
  });
  it('never goes above 1:1', () => {
    expect(fitView({ x: 50, y: 50, width: 100, height: 100 }, P)).toEqual({ zoom: 1, x: 540, y: 300 });
  });
});

describe('anyOnScreen', () => {
  it('tests boxes through the view', () => {
    const view = { x: -1000, y: 0, zoom: 0.5 };
    expect(anyOnScreen([{ x: 2000, y: 0, w: 100, h: 100 }], view, P)).toBe(true);
    expect(anyOnScreen([{ x: 0, y: 0, w: 100, h: 100 }], view, P)).toBe(false);
  });
});

describe('wheel', () => {
  it('knows a mouse wheel from a trackpad scroll', () => {
    expect(isMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 3.5 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 2, deltaY: 100 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 20 })).toBe(false);
  });
  it('zooms around the pointer and clamps the zoom', () => {
    const v = zoomAround({ x: 10, y: 20, zoom: 1 }, 500, 400, 2);
    expect(v).toEqual({ zoom: 2, x: -480, y: -360 });
    expect(zoomAround({ x: 0, y: 0, zoom: 3 }, 0, 0, 2).zoom).toBe(4);
    expect(zoomAround({ x: 0, y: 0, zoom: 0.06 }, 0, 0, 0.5).zoom).toBe(0.05);
  });
});

describe('createInvZoom', () => {
  it('writes on the first call, each 1.25x change, and on force', () => {
    const writes = [];
    const el = { style: { setProperty: (name, value) => writes.push([name, value]) } };
    const inv = createInvZoom(() => el);
    inv(1); inv(1.2); inv(1.3); inv(1.31, true);
    expect(writes).toEqual([['--dc-inv-zoom', '1'], ['--dc-inv-zoom', String(1 / 1.3)], ['--dc-inv-zoom', String(1 / 1.31)]]);
  });
});
```

`src/host.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { createHost } from './host.js';

const make = (embedded, zoom = { v: 0.5 }) => {
  const target = new EventTarget();
  const posts = [];
  const zoomTo = vi.fn();
  const host = createHost({ getZoom: () => zoom.v, zoomTo, target, embedded, post: (m) => posts.push(m) });
  const send = (data) => target.dispatchEvent(new MessageEvent('message', { data }));
  return { host, posts, zoomTo, send, zoom };
};

describe('createHost', () => {
  it('says it is present when embedded', () => {
    expect(make(true).posts).toEqual([{ type: '__dc_present' }]);
  });
  it('posts each new settled zoom once', () => {
    const { host, posts, zoom } = make(true);
    host.settled(); host.settled();
    zoom.v = 0.25; host.settled();
    expect(posts.filter((m) => m.type === '__dc_zoom').map((m) => m.scale)).toEqual([0.5, 0.25]);
  });
  it('answers a probe and posts the zoom again', () => {
    const { host, posts, send } = make(true);
    host.settled(); send({ type: '__dc_probe' });
    expect(posts.map((m) => m.type)).toEqual(['__dc_present', '__dc_zoom', '__dc_present', '__dc_zoom']);
  });
  it('sets the zoom the host asks for, and only a real scale', () => {
    const { send, zoomTo } = make(false);
    send({ type: '__dc_set_zoom', scale: 2 });
    send({ type: '__dc_set_zoom', scale: 'big' });
    send({ type: '__dc_set_zoom', scale: 0 });
    expect(zoomTo.mock.calls).toEqual([[2]]);
  });
  it('posts nothing at the top level, and stops after dispose', () => {
    const { host, posts, send, zoomTo } = make(false);
    host.settled(); send({ type: '__dc_probe' });
    expect(posts).toEqual([]);
    host.dispose(); send({ type: '__dc_set_zoom', scale: 2 });
    expect(zoomTo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --config vitest.config.mjs src/view.test.js src/host.test.js`
Expected: FAIL, `Failed to resolve import "./view.js"` and `"./host.js"`.

- [ ] **Step 3: Write the modules**

`src/view.js`:

```js
import { DC } from './constants.js';

// The old "Back to content" fit: the content box with DC.fitPad screen px on
// each side, centred, and never above 1:1. bounds: { x, y, width, height } in
// world px. pane: { w, h } screen px. Returns a React Flow viewport.
export function fitView(bounds, pane, { pad = DC.fitPad, minZoom = DC.minZoom, maxZoom = DC.maxZoom } = {}) {
  const zoom = Math.min(1, maxZoom, Math.max(minZoom,
    Math.min((pane.w - pad * 2) / bounds.width, (pane.h - pad * 2) / bounds.height)));
  return {
    zoom,
    x: (pane.w - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (pane.h - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

// True when one of the world boxes is inside the view. Arithmetic only: the
// lost-pill test runs on each move frame and must read no DOM rect.
export function anyOnScreen(boxes, view, pane) {
  return boxes.some((b) => {
    const l = b.x * view.zoom + view.x, t = b.y * view.zoom + view.y;
    return l + b.w * view.zoom > 0 && l < pane.w && t + b.h * view.zoom > 0 && t < pane.h;
  });
}

// A mouse wheel zooms, a trackpad scroll pans: the old engine's test.
export const isMouseWheel = (e) => e.deltaMode !== 0
  || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);

// The viewport after a zoom by `factor` that keeps the world point under the
// screen point (px, py) in place.
export function zoomAround(view, px, py, factor, { minZoom = DC.minZoom, maxZoom = DC.maxZoom } = {}) {
  const zoom = Math.min(maxZoom, Math.max(minZoom, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

// --dc-inv-zoom is 1 / zoom. The arrow strokes, the dashes and the section
// head read it to keep their screen size. The variable is inherited, so each
// write recalculates the style of the whole canvas: it is written only on a
// DC.invZoomStep change during a gesture, and exactly on settle (force).
export function createInvZoom(getEl, step = DC.invZoomStep) {
  let last = 0;
  return (zoom, force = false) => {
    const el = getEl();
    if (!el || !(zoom > 0)) return;
    if (!force && last && Math.abs(Math.log(zoom / last)) < Math.log(step)) return;
    last = zoom;
    el.style.setProperty('--dc-inv-zoom', String(1 / zoom));
  };
}
```

`src/host.js`:

```js
// The host protocol: a canvas in an iframe talks to its host with
// postMessage, target origin '*'. A canvas that is not embedded posts
// nothing: it would only talk to itself.
//   canvas → host: { type: '__dc_present' } on start and as the probe answer
//   canvas → host: { type: '__dc_zoom', scale } once per settled gesture,
//                  never the same scale twice (a probe resets that)
//   host → canvas: { type: '__dc_set_zoom', scale } zooms on the view middle
//   host → canvas: { type: '__dc_probe' }
export function createHost({ getZoom, zoomTo, target = globalThis.window,
  embedded = () => !!globalThis.window && globalThis.window.parent !== globalThis.window,
  post = (msg) => globalThis.window.parent.postMessage(msg, '*') }) {
  const isEmbedded = () => (typeof embedded === 'function' ? embedded() : !!embedded);
  let posted;
  const settled = () => {
    if (!isEmbedded()) return;
    const scale = getZoom();
    if (scale === posted) return;
    posted = scale;
    post({ type: '__dc_zoom', scale });
  };
  const onMessage = (e) => {
    const d = e.data;
    if (d && d.type === '__dc_set_zoom' && Number.isFinite(d.scale) && d.scale > 0) zoomTo(d.scale);
    else if (d && d.type === '__dc_probe') {
      if (isEmbedded()) post({ type: '__dc_present' });
      posted = undefined;
      settled();
    }
  };
  target.addEventListener('message', onMessage);
  if (isEmbedded()) post({ type: '__dc_present' });
  return { settled, dispose: () => target.removeEventListener('message', onMessage) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.config.mjs src/view.test.js src/host.test.js` → `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/view.js src/view.test.js src/host.js src/host.test.js
git commit -m "Add the view math and the host protocol"
```

---

### Task 7: Export

**Goal:** `src/export.js` holds the per-screen PNG/HTML export moved without change from the old engine.

**Files:**
- Create: `src/export.js`, `src/export.test.js`

**Acceptance Criteria:**
- [ ] The code is byte-identical to `main`'s `design-canvas.jsx` lines 414–534 and line 1366; only `export` keywords and a header comment are added.
- [ ] `npx vitest run src/export.test.js` prints `1 passed` (the name rule; the pixel checks run in the browser in Task 9).

**Verify:** `npx vitest run --config vitest.config.mjs src/export.test.js` → `1 passed`

**Steps:**

- [ ] **Step 1: Write the failing test**

`src/export.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { dcExportName } from './export.js';

describe('dcExportName', () => {
  it('keeps letters of every script and replaces separators', () => {
    expect(dcExportName('صفحة عربية', 'x')).toBe('صفحة عربية');
    expect(dcExportName('a/b:c', 'x')).toBe('a_b_c');
    expect(dcExportName('', 'id-1')).toBe('id-1');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --config vitest.config.mjs src/export.test.js`
Expected: FAIL, `Failed to resolve import "./export.js"`.

- [ ] **Step 3: Move the code**

```bash
{
  echo "// PNG / HTML export of one screen, moved without change from the old"
  echo "// design-canvas.jsx (main, lines 414-534 and 1366). It reads the screen's"
  echo "// own file, so it works whether the window is live or not. Only the"
  echo "// export keywords are new."
  echo
  git show main:design-canvas.jsx | sed -n '414,534p'
  echo
  git show main:design-canvas.jsx | sed -n '1366p'
} > src/export.js
```

Then add `export ` in front of these declarations, and change nothing else: `const dcBlobToDataUrl`, `function dcFontCss`, `async function dcInlineCss`, `async function dcInlineDoc`, `function dcArtboardSvg`, `const dcSvgUrl`, `async function dcExportArtboard`, `const dcExportName`. (`dcFontCache` and `dcReplaceAsync` stay private.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run --config vitest.config.mjs src/export.test.js` → `1 passed`.
Run: `npm run test:unit` → all unit tests pass (`58 passed`).

- [ ] **Step 5: Commit**

```bash
git add src/export.js src/export.test.js
git commit -m "Move the screen export into a module"
```

---

### Task 8: The canvas page in the browser

**Goal:** `DesignCanvas.mount(el, opts)` draws a page with React Flow: windows (dot, name, chips, ⋯ menu, ↗, screen), notes, the section head, the arrows with their labels, the dots, the first view, and the live budget under the four spike rules; a new headless browser suite proves the page and the budget.

**Files:**
- Create: `src/context.js`, `src/styles.css`, `src/WindowNode.jsx`, `src/NoteNode.jsx`, `src/SectionHead.jsx`, `src/FlowEdge.jsx`, `src/BackPill.jsx`, `src/CanvasPage.jsx`, `src/canvas.html`, `sample/index-rf.html`, `tests/rf/regressions.html`, `tests/rf/harness.js`, `tests/rf/checks-page.js`, `tests/rf/run-all.js`
- Modify: `src/main.jsx` (replace the stub), `package.json` (the `build` script), `tests/run.mjs` (`--page=`)

**Acceptance Criteria:**
- [ ] `npm run build` exits 0 and writes `dist/design-canvas.js` and `dist/canvas.html`.
- [ ] `npm run test:browser` prints `PASS` for each of the 6 checks in `checks-page.js` and ends with `PASS: canvas regressions`.
- [ ] The checks prove: the sample draws 10 windows, 1 note, the head `Invoices · ZATCA` / `10 screens · 1 variant` and 12 arrows; 1–8 live iframes at the fit and after a zoom, with the window in the middle live; no iframe mounts or drops during a wheel gesture; a zoom in 12 pinches with pauses turns no on-screen live window into its placeholder; the viewport's `will-change` is `auto` and each live iframe's is `transform`; a `canvas.json` that does not load shows `canvas.json did not load: HTTP 404`.
- [ ] `node tests/run.mjs 2>&1 | tail -1` (old suite) still prints `PASS: canvas regressions`.

**Verify:** `npm run test:browser 2>&1 | tail -1` → `PASS: canvas regressions`

**Steps:**

- [ ] **Step 1: Let the runner open another suite page**

In `tests/run.mjs`, replace the line that sets `chromePath`:

```js
const chromePath = process.argv[2] || process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
```

with:

```js
// node tests/run.mjs [chrome-path] [--page=tests/rf/regressions.html]
const args = process.argv.slice(2);
const pageArg = args.find((a) => a.startsWith('--page='));
const suitePage = pageArg ? pageArg.slice('--page='.length) : 'tests/regressions.html';
const chromePath = args.find((a) => !a.startsWith('--')) || process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
```

and in the `Page.navigate` call replace `/tests/regressions.html` with `/${suitePage}`. Run `node tests/run.mjs 2>&1 | tail -1` → `PASS: canvas regressions` (the default is unchanged).

- [ ] **Step 2: Write the suite scaffold and the page checks**

`tests/rf/regressions.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Canvas regressions</title>
<body style="margin:0">
<div id="fixture" style="position:fixed;inset:0"></div>
<pre id="results" style="position:fixed;z-index:100;right:0;bottom:0;max-height:30vh;overflow:auto;margin:0;background:#fff;font-size:10px">Running…</pre>
<script src="../../dist/design-canvas.js"></script>
<script src="./harness.js"></script>
<script src="./checks-page.js"></script>
<script src="./run-all.js"></script>
```

`tests/rf/harness.js`:

```js
// Helpers for the React Flow canvas checks. tests/run.mjs serves the
// repository and opens tests/rf/regressions.html in headless Chrome. Each
// check registers with test(); run-all.js runs them in order.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function until(fn, ms = 5000) {
  for (let t = 0; t < ms; t += 20) { if (fn()) return; await wait(20); }
  throw new Error('Timed out waiting for DOM/state');
}
const realFetch = window.fetch.bind(window);
const host = document.getElementById('fixture');
const SAMPLE = '../../sample/';
const TESTS = [];
let h = null;   // the mounted canvas of the running check; run-all.js unmounts it
function test(name, fn) { TESTS.push({ name, fn }); }

let sampleCache = null;
async function sample() {
  if (!sampleCache) sampleCache = await (await realFetch(SAMPLE + 'canvas.json')).json();
  return JSON.parse(JSON.stringify(sampleCache));
}
// A page of n windows in rows of `cols`, made of the sample's 1440-wide
// screens. Each file name is unique (?i=N) and keeps its own window.
async function grid(n, cols = 6) {
  const s = await sample();
  const files = s.artboards.filter((a) => a.w === 1440).map((a) => a.file);
  const artboards = [], flows = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    artboards.push({ file: `${files[i % files.length]}?i=${i}`, x: c * 2690, y: r * 1700, w: 1440, h: 900, title: `T${i}`, page: 't', variantOf: null });
    if (c > 0) flows.push({ page: 't', from: artboards[i - 1].file, to: artboards[i].file, label: 'Next', fs: 'r', ts: 'l' });
  }
  return { pages: [{ id: 't', name: 'Test page' }], artboards, annotations: [], flows };
}
// Each mount gets its own state file name, so no check sees another's state.
function mount(data, opts = {}) {
  const stateFile = 'rf-test-' + Math.random().toString(36).slice(2) + '.json';
  h = DesignCanvas.mount(host, { data, page: data.pages[0].id, base: SAMPLE, stateFile, ...opts });
  return h;
}
const ready = (ms) => until(() => h && h.api && h.api.fitted, ms);
const rf = () => h.api.rf;
const nodeEl = (id) => host.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
const iframes = () => host.querySelectorAll('.dc-card iframe').length;
const liveIds = () => [...host.querySelectorAll('.dc-win[data-live="1"]')].map((el) => el.closest('.react-flow__node').dataset.id);
function onScreen(el) {
  const r = el.getBoundingClientRect(), v = host.getBoundingClientRect();
  return r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
}
function wheel(opts) {
  host.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: 640, clientY: 450, bubbles: true, cancelable: true, ...opts,
  }));
}
```

`tests/rf/run-all.js`:

```js
window.canvasTestsDone = (async () => {
  const results = [];
  for (const { name, fn } of TESTS) {
    // A state file read answers 404 unless the check says otherwise.
    window.fetch = async (url, init) => (String(url).includes('rf-test-') ? new Response('', { status: 404 }) : realFetch(url, init));
    try { await fn(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
    finally {
      if (h) h.unmount();
      h = null;
      window.fetch = realFetch;
      host.replaceChildren();
      Object.keys(localStorage).filter((k) => k.startsWith('dc2-')).forEach((k) => localStorage.removeItem(k));
    }
    document.getElementById('results').textContent = JSON.stringify(results, null, 2);
  }
  document.title = results.every((r) => r.pass) ? 'PASS: canvas regressions' : 'FAIL: canvas regressions';
  return results;
})();
```

`tests/rf/checks-page.js`:

```js
test('the sample draws its windows, note, head and arrows', async () => {
  mount(await sample());
  await ready();
  const count = (sel) => host.querySelectorAll(sel).length;
  check(count('.react-flow__node-window') === 10, count('.react-flow__node-window') + ' windows, want 10 (one variant folds)');
  check(count('.react-flow__node-note') === 1, count('.react-flow__node-note') + ' notes, want 1');
  check(host.querySelector('.dc-headtitle').textContent === 'Invoices · ZATCA', 'head: ' + host.querySelector('.dc-headtitle').textContent);
  check(host.querySelector('.dc-headsub').textContent === '10 screens · 1 variant', 'subtitle: ' + host.querySelector('.dc-headsub').textContent);
  await until(() => count('.react-flow__edge') === 12);
  check(count('.dc-flowlabel') === 12, count('.dc-flowlabel') + ' arrow labels, want 12');
});

test('the live iframes stay inside the budget under pan and zoom', async () => {
  mount(await grid(24));
  await ready(); await wait(1600);
  const n0 = iframes();
  check(n0 >= 1 && n0 <= 8, n0 + ' live iframes at the fit');
  const id = host.querySelectorAll('.react-flow__node-window')[8].dataset.id;
  const node = rf().getNode(id);
  rf().setViewport({ zoom: 0.5, x: 640 - (node.position.x + node.width / 2) * 0.5, y: 450 - (node.position.y + node.height / 2) * 0.5 });
  await wait(1600);
  const n1 = iframes();
  check(n1 >= 1 && n1 <= 8, n1 + ' live iframes after the zoom');
  check(liveIds().includes(id), 'the window in the middle of the view is not live');
});

test('no iframe mounts or drops during a wheel gesture', async () => {
  mount(await grid(24));
  await ready(); await wait(1600);
  let changes = 0;
  const mo = new MutationObserver((recs) => recs.forEach((r) => [...r.addedNodes, ...r.removedNodes]
    .forEach((n) => { if (n.nodeName === 'IFRAME') changes++; })));
  mo.observe(host, { childList: true, subtree: true });
  for (let i = 0; i < 60; i++) { wheel({ deltaY: i < 30 ? -6 : 6, ctrlKey: true }); await frame(); }
  mo.disconnect();
  check(changes === 0, changes + ' iframe mounts or drops during the gesture');
  await wait(1600);
  check(iframes() <= 8, iframes() + ' live iframes after the gesture');
});

test('a zoom in several pinches keeps each on-screen live window live', async () => {
  // Spike rule 3. The spike's plain budget turned 18 live screens into their
  // placeholder in this gesture (report, "Second check").
  mount(await grid(24));
  await ready(); await wait(1600);
  const anchors = [[320, 225], [960, 225], [320, 675], [960, 675], [640, 450], [640, 450]];
  let flips = 0;
  for (const dir of [-1, 1]) {
    for (const [x, y] of anchors) {
      const before = liveIds().filter((id) => onScreen(nodeEl(id)));
      for (let i = 0; i < 12; i++) { wheel({ deltaY: dir * 6, ctrlKey: true, clientX: x, clientY: y }); await frame(); }
      await wait(900);   // longer than DC.stickySettleMs: a pass runs between the pinches
      const now = new Set(liveIds());
      flips += before.filter((id) => nodeEl(id) && onScreen(nodeEl(id)) && !now.has(id)).length;
    }
  }
  check(flips === 0, flips + ' on-screen live windows turned into their placeholder');
});

test('the world has no GPU layer and each live screen has its own', async () => {
  // Spike rules 1 and 2.
  mount(await grid(6));
  await ready(); await wait(1200);
  const wc = getComputedStyle(host.querySelector('.react-flow__viewport')).willChange;
  check(wc === 'auto', 'the viewport has will-change: ' + wc);
  const frames = [...host.querySelectorAll('.dc-card iframe')];
  check(frames.length > 0, 'no live iframe');
  frames.forEach((f) => check(getComputedStyle(f).willChange === 'transform', 'a live iframe has will-change: ' + getComputedStyle(f).willChange));
});

test('a canvas.json that does not load shows the error', async () => {
  window.fetch = async (url, init) => (String(url).endsWith('canvas.json') ? new Response('', { status: 404 }) : realFetch(url, init));
  h = DesignCanvas.mount(host, { page: 't' });
  await until(() => host.querySelector('.dc-error'));
  const text = host.querySelector('.dc-error').textContent;
  check(text.includes('canvas.json did not load: HTTP 404'), 'error text: ' + text);
});
```

- [ ] **Step 3: Run to see the checks fail**

Run: `npm run test:browser 2>&1 | tail -8`
Expected: each check prints `FAIL … design-canvas: the canvas is not built yet`, then `FAIL: canvas regressions`.

- [ ] **Step 4: Write the styles and the small components**

`src/context.js`:

```js
import { createContext } from 'react';

// { budget, act }: the live budget store and the window actions of the page.
export const PageCtx = createContext(null);
```

`src/styles.css`:

```css
/* The canvas root. The dots are 26 screen px apart at every zoom, so they are
   the root's background, behind the React Flow layers, and never move. */
.dc-root{position:relative;width:100%;height:100%;overflow:hidden;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#f0eee9 radial-gradient(rgba(70,58,46,.16) 1px,transparent 1px) 0 0/26px 26px}
.dc-root .react-flow{background:transparent}
/* Spike rule 1: the world never gets its own GPU layer. With one, a zoom-in
   and then a zoom-out on a big page loses content (spike report). */
.dc-root .react-flow__viewport{will-change:auto}
.dc-root .react-flow__node-head{pointer-events:none}
.dc-root .react-flow__node-window:has(.dc-menu){z-index:1000 !important}
.dc-root .react-flow__handle{opacity:0;width:14px;height:14px;min-width:0;min-height:0;border:0;background:#c96442}
/* The arrows keep their screen width: --dc-inv-zoom is 1 / zoom. */
.dc-root .react-flow__edge-path{stroke:#b9a991;stroke-linecap:round;stroke-width:max(calc(2px * min(var(--dc-inv-zoom,1),2)),calc(1px * var(--dc-inv-zoom,1)))}
.dc-root .react-flow__edge:hover .react-flow__edge-path{stroke:#c96442}
.dc-flowlabel{position:absolute;font:600 18px/1 Inter,-apple-system,system-ui,sans-serif;color:#6b6456;background:#fff;border:1px solid #e5e0d7;border-radius:999px;padding:8px 16px;box-shadow:0 1px 2px rgba(40,32,22,.07);white-space:nowrap;pointer-events:all}
/* A page is a window: a header with the name and the page options, then the
   screen inset in the body. The chrome is world px: it grows with the card. */
.dc-win{position:relative;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(40,32,22,.08),0 12px 30px -14px rgba(40,32,22,.35)}
.dc-winhead{display:flex;align-items:center;gap:14px;padding:0 22px;cursor:grab;user-select:none;border-bottom:1px solid rgba(40,32,22,.07)}
.dc-winhead:active{cursor:grabbing}
/* No transition on the dot or the card: a transition in the world repaints
   the whole world on each of its frames (old engine, tests/regressions.js). */
.dc-dot{flex:0 0 12px;height:12px;border-radius:6px;background:#cfc9bf}
.dc-win[data-live="1"] .dc-dot{background:#12a594}
.dc-wintitle{flex:1 1 auto;min-width:0;display:flex;align-items:center;overflow:hidden}
.dc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:22px;font-weight:600;letter-spacing:-.3px;color:#1e1b16;line-height:1.2}
.dc-bar{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:4px;border-radius:11px;background:rgba(40,32,22,.05);box-shadow:inset 0 0 0 1px rgba(40,32,22,.05)}
.dc-bar hr{flex:0 0 1px;width:1px;height:20px;margin:0 2px;border:0;background:rgba(40,32,22,.12)}
.dc-chips{flex:0 0 auto;display:flex;gap:6px}
.dc-sizes{flex:0 0 auto;display:inline-flex;gap:2px;padding:2px;background:#fff;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(40,32,22,.07)}
.dc-size{border:0;padding:6px 10px;border-radius:6px;background:transparent;font:600 12px/1 inherit;font-family:inherit;color:rgba(60,50,40,.65);cursor:pointer;letter-spacing:.02em}
.dc-size:hover{color:#2a251f}
.dc-size.dc-on{background:#12a594;color:#fff}
.dc-btns{flex:0 0 auto;display:flex;gap:2px;align-items:center}
.dc-kebab,.dc-openbtn{width:28px;height:28px;border-radius:7px;border:none;cursor:pointer;padding:0;background:transparent;color:rgba(60,50,40,.65);display:flex;align-items:center;justify-content:center;font:inherit}
.dc-kebab:hover,.dc-openbtn:hover{background:#fff;color:#1e1b16;box-shadow:inset 0 0 0 1px rgba(40,32,22,.07)}
.dc-menu{position:absolute;top:100%;right:0;margin-top:4px;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.05);padding:5px;min-width:180px;z-index:10}
.dc-menu button{display:block;width:100%;padding:9px 12px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:14px;font-weight:500;line-height:1.2;color:#29261b;cursor:pointer;text-align:left;white-space:nowrap}
.dc-menu button:hover{background:rgba(0,0,0,.05)}
.dc-menu button:disabled{opacity:.5;cursor:default}
.dc-menu hr{border:0;border-top:1px solid rgba(0,0,0,.08);margin:5px 3px}
.dc-menu .dc-danger{color:#c96442}
.dc-menu .dc-danger:hover{background:rgba(201,100,66,.1)}
.dc-menu-error{padding:6px 12px;max-width:260px;font-size:12px;line-height:1.4;color:#c96442;white-space:normal}
.dc-card{position:relative;isolation:isolate;contain:layout paint;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06)}
.dc-card *{scrollbar-width:none}
.dc-card *::-webkit-scrollbar{display:none}
/* Spike rule 2: each live screen is its own small GPU layer, so a zoom only
   scales it and never rasters it again. */
.dc-card iframe{display:block;border:0;background:#fff;will-change:transform}
/* The shield: an iframe swallows wheel and pinch, so a clear layer sits over
   the screen. A click opens the screen's own file. */
.dc-shield{position:absolute;inset:0;cursor:pointer}
.dc-grab .dc-shield{cursor:grab}
.dc-placeholder{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f6f4f0 0 12px,#eeece7 12px 24px);display:flex;align-items:center;justify-content:center;color:#9a958c;font:500 14px ui-monospace,Menlo,monospace}
.dc-note{box-sizing:border-box;background:#fef4a8;padding:14px 16px;font-size:13px;line-height:1.5;color:#5a4a2a;white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.08);transform:rotate(-1deg)}
/* The section head keeps its screen size up to 1.75x, by transform: a
   transform never reflows the world. It grows up from its bottom edge. */
.dc-sectionhead{transform:scale(min(var(--dc-inv-zoom,1),1.75));transform-origin:bottom left;white-space:nowrap}
.dc-headtitle{font-size:28px;font-weight:600;color:rgba(40,30,20,.85);letter-spacing:-.4px;margin-bottom:6px}
.dc-headsub{font-size:16px;color:rgba(60,50,40,.6)}
/* Shown only when no content is on screen. */
.dc-backto{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:7px;padding:9px 15px 9px 12px;border:1px solid #e5e0d7;border-radius:999px;background:#fff;box-shadow:0 2px 6px rgba(40,32,22,.08),0 18px 40px -14px rgba(40,32,22,.45);font-family:inherit;font-size:13px;font-weight:600;color:#3c3228;cursor:pointer;animation:dc-backto-in .18s cubic-bezier(.2,.7,.3,1) both}
.dc-backto:hover{background:#faf8f5}
@keyframes dc-backto-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.dc-error{padding:24px;font:14px/1.5 ui-monospace,Menlo,monospace;color:#c96442}
```

`src/NoteNode.jsx`:

```jsx
import { memo } from 'react';

// A post-it. It drags as a whole; its place is saved as positions['note:<id>'].
function NoteNode({ data }) {
  return <div className="dc-note" style={{ width: data.w }}>{data.text}</div>;
}
export default memo(NoteNode);
```

`src/SectionHead.jsx`:

```jsx
import { memo } from 'react';

// The page name and the "N screens · N variants" line, above the content.
function SectionHead({ data }) {
  return (
    <div className="dc-sectionhead">
      <div className="dc-headtitle">{data.name}</div>
      {data.subtitle && <div className="dc-headsub">{data.subtitle}</div>}
    </div>
  );
}
export default memo(SectionHead);
```

`src/FlowEdge.jsx`:

```jsx
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

const DASH = { strokeDasharray: 'calc(5px * var(--dc-inv-zoom, 1)) calc(6px * var(--dc-inv-zoom, 1))' };

// A built-in bezier arrow. The custom edge exists only for the label pill,
// which is world px like the old flow labels. No routing: an arrow can cross
// a window (user decision).
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={data.dashed ? DASH : undefined} interactionWidth={24} />
      {data.label && (
        <EdgeLabelRenderer>
          <div className="dc-flowlabel nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
export default memo(FlowEdge);
```

`src/BackPill.jsx`:

```jsx
// Shown when the view settles with no content on screen.
export default function BackPill({ onClick }) {
  return (
    <button className="dc-backto" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 4 12l7 7" /><path d="M4 12h15" />
      </svg>
      Back to content
    </button>
  );
}
```

- [ ] **Step 5: Write the window**

`src/WindowNode.jsx`:

```jsx
import { memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Handle, Position } from '@xyflow/react';
import { DC } from './constants.js';
import { PageCtx } from './context.js';
import { dcExportArtboard, dcExportName } from './export.js';

// Read by the browser suite: a patch must not render windows it does not touch.
export const renders = { count: 0 };

const SIDES = [['l', Position.Left], ['r', Position.Right], ['t', Position.Top], ['b', Position.Bottom]];
const KEBAB = (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><circle cx="2.5" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" /><circle cx="9.5" cy="6" r="1.1" /></svg>
);
const OPEN = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 2.5H2.5v11h11v-4" /><path d="M9.5 2.5h4v4M13.5 2.5L8 8" /></svg>
);

function SizeChips({ size, onPick }) {
  if (!size.axes.length) return null;
  return (
    <div className="dc-chips">
      {size.axes.map((ax) => (
        <div key={ax.key} className="dc-sizes">
          {ax.chips.map((c) => (
            <button key={c.value} className={'dc-size' + (c.value === ax.on ? ' dc-on' : '')} title={c.file}
              onClick={() => onPick(c.file)}>{c.label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

// One screen as a window: a header with the live dot, the name, the variant
// chips, the ⋯ menu and ↗, then the screen. Every option is in the header at
// all times. The screen is a live iframe while the budget says so, else a
// placeholder with the screen's name.
function WindowNode({ id, data }) {
  renders.count++;
  const { budget, act } = useContext(PageCtx);
  const live = useSyncExternalStore(budget.subscribe, () => budget.isLive(id));
  const { label, title, size, moved, sidesMoved } = data;
  const { width, height, href } = size;
  const screenTitle = (size.cur && size.cur.title) || title;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [exportError, setExportError] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) { setConfirming(false); setExportError(null); return undefined; }
    const off = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [menuOpen]);

  // The menu stays open while an export runs, so a failure shows in its row.
  const save = (kind) => {
    setExportError(null);
    setBusy(kind);
    dcExportArtboard(href, width, height, dcExportName(label, id), kind).then(
      () => { setBusy(null); setMenuOpen(false); },
      (err) => {
        console.error('[design-canvas] export failed:', err);
        setBusy(null);
        setExportError(`${kind.toUpperCase()} export failed: ${(err && err.message) || err}`);
      });
  };
  const close = (fn) => () => { setMenuOpen(false); fn(); };

  return (
    <>
      <div className="dc-win" data-live={live ? '1' : '0'} style={{ width: width + DC.winPad * 2 }}
        onPointerDownCapture={() => budget.touch(id)}>
        <div className="dc-winhead" style={{ height: DC.winHead }} title="Drag to move">
          <span className="dc-dot" title="Green while the screen is live" />
          <div className="dc-wintitle"><span className="dc-name" title={label}>{label}</span></div>
          <div className="dc-bar nodrag">
            <SizeChips size={size} onPick={(file) => act.pickVariant(id, file)} />
            {size.axes.length > 0 && <hr />}
            <div className="dc-btns">
              <div ref={menuRef} style={{ position: 'relative' }}>
                <button className="dc-kebab" title="More" onClick={() => setMenuOpen((o) => !o)}>{KEBAB}</button>
                {menuOpen && (
                  <div className="dc-menu">
                    {href && <button onClick={close(() => window.open(href, '_blank'))}>Open screen</button>}
                    {moved && <button onClick={close(() => act.resetPosition(id))}>Reset position</button>}
                    {sidesMoved && <button onClick={close(() => act.resetSides(id))}>Reset arrow sides</button>}
                    {href && <button disabled={!!busy} onClick={() => save('png')}>{busy === 'png' ? 'Downloading…' : 'Download PNG'}</button>}
                    {href && <button disabled={!!busy} onClick={() => save('html')}>{busy === 'html' ? 'Downloading…' : 'Download HTML'}</button>}
                    {exportError && <div className="dc-menu-error" role="alert">{exportError}</div>}
                    {href && <hr />}
                    <button className="dc-danger" onClick={() => { if (confirming) { setMenuOpen(false); act.remove(id); } else setConfirming(true); }}>
                      {confirming ? 'Click again to delete' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
              {href && <button className="dc-openbtn" title={'Open: ' + (label || id)} onClick={() => window.open(href, '_blank')}>{OPEN}</button>}
            </div>
          </div>
        </div>
        <div className="dc-winbody" style={{ padding: DC.winPad, background: DC.winBody }}>
          <div className="dc-card" style={{ width, height, contentVisibility: 'auto', containIntrinsicSize: `${width}px ${height}px` }}>
            {live
              ? <iframe key={href} src={href} title={screenTitle} loading="lazy" style={{ width, height }} />
              : <div className="dc-placeholder">{screenTitle}</div>}
            <div className="dc-shield" title="Open to edit" onClick={() => { if (href) location.href = href; }} />
          </div>
        </div>
      </div>
      {SIDES.map(([k, pos]) => [
        // An arrow end can be dropped on a handle (to move the arrow to that
        // side), but no new arrow starts from one.
        <Handle key={'s' + k} type="source" id={k} position={pos} isConnectableStart={false} />,
        <Handle key={'t' + k} type="target" id={k} position={pos} isConnectableStart={false} />,
      ])}
    </>
  );
}
export default memo(WindowNode);
```

- [ ] **Step 6: Write the page**

`src/CanvasPage.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, applyNodeChanges, MarkerType } from '@xyflow/react';
import { DC } from './constants.js';
import { PageCtx } from './context.js';
import { readPage, buildNodes, buildEdges, actions, screenOf } from './mapping.js';
import { createLiveBudget, boxesOf } from './liveBudget.js';
import { restoreState, createSaver, stateKey } from './persist.js';
import { fitView, anyOnScreen, isMouseWheel, zoomAround, createInvZoom } from './view.js';
import { createHost } from './host.js';
import WindowNode from './WindowNode.jsx';
import NoteNode from './NoteNode.jsx';
import SectionHead from './SectionHead.jsx';
import FlowEdge from './FlowEdge.jsx';
import BackPill from './BackPill.jsx';

const nodeTypes = { window: WindowNode, note: NoteNode, head: SectionHead };
const edgeTypes = { flow: FlowEdge };
// The arrowhead is in stroke-width units, so it keeps its screen size with
// the stroke (see .react-flow__edge-path in styles.css).
const EDGE_DEFAULTS = { type: 'flow', markerEnd: { type: MarkerType.ArrowClosed, color: '#b9a991', width: 5.5, height: 6.5 } };
const clampZoom = (z) => Math.min(DC.maxZoom, Math.max(DC.minZoom, z));

// Loads canvas.json (or takes it from the host as `data`) and shows one page.
// With no `page`, the first page of canvas.json.
export function CanvasPage({ page: pageId, data: given, stateFile, base = './', host = {}, onApi }) {
  const [data, setData] = useState(given || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (given) { setData(given); return undefined; }
    let off = false;
    fetch('./canvas.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { if (!off) setData(d); })
      .catch((e) => { if (!off) setError(String((e && e.message) || e)); });
    return () => { off = true; };
  }, [given]);
  if (error) return <div className="dc-root dc-error">canvas.json did not load: {error}</div>;
  if (!data) return <div className="dc-root" />;
  const id = pageId || (data.pages && data.pages[0] && data.pages[0].id);
  const file = stateFile || `.design-canvas.${id}.v2.state.json`;
  return <Page key={id + '\n' + file} data={data} pageId={id} stateFile={file} base={base} hostOpts={host} onApi={onApi} />;
}

function Page({ data, pageId, stateFile, base, hostOpts, onApi }) {
  const key = stateKey(stateFile);
  const viewKey = 'dc2-view:' + location.pathname + ':' + pageId;
  const page = useMemo(() => readPage(data, pageId, { base }), [data, pageId, base]);

  // Saved state. Nothing draws and nothing saves before the restore ends.
  const [state, setState] = useState(null);
  const restored = useRef(null);
  useEffect(() => {
    let off = false;
    restoreState({ stateFile, key }).then((s) => { if (!off) { restored.current = s; setState(s); } });
    return () => { off = true; };
  }, [stateFile, key]);
  const saver = useMemo(() => createSaver({ stateFile, key }), [stateFile, key]);
  useEffect(() => () => saver.dispose(), [saver]);
  useEffect(() => { if (state && state !== restored.current) saver.save(state); }, [state, saver]);
  const update = useCallback((fn) => setState((s) => (s ? fn(s) : s)), []);

  // Nodes and edges. A drag moves the node in `nodes`; the drop saves it, and
  // the saved state then builds the same position again.
  const cache = useRef(new Map());
  const built = useMemo(() => (state ? buildNodes(page, state, cache.current) : null), [page, state]);
  const edges = useMemo(() => (state ? buildEdges(page, state) : []), [page, state]);
  const [nodes, setNodes] = useState([]);
  useEffect(() => { if (built) setNodes(built); }, [built]);
  const onNodesChange = useCallback((changes) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // The view.
  const rootRef = useRef(null);
  const [rf, setRf] = useState(null);
  const rfRef = useRef(null);
  rfRef.current = rf;
  const pane = useCallback(() => ({
    w: rootRef.current ? rootRef.current.clientWidth : 0,
    h: rootRef.current ? rootRef.current.clientHeight : 0,
  }), []);
  const boxes = useRef([]);
  boxes.current = boxesOf(nodes);
  const content = useCallback(() => (rfRef.current ? rfRef.current.getNodes() : []).filter((n) => n.type !== 'head'), []);
  const contentBoxes = useCallback(() => content().map((n) => ({
    x: n.position.x, y: n.position.y,
    w: n.width ?? (n.measured && n.measured.width) ?? 0, h: n.height ?? (n.measured && n.measured.height) ?? 0,
  })), [content]);
  const inv = useMemo(() => createInvZoom(() => rootRef.current), []);

  // The live budget (spike rules 3 and 4).
  const budget = useMemo(() => createLiveBudget({
    read: () => ({ view: rfRef.current ? rfRef.current.getViewport() : { x: 0, y: 0, zoom: 1 }, pane: pane(), boxes: boxes.current }),
  }), [pane]);
  useEffect(() => () => budget.dispose(), [budget]);
  useEffect(() => { if (rf) budget.schedule(); }, [rf, built, budget]);

  // The first view: the saved one, else a fit. It waits for the restore.
  const [fitted, setFitted] = useState(false);
  useEffect(() => {
    if (fitted || !rf || !nodes.length) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(viewKey) || 'null'); } catch {}
    const view = saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)
      ? { x: saved.x, y: saved.y, zoom: clampZoom(saved.zoom) }
      : fitView(rf.getNodesBounds(nodes.filter((n) => n.type !== 'head')), pane());
    rf.setViewport(view);
    inv(view.zoom, true);
    setFitted(true);
  }, [fitted, rf, nodes, viewKey, pane, inv]);

  // The host protocol. hostOpts is read once, at start.
  const hostRef = useRef(null);
  useEffect(() => {
    if (!rf) return undefined;
    const h = createHost({ getZoom: () => rf.getZoom(), zoomTo: (s) => rf.zoomTo(s), ...hostOpts });
    hostRef.current = h;
    return () => { h.dispose(); hostRef.current = null; };
  }, [rf]);

  // Back to content: shown once the view settles with no content on screen,
  // hidden on the first move frame that brings content back.
  const [lost, setLost] = useState(false);
  const lostRef = useRef(false);
  lostRef.current = lost;
  const lostTimer = useRef(0);
  useEffect(() => () => clearTimeout(lostTimer.current), []);
  const checkLost = useCallback(() => {
    clearTimeout(lostTimer.current);
    lostTimer.current = setTimeout(() => {
      const r = rfRef.current, bs = contentBoxes();
      if (r) setLost(bs.length > 0 && !anyOnScreen(bs, r.getViewport(), pane()));
    }, DC.lostSettleMs);
  }, [contentBoxes, pane]);
  const backToContent = useCallback(() => {
    const r = rfRef.current;
    if (r) r.setViewport(fitView(r.getNodesBounds(content()), pane()), { duration: DC.backToMs });
  }, [content, pane]);

  const onMoveStart = useCallback(() => budget.moveStart(), [budget]);
  const onMove = useCallback((e, vp) => {
    inv(vp.zoom);
    if (lostRef.current && anyOnScreen(contentBoxes(), vp, pane())) setLost(false);
  }, [inv, contentBoxes, pane]);
  const onMoveEnd = useCallback((e, vp) => {
    budget.moveEnd();
    inv(vp.zoom, true);
    if (hostRef.current) hostRef.current.settled();
    try { localStorage.setItem(viewKey, JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom })); } catch {}
    checkLost();
  }, [budget, inv, viewKey, checkLost]);

  // A card drag holds the budget like a pan does. The drop saves the place
  // and marks the window as touched, so it keeps its place in the budget.
  const onNodeDragStart = useCallback(() => budget.moveStart(), [budget]);
  const onNodeDragStop = useCallback((e, node) => {
    budget.touch(node.id);
    budget.moveEnd();
    if (node.type === 'window') update((s) => actions.move(s, node.id, screenOf(node.position)));
    else if (node.type === 'note') update((s) => actions.move(s, node.id, node.position));
  }, [budget, update]);

  // An arrow end moves to another side of the same window only.
  const onReconnect = useCallback((old, conn) => {
    if (conn.source !== old.source || conn.target !== old.target) return;
    const sides = {};
    if (conn.sourceHandle && conn.sourceHandle !== old.sourceHandle) sides.fs = conn.sourceHandle;
    if (conn.targetHandle && conn.targetHandle !== old.targetHandle) sides.ts = conn.targetHandle;
    if (Object.keys(sides).length) update((s) => actions.setSides(s, old.data.key, sides));
  }, [update]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !rf) return undefined;
    // A mouse wheel zooms, as in the old canvas. React Flow's own scroll
    // handling then pans for a trackpad and zooms for a pinch.
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey || !isMouseWheel(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      rf.setViewport(zoomAround(rf.getViewport(), e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.sign(e.deltaY) * DC.wheelZoomStep)));
    };
    // Ctrl (or ⌘) held: the whole window is a grip (dragHandle in mapping.js).
    const grab = (e) => el.classList.toggle('dc-grab', !!(e.ctrlKey || e.metaKey));
    const drop = () => el.classList.remove('dc-grab');
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('keydown', grab);
    window.addEventListener('keyup', grab);
    window.addEventListener('blur', drop);
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', grab);
      window.removeEventListener('keyup', grab);
      window.removeEventListener('blur', drop);
    };
  }, [rf]);

  const act = useMemo(() => ({
    pickVariant: (id, file) => update((s) => actions.pickVariant(s, id, file)),
    resetPosition: (id) => update((s) => actions.resetPosition(s, id)),
    resetSides: (id) => update((s) => actions.resetSides(s, id)),
    remove: (id) => update((s) => actions.remove(s, id)),
    move: (id, p) => update((s) => actions.move(s, id, p)),
  }), [update]);
  const ctx = useMemo(() => ({ budget, act }), [budget, act]);

  // Read by the browser suite, the blank check and perf/bench.js.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!onApi) return;
    onApi({
      rf, budget, act, fitted,
      state: () => stateRef.current,
      reconnect: (edgeId, conn) => { const e = edges.find((x) => x.id === edgeId); if (e) onReconnect(e, conn); },
    });
  }, [onApi, rf, budget, act, fitted, edges, onReconnect]);

  if (!state) return <div ref={rootRef} className="dc-root" />;
  return (
    <div ref={rootRef} className="dc-root">
      <PageCtx.Provider value={ctx}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          defaultEdgeOptions={EDGE_DEFAULTS} onNodesChange={onNodesChange} onInit={setRf}
          onMoveStart={onMoveStart} onMove={onMove} onMoveEnd={onMoveEnd}
          onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
          edgesReconnectable onReconnect={onReconnect}
          minZoom={DC.minZoom} maxZoom={DC.maxZoom}
          panOnScroll panOnScrollSpeed={1} zoomOnPinch zoomOnDoubleClick={false}
          elementsSelectable={false} nodesFocusable={false} edgesFocusable={false}
          selectionKeyCode={null} multiSelectionKeyCode={null} deleteKeyCode={null}
          onlyRenderVisibleElements={false} />
      </PageCtx.Provider>
      {lost && <BackPill onClick={backToContent} />}
    </div>
  );
}
```

- [ ] **Step 7: Write the entry and the pages**

Replace `src/main.jsx` with:

```jsx
import { createRoot } from 'react-dom/client';
import rfCss from '@xyflow/react/dist/style.css?inline';
import css from './styles.css?inline';
import { CanvasPage } from './CanvasPage.jsx';
import * as exporter from './export.js';
import { renders } from './WindowNode.jsx';

let current = null;
function addStyles() {
  if (document.getElementById('dc-styles')) return;
  const s = document.createElement('style');
  s.id = 'dc-styles';
  s.textContent = rfCss + '\n' + css;
  document.head.appendChild(s);
}

// Mounts one canvas page into `el`. opts: { page, data, stateFile, base, host }.
// Returns { api, unmount }; `api` is filled once the page is ready.
export function mount(el, opts = {}) {
  addStyles();
  const handle = { api: null, unmount: null };
  const root = createRoot(el);
  root.render(<CanvasPage {...opts} onApi={(api) => { handle.api = api; }} />);
  handle.unmount = () => { root.unmount(); if (current === handle) current = null; };
  current = handle;
  return handle;
}
// The last mounted canvas. perf/bench.js and the measurement scripts read it.
export const last = () => current;
// Read by the browser suite only.
export const test = { exporter, renders };
```

`src/canvas.html` (the page for claude.ai/design; the build copies it to `dist/canvas.html`):

```html
<!doctype html>
<meta charset="utf-8">
<title>Design canvas</title>
<body style="margin:0">
<div id="root" style="height:100vh"></div>
<select id="dc-page" title="Page" hidden style="position:fixed;z-index:60;top:10px;right:10px;font:13px system-ui,sans-serif"></select>
<script src="./design-canvas.js"></script>
<script>
  // Put this file and design-canvas.js beside canvas.json. ?page=<id> opens a
  // page; else the list at the top right picks one (it shows for 2+ pages).
  const root = document.getElementById('root');
  fetch('./canvas.json').then((r) => r.json()).then((data) => {
    const pick = document.getElementById('dc-page');
    data.pages.forEach((p) => pick.add(new Option(p.name || p.id, p.id)));
    pick.value = new URLSearchParams(location.search).get('page') || sessionStorage.getItem('dc-page') || data.pages[0].id;
    pick.hidden = data.pages.length < 2;
    pick.onchange = () => { sessionStorage.setItem('dc-page', pick.value); location.reload(); };
    window.dcCanvas = DesignCanvas.mount(root, { data, page: pick.value });
  }).catch(() => { window.dcCanvas = DesignCanvas.mount(root, {}); });   // the canvas shows the error
</script>
```

`sample/index-rf.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>design-canvas-lod · sample (React Flow)</title>
<body style="margin:0"><div id="root" style="height:100vh"></div>
<script src="../dist/design-canvas.js"></script>
<script>window.dcCanvas = DesignCanvas.mount(document.getElementById('root'), { page: 'page-9' });</script>
```

In `package.json`, set the build script to:

```json
"build": "vite build --config vite.config.mjs && cp src/canvas.html dist/canvas.html",
```

- [ ] **Step 8: Build and run the checks**

Run: `npm run build && ls dist` → `canvas.html  design-canvas.js`.
Run: `npm run test:browser 2>&1 | tail -8` → six `PASS` lines, then `PASS: canvas regressions`.

If a check fails, find the root cause from evidence before changing code: read the failing message; open `http://127.0.0.1:8000/tests/rf/regressions.html` in a normal Chrome (`python3 -m http.server 8000`) and read the console. Known points to confirm, not to guess: React Flow fires `onMoveStart`/`onMoveEnd` for a programmatic `setViewport` and for ctrl+wheel on `.react-flow__pane` (the spike relied on both); `rf.getNodesBounds` accepts node objects. Record each correction in the report.

Run: `npm run test:unit` → `58 passed`. Run: `node tests/run.mjs 2>&1 | tail -1` → `PASS: canvas regressions` (old suite).

- [ ] **Step 9: Commit**

```bash
git add src tests/rf tests/run.mjs sample/index-rf.html package.json
git commit -m "Draw the canvas page with React Flow"
```

---

### Task 9: Window actions in the browser

**Goal:** Browser checks prove the window actions that Task 8 wired: header drag and ⌘-drag with the saved place, the variant chips with the arrows following, arrow-side changes and their reset, Reset position, Delete, the export (pixels, fonts, the error row) and that a patch renders only the window it touches. Fix each defect the checks find at its root cause.

**Files:**
- Create: `tests/rf/checks-window.js`
- Modify: `tests/rf/regressions.html` (load `checks-window.js` after `checks-page.js`)
- Modify only if a check finds a defect: `src/CanvasPage.jsx`, `src/WindowNode.jsx`, `src/mapping.js`, `src/styles.css`

**Acceptance Criteria:**
- [ ] A header drag of (100, 50) screen px moves the node by (100/zoom, 50/zoom) world px within 2 px, and the browser copy holds the new screen place (node position + (36, 100)).
- [ ] With ⌘ held, a drag on the screen moves the window the same way.
- [ ] A click on the `390` chip of `ZatcaDone` makes the node 462 × 980, saves `variants['ZatcaDone.dc.html'] = 'ZatcaDonePhone.dc.html'`, and changes the path of its incoming arrow.
- [ ] A side change of an arrow end is saved in `arrowSides`; a reconnect to another window is ignored; "Reset arrow sides" in the source window's menu removes the override.
- [ ] "Reset position" returns a moved window to its `canvas.json` place; "Delete" asks twice, then removes the window and its arrows and saves `deleted`.
- [ ] A failed export shows `PNG export failed: offline` in the menu; the two export checks of the old suite pass on the moved code.
- [ ] One chip click renders at most 4 windows of the 10.
- [ ] `npm run test:browser 2>&1 | tail -1` prints `PASS: canvas regressions` with 16 `PASS` lines.

**Verify:** `npm run test:browser 2>&1 | grep -c '^PASS '` → `16`

**Steps:**

- [ ] **Step 1: Write the checks**

In `tests/rf/regressions.html`, add `<script src="./checks-window.js"></script>` after the `checks-page.js` line.

`tests/rf/checks-window.js`:

```js
// Center window `id` at `zoom`, so the header and the chips are a real size.
async function focusOn(id, zoom = 0.5) {
  const n = rf().getNode(id);
  rf().setViewport({ zoom, x: 640 - (n.position.x + n.width / 2) * zoom, y: 450 - (n.position.y + n.height / 2) * zoom });
  await wait(300);
}
// A mouse drag the way d3-drag (React Flow's node drag) reads it: mousedown
// on the element, then mousemove and mouseup on the window.
async function drag(el, dx, dy, mods = {}) {
  const r = el.getBoundingClientRect();
  const x = r.left + 12, y = r.top + r.height / 2;
  const ev = (type, cx, cy, target) => target.dispatchEvent(new MouseEvent(type, {
    clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true, view: window, ...mods,
  }));
  ev('mousedown', x, y, el);
  for (let i = 1; i <= 5; i++) { ev('mousemove', x + (dx * i) / 5, y + (dy * i) / 5, window); await frame(); }
  ev('mouseup', x + dx, y + dy, window);
  await wait(200);
}
async function menuRow(text) {
  const find = () => [...host.querySelectorAll('.dc-menu button')].find((b) => b.textContent === text);
  await until(() => find());
  return find();
}
const savedCopy = () => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('dc2-state:'));
  return k ? JSON.parse(localStorage.getItem(k)) : null;
};
function chip(id, label) {
  return [...nodeEl(id).querySelectorAll('.dc-size')].find((b) => b.textContent === label);
}

test('a header drag moves the window and saves its place', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaCode.dc.html';
  await focusOn(id);
  const before = { ...rf().getNode(id).position }, zoom = rf().getZoom();
  await drag(nodeEl(id).querySelector('.dc-winhead'), 100, 50);
  const after = rf().getNode(id).position;
  check(Math.abs(after.x - before.x - 100 / zoom) < 2 && Math.abs(after.y - before.y - 50 / zoom) < 2,
    `moved by ${after.x - before.x}, ${after.y - before.y}; want ${100 / zoom}, ${50 / zoom}`);
  const saved = h.api.state().positions[id];
  check(saved && Math.abs(saved.x - (after.x + 36)) < 0.5 && Math.abs(saved.y - (after.y + 100)) < 0.5, 'saved place ' + JSON.stringify(saved));
  check(savedCopy() && savedCopy().positions[id], 'the browser copy has no saved place');
});

test('with ⌘ held, a drag on the screen moves the window', async () => {
  mount(await sample()); await ready();
  const id = 'Invoices.dc.html';
  await focusOn(id);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
  await until(() => host.querySelector('.dc-root.dc-grab'));
  const before = { ...rf().getNode(id).position }, zoom = rf().getZoom();
  await drag(nodeEl(id).querySelector('.dc-shield'), 80, 40, { metaKey: true });
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  const after = rf().getNode(id).position;
  check(Math.abs(after.x - before.x - 80 / zoom) < 2, `moved by ${after.x - before.x}; want ${80 / zoom}`);
  check(!host.querySelector('.dc-root.dc-grab'), 'the grip stayed on after the key went up');
});

test('a chip click changes the file and the size, and the arrow follows', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaDone.dc.html';
  await focusOn(id);
  check(rf().getNode(id).width === 1440 + 72, 'width ' + rf().getNode(id).width);
  const e = rf().getEdges().find((x) => x.target === id);
  const pathOf = () => host.querySelector(`.react-flow__edge[data-id="${e.id}"] .react-flow__edge-path`).getAttribute('d');
  const d0 = pathOf();
  check(chip(id, '390'), 'no 390 chip');
  chip(id, '390').click();
  await until(() => rf().getNode(id).width === 390 + 72);
  check(rf().getNode(id).height === 844 + 136, 'height ' + rf().getNode(id).height);
  check(h.api.state().variants[id] === 'ZatcaDonePhone.dc.html', 'the choice is not saved');
  await wait(100);
  check(pathOf() !== d0, 'the arrow did not follow the new size');
});

test('an arrow side change is saved, and the menu resets it', async () => {
  mount(await sample()); await ready();
  const from = 'ZatcaProfile.dc.html', to = 'ZatcaCode.dc.html';
  const e = rf().getEdges().find((x) => x.source === from && x.target === to);
  h.api.reconnect(e.id, { source: from, target: to, sourceHandle: 'b', targetHandle: 'l' });
  await until(() => rf().getEdge(e.id).sourceHandle === 'b');
  const sides = Object.values(h.api.state().arrowSides);
  check(sides.length === 1 && sides[0].fs === 'b' && !('ts' in sides[0]), JSON.stringify(h.api.state().arrowSides));
  h.api.reconnect(e.id, { source: from, target: 'Invoices.dc.html', sourceHandle: 'b', targetHandle: 'l' });
  await wait(100);
  check(rf().getEdge(e.id).target === to, 'a reconnect to another window was accepted');
  await focusOn(from);
  nodeEl(from).querySelector('.dc-kebab').click();
  (await menuRow('Reset arrow sides')).click();
  await until(() => rf().getEdge(e.id).sourceHandle === 'r');
  check(Object.keys(h.api.state().arrowSides).length === 0, JSON.stringify(h.api.state().arrowSides));
});

test('Reset position returns a moved window to canvas.json', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaCode.dc.html';
  h.api.act.move(id, { x: 9000, y: 9000 });
  await until(() => rf().getNode(id).position.x === 9000 - 36);
  await focusOn(id);
  nodeEl(id).querySelector('.dc-kebab').click();
  (await menuRow('Reset position')).click();
  await until(() => rf().getNode(id).position.x === 2880 - 36 && rf().getNode(id).position.y === 1040 - 100);
  check(!(id in h.api.state().positions), 'the saved place stayed');
});

test('Delete asks twice, then removes the window and its arrows', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaFailed.dc.html';
  await focusOn(id);
  nodeEl(id).querySelector('.dc-kebab').click();
  (await menuRow('Delete')).click();
  check(nodeEl(id), 'one click deleted the window');
  (await menuRow('Click again to delete')).click();
  await until(() => !nodeEl(id));
  check(!rf().getEdges().some((x) => x.source === id || x.target === id), 'an arrow of the deleted window stayed');
  check(h.api.state().deleted.includes(id), 'the delete is not saved');
});

test('a failed export shows the error in the menu', async () => {
  window.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('rf-test-')) return new Response('', { status: 404 });
    if (u.endsWith('ZatcaCode.dc.html')) throw new TypeError('offline');
    return realFetch(url, init);
  };
  mount(await sample()); await ready();
  const id = 'ZatcaCode.dc.html';
  await focusOn(id);
  nodeEl(id).querySelector('.dc-kebab').click();
  (await menuRow('Download PNG')).click();
  await until(() => host.querySelector('.dc-menu-error'));
  const text = host.querySelector('.dc-menu-error').textContent;
  check(text.includes('PNG export failed: offline'), 'error row: ' + text);
});

test('a chip click renders only its own window', async () => {
  mount(await sample()); await ready(); await wait(1600);
  const id = 'ZatcaDone.dc.html';
  await focusOn(id, 0.1); await wait(1200);
  const r0 = DesignCanvas.test.renders.count;
  chip(id, '390').click();
  await until(() => rf().getNode(id).width === 462);
  await wait(1200);
  const n = DesignCanvas.test.renders.count - r0;
  check(n <= 4, n + ' window renders for one chip click on a page of 10 windows');
});

test('Google Fonts export keeps the Arabic and the last Latin face', async () => {
  const css = '/* arabic */\n@font-face {font-family:Review;src:url(https://example.test/ar.woff2);unicode-range:U+0600-06FF;}\n/* latin */\n@font-face {font-family:Review;src:url(https://example.test/en.woff2);unicode-range:U+0000-00FF;}';
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return new Response(String(url).includes('.woff2') ? 'font' : css); };
  const out = await DesignCanvas.test.exporter.dcFontCss('https://fonts.googleapis.com/review-' + Date.now());
  check(calls.includes('https://example.test/ar.woff2') && calls.includes('https://example.test/en.woff2'), 'a font subset was dropped');
  check((out.match(/@font-face/g) || []).length === 2, 'a font face was lost');
});

test('CSS backgrounds and imported stylesheet assets rasterize at 2x', async () => {
  const { dcInlineDoc, dcSvgUrl, dcArtboardSvg } = DesignCanvas.test.exporter;
  const c = document.createElement('canvas'); c.width = c.height = 10;
  const ctx = c.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 10, 10);
  const red = c.toDataURL();
  const calls = [];
  window.fetch = async (url) => {
    const u = new URL(url, location.href); calls.push(u.pathname);
    if (u.pathname === '/styles/main.css') return new Response('@import "nested/background.css";');
    if (u.pathname === '/styles/nested/background.css') return new Response('body{margin:0;width:100px;height:100px;background-image:url(../red.png)}');
    if (u.pathname === '/styles/red.png') return realFetch(red);
    return new Response('', { status: 404 });
  };
  const html = '<html><head><link rel="stylesheet" href="/styles/main.css"></head><body></body></html>';
  // Download PNG's own wrapper at its own 2x scale, so this check fails if the
  // export path changes under it.
  const xhtml = await dcInlineDoc(html, location.href);
  const image = new Image(); image.src = dcSvgUrl(dcArtboardSvg(xhtml, 100, 100, 2)); await image.decode();
  check(image.naturalWidth === 200, 'the export SVG did not rasterize at 2x, got ' + image.naturalWidth);
  ctx.drawImage(image, 0, 0, 10, 10);
  const pixel = ctx.getImageData(5, 5, 1, 1).data;
  check(pixel[0] > 240 && pixel[1] < 20, 'the background rasterized white instead of red');
  check(calls.includes('/styles/red.png'), 'a CSS URL resolved against the wrong base');
  check(xhtml.includes('data:image/png'), 'the HTML export still depends on an external background');
});
```

- [ ] **Step 2: Run the checks**

Run: `npm run build && npm run test:browser 2>&1 | tail -18`
Expected: 16 `PASS` lines and `PASS: canvas regressions`. A check that fails here shows a real defect of Task 8's wiring (or of a synthetic-event assumption in the check). Find the root cause from evidence (console, DOM, `h.api.state()`), fix the code or, only when the evidence shows the synthetic event is not how the real input arrives, the check. Record each fix and its evidence in the report. Do not weaken an assertion to make it pass.

- [ ] **Step 3: Run everything**

Run: `npm run test:unit` → `58 passed`. Run: `node tests/run.mjs 2>&1 | tail -1` → `PASS: canvas regressions` (old suite).

- [ ] **Step 4: Commit**

```bash
git add tests/rf src
git commit -m "Check the window actions in the browser"
```

---

### Task 10: View behaviours in the browser

**Goal:** Browser checks prove the view behaviours Task 8 wired: the restore lifecycle, the saved view, Back to content, the host protocol, the mouse-wheel zoom against the trackpad pan, and `--dc-inv-zoom`. Fix each defect the checks find at its root cause.

**Files:**
- Create: `tests/rf/checks-view.js`
- Modify: `tests/rf/regressions.html` (load `checks-view.js` after `checks-window.js`)
- Modify only if a check finds a defect: `src/CanvasPage.jsx`, `src/view.js`, `src/host.js`, `src/persist.js`, `src/styles.css`

**Acceptance Criteria:**
- [ ] No window draws before the state read ends; the saved place is then used; a state read that hangs gives up after 1.5 s (draws between 1.4 s and 3.5 s).
- [ ] A view set before an unmount comes back on the next mount of the same page.
- [ ] With no content on screen, the pill `Back to content` shows; a click puts content on screen and hides it.
- [ ] Embedded: one `__dc_zoom` per settled `__dc_set_zoom`, with that scale, and one more after `__dc_probe`. Top level: no post at all.
- [ ] A mouse-wheel notch (`deltaY: 100`) zooms out; a trackpad scroll (`deltaY: 3.5`) pans and keeps the zoom.
- [ ] At zoom 0.25, `--dc-inv-zoom` is `4` on the root and an arrow's computed `stroke-width` is `4px` (1 screen px).
- [ ] `npm run test:browser 2>&1 | grep -c '^PASS '` prints `24`, and the last line is `PASS: canvas regressions`.

**Verify:** `npm run test:browser 2>&1 | grep -c '^PASS '` → `24`

**Steps:**

- [ ] **Step 1: Write the checks**

In `tests/rf/regressions.html`, add `<script src="./checks-view.js"></script>` after the `checks-window.js` line.

`tests/rf/checks-view.js`:

```js
const stateWith = (positions) => ({ updatedAt: 5, positions, variants: {}, arrowSides: {}, deleted: [] });

test('the page waits for the saved state, then uses it', async () => {
  let release = null;
  window.fetch = (url, init) => (String(url).includes('rf-test-')
    ? new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify(stateWith({ 'ZatcaCode.dc.html': { x: 3000, y: 5000 } })))); })
    : realFetch(url, init));
  mount(await sample());
  await until(() => release);
  await wait(300);
  check(!host.querySelector('.react-flow__node-window'), 'windows drew before the saved state was read');
  release();
  await ready();
  const p = rf().getNode('ZatcaCode.dc.html').position;
  check(p.x === 3000 - 36 && p.y === 5000 - 100, 'the saved place was not used: ' + JSON.stringify(p));
});

test('a state read that hangs gives up after 1.5 s', async () => {
  window.fetch = (url, init) => (String(url).includes('rf-test-') ? new Promise(() => {}) : realFetch(url, init));
  const data = await sample();
  const t0 = performance.now();
  mount(data);
  await ready(6000);
  const dt = performance.now() - t0;
  check(dt >= 1400 && dt < 3500, 'the page drew after ' + Math.round(dt) + ' ms');
});

test('the view comes back after a reload', async () => {
  const data = await sample();
  mount(data); await ready();
  rf().setViewport({ x: 10, y: 20, zoom: 0.3 });
  await wait(300);
  h.unmount(); h = null; host.replaceChildren();
  mount(data); await ready();
  const v = rf().getViewport();
  check(Math.abs(v.x - 10) < 0.01 && Math.abs(v.y - 20) < 0.01 && Math.abs(v.zoom - 0.3) < 1e-6, 'view ' + JSON.stringify(v));
});

test('Back to content shows with no content on screen and brings it back', async () => {
  mount(await sample()); await ready();
  rf().setViewport({ x: 200000, y: 200000, zoom: 0.5 });
  await until(() => host.querySelector('.dc-backto'), 2000);
  host.querySelector('.dc-backto').click();
  await wait(700);
  check([...host.querySelectorAll('.react-flow__node-window')].some(onScreen), 'no window on screen after Back to content');
  check(!host.querySelector('.dc-backto'), 'the pill stayed');
});

test('an embedded canvas posts the zoom once per settled gesture', async () => {
  const posts = [];
  mount(await sample(), { host: { embedded: true, post: (m) => posts.push(m) } });
  await ready(); await wait(400);
  check(posts.some((m) => m.type === '__dc_present'), 'no __dc_present');
  const zooms = () => posts.filter((m) => m.type === '__dc_zoom');
  const n0 = zooms().length, target = rf().getZoom() * 2;
  window.postMessage({ type: '__dc_set_zoom', scale: target }, '*');
  await wait(600);
  check(zooms().length === n0 + 1, (zooms().length - n0) + ' __dc_zoom posts for one settled zoom');
  check(Math.abs(zooms()[zooms().length - 1].scale - target) < 1e-6, 'the post carried ' + zooms()[zooms().length - 1].scale + ', not ' + target);
  window.postMessage({ type: '__dc_probe' }, '*');
  await wait(300);
  check(zooms().length === n0 + 2, 'the probe did not post the zoom again');
});

test('a top-level canvas posts nothing to the host', async () => {
  const posts = [];
  mount(await sample(), { host: { post: (m) => posts.push(m) } });
  await ready();
  for (let i = 0; i < 6; i++) { wheel({ deltaY: -6, ctrlKey: true }); await frame(); }
  await wait(600);
  check(posts.length === 0, posts.length + ' posts from a canvas that is not embedded');
});

test('a mouse wheel zooms and a trackpad scroll pans', async () => {
  mount(await grid(6)); await ready(); await wait(300);
  const v0 = rf().getViewport();
  wheel({ deltaY: 100 });
  await wait(50);
  const v1 = rf().getViewport();
  check(v1.zoom < v0.zoom, `a mouse-wheel notch did not zoom out (${v0.zoom} → ${v1.zoom})`);
  wheel({ deltaY: 3.5, deltaX: 1.25 });
  await wait(50);
  const v2 = rf().getViewport();
  check(v2.zoom === v1.zoom && v2.y !== v1.y, 'a trackpad scroll did not pan: ' + JSON.stringify([v1, v2]));
});

test('the arrows keep their screen width at every zoom', async () => {
  mount(await sample()); await ready();
  rf().setViewport({ x: 0, y: 0, zoom: 0.25 });
  await wait(300);
  const inv = host.querySelector('.dc-root').style.getPropertyValue('--dc-inv-zoom');
  check(inv === '4', '--dc-inv-zoom is ' + inv);
  const w = getComputedStyle(host.querySelector('.react-flow__edge-path')).strokeWidth;
  check(w === '4px', 'an arrow stroke is ' + w + ' at zoom 0.25');
});
```

- [ ] **Step 2: Run the checks**

Run: `npm run build && npm run test:browser 2>&1 | tail -26`
Expected: 24 `PASS` lines and `PASS: canvas regressions`. Handle a failure as in Task 9 Step 2: root cause from evidence, fix the code, record it; never weaken an assertion.

- [ ] **Step 3: Run everything**

Run: `npm run test:unit` → `58 passed`. Run: `node tests/run.mjs 2>&1 | tail -1` → `PASS: canvas regressions` (old suite).

- [ ] **Step 4: Commit**

```bash
git add tests/rf src
git commit -m "Check the view behaviours in the browser"
```

---

### Task 11: The tall-page blank check

**Goal:** `tests/blank-check.mjs` runs the spike's zoom-in-then-zoom-out probe on the new canvas in a headful Chrome with the GPU on, on the synthetic tall page, and fails if content is lost; a `--control` run (with `will-change` forced on the viewport) proves the check can see the blank.

**Files:**
- Create: `tests/cdp.mjs`, `tests/fixtures/tall.js`, `tests/blank.html`, `tests/blank-check.mjs`
- Modify: `package.json` (script `test:blank`)

**Acceptance Criteria:**
- [ ] `node tests/blank-check.mjs` prints `BLANK CHECK canvas: OK at 1 s, OK at 5 s` and exits 0: no card missing or cut, `edgesVsBase ≥ 0.5`, `diffVsBase ≤ 0.02` after the gesture.
- [ ] `node tests/blank-check.mjs --control` prints `BLANK CHECK control: BLANK …` and exits 0. If the control does not blank, the script exits 1 with `the check cannot see the blank on this machine`, and the task stops and reports that.
- [ ] The run writes `tests/out/blank/blank-<variant>.json` and the PNGs `blank-<variant>-{base,in,mid,out,out5}.png`; the report says what the full-resolution crops of the bottom two card rows of `out` show for both variants (opened with the Read tool).
- [ ] The validity guard holds: idle rAF ≥ 50 fps and `visibilityState === 'visible'` before and after, else `INVALID` and exit 4.

**Verify:** `npm run test:blank` → `BLANK CHECK canvas: OK at 1 s, OK at 5 s` then `BLANK CHECK control: BLANK …`

**Steps:**

- [ ] **Step 1: Port the Chrome driver and the tall page**

```bash
git show 483ee72:spike/cdp.mjs > tests/cdp.mjs
mkdir -p tests/fixtures
git show 483ee72:spike/tall.js > tests/fixtures/tall.js
```

(`483ee72` is the last commit of branch `spike/react-flow`; the object is in this repository.) Then edit `tests/cdp.mjs`:
- `outDir` → `path.join(root, 'tests', 'out')`; `root` stays the repository root (`path.resolve(<dir of this file>, '..')`).
- The Chrome profile directory → `path.join(root, 'tests', '.chrome-profile-gpu')` (git-ignored by `tests/.chrome-profile*/`).
- Replace the `ENGINES` object with:

```js
// The pages the headful scripts open. `old` exists until the switch-over
// (Task 14 of the phase 1 plan) removes the old canvas.
export const ENGINES = {
  old: { sample: '/sample/index.html', target: '.design-canvas',
    count: `document.querySelectorAll('[data-dc-slot]').length`, zoom: `window.dcView.scale` },
  new: { sample: '/sample/index-rf.html', tall: '/tests/blank.html', target: '.react-flow__pane',
    count: `document.querySelectorAll('.react-flow__node-window').length`, zoom: `window.dcCanvas.api.rf.getZoom()` },
};
```

In `tests/fixtures/tall.js` rename `window.spikeTall` to `window.tallPage` and change its header comment to say it is the blank check's page (12,200 × 16,200 px, the size of the real page that blanked). Change nothing else.

`tests/blank.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>blank check</title>
<body style="margin:0"><div id="root" style="height:100vh"></div>
<script src="../dist/design-canvas.js"></script>
<script src="./fixtures/tall.js"></script>
<script>
  // ?control=1 breaks spike rule 1 on purpose (will-change on the viewport),
  // so tests/blank-check.mjs --control can show that the check sees the blank.
  if (new URLSearchParams(location.search).get('control') === '1') {
    const s = document.createElement('style');
    s.textContent = '.react-flow__viewport{will-change:transform !important}';
    document.head.appendChild(s);
  }
  fetch('../sample/canvas.json').then((r) => r.json()).then((s) => {
    window.dcCanvas = DesignCanvas.mount(document.getElementById('root'),
      { data: window.tallPage(s), page: 'tall', base: '../sample/', stateFile: 'blank-check.json' });
  });
</script>
```

- [ ] **Step 2: Port the probe**

```bash
git show 483ee72:spike/wc-check.mjs > tests/blank-check.mjs
```

Edit `tests/blank-check.mjs` so it measures the new canvas only:
1. Header comment: what it checks (the zoom-in-then-zoom-out sequence that blanked the old engine; spike report, "Tall page"), how to run it (`npm run build`, then `node tests/blank-check.mjs [--control]`), and the pass rule.
2. Imports from `./cdp.mjs`. Write outputs to `path.join(outDir, 'blank')` (create it with `mkdirSync(..., { recursive: true })`); name files `blank-<variant>…` instead of `wc4-<variant>-f<RUN>…` and `wc-check-f<RUN>.json`.
3. In every page expression replace `window.rf` and the bare `rf.` with `window.dcCanvas.api.rf` / `dcCanvas.api.rf.` (in `NEW_FIT_EXPR`, `READ_VIEW`, `ZOOM_EXPR.new`, `fitNew`'s ready test, and any other expression that reads `rf`). The ready test becomes `${ENGINES.new.count} >= 10 && window.dcCanvas && dcCanvas.api && dcCanvas.api.fitted`.
4. Delete everything that serves the old engine or `freeze` only: `fitOld`, `ZOOM_EXPR.old`, `EL.old`, `WORLD_WC`/`worldWC`, `LIVE_CARD_RECTS`, `BLANK_WHITE`, `HEAD_PX`, the `freeze` split of the zoom-in (keep the single-call zoom-in), `worldWillChange`, `gestureBlank`, the speed ratios against `old`, `median`/`mode`/`printMedianTable` and the `RUN` argument.
5. `VARIANTS` becomes one entry chosen by the argument: `{ key: 'canvas', engine: 'new', url: '/tests/blank.html' }`, or with `--control` `{ key: 'control', engine: 'new', url: '/tests/blank.html?control=1' }`.
6. Keep unchanged: `IDLE_PROBE`/`checkIdle` (exit 4 on INVALID, `SPIKE_ALLOW_THROTTLED` renamed `BLANK_ALLOW_THROTTLED`), `TICKS`, `calibrateNewDy`, `allRectsOf`, `EDGE`, `GUTTERS`, `DIFF_VS_BASE`, `gutterPairsOf`, `gutterRectsOf`, `edgesVsBaseOf`, `statsOf`, `cardMetrics` (with its `n === 0` skip), `metricsFor` and its verdict rule, `ensureView`, the 1 s and +5 s shots.
7. The end: write the JSON, print `BLANK CHECK <key>: <verdict at out> at 1 s, <verdict at out5> at 5 s (missing=…, partial=…, edgesVsBase=…, diffVsBase=…)`, then exit: `canvas` → 0 if both verdicts are `OK`, else 1; `control` → 0 if a verdict is `BLANK`, else print `the check cannot see the blank on this machine` and exit 1.

In `package.json` add: `"test:blank": "npm run build && node tests/blank-check.mjs && node tests/blank-check.mjs --control"`.

- [ ] **Step 3: Run it**

Run (headful, the window stays in front):

```bash
npm run build
caffeinate -dimsu -t 900 & ( node tests/blank-check.mjs & p=$!; ( sleep 400; kill -9 $p 2>/dev/null ) & wait $p ); echo "exit=$?"; pkill -f "\.chrome-profile"; pkill -f "http.server"
( node tests/blank-check.mjs --control & p=$!; ( sleep 400; kill -9 $p 2>/dev/null ) & wait $p ); echo "exit=$?"; pkill -f "\.chrome-profile"; pkill -f "http.server"; pkill caffeinate
```

Expected: `BLANK CHECK canvas: OK at 1 s, OK at 5 s …` with `exit=0`, then `BLANK CHECK control: BLANK …` with `exit=0`.

- [ ] **Step 4: Look at the pictures**

Crop the bottom two card rows of `tests/out/blank/blank-canvas-out.png` and `blank-control-out.png` at full resolution (`sips -c 300 1300 --cropOffset 1300 640 <in> --out <crop>`; the screenshots are 2560 × 1600), open both crops with the Read tool, compare each with its `base` crop, and write down exactly what differs (cards, headers, arrows, text). The `canvas` crop must match its base; the `control` crop must show the loss the metric reported.

- [ ] **Step 5: Commit**

```bash
git add tests/cdp.mjs tests/fixtures/tall.js tests/blank.html tests/blank-check.mjs package.json
git commit -m "Add the tall-page blank check"
```

---

### Task 12: Frame times against the old engine

**Goal:** `perf/frames.mjs` measures the same zoom and pan gestures on the old sample (`sample/index.html`) and the new one (`sample/index-rf.html`) in both engine orders and records the result in `perf/results.md`; `perf/bench.js` is the console harness for the new canvas.

**Files:**
- Create: `perf/frames.mjs`, `perf/results.md`
- Modify: `perf/bench.js` (replace), `package.json` (script `perf`)

**Acceptance Criteria:**
- [ ] `perf/frames.mjs` keeps every validity guard of the spike bench: equal fit scale, equal scale after the 45 zoom-in ticks and equal pan travel (each within 3%), equal pan scale, idle rAF ≥ 50 fps and `visible` before and after; any failure prints `INVALID …`, writes nothing and exits 4.
- [ ] Two valid runs, one in each engine order, write `perf/out/frames.json` and `perf/out/frames-reversed.json`.
- [ ] `perf/results.md` holds the machine, the Chrome version, both tables (zoom and pan: p50, p95, max, dropped, over16, busyMs for each engine), the parity lines and the verdicts by the rule "new p95 ≤ 1.10 × old p95 and new max ≤ 1.10 × old max". A FAIL is recorded as it is; the task does not tune the canvas to change it.
- [ ] Pasting `perf/bench.js` into the console of `sample/index-rf.html` and running `await dcBench.all()` returns `{ zoomFrames, panFrames, liveByZoom, patchCost }` with no error.

**Verify:** `test -s perf/out/frames.json && test -s perf/out/frames-reversed.json && grep -c 'ZOOM\|PAN' perf/results.md` → a count of 4 or more

**Steps:**

- [ ] **Step 1: Port the bench**

```bash
git show 483ee72:spike/frames.mjs > perf/frames.mjs
```

Edit `perf/frames.mjs`:
1. Import from `../tests/cdp.mjs`; write outputs to `perf/out` (`mkdirSync(..., { recursive: true })`).
2. Rename the environment variables: `SPIKE_ORDER` → `PERF_ORDER`, `SPIKE_ALLOW_THROTTLED` → `PERF_ALLOW_THROTTLED`. Delete `SPIKE_OLD`, `SPIKE_NEW_FLAGS`, `SPIKE_OUT_TAG` and the `freeze` engagement check; the file names are `frames.json` (order `old,new`) and `frames-reversed.json` (order `new,old`).
3. In every page expression replace `window.rf` and the bare `rf.` with `window.dcCanvas.api.rf` / `dcCanvas.api.rf.`; the new page is ready when `${ENGINES.new.count} >= 10 && window.dcCanvas && dcCanvas.api && dcCanvas.api.fitted`.
4. Keep unchanged: the gestures (90 ctrl+wheel ticks of e^0.06, 45 in and 45 out; 60 pan frames of 40 screen px), the calibration of the new engine's `deltaY` and pan `deltaX`, the readiness wait (bounding box and live count stable for three reads 500 ms apart), all parity checks and the INVALID exits, the median of 3 runs, `dropped` (frames longer than 1.5 × the run's p50), the pass rule and the printed table.

In `package.json` add: `"perf": "npm run build && node perf/frames.mjs && PERF_ORDER=new,old node perf/frames.mjs"`.

- [ ] **Step 2: Replace the console harness**

`perf/bench.js`:

```js
// perf/bench.js — measurement harness for the React Flow canvas. The app
// never loads it. Open sample/index-rf.html (sample/index.html after the
// switch-over), wait for the windows, paste this file into the DevTools
// console and run `await dcBench.all()`. patchCost clicks a variant chip and
// the canvas saves it: to undo, delete the page's dc2-state: entry in
// localStorage and reload.
(() => {
  const api = () => {
    const h = DesignCanvas.last();
    if (!h || !h.api || !h.api.fitted) throw new Error('dcBench: no mounted canvas yet');
    return h.api;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => +n.toFixed(2);
  const iframes = () => document.querySelectorAll('.dc-card iframe').length;
  const wheel = (o) => document.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, ...o,
  }));
  const frameStats = async (fn) => {
    const times = [];
    let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await fn();
    stop = true;
    const s = times.slice(2).sort((a, b) => a - b), q = (p) => round(s[Math.floor(s.length * p)]);
    return { frames: s.length, median: q(0.5), p95: q(0.95), max: round(s[s.length - 1]),
      dropped: s.filter((f) => f > 1.5 * q(0.5)).length, over16: s.filter((f) => f > 16.7).length };
  };
  const center = async (zoom) => {
    const { rf } = api();
    const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
    const z = zoom || Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height);
    rf.setViewport({ zoom: z, x: innerWidth / 2 - (b.x + b.width / 2) * z, y: innerHeight / 2 - (b.y + b.height / 2) * z });
    await sleep(1500);
    return z;
  };
  // 90 pinch ticks, one per frame: in for the first half, out for the second.
  // deltaY 4.3281 is one tick of e^0.06, the old engine's tick (spike bench).
  const zoomFrames = async () => { await center(); return frameStats(async () => {
    for (let i = 0; i < 90; i++) { wheel({ deltaY: i < 45 ? -4.3281 : 4.3281, ctrlKey: true }); await frame(); }
  }); };
  // 60 trackpad scroll frames of 40 screen px at zoom 1.
  const panFrames = async () => { await center(1); return frameStats(async () => {
    for (let i = 0; i < 60; i++) { wheel({ deltaX: i < 30 ? 40 : -40, deltaY: i % 2 ? 0.5 : -0.5 }); await frame(); }
  }); };
  const liveByZoom = async () => {
    const out = {};
    for (const z of [0.05, 0.1, 0.25, 0.5, 1]) { await center(z); out[z] = iframes(); }
    return out;
  };
  // One variant chip click: the windows it renders and the time to the next frame.
  const patchCost = async () => {
    await center();
    const chip = [...document.querySelectorAll('.dc-size')].find((b) => !b.classList.contains('dc-on'));
    if (!chip) return null;
    const r0 = DesignCanvas.test.renders.count, t0 = performance.now();
    chip.click();
    await frame(); await frame();
    return { ms: round(performance.now() - t0), renders: DesignCanvas.test.renders.count - r0 };
  };
  const all = async () => ({ zoomFrames: await zoomFrames(), panFrames: await panFrames(), liveByZoom: await liveByZoom(), patchCost: await patchCost() });
  window.dcBench = { frameStats, zoomFrames, panFrames, liveByZoom, patchCost, all };
})();
```

- [ ] **Step 3: Run the bench in both orders**

```bash
npm run build
caffeinate -dimsu -t 900 & ( node perf/frames.mjs & p=$!; ( sleep 300; kill -9 $p 2>/dev/null ) & wait $p ); echo "exit=$?"; pkill -f "\.chrome-profile"; pkill -f "http.server"
( PERF_ORDER=new,old node perf/frames.mjs & p=$!; ( sleep 300; kill -9 $p 2>/dev/null ) & wait $p ); echo "exit=$?"; pkill -f "\.chrome-profile"; pkill -f "http.server"; pkill caffeinate
```

Expected: two tables, all parity lines `OK`, a `ZOOM` and a `PAN` verdict each, `exit=0`. `exit=4` (INVALID) is the machine or a real parity problem: read the message, correct the cause, run again; never write numbers from an INVALID run.

- [ ] **Step 4: Check the console harness**

Serve the worktree (`python3 -m http.server 8000`), open `http://127.0.0.1:8000/sample/index-rf.html` in Chrome, wait for the windows, paste `perf/bench.js` into the console and run `await dcBench.all()`. Record the returned object in `perf/results.md`. (A script may do this through `tests/cdp.mjs` instead: open the page, `evaluate` the file's text, then `evaluate('dcBench.all()')`.)

- [ ] **Step 5: Write the results**

`perf/results.md`: a header with the date, the worktree commit, `sysctl -n machdep.cpu.brand_string`, the Chrome version, the viewport and DPR; then for each order the table (engine × gesture: p50, p95, max, dropped, over16, busyMs), the parity lines, the `ZOOM`/`PAN` verdicts; then the `dcBench.all()` object; then one paragraph in Simplified Technical English that compares the result with the spike's `live-wc` numbers (spike report, "The same bench with the spike page flags": zoom p95 ratio 1.03, 0 dropped) and says plainly whether the rule passes.

- [ ] **Step 6: Commit**

```bash
git add perf/frames.mjs perf/bench.js perf/results.md package.json
git commit -m "Measure frame times against the old engine"
```

---

### Task 13: The look review

**Goal:** The user compares side-by-side screenshots of the old and the new sample at three views, reads the frame-time result, and says whether the switch-over can go ahead.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Create: `tests/look.mjs`
- Output (git-ignored): `tests/out/look/{old,new}-{fit,z025,z1}.png`, `tests/out/look/index.html`

**Acceptance Criteria:**
- [ ] `node tests/look.mjs` writes 6 PNGs and `tests/out/look/index.html` (old on the left, new on the right; the fit, `ZatcaCode` centred at zoom 0.25, and `ZatcaCode`'s top-left at zoom 1).
- [ ] The user has the page (sent with SendUserFile, or its path) and the verdict lines of `perf/results.md`.
- [ ] The user has answered, in the conversation: (a) does the new canvas look the same as the old one, apart from the arrows, and if not, what must change; (b) must renaming a window come back (see "Deferred decisions" in the header); (c) is it OK to switch over.
- [ ] If (a) lists changes or (b) is "yes", the controller adds a task for them before Task 14 (a ledger ruling), and this gate runs again after it. Task 14 starts only after (c) is "yes".

**Verify:** `ls tests/out/look | wc -l` → `7`, then the three quoted answers in the conversation

**Steps:**

- [ ] **Step 1: Write the screenshot script**

`tests/look.mjs`:

```js
// tests/look.mjs — side-by-side screenshots of the old and the new sample
// for the look review (phase 1 plan, Task 13). Headful Chrome, GPU on.
// Writes tests/out/look/*.png and tests/out/look/index.html. Task 14 deletes
// it with the old canvas.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const dir = path.join(outDir, 'look');
mkdirSync(dir, { recursive: true });
const ID = 'ZatcaCode.dc.html';
const SEL = { old: `[data-dc-slot="${ID}"]`, new: `.react-flow__node[data-id="${ID}"]` };
const rectOf = (sel) => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`;
// null: the engine's own first view. Else a zoom, with ZatcaCode centred or
// with its top-left corner at (40, 40).
const VIEWS = [['fit', null], ['z025', { zoom: 0.25, anchor: 'center' }], ['z1', { zoom: 1, anchor: 'topleft' }]];
const shift = (r, anchor) => (anchor === 'center'
  ? { dx: VIEW.width / 2 - (r.l + r.w / 2), dy: VIEW.height / 2 - (r.t + r.h / 2) }
  : { dx: 40 - r.l, dy: 40 - r.t });
const CLEAR = 'try { localStorage.clear(); } catch {}';

async function show(c, name, view) {
  const E = ENGINES[name];
  if (name === 'new') {
    await c.open(E.sample, CLEAR);
    await c.until(`${E.count} >= 10 && window.dcCanvas && dcCanvas.api && dcCanvas.api.fitted`, 60000);
    if (view) {
      const set = (x, y) => c.evaluate(`(async () => { dcCanvas.api.rf.setViewport({ x: ${x}, y: ${y}, zoom: ${view.zoom} }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
      await set(0, 0);
      const d = shift(await c.evaluate(rectOf(SEL.new)), view.anchor);
      await set(d.dx, d.dy);
    }
  } else if (!view) {
    await c.open(E.sample, CLEAR);
    await c.until(`${E.count} >= 10`, 60000);
  } else {
    // The old engine restores its view from localStorage on load and then
    // skips its first fit: pass 1 measures at x = y = 0, pass 2 sets the view.
    const key = 'dc-viewport-v3:' + E.sample;
    const preset = (x, y) => `${CLEAR} localStorage.setItem(${JSON.stringify(key)}, JSON.stringify({ x: ${x}, y: ${y}, scale: ${view.zoom} }));`;
    await c.open(E.sample, preset(0, 0));
    await c.until(`${E.count} >= 10`, 60000);
    await sleep(800);
    const d = shift(await c.evaluate(rectOf(SEL.old)), view.anchor);
    await c.open(E.sample, preset(d.dx, d.dy));
    await c.until(`${E.count} >= 10`, 60000);
  }
  await sleep(3500);   // the settle, the live pass and the iframe loads
}

const c = await launch();
try {
  for (const [tag, view] of VIEWS) {
    for (const name of ['old', 'new']) {
      await show(c, name, view);
      await c.screenshot(path.join('look', `${name}-${tag}.png`));
    }
  }
  writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Look review</title>
<style>body{font:14px system-ui,sans-serif;margin:16px}table{width:100%;border-collapse:collapse}td{width:50%;padding:6px;vertical-align:top}img{width:100%;border:1px solid #ccc}</style>
<h1>Old canvas (left), React Flow canvas (right)</h1>
<table>${VIEWS.map(([t]) => `<tr><th colspan="2">${t}</th></tr><tr><td><img src="old-${t}.png"></td><td><img src="new-${t}.png"></td></tr>`).join('')}</table>`);
  console.log('LOOK written: ' + path.join(dir, 'index.html'));
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
```

- [ ] **Step 2: Run it**

```bash
npm run build
caffeinate -dimsu -t 900 & ( node tests/look.mjs & p=$!; ( sleep 400; kill -9 $p 2>/dev/null ) & wait $p ); echo "exit=$?"; pkill -f "\.chrome-profile"; pkill -f "http.server"; pkill caffeinate
ls tests/out/look
```

Expected: `LOOK written: …/tests/out/look/index.html`, `exit=0`, and 7 files. Open two of the pictures with the Read tool to check that each shows its canvas at the named view (not an error page, not an empty view).

- [ ] **Step 3: Commit the script**

```bash
git add tests/look.mjs
git commit -m "Add the side-by-side look screenshots"
```

- [ ] **Step 4: Ask the user**

Send `tests/out/look/index.html` and the six PNGs (SendUserFile), or give the path. Quote the two verdict lines and the zoom p95 ratios from `perf/results.md`. Ask the three questions (a), (b), (c) of the acceptance criteria. For (b), say: the old canvas let the user rename a window in its header; the spec's window shows a plain name; a "yes" adds a task that brings renaming back (a `labels` map in the saved state and an editable name in the header), and changes nothing else. Stop and wait for the answers. Do not guess them.

- [ ] **Step 5: Record the answers**

Record the three answers, quoted, in the ledger (and in the final report). If (a) lists changes or (b) is "yes", add the task and run this gate again after it.

---

### Task 14: The switch-over

**Goal:** The sample and the suite use the new canvas only: the old canvas, its suite and its sample pages are deleted, the new suite moves to `tests/`, the measurement scripts lose their old-engine arm, and the README describes the new canvas.

**Files:**
- Delete: `design-canvas.jsx`, `canvas-page.jsx`, `tests/regressions.html`, `tests/regressions.js`, `sample/all-options.html`, `sample/index-rf.html`, `tests/look.mjs`
- Move: `tests/rf/regressions.html`, `harness.js`, `checks-page.js`, `checks-window.js`, `checks-view.js`, `run-all.js` → `tests/`
- Modify: `sample/index.html`, `tests/cdp.mjs`, `perf/frames.mjs`, `perf/bench.js` (header comment), `package.json`, `README.md`

**Acceptance Criteria:**
- [ ] `git ls-files | grep -c 'design-canvas.jsx\|canvas-page.jsx\|all-options\|index-rf\|tests/rf/'` prints `0`.
- [ ] `sample/index.html` mounts `../dist/design-canvas.js` on `page-9`.
- [ ] `node tests/run.mjs 2>&1 | tail -1` (the default page, now the new suite) prints `PASS: canvas regressions` with 24 `PASS` lines.
- [ ] `npm test` passes (58 unit tests, 24 browser checks); `npm run test:blank` prints `OK at 1 s, OK at 5 s` for the canvas and `BLANK` for the control.
- [ ] `perf/frames.mjs` runs on the new sample only (no `old` engine, no order argument) and prints one table.
- [ ] `node flow-layout.js; echo $?` prints the usage line and `2`.
- [ ] `README.md` matches the text in Step 4.

**Verify:** `npm test 2>&1 | tail -1` → `PASS: canvas regressions`

**Steps:**

- [ ] **Step 1: Delete the old canvas and move the new suite**

```bash
git rm -q design-canvas.jsx canvas-page.jsx tests/regressions.html tests/regressions.js sample/all-options.html sample/index-rf.html tests/look.mjs
git mv tests/rf/regressions.html tests/rf/harness.js tests/rf/checks-page.js tests/rf/checks-window.js tests/rf/checks-view.js tests/rf/run-all.js tests/
```

In `tests/regressions.html` change `../../dist/design-canvas.js` to `../dist/design-canvas.js`. In `tests/harness.js` change `const SAMPLE = '../../sample/';` to `const SAMPLE = '../sample/';`.

`sample/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>design-canvas-lod · sample</title>
<body style="margin:0"><div id="root" style="height:100vh"></div>
<script src="../dist/design-canvas.js"></script>
<script>window.dcCanvas = DesignCanvas.mount(document.getElementById('root'), { page: 'page-9' });</script>
```

- [ ] **Step 2: Drop the old-engine arm of the scripts**

- `tests/cdp.mjs`: delete `ENGINES.old`; set `ENGINES.new.sample` to `'/sample/index.html'`; change the comment above `ENGINES` to say which scripts read it.
- `perf/frames.mjs`: measure the `new` engine only — delete `PERF_ORDER`, the old engine's fit and calibration, the parity checks between the two engines and the pass rule; keep the validity guard (idle rAF and `visible`, exit 4), the readiness wait, the median of 3 runs, and print one table (zoom and pan: p50, p95, max, dropped, over16, busyMs) to `perf/out/frames.json`. Its header comment says that the comparison with the old engine is recorded in `perf/results.md` and needs the old canvas, which this repository no longer has.
- `perf/bench.js`: in the header comment, `sample/index-rf.html (sample/index.html after the switch-over)` → `sample/index.html`.
- `package.json`: `"test:browser": "npm run build && node tests/run.mjs"` and `"perf": "npm run build && node perf/frames.mjs"`.

- [ ] **Step 3: Run everything**

Run: `npm test 2>&1 | tail -1` → `PASS: canvas regressions` (and `58 passed` earlier in the output).
Run the blank check as in Task 11 Step 3 → canvas `OK at 1 s, OK at 5 s`, control `BLANK`.
Run: `node flow-layout.js; echo $?` → usage line, `2`.
Run: `git ls-files | grep -c 'design-canvas.jsx\|canvas-page.jsx\|all-options\|index-rf\|tests/rf/'` → `0`.

- [ ] **Step 4: Rewrite the README**

Replace `README.md` with this text (exactly; it is in Simplified Technical English like the old one):

````markdown
# design-canvas-lod

A pan/zoom canvas page for a claude.ai/design project, built on React Flow.
Each screen of the project is a window on the canvas. The screens nearest the
middle of the view are live iframes. All other screens show a placeholder.

## Use in claude.ai/design

1. Run `npm install` once, then `npm run build`.
2. Copy `dist/design-canvas.js` and `dist/canvas.html` into the project,
   beside `canvas.json` and the `.dc.html` screens.
3. Open `canvas.html`. `?page=<id>` opens one page of `canvas.json`. Without
   it, a list at the top right selects the page (it shows for 2 pages or more).

A page of your own can call `DesignCanvas.mount(element, options)`:

| Option | Meaning |
|---|---|
| `page` | The page id in `canvas.json`. The first page if you give none |
| `data` | The `canvas.json` content, if the page has it. Else the canvas reads `./canvas.json` |
| `stateFile` | The file for the saved edits. Default `.design-canvas.<page>.v2.state.json` |
| `base` | The folder of the screen files, relative to the page. Default `./` |

## The canvas

- **Windows.** A header with the live dot (green while the screen is live),
  the name, the variant chips, the ⋯ menu and ↗ (open the screen in a new
  tab). The menu holds Open screen, Reset position, Reset arrow sides,
  Download PNG, Download HTML and Delete. Drag a window by its header. With
  Ctrl or ⌘ held, drag it from anywhere on it. A click on a screen opens its
  file. `canvas.json` x/y is the screen's top-left corner; the window grows
  around it, into the gutter.
- **Variants.** Copies of one screen fold into one window. A file whose
  CamelCase name starts with another file's name on the same page is a
  variant of it (`SignInWrong`, `SignInArabic`, `SignInPhone` → `SignIn`; the
  longest match wins). The header shows one chip group per axis that varies:
  size (`1440 · 2K · 390`), language (`EN · AR`) and state (`Main · Wrong`).
  Optional fields in `canvas.json` override the guess: `variantOf` (a file, or
  `null` to keep a window), `lang`, `state`.
- **Arrows.** `canvas.json` `flows`: `{ page, from, to, label, fs, ts, dashed }`,
  where `fs`/`ts` are the sides (`l`, `r`, `t`, `b`). An arrow is a React Flow
  bezier curve; it can cross a window. Drag an arrow end to another side of
  its window; the choice is saved and wins over `canvas.json`.
- **Notes.** `canvas.json` `annotations`. Drag a note to move it.
- **View.** A trackpad scroll pans. A pinch, or Ctrl with a scroll, zooms. A
  mouse wheel zooms. The view is saved in the browser. When no content is on
  screen, "Back to content" fits the page again.

`flow-layout.js` lays a page out the way fatoora's flow map does:
`node flow-layout.js canvas.json [page-id]` rewrites x/y and fs/ts in place.

## Live screens

At most 8 windows hold a live iframe. A pass ranks the windows: the windows
on screen first, then the nearest to the middle of the view. A live window
counts 400 px nearer. A window you touch (a pointer down on it, or the end of
its drag) keeps its place for 4 s, but never outranks a window on screen. A
window mounts only within 600 px of the view, and a live window drops beyond
1600 px. A live window that is on screen never drops. A pass runs 600 ms
after the last move, never during a pan, a zoom or a drag, and mounts one
iframe each 60 ms.

Two rendering rules hold, and the checks guard them:
- The React Flow viewport has no `will-change`. With it, a zoom-in and then a
  zoom-out on a big page loses content.
- Each live iframe has `will-change: transform`, so a zoom does not raster
  the screens again.

The React Flow spike measured why (its report is on branch
`fix-canvas-layer-limit`, `docs/superpowers/specs/2026-09-19-react-flow-spike-report.md`).

## Saved state

The edits are `{ updatedAt, positions, variants, arrowSides, deleted }`. They
go to the browser at once (`dc2-state:<page path>:<state file>`) and to the
state file 400 ms after the last edit, through `window.omelette.writeFile`
where the host has it. On load the newer `updatedAt` wins, and the browser
copy wins a tie. If the state file does not answer in 1.5 s, the browser copy
is used. Nothing draws before the restore ends.

## Host protocol

A canvas in an iframe talks to its host with `postMessage`, target origin
`'*'`. A canvas that is not embedded posts nothing.

| Message | Direction | When |
|---|---|---|
| `{ type: '__dc_present' }` | canvas → host | on start, and as the answer to `__dc_probe` |
| `{ type: '__dc_zoom', scale }` | canvas → host | once per settled gesture; the same scale is not posted twice |
| `{ type: '__dc_set_zoom', scale }` | host → canvas | the host sets the zoom, anchored on the middle of the view |
| `{ type: '__dc_probe' }` | host → canvas | the canvas answers `__dc_present` and posts its zoom again |

## Development

| Command | What it does |
|---|---|
| `npm run test:unit` | The Vitest unit tests of the pure modules |
| `npm run test:browser` | Builds, then runs `tests/regressions.html` in headless Chrome (`node tests/run.mjs`) |
| `npm run test:blank` | Builds, then runs the tall-page blank check in a headful Chrome with the GPU on, and its control |
| `npm run perf` | Builds, then measures zoom and pan frame times in a headful Chrome |

`perf/bench.js` is a console harness: open the sample, paste the file into the
DevTools console and run `await dcBench.all()`. `perf/results.md` holds the
comparison with the old canvas.

Run the sample: `npm run build`, then `python3 -m http.server 8000`, and open
`http://localhost:8000/sample/`.
````

- [ ] **Step 5: Commit**

```bash
git add -A sample tests perf package.json README.md
git commit -m "Switch the sample and the suite to React Flow"
```

`git status --short` must show nothing after the commit.

---

### Task 15: The deploy check in claude.ai/design

**Goal:** The user deploys the built canvas into the claude.ai/design project and confirms on the real "Users and roles" page that it has no blank, keeps the live screens live, is smooth, and that the window actions work.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Read: `dist/design-canvas.js`, `dist/canvas.html` (the user copies them into the project)

**Acceptance Criteria:**
- [ ] The user has copied `dist/design-canvas.js` and `dist/canvas.html` beside `canvas.json` in the claude.ai/design project and opened `canvas.html` on "Users and roles".
- [ ] The user has answered, in the conversation, after a zoom-in to the maximum and a zoom-out to the fit in several pinches, done two times: (a) does the bottom of the page blank or flicker (want "no"); (b) do the live screens stay live during and after the gesture (want "yes"); (c) is it smooth (want "yes"); (d) do a header drag, a variant chip, the ⋯ menu and an arrow-end drag work (want "yes", or the list of what fails).
- [ ] The answers are recorded, quoted, with the date, in the ledger and the final report. A "no" on (b)–(d) or a "yes" on (a) opens a fix task before the branch is finished.

**Verify:** the four quoted answers in the conversation

**Steps:**

- [ ] **Step 1: Build and hand over**

Run `npm run build`. Give the user the two files' full paths (`<worktree>/dist/design-canvas.js`, `<worktree>/dist/canvas.html`) and these steps:
1. Copy both files into the claude.ai/design project, beside `canvas.json`.
2. Open `canvas.html`. Select "Users and roles" in the list at the top right.
3. Zoom in to the maximum and out to the fit, in several pinches; do it two times; pan to the bottom.
4. Drag a window by its header, click a variant chip, open the ⋯ menu, drag an arrow end to another side.
5. Answer (a)–(d).

- [ ] **Step 2: Stop and wait for the answers.** Do not guess them from the local checks.

- [ ] **Step 3: Record the answers** in the ledger and the final report, quoted, with the date. Then the branch goes to superpowers-extended-cc:finishing-a-development-branch.
