import { DC } from './constants.js';

// The old "Back to content" fit: the content box with DC.fitPad screen px on
// each side, centred, and never above 1:1. bounds: { x, y, width, height } in
// world px. pane: { w, h } screen px. Returns a React Flow viewport.
export function fitView(bounds, pane, { pad = DC.fitPad, minZoom = DC.minZoom, maxZoom = DC.maxZoom } = {}) {
  const zoom = Math.min(1, maxZoom, Math.max(minZoom,
    Math.min((pane.w - pad * 2) / bounds.width, (pane.h - pad * 2) / bounds.height)));
  return {
    zoom,
    x: (pane.w - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (pane.h - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

// True when one of the world boxes is inside the view. Arithmetic only: the
// lost-pill test runs on each move frame and must read no DOM rect.
export function anyOnScreen(boxes, view, pane) {
  return boxes.some((b) => {
    const l = b.x * view.zoom + view.x, t = b.y * view.zoom + view.y;
    return l + b.w * view.zoom > 0 && l < pane.w && t + b.h * view.zoom > 0 && t < pane.h;
  });
}

// A mouse wheel zooms, a trackpad scroll pans: the old engine's test.
export const isMouseWheel = (e) => e.deltaMode !== 0
  || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);

// The viewport after a zoom by `factor` that keeps the world point under the
// screen point (px, py) in place.
export function zoomAround(view, px, py, factor, { minZoom = DC.minZoom, maxZoom = DC.maxZoom } = {}) {
  const zoom = Math.min(maxZoom, Math.max(minZoom, view.zoom * factor));
  const k = zoom / view.zoom;
  return { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

// --dc-inv-zoom is 1 / zoom. The arrow strokes, the dashes and the section
// head read it to keep their screen size. The variable is inherited, so each
// write recalculates the style of the whole canvas: it is written only on a
// DC.invZoomStep change during a gesture, and exactly on settle (force).
export function createInvZoom(getEl, step = DC.invZoomStep) {
  let last = 0;
  return (zoom, force = false) => {
    const el = getEl();
    if (!el || !(zoom > 0)) return;
    if (!force && last && Math.abs(Math.log(zoom / last)) < Math.log(step)) return;
    last = zoom;
    el.style.setProperty('--dc-inv-zoom', String(1 / zoom));
  };
}
