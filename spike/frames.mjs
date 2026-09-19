// node spike/frames.mjs — the same zoom and pan gestures on both engines.
//
// SPIKE_ORDER=old,new (default) or SPIKE_ORDER=new,old picks which engine
// runs first; the order is recorded in the output file (out.order) and picks
// the output file name — see `outFile` below.
// SPIKE_ALLOW_THROTTLED=1 is the pre-existing escape hatch for a throttled
// machine (see the idle-rAF guard); numbers from a run with it set are not
// valid results.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, outDir } from './cdp.mjs';

const RUNS = 3, OLD_DY = 6, TICK = 0.06; // the old engine zooms by exp(deltaY * 0.01) for each tick
const PAN_PROBE_DX = 40, PAN_PX = 40; // C1: both engines must travel PAN_PX screen px per pan frame
const MIN_IDLE_FPS = 50;
const ALLOW_THROTTLED = process.env.SPIKE_ALLOW_THROTTLED === '1';

// I4: engine run order, recorded in frames.json and used to name the output file.
const ORDER = (process.env.SPIKE_ORDER || 'old,new').split(',').map((s) => s.trim());
if (!(ORDER.length === 2 && ORDER.includes('old') && ORDER.includes('new') && ORDER[0] !== ORDER[1])) {
  console.error(`SPIKE_ORDER must be "old,new" or "new,old" (got "${process.env.SPIKE_ORDER}")`);
  process.exit(2);
}
const outFile = ORDER[0] === 'old' ? 'frames.json' : 'frames-reversed.json';

// Injected into each page. One wheel event for each animation frame.
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
    // The fractional deltaY keeps the old engine on its pan branch. dx is
    // per-engine calibrated (C1, see calibratePan below) so both engines
    // travel the same screen px per frame; spikeDrive.posX (set right after
    // this driver is injected, per engine) reads this engine's own live
    // viewport-x back so travel30 (the first half of the gesture, the "in"
    // leg) is a real measurement, not an assumption.
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
// I6: run this both before the first gesture and after the last gesture of
// each engine — a machine that goes idle-throttled mid-run must also fail.
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

// I7: content-readiness probes, read from outside the page (no spikeDrive
// dependency, so they can run before DRIVER is injected). old: the union
// rect of [data-dc-slot]. new: rf.getNodesBounds of the window nodes.
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

// Put the window nodes in the middle of the pane at zoom z (or at the zoom
// that fits them in 90% of the pane when z is null).
const NEW_VIEW = (z) => `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = ${z === null ? 'Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)' : z};
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
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

const c = await launch();
const out = {};
try {
  for (const name of ORDER) {
    const E = ENGINES[name];
    await c.open(E.sample, 'try { localStorage.clear(); } catch {}');
    // Deviation from the brief: the old page compiles design-canvas.jsx and
    // canvas-page.jsx with Babel standalone, in the browser, after load. The
    // default 30s `until` timeout was not enough on this machine; give the
    // old engine 60s and keep the new engine (a prebuilt bundle) at 30s.
    await c.until(`${E.count} >= 10`, name === 'old' ? 60000 : 30000);

    // I7: replace the fixed 4s settle sleep with a real readiness wait: the
    // content bbox and the live-iframe count must read the same three times,
    // 500ms apart, before we trust the page is done laying out (this is what
    // a prior run's transient PARITY FAIL traced back to).
    const t0 = Date.now();
    let reads = [];
    while (true) {
      const bbox = await c.evaluate(CONTENT_BBOX[name]);
      const live = await c.evaluate(LIVE_COUNT);
      reads.push(JSON.stringify({ bbox, live }));
      if (reads.length > 3) reads.shift();
      if (reads.length === 3 && reads[0] === reads[1] && reads[1] === reads[2]) break;
      if (Date.now() - t0 > 30000) throw new Error(`content bbox/live-iframe count did not settle for ${name} within 30000ms (last reads: ${reads.join(' | ')})`);
      await sleep(500);
    }

    // Validity guard (I6: both before and after gestures). Print the
    // measurement either way so a throttled run's evidence is visible even
    // when it is allowed to continue.
    const checkIdle = (idle, when) => {
      console.log(`idle rAF for ${name} (${when}): fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
      if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
        if (!ALLOW_THROTTLED) {
          console.error(`INVALID: screen not visible or rAF throttled (${name}, ${when}, fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
          c.stop(4);
        }
        console.error(`WARNING: numbers are not valid (${name}, ${when}, fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — SPIKE_ALLOW_THROTTLED=1 is set, continuing anyway`);
      }
    };
    const idleBefore = await c.evaluate(IDLE_PROBE);
    checkIdle(idleBefore, 'before gestures');

    await c.evaluate(DRIVER);
    // A fixed, per-engine literal (not runtime-constructed code) — pan()
    // above and calibratePan below both read spikeDrive.posX() back.
    await c.evaluate(name === 'old' ? `spikeDrive.posX = () => window.dcView.x` : `spikeDrive.posX = () => window.rf.getViewport().x`);
    const fit = async () => {
      if (name === 'old') {
        if (!(await c.evaluate('!!window.dcBench'))) await c.evaluate(`fetch('/perf/bench.js').then((r) => r.text()).then((t) => { (0, eval)(t); })`);
        await c.evaluate('dcBench.fit().then(() => 1)');
      } else await c.evaluate(NEW_VIEW(null));
      await sleep(1500);
    };
    const zoomOne = async () => {
      if (name === 'old') await c.evaluate(`window.postMessage({ type: '__dc_set_zoom', scale: 1 }, '*')`);
      else await c.evaluate(NEW_VIEW(1));
      await sleep(1500);
      // C3: read back the achieved scale instead of trusting either
      // mechanism blindly, and record the live-iframe count alongside it.
      const panScale = +(await c.evaluate(E.zoom)).toFixed(4);
      const liveAtPan = await c.evaluate(LIVE_COUNT);
      return { panScale, liveAtPan };
    };

    await fit();
    const fitScale = +(await c.evaluate(E.zoom)).toFixed(4);

    let dy = OLD_DY;
    // The target the gestures below actually dispatch on. Starts as the
    // engine's default (ENGINES[name].target from cdp.mjs) and may fall back
    // for the new engine — see the calibration block.
    let target = E.target;
    if (name === 'new') {
      // Known-uncertain point from the brief: does a synthetic ctrl+wheel
      // dispatched on .react-flow__pane reach React Flow's zoom handler?
      // Reading @xyflow/system's XYPanZoom shows the d3 'wheel.zoom' listener
      // is bound on .react-flow__renderer (ZoomPane), the parent of
      // .react-flow__pane (Pane) — a bubbled, bubbles:true wheel event from
      // the pane should still reach it. Verify for real and fall back to the
      // element that owns the listener if it does not.
      const tryTarget = async (sel) => {
        const z0 = await c.evaluate(E.zoom);
        await c.evaluate(`(async () => { spikeDrive.wheel('${sel}', { deltaY: -${OLD_DY}, ctrlKey: true }); await spikeDrive.frame(); await spikeDrive.frame(); })()`);
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
          console.error(`a synthetic ctrl+wheel on ${primaryTarget} (ratio ${primaryRatio}) or ${fallback} (ratio ${ratio2}) did not zoom the spike. Check the event target.`);
          c.stop(3);
        }
        console.error(`a synthetic ctrl+wheel on ${primaryTarget} did not zoom the spike (ratio ${primaryRatio}); ${fallback} worked (ratio ${ratio2}), using it instead.`);
        target = fallback;
        ratio = ratio2;
      }
      dy = OLD_DY * TICK / Math.log(ratio);
      await fit();
    }

    // C1: calibrate the pan gesture exactly as the zoom gesture above —
    // measure one tick's real viewport-x delta on THIS engine (not an
    // assumed formula) and scale deltaX so it travels PAN_PX screen px per
    // frame. This is the fix for the old engine's pan running at 2x the
    // spike's (panOnScrollSpeed defaults to 0.5 and is not set in main.jsx —
    // deliberately not touched here, per the brief).
    const calibratePan = async () => {
      const x0 = await c.evaluate('spikeDrive.posX()');
      await c.evaluate(`(async () => { spikeDrive.wheel('${target}', { deltaX: ${PAN_PROBE_DX}, deltaY: -0.5 }); await spikeDrive.frame(); await spikeDrive.frame(); })()`);
      const x1 = await c.evaluate('spikeDrive.posX()');
      const ratio = Math.abs(x1 - x0) / PAN_PROBE_DX;
      if (!(ratio > 0.01)) {
        console.error(`a synthetic wheel pan on ${target} did not move ${name} (ratio ${ratio}). Check the event target.`);
        c.stop(3);
      }
      await fit(); // undo the probe tick's drift before the timed measurement
      return +(PAN_PX / ratio).toFixed(3);
    };
    const panDx = await calibratePan();

    const liveAtFit = await c.evaluate(LIVE_COUNT);

    // The scale after the 45 zoom-in ticks: both engines must agree.
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

    out[name] = {
      fitScale, liveAtFit, deltaY: +dy.toFixed(3), panDx, zoomedIn: +zoomedIn.toFixed(4),
      panScale, liveAtPan, zoom, pan,
      idleFpsBefore: +idleBefore.fps.toFixed(1), visibilityBefore: idleBefore.visibility,
      idleFpsAfter: +idleAfter.fps.toFixed(1), visibilityAfter: idleAfter.visibility,
    };
  }

  const pass = (g) => out.new[g].p95 <= out.old[g].p95 * 1.1 && out.new[g].max <= out.old[g].max * 1.1;
  // I7: the two engines' first fit must land on the same scale.
  const fitAgree = Math.abs(out.new.fitScale / out.old.fitScale - 1) <= 0.03;
  // The scale after the 45 zoom-in ticks: both engines must agree.
  const zoomAgree = Math.abs(out.new.zoomedIn / out.old.zoomedIn - 1) <= 0.03;
  // C1: total x travel over the first 30 (of 60) pan frames must agree.
  const panAgree = Math.abs(out.new.pan.travel30 / out.old.pan.travel30 - 1) <= 0.03;
  // C3: the pre-pan scale readback must agree.
  const panScaleAgree = Math.abs(out.new.panScale / out.old.panScale - 1) <= 0.03;
  // C2: neither engine may have run into the maxScale=4 clamp.
  const clampOk = out.old.zoomedIn < 4 * 0.99 && out.new.zoomedIn < 4 * 0.99;

  console.table({ 'old zoom': out.old.zoom, 'new zoom': out.new.zoom, 'old pan': out.old.pan, 'new pan': out.new.pan });
  console.log(`order: ${ORDER.join(',')}`);
  console.log(`live iframes at fit: old=${out.old.liveAtFit} new=${out.new.liveAtFit}`);
  console.log(`fit scale: old=${out.old.fitScale} new=${out.new.fitScale} ${fitAgree ? 'FIT PARITY OK' : 'FIT PARITY FAIL'}`);
  console.log(`scale after zoom-in: old=${out.old.zoomedIn} new=${out.new.zoomedIn} ${zoomAgree ? 'PARITY OK' : 'PARITY FAIL'}`);
  console.log(`pan x travel (first 30 frames): old=${out.old.pan.travel30} new=${out.new.pan.travel30} ${panAgree ? 'PAN PARITY OK' : 'PAN PARITY FAIL'}`);
  console.log(`pre-pan scale: old=${out.old.panScale} new=${out.new.panScale} ${panScaleAgree ? 'PAN SCALE PARITY OK' : 'PAN SCALE PARITY FAIL'}`);

  // C2: any parity failure (or a clamp hit) is fatal — no frames.json, exit 4.
  const invalid = [];
  if (!fitAgree) invalid.push(`INVALID: gesture parity — fit scale: old=${out.old.fitScale} new=${out.new.fitScale} (>3% apart)`);
  if (!zoomAgree) invalid.push(`INVALID: gesture parity — zoom scale after 45 ticks: old=${out.old.zoomedIn} new=${out.new.zoomedIn} (>3% apart)`);
  if (!panAgree) invalid.push(`INVALID: gesture parity — pan x travel (first 30 frames): old=${out.old.pan.travel30} new=${out.new.pan.travel30} (>3% apart)`);
  if (!panScaleAgree) invalid.push(`INVALID: gesture parity — pre-pan scale: old=${out.old.panScale} new=${out.new.panScale} (>3% apart)`);
  if (!clampOk) invalid.push(`INVALID: gesture parity — zoomedIn hit the maxScale clamp: old=${out.old.zoomedIn} new=${out.new.zoomedIn} (must both be < 3.96)`);
  if (invalid.length) {
    invalid.forEach((m) => console.error(m));
    c.stop(4);
  }

  out.order = ORDER;
  out.verdict = {
    fitParity: fitAgree, zoomParity: zoomAgree, panParity: panAgree, panScaleParity: panScaleAgree, clampOk,
    gestureParity: fitAgree && zoomAgree && panAgree && panScaleAgree && clampOk,
    zoom: pass('zoom'), pan: pass('pan'), throttled: ALLOW_THROTTLED,
  };
  writeFileSync(path.join(outDir, outFile), JSON.stringify(out, null, 2));
  console.log('ZOOM ' + (out.verdict.zoom ? 'PASS' : 'FAIL'));
  console.log('PAN ' + (out.verdict.pan ? 'PASS' : 'FAIL'));
  if (ALLOW_THROTTLED) console.error('WARNING: numbers are not valid — this run had SPIKE_ALLOW_THROTTLED=1 set.');
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
