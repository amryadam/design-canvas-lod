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
  const n0 = iframes();
  check(n0 >= 1 && n0 <= 8, n0 + ' live iframes at the fit');
  const id = host.querySelectorAll('.react-flow__node-window')[8].dataset.id;
  const node = rf().getNode(id);
  rf().setViewport({ zoom: 0.5, x: 640 - (node.position.x + node.width / 2) * 0.5, y: 450 - (node.position.y + node.height / 2) * 0.5 });
  await wait(1600);
  const n1 = iframes();
  check(n1 >= 1 && n1 <= 8, n1 + ' live iframes after the zoom');
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
  check(iframes() <= 8, iframes() + ' live iframes after the gesture');
});

test('a zoom in several pinches keeps each on-screen live window live', async () => {
  // Spike rule 3. The spike's plain budget turned 18 live screens into their
  // placeholder in this gesture (report, "Second check").
  mount(await grid(24));
  await ready(); await wait(1600);
  const anchors = [[320, 225], [960, 225], [320, 675], [960, 675], [640, 450], [640, 450]];
  let flips = 0;
  for (const dir of [-1, 1]) {
    for (const [x, y] of anchors) {
      const before = liveIds().filter((id) => onScreen(nodeEl(id)));
      for (let i = 0; i < 12; i++) { wheel({ deltaY: dir * 6, ctrlKey: true, clientX: x, clientY: y }); await frame(); }
      await wait(900);   // longer than DC.stickySettleMs: a pass runs between the pinches
      const now = new Set(liveIds());
      flips += before.filter((id) => nodeEl(id) && onScreen(nodeEl(id)) && !now.has(id)).length;
    }
  }
  check(flips === 0, flips + ' on-screen live windows turned into their placeholder');
});

test('the world has no GPU layer and each live screen has its own', async () => {
  // Spike rules 1 and 2.
  mount(await grid(6));
  await ready(); await wait(1200);
  const wc = getComputedStyle(host.querySelector('.react-flow__viewport')).willChange;
  check(wc === 'auto', 'the viewport has will-change: ' + wc);
  const frames = [...host.querySelectorAll('.dc-card iframe')];
  check(frames.length > 0, 'no live iframe');
  frames.forEach((f) => check(getComputedStyle(f).willChange === 'transform', 'a live iframe has will-change: ' + getComputedStyle(f).willChange));
});

test('a canvas.json that does not load shows the error', async () => {
  window.fetch = async (url, init) => (String(url).endsWith('canvas.json') ? new Response('', { status: 404 }) : realFetch(url, init));
  h = DesignCanvas.mount(host, { page: 't' });
  await until(() => host.querySelector('.dc-error'));
  const text = host.querySelector('.dc-error').textContent;
  check(text.includes('canvas.json did not load: HTTP 404'), 'error text: ' + text);
});
