// node spike/wc-check.mjs — Task 3c: does `wc=1` (will-change: transform on
// .react-flow__viewport, the fix for the spike's own extra zoom cost found
// in Task 3b's ablation) bring back the tall-page GPU-layer blank that the
// OLD engine shows (spike/tall-check.mjs's in-out probe, INOUT old: BLANK)?
// Also checks a middle way, `wc=1&contain=1` (adds `contain:layout paint`
// to each card, spike/src/main.jsx's `contain` flag).
//
// This is a NEW script. It does not edit spike/tall-check.mjs, spike/
// frames.mjs or spike/ablate.mjs; the pieces below marked "copied from
// tall-check.mjs" or "copied from ablate.mjs" are verbatim or near-verbatim
// copies (those scripts have no exports — everything runs at module load —
// so importing them is not an option; copying is the same approach
// ablate.mjs itself uses for the bits it needs from frames.mjs).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const EL = { old: '[data-dc-slot]', new: '.react-flow__node-window' };

// ---- copied from spike/tall-check.mjs ----
const unionRectOf = (sel) => `(() => { const a = [...document.querySelectorAll('${sel}')];
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  a.forEach((el) => { const q = el.getBoundingClientRect();
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
  return { l, t, w: r - l, h: b - t }; })()`;

const DRAWN = (b64, r) => `(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
  const k = img.width / innerWidth;
  const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const x0 = Math.max(0, ${r.l}), y0 = Math.max(0, ${r.t}), x1 = Math.min(innerWidth, ${r.l + r.w}), y1 = Math.min(innerHeight, ${r.t + r.h});
  if (x1 - x0 < 4 || y1 - y0 < 4) return -1;
  const d = g.getImageData(Math.round(x0 * k), Math.round(y0 * k), Math.round((x1 - x0) * k), Math.round((y1 - y0) * k)).data;
  let n = 0, hit = 0;
  for (let i = 0; i < d.length; i += 16) { n++; if (Math.abs(d[i] - 240) > 10 || Math.abs(d[i + 1] - 238) > 10 || Math.abs(d[i + 2] - 233) > 10) hit++; }
  return hit / n;
})()`;

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

async function fitOld(c) {
  await c.open(ENGINES.old.tall, "try { localStorage.clear(); } catch {}");
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
// script has several new-engine URL variants — plain/wc/wc-contain — that
// tall-check.mjs never needed, since it only ever visits ENGINES.new.tall).
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

// New for Task 3c: every card's own (unclipped) screen rect, in document
// order — same order for a variant's base and out shot, so cards are
// matched by index (cards are static DOM nodes; only the viewport moves).
const allRectsOf = (sel) => `[...document.querySelectorAll('${sel}')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })`;

// New for Task 3c: per-card "edge" metric. The union-rect `drawn` number
// (DRAWN above) cannot tell a blank card from a pale-but-drawn one — see the
// brief. This instead samples a border band just inside each card's rect
// and reports the fraction of those pixels that are NOT background colour
// #f0eee9 (240,238,233): a drawn card has a visible frame (box-shadow /
// border against the page background) so `edge` is high; a card the
// compositor dropped is indistinguishable from bare background there, so
// `edge` is ~0; a card cut off part-way through has a partial frame.
// The band is sampled with 4 small getImageData calls per card (top strip,
// bottom strip, left strip, right strip minus the corners already counted
// in top/bottom) rather than a full-card decode, so this stays fast even
// for ~50 large (1440x900 CSS) cards per screenshot.
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

// Frame-time stats, same shape tall-check.mjs/ablate.mjs use: p50/p95/max
// from the sorted times, dropped = frames > 1.5x p50.
function statsOf(times) {
  const s = times.slice().sort((a, b) => a - b);
  if (!s.length) return { p50: 0, p95: 0, max: 0, dropped: 0, count: 0 };
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  const p50 = q(0.5);
  return { p50, p95: q(0.95), max: +s[s.length - 1].toFixed(2), dropped: s.filter((t) => t > 1.5 * p50).length, count: s.length };
}

// The in-out probe for one variant: fit -> baseline screenshot (+ per-card
// rects, for the edge metric) -> zoom in with calibrated ticks to scale >=
// 3.5 -> screenshot -> zoom out the SAME number of ticks (split around a mid
// screenshot) -> wait 1s -> screenshot (+ per-card rects again). Records
// zoom-in AND zoom-out frame times separately (tall-check.mjs's inoutProbe
// only records the zoom-out leg; the brief for this task asks for both) and
// main-thread busy ms for the tick-dispatch work only (the base/in/mid/out
// screenshot decode+sample calls run on the main thread too but are
// diagnostic overhead, not part of "the in-out gesture", so they are
// excluded from the busy delta by bracketing busy() around each TICKS call
// rather than once around the whole probe).
async function inoutProbe(c, v) {
  const name = v.engine;
  const zoomExpr = ZOOM_EXPR[name];
  let target, dy;
  if (name === 'old') { await fitOld(c); target = ENGINES.old.target; dy = OLD_DY; }
  else { await fitNew(c, v.url); ({ target, dy } = await calibrateNewDy(c, v.url)); }

  const cx = VIEW.width / 2, cy = VIEW.height / 2;
  const shot = async (tag, withCards) => {
    const rect = await c.evaluate(unionRectOf(EL[name]));
    const cardRects = withCards ? await c.evaluate(allRectsOf(EL[name])) : null;
    const b64 = await c.screenshot(`wc-${v.key}-${tag}.png`);
    const drawn = +(await c.evaluate(DRAWN(b64, rect))).toFixed(3);
    const edges = withCards ? await c.evaluate(EDGE(b64, cardRects)) : null;
    return { rect, drawn, cardRects, edges };
  };

  const base = await shot('base', true);

  let b0 = await c.busy();
  const zin = await c.evaluate(TICKS(target, zoomExpr, -dy, INOUT_MAX_TICKS, INOUT_TARGET_SCALE, cx, cy));
  let b1 = await c.busy();
  const busyIn = b1 - b0;
  const inShot = await shot('in', false);

  const nOut = zin.n, half1 = Math.floor(nOut / 2), half2 = nOut - half1;
  b0 = await c.busy();
  const batch1 = await c.evaluate(TICKS(target, zoomExpr, dy, half1, null, cx, cy));
  b1 = await c.busy();
  const busyOut1 = b1 - b0;
  const midShot = await shot('mid', false);
  b0 = await c.busy();
  const batch2 = await c.evaluate(TICKS(target, zoomExpr, dy, half2, null, cx, cy));
  b1 = await c.busy();
  const busyOut2 = b1 - b0;
  const busyOut = busyOut1 + busyOut2;
  await sleep(1000);
  const out = await shot('out', true);

  const inStats = statsOf(zin.times.slice(2));
  const outStats = statsOf([...batch1.times.slice(2), ...batch2.times.slice(2)]);

  const outVsBase = base.drawn > 0 ? +(out.drawn / base.drawn).toFixed(3) : -1;

  // The per-card edge metric (the actual blank verdict for this task).
  // Only cards whose BASE rect is >= 8px in both dims and overlaps the
  // viewport count (per the brief) — a card that was never really on
  // screen, or a degenerate 0-size rect, cannot be judged "missing".
  const n = Math.min(base.cardRects.length, out.cardRects.length);
  if (base.cardRects.length !== out.cardRects.length) {
    console.error(`WARNING: ${v.key} card count changed base=${base.cardRects.length} out=${out.cardRects.length}, comparing first ${n}`);
  }
  const inViewport = (r) => r.l < VIEW.width && r.l + r.w > 0 && r.t < VIEW.height && r.t + r.h > 0;
  let cards = 0, missing = 0, partial = 0;
  const perCard = [];
  for (let i = 0; i < n; i++) {
    const br = base.cardRects[i], be = base.edges[i].edge;
    const oe = out.edges[i].edge;
    const qualifies = br.w >= 8 && br.h >= 8 && inViewport(br);
    if (!qualifies) continue;
    cards++;
    const ratio = be > 0 ? oe / be : (oe > 0 ? 1 : 0);
    let cls = 'ok';
    if (ratio < 0.3) { missing++; cls = 'missing'; } else if (ratio < 0.8) { partial++; cls = 'partial'; }
    perCard.push({ i, baseEdge: be, outEdge: oe, ratio: +ratio.toFixed(3), cls });
  }
  const verdict = (missing + partial > 0) ? 'BLANK' : 'OK';

  const result = {
    variant: v.key, engine: name, url: v.url, target, dy: +dy.toFixed(4),
    base: { drawn: base.drawn }, in: { n: zin.n, scale: +zin.scale.toFixed(4), drawn: inShot.drawn },
    mid: { drawn: midShot.drawn }, out: { n: half1 + half2, scale: +batch2.scale.toFixed(4), drawn: out.drawn },
    outVsBase,
    zoomIn: { ...inStats, busyMs: +busyIn.toFixed(1) },
    zoomOut: { ...outStats, busyMs: +busyOut.toFixed(1) },
    cards, missing, partial, verdict, perCard,
  };
  console.log(`wc-check ${v.key}: base=${result.base.drawn} in(n=${result.in.n},scale=${result.in.scale})=${result.in.drawn} mid=${result.mid.drawn} out(n=${result.out.n},scale=${result.out.scale})=${result.out.drawn} outVsBase=${outVsBase} cards=${cards} missing=${missing} partial=${partial} -> ${verdict}`);
  return result;
}

const VARIANTS = [
  { key: 'old', engine: 'old', url: ENGINES.old.tall, label: 'old engine (control)' },
  { key: 'plain', engine: 'new', url: ENGINES.new.tall, label: 'React Flow, no flags' },
  { key: 'wc', engine: 'new', url: ENGINES.new.tall + '&wc=1', label: 'React Flow, wc=1' },
  { key: 'wc-contain', engine: 'new', url: ENGINES.new.tall + '&wc=1&contain=1', label: 'React Flow, wc=1&contain=1' },
];
const RUNS = 2;

const c = await launch();
const allRuns = [];
try {
  // Validity guard (as tall-check.mjs): measured once, on the first page.
  await c.open(ENGINES.old.tall, "try { localStorage.clear(); } catch {}");
  await c.until(`${ENGINES.old.count} >= 10`, 60000);
  await sleep(1000);
  const idle = await c.evaluate(IDLE_PROBE);
  console.log(`idle rAF: fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
  if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
    if (!ALLOW_THROTTLED) {
      console.error(`INVALID: screen not visible or rAF throttled (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
      c.stop(4);
    }
    console.error(`WARNING: numbers are not valid (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — SPIKE_ALLOW_THROTTLED=1 is set, continuing anyway`);
  }

  for (let run = 1; run <= RUNS; run++) {
    console.log(`\n===== RUN ${run}/${RUNS} =====`);
    const rows = [];
    for (const v of VARIANTS) rows.push(await inoutProbe(c, v));
    allRuns.push({ run, rows });
  }

  writeFileSync(path.join(outDir, 'wc-check.json'), JSON.stringify({ variants: VARIANTS, runs: allRuns }, null, 2));

  for (const { run, rows } of allRuns) {
    console.log(`\n${'='.repeat(104)}\nRUN ${run}`);
    const col = (s, w) => String(s).padStart(w);
    console.log('variant'.padEnd(12) + col('p95in', 8) + col('p95out', 8) + col('drIn', 6) + col('drOut', 6) + col('max', 7) + col('busyMs', 9) + col('cards', 7) + col('missing', 9) + col('partial', 9) + '  verdict');
    rows.forEach((r) => {
      const maxAll = Math.max(r.zoomIn.max, r.zoomOut.max);
      const busyMs = +(r.zoomIn.busyMs + r.zoomOut.busyMs).toFixed(1);
      console.log(r.variant.padEnd(12) + col(r.zoomIn.p95, 8) + col(r.zoomOut.p95, 8) + col(r.zoomIn.dropped, 6) + col(r.zoomOut.dropped, 6) + col(maxAll, 7) + col(busyMs, 9) + col(r.cards, 7) + col(r.missing, 9) + col(r.partial, 9) + '  ' + r.verdict);
    });
  }

  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
