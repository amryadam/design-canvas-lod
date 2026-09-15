import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

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
    expect(pixel).toEqual([17, 180, 91, 255]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('does not publish a manifest when any variant cannot be captured', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'capture-previews-'));
  const out = join(temp, 'previews');
  try {
    await expect(capture(join(root, 'capture-canvas.json'), out)).rejects.toMatchObject({ code: 1 });
    await expect(readFile(join(out, 'manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
    await expect(capture(join(root, 'capture-canvas.json'), out)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(out, 'manifest.json'), 'utf8')).toBe(previousManifest);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
