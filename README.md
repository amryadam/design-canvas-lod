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
  are the source/target anchor sides (`l`, `r`, `t`, `b`). Curves bend around
  any page they would otherwise cross.
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
