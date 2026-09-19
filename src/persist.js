import { DC } from './constants.js';

// The saved edits of one page. canvas.json stays the authored baseline; this
// is the layer on top of it.
export const emptyState = () => ({ updatedAt: 0, positions: {}, variants: {}, arrowSides: {}, deleted: [] });
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const isState = (s) => isMap(s) && isMap(s.positions) && isMap(s.variants) && isMap(s.arrowSides) && Array.isArray(s.deleted);
const revision = (s) => (Number.isFinite(s.updatedAt) ? s.updatedAt : 0);

// The newer revision wins. The browser copy wins a tie: it can hold edits
// made where the state file cannot be written.
export function pickNewer(file, local) {
  const f = isState(file) ? file : null;
  const l = isState(local) ? local : null;
  if (l && (!f || revision(l) >= revision(f))) return l;
  return f || emptyState();
}

export const stateKey = (stateFile, path = location.pathname) => 'dc2-state:' + path + ':' + stateFile;

// Reads the state file beside the page and the browser copy. A file read
// that fails or takes longer than DC.stateTimeoutMs counts as no file.
export async function restoreState({ stateFile, key, fetchImpl = (...args) => fetch(...args),
  storage = globalThis.localStorage, timeoutMs = DC.stateTimeoutMs }) {
  const controller = new AbortController();
  let timer;
  const read = (async () => {
    const r = await fetchImpl('./' + stateFile, { signal: controller.signal });
    return r.ok ? r.json() : null;
  })().catch(() => null);
  const giveUp = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
  const file = await Promise.race([read, giveUp]);
  clearTimeout(timer);
  let local = null;
  try { local = JSON.parse(storage.getItem(key) || 'null'); } catch {}
  return pickNewer(file, local);
}

// Saves each new state. The browser copy is written at once, so a reload
// before the debounce keeps the edit. The host file (claude.ai/design's
// window.omelette.writeFile) is written DC.saveDebounceMs after the last
// save. A state counts as written only after the host write ends, so a
// failed write stays pending and pagehide sends it again.
export function createSaver({ stateFile, key, storage = globalThis.localStorage,
  events = globalThis.window || new EventTarget(),
  writeFile = (file, text) => globalThis.window?.omelette?.writeFile(file, text),
  debounceMs = DC.saveDebounceMs, warn = console.warn }) {
  let pending = null, written = null, timer = 0, chain = Promise.resolve();
  const write = () => {
    clearTimeout(timer); timer = 0;
    if (!pending || pending === written) return chain;
    const mine = pending, text = JSON.stringify(mine);
    chain = chain.then(() => writeFile(stateFile, text)).then(
      () => { written = mine; },
      (err) => warn('[design-canvas] the state file write failed; the browser copy holds the edits', err));
    return chain;
  };
  events.addEventListener('pagehide', write);
  return {
    save(state) {
      pending = state;
      try { storage.setItem(key, JSON.stringify(state)); } catch {}
      clearTimeout(timer);
      timer = setTimeout(write, debounceMs);
    },
    flush: write,
    settled: () => chain,
    dispose() { clearTimeout(timer); events.removeEventListener('pagehide', write); },
  };
}
