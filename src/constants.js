// Every number the canvas binds. The old design-canvas.jsx (on main) is the
// source of each one, except the ones the React Flow spike added (see its
// report).
export const DC = {
  // Look.
  bg: '#f0eee9', dot: 'rgba(70,58,46,.16)', dotSize: 26,
  winHead: 64,          // the window header, world px
  winPad: 36,           // the padding around the screen, world px
  winBody: '#eae7e1',
  sectionHeadMax: 1.75, // the most the section head counter-scales
  sectionHeadGap: 36,   // world px between the head and the content
  // A node drag starts on the first pixel of movement. React Flow's own
  // default (1 screen px) waits for that much motion before it starts, then
  // measures the rest of the drag from there — so the pixels spent crossing
  // the threshold never reach the node, and a fast first mousemove (a real
  // one, not only a synthetic one) can drop a visible chunk of the drag. The
  // header and the ⌘-drag shield are the only drag handles (mapping.js), and
  // every button in the header is marked nodrag, so nothing needs the
  // threshold to tell a click from a drag.
  nodeDragThreshold: 0,
  // A drop under this many world px is not a move: the old canvas's own
  // rule (design-canvas.jsx:1412 on main, `Math.hypot(dx, dy) < 4`), needed again
  // now that nodeDragThreshold 0 reports every click as a drag.
  dropTolerance: 4,
  // View.
  minZoom: 0.05, maxZoom: 4,
  fitPad: 80,           // screen px left around the content by a fit
  backToMs: 300,        // Back to content tween
  lostSettleMs: 150,    // wait after a move before the lost-pill test
  invZoomStep: 1.25,    // --dc-inv-zoom is written each 1.25x change and on settle
  wheelZoomStep: 0.18,  // one mouse-wheel notch zooms by exp(0.18)
  // The live budget: the old rules plus the spike's sticky rule.
  liveBudget: 8,
  mountMargin: 600,     // screen px: a window this near the view can mount
  unmountMargin: 1600,  // screen px: a live window this far from the view drops
  budgetHysteresis: 400,// screen px a live window counts as nearer
  touchMs: 4000,        // a touched window keeps its place this long
  touchBias: 1e6,       // px a touched window counts as nearer
  stickySettleMs: 600,  // quiet time before a pass (spike rule 3)
  mountGapMs: 60,       // one iframe mount per gap
  moveHoldMaxMs: 5000,  // a hold with no start and no end this long was lost
  // Saved state.
  stateTimeoutMs: 1500, // give up on the state file read
  saveDebounceMs: 400,  // wait after the last edit before the file write
};
