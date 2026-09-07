#!/usr/bin/env node
// make-thumbs.mjs — render each artboard in canvas.json to _thumbs/<Name>.png
// with the headless Chrome on this machine. No npm dependencies.
//
//   node make-thumbs.mjs --dir <folder with canvas.json + *.dc.html>
//                        [--out <folder>]      default <dir>/_thumbs
//                        [--only <Name>]       one artboard (file stem)
//                        [--force]             redo PNGs that are up to date
//                        [--width 720]         downscale width (sips, macOS)
//                        [--chrome <path>]     Chrome binary
//
// design-canvas.jsx shows these PNGs when the canvas is zoomed below 50 %, so
// 720 px wide is plenty. A PNG is skipped when it is newer than its .dc.html.
//
// Artboards that need the Design Components runtime (data-dc-script, {{holes}})
// render with literal braces here; delete their PNG if you prefer the
// placeholder. Google Fonts load over the network during the virtual-time budget.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const dir = resolve(opt('--dir', '.'));
const out = resolve(opt('--out', join(dir, '_thumbs')));
const only = opt('--only', null);
const force = flag('--force');
const width = Number(opt('--width', '720'));
const chrome = opt('--chrome', process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome');

const manifest = join(dir, 'canvas.json');
if (!existsSync(manifest)) { console.error(`no canvas.json in ${dir}`); process.exit(1); }
if (process.platform === 'darwin' && !existsSync(chrome)) { console.error(`Chrome not found at ${chrome} (use --chrome)`); process.exit(1); }
mkdirSync(out, { recursive: true });

const hasSips = spawnSync('sips', ['--version'], { stdio: 'ignore' }).status === 0;
if (!hasSips) console.warn('sips not found: PNGs will stay full size');

const { artboards = [] } = JSON.parse(readFileSync(manifest, 'utf8'));
let done = 0, skipped = 0, failed = 0;

for (const a of artboards) {
  const stem = a.file.split('/').pop().replace(/\.dc\.html$/, '');
  if (only && stem !== only) continue;
  const src = join(dir, a.file);
  const png = join(out, `${stem}.png`);
  if (!existsSync(src)) { console.log(`skip  ${stem}: ${a.file} missing`); skipped++; continue; }
  if (!force && existsSync(png) && statSync(png).mtimeMs > statSync(src).mtimeMs) { skipped++; continue; }

  const w = Math.round(a.w || 1440), h = Math.round(a.h || 900);
  const r = spawnSync(chrome, [
    '--headless=new', '--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--window-size=${w},${h}`, '--virtual-time-budget=4000', '--run-all-compositor-stages-before-draw',
    `--screenshot=${png}`, pathToFileURL(src).href,
  ], { stdio: 'ignore', timeout: 60000 });
  if (r.status !== 0 || !existsSync(png)) { console.log(`FAIL  ${stem}`); failed++; continue; }
  if (hasSips && width > 0) spawnSync('sips', ['-Z', String(width), png], { stdio: 'ignore' });
  console.log(`ok    ${stem}  ${w}×${h} → ${Math.round(statSync(png).size / 1024)} KB`);
  done++;
}

console.log(`\n${done} written, ${skipped} up to date, ${failed} failed → ${out}`);
process.exit(failed ? 1 : 0);
