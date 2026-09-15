import { describe, expect, test } from 'vitest';
import legacy from '../../sample/canvas.json';
import { applyCommand, emptyOverrides } from '../../src/domain/commands';
import { migrateLegacy } from '../../src/domain/migrate';
import type { Journey } from '../../src/domain/model';
import { parseOverrides } from '../../src/domain/validate';

const base = migrateLegacy(legacy, 'sample-invoices');
const page = base.pages[0].id;

describe('applyCommand', () => {
  test('preserves revision and resets authored and added items with defined semantics', () => {
    const note = { id: 'new-note', pageId: page, text: '', width: 100, position: { x: 1, y: 2 } };
    let edits = { ...emptyOverrides(base.workspaceId), revision: 41 };
    edits = applyCommand(base, edits, { type: 'move', kind: 'screen', id: base.screens[0].id, position: { x: 3, y: 4 } });
    edits = applyCommand(base, edits, { type: 'add-note', note });
    edits = applyCommand(base, edits, { type: 'move', kind: 'note', id: note.id, position: { x: 5, y: 6 } });
    edits = applyCommand(base, edits, { type: 'edit-note', id: note.id, text: 'later' });
    const reset = applyCommand(base, edits, { type: 'reset-layout' });

    expect(reset.revision).toBe(41);
    expect(reset.screens[base.screens[0].id]?.position).toBeUndefined();
    expect(reset.notes[note.id]).toEqual({ text: 'later' });
    expect(reset.addedNotes[0]).toEqual(note);
    expect(applyCommand(base, reset, { type: 'reset-item', kind: 'note', id: note.id }).addedNotes).toEqual([]);
    expect(applyCommand(base, reset, { type: 'clear-all' })).toEqual(emptyOverrides(base.workspaceId));
  });

  test('deleting additions removes them while deleting baseline items writes tombstones', () => {
    const added: Journey = { id: 'new-journey', pageId: page, source: base.screens[0].id, target: base.screens[1].id, sourceSide: 'r', targetSide: 'l', label: '', dashed: false };
    let edits = applyCommand(base, emptyOverrides(base.workspaceId), { type: 'add-journey', journey: added });
    edits = applyCommand(base, edits, { type: 'delete', kind: 'journey', id: added.id });
    expect(edits.addedJourneys).toEqual([]);
    expect(edits.journeys[added.id]).toBeUndefined();

    const deleted = applyCommand(base, edits, { type: 'delete', kind: 'journey', id: base.journeys[0].id });
    expect(deleted.journeys[base.journeys[0].id]).toEqual({ deleted: true });
  });

  test('preserves journey identity on valid reconnection and rejects invalid or cross-page endpoints', () => {
    const original = base.journeys[0];
    const target = base.screens.find((screen) => screen.pageId === original.pageId && screen.id !== original.target)!;
    const edited = applyCommand(base, emptyOverrides(base.workspaceId), { type: 'edit-journey', id: original.id, patch: { target: target.id, targetSide: 'b' } });
    expect(edited.journeys[original.id]).toEqual({ target: target.id, targetSide: 'b' });

    expect(() => applyCommand(base, edited, { type: 'edit-journey', id: original.id, patch: { source: 'missing' } })).toThrow('source');
    const otherPageBase = structuredClone(base);
    otherPageBase.pages.push({ id: 'other', name: 'Other' });
    otherPageBase.screens[1].pageId = 'other';
    expect(() => applyCommand(otherPageBase, emptyOverrides(base.workspaceId), { type: 'edit-journey', id: original.id, patch: { target: otherPageBase.screens[1].id } })).toThrow('same page');
  });

  test('rejects invalid connection sides supplied at the runtime boundary', () => {
    const original = base.journeys[0];
    expect(() => applyCommand(base, emptyOverrides(base.workspaceId), {
      type: 'edit-journey', id: original.id, patch: { sourceSide: 'x' },
    } as unknown as Parameters<typeof applyCommand>[2])).toThrow('sourceSide');
  });

  test('rejects undeclared journey patch fields before they can replace stable identity', () => {
    const original = base.journeys[0];
    expect(() => applyCommand(base, emptyOverrides(base.workspaceId), {
      type: 'edit-journey', id: original.id, patch: { id: 'replacement' },
    } as unknown as Parameters<typeof applyCommand>[2])).toThrow('unknown field');
  });

  test('handles record keys that collide with object prototypes', () => {
    const collisionBase = structuredClone(base);
    collisionBase.screens[0].id = '__proto__';
    collisionBase.journeys = [];
    const edits = applyCommand(collisionBase, emptyOverrides(base.workspaceId), { type: 'move', kind: 'screen', id: '__proto__', position: { x: 7, y: 8 } });
    expect(Object.hasOwn(edits.screens, '__proto__')).toBe(true);
    expect(edits.screens['__proto__']).toEqual({ position: { x: 7, y: 8 } });
  });
});

describe('parseOverrides', () => {
  const valid = () => ({ ...emptyOverrides(base.workspaceId), addedNotes: [{ id: 'orphan-note', pageId: 'removed-page', text: '', width: 100, position: { x: 0, y: 0 } }], addedJourneys: [{ id: 'orphan-journey', pageId: 'removed-page', source: 'gone-a', target: 'gone-b', sourceSide: 'r', targetSide: 'l', label: '', dashed: false }] });

  test('accepts structurally valid orphaned patches and additions', () => {
    expect(parseOverrides(valid(), base.workspaceId)).toEqual(valid());
  });

  test.each([
    [{ ...valid(), version: 2 }, '$.version'],
    [{ ...valid(), workspaceId: 'foreign' }, '$.workspaceId'],
    [{ ...valid(), addedNotes: [valid().addedNotes[0], valid().addedNotes[0]] }, 'must be unique'],
    [{ ...valid(), addedJourneys: [{ ...valid().addedJourneys[0], sourceSide: 'x' }] }, 'sourceSide'],
    [{ ...valid(), screens: { screen: { position: { x: Infinity, y: 0 } } } }, 'position.x'],
  ])('rejects malformed imported overrides', (input, message) => {
    expect(() => parseOverrides(input, base.workspaceId)).toThrow(message);
  });
});
