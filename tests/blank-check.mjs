// node tests/blank-check.mjs [--control] — the tall-page blank check (Task
// 11 of the React Flow canvas plan). Ports spike/wc-check.mjs's decisive
// tall-page measurement (see the spike report, "Tall page") to run against
// the new (React Flow) canvas only.
//
// The probe: fit the tall page (50 screens, 12,200 x 16,200 world px) ->
// screenshot (base) -> zoom in with synthetic ctrl+wheel ticks to scale >=
// 3.5 -> screenshot (in) -> zoom out the same number of ticks (a mid
// screenshot at the halfway point) -> wait 1s -> re-fit if the view did not
// land back on base's exact view (else INVALID) -> screenshot (out) -> wait
// 5s more -> screenshot (out5), so a texture that is only waiting for a
// re-raster (transient) is distinguished from lasting damage (permanent).
//
// Pass rule (BLANK if any hold, checked separately at `out` (1s) and `out5`
// (+5s)): a card is missing or partially drawn (per-card edge metric), or
// edgesVsBase < 0.5 (the gutter arrows/labels between cards are lost), or
// diffVsBase > 0.02 (a whole-view pixel diff against base).
//
// Run: `npm run build`, then `node tests/blank-check.mjs` (checks the new
// canvas) or `node tests/blank-check.mjs --control` (forces will-change on
// the React Flow viewport — known to lose the arrows on this gesture — to
// prove the check can see the defect). Needs a HEADFUL Chrome with the GPU
// on (see tests/cdp.mjs). Exits 0 on a pass, 1 on a fail (or when --control
// does not blank), 2 on an unexpected error, 4 when the validity guard trips
// (idle rAF < 50fps or the tab is not visible).
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const blankOutDir = path.join(outDir, 'blank');

// ---- copied from spike/tall-check.mjs (via spike/wc-check.mjs) ----
// C1 pattern (tall-check.mjs's waitView): read the engine's own view back and
// assert it landed — scale within 0.5%, x/y within 1px. Used here as the
// base/out "same view" guard: if the gesture's zoom-out did not return to
// base's exact view, re-fit (deterministic — see fitPage below) before the
// shot; if it still does not match, the row is INVALID rather than silently
// measured against the wrong view.
const READ_VIEW = `(() => { const v = window.dcCanvas.api.rf.getViewport(); return { x: v.x, y: v.y, scale: v.zoom }; })()`;
const viewMatches = (got, want) => !!got && Math.abs(got.scale / want.scale - 1) <= 0.005 && Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1;
async function ensureView(c, v, wantView, label, allowRefit) {
  let got = await c.evaluate(READ_VIEW);
  if (viewMatches(got, wantView)) return { view: got, refit: false, invalid: false };
  if (allowRefit) {
    await fitPage(c, v.url);
    got = await c.evaluate(READ_VIEW);
    if (viewMatches(got, wantView)) return { view: got, refit: true, invalid: false };
  }
  console.error(`INVALID: ${v.key} ${label} view ${JSON.stringify(got)} does not match base view ${JSON.stringify(wantView)}${allowRefit ? ' even after re-fit' : ''}`);
  return { view: got, refit: allowRefit, invalid: true };
}

const IDLE_PROBE = `(() => new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  const tick = () => {
    n++;
    const dt = performance.now() - t0;
    if (dt >= 1000) resolve({ fps: n / (dt / 1000), visibility: document.visibilityState });
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}))()`;
const MIN_IDLE_FPS = 50;
const ALLOW_THROTTLED = process.env.BLANK_ALLOW_THROTTLED === '1';

// The validity guard, run before AND after the gesture, on whatever page is
// currently loaded (the variant's own page).
async function checkIdle(c, label) {
  const idle = await c.evaluate(IDLE_PROBE);
  console.log(`idle rAF [${label}]: fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
  if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
    if (!ALLOW_THROTTLED) {
      console.error(`INVALID: screen not visible or rAF throttled at ${label} (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
      c.stop(4);
    }
    console.error(`WARNING: numbers are not valid at ${label} (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — BLANK_ALLOW_THROTTLED=1 is set, continuing anyway`);
  }
  return idle;
}

const FIT_EXPR = `(() => {
  const b = dcCanvas.api.rf.getNodesBounds(dcCanvas.api.rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = Math.max(0.05, Math.min(4, Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)));
  dcCanvas.api.rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;
async function fitPage(c, url) {
  // Deviation: guards `dcCanvas`/`api` with `&&` (instead of a bare
  // `!!window.dcCanvas.api.rf`) so this check cannot throw while the page's
  // onApi callback has not filled `api` yet (main.jsx starts it at null).
  if (!(await c.evaluate(`location.pathname + location.search === '${url}' && !!window.dcCanvas && !!dcCanvas.api && !!dcCanvas.api.rf`))) {
    await c.open(url);
    await c.until(`${ENGINES.new.count} >= 10 && window.dcCanvas && dcCanvas.api && dcCanvas.api.fitted`);
  }
  await c.evaluate(FIT_EXPR);
  await c.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  await sleep(1500);
}

const TICKS = (sel, zoomExpr, deltaY, maxN, target, cx, cy) => {
  const cond = target === null ? 'false' : `scale ${deltaY < 0 ? '>=' : '<='} ${target}`;
  return `(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const el = document.querySelector('${sel}');
    let last = performance.now(); const times = [];
    let n = 0, scale = ${zoomExpr};
    while (n < ${maxN} && !(${cond})) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaMode: 0, deltaY: ${deltaY}, clientX: ${cx}, clientY: ${cy}, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame();
      const now = performance.now(); times.push(now - last); last = now;
      n++; scale = ${zoomExpr};
    }
    return { n, scale, times };
  })()`;
};

const CAL_DY = 6, TICK = 0.06;   // dy is calibrated below against this reference tick
const ZOOM_EXPR = 'window.dcCanvas.api.rf.getZoom()';

async function calibrateDy(c, url) {
  const zoomExpr = ZOOM_EXPR, cx = VIEW.width / 2, cy = VIEW.height / 2;
  const tryTarget = async (sel) => {
    const z0 = await c.evaluate(zoomExpr);
    await c.evaluate(`(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      document.querySelector('${sel}').dispatchEvent(new WheelEvent('wheel', {
        deltaMode: 0, deltaY: -${CAL_DY}, clientX: ${cx}, clientY: ${cy}, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame(); await frame();
    })()`);
    return (await c.evaluate(zoomExpr)) / z0;
  };
  let target = ENGINES.new.target;
  let ratio = await tryTarget(target);
  if (!(ratio > 1.01)) {
    const primaryTarget = target, primaryRatio = ratio;
    await fitPage(c, url);
    target = '.react-flow__renderer';
    ratio = await tryTarget(target);
    if (!(ratio > 1.01)) throw new Error(`blank-check inout probe: a synthetic ctrl+wheel on ${primaryTarget} (ratio ${primaryRatio}) or ${target} (ratio ${ratio}) did not zoom the new engine`);
  }
  const dy = CAL_DY * TICK / Math.log(ratio);
  await fitPage(c, url);
  return { target, dy };
}

const INOUT_TARGET_SCALE = 3.5, INOUT_MAX_TICKS = 120;
// ---- end copied from spike/tall-check.mjs / spike/wc-check.mjs ----

// Every card's own (unclipped) screen rect, in document order — same order
// for a variant's base/out/out5 shots, so cards are matched by index (cards
// are static DOM nodes; only the viewport moves).
const allRectsOf = (sel) => `[...document.querySelectorAll('${sel}')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })`;
const EL = { new: '.react-flow__node-window' };

// Per-card "edge" metric: samples a ~2-CSS-px band just inside each card's
// rect and reports the fraction of those pixels that are NOT background
// colour #f0eee9 — a drawn card has a visible frame (box-shadow / border) so
// `edge` is high; a card the compositor dropped is indistinguishable from
// bare background there, so `edge` is ~0. `n` is the number of band pixels
// actually sampled; a card whose rect clips to nothing on screen (n===0)
// cannot be judged and must be SKIPPED, not scored missing — done in
// cardMetrics() below, not here.
const EDGE = (b64, rects) => `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
  const k = img.width / innerWidth;
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const rects = ${JSON.stringify(rects)};
  const band = Math.max(1, Math.round(2 * k)); // a 2-CSS-px band, in device px
  const bg0 = 240, bg1 = 238, bg2 = 233;
  const scan = (data, n0, hit0) => { let n = n0, hit = hit0;
    for (let i = 0; i < data.length; i += 4) { n++; if (Math.abs(data[i] - bg0) > 10 || Math.abs(data[i + 1] - bg1) > 10 || Math.abs(data[i + 2] - bg2) > 10) hit++; }
    return [n, hit]; };
  return rects.map((r) => {
    const x0 = Math.round(r.l * k), y0 = Math.round(r.t * k), x1 = Math.round((r.l + r.w) * k), y1 = Math.round((r.t + r.h) * k);
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(img.width, x1), cy1 = Math.min(img.height, y1);
    const w = cx1 - cx0, h = cy1 - cy0;
    if (w < 2 || h < 2) return { edge: 0, n: 0 };
    const topH = Math.min(band, h), botH = Math.min(band, h - topH);
    const bandW = Math.min(band, w);
    let n = 0, hit = 0;
    if (topH > 0) [n, hit] = scan(g.getImageData(cx0, cy0, w, topH).data, n, hit);
    if (botH > 0) [n, hit] = scan(g.getImageData(cx0, cy1 - botH, w, botH).data, n, hit);
    const midH = Math.max(0, h - topH - botH);
    if (bandW > 0 && midH > 0) {
      [n, hit] = scan(g.getImageData(cx0, cy0 + topH, bandW, midH).data, n, hit);
      if (w - bandW >= bandW) [n, hit] = scan(g.getImageData(cx1 - bandW, cy0 + topH, bandW, midH).data, n, hit);
    }
    return { edge: n > 0 ? +(hit / n).toFixed(4) : 0, n };
  });
})()`;

// edgesVsBase: counts non-background pixels in the "gutters" between
// horizontally-adjacent cards in the same row — tests/fixtures/tall.js only
// ever creates a flow edge between same-row neighbours (`if (c > 0)
// flows.push({ from: artboards[i - 1]... })`), so every arrow + label the
// tall page draws crosses exactly this region. Same background-vs-not test
// EDGE above already uses (>10 per channel from #f0eee9).
const GUTTERS = (b64, gutters) => `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
  const k = img.width / innerWidth;
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const gutters = ${JSON.stringify(gutters)};
  const bg0 = 240, bg1 = 238, bg2 = 233, half = 4;
  return gutters.map((gu) => {
    const x0 = Math.max(0, Math.round(gu.x0 * k)), x1 = Math.min(img.width, Math.round(gu.x1 * k));
    const yc = Math.round(gu.ymid * k);
    const y0 = Math.max(0, yc - Math.round(half * k)), y1 = Math.min(img.height, yc + Math.round(half * k));
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return { n: 0, hit: 0 };
    const data = g.getImageData(x0, y0, w, h).data;
    let n = 0, hit = 0;
    for (let i = 0; i < data.length; i += 4) { n++; if (Math.abs(data[i] - bg0) > 10 || Math.abs(data[i + 1] - bg1) > 10 || Math.abs(data[i + 2] - bg2) > 10) hit++; }
    return { n, hit };
  });
})()`;

// diffVsBase: a whole-VIEW pixel diff against the base screenshot, computed
// in the page from the two PNGs, so a card the per-card EDGE metric calls
// "ok" (its own border band unchanged) but whose body silently went blank,
// or damage anywhere off a card border / gutter band, still shows up.
// Sampled every 4th screenshot pixel in x and y, > 24 in any channel.
const DIFF_VS_BASE = (baseB64, outB64) => `(async () => {
  const load = (src) => { const im = new Image(); im.src = src; return im.decode().then(() => im); };
  const [a, b] = await Promise.all([load('data:image/png;base64,${baseB64}'), load('data:image/png;base64,${outB64}')]);
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const ca = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cb = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ga = ca.getContext('2d', { willReadFrequently: true }); ga.drawImage(a, 0, 0);
  const gb = cb.getContext('2d', { willReadFrequently: true }); gb.drawImage(b, 0, 0);
  const da = ga.getImageData(0, 0, w, h).data, db = gb.getImageData(0, 0, w, h).data;
  let n = 0, hit = 0;
  for (let y = 0; y < h; y += 4) {
    const row = y * w;
    for (let x = 0; x < w; x += 4) {
      const i = (row + x) * 4;
      n++;
      if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) hit++;
    }
  }
  return n > 0 ? +(hit / n).toFixed(4) : -1;
})()`;

// Group base cardRects into rows (by rounded top, tolerant of float jitter),
// sort each row left-to-right, and return adjacent [leftIdx, rightIdx] pairs
// — exactly the pairs tests/fixtures/tall.js links with a flow edge.
function gutterPairsOf(cardRects) {
  const rows = new Map();
  cardRects.forEach((r, i) => {
    const key = Math.round(r.t / 8) * 8;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(i);
  });
  const pairs = [];
  for (const idxs of rows.values()) {
    idxs.sort((a, b) => cardRects[a].l - cardRects[b].l);
    for (let k = 0; k < idxs.length - 1; k++) pairs.push([idxs[k], idxs[k + 1]]);
  }
  return pairs;
}
function gutterRectsOf(cardRects, pairs) {
  return pairs
    .map(([i, j]) => { const a = cardRects[i], b = cardRects[j]; return { x0: a.l + a.w, x1: b.l, ymid: a.t + a.h / 2 }; })
    .filter((r) => r.x1 - r.x0 >= 2);
}

async function edgesVsBaseOf(c, baseB64, outB64, gutterRects) {
  if (!gutterRects.length) return -1;
  const baseVals = await c.evaluate(GUTTERS(baseB64, gutterRects));
  const outVals = await c.evaluate(GUTTERS(outB64, gutterRects));
  const sum = (arr, key) => arr.reduce((a, x) => a + x[key], 0);
  const baseN = sum(baseVals, 'n'), baseHit = sum(baseVals, 'hit');
  const outN = sum(outVals, 'n'), outHit = sum(outVals, 'hit');
  const baseFrac = baseN > 0 ? baseHit / baseN : 0;
  const outFrac = outN > 0 ? outHit / outN : 0;
  if (baseFrac > 0) return +(outFrac / baseFrac).toFixed(3);
  return outFrac > 0 ? -1 : 1; // base had nothing to lose; -1 flags "unexpected pixels appeared"
}

// Frame-time stats: p50/p95/max from the sorted times, dropped = frames >
// 1.5x p50.
function statsOf(times) {
  const s = times.slice().sort((a, b) => a - b);
  if (!s.length) return { p50: 0, p95: 0, max: 0, dropped: 0, count: 0 };
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  const p50 = q(0.5);
  return { p50, p95: q(0.95), max: +s[s.length - 1].toFixed(2), dropped: s.filter((t) => t > 1.5 * p50).length, count: s.length };
}

// Per-card missing/partial classification, skipping any card whose band
// could not be sampled (n===0) in EITHER the base or the post-gesture shot,
// instead of scoring it "missing".
function cardMetrics(base, shot) {
  const n = Math.min(base.cardRects.length, shot.cardRects.length);
  if (base.cardRects.length !== shot.cardRects.length) {
    console.error(`WARNING: card count changed base=${base.cardRects.length} shot=${shot.cardRects.length}, comparing first ${n}`);
  }
  const inViewport = (r) => r.l < VIEW.width && r.l + r.w > 0 && r.t < VIEW.height && r.t + r.h > 0;
  let cards = 0, missing = 0, partial = 0, skipped = 0;
  const perCard = [];
  for (let i = 0; i < n; i++) {
    const br = base.cardRects[i];
    if (!(br.w >= 8 && br.h >= 8 && inViewport(br))) continue;
    const beObj = base.edges[i], oeObj = shot.edges[i];
    if (beObj.n === 0 || oeObj.n === 0) { skipped++; continue; }
    cards++;
    const be = beObj.edge, oe = oeObj.edge;
    const ratio = be > 0 ? oe / be : (oe > 0 ? 1 : 0);
    let cls = 'ok';
    if (ratio < 0.3) { missing++; cls = 'missing'; } else if (ratio < 0.8) { partial++; cls = 'partial'; }
    if (cls !== 'ok') perCard.push({ i, baseEdge: be, outEdge: oe, ratio: +ratio.toFixed(3), cls });
  }
  return { cards, missing, partial, skipped, perCard };
}

// Verdict: BLANK if missing+partial>0, or edgesVsBase<0.5, or diffVsBase>0.02
// — for whichever shot (out / out5) is passed in.
async function metricsFor(c, base, shot, gutterRects) {
  const cm = cardMetrics(base, shot);
  const edgesVsBase = await edgesVsBaseOf(c, base.b64, shot.b64, gutterRects);
  const diffVsBase = await diffVsBaseOf(c, base.b64, shot.b64);
  const blank = (cm.missing + cm.partial > 0) || (edgesVsBase >= 0 && edgesVsBase < 0.5) || (diffVsBase >= 0 && diffVsBase > 0.02);
  return { ...cm, edgesVsBase, diffVsBase, verdict: blank ? 'BLANK' : 'OK' };
}
async function diffVsBaseOf(c, baseB64, outB64) { return c.evaluate(DIFF_VS_BASE(baseB64, outB64)); }

// The in-out probe: fit -> baseline screenshot (+ per-card rects for the
// edge metric, + the view for the base/out equality guard) -> zoom in with
// calibrated ticks to scale >= 3.5 -> screenshot -> zoom out the SAME number
// of ticks (split around a mid screenshot) -> wait 1s -> assert the view
// matches base (re-fit once if not, else INVALID) -> out screenshot -> wait
// 5s more -> out5 screenshot (permanence).
async function inoutProbe(c, v) {
  await fitPage(c, v.url);
  const { target, dy } = await calibrateDy(c, v.url);

  await checkIdle(c, `${v.key} before`);

  const cx = VIEW.width / 2, cy = VIEW.height / 2;
  const shot = async (tag, withCards) => {
    const cardRects = withCards ? await c.evaluate(allRectsOf(EL.new)) : null;
    const b64 = await c.screenshot(path.join('blank', `blank-${v.key}-${tag}.png`));
    const edges = withCards ? await c.evaluate(EDGE(b64, cardRects)) : null;
    return { cardRects, edges, b64 };
  };

  const baseView = await c.evaluate(READ_VIEW);
  const base = await shot('base', true);

  const zin = await c.evaluate(TICKS(target, ZOOM_EXPR, -dy, INOUT_MAX_TICKS, INOUT_TARGET_SCALE, cx, cy));
  await shot('in', false);

  const nOut = zin.n, half1 = Math.floor(nOut / 2), half2 = nOut - half1;
  const batch1 = await c.evaluate(TICKS(target, ZOOM_EXPR, dy, half1, null, cx, cy));
  await shot('mid', false);
  const batch2 = await c.evaluate(TICKS(target, ZOOM_EXPR, dy, half2, null, cx, cy));

  await sleep(1000);
  const outCheck = await ensureView(c, v, baseView, 'out', true);
  const out = await shot('out', true);

  await sleep(5000);
  const out5Check = await ensureView(c, v, baseView, 'out5', false);
  const out5 = await shot('out5', true);

  await checkIdle(c, `${v.key} after`);

  const inStats = statsOf(zin.times.slice(2));
  const outStats = statsOf([...batch1.times.slice(2), ...batch2.times.slice(2)]);

  const gutterRects = gutterRectsOf(base.cardRects, gutterPairsOf(base.cardRects));
  const baseEdgeVals = base.edges.filter((e) => e.n > 0).map((e) => e.edge);
  const baseEdgeMean = baseEdgeVals.length ? +(baseEdgeVals.reduce((a, b) => a + b, 0) / baseEdgeVals.length).toFixed(4) : 0;

  const outMetrics = await metricsFor(c, base, out, gutterRects);
  if (outCheck.invalid) outMetrics.verdict = 'INVALID';
  const out5Metrics = await metricsFor(c, base, out5, gutterRects);
  if (out5Check.invalid) out5Metrics.verdict = 'INVALID';

  const result = {
    variant: v.key, engine: v.engine, url: v.url, target, dy: +dy.toFixed(4),
    baseEdgeMean,
    zoomIn: inStats,
    zoomOut: outStats,
    out: { scale: +batch2.scale.toFixed(4), view: outCheck.view, refit: outCheck.refit, invalid: outCheck.invalid, ...outMetrics },
    out5: { view: out5Check.view, invalid: out5Check.invalid, ...out5Metrics },
  };
  console.log(`BLANK CHECK ${v.key}: ${outMetrics.verdict} at 1 s, ${out5Metrics.verdict} at 5 s (missing=${outMetrics.missing}, partial=${outMetrics.partial}, edgesVsBase=${outMetrics.edgesVsBase}, diffVsBase=${outMetrics.diffVsBase})`);
  return result;
}

const control = process.argv.includes('--control');
const VARIANTS = control
  ? { key: 'control', engine: 'new', url: '/tests/blank.html?control=1' }
  : { key: 'canvas', engine: 'new', url: '/tests/blank.html' };

mkdirSync(blankOutDir, { recursive: true });

const c = await launch();
try {
  const result = await inoutProbe(c, VARIANTS);
  writeFileSync(path.join(blankOutDir, `blank-${VARIANTS.key}.json`), JSON.stringify(result, null, 2));

  if (!control) {
    const bothOk = result.out.verdict === 'OK' && result.out5.verdict === 'OK';
    c.stop(bothOk ? 0 : 1);
  } else {
    const anyBlank = result.out.verdict === 'BLANK' || result.out5.verdict === 'BLANK';
    if (anyBlank) { c.stop(0); }
    else { console.error('the check cannot see the blank on this machine'); c.stop(1); }
  }
} catch (e) { console.error(e); c.stop(2); }
