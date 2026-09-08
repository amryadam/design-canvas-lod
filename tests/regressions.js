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
function draw(file, children = E(Probe)) { root.render(E(DesignCanvas, { stateFile: file }, children)); }
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
    api.patchSection('review', { title: 'edited B' }); await wait(450);
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
  document.title = results.every((r) => r.pass) ? 'PASS: canvas regressions' : 'FAIL: canvas regressions';
  window.canvasTestResults = results;
  return results;
})();
