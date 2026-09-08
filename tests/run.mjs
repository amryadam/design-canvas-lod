// tests/run.mjs — run tests/regressions.html in headless Chrome and print the
// results. Node 26+ (built-in WebSocket). Usage: node tests/run.mjs [chrome-path]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.argv[2] || process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const httpPort = await freePort(), dbgPort = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(httpPort)], { cwd: root, stdio: 'ignore' });
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900',
  '--user-data-dir=' + path.join(root, 'tests', '.chrome-profile'),
  '--remote-debugging-port=' + dbgPort, 'about:blank',
], { stdio: 'ignore' });
const stop = (code) => { chrome.kill(); server.kill(); process.exit(code); };

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
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/tests/regressions.html` });
const res = await send('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    for (let i = 0; i < 300 && !window.canvasTestsDone; i++) await new Promise((r) => setTimeout(r, 100));
    const results = await Promise.race([window.canvasTestsDone, new Promise((r) => setTimeout(() => r(null), 180000))]);
    return { title: document.title, visibility: document.visibilityState, results };
  })()`,
});
const v = res.result && res.result.result && res.result.result.value;
if (!v || !v.results) { console.error('suite did not finish', JSON.stringify(res).slice(0, 400)); stop(2); }
for (const r of v.results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : ' :: ' + r.error));
console.log('visibility=' + v.visibility);
console.log(v.title);
stop(v.results.every((r) => r.pass) ? 0 : 1);
