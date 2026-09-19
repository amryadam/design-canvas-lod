import { describe, expect, it } from 'vitest';
import { DC } from './constants.js';

describe('DC', () => {
  it('holds the numbers the spike made binding', () => {
    expect(DC.liveBudget).toBe(8);
    expect(DC.stickySettleMs).toBe(600);
  });
  it('keeps the old window chrome, view limits and saved-state timing', () => {
    expect([DC.winHead, DC.winPad, DC.minZoom, DC.maxZoom, DC.fitPad]).toEqual([64, 36, 0.05, 4, 80]);
    expect([DC.stateTimeoutMs, DC.saveDebounceMs, DC.mountGapMs]).toEqual([1500, 400, 60]);
  });
});
