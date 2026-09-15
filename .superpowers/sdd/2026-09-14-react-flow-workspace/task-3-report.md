# Task 3 capture report

## Delivered behavior

`scripts/capture-previews.ts` accepts `--canvas`, `--root`, and `--out`, validates
the canvas with the shared baseline parser, serves only resolved files below a
loopback-only asset root, and captures each variant sequentially with Playwright.
It uses the authored viewport and device scale factor one. A single 15-second
deadline covers navigation, `document.fonts.ready`, image decoding, resource
error checking, and screenshot creation.

Captures are written to a sibling temporary directory. The output directory is
replaced only after every variant succeeds. A failed run removes only its
temporary directory, so an existing complete output and manifest remain intact.
Success holds a prior output as a backup until the new directory has been
renamed into place, and restores that backup if publication fails.

`src/previews/manifest.ts` exports the specified `PreviewManifest` type and a
runtime parser for consumers. Manifest revisions hash the baseline input, every
local root asset, capture settings, and each emitted PNG. The generator never
uses a previous capture as a cache; remote content is fetched again for every
run, and its resulting pixels affect the emitted revision.

## Red/green evidence

Before implementation:

```text
$ PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/capture.spec.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/capture-previews.ts'
1 failed, 1 passed
```

The initial success expectation failed because the CLI did not exist. The
failure-path test already passed because the missing executable returned a
nonzero status.

After implementation:

```text
$ npm run build
✓ built app and embed artifacts; exit 0

$ PLAYWRIGHT_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/capture.spec.ts
3 passed (20.1s)
```

The test fixture has a delayed font request and delayed SVG image request, a
320×180 desktop variant, a 390×844 phone variant, a green rectangle, and a
missing HTML variant. It verifies the two generated manifest dimensions, a
pixel of `[17, 180, 91, 255]`, failed publication with no manifest, and that a
failed rerun leaves the preceding completed manifest byte-for-byte unchanged.

Inspected capture artifacts from an independent successful CLI run:

```text
/tmp/capture-check-48392/desktop-default-2b52011bdb.png 2468 bytes
/tmp/capture-check-48392/phone-default-1af01aad30.png   4825 bytes
/tmp/capture-check-48392/manifest.json                   562 bytes
```

Both images show the green fixture rectangle at their authored desktop and
phone dimensions.

## Real sample attempt

Command:

```text
PLAYWRIGHT_BROWSER_CHANNEL=chrome npx tsx scripts/capture-previews.ts \
  --canvas tests/fixtures/workspace/canvas.json --root sample \
  --out /tmp/react-flow-real-sample-previews-20260914
```

The command finished in about 11 seconds and failed all 11 sample variants.
Every failure reported the required local script as unavailable, for example:

```text
variant:page-9:ZatcaProfile.dc.html: required resources failed:
404 http://127.0.0.1:<port>/support.js
```

All eleven `sample/*.dc.html` files reference `./support.js`; no tracked file
with that name exists under `sample/`. The pages also reference remote Google
Fonts, but they were not the observed failure. No real-sample manifest was
published at `/tmp/react-flow-real-sample-previews-20260914`.

## Self-review

- Root traversal, absolute paths, and symlink escapes are rejected before a
  document is served or captured.
- The server binds to `127.0.0.1`; no non-loopback listener is exposed.
- Every page, browser, and temporary server is closed in `finally` blocks.
- Response failures and failed requests are collected before publication.
- Captures use `fullPage: false`, preserving declared node dimensions.
- `git diff --check` reported no whitespace errors.
- The local sample remains blocked by the missing source asset. This task does
  not fabricate `support.js` and does not label partial captures as fresh.
