export type PreviewManifestEntry = {
  src: string;
  width: number;
  height: number;
  revision: string;
};

export type PreviewManifest = {
  version: 1;
  workspaceId: string;
  revision: string;
  entries: Record<string, PreviewManifestEntry>;
};

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path}: must be a non-empty string`);
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${path}: must be a positive finite number`);
  return value;
}

export function parsePreviewManifest(value: unknown): PreviewManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('$: must be an object');
  const input = value as Record<string, unknown>;
  if (input.version !== 1) throw new Error('$.version: must be 1');
  if (!input.entries || typeof input.entries !== 'object' || Array.isArray(input.entries)) throw new Error('$.entries: must be an object');
  const entries = Object.fromEntries(Object.entries(input.entries as Record<string, unknown>).map(([id, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`$.entries.${id}: must be an object`);
    const parsed = entry as Record<string, unknown>;
    return [id, {
      src: nonEmptyString(parsed.src, `$.entries.${id}.src`),
      width: positiveNumber(parsed.width, `$.entries.${id}.width`),
      height: positiveNumber(parsed.height, `$.entries.${id}.height`),
      revision: nonEmptyString(parsed.revision, `$.entries.${id}.revision`),
    }];
  }));
  return {
    version: 1,
    workspaceId: nonEmptyString(input.workspaceId, '$.workspaceId'),
    revision: nonEmptyString(input.revision, '$.revision'),
    entries,
  };
}
