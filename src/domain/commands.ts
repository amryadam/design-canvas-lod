import type { Baseline, Journey, JourneyPatch, Note, NotePatch, Overrides, Point, ScreenPatch } from './model';

export type Command =
 | { type: 'move'; kind: 'screen' | 'note'; id: string; position: Point }
 | { type: 'variant'; id: string; variantId: string }
 | { type: 'add-note'; note: Note }
 | { type: 'edit-note'; id: string; text: string }
 | { type: 'add-journey'; journey: Journey }
 | { type: 'edit-journey'; id: string; patch: JourneyPatch }
 | { type: 'delete'; kind: 'screen' | 'note' | 'journey'; id: string }
 | { type: 'reset-item'; kind: 'screen' | 'note' | 'journey'; id: string }
 | { type: 'reset-layout' }
 | { type: 'clear-all' };

const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

function cloneRecord<T extends object>(source: Record<string, T>): Record<string, T> {
  const result = dictionary<T>();
  for (const key of Object.keys(source)) result[key] = { ...source[key] };
  return result;
}

function cloneOverrides(edits: Overrides): Overrides {
  return {
    ...edits,
    screens: cloneRecord(edits.screens),
    notes: cloneRecord(edits.notes),
    journeys: cloneRecord(edits.journeys),
    addedNotes: edits.addedNotes.slice(),
    addedJourneys: edits.addedJourneys.slice(),
  };
}

export function emptyOverrides(workspaceId: string): Overrides {
  if (!workspaceId) throw new Error('workspaceId must be a non-empty string');
  return { version: 1, workspaceId, revision: 0, screens: dictionary(), notes: dictionary(), journeys: dictionary(), addedNotes: [], addedJourneys: [] };
}

function assertPoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('position must contain finite coordinates');
}

function ownPatch<T extends object>(record: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

function setPatch<T extends object>(record: Record<string, T>, id: string, patch: Partial<T>): void {
  record[id] = { ...ownPatch(record, id), ...patch } as T;
}

function removePatchField<T extends object>(record: Record<string, T>, id: string, field: keyof T): void {
  if (!Object.hasOwn(record, id)) return;
  const patch = { ...record[id] };
  delete patch[field];
  if (Object.keys(patch).length) record[id] = patch;
  else delete record[id];
}

function effectiveJourney(base: Baseline, edits: Overrides, id: string): Journey | undefined {
  const source = base.journeys.find((journey) => journey.id === id) ?? edits.addedJourneys.find((journey) => journey.id === id);
  if (!source) return undefined;
  return { ...source, ...ownPatch(edits.journeys, id) };
}

function assertJourney(base: Baseline, edits: Overrides, journey: Journey): void {
  if (!journey.id || !journey.pageId || !journey.source || !journey.target) throw new Error('journey identifiers must be non-empty strings');
  if (!['l', 'r', 't', 'b'].includes(journey.sourceSide)) throw new Error('journey sourceSide must be one of l, r, t, b');
  if (!['l', 'r', 't', 'b'].includes(journey.targetSide)) throw new Error('journey targetSide must be one of l, r, t, b');
  if (typeof journey.label !== 'string' || typeof journey.dashed !== 'boolean') throw new Error('journey label and dashed values are invalid');
  const source = base.screens.find((screen) => screen.id === journey.source);
  const target = base.screens.find((screen) => screen.id === journey.target);
  if (!source) throw new Error('journey source must identify a screen');
  if (!target) throw new Error('journey target must identify a screen');
  if (source.pageId !== journey.pageId || target.pageId !== journey.pageId) throw new Error('journey endpoints must be on the same page');
  if (ownPatch(edits.screens, source.id)?.deleted || ownPatch(edits.screens, target.id)?.deleted) throw new Error('journey endpoints must identify available screens');
}

export function applyCommand(base: Baseline, edits: Overrides, command: Command): Overrides {
  if (base.workspaceId !== edits.workspaceId) throw new Error('baseline and overrides workspaceId must match');
  if (command.type === 'clear-all') return emptyOverrides(edits.workspaceId);
  const next = cloneOverrides(edits);

  if (command.type === 'move') {
    assertPoint(command.position);
    if (command.kind === 'screen') {
      if (!base.screens.some((item) => item.id === command.id)) throw new Error('screen id must identify a baseline screen');
      setPatch(next.screens, command.id, { position: { ...command.position } });
    } else {
      if (!base.notes.some((item) => item.id === command.id) && !next.addedNotes.some((item) => item.id === command.id)) throw new Error('note id must identify a note');
      setPatch(next.notes, command.id, { position: { ...command.position } });
    }
  } else if (command.type === 'variant') {
    const screen = base.screens.find((item) => item.id === command.id);
    if (!screen) throw new Error('screen id must identify a baseline screen');
    if (!screen.variants.some((variant) => variant.id === command.variantId)) throw new Error('variantId must identify a variant on the screen');
    setPatch(next.screens, command.id, { variantId: command.variantId });
  } else if (command.type === 'add-note') {
    if (base.notes.some((item) => item.id === command.note.id) || next.addedNotes.some((item) => item.id === command.note.id)) throw new Error('note id must be unique');
    if (!base.pages.some((item) => item.id === command.note.pageId)) throw new Error('note pageId must identify a page');
    assertPoint(command.note.position);
    if (!command.note.id || typeof command.note.text !== 'string' || !Number.isFinite(command.note.width) || command.note.width <= 0) throw new Error('note is invalid');
    next.addedNotes.push(structuredClone(command.note));
  } else if (command.type === 'edit-note') {
    if (typeof command.text !== 'string') throw new Error('note text must be a string');
    if (!base.notes.some((item) => item.id === command.id) && !next.addedNotes.some((item) => item.id === command.id)) throw new Error('note id must identify a note');
    setPatch(next.notes, command.id, { text: command.text });
  } else if (command.type === 'add-journey') {
    if (!command.journey.id || base.journeys.some((item) => item.id === command.journey.id) || next.addedJourneys.some((item) => item.id === command.journey.id)) throw new Error('journey id must be unique');
    assertJourney(base, next, command.journey);
    next.addedJourneys.push(structuredClone(command.journey));
  } else if (command.type === 'edit-journey') {
    const current = effectiveJourney(base, next, command.id);
    if (!current) throw new Error('journey id must identify a journey');
    const changed = { ...current, ...command.patch, id: current.id };
    assertJourney(base, next, changed);
    setPatch(next.journeys, command.id, command.patch);
  } else if (command.type === 'delete') {
    const additions = command.kind === 'note' ? next.addedNotes : command.kind === 'journey' ? next.addedJourneys : undefined;
    const addedIndex = additions?.findIndex((item) => item.id === command.id) ?? -1;
    if (additions && addedIndex >= 0) {
      additions.splice(addedIndex, 1);
      delete (command.kind === 'note' ? next.notes : next.journeys)[command.id];
    } else {
      const exists = command.kind === 'screen' ? base.screens.some((item) => item.id === command.id) : command.kind === 'note' ? base.notes.some((item) => item.id === command.id) : base.journeys.some((item) => item.id === command.id);
      if (!exists) throw new Error(`${command.kind} id must identify an item`);
      setPatch(command.kind === 'screen' ? next.screens : command.kind === 'note' ? next.notes : next.journeys, command.id, { deleted: true });
    }
  } else if (command.type === 'reset-item') {
    const additions = command.kind === 'note' ? next.addedNotes : command.kind === 'journey' ? next.addedJourneys : undefined;
    const addedIndex = additions?.findIndex((item) => item.id === command.id) ?? -1;
    if (additions && addedIndex >= 0) additions.splice(addedIndex, 1);
    delete (command.kind === 'screen' ? next.screens : command.kind === 'note' ? next.notes : next.journeys)[command.id];
  } else {
    for (const id of Object.keys(next.screens)) removePatchField(next.screens, id, 'position');
    for (const id of Object.keys(next.notes)) removePatchField(next.notes, id, 'position');
  }
  return next;
}
