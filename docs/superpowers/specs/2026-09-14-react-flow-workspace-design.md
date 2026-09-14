# React Flow screen and journey workspace

Date: 2026-09-14
Status: Written specification approved by the user on 2026-09-14.

## Purpose and scope

Replace the custom canvas with a clean-slate React Flow workspace. Screen review and journey editing are equally important. Existing behavior informs requirements but the existing renderer is not the implementation template.

The first version supports 100 primary screens, excluding variants, in both a standalone web application and claude.ai/design. Both environments use the same workspace implementation. Generated assets and small host adapters provide environment-specific loading and persistence.

## Approach and alternatives

Use React Flow for viewport navigation, selection, node dragging, and connection interaction. Custom React nodes implement screens and text notes. Domain code owns variants, preview activation, authored data, and overrides.

A separate application for each environment duplicates behavior and maintenance. Hosting the standalone application and embedding its URL adds hosting and embedding dependencies. A shared distributable with host adapters is the selected approach, contingent on an early Claude compatibility check.

React Flow is MIT-licensed and supports custom React nodes. References:

- https://reactflow.dev/
- https://reactflow.dev/learn/customization/custom-nodes

No library replacement alone establishes a performance improvement. Validate the resulting workspace in both environments.

## User interaction

Screens display generated snapshots by default. Activating a screen replaces its snapshot with the corresponding live HTML in place, keeping the journey visible. Escape or clicking outside returns it to the snapshot. At most one screen is live at a time. Activating another deactivates the previous screen. Panning or zooming does not activate any additional live documents.

Drag a screen by its header and drag the background to pan. Viewport controls support zoom and fitting content. Selection and canvas gestures must not interfere with buttons or active HTML content.

Connect screens through handles on their top, right, bottom, or left side. Select a connection to edit its label, change endpoints, or delete it. Use React Flow standard edge paths in the first version. Automatic obstacle-avoiding routing is outside this version.

Variants switch within the same screen node and retain its identity, position, and journey connections. A variant change updates the snapshot and dimensions; if the screen is active, it also updates the live document. Movable text notes explain steps and branches.

## Component boundaries

- Workspace: React Flow composition, viewport, selection, and editing controls.
- Screen node: snapshot, header, variant controls, connection handles, and live activation.
- Note node: editable text and position.
- Domain model and reconciliation: stable identities, baseline data, overrides, and source updates; independent of React Flow internals.
- Preview generator: browser capture of HTML files, producing images and a manifest.
- Host adapters: load baseline/assets/overrides and write overrides where supported; expose capabilities and save failures.

React Flow node and edge data is derived from the domain model. Its internal serialization is not the persisted domain contract.

## Source data and saved edits

canvas.json remains the authored baseline for screens, variants, notes, and initial connections. Screens, variants, notes, and connections use stable IDs independent of filenames. A file rename with an unchanged ID retains edits. Legacy data needs a deterministic migration that assigns and records IDs before relying on rename stability.

Saved overrides include positions, chosen variants, note edits and additions, connection edits and additions, and deletions of authored items. Deletions need explicit tombstones so reconciliation does not recreate deleted baseline items. Overrides are versioned and scoped to a workspace identity.

Loading sequence: read baseline, restore available overrides, reconcile by ID, derive nodes and edges, then fit the restored layout. Avoid fitting or enabling edits against partially restored data.

New authored screens appear automatically. Matching IDs retain overrides. Overrides whose baseline items disappeared are retained but hidden; they can apply again if those IDs return. Added notes and connections are distinct from orphaned baseline overrides. Connections with unavailable endpoints remain hidden until both endpoints exist.

Local changes persist immediately in browser storage. A host adapter also writes an override file where supported. Standalone mode supports override import/export. When both browser and file saves exist, compare revisions and restore the newer whole document, with browser state winning ties. This is single-editor persistence; concurrent collaborative merging is outside scope.

Reset layout removes position overrides without deleting journey edits. Reset selected item removes its overrides; for a user-added item it removes that item. Clear all workspace edits removes the complete override layer and restores the baseline.

## Snapshot generation and assets

A browser-based build step captures each HTML screen and each variant at its authored dimensions. It produces snapshot images and a manifest keyed by stable IDs and source revision. Both runtime environments load these assets; runtime DOM screenshot generation is unnecessary.

The generator waits for document readiness and fonts and applies a bounded capture timeout. Failed captures are reported as failures with the affected screen ID, never silently represented as fresh images. Source files and their required assets must be available to the capture browser. Bundle paths must resolve in both target environments.

The manifest identifies snapshot dimensions and revision so stale or missing output can be detected. Preview image sizing, compression, and viewport loading are performance decisions to measure against the 100-screen fixture, not assumptions that all full-resolution variants can remain decoded at once.

## Failure handling

A missing snapshot displays a labeled placeholder. A failed live preview offers retry and return to preview. Browser iframe restrictions may prevent reliable failure detection; the return control must remain usable regardless.

Baseline parse or load failures produce an explicit load error with retry. Invalid override imports report the validation error and preserve current data. Host save failures retain the browser copy and show unsaved-to-file status with a retry path. Browser storage failures must also be visible rather than reported as saved.

The active preview requires testing of Escape and focus across iframe boundaries. Use a bridge in controlled screen documents if required and supported; verify this before finalizing activation mechanics. Keep a visible workspace-level return-to-preview control available.

## Packaging and Claude compatibility gate

A local build produces the workspace bundle, styles, snapshot manifest, preview images, and required source assets. Standalone hosting serves those files. The Claude adapter integrates the same workspace with the host's supported file and embedding APIs.

Before committing to the implementation details, verify in the real Claude environment: bundle loading, styles and image resolution, HTML iframe loading, keyboard/focus behavior, baseline reads, and override writes. Document actual host capabilities and limitations. A local browser result cannot establish Claude compatibility. If the host cannot support an agreed interaction or persistence capability, bring the concrete limitation back for a design decision.

## Validation and acceptance

Exercise the same user journeys in standalone and Claude:

- Load generated snapshots, switch variants, activate HTML, and deactivate with Escape and outside click.
- Drag, pan, zoom, fit, select, connect, label, reconnect, delete, and edit notes.
- Reload saved state; import/export; exercise each reset action.
- Update baseline files, retain edits by stable ID, add screens, remove and restore IDs, and verify hidden connections.
- Exercise missing snapshots, broken HTML, invalid baseline/overrides, and file/browser save failures.

Use representative 25-screen and 100-screen datasets with variants and long HTML pages. Record viewport interaction frame times, preview memory behavior, initial readiness, and activation latency on identified hardware and browsers. During snapshot navigation there must be zero live screen iframes; activation should introduce only the selected live screen. Look for blanking, flicker, input stalls, and unexpected remounts in both environments. These measurements establish the achievable performance envelope; no unmeasured frame-rate guarantee is implied.

Use focused automated tests for reconciliation, tombstones, revision selection, and import validation, plus real browser interaction checks. Verify generated snapshot dimensions and visual content. Preserve separate evidence for standalone and Claude outcomes.

## Delivery

Work in feature/react-flow-workspace, created from the current dev tip in a separate worktree. Preserve existing staged changes in the original checkout. Review this written spec before writing the implementation plan. The plan should begin with host compatibility and preview generation verification, followed by domain persistence, workspace interactions, packaging, and acceptance coverage.

Commit work on the feature branch. Once the complete feature is verified, merge into dev using --no-ff and retain the feature branch. Promotion to main requires a separate explicit request.

## Deferred scope

Real-time collaboration, obstacle-avoiding routing, additional whiteboard drawing tools, and automatic performance promises are outside the initial release. Existing per-screen PNG/HTML export controls are not yet an agreed first-version requirement; override import/export is included.
