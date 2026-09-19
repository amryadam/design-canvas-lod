// node perf/frames.mjs — zoom and pan gestures on the React Flow canvas.
// Prints one table (zoom and pan: p50, p95, max, dropped, over16, busyMs)
// and writes perf/out/frames.json.
//
// The comparison with the old canvas is recorded in perf/results.md;
// reproducing it needs the old canvas, which this repository no longer has
// (removed in Task 14 of the phase 1 plan).
// PERF_ALLOW_THROTTLED=1 is the pre-existing escape hatch for a throttled
// machine (see the idle-rAF guard); numbers from a run with it set are not
// valid results.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, root } from '../tests/cdp.mjs';

const outDir = path.join(root, 'perf', 'out');
mkdirSync(outDir, { recursive: true });

const RUNS = 3, CAL_DY = 6, TICK = 0.06; // dy is calibrated below so its per-tick zoom ratio matches this reference tick (see perf/results.md)
const PAN_PROBE_DX = 40, PAN_PX = 40; // C1: the pan gesture must travel PAN_PX screen px per frame
const MIN_IDLE_FPS = 50;
const ALLOW_THROTTLED = process.env.PERF_ALLOW_THROTTLED === '1';

// Injected into the page. One wheel event for each animation frame.
const DRIVER = `(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const wheel = (sel, o) => document.querySelector(sel).dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, ...o }));
  // I5: frames and dropped (frames > 1.5x this run's own p50) ride along with
  // over16 instead of replacing it — over16 alone is dead at a 144Hz refresh
  // (a dropped frame there is 13.9ms, under the 16.7ms threshold).
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
    // The fractional deltaY keeps the gesture on the pan branch. dx is
    // calibrated (C1, see calibratePan below) so the pan travels PAN_PX
    // screen px per frame; spikeDrive.posX (set right after this driver is
    // injected) reads the live viewport-x back so travel30 (the first half
    // of the gesture, the "in" leg) is a real measurement, not an assumption.
    pan: (sel, dx, n = 60) => stats(async () => {
      const p0 = window.spikeDrive.posX();
      let travel30 = 0;
      for (let i = 0; i < n; i++) {
        wheel(sel, { deltaX: i < n / 2 ? dx : -dx, deltaY: i % 2 ? 0.5 : -0.5 });
        await frame();
        if (i === Math.floor(n / 2) - 1) travel30 = Math.abs(window.spikeDrive.posX() - p0);
      }
      return { travel30: +travel30.toFixed(2) };
    }),
  };
})()`;

// The idle rAF rate over 1s, plus document.visibilityState. Controller ruling
// (not in the original brief): a locked or sleeping screen throttles
// requestAnimationFrame and makes every number below meaningless.
// I6: run this both before the first gesture and after the last gesture — a
// machine that goes idle-throttled mid-run must also fail.
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

// I7: content-readiness probe, read from outside the page (no spikeDrive
// dependency, so it can run before DRIVER is injected): the bounding box of
// the window nodes.
const CONTENT_BBOX = `(() => { const b = dcCanvas.api.rf.getNodesBounds(dcCanvas.api.rf.getNodes().filter((n) => n.type === 'window'));
  return { l: Math.round(b.x), t: Math.round(b.y), r: Math.round(b.x + b.width), b: Math.round(b.y + b.height) }; })()`;
const LIVE_COUNT = `document.querySelectorAll('iframe').length`;

// Put the window nodes in the middle of the pane at zoom z (or at the zoom
// that fits them in 90% of the pane when z is null).
const NEW_VIEW = (z) => `(() => {
  const b = dcCanvas.api.rf.getNodesBounds(dcCanvas.api.rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = ${z === null ? 'Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)' : z};
  dcCanvas.api.rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;

const median = (rows, k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
// I5: union of whatever keys the runs actually returned, so a field (frames,
// dropped, travel30) can never be silently dropped by a stale hardcoded list.
const fold = (rows) => {
  const keys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  return Object.fromEntries([...keys].map((k) => [k, median(rows, k)]));
};

const E = ENGINES.new;
const c = await launch();
try {
  await c.open(E.sample, 'try { localStorage.clear(); } catch {}');
  await c.until(`${E.count} >= 10 && window.dcCanvas && dcCanvas.api && dcCanvas.api.fitted`, 30000);

  // I7: replace a fixed settle sleep with a real readiness wait: the content
  // bbox and the live-iframe count must read the same three times, 500ms
  // apart, before we trust the page is done laying out.
  const t0 = Date.now();
  let reads = [];
  while (true) {
    const bbox = await c.evaluate(CONTENT_BBOX);
    const live = await c.evaluate(LIVE_COUNT);
    reads.push(JSON.stringify({ bbox, live }));
    if (reads.length > 3) reads.shift();
    if (reads.length === 3 && reads[0] === reads[1] && reads[1] === reads[2]) break;
    if (Date.now() - t0 > 30000) throw new Error(`content bbox/live-iframe count did not settle within 30000ms (last reads: ${reads.join(' | ')})`);
    await sleep(500);
  }

  // Validity guard (I6: both before and after gestures). Print the
  // measurement either way so a throttled run's evidence is visible even
  // when it is allowed to continue.
  const checkIdle = (idle, when) => {
    console.log(`idle rAF (${when}): fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
    if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
      if (!ALLOW_THROTTLED) {
        console.error(`INVALID: screen not visible or rAF throttled (${when}, fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
        c.stop(4);
      }
      console.error(`WARNING: numbers are not valid (${when}, fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — PERF_ALLOW_THROTTLED=1 is set, continuing anyway`);
    }
  };
  const idleBefore = await c.evaluate(IDLE_PROBE);
  checkIdle(idleBefore, 'before gestures');

  await c.evaluate(DRIVER);
  // A fixed literal (not runtime-constructed code) — pan() above and
  // calibratePan below both read spikeDrive.posX() back.
  await c.evaluate(`spikeDrive.posX = () => window.dcCanvas.api.rf.getViewport().x`);
  const fit = async () => { await c.evaluate(NEW_VIEW(null)); await sleep(1500); };
  const zoomOne = async () => {
    await c.evaluate(NEW_VIEW(1));
    await sleep(1500);
    // C3: read back the achieved scale instead of trusting the mechanism
    // blindly, and record the live-iframe count alongside it.
    const panScale = +(await c.evaluate(E.zoom)).toFixed(4);
    const liveAtPan = await c.evaluate(LIVE_COUNT);
    return { panScale, liveAtPan };
  };

  await fit();
  const fitScale = +(await c.evaluate(E.zoom)).toFixed(4);

  // Known-uncertain point from the brief: does a synthetic ctrl+wheel
  // dispatched on .react-flow__pane reach React Flow's zoom handler?
  // Reading @xyflow/system's XYPanZoom shows the d3 'wheel.zoom' listener is
  // bound on .react-flow__renderer (ZoomPane), the parent of
  // .react-flow__pane (Pane) — a bubbled, bubbles:true wheel event from the
  // pane should still reach it. Verify for real and fall back to the element
  // that owns the listener if it does not.
  let target = E.target;
  const tryTarget = async (sel) => {
    const z0 = await c.evaluate(E.zoom);
    await c.evaluate(`(async () => { spikeDrive.wheel('${sel}', { deltaY: -${CAL_DY}, ctrlKey: true }); await spikeDrive.frame(); await spikeDrive.frame(); })()`);
    const ratio = (await c.evaluate(E.zoom)) / z0;
    return ratio;
  };
  let ratio = await tryTarget(target);
  if (!(ratio > 1.01)) {
    const primaryTarget = target, primaryRatio = ratio;
    await fit();
    const fallback = '.react-flow__renderer';
    const ratio2 = await tryTarget(fallback);
    if (!(ratio2 > 1.01)) {
      console.error(`a synthetic ctrl+wheel on ${primaryTarget} (ratio ${primaryRatio}) or ${fallback} (ratio ${ratio2}) did not zoom the canvas. Check the event target.`);
      c.stop(3);
    }
    console.error(`a synthetic ctrl+wheel on ${primaryTarget} did not zoom the canvas (ratio ${primaryRatio}); ${fallback} worked (ratio ${ratio2}), using it instead.`);
    target = fallback;
    ratio = ratio2;
  }
  const dy = CAL_DY * TICK / Math.log(ratio);
  await fit();

  // C1: calibrate the pan gesture exactly as the zoom gesture above —
  // measure one tick's real viewport-x delta (not an assumed formula) and
  // scale deltaX so it travels PAN_PX screen px per frame.
  const calibratePan = async () => {
    const x0 = await c.evaluate('spikeDrive.posX()');
    await c.evaluate(`(async () => { spikeDrive.wheel('${target}', { deltaX: ${PAN_PROBE_DX}, deltaY: -0.5 }); await spikeDrive.frame(); await spikeDrive.frame(); })()`);
    const x1 = await c.evaluate('spikeDrive.posX()');
    const ratio = Math.abs(x1 - x0) / PAN_PROBE_DX;
    if (!(ratio > 0.01)) {
      console.error(`a synthetic wheel pan on ${target} did not move the canvas (ratio ${ratio}). Check the event target.`);
      c.stop(3);
    }
    await fit(); // undo the probe tick's drift before the timed measurement
    return +(PAN_PX / ratio).toFixed(3);
  };
  const panDx = await calibratePan();

  const liveAtFit = await c.evaluate(LIVE_COUNT);

  // The scale after 45 zoom-in ticks.
  await c.evaluate(`spikeDrive.zoomIn('${target}', ${dy}, 45)`);
  const zoomedIn = await c.evaluate(E.zoom);
  await fit();

  const measure = async (gesture) => {
    const rows = [];
    await c.evaluate(`spikeDrive.${gesture}.then(() => 1)`); await sleep(1200); // warm-up
    for (let i = 0; i < RUNS; i++) {
      const b0 = await c.busy();
      const s = await c.evaluate(`spikeDrive.${gesture}`);
      rows.push({ ...s, busyMs: +((await c.busy()) - b0).toFixed(1) });
      await sleep(1200);
    }
    return fold(rows);
  };
  const zoom = await measure(`zoom('${target}', ${dy})`);

  const { panScale, liveAtPan } = await zoomOne();
  const pan = await measure(`pan('${target}', ${panDx})`);

  const idleAfter = await c.evaluate(IDLE_PROBE);
  checkIdle(idleAfter, 'after gestures');

  const out = {
    fitScale, liveAtFit, deltaY: +dy.toFixed(3), panDx, zoomedIn: +zoomedIn.toFixed(4),
    panScale, liveAtPan, zoom, pan,
    idleFpsBefore: +idleBefore.fps.toFixed(1), visibilityBefore: idleBefore.visibility,
    idleFpsAfter: +idleAfter.fps.toFixed(1), visibilityAfter: idleAfter.visibility,
  };

  console.table({ zoom: out.zoom, pan: out.pan });
  console.log(`fit scale: ${out.fitScale}, live iframes at fit: ${out.liveAtFit}`);

  writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(out, null, 2));
  if (ALLOW_THROTTLED) console.error('WARNING: numbers are not valid — this run had PERF_ALLOW_THROTTLED=1 set.');
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
