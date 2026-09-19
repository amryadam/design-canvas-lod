// node spike/frames.mjs — the same zoom and pan gestures on both engines.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, outDir } from './cdp.mjs';

const RUNS = 3, OLD_DY = 6, TICK = 0.06; // the old engine zooms by exp(deltaY * 0.01) for each tick
const MIN_IDLE_FPS = 50;
// Controller-required escape hatch: this machine's screen may be locked or
// asleep, which throttles requestAnimationFrame and makes every number
// meaningless. Set to prove the rest of the script is correct even when the
// validity guard below would otherwise refuse to run. Numbers from a run
// with this set are NOT valid results.
const ALLOW_THROTTLED = process.env.SPIKE_ALLOW_THROTTLED === '1';

// Injected into each page. One wheel event for each animation frame.
const DRIVER = `(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const wheel = (sel, o) => document.querySelector(sel).dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, ...o }));
  const stats = async (fn) => {
    const times = []; let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await fn(); stop = true;
    const s = times.slice(2).sort((a, b) => a - b), q = (p) => +s[Math.floor(s.length * p)].toFixed(2);
    return { frames: s.length, p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(2), over16: s.filter((f) => f > 16.7).length };
  };
  window.spikeDrive = {
    frame, wheel,
    zoomIn: async (sel, dy, n) => { for (let i = 0; i < n; i++) { wheel(sel, { deltaY: -dy, ctrlKey: true }); await frame(); } },
    zoom: (sel, dy, n = 90) => stats(async () => {
      for (let i = 0; i < n; i++) { wheel(sel, { deltaY: i < n / 2 ? -dy : dy, ctrlKey: true }); await frame(); } }),
    // The fractional deltaY keeps the old engine on its pan branch.
    pan: (sel, n = 60) => stats(async () => {
      for (let i = 0; i < n; i++) { wheel(sel, { deltaX: i < n / 2 ? 40 : -40, deltaY: i % 2 ? 0.5 : -0.5 }); await frame(); } }),
  };
})()`;

// The idle rAF rate over 1s, plus document.visibilityState. Controller ruling
// (not in the original brief): a locked or sleeping screen throttles
// requestAnimationFrame and makes every number below meaningless, so this
// runs first, on every engine, right after the page is ready.
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

// Put the window nodes in the middle of the pane at zoom z (or at the zoom
// that fits them in 90% of the pane when z is null).
const NEW_VIEW = (z) => `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = ${z === null ? 'Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)' : z};
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;

const median = (rows, k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const fold = (rows) => Object.fromEntries(['p50', 'p95', 'max', 'over16', 'busyMs'].map((k) => [k, median(rows, k)]));

const c = await launch();
const out = {};
try {
  for (const name of ['old', 'new']) {
    const E = ENGINES[name];
    await c.open(E.sample, 'try { localStorage.clear(); } catch {}');
    // Deviation from the brief: the old page compiles design-canvas.jsx and
    // canvas-page.jsx with Babel standalone, in the browser, after load. The
    // default 30s `until` timeout was not enough on this machine; give the
    // old engine 60s and keep the new engine (a prebuilt bundle) at 30s.
    await c.until(`${E.count} >= 10`, name === 'old' ? 60000 : 30000);
    await sleep(4000);

    // Validity guard. Print the measurement either way so a throttled run's
    // evidence is visible even when it is allowed to continue.
    const idle = await c.evaluate(IDLE_PROBE);
    console.log(`idle rAF for ${name}: fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
    if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
      if (!ALLOW_THROTTLED) {
        console.error(`INVALID: screen not visible or rAF throttled (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility})`);
        c.stop(4);
      }
      console.error(`WARNING: numbers are not valid (fps=${idle.fps.toFixed(1)}, visibility=${idle.visibility}) — SPIKE_ALLOW_THROTTLED=1 is set, continuing anyway`);
    }

    await c.evaluate(DRIVER);
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
    };

    await fit();
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
    const liveAtFit = await c.evaluate(`document.querySelectorAll('iframe').length`);

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
    await zoomOne();
    const pan = await measure(`pan('${target}')`);
    out[name] = {
      liveAtFit, deltaY: +dy.toFixed(3), zoomedIn: +zoomedIn.toFixed(4), zoom, pan,
      idleFps: +idle.fps.toFixed(1), visibility: idle.visibility,
    };
  }

  const agree = Math.abs(out.new.zoomedIn / out.old.zoomedIn - 1) <= 0.03;
  const pass = (g) => out.new[g].p95 <= out.old[g].p95 * 1.1 && out.new[g].max <= out.old[g].max * 1.1;
  out.verdict = { gestureParity: agree, zoom: pass('zoom'), pan: pass('pan'), throttled: ALLOW_THROTTLED };
  writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(out, null, 2));
  console.table({ 'old zoom': out.old.zoom, 'new zoom': out.new.zoom, 'old pan': out.old.pan, 'new pan': out.new.pan });
  console.log(`live iframes at fit: old=${out.old.liveAtFit} new=${out.new.liveAtFit}`);
  console.log(`scale after zoom-in: old=${out.old.zoomedIn} new=${out.new.zoomedIn} ${agree ? 'PARITY OK' : 'PARITY FAIL'}`);
  console.log('ZOOM ' + (out.verdict.zoom ? 'PASS' : 'FAIL'));
  console.log('PAN ' + (out.verdict.pan ? 'PASS' : 'FAIL'));
  if (ALLOW_THROTTLED) console.error('WARNING: numbers are not valid — this run had SPIKE_ALLOW_THROTTLED=1 set.');
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
