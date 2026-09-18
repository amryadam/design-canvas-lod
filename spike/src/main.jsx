import { createRoot } from 'react-dom/client';
import { memo, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { ReactFlow, Background, Handle, Position, MarkerType, useNodesState, useEdgesState } from '@xyflow/react';
import rfCss from '@xyflow/react/dist/style.css?inline';
import { subscribe, isLive, schedule } from './budget.js';

const HEAD = 44;
const SIDES = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };
const CSS = `
.sp-root{width:100%;height:100%;background:#f0eee9}
.sp-win{background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.14);overflow:hidden;font:600 18px/1 system-ui,sans-serif;color:#2b2622}
.sp-head{height:${HEAD}px;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;cursor:grab;white-space:nowrap}
.sp-dot{width:10px;height:10px;border-radius:50%;background:#b9b2a8}.sp-dot.on{background:#2fa36b}
.sp-body{position:relative;content-visibility:auto}
.sp-ph{width:100%;height:100%;display:grid;place-items:center;background:#fff;color:#8a8178;font-size:40px}
.sp-shield{position:absolute;inset:0}
.sp-note{background:#fff3a8;padding:24px;font:400 22px/1.45 system-ui,sans-serif;white-space:pre-wrap;box-sizing:border-box}
.react-flow__handle{opacity:0}
`;

const WindowNode = memo(({ id, data }) => {
  const live = useSyncExternalStore(subscribe, () => isLive(id));
  return (
    <div className="sp-win" style={{ width: data.w, height: data.h + HEAD }}>
      <div className="sp-head"><span className={'sp-dot' + (live ? ' on' : '')} />{data.title}</div>
      <div className="sp-body" style={{ width: data.w, height: data.h }}>
        {live
          ? <iframe src={data.src} title={data.title} style={{ width: data.w, height: data.h, border: 0, display: 'block' }} />
          : <div className="sp-ph">{data.title}</div>}
        <div className="sp-shield" />
      </div>
      {Object.entries(SIDES).flatMap(([k, pos]) => [
        <Handle key={'s' + k} type="source" id={k} position={pos} />,
        <Handle key={'t' + k} type="target" id={k} position={pos} />,
      ])}
    </div>
  );
});
const NoteNode = memo(({ data }) => <div className="sp-note" style={{ width: data.w }}>{data.text}</div>);
const nodeTypes = { window: WindowNode, note: NoteNode };

// canvas.json -> nodes and edges. The screen keeps its x/y; the header sits
// above it, so the node starts HEAD px higher. No variant folding in the spike.
function build(data, page, base) {
  const boards = data.artboards.filter((a) => a.page === page);
  const ids = new Set(boards.map((a) => a.file));
  const nodes = boards.map((a) => ({
    id: a.file, type: 'window', position: { x: a.x, y: a.y - HEAD }, width: a.w, height: a.h + HEAD,
    dragHandle: '.sp-head', data: { w: a.w, h: a.h, title: a.title || a.file, src: base + a.file },
  }));
  (data.annotations || []).filter((n) => n.page === page).forEach((n) => nodes.push({
    id: n.id, type: 'note', position: { x: n.x, y: n.y }, data: { w: Math.min(n.w || 480, 760), text: n.text },
  }));
  const edges = (data.flows || []).filter((f) => f.page === page && ids.has(f.from) && ids.has(f.to) && f.from !== f.to)
    .map((f, i) => ({
      id: 'e' + i, source: f.from, target: f.to, sourceHandle: f.fs || 'r', targetHandle: f.ts || 'l',
      label: f.label, labelStyle: { fontSize: 28 }, markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 6, strokeDasharray: f.dashed ? '18 12' : undefined },
    }));
  return { nodes, edges };
}

function App({ data, page, base }) {
  const init = useMemo(() => build(data, page, base), [data, page, base]);
  const [nodes, , onNodesChange] = useNodesState(init.nodes);
  const [edges] = useEdgesState(init.edges);
  const wrap = useRef(null), rf = useRef(null), boxes = useRef([]);
  boxes.current = nodes.filter((n) => n.type === 'window')
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height }));
  const kick = useCallback(() => schedule(() => [
    rf.current.getViewport(), { w: wrap.current.clientWidth, h: wrap.current.clientHeight }, boxes.current,
  ]), []);
  return (
    <div ref={wrap} className="sp-root">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={nodeTypes}
        minZoom={0.05} maxZoom={4} panOnScroll zoomOnPinch nodesConnectable={false} fitView
        onInit={(inst) => { rf.current = inst; window.rf = inst; kick(); }}
        onMove={kick} onMoveEnd={kick} onNodeDragStop={kick}>
        <Background gap={26} />
      </ReactFlow>
    </div>
  );
}

export function mount(el, { data, page, base = './' }) {
  const style = document.createElement('style');
  style.textContent = rfCss + CSS;
  document.head.appendChild(style);
  createRoot(el).render(<App data={data} page={page} base={base} />);
}
