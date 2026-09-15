import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { parseBaseline } from '../src/domain/validate';
import type { Variant } from '../src/domain/model';
import type { PreviewManifest } from '../src/previews/manifest';

const deadlineMs = 15_000;
const settings = { deadlineMs, deviceScaleFactor: 1, fullPage: false, animations: 'disabled' };

type Arguments = { canvas: string; root: string; out: string };
type Failure = { variantId: string; message: string };

function usage(): never {
  throw new Error('Usage: npx tsx scripts/capture-previews.ts --canvas <file> --root <assets-dir> --out <output-dir>');
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) usage();
    values.set(key.slice(2), value);
  }
  const canvas = values.get('canvas');
  const root = values.get('root');
  const out = values.get('out');
  if (!canvas || !root || !out || values.size !== 3) usage();
  return { canvas: resolve(canvas), root: resolve(root), out: resolve(out) };
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function localFile(root: string, file: string): Promise<string> {
  if (isAbsolute(file)) throw new Error(`absolute asset path is not allowed: ${file}`);
  const requested = resolve(root, file);
  if (!inside(root, requested)) throw new Error(`asset path escapes root: ${file}`);
  let resolved: string;
  try {
    resolved = await realpath(requested);
  } catch {
    throw new Error(`asset does not exist: ${file}`);
  }
  if (!inside(root, resolved)) throw new Error(`asset path escapes root through symlink: ${file}`);
  if (!(await stat(resolved)).isFile()) throw new Error(`asset is not a file: ${file}`);
  return resolved;
}

function contentType(file: string): string {
  return ({ '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' } as Record<string, string>)[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

async function serveFile(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('Bad path');
    return;
  }
  const file = decoded === '/' ? 'index.html' : decoded.slice(1);
  try {
    const asset = await localFile(root, file);
    const delay = Number(url.searchParams.get('delay') ?? '0');
    if (Number.isFinite(delay) && delay > 0 && delay <= 1_000) await new Promise((done) => setTimeout(done, delay));
    response.writeHead(200, { 'Content-Type': contentType(asset), 'Cache-Control': 'no-store' });
    response.end(await readFile(asset));
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end(error instanceof Error ? error.message : 'Not found');
  }
}

async function startServer(root: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => { void serveFile(root, request, response); });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.off('error', fail); done(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback server did not expose a TCP address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
  };
}

function withDeadline<T>(operation: Promise<T>, variantId: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${deadlineMs}ms`)), deadlineMs); });
  return Promise.race([operation, timeout]).finally(() => { if (timer) clearTimeout(timer); }).catch((error) => {
    throw new Error(`${variantId}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function outputName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  const suffix = createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `${safe || 'variant'}-${suffix}.png`;
}

async function captureVariant(browser: Browser, origin: string, root: string, variant: Variant, output: string): Promise<void> {
  const source = await localFile(root, variant.file);
  const documentPath = relative(root, source).split(sep).map(encodeURIComponent).join('/');
  const page = await browser.newPage({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 1 });
  const failedResources: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => failedResources.push(`request failed ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`));
  try {
    await withDeadline((async () => {
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.goto(`${origin}/${documentPath}`, { waitUntil: 'load', timeout: deadlineMs });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(async (image) => {
          if (image.complete && image.naturalWidth === 0) throw new Error(`image failed to load: ${image.currentSrc || image.src}`);
          await image.decode();
        }));
      });
      if (failedResources.length) throw new Error(`required resources failed: ${failedResources.join('; ')}`);
      await page.screenshot({ path: output, fullPage: false, animations: 'disabled' });
    })(), variant.id);
  } finally {
    await page.close();
  }
}

async function treeDigest(root: string, excluded: string): Promise<string> {
  const digest = createHash('sha256');
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const item = resolve(directory, entry.name);
      if (inside(excluded, item)) continue;
      const rel = relative(root, item);
      if (entry.isDirectory()) await visit(item);
      else if (entry.isFile()) { digest.update(rel); digest.update(await readFile(item)); }
      else if ((await lstat(item)).isSymbolicLink()) digest.update(`symlink:${rel}`);
    }
  }
  await visit(root);
  return digest.digest('hex');
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function publish(temp: string, out: string): Promise<void> {
  const backup = `${out}.previous-${process.pid}`;
  let movedExisting = false;
  try {
    await rename(out, backup);
    movedExisting = true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await rename(temp, out);
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedExisting) await rename(backup, out).catch(() => undefined);
    throw error;
  }
}

export async function generatePreviews(args: Arguments): Promise<PreviewManifest> {
  const root = await realpath(args.root);
  const canvasText = await readFile(args.canvas, 'utf8');
  const canvas = JSON.parse(canvasText);
  const baseline = parseBaseline(canvas);
  const parent = dirname(args.out);
  await mkdir(parent, { recursive: true });
  const temp = resolve(parent, `.${basename(args.out)}.tmp-${process.pid}-${Date.now()}`);
  if (inside(root, temp)) throw new Error('output directory must be outside the asset root');
  await mkdir(temp);
  const server = await startServer(root);
  let browser: Browser | undefined;
  const failures: Failure[] = [];
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL });
    const entries: PreviewManifest['entries'] = {};
    const inputRevision = digest(JSON.stringify({ root: await treeDigest(root, temp), canvas: digest(canvasText), settings }));
    for (const screen of baseline.screens) for (const variant of screen.variants) {
      const filename = outputName(variant.id);
      try {
        await captureVariant(browser, server.origin, root, variant, resolve(temp, filename));
        entries[variant.id] = {
          src: filename,
          width: variant.width,
          height: variant.height,
          revision: digest(JSON.stringify({ inputRevision, variant, screenshot: digest(await readFile(resolve(temp, filename))) })),
        };
      } catch (error) {
        failures.push({ variantId: variant.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (failures.length) throw new Error(`Preview capture failed:\n${failures.map((failure) => `- ${failure.variantId}: ${failure.message}`).join('\n')}`);
    const manifest: PreviewManifest = {
      version: 1,
      workspaceId: baseline.workspaceId,
      revision: digest(JSON.stringify({ inputRevision, entries })),
      entries,
    };
    await writeFile(resolve(temp, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await publish(temp, args.out);
    return manifest;
  } finally {
    await browser?.close();
    await server.close();
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generatePreviews(parseArguments(process.argv.slice(2))).then((manifest) => {
    console.log(`Captured ${Object.keys(manifest.entries).length} previews in ${manifest.revision}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
