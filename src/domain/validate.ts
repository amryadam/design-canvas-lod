import type { Baseline, Journey, JourneyPatch, Note, NotePatch, Overrides, Point, Screen, ScreenPatch, Side, Variant } from './model';

export class ValidationError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(path, 'must be an object');
  return value as UnknownRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ValidationError(path, 'must be a non-empty string');
  return value;
}

function editableText(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ValidationError(path, 'must be a string');
  return value;
}

function finite(value: unknown, path: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new ValidationError(path, positive ? 'must be a positive finite number' : 'must be a finite number');
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError(path, 'must be an array');
  return value;
}

function unique(values: { id: string }[], path: string): void {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id)) throw new ValidationError(`${path}[${index}].id`, 'must be unique');
    ids.add(value.id);
  });
}

function parsePoint(value: unknown, path: string): Point {
  const input = record(value, path);
  return { x: finite(input.x, `${path}.x`), y: finite(input.y, `${path}.y`) };
}

function parseVariant(value: unknown, path: string): Variant {
  const input = record(value, path);
  return {
    id: string(input.id, `${path}.id`), file: string(input.file, `${path}.file`), label: string(input.label, `${path}.label`),
    width: finite(input.width, `${path}.width`, true), height: finite(input.height, `${path}.height`, true),
  };
}

function parseScreen(value: unknown, path: string): Screen {
  const input = record(value, path);
  const variants = array(input.variants, `${path}.variants`).map((variant, index) => parseVariant(variant, `${path}.variants[${index}]`));
  if (!variants.length) throw new ValidationError(`${path}.variants`, 'must not be empty');
  unique(variants, `${path}.variants`);
  const defaultVariantId = string(input.defaultVariantId, `${path}.defaultVariantId`);
  if (!variants.some((variant) => variant.id === defaultVariantId)) throw new ValidationError(`${path}.defaultVariantId`, 'must identify a variant on this screen');
  return { id: string(input.id, `${path}.id`), pageId: string(input.pageId, `${path}.pageId`), title: string(input.title, `${path}.title`), position: parsePoint(input.position, `${path}.position`), defaultVariantId, variants };
}

function parseNote(value: unknown, path: string): Note {
  const input = record(value, path);
  return { id: string(input.id, `${path}.id`), pageId: string(input.pageId, `${path}.pageId`), text: editableText(input.text, `${path}.text`), width: finite(input.width, `${path}.width`, true), position: parsePoint(input.position, `${path}.position`) };
}

function side(value: unknown, path: string): Side {
  if (value === 'l' || value === 'r' || value === 't' || value === 'b') return value;
  throw new ValidationError(path, 'must be one of l, r, t, b');
}

function parseJourney(value: unknown, path: string): Journey {
  const input = record(value, path);
  if (typeof input.dashed !== 'boolean') throw new ValidationError(`${path}.dashed`, 'must be a boolean');
  return { id: string(input.id, `${path}.id`), pageId: string(input.pageId, `${path}.pageId`), source: string(input.source, `${path}.source`), target: string(input.target, `${path}.target`), sourceSide: side(input.sourceSide, `${path}.sourceSide`), targetSide: side(input.targetSide, `${path}.targetSide`), label: editableText(input.label, `${path}.label`), dashed: input.dashed };
}

export function parseBaseline(value: unknown): Baseline {
  const input = record(value, '$');
  if (input.version !== 1) throw new ValidationError('$.version', 'must be 1');
  const pages = array(input.pages, '$.pages').map((page, index) => {
    const parsed = record(page, `$.pages[${index}]`);
    return { id: string(parsed.id, `$.pages[${index}].id`), name: string(parsed.name, `$.pages[${index}].name`) };
  });
  unique(pages, '$.pages');
  const screens = array(input.screens, '$.screens').map((screen, index) => parseScreen(screen, `$.screens[${index}]`));
  const notes = array(input.notes, '$.notes').map((note, index) => parseNote(note, `$.notes[${index}]`));
  const journeys = array(input.journeys, '$.journeys').map((journey, index) => parseJourney(journey, `$.journeys[${index}]`));
  unique(screens, '$.screens'); unique(notes, '$.notes'); unique(journeys, '$.journeys');
  const pageIds = new Set(pages.map((page) => page.id));
  screens.forEach((screen, index) => { if (!pageIds.has(screen.pageId)) throw new ValidationError(`$.screens[${index}].pageId`, 'must identify a page'); });
  notes.forEach((note, index) => { if (!pageIds.has(note.pageId)) throw new ValidationError(`$.notes[${index}].pageId`, 'must identify a page'); });
  const screenIds = new Set(screens.map((screen) => screen.id));
  journeys.forEach((journey, index) => {
    if (!pageIds.has(journey.pageId)) throw new ValidationError(`$.journeys[${index}].pageId`, 'must identify a page');
    if (!screenIds.has(journey.source)) throw new ValidationError(`$.journeys[${index}].source`, 'must identify a screen');
    if (!screenIds.has(journey.target)) throw new ValidationError(`$.journeys[${index}].target`, 'must identify a screen');
  });
  return { version: 1, workspaceId: string(input.workspaceId, '$.workspaceId'), pages, screens, notes, journeys };
}

function optionalPoint(value: unknown, path: string): Point | undefined {
  return value === undefined ? undefined : parsePoint(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(path, 'must be a boolean');
  return value;
}

function parsePatchRecord<T>(value: unknown, path: string, parser: (value: UnknownRecord, path: string) => T): Record<string, T> {
  const input = record(value, path);
  const output = Object.create(null) as Record<string, T>;
  for (const id of Object.keys(input)) {
    if (!id) throw new ValidationError(path, 'keys must be non-empty strings');
    output[id] = parser(record(input[id], `${path}.${id}`), `${path}.${id}`);
  }
  return output;
}

function screenPatch(input: UnknownRecord, path: string): ScreenPatch {
  const output: ScreenPatch = {};
  if (input.position !== undefined) output.position = parsePoint(input.position, `${path}.position`);
  if (input.variantId !== undefined) output.variantId = string(input.variantId, `${path}.variantId`);
  if (input.deleted !== undefined) output.deleted = boolean(input.deleted, `${path}.deleted`);
  return output;
}

function notePatch(input: UnknownRecord, path: string): NotePatch {
  const output: NotePatch = {};
  if (input.pageId !== undefined) output.pageId = string(input.pageId, `${path}.pageId`);
  if (input.text !== undefined) output.text = editableText(input.text, `${path}.text`);
  if (input.width !== undefined) output.width = finite(input.width, `${path}.width`, true);
  const position = optionalPoint(input.position, `${path}.position`); if (position) output.position = position;
  if (input.deleted !== undefined) output.deleted = boolean(input.deleted, `${path}.deleted`);
  return output;
}

function journeyPatch(input: UnknownRecord, path: string): JourneyPatch {
  const output: JourneyPatch = {};
  if (input.pageId !== undefined) output.pageId = string(input.pageId, `${path}.pageId`);
  if (input.source !== undefined) output.source = string(input.source, `${path}.source`);
  if (input.target !== undefined) output.target = string(input.target, `${path}.target`);
  if (input.sourceSide !== undefined) output.sourceSide = side(input.sourceSide, `${path}.sourceSide`);
  if (input.targetSide !== undefined) output.targetSide = side(input.targetSide, `${path}.targetSide`);
  if (input.label !== undefined) output.label = editableText(input.label, `${path}.label`);
  if (input.dashed !== undefined) output.dashed = boolean(input.dashed, `${path}.dashed`);
  if (input.deleted !== undefined) output.deleted = boolean(input.deleted, `${path}.deleted`);
  return output;
}

export function parseOverrides(value: unknown, workspaceId: string): Overrides {
  const input = record(value, '$');
  if (input.version !== 1) throw new ValidationError('$.version', 'must be 1');
  const parsedWorkspaceId = string(input.workspaceId, '$.workspaceId');
  if (parsedWorkspaceId !== workspaceId) throw new ValidationError('$.workspaceId', 'must match the active workspace');
  const revision = finite(input.revision, '$.revision');
  if (revision < 0) throw new ValidationError('$.revision', 'must be non-negative');
  const screens = parsePatchRecord(input.screens, '$.screens', screenPatch);
  const notes = parsePatchRecord(input.notes, '$.notes', notePatch);
  const journeys = parsePatchRecord(input.journeys, '$.journeys', journeyPatch);
  const addedNotes = array(input.addedNotes, '$.addedNotes').map((note, index) => parseNote(note, `$.addedNotes[${index}]`));
  const addedJourneys = array(input.addedJourneys, '$.addedJourneys').map((journey, index) => parseJourney(journey, `$.addedJourneys[${index}]`));
  unique(addedNotes, '$.addedNotes'); unique(addedJourneys, '$.addedJourneys');
  return { version: 1, workspaceId: parsedWorkspaceId, revision, screens, notes, journeys, addedNotes, addedJourneys };
}
