# Task 1: React Flow host compatibility probe

Date: 2026-09-14

## Artifact

- Base revision: `7d9d773` (`docs: plan React Flow workspace implementation`).
- Build output: `dist/app/` for the standalone application and `dist/embed/` for the IIFE embed. The IIFE exposes `DesignWorkspace.mountWorkspace(element, options)` and contains React/React DOM rather than requiring a host global.
- The test-only source fixture is `tests/fixtures/workspace/probe.html`; it is not reachable from the production application entry point.
- `flow-layout.js` remains runnable as CommonJS: `node flow-layout.js` returned its expected usage message and status 2. The root package does not set `"type": "module"`; TypeScript scripts can use `tsx`.

## TDD evidence

1. RED — `PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/host-probe.spec.ts` failed before the fixture existed with `net::ERR_HTTP_RESPONSE_CODE_FAILURE` at `/tests/fixtures/workspace/probe.html`.
2. GREEN — after adding the two React Flow custom nodes, the same command passed: `1 passed (1.9s)`.
3. RED — the added Escape regression failed before the listener existed: expected `iframe[data-live-screen]` count 0 after Escape, received 1.
4. GREEN — after adding the workspace Escape listener, the host probe command passed: `2 passed (1.8s)`.

## Local browser results

Environment: macOS arm64, Node `v26.8.2`, npm `11.19.1`, Playwright `1.58.2`, installed Google Chrome selected with `PLAYWRIGHT_BROWSER_CHANNEL=chrome` (the configuration otherwise uses Playwright's default downloaded Chromium).

- `npm run build` passed. It emitted the standalone application, `design-workspace.css`, and `design-workspace.iife.js`; both app and embed assets use relative bases.
- `PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/bundle-probe.spec.ts` passed: `1 passed (1.6s)`. It loaded the exact IIFE and CSS inside a local parent iframe and found both custom snapshot nodes with no live-screen iframe at startup.
- The source probe test verified two labeled snapshot nodes, zero initial `iframe[data-live-screen]`, activation creating one live iframe, and parent-document Escape returning to the snapshot.
- The probe snapshot uses an inline SVG data URL, so it has no host-relative image fetch to resolve. The local IIFE test verifies the emitted stylesheet and bundle resolve through the parent iframe path.
- No baseline fetch or host write/read round-trip exists in this Task 1 probe. The standalone fixture has no `window.omelette` API, so persistence capability is unobserved; no files were written or overwritten.

## Real Claude result: blocked

The controller's Chrome session contained only `about:blank`. Navigation to `https://claude.ai/design` reached Cloudflare's “Just a moment…” page with “Performing security verification” and a human-verification checkbox. Per the task boundary, the check was not retried or bypassed. Therefore bundle/style/image behavior, HTML iframe loading, focus/Escape with a Claude-hosted iframe, baseline reads, `window.omelette?.writeFile` persistence across reopening, write/read round-trips, and the legacy `__dc_probe` / `__dc_present` / `__dc_set_zoom` / `__dc_zoom` protocol remain unverified in the real host.

## Self-review

- The public export has the requested unmount return contract.
- The initial renderer is deliberately disposable and keeps test fixtures outside production entry points.
- The local parent iframe proof does not establish Claude compatibility.
- Vite reports that React Flow's upstream `"use client"` directive was ignored while bundling. Both emitted artifacts and browser tests succeeded; this is a build warning to revisit only if the target host treats it differently.

## Round 1 documentation fix

- Added the durable evidence record at `docs/test-runs/react-flow-host-check.md`, including artifact revision `aa0ba48`, local source and IIFE results, tool requirements, the unmasked Vite warning, and the exact Claude blocker.
- Re-ran read-only `npm view` metadata inspection. Node `v26.8.2` satisfies Vite's `^20.19.0 || >=22.12.0`, Playwright's `>=18`, TypeScript's `>=14.17`, and tsx's `>=18` requirements; React DOM's `react ^19.3.0` peer matches installed React 19.3.0; React Flow's React peers are all `>=17`.
- Documentation-only verification: `git diff --check` completed with no output.
