# design-canvas-lod

Pan/zoom canvas page for a claude.ai/design project, with level of detail:
live iframes near 1:1 or in focus, PNG thumbnails when zoomed out.

- `design-canvas.jsx` — the canvas (sections, artboards, post-its, focus view).
- `canvas-page.jsx` — reads `canvas.json` and lays one page out on the canvas.
- `make-thumbs.mjs` — renders `_thumbs/<Name>.png` for every artboard with headless Chrome.
- `screens/` — Seaturtle Screens: 112 `.dc.html` artboards, `canvas.json`, flag SVGs, `_thumbs/`.

## Make thumbnails

    node make-thumbs.mjs --dir screens

Redo one: `--only SignIn`. Redo all: `--force`.

## Use in claude.ai/design

Copy the two `.jsx` files and the `_thumbs/` folder into the project beside the artboards.
