// node spike/sticky-check.mjs — local proof for the sticky=1 hypothesis: a
// human zoom is several pinch strokes with pauses > 150ms; after each pause
// the DEFAULT (non-sticky) budget pass runs, and because the zoom is
// anchored at the pointer, the view middle moves — with more than 8 windows
// visible the "8 nearest the middle" set changes, swapping out live windows
// that are still on screen (they flip to their placeholder mid-gesture).
// sticky=1's pickLiveSticky never drops an on-screen live window, so the
// same gesture should show zero such swaps.
//
// On the TALL page, from the fit, drives a HUMAN-LIKE zoom: 6 strokes of 12
// ctrl+wheel ticks each (one tick per frame), each stroke anchored at a
// different point of the viewport (cycling the 4 quadrant centres and the
// middle), with a 400ms pause after each stroke; then 6 zoom-out strokes the
// same way. Reads the debug=1 overlay's log (via window.__spikeDebug, the
// same "expose it on window" pattern this spike already uses for
// window.rf/spikeTall/spikeDrive) after every pause, and separately checks
// the DOM directly for windows that were live AND on screen right before a
// stroke and show their placeholder right after the following pause.
//
// Reuses cdp.mjs as-is (launch/open/until/evaluate/screenshot/stop). The
// content-bbox settle loop and the calibrated ctrl+wheel probe below are
// copied from spike/frames.mjs and spike/wc-check.mjs (near-verbatim, same
// approach wc-check.mjs itself used for the pieces it needed from
// frames.mjs) — neither file has exports (everything in them runs at module
// load), so importing is not an option, and this script does not edit them
// or spike/tall-check.mjs/spike/ablate.mjs.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const STROKE_TICKS = 12, STROKES = 6, PAUSE_MS = 400;
// Same calibration constants spike/frames.mjs and spike/wc-check.mjs use to
// turn a one-tick probe ratio into a per-tick deltaY for the new engine.
const OLD_DY = 6, TICK = 0.06;

// Cycles through the 4 quadrant centres and the middle of the 1280x800
// viewport, one per stroke (wraps after the 5th).
const ANCHORS = [
  { x: Math.round(VIEW.width * 0.25), y: Math.round(VIEW.height * 0.25) }, // top-left
  { x: Math.round(VIEW.width * 0.75), y: Math.round(VIEW.height * 0.25) }, // top-right
  { x: Math.round(VIEW.width * 0.25), y: Math.round(VIEW.height * 0.75) }, // bottom-left
  { x: Math.round(VIEW.width * 0.75), y: Math.round(VIEW.height * 0.75) }, // bottom-right
  { x: Math.round(VIEW.width / 2), y: Math.round(VIEW.height / 2) },       // middle
];

// One wheel event per animation frame, injected once per page load.
const DRIVER = `(() => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  window.stickyDrive = {
    stroke: async (sel, deltaY, n, cx, cy) => {
      const el = document.querySelector(sel);
      for (let i = 0; i < n; i++) {
        el.dispatchEvent(new WheelEvent('wheel', { deltaMode: 0, deltaY, clientX: cx, clientY: cy, ctrlKey: true, bubbles: true, cancelable: true }));
        await frame();
      }
    },
  };
})()`;

// ---- copied from spike/frames.mjs (content-bbox readiness wait) ----
const CONTENT_BBOX_NEW = `(() => { const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  return { l: Math.round(b.x), t: Math.round(b.y), r: Math.round(b.x + b.width), b: Math.round(b.y + b.height) }; })()`;
const LIVE_COUNT = `document.querySelectorAll('iframe').length`;
async function waitSettled(c) {
  const t0 = Date.now();
  let reads = [];
  while (true) {
    const bbox = await c.evaluate(CONTENT_BBOX_NEW);
    const live = await c.evaluate(LIVE_COUNT);
    reads.push(JSON.stringify({ bbox, live }));
    if (reads.length > 3) reads.shift();
    if (reads.length === 3 && reads[0] === reads[1] && reads[1] === reads[2]) return;
    if (Date.now() - t0 > 30000) throw new Error(`content did not settle within 30000ms (last reads: ${reads.join(' | ')})`);
    await sleep(500);
  }
}
// ---- end copied from frames.mjs ----

// ---- copied from spike/frames.mjs (fit view) / spike/wc-check.mjs (calibrated dy) ----
const NEW_VIEW_FIT = `(() => {
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height);
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;
async function calibrateDy(c) {
  const cx = VIEW.width / 2, cy = VIEW.height / 2;
  const tryTarget = async (sel) => {
    const z0 = await c.evaluate('window.rf.getZoom()');
    await c.evaluate(`(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      document.querySelector('${sel}').dispatchEvent(new WheelEvent('wheel', {
        deltaMode: 0, deltaY: ${-OLD_DY}, clientX: ${cx}, clientY: ${cy}, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame(); await frame();
    })()`);
    return (await c.evaluate('window.rf.getZoom()')) / z0;
  };
  let target = ENGINES.new.target;
  let ratio = await tryTarget(target);
  if (!(ratio > 1.01)) {
    await c.evaluate(NEW_VIEW_FIT); await sleep(300);
    const fallback = '.react-flow__renderer';
    const ratio2 = await tryTarget(fallback);
    if (!(ratio2 > 1.01)) throw new Error(`sticky-check: a synthetic ctrl+wheel on ${target} (ratio ${ratio}) or ${fallback} (ratio ${ratio2}) did not zoom the spike`);
    target = fallback; ratio = ratio2;
  }
  const dy = OLD_DY * TICK / Math.log(ratio);
  await c.evaluate(NEW_VIEW_FIT); await sleep(300);
  return { target, dy };
}
// ---- end copied from wc-check.mjs ----

// Every window node's own DOM state: `live` mirrors budget.js's isLive(id)
// (the `.sp-dot.on` class WindowNode sets), `onScreen` is a plain screen-px
// rect test against the 1280x800 viewport (CSS px — DPR only affects the
// screenshot's pixel density, not layout).
const LIVE_ONSCREEN = `[...document.querySelectorAll('.react-flow__node-window')].map((el) => {
  const r = el.getBoundingClientRect();
  const win = el.querySelector('.sp-win');
  return {
    id: el.getAttribute('data-id'),
    live: !!win && !!win.querySelector('.sp-dot.on'),
    onScreen: r.left < ${VIEW.width} && r.right > 0 && r.top < ${VIEW.height} && r.bottom > 0,
  };
})`;

const lineOf = (e) => e.type === 'pass'
  ? `t=${e.t} zoom=${e.zoom.toFixed(3)} +${e.added} -${e.dropped} droppedVisible=${e.droppedVisible}`
  : `${e.kind} t=${e.t}`;

async function run(c, variant, url) {
  console.log(`\n${'='.repeat(90)}\n${variant}: ${url}`);
  await c.open(url, "try { localStorage.clear(); } catch {}");
  await c.until(`${ENGINES.new.count} >= 10 && window.rf`, 30000);
  await waitSettled(c);
  await c.evaluate(NEW_VIEW_FIT);
  await sleep(300);
  await waitSettled(c);
  await c.evaluate(DRIVER);
  const { target, dy } = await calibrateDy(c);

  // Let the debug overlay's own first pass (150ms non-sticky / 600ms sticky
  // after onInit's kick(), plus whatever the fit calls above re-triggered)
  // settle before the stroke sequence starts, so every pass logged from here
  // on belongs to a stroke, not to page load / calibration.
  await sleep(2000);

  const zoomAtStart = await c.evaluate('window.rf.getZoom()');
  console.log(`${variant}: fit zoom=${zoomAtStart.toFixed(4)} target=${target} dy=${dy.toFixed(4)}`);

  let transitions = 0;
  const rows = [];
  const doStroke = async (n, deltaY, label) => {
    const anchor = ANCHORS[(n - 1) % ANCHORS.length];
    const before = await c.evaluate(LIVE_ONSCREEN);
    const beforeIds = before.filter((w) => w.live && w.onScreen).map((w) => w.id);
    await c.evaluate(`window.stickyDrive.stroke('${target}', ${deltaY}, ${STROKE_TICKS}, ${anchor.x}, ${anchor.y}).then(() => 1)`);
    await sleep(PAUSE_MS);
    const after = await c.evaluate(LIVE_ONSCREEN);
    const afterLiveIds = new Set(after.filter((w) => w.live).map((w) => w.id));
    const becamePlaceholder = beforeIds.filter((id) => !afterLiveIds.has(id)).length;
    transitions += becamePlaceholder;

    const zoomNow = await c.evaluate('window.rf.getZoom()');
    const dbg = await c.evaluate(`window.__spikeDebug ? {
      passCount: window.__spikeDebug.passCount, liveCount: window.__spikeDebug.liveCount,
      visibleCount: window.__spikeDebug.visibleCount, log: window.__spikeDebug.log.slice(-8)
    } : null`);
    console.log(`${variant} ${label} n=${n} anchor=(${anchor.x},${anchor.y}) zoom=${zoomNow.toFixed(4)} liveOnScreenBefore=${beforeIds.length} becamePlaceholder=${becamePlaceholder}`);
    if (dbg) console.log(`  debug: passes=${dbg.passCount} live=${dbg.liveCount} visible=${dbg.visibleCount}\n  ` + dbg.log.map(lineOf).join('\n  '));
    rows.push({ label, n, anchor, zoom: zoomNow, liveOnScreenBefore: beforeIds.length, becamePlaceholder, debug: dbg });

    if (label === 'in' && n === 3) await c.screenshot(`sticky-${variant}-3.png`);
  };

  for (let n = 1; n <= STROKES; n++) await doStroke(n, -dy, 'in');
  for (let n = 1; n <= STROKES; n++) await doStroke(n, dy, 'out');

  const finalDebug = await c.evaluate('window.__spikeDebug ? JSON.parse(JSON.stringify(window.__spikeDebug)) : null');
  const passLog = finalDebug ? finalDebug.log.filter((e) => e.type === 'pass') : [];
  const totalPasses = finalDebug ? finalDebug.passCount : null;
  const totalDroppedVisible = passLog.reduce((a, e) => a + e.droppedVisible, 0);

  console.log(`\n${variant} TOTALS: passes=${totalPasses} droppedVisible=${totalDroppedVisible} liveOnScreen->placeholder=${transitions}`);
  console.log(`${variant} full debug log (${finalDebug ? finalDebug.log.length : 0} entries):`);
  if (finalDebug) console.log(finalDebug.log.map(lineOf).join('\n'));

  return { variant, url, target, dy, zoomAtStart, rows, totalPasses, totalDroppedVisible, transitions, fullLog: finalDebug ? finalDebug.log : [] };
}

const c = await launch();
try {
  const variants = [
    { key: 'nonsticky', url: `${ENGINES.new.tall}&livewc=1&debug=1` },
    { key: 'sticky', url: `${ENGINES.new.tall}&livewc=1&debug=1&sticky=1` },
  ];
  const results = [];
  for (const v of variants) results.push(await run(c, v.key, v.url));

  writeFileSync(path.join(outDir, 'sticky-check.json'), JSON.stringify(results, null, 2));

  console.log(`\n${'='.repeat(90)}\nSUMMARY`);
  results.forEach((r) => {
    console.log(`${r.variant}: passes=${r.totalPasses} droppedVisible=${r.totalDroppedVisible} liveOnScreen->placeholder=${r.transitions}`);
  });

  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
