import type { Baseline, Side, Variant } from './model';
import { ValidationError, parseBaseline } from './validate';

type LegacyArtboard = { id?: string; variantId?: string; file: string; x: number; y: number; w: number; h: number; title?: string; page: string; variantOf?: string | null; lang?: string; state?: string };
type LegacyNote = { id?: string; x: number; y: number; w?: number; page: string; text: string };
type LegacyFlow = { id?: string; page: string; from: string; to: string; label?: string; fs?: Side; ts?: Side; dashed?: boolean };
type Legacy = { pages: { id: string; name: string }[]; artboards: LegacyArtboard[]; annotations?: LegacyNote[]; flows?: LegacyFlow[] };
const SIZE_WORDS = new Set(['Desktop', '2K', '4K', 'Tablet', 'Phone', 'Laptop', 'Mobile']);

const slug = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '-');
const generatedId = (kind: string, page: string, identity: string) => `${kind}:${slug(page)}:${slug(identity)}`;
const tokens = (file: string) => file.split('/').pop()!.replace(/\.dc\.html$/, '').match(/\d+[A-Z]?(?![a-z])|[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) || [];
const labelOf = (artboard: LegacyArtboard, root: LegacyArtboard) => {
  if (artboard.state != null) return artboard.state || artboard.title || artboard.file;
  const extra = tokens(artboard.file).slice(tokens(root.file).length).filter((token) => token !== 'Arabic' && !SIZE_WORDS.has(token));
  return extra.join(' ') || artboard.title || artboard.file;
};

function legacy(value: unknown): Legacy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('$', 'must be an object');
  const input = value as Partial<Legacy>;
  if (!Array.isArray(input.pages)) throw new ValidationError('$.pages', 'must be an array');
  if (!Array.isArray(input.artboards)) throw new ValidationError('$.artboards', 'must be an array');
  return { pages: input.pages, artboards: input.artboards, annotations: input.annotations ?? [], flows: input.flows ?? [] };
}

export function migrateLegacy(input: unknown, workspaceId: string): Baseline {
  const source = legacy(input);
  if (!workspaceId) throw new ValidationError('$.workspaceId', 'must be a non-empty string');
  const boardsByPage = new Map<string, LegacyArtboard[]>();
  source.artboards.forEach((board, index) => {
    if (!board || typeof board !== 'object') throw new ValidationError(`$.artboards[${index}]`, 'must be an object');
    if (!board.file || !board.page) throw new ValidationError(`$.artboards[${index}]`, 'must include file and page');
    if (![board.x, board.y, board.w, board.h].every(Number.isFinite) || board.w <= 0 || board.h <= 0) throw new ValidationError(`$.artboards[${index}]`, 'must have finite coordinates and positive dimensions');
    const list = boardsByPage.get(board.page) ?? []; list.push(board); boardsByPage.set(board.page, list);
  });
  const rootByFile = new Map<string, LegacyArtboard>();
  const screenIdByFile = new Map<string, string>();
  const screens: Baseline['screens'] = [];
  for (const [pageId, boards] of boardsByPage) {
    const byFile = new Map(boards.map((board) => [board.file, board]));
    if (byFile.size !== boards.length) throw new ValidationError(`$.artboards`, `duplicate file on page ${pageId}`);
    const parentOf = (board: LegacyArtboard): LegacyArtboard | undefined => {
      if (Object.hasOwn(board, 'variantOf')) {
        if (board.variantOf == null) return undefined;
        const parent = byFile.get(board.variantOf);
        if (!parent) throw new ValidationError(`$.artboards[${source.artboards.indexOf(board)}].variantOf`, 'must identify an artboard on the same page');
        const seen = new Set([board.file]);
        let next: LegacyArtboard | undefined = parent;
        while (next && Object.hasOwn(next, 'variantOf') && next.variantOf != null) {
          if (seen.has(next.file)) throw new ValidationError(`$.artboards[${source.artboards.indexOf(board)}].variantOf`, 'variant relationship contains a cycle');
          seen.add(next.file);
          next = byFile.get(next.variantOf);
          if (!next) throw new ValidationError(`$.artboards[${source.artboards.indexOf(board)}].variantOf`, 'must identify an artboard on the same page');
          if (seen.has(next.file)) throw new ValidationError(`$.artboards[${source.artboards.indexOf(board)}].variantOf`, 'variant relationship contains a cycle');
          throw new ValidationError(`$.artboards[${source.artboards.indexOf(board)}].variantOf`, 'explicit variant chains are not supported');
        }
        return parent;
      }
      const directory = board.file.includes('/') ? board.file.slice(0, board.file.lastIndexOf('/') + 1) : '';
      const pieces = tokens(board.file);
      for (let count = pieces.length - 1; count >= 1; count--) {
        const parent = byFile.get(`${directory}${pieces.slice(0, count).join('')}.dc.html`);
        if (parent) return parent;
      }
      return undefined;
    };
    const rootOf = (board: LegacyArtboard): LegacyArtboard => {
      const seen = new Set<string>(); let current = board;
      while (true) {
        if (seen.has(current.file)) throw new ValidationError(`$.artboards[${source.artboards.indexOf(board)}].variantOf`, 'variant relationship contains a cycle');
        seen.add(current.file);
        const parent = parentOf(current); if (!parent) return current;
        current = parent;
      }
    };
    boards.forEach((board) => rootByFile.set(`${pageId}\u0000${board.file}`, rootOf(board)));
    const roots = boards.filter((board) => rootByFile.get(`${pageId}\u0000${board.file}`) === board);
    roots.forEach((root) => {
      const variants: Variant[] = boards.filter((board) => rootByFile.get(`${pageId}\u0000${board.file}`) === root).map((board) => ({
        id: board.variantId ?? generatedId('variant', pageId, board.file), file: board.file, label: labelOf(board, root), width: board.w, height: board.h,
      }));
      const screenId = root.id ?? generatedId('screen', pageId, root.file);
      screenIdByFile.set(`${pageId}\u0000${root.file}`, screenId);
      boards.filter((board) => rootByFile.get(`${pageId}\u0000${board.file}`) === root).forEach((board) => screenIdByFile.set(`${pageId}\u0000${board.file}`, screenId));
      screens.push({ id: screenId, pageId, title: root.title || root.file, position: { x: root.x, y: root.y }, defaultVariantId: variants[0].id, variants });
    });
  }
  const notes = source.annotations!.map((note, index) => ({ id: note.id ?? generatedId('note', note.page, String(index)), pageId: note.page, text: note.text, width: note.w ?? 480, position: { x: note.x, y: note.y } }));
  const seenJourneyIds = new Set<string>();
  const journeys = source.flows!.map((flow, index) => {
    const occurrence = source.flows!.slice(0, index).filter((other) => other.page === flow.page && other.from === flow.from && other.to === flow.to).length;
    const id = flow.id ?? generatedId('journey', flow.page, `${flow.from}:${flow.to}:${occurrence}`);
    if (seenJourneyIds.has(id)) throw new ValidationError(`$.flows[${index}].id`, 'must be unique'); seenJourneyIds.add(id);
    const sourceId = screenIdByFile.get(`${flow.page}\u0000${flow.from}`); const targetId = screenIdByFile.get(`${flow.page}\u0000${flow.to}`);
    if (!sourceId) throw new ValidationError(`$.flows[${index}].from`, 'must identify an artboard on the same page');
    if (!targetId) throw new ValidationError(`$.flows[${index}].to`, 'must identify an artboard on the same page');
    return { id, pageId: flow.page, source: sourceId, target: targetId, sourceSide: flow.fs ?? 'r', targetSide: flow.ts ?? 'l', label: flow.label ?? '', dashed: flow.dashed ?? false };
  });
  return parseBaseline({ version: 1, workspaceId, pages: source.pages, screens, notes, journeys });
}
