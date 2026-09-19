import { describe, expect, it } from 'vitest';
import { fitView, anyOnScreen, isMouseWheel, zoomAround, createInvZoom } from './view.js';

const P = { w: 1280, h: 800 };

describe('fitView', () => {
  it('leaves 80 px around the content', () => {
    const v = fitView({ x: 0, y: 0, width: 2000, height: 1000 }, P);
    expect(v.zoom).toBeCloseTo(0.56, 10);
    expect(v.x).toBeCloseTo(80, 6);
    expect(v.y).toBeCloseTo(120, 6);
  });
  it('never goes above 1:1', () => {
    expect(fitView({ x: 50, y: 50, width: 100, height: 100 }, P)).toEqual({ zoom: 1, x: 540, y: 300 });
  });
});

describe('anyOnScreen', () => {
  it('tests boxes through the view', () => {
    const view = { x: -1000, y: 0, zoom: 0.5 };
    expect(anyOnScreen([{ x: 2000, y: 0, w: 100, h: 100 }], view, P)).toBe(true);
    expect(anyOnScreen([{ x: 0, y: 0, w: 100, h: 100 }], view, P)).toBe(false);
  });
});

describe('wheel', () => {
  it('knows a mouse wheel from a trackpad scroll', () => {
    expect(isMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 3.5 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 2, deltaY: 100 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 20 })).toBe(false);
  });
  it('zooms around the pointer and clamps the zoom', () => {
    const v = zoomAround({ x: 10, y: 20, zoom: 1 }, 500, 400, 2);
    expect(v).toEqual({ zoom: 2, x: -480, y: -360 });
    expect(zoomAround({ x: 0, y: 0, zoom: 3 }, 0, 0, 2).zoom).toBe(4);
    expect(zoomAround({ x: 0, y: 0, zoom: 0.06 }, 0, 0, 0.5).zoom).toBe(0.05);
  });
});

describe('createInvZoom', () => {
  it('writes on the first call, each 1.25x change, and on force', () => {
    const writes = [];
    const el = { style: { setProperty: (name, value) => writes.push([name, value]) } };
    const inv = createInvZoom(() => el);
    inv(1); inv(1.2); inv(1.3); inv(1.31, true);
    expect(writes).toEqual([['--dc-inv-zoom', '1'], ['--dc-inv-zoom', String(1 / 1.3)], ['--dc-inv-zoom', String(1 / 1.31)]]);
  });
});
