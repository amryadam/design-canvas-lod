import { describe, expect, test } from 'vitest';
import legacy from '../../sample/canvas.json';
import { migrateLegacy } from '../../src/domain/migrate';
import type { Baseline } from '../../src/domain/model';
import { applyCommand, emptyOverrides } from '../../src/domain/commands';
import { reconcile } from '../../src/domain/reconcile';

const base = migrateLegacy(legacy, 'sample-invoices');

describe('reconcile', () => {
  test('retains edits across source renames and temporary removal by stable ID', () => {
    const id = base.screens[0].id;
    const edited = applyCommand(base, emptyOverrides(base.workspaceId), { type: 'move', kind: 'screen', id, position: { x: 12, y: 34 } });
    const renamed = structuredClone(base);
    renamed.screens[0].variants[0].file = 'renamed.html';

    expect(reconcile(renamed, edited).screens.find((screen) => screen.id === id)?.position).toEqual({ x: 12, y: 34 });
    expect(reconcile({ ...base, screens: [] }, edited).journeys).toEqual([]);
    expect(edited.screens[id]).toEqual({ position: { x: 12, y: 34 } });
    expect(reconcile(base, edited).screens.find((screen) => screen.id === id)?.position).toEqual({ x: 12, y: 34 });
  });

  test('applies tombstones and hides connections with missing or deleted endpoints', () => {
    const deletedId = base.screens[0].id;
    const edited = applyCommand(base, emptyOverrides(base.workspaceId), { type: 'delete', kind: 'screen', id: deletedId });
    const resolved = reconcile(base, edited);

    expect(resolved.screens.some((screen) => screen.id === deletedId)).toBe(false);
    expect(resolved.journeys.some((journey) => journey.source === deletedId || journey.target === deletedId)).toBe(false);
    expect(edited.journeys).toEqual({});
  });

  test('falls back to the baseline default while retaining a stale variant patch', () => {
    const screen = base.screens.find((candidate) => candidate.variants.length > 1)!;
    const chosen = screen.variants[1].id;
    const edited = applyCommand(base, emptyOverrides(base.workspaceId), { type: 'variant', id: screen.id, variantId: chosen });
    const changed = structuredClone(base);
    changed.screens.find((candidate) => candidate.id === screen.id)!.variants = [screen.variants[0]];

    expect(reconcile(changed, edited).screens.find((candidate) => candidate.id === screen.id)?.variantId).toBe(screen.defaultVariantId);
    expect(edited.screens[screen.id].variantId).toBe(chosen);
  });

  test('combines additions and patches without mutating either input', () => {
    const note = { id: 'added', pageId: base.pages[0].id, text: 'Draft', width: 200, position: { x: 1, y: 2 } };
    const edits = applyCommand(base, emptyOverrides(base.workspaceId), { type: 'add-note', note });
    const moved = applyCommand(base, edits, { type: 'move', kind: 'note', id: note.id, position: { x: 8, y: 9 } });

    expect(reconcile(base, moved).notes.find((item) => item.id === note.id)).toMatchObject({ text: 'Draft', position: { x: 8, y: 9 } });
    expect(edits.addedNotes[0]).toEqual(note);
    expect(base.notes.some((item) => item.id === note.id)).toBe(false);
  });
});
