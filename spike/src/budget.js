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

// sticky=1's settle window: a pass runs only after this much quiet, and
// (via stickyMoveStart/stickyMoveEnd below) never mid-gesture at all.
export const STICKY_SETTLE_MS = 600;

// Pure, next to pickLive (which stays exactly as it was). `prevLive` is the
// live Set from the last pass. Rule: a live window that is ON SCREEN right
// now is never dropped by this pass — only an off-screen live window can be
// dropped. That can hold the result above `budget` (an on-screen window kept
// past the budget) until it leaves the screen, at which point it is the
// first thing a later pass drops. The remaining free slots (if any) fill by
// the same rank pickLive uses: visible first, then nearest the middle,
// nothing beyond MARGIN.
export function pickLiveSticky(prevLive, viewport, pane, boxes, budget = BUDGET) {
  const { x, y, zoom } = viewport;
  const x0 = -x / zoom, y0 = -y / zoom, x1 = x0 + pane.w / zoom, y1 = y0 + pane.h / zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const ranked = boxes.map((b) => {
    const ox = Math.max(b.x - x1, 0, x0 - (b.x + b.w)), oy = Math.max(b.y - y1, 0, y0 - (b.y + b.h));
    const mx = Math.max(b.x - cx, 0, cx - (b.x + b.w)), my = Math.max(b.y - cy, 0, cy - (b.y + b.h));
    return { id: b.id, out: Math.hypot(ox, oy) * zoom, mid: Math.hypot(mx, my) };
  });
  const byId = new Map(ranked.map((r) => [r.id, r]));

  const keep = [];
  prevLive.forEach((id) => { const r = byId.get(id); if (r && r.out === 0) keep.push(id); });
  const keepSet = new Set(keep);

  const free = Math.max(0, budget - keep.length);
  const fill = ranked.filter((r) => r.out <= MARGIN && !keepSet.has(r.id))
    .sort((p, q) => ((p.out > 0) - (q.out > 0)) || (p.mid - q.mid))
    .slice(0, free).map((r) => r.id);

  return [...keep, ...fill];
}

// Pure. Whether box `b` intersects the current viewport rect — the same
// zero-clip test pickLive's own `out === 0` uses, exposed standalone so the
// debug overlay (debug.js) can compute a "visible count" without reaching
// into pickLive's internals.
export function isOnScreen(viewport, pane, b) {
  const { x, y, zoom } = viewport;
  const x0 = -x / zoom, y0 = -y / zoom, x1 = x0 + pane.w / zoom, y1 = y0 + pane.h / zoom;
  return b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0;
}

let live = new Set(), timer = 0;
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const isLive = (id) => live.has(id);

// `read` returns [viewport, pane, boxes] (an optional 4th element overrides
// budget). The timer restarts on each call, so the pass runs SETTLE_MS after
// the last move and never in a gesture. `onPass`, if given, is called with
// this pass's { prevLive, live, viewport, pane, boxes } right after `live`
// updates — debug.js's logPass is the only caller; omitting it (every call
// site before this task) leaves the timing and the result exactly as they
// were.
export function schedule(read, onPass) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const args = read();
    const prevLive = live;
    live = new Set(pickLive(...args));
    if (onPass) onPass({ prevLive, live, viewport: args[0], pane: args[1], boxes: args[2] });
    subs.forEach((f) => f());
  }, SETTLE_MS);
}

// sticky=1's own scheduler. `inGesture` is set only by stickyMoveStart/
// stickyMoveEnd (main.jsx wires those to onMoveStart/onMoveEnd only when
// sticky is on) — while it is true a pass is never run, however long the
// quiet gap, which covers a held pinch with no intervening onMove. Shares
// `live`/`subs` with schedule() above; a page runs one scheduler or the
// other, never both, so there is nothing to coordinate between them.
let stickyTimer = 0, inGesture = false;
export function stickyMoveStart() { inGesture = true; clearTimeout(stickyTimer); }
export function stickyMoveEnd() { inGesture = false; }
export function scheduleSticky(read, onPass) {
  clearTimeout(stickyTimer);
  if (inGesture) return;
  stickyTimer = setTimeout(() => {
    if (inGesture) return;
    const args = read();
    const prevLive = live;
    live = new Set(pickLiveSticky(prevLive, ...args));
    if (onPass) onPass({ prevLive, live, viewport: args[0], pane: args[1], boxes: args[2] });
    subs.forEach((f) => f());
  }, STICKY_SETTLE_MS);
}
