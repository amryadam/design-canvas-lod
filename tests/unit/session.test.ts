import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { emptyOverrides } from '../../src/domain/commands';
import type { Baseline, Overrides } from '../../src/domain/model';
import type { HostAdapter } from '../../src/hosts/types';
import { restoreSession } from '../../src/persistence/session';

const baseline: Baseline = {
  version: 1,
  workspaceId: 'alpha',
  pages: [{ id: 'page', name: 'Page' }],
  screens: [{ id: 'screen', pageId: 'page', title: 'Screen', position: { x: 0, y: 0 }, defaultVariantId: 'default', variants: [{ id: 'default', file: 'screen.html', label: 'Default', width: 100, height: 100 }] }],
  notes: [],
  journeys: [],
};

class FakeStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function overrides(revision: number, x: number, workspaceId = 'alpha'): Overrides {
  return { ...emptyOverrides(workspaceId), revision, screens: { screen: { position: { x, y: 0 } } } };
}

function host(file: unknown = null, writeOverrides?: (document: Overrides) => Promise<void>): HostAdapter {
  return {
    resolveAsset: (path) => path,
    readBaseline: async () => baseline,
    readManifest: async () => ({}),
    readOverrides: async () => file,
    writeOverrides,
  };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('restoreSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test.each([
    [8, 3, 8, 80],
    [3, 8, 8, 30],
    [8, 8, 8, 80],
  ])('selects browser and file revisions with browser winning ties', async (browserRevision, fileRevision, expectedRevision, expectedX) => {
    const storage = new FakeStorage();
    storage.setItem('rf-workspace:v1:alpha', JSON.stringify(overrides(browserRevision, browserRevision * 10)));
    const session = await restoreSession(host(overrides(fileRevision, fileRevision * 10)), storage, new AbortController().signal);
    expect(session.read().overrides.revision).toBe(expectedRevision);
    expect(session.read().resolved.screens[0].position.x).toBe(expectedX);
  });

  test('times out override restore after 1500ms and ignores its late result', async () => {
    let resolveFile!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { resolveFile = resolve; });
    const storage = new FakeStorage();
    storage.setItem('rf-workspace:v1:alpha', JSON.stringify(overrides(2, 20)));
    const restoring = restoreSession({ ...host(), readOverrides: async () => pending }, storage, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1500);
    const session = await restoring;
    expect(session.read().overrides.revision).toBe(2);
    expect(session.read().warnings.some((warning) => warning.channel === 'file' && warning.code === 'timeout')).toBe(true);
    session.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 99, y: 0 } });
    resolveFile(overrides(100, 100));
    await flush();
    expect(session.read().resolved.screens[0].position.x).toBe(99);
  });

  test('reports invalid file overrides and falls back to valid browser state', async () => {
    const storage = new FakeStorage();
    storage.setItem('rf-workspace:v1:alpha', JSON.stringify(overrides(4, 40)));
    const session = await restoreSession(host({ version: 99 }), storage, new AbortController().signal);
    expect(session.read().overrides.revision).toBe(4);
    expect(session.read().warnings.some((warning) => warning.channel === 'file' && warning.code === 'invalid')).toBe(true);
  });

  test('isolates browser state by baseline workspace id and reports rejected browser writes', async () => {
    const storage = new FakeStorage();
    const other = structuredClone(baseline); other.workspaceId = 'beta';
    const alpha = await restoreSession(host(), storage, new AbortController().signal);
    alpha.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 7, y: 0 } });
    const beta = await restoreSession({ ...host(), readBaseline: async () => other }, storage, new AbortController().signal);
    expect(beta.read().overrides.workspaceId).toBe('beta');
    expect(beta.read().overrides.revision).toBe(0);

    const rejecting = new FakeStorage();
    rejecting.setItem = () => { throw new Error('quota'); };
    const failed = await restoreSession(host(), rejecting, new AbortController().signal);
    failed.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 8, y: 0 } });
    expect(failed.read().status.local).toBe('failed');
    expect(failed.read().warnings.some((warning) => warning.channel === 'browser')).toBe(true);
  });

  test('increments from the prior revision for clear-all and never lowers revision on import', async () => {
    vi.setSystemTime(10);
    const storage = new FakeStorage();
    storage.setItem('rf-workspace:v1:alpha', JSON.stringify(overrides(50, 50)));
    const session = await restoreSession(host(), storage, new AbortController().signal);
    session.dispatch({ type: 'clear-all' });
    expect(session.read().overrides.revision).toBe(51);
    session.importOverrides(overrides(1, 1));
    expect(session.read().overrides.revision).toBe(52);
    expect(session.read().resolved.screens[0].position.x).toBe(1);
  });

  test('rejects invalid imports without changing state', async () => {
    const session = await restoreSession(host(), new FakeStorage(), new AbortController().signal);
    const before = session.exportOverrides();
    expect(() => session.importOverrides({ version: 99 })).toThrow();
    expect(session.exportOverrides()).toBe(before);
  });

  test('serializes debounced host writes and follows an in-flight write with the newest edit', async () => {
    const documents: Overrides[] = [];
    const completions: Array<() => void> = [];
    const writer = (document: Overrides) => new Promise<void>((resolve) => { documents.push(structuredClone(document)); completions.push(resolve); });
    const session = await restoreSession(host(null, writer), new FakeStorage(), new AbortController().signal);
    session.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 1, y: 0 } });
    await vi.advanceTimersByTimeAsync(400);
    expect(documents.map((item) => item.revision)).toEqual([session.read().overrides.revision]);
    session.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 2, y: 0 } });
    await vi.advanceTimersByTimeAsync(400);
    expect(documents).toHaveLength(1);
    completions[0](); await flush();
    expect(documents).toHaveLength(2);
    expect(documents[1].screens.screen.position?.x).toBe(2);
    completions[1](); await flush();
    expect(session.read().status.file).toBe('saved');
  });

  test('retries failed host writes and disposal suppresses stale completion updates', async () => {
    const writer = vi.fn<(_: Overrides) => Promise<void>>().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const session = await restoreSession(host(null, writer), new FakeStorage(), new AbortController().signal);
    let notifications = 0; session.subscribe(() => { notifications += 1; });
    session.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 3, y: 0 } });
    await vi.advanceTimersByTimeAsync(400); await flush();
    expect(session.read().status.file).toBe('failed');
    session.retrySave(); await flush();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(session.read().status.file).toBe('saved');

    let finish!: () => void;
    const late = await restoreSession(host(null, () => new Promise<void>((resolve) => { finish = resolve; })), new FakeStorage(), new AbortController().signal);
    let lateNotifications = 0; late.subscribe(() => { lateNotifications += 1; });
    late.dispatch({ type: 'move', kind: 'screen', id: 'screen', position: { x: 4, y: 0 } });
    await vi.advanceTimersByTimeAsync(400);
    late.dispose(); const countAtDispose = lateNotifications;
    finish(); await flush();
    expect(lateNotifications).toBe(countAtDispose);
    expect(notifications).toBeGreaterThan(0);
  });

  test('bounds baseline reads and exposes a retryable restore error', async () => {
    const restoring = restoreSession({ ...host(), readBaseline: async () => new Promise(() => {}) }, new FakeStorage(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(restoring).rejects.toMatchObject({ name: 'RestoreError', retryable: true });
  });
});
