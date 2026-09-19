import { DC } from './constants.js';

// The live budget. At most DC.liveBudget windows hold a live iframe; all
// other windows show a placeholder. The rules are the old engine's, plus the
// sticky rule the React Flow spike proved necessary: a zoom in several
// pinches moved the view middle between the pinches, and the old ranking then
// swapped screens the user could still see for their placeholder.
export const BUDGET = {
  size: DC.liveBudget,
  margin: DC.mountMargin,
  unmountMargin: DC.unmountMargin,
  hysteresis: DC.budgetHysteresis,
  touchMs: DC.touchMs,
  touchBias: DC.touchBias,
  settleMs: DC.stickySettleMs,
  mountGapMs: DC.mountGapMs,
};

export const boxesOf = (nodes) => nodes.filter((n) => n.type === 'window')
  .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height }));

// Pure. The live set this pass wants, in rank order.
// prev: Set of live ids. view: { x, y, zoom }. pane: { w, h } screen px.
// boxes: [{ id, x, y, w, h }] world px. touched: Map id → time. now: ms.
export function rankLive(prev, view, pane, boxes, touched, now, cfg = BUDGET) {
  const { x, y, zoom } = view;
  const cx = pane.w / 2, cy = pane.h / 2;
  const rows = [];
  for (const b of boxes) {
    const l = b.x * zoom + x, t = b.y * zoom + y, r = l + b.w * zoom, btm = t + b.h * zoom;
    const live = prev.has(b.id);
    const m = live ? cfg.unmountMargin : cfg.margin;
    if (!(r > -m && l < pane.w + m && btm > -m && t < pane.h + m)) continue;
    const visible = r > 0 && l < pane.w && btm > 0 && t < pane.h;
    const at = touched.get(b.id);
    const d = Math.hypot(Math.max(l - cx, 0, cx - r), Math.max(t - cy, 0, cy - btm))
      - (live ? cfg.hysteresis : 0)
      - (at !== undefined && now - at < cfg.touchMs ? cfg.touchBias : 0);
    rows.push({ id: b.id, live, visible, d });
  }
  rows.sort((a, b) => Number(b.visible) - Number(a.visible) || a.d - b.d);
  // The sticky rule. `keep` is a subset of the previous live set, so the
  // result never grows past the budget.
  const keep = rows.filter((r) => r.visible && r.live).map((r) => r.id);
  const kept = new Set(keep);
  const fill = rows.filter((r) => !kept.has(r.id)).slice(0, Math.max(0, cfg.size - keep.length)).map((r) => r.id);
  return [...keep, ...fill];
}

// The store. `read()` returns { view, pane, boxes } at the time of the pass.
// A pass drops at once, but mounts one window only; if more wait, the next
// pass runs cfg.mountGapMs later, because two mounts in one frame make it long.
export function createLiveBudget({ read, cfg = BUDGET, now = () => performance.now() }) {
  const live = new Set();
  const touched = new Map();
  const subs = new Set();
  let moving = false, timer = 0;
  const emit = () => subs.forEach((fn) => fn());
  const run = () => {
    timer = 0;
    if (moving) return;
    const { view, pane, boxes } = read();
    const target = rankLive(live, view, pane, boxes, touched, now(), cfg);
    const want = new Set(target);
    let changed = false;
    for (const id of live) if (!want.has(id)) { live.delete(id); changed = true; }
    const next = target.find((id) => !live.has(id));
    if (next !== undefined) {
      live.add(next); changed = true;
      if (target.some((id) => !live.has(id))) timer = setTimeout(run, cfg.mountGapMs);
    }
    if (changed) emit();
  };
  const schedule = () => { clearTimeout(timer); timer = moving ? 0 : setTimeout(run, cfg.settleMs); };
  return {
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    isLive: (id) => live.has(id),
    liveIds: () => [...live],
    schedule,
    moveStart: () => { moving = true; clearTimeout(timer); timer = 0; },
    moveEnd: () => { moving = false; schedule(); },
    touch: (id) => { touched.set(id, now()); },
    dispose: () => { clearTimeout(timer); timer = 0; subs.clear(); },
  };
}
