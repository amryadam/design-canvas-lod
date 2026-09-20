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

Three rendering rules hold, and the checks guard them:
- The React Flow viewport has no `will-change`. With it, a zoom-in and then a
  zoom-out on a big page loses content.
- Each live iframe has `will-change: transform`, so a zoom does not raster
  the screens again.
- A live screen stays painted through a gesture. A live card never carries
  `content-visibility`, because Chrome can skip a card that has it, and a
  skipped card is not painted and loses its iframe's layer. Its iframe does
  not defer its load either, because the budget mounts the iframe early on
  purpose. A placeholder card keeps `content-visibility: auto`, where it costs
  nothing to skip.

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
| `npm run test:live-paint` | Builds, then measures, frame by frame, that no live screen loses its pixels during a pinch, and runs its control. `--url=<path>` runs it on another page |
| `npm run perf` | Builds, then measures zoom and pan frame times in a headful Chrome |

`perf/bench.js` is a console harness: open the sample, paste the file into the
DevTools console and run `await dcBench.all()`. `perf/results.md` holds the
comparison with the old canvas.

Run the sample: `npm run build`, then `python3 -m http.server 8000`, and open
`http://localhost:8000/sample/`.
