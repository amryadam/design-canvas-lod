// canvas-page.jsx — reads canvas.json, groups one page's artboards into rows
// (sections) by their y coordinate, and renders them on DesignCanvas with each
// screen embedded as a lazy iframe of its .dc.html file. Flow connectors
// from canvas.json "flows" are drawn between artboards by CanvasFlows.
// Requires design-canvas.jsx to be loaded first (globals DesignCanvas etc).

// ---- Flow connectors ---------------------------------------------------------
// Renders into the canvas world (the transformed child of .design-canvas) so the
// layer pans and zooms with the artboards. Each artboard's box is measured from
// [data-dc-slot="<file>"] .dc-card and converted to world coordinates.

const CF = {
  stroke: '#b9a991', width: 2, dash: '5 6',
  arrowLen: 11, arrowHalf: 6.5,
  pill: { font: '600 12.5px/1 Inter, -apple-system, system-ui, sans-serif', color: '#6b6456', bg: '#fff', border: '1px solid #e5e0d7', shadow: '0 1px 2px rgba(40,32,22,.07)' },
};
const CF_NORMAL = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

function cfAnchor(box, side) {
  const { x, y, w, h } = box;
  if (side === 'l') return { x, y: y + h / 2 };
  if (side === 'r') return { x: x + w, y: y + h / 2 };
  if (side === 't') return { x: x + w / 2, y };
  return { x: x + w / 2, y: y + h };
}

// Cubic bezier between two anchors; control points pushed along each outward
// normal. When both anchors are vertical, k is clamped so a return curve stays
// inside the gap between rows instead of arcing into the row above.
function cfCurve(a, fs, b, ts) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  let k = Math.max(70, dist * 0.42);
  const vertical = (s) => s === 't' || s === 'b';
  if (vertical(fs) && vertical(ts)) k = Math.min(k, 70);
  const [nx1, ny1] = CF_NORMAL[fs] || CF_NORMAL.r;
  const [nx2, ny2] = CF_NORMAL[ts] || CF_NORMAL.l;
  const c1 = { x: a.x + nx1 * k, y: a.y + ny1 * k };
  const c2 = { x: b.x + nx2 * k, y: b.y + ny2 * k };
  const at = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
  };
  const angle = Math.atan2(b.y - c2.y, b.x - c2.x);
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid: at(0.5), angle };
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
    const card = slot && slot.querySelector('.dc-card');
    let b = null;
    if (card) {
      const r = card.getBoundingClientRect();
      b = { x: (r.left - wr.left) / scale, y: (r.top - wr.top) / scale, w: r.width / scale, h: r.height / scale };
    }
    boxes.set(file, b);
    return b;
  };
  const out = [];
  flows.forEach((f, i) => {
    const fb = box(f.from), tb = box(f.to);
    if (!fb || !tb) return; // slot not in the DOM (hidden, or not this page)
    const a = cfAnchor(fb, f.fs), b = cfAnchor(tb, f.ts);
    out.push({ key: `${f.from}>${f.to}#${i}`, ...cfCurve(a, f.fs, b, f.ts), end: b, label: f.label, dashed: !!f.dashed });
  });
  // Signature lets the caller skip a React update when nothing moved.
  out.sig = out.map((o) => o.d).join('|');
  return out;
}

function CanvasFlows({ flows }) {
  const [world, setWorld] = React.useState(null);
  const [paths, setPaths] = React.useState([]);

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
      // The world's own style changes on every pan/zoom; world coordinates don't.
      if (recs.some((r) => r.target !== world)) schedule();
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
        {paths.map((p) => (
          <g key={p.key} fill="none" stroke={CF.stroke} strokeWidth={CF.width} strokeLinecap="round" strokeLinejoin="round">
            <path d={p.d} strokeDasharray={p.dashed ? CF.dash : undefined} vectorEffect="non-scaling-stroke" />
            <polygon points={cfArrow(p.end, p.angle)} fill={CF.stroke} stroke="none"
              style={{ transform: 'scale(var(--dc-inv-zoom, 1))', transformOrigin: `${p.end.x}px ${p.end.y}px` }} />
          </g>
        ))}
      </svg>
      {paths.map((p) => p.label && (
        <div key={p.key} style={{
          position: 'absolute', left: p.mid.x, top: p.mid.y, transform: 'translate(-50%, -50%) scale(var(--dc-inv-zoom, 1))',
          font: CF.pill.font, color: CF.pill.color, background: CF.pill.bg, border: CF.pill.border,
          borderRadius: 999, padding: '5px 11px', boxShadow: CF.pill.shadow, whiteSpace: 'nowrap',
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
  if (!data) return <div style={{ height: '100vh', background: '#f0eee9' }} />;

  const boards = data.artboards.filter((a) => a.page === page);
  const notes = data.annotations.filter((a) => a.page === page);
  const pageName = (data.pages.find((p) => p.id === page) || {}).name || page;

  // Rows: distinct y values, in order.
  const ys = [...new Set(boards.map((b) => b.y))].sort((a, b) => a - b);
  const rows = ys.map((y, i) => {
    const items = boards.filter((b) => b.y === y).sort((a, b) => a.x - b.x);
    // Short annotation sitting just above the row → its title.
    const titleNote = notes.filter((n) => n.text.length < 90 && n.y < y && n.y >= y - 450 && !n.text.includes('\n'))
      .sort((a, b) => b.y - a.y)[0];
    return { y, items, title: titleNote ? titleNote.text : (ys.length > 1 ? `Row ${i + 1}` : pageName), titleNote };
  });
  const used = new Set(rows.map((r) => r.titleNote).filter(Boolean));
  // Remaining notes attach to the first row whose y is at or after them (else the first row).
  const longNotes = notes.filter((n) => !used.has(n));
  rows.forEach((r) => (r.notes = []));
  longNotes.forEach((n) => {
    const r = rows.find((row) => row.y >= n.y) || rows[0];
    if (r) r.notes.push(n);
  });

  return (
    <DesignCanvas stateFile={stateFile || `.design-canvas.${page}.state.json`}>
      {rows.map((r, i) => (
        <DCSection key={r.y} id={`${page}-row-${i}`} title={r.title}
          subtitle={i === 0 ? `${boards.length} screens` : undefined}>
          {r.notes.map((n) => <DCPostIt key={n.id} width={Math.min(n.w || 480, 760)}>{n.text}</DCPostIt>)}
          {r.items.map((b) => {
            const stem = b.file.split('/').pop().replace('.dc.html', '');
            return (
              <DCArtboard key={b.file} id={b.file} label={b.title || stem}
                width={b.w} height={b.h} href={'./' + b.file}>
                <DCLazyFrame src={'./' + b.file} href={b.file} title={b.title || b.file} width={b.w} height={b.h} />
              </DCArtboard>
            );
          })}
        </DCSection>
      ))}
      <CanvasFlows flows={flows} />
    </DesignCanvas>
  );
}

window.CanvasPage = CanvasPage;
window.CanvasFlows = CanvasFlows;
