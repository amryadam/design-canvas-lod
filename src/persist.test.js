import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, pickNewer, restoreState, createSaver, stateKey } from './persist.js';

const st = (updatedAt, extra = {}) => ({ updatedAt, positions: {}, variants: {}, arrowSides: {}, deleted: [], ...extra });
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};
const res = (body, ok = true) => ({ ok, json: async () => body });
const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pickNewer', () => {
  it('takes the newer revision, and the browser copy on a tie', () => {
    expect(pickNewer(st(10), st(20)).updatedAt).toBe(20);
    expect(pickNewer(st(20), st(10)).updatedAt).toBe(20);
    const local = st(5, { deleted: ['L'] });
    expect(pickNewer(st(5), local)).toBe(local);
  });
  it('ignores a state that is not valid, including the old format', () => {
    expect(pickNewer({ sections: { p: {} }, updatedAt: 99 }, st(1)).updatedAt).toBe(1);
    expect(pickNewer(st(3), 'junk').updatedAt).toBe(3);
    expect(pickNewer(null, null)).toEqual(emptyState());
  });
});

describe('restoreState', () => {
  it('reads the state file beside the page and keeps the newer copy', async () => {
    const fetchImpl = vi.fn(async () => res(st(30)));
    const storage = memStorage({ k: JSON.stringify(st(20)) });
    const s = await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl, storage });
    expect(fetchImpl.mock.calls[0][0]).toBe('./f.json');
    expect(s.updatedAt).toBe(30);
  });
  it('uses the browser copy when the file is missing or the read fails', async () => {
    const storage = memStorage({ k: JSON.stringify(st(20)) });
    expect((await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: async () => res(null, false), storage })).updatedAt).toBe(20);
    expect((await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: async () => { throw new Error('offline'); }, storage })).updatedAt).toBe(20);
  });
  it('uses the file when the browser storage throws', async () => {
    expect((await restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: async () => res(st(7)), storage: throwing })).updatedAt).toBe(7);
  });
  it('gives up on a file read that hangs after 1500 ms', async () => {
    const storage = memStorage({ k: JSON.stringify(st(20)) });
    let done = null;
    restoreState({ stateFile: 'f.json', key: 'k', fetchImpl: () => new Promise(() => {}), storage }).then((s) => { done = s; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(null);
    await vi.advanceTimersByTimeAsync(1);
    expect(done.updatedAt).toBe(20);
  });
});

describe('createSaver', () => {
  const make = (writeFile, storage = memStorage()) => {
    const events = new EventTarget();
    return { events, storage, saver: createSaver({ stateFile: 'f.json', key: 'k', storage, events, writeFile, warn: () => {} }) };
  };
  it('writes the browser copy at once and the file once after 400 ms', async () => {
    const writes = [];
    const { storage, saver } = make(async (file, text) => { writes.push([file, JSON.parse(text).updatedAt]); });
    saver.save(st(1)); saver.save(st(2));
    expect(JSON.parse(storage.getItem('k')).updatedAt).toBe(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([['f.json', 2]]);
  });
  it('sends a failed file write again on pagehide', async () => {
    let fail = true;
    const writes = [];
    const { events, saver } = make(async (file, text) => { writes.push(JSON.parse(text).updatedAt); if (fail) throw new Error('read-only'); });
    saver.save(st(3));
    await vi.advanceTimersByTimeAsync(400);
    fail = false;
    events.dispatchEvent(new Event('pagehide'));
    await saver.settled();
    expect(writes).toEqual([3, 3]);
  });
  it('does not send a written state again, also when the host has no writeFile', async () => {
    const writeFile = vi.fn(() => undefined);
    const { events, saver } = make(writeFile);
    saver.save(st(4));
    await vi.advanceTimersByTimeAsync(400);
    events.dispatchEvent(new Event('pagehide'));
    await saver.settled();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
  it('survives a browser storage that throws', async () => {
    const writeFile = vi.fn(async () => {});
    const { saver } = make(writeFile, throwing);
    expect(() => saver.save(st(5))).not.toThrow();
    await vi.advanceTimersByTimeAsync(400);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe('stateKey', () => {
  it('scopes the browser copy by page path and state file', () => {
    expect(stateKey('f.json', '/sample/index.html')).toBe('dc2-state:/sample/index.html:f.json');
  });
});
