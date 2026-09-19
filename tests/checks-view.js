const stateWith = (positions) => ({ updatedAt: 5, positions, variants: {}, arrowSides: {}, deleted: [] });

test('the page waits for the saved state, then uses it', async () => {
  let release = null;
  window.fetch = (url, init) => (String(url).includes('rf-test-')
    ? new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify(stateWith({ 'ZatcaCode.dc.html': { x: 3000, y: 5000 } })))); })
    : realFetch(url, init));
  mount(await sample());
  await until(() => release);
  await wait(300);
  check(!host.querySelector('.react-flow__node-window'), 'windows drew before the saved state was read');
  release();
  await ready();
  const p = rf().getNode('ZatcaCode.dc.html').position;
  check(p.x === 3000 - 36 && p.y === 5000 - 100, 'the saved place was not used: ' + JSON.stringify(p));
});

test('a state read that hangs gives up after 1.5 s', async () => {
  window.fetch = (url, init) => (String(url).includes('rf-test-') ? new Promise(() => {}) : realFetch(url, init));
  const data = await sample();
  const t0 = performance.now();
  mount(data);
  await ready(6000);
  const dt = performance.now() - t0;
  check(dt >= 1400 && dt < 3500, 'the page drew after ' + Math.round(dt) + ' ms');
});

test('the view comes back after a reload', async () => {
  const data = await sample();
  mount(data); await ready();
  rf().setViewport({ x: 10, y: 20, zoom: 0.3 });
  await wait(300);
  h.unmount(); h = null; host.replaceChildren();
  mount(data); await ready();
  const v = rf().getViewport();
  check(Math.abs(v.x - 10) < 0.01 && Math.abs(v.y - 20) < 0.01 && Math.abs(v.zoom - 0.3) < 1e-6, 'view ' + JSON.stringify(v));
});

test('Back to content shows with no content on screen and brings it back', async () => {
  mount(await sample()); await ready();
  rf().setViewport({ x: 200000, y: 200000, zoom: 0.5 });
  await until(() => host.querySelector('.dc-backto'), 2000);
  host.querySelector('.dc-backto').click();
  await wait(700);
  check([...host.querySelectorAll('.react-flow__node-window')].some(onScreen), 'no window on screen after Back to content');
  check(!host.querySelector('.dc-backto'), 'the pill stayed');
});

test('an embedded canvas posts the zoom once per settled gesture', async () => {
  const posts = [];
  mount(await sample(), { host: { embedded: true, post: (m) => posts.push(m) } });
  await ready(); await wait(400);
  check(posts.some((m) => m.type === '__dc_present'), 'no __dc_present');
  const zooms = () => posts.filter((m) => m.type === '__dc_zoom');
  const n0 = zooms().length, target = rf().getZoom() * 2;
  window.postMessage({ type: '__dc_set_zoom', scale: target }, '*');
  await wait(600);
  check(zooms().length === n0 + 1, (zooms().length - n0) + ' __dc_zoom posts for one settled zoom');
  check(Math.abs(zooms()[zooms().length - 1].scale - target) < 1e-6, 'the post carried ' + zooms()[zooms().length - 1].scale + ', not ' + target);
  window.postMessage({ type: '__dc_probe' }, '*');
  await wait(300);
  check(zooms().length === n0 + 2, 'the probe did not post the zoom again');
});

test('a top-level canvas posts nothing to the host', async () => {
  const posts = [];
  mount(await sample(), { host: { post: (m) => posts.push(m) } });
  await ready();
  for (let i = 0; i < 6; i++) { wheel({ deltaY: -6, ctrlKey: true }); await frame(); }
  await wait(600);
  check(posts.length === 0, posts.length + ' posts from a canvas that is not embedded');
});

test('a mouse wheel zooms and a trackpad scroll pans', async () => {
  mount(await grid(6)); await ready(); await wait(300);
  const v0 = rf().getViewport();
  wheel({ deltaY: 100 });
  await wait(50);
  const v1 = rf().getViewport();
  check(v1.zoom < v0.zoom, `a mouse-wheel notch did not zoom out (${v0.zoom} → ${v1.zoom})`);
  wheel({ deltaY: 3.5, deltaX: 1.25 });
  await wait(50);
  const v2 = rf().getViewport();
  check(v2.zoom === v1.zoom && v2.y !== v1.y, 'a trackpad scroll did not pan: ' + JSON.stringify([v1, v2]));
});

test('the arrows keep their screen width at every zoom', async () => {
  mount(await sample()); await ready();
  rf().setViewport({ x: 0, y: 0, zoom: 0.25 });
  await wait(300);
  const inv = host.querySelector('.dc-root').style.getPropertyValue('--dc-inv-zoom');
  check(inv === '4', '--dc-inv-zoom is ' + inv);
  const w = getComputedStyle(host.querySelector('.react-flow__edge-path')).strokeWidth;
  check(w === '4px', 'an arrow stroke is ' + w + ' at zoom 0.25');
});
