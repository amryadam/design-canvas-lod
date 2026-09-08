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
    // The window chrome is part of the slot box, and the budget counts the
    // slots nearest the view. Size the screen so the window keeps the 300x200
    // box this check was written for; a bigger box would push the eighth slot
    // out of the margin and the budget would never fill.
    const w = 300 - DC.winPad * 2, h = 200 - DC.winHead - DC.winPad * 2;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: w, height: h },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: w, height: h })));
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
  await test('the settled pass ranks without measuring every slot', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 4;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 300, height: 200 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 300, height: 200 })));
    }
    draw('review-ranking.json', E(DCSection, { id: 'review', title: 'Ranking' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(400);
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-dc-slot')) reads++;
      return original.apply(this, arguments);
    };
    let held, fresh;
    try {
      dcLodRun(); reads = 0;      // let any pending mount settle first
      dcLodRun(); held = reads;
      dcLodInvalidate(); reads = 0;
      dcLodRun(); fresh = reads;
    } finally { Element.prototype.getBoundingClientRect = original; }
    check(held === 0, 'a settled pass measured ' + held + ' slots');
    check(fresh === count, 'an invalidated pass measured ' + fresh + ' of ' + count);
  });
  await test('a forced re-measure ranks the same slots live as the held boxes', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // Small boards, so the whole row is inside the mount margin at scale 1.
    // The fit runs from an animation frame, and this headless harness does not
    // always give one. This test must measure the ranking, not the fit.
    const count = DC.liveBudget + 6;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 100, height: 80 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 100, height: 80 })));
    }
    draw('review-rank-stable.json', E(DCSection, { id: 'review', title: 'Stable' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => host.querySelectorAll('.dc-card iframe').length >= DC.liveBudget);
    await wait(400);
    const liveSet = () => new Set([...host.querySelectorAll('[data-dc-slot]')]
      .filter((el) => el.querySelector('.dc-card iframe')).map((el) => el.dataset.dcSlot));
    // The registry's own answer, which dcLodRun writes at once. The DOM
    // follows it one React commit later, so a check on the DOM cannot say
    // which pass it is reading.
    const ranked = () => [...dcLod.subs].filter((s) => s.live)
      .map((s) => s.box.dataset.dcSlot).sort().join(',');
    // Pan the row, so the held boxes and a fresh measurement would disagree if
    // the arithmetic in dcLodRun were wrong: the world moves under a still camera.
    const vp = host.querySelector('.design-canvas');
    const world = host.querySelector('[data-dc-world]');
    const worldLeft = world.getBoundingClientRect().left;
    vp.dispatchEvent(new WheelEvent('wheel', { deltaX: 900, deltaY: 0, deltaMode: 0, clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
    await until(() => Math.abs(world.getBoundingClientRect().left - worldLeft) > 1);
    // A pass refuses to run while the world moves, so wait for the flag. Then
    // drive the ranking to its fixed point here. dcLodRun mounts one slot per
    // pass, and a fixed wait on that chain is what makes a test like this
    // flake; a loop of passes has no clock in it at all.
    await until(() => !dcMoving());
    const settle = () => { for (let i = 0; i < count + 2; i++) dcLodRun(); };
    settle();
    const before = ranked();
    check(before.split(',').length === DC.liveBudget, 'the pan did not settle to a full budget: ' + before);
    dcLodInvalidate();
    settle();
    const after = ranked();
    check(after.split(',').length === DC.liveBudget, 'the re-measured pass did not settle to a full budget: ' + after);
    check(before === after, 'ranking changed on a forced re-measure: ' + before + ' -> ' + after);
    // The registry's answer must also reach the screen. React commits the
    // mounts after the passes, so wait for the exact set: a wait for the count
    // alone would read the set from before the pan and pass on nothing.
    await until(() => [...liveSet()].sort().join(',') === after);
  });
  await test('a canvas that goes away leaves a registry that still ranks', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // The registry is module state, so it outlives each canvas. A first canvas
    // mounts, sets the camera, and then goes away.
    draw('review-gone.json', E(DCSection, { id: 'review', title: 'Gone' },
      E(DCArtboard, { id: 'g0', width: 100, height: 80 },
        E(DCLazyFrame, { src: 'about:blank', title: 'g0', width: 100, height: 80 }))));
    await until(() => host.querySelectorAll('.dc-card iframe').length === 1);
    for (let i = 0; i < 100 && dcLod.world === null; i++) await wait(20);
    check(dcLod.world !== null, 'the first canvas never set a camera');
    root.unmount(); host.replaceChildren(); root = ReactDOM.createRoot(host);
    check(dcLod.world === null, 'the registry kept the world of the canvas that went away');

    // A second canvas, with the camera held away for the whole of its life. A
    // real canvas is in this state from its first slot to its first flushed
    // frame. The budget must still fill: a pass with no world measures each
    // slot itself. Without that fallback no iframe mounts at all.
    const camera = Object.getOwnPropertyDescriptor(dcLod, 'world');
    Object.defineProperty(dcLod, 'world', { configurable: true, get: () => null, set: () => {} });
    // Small boards, so the whole row is inside the mount margin at scale 1.
    // The fit runs from an animation frame, and this headless harness does not
    // always give one. This test must measure the registry, not the fit.
    const count = DC.liveBudget + 4;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'c' + i, id: 'c' + i, width: 100, height: 80 },
        E(DCLazyFrame, { src: 'about:blank', title: 'c' + i, width: 100, height: 80 })));
    }
    try {
      draw('review-nocamera.json', E(DCSection, { id: 'review', title: 'No camera' }, boards));
      await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
      await until(() => host.querySelectorAll('.dc-card iframe').length === DC.liveBudget);
    } finally { Object.defineProperty(dcLod, 'world', { ...camera, value: null }); }
    const live = host.querySelectorAll('.dc-card iframe').length;
    check(live === DC.liveBudget, 'a canvas with no camera mounted ' + live + ' of ' + DC.liveBudget);
    check(host.querySelectorAll('.dc-placeholder').length === count - live, 'slots outside the budget lost their placeholder');
  });
  await test('a slot outside the camera world is measured, not held', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // One canvas owns the camera. A slot of a second canvas is not inside that
    // world, so it does not move when the camera pans. A camera pan puts no
    // generation up, so a held box for such a slot would rank it in the wrong
    // place on every pass after the first one.
    draw('review-foreign.json', E(DCSection, { id: 'review', title: 'Foreign' },
      E(DCArtboard, { id: 'f0', width: 40, height: 40 })));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === 1);
    await until(() => dcLod.world !== null);
    // The first fit and its DC.rescueMs nudge both arm the moving flag, and a
    // pass refuses to run while it is set.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    check(dcLod.subs.size === 0, 'the fixture canvas subscribed slots of its own');
    // The box is outside the world, and far to the right of the screen. It is
    // thus outside its mount margin and must never go live.
    const far = innerWidth * 3;
    const box = document.body.appendChild(document.createElement('div'));
    box.getBoundingClientRect = () => ({ left: far, top: 0, right: far + 50, bottom: 50 });
    const entry = { live: false, margin: 600, box, set(value) { entry.live = value; } };
    const world = dcLod.world, before = world.style.transform;
    try {
      dcLod.subs.add(entry);
      dcLodRun();
      check(!entry.live, 'a slot outside its mount margin went live');
      // Pan the camera by exactly the offset of the box. A held box would then
      // land on the screen; a measured one stays where it is.
      world.style.transform = 'translate3d(' + -far + 'px, 0, 0) ' + before;
      for (let pass = 0; pass < 4; pass++) dcLodRun();
      check(!entry.live, 'the pass moved a slot that the camera world does not hold');
    } finally {
      dcLod.subs.delete(entry); box.remove();
      world.style.transform = before; clearTimeout(dcLod.timer);
    }
  });
  await test('a variant size change re-measures the held boxes', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // A restored view, so the first fit leaves the scale at 1 and the row
    // below keeps the sizes this check counts on.
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    // dcActions.size patches sec.variant. The slot then changes width, and
    // every sibling to its right in the flex row moves. Nothing on that path
    // measures the world again unless the patch itself invalidates.
    // Two sections make the hole visible. The second holds one very wide card,
    // so it and not the row under test sets the world's width. Every card is
    // the same height, so the row height and the world height never change.
    // The world thus keeps its own border box through the patch, its
    // ResizeObserver stays silent, and no pan or zoom puts the generation up.
    const count = DC.liveBudget + 6;
    const boards = [];
    // b0 starts wide. The thin variant pulls every card to its right back by
    // 2340 px, from outside the mount margin to inside the viewport.
    boards.push(E(DCArtboard, { key: 'b0', id: 'b0', width: 2400, height: 40,
      variants: [{ file: 'b0-fat', w: 2400, h: 40, primary: true }, { file: 'b0-thin', w: 60, h: 40 }] },
      E(DCLazyFrame, { src: 'about:blank', title: 'b0', width: 60, height: 40 })));
    for (let i = 1; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 60, height: 40 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 60, height: 40 })));
    }
    draw('review-variant.json', [
      E(Probe, { key: 'p' }),
      E(DCSection, { key: 'r', id: 'review', title: 'Variant', gap: 20 }, boards),
      E(DCSection, { key: 'w', id: 'wide', title: 'Wide' }, E(DCArtboard, { id: 'w0', width: 8000, height: 40 })),
    ], { style: { position: 'fixed', top: 0, left: 0, width: 900, height: 700 } });
    await until(() => api && host.querySelectorAll('[data-dc-slot]').length === count + 1);
    // The first fit and its DC.rescueMs nudge both arm the moving flag, and a
    // pass refuses to run while it is set.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    check(dcLod.subs.size === count, 'the fixture registered ' + dcLod.subs.size + ' slots, not ' + count);
    // Manual pump to the fixed point, per this file's convention: no sleep
    // stands in for a real assertion, and dcLod.subs is read directly rather
    // than the DOM, which a React commit can still lag behind.
    const settle = () => { for (let i = 0; i < count + 2; i++) dcLodRun(); };
    const live = () => [...dcLod.subs].filter((s) => s.live).length;
    settle();
    check(live() === 1, 'fixture: ' + live() + ' slots were live before the patch, not 1');
    const world = host.querySelector('[data-dc-world]');
    const box0 = world.getBoundingClientRect();
    api.patchSection('review', (x) => dcMapPatch(x, 'variant', 'b0', 'b0-thin'));
    const b0 = host.querySelector('[data-dc-slot="b0"]');
    await until(() => b0.getBoundingClientRect().width < 200);
    const box1 = world.getBoundingClientRect();
    check(Math.abs(box1.width - box0.width) < 0.5 && Math.abs(box1.height - box0.height) < 0.5,
      'fixture: the world resized, so its ResizeObserver would have invalidated on its own');
    await until(() => !dcMoving());
    settle();
    check(live() === DC.liveBudget,
      'the row moved and ' + live() + ' of ' + DC.liveBudget + ' slots went live; the held boxes were never dropped');
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
    await wait(DC.rescueMs + 200); // past the first fit, the rescue and the 300 ms transform write
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
  await test('settled visible slots reclaim the budget from off-screen live slots', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    check(dcLod.subs.size === 0, 'previous fixture retained LOD subscriptions');
    // A live camera, and boxes that the camera's world holds. Without a canvas
    // this check ranks through the no-world fallback only, and never through
    // the held world boxes that the pass uses on a real page.
    // The boards carry no DCLazyFrame, so the canvas subscribes no slot of its
    // own and the fixture below is the whole registry.
    const count = DC.liveBudget * 2;
    const boards = [];
    for (let i = 0; i < count; i++) boards.push(E(DCArtboard, { key: 'r' + i, id: 'r' + i, width: 40, height: 40 }));
    draw('review-reclaim.json', E(DCSection, { id: 'review', title: 'Reclaim' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => dcLod.world !== null);
    // The first fit and its DC.rescueMs nudge both arm the moving flag, and a
    // pass refuses to run while it is set.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    check(dcLod.subs.size === 0, 'the fixture canvas subscribed slots of its own');
    // Controlled post-zoom screen rects: 1000-world-px boards at 5% zoom.
    // There are exactly budget visible boards, so none should stay a placeholder.
    // Previously live boards sit just below the screen, inside unmountMargin.
    // The rect gives the four edges and no width or height. near, visible and
    // the distance ask for the edges only, so the pass must want no more.
    const els = [...host.querySelectorAll('[data-dc-slot]')];
    const entries = [], changes = [];
    const add = (id, top, live, el) => {
      const left = innerWidth / 2;
      el.getBoundingClientRect = () => ({ left, top, right: left + 50, bottom: top + 50 });
      const s = { id, live, margin: 600, box: el, set(value) { changes.push({ id, value }); } };
      entries.push(s); dcLod.subs.add(s);
    };
    try {
      for (let i = 0; i < DC.liveBudget; i++) add('old-' + i, innerHeight + 10, true, els[i]);
      for (let i = 0; i < DC.liveBudget; i++) add('visible-' + i, innerHeight - 100, false, els[DC.liveBudget + i]);
      check(dcLod.world.contains(entries[0].box), 'the fixture boxes are outside the camera world');
      for (let pass = 0; pass < 100; pass++) {
        const start = changes.length;
        dcLodRun();
        check(entries.filter((s) => s.live).length <= DC.liveBudget, 'budget exceeded during recovery');
        check(changes.slice(start).filter((c) => c.value).length <= 1, 'recovery bypassed staggered mounts');
      }
      const visibleLive = entries.filter((s) => s.id.startsWith('visible-') && s.live).length;
      check(visibleLive === DC.liveBudget,
        visibleLive + '/' + DC.liveBudget + ' visible slots live after 100 settled passes; off-screen slots retained the budget');
      const settledChanges = changes.length;
      for (let pass = 0; pass < 10; pass++) dcLodRun();
      check(changes.length === settledChanges, 'idle LOD churn after recovery');
    } finally {
      entries.forEach((s) => dcLod.subs.delete(s));
      clearTimeout(dcLod.timer);
    }
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
    await until(() => api && host.querySelector('[data-dc-slot] .dc-winhead'));
    // The first fit and its DC.rescueMs nudge both arm the moving flag. Wait
    // for it to clear, or a check cannot tell a drag's flag from theirs.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    const vp = host.querySelector('.design-canvas');
    const grip = host.querySelector('[data-dc-slot="A"] .dc-winhead');
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
    // The window chrome puts each slot box at 300 + DC.winPad * 2 wide, so the
    // row holds one slot every 392 px from x 60. Only b0, b1 and b2 are inside
    // the 400 px viewport plus the 600 px margin. The browser window is wider,
    // so b3 and b4 are inside the window and its margin.
    await until(() => host.querySelectorAll('.dc-card iframe').length >= 1);
    await wait(600);
    const live = [...host.querySelectorAll('[data-dc-slot]')].filter((s) => s.querySelector('iframe')).map((s) => s.dataset.dcSlot);
    check(innerWidth > 1100, 'window too narrow for this check');
    check(live.sort().join(',') === 'b0,b1,b2', 'live set: ' + live.join(','));
  });
  await test('a touched slot keeps its place in the budget', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // More slots than the budget, so some stay placeholders after the fit.
    const count = DC.liveBudget + 6;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 100, height: 80 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 100, height: 80 })));
    }
    draw('review-sticky.json', E(DCSection, { id: 'review', title: 'Sticky' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    // The first fit and its DC.rescueMs nudge both arm the moving flag, and a
    // pass refuses to run while it is set.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    // Manual pump to the fixed point, per this file's convention: no sleep
    // stands in for a real assertion, and dcLod.subs is read directly rather
    // than the DOM, which a React commit can still lag behind.
    const settle = () => { for (let i = 0; i < count + 2; i++) dcLodRun(); };
    settle();

    const vp = host.querySelector('.design-canvas');
    const vr = vp.getBoundingClientRect();
    const isVisible = (box) => {
      const r = box.getBoundingClientRect();
      return r.right > vr.left && r.left < vr.left + vr.width && r.bottom > vr.top && r.top < vr.top + vr.height;
    };

    const subs = [...dcLod.subs];
    check(subs.filter((s) => s.live).length === DC.liveBudget, 'the fixture did not settle to a full budget');
    const target = subs.find((s) => !s.live && isVisible(s.box));
    check(!!target, 'fixture: no visible placeholder to touch');

    // A pointer down anywhere in the slot marks it; a pointer up ends the
    // gesture, so it cannot hold the registry moving and block the next pass.
    const tr = target.box.getBoundingClientRect();
    const opts = { pointerId: 11, clientX: tr.left + 4, clientY: tr.top + 4, button: 0, buttons: 1, bubbles: true, cancelable: true };
    target.box.dispatchEvent(new PointerEvent('pointerdown', opts));
    document.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));

    settle();
    check(target.live, 'a touch on a visible placeholder did not win it a place in the budget');
    check(subs.filter((s) => s.live).length === DC.liveBudget,
      'the touch pushed the live count past DC.liveBudget: ' + subs.filter((s) => s.live).length);
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
      check(calls[1] === calls[0], 'retry sent different JSON');
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
  await test('cfRoute picks a candidate that crosses less than the plain curve', async () => {
    // The obstacle stands against B's left anchor. No route around it is clear.
    // The router must then draw the candidate that crosses the least.
    const a = { x: 0, y: 0 }, b = { x: 600, y: 0 }, obs = [{ x: 440, y: -300, w: 160, h: 600 }];
    const plainHits = cfHits(cfCurve(a, 'r', b, 'l'), obs, 96);
    const routed = cfRoute(a, 'r', b, 'l', obs);
    check(plainHits > 0, 'fixture: the plain curve must cross the obstacle');
    check(cfHits(routed, obs, 96) < plainHits, 'cfRoute kept the plain curve although a clearer candidate exists');
  });
  await test('a grown section head stays inside its gap', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    draw('review-heads.json', [
      E(DCSection, { key: 'a', id: 'a', title: 'First', subtitle: 'With a subtitle' }, E(DCArtboard, { id: 'a1', width: 300, height: 200 })),
      E(DCSection, { key: 'b', id: 'b', title: 'Second', subtitle: 'With a subtitle' }, E(DCArtboard, { id: 'b1', width: 300, height: 200 })),
    ]);
    await until(() => host.querySelectorAll('.dc-sectionhead').length === 2);
    await wait(DC.rescueMs + 200);
    const world = host.querySelector('[data-dc-world]');
    world.style.setProperty('--dc-inv-zoom', '4'); void world.offsetHeight;
    const [h1, h2] = host.querySelectorAll('.dc-sectionhead');
    const row1 = host.querySelector('[data-dc-section="a"] [data-dc-row]');
    check(h1.getBoundingClientRect().top >= world.getBoundingClientRect().top - 0.5, 'the first head grew above the world top');
    check(h2.getBoundingClientRect().top >= row1.getBoundingClientRect().bottom - 0.5, 'the second head covers the first section cards');
  });
  await test('export names keep non-Latin letters', async () => {
    check(dcExportName('صفحة عربية', 'x') === 'صفحة عربية', 'Arabic label collapsed: ' + dcExportName('صفحة عربية', 'x'));
    check(dcExportName('a/b:c', 'x') === 'a_b_c', 'separators kept');
  });
  document.title = results.every((r) => r.pass) ? 'PASS: canvas regressions' : 'FAIL: canvas regressions';
  window.canvasTestResults = results;
  return results;
})();
