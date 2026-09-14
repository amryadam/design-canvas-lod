# React Flow Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom renderer with a shared screen-review and journey-editing workspace for standalone hosting and Claude.

**Architecture:** A versioned domain model combines authored canvas data with user overrides and projects it into React Flow. Screen nodes display generated images and activate one HTML iframe on demand. Host adapters isolate loading, saving, and host messages from the workspace.

**Tech Stack:** React, TypeScript, @xyflow/react, Vite, Vitest, Playwright, Node.js. Resolve compatible maintained versions during Task 1, record runtime requirements, and commit the lockfile; do not guess package versions from this document.

**Spec:** `docs/superpowers/specs/2026-09-14-react-flow-workspace-design.md`

## Global Constraints

- The first version supports 100 primary screens, excluding variants, in both a standalone web application and claude.ai/design.
- At most one screen is live at a time.
- React Flow node and edge data is derived from the domain model. Its internal serialization is not the persisted domain contract.
- A local browser result cannot establish Claude compatibility.
- Reset layout removes position overrides without deleting journey edits.
- Promotion to main requires a separate explicit request.
- Worktree: `/Users/amryadam/Github/design-canvas-lod-wt/react-flow-workspace`; branch: `feature/react-flow-workspace`, originally based on `dev` at `cd57124`.
- Preserve the original checkout's staged changes. Do not import unrelated post-dev renderer fixes into this independent feature.
- No obstacle routing, collaboration, extra drawing tools, or per-screen export work in this release.

## Current repository and proposed files

The current sample loads React 18 and Babel from CDNs and executes `design-canvas.jsx` and `canvas-page.jsx` as browser scripts. `sample/canvas.json` uses filenames for artboards and connection endpoints. The integration baseline contains `tests/regressions.html` and `tests/regressions.js`, not an npm application or `tests/run.mjs`.

Keep the legacy files available during migration. Introduce these focused units:

| Paths | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore` | Build and validation commands |
| `src/domain/model.ts`, `validate.ts`, `migrate.ts`, `reconcile.ts`, `commands.ts` | Persistent contract and pure edits |
| `src/hosts/types.ts`, `standalone.ts`, `claude.ts`, `zoom-bridge.ts` | Host capabilities and file/message integration |
| `src/persistence/session.ts` | Restore, revisions, local/file writes |
| `src/previews/manifest.ts`, `PreviewImage.tsx`, `ActivePreview.tsx`, `preview-bridge.ts` | Snapshot and live-document lifecycle |
| `src/workspace/Workspace.tsx`, `project.ts`, `ScreenNode.tsx`, `NoteNode.tsx`, `JourneyInspector.tsx`, `Toolbar.tsx`, `workspace.css` | React Flow UI |
| `src/main.tsx`, `src/embed.tsx`, `index.html` | Standalone and bundled embed entry points |
| `scripts/migrate-canvas.ts`, `capture-previews.ts`, `package-workspace.ts`, `make-perf-fixture.ts` | Data conversion, capture, distribution, benchmark data |
| `tests/unit/`, `tests/e2e/`, `tests/fixtures/workspace/` | Domain and browser proof |
| `docs/test-runs/react-flow-host-check.md`, `react-flow-acceptance.md`, `docs/react-flow-workspace.md` | Environment evidence and operation instructions |

Tasks are sequential. Each task specifies its own commit boundary; use `git add` with its listed paths, never indiscriminately stage unrelated files. Red/green checks apply to behavior changes, not documentation or scaffolding in isolation.

## Task 1: Establish a runnable React Flow bundle and verify host feasibility

**Files:** Create build/config/entry files above, `tests/fixtures/workspace/probe.html`, `tests/e2e/host-probe.spec.ts`, `docs/test-runs/react-flow-host-check.md`. Modify `.gitignore`.

**Interfaces:** `mountWorkspace(element: HTMLElement, options: { baseUrl: string; host: 'standalone' | 'claude' }): () => void` is the public embed export; its return value unmounts. The initial probe implements this export with two disposable nodes; subsequent tasks replace probe content with the workspace.

- [ ] Inspect `node --version`, `npm --version`, and dependency engine/peer requirements using `npm view`. Install compatible React, React DOM, @xyflow/react and the named build/test tools. Keep existing `flow-layout.js` runnable: do not change root package module mode without checking its CommonJS usage; use `tsx` for TypeScript scripts.
- [ ] Add scripts `dev` (Vite), `build` (typecheck then Vite app and library builds), `test:unit` (Vitest run), and `test:e2e` (Playwright test). Configure relative asset base and an IIFE library bundle exposing `DesignWorkspace.mountWorkspace`, with React bundled once in that artifact. Give app and embed outputs separate directories so one build cannot erase the other. Ignore dependencies, build output, generated test artifacts, and captures.
- [ ] Add a browser test proving the loaded bundle renders custom HTML nodes and mounts no iframe initially:

```ts
import { test, expect } from '@playwright/test';
test('host probe boots with snapshots', async ({ page }) => {
  await page.goto('/tests/fixtures/workspace/probe.html');
  await expect(page.getByTestId('probe-screen')).toHaveCount(2);
  await expect(page.locator('iframe[data-live-screen]')).toHaveCount(0);
});
```

- [ ] Run `npm run test:e2e -- tests/e2e/host-probe.spec.ts`; verify the missing entry/probe fails the assertion. Add the minimal two-node renderer and rerun to green. A custom probe node contains a labeled image, Activate button, and conditional iframe; import React Flow's CSS and give its parent an explicit height.
- [ ] Build the distributable and load the exact bundle in a local parent iframe and the real Claude project. Record bundle/style/image resolution, HTML iframe loading, focus and Escape behavior, baseline fetch, and a write/read round-trip to a uniquely named probe override file through the host's available API. Do not overwrite existing state. Remove only the probe file if supported.
- [ ] Check the existing `window.omelette?.writeFile` integration against actual host behavior; record whether writes persist across reopening. Test the existing `__dc_probe`, `__dc_present`, `__dc_set_zoom`, and `__dc_zoom` protocol if Claude uses it. Probe results must include environment, artifact revision, actions, and observations; simulated host results get a separate label.
- [ ] If real host access is unavailable, record the exact blocker and continue independent domain and capture tasks. Do not claim Claude support or finalize dependent adapter behavior without evidence. If a host capability contradicts the approved design, request a concrete design decision.
- [ ] Commit: `build: establish React Flow bundle and host compatibility probe`.

## Task 2: Define stable authored data and migrate the existing sample

**Files:** Create `src/domain/model.ts`, `validate.ts`, `migrate.ts`, `scripts/migrate-canvas.ts`, `tests/unit/migrate.test.ts`, `tests/fixtures/workspace/canvas.json`.

**Interfaces:** `parseBaseline(input: unknown): Baseline`; `migrateLegacy(input: unknown, workspaceId: string): Baseline`. CLI accepts `--input`, `--output`, `--workspace-id`; it never overwrites input by default.

- [ ] Define the shared types below; consumers use these names and fields:

```ts
export type Side = 'l' | 'r' | 't' | 'b';
export type Point = { x: number; y: number };
export type Variant = { id: string; file: string; label: string; width: number; height: number };
export type Screen = { id: string; pageId: string; title: string; position: Point; defaultVariantId: string; variants: Variant[] };
export type Note = { id: string; pageId: string; text: string; width: number; position: Point };
export type Journey = { id: string; pageId: string; source: string; target: string; sourceSide: Side; targetSide: Side; label: string; dashed: boolean };
export type Baseline = { version: 1; workspaceId: string; pages: { id: string; name: string }[]; screens: Screen[]; notes: Note[]; journeys: Journey[] };
export type ScreenPatch = { position?: Point; variantId?: string; deleted?: boolean };
export type NotePatch = Partial<Omit<Note, 'id'>> & { deleted?: boolean };
export type JourneyPatch = Partial<Omit<Journey, 'id'>> & { deleted?: boolean };
export type Overrides = { version: 1; workspaceId: string; revision: number; screens: Record<string, ScreenPatch>; notes: Record<string, NotePatch>; journeys: Record<string, JourneyPatch>; addedNotes: Note[]; addedJourneys: Journey[] };
export type Resolved = { screens: (Screen & { variantId: string })[]; notes: Note[]; journeys: Journey[] };
```

- [ ] Add a test importing legacy sample JSON, invoking migration twice, and asserting equality, unique IDs, nonempty variants, and resolvable journey endpoints. Assert duplicate IDs, invalid dimensions/coordinates, unknown pages, and invalid default variants are rejected by `parseBaseline`.

```ts
const first = migrateLegacy(legacy, 'sample-invoices');
expect(migrateLegacy(legacy, 'sample-invoices')).toEqual(first);
expect(new Set(first.screens.map(s => s.id)).size).toBe(first.screens.length);
expect(first.journeys.every(e => first.screens.some(s => s.id === e.source))).toBe(true);
```

- [ ] Run `npm run test:unit -- tests/unit/migrate.test.ts` and confirm failure before implementing migration.
- [ ] Implement explicit schema validation with errors identifying the JSON path. Preserve pages, positions, note text/width, labels, dashed edges, and anchor sides. Adapt existing variant inference into a pure migration function, respecting explicit `variantOf`; map variant endpoints to their primary screen. Generate deterministic initial IDs from page plus original identity and disambiguate duplicate legacy edges. Preserve supplied IDs. Persist IDs in the output so future renames modify `file`, not `id`.
- [ ] Rerun tests and run `npx tsx scripts/migrate-canvas.ts --input sample/canvas.json --output tests/fixtures/workspace/canvas.json --workspace-id sample-invoices`; review converted sample counts and variant grouping. No automatic import of legacy browser state: retain its storage keys and document the new workspace namespace.
- [ ] Commit: `feat: define stable canvas data and legacy migration`.

## Task 3: Produce verified snapshot assets

**Files:** Create `src/previews/manifest.ts`, `scripts/capture-previews.ts`, `tests/e2e/capture.spec.ts`, capture HTML fixtures under `tests/fixtures/workspace/`.

**Interfaces:** `PreviewManifest = { version: 1; workspaceId: string; revision: string; entries: Record<string, { src: string; width: number; height: number; revision: string }> }`; entries keyed by variant ID. CLI: `npx tsx scripts/capture-previews.ts --canvas <file> --root <assets-dir> --out <output-dir>`. Returns nonzero if any capture fails.

- [ ] Add a capture fixture with a colored rectangle, delayed font/image readiness, a phone variant, and a missing HTML path. Test generated dimensions and visible pixels, and that failed generation never publishes a successful manifest containing the failed variant.
- [ ] Run `npm run test:e2e -- tests/e2e/capture.spec.ts`; confirm failure because the command is not implemented.
- [ ] Implement a loopback-only static server rooted at the asset directory and capture sequentially with Playwright. Reject paths outside that root. Set viewport to authored width/height and device scale to one. Await load, fonts, and image decoding, bounded by a 15-second per-screen deadline. Capture the authored viewport, not `fullPage`, to retain node dimensions:

```ts
await page.setViewportSize({ width: variant.width, height: variant.height });
await page.goto(documentUrl, { waitUntil: 'load', timeout: 15000 });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.decode()));
});
await page.screenshot({ path: outputFile, fullPage: false, animations: 'disabled' });
```

- [ ] Enforce the deadline around the complete readiness/capture operation, not only navigation. Track required resource failures. Capture into a temporary output directory and publish only after all variants succeed. Revision hashes include local input assets and capture settings; always recapture external assets, with external-content freshness limited to capture time. Copy required HTML assets as part of packaging in Task 8.
- [ ] Rerun the test; inspect desktop and phone screenshots. Generate the real sample previews and record output size and capture errors. Shut down the temporary server/browser in `finally`.
- [ ] Commit: `feat: generate manifest-backed screen snapshots`.

## Task 4: Implement reconciliation and editing commands

**Files:** Create `src/domain/reconcile.ts`, `commands.ts`, `tests/unit/reconcile.test.ts`, `commands.test.ts`. Extend `validate.ts` with `parseOverrides(input: unknown, workspaceId: string): Overrides`.

**Interfaces:** `emptyOverrides(workspaceId: string): Overrides`; `reconcile(base: Baseline, edits: Overrides): Resolved`; `applyCommand(base: Baseline, edits: Overrides, command: Command): Overrides`. Commands are the following discriminated union; callers provide IDs for additions:

```ts
export type Command =
 | { type: 'move'; kind: 'screen' | 'note'; id: string; position: Point }
 | { type: 'variant'; id: string; variantId: string }
 | { type: 'add-note'; note: Note }
 | { type: 'edit-note'; id: string; text: string }
 | { type: 'add-journey'; journey: Journey }
 | { type: 'edit-journey'; id: string; patch: JourneyPatch }
 | { type: 'delete'; kind: 'screen' | 'note' | 'journey'; id: string }
 | { type: 'reset-item'; kind: 'screen' | 'note' | 'journey'; id: string }
 | { type: 'reset-layout' }
 | { type: 'clear-all' };
```

- [ ] Write red tests for source renames with stable IDs, removal/reappearance, tombstones, hidden dangling connections, additions, and fallback when a selected variant disappears. Use the migrated sample fixture as `base`:

```ts
const id = base.screens[0].id;
const edited = applyCommand(base, emptyOverrides(base.workspaceId),
  { type: 'move', kind: 'screen', id, position: { x: 12, y: 34 } });
const renamed = structuredClone(base);
renamed.screens[0].variants[0].file = 'renamed.html';
expect(reconcile(renamed, edited).screens.find(s => s.id === id)?.position)
  .toEqual({ x: 12, y: 34 });
expect(reconcile({ ...base, screens: [] }, edited).journeys).toEqual([]);
```

- [ ] Run `npm run test:unit -- tests/unit/reconcile.test.ts tests/unit/commands.test.ts` and observe missing behavior.
- [ ] Apply patches by ID without mutating baseline or overrides. Keep orphaned patches in storage, filter only the derived view. Resolve available default variant if an override references a removed variant, retaining the old patch. Reject cross-page connection edits and invalid endpoints. Keep stable journey IDs on reconnection. Deleting added items removes additions; deleting baseline items sets tombstones. A missing endpoint hides rather than destroys its connection.
- [ ] Implement reset semantics. Reset layout removes authored position patches; user-added notes keep their creation position as they have no authored placement. Store their creation records unchanged in addedNotes and route subsequent moves/text edits through notes patches, so reset-layout removes those position patches consistently. Reset added item deletes it. Clear all returns `emptyOverrides`. Session persistence, not pure domain commands, assigns revisions.
- [ ] Add malformed-import tests: version mismatch, foreign workspace, duplicate added IDs, invalid sides, nonfinite values. Validate before accepting any replacement. Rerun all Task 4 tests.
- [ ] Commit: `feat: reconcile canvas overrides and journey edits`.

## Task 5: Restore and save through explicit host adapters

**Files:** Create `src/hosts/types.ts`, `standalone.ts`, `claude.ts`, `src/persistence/session.ts`, `tests/unit/session.test.ts`.

**Interfaces:**

```ts
export interface HostAdapter {
  resolveAsset(path: string): string;
  readBaseline(signal: AbortSignal): Promise<unknown>;
  readManifest(signal: AbortSignal): Promise<unknown>;
  readOverrides(signal: AbortSignal): Promise<unknown | null>;
  writeOverrides?: (document: Overrides) => Promise<void>;
}
export type SaveStatus = { local: 'saved' | 'failed'; file: 'unavailable' | 'pending' | 'saved' | 'failed' };
// Session created per workspace; consumers subscribe, never read a global singleton.
export interface Session {
  read(): { baseline: Baseline; overrides: Overrides; resolved: Resolved; status: SaveStatus };
  subscribe(listener: () => void): () => void;
  dispatch(command: Command): void;
  importOverrides(input: unknown): void;
  exportOverrides(): string;
  retrySave(): void;
  dispose(): void;
}
// Restore includes baseline validation; manifest is independently loaded by preview UI.
export declare function restoreSession(host: HostAdapter, storage: Storage, signal: AbortSignal): Promise<Session>;
```

- [ ] Add red tests with fake storage and deferred host promises: browser revision newer, file newer, tie goes to browser, 1500ms override-read timeout, invalid file fallback, no late overwrite, workspace isolation, rejected browser writes, host write ordering, import rejection preserving state.

```ts
const session = await restoreSession(host, storage, new AbortController().signal);
const before = session.exportOverrides();
expect(() => session.importOverrides({ version: 99 })).toThrow();
expect(session.exportOverrides()).toBe(before);
```

- [ ] Run `npm run test:unit -- tests/unit/session.test.ts` to establish red, then implement restore and revision selection. Use key `rf-workspace:v1:<workspaceId>`; local revision increments with `Math.max(Date.now(), previousRevision + 1)`. Timed-out reads must not later replace edited state. Baseline failures block entry with retry; override failures may fall back and must be reported.
- [ ] Write local state synchronously after each committed edit. Debounce file writes by 400ms and serialize them so older writes cannot complete after newer writes. Save clear/reset as a new revision, avoiding resurrection from a stale file. Expose each save channel's status and retry. Abort subscriptions and pending reads when changing workspace; catch in-flight write errors after disposal without updating another session.
- [ ] Standalone reads relative files, reports file writes unavailable, and uses import/export. Claude uses only the file API verified in Task 1; absent capability is explicit. If file reads/writes cannot support the approved experience, report the limitation before claiming that adapter finished.
- [ ] Rerun tests with fake timers and verify one browser reload manually after a layout edit once Task 6 is connected.
- [ ] Commit: `feat: persist workspace edits through host adapters`.

## Task 6: Build snapshot-first screen review and live activation

**Files:** Create `src/workspace/Workspace.tsx`, `project.ts`, `ScreenNode.tsx`, `workspace.css`, `src/previews/PreviewImage.tsx`, `ActivePreview.tsx`, `preview-bridge.ts`, `tests/e2e/screens.spec.ts`. Update both entry points to mount real workspace content.

**Interfaces:** `project(resolved: Resolved, pageId: string): { nodes: Node[]; edges: Edge[] }`; `Workspace({ host }: { host: HostAdapter })`; `ScreenNode` receives resolved screen data and reads stable interaction callbacks through workspace context. Activation uses one `activeScreenId: string | null`. Preview bridge message: `{ type: 'rf-preview:escape', token: string }`.

- [ ] Add red browser checks using migrated fixture: restore before fit, zero live iframes at boot/pan/zoom, changed variant dimensions, and activate/deactivate in place:

```ts
await page.goto('/?fixture=workspace');
await expect(page.locator('iframe[data-live-screen]')).toHaveCount(0);
await page.getByRole('button', { name: 'Activate screen' }).first().click();
await expect(page.locator('iframe[data-live-screen]')).toHaveCount(1);
await page.getByRole('button', { name: 'Return to preview' }).click();
await expect(page.locator('iframe[data-live-screen]')).toHaveCount(0);
```

- [ ] Run `npm run test:e2e -- tests/e2e/screens.spec.ts` to red. Implement memoized custom screen nodes, page selection, Background, Controls, and a fit after restoration and node measurement. Keep authored x/y as node positions; define screen header/body geometry consistently. Use a header drag handle and `nodrag nopan nowheel` for interactive controls. Dimension changes call React Flow's node-internals update.
- [ ] Implement generated image loading with reserved dimensions, missing-image placeholder and stale-manifest indicator. Start with native lazy loading and asynchronous decoding; Task 9 measures whether explicit viewport image unloading is required. Do not use screen iframes as image fallbacks.
- [ ] Activate only from an explicit button/double-click action, never from pan/zoom. Outside pointer activation closes the current preview; clicking another activation control switches directly. Variant switching within the active screen preserves active status. Returning focus goes to its activation button. When a page switch or screen removal hides the active screen, deactivate it.
- [ ] Implement Escape at the parent and in controlled packaged HTML via the bridge. Validate `event.source === activeIframe.contentWindow` and token, and use verified origins where available. Bridge injection happens to packaged copies only in Task 8; fixture includes it now. Test keyboard input inside the iframe, then Escape. Keep an always-reachable Return to preview control and Retry for observable load failures; do not treat iframe `load` as proof of successful content rendering.
- [ ] Rerun tests for outside click, another screen activation, variant switching while active, missing image, failed live load, and no iframe mount churn during snapshot-only gestures. Review desktop, narrow viewport, and keyboard navigation visually.
- [ ] Commit: `feat: add snapshot-first screen review and live activation`.

## Task 7: Implement journey editing, notes, and reset controls

**Files:** Create `src/workspace/NoteNode.tsx`, `JourneyInspector.tsx`, `Toolbar.tsx`, `tests/e2e/journeys.spec.ts`; modify `Workspace.tsx`, `project.ts`, `ScreenNode.tsx`.

**Interfaces:** UI actions call `session.dispatch(Command)` from Task 4. Four handle IDs are Side values. Use loose connection mode with one source-type handle per side, verifying the installed React Flow version allows either endpoint. Edge IDs are domain journey IDs.

- [ ] Add red tests for header drag/reload, creating a connection, selecting/editing its label, reconnection preserving ID, deletion/reload, variant change preserving connections, adding/editing/moving a note, and all three reset actions. Seed connection fixtures through baseline data; use real mouse gestures for connection creation and reconnection.
- [ ] Run `npm run test:e2e -- tests/e2e/journeys.spec.ts`. Implement position updates as transient UI state while dragging and commit a `move` command on drag stop. Convert onConnect to `add-journey` using `crypto.randomUUID()`; onReconnect emits `edit-journey` with endpoints and sides, preserving domain ID. Derive standard smooth-step edges, arrows, label, and dashed style.
- [ ] Add edge inspector and note editor with labeled controls. Dispatch domain commands, avoiding direct React Flow state serialization. Entering text must not trigger canvas Delete shortcuts. Add note at viewport center converted to world coordinates; use an initial width of 320 world pixels.
- [ ] Wire reset selected, reset layout, and clear all. Clearly explain the scope before clear-all using an in-product confirmation, not an agent approval. Import validates before applying; export downloads the current override JSON. Show file/local save statuses and retry in toolbar without exposing implementation jargon to users.
- [ ] Rerun journey tests and Task 6 screen checks. Verify all four sides, return/loop flows between distinct nodes, self-connection behavior under domain validation, and RTL note text. Specify self-connections as allowed within a page, using the standard path; do not silently discard newly authored connections.
- [ ] Commit: `feat: edit journeys notes and workspace overrides`.

## Task 8: Package both entry points and integrate Claude host messages

**Files:** Create `scripts/package-workspace.ts`, `src/hosts/zoom-bridge.ts`, `tests/e2e/package.spec.ts`, `tests/e2e/host-messages.spec.ts`, `docs/react-flow-workspace.md`; modify `src/embed.tsx`, build scripts, and `README.md`.

**Interfaces:** CLI `npx tsx scripts/package-workspace.ts --canvas <file> --root <assets-dir> --previews <generated-dir> --out <distribution-dir>` emits `index.html`, `workspace.js`, `workspace.css`, `canvas.json`, `previews/`, and `screens/`. `installZoomBridge(parent: Window, controls: { getZoom(): number; setZoom(scale: number): void; subscribeSettled(fn: () => void): () => void }): () => void` adapts the verified host protocol.

- [ ] Add red packaged-asset tests serving a temporary output directory under a nested URL. Assert no requests depend on the repository or Vite development server. Verify desktop/phone snapshots, live relative CSS/font/image paths, and refresh restore there.
- [ ] Run `npm run test:e2e -- tests/e2e/package.spec.ts tests/e2e/host-messages.spec.ts`. Implement packaging with Node filesystem APIs, preserving source-relative directories under `screens/`, rewriting baseline variant paths accordingly, and adding the keyboard bridge only to packaged HTML. Copy all required local assets, excluding build/state output, and reject root escapes. Keep source originals unchanged.
- [ ] Build standalone and embed artifacts from the same components. Read the baseline workspace ID; never infer identity from deployment URL. Mount with the correct adapter from explicit options, avoiding unreliable hostname-based detection. Verify cleanup on repeated mount/unmount.
- [ ] If Task 1 confirms the zoom protocol is needed, implement parent-source validation, finite clamped incoming scale, center anchoring through React Flow viewport APIs, probe response, and settled zoom notifications without echo loops. Top-level standalone posts no host messages. Test teardown and duplicate-mount behavior.
- [ ] Rerun packaged browser tests. Use the real Claude environment to repeat snapshot, live activation including Escape, asset loading, save/reopen, and host zoom workflows with the production artifact. Record unsupported capabilities rather than silently replacing file persistence with a fake implementation.
- [ ] Document exact migrate, capture, build, package, serve, copy-to-Claude, import/export, and rollback commands. Explain stable IDs, regeneration after HTML changes, external snapshot freshness, local-only save status, and retention of legacy data. Change README's primary entry instructions to the new workspace only after it works.
- [ ] Commit: `feat: distribute the workspace for standalone and Claude`.

## Task 9: Verify 100-screen behavior and deliver the feature

**Files:** Create `scripts/make-perf-fixture.ts`, `tests/e2e/performance.spec.ts`, `docs/test-runs/react-flow-acceptance.md`. Modify performance-sensitive components only in response to measured failures.

**Interfaces:** `npx tsx scripts/make-perf-fixture.ts --count 100 --out <directory>` emits deterministic Baseline data and local HTML assets. Include multiple variants, 1440px desktop and 390px phone screens, long authored heights, notes, and branching journeys. Repeat at 25 screens.

- [ ] Generate both fixtures and capture previews with Task 3 tooling. Run the production bundle, not only Vite dev mode. Record hardware, browser, artifact commit, image bytes/dimensions, readiness time, activation latency, and p50/p95/max animation-frame intervals during a repeatable 10-second pan/zoom gesture. Memory measurements must identify the API used and whether they include decoded images/GPU memory; unavailable metrics are explicitly unavailable.
- [ ] Add a browser guard for zero live screen iframe mounts during snapshot navigation, using a MutationObserver to catch transient mounts, not just the final count. During activation assert a maximum of one live screen. Record visual blanking/flicker with screenshots or a recording; frame timing alone does not prove absence.
- [ ] Measure repeated pan-away/pan-back and activation cycles for memory growth and loading stalls. If necessary, unload distant image sources while keeping fixed-size node shells and low-resolution thumbnails; pin the active node so viewport optimization cannot break interaction. Compare measurements before/after each targeted optimization. Do not turn on node virtualization without verifying connectors and live activation.
- [ ] Run the full new suite once after changes settle:

```bash
npm run test:unit
npm run build
npm run test:e2e
```

- [ ] Run legacy regression HTML in a real browser if legacy files remain shipped, awaiting `window.canvasTestsDone`; preserve its result separately from new workspace acceptance. The new behavior intentionally replaces old LOD/routing internals, so translate their user-facing failure cases into new checks rather than requiring removed implementation hooks.
- [ ] Complete the spec acceptance matrix in both standalone and Claude: review, journeys, notes, save/reload, resets, source reconciliation, all listed failures, focus, and 25/100-screen measurements. Include test command output, artifact revision, screenshots/recordings, and any host blocker. No feature-complete claim while required Claude evidence is absent. No arbitrary FPS pass threshold is invented; report the measured envelope and any observed input stalls or flicker as unresolved failures.
- [ ] Commit verified adjustments and evidence: `test: verify React Flow workspace acceptance`.
- [ ] Inspect feature diff, check clean feature and integration worktrees, and check whether dev advanced. If it did, integrate dev into the feature branch and rerun checks affected by the integration. Never discard unrelated integration-worktree changes.
- [ ] After all required acceptance passes, merge from the existing dev worktree and preserve the feature branch:

```bash
git -C /Users/amryadam/Github/design-canvas-lod-wt/dev merge --no-ff feature/react-flow-workspace -m "Merge branch 'feature/react-flow-workspace' into dev"
git -C /Users/amryadam/Github/design-canvas-lod-wt/dev log -1 --format='%H %P %s'
```

- [ ] Confirm the merge has dev as first parent and the feature tip as second parent. Report merge SHA and separate standalone/Claude results. Do not promote to main or delete the feature branch.

## Plan self-review and coverage

- Purpose and shared architecture: Tasks 1, 6, 8.
- Stable identities, migration, reconciliation, tombstones and resets: Tasks 2, 4, 5, 7.
- Snapshot generation, dimensions, revision manifest and failures: Tasks 3, 6, 8.
- Navigation, variant review, live iframe lifecycle and keyboard boundaries: Tasks 1, 6, 9.
- Journey editing, four sides, notes and persistence: Tasks 4, 5, 7.
- Host capabilities, source/file errors, save ordering and import/export: Tasks 1, 5, 7, 8.
- Performance target and real environment acceptance: Task 9; local evidence never substitutes for Claude.
- Git delivery and legacy preservation: Tasks 1, 8, 9.

All concrete API names used above are defined here or belong to the named libraries. Verify exact library signatures against installed types during execution. This document defines commands and test files to create; none of its future test outcomes are claimed to have run during planning.

## Primary implementation references

- React Flow component API: https://reactflow.dev/api-reference/react-flow
- Reconnection example: https://reactflow.dev/examples/edges/reconnect-edge
- Performance guidance: https://reactflow.dev/learn/advanced-use/performance
- Playwright page/screenshot API: https://playwright.dev/docs/api/class-page
