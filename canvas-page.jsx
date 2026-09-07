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
  // Line, dash and arrowhead match fatoora's flow map (flow-map.jsx FmConnectors).
  stroke: '#b9a991', hover: '#c96442', width: 2, dash: '5 6',
  arrowLen: 11, arrowHalf: 6.5,
  // Pills and arrowheads hold screen size down to 8% zoom (a whole flow map
  // on one screen, as in fatoora), then shrink with the world so they never
  // balloon over the artboards when zoomed far out.
  inv: 'min(var(--dc-inv-zoom, 1), 12)',
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
// travel; `m1`/`m2` scale the tangent lengths at a and b, `mi` the interior ones.
function cfVia(pts, fs, ts, m1, m2, mi = 0.5) {
  const [[nx1, ny1], [nx2, ny2]] = cfNormals(fs, ts);
  const n = pts.length - 1, segs = [];
  // Unit direction of travel through point i (previous point → next point).
  const dirAt = (i) => { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n, i + 1)]; const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }; };
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1], len = Math.hypot(q.x - p.x, q.y - p.y);
    const k0 = Math.max(40, len * 0.4 * (i === 0 ? m1 : 1)), k1 = Math.max(40, len * 0.4 * (i === n - 1 ? m2 : 1));
    const t0 = i === 0 ? { x: nx1, y: ny1 } : dirAt(i), t1 = i === n - 1 ? { x: -nx2, y: -ny2 } : dirAt(i + 1);
    const f0 = i === 0 ? 1 : mi, f1 = i === n - 1 ? 1 : mi;
    segs.push(cfSeg(p, { x: p.x + t0.x * k0 * f0, y: p.y + t0.y * k0 * f0 }, { x: q.x - t1.x * k1 * f1, y: q.y - t1.y * k1 * f1 }, q));
  }
  const at = (t) => { const i = Math.min(n - 1, Math.floor(t * n)); return segs[i].at(t * n - i); };
  return { d: segs.map((g, i) => (i ? g.d.replace(/^M [^C]+/, '') : g.d)).join(' '), mid: at(0.5), angle: segs[n - 1].angle, at };
}

// Tangent-length scales (source, target) tried when smoothing a routed path.
const CF_TANGENT_SCALES = [[1, 1], [0.6, 0.6], [0.35, 0.35], [1, 0.4], [0.4, 1], [1.5, 1.5]];

// Does the straight segment p→q pass through rect r? (Liang–Barsky clip.)
function cfSegHits(p, q, r) {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = 0, t1 = 1;
  const clip = (den, num) => {
    if (den === 0) return num >= 0;
    const t = num / den;
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, p.x - r.x) && clip(dx, r.x + r.w - p.x) && clip(-dy, p.y - r.y) && clip(dy, r.y + r.h - p.y);
}
const cfClear = (p, q, obstacles) => !obstacles.some((r) => cfSegHits(p, q, r));

// Shortest clear polyline from a to b: a visibility graph over the padded
// corners of every page and note, searched with Dijkstra. Each anchor first
// steps out along its side's normal so the curve leaves the page squarely.
// Returns the interior waypoints (may be empty), or null when no clear path
// exists at all.
const CF_CORNER = 40, CF_EXIT = 48, CF_BEND_COST = 120;
function cfPath(a, fs, b, ts, obstacles) {
  const [[nx1, ny1], [nx2, ny2]] = cfNormals(fs, ts);
  const free = (p) => !obstacles.some((r) => cfInside(p, r));
  const step = (p, nx, ny) => { const q = { x: p.x + nx * CF_EXIT, y: p.y + ny * CF_EXIT }; return free(q) ? q : p; };
  const a1 = step(a, nx1, ny1), b1 = step(b, nx2, ny2);
  const nodes = [a1, b1];
  for (const r of obstacles) {
    const G = CF_CORNER;
    for (const c of [{ x: r.x - G, y: r.y - G }, { x: r.x + r.w + G, y: r.y - G }, { x: r.x - G, y: r.y + r.h + G }, { x: r.x + r.w + G, y: r.y + r.h + G }]) if (free(c)) nodes.push(c);
  }
  const n = nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) return null;
    if (u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const p = nodes[u], q = nodes[v];
      const d = dist[u] + Math.hypot(q.x - p.x, q.y - p.y) + (v === 1 ? 0 : CF_BEND_COST);
      if (d < dist[v] && cfClear(p, q, obstacles)) { dist[v] = d; prev[v] = u; }
    }
  }
  const pts = [];
  for (let v = prev[1]; v > 0; v = prev[v]) pts.unshift(nodes[v]);
  if (a1 !== a) pts.unshift(a1);
  if (b1 !== b) pts.push(b1);
  return pts;
}

// Route a → b around every page and note that is not an endpoint. The plain
// S-curve wins when it is already clear; otherwise the shortest clear polyline
// from cfPath is smoothed with the tangent scale that keeps it clear. If no
// candidate is fully clear, the one that crosses the least is drawn.
function cfRoute(a, fs, b, ts, obstacles) {
  const plain = cfCurve(a, fs, b, ts);
  if (!obstacles.length) return plain;
  let best = plain, bestHits = cfHits(plain, obstacles);
  if (!bestHits) return plain;
  const consider = (c) => { const h = cfHits(c, obstacles, CF_SAMPLES * 4); if (h < bestHits) { best = c; bestHits = h; } return h === 0; };
  for (const m of [0.6, 0.35, 0.2, 1.6, 2.4]) if (consider(cfCurve(a, fs, b, ts, m))) return best;
  const via = cfPath(a, fs, b, ts, obstacles);
  if (via && via.length) {
    for (const mi of [0.5, 0.25, 0.1]) for (const [m1, m2] of CF_TANGENT_SCALES) if (consider(cfVia([a, ...via, b], fs, ts, m1, m2, mi))) return best;
  }
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

// Slide each label along its curve (from the middle outwards) until its pill
// overlaps no pill placed before it. Pills hold screen size, so their world
// footprint is the screen size over the current zoom.
const CF_LABEL_T = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
function cfPlaceLabels(paths, s) {
  const placed = [];
  const pill = (p, t) => { const c = p.at(t); const w = (p.label.length * 7.2 + 24) / s, h = 28 / s; return { x: c.x - w / 2, y: c.y - h / 2, w, h, c }; };
  const overlaps = (r) => placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
  for (const p of paths) {
    if (!p.label) continue;
    let best = pill(p, 0.5);
    for (const t of CF_LABEL_T) { const r = pill(p, t); if (!overlaps(r)) { best = r; break; } }
    p.mid = best.c;
    placed.push(best);
  }
}

// Whole-pixel world boxes: measurements at different zooms differ by float
// noise, and a changed signature would re-render every connector for nothing.
const cfRound = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

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
      b = cfRound({ x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale });
    }
    boxes.set(file, b);
    return b;
  };
  // Every page and note is an obstacle for every flow (see `obstacles` below).
  const PAD = 24;
  const pad = (r, file) => ({ file, x: r.x - PAD, y: r.y - PAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD });
  const allBoxes = [];
  slots.forEach((_, file) => { const r = box(file); if (r) allBoxes.push(pad(r, file)); });
  world.querySelectorAll('[data-dc-note]').forEach((el) => {
    const r = el.getBoundingClientRect();
    allBoxes.push(pad(cfRound({ x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale }), null));
  });
  const out = [];
  flows.forEach((f, i) => {
    const fb = box(f.from), tb = box(f.to);
    if (!fb || !tb) return; // slot not in the DOM (hidden, or not this page)
    const a = cfAnchor(fb, f.fs), b = cfAnchor(tb, f.ts);
    // Other pages and notes with their padding, plus the two endpoint pages
    // unpadded, so the curve can leave an anchor but never swing back across
    // its own page.
    const obstacles = allBoxes.filter((r) => r.file !== f.from && r.file !== f.to).concat([{ file: f.from, ...fb }, { file: f.to, ...tb }]);
    const curve = cfRoute(a, f.fs, b, f.ts, obstacles);
    out.push({ key: `${f.from}>${f.to}#${i}`, d: curve.d, mid: curve.mid, angle: curve.angle, end: b, label: f.label, dashed: !!f.dashed, at: curve.at });
  });
  cfPlaceLabels(out, Math.max(scale, 1 / 12));
  // Signature lets the caller skip a React update when nothing moved.
  out.sig = out.map((o) => o.d + '@' + Math.round(o.mid.x) + ',' + Math.round(o.mid.y)).join('|');
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
    // Zoom changes where label pills land (they hold screen size), so measure
    // once more shortly after the world's transform settles.
    let zoomTimer = 0;
    const mo = new MutationObserver((recs) => {
      let moved = false, zoomed = false;
      for (const r of recs) {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (!t) continue;
        if (t === world) { zoomed = true; continue; }
        // Anything inside a card (iframe mounts, snapshot swaps) never changes
        // card geometry, and our own layer's re-render must not re-trigger us.
        if (t.closest('.dc-card') || t.closest('.dc-flows')) continue;
        moved = true;
      }
      if (moved) schedule();
      else if (zoomed) { clearTimeout(zoomTimer); zoomTimer = setTimeout(measure, 200); }
    });
    mo.observe(world, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', schedule);
    return () => {
      off = true; cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(zoomTimer);
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
