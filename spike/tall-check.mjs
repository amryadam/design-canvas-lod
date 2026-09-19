// node spike/tall-check.mjs — is the bottom of the tall page drawn at each zoom?
// The old engine is the control: on main it must show the blank. If it does
// not, a screenshot does not see this GPU effect and only the user's check in
// claude.ai/design can answer.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const ZOOMS = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4], SHARP = [0.73, 1.37];
const EL = { old: '[data-dc-slot]', new: '.react-flow__node-window' };
const rectOf = (sel, which) => `(() => { const a = [...document.querySelectorAll('${sel}')]; const r = a[${which === 'last' ? 'a.length - 1' : 0}].getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`;
// The rect around EVERY screen (union, unclipped) — used by the in-out probe,
// where "drawn" is measured over the whole content, not one screen.
const unionRectOf = (sel) => `(() => { const a = [...document.querySelectorAll('${sel}')];
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  a.forEach((el) => { const q = el.getBoundingClientRect();
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
  return { l, t, w: r - l, h: b - t }; })()`;

// C1 (review finding): read the engine's own view back after every place it
// is set from outside (a localStorage preset for the old engine, setViewport
// for the new one) and assert it landed — scale within 0.5%, x/y within 1px.
// This polls for up to `ms` (the two engines' restore/apply is normally
// synchronous, so a match on the first read is the common case) and THROWS
// on a real mismatch instead of silently measuring against the wrong view.
// This is the check the brief asked for to explain or catch the earlier
// flaky `old zoom=0.1 drawn=-1` row (see the report's "C1" section): if the
// mismatch reproduces, this throw names the exact bad x/y/scale instead of
// a downstream "Back to content" pill and a rect too small to sample.
async function waitView(c, name, want, label, ms = 3000) {
  const read = name === 'old' ? 'window.dcView' : `(() => { const v = window.rf.getViewport(); return { x: v.x, y: v.y, scale: v.zoom }; })()`;
  let got;
  for (let t = 0; t < ms; t += 100) {
    got = await c.evaluate(read);
    if (got && Math.abs(got.scale / want.scale - 1) <= 0.005 && Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1) return got;
    await sleep(100);
  }
  throw new Error(`${label}: ${name} view ${JSON.stringify(got)} does not match set view ${JSON.stringify(want)} after ${ms}ms`);
}

// Put element `which` of the engine's page at zoom z. anchor 'center' puts its
// middle in the middle of the viewport; 'topleft' puts its corner at 100,100.
// Returns { rect, scale }: `scale` is the read-back-and-verified achieved
// scale (C1), recorded in tall.json so a clamp or a restore miss is visible
// in the data, not just inferred from a picture.
async function place(c, name, url, z, which, anchor) {
  const E = ENGINES[name];
  const want = (r) => (anchor === 'center'
    ? { dx: VIEW.width / 2 - (r.l + r.w / 2), dy: VIEW.height / 2 - (r.t + r.h / 2) }
    : { dx: 100 - r.l, dy: 100 - r.t });
  let scale;
  if (name === 'new') {
    if (!(await c.evaluate(`location.pathname + location.search === '${url}' && !!window.rf`))) { await c.open(url); await c.until(`${E.count} >= 10 && window.rf`); }
    // setViewport is applied on the next render, so wait two frames before a rect read.
    const view = (x, y) => c.evaluate(`(async () => { await rf.setViewport({ x: ${x}, y: ${y}, zoom: ${z} }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
    await view(0, 0);
    await waitView(c, name, { x: 0, y: 0, scale: z }, `place ${name} z=${z} pass1`);
    const d = want(await c.evaluate(rectOf(EL.new, which)));
    await view(d.dx, d.dy);
    ({ scale } = await waitView(c, name, { x: d.dx, y: d.dy, scale: z }, `place ${name} z=${z} pass2`));
  } else {
    // The old engine restores its view from localStorage on load, and then
    // skips its first fit. Pass 1 measures at x=0,y=0; pass 2 sets the view.
    const key = 'dc-viewport-v3:' + url;
    const preset = (x, y) => `try { localStorage.setItem(${JSON.stringify(key)}, JSON.stringify({ x: ${x}, y: ${y}, scale: ${z} })); } catch {}`;
    // Deviation from the brief: the old page compiles design-canvas.jsx and
    // canvas-page.jsx with Babel standalone, in the browser, on every load,
    // and this script reloads the old page twice per zoom step. The default
    // 30s `until` timeout in cdp.mjs was not enough for this on this machine
    // (spike/frames.mjs hit the same thing and needed 60s for the old
    // engine), so both `until` calls below pass 60000 explicitly.
    await c.open(url, preset(0, 0)); await c.until(`${E.count} >= 10`, 60000);
    await waitView(c, name, { x: 0, y: 0, scale: z }, `place ${name} z=${z} pass1`);
    const d = want(await c.evaluate(rectOf(EL.old, which)));
    await c.open(url, preset(d.dx, d.dy)); await c.until(`${E.count} >= 10`, 60000);
    ({ scale } = await waitView(c, name, { x: d.dx, y: d.dy, scale: z }, `place ${name} z=${z} pass2`));
  }
  await sleep(3000); // the settle, the live pass, and the iframe load
  const rect = await c.evaluate(rectOf(EL[name], which));
  return { rect, scale };
}

// The fraction of sampled pixels inside rect r (CSS px, clipped to the
// viewport) that are not the background colour.
// Deviation checked but NOT made: the brief's known-uncertain point (b) asks
// whether inlining the screenshot as a base64 data URL inside `evaluate` is
// too large/slow. Measured directly (scratch script, both a near-blank frame
// and a worst-case frame of real iframe content centred in view): b64 length
// ~155KB-478KB, decode 11-18ms. That is nowhere near "several MB" or slow, so
// the brief's inline approach is kept unchanged here.
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

// Controller-required validity guard (not in the original brief, reused from
// spike/frames.mjs's approach): a locked or sleeping screen throttles
// requestAnimationFrame and makes every screenshot-based measurement below
// meaningless, so this runs first, right after the first page is ready.
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

// Fit the old engine's tall page for real (dcBench.fit(), not a localStorage
// preset), starting from a cleared localStorage. Shared by the gesture probe
// and the in-out probe.
async function fitOld(c) {
  await c.open(ENGINES.old.tall, "try { localStorage.clear(); } catch {}");
  await c.until(`${ENGINES.old.count} >= 10`, 60000);
  await sleep(500);
  if (!(await c.evaluate('!!window.dcBench'))) await c.evaluate(`fetch('/perf/bench.js').then((r) => r.text()).then((t) => { (0, eval)(t); })`);
  await c.evaluate('dcBench.fit().then(() => 1)');
  await sleep(1500);
}

// Fit the new engine's tall page: the bounding box of the window nodes at a
// zoom that puts 90% of it in the pane, clamped to [minZoom, maxZoom] (both
// engines share minScale/minZoom=0.05, maxScale/maxZoom=4 — see
// design-canvas.jsx's DCViewport defaults and spike/src/main.jsx's ReactFlow
// props), the same shape as spike/frames.mjs's NEW_VIEW(null).
const NEW_FIT_EXPR = `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = Math.max(0.05, Math.min(4, Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)));
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;
async function fitNew(c) {
  if (!(await c.evaluate(`location.pathname + location.search === '${ENGINES.new.tall}' && !!window.rf`))) {
    await c.open(ENGINES.new.tall);
    await c.until(`${ENGINES.new.count} >= 10 && window.rf`);
  }
  await c.evaluate(NEW_FIT_EXPR);
  await c.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  await sleep(1500);
}

// Extra probe, run only when the old engine did NOT blank in the static
// screenshots above (a finding, not a defect — see the brief). Fits the old
// tall page for real, then drives 60 synthetic ctrl+wheel zoom-in ticks
// centred on the bottom-right screen (the same pattern spike/frames.mjs uses
// for its zoom gesture), and screenshots the result. This checks whether the
// GPU-layer blank needs a live zoom gesture rather than a static view.
// I2 (review finding): this used to never read the scale before/after the
// ticks, so a broken driver (wrong target, event not reaching the handler)
// would look identical to "not blank" in the output. Now it reads the scale
// before and after and throws unless it really grew (after/before > 5).
// NOTE (Coverage gap, see report): this probe only zooms IN and screenshots
// while still zoomed in — the documented bug (DC.maxLayerMB's comment in the
// main checkout's design-canvas.jsx) needs a zoom-in THEN a zoom-out, which
// this probe structurally cannot exercise. inoutProbe() below is the one
// that actually drives that sequence; this one is kept only because
// controlReproduced's definition still names it as a separate signal.
async function gestureProbe(c) {
  await fitOld(c);
  const scaleBefore = +(await c.evaluate(ENGINES.old.zoom)).toFixed(4);
  const expr = rectOf(EL.old, 'last');
  const r0 = await c.evaluate(expr);
  const cx = Math.max(0, Math.min(VIEW.width, r0.l + r0.w / 2));
  const cy = Math.max(0, Math.min(VIEW.height, r0.t + r0.h / 2));
  await c.evaluate(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const el = document.querySelector('${ENGINES.old.target}');
    for (let i = 0; i < 60; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaMode: 0, deltaY: -6, clientX: ${cx}, clientY: ${cy}, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame();
    }
  })()`);
  await sleep(1500);
  const scaleAfter = +(await c.evaluate(ENGINES.old.zoom)).toFixed(4);
  if (!(scaleAfter / scaleBefore > 5)) throw new Error(`gesture probe: scale did not really increase (before=${scaleBefore} after=${scaleAfter})`);
  const r1 = await c.evaluate(expr);
  const b64 = await c.screenshot('tall-old-gesture.png');
  const drawn = +(await c.evaluate(DRAWN(b64, r1))).toFixed(3);
  return { drawn, rect: r1, scaleBefore, scaleAfter };
}

// One synthetic ctrl+wheel tick per rAF on `sel`, centred at (cx,cy), until
// `zoomExpr` crosses `target` in the tick's own direction, or `maxN` ticks
// have run (target === null runs exactly maxN ticks with no early stop — the
// zoom-out leg, which the brief requires to use "the same number of ticks"
// as the zoom-in leg, not a scale-based stop). Runs entirely in-page (the
// spike/frames.mjs pattern) so per-tick timing is not polluted by the
// Node<->Chrome round trip. Returns { n, scale, times }.
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

// The old engine's own per-tick log-zoom-factor for a ctrl+wheel deltaY of
// -OLD_DY (design-canvas.jsx's zoomAt: factor = exp(-deltaY*0.01), so
// ln(factor) = deltaY*0.01 = OLD_DY*0.01 = TICK for OLD_DY=6). Mirrors
// spike/frames.mjs's constants of the same name so the two engines' zoom
// gestures are comparable tick-for-tick.
const OLD_DY = 6, TICK = 0.06;
const ZOOM_EXPR = { old: 'window.dcView.scale', new: 'window.rf.getZoom()' };

// Coverage-gap probe (review finding): calibrate the new engine's per-tick
// deltaY to the old engine's, the same way spike/frames.mjs does — one probe
// tick of deltaY=-OLD_DY on the primary target (.react-flow__pane), and if
// that does not zoom the spike, fall back to .react-flow__renderer (the
// element XYPanZoom's wheel.zoom listener is actually bound to).
async function calibrateNewDy(c) {
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
    await fitNew(c); // undo the probe tick's drift before trying the fallback
    target = '.react-flow__renderer';
    ratio = await tryTarget(target);
    if (!(ratio > 1.01)) throw new Error(`inout probe: a synthetic ctrl+wheel on ${primaryTarget} (ratio ${primaryRatio}) or ${target} (ratio ${ratio}) did not zoom the new engine`);
  }
  const dy = OLD_DY * TICK / Math.log(ratio);
  await fitNew(c); // undo this probe tick's drift before the real measurement
  return { target, dy };
}

const INOUT_TARGET_SCALE = 3.5, INOUT_MAX_TICKS = 120;

// Coverage gap (review finding): zoom in, then zoom out, for one engine. The
// old engine's own comment in the main checkout's design-canvas.jsx
// (DC.maxLayerMB) names exactly this sequence as the trigger of the raster-
// memory problem: on its GPU layer the world keeps the raster scale it had
// when zoomed in, so a zoom-in then a zoom-out draws the whole world at the
// zoomed-in resolution and the GPU drops frames. gestureProbe() above only
// zooms in and screenshots while still zoomed in, so it cannot see this;
// this probe drives the documented trigger for real, on both engines.
async function inoutProbe(c, name) {
  const zoomExpr = ZOOM_EXPR[name];
  let target, dy;
  if (name === 'old') { await fitOld(c); target = ENGINES.old.target; dy = OLD_DY; }
  else { await fitNew(c); ({ target, dy } = await calibrateNewDy(c)); }

  const cx = VIEW.width / 2, cy = VIEW.height / 2;
  const shot = async (tag) => {
    const rect = await c.evaluate(unionRectOf(EL[name]));
    const b64 = await c.screenshot(`tall-${name}-inout-${tag}.png`);
    const drawn = +(await c.evaluate(DRAWN(b64, rect))).toFixed(3);
    return { rect, drawn };
  };

  const base = await shot('base');

  // Zoom in, one ctrl+wheel tick per frame, until scale >= 3.5 (cap 120).
  const zin = await c.evaluate(TICKS(target, zoomExpr, -dy, INOUT_MAX_TICKS, INOUT_TARGET_SCALE, cx, cy));
  const inShot = await shot('in');

  // Zoom out with the SAME number of ticks (not a scale-based stop), split
  // around the half-way tick so a screenshot can be taken there too.
  const nOut = zin.n, half1 = Math.floor(nOut / 2), half2 = nOut - half1;
  const batch1 = await c.evaluate(TICKS(target, zoomExpr, dy, half1, null, cx, cy));
  const midShot = await shot('mid');
  const batch2 = await c.evaluate(TICKS(target, zoomExpr, dy, half2, null, cx, cy));
  await sleep(1000);
  const outShot = await shot('out');

  // Frame times through the whole zoom-out leg: the same in-page rAF method
  // spike/frames.mjs uses (times.slice(2) drops per-batch startup jitter),
  // concatenated across the two batches since the mid screenshot splits the
  // gesture into two Node<->Chrome round trips.
  const times = [...batch1.times.slice(2), ...batch2.times.slice(2)].sort((a, b) => a - b);
  const q = (p) => (times.length ? +times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2) : 0);
  const p50 = q(0.5), p95 = q(0.95), max = times.length ? +times[times.length - 1].toFixed(2) : 0;
  const dropped = times.filter((t) => t > 1.5 * p50).length;

  const outVsBase = base.drawn > 0 ? +(outShot.drawn / base.drawn).toFixed(3) : -1;
  const blank = outVsBase < 0.8 || midShot.drawn < 0.5 * base.drawn;

  const result = {
    target, dy: +dy.toFixed(4),
    base: { drawn: base.drawn },
    in: { n: zin.n, scale: +zin.scale.toFixed(4), drawn: inShot.drawn },
    mid: { drawn: midShot.drawn },
    out: { n: half1 + half2, scale: +batch2.scale.toFixed(4), drawn: outShot.drawn },
    outVsBase, blank,
    frames: { p50, p95, max, dropped, count: times.length },
  };
  console.log(`inout ${name}: base=${result.base.drawn} in(n=${result.in.n},scale=${result.in.scale})=${result.in.drawn} mid=${result.mid.drawn} out(n=${result.out.n},scale=${result.out.scale})=${result.out.drawn} outVsBase=${outVsBase} zoomOutFrames p50=${p50} p95=${p95} max=${max} dropped=${dropped}`);
  return result;
}

const c = await launch();
const rows = [];
try {
  // Validity guard: measure on the first page this script will actually use.
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

  for (const name of ['old', 'new']) {
    for (const z of ZOOMS) {
      const { rect: r, scale } = await place(c, name, ENGINES[name].tall, z, 'last', 'center');
      const b64 = await c.screenshot(`tall-${name}-${z}.png`);
      const drawn = +(await c.evaluate(DRAWN(b64, r))).toFixed(3);
      rows.push({ engine: name, zoom: z, drawn, pass: drawn >= 0.5, scale });
      console.log(`${name} zoom=${z} drawn=${drawn} scale=${scale}`);
    }
  }
  for (const name of ['old', 'new']) {
    for (const z of SHARP) {
      await place(c, name, ENGINES[name].sample, z, 'first', 'topleft');
      await c.screenshot(`sharp-${name}-${z}.png`, { x: 100, y: 100, width: 600, height: 200 });
    }
  }
  const ok = (name) => rows.filter((r) => r.engine === name).every((r) => r.pass);
  const staticOldFail = !ok('old');

  let gesture = null;
  if (!staticOldFail) {
    gesture = await gestureProbe(c);
    console.log(`gesture probe (old, 60 live zoom-in ticks on the bottom-right screen): drawn=${gesture.drawn} scaleBefore=${gesture.scaleBefore} scaleAfter=${gesture.scaleAfter}`);
  }
  const gestureBlank = gesture ? gesture.drawn < 0.5 : false;

  // Coverage gap: the in-out probe runs for BOTH engines unconditionally —
  // it is a distinct check from the static rows and the one-directional
  // gesture probe above, not a fallback that only fires when those pass.
  const inout = { old: await inoutProbe(c, 'old'), new: await inoutProbe(c, 'new') };
  console.log('INOUT old: ' + (inout.old.blank ? 'BLANK' : 'OK'));
  console.log('INOUT new: ' + (inout.new.blank ? 'BLANK' : 'OK'));

  const controlReproduced = staticOldFail || gestureBlank || inout.old.blank;

  writeFileSync(path.join(outDir, 'tall.json'), JSON.stringify({ rows, newPass: ok('new'), controlReproduced, gesture, inout }, null, 2));
  console.log('TALL new: ' + (ok('new') ? 'PASS' : 'FAIL'));
  console.log('TALL old (control): ' + (ok('old') ? 'NOT REPRODUCED' : 'BLANK REPRODUCED'));
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
