// design-canvas.jsx — pan/zoom canvas: sections, artboards as windows (reorder
// / rename / delete, every option in the window header), post-its. Ported from the
// fatoora project with performance work for heavy artboards (full-page
// iframes):
//   • DCLazyFrame mounts an iframe for a slot that obeys two conditions. The
//     slot must be near the viewport. The slot must also be one of the
//     DC.liveBudget slots nearest to the viewport centre. Nearness is
//     necessary, but the budget makes the decision. All other slots show a
//     placeholder. At 5 % zoom the full page is on screen, but only
//     DC.liveBudget iframes mount
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
  budgetHysteresis: 400, // px a live slot counts as nearer; it keeps the last place stable
  stickyMs: 4000,       // a slot keeps its place in the budget this long after a
                        // pointer goes down on it or comes up on it, so a card
                        // you are working on does not drop under you. The
                        // pointer up is what makes a drag longer than this
                        // window keep its place: no pass runs during a drag
  stickyBias: 1e6,      // px a touched slot counts as nearer. It outranks every
                        // real distance, but it never outranks a visible slot:
                        // the visible sort runs first, and that rule exists to
                        // stop off-screen frames holding the budget
  unmountMargin: 1600,  // px of screen space beyond which a live iframe is dropped
  movingMs: 220,        // how long a pan or a zoom counts as still moving. It
                        // MUST be more than settleMs. The LOD pass is armed for
                        // settleMs and refuses to run while the world moves, so
                        // a shorter window lets the flag clear first and the
                        // guard never fires: slots then mounted and dropped
                        // between two wheel notches, and the cards blinked
  settleMs: 150,        // wait after the last zoom or pan change. Three things then
                        // occur: the LOD pass runs, the --dc-inv-zoom variable is
                        // written, and the lost-pill check runs. A larger value
                        // also delays the mount of an iframe. It does not move
                        // the view: nothing in the world's layout reads the zoom
  mountGapMs: 60,       // gap between two iframe mounts; two in one frame make it long
  rescueMs: 500,        // after the fit: if no slot is on screen, nudge slot 0 into view
  stateTimeoutMs: 1500,  // give up on the state file read; the browser copy then wins
  saveDebounceMs: 400,   // wait after the last edit before the state file is written
  label: 'rgba(60,50,40,0.7)', title: 'rgba(40,30,20,0.85)', subtitle: 'rgba(60,50,40,0.6)',
  postitBg: '#fef4a8', postitText: '#5a4a2a',
  noteReserveH: 240,    // height a free-placed note reserves in the page box
  winHead: 64,          // the window header: name, chips, buttons. World px,
  winPad: 36,           // as is the padding around the screen, so the chrome
  winBody: '#eae7e1',   // grows and shrinks with the card
  sectionHeadMax: 1.75, // most the section head counter-scales. The rule
                        // below gives the arithmetic
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
/* A page is a window: a header with the name and the page options, then the
   screen inset in the body. The chrome is world px, so it grows and shrinks
   with the card, as the flow labels do. */
[data-dc-slot].dc-dragging .dc-win{box-shadow:0 12px 40px rgba(0,0,0,.25),0 0 0 2px #c96442;transform:scale(1.02)}
.dc-win{position:relative;background:#fff;border-radius:18px;overflow:hidden;transition:box-shadow .18s ease,transform .18s ease;box-shadow:0 1px 3px rgba(40,32,22,.08),0 12px 30px -14px rgba(40,32,22,.35)}
[data-dc-slot]:hover:not(.dc-dragging) .dc-win{transform:translateY(-3px);box-shadow:0 2px 6px rgba(40,32,22,.08),0 26px 50px -18px rgba(40,32,22,.4)}
.dc-winhead{display:flex;align-items:center;gap:14px;padding:0 22px;cursor:grab;user-select:none;border-bottom:1px solid rgba(40,32,22,.07)}
.dc-winhead:active{cursor:grabbing}
.dc-dot{flex:0 0 12px;height:12px;border-radius:6px;background:#cfc9bf;transition:background .18s}
[data-dc-slot]:has([data-dc-live="1"]) .dc-dot{background:#12a594}
.dc-wintitle{flex:1 1 auto;min-width:0;display:flex;align-items:center;overflow:hidden}
.dc-wintitle .dc-editable{overflow:hidden;text-overflow:ellipsis;max-width:100%;font-size:22px;font-weight:600;letter-spacing:-.3px;color:#1e1b16;line-height:1.2}
.dc-wintitle .dc-editable:focus{overflow:visible;text-overflow:clip}
.dc-card{isolation:isolate;contain:layout paint}
.dc-card *{scrollbar-width:none}
.dc-card *::-webkit-scrollbar{display:none}
.dc-card iframe{display:block;border:0;background:#fff}
.dc-moving .dc-card iframe{pointer-events:none}
/* Ctrl (or ⌘) held: the whole page is a grip. The screen iframe stops taking
   the pointer, so a Ctrl+click on it reaches the slot (see onSlotDownCapture). */
.dc-grab [data-dc-slot]{cursor:grab}
.dc-grab .dc-card iframe{pointer-events:none}
.dc-shield{position:absolute;inset:0;cursor:pointer}
/* One bar at the right of the header: the variant chips, then the actions.
   It is always visible; nothing in it waits for a hover. */
.dc-bar{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:4px;border-radius:11px;background:rgba(40,32,22,.05);box-shadow:inset 0 0 0 1px rgba(40,32,22,.05)}
.dc-bar hr{flex:0 0 1px;width:1px;height:20px;margin:0 2px;border:0;background:rgba(40,32,22,.12)}
.dc-chips{flex:0 0 auto;display:flex;gap:6px}
.dc-sizes{flex:0 0 auto;display:inline-flex;gap:2px;padding:2px;background:#fff;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(40,32,22,.07)}
.dc-size{border:0;padding:6px 10px;border-radius:6px;background:transparent;font:600 12px/1 inherit;font-family:inherit;color:rgba(60,50,40,.65);cursor:pointer;letter-spacing:.02em;transition:background .12s,color .12s}
.dc-size:hover{color:#2a251f}
.dc-size.dc-on{background:#12a594;color:#fff}
.dc-btns{flex:0 0 auto;display:flex;gap:2px;align-items:center}
[data-dc-slot]:has(.dc-menu){z-index:10}
.dc-kebab,.dc-openbtn{width:28px;height:28px;border-radius:7px;border:none;cursor:pointer;padding:0;background:transparent;color:rgba(60,50,40,.65);display:flex;align-items:center;justify-content:center;font:inherit;transition:background .12s,color .12s}
.dc-kebab:hover,.dc-openbtn:hover{background:#fff;color:#1e1b16;box-shadow:inset 0 0 0 1px rgba(40,32,22,.07)}
.dc-menu{position:absolute;top:100%;right:0;margin-top:4px;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.05);padding:5px;min-width:180px;z-index:10}
.dc-menu button{display:block;width:100%;padding:9px 12px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:14px;font-weight:500;line-height:1.2;color:#29261b;cursor:pointer;text-align:left;transition:background .12s;white-space:nowrap}
.dc-menu button:hover{background:rgba(0,0,0,.05)}
.dc-menu hr{border:0;border-top:1px solid rgba(0,0,0,.08);margin:5px 3px}
.dc-menu .dc-danger{color:#c96442}
.dc-menu .dc-danger:hover{background:rgba(201,100,66,.1)}
/* The section head follows the same rule by transform, not by zoom: a transform
   never reflows, so the head keeps a fixed world box and the world's layout
   stays free of the zoom. The head grows from its bottom edge, upwards into the
   gap above it. The cap keeps the grown head inside that gap. A head with a
   title and a subtitle measures 93 px high in headless Chrome at these styles.
   The smaller gap is the 72 px world top padding; the section gap is 80 px. The
   head thus grows at most 1 + 72 / 93 = 1.77 times. The cap of 1.75 grows a
   93 px head by 0.75 x 93 = 70 px, which stays in the 72 px. Below 57 % zoom
   (1 / 1.75) the head follows the world. A change to the title size, the
   subtitle size or the head padding changes the 93 px. Measure the head again
   and calculate the cap again. The check "a grown section head stays inside its
   gap" fails if you do not. */
.dc-sectionhead{transform:scale(min(var(--dc-inv-zoom,1),${DC.sectionHeadMax}));transform-origin:bottom left}
/* Shown only when no section is on screen. */
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
// Shared "is the world moving" flag. Two sources set it: a pan or a zoom arms
// dcMarkMoving, which clears itself after DC.movingMs; a card drag holds
// dcDragDepth for the length of the gesture. dcMoving() reads both.
// The .dc-moving class drives CSS only (live iframes lose pointer events).
// dcSyncMoving is the one writer of that class: it copies dcMoving() onto every
// viewport, so the class can never disagree with the flag.
// The flag is global on purpose. A gesture in one viewport freezes the LOD
// registry for the whole page, so every viewport gets the same answer.
// dcSyncedOn holds the state already written. A pan calls dcSyncMoving in each
// flushed frame, and the answer only changes twice per gesture, so the cache
// keeps the querySelectorAll off the pan and zoom path.
let dcMovingTimer = 0;
let dcDragDepth = 0;
let dcSyncedOn = null;
const dcMoving = () => dcMovingTimer !== 0 || dcDragDepth > 0;
function dcSyncMoving() {
  const on = dcMoving();
  if (on === dcSyncedOn) return;
  dcSyncedOn = on;
  document.querySelectorAll('.design-canvas').forEach((vp) => vp.classList.toggle('dc-moving', on));
}
// A viewport that mounts during a gesture carries no class yet. This drops the
// cache, so the next sync writes to it as well.
function dcSyncMovingForce() { dcSyncedOn = null; dcSyncMoving(); }
function dcMarkMoving() {
  clearTimeout(dcMovingTimer);
  dcMovingTimer = setTimeout(() => { dcMovingTimer = 0; dcSyncMoving(); dcLodSchedule(); }, DC.movingMs);
  dcSyncMoving();
}

// The level-of-detail registry. Every slot subscribes to it. One settle timer,
// one poll and one IntersectionObserver serve them all, instead of N timers
// that fire per frame.
// `world` is the transformed element the slots sit in, and `gen` is the
// measurement generation. DCViewport writes both through dcSetCamera on every
// flushed frame, and gives the world back through dcClearCamera when it goes
// away. `world` is thus null, and not a dead element, between one canvas and
// the next. `scale` drives no decision in the app: dcLodRun ranks slots by
// distance and budget only. The field is kept because perf/bench.js reads it to
// know where the view is.
const dcLod = { scale: 1, world: null, gen: 0, subs: new Set(), timer: 0, poll: 0, io: null };

// A slot's box inside the world does not move when the world pans or zooms.
// The world carries transform-origin 0 0. Only .dc-sectionhead reads
// --dc-inv-zoom now, and it reads it through a transform, which never
// reflows. The world layout is thus the same at every zoom. Each entry
// therefore holds its world box and the generation it was measured in, and
// one pass turns the held boxes into screen space with one rect read of the
// world itself.
// Call dcLodInvalidate whenever the DOM moves a slot. A missed call costs a
// slightly wrong ranking until the next real one, never a wrong render.
function dcLodInvalidate() { dcLod.gen++; dcLodSchedule(); }
// A pointer down anywhere in a slot marks it, and the pointer up marks it
// again. The mark wins the budget for DC.stickyMs, so a card you drag, rename
// or open the ⋯ menu on does not drop while you work on it. It does not win
// the margin, and it does not win against a visible slot: a slot that has left
// the screen must still give its place up.
// The second mark is what makes the window start at the end of the gesture. A
// drag holds the registry moving for its whole length, so no pass reads the
// mark until the drop. A drag longer than DC.stickyMs would then find a stale
// mark, at the one moment the mark is for. The drag holds the pointer capture,
// so the pointer up reaches the dragged slot even outside it. A drag that the
// browser cancels gets no second mark. That is safe: a cancelled drag commits
// no move, so the card keeps the place it already had.
// Capture phase, because the slot header stops propagation on its own pointer
// down. A pointer down inside a live iframe never reaches this document, so the
// mark covers the parent-side gestures only. The mark needs no clean-up: the
// 500 ms poll re-ranks within 500 ms of it going stale.
function dcTouch(e) {
  const box = e.target.closest && e.target.closest('[data-dc-slot]');
  if (!box) return;
  let hit = false;
  dcLod.subs.forEach((s) => { if (s.box === box) { s.touchedAt = performance.now(); hit = true; } });
  if (hit) dcLodSchedule();
}
// Distance from the viewport centre to the nearest point of a slot's box; 0
// when the centre is inside it. This is what ranks slots for the budget.
// `v` is the slot's own viewport box, not the window: a canvas in a panel must
// rank the slots that its user sees.
function dcSlotDistance(r, v) {
  const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
  const dx = Math.max(r.left - cx, 0, cx - r.right);
  const dy = Math.max(r.top - cy, 0, cy - r.bottom);
  return Math.hypot(dx, dy);
}

// One pass over every slot. The DC.liveBudget slots that are nearest to the
// viewport centre, and are inside their margin, become live. Visible slots
// rank ahead of off-screen preloads. All other slots show their placeholder.
// Near, visible and the centre are measured against the slot's own viewport
// box, not the window: a canvas in a panel must rank what its user sees.
// A live slot counts as DC.budgetHysteresis px nearer than it is. The slot in
// last place thus stays stable from pass to pass.
// The mount of an iframe is the one expensive step, because a full document
// parses and lays out. Only one slot mounts in each pass. The other slots wait
// for the next pass. A drop is cheap, and it has no such limit.
function dcLodRun() {
  // A pan or a pinch changes the ranking in each frame, and a drop removes a
  // full iframe. Do not measure the slots during the gesture. Wait until the
  // world stops. dcLodSchedule then runs this pass again.
  if (dcMoving()) { clearTimeout(dcLod.timer); dcLod.timer = setTimeout(dcLodRun, DC.settleMs); return; }
  // The registry lives longer than one canvas. There is thus no world to
  // measure against before the first flushed frame, and again after the
  // viewport goes away. A detached world is the same case: its rect is all
  // zeros, so every box that it makes is wrong.
  // With no world the pass measures each slot itself, as it did before the
  // held boxes. This costs one rect for each slot, but only in that short
  // window. It also keeps the budget correct at all times: an absent camera
  // can never leave the canvas with no live iframes.
  const cam = dcLod.world;
  const world = cam && cam.isConnected && cam.offsetWidth ? cam : null;
  // One rect read for the whole pass. The scale comes from the same read, so
  // it cannot fall out of step with the DOM the way a stored copy can.
  // offsetWidth is an integer, so the derived scale carries up to half a pixel
  // of error at the far edge of a wide world. That error can only change the
  // order of two slots that sit exactly on the viewport edge in the visible
  // sort.
  const wr = world ? world.getBoundingClientRect() : null;
  const scale = world ? wr.width / world.offsetWidth : 1;
  const now = performance.now();
  const all = [];
  // One rect per viewport, not one per slot: all the slots of a canvas share
  // its box.
  const vpRects = new Map();
  dcLod.subs.forEach((s) => {
    const vp = s.vp;
    let v = vpRects.get(vp);
    if (!v) { v = vp ? vp.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight }; vpRects.set(vp, v); }
    // A held box is an offset inside the camera's world, so it is only valid
    // for a slot that this world holds. A second canvas has its own world.
    // Its slots do not move with the camera, and a pan of the camera does not
    // put the generation up, so a held box for such a slot would be wrong on
    // every pass after the first one.
    const held = world && world.contains(s.box);
    let r;
    if (!held) {
      // Do not hold this box. There is no world of this slot's own to make it
      // relative to, so the next pass must measure the slot again.
      const b = s.box.getBoundingClientRect();
      r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    } else {
      if (s.gen !== dcLod.gen) {
        const b = s.box.getBoundingClientRect();
        // The edges, not width and height: near, visible and the distance ask
        // for the edges only, so a box that carries no size still ranks.
        s.wx = (b.left - wr.left) / scale; s.wy = (b.top - wr.top) / scale;
        s.ww = (b.right - b.left) / scale; s.wh = (b.bottom - b.top) / scale;
        s.gen = dcLod.gen;
      }
      const left = wr.left + s.wx * scale, top = wr.top + s.wy * scale;
      r = { left, top, right: left + s.ww * scale, bottom: top + s.wh * scale };
    }
    const m = s.live ? DC.unmountMargin : s.margin;
    const near = r.right > v.left - m && r.left < v.left + v.width + m && r.bottom > v.top - m && r.top < v.top + v.height + m;
    const visible = r.right > v.left && r.left < v.left + v.width && r.bottom > v.top && r.top < v.top + v.height;
    const sticky = s.touchedAt !== undefined && now - s.touchedAt < DC.stickyMs;
    all.push({ s, near, visible, d: dcSlotDistance(r, v) - (s.live ? DC.budgetHysteresis : 0) - (sticky ? DC.stickyBias : 0) });
  });
  // Hysteresis stabilizes peers, but must not let off-screen live frames keep
  // the entire budget while visible slots remain placeholders indefinitely.
  const ranked = all.filter((e) => e.near).sort((a, b) => Number(b.visible) - Number(a.visible) || a.d - b.d);
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
// The camera is the world element that the held boxes are relative to. Only
// DCViewport writes it, and only for the world that it owns.
function dcSetCamera(world, scale) {
  // A different world element means a different canvas. Its slots have not
  // been measured against it, so a stale generation would wrongly let them
  // keep their old boxes. Bump the generation to make those boxes invalid.
  if (dcLod.world !== world) dcLod.gen++;
  dcLod.world = world; dcLod.scale = scale; dcLodSchedule();
}
// The viewport calls this when it goes away. The registry must not keep a
// world that has left the page, because the held boxes are relative to that
// world only. The generation goes up with it, so no box can live on into a
// different world. The element is compared first: a canvas that goes away
// late must not clear the camera of a canvas that came after it.
function dcClearCamera(world) {
  if (dcLod.world !== world) return;
  dcLod.world = null; dcLod.gen++;
}
// entry is { box, vp, margin, live, set } — the slot element to measure, the
// viewport it lives in, the px of screen space that lets it mount, whether it
// is live now, and the setter that mounts or drops it. dcLodRun adds the held
// world box and its generation.
function dcLodSubscribe(entry) {
  if (!dcLod.subs.size) {
    dcLod.poll = setInterval(dcLodRun, 500);
    document.addEventListener('visibilitychange', dcLodSchedule);
    document.addEventListener('pointerdown', dcTouch, true);
    document.addEventListener('pointerup', dcTouch, true);
    if (!dcLod.io) dcLod.io = new IntersectionObserver(dcLodSchedule, { rootMargin: '600px' });
  }
  dcLod.subs.add(entry); dcLod.io.observe(entry.box);
  dcLodInvalidate();
  return () => {
    dcLod.subs.delete(entry); dcLod.io.unobserve(entry.box);
    dcLodInvalidate();
    if (!dcLod.subs.size) {
      clearInterval(dcLod.poll); clearTimeout(dcLod.timer); document.removeEventListener('visibilitychange', dcLodSchedule);
      document.removeEventListener('pointerdown', dcTouch, true);
      document.removeEventListener('pointerup', dcTouch, true);
    }
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

// The <foreignObject> wrapper for a rasterized artboard, and its data URL.
// `px` is the output scale. An <img>-loaded SVG rasterizes at its intrinsic
// size, so the SVG must carry the output resolution and map the artboard
// through viewBox. tests/regressions.js rasterizes through these two, so the
// check cannot pass while the export path drifts.
function dcArtboardSvg(xhtml, w, h, px = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
}
const dcSvgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// Per-artboard export from the kebab menu (kind: 'png' | 'html'). It uses the
// inliner on the artboard's source file. The export thus works whether the
// slot is live or shows its placeholder. The PNG is 2× the artboard's natural
// size.
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
  const img = new Image();
  img.src = dcSvgUrl(dcArtboardSvg(xhtml, w, h, px));
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
  const [state, setState] = React.useState({ sections: {}, updatedAt: 0 });
  const [ready, setReady] = React.useState(false);
  const savedSections = React.useRef(null);
  const fileWrites = React.useRef(Promise.resolve());

  // Prefer the newest revision. For unversioned legacy saves, the browser copy
  // wins: it may hold edits made where the existing file cannot be written.
  React.useEffect(() => {
    let off = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DC.stateTimeoutMs);
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
        setState({ sections, updatedAt: revision(saved) });
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
    // Mark the sections saved only after the host writes them. A failed write
    // thus stays pending, and the next write chance sends it again.
    const write = () => {
      clearTimeout(t);
      if (savedSections.current === state.sections) return;
      const mine = state.sections;
      fileWrites.current = fileWrites.current
        .then(() => window.omelette?.writeFile(stateFile, json))
        .then(() => { savedSections.current = mine; },
          (err) => { console.warn('[design-canvas] state file write failed; the browser copy holds the edits', err); });
    };
    const t = setTimeout(write, DC.saveDebounceMs);
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
      slotIds: [...kept, ...srcIds.filter((k) => !kept.includes(k))], srcKey,
    };
  });

  // patchSection keeps one identity for the life of the canvas, so the per-slot
  // callbacks built on it survive a state change. Only `state` and `section`
  // move, and only the components that read them re-render.
  // A section patch can also move a slot, so the held world boxes go stale
  // here. A variant changes a card's width and height, and every sibling to
  // its right in the flex row shifts. A reset position sends a freely placed
  // card back to its authored spot. The world keeps its own border box in both
  // cases, because it is as wide as its widest row and as tall as its tallest
  // card. The ResizeObserver on the world thus does not fire, and no other
  // path recovers the boxes: a pan or a zoom keeps the same world element and
  // puts no generation up. One call here covers every patch, which a call in
  // each action of dcActions would not: the next action added would miss it.
  const patchSection = React.useCallback((id, p) => {
    dcLodInvalidate();
    setState((s) => ({
      ...s, updatedAt: Math.max(Date.now(), s.updatedAt + 1),
      sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
    }));
  }, []);
  const api = React.useMemo(() => ({
    state,
    section: (id) => state.sections[id] || {},
    patchSection,
  }), [state, patchSection]);

  // Empty deps: the listener is registered once per canvas, not once per state
  // change. The escape key had a listener here as well; it closed the focus
  // overlay, and the window header replaced that overlay.
  React.useEffect(() => {
    const onPd = (e) => { const ae = document.activeElement; if (ae && ae.isContentEditable && !ae.contains(e.target)) ae.blur(); };
    document.addEventListener('pointerdown', onPd, true);
    return () => document.removeEventListener('pointerdown', onPd, true);
  }, []);

  return (
    <DCCtx.Provider value={api}>
      <DCViewport minScale={minScale} maxScale={maxScale} style={style}>{ready && children}</DCViewport>
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

  // Only .dc-sectionhead reads --dc-inv-zoom now, and it reads it through a
  // transform, which never reflows. The world's layout is thus the same at
  // every zoom, and this write cannot move a card.
  // It used to. The world padding, the section gaps and the .dc-sectionhead
  // zoom were all in screen units, so the settled write re-laid out the world
  // and stepped the content by 33 px for one wheel notch. A slow wheel roll
  // showed it worst: each notch is more than DC.settleMs apart, so the write
  // landed between the notches and every one got its own step.
  // The variable is still written on settle, not per frame: it is an inherited
  // custom property, so each write makes Chrome calculate the style of the full
  // world again — 0.4 ms at 10 slots, 1.1 ms at 40, in every frame of a pinch.
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
    dcSetCamera(el, scale);
    if (lastPostedScale.current !== scale) {
      lastPostedScale.current = scale;
      window.parent.postMessage({ type: '__dc_zoom', scale }, '*');
    }
    dcMarkMoving();
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
    // Hold the world element now. React can detach the ref before this
    // cleanup runs, and the cleanup must know which world it gives back.
    const world = worldRef.current;
    const flush = () => { clearTimeout(saveT.current); try { localStorage.setItem(tfKey, JSON.stringify(tf.current)); } catch {} };
    try {
      const s = JSON.parse(localStorage.getItem(tfKey) || 'null');
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale)) {
        tf.current = { x: s.x, y: s.y, scale: Math.min(maxScale, Math.max(minScale, s.scale)) };
        restoredView.current = true; apply(true);
      }
    } catch {}
    window.addEventListener('pagehide', flush);
    // This viewport may have mounted during a gesture in another one.
    dcSyncMovingForce();
    // The pill timer and the Back to content tween live as long as the
    // viewport, so they are stopped here and not in the fit effect, which
    // re-runs whenever the content or the scale bounds change.
    // The LOD registry is module state, so it also outlives this viewport.
    // Give the world back, or the next canvas ranks against a dead one.
    return () => {
      clearTimeout(lostT.current); clearTimeout(invT.current);
      if (tween.current) cancelAnimationFrame(tween.current);
      dcClearCamera(world);
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
      // A restored view is the user's choice, even one with nothing on screen.
      if (restoredView.current) return;
      const slots = worldRef.current.querySelectorAll('[data-dc-slot]');
      if (!slots.length) return;
      const v = vpRef.current.getBoundingClientRect();
      for (const el of slots) { const r = el.getBoundingClientRect(); if (r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom) return; }
      const r = slots[0].getBoundingClientRect(); const t = tf.current;
      t.x += v.left + 60 - r.left; t.y += v.top + 100 - r.top; apply(true);
    }, DC.rescueMs);
    return () => { cancelAnimationFrame(fit); clearTimeout(rescue); };
  }, [hasContent, apply, minScale, maxScale]);

  // The pages can also leave the screen with the view held still: the window
  // gets smaller, or the section box grows as a page is moved. Neither goes
  // through flushNow, so watch for both.
  React.useEffect(() => {
    const schedule = () => {
      dcLodInvalidate();
      clearTimeout(lostT.current); lostT.current = setTimeout(checkLost, DC.settleMs);
    };
    const ro = new ResizeObserver(schedule);
    if (worldRef.current) ro.observe(worldRef.current);
    window.addEventListener('resize', schedule);
    return () => { ro.disconnect(); window.removeEventListener('resize', schedule); };
  }, [checkLost]);

  React.useEffect(() => {
    const vp = vpRef.current; if (!vp) return;
    const zoomAt = (cx, cy, factor) => {
      const r = vp.getBoundingClientRect();
      const px = cx - r.left, py = cy - r.top;
      const t = tf.current;
      const next = Math.min(maxScale, Math.max(minScale, t.scale * factor));
      const k = next / t.scale;
      if (k === 1) return;
      // No drift correction. This is exact arithmetic on tf, and the world's
      // layout no longer depends on the zoom at all, so a world point below the
      // pointer stays below the pointer with nothing to cancel.
      t.x = px - (px - t.x) * k; t.y = py - (py - t.y) * k; t.scale = next;
      apply(true);
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
      // Arm the flag here, so a click with no move still clears it after
      // DC.movingMs; dcLodRun freezes the whole LOD registry while it is set.
      // dcMarkMoving owns the timer and dcSyncMoving owns the class.
      vp.style.cursor = 'grabbing'; dcMarkMoving();
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
    // Ctrl (or ⌘ on a Mac) held turns every page into a grip. Keys inside a
    // screen iframe do not reach this window, so the class also follows the
    // modifier on pointer events over the viewport, and blur clears it.
    const setGrab = (on) => vp.classList.toggle('dc-grab', !!on);
    const onKey = (e) => setGrab(e.ctrlKey || e.metaKey);
    const onBlur = () => setGrab(false);
    const onCtx = (e) => { if (e.ctrlKey && e.target.closest('[data-dc-slot]')) e.preventDefault(); };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', onBlur);
    vp.addEventListener('pointermove', onKey); vp.addEventListener('contextmenu', onCtx);
    return () => {
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onBlur);
      vp.removeEventListener('pointermove', onKey); vp.removeEventListener('contextmenu', onCtx);
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
      <div ref={worldRef} data-dc-world="" style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', willChange: 'transform', width: 'max-content', minWidth: '100%', minHeight: '100%', padding: '72px 0 80px' }}>
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

// The page actions, called from the window header.
function dcActions(patchSection, sid, srcKey) {
  return {
    size: (k, file) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'variant', k, file)),
    move: (k, p) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'positions', k, p)),
    rename: (k, v) => patchSection && patchSection(sid, (x) => dcMapPatch(x, 'labels', k, v)),
    reorder: (next) => patchSection && patchSection(sid, { order: next }),
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
  };
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
  // dcSize reads these props only, together with the variant the section chose.
  // One mark for each slot thus says when to build its size again. `byId` is a
  // fresh object in each render and cannot be a dependency; the marks can.
  const sizeMark = (k) => {
    const q = byId[k].props;
    return JSON.stringify([q.width, q.height, q.href, q.variants, (sec.variant || {})[k]]);
  };
  const marks = order.map((k) => k + '\x00' + sizeMark(k)).join('\x1f');
  // One size object for each slot. A slot keeps the same object until its own
  // mark changes. Without the cache, a variant switch on one slot would give a
  // new size object to every slot. Each frame would then fail its shallow
  // compare and render again, which is what the memo has to stop.
  const sizeCache = React.useRef(new Map());
  const sizes = React.useMemo(() => {
    const cache = sizeCache.current, out = {};
    order.forEach((k) => {
      const mark = sizeMark(k), hit = cache.get(k);
      out[k] = hit && hit.mark === mark ? hit.size : dcSize(byId[k].props, (sec.variant || {})[k]);
      cache.set(k, { mark, size: out[k] });
    });
    // A removed slot must not hold its size in the cache for the life of the page.
    for (const k of [...cache.keys()]) if (!(k in out)) cache.delete(k);
    return out;
  }, [marks]);
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
      const s = sizes[k];
      if (!s) return;
      // The window grows around the screen: left and up by the chrome, right
      // and down by the padding. The screen itself keeps the authored spot.
      span({ x: p.x - DC.winPad, y: p.y - DC.winHead - DC.winPad },
        (s.width || 0) + DC.winPad * 2, (s.height || 0) + DC.winHead + DC.winPad * 2);
    });
    rest.forEach((n) => {
      const p = noteAt(n);
      span(p, p.w || (n.props && n.props.width) || 320, DC.noteReserveH);
    });
    return { origin: { x: x0, y: y0 }, w: w - x0 + 60, h: h - y0 };
  }, [placed, notePositions, order.join('|'), rest.length, sizes]);

  // One stable object of actions. Each action takes the slot id. Without it,
  // each slot would get eight new closures in each render, and the memo on the
  // frame could never hit.
  const patchSection = ctx && ctx.patchSection;
  const actions = React.useMemo(
    () => dcActions(patchSection, sid, srcKey),
    [patchSection, sid, srcKey]);

  return (
    <div data-dc-section={sid} style={{ marginBottom: freeBox ? '540px' : '80px', position: 'relative' }}>
      <div style={{ padding: '0 60px' }}>
        <div className="dc-sectionhead" style={{ paddingBottom: 36 }}>
          <DCEditable tag="div" value={sec.title ?? title}
            onChange={(v) => ctx && sid && ctx.patchSection(sid, { title: v })}
            style={{ fontSize: 28, fontWeight: 600, color: DC.title, letterSpacing: -0.4, marginBottom: 6, display: 'inline-block' }} />
          {subtitle && <div style={{ fontSize: 16, color: DC.subtitle }}>{subtitle}</div>}
        </div>
      </div>
      {!freeBox && rest.length > 0 && <div className="dc-notes" style={{ padding: '0 60px 40px', display: 'flex', gap: 24, alignItems: 'flex-start', width: 'max-content' }}>{rest}</div>}
      <div data-dc-row="" style={freeBox
        ? { position: 'relative', marginLeft: 60 + freeBox.origin.x, marginRight: 60, marginTop: freeBox.origin.y, width: freeBox.w, height: freeBox.h }
        : { display: 'flex', gap, padding: '0 60px', alignItems: 'flex-start', width: 'max-content' }}>
        {freeBox && rest.map((n, i) => (
          <div key={(n && n.props && n.props.id) || i} data-dc-note={(n && n.props && n.props.id) || i} style={{ position: 'absolute', left: noteAt(n).x - freeBox.origin.x, top: noteAt(n).y - freeBox.origin.y }}>{n}</div>
        ))}
        {order.map((k) => (
          // byId[k] is a new element in each render, because
          // React.Children.toArray makes a clone to add its key. The identity
          // of the element thus changes, but its props do not. The element
          // would fail the memo for each slot. Send the props object, which
          // does not change.
          <DCArtboardFrame key={k} sectionId={sid} artboardProps={byId[k].props} order={order}
            size={sizes[k]} actions={actions}
            // freeBox.origin is a new object after each position patch. As an
            // object prop it would fail the shallow compare for each slot, and
            // thus the memo. Two numbers do not change in the same way.
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
//   live  — a real iframe. It mounts while the slot is one of the
//           DC.liveBudget slots nearest to the viewport centre, and is inside
//           `margin` px of it. It drops when the slot leaves the budget, or
//           goes more than DC.unmountMargin px away.
//   placeholder — the striped card. Each slot that is not live shows it.
// `eager` makes the iframe live at all times, outside the budget. No slot in
// the canvas uses it; a host that embeds one screen on its own can. The
// registry does one pass for all slots together, DC.settleMs after the last
// zoom or pan tick. A pinch thus does not mount and drop iframes many times.
function DCLazyFrame({ src, title, width, height, eager = false, margin = 600, href }) {
  const ref = React.useRef(null);
  const [live, setLive] = React.useState(eager);
  React.useEffect(() => {
    if (eager || !ref.current) return;
    // Measure the slot, not the inner div: the slot has content-visibility:auto,
    // so reading a descendant's rect would force layout of a skipped subtree.
    const box = ref.current.closest('[data-dc-slot]') || ref.current;
    // The subscribe invalidates, and the invalidation schedules the pass.
    return dcLodSubscribe({ box, vp: box.closest('.design-canvas'), margin, live: false, set: setLive });
  }, [eager, margin]);
  const on = eager || live;
  // Shield: iframes swallow wheel/pinch, so a transparent layer sits over the
  // screen and lets the canvas zoom/pan. A click opens the screen's own file
  // (where it can be edited); the ↗ button in the header opens it in a new tab.
  return (
    <div ref={ref} data-dc-live={on ? '1' : '0'} style={{ width, height, position: 'relative' }}>
      {on ? <iframe src={src} title={title} loading="lazy" style={{ width, height }} />
        : <div className="dc-placeholder">{title}</div>}
      {!eager && <div className="dc-shield" title="Open to edit" onClick={() => { if (href) location.href = href; }} />}
    </div>
  );
}

// One pointer drag on a slot. Reports pointer deltas in world px (screen px ÷
// zoom) and cleans up on release, cancel, lost capture or a window blur, so a
// pointer released outside the window cannot hold dcDragDepth for ever.
// `keepMoving` keeps the moving flag armed for DC.movingMs after the drop, so
// the drop animation runs with iframes still inert.
// Returns a cancel function for unmounts.
function dcDragSession(e, me, { move, up, keepMoving }) {
  e.preventDefault(); e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  // One rect and one offsetWidth per event: both are reads, so they share one
  // forced layout.
  const measure = () => { const r = me.getBoundingClientRect(); return { r, z: r.width / me.offsetWidth || 1 }; };
  const scale = measure().z;
  me.classList.add('dc-dragging');
  try { me.setPointerCapture(e.pointerId); } catch {}
  dcDragDepth++; dcSyncMoving();
  const onMove = (ev) => {
    const { r, z } = measure();
    move((ev.clientX - sx) / scale, (ev.clientY - sy) / scale, scale, { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z });
  };
  let done = false;
  const finish = (cancelled) => {
    if (done) return; done = true;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    me.removeEventListener('lostpointercapture', onCancel);
    window.removeEventListener('blur', onCancel);
    try { me.releasePointerCapture(e.pointerId); } catch {}
    me.classList.remove('dc-dragging');
    dcDragDepth = Math.max(0, dcDragDepth - 1);
    if (keepMoving) dcMarkMoving(); else dcSyncMoving();
    // A drag moves a card, so the held world boxes are wrong. Drop them.
    dcLodInvalidate();
    up(scale, cancelled);
  };
  const onUp = () => finish(false), onCancel = () => finish(true);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  me.addEventListener('lostpointercapture', onCancel);
  window.addEventListener('blur', onCancel);
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

// Export file name: the label, or the id, with path and shell separators
// replaced. \p{L}\p{N} keeps Arabic and every other script.
const dcExportName = (label, id) => String(label || id || 'artboard').replace(/[^\p{L}\p{N}\s.-]+/gu, '_');
function DCArtboardFrame({ sectionId, artboardProps, label, order, position, originX = 0, originY = 0, moved, size, actions, arrowsMoved }) {
  // perf/bench.js reads this counter to find how many frames one state patch
  // renders. A render-phase increment is the only way to count renders, so it
  // stays in the body.
  DC.renders++;
  const { id: rawId, label: rawLabel, children: rawChildren, style = {} } = artboardProps;
  const id = rawId ?? rawLabel;
  // With size variants the slot follows the chosen size; `children` may be a
  // function of that size so the host can embed the right file.
  size = size || dcSize(artboardProps);
  const { width, height, href } = size;
  const children = typeof rawChildren === 'function' ? rawChildren(size.cur, size) : rawChildren;
  const ref = React.useRef(null);
  const menuRef = React.useRef(null);
  const cancelDrag = React.useRef(null);
  const dropT = React.useRef(0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!menuOpen) { setConfirming(false); return; }
    const off = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [menuOpen]);

  // Cancel first: a cancelled drag commits nothing and arms no drop timer.
  React.useEffect(() => () => { cancelDrag.current && cancelDrag.current(); clearTimeout(dropT.current); }, []);

  // Free placement: the header moves the window anywhere in the section,
  // including left of and above the origin. The live drag is a transform (React never
  // writes one on the slot), the drop commits a snapped position to the section
  // state and the section box grows to hold it.
  const onMoveDown = (e) => {
    const me = ref.current;
    let dx = 0, dy = 0;
    cancelDrag.current = dcDragSession(e, me, {
      move: (wx, wy) => { dx = wx; dy = wy; me.style.transform = `translate(${dx}px, ${dy}px)`; },
      up: (scale, cancelled) => {
        cancelDrag.current = null;
        me.style.transition = 'none'; me.style.transform = '';
        requestAnimationFrame(() => { me.style.transition = ''; });
        // A lost pointer, a window blur or an unmount cancels the drag. The
        // card goes home and the section state keeps the old position.
        if (cancelled) return;
        if (Math.hypot(dx, dy) < 4) return;
        const snap = (v) => Math.round(v / 10) * 10;
        actions.move(id, { x: snap(position.x + dx), y: snap(position.y + dy) });
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
    cancelDrag.current = dcDragSession(e, me, {
      keepMoving: true,
      move: (wx, wy, scale) => {
        me.style.transform = `translateX(${wx}px)`;
        const cur = homes[startIdx].x + wx * scale;
        let nearest = 0, best = Infinity;
        for (let i = 0; i < slotXs.length; i++) { const d = Math.abs(slotXs[i] - cur); if (d < best) { best = d; nearest = i; } }
        if (liveOrder.indexOf(id) !== nearest) { liveOrder = order.filter((k) => k !== id); liveOrder.splice(nearest, 0, id); layout(scale); }
      },
      up: (scale, cancelled) => {
        cancelDrag.current = null;
        // Put every slot back where the layout wants it, with no animation.
        const home = () => {
          for (const h of homes) { h.el.style.transition = 'none'; h.el.style.transform = ''; }
          requestAnimationFrame(() => requestAnimationFrame(() => { for (const h of homes) h.el.style.transition = ''; }));
        };
        // A lost pointer, a window blur or an unmount cancels the drag. The
        // slots go home at once and the section state keeps the old order.
        if (cancelled) { home(); return; }
        const finalSlot = liveOrder.indexOf(id);
        me.style.transform = `translateX(${(slotXs[finalSlot] - homes[startIdx].x) / scale}px)`;
        // The slots slide for 180 ms, then the new order is committed. The
        // timer is held, so an unmount in that window cannot patch the state.
        dropT.current = setTimeout(() => {
          dropT.current = 0;
          home();
          if (liveOrder.join('|') !== order.join('|')) actions.reorder(liveOrder);
          // The reorder lands here, 180 ms after the drop. That is past the
          // settle that finish()'s own invalidation already spent. Measure
          // again, or the registry keeps ranking the pre-reorder boxes.
          dcLodInvalidate();
        }, 180);
      },
    });
  };

  // Ctrl+left click (⌘ on a Mac) anywhere on the page moves it, as the header
  // does. Capture phase, so the title, the chips and the menu do not stop it.
  const onSlotDownCapture = (e) => { if (e.button === 0 && (e.ctrlKey || e.metaKey)) onGripDown(e); };

  const fileName = dcExportName(label, id);
  const save = (kind) => dcExportArtboard(href, width, height, fileName, kind)
    .catch((err) => console.error('[design-canvas] export failed:', err));
  return (
    <div ref={ref} data-dc-slot={id} onPointerDownCapture={onSlotDownCapture} style={position
      ? { position: 'absolute', left: position.x - originX - DC.winPad, top: position.y - originY - DC.winHead - DC.winPad }
      : { position: 'relative', flexShrink: 0 }}>
      <div className="dc-win" style={{ width: width + DC.winPad * 2 }}>
        {/* The whole header drags the card. The name, the chips and the
            buttons stop the gesture, so a click on them still reads. */}
        <div className="dc-winhead" data-noncommentable="" onPointerDown={onGripDown}
          style={{ height: DC.winHead }} title={position ? 'Drag to move' : 'Drag to reorder'}>
          <span className="dc-dot" title="Green while the screen is live" />
          <div className="dc-wintitle" onPointerDown={(e) => e.stopPropagation()}>
            <DCEditable value={label} onChange={(v) => actions.rename(id, v)} onClick={(e) => e.stopPropagation()} />
          </div>
          <div className="dc-bar" onPointerDown={(e) => e.stopPropagation()}>
            <DCSizeChips size={size} onSize={(file) => actions.size(id, file)} />
            {size.axes.length > 0 && <hr />}
            <div className="dc-btns">
              <div ref={menuRef} style={{ position: 'relative' }}>
                <button className="dc-kebab" title="More" onClick={() => setMenuOpen((o) => !o)}>
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><circle cx="2.5" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/><circle cx="9.5" cy="6" r="1.1"/></svg>
                </button>
                {menuOpen && (
                  <div className="dc-menu" onPointerDown={(e) => e.stopPropagation()}>
                    {href && <button onClick={() => { setMenuOpen(false); window.open(href, '_blank'); }}>Open screen</button>}
                    {moved && <button onClick={() => { setMenuOpen(false); actions.resetPosition(id); }}>Reset position</button>}
                    {arrowsMoved && <button onClick={() => { setMenuOpen(false); actions.resetArrows(id); }}>Reset arrow sides</button>}
                    {href && <button onClick={() => { setMenuOpen(false); save('png'); }}>Download PNG</button>}
                    {href && <button onClick={() => { setMenuOpen(false); save('html'); }}>Download HTML</button>}
                    {href && <hr />}
                    <button className="dc-danger" onClick={() => { if (confirming) { setMenuOpen(false); actions.remove(id); } else setConfirming(true); }}>
                      {confirming ? 'Click again to delete' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
              {href && (
                <button className="dc-openbtn" title={'Open: ' + (label || id)} onClick={() => window.open(href, '_blank')}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 2.5H2.5v11h11v-4"/><path d="M9.5 2.5h4v4M13.5 2.5L8 8"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>
        {/* content-visibility goes on the screen, not the window: its paint
            containment would clip the menu that opens under the header. */}
        <div className="dc-winbody" style={{ padding: DC.winPad, background: DC.winBody }}>
          <div className="dc-card" style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06)', overflow: 'hidden', width, height, background: '#fff', contentVisibility: 'auto', containIntrinsicSize: `${width}px ${height}px`, ...style }}>
            {children || <div className="dc-placeholder">{id}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
// Each prop of the frame keeps its identity through a state change that did
// not touch this slot. The default shallow compare is thus sufficient.
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

function DCPostIt({ children, width = 320, rotate = -1 }) {
  return (
    <div style={{ width, flexShrink: 0, background: DC.postitBg, padding: '14px 16px', fontFamily: DC.font, fontSize: 13, lineHeight: 1.5, color: DC.postitText, whiteSpace: 'pre-wrap', boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)', transform: `rotate(${rotate}deg)` }}>{children}</div>
  );
}

// Renders nothing; lets a host mount this file purely to load the globals.
function DCLib() { return null; }

// A top-level const does not land on window, so the names a host page or a
// tool needs are published here. perf/bench.js reads DC, dcLod and dcLodRun.
// tests/regressions.js reads those, and also dcLodInvalidate, dcMoving,
// dcArtboardSvg, dcSvgUrl and dcExportName.
Object.assign(window, { DesignCanvas, DCSection, DCArtboard, DCPostIt, DCLazyFrame, DCCtx, DCLib, dcDragSession, dcFlowKey, dcMapPatch, dcMoving, DC, dcLod, dcLodRun, dcLodInvalidate, dcArtboardSvg, dcSvgUrl, dcExportName });
