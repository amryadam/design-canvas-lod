import { describe, expect, test } from 'vitest';
import legacy from '../../sample/canvas.json';
import { migrateLegacy } from '../../src/domain/migrate';
import { parseBaseline } from '../../src/domain/validate';

describe('migrateLegacy', () => {
  test('converts the legacy sample deterministically with stable groups and resolvable journeys', () => {
    const first = migrateLegacy(legacy, 'sample-invoices');

    expect(migrateLegacy(legacy, 'sample-invoices')).toEqual(first);
    expect(new Set(first.screens.map((screen) => screen.id)).size).toBe(first.screens.length);
    expect(first.screens).toHaveLength(10);
    expect(first.screens.find((screen) => screen.variants.some((variant) => variant.file === 'ZatcaDonePhone.dc.html'))?.variants).toHaveLength(2);
    expect(first.journeys).toHaveLength(12);
    expect(first.journeys.every((journey) => first.screens.some((screen) => screen.id === journey.source))).toBe(true);
    expect(first.journeys.every((journey) => first.screens.some((screen) => screen.id === journey.target))).toBe(true);
    expect(parseBaseline(first)).toEqual(first);
  });

  test('preserves supplied identities and disambiguates duplicate legacy journeys', () => {
    const migrated = migrateLegacy({
      pages: [{ id: 'p', name: 'Page' }],
      artboards: [
        { id: 'screen-a', file: 'A.dc.html', x: 0, y: 0, w: 100, h: 100, title: 'A', page: 'p', variantId: 'a-default' },
        { id: 'variant-b', file: 'AB.dc.html', x: 0, y: 0, w: 200, h: 100, title: 'AB', page: 'p', variantOf: 'A.dc.html' },
      ],
      annotations: [{ id: 'note-a', page: 'p', x: 4, y: 5, w: 120, text: 'Remember this' }],
      flows: [
        { id: 'journey-a', page: 'p', from: 'AB.dc.html', to: 'A.dc.html', label: 'Back', fs: 'b', ts: 't', dashed: true },
        { page: 'p', from: 'AB.dc.html', to: 'A.dc.html', label: 'Back', fs: 'b', ts: 't', dashed: true },
      ],
    }, 'workspace');

    expect(migrated.screens[0]).toMatchObject({ id: 'screen-a', defaultVariantId: 'a-default' });
    expect(migrated.screens[0].variants.map((variant) => variant.id)).toEqual(['a-default', 'variant-b']);
    expect(migrated.notes[0].id).toBe('note-a');
    expect(migrated.journeys[0].id).toBe('journey-a');
    expect(new Set(migrated.journeys.map((journey) => journey.id)).size).toBe(2);
    expect(migrated.journeys[0]).toMatchObject({ source: 'screen-a', target: 'screen-a', sourceSide: 'b', targetSide: 't', dashed: true, label: 'Back' });
  });
});

describe('parseBaseline', () => {
  const valid = {
    version: 1,
    workspaceId: 'workspace',
    pages: [{ id: 'page', name: 'Page' }],
    screens: [{
      id: 'screen', pageId: 'page', title: 'Screen', position: { x: 0, y: 0 }, defaultVariantId: 'variant',
      variants: [{ id: 'variant', file: 'screen.html', label: 'Default', width: 100, height: 100 }],
    }],
    notes: [],
    journeys: [],
  };

  test.each([
    [{ ...valid, screens: [...valid.screens, { ...valid.screens[0] }] }, '$.screens[1].id'],
    [{ ...valid, screens: [{ ...valid.screens[0], position: { x: Number.NaN, y: 0 } }] }, '$.screens[0].position.x'],
    [{ ...valid, screens: [{ ...valid.screens[0], variants: [{ ...valid.screens[0].variants[0], width: 0 }] }] }, '$.screens[0].variants[0].width'],
    [{ ...valid, screens: [{ ...valid.screens[0], pageId: 'missing' }] }, '$.screens[0].pageId'],
    [{ ...valid, screens: [{ ...valid.screens[0], defaultVariantId: 'missing' }] }, '$.screens[0].defaultVariantId'],
  ])('rejects invalid baseline data at %s', (input, path) => {
    expect(() => parseBaseline(input)).toThrow(path);
  });

  test('allows empty note text and journey labels', () => {
    const input = {
      ...valid,
      notes: [{ id: 'note', pageId: 'page', text: '', width: 100, position: { x: 0, y: 0 } }],
      journeys: [{ id: 'journey', pageId: 'page', source: 'screen', target: 'screen', sourceSide: 'r', targetSide: 'l', label: '', dashed: false }],
    };

    expect(parseBaseline(input)).toEqual(input);
  });
});

describe('explicit legacy variants', () => {
  test.each([
    [[
      { file: 'A.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'p', variantOf: 'missing.dc.html' },
    ], 'variantOf'],
    [[
      { file: 'A.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'p', variantOf: 'B.dc.html' },
      { file: 'B.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'p', variantOf: 'A.dc.html' },
    ], 'cycle'],
  ])('rejects %s explicit variant relationships', (artboards, message) => {
    expect(() => migrateLegacy({ pages: [{ id: 'p', name: 'Page' }], artboards, annotations: [], flows: [] }, 'workspace')).toThrow(message);
  });

  test('resolves an explicit chain to its terminal root and keeps an empty legacy flow label', () => {
    const migrated = migrateLegacy({
      pages: [{ id: 'p', name: 'Page' }],
      artboards: [
        { id: 'variant-a', file: 'A.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'p', variantOf: 'B.dc.html' },
        { id: 'variant-b', file: 'B.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'p', variantOf: 'C.dc.html' },
        { id: 'screen-c', file: 'C.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'p' },
      ],
      annotations: [{ id: 'note', page: 'p', x: 0, y: 0, w: 100, text: '' }],
      flows: [{ page: 'p', from: 'A.dc.html', to: 'B.dc.html' }],
    }, 'workspace');

    expect(migrated.screens).toHaveLength(1);
    expect(migrated.screens[0]).toMatchObject({ id: 'screen-c' });
    expect(migrated.screens[0].variants.map((variant) => variant.id)).toEqual(['variant-a', 'variant-b', 'variant:p:C.dc.html']);
    expect(migrated.notes[0].text).toBe('');
    expect(migrated.journeys[0]).toMatchObject({ source: 'screen-c', target: 'screen-c', label: '' });
  });
});
