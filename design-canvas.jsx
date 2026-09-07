// design-canvas.jsx — pan/zoom canvas: sections, artboards (reorder / rename /
// delete / focus), post-its. Ported from the fatoora project with performance
// work for heavy artboards (full-page iframes):
//   • DCLazyFrame mounts an iframe only when its slot is near the viewport
//   • pan/zoom writes are rAF-coalesced; iframes lose pointer events while moving
//   • zoom-anchor lookup (elementFromPoint) is throttled to one per frame
//   • cards use CSS containment; persistence writes are debounced
//   • first load fits the widest section to the viewport instead of 1:1
//   • slots use content-visibility:auto, so off-screen cards skip layout/paint
//   • LOD: below DC.liveScale zoom, or far from the viewport, a slot shows a
//     snapshot instead of a live iframe; iframes mount only near 1:1 or in focus
//   • snapshots are made in the browser, one at a time in idle moments: the
//     .dc.html is fetched, its images and Google Fonts are inlined, and it is
//     rasterized through an SVG <foreignObject> onto a canvas, then cached in
//     IndexedDB keyed by content hash — no build step, no files in the project

const DC = {
  bg: '#f0eee9', grid: 'rgba(0,0,0,0.06)',
  liveScale: 0.5,       // live iframe at or above this zoom
  unmountMargin: 1600,  // px of screen space beyond which a live iframe is dropped
  settleMs: 150,        // wait after the last zoom/pan change before switching modes
  mountGapMs: 60,       // gap between two iframe mounts, so they don't jank one frame
  snapWidth: 720,       // snapshot bitmap width; they only show below liveScale
  label: 'rgba(60,50,40,0.7)', title: 'rgba(40,30,20,0.85)', subtitle: 'rgba(60,50,40,0.6)',
  postitBg: '#fef4a8', postitText: '#5a4a2a',
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
.dc-card img.dc-thumb{display:block;width:100%;height:100%;object-fit:cover;object-position:top left;background:#fff}
.dc-moving .dc-card iframe{pointer-events:none}
.dc-shield{position:absolute;inset:0;cursor:pointer}
.dc-header{position:absolute;bottom:100%;left:-4px;margin-bottom:calc(4px * var(--dc-inv-zoom,1));z-index:2;display:flex;align-items:center;container-type:inline-size}
.dc-labelrow{display:flex;align-items:center;gap:4px;height:24px;flex:1 1 auto;min-width:0}
.dc-grip{flex:0 0 auto;cursor:grab;display:flex;align-items:center;padding:5px 4px;border-radius:4px;transition:background .12s,opacity .12s}
.dc-grip:hover{background:rgba(0,0,0,.08)}
.dc-grip:active{cursor:grabbing}
.dc-labeltext{flex:1 1 auto;min-width:0;cursor:pointer;border-radius:4px;padding:3px 6px;display:flex;align-items:center;transition:background .12s;overflow:hidden}
@container (max-width: 110px){.dc-labeltext{display:none}.dc-grip{opacity:0}[data-dc-slot]:hover .dc-grip{opacity:1}}
.dc-labeltext:hover{background:rgba(0,0,0,.05)}
.dc-labeltext .dc-editable{overflow:hidden;text-overflow:ellipsis;max-width:100%}
.dc-labeltext .dc-editable:focus{overflow:visible;text-overflow:clip}
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
.dc-header{width:calc((100% + 4px) / var(--dc-inv-zoom,1));transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom left}
.dc-sectionhead{zoom:var(--dc-inv-zoom,1)}
.dc-notes{zoom:var(--dc-inv-zoom,1)}
.dc-placeholder{width:100%;height:100%;background:repeating-linear-gradient(135deg,#f6f4f0 0 12px,#eeece7 12px 24px);display:flex;align-items:center;justify-content:center;color:#9a958c;font:500 14px ui-monospace,Menlo,monospace}
`;
  document.head.appendChild(s);
}

const DCCtx = React.createContext(null);
// Shared "is the world moving" flag: toggled by DCViewport, read via CSS class.
let dcMovingTimer = 0;
function dcMarkMoving(vp) {
  if (!vp) return;
  if (!vp.classList.contains('dc-moving')) vp.classList.add('dc-moving');
  clearTimeout(dcMovingTimer);
  dcMovingTimer = setTimeout(() => vp.classList.remove('dc-moving'), 120);
}

// Shared zoom signal: DCViewport writes it once per flushed frame; lazy frames
// subscribe and only re-render when their live/thumb decision changes.
// One settle timer, one poll and one IntersectionObserver serve every slot,
// instead of N timers firing per frame.
const dcZoom = { scale: 1, subs: new Set(), timer: 0, poll: 0, io: null };
// Mounting an iframe is the one expensive step (a whole document parses and
// lays out), so at most one slot goes live per pass; the rest wait a beat.
function dcLodRun() {
  let mounted = false, pending = false;
  dcZoom.subs.forEach((f) => {
    try {
      const r = f(!mounted);          // returns 'mount' when it wants to go live
      if (r === 'mount') mounted = true;
      else if (r === 'wait') pending = true;
    } catch {}
  });
  if (pending) { clearTimeout(dcZoom.timer); dcZoom.timer = setTimeout(dcLodRun, DC.mountGapMs); }
}
function dcLodSchedule() { clearTimeout(dcZoom.timer); dcZoom.timer = setTimeout(dcLodRun, DC.settleMs); }
function dcSetZoom(scale) { dcZoom.scale = scale; dcLodSchedule(); }
function dcLodSubscribe(el, decide) {
  if (!dcZoom.subs.size) {
    dcZoom.poll = setInterval(dcLodRun, 500);
    document.addEventListener('visibilitychange', dcLodSchedule);
    if (!dcZoom.io) dcZoom.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
  dcZoom.subs.add(decide); dcZoom.io.observe(el);
  return () => {
    dcZoom.subs.delete(decide); dcZoom.io.unobserve(el);
    if (!dcZoom.subs.size) { clearInterval(dcZoom.poll); clearTimeout(dcZoom.timer); document.removeEventListener('visibilitychange', dcLodSchedule); }
  };
}

// ---------------------------------------------------------------------------
// In-browser snapshots. dcSnap.want(src, w, h, cb) registers a slot; cb gets a
// data URL as soon as one exists (memory → IndexedDB → freshly rasterized).
// Rasterizing = fetch html → DOMParser → strip scripts → inline same-origin
// images + Google Fonts CSS (woff2 as data:) → XMLSerializer → SVG
// foreignObject → <img> → <canvas> → webp data URL. Runs one artboard at a
// time, only while the canvas is idle and the tab is visible.
const dcSnap = {
  mem: new Map(),          // src → { hash, data }
  subs: new Map(),         // src → Set(cb)
  queue: [],               // [{ src, w, h }]
  queued: new Set(),
  busy: false,
  fontCss: new Map(),      // href → Promise<string>
  db: null,
  get(src) { const e = this.mem.get(src); return e ? e.data : null; },
  want(src, w, h, cb) {
    if (!this.subs.has(src)) this.subs.set(src, new Set());
    this.subs.get(src).add(cb);
    const e = this.mem.get(src); if (e) cb(e.data);
    if (!this.queued.has(src)) { this.queued.add(src); this.queue.push({ src, w, h }); this.kick(); }
    return () => { const s = this.subs.get(src); if (s) { s.delete(cb); if (!s.size) this.subs.delete(src); } };
  },
  kick() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
    idle(() => this.step());
  },
  async step() {
    const moving = document.querySelector('.design-canvas.dc-moving');
    if (moving || document.visibilityState !== 'visible') { setTimeout(() => this.step(), 250); return; }
    const job = this.queue.shift();
    if (job) {
      try { await this.make(job); } catch (e) { console.warn('[dc-snap]', job.src, e && e.message); }
      this.queued.delete(job.src);
    }
    this.busy = false;
    this.kick();
  },
  emit(src, data) { const s = this.subs.get(src); if (s) s.forEach((cb) => { try { cb(data); } catch {} }); },
  async make({ src, w, h }) {
    const html = await (await fetch(src)).text();
    const hash = dcHash(html) + ':' + w + 'x' + h;
    let cached = this.mem.get(src) || (await this.dbGet(src));
    if (cached && cached.hash === hash) { this.mem.set(src, cached); this.emit(src, cached.data); return; }
    const data = await dcRasterize(html, new URL(src, location.href).href, w, h);
    const entry = { hash, data };
    this.mem.set(src, entry); this.emit(src, data);
    await this.dbPut(src, entry);
  },
  open() {
    if (this.db) return this.db;
    this.db = new Promise((res) => {
      try {
        const r = indexedDB.open('dc-snapshots', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('snap');
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch { res(null); }
    });
    return this.db;
  },
  async dbGet(k) {
    const db = await this.open(); if (!db) return null;
    return new Promise((res) => { try { const q = db.transaction('snap').objectStore('snap').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } });
  },
  async dbPut(k, v) {
    const db = await this.open(); if (!db) return;
    return new Promise((res) => { try { const tx = db.transaction('snap', 'readwrite'); tx.objectStore('snap').put(v, k); tx.oncomplete = res; tx.onerror = res; } catch { res(); } });
  },
};

function dcHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + ':' + s.length; }

const dcBlobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

// Google Fonts CSS with the latin/arabic faces inlined as data: URLs, cached per href.
function dcFontCss(href) {
  if (!dcSnap.fontCss.has(href)) dcSnap.fontCss.set(href, (async () => {
    const css = await (await fetch(href)).text();
    const blocks = css.split('@font-face').slice(1).map((b) => '@font-face' + b)
      .filter((b) => /\/\* (latin|arabic) \*\//.test(b));
    const out = [];
    for (const b of blocks) {
      const m = b.match(/url\(([^)]+)\)/); if (!m) continue;
      try { const d = await dcBlobToDataUrl(await (await fetch(m[1])).blob()); out.push(b.replace(m[1], d)); } catch {}
    }
    return out.join('\n');
  })().catch(() => ''));
  return dcSnap.fontCss.get(href);
}

async function dcRasterize(html, baseHref, w, h) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base'); base.href = baseHref; doc.head.prepend(base);
  doc.querySelectorAll('script, iframe, video, audio, noscript').forEach((e) => e.remove());
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"]')]) {
    const url = link.href; let css = '';
    try {
      if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) css = await dcFontCss(url);
      else if (new URL(url).origin === location.origin) css = await (await fetch(url)).text();
    } catch {}
    const st = doc.createElement('style'); st.textContent = css; link.replaceWith(st);
  }
  doc.querySelectorAll('link').forEach((e) => e.remove());
  for (const img of [...doc.images]) {
    const url = img.src; if (!url || url.startsWith('data:')) continue;
    try { img.setAttribute('src', await dcBlobToDataUrl(await (await fetch(url)).blob())); } catch { img.remove(); }
  }
  base.remove();
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image(); img.src = svgUrl; await img.decode();
  const k = Math.min(1, DC.snapWidth / w);
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/webp', 0.8); } catch { return svgUrl; }
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

function DesignCanvas({ children, minScale, maxScale, style, stateFile = DC_STATE_FILE }) {
  const [state, setState] = React.useState({ sections: {}, focus: null });
  const [ready, setReady] = React.useState(false);
  const didRead = React.useRef(false);
  const skipNextWrite = React.useRef(false);

  React.useEffect(() => {
    let off = false;
    fetch('./' + stateFile)
      .then((r) => (r.ok ? r.json() : null))
      .then((saved) => {
        if (off || !saved || !saved.sections) return;
        skipNextWrite.current = true;
        setState((s) => ({ ...s, sections: saved.sections }));
      })
      .catch(() => {})
      .finally(() => { didRead.current = true; if (!off) setReady(true); });
    const t = setTimeout(() => { if (!off) setReady(true); }, 150);
    return () => { off = true; clearTimeout(t); };
  }, []);

  React.useEffect(() => {
    if (!didRead.current) return;
    if (skipNextWrite.current) { skipNextWrite.current = false; return; }
    const t = setTimeout(() => {
      window.omelette?.writeFile(stateFile, JSON.stringify({ sections: state.sections })).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [state.sections]);

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

  const api = React.useMemo(() => ({
    state,
    section: (id) => state.sections[id] || {},
    patchSection: (id, p) => setState((s) => ({
      ...s, sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
    })),
    setFocus: (slotId) => setState((s) => ({ ...s, focus: slotId })),
  }), [state]);

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

  // rAF-coalesced DOM write: many wheel ticks per frame collapse into one transform.
  const flushNow = React.useCallback(() => {
    raf.current = 0;
    const { x, y, scale } = tf.current;
    const el = worldRef.current; if (!el) return;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    el.style.setProperty('--dc-inv-zoom', String(1 / scale));
    dcSetZoom(scale);
    if (lastPostedScale.current !== scale) {
      lastPostedScale.current = scale;
      window.parent.postMessage({ type: '__dc_zoom', scale }, '*');
    }
    dcMarkMoving(vpRef.current);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { try { localStorage.setItem(tfKey, JSON.stringify(tf.current)); } catch {} }, 300);
  }, [tfKey]);
  const apply = React.useCallback((sync) => {
    if (sync) { if (raf.current) cancelAnimationFrame(raf.current); flushNow(); return; }
    if (!raf.current) raf.current = requestAnimationFrame(flushNow);
  }, [flushNow]);

  React.useLayoutEffect(() => {
    const flush = () => { clearTimeout(saveT.current); try { localStorage.setItem(tfKey, JSON.stringify(tf.current)); } catch {} };
    let restored = false;
    try {
      const s = JSON.parse(localStorage.getItem(tfKey) || 'null');
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale)) {
        tf.current = { x: s.x, y: s.y, scale: Math.min(maxScale, Math.max(minScale, s.scale)) };
        restored = true; apply(true);
      }
    } catch {}
    // First visit: fit the widest section to the viewport width.
    const fit = setTimeout(() => {
      if (restored) return;
      const w = worldRef.current; if (!w) return;
      let maxW = 0;
      w.querySelectorAll('[data-dc-row]').forEach((r) => { maxW = Math.max(maxW, r.scrollWidth + 120); });
      if (!maxW) return;
      const s = Math.min(1, Math.max(minScale, (window.innerWidth) / maxW));
      tf.current = { x: 0, y: 0, scale: s }; apply(true);
    }, 60);
    const rescue = setTimeout(() => {
      const slots = document.querySelectorAll('[data-dc-slot]');
      if (!slots.length) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const el of slots) { const r = el.getBoundingClientRect(); if (r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh) return; }
      const r = slots[0].getBoundingClientRect(); const t = tf.current;
      t.x += 60 - r.left; t.y += 100 - r.top; apply(true);
    }, 500);
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(fit); clearTimeout(rescue); window.removeEventListener('pagehide', flush); flush(); };
  }, []);

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
      if (isGesturing) return;
      if ((e.ctrlKey || e.metaKey) && !isMouseWheel(e)) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else if (isMouseWheel(e)) zoomAt(e.clientX, e.clientY, Math.exp(-Math.sign(e.deltaY) * 0.18));
      else { tf.current.x -= e.deltaX; tf.current.y -= e.deltaY; apply(); }
    };
    const onGestureStart = (e) => { e.preventDefault(); isGesturing = true; gsBase = tf.current.scale; };
    const onGestureChange = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, (gsBase * e.scale) / tf.current.scale); };
    const onGestureEnd = (e) => { e.preventDefault(); isGesturing = false; };

    let drag = null;
    const onPointerDown = (e) => {
      const onBg = !e.target.closest('[data-dc-slot], .dc-editable, .dc-nav');
      if (!(e.button === 1 || (e.button === 0 && onBg))) return;
      e.preventDefault();
      vp.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
      vp.style.cursor = 'grabbing'; vp.classList.add('dc-moving');
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
  }, [apply, minScale, maxScale]);

  const gridSvg = `url("data:image/svg+xml,%3Csvg width='120' height='120' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M120 0H0v120' fill='none' stroke='${encodeURIComponent(DC.grid)}' stroke-width='1'/%3E%3C/svg%3E")`;
  return (
    <div ref={vpRef} className="design-canvas"
      style={{ height: '100vh', width: '100vw', background: DC.bg, overflow: 'hidden', overscrollBehavior: 'none', touchAction: 'none', position: 'relative', fontFamily: DC.font, boxSizing: 'border-box', ...style }}>
      <div ref={worldRef} style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform', width: 'max-content', minWidth: '100%', minHeight: '100%', padding: 'calc(72px * var(--dc-inv-zoom,1)) 0 80px' }}>
        <div style={{ position: 'absolute', inset: -8000, backgroundImage: gridSvg, backgroundSize: '120px 120px', pointerEvents: 'none', zIndex: -1 }} />
        {children}
      </div>
    </div>
  );
}

function DCSection({ id, title, subtitle, children, gap = 48 }) {
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

  return (
    <div data-dc-section={sid} style={{ marginBottom: 'calc(80px * var(--dc-inv-zoom, 1))', position: 'relative' }}>
      <div style={{ padding: '0 60px' }}>
        <div className="dc-sectionhead" style={{ paddingBottom: 36 }}>
          <DCEditable tag="div" value={sec.title ?? title}
            onChange={(v) => ctx && sid && ctx.patchSection(sid, { title: v })}
            style={{ fontSize: 28, fontWeight: 600, color: DC.title, letterSpacing: -0.4, marginBottom: 6, display: 'inline-block' }} />
          {subtitle && <div style={{ fontSize: 16, color: DC.subtitle }}>{subtitle}</div>}
        </div>
      </div>
      {rest.length > 0 && <div className="dc-notes" style={{ padding: '0 60px 40px', display: 'flex', gap: 24, alignItems: 'flex-start', width: 'max-content' }}>{rest}</div>}
      <div data-dc-row="" style={{ display: 'flex', gap, padding: '0 60px', alignItems: 'flex-start', width: 'max-content' }}>
        {order.map((k) => (
          <DCArtboardFrame key={k} sectionId={sid} artboard={byId[k]} order={order}
            label={(sec.labels || {})[k] ?? byId[k].props.label}
            onRename={(v) => ctx && ctx.patchSection(sid, (x) => ({ labels: { ...x.labels, [k]: v } }))}
            onReorder={(next) => ctx && ctx.patchSection(sid, { order: next })}
            onDelete={() => ctx && ctx.patchSection(sid, (x) => ({ hidden: [...(x.srcKey === srcKey ? (x.hidden || []) : []), k], srcKey }))}
            onFocus={() => ctx && ctx.setFocus(`${sid}/${k}`)} />
        ))}
      </div>
    </div>
  );
}

function DCArtboard() { return null; }

// Lazy frame with three levels of detail:
//   live  — a real iframe. Mounted when the slot is within `margin` px of the
//           viewport AND zoom >= DC.liveScale; dropped again once it drifts
//           past DC.unmountMargin or zoom falls below the threshold.
//   snap  — an in-browser snapshot (dcSnap). Shown whenever not live.
//   placeholder — until a snapshot exists.
// `eager` forces a live iframe regardless (focus overlay). Mode switches wait
// DC.settleMs after the last zoom/pan tick so a pinch doesn't thrash iframes.
function DCLazyFrame({ src, title, width, height, eager = false, margin = 600, href }) {
  const ref = React.useRef(null);
  const [live, setLive] = React.useState(eager);
  const [snap, setSnap] = React.useState(() => dcSnap.get(src));
  React.useEffect(() => { if (!eager) return dcSnap.want(src, width, height, setSnap); }, [src, width, height, eager]);
  React.useEffect(() => {
    if (eager || !ref.current) return;
    let isLive = live;
    // Measure the slot, not the inner div: the slot has content-visibility:auto,
    // so reading a descendant's rect would force layout of a skipped subtree.
    const box = ref.current.closest('[data-dc-slot]') || ref.current;
    const within = (m) => {
      const r = box.getBoundingClientRect();
      return r.right > -m && r.left < innerWidth + m && r.bottom > -m && r.top < innerHeight + m;
    };
    const decide = (mayMount = true) => {
      const zoomOk = dcZoom.scale >= DC.liveScale;
      const want = isLive ? (zoomOk && within(DC.unmountMargin)) : (zoomOk && within(margin));
      if (want === isLive) return null;
      if (want && !mayMount) return 'wait';
      isLive = want; setLive(want);
      return want ? 'mount' : null;
    };
    decide();
    return dcLodSubscribe(box, decide);
  }, [eager, margin]);
  const on = eager || live;
  // Shield: iframes swallow wheel/pinch, so a transparent layer sits over the
  // screen and lets the canvas zoom/pan. A click opens the screen's own file
  // (where it can be edited); the ⋯ menu opens it in a new tab.
  return (
    <div ref={ref} style={{ width, height, position: 'relative' }}>
      {on ? <iframe src={src} title={title} loading="lazy" style={{ width, height }} />
        : snap ? <img className="dc-thumb" src={snap} alt={title} decoding="async" draggable={false} />
        : <div className="dc-placeholder">{title}</div>}
      {!eager && <div className="dc-shield" title="Open to edit" onClick={() => { if (href) location.href = href; }} />}
    </div>
  );
}

function DCArtboardFrame({ sectionId, artboard, label, order, onRename, onReorder, onFocus, onDelete }) {
  const { id: rawId, label: rawLabel, width = 260, height = 480, children, style = {}, href } = artboard.props;
  const id = rawId ?? rawLabel;
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

  const onGripDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const me = ref.current;
    const scale = me.getBoundingClientRect().width / me.offsetWidth || 1;
    const peers = Array.from(document.querySelectorAll(`[data-dc-section="${sectionId}"] [data-dc-slot]`));
    const homes = peers.map((el) => ({ el, id: el.dataset.dcSlot, x: el.getBoundingClientRect().left }));
    const slotXs = homes.map((h) => h.x);
    const startIdx = order.indexOf(id);
    const startX = e.clientX;
    let liveOrder = order.slice();
    me.classList.add('dc-dragging');
    const vp = me.closest('.design-canvas'); vp && vp.classList.add('dc-moving');
    const layout = () => {
      for (const h of homes) { if (h.id === id) continue; h.el.style.transform = `translateX(${(slotXs[liveOrder.indexOf(h.id)] - h.x) / scale}px)`; }
    };
    const move = (ev) => {
      const dx = ev.clientX - startX;
      me.style.transform = `translateX(${dx / scale}px)`;
      const cur = homes[startIdx].x + dx;
      let nearest = 0, best = Infinity;
      for (let i = 0; i < slotXs.length; i++) { const d = Math.abs(slotXs[i] - cur); if (d < best) { best = d; nearest = i; } }
      if (liveOrder.indexOf(id) !== nearest) { liveOrder = order.filter((k) => k !== id); liveOrder.splice(nearest, 0, id); layout(); }
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      const finalSlot = liveOrder.indexOf(id);
      me.classList.remove('dc-dragging');
      me.style.transform = `translateX(${(slotXs[finalSlot] - homes[startIdx].x) / scale}px)`;
      setTimeout(() => {
        for (const h of homes) { h.el.style.transition = 'none'; h.el.style.transform = ''; }
        if (liveOrder.join('|') !== order.join('|')) onReorder(liveOrder);
        vp && vp.classList.remove('dc-moving');
        requestAnimationFrame(() => requestAnimationFrame(() => { for (const h of homes) h.el.style.transition = ''; }));
      }, 180);
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} data-dc-slot={id} style={{ position: 'relative', flexShrink: 0 }}>
      <div className="dc-header" data-noncommentable="" style={{ color: DC.label }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dc-labelrow">
          <div className="dc-grip" onPointerDown={onGripDown} title="Drag to reorder">
            <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
          </div>
          <div className="dc-labeltext" onClick={onFocus} title="Click to focus">
            <DCEditable value={label} onChange={onRename} onClick={(e) => e.stopPropagation()} style={{ fontSize: 15, fontWeight: 500, color: DC.label, lineHeight: 1 }} />
          </div>
        </div>
        <div className="dc-btns">
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button className="dc-kebab" title="More" onClick={() => setMenuOpen((o) => !o)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="2.5" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="9.5" cy="6" r="1.1"/></svg>
            </button>
            {menuOpen && (
              <div className="dc-menu" onPointerDown={(e) => e.stopPropagation()}>
                {href && <button onClick={() => { setMenuOpen(false); window.open(href, '_blank'); }}>Open screen</button>}
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
  const { width = 260, height = 480, children, href } = artboard.props;
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
    <div onClick={() => ctx.setFocus(null)} onWheel={(e) => e.preventDefault()}
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
        <div onClick={(e) => e.stopPropagation()} style={{ fontSize: 14, fontWeight: 500, opacity: .85, textAlign: 'center' }}>
          {(sec.labels || {})[aid] ?? artboard.props.label}
          <span style={{ opacity: .5, marginLeft: 10, fontVariantNumeric: 'tabular-nums' }}>{idx + 1} / {peers.length}</span>
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

Object.assign(window, { DesignCanvas, DCSection, DCArtboard, DCPostIt, DCLazyFrame, DCCtx, DCLib });
