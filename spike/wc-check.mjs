// node spike/wc-check.mjs <1|2|3> — Task 3d: the decisive tall-page measurement.
//
// Task 3c asked "does wc=1 bring the old engine's GPU-layer blank back to
// React Flow?" and found: no severe blank, but a small reproducible edge
// softening on 2-3 cards. A reviewer found the conclusion "speed and blank
// always trade off" is NOT proven — an earlier small-page ablation showed
// React Flow WITHOUT will-change and with NO live iframes is faster than the
// old engine, and the blank metric itself had two defects. This script:
//   (a) adds three variants that isolate the two suspects the ablation
//       named — no live iframes at all (`no-iframes`), will-change moved
//       from the world viewport onto each live iframe individually
//       (`live-wc`), and iframes hidden (not unmounted) for the duration of
//       a gesture only (`freeze`, spike/src/main.jsx's new flags) — next to
//       the `old` control, `plain`, and `wc` from Task 3c (drops `wc-contain`,
//       which added nothing over `wc` alone in Task 3c's numbers);
//   (b) fixes the blank metric: a card whose sampled edge-band could not be
//       read (n===0) is skipped, not scored missing; adds a whole-view
//       diffVsBase pixel metric so a lost SVG edge/arrow (nowhere near a
//       card's own border band) cannot hide; adds an edgesVsBase metric
//       sampled in the gutters between cards, replacing the fragile
//       "count arrow-coloured pixels" approach; takes a second post-gesture
//       screenshot 5s after the first (out5) so a texture that is only
//       waiting for a re-raster (transient) is distinguished from lasting
//       damage (permanent).
//
// This is still a NEW script, not an edit to spike/tall-check.mjs, spike/
// frames.mjs or spike/ablate.mjs (none have exports; everything runs at
// module load, so importing is not an option) — the pieces below marked
// "copied from tall-check.mjs" are verbatim or near-verbatim copies, same
// approach ablate.mjs itself uses for the bits it needs from frames.mjs.
//
// Run three times, one Chrome launch per run (see the task brief's machine-
// condition rule): `node spike/wc-check.mjs 1`, then `2`, then `3`. Each run
// writes spike/out/wc-check-f<N>.json and spike/out/wc4-<variant>-f<N>-
// {base,in,mid,out,out5}.png, and prints that run's tables. Once all three
// f1/f2/f3 files exist on disk, the run also prints the median-of-3 summary
// table (whichever invocation happens to complete the set — normally the
// third — prints it; the other two see files missing and skip it).
//
// Task 3f (reviewer gap 2) adds a second control, `old-fixed`: the old
// engine plus the world-GPU-layer-budget fix from main's 08b443c/e5b6fa4
// (design-canvas.fixed.jsx, loaded via sample/index-fixed.html and
// sample/old-tall-fixed.html; the original design-canvas.jsx/canvas-page.jsx
// are untouched). Its speed ratios are computed against `old`, same as every
// other row. The world's computed will-change (getComputedStyle([data-dc-
// world]).willChange) is recorded at base/in(peak)/out for both `old` rows.
// The file-name tag moves from r<N>/wc3- to f<N>/wc4- so this run's evidence
// cannot silently overwrite Task 3d's r1-r3 files already on disk (spike/out
// is git-ignored and nothing in it is deleted).
//
// Task 3f part B also adds, for the `freeze` variant only: the zoom-in is
// split at its geometric-mean midpoint scale so a screenshot can be taken at
// the MID tick of the zoom-in gesture (wc4-freeze-f<N>-gesture.png, gap 1's
// bug showed here first), plus a blank-white count over the live cards in
// that shot (gestureBlank in the JSON).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const EL = { old: '[data-dc-slot]', new: '.react-flow__node-window' };

// ---- copied from spike/tall-check.mjs ----
// C1 pattern (tall-check.mjs's waitView): read the engine's own view back and
// assert it landed — scale within 0.5%, x/y within 1px. Reused here (Task
// 3d) as the base/out "same view" guard the brief asks for: if the gesture's
// zoom-out did not return to base's exact view, re-fit (deterministic — see
// fitOld/fitNew below) before the shot; if it still does not match, the row
// is INVALID rather than silently measured against the wrong view.
const READ_VIEW = (name) => (name === 'old' ? 'window.dcView' : `(() => { const v = window.rf.getViewport(); return { x: v.x, y: v.y, scale: v.zoom }; })()`);
const viewMatches = (got, want) => !!got && Math.abs(got.scale / want.scale - 1) <= 0.005 && Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1;
async function ensureView(c, name, v, wantView, label, allowRefit) {
  const read = READ_VIEW(name);
  let got = await c.evaluate(read);
  if (viewMatches(got, wantView)) return { view: got, refit: false, invalid: false };
  if (allowRefit) {
    if (name === 'old') await fitOld(c, v.url); else await fitNew(c, v.url);
    got = await c.evaluate(read);
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
const ALLOW_THROTTLED = process.env.SPIKE_ALLOW_THROTTLED === '1';

// New for Task 3d: the validity guard, now run before AND after each
// variant (previously once for the whole script), on whatever page is
// currently loaded (the variant's own page).
async function checkIdle(c, label) {
  const idle = await c.evaluate(IDLE_PROBE);
  console.log(`idle rAF [${label}]: fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
  if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
    if (!ALLOW_THROTTLED) {
      console.error(`INVALID: screen not visible or rAF throttled at ${label} (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
      c.stop(4);
    }
    console.error(`WARNING: numbers are not valid at ${label} (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — SPIKE_ALLOW_THROTTLED=1 is set, continuing anyway`);
  }
  return idle;
}

// Task 3f: parameterised on `url`, same reason as fitNew below — this
// script now has a second old-engine URL (ENGINES['old-fixed'].tall).
async function fitOld(c, url = ENGINES.old.tall) {
  await c.open(url, "try { localStorage.clear(); } catch {}");
  await c.until(`${ENGINES.old.count} >= 10`, 60000);
  await sleep(500);
  if (!(await c.evaluate('!!window.dcBench'))) await c.evaluate(`fetch('/perf/bench.js').then((r) => r.text()).then((t) => { (0, eval)(t); })`);
  await c.evaluate('dcBench.fit().then(() => 1)');
  await sleep(1500);
}

const NEW_FIT_EXPR = `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = Math.max(0.05, Math.min(4, Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)));
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;
// Deviation from tall-check.mjs's fitNew: parameterised on `url` (this
// script has several new-engine URL variants that tall-check.mjs never
// needed, since it only ever visits ENGINES.new.tall).
async function fitNew(c, url) {
  if (!(await c.evaluate(`location.pathname + location.search === '${url}' && !!window.rf`))) {
    await c.open(url);
    await c.until(`${ENGINES.new.count} >= 10 && window.rf`);
  }
  await c.evaluate(NEW_FIT_EXPR);
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

const OLD_DY = 6, TICK = 0.06;
const ZOOM_EXPR = { old: 'window.dcView.scale', new: 'window.rf.getZoom()' };

// Deviation from tall-check.mjs's calibrateNewDy: parameterised on `url`
// (passed through to fitNew) for the same reason as fitNew above.
async function calibrateNewDy(c, url) {
  const zoomExpr = ZOOM_EXPR.new, cx = VIEW.width / 2, cy = VIEW.height / 2;
  const tryTarget = async (sel) => {
    const z0 = await c.evaluate(zoomExpr);
    await c.evaluate(`(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      document.querySelector('${sel}').dispatchEvent(new WheelEvent('wheel', {
        deltaMode: 0, deltaY: -${OLD_DY}, clientX: ${cx}, clientY: ${cy}, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame(); await frame();
    })()`);
    return (await c.evaluate(zoomExpr)) / z0;
  };
  let target = ENGINES.new.target;
  let ratio = await tryTarget(target);
  if (!(ratio > 1.01)) {
    const primaryTarget = target, primaryRatio = ratio;
    await fitNew(c, url);
    target = '.react-flow__renderer';
    ratio = await tryTarget(target);
    if (!(ratio > 1.01)) throw new Error(`wc-check inout probe: a synthetic ctrl+wheel on ${primaryTarget} (ratio ${primaryRatio}) or ${target} (ratio ${ratio}) did not zoom the new engine`);
  }
  const dy = OLD_DY * TICK / Math.log(ratio);
  await fitNew(c, url);
  return { target, dy };
}

const INOUT_TARGET_SCALE = 3.5, INOUT_MAX_TICKS = 120;
// ---- end copied from spike/tall-check.mjs ----

// Every card's own (unclipped) screen rect, in document order — same order
// for a variant's base/out/out5 shots, so cards are matched by index (cards
// are static DOM nodes; only the viewport moves). Both engines build from
// the same spikeTall() artboards array in the same r*5+c order (verified in
// Task 3c's report: the old engine's bottom-row loss landed on indices
// 45-49, i.e. row 9).
const allRectsOf = (sel) => `[...document.querySelectorAll('${sel}')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })`;

// Task 3f part B: each React Flow window card's rect plus whether it is
// "live" (its dot has the `on` class — spike/src/main.jsx's WindowNode).
// Read live from the DOM at the same moment as the mid-gesture screenshot
// (new-engine specific; only used for the `freeze` variant).
const LIVE_CARD_RECTS = `[...document.querySelectorAll('.react-flow__node-window')].map((el) => {
  const r = el.getBoundingClientRect();
  const win = el.querySelector('.sp-win');
  const live = !!win && !!win.querySelector('.sp-dot.on');
  return { l: r.left, t: r.top, w: r.width, h: r.height, live };
})`;
const HEAD_PX = 44; // spike/src/main.jsx's HEAD — the card header height, excluded from the body sample below.

// Task 3f part B: "blank white" — a live card's BODY (below its header) is
// (near-)entirely pure white with nothing drawn on it: gap 1's bug (the
// freeze placeholder laid out below the hidden iframe and clipped by
// .sp-win's overflow:hidden) looked exactly like this — neither the hidden
// iframe nor the placeholder painted anything into the visible body rect, so
// what showed through was plain white. After the fix, a live card's body
// during the gesture shows the placeholder's title text/pattern instead, so
// it is no longer (near-)uniformly white. >99.5% near-white pixels (all
// channels > 250) counts as blank; only live cards are checked (a non-live
// card's placeholder was never affected by the bug).
const BLANK_WHITE = (b64, cards) => `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
  const k = img.width / innerWidth;
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const cards = ${JSON.stringify(cards)};
  const results = cards.filter((c) => c.live).map((c) => {
    const x0 = Math.max(0, Math.round(c.l * k)), y0 = Math.max(0, Math.round((c.t + ${HEAD_PX}) * k));
    const x1 = Math.min(img.width, Math.round((c.l + c.w) * k)), y1 = Math.min(img.height, Math.round((c.t + c.h) * k));
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return { n: 0, whiteFrac: 0, blank: false };
    const data = g.getImageData(x0, y0, w, h).data;
    let n = 0, white = 0;
    for (let i = 0; i < data.length; i += 4) { n++; if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) white++; }
    const whiteFrac = n > 0 ? +(white / n).toFixed(4) : 0;
    return { n, whiteFrac, blank: whiteFrac > 0.995 };
  });
  return { liveCount: results.length, blankCount: results.filter((r) => r.blank).length, perCard: results };
})()`;

// Per-card "edge" metric (unchanged approach from Task 3c): samples a
// ~2-CSS-px band just inside each card's rect and reports the fraction of
// those pixels that are NOT background colour #f0eee9 — a drawn card has a
// visible frame (box-shadow / border) so `edge` is high; a card the
// compositor dropped is indistinguishable from bare background there, so
// `edge` is ~0. `n` is the number of band pixels actually sampled; Task 3d
// fix #1 (reviewer finding): a card whose rect clips to nothing on screen
// (n===0) cannot be judged and must be SKIPPED, not scored missing — done in
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

// New for Task 3d (reviewer fix #2): edgesVsBase. Counts non-background
// pixels in the "gutters" between horizontally-adjacent cards in the same
// row — spike/tall.js only ever creates a flow edge between same-row
// neighbours (`if (c > 0) flows.push({ from: artboards[i - 1]... })`), so
// every arrow + label the tall page draws crosses exactly this region. This
// replaces "count dark/brown arrow-coloured pixels" (fragile: ties the
// metric to one engine's arrow colour/theme) with the same background-vs-not
// test EDGE above already uses (>10 per channel from #f0eee9). Applies
// identically to the old engine and every React Flow variant.
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

// New for Task 3d (reviewer fix #3): diffVsBase. A whole-VIEW pixel diff
// against the base screenshot, computed in the page from the two PNGs, so a
// card the per-card EDGE metric calls "ok" (its own border band unchanged)
// but whose body silently went blank, or damage anywhere off a card border /
// gutter band, still shows up. Sampled every 4th screenshot pixel in x and
// y, > 24 in any channel, exactly as specified.
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
// — exactly the pairs spike/tall.js links with a flow edge.
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

// Frame-time stats, same shape tall-check.mjs/ablate.mjs use: p50/p95/max
// from the sorted times, dropped = frames > 1.5x p50.
function statsOf(times) {
  const s = times.slice().sort((a, b) => a - b);
  if (!s.length) return { p50: 0, p95: 0, max: 0, dropped: 0, count: 0 };
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  const p50 = q(0.5);
  return { p50, p95: q(0.95), max: +s[s.length - 1].toFixed(2), dropped: s.filter((t) => t > 1.5 * p50).length, count: s.length };
}

// Task 3d fix #1 (reviewer finding): per-card missing/partial classification,
// now skipping any card whose band could not be sampled (n===0) in EITHER
// the base or the post-gesture shot, instead of scoring it "missing".
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

// Verdict per the brief: BLANK if missing+partial>0, or edgesVsBase<0.5, or
// diffVsBase>0.02 — for whichever shot (out / out5) is passed in.
async function metricsFor(c, base, shot, gutterRects) {
  const cm = cardMetrics(base, shot);
  const edgesVsBase = await edgesVsBaseOf(c, base.b64, shot.b64, gutterRects);
  const diffVsBase = await diffVsBaseOf(c, base.b64, shot.b64);
  const blank = (cm.missing + cm.partial > 0) || (edgesVsBase >= 0 && edgesVsBase < 0.5) || (diffVsBase >= 0 && diffVsBase > 0.02);
  return { ...cm, edgesVsBase, diffVsBase, verdict: blank ? 'BLANK' : 'OK' };
}
async function diffVsBaseOf(c, baseB64, outB64) { return c.evaluate(DIFF_VS_BASE(baseB64, outB64)); }

// The in-out probe for one variant: fit -> baseline screenshot (+ per-card
// rects for the edge metric, + the view for the base/out equality guard) ->
// zoom in with calibrated ticks to scale >= 3.5 -> screenshot -> zoom out the
// SAME number of ticks (split around a mid screenshot) -> wait 1s -> assert
// the view matches base (re-fit once if not, else INVALID) -> out screenshot
// -> wait 5s more -> out5 screenshot (permanence). Records zoom-in AND
// zoom-out frame times separately and main-thread busy ms for the
// tick-dispatch work only (screenshot decode+sample calls are diagnostic
// overhead, excluded from the busy delta by bracketing busy() tightly around
// each TICKS call).
// Task 3f (gap 2): the world's own computed will-change, read only for the
// old engine (both `old` and `old-fixed` share engine:'old' and the same
// [data-dc-world] element; the new engine has no such element). On `old`
// this is always 'transform' (unconditional in design-canvas.jsx). On
// `old-fixed` it flips with scale — see design-canvas.fixed.jsx's promote
// check against DC.maxLayerMB — so sampling it at base/in/out shows exactly
// when the fix's GPU-layer budget engages on the tall page.
const WORLD_WC = `(() => { const el = document.querySelector('[data-dc-world]'); return el ? getComputedStyle(el).willChange : null; })()`;
async function worldWC(c, name) { return name === 'old' ? c.evaluate(WORLD_WC) : null; }

async function inoutProbe(c, v, RUN) {
  const name = v.engine;
  const zoomExpr = ZOOM_EXPR[name];
  let target, dy;
  if (name === 'old') { await fitOld(c, v.url); target = ENGINES.old.target; dy = OLD_DY; }
  else { await fitNew(c, v.url); ({ target, dy } = await calibrateNewDy(c, v.url)); }

  await checkIdle(c, `${v.key} before`);

  const cx = VIEW.width / 2, cy = VIEW.height / 2;
  const shot = async (tag, withCards) => {
    const cardRects = withCards ? await c.evaluate(allRectsOf(EL[name])) : null;
    const b64 = await c.screenshot(`wc4-${v.key}-f${RUN}-${tag}.png`);
    const edges = withCards ? await c.evaluate(EDGE(b64, cardRects)) : null;
    return { cardRects, edges, b64 };
  };

  const baseView = await c.evaluate(READ_VIEW(name));
  const base = await shot('base', true);
  const wcBase = await worldWC(c, name);

  // Task 3f part B: for `freeze` only, split the zoom-in into two TICKS
  // calls (same shape zoom-out already uses for its own mid screenshot) so a
  // screenshot can be taken at the MID tick of the zoom-in gesture — this is
  // where gap 1's bug showed a live card as blank white. The split point is
  // the geometric mean of the fit scale and INOUT_TARGET_SCALE: each tick
  // multiplies scale by ~a constant factor, so this lands close to the
  // tick-count midpoint without a throwaway dry run. Every other variant
  // keeps the original single-call zoom-in, unchanged.
  let gestureBlank = null;
  let b0 = await c.busy();
  let zin;
  if (v.key === 'freeze') {
    const midTarget = Math.sqrt(baseView.scale * INOUT_TARGET_SCALE);
    const zinA = await c.evaluate(TICKS(target, zoomExpr, -dy, INOUT_MAX_TICKS, midTarget, cx, cy));
    const cardsAtMid = await c.evaluate(LIVE_CARD_RECTS);
    const gestureB64 = await c.screenshot(`wc4-freeze-f${RUN}-gesture.png`);
    gestureBlank = await c.evaluate(BLANK_WHITE(gestureB64, cardsAtMid));
    const zinB = await c.evaluate(TICKS(target, zoomExpr, -dy, Math.max(0, INOUT_MAX_TICKS - zinA.n), INOUT_TARGET_SCALE, cx, cy));
    zin = { n: zinA.n + zinB.n, timeSegments: [zinA.times, zinB.times] };
  } else {
    zin = await c.evaluate(TICKS(target, zoomExpr, -dy, INOUT_MAX_TICKS, INOUT_TARGET_SCALE, cx, cy));
    zin.timeSegments = [zin.times];
  }
  let b1 = await c.busy();
  const busyIn = b1 - b0;
  await shot('in', false);
  const wcIn = await worldWC(c, name);

  const nOut = zin.n, half1 = Math.floor(nOut / 2), half2 = nOut - half1;
  b0 = await c.busy();
  const batch1 = await c.evaluate(TICKS(target, zoomExpr, dy, half1, null, cx, cy));
  b1 = await c.busy();
  const busyOut1 = b1 - b0;
  await shot('mid', false);
  b0 = await c.busy();
  const batch2 = await c.evaluate(TICKS(target, zoomExpr, dy, half2, null, cx, cy));
  b1 = await c.busy();
  const busyOut2 = b1 - b0;
  const busyOut = busyOut1 + busyOut2;

  await sleep(1000);
  const outCheck = await ensureView(c, name, v, baseView, 'out', true);
  const out = await shot('out', true);
  const wcOut = await worldWC(c, name);

  await sleep(5000);
  const out5Check = await ensureView(c, name, v, baseView, 'out5', false);
  const out5 = await shot('out5', true);

  await checkIdle(c, `${v.key} after`);

  const inStats = statsOf(zin.timeSegments.flatMap((t) => t.slice(2)));
  const outStats = statsOf([...batch1.times.slice(2), ...batch2.times.slice(2)]);

  const gutterRects = gutterRectsOf(base.cardRects, gutterPairsOf(base.cardRects));
  const baseEdgeVals = base.edges.filter((e) => e.n > 0).map((e) => e.edge);
  const baseEdgeMean = baseEdgeVals.length ? +(baseEdgeVals.reduce((a, b) => a + b, 0) / baseEdgeVals.length).toFixed(4) : 0;

  const outMetrics = await metricsFor(c, base, out, gutterRects);
  if (outCheck.invalid) outMetrics.verdict = 'INVALID';
  const out5Metrics = await metricsFor(c, base, out5, gutterRects);
  if (out5Check.invalid) out5Metrics.verdict = 'INVALID';

  const result = {
    variant: v.key, engine: name, url: v.url, target, dy: +dy.toFixed(4),
    baseEdgeMean,
    zoomIn: { ...inStats, busyMs: +busyIn.toFixed(1) },
    zoomOut: { ...outStats, busyMs: +busyOut.toFixed(1) },
    out: { scale: +batch2.scale.toFixed(4), view: outCheck.view, refit: outCheck.refit, invalid: outCheck.invalid, ...outMetrics },
    out5: { view: out5Check.view, invalid: out5Check.invalid, ...out5Metrics },
    ...(name === 'old' ? { worldWillChange: { base: wcBase, in: wcIn, out: wcOut } } : {}),
    ...(gestureBlank ? { gestureBlank } : {}),
  };
  console.log(`wc-check ${v.key} f${RUN}: baseEdgeMean=${baseEdgeMean} out(missing=${outMetrics.missing},partial=${outMetrics.partial},skipped=${outMetrics.skipped},edgesVsBase=${outMetrics.edgesVsBase},diffVsBase=${outMetrics.diffVsBase})=${outMetrics.verdict} out5(missing=${out5Metrics.missing},partial=${out5Metrics.partial},edgesVsBase=${out5Metrics.edgesVsBase},diffVsBase=${out5Metrics.diffVsBase})=${out5Metrics.verdict}`);
  if (result.worldWillChange) console.log(`wc-check ${v.key} f${RUN}: world will-change base=${wcBase} in(peak)=${wcIn} out=${wcOut}`);
  if (gestureBlank) console.log(`wc-check ${v.key} f${RUN}: gesture mid-zoom-in live=${gestureBlank.liveCount} blankWhite=${gestureBlank.blankCount}`);
  return result;
}

const VARIANTS = [
  { key: 'old', engine: 'old', url: ENGINES.old.tall, label: 'old engine (control)' },
  // Task 3f (gap 2): old engine + the world-GPU-layer-budget fix (main's
  // 08b443c/e5b6fa4) — the cheapest competing option, never measured before.
  { key: 'old-fixed', engine: 'old', url: ENGINES['old-fixed'].tall, label: 'old engine + layer budget fix (control)' },
  { key: 'plain', engine: 'new', url: ENGINES.new.tall, label: 'React Flow, no flags' },
  { key: 'wc', engine: 'new', url: ENGINES.new.tall + '&wc=1', label: 'React Flow, wc=1' },
  { key: 'no-iframes', engine: 'new', url: ENGINES.new.tall + '&off=iframes', label: 'React Flow, off=iframes' },
  { key: 'live-wc', engine: 'new', url: ENGINES.new.tall + '&livewc=1', label: 'React Flow, livewc=1' },
  { key: 'freeze', engine: 'new', url: ENGINES.new.tall + '&freeze=1', label: 'React Flow, freeze=1' },
];

function median(nums) {
  const s = nums.filter((n) => typeof n === 'number' && isFinite(n)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(3);
}
function mode(vals) {
  const counts = new Map();
  vals.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  let best = vals[0], bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function printRunTable(run, rows) {
  const col = (s, w) => String(s).padStart(w);
  console.log(`\n${'='.repeat(120)}\nRUN ${run} — speed`);
  console.log('variant'.padEnd(12) + col('p95in', 8) + col('p95out', 8) + col('maxIn', 8) + col('drIn', 6) + col('drOut', 6) + col('busyMs', 9) + col('p95VsOld', 10) + col('maxVsOld', 10) + col('busyVsOld', 11) + '  SPEED');
  rows.forEach((r) => {
    const busyMs = +(r.zoomIn.busyMs + r.zoomOut.busyMs).toFixed(1);
    const sp = r.speed;
    console.log(r.variant.padEnd(12) + col(r.zoomIn.p95, 8) + col(r.zoomOut.p95, 8) + col(r.zoomIn.max, 8) + col(r.zoomIn.dropped, 6) + col(r.zoomOut.dropped, 6) + col(busyMs, 9)
      + col(sp ? sp.p95InVsOld : '-', 10) + col(sp ? sp.maxInVsOld : '-', 10) + col(sp ? sp.busyVsOld : '-', 11) + '  ' + (sp ? sp.verdict : '-'));
  });
  console.log(`\nRUN ${run} — blank`);
  console.log('variant'.padEnd(12) + col('baseEdge', 9) + col('missing', 8) + col('partial', 8) + col('skipped', 8) + col('edgesVB', 8) + col('diffVB', 8) + '  @out'.padEnd(7) + col('edgesVB5', 9) + col('diffVB5', 8) + '  @5s');
  rows.forEach((r) => {
    console.log(r.variant.padEnd(12) + col(r.baseEdgeMean, 9) + col(r.out.missing, 8) + col(r.out.partial, 8) + col(r.out.skipped, 8) + col(r.out.edgesVsBase, 8) + col(r.out.diffVsBase, 8) + '  ' + r.out.verdict.padEnd(7)
      + col(r.out5.edgesVsBase, 9) + col(r.out5.diffVsBase, 8) + '  ' + r.out5.verdict);
  });
}

function printMedianTable(allRuns) {
  console.log(`\n${'='.repeat(120)}\nMEDIAN OF ${allRuns.length} RUNS`);
  const col = (s, w) => String(s).padStart(w);
  console.log('variant'.padEnd(12) + col('p95in', 8) + col('drIn', 6) + col('busy', 8) + col('p95VsOld', 10) + col('busyVsOld', 11) + col('SPEED', 7)
    + col('missing', 9) + col('partial', 9) + col('edgesVB', 9) + col('diffVB', 8) + '  @out'.padEnd(7) + '  @5s');
  for (const v of VARIANTS) {
    const rowsForV = allRuns.map((run) => run.rows.find((r) => r.variant === v.key)).filter(Boolean);
    if (!rowsForV.length) continue;
    const p95in = median(rowsForV.map((r) => r.zoomIn.p95));
    const drIn = median(rowsForV.map((r) => r.zoomIn.dropped));
    const busy = median(rowsForV.map((r) => +(r.zoomIn.busyMs + r.zoomOut.busyMs).toFixed(1)));
    const p95VsOld = rowsForV[0].speed ? median(rowsForV.map((r) => r.speed.p95InVsOld)) : '-';
    const busyVsOld = rowsForV[0].speed ? median(rowsForV.map((r) => r.speed.busyVsOld)) : '-';
    const speed = rowsForV[0].speed ? mode(rowsForV.map((r) => r.speed.verdict)) : '-';
    const missing = median(rowsForV.map((r) => r.out.missing));
    const partial = median(rowsForV.map((r) => r.out.partial));
    const edgesVB = median(rowsForV.map((r) => r.out.edgesVsBase));
    const diffVB = median(rowsForV.map((r) => r.out.diffVsBase));
    const vOut = mode(rowsForV.map((r) => r.out.verdict));
    const vOut5 = mode(rowsForV.map((r) => r.out5.verdict));
    console.log(v.key.padEnd(12) + col(p95in, 8) + col(drIn, 6) + col(busy, 8) + col(p95VsOld, 10) + col(busyVsOld, 11) + col(speed, 7)
      + col(missing, 9) + col(partial, 9) + col(edgesVB, 9) + col(diffVB, 8) + '  ' + String(vOut).padEnd(7) + '  ' + vOut5);
  }
}

const RUN = Number(process.argv[2]);
if (![1, 2, 3].includes(RUN)) { console.error('usage: node spike/wc-check.mjs <1|2|3>'); process.exit(2); }

const c = await launch();
try {
  const rows = [];
  for (const v of VARIANTS) rows.push(await inoutProbe(c, v, RUN));

  const oldRow = rows.find((r) => r.variant === 'old');
  rows.forEach((r) => {
    if (r.variant === 'old') return;
    const busy = r.zoomIn.busyMs + r.zoomOut.busyMs, oldBusy = oldRow.zoomIn.busyMs + oldRow.zoomOut.busyMs;
    const p95InVsOld = +(r.zoomIn.p95 / oldRow.zoomIn.p95).toFixed(3);
    const maxInVsOld = +(r.zoomIn.max / oldRow.zoomIn.max).toFixed(3);
    r.speed = {
      p95InVsOld, maxInVsOld, busyVsOld: +(busy / oldBusy).toFixed(3),
      verdict: (r.zoomIn.p95 <= 1.10 * oldRow.zoomIn.p95 && r.zoomIn.max <= 1.10 * oldRow.zoomIn.max) ? 'PASS' : 'FAIL',
    };
  });

  writeFileSync(path.join(outDir, `wc-check-f${RUN}.json`), JSON.stringify({ run: RUN, variants: VARIANTS, rows }, null, 2));

  printRunTable(RUN, rows);

  const files = [1, 2, 3].map((n) => path.join(outDir, `wc-check-f${n}.json`));
  if (files.every((f) => existsSync(f))) {
    const allRuns = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
    printMedianTable(allRuns);
  }

  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
