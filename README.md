# design-canvas-lod

Pan/zoom canvas page for a claude.ai/design project, with level of detail:
live iframes near 1:1 or in focus, snapshots when zoomed out.

- `design-canvas.jsx` — the canvas (sections, artboards, post-its, focus view, snapshots).
- `canvas-page.jsx` — reads `canvas.json` and lays one page out on the canvas.
- `screens/` — Seaturtle Screens: 112 `.dc.html` artboards, `canvas.json`, flag SVGs.

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

## Use in claude.ai/design

Copy the two `.jsx` files into the project beside the artboards.
