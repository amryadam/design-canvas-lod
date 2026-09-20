import { DC } from './constants.js';
import { cpVariants, cpChip, cpStripSize, dcVariant } from './variants.js';

// The key of an arrow in the saved arrowSides map. No file name and no label
// carries the separator.
export const FLOW_KEY_SEP = '\x1f';
export const flowKey = (f) => [f.from, f.to, f.label || ''].join(FLOW_KEY_SEP);
const flowKeyParts = (key) => { const [from, to] = key.split(FLOW_KEY_SEP); return { from, to }; };

// canvas.json gives the screen's top-left corner. The window grows around it:
// the header and the padding go left and up, into the gutter.
export const windowBox = (screen, size) => ({
  x: screen.x - DC.winPad,
  y: screen.y - DC.winHead - DC.winPad,
  w: size.width + DC.winPad * 2,
  h: size.height + DC.winHead + DC.winPad * 2,
});
export const screenOf = (position) => ({ x: position.x + DC.winPad, y: position.y + DC.winHead + DC.winPad });

// The shape canvas.json must have, as a message or null. A file that parses
// but holds something else drew a white page with no message before: readPage
// threw inside a useMemo, and React 18 then unmounted the whole root.
// CanvasPage shows this message in the .dc-error row the failed fetch uses.
export function dataError(data, pageId) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'canvas.json is not an object';
  if (!Array.isArray(data.artboards)) return 'canvas.json has no artboards list';
  if (!Array.isArray(data.pages) || !data.pages.length) return 'canvas.json has no pages list';
  if (pageId && !data.pages.some((p) => p && p.id === pageId)) return `canvas.json has no page ${pageId}`;
  return null;
}

// canvas.json → the page as authored. Variants fold into their primary
// window. Flows drawn on a variant land on the primary; a flow that then
// loops back on itself, a duplicate, and a flow to a screen that is not on
// the page are dropped. The lists are read with a guard, so a file that
// dataError did not see cannot throw here.
export function readPage(data, pageId, { base = './', warn = console.warn } = {}) {
  const onPage = (data.artboards || []).filter((a) => a.page === pageId);
  const { primaryOf, axesOf } = cpVariants(onPage);
  const boards = onPage.filter((a) => primaryOf(a.file) === a.file);
  const sizesOf = Object.fromEntries(boards.map((b) => [b.file, [b]]));
  onPage.forEach((a) => { const p = primaryOf(a.file); if (p !== a.file) sizesOf[p].push(a); });
  const windows = boards.map((b) => {
    const stem = b.file.split('/').pop().replace('.dc.html', '');
    const list = sizesOf[b.file];
    let variants = null;
    if (list.length > 1) {
      list.sort((p, q) => (q.w - p.w) || (q.h - p.h));
      variants = list.map((s) => ({
        file: s.file, w: s.w, h: s.h, href: base + s.file, title: s.title || s.file,
        chip: cpChip(s.w), primary: s.file === b.file, ...axesOf(s, b),
      }));
    }
    return {
      id: b.file, x: b.x, y: b.y, w: b.w, h: b.h, href: base + b.file, variants,
      label: variants ? cpStripSize(b.title || stem) : (b.title || stem),
      title: b.title || b.file,
    };
  });
  const notes = (data.annotations || []).filter((n) => n.page === pageId)
    .map((n) => ({ id: n.id, x: n.x, y: n.y, w: Math.min(n.w || 480, 760), text: n.text }));
  const known = new Set(boards.map((b) => b.file));
  const seen = new Set();
  const flows = [];
  (data.flows || []).filter((f) => f.page === pageId).forEach((f) => {
    const from = primaryOf(f.from), to = primaryOf(f.to);
    if (!known.has(from) || !known.has(to)) {
      warn(`[design-canvas] the flow ${f.from} → ${f.to} names a screen that is not on page ${pageId}; it is dropped`);
      return;
    }
    if (from === to) return;
    const flow = { from, to, label: f.label || '', dashed: !!f.dashed, fs: f.fs || 'r', ts: f.ts || 'l' };
    const key = flowKey(flow);
    if (seen.has(key)) return;
    seen.add(key);
    flows.push({ ...flow, key });
  });
  const meta = (data.pages || []).find((p) => p.id === pageId);
  const variantCount = onPage.length - boards.length;
  const head = {
    name: (meta && meta.name) || pageId,
    subtitle: `${boards.length} screens` + (variantCount ? ` · ${variantCount} variant${variantCount === 1 ? '' : 's'}` : ''),
  };
  return { windows, notes, flows, head };
}

// The windows whose arrow sides the user moved: "Reset arrow sides" shows
// in their menu only.
export function movedSides(arrowSides) {
  const out = new Set();
  Object.entries(arrowSides || {}).forEach(([key, o]) => {
    const { from, to } = flowKeyParts(key);
    if (o.fs) out.add(from);
    if (o.ts) out.add(to);
  });
  return out;
}

const DATA_KEYS = ['label', 'title', 'size', 'moved', 'sidesMoved'];
const sameData = (a, b) => DATA_KEYS.every((k) => a[k] === b[k]);

// The page plus the saved edits → React Flow nodes. `cache` lives as long as
// the page: a window keeps its size and data objects while its own inputs do
// not change, so a patch re-renders only the windows it touches.
export function buildNodes(page, state, cache = new Map()) {
  const deleted = new Set(state.deleted);
  const sides = movedSides(state.arrowSides);
  const nodes = [];
  let x0 = Infinity, y0 = Infinity;
  for (const w of page.windows) {
    if (deleted.has(w.id)) continue;
    const chosen = state.variants[w.id];
    let hit = cache.get(w.id);
    if (!hit || hit.chosen !== chosen) {
      hit = { chosen, size: dcVariant({ variants: w.variants, width: w.w, height: w.h, href: w.href }, chosen), data: null };
      cache.set(w.id, hit);
    }
    const saved = state.positions[w.id];
    const data = { label: w.label, title: w.title, size: hit.size, moved: !!saved, sidesMoved: sides.has(w.id) };
    if (!hit.data || !sameData(hit.data, data)) hit.data = data;
    const box = windowBox(saved || { x: w.x, y: w.y }, hit.size);
    x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y);
    nodes.push({
      id: w.id, type: 'window', position: { x: box.x, y: box.y }, width: box.w, height: box.h,
      // The header drags the window. With Ctrl or ⌘ held the screen does too.
      dragHandle: '.dc-winhead, .dc-grab .dc-shield', data: hit.data,
    });
  }
  for (const n of page.notes) {
    const id = 'note:' + n.id;
    const p = state.positions[id] || { x: n.x, y: n.y };
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    let hit = cache.get(id);
    if (!hit || hit.data.w !== n.w || hit.data.text !== n.text) { hit = { data: { w: n.w, text: n.text } }; cache.set(id, hit); }
    nodes.push({ id, type: 'note', position: { x: p.x, y: p.y }, connectable: false, data: hit.data });
  }
  if (Number.isFinite(x0)) {
    nodes.push({
      id: 'dc-head', type: 'head', position: { x: x0, y: y0 - DC.sectionHeadGap }, origin: [0, 1],
      draggable: false, selectable: false, connectable: false, focusable: false, data: page.head,
    });
  }
  return nodes;
}

// The flows → React Flow edges. Saved sides win over canvas.json.
export function buildEdges(page, state) {
  const deleted = new Set(state.deleted);
  const out = [];
  page.flows.forEach((f, i) => {
    if (deleted.has(f.from) || deleted.has(f.to)) return;
    const o = state.arrowSides[f.key] || {};
    out.push({
      id: 'flow-' + i, type: 'flow', source: f.from, target: f.to,
      sourceHandle: o.fs || f.fs, targetHandle: o.ts || f.ts, reconnectable: true,
      data: { key: f.key, label: f.label, dashed: f.dashed },
    });
  });
  return out;
}

// Every patch bumps the revision: the newer revision wins on the next load.
const bump = (s, p) => ({ ...s, ...p, updatedAt: Math.max(Date.now(), s.updatedAt + 1) });
export const actions = {
  move: (s, id, p) => bump(s, { positions: { ...s.positions, [id]: { x: p.x, y: p.y } } }),
  resetPosition: (s, id) => { const positions = { ...s.positions }; delete positions[id]; return bump(s, { positions }); },
  pickVariant: (s, id, file) => bump(s, { variants: { ...s.variants, [id]: file } }),
  remove: (s, id) => bump(s, { deleted: [...s.deleted.filter((d) => d !== id), id] }),
  setSides: (s, key, sides) => bump(s, { arrowSides: { ...s.arrowSides, [key]: { ...(s.arrowSides[key] || {}), ...sides } } }),
  resetSides: (s, id) => {
    const arrowSides = {};
    Object.entries(s.arrowSides).forEach(([key, o]) => {
      const { from, to } = flowKeyParts(key), r = { ...o };
      if (from === id) delete r.fs;
      if (to === id) delete r.ts;
      if (Object.keys(r).length) arrowSides[key] = r;
    });
    return bump(s, { arrowSides });
  },
};
