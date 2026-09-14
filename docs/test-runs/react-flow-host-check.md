# React Flow host compatibility check

Date: 2026-09-14
Artifact revision: `aa0ba48` (`build: establish React Flow bundle and host compatibility probe`)

## Environment and dependency compatibility

The local check ran on macOS arm64 with Node `v26.8.2`, npm `11.19.1`, and Playwright `1.58.2`. `PLAYWRIGHT_BROWSER_CHANNEL=chrome` selected the installed Google Chrome for the recorded runs; with that variable unset, Playwright uses its configured default Chromium installation.

Read-only `npm view` inspection recorded these requirements:

| Package | Installed version | Published engine or peer requirement |
| --- | --- | --- |
| React | 19.3.0 | `node >=0.10.0` |
| React DOM | 19.3.0 | peer `react ^19.3.0` |
| @xyflow/react | 12.11.6 | peers `react`, `react-dom`, `@types/react`, `@types/react-dom` all `>=17` |
| Vite | 7.3.1 | `node ^20.19.0 || >=22.12.0` |
| Playwright Test | 1.58.2 | `node >=18` |
| TypeScript | 5.9.3 | `node >=14.17` |
| tsx | 4.23.0 | `node >=18` |

Node 26.8.2 satisfies the selected toolchain requirements. The root package remains CommonJS-safe: it does not set `"type": "module"`, and `node flow-layout.js` prints `usage: node flow-layout.js <canvas.json> [page-id ...]` with status 2.

## Local artifact checks

`npm run build` completed successfully and emitted independent output directories:

- `dist/app/` standalone application, including a relative-path CSS asset and application JavaScript.
- `dist/embed/design-workspace.iife.js` and `dist/embed/design-workspace.css`, using a relative asset base. The IIFE exposes `DesignWorkspace.mountWorkspace(element, options)` and bundles its React runtime.

The build printed the following upstream warning twice, once for each build target:

```
node_modules/@xyflow/react/dist/esm/index.js (1:0): Module level directives cause errors when bundled, "use client" in "node_modules/@xyflow/react/dist/esm/index.js" was ignored.
```

It was not suppressed or masked. Vite emitted both artifacts and the browser checks below passed; this warning remains relevant if the target host handles React Flow's directive differently.

| Command | Output | Verified behavior |
| --- | --- | --- |
| `PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/host-probe.spec.ts` | `2 passed (1.8s)` | Source probe shows two labeled custom snapshot nodes and zero live screen iframes initially. Activation creates one iframe; parent-document Escape returns it to the snapshot. |
| `PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/bundle-probe.spec.ts` | `1 passed (1.6s)` | The exact IIFE and emitted CSS load inside a local parent iframe and render two snapshots with no initial live iframe. |
| `PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e` | `3 passed (2.5s)` | Full local browser regression set. |
| `npm run test:unit` | `No test files found, exiting with code 0` | Unit test script is configured and completes cleanly; Task 1 has browser coverage only. |

The probe image is an inline SVG data URL, so no host-relative image request is involved. The source fixture lives under `tests/fixtures/workspace/` and is outside the production entry point. No baseline fetch or host write/read round-trip is implemented by this disposable Task 1 probe; standalone has no `window.omelette` API and did not write or overwrite any state.

## Claude host check: blocked

The controller's Chrome session initially contained only `about:blank`. Navigating to `https://claude.ai/design` reached Cloudflare's “Just a moment…” screen with “Performing security verification” and a human-verification checkbox. The check was not retried or bypassed.

As a result, these real-Claude capabilities remain unverified: emitted bundle, stylesheet, and image resolution; HTML iframe loading; focus and Escape across a Claude-hosted iframe; baseline reads; `window.omelette?.writeFile` behavior and persistence after reopening; a uniquely named override-file write/read round-trip; and the `__dc_probe`, `__dc_present`, `__dc_set_zoom`, and `__dc_zoom` protocol. The local iframe result does not establish Claude support.
