test('the sample draws its windows, note, head and arrows', async () => {
  mount(await sample());
  await ready();
  const count = (sel) => host.querySelectorAll(sel).length;
  check(count('.react-flow__node-window') === 10, count('.react-flow__node-window') + ' windows, want 10 (one variant folds)');
  check(count('.react-flow__node-note') === 1, count('.react-flow__node-note') + ' notes, want 1');
  check(host.querySelector('.dc-headtitle').textContent === 'Invoices · ZATCA', 'head: ' + host.querySelector('.dc-headtitle').textContent);
  check(host.querySelector('.dc-headsub').textContent === '10 screens · 1 variant', 'subtitle: ' + host.querySelector('.dc-headsub').textContent);
  await until(() => count('.react-flow__edge') === 12);
  check(count('.dc-flowlabel') === 12, count('.dc-flowlabel') + ' arrow labels, want 12');
});

test('the live iframes stay inside the budget under pan and zoom', async () => {
  mount(await grid(24));
  await ready(); await wait(1600);
  // The whole grid is on screen at the fit, so the budget fills every one of
  // its 8 places. A band of 1..8 would let a regression to one live screen
  // through (perf/results.md records 8 at zoom 0.05-0.25).
  const n0 = iframes();
  check(n0 === 8, n0 + ' live iframes at the fit, want 8');
  const id = host.querySelectorAll('.react-flow__node-window')[8].dataset.id;
  const node = rf().getNode(id);
  rf().setViewport({ zoom: 0.5, x: 640 - (node.position.x + node.width / 2) * 0.5, y: 450 - (node.position.y + node.height / 2) * 0.5 });
  await wait(1600);
  const n1 = iframes();
  check(n1 === 8, n1 + ' live iframes after the zoom, want 8');
  check(liveIds().includes(id), 'the window in the middle of the view is not live');
});

test('no iframe mounts or drops during a wheel gesture', async () => {
  mount(await grid(24));
  await ready(); await wait(1600);
  let changes = 0;
  const mo = new MutationObserver((recs) => recs.forEach((r) => [...r.addedNodes, ...r.removedNodes]
    .forEach((n) => { if (n.nodeName === 'IFRAME') changes++; })));
  mo.observe(host, { childList: true, subtree: true });
  for (let i = 0; i < 60; i++) { wheel({ deltaY: i < 30 ? -6 : 6, ctrlKey: true }); await frame(); }
  mo.disconnect();
  check(changes === 0, changes + ' iframe mounts or drops during the gesture');
  await wait(1600);
  check(iframes() === 8, iframes() + ' live iframes after the gesture, want 8');
});

test('a zoom in several pinches keeps each on-screen live window live', async () => {
  // Spike rule 3 as wired: a pass runs after each pinch, and no pass turns an
  // on-screen live window into its placeholder. The spike's plain budget did
  // that 18 times in a gesture like this (report, "Second check"). The sticky
  // ranking itself has its own unit test in src/liveBudget.test.js.
  mount(await grid(24));
  await ready();
  // Start at zoom 0.1 on the middle of the grid. A tick zooms by 2^0.12 (the
  // ctrl+wheel delta of React Flow on a Mac), so 6 pinches of 6 ticks zoom in
  // to 2 and 6 zoom out to 0.1 again: each pinch stays inside 0.05–4.
  const b = rf().getNodesBounds(rf().getNodes().filter((n) => n.type === 'window'));
  rf().setViewport({ zoom: 0.1, x: host.clientWidth / 2 - (b.x + b.width / 2) * 0.1, y: host.clientHeight / 2 - (b.y + b.height / 2) * 0.1 });
  await wait(1600);
  const budget = h.api.budget;
  const anchors = [[320, 225], [960, 225], [320, 675], [960, 675], [640, 450], [640, 450]];
  let flips = 0, n = 0;
  for (const dir of [-1, 1]) {
    for (const [x, y] of anchors) {
      n++;
      const before = liveIds().filter((id) => onScreen(nodeEl(id)));
      const z0 = rf().getZoom();
      for (let i = 0; i < 6; i++) { if (i) await frame(); wheel({ deltaY: dir * 6, ctrlKey: true, clientX: x, clientY: y }); }
      // The last tick has started a move, and no pass runs during a move:
      // a pass counted from here ran after the pinch.
      const p0 = budget.passes();
      check(rf().getZoom() !== z0, `pinch ${n} did not change the zoom (${z0})`);
      await until(() => budget.passes() > p0, 2000).catch(() => { throw new Error(`no budget pass ran after pinch ${n}`); });
      await wait(500);   // the mounts after the pass, one each DC.mountGapMs
      const now = new Set(liveIds());
      flips += before.filter((id) => nodeEl(id) && onScreen(nodeEl(id)) && !now.has(id)).length;
    }
  }
  check(flips === 0, flips + ' on-screen live windows turned into their placeholder');
});

test('the world has no GPU layer and each live screen has its own', async () => {
  // Spike rules 1 and 2.
  mount(await grid(6));
  await ready();
  // Six windows, all on screen at the fit, so all six are live: fewer would
  // mean the budget stopped filling its places.
  await until(() => host.querySelectorAll('.dc-card iframe').length === 6, 5000);
  const wc = getComputedStyle(host.querySelector('.react-flow__viewport')).willChange;
  check(wc === 'auto', 'the viewport has will-change: ' + wc);
  const frames = [...host.querySelectorAll('.dc-card iframe')];
  check(frames.length === 6, frames.length + ' live iframes on a page of 6 windows, want 6');
  frames.forEach((f) => check(getComputedStyle(f).willChange === 'transform', 'a live iframe has will-change: ' + getComputedStyle(f).willChange));
});

test('a canvas.json with no artboards shows the error, not a white page', async () => {
  // The file parses, so the fetch path is happy; the shape is wrong. Before
  // the guard, readPage threw inside a useMemo and React unmounted the root.
  h = DesignCanvas.mount(host, { data: { pages: [{ id: 't' }] }, page: 't' });
  await until(() => host.querySelector('.dc-error'));
  const text = host.querySelector('.dc-error').textContent;
  check(text.includes('artboards'), 'error text: ' + text);
  check(host.querySelectorAll('.react-flow__node').length === 0, 'a node drew on a page with no artboards');
});

test('a canvas.json that does not load shows the error', async () => {
  window.fetch = async (url, init) => (String(url).endsWith('canvas.json') ? new Response('', { status: 404 }) : realFetch(url, init));
  h = DesignCanvas.mount(host, { page: 't' });
  await until(() => host.querySelector('.dc-error'));
  const text = host.querySelector('.dc-error').textContent;
  check(text.includes('canvas.json did not load: HTTP 404'), 'error text: ' + text);
});
