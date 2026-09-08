// Serve the repository with python3 -m http.server, then open tests/regressions.html.
// Real React/DOM/rasterization; fetch is controlled to reproduce loading races.
const E = React.createElement;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function until(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await wait(20); }
  throw new Error('Timed out waiting for DOM/state');
}
const originalFetch = window.fetch.bind(window);
const results = [];
let root, api;
const host = document.getElementById('fixture');
const key = (file) => 'dc-state:' + location.pathname + ':' + file;
const envelope = (title, updatedAt) => ({ sections: { review: { title } }, ...(updatedAt === undefined ? {} : { updatedAt }) });
const json = (data) => new Response(JSON.stringify(data));
function Probe() { api = React.useContext(DCCtx); return E('div', { id: 'ready-probe' }); }
function draw(file, children = E(Probe), props) { root.render(E(DesignCanvas, { stateFile: file, ...props }, children)); }
async function test(name, fn) {
  root = ReactDOM.createRoot(host); api = null;
  localStorage.removeItem('dc-viewport-v3:' + location.pathname);
  try { await fn(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); }
  finally {
    root.unmount(); window.fetch = originalFetch;
    Object.keys(localStorage).filter((k) => k.startsWith('dc-state:' + location.pathname + ':review-')).forEach((k) => localStorage.removeItem(k));
    host.replaceChildren();
  }
  document.getElementById('results').textContent = JSON.stringify(results, null, 2);
}
window.canvasTestsDone = (async () => {
  await test('newer browser revision beats stale file', async () => {
    localStorage.setItem(key('review-save.json'), JSON.stringify(envelope('browser', 20)));
    window.fetch = async () => json(envelope('file', 10));
    draw('review-save.json'); await until(() => api);
    check(api.section('review').title === 'browser', 'stale file replaced browser edits');
  });
  await test('legacy browser edits survive a read-only legacy file', async () => {
    localStorage.setItem(key('review-legacy.json'), JSON.stringify(envelope('browser')));
    window.fetch = async () => json(envelope('file'));
    draw('review-legacy.json'); await until(() => api);
    check(api.section('review').title === 'browser', 'legacy browser edits lost');
  });
  await test('newer file revision beats browser copy', async () => {
    localStorage.setItem(key('review-new.json'), JSON.stringify(envelope('browser', 10)));
    window.fetch = async () => json(envelope('file', 20));
    draw('review-new.json'); await until(() => api);
    check(api.section('review').title === 'file', 'new file ignored');
  });
  await test('editing waits for restoration', async () => {
    let release; window.fetch = () => new Promise((resolve) => { release = () => resolve(json(envelope('loaded', 20))); });
    draw('review-delay.json'); await until(() => release); await wait(250);
    const exposed = !!host.querySelector('#ready-probe');
    release(); await until(() => api && api.section('review').title === 'loaded');
    check(!exposed, 'canvas became editable before restoration finished');
    api.patchSection('review', { title: 'edited' }); await wait(50);
    check(api.section('review').title === 'edited', 'edit overwritten');
  });
  await test('switch state file without leaking sections', async () => {
    const calls = []; window.fetch = async (url) => { calls.push(url); return json(envelope(String(url).includes('-a.') ? 'A' : 'B', 20)); };
    draw('review-switch-a.json'); await until(() => api); await wait(30);
    draw('review-switch-b.json'); await wait(250);
    check(calls.some((url) => String(url).includes('-b.')), 'B was never fetched');
    check(api.section('review').title === 'B', 'A state leaked into B');
    api.patchSection('review', { title: 'edited B' }); await wait(DC.saveDebounceMs + 50);
    check(JSON.parse(localStorage.getItem(key('review-switch-b.json'))).sections.review.title === 'edited B', 'B edit not saved');
  });
  await test('navigation before debounce retains browser edits', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-navigation.json'); await until(() => api);
    api.patchSection('review', { title: 'last edit' }); await wait(30);
    root.unmount(); root = ReactDOM.createRoot(host);
    const saved = JSON.parse(localStorage.getItem(key('review-navigation.json')));
    check(saved?.sections.review.title === 'last edit', 'last edit lost on navigation');
    check(Number.isFinite(saved.updatedAt), 'saved revision missing');
  });
  await test('fit wide content after delayed restoration', async () => {
    window.fetch = async () => { await wait(350); return new Response('', { status: 404 }); };
    draw('review-fit.json', E(DCSection, { id: 'review', title: 'Wide' }, E(DCArtboard, { id: 'wide', width: 10000, height: 500 })));
    await until(() => host.querySelector('[data-dc-row]')); await wait(200);
    const world = host.querySelector('[data-dc-world]');
    const scale = new DOMMatrix(getComputedStyle(world).transform).a;
    check(scale < 0.5, 'wide row remained at scale ' + scale);
  });
  async function flowFixture() {
    window.fetch = async () => new Response('', { status: 404 });
    const flow = { from: 'A', to: 'B', fs: 'r', ts: 'l', label: 'AAAA' };
    const render = (flows) => draw('review-flows.json', [
      E(DCSection, { key: 's', id: 'review', positions: { A: { x: 0, y: 0 }, B: { x: 600, y: 0 } } },
        E(DCArtboard, { id: 'A', width: 200, height: 200 }), E(DCArtboard, { id: 'B', width: 200, height: 200 })),
      E(CanvasFlows, { key: 'f', flows }),
    ]);
    render([flow]); await until(() => host.querySelector('.dc-flows')); await wait(300);
    return { flow, render };
  }
  await test('connector label and dashed style refresh', async () => {
    const { flow, render } = await flowFixture(); render([{ ...flow, label: 'BBBB', dashed: true }]); await wait(350);
    const layer = host.querySelector('.dc-flows');
    check(layer.textContent === 'BBBB', 'old label retained');
    check(layer.querySelector('path').style.strokeDasharray !== '', 'dash style not updated');
  });
  await test('removing all flows clears connector layer', async () => {
    const { render } = await flowFixture(); render([]); await wait(350);
    check(!host.querySelector('.dc-flows'), 'removed arrows remain visible');
  });
  await test('Google Fonts preserves Arabic and final Latin face', async () => {
    const css = '/* arabic */\n@font-face {font-family:Review;src:url(https://example.test/ar.woff2);unicode-range:U+0600-06FF;}\n/* latin */\n@font-face {font-family:Review;src:url(https://example.test/en.woff2);unicode-range:U+0000-00FF;}';
    const calls = []; window.fetch = async (url) => { calls.push(String(url)); return new Response(String(url).includes('.woff2') ? 'font' : css); };
    const out = await dcFontCss('https://fonts.googleapis.com/review-' + Date.now());
    check(calls.includes('https://example.test/ar.woff2') && calls.includes('https://example.test/en.woff2'), 'font subset dropped');
    check((out.match(/@font-face/g) || []).length === 2, 'font face lost');
  });
  await test('CSS backgrounds and imported stylesheet assets rasterize', async () => {
    const c = document.createElement('canvas'); c.width = c.height = 10;
    const ctx = c.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 10, 10); const red = c.toDataURL();
    const calls = [];
    window.fetch = async (url) => {
      const u = new URL(url, location.href); calls.push(u.pathname);
      if (u.pathname === '/styles/main.css') return new Response('@import "nested/background.css";');
      if (u.pathname === '/styles/nested/background.css') return new Response('body{margin:0;width:100px;height:100px;background-image:url(../red.png)}');
      if (u.pathname === '/styles/red.png') return originalFetch(red);
      return new Response('', { status: 404 });
    };
    const html = '<html><head><link rel="stylesheet" href="/styles/main.css"></head><body></body></html>';
    // Download PNG's own wrapper, at its own 2x scale, so this check fails if
    // the export path changes under it.
    const xhtml = await dcInlineDoc(html, location.href);
    const image = new Image(); image.src = dcSvgUrl(dcArtboardSvg(xhtml, 100, 100, 2)); await image.decode();
    check(image.naturalWidth === 200, 'export SVG did not rasterize at 2x, got ' + image.naturalWidth);
    ctx.drawImage(image, 0, 0, 10, 10); const pixel = ctx.getImageData(5, 5, 1, 1).data;
    check(pixel[0] > 240 && pixel[1] < 20, 'background rasterized white instead of red');
    check(calls.includes('/styles/red.png'), 'CSS URL resolved against wrong base');
    check(xhtml.includes('data:image/png'), 'HTML export still depends on external background');
  });
  await test('live iframes stay inside the budget', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 4;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 300, height: 200 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 300, height: 200 })));
    }
    draw('review-budget.json', E(DCSection, { id: 'review', title: 'Budget' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    // One slot mounts per DC.mountGapMs pass, so a full budget needs time.
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(400);
    const live = host.querySelectorAll('.dc-card iframe').length;
    check(live <= DC.liveBudget, 'budget exceeded: ' + live + ' live of ' + count);
    check(host.querySelectorAll('.dc-placeholder').length === count - live, 'slots outside the budget lost their placeholder');
  });
  await test('the settled --dc-inv-zoom write holds the zoom anchor', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // A viewport of a known size, so the anchor is the slot below its middle
    // and not whatever the results pane has pushed on screen. The tall card
    // keeps that middle inside the slot at any window height.
    const w = Math.min(900, innerWidth), h = Math.min(700, innerHeight);
    draw('review-anchor.json',
      E(DCSection, { id: 'review', title: 'Anchor' }, E(DCArtboard, { id: 'a', width: 600, height: 4000 })),
      { style: { position: 'fixed', top: 0, left: 0, width: w, height: h } });
    await until(() => host.querySelector('[data-dc-slot]'));
    await wait(DC.rescueMs + 200);
    const world = host.querySelector('[data-dc-world]');
    const slot = host.querySelector('[data-dc-slot]');
    const scaleOf = () => new DOMMatrix(getComputedStyle(world).transform).a;
    const invOf = () => parseFloat(getComputedStyle(world).getPropertyValue('--dc-inv-zoom')) || 1;
    const s0 = scaleOf(), inv0 = invOf(), top0 = slot.getBoundingClientRect().top, cy = h / 2;
    // The host zoom path anchors on the middle of the viewport, as a pinch does.
    window.postMessage({ type: '__dc_set_zoom', scale: s0 / 2 }, '*');
    await until(() => scaleOf() !== s0);
    // Where a transform alone puts the slot. This is what zoomAt guarantees.
    const want = cy + (top0 - cy) * (scaleOf() / s0);
    const during = slot.getBoundingClientRect().top;
    check(Math.abs(during - want) < 1, 'the gesture moved the anchor by ' + (during - want).toFixed(2) + 'px');
    await wait(DC.settleMs + 250);
    // Without this the test would also pass if the deferred write were deleted,
    // or made per-frame again. Both are correct; silently losing it is not.
    check(invOf() > inv0 * 1.9, '--dc-inv-zoom never settled: ' + invOf());
    const after = slot.getBoundingClientRect().top;
    check(Math.abs(after - want) < 1, 'content jumped ' + (after - want).toFixed(2) + 'px when --dc-inv-zoom settled');
  });
  await test('the world layout does not read the zoom', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-worldunits.json',
      E(DCSection, { id: 'review', title: 'World units' },
        E(DCArtboard, { id: 'a', width: 600, height: 400 }),
        E(DCArtboard, { id: 'b', width: 600, height: 400 })));
    await until(() => host.querySelector('[data-dc-row]'));
    await wait(400);
    const world = host.querySelector('[data-dc-world]');
    const boxes = [...host.querySelectorAll('[data-dc-slot],[data-dc-section],[data-dc-row]')];
    check(boxes.length >= 3, 'fixture did not render');
    const rects = () => boxes.map((b) => { const q = b.getBoundingClientRect(); return [q.top, q.left]; });
    // Hold the transform still and swing --dc-inv-zoom over its whole range.
    // Nothing in the world's flow may read it, or the settled write moves every
    // card and the content steps out from below the pointer as you zoom.
    const held = world.style.transform;
    const before = rects();
    let worst = 0, culprit = '';
    for (const v of ['0.25', '1', '4', '20']) {
      world.style.setProperty('--dc-inv-zoom', v);
      void world.offsetHeight;
      rects().forEach(([t, l], i) => {
        const d = Math.max(Math.abs(t - before[i][0]), Math.abs(l - before[i][1]));
        if (d > worst) { worst = d; culprit = boxes[i].dataset.dcSlot || boxes[i].dataset.dcSection || 'row'; }
      });
    }
    check(world.style.transform === held, 'the transform moved during the test');
    check(worst < 0.01, 'a world box (' + culprit + ') moved ' + worst.toFixed(2) + 'px with --dc-inv-zoom');
  });
  await test('a wheel roll does not mount or drop iframes mid-gesture', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 4;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 400, height: 300 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 400, height: 300 })));
    }
    draw('review-rollchurn.json', E(DCSection, { id: 'review', title: 'Roll' }, boards),
      { style: { position: 'fixed', top: 0, left: 0, width: Math.min(900, innerWidth), height: Math.min(700, innerHeight) } });
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(600);
    // DC.movingMs must outlast DC.settleMs. If it does not, the moving flag
    // clears before the LOD pass is armed to run, dcLodRun's guard never fires,
    // and slots mount and drop between two notches — the cards blink.
    check(DC.movingMs > DC.settleMs, 'movingMs (' + DC.movingMs + ') must exceed settleMs (' + DC.settleMs + ')');
    const vp = host.querySelector('.design-canvas');
    let churn = 0;
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.tagName === 'IFRAME') churn++; });
        r.removedNodes.forEach((n) => { if (n.nodeType === 1 && n.tagName === 'IFRAME') churn++; });
      }
    });
    mo.observe(vp, { childList: true, subtree: true });
    // A gap between settleMs and movingMs: the cadence that used to churn.
    const gap = Math.round((DC.settleMs + DC.movingMs) / 2);
    for (let i = 0; i < 6; i++) {
      vp.dispatchEvent(new WheelEvent('wheel', { clientX: 200, clientY: 200,
        deltaX: 0, deltaY: -120, deltaMode: 0, bubbles: true, cancelable: true }));
      await wait(gap);
    }
    mo.disconnect();
    check(churn === 0, churn + ' iframe mounts/drops during the roll; the cards blink');
  });
  // A section with `positions` places the cards freely and the grip moves one.
  // A section without it lays them out in a row and the grip reorders them,
  // which is the keepMoving path.
  async function dragFixture(name, positions = { A: { x: 0, y: 0 }, B: { x: 400, y: 0 } }) {
    window.fetch = async () => new Response('', { status: 404 });
    draw(name, [
      E(Probe, { key: 'p' }),
      E(DCSection, { key: 's', id: 'review', ...(positions ? { positions } : {}) },
        E(DCArtboard, { id: 'A', width: 200, height: 200 }), E(DCArtboard, { id: 'B', width: 200, height: 200 })),
    ]);
    await until(() => api && host.querySelector('[data-dc-slot] .dc-grip'));
    // The first fit and its DC.rescueMs nudge both arm the moving flag. Wait
    // for it to clear, or a check cannot tell a drag's flag from theirs.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    const vp = host.querySelector('.design-canvas');
    const grip = host.querySelector('[data-dc-slot="A"] .dc-grip');
    const r = grip.getBoundingClientRect();
    const at = (type, x, y, target = grip) => target.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    return { vp, grip, r, at };
  }
  await test('a lost pointer ends the card drag', async () => {
    const { vp, r, at } = await dragFixture('review-lostdrag.json');
    at('pointerdown', r.left + 4, r.top + 4);
    at('pointermove', r.left + 60, r.top + 60, document);
    check(dcMoving(), 'the drag did not set the moving flag');
    window.dispatchEvent(new Event('blur'));
    await wait(50);
    check(!dcMoving(), 'dcMoving() stayed true after the pointer was lost');
    check(!vp.classList.contains('dc-moving'), '.dc-moving stayed on after the pointer was lost');
    // The pointer went away; the user never dropped the card. A cancelled drag
    // must put the card back and write no position to the section state.
    check(!(api.section('review').positions || {}).A, 'the cancelled drag committed a move');
  });
  await test('a pan timer does not strip .dc-moving from a running drag', async () => {
    const { vp, r, at } = await dragFixture('review-pandrag.json');
    vp.dispatchEvent(new WheelEvent('wheel', { deltaX: 3.5, deltaY: 0, deltaMode: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    await wait(20);
    at('pointerdown', r.left + 4, r.top + 4);
    at('pointermove', r.left + 60, r.top + 60, document);
    await wait(DC.movingMs + 60);
    check(vp.classList.contains('dc-moving'), 'the pan timer removed .dc-moving mid-drag');
    at('pointerup', r.left + 60, r.top + 60, document);
    await wait(DC.movingMs + 60);
    check(!dcMoving() && !vp.classList.contains('dc-moving'), 'the flag or class stayed on after the drop');
  });
  await test('a grip reorder holds the flag over its drop animation', async () => {
    const { vp, r, at } = await dragFixture('review-reorder.json', null);
    at('pointerdown', r.left + 4, r.top + 4);
    at('pointermove', r.left + 300, r.top, document);
    check(dcMoving() && vp.classList.contains('dc-moving'), 'the reorder drag did not set the flag');
    at('pointerup', r.left + 300, r.top, document);
    // keepMoving arms the flag for DC.movingMs, which outlasts the 180 ms drop
    // slide. An iframe that mounts under the cards mid-slide would drop frames.
    check(dcMoving() && vp.classList.contains('dc-moving'), 'the drop cleared the flag before the slide ran');
    await wait(DC.movingMs + 60);
    check(!dcMoving() && !vp.classList.contains('dc-moving'), 'the flag or class stayed on after the slide');
  });
  await test('the rescue nudge keeps a restored pan', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: -5000, y: -5000, scale: 1 }));
    draw('review-rescue.json', E(DCSection, { id: 'review', title: 'Rescue' }, E(DCArtboard, { id: 'a', width: 300, height: 200 })));
    await until(() => host.querySelector('[data-dc-slot]'));
    await wait(DC.rescueMs + 200);
    const world = host.querySelector('[data-dc-world]');
    // The style getter prints the written `0` as `0px`, so read the matrix.
    const m = new DOMMatrix(world.style.transform);
    check(m.a === 1 && m.e === -5000 && m.f === -5000, 'the rescue moved a restored view: ' + world.style.transform);
  });
  await test('the LOD budget ranks against the viewport, not the window', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 6, boards = [];
    for (let i = 0; i < count; i++) boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 300, height: 200 },
      E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 300, height: 200 })));
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    draw('review-lodvp.json', E(DCSection, { id: 'review', title: 'LOD', gap: 20 }, boards),
      { style: { position: 'fixed', top: 0, left: 0, width: 400, height: 400 } });
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    // The row holds one slot every 320 px from x 60. Only b0, b1 and b2 are
    // inside the 400 px viewport plus the 600 px margin. The window is 1280 px
    // wide, so b3 to b5 are inside the window and its margin.
    await until(() => host.querySelectorAll('.dc-card iframe').length >= 1);
    await wait(600);
    const live = [...host.querySelectorAll('[data-dc-slot]')].filter((s) => s.querySelector('iframe')).map((s) => s.dataset.dcSlot);
    // Slot b0 sits at x 60 in the viewport; it is the nearest to (200, 200) and must be live.
    check(live.includes('b0'), 'the nearest slot to the viewport centre is not live: ' + live.join(','));
    check(!live.includes('b5'), 'a slot far from the viewport is live because it is near the window: ' + live.join(','));
  });
  await test('a hanging state read gives up after DC.stateTimeoutMs', async () => {
    window.fetch = (url, opts) => new Promise((resolve, reject) => { opts && opts.signal && opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
    draw('review-hang.json'); await wait(DC.stateTimeoutMs + 300);
    check(!!api, 'the canvas stayed blank past DC.stateTimeoutMs');
  });
  await test('a failed host write is retried on pagehide', async () => {
    const calls = [];
    window.omelette = { writeFile: async (file, json) => { calls.push(json); throw new Error('disk'); } };
    try {
      window.fetch = async () => json(envelope('file', 10));
      draw('review-writefail.json'); await until(() => api);
      api.patchSection('review', { title: 'edited' }); await wait(DC.saveDebounceMs + 100);
      check(calls.length === 1, 'first write did not run');
      window.dispatchEvent(new Event('pagehide')); await wait(50);
      check(calls.length === 2, 'the failed write was marked saved and not retried');
    } finally { delete window.omelette; }
  });
  await test('a host write that ran is not sent again on pagehide', async () => {
    const calls = [];
    window.omelette = { writeFile: async (file, json) => { calls.push(json); } };
    try {
      window.fetch = async () => json(envelope('file', 10));
      draw('review-writeonce.json'); await until(() => api);
      api.patchSection('review', { title: 'edited' }); await wait(DC.saveDebounceMs + 100);
      check(calls.length === 1, 'first write did not run');
      window.dispatchEvent(new Event('pagehide')); await wait(50);
      check(calls.length === 1, 'the saved sections were written a second time');
    } finally { delete window.omelette; }
  });
  document.title = results.every((r) => r.pass) ? 'PASS: canvas regressions' : 'FAIL: canvas regressions';
  window.canvasTestResults = results;
  return results;
})();
