import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET, rankLive, createLiveBudget, boxesOf } from './liveBudget.js';

// A 1000 × 800 view at zoom 1, so world px = screen px. Its middle is (500, 400).
const V = { x: 0, y: 0, zoom: 1 }, P = { w: 1000, h: 800 };
const box = (id, x, y, w = 200, h = 200) => ({ id, x, y, w, h });
const one = { ...BUDGET, size: 1 };
const rank = (prev, boxes, cfg = BUDGET, touched = new Map(), now = 0, view = V) => rankLive(new Set(prev), view, P, boxes, touched, now, cfg);

describe('rankLive', () => {
  it('puts a visible window before a nearer window off screen', () => {
    // A: visible in the corner, 612 px from the middle. B: above the view, 450 px.
    expect(rank([], [box('A', 980, 780), box('B', 400, -250)], one)).toEqual(['A']);
  });
  it('keeps the budget of 8', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => box('w' + i, i * 60, 100, 50, 50));
    expect(rank([], boxes)).toHaveLength(8);
  });
  it('lets a live window count 400 px nearer, and drops it only past 1600 px', () => {
    // Z is 600 px left of the view (1100 px from the middle), W is 300 px right (800 px).
    const boxes = [box('Z', -800, 350, 200, 100), box('W', 1300, 350, 200, 100)];
    expect(rank(['Z'], boxes, one)).toEqual(['Z']);
    expect(rank([], boxes, one)).toEqual(['W']);   // not live, Z is past the 600 px mount margin
  });
  it('drops a live window more than 1600 px outside the view', () => {
    expect(rank(['F'], [box('F', 2700, 300)], one)).toEqual([]);
  });
  it('lets a touched window outrank other off-screen windows, never a visible one', () => {
    const touched = new Map([['T', 1000]]);
    expect(rank([], [box('V', 980, 780), box('T', 1300, 350, 200, 100)], one, touched, 2000)).toEqual(['V']);
    expect(rank([], [box('U', 400, -250), box('T', 1300, 350, 200, 100)], one, touched, 2000)).toEqual(['T']);
    expect(rank([], [box('U', 400, -250), box('T', 1300, 350, 200, 100)], one, touched, 6000)).toEqual(['U']);
  });
  it('never drops a live window that is on screen (the sticky rule)', () => {
    const boxes = [box('A', 980, 780), box('C', 450, 350, 100, 100)];
    expect(rank(['A'], boxes, one)).toEqual(['A']);
    expect(rank([], boxes, one)).toEqual(['C']);
  });
  it('never returns more than the budget', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => box('w' + i, i * 60, 100, 50, 50));
    const prev = ['w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w11'];
    const got = rank(prev, boxes);
    expect(got).toHaveLength(8);
    expect(new Set(got)).toEqual(new Set(prev));
  });
  it('maps world boxes through the view', () => {
    expect(rank([], [box('X', 2000, 0)], one, new Map(), 0, { x: -1000, y: 0, zoom: 0.5 })).toEqual(['X']);
  });
});

describe('createLiveBudget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const tenVisible = Array.from({ length: 10 }, (_, i) => box('w' + i, i * 90, 100, 80, 80));

  it('runs a pass 600 ms after the last call and mounts one window each 60 ms', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.schedule(); vi.advanceTimersByTime(300); b.schedule();
    vi.advanceTimersByTime(599); expect(b.liveIds()).toEqual([]);
    vi.advanceTimersByTime(1); expect(b.liveIds()).toHaveLength(1);
    vi.advanceTimersByTime(60); expect(b.liveIds()).toHaveLength(2);
    vi.advanceTimersByTime(60 * 6); expect(b.liveIds()).toHaveLength(8);
    vi.advanceTimersByTime(5000); expect(b.liveIds()).toHaveLength(8);
  });
  it('runs no pass between moveStart and moveEnd', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.schedule(); vi.advanceTimersByTime(300);
    b.moveStart(); b.schedule(); vi.advanceTimersByTime(5000);
    expect(b.liveIds()).toEqual([]);
    b.moveEnd(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toHaveLength(1);
  });
  it('keeps the hold of a card drag when a pan that overlaps it ends', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.dragStart(); b.moveStart();
    b.moveEnd(); vi.advanceTimersByTime(4000);
    expect(b.liveIds()).toEqual([]);
    b.dragEnd(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toHaveLength(1);
    b.dispose();
  });
  it('keeps the hold of a pan when a card drag that overlaps it ends', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.moveStart(); b.dragStart();
    b.dragEnd(); vi.advanceTimersByTime(4000);
    expect(b.liveIds()).toEqual([]);
    b.moveEnd(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toHaveLength(1);
    b.dispose();
  });
  it('frees the view on one end, because a pinch starts for each tick', () => {
    // React Flow reports a start for each wheel tick and one end for the
    // gesture, so the hold must not count the starts.
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    for (let i = 0; i < 6; i++) b.moveStart();
    b.moveEnd(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toHaveLength(1);
    b.dispose();
  });
  it('frees a hold whose end was lost', () => {
    // A second touch finger aborts a card drag: no onNodeDragStop follows.
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible }), now: () => Date.now() });
    b.dragStart(); vi.advanceTimersByTime(4999);
    expect(b.liveIds()).toEqual([]);
    vi.advanceTimersByTime(1 + 600);
    expect(b.liveIds()).toHaveLength(1);
    b.dispose();
  });
  it('tells the subscribers of each change', () => {
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes: tenVisible.slice(0, 2) }), now: () => Date.now() });
    const heard = vi.fn();
    const off = b.subscribe(heard);
    b.schedule(); vi.advanceTimersByTime(600 + 60);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(b.isLive('w0') && b.isLive('w1')).toBe(true);
    off(); b.dispose();
  });
  it('keeps a touched window off screen in the budget', () => {
    const boxes = [box('U', 400, -250), box('T', 1300, 350, 200, 100)];
    const b = createLiveBudget({ read: () => ({ view: V, pane: P, boxes }), cfg: one, now: () => Date.now() });
    b.touch('T'); b.schedule(); vi.advanceTimersByTime(600);
    expect(b.liveIds()).toEqual(['T']);
  });
});

describe('boxesOf', () => {
  it('gives the window boxes only', () => {
    const nodes = [
      { id: 'a', type: 'window', position: { x: 1, y: 2 }, width: 3, height: 4 },
      { id: 'note:n', type: 'note', position: { x: 0, y: 0 } },
    ];
    expect(boxesOf(nodes)).toEqual([{ id: 'a', x: 1, y: 2, w: 3, h: 4 }]);
  });
});
