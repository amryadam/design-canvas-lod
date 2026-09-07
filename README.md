# design-canvas-lod

Pan/zoom canvas page for a claude.ai/design project, with level of detail:
live iframes near 1:1 or in focus, snapshots when zoomed out.

- `design-canvas.jsx` — the canvas (sections, artboards, post-its, focus view, snapshots).
- `canvas-page.jsx` — reads `canvas.json` and lays one page out as a single free
  canvas: every artboard and note at its own x/y. Drag a card by its grip to
  move it; the spot is saved to the section state file and to the browser, so
  it survives a reload even where the file cannot be written.
  Its `flows` array draws arrows between artboards on the canvas itself
  (`CanvasFlows`): `{ page, from, to, label, fs, ts, dashed }`, where `fs`/`ts`
  are the source/target anchor sides (`l`, `r`, `t`, `b`). Curves route through
  the gutters around every page and note they would otherwise cross (shortest
  clear path over the page corners, then smoothed).
- Size variants: an artboard entry with `"variantOf": "<primary file>"` takes no
  slot of its own. The primary's header shows one chip per size (`1440 · 2K ·
  390`); a click swaps the file and resizes the frame in place. Arrows, the
  saved position, and the focus view follow the chosen size, and the choice is
  saved with the section state. Titles that end in `· 1440×900` lose that
  suffix on a primary, since the chip shows it.
- `flow-layout.js` — `node flow-layout.js canvas.json [page-id]` lays a page out
  the way fatoora's flow map does: stages left to right, branches stacked under
  each other, a gutter of one card width between stages and 0.8 of a card
  height between rows, anchors chosen from geometry. Rewrites x/y and fs/ts in
  place. Positions saved in the browser win over canvas.json, so clear the
  page's saved layout (localStorage key `dc-state:…`) to see the new one.
- `sample/` — one example page: 11 `.dc.html` artboards, a `canvas.json` with
  `flows`, and an `index.html` that runs the canvas on them.

## How snapshots work

Nothing to run and no files to add. The canvas makes them itself, in the browser:

1. Each artboard's `.dc.html` is fetched once, one at a time, in idle moments.
2. Its same-origin images and Google Fonts are inlined, then the document is
   rasterized through an SVG `foreignObject` onto a canvas as a 720 px WebP.
3. The result is cached in IndexedDB, keyed by a hash of the file. A changed
   artboard gets a new snapshot on the next open. A new artboard shows live
   until its snapshot exists, usually within a second.

Below 50 % zoom, or far from the viewport, a slot shows its snapshot.
Live iframes mount only near 1:1 or in the focus view, one at a time.

## Run the sample

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/sample/`.

## Use in claude.ai/design

Copy the two `.jsx` files into the project beside the artboards.
