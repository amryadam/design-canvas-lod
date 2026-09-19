import { createRoot } from 'react-dom/client';
import { memo, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { ReactFlow, Background, Handle, Position, MarkerType, useNodesState, useEdgesState } from '@xyflow/react';
import rfCss from '@xyflow/react/dist/style.css?inline';
import { subscribe, isLive, schedule } from './budget.js';

const HEAD = 44;
const SIDES = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };

// Task 3b ablation: `opts.off` (a Set) switches ONE named suspect's cost off,
// `opts.cis`/`opts.wc`/`opts.contain` switch a mitigation ON. With no opts
// (or an empty `off`), every branch below takes the same path it always did
// — the default page's markup and CSS text are unchanged.
function buildCss(opts) {
  const off = (opts && opts.off) || new Set();
  const shadowDecl = off.has('shadow') ? '' : 'box-shadow:0 2px 12px rgba(0,0,0,.14);';
  const containDecl = opts && opts.contain ? ';contain:layout paint' : '';
  const cvDecl = off.has('cv') ? '' : ';content-visibility:auto';
  const wcRule = opts && opts.wc ? '.react-flow__viewport{will-change:transform}\n' : '';
  // Task 3d `freeze=1`: while a gesture runs (App's onMoveStart/onMoveEnd
  // toggle the `sp-gesture` class on the root, imperatively via
  // classList — no React state, so the toggle itself costs one style
  // recalculation, not a re-render of every node), live iframes go
  // `visibility:hidden` and their placeholder (normally hidden, kept
  // mounted alongside the iframe) shows instead. The iframe itself stays
  // mounted throughout, so it never reloads.
  const freezeRule = opts && opts.freeze
    ? '.sp-freeze-ph{display:none}\n.sp-gesture .sp-live-if{visibility:hidden}\n.sp-gesture .sp-freeze-ph{display:grid}\n'
    : '';
  return `
.sp-root{width:100%;height:100%;background:#f0eee9}
.sp-win{background:#fff;border-radius:10px;${shadowDecl}overflow:hidden;font:600 18px/1 system-ui,sans-serif;color:#2b2622${containDecl}}
.sp-head{height:${HEAD}px;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;cursor:grab;white-space:nowrap}
.sp-dot{width:10px;height:10px;border-radius:50%;background:#b9b2a8}.sp-dot.on{background:#2fa36b}
.sp-body{position:relative${cvDecl}}
.sp-ph{width:100%;height:100%;display:grid;place-items:center;background:#fff;color:#8a8178;font-size:40px}
.sp-shield{position:absolute;inset:0}
.sp-note{background:#fff3a8;padding:24px;font:400 22px/1.45 system-ui,sans-serif;white-space:pre-wrap;box-sizing:border-box}
.react-flow__handle{opacity:0}
${wcRule}${freezeRule}`;
}

const WindowNode = memo(({ id, data }) => {
  const live = useSyncExternalStore(subscribe, () => isLive(id));
  const bodyStyle = data.cis
    ? { width: data.w, height: data.h, containIntrinsicSize: `${data.w}px ${data.h}px` }
    : { width: data.w, height: data.h };
  // Task 3d `livewc=1`: will-change:transform on the live iframe ELEMENT
  // only (not the viewport) — each live iframe becomes its own small GPU
  // layer, instead of one world-sized layer.
  const ifStyle = data.livewc
    ? { width: data.w, height: data.h, border: 0, display: 'block', willChange: 'transform' }
    : { width: data.w, height: data.h, border: 0, display: 'block' };
  // `data.handles` is null by default (render all 8, as always). Set by the
  // `handles` off-flag to the exact source/target sides this node's edges
  // actually use, so unused handles are not rendered at all.
  const handleEls = data.handles
    ? Object.entries(SIDES).flatMap(([k, pos]) => [
        data.handles.has('s' + k) ? <Handle key={'s' + k} type="source" id={k} position={pos} /> : null,
        data.handles.has('t' + k) ? <Handle key={'t' + k} type="target" id={k} position={pos} /> : null,
      ]).filter(Boolean)
    : Object.entries(SIDES).flatMap(([k, pos]) => [
        <Handle key={'s' + k} type="source" id={k} position={pos} />,
        <Handle key={'t' + k} type="target" id={k} position={pos} />,
      ]);
  return (
    <div className="sp-win" style={{ width: data.w, height: data.h + HEAD }}>
      <div className="sp-head"><span className={'sp-dot' + (live ? ' on' : '')} />{data.title}</div>
      <div className="sp-body" style={bodyStyle}>
        {live && <iframe src={data.src} title={data.title} className={data.freeze ? 'sp-live-if' : undefined} style={ifStyle} />}
        {live && data.freeze && <div className="sp-ph sp-freeze-ph">{data.title}</div>}
        {!live && <div className="sp-ph">{data.title}</div>}
        <div className="sp-shield" />
      </div>
      {handleEls}
    </div>
  );
});
const NoteNode = memo(({ data }) => <div className="sp-note" style={{ width: data.w }}>{data.text}</div>);
const nodeTypes = { window: WindowNode, note: NoteNode };

// canvas.json -> nodes and edges. The screen keeps its x/y; the header sits
// above it, so the node starts HEAD px higher. No variant folding in the spike.
function build(data, page, base, opts) {
  const off = (opts && opts.off) || new Set();
  const boards = data.artboards.filter((a) => a.page === page);
  const ids = new Set(boards.map((a) => a.file));
  const flows = (data.flows || []).filter((f) => f.page === page && ids.has(f.from) && ids.has(f.to) && f.from !== f.to);

  // Per node: the set of source/target handle keys ('s'+side, 't'+side) the
  // flows actually use. Only consulted when the `handles` off-flag is set.
  const neededHandles = new Map();
  const need = (id, key) => { if (!neededHandles.has(id)) neededHandles.set(id, new Set()); neededHandles.get(id).add(key); };
  flows.forEach((f) => { need(f.from, 's' + (f.fs || 'r')); need(f.to, 't' + (f.ts || 'l')); });

  const nodes = boards.map((a) => ({
    id: a.file, type: 'window', position: { x: a.x, y: a.y - HEAD }, width: a.w, height: a.h + HEAD,
    dragHandle: '.sp-head',
    data: {
      w: a.w, h: a.h, title: a.title || a.file, src: base + a.file,
      handles: off.has('handles') ? (neededHandles.get(a.file) || new Set()) : null,
      cis: !!(opts && opts.cis),
      livewc: !!(opts && opts.livewc),
      freeze: !!(opts && opts.freeze),
    },
  }));
  (data.annotations || []).filter((n) => n.page === page).forEach((n) => nodes.push({
    id: n.id, type: 'note', position: { x: n.x, y: n.y }, data: { w: Math.min(n.w || 480, 760), text: n.text },
  }));
  const edges = off.has('edges') ? [] : flows.map((f, i) => ({
    id: 'e' + i, source: f.from, target: f.to, sourceHandle: f.fs || 'r', targetHandle: f.ts || 'l',
    label: off.has('labels') ? undefined : f.label, labelStyle: { fontSize: 28 }, markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 6, strokeDasharray: f.dashed ? '18 12' : undefined },
  }));
  return { nodes, edges };
}

function App({ data, page, base, opts }) {
  const off = (opts && opts.off) || new Set();
  const init = useMemo(() => build(data, page, base, opts), [data, page, base, opts]);
  const [nodes, , onNodesChange] = useNodesState(init.nodes);
  const [edges] = useEdgesState(init.edges);
  const wrap = useRef(null), rf = useRef(null), boxes = useRef([]);
  boxes.current = nodes.filter((n) => n.type === 'window')
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height }));
  // `iframes` off-flag: budget 0, every window shows its placeholder.
  const budgetOverride = off.has('iframes') ? 0 : undefined;
  const kick = useCallback(() => schedule(() => {
    const args = [rf.current.getViewport(), { w: wrap.current.clientWidth, h: wrap.current.clientHeight }, boxes.current];
    if (budgetOverride !== undefined) args.push(budgetOverride);
    return args;
  }), [budgetOverride]);
  // Task 3d `freeze=1`: mark the root as "in a gesture" imperatively
  // (classList, not React state) for the CSS in buildCss's freezeRule to
  // key off, from onMoveStart to onMoveEnd. Only wired up when the flag is
  // set, so the default page's behaviour (and cost) is unchanged.
  const freeze = !!(opts && opts.freeze);
  const onMoveStart = useCallback(() => {
    if (freeze) wrap.current.classList.add('sp-gesture');
  }, [freeze]);
  const onMoveEnd = useCallback(() => {
    if (freeze) wrap.current.classList.remove('sp-gesture');
    kick();
  }, [freeze, kick]);
  return (
    <div ref={wrap} className="sp-root">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes}
        minZoom={0.05} maxZoom={4} panOnScroll zoomOnPinch nodesConnectable={false} fitView
        onInit={(inst) => { rf.current = inst; window.rf = inst; kick(); }}
        onMove={kick} onMoveStart={onMoveStart} onMoveEnd={onMoveEnd} onNodeDragStop={kick}>
        {!off.has('bg') && <Background gap={26} />}
      </ReactFlow>
    </div>
  );
}

// Task 3d's two new flags (`livewc`, `freeze`) are read here, directly from
// the URL, instead of being added to spike/index.html's own opts-building
// (like the Task 3b ablation flags off/cis/wc/contain are) — so this file
// alone is enough to turn them on, and the default page (no query flags)
// renders exactly as before: params.get(...) is null, so both stay false.
export function mount(el, { data, page, base = './', opts = {} }) {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const merged = { ...opts, livewc: !!opts.livewc || params.get('livewc') === '1', freeze: !!opts.freeze || params.get('freeze') === '1' };
  const style = document.createElement('style');
  style.textContent = rfCss + buildCss(merged);
  document.head.appendChild(style);
  createRoot(el).render(<App data={data} page={page} base={base} opts={merged} />);
}
