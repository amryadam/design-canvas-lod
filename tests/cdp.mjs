// Starts a static server at the worktree root and a HEADFUL Chrome (the GPU
// must be on), and talks to it through the DevTools protocol. Node 26+.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'tests', 'out');
export const VIEW = { width: 1280, height: 800, dpr: 2 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

// The pages the headful scripts open. tests/blank-check.mjs and
// perf/frames.mjs both read ENGINES.new.
export const ENGINES = {
  new: { sample: '/sample/index.html', tall: '/tests/blank.html', target: '.react-flow__pane',
    count: `document.querySelectorAll('.react-flow__node-window').length`, zoom: `window.dcCanvas.api.rf.getZoom()` },
};

export async function launch() {
  mkdirSync(outDir, { recursive: true });
  const httpPort = await freePort(), dbgPort = await freePort();
  const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const server = spawn('python3', ['-m', 'http.server', String(httpPort)], { cwd: root, stdio: 'ignore' });
  const chrome = spawn(chromePath, [
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000',
    '--user-data-dir=' + path.join(root, 'tests', '.chrome-profile-gpu'),
    '--remote-debugging-port=' + dbgPort, 'about:blank',
  ], { stdio: 'ignore' });
  const stop = (code = 0) => { chrome.kill(); server.kill(); process.exit(code); };

  let targets = [];
  for (let i = 0; i < 50 && !targets.length; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json(); } catch {}
    if (!targets.length) await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('no page target'); stop(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    const timer = setTimeout(() => { pending.delete(mid); reject(new Error('send timeout: ' + method)); }, 30000);
    pending.set(mid, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  // The Python HTTP server starts alongside Chrome but is not always ready
  // by the time Chrome navigates, so wait until it answers before returning.
  let serverUp = false;
  for (let t = 0; t < 10000 && !serverUp; t += 100) {
    try { serverUp = (await fetch(`http://127.0.0.1:${httpPort}/`)).ok; } catch { await sleep(100); }
  }
  if (!serverUp) { console.error('http server did not come up on port ' + httpPort); stop(2); }

  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.error || m.result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(m.error || m.result.exceptionDetails).slice(0, 400));
    return m.result.result.value;
  };
  const until = async (expr, ms = 30000) => {
    for (let t = 0; t < ms; t += 100) { if (await evaluate(`!!(${expr})`)) return; await sleep(100); }
    throw new Error('timeout: ' + expr);
  };
  // `preset` is JS that runs before the page's own scripts. localStorage must
  // be set this way: the old canvas writes its view on pagehide, so a value
  // set on the old document would be overwritten.
  const open = async (urlPath, preset) => {
    let sid;
    if (preset) sid = (await send('Page.addScriptToEvaluateOnNewDocument', { source: preset })).result.identifier;
    await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}${urlPath}` });
    await until(`document.readyState === 'complete'`);
    if (sid) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid });
    const href = await evaluate('location.href');
    if (href.startsWith('chrome-error://')) throw new Error('navigation failed, got ' + href);
  };
  const screenshot = async (file, clip) => {
    const m = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(path.join(outDir, file), Buffer.from(m.result.data, 'base64'));
    return m.result.data;
  };
  // Main-thread busy time so far, in ms.
  const busy = async () => (await send('Performance.getMetrics')).result.metrics.find((x) => x.name === 'TaskDuration').value * 1000;

  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.dpr, mobile: false });
  return { send, evaluate, until, open, screenshot, busy, stop };
}
