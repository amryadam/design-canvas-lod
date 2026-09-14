# Task 2: Stable authored data and legacy migration

## Delivered

- Added the specified domain types in `src/domain/model.ts` with no field or
  type-name deviations from the task brief.
- Added `parseBaseline(input)` with explicit JSON-path validation for required
  fields, finite coordinates, positive dimensions, duplicate IDs, page links,
  default variants, and journey endpoints.
- Added deterministic `migrateLegacy(input, workspaceId)` conversion. It keeps
  legacy pages and authored positions; preserves supplied screen, variant,
  note, and journey IDs where their dedicated legacy fields are present; maps
  variant journey endpoints to their primary screen; and preserves labels,
  anchor sides, dashed state, note text, and note width.
- The old `cpVariants` inference is reproduced as a pure function: same-page
  CamelCase prefix matching chooses the longest available parent. Explicit
  parent chains resolve to their terminal root; missing parents and cycles
  reject with a validation error rather than discarding an artboard.
- Added a non-destructive CLI and the migrated workspace fixture. The CLI
  rejects an output path that resolves to the input path.
- Documented the retained legacy local-storage key and the future workspace
  override namespace `rf-workspace:v1:<workspaceId>`; no legacy
  browser state is imported.

## Migration evidence

Command:

```sh
npx tsx scripts/migrate-canvas.ts --input sample/canvas.json --output tests/fixtures/workspace/canvas.json --workspace-id sample-invoices
```

Output: `Migrated 10 screens, 1 notes, and 12 journeys`.

Parsing the generated fixture confirmed: 1 page, 10 primary screens, 11
variants, 1 note, and 12 journeys. The only variant group is
`ZatcaDone.dc.html` with `ZatcaDonePhone.dc.html`.

## Tests and verification

- Red: `npm run test:unit -- tests/unit/migrate.test.ts` failed before the
  implementation because `src/domain/migrate` did not exist.
- Green: the same command passes 10 tests. They cover deterministic conversion,
  stable supplied IDs, duplicate legacy journeys, variant endpoint resolution,
  invalid duplicate baseline IDs, coordinates, dimensions, pages, default
  variants, invalid explicit parents and cycles, terminal explicit chains,
  child-artboard IDs, and empty editable text.
- `npm run build` passed, including TypeScript `--noEmit` and both Vite builds.
  Vite reports its existing informational warning that it ignores the
  third-party `use client` directive in `@xyflow/react`.
- `git diff --check` passed.
- Browser tests were intentionally not run: this task is pure domain and CLI
  code, and the task brief specifically excludes a browser-suite rerun unless
  needed.

## Self-review and limits

The migration deliberately uses generated IDs containing the legacy page and
file identity, then writes them to the fixture. Future filename changes should
keep those persisted IDs and update the `file` field. A legacy artboard's `id`
is treated as its primary screen ID. A child artboard's dedicated `variantId`,
or its `id` when no dedicated field is present, is the variant ID. This avoids
one root identifier being reused for two domain entities. The current sample
lacks those IDs, so the fixture demonstrates the generated stable-ID path.

## Round 1 correction evidence

Controller review clarified that explicit `variantOf` chains are valid legacy
data. The converter now follows each chain to its terminal root and still
rejects only missing explicit parents and cycles. Child artboard `id` values
are retained as variant IDs when `variantId` is absent. Baseline parsing now
allows empty note text and journey labels while retaining non-empty validation
for IDs and path-like references. The documented override namespace is
`rf-workspace:v1:<workspaceId>`.

Commands and fresh output:

```text
$ npm run test:unit -- tests/unit/migrate.test.ts
Test Files  1 passed (1)
Tests  11 passed (11)

$ npm run build
✓ built in 534ms
✓ built in 971ms
```

The build continues to report Vite's informational third-party
`@xyflow/react` `use client` directive warning. `git diff --check` passed.
