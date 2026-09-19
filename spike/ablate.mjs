// node spike/ablate.mjs — Task 3b: an ABLATION of the spike page's own zoom
// cost. spike/frames.mjs found zoom p95 8.4-13.8ms on the spike vs 7.5-8.5ms
// on the old engine (144Hz display; a dropped frame is ~13.9ms), with 3-6
// dropped frames of 88 vs 1, and main-thread busy 159-184ms vs 136-146ms.
// This script does not explain WHY (that is React Flow vs the old engine);
// it isolates WHICH of the spike page's own suspects (Background, edge
// labels, edges, all 8 handles per node, box-shadow, content-visibility,
// the live-iframe budget) accounts for the gap, one at a time, by toggling
// URL flags spike/src/main.jsx now reads from location.search.
//
// The driver (spikeDrive.zoom/zoomIn/frame/wheel), the readiness wait (the
// content-bbox + live-iframe-count settle loop), the validity guard (idle
// rAF fps and visibility), and the new-engine deltaY calibration below are
// COPIED from spike/frames.mjs, not imported (that script has no exports
// and this task must not change its behaviour). Anything copied is marked;
// nothing in spike/frames.mjs itself is touched.
//
// SPIKE_ALLOW_THROTTLED=1 is the same escape hatch as frames.mjs: numbers
// from a run with it set are not valid results.
//
// ABLATE_ONLY=name,name limits the flag-variant loop to those names (plus
// old-first/base/old-last/base-again, which always run) — an escape hatch
// for a partial or resumed run if a single invocation ever needs splitting.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, outDir } from './cdp.mjs';

const RUNS = 5, OLD_DY = 6, TICK = 0.06;
const MIN_IDLE_FPS = 50;
const ALLOW_THROTTLED = process.env.SPIKE_ALLOW_THROTTLED === '1';
const ONLY = process.env.ABLATE_ONLY ? new Set(process.env.ABLATE_ONLY.split(',').map((s) => s.trim())) : null;
// A single flag is judged to have "helped" if it cuts busyMs vs `base` by
// more than this fraction. Chosen because it is well above the base/
// base-again drift this rig has shown in prior runs (frames.json: old
// before/after idle fps drift 144.9->144.5, i.e. <1%); the report states
// the actual base-vs-base-again spread measured in THIS run for comparison.
const HELP_THRESHOLD = 0.05;

// ---- copied from spike/frames.mjs (verbatim except the "old zoomedIn
// baseline" name below, which frames.mjs does not need since it only runs
// each engine once) ----
const DRIVER = `(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const wheel = (sel, o) => document.querySelector(sel).dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, ...o }));
  const stats = async (fn) => {
    const times = []; let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const extra = await fn(); stop = true;
    const s = times.slice(2).sort((a, b) => a - b), q = (p) => +s[Math.floor(s.length * p)].toFixed(2);
    const p50 = q(0.5);
    const dropped = s.filter((f) => f > 1.5 * p50).length;
    return { frames: s.length, p50, p95: q(0.95), max: +s[s.length - 1].toFixed(2),
      over16: s.filter((f) => f > 16.7).length, dropped, ...(extra || {}) };
  };
  window.spikeDrive = {
    frame, wheel,
    zoomIn: async (sel, dy, n) => { for (let i = 0; i < n; i++) { wheel(sel, { deltaY: -dy, ctrlKey: true }); await frame(); } },
    zoom: (sel, dy, n = 90) => stats(async () => {
      for (let i = 0; i < n; i++) { wheel(sel, { deltaY: i < n / 2 ? -dy : dy, ctrlKey: true }); await frame(); } }),
  };
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

const CONTENT_BBOX = {
  old: `(() => { const els = [...document.querySelectorAll('[data-dc-slot]')];
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    els.forEach((el) => { const q = el.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
    return { l: Math.round(l), t: Math.round(t), r: Math.round(r), b: Math.round(b) }; })()`,
  new: `(() => { const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
    return { l: Math.round(b.x), t: Math.round(b.y), r: Math.round(b.x + b.width), b: Math.round(b.y + b.height) }; })()`,
};
const LIVE_COUNT = `document.querySelectorAll('iframe').length`;

const NEW_VIEW = (z) => `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = ${z === null ? 'Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)' : z};
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;

const median = (rows, k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const fold = (rows) => {
  const keys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  return Object.fromEntries([...keys].map((k) => [k, median(rows, k)]));
};
// ---- end copied from spike/frames.mjs ----

const FLAG_VARIANTS = [
  { name: 'off-bg', query: 'off=bg' },
  { name: 'off-labels', query: 'off=labels' },
  { name: 'off-edges', query: 'off=edges' },
  { name: 'off-handles', query: 'off=handles' },
  { name: 'off-shadow', query: 'off=shadow' },
  { name: 'off-cv', query: 'off=cv' },
  { name: 'off-iframes', query: 'off=iframes' },
  { name: 'cis', query: 'cis=1' },
  { name: 'wc', query: 'wc=1' },
  { name: 'contain', query: 'contain=1' },
  { name: 'all-off', query: 'off=bg,labels,handles,shadow,cv' },
  { name: 'bare', query: 'off=bg,edges,handles,shadow,cv,iframes' },
];
const SINGLE_EFFECT_NAMES = ['off-bg', 'off-labels', 'off-edges', 'off-handles', 'off-shadow', 'off-cv', 'off-iframes', 'cis', 'wc', 'contain'];

const c = await launch();
const results = {};
const order = [];
let oldZoomedIn = null;

const checkIdle = (idle, when, label) => {
  console.log(`idle rAF for ${label} (${when}): fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
  if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
    if (!ALLOW_THROTTLED) {
      console.error(`INVALID: screen not visible or rAF throttled (${label}, ${when}, fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
      c.stop(4);
    }
    console.error(`WARNING: numbers are not valid (${label}, ${when}, fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — SPIKE_ALLOW_THROTTLED=1 is set, continuing anyway`);
  }
};

// Copied from spike/frames.mjs: the content-bbox + live-iframe-count settle
// loop (three identical reads, 500ms apart) that replaced a fixed sleep.
async function waitReady(engine, label) {
  const t0 = Date.now();
  let reads = [];
  while (true) {
    const bbox = await c.evaluate(CONTENT_BBOX[engine]);
    const live = await c.evaluate(LIVE_COUNT);
    reads.push(JSON.stringify({ bbox, live }));
    if (reads.length > 3) reads.shift();
    if (reads.length === 3 && reads[0] === reads[1] && reads[1] === reads[2]) return;
    if (Date.now() - t0 > 30000) throw new Error(`content bbox/live-iframe count did not settle for ${label} within 30000ms (last reads: ${reads.join(' | ')})`);
    await sleep(500);
  }
}

async function fitEngine(engine) {
  if (engine === 'old') {
    if (!(await c.evaluate('!!window.dcBench'))) await c.evaluate(`fetch('/perf/bench.js').then((r) => r.text()).then((t) => { (0, eval)(t); })`);
    await c.evaluate('dcBench.fit().then(() => 1)');
  } else await c.evaluate(NEW_VIEW(null));
  await sleep(1500);
}

// Copied from spike/frames.mjs's new-engine calibration: verify a synthetic
// ctrl+wheel on .react-flow__pane really zooms, fall back to
// .react-flow__renderer if not, then scale deltaY to match the old engine's
// per-tick log-zoom-factor (OLD_DY=6 -> TICK=0.06).
async function calibrateDy(engine, target) {
  if (engine === 'old') return { target, dy: OLD_DY };
  const tryTarget = async (sel) => {
    const z0 = await c.evaluate(ENGINES.new.zoom);
    await c.evaluate(`(async () => { spikeDrive.wheel('${sel}', { deltaY: -${OLD_DY}, ctrlKey: true }); await spikeDrive.frame(); await spikeDrive.frame(); })()`);
    return (await c.evaluate(ENGINES.new.zoom)) / z0;
  };
  let ratio = await tryTarget(target);
  if (!(ratio > 1.01)) {
    const primaryTarget = target, primaryRatio = ratio;
    await fitEngine('new');
    const fallback = '.react-flow__renderer';
    const ratio2 = await tryTarget(fallback);
    if (!(ratio2 > 1.01)) throw new Error(`a synthetic ctrl+wheel on ${primaryTarget} (ratio ${primaryRatio}) or ${fallback} (ratio ${ratio2}) did not zoom the spike`);
    console.error(`a synthetic ctrl+wheel on ${primaryTarget} did not zoom the spike (ratio ${primaryRatio}); ${fallback} worked (ratio ${ratio2}), using it instead.`);
    target = fallback; ratio = ratio2;
  }
  const dy = OLD_DY * TICK / Math.log(ratio);
  await fitEngine('new');
  return { target, dy };
}

async function measure(gestureExpr) {
  const rows = [];
  await c.evaluate(`spikeDrive.${gestureExpr}.then(() => 1)`); await sleep(1200); // warm-up
  for (let i = 0; i < RUNS; i++) {
    const b0 = await c.busy();
    const s = await c.evaluate(`spikeDrive.${gestureExpr}`);
    rows.push({ ...s, busyMs: +((await c.busy()) - b0).toFixed(1) });
    await sleep(1200);
  }
  return fold(rows);
}

async function runVariant(name, engine, urlPath) {
  console.log(`\n=== ${name} (${engine}) ${urlPath} ===`);
  const E = ENGINES[engine];
  await c.open(urlPath, "try { localStorage.clear(); } catch {}");
  await c.until(`${E.count} >= 10`, engine === 'old' ? 60000 : 30000);
  await waitReady(engine, name);

  const idleBefore = await c.evaluate(IDLE_PROBE);
  checkIdle(idleBefore, 'before gestures', name);

  await c.evaluate(DRIVER);
  await c.evaluate(engine === 'old' ? `spikeDrive.posX = () => window.dcView.x` : `spikeDrive.posX = () => window.rf.getViewport().x`);

  await fitEngine(engine);
  const fitScale = +(await c.evaluate(E.zoom)).toFixed(4);

  const { target, dy } = await calibrateDy(engine, E.target);

  await c.evaluate(`spikeDrive.zoomIn('${target}', ${dy}, 45)`);
  const zoomedIn = +(await c.evaluate(E.zoom)).toFixed(4);
  await fitEngine(engine);

  if (engine === 'old' && oldZoomedIn === null) oldZoomedIn = zoomedIn; // baseline set by old-first

  let parityOk = true, parityNote = 'n/a (old engine)';
  if (engine === 'new') {
    if (oldZoomedIn === null) throw new Error('old baseline (old-first) has not been measured yet');
    parityOk = Math.abs(zoomedIn / oldZoomedIn - 1) <= 0.03;
    parityNote = `zoomedIn=${zoomedIn} vs old=${oldZoomedIn} (${(Math.abs(zoomedIn / oldZoomedIn - 1) * 100).toFixed(2)}% apart)`;
    console.log(`zoom parity (${name}): ${parityNote} — ${parityOk ? 'OK' : 'FAIL'}`);
  }

  let zoom = null;
  if (parityOk) {
    zoom = await measure(`zoom('${target}', ${dy})`);
  } else {
    console.error(`INVALID: ${name} — gesture parity FAIL (${parityNote}); not measured`);
  }

  const idleAfter = await c.evaluate(IDLE_PROBE);
  checkIdle(idleAfter, 'after gestures', name);

  return {
    name, engine, url: urlPath, fitScale, zoomedIn, target, dy: +dy.toFixed(3),
    parityOk, parityNote,
    idleFpsBefore: +idleBefore.fps.toFixed(1), idleFpsAfter: +idleAfter.fps.toFixed(1),
    zoom,
  };
}

const run = async (name, engine, urlPath) => {
  if (ONLY && !ONLY.has(name) && !['old-first', 'base', 'old-last', 'base-again'].includes(name)) {
    console.log(`skipping ${name} (ABLATE_ONLY set, not in list)`);
    return;
  }
  order.push(name);
  // One retry on a script error (not on a parity FAIL, which is a real
  // result): a hard navigation right after another hard navigation can hit a
  // CDP document-readyState race (the exact class of flake spike/frames.mjs's
  // readiness wait was written to guard against) and evaluate against a
  // half-swapped document. A second attempt on a clean page removes that
  // noise; a repeat failure is a real finding, not a fluke, and is reported.
  try {
    results[name] = await runVariant(name, engine, urlPath);
  } catch (e) {
    console.error(`ERROR in variant ${name} (attempt 1): ${e && e.message ? e.message : e}`);
    console.error(`retrying ${name} once...`);
    try {
      results[name] = await runVariant(name, engine, urlPath);
    } catch (e2) {
      console.error(`ERROR in variant ${name} (attempt 2): ${e2 && e2.message ? e2.message : e2}`);
      results[name] = { name, engine, url: urlPath, error: String(e2 && e2.message ? e2.message : e2) };
    }
  }
};

try {
  await run('old-first', 'old', ENGINES.old.sample);
  await run('base', 'new', ENGINES.new.sample);
  for (const v of FLAG_VARIANTS) await run(v.name, 'new', ENGINES.new.sample + '?' + v.query);

  // "best": the flags among the 10 single-effect variants that individually
  // beat `base` on busyMs by more than HELP_THRESHOLD, combined. Computed
  // after the full single-flag battery above, per the brief.
  const base = results['base'];
  const helped = [];
  if (base && base.zoom) {
    console.log('\n--- single-flag effect on busyMs vs base ---');
    for (const n of SINGLE_EFFECT_NAMES) {
      const r = results[n];
      if (!r || !r.zoom) { console.log(`${n}: not measured (INVALID or error)`); continue; }
      const rel = (base.zoom.busyMs - r.zoom.busyMs) / base.zoom.busyMs;
      console.log(`${n}: busyMs ${r.zoom.busyMs} vs base ${base.zoom.busyMs} (${(rel * 100).toFixed(1)}% ${rel > 0 ? 'better' : 'worse'})`);
      if (rel > HELP_THRESHOLD) helped.push(n);
    }
  } else {
    console.error('base was not validly measured — cannot judge which flags helped, skipping best');
  }

  let bestQuery = null;
  if (helped.length) {
    const offFlags = helped.filter((n) => n.startsWith('off-')).map((n) => n.slice(4));
    const onFlags = helped.filter((n) => !n.startsWith('off-'));
    const parts = [];
    if (offFlags.length) parts.push('off=' + offFlags.join(','));
    onFlags.forEach((f) => parts.push(`${f}=1`));
    bestQuery = parts.join('&');
    console.log(`\nbest combination (flags that each beat base by >${(HELP_THRESHOLD * 100).toFixed(0)}% busyMs): ${helped.join(', ')} -> ?${bestQuery}`);
    await run('best', 'new', ENGINES.new.sample + '?' + bestQuery);
  } else {
    console.log(`\nbest: no single flag beat base by more than ${(HELP_THRESHOLD * 100).toFixed(0)}% busyMs — skipping the best variant.`);
  }

  await run('old-last', 'old', ENGINES.old.sample);
  await run('base-again', 'new', ENGINES.new.sample);

  const out = {
    runs: RUNS, helpThresholdRelBusyMs: HELP_THRESHOLD,
    order, results, helped, bestQuery,
  };
  writeFileSync(path.join(outDir, 'ablate.json'), JSON.stringify(out, null, 2));

  const oldFirstP95 = results['old-first'] && results['old-first'].zoom ? results['old-first'].zoom.p95 : null;
  const oldLastP95 = results['old-last'] && results['old-last'].zoom ? results['old-last'].zoom.p95 : null;
  const oldP95Mean = (oldFirstP95 != null && oldLastP95 != null) ? (oldFirstP95 + oldLastP95) / 2 : (oldFirstP95 ?? oldLastP95);

  const rows = order.map((n) => results[n]).filter((r) => r && r.zoom);
  rows.sort((a, b) => (a.zoom.p95 - b.zoom.p95) || (a.zoom.busyMs - b.zoom.busyMs));

  const col = (s, w) => String(s).padStart(w);
  console.log('\n' + '='.repeat(104));
  console.log(
    'name'.padEnd(14) + col('p50', 7) + col('p95', 7) + col('max', 7) + col('dropped', 9) +
    col('frames', 8) + col('busyMs', 9) + col('vsBase', 9) + col('vsOld', 9),
  );
  rows.forEach((r) => {
    const vsBase = base && base.zoom ? (r.zoom.busyMs / base.zoom.busyMs).toFixed(2) : '-';
    const vsOld = oldP95Mean ? (r.zoom.p95 / oldP95Mean).toFixed(2) : '-';
    console.log(
      r.name.padEnd(14) + col(r.zoom.p50, 7) + col(r.zoom.p95, 7) + col(r.zoom.max, 7) +
      col(r.zoom.dropped, 9) + col(r.zoom.frames, 8) + col(r.zoom.busyMs, 9) + col(vsBase, 9) + col(vsOld, 9),
    );
  });
  const skipped = order.filter((n) => !results[n] || !results[n].zoom);
  if (skipped.length) console.log('\nINVALID / not measured: ' + skipped.join(', '));

  if (base && base.zoom && results['base-again'] && results['base-again'].zoom) {
    const ba = results['base-again'].zoom;
    console.log(`\nbase vs base-again (noise): p95 ${base.zoom.p95} vs ${ba.p95}, busyMs ${base.zoom.busyMs} vs ${ba.busyMs}, dropped ${base.zoom.dropped} vs ${ba.dropped}`);
  }
  if (oldFirstP95 != null && oldLastP95 != null) {
    console.log(`old-first vs old-last (drift): p95 ${oldFirstP95} vs ${oldLastP95}, busyMs ${results['old-first'].zoom.busyMs} vs ${results['old-last'].zoom.busyMs}`);
  }

  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
