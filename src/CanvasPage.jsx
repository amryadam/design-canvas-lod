import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, applyNodeChanges, MarkerType } from '@xyflow/react';
import { DC } from './constants.js';
import { PageCtx } from './context.js';
import { readPage, buildNodes, buildEdges, actions, screenOf } from './mapping.js';
import { createLiveBudget, boxesOf } from './liveBudget.js';
import { restoreState, createSaver, stateKey } from './persist.js';
import { fitView, anyOnScreen, isMouseWheel, zoomAround, createInvZoom } from './view.js';
import { createHost } from './host.js';
import WindowNode from './WindowNode.jsx';
import NoteNode from './NoteNode.jsx';
import SectionHead from './SectionHead.jsx';
import FlowEdge from './FlowEdge.jsx';
import BackPill from './BackPill.jsx';

const nodeTypes = { window: WindowNode, note: NoteNode, head: SectionHead };
const edgeTypes = { flow: FlowEdge };
// The arrowhead is in stroke-width units, so it keeps its screen size with
// the stroke (see .react-flow__edge-path in styles.css).
const EDGE_DEFAULTS = { type: 'flow', markerEnd: { type: MarkerType.ArrowClosed, color: '#b9a991', width: 5.5, height: 6.5 } };
const clampZoom = (z) => Math.min(DC.maxZoom, Math.max(DC.minZoom, z));

// Loads canvas.json (or takes it from the host as `data`) and shows one page.
// With no `page`, the first page of canvas.json.
export function CanvasPage({ page: pageId, data: given, stateFile, base = './', host = {}, onApi }) {
  const [data, setData] = useState(given || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (given) { setData(given); return undefined; }
    let off = false;
    fetch('./canvas.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { if (!off) setData(d); })
      .catch((e) => { if (!off) setError(String((e && e.message) || e)); });
    return () => { off = true; };
  }, [given]);
  if (error) return <div className="dc-root dc-error">canvas.json did not load: {error}</div>;
  if (!data) return <div className="dc-root" />;
  const id = pageId || (data.pages && data.pages[0] && data.pages[0].id);
  const file = stateFile || `.design-canvas.${id}.v2.state.json`;
  return <Page key={id + '\n' + file} data={data} pageId={id} stateFile={file} base={base} hostOpts={host} onApi={onApi} />;
}

function Page({ data, pageId, stateFile, base, hostOpts, onApi }) {
  const key = stateKey(stateFile);
  const viewKey = 'dc2-view:' + location.pathname + ':' + pageId;
  const page = useMemo(() => readPage(data, pageId, { base }), [data, pageId, base]);

  // Saved state. Nothing draws and nothing saves before the restore ends.
  const [state, setState] = useState(null);
  const restored = useRef(null);
  useEffect(() => {
    let off = false;
    restoreState({ stateFile, key }).then((s) => { if (!off) { restored.current = s; setState(s); } });
    return () => { off = true; };
  }, [stateFile, key]);
  const saver = useMemo(() => createSaver({ stateFile, key }), [stateFile, key]);
  useEffect(() => () => saver.dispose(), [saver]);
  useEffect(() => { if (state && state !== restored.current) saver.save(state); }, [state, saver]);
  const update = useCallback((fn) => setState((s) => (s ? fn(s) : s)), []);

  // Nodes and edges. A drag moves the node in `nodes`; the drop saves it, and
  // the saved state then builds the same position again.
  const cache = useRef(new Map());
  const built = useMemo(() => (state ? buildNodes(page, state, cache.current) : null), [page, state]);
  const edges = useMemo(() => (state ? buildEdges(page, state) : []), [page, state]);
  const [nodes, setNodes] = useState([]);
  // A node object without `measured` makes React Flow measure the node again
  // and hide it and its arrows until then: a blink on each edit. The rebuilt
  // nodes keep the last measure; a new size reaches React Flow through its
  // resize observer.
  useEffect(() => {
    if (!built) return;
    setNodes((prev) => {
      const last = new Map(prev.map((n) => [n.id, n.measured]));
      return built.map((n) => (last.get(n.id) ? { ...n, measured: last.get(n.id) } : n));
    });
  }, [built]);
  const onNodesChange = useCallback((changes) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // The view.
  const rootRef = useRef(null);
  const [rf, setRf] = useState(null);
  const rfRef = useRef(null);
  rfRef.current = rf;
  const pane = useCallback(() => ({
    w: rootRef.current ? rootRef.current.clientWidth : 0,
    h: rootRef.current ? rootRef.current.clientHeight : 0,
  }), []);
  const boxes = useRef([]);
  boxes.current = boxesOf(nodes);
  const content = useCallback(() => (rfRef.current ? rfRef.current.getNodes() : []).filter((n) => n.type !== 'head'), []);
  const contentBoxes = useCallback(() => content().map((n) => ({
    x: n.position.x, y: n.position.y,
    w: n.width ?? (n.measured && n.measured.width) ?? 0, h: n.height ?? (n.measured && n.measured.height) ?? 0,
  })), [content]);
  const inv = useMemo(() => createInvZoom(() => rootRef.current), []);

  // The live budget (spike rules 3 and 4).
  const budget = useMemo(() => createLiveBudget({
    read: () => ({ view: rfRef.current ? rfRef.current.getViewport() : { x: 0, y: 0, zoom: 1 }, pane: pane(), boxes: boxes.current }),
  }), [pane]);
  useEffect(() => () => budget.dispose(), [budget]);
  useEffect(() => { if (rf) budget.schedule(); }, [rf, built, budget]);

  // The first view: the saved one, else a fit. It waits for the restore.
  const [fitted, setFitted] = useState(false);
  useEffect(() => {
    if (fitted || !rf || !nodes.length) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(viewKey) || 'null'); } catch {}
    const view = saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)
      ? { x: saved.x, y: saved.y, zoom: clampZoom(saved.zoom) }
      : fitView(rf.getNodesBounds(nodes.filter((n) => n.type !== 'head')), pane());
    rf.setViewport(view);
    inv(view.zoom, true);
    setFitted(true);
  }, [fitted, rf, nodes, viewKey, pane, inv]);

  // The host protocol. hostOpts is read once, at start.
  const hostRef = useRef(null);
  useEffect(() => {
    if (!rf) return undefined;
    const h = createHost({ getZoom: () => rf.getZoom(), zoomTo: (s) => rf.zoomTo(s), ...hostOpts });
    hostRef.current = h;
    return () => { h.dispose(); hostRef.current = null; };
  }, [rf]);

  // Back to content: shown once the view settles with no content on screen,
  // hidden on the first move frame that brings content back.
  const [lost, setLost] = useState(false);
  const lostRef = useRef(false);
  lostRef.current = lost;
  const lostTimer = useRef(0);
  useEffect(() => () => clearTimeout(lostTimer.current), []);
  const checkLost = useCallback(() => {
    clearTimeout(lostTimer.current);
    lostTimer.current = setTimeout(() => {
      const r = rfRef.current, bs = contentBoxes();
      if (r) setLost(bs.length > 0 && !anyOnScreen(bs, r.getViewport(), pane()));
    }, DC.lostSettleMs);
  }, [contentBoxes, pane]);
  const backToContent = useCallback(() => {
    const r = rfRef.current;
    if (r) r.setViewport(fitView(r.getNodesBounds(content()), pane()), { duration: DC.backToMs });
  }, [content, pane]);

  const onMoveStart = useCallback(() => budget.moveStart(), [budget]);
  const onMove = useCallback((e, vp) => {
    inv(vp.zoom);
    if (lostRef.current && anyOnScreen(contentBoxes(), vp, pane())) setLost(false);
  }, [inv, contentBoxes, pane]);
  const onMoveEnd = useCallback((e, vp) => {
    budget.moveEnd();
    inv(vp.zoom, true);
    if (hostRef.current) hostRef.current.settled();
    try { localStorage.setItem(viewKey, JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom })); } catch {}
    checkLost();
  }, [budget, inv, viewKey, checkLost]);

  // A card drag holds the budget like a pan does. The drop saves the place
  // and marks the window as touched, so it keeps its place in the budget.
  // With nodeDragThreshold 0 (see constants.js), React Flow starts the drag
  // at mousedown and reports a drop even when the pointer barely moved or
  // never moved at all; dragStartPos measures the drop against
  // DC.dropTolerance (the old canvas's own rule) so a click, or a drag too
  // small to be one, saves nothing and the card goes back to where it
  // started.
  const dragStartPos = useRef(null);
  // A card drag holds the budget on its own flag, so the end of a pan that
  // runs at the same time cannot free it (see liveBudget.js).
  const onNodeDragStart = useCallback((e, node) => { dragStartPos.current = { x: node.position.x, y: node.position.y }; budget.dragStart(); }, [budget]);
  const onNodeDragStop = useCallback((e, node) => {
    budget.touch(node.id);
    budget.dragEnd();
    const start = dragStartPos.current;
    dragStartPos.current = null;
    if (start && Math.hypot(node.position.x - start.x, node.position.y - start.y) < DC.dropTolerance) {
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, position: start } : n)));
      return;
    }
    if (node.type === 'window') update((s) => actions.move(s, node.id, screenOf(node.position)));
    else if (node.type === 'note') update((s) => actions.move(s, node.id, node.position));
  }, [budget, update]);

  // An arrow end moves to another side of the same window only.
  const onReconnect = useCallback((old, conn) => {
    if (conn.source !== old.source || conn.target !== old.target) return;
    const sides = {};
    if (conn.sourceHandle && conn.sourceHandle !== old.sourceHandle) sides.fs = conn.sourceHandle;
    if (conn.targetHandle && conn.targetHandle !== old.targetHandle) sides.ts = conn.targetHandle;
    if (Object.keys(sides).length) update((s) => actions.setSides(s, old.data.key, sides));
  }, [update]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !rf) return undefined;
    // A mouse wheel zooms, as in the old canvas. React Flow's own scroll
    // handling then pans for a trackpad and zooms for a pinch.
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey || !isMouseWheel(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      rf.setViewport(zoomAround(rf.getViewport(), e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.sign(e.deltaY) * DC.wheelZoomStep)));
    };
    // Ctrl (or ⌘) held: the whole window is a grip (dragHandle in mapping.js).
    const grab = (e) => el.classList.toggle('dc-grab', !!(e.ctrlKey || e.metaKey));
    const drop = () => el.classList.remove('dc-grab');
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('keydown', grab);
    window.addEventListener('keyup', grab);
    window.addEventListener('blur', drop);
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', grab);
      window.removeEventListener('keyup', grab);
      window.removeEventListener('blur', drop);
    };
  }, [rf]);

  const act = useMemo(() => ({
    pickVariant: (id, file) => update((s) => actions.pickVariant(s, id, file)),
    resetPosition: (id) => update((s) => actions.resetPosition(s, id)),
    resetSides: (id) => update((s) => actions.resetSides(s, id)),
    remove: (id) => update((s) => actions.remove(s, id)),
    move: (id, p) => update((s) => actions.move(s, id, p)),
  }), [update]);
  const ctx = useMemo(() => ({ budget, act }), [budget, act]);

  // Read by the browser suite, the blank check and perf/bench.js.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!onApi) return;
    onApi({
      rf, budget, act, fitted,
      state: () => stateRef.current,
      reconnect: (edgeId, conn) => { const e = edges.find((x) => x.id === edgeId); if (e) onReconnect(e, conn); },
    });
  }, [onApi, rf, budget, act, fitted, edges, onReconnect]);

  if (!state) return <div ref={rootRef} className="dc-root" />;
  return (
    <div ref={rootRef} className="dc-root">
      <PageCtx.Provider value={ctx}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          defaultEdgeOptions={EDGE_DEFAULTS} onNodesChange={onNodesChange} onInit={setRf}
          onMoveStart={onMoveStart} onMove={onMove} onMoveEnd={onMoveEnd}
          onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
          edgesReconnectable onReconnect={onReconnect}
          nodeDragThreshold={DC.nodeDragThreshold}
          minZoom={DC.minZoom} maxZoom={DC.maxZoom}
          panOnScroll panOnScrollSpeed={1} zoomOnPinch zoomOnDoubleClick={false}
          elementsSelectable={false} nodesFocusable={false} edgesFocusable={false}
          selectionKeyCode={null} multiSelectionKeyCode={null} deleteKeyCode={null}
          onlyRenderVisibleElements={false} />
      </PageCtx.Provider>
      {lost && <BackPill onClick={backToContent} />}
    </div>
  );
}
