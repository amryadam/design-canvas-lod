// debug=1's diagnostic overlay. All state lives in this plain module object,
// never in React — the overlay is a handful of DOM nodes created once and
// updated by direct mutation, so watching it costs nothing measurable and it
// never triggers a React re-render. Only imported by main.jsx; its exports
// are all no-ops until initDebug() has run (main.jsx only calls that when
// opts.debug is set), so the default page pays nothing for this file either.
import { isOnScreen } from './budget.js';

const state = {
  t0: typeof performance !== 'undefined' ? performance.now() : 0,
  zoom: 0,
  liveCount: 0,
  visibleCount: 0,
  passCount: 0,
  log: [], // every pass + gesture event, oldest first — copy/console.log export all of it
};

let el = null, headEl = null, listEl = null;

const now = () => Math.round(performance.now() - state.t0);

const lineOf = (e) => e.type === 'pass'
  ? `t=${e.t} zoom=${e.zoom.toFixed(3)} +${e.added} -${e.dropped} droppedVisible=${e.droppedVisible}`
  : `${e.kind} t=${e.t}`;

const fullText = () => state.log.map(lineOf).join('\n');

function render() {
  if (!headEl) return;
  headEl.textContent = `zoom=${state.zoom.toFixed(3)} live=${state.liveCount} visible=${state.visibleCount} passes=${state.passCount}`;
  listEl.textContent = state.log.slice(-8).map(lineOf).join('\n');
}

// Idempotent — safe to call more than once (main.jsx calls it from onInit).
export function initDebug() {
  if (el || typeof document === 'undefined') return;
  // Exposed the same way this spike already exposes window.rf/spikeTall/
  // spikeDrive: a check script (spike/sticky-check.mjs) reads the full log
  // (state.log is not truncated — only the on-page overlay shows the last
  // 8) straight off this reference instead of driving the copy button.
  if (typeof window !== 'undefined') window.__spikeDebug = state;
  el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:440px;'
    + 'background:rgba(20,18,16,.82);color:#d6ffe0;border-radius:6px;padding:6px 8px;'
    + 'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none';
  headEl = document.createElement('div');
  headEl.style.cssText = 'color:#fff;font-weight:600';
  listEl = document.createElement('div');
  const btn = document.createElement('button');
  btn.textContent = 'copy';
  btn.style.cssText = 'pointer-events:auto;margin-top:4px;font:11px ui-monospace,Menlo,Consolas,monospace;'
    + 'background:#2b2622;color:#d6ffe0;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer';
  btn.addEventListener('click', () => {
    const text = fullText();
    console.log(text);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  });
  el.appendChild(headEl);
  el.appendChild(listEl);
  el.appendChild(btn);
  document.body.appendChild(el);
  render();
}

// main.jsx calls this from kick() itself — every onMove/onMoveEnd/
// onNodeDragStop/onInit call, i.e. every frame of a gesture, not just when a
// (debounced) pass actually runs. Without this the header's zoom/visible
// count would show whatever they were at the LAST pass, which for sticky=1
// (passes are rare by design) can be stuck showing the pre-gesture zoom
// while the page is actually zoomed in — this only touches the header text,
// not the pass list, so it stays cheap.
export function logTick(zoom, visibleCount) {
  if (!headEl) return;
  state.zoom = zoom;
  state.visibleCount = visibleCount;
  headEl.textContent = `zoom=${zoom.toFixed(3)} live=${state.liveCount} visible=${visibleCount} passes=${state.passCount}`;
}

// main.jsx calls this from onMoveStart/onMoveEnd when opts.debug is set.
export function logGesture(kind) {
  if (!el) return;
  state.log.push({ type: 'gesture', kind, t: now() });
  render();
}

// The onPass hook budget.js's schedule()/scheduleSticky() call right after a
// pass updates `live`. { prevLive, live, viewport, pane, boxes } is exactly
// that pass's own read() result plus the before/after Sets.
export function logPass({ prevLive, live, viewport, pane, boxes }) {
  if (!el) return;
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const added = [...live].filter((id) => !prevLive.has(id)).length;
  const droppedIds = [...prevLive].filter((id) => !live.has(id));
  const droppedVisible = droppedIds.filter((id) => {
    const b = boxById.get(id);
    return b && isOnScreen(viewport, pane, b);
  }).length;
  state.zoom = viewport.zoom;
  state.liveCount = live.size;
  state.visibleCount = boxes.filter((b) => isOnScreen(viewport, pane, b)).length;
  state.passCount++;
  state.log.push({ type: 'pass', t: now(), zoom: viewport.zoom, added, dropped: droppedIds.length, droppedVisible });
  render();
}
