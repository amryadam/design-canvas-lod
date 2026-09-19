// Center window `id` at `zoom`, so the header and the chips are a real size.
async function focusOn(id, zoom = 0.5) {
  const n = rf().getNode(id);
  rf().setViewport({ zoom, x: 640 - (n.position.x + n.width / 2) * zoom, y: 450 - (n.position.y + n.height / 2) * zoom });
  await wait(300);
}
// A mouse drag the way d3-drag (React Flow's node drag) reads it: mousedown
// on the element, then mousemove and mouseup on the window.
async function drag(el, dx, dy, mods = {}) {
  const r = el.getBoundingClientRect();
  const x = r.left + 12, y = r.top + r.height / 2;
  const ev = (type, cx, cy, target) => target.dispatchEvent(new MouseEvent(type, {
    clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true, view: window, ...mods,
  }));
  ev('mousedown', x, y, el);
  for (let i = 1; i <= 5; i++) { ev('mousemove', x + (dx * i) / 5, y + (dy * i) / 5, window); await frame(); }
  ev('mouseup', x + dx, y + dy, window);
  await wait(200);
}
async function menuRow(text) {
  const find = () => [...host.querySelectorAll('.dc-menu button')].find((b) => b.textContent === text);
  await until(() => find());
  return find();
}
// mousedown, then (if dx or dy) one mousemove, then mouseup: a click, or a
// drop too small to be a drag, never the multi-step motion of drag().
async function pressRelease(el, dx = 0, dy = 0, mods = {}) {
  const r = el.getBoundingClientRect();
  const x = r.left + 12, y = r.top + r.height / 2;
  const ev = (type, cx, cy, target) => target.dispatchEvent(new MouseEvent(type, {
    clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true, view: window, ...mods,
  }));
  ev('mousedown', x, y, el);
  if (dx || dy) ev('mousemove', x + dx, y + dy, window);
  ev('mouseup', x + dx, y + dy, window);
  await wait(200);
}
// Opens the ⋯ menu, reports whether "Reset position" shows, then closes it.
async function hasResetRow(id) {
  nodeEl(id).querySelector('.dc-kebab').click();
  await until(() => host.querySelector('.dc-menu'));
  const has = [...host.querySelectorAll('.dc-menu button')].some((b) => b.textContent === 'Reset position');
  nodeEl(id).querySelector('.dc-kebab').click();
  await until(() => !host.querySelector('.dc-menu'));
  return has;
}
const savedCopy = () => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('dc2-state:'));
  return k ? JSON.parse(localStorage.getItem(k)) : null;
};
function chip(id, label) {
  return [...nodeEl(id).querySelectorAll('.dc-size')].find((b) => b.textContent === label);
}

test('a header drag moves the window and saves its place', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaCode.dc.html';
  await focusOn(id);
  const head = nodeEl(id).querySelector('.dc-winhead');
  const start = { ...rf().getNode(id).position }, updatedAt0 = h.api.state().updatedAt;

  // A press and release with no movement is a click, not a drag: it must
  // save nothing (CanvasPage.jsx's dropTolerance guard on onNodeDragStop).
  await pressRelease(head);
  check(h.api.state().updatedAt === updatedAt0, 'a click with no move bumped updatedAt');
  check(!(id in h.api.state().positions), 'a click with no move saved a place');
  check(rf().getNode(id).position.x === start.x && rf().getNode(id).position.y === start.y, 'a click with no move moved the node');
  check(!(await hasResetRow(id)), 'Reset position shows after a click with no move');

  // A drop under DC.dropTolerance (4 world px) is the same: at zoom 0.5, a
  // 1 screen px move is 2 world px, under the 4 px tolerance.
  await pressRelease(head, 1, 0);
  check(!(id in h.api.state().positions), 'a 1 px drop saved a place');
  check(rf().getNode(id).position.x === start.x && rf().getNode(id).position.y === start.y, 'a 1 px drop moved the node');

  const before = { ...rf().getNode(id).position }, zoom = rf().getZoom();
  await drag(head, 100, 50);
  const after = rf().getNode(id).position;
  check(Math.abs(after.x - before.x - 100 / zoom) < 2 && Math.abs(after.y - before.y - 50 / zoom) < 2,
    `moved by ${after.x - before.x}, ${after.y - before.y}; want ${100 / zoom}, ${50 / zoom}`);
  const saved = h.api.state().positions[id];
  check(saved && Math.abs(saved.x - (after.x + 36)) < 0.5 && Math.abs(saved.y - (after.y + 100)) < 0.5, 'saved place ' + JSON.stringify(saved));
  check(savedCopy() && savedCopy().positions[id], 'the browser copy has no saved place');
});

test('with ⌘ held, a drag on the screen moves the window', async () => {
  mount(await sample()); await ready();
  const id = 'Invoices.dc.html';
  await focusOn(id);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
  await until(() => host.querySelector('.dc-root.dc-grab'));
  const before = { ...rf().getNode(id).position }, zoom = rf().getZoom();
  await drag(nodeEl(id).querySelector('.dc-shield'), 80, 40, { metaKey: true });
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  const after = rf().getNode(id).position;
  check(Math.abs(after.x - before.x - 80 / zoom) < 2, `moved by ${after.x - before.x}; want ${80 / zoom}`);
  check(!host.querySelector('.dc-root.dc-grab'), 'the grip stayed on after the key went up');
});

test('a chip click changes the file and the size, and the arrow follows', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaDone.dc.html';
  await focusOn(id);
  check(rf().getNode(id).width === 1440 + 72, 'width ' + rf().getNode(id).width);
  const e = rf().getEdges().find((x) => x.target === id);
  const pathOf = () => host.querySelector(`.react-flow__edge[data-id="${e.id}"] .react-flow__edge-path`).getAttribute('d');
  const d0 = pathOf();
  check(chip(id, '390'), 'no 390 chip');
  chip(id, '390').click();
  await until(() => rf().getNode(id).width === 390 + 72);
  check(rf().getNode(id).height === 844 + 136, 'height ' + rf().getNode(id).height);
  check(h.api.state().variants[id] === 'ZatcaDonePhone.dc.html', 'the choice is not saved');
  await wait(100);
  check(pathOf() !== d0, 'the arrow did not follow the new size');
});

test('an arrow side change is saved, and the menu resets it', async () => {
  mount(await sample()); await ready();
  const from = 'ZatcaProfile.dc.html', to = 'ZatcaCode.dc.html';
  const e = rf().getEdges().find((x) => x.source === from && x.target === to);
  h.api.reconnect(e.id, { source: from, target: to, sourceHandle: 'b', targetHandle: 'l' });
  await until(() => rf().getEdge(e.id).sourceHandle === 'b');
  const sides = Object.values(h.api.state().arrowSides);
  check(sides.length === 1 && sides[0].fs === 'b' && !('ts' in sides[0]), JSON.stringify(h.api.state().arrowSides));
  const beforeSides = JSON.stringify(h.api.state().arrowSides);
  const beforeHandles = { sourceHandle: rf().getEdge(e.id).sourceHandle, targetHandle: rf().getEdge(e.id).targetHandle };
  // 't'/'t' differ from the current 'b'/'l' sides, so a reconnect wrongly
  // accepted would show up in arrowSides; canvas.json's own target ('to')
  // never changes, so that alone cannot prove the guard ran.
  h.api.reconnect(e.id, { source: from, target: 'Invoices.dc.html', sourceHandle: 't', targetHandle: 't' });
  await wait(100);
  check(rf().getEdge(e.id).target === to, 'a reconnect to another window was accepted');
  check(rf().getEdge(e.id).sourceHandle === beforeHandles.sourceHandle && rf().getEdge(e.id).targetHandle === beforeHandles.targetHandle,
    'a reconnect to another window changed the edge sides: ' + JSON.stringify(rf().getEdge(e.id)));
  check(JSON.stringify(h.api.state().arrowSides) === beforeSides,
    'a reconnect to another window changed arrowSides: ' + JSON.stringify(h.api.state().arrowSides));
  await focusOn(from);
  nodeEl(from).querySelector('.dc-kebab').click();
  (await menuRow('Reset arrow sides')).click();
  await until(() => rf().getEdge(e.id).sourceHandle === 'r');
  check(Object.keys(h.api.state().arrowSides).length === 0, JSON.stringify(h.api.state().arrowSides));
});

test('Reset position returns a moved window to canvas.json', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaCode.dc.html';
  h.api.act.move(id, { x: 9000, y: 9000 });
  await until(() => rf().getNode(id).position.x === 9000 - 36);
  await focusOn(id);
  nodeEl(id).querySelector('.dc-kebab').click();
  (await menuRow('Reset position')).click();
  await until(() => rf().getNode(id).position.x === 2880 - 36 && rf().getNode(id).position.y === 1040 - 100);
  check(!(id in h.api.state().positions), 'the saved place stayed');
});

test('Delete asks twice, then removes the window and its arrows', async () => {
  mount(await sample()); await ready();
  const id = 'ZatcaFailed.dc.html';
  await focusOn(id);
  nodeEl(id).querySelector('.dc-kebab').click();
  (await menuRow('Delete')).click();
  check(nodeEl(id), 'one click deleted the window');
  (await menuRow('Click again to delete')).click();
  await until(() => !nodeEl(id));
  check(!rf().getEdges().some((x) => x.source === id || x.target === id), 'an arrow of the deleted window stayed');
  check(h.api.state().deleted.includes(id), 'the delete is not saved');
});

test('a failed export shows the error in the menu', async () => {
  window.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('rf-test-')) return new Response('', { status: 404 });
    if (u.endsWith('ZatcaCode.dc.html')) throw new TypeError('offline');
    return realFetch(url, init);
  };
  mount(await sample()); await ready();
  const id = 'ZatcaCode.dc.html';
  await focusOn(id);
  nodeEl(id).querySelector('.dc-kebab').click();
  (await menuRow('Download PNG')).click();
  await until(() => host.querySelector('.dc-menu-error'));
  const text = host.querySelector('.dc-menu-error').textContent;
  check(text.includes('PNG export failed: offline'), 'error row: ' + text);
});

test('a chip click renders only its own window', async () => {
  mount(await sample()); await ready(); await wait(1600);
  const id = 'ZatcaDone.dc.html';
  await focusOn(id, 0.1); await wait(1200);
  const r0 = DesignCanvas.test.renders.count;
  chip(id, '390').click();
  await until(() => rf().getNode(id).width === 462);
  await wait(1200);
  const n = DesignCanvas.test.renders.count - r0;
  check(n <= 4, n + ' window renders for one chip click on a page of 10 windows');
});

test('Google Fonts export keeps the Arabic and the last Latin face', async () => {
  const css = '/* arabic */\n@font-face {font-family:Review;src:url(https://example.test/ar.woff2);unicode-range:U+0600-06FF;}\n/* latin */\n@font-face {font-family:Review;src:url(https://example.test/en.woff2);unicode-range:U+0000-00FF;}';
  const calls = [];
  window.fetch = async (url) => { calls.push(String(url)); return new Response(String(url).includes('.woff2') ? 'font' : css); };
  const out = await DesignCanvas.test.exporter.dcFontCss('https://fonts.googleapis.com/review-' + Date.now());
  check(calls.includes('https://example.test/ar.woff2') && calls.includes('https://example.test/en.woff2'), 'a font subset was dropped');
  check((out.match(/@font-face/g) || []).length === 2, 'a font face was lost');
});

test('CSS backgrounds and imported stylesheet assets rasterize at 2x', async () => {
  const { dcInlineDoc, dcSvgUrl, dcArtboardSvg } = DesignCanvas.test.exporter;
  const c = document.createElement('canvas'); c.width = c.height = 10;
  const ctx = c.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 10, 10);
  const red = c.toDataURL();
  const calls = [];
  window.fetch = async (url) => {
    const u = new URL(url, location.href); calls.push(u.pathname);
    if (u.pathname === '/styles/main.css') return new Response('@import "nested/background.css";');
    if (u.pathname === '/styles/nested/background.css') return new Response('body{margin:0;width:100px;height:100px;background-image:url(../red.png)}');
    if (u.pathname === '/styles/red.png') return realFetch(red);
    return new Response('', { status: 404 });
  };
  const html = '<html><head><link rel="stylesheet" href="/styles/main.css"></head><body></body></html>';
  // Download PNG's own wrapper at its own 2x scale, so this check fails if the
  // export path changes under it.
  const xhtml = await dcInlineDoc(html, location.href);
  const image = new Image(); image.src = dcSvgUrl(dcArtboardSvg(xhtml, 100, 100, 2)); await image.decode();
  check(image.naturalWidth === 200, 'the export SVG did not rasterize at 2x, got ' + image.naturalWidth);
  ctx.drawImage(image, 0, 0, 10, 10);
  const pixel = ctx.getImageData(5, 5, 1, 1).data;
  check(pixel[0] > 240 && pixel[1] < 20, 'the background rasterized white instead of red');
  check(calls.includes('/styles/red.png'), 'a CSS URL resolved against the wrong base');
  check(xhtml.includes('data:image/png'), 'the HTML export still depends on an external background');
});
