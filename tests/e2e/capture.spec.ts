import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateOutputLocation } from '../../src/previews/output-safety';

const run = promisify(execFile);
const root = resolve('tests/fixtures/workspace');

async function capture(canvas: string, out: string) {
  return run('npx', ['tsx', 'scripts/capture-previews.ts', '--canvas', canvas, '--root', root, '--out', out], {
    cwd: process.cwd(),
    env: { ...process.env, PLAYWRIGHT_BROWSER_CHANNEL: 'chrome' },
  });
}

test('captures authored desktop and phone viewports after resource readiness', async ({ page }) => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-'));
  const out = join(temp, 'previews');
  try {
    await capture(join(root, 'capture-ok-canvas.json'), out);

    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.entries)).toEqual(['desktop-default', 'phone-default']);
    expect(manifest.entries['desktop-default']).toMatchObject({ width: 320, height: 180 });
    expect(manifest.entries['phone-default']).toMatchObject({ width: 390, height: 844 });

    const desktop = await readFile(join(out, manifest.entries['desktop-default'].src));
    await page.setContent(`<canvas width="320" height="180"></canvas>`);
    const pixel = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.querySelector('canvas')!;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(300, 170, 1, 1).data];
    }, desktop.toString('base64'));
    expect(pixel).toEqual([244, 63, 94, 255]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('does not publish a manifest when any variant cannot be captured', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-'));
  const out = join(temp, 'previews');
  try {
    const failure = await capture(join(root, 'capture-canvas.json'), out).catch((error: unknown) => error as { code?: number; stderr?: string });
    expect(failure).toMatchObject({ code: 1 });
    expect(failure.stderr).toContain('missing-default');
    expect(failure.stderr).toContain('missing-resource-default');
    await expect(readFile(join(out, 'manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('refuses output locations that overlap resolved asset or canvas inputs', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-paths-'));
  const assets = join(temp, 'assets');
  const canvas = join(temp, 'canvas.json');
  const assetAlias = join(temp, 'asset-alias');
  try {
    await mkdir(assets);
    await writeFile(canvas, '{}');
    await symlink(assets, assetAlias);

    await expect(validateOutputLocation({ root: assets, canvas, out: assets })).rejects.toThrow('must not overlap');
    await expect(validateOutputLocation({ root: assets, canvas, out: temp })).rejects.toThrow('must not overlap');
    await expect(validateOutputLocation({ root: assets, canvas, out: assetAlias })).rejects.toThrow('must not overlap');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('refuses to replace a non-generator output directory', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-owned-'));
  const out = join(temp, 'previews');
  const sentinel = join(out, 'unrelated.txt');
  try {
    await mkdir(out);
    await writeFile(sentinel, 'preserve me');
    await expect(capture(join(root, 'capture-ok-canvas.json'), out)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(sentinel, 'utf8')).toBe('preserve me');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('regenerates a generator-owned output after an authored variant changes', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-changed-'));
  const out = join(temp, 'previews');
  try {
    await capture(join(root, 'capture-ok-canvas.json'), out);
    await capture(join(root, 'capture-changed-canvas.json'), out);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.entries['desktop-default']).toMatchObject({ width: 321, height: 180 });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('keeps the last complete preview set when a later run fails', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-'));
  const out = join(temp, 'previews');
  try {
    await capture(join(root, 'capture-ok-canvas.json'), out);
    const previousManifest = await readFile(join(out, 'manifest.json'), 'utf8');
    await capture(join(root, 'capture-ok-canvas.json'), out);
    expect(await readFile(join(out, 'manifest.json'), 'utf8')).toBe(previousManifest);
    const failure = await capture(join(root, 'capture-resource-failure-canvas.json'), out).catch((error: unknown) => error as { code?: number; stderr?: string });
    expect(failure).toMatchObject({ code: 1 });
    expect(failure.stderr).toContain('phone-default');
    expect(failure.stderr).toContain('does-not-exist.svg');
    expect(await readFile(join(out, 'manifest.json'), 'utf8')).toBe(previousManifest);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
