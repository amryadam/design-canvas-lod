// Helpers for the React Flow canvas checks. tests/run.mjs serves the
// repository and opens tests/regressions.html in headless Chrome. Each
// check registers with test(); run-all.js runs them in order.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function until(fn, ms = 5000) {
  for (let t = 0; t < ms; t += 20) { if (fn()) return; await wait(20); }
  throw new Error('Timed out waiting for DOM/state');
}
const realFetch = window.fetch.bind(window);
const host = document.getElementById('fixture');
const SAMPLE = '../sample/';
const TESTS = [];
let h = null;   // the mounted canvas of the running check; run-all.js unmounts it
function test(name, fn) { TESTS.push({ name, fn }); }

let sampleCache = null;
async function sample() {
  if (!sampleCache) sampleCache = await (await realFetch(SAMPLE + 'canvas.json')).json();
  return JSON.parse(JSON.stringify(sampleCache));
}
// A page of n windows in rows of `cols`, made of the sample's 1440-wide
// screens. Each file name is unique (?i=N) and keeps its own window.
async function grid(n, cols = 6) {
  const s = await sample();
  const files = s.artboards.filter((a) => a.w === 1440).map((a) => a.file);
  const artboards = [], flows = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    artboards.push({ file: `${files[i % files.length]}?i=${i}`, x: c * 2690, y: r * 1700, w: 1440, h: 900, title: `T${i}`, page: 't', variantOf: null });
    if (c > 0) flows.push({ page: 't', from: artboards[i - 1].file, to: artboards[i].file, label: 'Next', fs: 'r', ts: 'l' });
  }
  return { pages: [{ id: 't', name: 'Test page' }], artboards, annotations: [], flows };
}
// Each mount gets its own state file name, so no check sees another's state.
function mount(data, opts = {}) {
  const stateFile = 'rf-test-' + Math.random().toString(36).slice(2) + '.json';
  h = DesignCanvas.mount(host, { data, page: data.pages[0].id, base: SAMPLE, stateFile, ...opts });
  return h;
}
const ready = (ms) => until(() => h && h.api && h.api.fitted, ms);
const rf = () => h.api.rf;
const nodeEl = (id) => host.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
const iframes = () => host.querySelectorAll('.dc-card iframe').length;
const liveIds = () => [...host.querySelectorAll('.dc-win[data-live="1"]')].map((el) => el.closest('.react-flow__node').dataset.id);
function onScreen(el) {
  const r = el.getBoundingClientRect(), v = host.getBoundingClientRect();
  return r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
}
function wheel(opts) {
  host.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: 640, clientY: 450, bubbles: true, cancelable: true, ...opts,
  }));
}
