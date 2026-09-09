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
    draw('review-delay.json'); await until(() => release); await wait(DC.settleMs + 100);
    const exposed = !!host.querySelector('#ready-probe');
    release(); await until(() => api && api.section('review').title === 'loaded');
    check(!exposed, 'canvas became editable before restoration finished');
    api.patchSection('review', { title: 'edited' }); await wait(50);
    check(api.section('review').title === 'edited', 'edit overwritten');
  });
  await test('switch state file without leaking sections', async () => {
    const calls = []; window.fetch = async (url) => { calls.push(url); return json(envelope(String(url).includes('-a.') ? 'A' : 'B', 20)); };
    draw('review-switch-a.json'); await until(() => api); await wait(30);
    draw('review-switch-b.json'); await wait(DC.settleMs + 100);
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
    window.fetch = async () => { await wait(DC.settleMs * 2); return new Response('', { status: 404 }); };
    draw('review-fit.json', E(DCSection, { id: 'review', title: 'Wide' }, E(DCArtboard, { id: 'wide', width: 10000, height: 500 })));
    await until(() => host.querySelector('[data-dc-row]')); await wait(DC.settleMs + 50);
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
    render([flow]); await until(() => host.querySelector('.dc-flows')); await wait(CF.remeasureMs + 60);
    return { flow, render };
  }
  await test('connector label and dashed style refresh', async () => {
    const { flow, render } = await flowFixture(); render([{ ...flow, label: 'BBBB', dashed: true }]); await wait(CF.remeasureMs + 110);
    const layer = host.querySelector('.dc-flows');
    check(layer.textContent === 'BBBB', 'old label retained');
    check(layer.querySelector('path').style.strokeDasharray !== '', 'dash style not updated');
  });
  await test('removing all flows clears connector layer', async () => {
    const { render } = await flowFixture(); render([]); await wait(CF.remeasureMs + 110);
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
    await wait(DC.movingMs + DC.settleMs + 30);
    const live = host.querySelectorAll('.dc-card iframe').length;
    check(live <= DC.liveBudget, 'budget exceeded: ' + live + ' live of ' + count);
    check(host.querySelectorAll('.dc-placeholder').length === count - live, 'slots outside the budget lost their placeholder');
  });
  await test('a mount or a drop starts no transition in the world', async () => {
    // A CSS transition on a node inside the world runs on the main thread:
    // every frame of it recalculates style and repaints the whole world
    // layer. On a 13-slot page with live iframes that repaint storm is what
    // left the cards and the arrows unpainted for a frame after each mount
    // or drop, which the user saw as the canvas flickering. The live dot
    // used to fade in over 180 ms, so every mount and every drop cost 20
    // full-world paints instead of one.
    window.fetch = async () => new Response('', { status: 404 });
    const count = DC.liveBudget + 4;
    const w = 300 - DC.winPad * 2, h = 200 - DC.winHead - DC.winPad * 2;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: w, height: h },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: w, height: h })));
    }
    draw('review-mount-anim.json', E(DCSection, { id: 'review', title: 'Mount' }, boards));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    // Watch the whole fill: one slot mounts per DC.mountGapMs pass, so a
    // transition started by any of them is running at one of these polls.
    const world = host.querySelector('[data-dc-world]');
    const seen = new Set();
    for (let i = 0; i < 120 && host.querySelectorAll('.dc-card iframe').length < DC.liveBudget; i++) {
      for (const a of document.getAnimations()) {
        const target = a.effect && a.effect.target;
        if (target && world.contains(target)) seen.add(a.constructor.name + ' on .' + [...target.classList].join('.') + ' (' + (a.transitionProperty || a.animationName || '?') + ')');
      }
      await wait(10);
    }
    check(seen.size === 0, 'a mount ran ' + [...seen].join(', ') + '; each frame of it repaints the whole world');
  });
  await test('hover chrome in the world starts no transition', async () => {
    // The dot fix removed one world-layer transition; the hover lift on
    // .dc-win is the same bug, larger. [data-dc-slot]:hover ran a transform
    // and a box-shadow over .18s on a node inside the world, so a pointer
    // sweep -- or a pan, where :hover hops card to card as the world slides
    // under a still pointer -- repainted the whole world every frame of the
    // hover. Guard the invariant the dot test guards, but for hover: world
    // chrome carries no transition, and no hover rule moves a world node.
    window.fetch = async () => new Response('', { status: 404 });
    const w = 300 - DC.winPad * 2, h = 200 - DC.winHead - DC.winPad * 2;
    draw('review-hover-anim.json', E(DCSection, { id: 'review', title: 'Hover' },
      E(DCArtboard, { id: 'b0', width: w, height: h },
        E(DCLazyFrame, { src: 'about:blank', title: 'b0', width: w, height: h }))));
    await until(() => host.querySelector('.dc-win'));
    const win = host.querySelector('.dc-win');
    check(getComputedStyle(win).transitionDuration === '0s',
      '.dc-win transitions ' + getComputedStyle(win).transitionProperty + ' over ' +
      getComputedStyle(win).transitionDuration + '; every hover then repaints the whole world');
    // A transform on .dc-win paints the world layer on hover-in and hover-out.
    let moved = '';
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules)
        if (r.selectorText && r.selectorText.includes(':hover') &&
            r.selectorText.includes('.dc-win') && r.style && r.style.transform)
          moved += r.selectorText + '{transform:' + r.style.transform + '}';
    }
    check(!moved, 'a hover rule moves .dc-win: ' + moved);
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
    // A restored view and a viewport of a known size. The fit runs from an
    // animation frame, and this headless harness does not always give one, so
    // the scale and the box would otherwise both be a guess. The slots must
    // also sit inside their own canvas box: `visible` is what separates the
    // ranking of one layout from another, and a canvas pushed below the
    // window by the results pane makes every slot off-screen and equal.
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    // Small boards, so the whole row is inside the mount margin at scale 1.
    const count = DC.liveBudget + 6;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 'b' + i, id: 'b' + i, width: 100, height: 80 },
        E(DCLazyFrame, { src: 'about:blank', title: 'b' + i, width: 100, height: 80 })));
    }
    draw('review-rank-stable.json', E(DCSection, { id: 'review', title: 'Stable' }, boards),
      { style: { position: 'fixed', top: 0, left: 0, width: 1200, height: 800 } });
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
    // This pass holds every box at the scale the world has now.
    settle();
    // Now change the scale. A pan alone leaves the scale term untested,
    // because a box held and rebuilt at one scale gives the same answer with a
    // wrong term. The camera keeps the same world element through a zoom, so
    // it puts no generation up and the held boxes stay: the next pass rebuilds
    // boxes of the old scale at the new one, which is what the term is for.
    // ctrlKey with a fractional delta takes the pinch branch, which zooms far
    // enough in one event to move every slot.
    const scaleOf = () => new DOMMatrix(getComputedStyle(world).transform).a;
    const scale0 = scaleOf();
    vp.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaX: 0, deltaY: 100.5, deltaMode: 0, clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
    await until(() => scaleOf() < scale0 * 0.9);
    await until(() => !dcMoving());
    check(Math.abs(scaleOf() - 1) > 0.05, 'fixture: the zoom must leave a scale other than 1');
    settle();
    const before = ranked();
    check(before.split(',').length === DC.liveBudget, 'the zoom did not settle to a full budget: ' + before);
    dcLodInvalidate();
    settle();
    const after = ranked();
    check(after.split(',').length === DC.liveBudget, 'the re-measured pass did not settle to a full budget: ' + after);
    check(before === after, 'ranking changed on a forced re-measure: ' + before + ' -> ' + after);
    // A re-measure cannot judge the scale term on its own. The measure divides
    // by the scale and the reconstruction multiplies by it, so an error in the
    // term cancels and both answers agree while both are wrong. Rank the same
    // layout once more with no camera: that path reads each slot's rect from
    // the DOM and reconstructs nothing, so it is the only answer that does not
    // share the arithmetic under test.
    const camera = Object.getOwnPropertyDescriptor(dcLod, 'world');
    let direct;
    try {
      Object.defineProperty(dcLod, 'world', { configurable: true, get: () => null, set: () => {} });
      settle();
      direct = ranked();
    } finally { Object.defineProperty(dcLod, 'world', camera); }
    check(direct.split(',').length === DC.liveBudget, 'the measured pass did not settle to a full budget: ' + direct);
    check(before === direct, 'the held boxes ranked a different set from the DOM: ' + before + ' -> ' + direct);
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
  await test('--dc-inv-zoom tracks the zoom during the gesture', async () => {
    // Before: the variable held its pre-gesture value through the whole pinch
    // and onSettle snapped it DC.settleMs after the last notch, so the section
    // head, the arrowheads and the dashes jumped to size at once -- a flicker
    // after a zoom. Now a coarse step writes it during the gesture, so the
    // chrome tracks the zoom and never snaps late. Layout still never reads it
    // ("the world layout does not read the zoom"), so this moves no card.
    window.fetch = async () => new Response('', { status: 404 });
    const w = Math.min(900, innerWidth), h = Math.min(700, innerHeight);
    draw('review-invtrack.json',
      E(DCSection, { id: 'review', title: 'Track' }, E(DCArtboard, { id: 'a', width: 600, height: 4000 })),
      { style: { position: 'fixed', top: 0, left: 0, width: w, height: h } });
    await until(() => host.querySelector('[data-dc-slot]'));
    await wait(DC.rescueMs + 200);
    const world = host.querySelector('[data-dc-world]');
    const scaleOf = () => new DOMMatrix(getComputedStyle(world).transform).a;
    const invOf = () => parseFloat(getComputedStyle(world).getPropertyValue('--dc-inv-zoom')) || 1;
    const s0 = scaleOf(), inv0 = invOf();
    // Zoom well out. Read the variable while the scale is only half way there,
    // so the read lands inside the gesture, before any settle timer could fire.
    window.postMessage({ type: '__dc_set_zoom', scale: s0 / 4 }, '*');
    await until(() => scaleOf() <= s0 * 0.5);
    check(invOf() > inv0 * 1.4, '--dc-inv-zoom stayed near ' + invOf().toFixed(2) + ' during the gesture; it still snaps late');
  });
  await test('the world layout does not read the zoom', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-worldunits.json',
      E(DCSection, { id: 'review', title: 'World units' },
        E(DCArtboard, { id: 'a', width: 600, height: 400 }),
        E(DCArtboard, { id: 'b', width: 600, height: 400 })));
    await until(() => host.querySelector('[data-dc-row]'));
    await wait(DC.movingMs + DC.settleMs + 30);
    const world = host.querySelector('[data-dc-world]');
    const boxes = [...host.querySelectorAll('[data-dc-slot],[data-dc-section],[data-dc-row]')];
    check(boxes.length >= 3, 'fixture did not render');
    // All four edges, and not the top-left corner alone. The LOD registry
    // holds each slot's box in world units, and dcLodRun rebuilds `right` and
    // `bottom` from a held width and height. `near` and `visible` read those
    // two edges, so a reader that changes a slot's size and leaves its corner
    // still would give a wrong ranking that a corner-only check cannot see.
    // The held boxes depend on this check. It is the one guard on the claim
    // that the world's layout is the same at every zoom, and that claim is
    // what lets a slot keep a box instead of measuring itself in every pass.
    const rects = () => boxes.map((b) => { const q = b.getBoundingClientRect(); return [q.top, q.left, q.right, q.bottom]; });
    // Hold the transform still and swing --dc-inv-zoom over its whole range.
    // Nothing in the world's flow may read it, or the settled write moves every
    // card and the content steps out from below the pointer as you zoom.
    const held = world.style.transform;
    const before = rects();
    let worst = 0, culprit = '';
    for (const v of ['0.25', '1', '4', '20']) {
      world.style.setProperty('--dc-inv-zoom', v);
      void world.offsetHeight;
      rects().forEach((edges, i) => {
        const d = Math.max(...edges.map((e, k) => Math.abs(e - before[i][k])));
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
    await wait(DC.rescueMs + 100);
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
    // keepMoving arms the flag for DC.movingMs, which outlasts the DC.dropMs
    // drop slide. An iframe that mounts mid-slide would drop frames.
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
    await wait(DC.rescueMs + 100);
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
  await test('a touched slot off the screen gives its place to a visible one', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    check(dcLod.subs.size === 0, 'previous fixture retained LOD subscriptions');
    // The safety rule of the mark: it biases the distance only, and the
    // visible sort runs before the distance. A slot that has left the screen
    // must give its place up although the user touched it a moment ago. The
    // check above touches a slot that is already on the screen, where the rule
    // cannot be broken.
    const count = DC.liveBudget * 2;
    const boards = [];
    for (let i = 0; i < count; i++) {
      boards.push(E(DCArtboard, { key: 't' + i, id: 't' + i, width: 40, height: 40 },
        E(DCLazyFrame, { src: 'about:blank', title: 't' + i, width: 40, height: 40 })));
    }
    draw('review-stickyrank.json', E(DCSection, { id: 'review', title: 'Sticky rank' }, boards),
      { style: { position: 'fixed', top: 0, left: 0, width: 900, height: 700 } });
    await until(() => host.querySelectorAll('[data-dc-slot]').length === count);
    await until(() => dcLod.subs.size === count);
    // The first fit and its DC.rescueMs nudge both arm the moving flag, and a
    // pass refuses to run while it is set.
    await wait(DC.rescueMs + 200);
    await until(() => !dcMoving());
    // Controlled screen rects, as the reclaim check above uses. These slots
    // rank against their own canvas box and not the window, so the rects below
    // are built from that box. The touched slots sit just under its bottom
    // edge, inside their unmount margin. The others sit inside it.
    const vr = host.querySelector('.design-canvas').getBoundingClientRect();
    const subs = [...dcLod.subs];
    const touched = subs.slice(0, DC.liveBudget), onScreen = subs.slice(DC.liveBudget);
    const place = (s, top, live) => {
      const left = vr.left + vr.width / 2;
      s.box.getBoundingClientRect = () => ({ left, top, right: left + 50, bottom: top + 50 });
      s.live = live;
    };
    touched.forEach((s) => place(s, vr.bottom + 10, true));
    onScreen.forEach((s) => place(s, vr.bottom - 100, false));
    // The boxes above replace the ones the registry holds, so drop the held
    // copies. Without this the next pass ranks the layout the fixture had.
    dcLodInvalidate();
    // A real gesture on each off-screen slot: dcTouch reads the events and
    // writes the mark, so this check covers the mark and the ranking together.
    touched.forEach((s, i) => {
      const opts = { pointerId: 30 + i, clientX: 0, clientY: 0, button: 0, buttons: 1, bubbles: true, cancelable: true };
      s.box.dispatchEvent(new PointerEvent('pointerdown', opts));
      s.box.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    });
    check(touched.every((s) => s.touchedAt !== undefined), 'the fixture gesture marked no slot');
    check(onScreen.every((s) => s.touchedAt === undefined), 'the fixture gesture marked a slot it never reached');
    for (let pass = 0; pass < count + 4; pass++) dcLodRun();
    const visibleLive = onScreen.filter((s) => s.live).length;
    const touchedLive = touched.filter((s) => s.live).length;
    check(visibleLive === DC.liveBudget,
      visibleLive + '/' + DC.liveBudget + ' slots on the screen are live; the touched slots kept the budget');
    check(touchedLive === 0, touchedLive + ' touched slots off the screen kept their place');
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
  await test('the lost pill costs no rect reads per frame', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-lostcost.json', E(DCSection, { id: 'review', title: 'Lost' }, E(DCArtboard, { id: 'a', width: 300, height: 200 })));
    await until(() => host.querySelector('[data-dc-slot]')); await wait(DC.rescueMs + 200);
    const vp = host.querySelector('.design-canvas');
    const pan = (dx) => vp.dispatchEvent(new WheelEvent('wheel', { deltaX: dx + 0.001, deltaY: 0.001, deltaMode: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    pan(6000); await until(() => host.querySelector('.dc-backto'));
    const orig = Element.prototype.getBoundingClientRect; let reads = 0;
    Element.prototype.getBoundingClientRect = function () { reads++; return orig.call(this); };
    try { for (let i = 0; i < 10; i++) { pan(5); await new Promise((r) => requestAnimationFrame(r)); } }
    finally { Element.prototype.getBoundingClientRect = orig; }
    check(reads === 0, reads + ' rect reads during 10 frames with the pill up');
    check(host.querySelector('.dc-backto'), 'the pill went away while still off content');
    // Pan back over the content. The hide must land in the frame that brings
    // the content on screen, not DC.settleMs later.
    pan(-6050.012);
    await new Promise((r) => requestAnimationFrame(r));
    await wait(40);
    check(!host.querySelector('.dc-backto'), 'the pill outlived the frame that brought the content back');
  });
  await test('the pill holds while the view sits between two sections', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    // A held view: no first fit and no rescue, so the gap keeps its world size.
    localStorage.setItem('dc-viewport-v3:' + location.pathname, JSON.stringify({ x: 0, y: 0, scale: 1 }));
    draw('review-lostgap.json', [
      E(DCSection, { key: 'a', id: 'a', title: 'First', positions: { a1: { x: 0, y: 0 } } }, E(DCArtboard, { id: 'a1', width: 300, height: 200 })),
      E(DCSection, { key: 'b', id: 'b', title: 'Second' }, E(DCArtboard, { id: 'b1', width: 300, height: 200 })),
    ], { style: { position: 'fixed', top: 0, left: 0, width: 600, height: 300 } });
    await until(() => host.querySelectorAll('[data-dc-slot]').length === 2);
    await wait(DC.rescueMs + 300);
    const vp = host.querySelector('.design-canvas');
    const pan = (dx, dy) => vp.dispatchEvent(new WheelEvent('wheel', { deltaX: dx + 0.001, deltaY: dy + 0.001, deltaMode: 0, clientX: 300, clientY: 150, bubbles: true, cancelable: true }));
    const secs = [...host.querySelectorAll('[data-dc-section]')];
    const box = vp.getBoundingClientRect();
    const top = secs[0].getBoundingClientRect().bottom, bottom = secs[1].getBoundingClientRect().top;
    check(bottom - top > box.height + 40, 'fixture: the gap (' + (bottom - top).toFixed(0) + 'px) is not larger than the view');
    // Put the view in the middle of the gap. No section is on screen, but one
    // box around all the content would still cover the view.
    pan(0, (top + bottom) / 2 - (box.top + box.height / 2));
    await until(() => host.querySelector('.dc-backto'));
    pan(0, 5);
    await new Promise((r) => requestAnimationFrame(r));
    await wait(40);
    check(host.querySelector('.dc-backto'), 'the pill hid although both sections are off screen');
  });
  await test('an embedded canvas posts the zoom once per settled gesture', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const desc = Object.getOwnPropertyDescriptor(window, 'postMessage');
    const real = window.postMessage, posts = [];
    DC.embedded = true;
    window.postMessage = function (msg, ...rest) {
      if (msg && msg.type === '__dc_zoom') posts.push(msg.scale);
      return real.apply(window, [msg, ...rest]);
    };
    try {
      draw('review-embedpost.json', E(DCSection, { id: 'review', title: 'Embed' }, E(DCArtboard, { id: 'a', width: 300, height: 200 })));
      await until(() => host.querySelector('[data-dc-slot]'));
      await wait(DC.rescueMs + 300);
      posts.length = 0;
      const s0 = dcView.scale;
      real.call(window, { type: '__dc_set_zoom', scale: s0 / 2 }, '*');
      await wait(DC.settleMs + 250);
      check(posts.length === 1, posts.length + ' __dc_zoom posts for one settled zoom');
      check(Math.abs(posts[0] - s0 / 2) < 1e-6, 'the post carried scale ' + posts[0] + ', not ' + (s0 / 2));
      // The probe drops the posted scale, so the next settle must post again.
      real.call(window, { type: '__dc_probe' }, '*');
      await wait(DC.settleMs + 250);
      check(posts.length === 2, posts.length + ' __dc_zoom posts after the probe');
    } finally {
      delete DC.embedded;
      if (desc) Object.defineProperty(window, 'postMessage', desc); else delete window.postMessage;
    }
  });
  await test('a top-level canvas posts no zoom to the host', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const posts = [];
    const onMsg = (e) => { if (e.data && e.data.type === '__dc_zoom') posts.push(e.data.scale); };
    window.addEventListener('message', onMsg);
    try {
      draw('review-zoompost.json', E(DCSection, { id: 'review', title: 'Zoom' }, E(DCArtboard, { id: 'a', width: 300, height: 200 })));
      await until(() => host.querySelector('[data-dc-slot]')); await wait(DC.rescueMs + 200);
      const vp = host.querySelector('.design-canvas');
      for (let i = 0; i < 6; i++) vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, deltaMode: 0, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
      await wait(DC.settleMs + 250);
      check(posts.length === 0, posts.length + ' __dc_zoom posts from a canvas that is not embedded');
    } finally { window.removeEventListener('message', onMsg); }
  });
  await test('the LOD poll pauses when hidden and frees the observer', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    draw('review-lodpoll.json', E(DCSection, { id: 'review', title: 'Poll' },
      E(DCArtboard, { id: 'a', width: 300, height: 200 }, E(DCLazyFrame, { src: 'about:blank', title: 'a', width: 300, height: 200 }))));
    await until(() => dcLod.subs.size > 0);
    check(dcLod.poll !== 0, 'the poll never started');
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    try {
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      check(dcLod.poll === 0, 'the poll kept running in a hidden tab');
    } finally { Object.defineProperty(Document.prototype, 'hidden', desc); }
    document.dispatchEvent(new Event('visibilitychange'));
    check(dcLod.poll !== 0, 'the poll did not restart when the tab came back');
    root.unmount(); root = ReactDOM.createRoot(host);
    await until(() => dcLod.subs.size === 0);
    check(dcLod.poll === 0, 'the poll outlived the last slot');
    check(dcLod.io === null, 'the observer outlived the last slot');
  });
  await test('a flow change does not rebuild the flow observers', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const flow = { from: 'A', to: 'B', fs: 'r', ts: 'l', label: 'AAAA' };
    const render = (flows) => draw('review-flowchurn.json', [
      E(DCSection, { key: 's', id: 'review', positions: { A: { x: 0, y: 0 }, B: { x: 600, y: 0 } } },
        E(DCArtboard, { id: 'A', width: 200, height: 200 }), E(DCArtboard, { id: 'B', width: 200, height: 200 })),
      E(CanvasFlows, { key: 'f', flows }),
    ]);
    render([flow]); await until(() => host.querySelector('.dc-flows')); await wait(CF.remeasureMs + 60);
    const Real = window.MutationObserver; let built = 0;
    window.MutationObserver = class extends Real { constructor(cb) { super(cb); built++; } };
    try {
      render([{ ...flow, label: 'BBBB' }]); await wait(CF.remeasureMs + 110);
      check(host.querySelector('.dc-flows').textContent === 'BBBB', 'the label did not refresh');
      check(built === 0, built + ' flow observers built again for a label change');
    } finally { window.MutationObserver = Real; }
  });
  await test('a CanvasPage re-render keeps the artboard elements', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const fixture = {
      pages: [{ id: 'p1', name: 'Page one' }],
      artboards: [
        { page: 'p1', file: 'A.dc.html', title: 'A', x: 0, y: 0, w: 300, h: 200 },
        { page: 'p1', file: 'B.dc.html', title: 'B', x: 600, y: 0, w: 300, h: 200 },
      ],
      annotations: [], flows: [],
    };
    let bump = null;
    function Wrap() {
      const [, setN] = React.useState(0);
      bump = () => setN((v) => v + 1);
      return E(CanvasPage, { page: 'p1', data: fixture, stateFile: 'review-canvaspage.json' });
    }
    root.render(E(Wrap));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === 2);
    await wait(DC.rescueMs + 400);
    const before = DC.renders;
    bump(); await wait(DC.settleMs);
    check(DC.renders === before, (DC.renders - before) + ' artboard frames rendered again for the same data');
  });
  await test('the page menu resets a moved arrow side', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const flow = { page: 'p1', from: 'A.dc.html', to: 'B.dc.html', fs: 'r', ts: 'l', label: 'go' };
    const fixture = {
      pages: [{ id: 'p1', name: 'Page one' }],
      artboards: [
        { page: 'p1', file: 'A.dc.html', title: 'A', x: 0, y: 0, w: 300, h: 200 },
        { page: 'p1', file: 'B.dc.html', title: 'B', x: 600, y: 0, w: 300, h: 200 },
      ],
      annotations: [], flows: [flow],
    };
    // The state a handle drag writes: the source end of this flow was moved to
    // the bottom side of page A.
    const fk = cfFlowKey(flow);
    localStorage.setItem(key('review-arrows.json'),
      JSON.stringify({ sections: { p1: { arrows: { [fk]: { fs: 'b' } } } }, updatedAt: 20 }));
    root.render(E(CanvasPage, { page: 'p1', data: fixture, stateFile: 'review-arrows.json' }));
    await until(() => host.querySelector('[data-dc-slot="A.dc.html"] .dc-kebab'));
    const kebab = host.querySelector('[data-dc-slot="A.dc.html"] .dc-kebab');
    const row = () => [...host.querySelectorAll('[data-dc-slot="A.dc.html"] .dc-menu button')].find((b) => b.textContent === 'Reset arrow sides');
    kebab.click(); await wait(30);
    check(!!row(), 'the moved page offers no reset row');
    row().click(); await wait(DC.saveDebounceMs + 60);
    const saved = JSON.parse(localStorage.getItem(key('review-arrows.json')));
    check(!((saved.sections.p1.arrows || {})[fk] || {}).fs, 'the moved side is still saved');
    kebab.click(); await wait(30);
    check(!row(), 'the reset row is still offered');
  });
  await test('a moved arrow side costs no frame renders on a patch', async () => {
    window.fetch = async () => new Response('', { status: 404 });
    const flow = { page: 'p1', from: 'A.dc.html', to: 'B.dc.html', fs: 'r', ts: 'l', label: 'go' };
    const fixture = {
      pages: [{ id: 'p1', name: 'Page one' }],
      artboards: [
        { page: 'p1', file: 'A.dc.html', title: 'A', x: 0, y: 0, w: 300, h: 200 },
        { page: 'p1', file: 'B.dc.html', title: 'B', x: 600, y: 0, w: 300, h: 200 },
      ],
      annotations: [], flows: [flow],
    };
    localStorage.setItem(key('review-arrowcost.json'),
      JSON.stringify({ sections: { p1: { arrows: { [cfFlowKey(flow)]: { fs: 'b' } } } }, updatedAt: 20 }));
    root.render(E(CanvasPage, { page: 'p1', data: fixture, stateFile: 'review-arrowcost.json' }));
    await until(() => host.querySelectorAll('[data-dc-slot]').length === 2);
    await wait(DC.rescueMs + 400);
    // A patch that leaves the arrows alone. The page holds the menu rows of the
    // moved slot, so no frame may render again.
    const title = host.querySelector('.dc-sectionhead .dc-editable');
    const before = DC.renders;
    title.textContent = 'Renamed';
    title.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await wait(DC.settleMs);
    const grew = DC.renders - before;
    await wait(DC.saveDebounceMs + 60);
    const saved = JSON.parse(localStorage.getItem(key('review-arrowcost.json')));
    check(saved.sections.p1.title === 'Renamed', 'the section title patch never ran');
    check(grew === 0, grew + ' frames rendered again for a patch that kept the arrows');
  });
  await test('dcView holds the scale the world and the drag use', async () => {
    const { at } = await dragFixture('review-viewscale.json');
    const world = host.querySelector('[data-dc-world]');
    const scaleOf = () => new DOMMatrix(getComputedStyle(world).transform).a;
    window.postMessage({ type: '__dc_set_zoom', scale: scaleOf() / 2 }, '*');
    await wait(DC.settleMs + 250);
    const shown = scaleOf();
    check(Math.abs(dcView.scale - shown) < 1e-6, 'dcView.scale is ' + dcView.scale + ', the world shows ' + shown);
    // The drag reports world px: the screen travel divided by the same scale.
    // The card is at x 0, and the commit snaps the position to 10 px.
    const g = host.querySelector('[data-dc-slot="A"] .dc-winhead').getBoundingClientRect();
    at('pointerdown', g.left + 4, g.top + 4);
    at('pointermove', g.left + 104, g.top + 4, document);
    at('pointerup', g.left + 104, g.top + 4, document);
    await wait(50);
    const want = 100 / dcView.scale, got = api.section('review').positions.A.x;
    check(Math.abs(got - want) <= 10, 'the drag moved the card ' + got + ' world px, not ' + want.toFixed(1));
  });
  document.title = results.every((r) => r.pass) ? 'PASS: canvas regressions' : 'FAIL: canvas regressions';
  window.canvasTestResults = results;
  return results;
})();
