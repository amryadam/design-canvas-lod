// tests/look.mjs — side-by-side screenshots of the old and the new sample
// for the look review (phase 1 plan, Task 13). Headful Chrome, GPU on.
// Writes tests/out/look/*.png and tests/out/look/index.html. Task 14 deletes
// it with the old canvas.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const dir = path.join(outDir, 'look');
mkdirSync(dir, { recursive: true });
const ID = 'ZatcaCode.dc.html';
const SEL = { old: `[data-dc-slot="${ID}"]`, new: `.react-flow__node[data-id="${ID}"]` };
const rectOf = (sel) => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`;
// null: the engine's own first view. Else a zoom, with ZatcaCode centred or
// with its top-left corner at (40, 40).
const VIEWS = [['fit', null], ['z025', { zoom: 0.25, anchor: 'center' }], ['z1', { zoom: 1, anchor: 'topleft' }]];
const shift = (r, anchor) => (anchor === 'center'
  ? { dx: VIEW.width / 2 - (r.l + r.w / 2), dy: VIEW.height / 2 - (r.t + r.h / 2) }
  : { dx: 40 - r.l, dy: 40 - r.t });
const CLEAR = 'try { localStorage.clear(); } catch {}';

async function show(c, name, view) {
  const E = ENGINES[name];
  if (name === 'new') {
    await c.open(E.sample, CLEAR);
    await c.until(`${E.count} >= 10 && window.dcCanvas && dcCanvas.api && dcCanvas.api.fitted`, 60000);
    if (view) {
      const set = (x, y) => c.evaluate(`(async () => { dcCanvas.api.rf.setViewport({ x: ${x}, y: ${y}, zoom: ${view.zoom} }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
      await set(0, 0);
      const d = shift(await c.evaluate(rectOf(SEL.new)), view.anchor);
      await set(d.dx, d.dy);
    }
  } else if (!view) {
    await c.open(E.sample, CLEAR);
    await c.until(`${E.count} >= 10`, 60000);
  } else {
    // The old engine restores its view from localStorage on load and then
    // skips its first fit: pass 1 measures at x = y = 0, pass 2 sets the view.
    const key = 'dc-viewport-v3:' + E.sample;
    const preset = (x, y) => `${CLEAR} localStorage.setItem(${JSON.stringify(key)}, JSON.stringify({ x: ${x}, y: ${y}, scale: ${view.zoom} }));`;
    await c.open(E.sample, preset(0, 0));
    await c.until(`${E.count} >= 10`, 60000);
    await sleep(800);
    const d = shift(await c.evaluate(rectOf(SEL.old)), view.anchor);
    await c.open(E.sample, preset(d.dx, d.dy));
    await c.until(`${E.count} >= 10`, 60000);
  }
  await sleep(3500);   // the settle, the live pass and the iframe loads
}

const c = await launch();
try {
  for (const [tag, view] of VIEWS) {
    for (const name of ['old', 'new']) {
      await show(c, name, view);
      await c.screenshot(path.join('look', `${name}-${tag}.png`));
    }
  }
  writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Look review</title>
<style>body{font:14px system-ui,sans-serif;margin:16px}table{width:100%;border-collapse:collapse}td{width:50%;padding:6px;vertical-align:top}img{width:100%;border:1px solid #ccc}</style>
<h1>Old canvas (left), React Flow canvas (right)</h1>
<table>${VIEWS.map(([t]) => `<tr><th colspan="2">${t}</th></tr><tr><td><img src="old-${t}.png"></td><td><img src="new-${t}.png"></td></tr>`).join('')}</table>`);
  console.log('LOOK written: ' + path.join(dir, 'index.html'));
  c.stop(0);
} catch (e) { console.error(e); c.stop(2); }
