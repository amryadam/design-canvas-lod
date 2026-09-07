// canvas-page.jsx — reads canvas.json and renders one page as a single free
// canvas: every artboard and note at its own x/y, each screen embedded as a
// lazy iframe of its .dc.html file. Flow connectors
// from canvas.json "flows" are drawn between artboards by CanvasFlows.
// Requires design-canvas.jsx to be loaded first (globals DesignCanvas etc).

// ---- Flow connectors ---------------------------------------------------------
// Renders into the canvas world (the transformed child of .design-canvas) so the
// layer pans and zooms with the artboards. Each artboard's box is measured from
// the [data-dc-slot="<file>"] element itself (never the .dc-card inside it —
// that has content-visibility:auto, and reading its rect would force layout of
// off-screen skipped subtrees) and converted to world coordinates.

const CF = {
  stroke: '#b9a991', hover: '#c96442', width: 3, dash: '6 7',
  arrowLen: 14, arrowHalf: 8,
  // Pills and arrowheads hold screen size down to 25% zoom, then shrink with
  // the world, so they never balloon over the artboards when zoomed far out.
  inv: 'min(var(--dc-inv-zoom, 1), 4)',
  pill: { font: '600 12.5px/1 Inter, -apple-system, system-ui, sans-serif', color: '#6b6456', bg: '#fff', border: '1px solid #e5e0d7', shadow: '0 1px 2px rgba(40,32,22,.07)' },
};
const CF_NORMAL = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
// Outward normals of the source and target sides; unknown sides read as r → l.
const cfNormals = (fs, ts) => [CF_NORMAL[fs] || CF_NORMAL.r, CF_NORMAL[ts] || CF_NORMAL.l];

function cfAnchor(box, side) {
  const { x, y, w, h } = box;
  if (side === 'l') return { x, y: y + h / 2 };
  if (side === 'r') return { x: x + w, y: y + h / 2 };
  if (side === 't') return { x: x + w / 2, y };
  return { x: x + w / 2, y: y + h };
}

// Cubic bezier between two anchors; control points pushed along each outward
// normal, fatoora-style: k = max(70, dist * 0.42), so opposite-facing pairs
// (r→l, b→t) draw a full S-curve. Only same-side pairs (b→b, t→t) get a
// bounded bulge, or the loop would swing into the neighbouring row.
function cfCurve(a, fs, b, ts, kMul = 1) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  let k = Math.max(70, dist * 0.42);
  if (fs === ts && (fs === 't' || fs === 'b')) k = Math.min(k, Math.max(90, dist * 0.3));
  k *= kMul;
  const [[nx1, ny1], [nx2, ny2]] = cfNormals(fs, ts);
  return cfSeg(a, { x: a.x + nx1 * k, y: a.y + ny1 * k }, { x: b.x + nx2 * k, y: b.y + ny2 * k }, b);
}

// One cubic segment with a point sampler.
function cfSeg(a, c1, c2, b) {
  const at = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
  };
  const angle = Math.atan2(b.y - c2.y, b.x - c2.x);
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid: at(0.5), angle, at };
}

const cfInside = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
// Number of sample points that fall inside an obstacle; 0 means the curve is
// clear. Every candidate is sampled at the same density so counts compare.
const CF_SAMPLES = 24;
function cfHits(curve, obstacles, n = CF_SAMPLES) {
  let hits = 0;
  for (let i = 1; i < n; i++) {
    const p = curve.at(i / n);
    for (const r of obstacles) if (cfInside(p, r)) { hits++; break; }
  }
  return hits;
}

// Smooth multi-segment curve through `pts` (first = a, last = b). End tangents
// follow the anchors' normals, interior tangents follow the direction of
// travel; `m1`/`m2` scale the tangent lengths at a and b.
function cfVia(pts, fs, ts, m1, m2) {
  const [[nx1, ny1], [nx2, ny2]] = cfNormals(fs, ts);
  const n = pts.length - 1, segs = [];
  // Unit direction of travel through point i (previous point → next point).
  const dirAt = (i) => { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n, i + 1)]; const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }; };
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1], len = Math.hypot(q.x - p.x, q.y - p.y);
    const k0 = Math.max(40, len * 0.4 * (i === 0 ? m1 : 1)), k1 = Math.max(40, len * 0.4 * (i === n - 1 ? m2 : 1));
    const t0 = i === 0 ? { x: nx1, y: ny1 } : dirAt(i), t1 = i === n - 1 ? { x: -nx2, y: -ny2 } : dirAt(i + 1);
    const f0 = i === 0 ? 1 : 0.5, f1 = i === n - 1 ? 1 : 0.5;
    segs.push(cfSeg(p, { x: p.x + t0.x * k0 * f0, y: p.y + t0.y * k0 * f0 }, { x: q.x - t1.x * k1 * f1, y: q.y - t1.y * k1 * f1 }, q));
  }
  const at = (t) => { const i = Math.min(n - 1, Math.floor(t * n)); return segs[i].at(t * n - i); };
  return { d: segs.map((g, i) => (i ? g.d.replace(/^M [^C]+/, '') : g.d)).join(' '), mid: at(0.5), angle: segs[n - 1].angle, at };
}

// Tangent-length scales (source, target) tried for each bend. Short target
// tangents let a curve slip into a narrow gap under a neighbouring page.
const CF_TANGENT_SCALES = [[1, 1], [1, 0.5], [0.5, 0.2], [0.2, 0.1]];

// Route a→b around pages. Candidates, in order: the plain curve, the same
// curve with shorter or longer tangents, a bend through one waypoint beside
// the first page the plain curve enters, then a run along one edge of that
// page through its two corners. The first clean candidate wins; otherwise the
// one that crosses the least.
function cfRoute(a, fs, b, ts, obstacles) {
  const plain = cfCurve(a, fs, b, ts);
  if (!obstacles.length) return plain;
  let best = plain, bestHits = cfHits(plain, obstacles);
  if (!bestHits) return plain;
  const consider = (c) => { const h = cfHits(c, obstacles); if (h < bestHits) { best = c; bestHits = h; } return h === 0; };
  for (const m of [0.6, 0.35, 0.2, 1.6, 2.4]) if (consider(cfCurve(a, fs, b, ts, m))) return best;
  let hit = null;
  for (let i = 1; i < CF_SAMPLES && !hit; i++) { const p = plain.at(i / CF_SAMPLES); hit = obstacles.find((r) => cfInside(p, r)) || null; }
  if (!hit) return best;
  const M = 60, L = hit.x - M, R = hit.x + hit.w + M, T = hit.y - M, B = hit.y + hit.h + M;
  const cx = Math.min(Math.max((a.x + b.x) / 2, hit.x), hit.x + hit.w);
  const cy = Math.min(Math.max((a.y + b.y) / 2, hit.y), hit.y + hit.h);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const byDistanceToMid = (p, q) => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y);
  const ways = [{ x: L, y: cy }, { x: R, y: cy }, { x: cx, y: T }, { x: cx, y: B }].sort(byDistanceToMid);
  for (const w of ways) for (const [m1, m2] of CF_TANGENT_SCALES) if (consider(cfVia([a, w, b], fs, ts, m1, m2))) return best;
  // Edge runs: the two corners of one side, nearest corner to a first.
  const edges = [[{ x: L, y: T }, { x: R, y: T }], [{ x: L, y: B }, { x: R, y: B }], [{ x: L, y: T }, { x: L, y: B }], [{ x: R, y: T }, { x: R, y: B }]]
    .map(([p, q]) => (Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(q.x - a.x, q.y - a.y) ? [p, q] : [q, p]))
    .sort((e, f) => byDistanceToMid({ x: (e[0].x + e[1].x) / 2, y: (e[0].y + e[1].y) / 2 }, { x: (f[0].x + f[1].x) / 2, y: (f[0].y + f[1].y) / 2 }));
  for (const [c1, c2] of edges) for (const [m1, m2] of CF_TANGENT_SCALES) if (consider(cfVia([a, c1, c2, b], fs, ts, m1, m2))) return best;
  return best;
}

function cfArrow(p, angle) {
  const L = CF.arrowLen, H = CF.arrowHalf;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const bx = p.x - cos * L, by = p.y - sin * L;
  const l = { x: bx - sin * H, y: by + cos * H };
  const r = { x: bx + sin * H, y: by - cos * H };
  return `${p.x},${p.y} ${l.x},${l.y} ${r.x},${r.y}`;
}

function cfMeasure(world, flows) {
  const wr = world.getBoundingClientRect();
  const scale = wr.width / world.offsetWidth || 1;
  // One DOM query for all slots; each card is measured at most once per pass.
  const slots = new Map();
  world.querySelectorAll('[data-dc-slot]').forEach((el) => slots.set(el.dataset.dcSlot, el));
  const boxes = new Map();
  const box = (file) => {
    if (boxes.has(file)) return boxes.get(file);
    const slot = slots.get(file);
    let b = null;
    if (slot) {
      const r = slot.getBoundingClientRect();
      b = { x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale };
    }
    boxes.set(file, b);
    return b;
  };
  // Every page and note is an obstacle for every flow that does not start or
  // end on it.
  const PAD = 24;
  const pad = (r, file) => ({ file, x: r.x - PAD, y: r.y - PAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD });
  const allBoxes = [];
  slots.forEach((_, file) => { const r = box(file); if (r) allBoxes.push(pad(r, file)); });
  world.querySelectorAll('[data-dc-note]').forEach((el) => {
    const r = el.getBoundingClientRect();
    allBoxes.push(pad({ x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale }, null));
  });
  const out = [];
  flows.forEach((f, i) => {
    const fb = box(f.from), tb = box(f.to);
    if (!fb || !tb) return; // slot not in the DOM (hidden, or not this page)
    const a = cfAnchor(fb, f.fs), b = cfAnchor(tb, f.ts);
    const obstacles = allBoxes.filter((r) => r.file !== f.from && r.file !== f.to);
    const { d, mid, angle } = cfRoute(a, f.fs, b, f.ts, obstacles);
    out.push({ key: `${f.from}>${f.to}#${i}`, d, mid, angle, end: b, label: f.label, dashed: !!f.dashed });
  });
  // Signature lets the caller skip a React update when nothing moved.
  out.sig = out.map((o) => o.d).join('|');
  return out;
}

function CanvasFlows({ flows }) {
  const [world, setWorld] = React.useState(null);
  const [paths, setPaths] = React.useState([]);
  const [hover, setHover] = React.useState(null);

  React.useEffect(() => {
    const el = document.querySelector('.design-canvas > div');
    if (el) setWorld(el);
  }, []);

  React.useEffect(() => {
    if (!world || !flows.length) return;
    let raf = 0, timer = 0, off = false;
    const measure = () => {
      if (off) return;
      const next = cfMeasure(world, flows);
      setPaths((prev) => (prev.sig === next.sig ? prev : next));
    };
    // Slots animate their transform for 180ms; measure now and again after that.
    const schedule = () => {
      cancelAnimationFrame(raf); clearTimeout(timer);
      raf = requestAnimationFrame(measure);
      timer = setTimeout(measure, 240);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(world);
    const mo = new MutationObserver((recs) => {
      // Skip the world's own pan/zoom style writes AND anything inside a card:
      // iframe mounts / snapshot swaps never change card geometry, and reacting
      // to them caused a re-measure storm while slots were going live.
      if (recs.some((r) => {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        return t && t !== world && !t.closest('.dc-card');
      })) schedule();
    });
    mo.observe(world, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', schedule);
    return () => {
      off = true; cancelAnimationFrame(raf); clearTimeout(timer);
      ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', schedule);
    };
  }, [world, flows]);

  if (!world || !paths.length) return null;
  return ReactDOM.createPortal(
    <div className="dc-flows" style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 5 }}>
      <svg width="1" height="1" style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
        {paths.map((p, i) => {
          const on = hover === i, dim = hover != null && !on;
          const ink = on ? CF.hover : CF.stroke;
          return (
            <g key={p.key} fill="none" stroke={ink} strokeWidth={CF.width} strokeLinecap="round" strokeLinejoin="round"
              opacity={dim ? 0.3 : 1} style={{ transition: 'opacity .15s' }}>
              <path d={p.d} strokeDasharray={p.dashed ? CF.dash : undefined} vectorEffect="non-scaling-stroke" />
              <polygon points={cfArrow(p.end, p.angle)} fill={ink} stroke="none"
                style={{ transform: `scale(${CF.inv})`, transformOrigin: `${p.end.x}px ${p.end.y}px` }} />
              <path d={p.d} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'stroke' }} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {paths.map((p, i) => p.label && (
        <div key={p.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{
          position: 'absolute', left: p.mid.x, top: p.mid.y, transform: `translate(-50%, -50%) scale(${CF.inv})`,
          font: CF.pill.font, color: hover === i ? CF.hover : CF.pill.color, background: CF.pill.bg,
          border: hover === i ? `1px solid ${CF.hover}` : CF.pill.border, opacity: hover != null && hover !== i ? 0.35 : 1,
          borderRadius: 999, padding: '5px 11px', boxShadow: CF.pill.shadow, whiteSpace: 'nowrap',
          pointerEvents: 'auto', transition: 'opacity .15s, color .15s, border-color .15s',
        }}>{p.label}</div>
      ))}
    </div>,
    world,
  );
}

// ---- Page ------------------------------------------------------------------

function CanvasPage({ page, stateFile }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    fetch('./canvas.json').then((r) => r.json()).then(setData).catch((e) => console.error('[canvas-page]', e));
  }, []);
  const flows = React.useMemo(() => ((data && data.flows) || []).filter((f) => f.page === page), [data, page]);
  // One free canvas per page: every artboard and note sits at its canvas.json
  // x/y, relative to the page's top-left corner (notes can sit above y = 0).
  // Memoised so DCSection's layout memo sees stable objects.
  const layout = React.useMemo(() => {
    if (!data) return null;
    const boards = data.artboards.filter((a) => a.page === page);
    const notes = data.annotations.filter((a) => a.page === page);
    const bandOf = (b) => (b.band != null ? b.band : b.y);
    const items = boards.slice().sort((a, b) => bandOf(a) - bandOf(b) || a.x - b.x);
    const all = [...boards, ...notes];
    const minX = Math.min(...all.map((o) => o.x)), minY = Math.min(...all.map((o) => o.y));
    const positions = Object.fromEntries(items.map((b) => [b.file, { x: b.x - minX, y: b.y - minY }]));
    const notePositions = Object.fromEntries(notes.map((n) => [n.id, { x: n.x - minX, y: n.y - minY, w: Math.min(n.w || 480, 760) }]));
    return { boards, notes, items, positions, notePositions };
  }, [data, page]);
  if (!data) return <div style={{ height: '100vh', background: '#f0eee9' }} />;

  const { boards, notes, items, positions, notePositions } = layout;
  const pageName = (data.pages.find((p) => p.id === page) || {}).name || page;

  return (
    <DesignCanvas stateFile={stateFile || `.design-canvas.${page}.state.json`}>
      <DCSection id={page} title={pageName} subtitle={`${boards.length} screens`} positions={positions} notePositions={notePositions}>
        {notes.map((n) => <DCPostIt key={n.id} id={n.id} width={notePositions[n.id].w}>{n.text}</DCPostIt>)}
        {items.map((b) => {
          const stem = b.file.split('/').pop().replace('.dc.html', '');
          return (
            <DCArtboard key={b.file} id={b.file} label={b.title || stem}
              width={b.w} height={b.h} href={'./' + b.file}>
              <DCLazyFrame src={'./' + b.file} href={b.file} title={b.title || b.file} width={b.w} height={b.h} />
            </DCArtboard>
          );
        })}
      </DCSection>
      <CanvasFlows flows={flows} />
    </DesignCanvas>
  );
}

window.CanvasPage = CanvasPage;
window.CanvasFlows = CanvasFlows;
