import type { Baseline, Journey, Note, Overrides, Resolved, Screen } from './model';

export function reconcile(base: Baseline, edits: Overrides): Resolved {
  const screens = base.screens.flatMap((screen): Resolved['screens'] => {
    const patch = Object.hasOwn(edits.screens, screen.id) ? edits.screens[screen.id] : undefined;
    if (patch?.deleted) return [];
    const variantId = patch?.variantId && screen.variants.some((variant) => variant.id === patch.variantId)
      ? patch.variantId
      : screen.defaultVariantId;
    return [{ ...screen, position: patch?.position ? { ...patch.position } : { ...screen.position }, variantId }];
  });

  const notes: Note[] = [...base.notes, ...edits.addedNotes].flatMap((note) => {
    const patch = Object.hasOwn(edits.notes, note.id) ? edits.notes[note.id] : undefined;
    if (patch?.deleted) return [];
    return [{ ...note, ...patch, position: patch?.position ? { ...patch.position } : { ...note.position } }];
  });

  const screenById = new Map(screens.map((screen) => [screen.id, screen]));
  const journeys: Journey[] = [...base.journeys, ...edits.addedJourneys].flatMap((journey) => {
    const patch = Object.hasOwn(edits.journeys, journey.id) ? edits.journeys[journey.id] : undefined;
    if (patch?.deleted) return [];
    const resolved = { ...journey, ...patch };
    const source = screenById.get(resolved.source);
    const target = screenById.get(resolved.target);
    if (!source || !target || source.pageId !== resolved.pageId || target.pageId !== resolved.pageId) return [];
    return [resolved];
  });

  return { screens, notes, journeys };
}
