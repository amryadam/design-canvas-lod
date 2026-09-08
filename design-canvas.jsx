// design-canvas.jsx — pan/zoom canvas: sections, artboards (reorder / rename /
// delete / focus), post-its. Ported from the fatoora project with performance
// work for heavy artboards (full-page iframes):
//   • DCLazyFrame mounts an iframe only when its slot is near the viewport AND
//     one of the DC.liveBudget slots nearest the viewport centre; nearness is
//     necessary but the budget decides — the rest show a placeholder, so
//     everything on screen at 5 % zoom does not mount at once
//   • pan/zoom writes are rAF-coalesced; iframes lose pointer events while moving
//   • zoom-anchor lookup (elementFromPoint) is throttled to one per frame
//   • cards use CSS containment; persistence writes are debounced
//   • first load fits the widest section to the viewport instead of 1:1
//   • slots use content-visibility:auto, so off-screen cards skip layout/paint

const DC = {
  renders: 0,           // artboard frames rendered; read by perf/bench.js
  bg: '#f0eee9', dot: 'rgba(70,58,46,.16)',   // dot colour and pitch, as in
  dotSize: 26,          // fatoora's flow map: screen px, the same at every zoom
  fitPad: 80,           // margin left around the content by Back to content
  backToMs: 300,        // Back to content tween
  liveBudget: 8,        // most live iframes at once; the nearest to the centre win
  budgetHysteresis: 400, // px a live slot counts as nearer, so the last place does not flip
  unmountMargin: 1600,  // px of screen space beyond which a live iframe is dropped
  settleMs: 150,        // wait after the last zoom/pan change before the LOD pass runs,
                        // the --dc-inv-zoom CSS var is written, and the lost-pill check
                        // runs — raising it also delays when iframes mount
  mountGapMs: 60,       // gap between two iframe mounts, so they don't jank one frame
  label: 'rgba(60,50,40,0.7)', title: 'rgba(40,30,20,0.85)', subtitle: 'rgba(60,50,40,0.6)',
  postitBg: '#fef4a8', postitText: '#5a4a2a',
  noteReserveH: 240,    // height a free-placed note reserves in the page box
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};

if (typeof document !== 'undefined' && !document.getElementById('dc-styles')) {
  const s = document.createElement('style');
  s.id = 'dc-styles';
  s.textContent = `
.dc-editable{cursor:text;outline:none;white-space:nowrap;border-radius:3px;padding:0 2px;margin:0 -2px}
.dc-editable:focus{background:#fff;box-shadow:0 0 0 1.5px #c96442}
[data-dc-slot]{transition:transform .18s cubic-bezier(.2,.7,.3,1)}
[data-dc-slot].dc-dragging{transition:none;z-index:10;pointer-events:none}
[data-dc-slot].dc-dragging .dc-card{box-shadow:0 12px 40px rgba(0,0,0,.25),0 0 0 2px #c96442;transform:scale(1.02)}
.dc-card{isolation:isolate;contain:layout paint;transition:box-shadow .18s ease,transform .18s ease}
[data-dc-slot]:hover:not(.dc-dragging) .dc-card{transform:translateY(-3px);box-shadow:0 2px 6px rgba(40,32,22,.08),0 26px 50px -18px rgba(40,32,22,.4)!important}
.dc-card *{scrollbar-width:none}
.dc-card *::-webkit-scrollbar{display:none}
.dc-card iframe{display:block;border:0;background:#fff}
.dc-moving .dc-card iframe{pointer-events:none}
.dc-shield{position:absolute;inset:0;cursor:pointer}
.dc-header{position:absolute;bottom:100%;left:-4px;margin-bottom:calc(4px * var(--dc-hz,1));z-index:2;display:flex;flex-wrap:wrap;align-items:center;row-gap:4px;container-type:inline-size}
.dc-labelrow{display:flex;align-items:center;gap:4px;height:24px;flex:1 1 auto;min-width:0}
.dc-grip{flex:0 0 auto;cursor:grab;display:flex;align-items:center;padding:5px 4px;border-radius:4px;transition:background .12s,opacity .12s}
.dc-grip:hover{background:rgba(0,0,0,.08)}
.dc-grip:active{cursor:grabbing}
.dc-labeltext{flex:1 1 auto;min-width:0;cursor:pointer;border-radius:4px;padding:3px 6px;display:flex;align-items:center;transition:background .12s;overflow:hidden}
@container (max-width: 110px){.dc-labeltext{display:none}.dc-grip{opacity:0}[data-dc-slot]:hover .dc-grip{opacity:1}}
.dc-labeltext:hover{background:rgba(0,0,0,.05)}
.dc-labeltext .dc-editable{overflow:hidden;text-overflow:ellipsis;max-width:100%}
.dc-labeltext .dc-editable:focus{overflow:visible;text-overflow:clip}
.dc-chips{flex:1 0 100%;order:2;display:flex;flex-wrap:wrap;gap:4px;margin-left:24px}
.dc-sizes{flex:0 0 auto;display:inline-flex;gap:2px;padding:2px;background:rgba(0,0,0,.05);border-radius:6px}
.dc-size{border:0;padding:4px 7px;border-radius:4px;background:transparent;font:500 10.5px/1 inherit;font-family:inherit;color:rgba(60,50,40,.7);cursor:pointer;transition:background .12s,color .12s}
.dc-size:hover{color:#2a251f}
.dc-size.dc-on{background:#fff;color:#2a251f;box-shadow:0 1px 2px rgba(0,0,0,.12)}
@container (max-width: 200px){.dc-chips{display:none}[data-dc-slot]:hover .dc-chips{display:flex}}
.dc-focus .dc-chips{flex:0 0 auto;order:0;margin-left:12px}
.dc-focus .dc-sizes{background:rgba(255,255,255,.12)}
.dc-focus .dc-size{color:rgba(255,255,255,.7)}
.dc-focus .dc-size:hover{color:#fff}
.dc-focus .dc-size.dc-on{background:#fff;color:#2a251f}
.dc-btns{flex:0 0 auto;margin-left:auto;display:flex;gap:2px;opacity:0;transition:opacity .12s}
[data-dc-slot]:hover .dc-btns,.dc-btns:has(.dc-menu){opacity:1}
.dc-expand,.dc-kebab{width:22px;height:22px;border-radius:5px;border:none;cursor:pointer;padding:0;background:transparent;color:rgba(60,50,40,.7);display:flex;align-items:center;justify-content:center;font:inherit;transition:background .12s,color .12s}
.dc-expand:hover,.dc-kebab:hover{background:rgba(0,0,0,.06);color:#2a251f}
[data-dc-slot]:has(.dc-menu){z-index:10}
.dc-menu{position:absolute;top:100%;right:0;margin-top:4px;background:#fff;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.05);padding:4px;min-width:160px;z-index:10}
.dc-menu button{display:block;width:100%;padding:7px 10px;border:0;background:transparent;border-radius:5px;font-family:inherit;font-size:13px;font-weight:500;line-height:1.2;color:#29261b;cursor:pointer;text-align:left;transition:background .12s;white-space:nowrap}
.dc-menu button:hover{background:rgba(0,0,0,.05)}
.dc-menu hr{border:0;border-top:1px solid rgba(0,0,0,.08);margin:4px 2px}
.dc-menu .dc-danger{color:#c96442}
.dc-menu .dc-danger:hover{background:rgba(201,100,66,.1)}
/* The header (label, chips, buttons) holds screen size down to 25% zoom, then
   shrinks with the world so it never grows over the neighbouring cards. */
[data-dc-slot]{--dc-hz:min(var(--dc-inv-zoom,1),4)}
.dc-header{width:calc((100% + 4px) / var(--dc-hz,1));transform:scale(var(--dc-hz,1));transform-origin:bottom left}
.dc-sectionhead{zoom:var(--dc-inv-zoom,1)}
/* Shown only when no section is on screen; the focus overlay (z 100) covers it. */
.dc-backto{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:7px;padding:9px 15px 9px 12px;border:1px solid #e5e0d7;border-radius:999px;background:#fff;box-shadow:0 2px 6px rgba(40,32,22,.08),0 18px 40px -14px rgba(40,32,22,.45);font-family:inherit;font-size:13px;font-weight:600;color:#3c3228;cursor:pointer;animation:dc-backto-in .18s cubic-bezier(.2,.7,.3,1) both}
.dc-backto:hover{background:#faf8f5}
@keyframes dc-backto-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.dc-placeholder{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f6f4f0 0 12px,#eeece7 12px 24px);display:flex;align-items:center;justify-content:center;color:#9a958c;font:500 14px ui-monospace,Menlo,monospace}
`;
  document.head.appendChild(s);
}

// The zoomed-out snapshots are gone; drop the cache they left in the browser.
if (typeof indexedDB !== 'undefined') { try { indexedDB.deleteDatabase('dc-snapshots'); } catch {} }

const DCCtx = React.createContext(null);
// Shared "is the world moving" flag. The .dc-moving class drives CSS only:
// live iframes lose pointer events while the world moves. The module keeps its
// own answer in dcMovingTimer and dcDragDepth, and dcMoving() reads those.
// A class left behind by a drag that did not finish thus cannot stop the LOD
// registry for the life of the page.
// Two sources set the flag: a pan or a zoom arms dcMarkMoving, which clears
// itself after 120 ms; a card drag holds dcDragDepth for the length of the
// gesture.
let dcMovingTimer = 0;
let dcDragDepth = 0;
const dcMoving = () => dcMovingTimer !== 0 || dcDragDepth > 0;
function dcMarkMoving(vp) {
  if (!vp) return;
  if (!vp.classList.contains('dc-moving')) vp.classList.add('dc-moving');
  clearTimeout(dcMovingTimer);
  dcMovingTimer = setTimeout(() => {
    dcMovingTimer = 0;
    vp.classList.remove('dc-moving');
    dcLodSchedule();
  }, 120);
}

// The level-of-detail registry. Every slot subscribes to it. One settle timer,
// one poll and one IntersectionObserver serve them all, instead of N timers
// that fire per frame.
// DCViewport writes `scale` once per flushed frame. The scale drives no
// decision in the app: dcLodRun ranks slots by distance and budget only. The
// field is kept because perf/bench.js reads it to know where the view is.
const dcLod = { scale: 1, subs: new Set(), timer: 0, poll: 0, io: null };
// Distance from the viewport centre to the nearest point of a slot's box; 0
// when the centre is inside it. This is what ranks slots for the budget.
function dcSlotDistance(r) {
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const dx = Math.max(r.left - cx, 0, cx - r.right);
  const dy = Math.max(r.top - cy, 0, cy - r.bottom);
  return Math.hypot(dx, dy);
}

// One pass over every slot. The nearest DC.liveBudget slots that are within
// their margin go live; everything else drops to its placeholder. A live slot
// counts as DC.budgetHysteresis px nearer than it is, so a slot on the last
// place does not flip on every pass. Mounting an iframe is the one expensive
// step (a whole document parses and lays out), so at most one slot mounts per
// pass and the rest wait a beat; dropping is cheap and is not rationed.
function dcLodRun() {
  // A pan or a pinch changes the ranking in each frame, and a drop removes a
  // full iframe. Do not measure the slots during the gesture. Wait until the
  // world stops. dcLodSchedule then runs this pass again.
  if (dcMoving()) { clearTimeout(dcLod.timer); dcLod.timer = setTimeout(dcLodRun, DC.settleMs); return; }
  const all = [];
  dcLod.subs.forEach((s) => {
    const r = s.box.getBoundingClientRect();
    const m = s.live ? DC.unmountMargin : s.margin;
    const near = r.right > -m && r.left < innerWidth + m && r.bottom > -m && r.top < innerHeight + m;
    all.push({ s, near, d: dcSlotDistance(r) - (s.live ? DC.budgetHysteresis : 0) });
  });
  const ranked = all.filter((e) => e.near).sort((a, b) => a.d - b.d);
  const winners = new Set(ranked.slice(0, DC.liveBudget).map((e) => e.s));
  // Drop first, so a mount never takes the page over the budget for a frame.
  all.forEach(({ s }) => { if (s.live && !winners.has(s)) { s.live = false; s.set(false); } });
  let mounted = false, pending = false;
  for (const { s } of ranked) {
    if (s.live || !winners.has(s)) continue;
    if (mounted) { pending = true; break; }
    s.live = true; s.set(true); mounted = true;
  }
  if (pending) { clearTimeout(dcLod.timer); dcLod.timer = setTimeout(dcLodRun, DC.mountGapMs); }
}
function dcLodSchedule() { clearTimeout(dcLod.timer); dcLod.timer = setTimeout(dcLodRun, DC.settleMs); }
function dcSetZoom(scale) { dcLod.scale = scale; dcLodSchedule(); }
// entry is { box, margin, live, set } — the slot element to measure, the px of
// screen space that lets it mount, whether it is live now, and the setter that
// mounts or drops it.
function dcLodSubscribe(entry) {
  if (!dcLod.subs.size) {
    dcLod.poll = setInterval(dcLodRun, 500);
    document.addEventListener('visibilitychange', dcLodSchedule);
    if (!dcLod.io) dcLod.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
  dcLod.subs.add(entry); dcLod.io.observe(entry.box);
  return () => {
    dcLod.subs.delete(entry); dcLod.io.unobserve(entry.box);
    if (!dcLod.subs.size) { clearInterval(dcLod.poll); clearTimeout(dcLod.timer); document.removeEventListener('visibilitychange', dcLodSchedule); }
  };
}

const dcBlobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

// Google Fonts CSS with the latin/arabic faces inlined as data: URLs, cached per href.
// href → Promise<string>, so two artboards on the same font fetch it once.
const dcFontCache = new Map();
function dcFontCss(href) {
  if (!dcFontCache.has(href)) dcFontCache.set(href, (async () => {
    const css = await (await fetch(href)).text();
    // A subset comment belongs to the following rule, including the last face.
    // Some responses have no subset comments; keep those faces as well.
    const blocks = [...css.matchAll(/(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{[^}]*\}/g)]
      .filter((m) => !m[1] || /^(latin|arabic)$/.test(m[1].trim()))
      .map((m) => m[0]);
    return dcInlineCss(blocks.join('\n'), href);
  })().catch(() => ''));
  return dcFontCache.get(href);
}

async function dcReplaceAsync(text, pattern, replace) {
  let out = '', last = 0;
  for (const m of text.matchAll(pattern)) {
    out += text.slice(last, m.index) + await replace(m);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

// Resolve each stylesheet's resources against its own URL before embedding it.
// Expand imports first so nested relative URLs retain the correct base.
async function dcInlineCss(css, baseHref, ancestors = new Set()) {
  const chain = new Set(ancestors); chain.add(baseHref);
  const unquote = (s) => s.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  css = await dcReplaceAsync(css, /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*((?:"[^"]*"|'[^']*'|[^)])*)\s*\)|("[^"]*"|'[^']*'))\s*([^;]*);/gi, async (m) => {
    if (m[0].startsWith('/*')) return m[0];
    try {
      const href = new URL(unquote(m[1] || m[2]), baseHref).href;
      if (chain.has(href)) return '';
      const response = await fetch(href); if (!response.ok) return '';
      const body = await dcInlineCss(await response.text(), href, chain);
      const media = m[3].trim();
      return media ? `@media ${media}{${body}}` : body;
    } catch { return ''; }
  });
  return dcReplaceAsync(css, /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)]*)\s*\)/gi, async (m) => {
    if (m[1] === undefined) return m[0];
    const raw = unquote(m[1]);
    if (!raw || /^(data:|#)/i.test(raw)) return m[0];
    try {
      const url = new URL(raw, baseHref);
      const response = await fetch(url.href); if (!response.ok) return 'url("")';
      const data = await dcBlobToDataUrl(await response.blob());
      return `url("${data}${url.hash}")`;
    } catch { return 'url("")'; }
  });
}

// Self-contained document inliner shared by exports: strip scripts →
// inline same-origin CSS/images + Google Fonts → serialized XHTML.
async function dcInlineDoc(html, baseHref) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base'); base.href = baseHref; doc.head.prepend(base);
  doc.querySelectorAll('script, iframe, video, audio, noscript').forEach((e) => e.remove());
  for (const style of [...doc.querySelectorAll('style')]) style.textContent = await dcInlineCss(style.textContent, baseHref);
  for (const el of [...doc.querySelectorAll('[style]')]) el.setAttribute('style', await dcInlineCss(el.getAttribute('style'), baseHref));
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"]')]) {
    const url = link.href; let css = '';
    try {
      if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) css = await dcFontCss(url);
      else if (new URL(url).origin === location.origin) {
        const response = await fetch(url);
        if (response.ok) css = await dcInlineCss(await response.text(), url);
      }
    } catch {}
    const st = doc.createElement('style'); st.textContent = css;
    if (link.media) st.media = link.media;
    link.replaceWith(st);
  }
  doc.querySelectorAll('link').forEach((e) => e.remove());
  for (const img of [...doc.images]) {
    const url = img.src; if (!url || url.startsWith('data:')) continue;
    try { img.setAttribute('src', await dcBlobToDataUrl(await (await fetch(url)).blob())); } catch { img.remove(); }
  }
  base.remove();
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// Per-artboard export from the kebab menu (kind: 'png' | 'html'). Reuses the
// inliner on the artboard's source file, so it works whether the slot is
// live or showing its placeholder. PNG renders at 2× the
// artboard's natural size via viewBox mapping (an <img>-loaded SVG rasterizes
// at its intrinsic size, so the SVG itself must be the output resolution).
async function dcExportArtboard(src, w, h, name, kind) {
  try { await document.fonts.ready; } catch {}
  const save = (blob, ext) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name + '.' + ext; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const html = await (await fetch(src)).text();
  const xhtml = await dcInlineDoc(html, new URL(src, location.href).href);
  if (kind === 'html') return save(new Blob(['<!doctype html>\n' + xhtml], { type: 'text/html' }), 'html');
  const px = 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas'); c.width = w * px; c.height = h * px;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  c.toBlob((blob) => save(blob, 'png'), 'image/png');
}
// ---------------------------------------------------------------------------

function dcFlatten(children) {
  const out = [];
  React.Children.forEach(children, (c) => {
    if (c && c.type === React.Fragment) out.push(...dcFlatten(c.props.children));
    else out.push(c);
  });
  return out;
}

const DC_STATE_FILE = '.design-canvas.state.json';

function DesignCanvas({ stateFile = DC_STATE_FILE, ...props }) {
  // A different document gets a fresh restoration, focus and save lifecycle.
  const lsKey = 'dc-state:' + location.pathname + ':' + stateFile;
  return <DCStateCanvas key={lsKey} {...props} stateFile={stateFile} lsKey={lsKey} />;
}

function DCStateCanvas({ children, minScale, maxScale, style, stateFile, lsKey }) {
  const [state, setState] = React.useState({ sections: {}, focus: null, updatedAt: 0 });
  const [ready, setReady] = React.useState(false);
  const savedSections = React.useRef(null);
  const fileWrites = React.useRef(Promise.resolve());

  // Prefer the newest revision. For unversioned legacy saves, the browser copy
  // wins: it may hold edits made where the existing file cannot be written.
  React.useEffect(() => {
    let off = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const valid = (s) => s && s.sections && typeof s.sections === 'object' && !Array.isArray(s.sections);
    const revision = (s) => Number.isFinite(s?.updatedAt) ? s.updatedAt : 0;
    fetch('./' + stateFile, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((saved) => {
        let local = null;
        try { local = JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch {}
        if (valid(local) && (!valid(saved) || revision(local) >= revision(saved))) saved = local;
        if (off) return;
        const sections = valid(saved) ? saved.sections : {};
        savedSections.current = sections;
        setState({ sections, focus: null, updatedAt: revision(saved) });
      })
      .catch(() => {})
      .finally(() => { clearTimeout(timeout); if (!off) setReady(true); });
    return () => { off = true; clearTimeout(timeout); controller.abort(); };
  }, [lsKey, stateFile]);

  React.useEffect(() => {
    if (!ready || state.sections === savedSections.current) return;
    const json = JSON.stringify({ sections: state.sections, updatedAt: state.updatedAt });
    // Save locally immediately, including when navigation beats the file debounce.
    try { localStorage.setItem(lsKey, json); } catch {}
    const write = () => {
      clearTimeout(t);
      if (savedSections.current === state.sections) return;
      savedSections.current = state.sections;
      fileWrites.current = fileWrites.current.then(() => window.omelette?.writeFile(stateFile, json)).catch(() => {});
    };
    const t = setTimeout(write, 400);
    window.addEventListener('pagehide', write);
    return () => { clearTimeout(t); window.removeEventListener('pagehide', write); };
  }, [ready, state.sections, state.updatedAt, lsKey, stateFile]);

  const registry = {}, sectionMeta = {}, sectionOrder = [];
  dcFlatten(children).forEach((sec) => {
    if (!sec || sec.type !== DCSection) return;
    const sid = sec.props.id ?? sec.props.title;
    if (!sid) return;
    sectionOrder.push(sid);
    const persisted = state.sections[sid] || {};
    const abs = [];
    dcFlatten(sec.props.children).forEach((ab) => {
      if (!ab || ab.type !== DCArtboard) return;
      const aid = ab.props.id ?? ab.props.label;
      if (aid) abs.push([aid, ab]);
    });
    const srcKey = abs.map(([k]) => k).join('\x1f');
    const hidden = persisted.srcKey === srcKey ? (persisted.hidden || []) : [];
    const srcIds = [];
    abs.forEach(([aid, ab]) => {
      if (hidden.includes(aid)) return;
      registry[`${sid}/${aid}`] = { sectionId: sid, artboard: ab };
      srcIds.push(aid);
    });
    const kept = (persisted.order || []).filter((k) => srcIds.includes(k));
    sectionMeta[sid] = {
      title: persisted.title ?? sec.props.title, subtitle: sec.props.subtitle,
      slotIds: [...kept, ...srcIds.filter((k) => !kept.includes(k))],
    };
  });

  // patchSection and setFocus keep one identity for the life of the canvas, so
  // the per-slot callbacks built on them survive a state change. Only `state`
  // and `section` move, and only the components that read them re-render.
  const patchSection = React.useCallback((id, p) => setState((s) => ({
    ...s, updatedAt: Math.max(Date.now(), s.updatedAt + 1),
    sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
  })), []);
  const setFocus = React.useCallback((slotId) => setState((s) => ({ ...s, focus: slotId })), []);
  const api = React.useMemo(() => ({
    state,
    section: (id) => state.sections[id] || {},
    patchSection,
    setFocus,
  }), [state, patchSection, setFocus]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') api.setFocus(null); };
    const onPd = (e) => { const ae = document.activeElement; if (ae && ae.isContentEditable && !ae.contains(e.target)) ae.blur(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPd, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPd, true); };
  }, [api]);

  return (
    <DCCtx.Provider value={api}>
      <DCViewport minScale={minScale} maxScale={maxScale} style={style}>{ready && children}</DCViewport>
      {state.focus && registry[state.focus] && (
        <DCFocusOverlay entry={registry[state.focus]} sectionMeta={sectionMeta} sectionOrder={sectionOrder} />
      )}
    </DCCtx.Provider>
  );
}

function DCViewport({ children, minScale = 0.05, maxScale = 4, style = {} }) {
  const vpRef = React.useRef(null);
  const worldRef = React.useRef(null);
  const tf = React.useRef({ x: 0, y: 0, scale: 1 });
  const tfKey = 'dc-viewport-v3:' + location.pathname;
  const saveT = React.useRef(0);
  const raf = React.useRef(0);
  const lastPostedScale = React.useRef();
  // Restoration and first fit: the fit waits until the saved view has been
  // read and the children exist, so it cannot run against an empty world.
  const restoredView = React.useRef(false);
  const fittedView = React.useRef(false);
  const hasContent = React.Children.toArray(children).length > 0;

  // Back to content: shown once the view settles with no section on screen.
  const [lost, setLost] = React.useState(false);
  const lostRef = React.useRef(false);
  const lostT = React.useRef(0);
  const tween = React.useRef(0);

  // What counts as content: the section (its header too), every slot and every
  // note. A slot can sit outside its row's box, so sections alone under-measure.
  // Never the .dc-card inside a slot — that has content-visibility:auto, and
  // reading its rect would lay out a skipped subtree.
  const boxes = (vp) => vp.querySelectorAll('[data-dc-section], [data-dc-slot], [data-dc-note]');

  // A few rects, read on settle — and, while the pill is up, on every flushed
  // frame, so panning back onto the pages hides it at once instead of 150 ms on.
  const checkLost = React.useCallback(() => {
    const vp = vpRef.current; if (!vp) return;
    const els = boxes(vp);
    let next = els.length > 0;
    const r = vp.getBoundingClientRect();
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) { next = false; break; }
    }
    if (lostRef.current !== next) { lostRef.current = next; setLost(next); }
  }, []);

  // Zoom-dependent chrome (header sizes, section gaps, world padding) reads
  // --dc-inv-zoom. It is an inherited custom property, so writing it makes
  // Chrome recalculate style for the whole world — 0.4 ms at 10 slots, 1.1 ms
  // at 40, on every frame of a pinch. It is written once the gesture settles
  // instead: during the gesture the world is one composited transform, and the
  // chrome scales with it for a beat before it snaps back to screen size.
  const invT = React.useRef(0);
  const lastInv = React.useRef(null);
  const writeInv = React.useCallback(() => {
    invT.current = 0;
    const el = worldRef.current; if (!el) return;
    const inv = 1 / tf.current.scale;
    if (lastInv.current === inv) return;
    lastInv.current = inv;
    el.style.setProperty('--dc-inv-zoom', String(inv));
  }, []);

  // rAF-coalesced DOM write: many wheel ticks per frame collapse into one transform.
  const flushNow = React.useCallback(() => {
    raf.current = 0;
    const { x, y, scale } = tf.current;
    const el = worldRef.current; if (!el) return;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    // First paint writes at once, so the chrome is never wrong before a gesture.
    if (lastInv.current === null) writeInv();
    else { clearTimeout(invT.current); invT.current = setTimeout(writeInv, DC.settleMs); }
    dcSetZoom(scale);
    if (lastPostedScale.current !== scale) {
      lastPostedScale.current = scale;
      window.parent.postMessage({ type: '__dc_zoom', scale }, '*');
    }
    dcMarkMoving(vpRef.current);
    if (lostRef.current) checkLost();
    clearTimeout(lostT.current);
    lostT.current = setTimeout(checkLost, DC.settleMs);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { try { localStorage.setItem(tfKey, JSON.stringify(tf.current)); } catch {} }, 300);
  }, [tfKey, checkLost, writeInv]);
  const apply = React.useCallback((sync) => {
    if (sync) { if (raf.current) cancelAnimationFrame(raf.current); flushNow(); return; }
    if (!raf.current) raf.current = requestAnimationFrame(flushNow);
  }, [flushNow]);
  // Any hand-driven pan or zoom wins over a running tween.
  const stopTween = React.useCallback(() => {
    if (tween.current) { cancelAnimationFrame(tween.current); tween.current = 0; }
  }, []);

  // Fit every section to the viewport, eased over DC.backToMs. dcLodSchedule
  // coalesces, so the iframes settle once at the end instead of on every frame.
  const backToContent = React.useCallback(() => {
    const vp = vpRef.current, w = worldRef.current;
    if (!vp || !w) return;
    const wr = w.getBoundingClientRect(), s0 = tf.current.scale;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    boxes(vp).forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      x0 = Math.min(x0, (b.left - wr.left) / s0); y0 = Math.min(y0, (b.top - wr.top) / s0);
      x1 = Math.max(x1, (b.right - wr.left) / s0); y1 = Math.max(y1, (b.bottom - wr.top) / s0);
    });
    if (!(x1 > x0 && y1 > y0)) return;
    const r = vp.getBoundingClientRect(), pad = DC.fitPad * 2;
    const scale = Math.min(1, maxScale, Math.max(minScale,
      Math.min((r.width - pad) / (x1 - x0), (r.height - pad) / (y1 - y0))));
    const to = {
      scale,
      x: (r.width - (x1 - x0) * scale) / 2 - x0 * scale,
      y: (r.height - (y1 - y0) * scale) / 2 - y0 * scale,
    };
    const from = { ...tf.current }, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / DC.backToMs);
      const e = 1 - Math.pow(1 - k, 3);
      tf.current = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        scale: from.scale + (to.scale - from.scale) * e,
      };
      apply(true);
      tween.current = k < 1 ? requestAnimationFrame(step) : 0;
    };
    stopTween();
    tween.current = requestAnimationFrame(step);
  }, [apply, stopTween, minScale, maxScale]);

  React.useLayoutEffect(() => {
    const flush = () => { clearTimeout(saveT.current); try { localStorage.setItem(tfKey, JSON.stringify(tf.current)); } catch {} };
    try {
      const s = JSON.parse(localStorage.getItem(tfKey) || 'null');
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale)) {
        tf.current = { x: s.x, y: s.y, scale: Math.min(maxScale, Math.max(minScale, s.scale)) };
        restoredView.current = true; apply(true);
      }
    } catch {}
    window.addEventListener('pagehide', flush);
    // The pill timer and the Back to content tween live as long as the
    // viewport, so they are stopped here and not in the fit effect, which
    // re-runs whenever the content or the scale bounds change.
    return () => {
      clearTimeout(lostT.current); clearTimeout(invT.current);
      if (tween.current) cancelAnimationFrame(tween.current);
      window.removeEventListener('pagehide', flush); flush();
    };
  }, []);

  React.useLayoutEffect(() => {
    if (!hasContent) return;
    // Wait for actual content, not a timer racing the state-file request.
    const fit = requestAnimationFrame(() => {
      if (restoredView.current || fittedView.current) return;
      const w = worldRef.current; if (!w) return;
      let maxW = 0;
      w.querySelectorAll('[data-dc-row]').forEach((r) => { maxW = Math.max(maxW, r.scrollWidth + 120); });
      if (!maxW) return;
      const s = Math.min(1, maxScale, Math.max(minScale, vpRef.current.clientWidth / maxW));
      fittedView.current = true;
      tf.current = { x: 0, y: 0, scale: s }; apply(true);
    });
    const rescue = setTimeout(() => {
      const slots = worldRef.current.querySelectorAll('[data-dc-slot]');
      if (!slots.length) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const el of slots) { const r = el.getBoundingClientRect(); if (r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh) return; }
      const r = slots[0].getBoundingClientRect(); const t = tf.current;
      t.x += 60 - r.left; t.y += 100 - r.top; apply(true);
    }, 500);
    return () => { cancelAnimationFrame(fit); clearTimeout(rescue); };
  }, [hasContent, apply, minScale, maxScale]);

  // The pages can also leave the screen with the view held still: the window
  // gets smaller, or the section box grows as a page is moved. Neither goes
  // through flushNow, so watch for both.
  React.useEffect(() => {
    const schedule = () => { clearTimeout(lostT.current); lostT.current = setTimeout(checkLost, DC.settleMs); };
    const ro = new ResizeObserver(schedule);
    if (worldRef.current) ro.observe(worldRef.current);
    window.addEventListener('resize', schedule);
    return () => { ro.disconnect(); window.removeEventListener('resize', schedule); };
  }, [checkLost]);

  React.useEffect(() => {
    const vp = vpRef.current; if (!vp) return;
    let lastAnchorFrame = -1, anchor = null, anchorY0 = 0;

    const zoomAt = (cx, cy, factor) => {
      const r = vp.getBoundingClientRect();
      const px = cx - r.left, py = cy - r.top;
      const t = tf.current;
      const next = Math.min(maxScale, Math.max(minScale, t.scale * factor));
      const k = next / t.scale;
      if (k === 1) return;
      // Throttled anchor lookup: elementFromPoint is expensive with many iframes.
      const now = performance.now();
      if (now - lastAnchorFrame > 16) {
        lastAnchorFrame = now;
        const hit = document.elementFromPoint(cx, cy);
        anchor = hit && hit.closest ? hit.closest('[data-dc-slot],[data-dc-section]') : null;
      }
      if (anchor) anchorY0 = anchor.getBoundingClientRect().top;
      t.x = px - (px - t.x) * k; t.y = py - (py - t.y) * k; t.scale = next;
      apply(true);
      if (anchor) {
        const drift = anchor.getBoundingClientRect().top - (cy + (anchorY0 - cy) * k);
        if (Math.abs(drift) > 0.1) { t.y -= drift; apply(true); }
      }
    };

    const isMouseWheel = (e) => e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    let isGesturing = false, gsBase = 1;
    const onWheel = (e) => {
      e.preventDefault();
      stopTween();
      if (isGesturing) return;
      if ((e.ctrlKey || e.metaKey) && !isMouseWheel(e)) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else if (isMouseWheel(e)) zoomAt(e.clientX, e.clientY, Math.exp(-Math.sign(e.deltaY) * 0.18));
      else { tf.current.x -= e.deltaX; tf.current.y -= e.deltaY; apply(); }
    };
    const onGestureStart = (e) => { e.preventDefault(); stopTween(); isGesturing = true; gsBase = tf.current.scale; };
    const onGestureChange = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, (gsBase * e.scale) / tf.current.scale); };
    const onGestureEnd = (e) => { e.preventDefault(); isGesturing = false; };

    let drag = null;
    const onPointerDown = (e) => {
      const onBg = !e.target.closest('[data-dc-slot], .dc-editable, .dc-nav, .dc-flows, .dc-backto');
      if (!(e.button === 1 || (e.button === 0 && onBg))) return;
      e.preventDefault();
      stopTween();
      vp.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
      // Arm the removal timer with the class, so a click with no move still
      // clears dc-moving; dcLodRun freezes the whole LOD registry while it is set.
      vp.style.cursor = 'grabbing'; dcMarkMoving(vp);
    };
    const onPointerMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      tf.current.x += e.clientX - drag.lx; tf.current.y += e.clientY - drag.ly;
      drag.lx = e.clientX; drag.ly = e.clientY; apply();
    };
    const onPointerUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      vp.releasePointerCapture(e.pointerId); drag = null; vp.style.cursor = '';
    };
    const onHostMsg = (e) => {
      const d = e.data;
      if (d && d.type === '__dc_set_zoom' && typeof d.scale === 'number') {
        const r = vp.getBoundingClientRect();
        zoomAt(r.left + r.width / 2, r.top + r.height / 2, d.scale / tf.current.scale);
      } else if (d && d.type === '__dc_probe') {
        window.parent.postMessage({ type: '__dc_present' }, '*');
        lastPostedScale.current = undefined; apply(true);
      }
    };
    window.addEventListener('message', onHostMsg);
    window.parent.postMessage({ type: '__dc_present' }, '*');
    lastPostedScale.current = undefined; apply(true);

    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('gesturestart', onGestureStart, { passive: false });
    vp.addEventListener('gesturechange', onGestureChange, { passive: false });
    vp.addEventListener('gestureend', onGestureEnd, { passive: false });
    vp.addEventListener('pointerdown', onPointerDown);
    vp.addEventListener('pointermove', onPointerMove);
    vp.addEventListener('pointerup', onPointerUp);
    vp.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('message', onHostMsg);
      vp.removeEventListener('wheel', onWheel);
      vp.removeEventListener('gesturestart', onGestureStart);
      vp.removeEventListener('gesturechange', onGestureChange);
      vp.removeEventListener('gestureend', onGestureEnd);
      vp.removeEventListener('pointerdown', onPointerDown);
      vp.removeEventListener('pointermove', onPointerMove);
      vp.removeEventListener('pointerup', onPointerUp);
      vp.removeEventListener('pointercancel', onPointerUp);
    };
  }, [apply, stopTween, minScale, maxScale]);

  return (
    <div ref={vpRef} className="design-canvas"
      style={{ height: '100vh', width: '100vw', background: DC.bg, overflow: 'hidden', overscrollBehavior: 'none', touchAction: 'none', position: 'relative', fontFamily: DC.font, boxSizing: 'border-box', ...style }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${DC.dot} 1px, transparent 1px)`, backgroundSize: `${DC.dotSize}px ${DC.dotSize}px`, pointerEvents: 'none' }} />
      <div ref={worldRef} data-dc-world="" style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform', width: 'max-content', minWidth: '100%', minHeight: '100%', padding: 'calc(72px * var(--dc-inv-zoom,1)) 0 80px' }}>
        {children}
      </div>
      {lost && (
        <button className="dc-backto" onClick={backToContent}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 4 12l7 7" /><path d="M4 12h15" />
          </svg>
          Back to content
        </button>
      )}
    </div>
  );
}

// `positions` (id -> {x, y}, section-local px) switches the section from a flex
// row to free placement: slots sit exactly where the canvas file puts them, so a
// flow can stagger down and across instead of snapping to one baseline.
// Variants. An artboard with `variants` ([{ file, w, h, href, chip, lang,
// state }]) shows one of them at a time in the same slot; the chosen file is
// saved per slot in the section state (sec.variant[id]). Three axes: size
// (chip, from the width), language (lang, default en) and state (free text,
// the primary reads as Main). Without `variants` the props are the size.
const DC_AXES = [
  { key: 'size', of: (v) => v.chip || String(v.w), label: (k) => k },
  { key: 'lang', of: (v) => (v.lang || 'en'), label: (k) => k.toUpperCase() },
  { key: 'state', of: (v) => (v.state || ''), label: (k) => k || 'Main' },
];
function dcSize(props, chosen) {
  const { variants, width = 260, height = 480, href } = props;
  if (!variants || !variants.length) return { width, height, href, variants: null, idx: -1, cur: null, axes: [] };
  const rootIdx = Math.max(0, variants.findIndex((s) => s.primary));
  let idx = variants.findIndex((s) => s.file === chosen);
  if (idx < 0) idx = rootIdx;
  const cur = variants[idx], root = variants[rootIdx];
  // One chip group per axis that has more than one value. Sizes keep the
  // order given (widest first); language and state lead with the primary's.
  const axes = DC_AXES.map((ax) => {
    const values = [...new Set(variants.map(ax.of))];
    if (values.length < 2) return null;
    if (ax.key !== 'size') values.sort((a, b) => (a === ax.of(root) ? -1 : b === ax.of(root) ? 1 : 0));
    const pick = (value) => {
      const same = (v, other) => DC_AXES.every((o) => o === ax || o === other || o.of(v) === o.of(cur));
      return (variants.find((v) => ax.of(v) === value && same(v)) ||
        variants.find((v) => ax.of(v) === value && DC_AXES.some((o) => o !== ax && same(v, o))) ||
        variants.find((v) => ax.of(v) === value)).file;
    };
    return { key: ax.key, on: ax.of(cur), chips: values.map((value) => ({ value, label: ax.label(value), file: pick(value) })) };
  }).filter(Boolean);
  return { width: cur.w, height: cur.h, href: cur.href ?? href, variants, idx, cur, axes };
}

function DCSizeChips({ size, onSize, style }) {
  if (!size.axes.length) return null;
  return (
    <div className="dc-chips" style={style} onPointerDown={(e) => e.stopPropagation()}>
      {size.axes.map((ax) => (
        <div key={ax.key} className="dc-sizes">
          {ax.chips.map((c) => (
            <button key={c.value} className={'dc-size' + (c.value === ax.on ? ' dc-on' : '')} title={c.file}
              onClick={(e) => { e.stopPropagation(); onSize && onSize(c.file); }}>{c.label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

function DCSection({ id, title, subtitle, children, gap = 48, positions, notePositions }) {
  const ctx = React.useContext(DCCtx);
  const sid = id ?? title;
  const all = React.Children.toArray(dcFlatten(children));
  const artboards = all.filter((c) => c && c.type === DCArtboard);
  const rest = all.filter((c) => !(c && c.type === DCArtboard));
  const sec = (ctx && sid && ctx.section(sid)) || {};
  const allIds = artboards.map((a) => a.props.id ?? a.props.label).filter(Boolean);
  const srcKey = allIds.join('\x1f');
  const hidden = sec.srcKey === srcKey ? (sec.hidden || []) : [];
  const srcOrder = allIds.filter((k) => !hidden.includes(k));
  const order = React.useMemo(() => {
    const kept = (sec.order || []).filter((k) => srcOrder.includes(k));
    return [...kept, ...srcOrder.filter((k) => !kept.includes(k))];
  }, [sec.order, srcOrder.join('|')]);
  const byId = Object.fromEntries(artboards.map((a) => [a.props.id ?? a.props.label, a]));
  const sizeOf = (k) => dcSize(byId[k].props, (sec.variant || {})[k]);
  // Persisted moves override the authored positions.
  const placed = React.useMemo(() => (positions ? { ...positions, ...(sec.positions || {}) } : null), [positions, sec.positions]);
  // In free mode every note is placed too; one without a position sits at the origin.
  const noteAt = (n) => (notePositions && n && n.props && notePositions[n.props.id]) || { x: 0, y: 0 };
  // A page moved left or up takes the box's origin negative. The box then keeps
  // that corner and the row's margins shift by the same amount, so the box grows
  // left and up around what is already placed: nothing on screen moves, the
  // right and bottom edges still carry the flow, and there is no wall at 0.
  const freeBox = React.useMemo(() => {
    if (!placed) return null;
    let x0 = 0, y0 = 0, w = 0, h = 0;
    const span = (p, bw, bh) => {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      w = Math.max(w, p.x + bw); h = Math.max(h, p.y + bh);
    };
    order.forEach((k) => {
      const p = placed[k], a = byId[k];
      if (!p || !a) return;
      const s = sizeOf(k);
      span(p, s.width || 0, s.height || 0);
    });
    rest.forEach((n) => {
      const p = noteAt(n);
      span(p, p.w || (n.props && n.props.width) || 320, DC.noteReserveH);
    });
    return { origin: { x: x0, y: y0 }, w: w - x0 + 60, h: h - y0 };
  }, [placed, notePositions, order.join('|'), rest.length, sec.variant]);

  // One stable object of actions, keyed by slot id, instead of eight fresh
  // closures per slot per render. Without this React.memo on the frame can
  // never hit: every prop would be a new function on every state change.
  const patchSection = ctx && ctx.patchSection, setFocus = ctx && ctx.setFocus;
  const actions = React.useMemo(() => ({
    size: (k, file) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'variant', k, file)),
    move: (k, p) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'positions', k, p)),
    rename: (k, v) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'labels', k, v)),
    reorder: (next) => patchSection && patchSection(sid, { order: next }),
    focus: (k) => setFocus && setFocus(`${sid}/${k}`),
    resetPosition: (k) => patchSection && patchSection(sid, (x) => {
      const n = { ...(x.positions || {}) }; delete n[k]; return { positions: n };
    }),
    resetArrows: (k) => patchSection && patchSection(sid, (x) => {
      // Only the end that meets this page: the far page keeps its side.
      const n = {};
      Object.entries(x.arrows || {}).forEach(([key, o]) => {
        const { from, to } = dcFlowKeyParts(key), r = { ...o };
        if (from === k) delete r.fs;
        if (to === k) delete r.ts;
        if (Object.keys(r).length) n[key] = r;
      });
      return { arrows: n };
    }),
    remove: (k) => patchSection && patchSection(sid, (x) => ({
      hidden: [...(x.srcKey === srcKey ? (x.hidden || []) : []), k], srcKey,
    })),
  }), [patchSection, setFocus, sid, srcKey]);

  // One size object per slot, kept across renders that did not change a
  // variant. The artboard elements behind byId are made once by the page and
  // only rebuilt on a reload, which rebuilds `order` too, so they need no dep.
  const sizes = React.useMemo(() => {
    const out = {};
    order.forEach((k) => { out[k] = dcSize(byId[k].props, (sec.variant || {})[k]); });
    return out;
  }, [order.join('|'), sec.variant]);

  return (
    <div data-dc-section={sid} style={{ marginBottom: freeBox ? 'calc(400px + 140px * var(--dc-inv-zoom, 1))' : 'calc(80px * var(--dc-inv-zoom, 1))', position: 'relative' }}>
      <div style={{ padding: '0 60px' }}>
        <div className="dc-sectionhead" style={{ paddingBottom: 36 }}>
          <DCEditable tag="div" value={sec.title ?? title}
            onChange={(v) => ctx && sid && ctx.patchSection(sid, { title: v })}
            style={{ fontSize: 28, fontWeight: 600, color: DC.title, letterSpacing: -0.4, marginBottom: 6, display: 'inline-block' }} />
          {subtitle && <div style={{ fontSize: 16, color: DC.subtitle }}>{subtitle}</div>}
        </div>
      </div>
      {!freeBox && rest.length > 0 && <div className="dc-notes" style={{ padding: '0 60px calc(40px * var(--dc-inv-zoom, 1))', display: 'flex', gap: 24, alignItems: 'flex-start', width: 'max-content' }}>{rest}</div>}
      <div data-dc-row="" style={freeBox
        ? { position: 'relative', marginLeft: 60 + freeBox.origin.x, marginRight: 60, marginTop: freeBox.origin.y, width: freeBox.w, height: freeBox.h }
        : { display: 'flex', gap, padding: '0 60px', alignItems: 'flex-start', width: 'max-content' }}>
        {freeBox && rest.map((n, i) => (
          <div key={(n && n.props && n.props.id) || i} data-dc-note={(n && n.props && n.props.id) || i} style={{ position: 'absolute', left: noteAt(n).x - freeBox.origin.x, top: noteAt(n).y - freeBox.origin.y }}>{n}</div>
        ))}
        {order.map((k) => (
          // byId[k] itself is a new element every render: React.Children.toArray
          // re-keys by cloning, so the element identity churns even though its
          // props do not. Passing the element would defeat the memo for every
          // slot; the props object holds still instead.
          <DCArtboardFrame key={k} sectionId={sid} artboardProps={byId[k].props} order={order}
            size={sizes[k]} actions={actions}
            // freeBox.origin is a fresh object every recompute (any position
            // patch remakes it), so an object prop here would fail the shallow
            // compare for every slot and defeat the memo. Two numbers hold
            // still instead.
            position={placed && placed[k]} originX={freeBox ? freeBox.origin.x : 0} originY={freeBox ? freeBox.origin.y : 0} moved={!!(sec.positions && sec.positions[k])}
            arrowsMoved={Object.entries(sec.arrows || {}).some(([key, o]) => { const { from, to } = dcFlowKeyParts(key); return (from === k && o.fs) || (to === k && o.ts); })}
            label={(sec.labels || {})[k] ?? byId[k].props.label} />
        ))}
      </div>
    </div>
  );
}

function DCArtboard() { return null; }

// Lazy frame with two levels of detail:
//   live  — a real iframe. Mounted while the slot is one of the DC.liveBudget
//           slots nearest the viewport centre and within `margin` px of it;
//           dropped once it falls out of the budget or past DC.unmountMargin.
//   placeholder — the striped card, for every slot that is not live.
// `eager` forces a live iframe regardless (focus overlay). The registry runs
// one pass for every slot at once, DC.settleMs after the last zoom or pan tick,
// so a pinch does not thrash iframes.
function DCLazyFrame({ src, title, width, height, eager = false, margin = 600, href }) {
  const ref = React.useRef(null);
  const [live, setLive] = React.useState(eager);
  React.useEffect(() => {
    if (eager || !ref.current) return;
    // Measure the slot, not the inner div: the slot has content-visibility:auto,
    // so reading a descendant's rect would force layout of a skipped subtree.
    const box = ref.current.closest('[data-dc-slot]') || ref.current;
    const off = dcLodSubscribe({ box, margin, live: false, set: setLive });
    dcLodSchedule();
    return off;
  }, [eager, margin]);
  const on = eager || live;
  // Shield: iframes swallow wheel/pinch, so a transparent layer sits over the
  // screen and lets the canvas zoom/pan. A click opens the screen's own file
  // (where it can be edited); the ⋯ menu opens it in a new tab.
  return (
    <div ref={ref} style={{ width, height, position: 'relative' }}>
      {on ? <iframe src={src} title={title} loading="lazy" style={{ width, height }} />
        : <div className="dc-placeholder">{title}</div>}
      {!eager && <div className="dc-shield" title="Open to edit" onClick={() => { if (href) location.href = href; }} />}
    </div>
  );
}

// One pointer drag on a slot: marks the slot and viewport as moving, reports
// pointer deltas in world px (screen px ÷ zoom), and cleans up on release or
// cancel. `me` sets the scale (its screen width over its layout width) and
// gets the dragging class. `move` also receives the pointer's world position,
// measured against `me`'s current rect so a zoom mid-drag does not go stale.
// `keepMoving` leaves the viewport's moving flag for the caller to clear.
// Returns a cancel function for unmounts.
function dcDragSession(e, me, { move, up, keepMoving }) {
  e.preventDefault(); e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  const scaleOf = () => me.getBoundingClientRect().width / me.offsetWidth || 1;
  const scale = scaleOf();
  me.classList.add('dc-dragging');
  const vp = me.closest('.design-canvas'); vp && vp.classList.add('dc-moving');
  dcDragDepth++;
  const onMove = (ev) => {
    const r = me.getBoundingClientRect(), z = scaleOf();
    move((ev.clientX - sx) / scale, (ev.clientY - sy) / scale, scale, { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z });
  };
  let done = false;
  const finish = (cancelled) => {
    if (done) return; done = true;
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onCancel);
    me.classList.remove('dc-dragging');
    // The drag is over here even when keepMoving leaves the class on for the
    // drop animation, so the registry is released at the same point.
    dcDragDepth = Math.max(0, dcDragDepth - 1);
    dcLodSchedule();
    if (!keepMoving && vp) vp.classList.remove('dc-moving');
    up(scale, vp, cancelled);
  };
  const onUp = () => finish(false), onCancel = () => finish(true);
  document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onCancel);
  return onCancel;
}

// Flow identity shared with canvas-page.jsx (CanvasFlows): endpoints and
// label, joined with a separator no file name or label carries. Arrow-side
// overrides in the section state are keyed by it.
const DC_KEY_SEP = '\x1f';
const dcFlowKey = (f) => [f.from, f.to, f.label || ''].join(DC_KEY_SEP);
const dcFlowKeyParts = (key) => { const [from, to, label] = key.split(DC_KEY_SEP); return { from, to, label }; };
// Patch one entry of a map-shaped section field ({ positions: { [k]: v } }).
const dcMapPatch = (x, field, key, value) => ({ [field]: { ...(x[field] || {}), [key]: value } });

function DCArtboardFrame({ sectionId, artboardProps, label, order, position, originX = 0, originY = 0, moved, size, actions, arrowsMoved }) {
  DC.renders++;
  const { id: rawId, label: rawLabel, children: rawChildren, style = {} } = artboardProps;
  const id = rawId ?? rawLabel;
  // The eight callbacks the body already uses, rebuilt per render from one
  // stable actions object. They are cheap; the props that reach React.memo are
  // what has to hold still, and those are actions, size, order and primitives.
  const onSize = (file) => actions.size(id, file);
  const onMove = (p) => actions.move(id, p);
  const onResetPosition = () => actions.resetPosition(id);
  const onResetArrows = () => actions.resetArrows(id);
  const onRename = (v) => actions.rename(id, v);
  const onReorder = (next) => actions.reorder(next);
  const onFocus = () => actions.focus(id);
  const onDelete = () => actions.remove(id);
  // With size variants the slot follows the chosen size; `children` may be a
  // function of that size so the host can embed the right file.
  size = size || dcSize(artboardProps);
  const { width, height, href } = size;
  const children = typeof rawChildren === 'function' ? rawChildren(size.cur, size) : rawChildren;
  const ref = React.useRef(null);
  const menuRef = React.useRef(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!menuOpen) { setConfirming(false); return; }
    const off = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [menuOpen]);

  // Free placement: the grip moves the card anywhere in the section, including
  // left of and above the origin. The live drag is a transform (React never
  // writes one on the slot), the drop commits a snapped position to the section
  // state and the section box grows to hold it.
  const onMoveDown = (e) => {
    const me = ref.current;
    let dx = 0, dy = 0;
    dcDragSession(e, me, {
      move: (wx, wy) => { dx = wx; dy = wy; me.style.transform = `translate(${dx}px, ${dy}px)`; },
      up: () => {
        me.style.transition = 'none'; me.style.transform = '';
        requestAnimationFrame(() => { me.style.transition = ''; });
        if (Math.hypot(dx, dy) < 4) return;
        const snap = (v) => Math.round(v / 10) * 10;
        onMove && onMove({ x: snap(position.x + dx), y: snap(position.y + dy) });
      },
    });
  };

  const onGripDown = (e) => {
    if (position) return onMoveDown(e);
    const me = ref.current;
    const peers = Array.from(document.querySelectorAll(`[data-dc-section="${sectionId}"] [data-dc-slot]`));
    const homes = peers.map((el) => ({ el, id: el.dataset.dcSlot, x: el.getBoundingClientRect().left }));
    const slotXs = homes.map((h) => h.x);
    const startIdx = order.indexOf(id);
    let liveOrder = order.slice();
    const layout = (scale) => {
      for (const h of homes) { if (h.id === id) continue; h.el.style.transform = `translateX(${(slotXs[liveOrder.indexOf(h.id)] - h.x) / scale}px)`; }
    };
    dcDragSession(e, me, {
      keepMoving: true,
      move: (wx, wy, scale) => {
        me.style.transform = `translateX(${wx}px)`;
        const cur = homes[startIdx].x + wx * scale;
        let nearest = 0, best = Infinity;
        for (let i = 0; i < slotXs.length; i++) { const d = Math.abs(slotXs[i] - cur); if (d < best) { best = d; nearest = i; } }
        if (liveOrder.indexOf(id) !== nearest) { liveOrder = order.filter((k) => k !== id); liveOrder.splice(nearest, 0, id); layout(scale); }
      },
      up: (scale, vp) => {
        const finalSlot = liveOrder.indexOf(id);
        me.style.transform = `translateX(${(slotXs[finalSlot] - homes[startIdx].x) / scale}px)`;
        setTimeout(() => {
          for (const h of homes) { h.el.style.transition = 'none'; h.el.style.transform = ''; }
          if (liveOrder.join('|') !== order.join('|')) onReorder(liveOrder);
          vp && vp.classList.remove('dc-moving');
          requestAnimationFrame(() => requestAnimationFrame(() => { for (const h of homes) h.el.style.transition = ''; }));
        }, 180);
      },
    });
  };

  return (
    <div ref={ref} data-dc-slot={id} style={position
      ? { position: 'absolute', left: position.x - originX, top: position.y - originY }
      : { position: 'relative', flexShrink: 0 }}>
      <div className="dc-header" data-noncommentable="" style={{ color: DC.label }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dc-labelrow">
          <div className="dc-grip" onPointerDown={onGripDown} title={position ? 'Drag to move' : 'Drag to reorder'}>
            <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
          </div>
          <div className="dc-labeltext" onClick={onFocus} title="Click to focus">
            <DCEditable value={label} onChange={onRename} onClick={(e) => e.stopPropagation()} style={{ fontSize: 15, fontWeight: 500, color: DC.label, lineHeight: 1 }} />
          </div>
        </div>
        <DCSizeChips size={size} onSize={onSize} />
        <div className="dc-btns">
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button className="dc-kebab" title="More" onClick={() => setMenuOpen((o) => !o)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="2.5" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="9.5" cy="6" r="1.1"/></svg>
            </button>
            {menuOpen && (
              <div className="dc-menu" onPointerDown={(e) => e.stopPropagation()}>
                {href && <button onClick={() => { setMenuOpen(false); window.open(href, '_blank'); }}>Open screen</button>}
                {moved && <button onClick={() => { setMenuOpen(false); onResetPosition && onResetPosition(); }}>Reset position</button>}
                {arrowsMoved && <button onClick={() => { setMenuOpen(false); onResetArrows && onResetArrows(); }}>Reset arrow sides</button>}
                {href && <button onClick={() => { setMenuOpen(false); dcExportArtboard(href, width, height, String(label || id || 'artboard').replace(/[^\w\s.-]+/g, '_'), 'png').catch((err) => console.error('[design-canvas] export failed:', err)); }}>Download PNG</button>}
                {href && <button onClick={() => { setMenuOpen(false); dcExportArtboard(href, width, height, String(label || id || 'artboard').replace(/[^\w\s.-]+/g, '_'), 'html').catch((err) => console.error('[design-canvas] export failed:', err)); }}>Download HTML</button>}
                {href && <hr />}
                <button className="dc-danger" onClick={() => { if (confirming) { setMenuOpen(false); onDelete(); } else setConfirming(true); }}>
                  {confirming ? 'Click again to delete' : 'Delete'}
                </button>
              </div>
            )}
          </div>
          <button className="dc-expand" onClick={onFocus} title="Focus">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 1h4v4M5 11H1V7M11 1L7.5 4.5M1 11l3.5-3.5"/></svg>
          </button>
        </div>
      </div>
      {/* content-visibility goes on the card, not the slot: its paint containment
          would clip the label header that hangs above the slot box. */}
      <div className="dc-card" style={{ borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06)', overflow: 'hidden', width, height, background: '#fff', contentVisibility: 'auto', containIntrinsicSize: `${width}px ${height}px`, ...style }}>
        {children || <div className="dc-placeholder">{id}</div>}
      </div>
    </div>
  );
}
// Every prop the frame takes now holds still through a state change that did
// not touch this slot, so the default shallow compare is enough.
DCArtboardFrame = React.memo(DCArtboardFrame);

function DCEditable({ value, onChange, style, tag = 'span', onClick }) {
  const T = tag;
  return (
    <T className="dc-editable" contentEditable suppressContentEditableWarning onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onChange && onChange(e.currentTarget.textContent)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      style={style}>{value}</T>
  );
}

function DCFocusOverlay({ entry, sectionMeta, sectionOrder }) {
  const ctx = React.useContext(DCCtx);
  const { sectionId, artboard } = entry;
  const sec = ctx.section(sectionId);
  const meta = sectionMeta[sectionId];
  const peers = meta.slotIds;
  const aid = artboard.props.id ?? artboard.props.label;
  const idx = peers.indexOf(aid);
  const secIdx = sectionOrder.indexOf(sectionId);
  const go = (d) => { const n = peers[(idx + d + peers.length) % peers.length]; if (n) ctx.setFocus(`${sectionId}/${n}`); };
  const goSection = (d) => {
    const n = sectionOrder.length;
    for (let i = 1; i < n; i++) {
      const ns = sectionOrder[(((secIdx + d * i) % n) + n) % n];
      const first = sectionMeta[ns] && sectionMeta[ns].slotIds[0];
      if (first) { ctx.setFocus(`${ns}/${first}`); return; }
    }
  };
  React.useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); goSection(-1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); goSection(1); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  const size = dcSize(artboard.props, (sec.variant || {})[aid]);
  const { width, height, href } = size;
  const children = typeof artboard.props.children === 'function' ? artboard.props.children(size.cur, size) : artboard.props.children;
  const onSize = (file) => ctx.patchSection(sectionId, (x) => dcMapPatch(x, 'variant', aid, file));
  const [vp, setVp] = React.useState({ w: window.innerWidth, h: window.innerHeight });
  React.useEffect(() => { const r = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  const scale = Math.max(0.1, Math.min((vp.w - 200) / width, (vp.h - 260) / height, 2));
  const [ddOpen, setDd] = React.useState(false);
  const Arrow = ({ dir, onClick }) => (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ position: 'absolute', top: '50%', [dir]: 28, transform: 'translateY(-50%)', border: 'none', background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.9)', width: 44, height: 44, borderRadius: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={dir === 'left' ? 'M11 3L5 9l6 6' : 'M7 3l6 6-6 6'} /></svg>
    </button>
  );
  // Focused content: prefer a fresh eager iframe of the screen (children may be lazy).
  const content = href ? <DCLazyFrame src={href} title={aid} width={width} height={height} eager /> : children;
  return ReactDOM.createPortal(
    <div className="dc-focus" onClick={() => ctx.setFocus(null)} onWheel={(e) => e.preventDefault()}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(24,20,16,.6)', backdropFilter: 'blur(14px)', fontFamily: DC.font, color: '#fff' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, display: 'flex', alignItems: 'flex-start', padding: '16px 20px 0', gap: 16 }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setDd((o) => !o)} style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: '6px 8px', borderRadius: 6, textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>{meta.title}</span>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ opacity: .7 }}><path d="M2 4l3.5 3.5L9 4"/></svg>
            </span>
          </button>
          {ddOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#2a251f', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,.4)', padding: 4, minWidth: 200, zIndex: 10 }}>
              {sectionOrder.filter((sid) => sectionMeta[sid].slotIds.length).map((sid) => (
                <button key={sid} onClick={() => { setDd(false); const f = sectionMeta[sid].slotIds[0]; if (f) ctx.setFocus(`${sid}/${f}`); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', background: sid === sectionId ? 'rgba(255,255,255,.1)' : 'transparent', color: '#fff', padding: '8px 12px', borderRadius: 5, fontSize: 14, fontWeight: sid === sectionId ? 600 : 400, fontFamily: 'inherit' }}>
                  {sectionMeta[sid].title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => ctx.setFocus(null)} style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,.7)', width: 32, height: 32, borderRadius: 16, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ position: 'absolute', top: 64, bottom: 56, left: 100, right: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: width * scale, height: height * scale, position: 'relative' }}>
          <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', background: '#fff', borderRadius: 2, overflow: 'hidden', boxShadow: '0 20px 80px rgba(0,0,0,.4)' }}>
            {content}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ fontSize: 14, fontWeight: 500, opacity: .85, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {(sec.labels || {})[aid] ?? artboard.props.label}
          <span style={{ opacity: .5, marginLeft: 10, fontVariantNumeric: 'tabular-nums' }}>{idx + 1} / {peers.length}</span>
          <DCSizeChips size={size} onSize={onSize} />
        </div>
      </div>
      <Arrow dir="left" onClick={() => go(-1)} />
      <Arrow dir="right" onClick={() => go(1)} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
        {peers.map((p, i) => (
          <button key={p} onClick={() => ctx.setFocus(`${sectionId}/${p}`)} style={{ border: 'none', padding: 0, cursor: 'pointer', width: 6, height: 6, borderRadius: 3, background: i === idx ? '#fff' : 'rgba(255,255,255,.3)' }} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function DCPostIt({ children, width = 320, rotate = -1 }) {
  return (
    <div style={{ width, flexShrink: 0, background: DC.postitBg, padding: '14px 16px', fontFamily: DC.font, fontSize: 13, lineHeight: 1.5, color: DC.postitText, whiteSpace: 'pre-wrap', boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)', transform: `rotate(${rotate}deg)` }}>{children}</div>
  );
}

// Renders nothing; lets a host mount this file purely to load the globals.
function DCLib() { return null; }

Object.assign(window, { DesignCanvas, DCSection, DCArtboard, DCPostIt, DCLazyFrame, DCCtx, DCLib, dcDragSession, dcFlowKey, dcMapPatch });
