import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type OutputLocation = { root: string; canvas: string; out: string };

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function resolveExistingAncestors(path: string): Promise<string> {
  const missing: string[] = [];
  let candidate = resolve(path);
  while (true) {
    try {
      return resolve(await realpath(candidate), ...missing);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

export async function validateOutputLocation(args: OutputLocation): Promise<OutputLocation> {
  const root = await realpath(args.root);
  const canvas = await realpath(args.canvas);
  const out = await resolveExistingAncestors(args.out);
  if (inside(root, out) || inside(out, root) || inside(out, canvas)) {
    throw new Error('output directory must not overlap resolved asset root or canvas input');
  }
  return { root, canvas, out };
}
