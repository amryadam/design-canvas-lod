// The spike's live budget. Simple on purpose: no hysteresis, no touch mark,
// no mount gap. Visible windows first, then the nearest to the view middle.
export const BUDGET = 8, SETTLE_MS = 150, MARGIN = 600;

// Pure. viewport = { x, y, zoom }, pane = { w, h }, boxes = [{ id, x, y, w, h }]
// in world px. Returns the ids that are live.
export function pickLive(viewport, pane, boxes, budget = BUDGET) {
  const { x, y, zoom } = viewport;
  const x0 = -x / zoom, y0 = -y / zoom, x1 = x0 + pane.w / zoom, y1 = y0 + pane.h / zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return boxes.map((b) => {
    const ox = Math.max(b.x - x1, 0, x0 - (b.x + b.w)), oy = Math.max(b.y - y1, 0, y0 - (b.y + b.h));
    const mx = Math.max(b.x - cx, 0, cx - (b.x + b.w)), my = Math.max(b.y - cy, 0, cy - (b.y + b.h));
    return { id: b.id, out: Math.hypot(ox, oy) * zoom, mid: Math.hypot(mx, my) };
  }).filter((r) => r.out <= MARGIN)
    .sort((p, q) => ((p.out > 0) - (q.out > 0)) || (p.mid - q.mid))
    .slice(0, budget).map((r) => r.id);
}

let live = new Set(), timer = 0;
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const isLive = (id) => live.has(id);
// `read` returns [viewport, pane, boxes]. The timer restarts on each call, so
// the pass runs SETTLE_MS after the last move and never in a gesture.
export function schedule(read) {
  clearTimeout(timer);
  timer = setTimeout(() => { live = new Set(pickLive(...read())); subs.forEach((f) => f()); }, SETTLE_MS);
}
