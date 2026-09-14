import type { Baseline, Journey, Note, Point, Screen, Side, Variant } from './model';

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
  return { id: string(input.id, `${path}.id`), pageId: string(input.pageId, `${path}.pageId`), text: string(input.text, `${path}.text`), width: finite(input.width, `${path}.width`, true), position: parsePoint(input.position, `${path}.position`) };
}

function side(value: unknown, path: string): Side {
  if (value === 'l' || value === 'r' || value === 't' || value === 'b') return value;
  throw new ValidationError(path, 'must be one of l, r, t, b');
}

function parseJourney(value: unknown, path: string): Journey {
  const input = record(value, path);
  if (typeof input.dashed !== 'boolean') throw new ValidationError(`${path}.dashed`, 'must be a boolean');
  return { id: string(input.id, `${path}.id`), pageId: string(input.pageId, `${path}.pageId`), source: string(input.source, `${path}.source`), target: string(input.target, `${path}.target`), sourceSide: side(input.sourceSide, `${path}.sourceSide`), targetSide: side(input.targetSide, `${path}.targetSide`), label: string(input.label, `${path}.label`), dashed: input.dashed };
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
