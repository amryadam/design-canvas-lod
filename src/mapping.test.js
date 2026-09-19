import { describe, expect, it, vi } from 'vitest';
import { readPage, buildNodes, buildEdges, actions, flowKey, screenOf, windowBox } from './mapping.js';

const empty = () => ({ updatedAt: 0, positions: {}, variants: {}, arrowSides: {}, deleted: [] });
const DATA = {
  pages: [{ id: 'p', name: 'Sign in' }],
  artboards: [
    { file: 'SignIn.dc.html', x: 0, y: 0, w: 1440, h: 900, title: 'Sign in · 1440×900', page: 'p' },
    { file: 'SignInWrong.dc.html', x: 0, y: 1200, w: 1440, h: 900, title: 'Sign in · wrong · 1440×900', page: 'p' },
    { file: 'SignInPhone.dc.html', x: 0, y: 2400, w: 390, h: 844, title: 'Sign in · 390×844', page: 'p' },
    { file: 'Home.dc.html', x: 3000, y: 0, w: 1440, h: 1000, title: 'Home', page: 'p' },
    { file: 'Other.dc.html', x: 0, y: 0, w: 100, h: 100, page: 'q' },
  ],
  annotations: [{ id: 'n1', x: 0, y: -300, w: 980, text: 'Note', page: 'p' }],
  flows: [
    { page: 'p', from: 'SignIn.dc.html', to: 'Home.dc.html', label: 'Next', fs: 'r', ts: 'l' },
    { page: 'p', from: 'SignInWrong.dc.html', to: 'Home.dc.html', label: 'Next', fs: 'r', ts: 'l' },
    { page: 'p', from: 'SignInWrong.dc.html', to: 'SignIn.dc.html', label: 'Retry' },
    { page: 'p', from: 'Home.dc.html', to: 'Gone.dc.html', label: 'x' },
    { page: 'p', from: 'Home.dc.html', to: 'SignIn.dc.html', label: 'Back', dashed: true, fs: 'b', ts: 't' },
  ],
};
const page = (warn = () => {}) => readPage(DATA, 'p', { base: './s/', warn });
const K0 = flowKey({ from: 'SignIn.dc.html', to: 'Home.dc.html', label: 'Next' });
const K1 = flowKey({ from: 'Home.dc.html', to: 'SignIn.dc.html', label: 'Back' });

describe('readPage', () => {
  it('folds the variants into their primary window', () => {
    const { windows } = page();
    expect(windows.map((w) => w.id)).toEqual(['SignIn.dc.html', 'Home.dc.html']);
    expect(windows[0]).toMatchObject({ label: 'Sign in', title: 'Sign in · 1440×900', href: './s/SignIn.dc.html' });
    expect(windows[0].variants.map((v) => v.file)).toEqual(['SignIn.dc.html', 'SignInWrong.dc.html', 'SignInPhone.dc.html']);
    expect(windows[0].variants[2]).toMatchObject({ href: './s/SignInPhone.dc.html', chip: '390', primary: false });
    expect(windows[1]).toMatchObject({ label: 'Home', variants: null });
  });
  it('reads the head and the notes of the page only', () => {
    const p = page();
    expect(p.head).toEqual({ name: 'Sign in', subtitle: '2 screens · 2 variants' });
    expect(p.notes).toEqual([{ id: 'n1', x: 0, y: -300, w: 760, text: 'Note' }]);
  });
  it('moves flows onto primaries and drops loops, duplicates and unknown screens', () => {
    const warn = vi.fn();
    const { flows } = page(warn);
    expect(flows.map((f) => [f.from, f.to, f.label, f.fs, f.ts, f.dashed])).toEqual([
      ['SignIn.dc.html', 'Home.dc.html', 'Next', 'r', 'l', false],
      ['Home.dc.html', 'SignIn.dc.html', 'Back', 'b', 't', true],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Gone.dc.html');
  });
});

describe('buildNodes', () => {
  it('grows each window around its screen and puts the head above the content', () => {
    const nodes = buildNodes(page(), empty());
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['SignIn.dc.html']).toMatchObject({ type: 'window', position: { x: -36, y: -100 }, width: 1512, height: 1036 });
    expect(byId['Home.dc.html']).toMatchObject({ position: { x: 2964, y: -100 }, width: 1512, height: 1136 });
    expect(byId['note:n1']).toMatchObject({ type: 'note', position: { x: 0, y: -300 }, data: { w: 760, text: 'Note' } });
    expect(byId['dc-head']).toMatchObject({ type: 'head', position: { x: -36, y: -336 }, origin: [0, 1], draggable: false });
  });
  it('uses the saved position and the chosen variant', () => {
    const s = { ...empty(), positions: { 'SignIn.dc.html': { x: 100, y: 200 } }, variants: { 'SignIn.dc.html': 'SignInPhone.dc.html' } };
    const n = buildNodes(page(), s).find((x) => x.id === 'SignIn.dc.html');
    expect(n).toMatchObject({ position: { x: 64, y: 100 }, width: 462, height: 980 });
    expect(n.data.moved).toBe(true);
    expect(n.data.size.href).toBe('./s/SignInPhone.dc.html');
  });
  it('drops a deleted window', () => {
    const nodes = buildNodes(page(), { ...empty(), deleted: ['Home.dc.html'] });
    expect(nodes.map((n) => n.id)).toEqual(['SignIn.dc.html', 'note:n1', 'dc-head']);
  });
  it('keeps the data of a window that did not change', () => {
    const p = page(), cache = new Map();
    const a = buildNodes(p, empty(), cache);
    const b = buildNodes(p, { ...empty(), variants: { 'Home.dc.html': 'Home.dc.html' } }, cache);
    expect(b[0].data).toBe(a[0].data);
  });
});

describe('buildEdges', () => {
  it('gives each flow its authored sides', () => {
    const edges = buildEdges(page(), empty());
    expect(edges.map((e) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data.dashed])).toEqual([
      ['flow-0', 'SignIn.dc.html', 'Home.dc.html', 'r', 'l', false],
      ['flow-1', 'Home.dc.html', 'SignIn.dc.html', 'b', 't', true],
    ]);
    expect(buildEdges(page(), { ...empty(), deleted: ['Home.dc.html'] })).toEqual([]);
  });
  it('lets saved sides win and marks the windows whose sides moved', () => {
    const s = { ...empty(), arrowSides: { [K0]: { fs: 'b' } } };
    const e = buildEdges(page(), s)[0];
    expect([e.sourceHandle, e.targetHandle]).toEqual(['b', 'l']);
    const nodes = buildNodes(page(), s);
    expect(nodes.find((n) => n.id === 'SignIn.dc.html').data.sidesMoved).toBe(true);
    expect(nodes.find((n) => n.id === 'Home.dc.html').data.sidesMoved).toBe(false);
  });
});

describe('actions', () => {
  it('moves, resets and deletes, and bumps the revision', () => {
    let s = actions.move(empty(), 'A', { x: 1, y: 2 });
    expect(s.positions.A).toEqual({ x: 1, y: 2 });
    expect(s.updatedAt).toBeGreaterThan(0);
    const before = s.updatedAt;
    s = actions.resetPosition(s, 'A');
    expect(s.positions).toEqual({});
    expect(s.updatedAt).toBeGreaterThan(before);
    s = actions.remove(actions.remove(s, 'B'), 'B');
    expect(s.deleted).toEqual(['B']);
    expect(actions.pickVariant(s, 'A', 'A2').variants).toEqual({ A: 'A2' });
  });
  it('sets arrow sides and resets only the sides of one window', () => {
    let s = actions.setSides(empty(), K0, { fs: 'b' });
    s = actions.setSides(s, K0, { ts: 't' });
    s = actions.setSides(s, K1, { ts: 'r' });
    expect(s.arrowSides[K0]).toEqual({ fs: 'b', ts: 't' });
    expect(actions.resetSides(s, 'SignIn.dc.html').arrowSides).toEqual({ [K0]: { ts: 't' } });
  });
  it('maps a node position to the screen and back', () => {
    const size = { width: 1440, height: 900 };
    const box = windowBox({ x: 10, y: 20 }, size);
    expect(box).toEqual({ x: -26, y: -80, w: 1512, h: 1036 });
    expect(screenOf({ x: box.x, y: box.y })).toEqual({ x: 10, y: 20 });
  });
});
