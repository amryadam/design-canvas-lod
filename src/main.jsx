import { createRoot } from 'react-dom/client';
import rfCss from '@xyflow/react/dist/style.css?inline';
import css from './styles.css?inline';
import { CanvasPage } from './CanvasPage.jsx';
import * as exporter from './export.js';
import { renders } from './WindowNode.jsx';

let current = null;
function addStyles() {
  if (document.getElementById('dc-styles')) return;
  const s = document.createElement('style');
  s.id = 'dc-styles';
  s.textContent = rfCss + '\n' + css;
  document.head.appendChild(s);
}

// Mounts one canvas page into `el`. opts: { page, data, stateFile, base, host }.
// Returns { api, unmount }; `api` is filled once the page is ready.
export function mount(el, opts = {}) {
  addStyles();
  const handle = { api: null, unmount: null };
  const root = createRoot(el);
  root.render(<CanvasPage {...opts} onApi={(api) => { handle.api = api; }} />);
  handle.unmount = () => { root.unmount(); if (current === handle) current = null; };
  current = handle;
  return handle;
}
// The last mounted canvas. perf/bench.js and the measurement scripts read it.
export const last = () => current;
// Read by the browser suite only.
export const test = { exporter, renders };
