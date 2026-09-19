// Every number the canvas binds. The old design-canvas.jsx is the source of
// each one, except the ones the React Flow spike added (see its report).
export const DC = {
  // Look.
  bg: '#f0eee9', dot: 'rgba(70,58,46,.16)', dotSize: 26,
  winHead: 64,          // the window header, world px
  winPad: 36,           // the padding around the screen, world px
  winBody: '#eae7e1',
  sectionHeadMax: 1.75, // the most the section head counter-scales
  sectionHeadGap: 36,   // world px between the head and the content
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
  // Saved state.
  stateTimeoutMs: 1500, // give up on the state file read
  saveDebounceMs: 400,  // wait after the last edit before the file write
};
