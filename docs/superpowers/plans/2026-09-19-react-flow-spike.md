# React Flow Spike (Phase 0 Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure a throwaway React Flow canvas against today's `main` and give a go/no-go for the migration.

**Architecture:** A throwaway Vite library build (`spike/`) renders the sample's `canvas.json` with React Flow 12: window nodes that hold live iframes, a simple budget of 8, built-in bezier edges. Node scripts drive a headful Chrome through the DevTools protocol (the same method as `tests/run.mjs`) and run the same gestures on the old engine and on the spike. The output is two JSON files, some PNG files, and a report.

**Tech Stack:** React 18.3.1, `@xyflow/react` 12.11.6, Vite 7.3.1 (esbuild JSX, no plugins), Node 26 (built-in `WebSocket`), Google Chrome, `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-09-19-react-flow-canvas-design.md` (section "Phase 0 — the spike gate").

**Scope:** This plan covers phase 0 only. Phase 1 (the migration) gets its own plan after the go/no-go, because the spike's findings change it.

## Global Constraints

- All spike code goes in a git worktree at `/Users/amryadam/Github/design-canvas-lod-wt/spike-react-flow`, on the branch `spike/react-flow` off `main`. The branch is never merged. Do not touch `fix-canvas-layer-limit`, its staged files, or the worktree `react-flow-workspace`.
- Only the report (Task 5) is committed outside the spike branch: on the branch that holds the spec, with a path-limited commit (`git commit -- <path>`), so the staged files there stay staged.
- The old engine is measured as it is on `main`. Do not edit `design-canvas.jsx`, `canvas-page.jsx` or `perf/bench.js`.
- No smart-edge add-on and no custom router: built-in React Flow edges only.
- `onlyRenderVisibleElements` stays off.
- Same conditions for both engines: one machine, one Chrome, viewport 1280 × 800, DPR 2, headful (the GPU must be on — do NOT pass `--headless` or `--disable-gpu`; the blank is a GPU compositor effect).
- Zoom gesture: 90 `ctrl+wheel` ticks, one for each frame, 45 in and 45 out, each tick a factor of e^0.06 (the old engine's factor for `deltaY = 6`). Pan gesture: 60 frames, 40 px for each frame.
- Pass criteria: no blank on the tall page at any zoom step; zoom and pan p95 and worst frame of the spike ≤ 1.10 × the old engine's.
- Commit messages: imperative subject, max 50 characters, no trailing period, no type prefix, no attribution lines.
- Keep the Chrome window visible and in front while a script runs. A hidden window pauses `requestAnimationFrame`.

**User decisions (already made):**
- "A with the spike gate" — React Flow, with the measurement first.
- "no need to @tisoap/react-flow-smart-edge" and "Built-in edges only" — an arrow can cross a window.
- "Today's spec, from zero" — ignore the branch `feature/react-flow-workspace`; do not reuse its code.
- A 10% noise band on the frame-time criteria is approved.
- The last check is the user's: the spike bundle on the real "Users and roles" page in claude.ai/design.

---

## File Structure

All paths are relative to the spike worktree.

| File | Job |
|---|---|
| `spike/package.json`, `spike/vite.config.js`, `spike/.gitignore` | The build |
| `spike/src/budget.js` | The live budget: a pure `pickLive` and a small store |
| `spike/src/main.jsx` | `RFSpike.mount`: nodes, edges, `<ReactFlow>` |
| `spike/index.html` | Runs the spike on `../sample/` (`?page=tall` for the tall page) |
| `spike/host.html` | Runs the spike inside a claude.ai/design project; the build copies it to `dist/spike.html` |
| `spike/tall.js` | `window.spikeTall(sample)`: the synthetic tall page, used by both engines |
| `sample/old-tall.html` | Runs the OLD engine on the tall page |
| `spike/cdp.mjs` | Starts the server and Chrome; `open`, `evaluate`, `until`, `screenshot`, `busy` |
| `spike/smoke.mjs` | Checks that a page rendered |
| `spike/frames.mjs` | The zoom and pan frame bench → `spike/out/frames.json` |
| `spike/tall-check.mjs` | The tall-page pixel check and the sharpness crops → `spike/out/tall.json`, PNGs |

---

### Task 1: Spike worktree, build, and the sample page on React Flow

**Goal:** A built `spike/dist/spike.js` that renders the sample page with React Flow: 11 window nodes, 1 note node, 12 edges, a maximum of 8 live iframes.

**Files:**
- Create: `spike/package.json`, `spike/vite.config.js`, `spike/.gitignore`
- Create: `spike/src/budget.js`, `spike/src/main.jsx`
- Create: `spike/index.html`, `spike/host.html`
- Create: `spike/cdp.mjs`, `spike/smoke.mjs`

**Acceptance Criteria:**
- [ ] `npm run build` in `spike/` exits 0 and writes `spike/dist/spike.js` and `spike/dist/spike.html`.
- [ ] `node spike/smoke.mjs` prints `windows=11 notes=1 edges=12` and an `iframes=` value from 1 to 8, then `SMOKE PASS`.
- [ ] `window.rf` is the React Flow instance (the bench scripts need it).

**Verify:** `cd spike && npm run build && node smoke.mjs` → last line `SMOKE PASS`

**Steps:**

- [ ] **Step 1: Make the worktree**

```bash
cd /Users/amryadam/Github/design-canvas-lod
git worktree add -b spike/react-flow ../design-canvas-lod-wt/spike-react-flow main
cd ../design-canvas-lod-wt/spike-react-flow && mkdir -p spike/src
```

- [ ] **Step 2: Write the build files**

`spike/package.json`:

```json
{
  "name": "rf-spike",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build && cp host.html dist/spike.html"
  },
  "dependencies": {
    "@xyflow/react": "12.11.6",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "vite": "7.3.1"
  }
}
```

`spike/vite.config.js`:

```js
import { defineConfig } from 'vite';

// One IIFE file with React and React Flow inside. The CSS is imported as a
// string (?inline) and injected by mount(), so there is no second file.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/main.jsx', name: 'RFSpike', formats: ['iife'], fileName: () => 'spike.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

`spike/.gitignore`:

```
node_modules/
dist/
out/
.chrome-profile/
```

- [ ] **Step 3: Write the live budget**

`spike/src/budget.js`:

```js
// The spike's live budget. Simple on purpose: no hysteresis, no touch mark,
// no mount gap. Visible windows first, then the nearest to the view middle.
export const BUDGET = 8, SETTLE_MS = 150, MARGIN = 600;

// Pure. viewport = { x, y, zoom }, pane = { w, h }, boxes = [{ id, x, y, w, h }]
// in world px. Returns the ids that are live.
export function pickLive(viewport, pane, boxes, budget = BUDGET) {
  const { x, y, zoom } = viewport;
  const x0 = -x / zoom, y0 = -y / zoom, x1 = x0 + pane.w / zoom, y1 = y0 + pane.h / zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return boxes.map((b) => {
    const ox = Math.max(b.x - x1, 0, x0 - (b.x + b.w)), oy = Math.max(b.y - y1, 0, y0 - (b.y + b.h));
    const mx = Math.max(b.x - cx, 0, cx - (b.x + b.w)), my = Math.max(b.y - cy, 0, cy - (b.y + b.h));
    return { id: b.id, out: Math.hypot(ox, oy) * zoom, mid: Math.hypot(mx, my) };
  }).filter((r) => r.out <= MARGIN)
    .sort((p, q) => ((p.out > 0) - (q.out > 0)) || (p.mid - q.mid))
    .slice(0, budget).map((r) => r.id);
}

let live = new Set(), timer = 0;
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const isLive = (id) => live.has(id);
// `read` returns [viewport, pane, boxes]. The timer restarts on each call, so
// the pass runs SETTLE_MS after the last move and never in a gesture.
export function schedule(read) {
  clearTimeout(timer);
  timer = setTimeout(() => { live = new Set(pickLive(...read())); subs.forEach((f) => f()); }, SETTLE_MS);
}
```

- [ ] **Step 4: Write the canvas**

`spike/src/main.jsx`:

```jsx
import { createRoot } from 'react-dom/client';
import { memo, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { ReactFlow, Background, Handle, Position, MarkerType, useNodesState, useEdgesState } from '@xyflow/react';
import rfCss from '@xyflow/react/dist/style.css?inline';
import { subscribe, isLive, schedule } from './budget.js';

const HEAD = 44;
const SIDES = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };
const CSS = `
.sp-root{width:100%;height:100%;background:#f0eee9}
.sp-win{background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.14);overflow:hidden;font:600 18px/1 system-ui,sans-serif;color:#2b2622}
.sp-head{height:${HEAD}px;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;cursor:grab;white-space:nowrap}
.sp-dot{width:10px;height:10px;border-radius:50%;background:#b9b2a8}.sp-dot.on{background:#2fa36b}
.sp-body{position:relative;content-visibility:auto}
.sp-ph{width:100%;height:100%;display:grid;place-items:center;background:#fff;color:#8a8178;font-size:40px}
.sp-shield{position:absolute;inset:0}
.sp-note{background:#fff3a8;padding:24px;font:400 22px/1.45 system-ui,sans-serif;white-space:pre-wrap;box-sizing:border-box}
.react-flow__handle{opacity:0}
`;

const WindowNode = memo(({ id, data }) => {
  const live = useSyncExternalStore(subscribe, () => isLive(id));
  return (
    <div className="sp-win" style={{ width: data.w, height: data.h + HEAD }}>
      <div className="sp-head"><span className={'sp-dot' + (live ? ' on' : '')} />{data.title}</div>
      <div className="sp-body" style={{ width: data.w, height: data.h }}>
        {live
          ? <iframe src={data.src} title={data.title} style={{ width: data.w, height: data.h, border: 0, display: 'block' }} />
          : <div className="sp-ph">{data.title}</div>}
        <div className="sp-shield" />
      </div>
      {Object.entries(SIDES).flatMap(([k, pos]) => [
        <Handle key={'s' + k} type="source" id={k} position={pos} />,
        <Handle key={'t' + k} type="target" id={k} position={pos} />,
      ])}
    </div>
  );
});
const NoteNode = memo(({ data }) => <div className="sp-note" style={{ width: data.w }}>{data.text}</div>);
const nodeTypes = { window: WindowNode, note: NoteNode };

// canvas.json -> nodes and edges. The screen keeps its x/y; the header sits
// above it, so the node starts HEAD px higher. No variant folding in the spike.
function build(data, page, base) {
  const boards = data.artboards.filter((a) => a.page === page);
  const ids = new Set(boards.map((a) => a.file));
  const nodes = boards.map((a) => ({
    id: a.file, type: 'window', position: { x: a.x, y: a.y - HEAD }, width: a.w, height: a.h + HEAD,
    dragHandle: '.sp-head', data: { w: a.w, h: a.h, title: a.title || a.file, src: base + a.file },
  }));
  (data.annotations || []).filter((n) => n.page === page).forEach((n) => nodes.push({
    id: n.id, type: 'note', position: { x: n.x, y: n.y }, data: { w: Math.min(n.w || 480, 760), text: n.text },
  }));
  const edges = (data.flows || []).filter((f) => f.page === page && ids.has(f.from) && ids.has(f.to) && f.from !== f.to)
    .map((f, i) => ({
      id: 'e' + i, source: f.from, target: f.to, sourceHandle: f.fs || 'r', targetHandle: f.ts || 'l',
      label: f.label, labelStyle: { fontSize: 28 }, markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 6, strokeDasharray: f.dashed ? '18 12' : undefined },
    }));
  return { nodes, edges };
}

function App({ data, page, base }) {
  const init = useMemo(() => build(data, page, base), [data, page, base]);
  const [nodes, , onNodesChange] = useNodesState(init.nodes);
  const [edges] = useEdgesState(init.edges);
  const wrap = useRef(null), rf = useRef(null), boxes = useRef([]);
  boxes.current = nodes.filter((n) => n.type === 'window')
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height }));
  const kick = useCallback(() => schedule(() => [
    rf.current.getViewport(), { w: wrap.current.clientWidth, h: wrap.current.clientHeight }, boxes.current,
  ]), []);
  return (
    <div ref={wrap} className="sp-root">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes}
        minZoom={0.05} maxZoom={4} panOnScroll zoomOnPinch nodesConnectable={false} fitView
        onInit={(inst) => { rf.current = inst; window.rf = inst; kick(); }}
        onMove={kick} onMoveEnd={kick} onNodeDragStop={kick}>
        <Background gap={26} />
      </ReactFlow>
    </div>
  );
}

export function mount(el, { data, page, base = './' }) {
  const style = document.createElement('style');
  style.textContent = rfCss + CSS;
  document.head.appendChild(style);
  createRoot(el).render(<App data={data} page={page} base={base} />);
}
```

- [ ] **Step 5: Write the two pages**

`spike/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>rf spike</title>
<body style="margin:0"><div id="root" style="height:100vh"></div>
<script src="./tall.js"></script>
<script src="./dist/spike.js"></script>
<script>
  const page = new URLSearchParams(location.search).get('page') || 'page-9';
  fetch('../sample/canvas.json').then((r) => r.json()).then((s) => RFSpike.mount(
    document.getElementById('root'),
    { data: page === 'tall' ? window.spikeTall(s) : s, page, base: '../sample/' }));
</script>
```

(`./tall.js` does not exist until Task 2. The 404 is harmless for the sample page.)

`spike/host.html` — for a claude.ai/design project, beside its `canvas.json`:

```html
<!doctype html>
<meta charset="utf-8">
<title>rf spike</title>
<body style="margin:0"><div id="root" style="height:100vh"></div>
<script src="./spike.js"></script>
<script>
  fetch('./canvas.json').then((r) => r.json()).then((d) => RFSpike.mount(
    document.getElementById('root'),
    { data: d, page: new URLSearchParams(location.search).get('page') || d.pages[0].id, base: './' }));
</script>
```

- [ ] **Step 6: Write the Chrome driver**

`spike/cdp.mjs`:

```js
// Starts a static server at the worktree root and a HEADFUL Chrome (the GPU
// must be on), and talks to it through the DevTools protocol. Node 26+.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'spike', 'out');
export const VIEW = { width: 1280, height: 800, dpr: 2 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

export const ENGINES = {
  old: { sample: '/sample/index.html', tall: '/sample/old-tall.html', target: '.design-canvas',
    count: `document.querySelectorAll('[data-dc-slot]').length`, zoom: `window.dcView.scale` },
  new: { sample: '/spike/index.html', tall: '/spike/index.html?page=tall', target: '.react-flow__pane',
    count: `document.querySelectorAll('.react-flow__node-window').length`, zoom: `window.rf.getZoom()` },
};

export async function launch() {
  mkdirSync(outDir, { recursive: true });
  const httpPort = await freePort(), dbgPort = await freePort();
  const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const server = spawn('python3', ['-m', 'http.server', String(httpPort)], { cwd: root, stdio: 'ignore' });
  const chrome = spawn(chromePath, [
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000',
    '--user-data-dir=' + path.join(root, 'spike', '.chrome-profile'),
    '--remote-debugging-port=' + dbgPort, 'about:blank',
  ], { stdio: 'ignore' });
  const stop = (code = 0) => { chrome.kill(); server.kill(); process.exit(code); };

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

  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.error || m.result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(m.error || m.result.exceptionDetails).slice(0, 400));
    return m.result.result.value;
  };
  const until = async (expr, ms = 30000) => {
    for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expr})`)) return; await sleep(100); }
    throw new Error('timeout: ' + expr);
  };
  // `preset` is JS that runs before the page's own scripts. localStorage must
  // be set this way: the old canvas writes its view on pagehide, so a value
  // set on the old document would be overwritten.
  const open = async (urlPath, preset) => {
    let sid;
    if (preset) sid = (await send('Page.addScriptToEvaluateOnNewDocument', { source: preset })).result.identifier;
    await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}${urlPath}` });
    await until(`document.readyState === 'complete'`);
    if (sid) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid });
  };
  const screenshot = async (file, clip) => {
    const m = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(path.join(outDir, file), Buffer.from(m.result.data, 'base64'));
    return m.result.data;
  };
  // Main-thread busy time so far, in ms.
  const busy = async () => (await send('Performance.getMetrics')).result.metrics.find((x) => x.name === 'TaskDuration').value * 1000;

  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.dpr, mobile: false });
  return { send, evaluate, until, open, screenshot, busy, stop };
}
```

- [ ] **Step 7: Write the smoke check**

`spike/smoke.mjs`:

```js
// node spike/smoke.mjs [tall] — did the spike page render?
import { launch, sleep, ENGINES } from './cdp.mjs';

const tall = process.argv[2] === 'tall';
const want = tall ? { windows: 50, notes: 0, edges: 40 } : { windows: 11, notes: 1, edges: 12 };
const c = await launch();
try {
  await c.open(tall ? ENGINES.new.tall : ENGINES.new.sample);
  await c.until(`${ENGINES.new.count} >= ${want.windows} && window.rf`);
  await sleep(2500);
  const got = await c.evaluate(`({
    windows: document.querySelectorAll('.react-flow__node-window').length,
    notes: document.querySelectorAll('.react-flow__node-note').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
    iframes: document.querySelectorAll('iframe').length,
  })`);
  console.log(`windows=${got.windows} notes=${got.notes} edges=${got.edges}`);
  console.log(`iframes=${got.iframes}`);
  const ok = got.windows === want.windows && got.notes === want.notes && got.edges === want.edges && got.iframes >= 1 && got.iframes <= 8;
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  c.stop(ok ? 0 : 1);
} catch (e) { console.error(e); c.stop(2); }
```

- [ ] **Step 8: Build and run the smoke check**

```bash
cd spike && npm install && npm run build && node smoke.mjs
```

Expected: `windows=11 notes=1 edges=12`, `iframes=` from 1 to 8, `SMOKE PASS`. The build prints a `"use client" ... was ignored` warning from React Flow; that is normal.

If `edges=0`: the handles did not match. Check that each window renders a `source` and a `target` handle for each of `l`, `r`, `t`, `b`.

- [ ] **Step 9: Commit**

```bash
git add spike && git commit -m "Add the React Flow spike page"
```

---

### Task 2: The tall page for both engines

**Goal:** One synthetic tall page (50 screens, 12,200 × 16,200 world px) that the old engine and the spike both render from the same data.

**Files:**
- Create: `spike/tall.js`
- Create: `sample/old-tall.html`

**Acceptance Criteria:**
- [ ] `window.spikeTall(sample)` returns 50 artboards whose bounding box is 12,200 × 16,200 px, with 40 flows, on the page id `tall`.
- [ ] `node spike/smoke.mjs tall` prints `windows=50 notes=0 edges=40` and `SMOKE PASS`.
- [ ] `sample/old-tall.html` shows 50 `[data-dc-slot]` elements in the old engine.

**Verify:** `node spike/smoke.mjs tall` → `SMOKE PASS`

**Steps:**

- [ ] **Step 1: Write the generator**

`spike/tall.js` (a classic script, because `sample/old-tall.html` has no bundler):

```js
// The synthetic tall page: 5 columns x 10 rows of 1440x900 screens.
// Width 4*2690+1440 = 12,200. Height 9*1700+900 = 16,200. This is the size of
// the real page whose bottom half blanks today. Each file name is unique
// (?i=N) because both engines key a screen by its file. `variantOf: null`
// stops the old engine from folding the copies into variants.
window.spikeTall = (sample) => {
  const files = sample.artboards.filter((a) => a.w === 1440).map((a) => a.file);
  const artboards = [], flows = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 5; c++) {
    const i = r * 5 + c, src = files[i % files.length];
    artboards.push({ file: `${src}?i=${i}`, x: c * 2690, y: r * 1700, w: 1440, h: 900, title: `T${i} ${src}`, page: 'tall', variantOf: null });
    if (c > 0) flows.push({ page: 'tall', from: artboards[i - 1].file, to: artboards[i].file, label: 'Next', fs: 'r', ts: 'l', dashed: false });
  }
  return { artboards, annotations: [], flows, pages: [{ id: 'tall', name: 'Tall page' }], launch: sample.launch };
};
```

- [ ] **Step 2: Write the old-engine page**

`sample/old-tall.html` (in `sample/`, so the iframe paths `./X.dc.html` resolve):

```html
<!doctype html>
<meta charset="utf-8">
<title>old engine · tall page</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js"></script>
<body style="margin:0"><div id="root"></div>
<script src="../spike/tall.js"></script>
<script type="text/babel" src="../design-canvas.jsx"></script>
<script type="text/babel" src="../canvas-page.jsx"></script>
<script type="text/babel">
  fetch('./canvas.json').then((r) => r.json()).then((s) =>
    ReactDOM.createRoot(document.getElementById('root')).render(<CanvasPage page="tall" data={spikeTall(s)} />));
</script>
```

- [ ] **Step 3: Check both**

```bash
node spike/smoke.mjs tall
```

Expected: `windows=50 notes=0 edges=40`, `SMOKE PASS`.

Then check the old engine by hand: `python3 -m http.server 8000` at the worktree root, open `http://localhost:8000/sample/old-tall.html`, and run `document.querySelectorAll('[data-dc-slot]').length` in the console. Expected: `50`.

- [ ] **Step 4: Commit**

```bash
git add spike/tall.js sample/old-tall.html && git commit -m "Add the tall page for both engines"
```

---

### Task 3: The frame bench

**Goal:** `spike/out/frames.json`: zoom and pan frame times and main-thread busy time, for the old engine and the spike, from the same gestures.

**Files:**
- Create: `spike/frames.mjs`

**Acceptance Criteria:**
- [ ] The zoom factor for each tick is the same in both engines: the script calibrates the spike's `deltaY` from one measured tick, and prints both engines' scale after the 45 zoom-in ticks; the two agree within 3%.
- [ ] `frames.json` holds, for each engine and each gesture (`zoom`, `pan`), the median of 3 runs of: `p50`, `p95`, `max`, `over16`, `busyMs`; and the live iframe count at the start.
- [ ] The script prints `ZOOM PASS|FAIL` and `PAN PASS|FAIL` from the rule: spike `p95` ≤ 1.10 × old `p95` and spike `max` ≤ 1.10 × old `max`.
- [ ] The script exits 3 with a clear message if a synthetic wheel event does not zoom the spike.

**Verify:** `node spike/frames.mjs` → prints a table, `ZOOM …`, `PAN …`, and writes `spike/out/frames.json`

**Steps:**

- [ ] **Step 1: Write the bench**

`spike/frames.mjs`:

```js
// node spike/frames.mjs — the same zoom and pan gestures on both engines.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, outDir } from './cdp.mjs';

const RUNS = 3, OLD_DY = 6, TICK = 0.06; // the old engine zooms by exp(deltaY * 0.01) for each tick

// Injected into each page. One wheel event for each animation frame.
const DRIVER = `(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const wheel = (sel, o) => document.querySelector(sel).dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, ...o }));
  const stats = async (fn) => {
    const times = []; let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await fn(); stop = true;
    const s = times.slice(2).sort((a, b) => a - b), q = (p) => +s[Math.floor(s.length * p)].toFixed(2);
    return { frames: s.length, p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(2), over16: s.filter((f) => f > 16.7).length };
  };
  window.spikeDrive = {
    frame, wheel,
    zoomIn: async (sel, dy, n) => { for (let i = 0; i < n; i++) { wheel(sel, { deltaY: -dy, ctrlKey: true }); await frame(); } },
    zoom: (sel, dy, n = 90) => stats(async () => {
      for (let i = 0; i < n; i++) { wheel(sel, { deltaY: i < n / 2 ? -dy : dy, ctrlKey: true }); await frame(); } }),
    // The fractional deltaY keeps the old engine on its pan branch.
    pan: (sel, n = 60) => stats(async () => {
      for (let i = 0; i < n; i++) { wheel(sel, { deltaX: i < n / 2 ? 40 : -40, deltaY: i % 2 ? 0.5 : -0.5 }); await frame(); } }),
  };
})()`;

// Put the window nodes in the middle of the pane at zoom z (or at the zoom
// that fits them in 90% of the pane when z is null).
const NEW_VIEW = (z) => `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = ${z === null ? 'Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)' : z};
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;

const median = (rows, k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const fold = (rows) => Object.fromEntries(['p50', 'p95', 'max', 'over16', 'busyMs'].map((k) => [k, median(rows, k)]));

const c = await launch();
const out = {};
try {
  for (const name of ['old', 'new']) {
    const E = ENGINES[name];
    await c.open(E.sample, 'try { localStorage.clear(); } catch {}');
    await c.until(`${E.count} >= 10`);
    await sleep(4000);
    await c.evaluate(DRIVER);
    const fit = async () => {
      if (name === 'old') {
        if (!(await c.evaluate('!!window.dcBench'))) await c.evaluate(`fetch('/perf/bench.js').then((r) => r.text()).then((t) => { (0, eval)(t); })`);
        await c.evaluate('dcBench.fit().then(() => 1)');
      } else await c.evaluate(NEW_VIEW(null));
      await sleep(1500);
    };
    const zoomOne = async () => {
      if (name === 'old') await c.evaluate(`window.postMessage({ type: '__dc_set_zoom', scale: 1 }, '*')`);
      else await c.evaluate(NEW_VIEW(1));
      await sleep(1500);
    };

    await fit();
    let dy = OLD_DY;
    if (name === 'new') {
      const z0 = await c.evaluate(E.zoom);
      await c.evaluate(`(async () => { spikeDrive.wheel('${E.target}', { deltaY: -${OLD_DY}, ctrlKey: true }); await spikeDrive.frame(); await spikeDrive.frame(); })()`);
      const ratio = (await c.evaluate(E.zoom)) / z0;
      if (!(ratio > 1.01)) { console.error(`a synthetic ctrl+wheel on ${E.target} did not zoom the spike (ratio ${ratio}). Check the event target.`); c.stop(3); }
      dy = OLD_DY * TICK / Math.log(ratio);
      await fit();
    }
    const liveAtFit = await c.evaluate(`document.querySelectorAll('iframe').length`);

    // The scale after the 45 zoom-in ticks: both engines must agree.
    await c.evaluate(`spikeDrive.zoomIn('${E.target}', ${dy}, 45)`);
    const zoomedIn = await c.evaluate(E.zoom);
    await fit();

    const measure = async (gesture) => {
      const rows = [];
      await c.evaluate(`spikeDrive.${gesture}.then(() => 1)`); await sleep(1200); // warm-up
      for (let i = 0; i < RUNS; i++) {
        const b0 = await c.busy();
        const s = await c.evaluate(`spikeDrive.${gesture}`);
        rows.push({ ...s, busyMs: +((await c.busy()) - b0).toFixed(1) });
        await sleep(1200);
      }
      return fold(rows);
    };
    const zoom = await measure(`zoom('${E.target}', ${dy})`);
    await zoomOne();
    const pan = await measure(`pan('${E.target}')`);
    out[name] = { liveAtFit, deltaY: +dy.toFixed(3), zoomedIn: +zoomedIn.toFixed(4), zoom, pan };
  }

  const agree = Math.abs(out.new.zoomedIn / out.old.zoomedIn - 1) <= 0.03;
  const pass = (g) => out.new[g].p95 <= out.old[g].p95 * 1.1 && out.new[g].max <= out.old[g].max * 1.1;
  out.verdict = { gestureParity: agree, zoom: pass('zoom'), pan: pass('pan') };
  writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(out, null, 2));
  console.table({ 'old zoom': out.old.zoom, 'new zoom': out.new.zoom, 'old pan': out.old.pan, 'new pan': out.new.pan });
  console.log(`live iframes at fit: old=${out.old.liveAtFit} new=${out.new.liveAtFit}`);
  console.log(`scale after zoom-in: old=${out.old.zoomedIn} new=${out.new.zoomedIn} ${agree ? 'PARITY OK' : 'PARITY FAIL'}`);
  console.log('ZOOM ' + (out.verdict.zoom ? 'PASS' : 'FAIL'));
  console.log('PAN ' + (out.verdict.pan ? 'PASS' : 'FAIL'));
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
```

- [ ] **Step 2: Run it**

```bash
node spike/frames.mjs
```

Keep the Chrome window in front until the script ends (about 1 minute). Expected: a table with 4 rows, `PARITY OK`, a `ZOOM` line and a `PAN` line. A `FAIL` verdict is a valid result of the spike, not a defect of the script. `PARITY FAIL` is a defect: the two gestures were not equal, so correct the calibration before you use the numbers.

- [ ] **Step 3: Run it a second time and compare**

Run the script again. If a `p95` differs from the first run by more than 15%, the machine was busy: close other apps and repeat until two runs agree. Keep the last `frames.json`.

- [ ] **Step 4: Commit**

```bash
git add spike/frames.mjs && git commit -m "Add the zoom and pan frame bench"
```

---

### Task 4: The tall-page blank check and the sharpness crops

**Goal:** `spike/out/tall.json`: at 8 zoom steps from 0.1 to 4, is the bottom-right screen of the tall page drawn, in each engine? Plus 4 PNG crops of text at two zoom levels that are not whole numbers.

**Files:**
- Create: `spike/tall-check.mjs`

**Acceptance Criteria:**
- [ ] For each engine and each zoom in `[0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4]`, the script puts the last screen of the tall page in the middle of the viewport, waits for the settle, takes a screenshot (`out/tall-<engine>-<zoom>.png`), and records `drawn`: the fraction of sampled pixels inside the screen's visible rect that differ from the background `#f0eee9` by more than 10 in a channel. `pass` is `drawn >= 0.5`.
- [ ] The script prints `TALL new: PASS|FAIL` and `TALL old (control): BLANK REPRODUCED|NOT REPRODUCED`.
- [ ] The script writes `out/sharp-<engine>-<zoom>.png` for zoom 0.73 and 1.37: a 600 × 200 crop from the top-left of the first screen of the sample page.

**Verify:** `node spike/tall-check.mjs` → prints both `TALL` lines; `ls spike/out/*.png | wc -l` → `20`

**Steps:**

- [ ] **Step 1: Write the check**

`spike/tall-check.mjs`:

```js
// node spike/tall-check.mjs — is the bottom of the tall page drawn at each zoom?
// The old engine is the control: on main it must show the blank. If it does
// not, a screenshot does not see this GPU effect and only the user's check in
// claude.ai/design can answer.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const ZOOMS = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4], SHARP = [0.73, 1.37];
const EL = { old: '[data-dc-slot]', new: '.react-flow__node-window' };
const rectOf = (sel, which) => `(() => { const a = [...document.querySelectorAll('${sel}')]; const r = a[${which === 'last' ? 'a.length - 1' : 0}].getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`;

// Put element `which` of the engine's page at zoom z. anchor 'center' puts its
// middle in the middle of the viewport; 'topleft' puts its corner at 100,100.
async function place(c, name, url, z, which, anchor) {
  const E = ENGINES[name];
  const want = (r) => (anchor === 'center'
    ? { dx: VIEW.width / 2 - (r.l + r.w / 2), dy: VIEW.height / 2 - (r.t + r.h / 2) }
    : { dx: 100 - r.l, dy: 100 - r.t });
  if (name === 'new') {
    if (!(await c.evaluate(`location.pathname + location.search === '${url}' && !!window.rf`))) { await c.open(url); await c.until(`${E.count} >= 10 && window.rf`); }
    // setViewport is applied on the next render, so wait two frames before a rect read.
    const view = (x, y) => c.evaluate(`(async () => { await rf.setViewport({ x: ${x}, y: ${y}, zoom: ${z} }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
    await view(0, 0);
    const d = want(await c.evaluate(rectOf(EL.new, which)));
    await view(d.dx, d.dy);
  } else {
    // The old engine restores its view from localStorage on load, and then
    // skips its first fit. Pass 1 measures at x=0,y=0; pass 2 sets the view.
    const key = 'dc-viewport-v3:' + url;
    const preset = (x, y) => `try { localStorage.setItem(${JSON.stringify(key)}, JSON.stringify({ x: ${x}, y: ${y}, scale: ${z} })); } catch {}`;
    await c.open(url, preset(0, 0)); await c.until(`${E.count} >= 10`); await sleep(500);
    const d = want(await c.evaluate(rectOf(EL.old, which)));
    await c.open(url, preset(d.dx, d.dy)); await c.until(`${E.count} >= 10`);
  }
  await sleep(3000); // the settle, the live pass, and the iframe load
  return c.evaluate(rectOf(EL[name], which));
}

// The fraction of sampled pixels inside rect r (CSS px, clipped to the
// viewport) that are not the background colour.
const DRAWN = (b64, r) => `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
  const k = img.width / innerWidth;
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const x0 = Math.max(0, ${r.l}), y0 = Math.max(0, ${r.t}), x1 = Math.min(innerWidth, ${r.l + r.w}), y1 = Math.min(innerHeight, ${r.t + r.h});
  if (x1 - x0 < 4 || y1 - y0 < 4) return -1;
  const d = g.getImageData(Math.round(x0 * k), Math.round(y0 * k), Math.round((x1 - x0) * k), Math.round((y1 - y0) * k)).data;
  let n = 0, hit = 0;
  for (let i = 0; i < d.length; i += 16) { n++; if (Math.abs(d[i] - 240) > 10 || Math.abs(d[i + 1] - 238) > 10 || Math.abs(d[i + 2] - 233) > 10) hit++; }
  return hit / n;
})()`;

const c = await launch();
const rows = [];
try {
  for (const name of ['old', 'new']) {
    for (const z of ZOOMS) {
      const r = await place(c, name, ENGINES[name].tall, z, 'last', 'center');
      const b64 = await c.screenshot(`tall-${name}-${z}.png`);
      const drawn = +(await c.evaluate(DRAWN(b64, r))).toFixed(3);
      rows.push({ engine: name, zoom: z, drawn, pass: drawn >= 0.5 });
      console.log(`${name} zoom=${z} drawn=${drawn}`);
    }
  }
  for (const name of ['old', 'new']) {
    for (const z of SHARP) {
      await place(c, name, ENGINES[name].sample, z, 'first', 'topleft');
      await c.screenshot(`sharp-${name}-${z}.png`, { x: 100, y: 100, width: 600, height: 200 });
    }
  }
  const ok = (name) => rows.filter((r) => r.engine === name).every((r) => r.pass);
  writeFileSync(path.join(outDir, 'tall.json'), JSON.stringify({ rows, newPass: ok('new'), controlReproduced: !ok('old') }, null, 2));
  console.log('TALL new: ' + (ok('new') ? 'PASS' : 'FAIL'));
  console.log('TALL old (control): ' + (ok('old') ? 'NOT REPRODUCED' : 'BLANK REPRODUCED'));
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
```

- [ ] **Step 2: Run it**

```bash
node spike/tall-check.mjs && ls spike/out/*.png | wc -l
```

Expected: 16 `drawn=` lines, the two `TALL` lines, and `20` PNG files (16 tall + 4 sharp). The run takes about 3 minutes. Keep the Chrome window in front.

- [ ] **Step 3: Look at the pictures**

Read `out/tall-new-4.png`, `out/tall-old-4.png` and the 4 `sharp-*.png` files with the Read tool. Check that each `drawn` number agrees with what the picture shows: a screen in the middle means `drawn` is near 1; only the dotted background means it is near 0. If a number and its picture do not agree, the rect or the colour test is wrong: correct the script before you use the result.

Write down for the report: is the text in `sharp-new-*.png` as sharp as in `sharp-old-*.png`?

- [ ] **Step 4: Commit**

```bash
git add spike/tall-check.mjs && git commit -m "Add the tall-page blank check"
```

---

### Task 5: The spike report

**Goal:** A committed report with the numbers and a go/no-go recommendation.

**Files:**
- Create: `docs/superpowers/specs/2026-09-19-react-flow-spike-report.md` — in the MAIN checkout `/Users/amryadam/Github/design-canvas-lod`, not in the spike worktree.

**Acceptance Criteria:**
- [ ] The report gives the machine, the Chrome version, the viewport and DPR, and the spike commit hash.
- [ ] It holds the zoom and pan table (old and new: `p50`, `p95`, `max`, `over16`, `busyMs`), the live iframe counts, the gesture parity line, and the two verdicts, copied from `spike/out/frames.json`.
- [ ] It holds the tall-page table (engine × zoom → `drawn`), `TALL new`, and whether the control reproduced the blank, copied from `spike/out/tall.json`.
- [ ] It gives the text sharpness finding from Task 4 Step 3, with a workaround if the spike's text is less sharp.
- [ ] It lists the limits of the spike: 11 nodes against the old engine's 10 slots (no variant folding), no hysteresis or mount gap in the budget, synthetic wheel events, a synthetic tall page.
- [ ] It ends with one line: `Recommendation: GO`, `Recommendation: NO-GO`, or `Recommendation: USER CHECK DECIDES`, from the rule in Step 2.
- [ ] The commit holds only the report; `git status --short` in the main checkout still shows the two staged files.

**Verify:** `cd /Users/amryadam/Github/design-canvas-lod && git log -1 --name-only --format=%s` → the subject and exactly one file, the report

**Steps:**

- [ ] **Step 1: Collect the facts**

```bash
cd /Users/amryadam/Github/design-canvas-lod-wt/spike-react-flow
git rev-parse --short HEAD
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version
sysctl -n machdep.cpu.brand_string
cat spike/out/frames.json spike/out/tall.json
```

- [ ] **Step 2: Apply the rule**

| Condition | Recommendation |
|---|---|
| `TALL new` is FAIL | NO-GO |
| `TALL new` is PASS, and ZOOM and PAN are PASS, and the control reproduced the blank | GO |
| `TALL new` is PASS, and ZOOM and PAN are PASS, and the control did NOT reproduce the blank | USER CHECK DECIDES (the screenshot cannot see the effect; the frame times pass) |
| ZOOM or PAN is FAIL | NO-GO, with the size of the gap; say if the gap is inside one gesture only |

- [ ] **Step 3: Write the report**

Sections, in this order: `## Conditions`, `## Frame times`, `## Tall page`, `## Text sharpness`, `## Limits of the spike`, `## Recommendation`. Copy the numbers; do not round them again. Write in Simplified Technical English, as the spec does.

- [ ] **Step 4: Commit only the report**

```bash
cd /Users/amryadam/Github/design-canvas-lod
git add docs/superpowers/specs/2026-09-19-react-flow-spike-report.md
git commit -m "Record the React Flow spike results" -- docs/superpowers/specs/2026-09-19-react-flow-spike-report.md
git status --short
```

Expected `git status --short`: `M  design-canvas.jsx` and `A  docs/superpowers/plans/2026-09-09-canvas-layer-limit.md`, still staged.

---

### Task 6: The user's check in claude.ai/design, and the go/no-go

**Goal:** The user loads the spike bundle on the real "Users and roles" page in claude.ai/design, zooms from the fit to the maximum, and says whether the bottom of the page blanks; then the user gives the go/no-go.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Read: `spike/dist/spike.js`, `spike/dist/spike.html` (the user copies both into the claude.ai/design project, beside its `canvas.json`)
- Modify: `docs/superpowers/specs/2026-09-19-react-flow-spike-report.md` — add `## User check`

**Acceptance Criteria:**
- [ ] The user has opened `spike.html?page=<the id of "Users and roles">` in claude.ai/design and has answered, in the conversation: does the bottom of the page blank or flicker at any zoom from the fit to 4? (yes / no)
- [ ] The user has answered: does pan and zoom feel as smooth as the current canvas? (yes / no / worse where)
- [ ] The user has said GO or NO-GO in the conversation.
- [ ] The report has a `## User check` section with the three answers, quoted, and the date. It is committed with a path-limited commit.

**Verify:** `grep -A6 '^## User check' docs/superpowers/specs/2026-09-19-react-flow-spike-report.md` → shows the three quoted answers

**Steps:**

- [ ] **Step 1: Give the user the files and the steps**

Tell the user:
1. Copy `design-canvas-lod-wt/spike-react-flow/spike/dist/spike.js` and `spike.html` into the claude.ai/design project, beside `canvas.json`.
2. Find the page id of "Users and roles" in the project's `canvas.json` (`pages[].id`).
3. Open `spike.html?page=<id>`.
4. Zoom in from the fit to the maximum with a pinch, and pan to the bottom of the page. Do this two times.
5. Answer the three questions above.

- [ ] **Step 2: Stop and wait for the answers.** Do not start phase 1. Do not guess the answers from the Task 5 numbers.

- [ ] **Step 3: Record the answers**

Add `## User check` to the report with the date and the three answers as quotes. Commit:

```bash
cd /Users/amryadam/Github/design-canvas-lod
git commit -m "Record the user's spike check" -- docs/superpowers/specs/2026-09-19-react-flow-spike-report.md
```

- [ ] **Step 4: Next step**

- GO: write the phase 1 plan with the writing-plans skill, from the spec and the report.
- NO-GO: go to the fallback in the spec — finish `docs/superpowers/plans/2026-09-09-canvas-layer-limit.md` on `fix-canvas-layer-limit`.
- In both cases ask the user if the spike worktree and branch can be removed. Do not remove them without a yes.
