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

// Put element `which` of the engine's page at zoom z. anchor 'center' puts its
// middle in the middle of the viewport; 'topleft' puts its corner at 100,100.
async function place(c, name, url, z, which, anchor) {
  const E = ENGINES[name];
  const want = (r) => (anchor === 'center'
    ? { dx: VIEW.width / 2 - (r.l + r.w / 2), dy: VIEW.height / 2 - (r.t + r.h / 2) }
    : { dx: 100 - r.l, dy: 100 - r.t });
  if (name === 'new') {
    if (!(await c.evaluate(`location.pathname + location.search === '${url}' && !!window.rf`))) { await c.open(url); await c.until(`${E.count} >= 10 && window.rf`); }
    // setViewport is applied on the next render, so wait two frames before a rect read.
    const view = (x, y) => c.evaluate(`(async () => { await rf.setViewport({ x: ${x}, y: ${y}, zoom: ${z} }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
    await view(0, 0);
    const d = want(await c.evaluate(rectOf(EL.new, which)));
    await view(d.dx, d.dy);
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
    await c.open(url, preset(0, 0)); await c.until(`${E.count} >= 10`, 60000); await sleep(500);
    const d = want(await c.evaluate(rectOf(EL.old, which)));
    await c.open(url, preset(d.dx, d.dy)); await c.until(`${E.count} >= 10`, 60000);
  }
  await sleep(3000); // the settle, the live pass, and the iframe load
  return c.evaluate(rectOf(EL[name], which));
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

// Extra probe, run only when the old engine did NOT blank in the static
// screenshots above (a finding, not a defect — see the brief). Fits the old
// tall page for real, then drives ~60 synthetic ctrl+wheel zoom-in ticks
// centred on the bottom-right screen (the same pattern spike/frames.mjs uses
// for its zoom gesture), and screenshots the result. This checks whether the
// GPU-layer blank needs a live zoom gesture rather than a static view.
async function gestureProbe(c) {
  await c.open(ENGINES.old.tall, "try { localStorage.clear(); } catch {}");
  await c.until(`${ENGINES.old.count} >= 10`, 60000);
  await sleep(500);
  if (!(await c.evaluate('!!window.dcBench'))) await c.evaluate(`fetch('/perf/bench.js').then((r) => r.text()).then((t) => { (0, eval)(t); })`);
  await c.evaluate('dcBench.fit().then(() => 1)');
  await sleep(1500);
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
  const r1 = await c.evaluate(expr);
  const b64 = await c.screenshot('tall-old-gesture.png');
  const drawn = +(await c.evaluate(DRAWN(b64, r1))).toFixed(3);
  return { drawn, rect: r1 };
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
      const r = await place(c, name, ENGINES[name].tall, z, 'last', 'center');
      const b64 = await c.screenshot(`tall-${name}-${z}.png`);
      const drawn = +(await c.evaluate(DRAWN(b64, r))).toFixed(3);
      rows.push({ engine: name, zoom: z, drawn, pass: drawn >= 0.5 });
      console.log(`${name} zoom=${z} drawn=${drawn}`);
    }
  }
  for (const name of ['old', 'new']) {
    for (const z of SHARP) {
      await place(c, name, ENGINES[name].sample, z, 'first', 'topleft');
      await c.screenshot(`sharp-${name}-${z}.png`, { x: 100, y: 100, width: 600, height: 200 });
    }
  }
  const ok = (name) => rows.filter((r) => r.engine === name).every((r) => r.pass);
  const controlReproduced = !ok('old');

  let gesture = null;
  if (!controlReproduced) {
    gesture = await gestureProbe(c);
    console.log(`gesture probe (old, 60 live zoom-in ticks on the bottom-right screen): drawn=${gesture.drawn}`);
  }

  writeFileSync(path.join(outDir, 'tall.json'), JSON.stringify({ rows, newPass: ok('new'), controlReproduced, gesture }, null, 2));
  console.log('TALL new: ' + (ok('new') ? 'PASS' : 'FAIL'));
  console.log('TALL old (control): ' + (ok('old') ? 'NOT REPRODUCED' : 'BLANK REPRODUCED'));
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
