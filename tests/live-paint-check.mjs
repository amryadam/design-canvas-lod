// node tests/live-paint-check.mjs [--url=<path>] [--tag=<name>] [--control]
// Spike rule 4 ("no freeze": a live screen stays painted during a gesture),
// measured on a real page in a HEADFUL Chrome with the GPU on (tests/cdp.mjs).
//
// The probe: open the page -> fit -> wait for the budget to fill its places ->
// measure every live card while nothing moves (the REST reading) -> pinch:
// zoom in with synthetic ctrl+wheel ticks, one tick for each animation frame,
// so windows leave the view, then zoom out again, so they come back. The two
// legs follow each other with no pause, so the budget starts no pass inside
// the gesture and the live set holds from the first frame to the last.
//
// A screencast records the frames of both legs. Chrome sends one image for
// each frame it can encode and that the check acknowledges in time, so the
// record is DENSE but NOT COMPLETE: about three of four driven frames in the
// runs measured so far. A blank of one frame can therefore be missed, while a
// blank that lasts two frames or more cannot. The coverage guard below states
// what each run really got, and a run that falls under the floor is INVALID,
// not PASS.
//
// The metric is per card and per frame: `ink` is the fraction of the card's
// own pixels that are NOT one of the flat colours the page paints where
// nothing is drawn (the card background #fff, the window body #eae7e1 and the
// canvas #f0eee9). A card that Chrome skipped, or an iframe that never
// loaded, is flat, so its ink falls to about zero. A reading is BLANK when
// ink < 0.01, or under 12% of the same card's rest reading.
//
// The view moves while a frame is composited, so the check does not trust one
// viewport: the page records the viewport of every animation frame, and each
// screencast frame is measured on the INTERSECTION of the card's rect over
// every animation frame its swap time can belong to. That region is inside
// the card in each of them, so it is inside the card in the frame that was
// really captured. A region too small to judge is skipped, not scored blank.
//
// --control paints the live iframes out for the length of the gesture, so a
// run that does not report FAIL proves nothing on this machine.
//
// Exit: 0 PASS, 1 FAIL, 2 unexpected error, 4 the validity guard tripped
// (idle rAF under 50 fps, the tab is not visible, or the run covered too
// little of the gesture to say anything).
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { launch, sleep, ENGINES, VIEW, outDir } from './cdp.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const URL_PATH = arg('url', ENGINES.new.sample);
const CONTROL = argv.includes('--control');
const TAG = arg('tag', CONTROL ? 'control' : 'sample');
const shotDir = path.join(outDir, 'live-paint');

const ZOOM_TICKS = 30;        // ticks in each leg of the gesture (about 1.9x)
const TICK_SCALE = 0.5;       // a half reference tick, the size a real pinch sends
const MIN_REST_INK = 0.02;    // below this a card holds too little to be judged
const MIN_INK = 0.01;         // a reading under this is blank
const MIN_REST_RATIO = 0.12;  // a reading under this much of the rest reading is blank
const MIN_SIDE = 12;          // device px: a smaller sample region is skipped
// The coverage floors. A reading the region test drops, and a frame the
// screencast did not send, are both silent losses: without a floor a run that
// scored almost nothing would still print PASS.
const MIN_FRAME_COVER = 0.5;  // recorded frames / driven frames
const MIN_READING_COVER = 0.6; // scored readings / (recorded frames x judged cards)
const CAL_DY = 6, TICK = 0.06;
const MIN_IDLE_FPS = 50;
const ALLOW_THROTTLED = process.env.LIVE_PAINT_ALLOW_THROTTLED === '1';
// The colours the page paints where nothing is drawn.
const FLAT = [[255, 255, 255], [234, 231, 225], [240, 238, 233]];

const FIT = `(() => {
  const rf = dcCanvas.api.rf;
  const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
  const zoom = Math.max(0.05, Math.min(4, Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height)));
  rf.setViewport({ x: innerWidth / 2 - (b.x + b.width / 2) * zoom, y: innerHeight / 2 - (b.y + b.height / 2) * zoom, zoom });
  return zoom;
})()`;
const IDLE_PROBE = `(() => new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; const dt = performance.now() - t0;
    if (dt >= 1000) resolve({ fps: n / (dt / 1000), visibility: document.visibilityState });
    else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}))()`;
// The control arm: the live screens lose their pixels for the gesture only.
const CONTROL_ON = `(() => { const s = document.createElement('style'); s.id = 'lp-control';
  s.textContent = '.dc-card iframe{visibility:hidden}'; document.head.appendChild(s); return 1; })()`;

// The live cards, with the screen rect each one has under the viewport read
// with it. A card never moves in the world, so its rect under any other
// viewport follows from these two.
const LIVE_CARDS = `(() => {
  const v = dcCanvas.api.rf.getViewport();
  return {
    view: { x: v.x, y: v.y, zoom: v.zoom },
    cards: [...document.querySelectorAll('.dc-win[data-live="1"] .dc-card')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.closest('.react-flow__node').dataset.id, l: r.left, t: r.top, w: r.width, h: r.height };
    }),
  };
})()`;

// One wheel tick for each animation frame, started without being awaited, so
// the check can record the page while the gesture runs. Every frame's
// viewport goes into window.__lp.frames.
const DRIVE = (sel, deltaY, n, cx, cy) => `(() => {
  window.__lp = { frames: [], done: false };
  (async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const el = document.querySelector('${sel}');
    const rec = () => { const v = dcCanvas.api.rf.getViewport(); window.__lp.frames.push({ t: performance.now(), x: v.x, y: v.y, zoom: v.zoom }); };
    rec();
    for (let i = 0; i < ${n}; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaMode: 0, deltaY: ${deltaY}, clientX: ${cx}, clientY: ${cy}, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame();
      rec();
    }
    window.__lp.done = true;
  })();
  return 1;
})()`;

// ---- PNG ----
// The screencast gives one PNG for each frame it sends. They are measured
// here, in Node, so no image goes back into the page.
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9];
      if (data[12]) throw new Error('an interlaced PNG is not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += len + 12;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`PNG bit depth ${bd} colour type ${ct} is not supported`);
  const ch = ct === 6 ? 4 : 3, stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++], row = raw.subarray(q, q + stride);
    q += stride;
    const base = y * stride, up = base - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[base + i - ch] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const cc = (y > 0 && i >= ch) ? out[up + i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const g = a + b - cc, pa = Math.abs(g - a), pb = Math.abs(g - b), pc = Math.abs(g - cc);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cc);
      }
      out[base + i] = v & 255;
    }
  }
  return { width: w, height: h, ch, data: out };
}

// The fraction of the region that is not one of the flat colours.
function inkOf(img, r, k) {
  const x0 = Math.max(0, Math.round(r.l * k)), y0 = Math.max(0, Math.round(r.t * k));
  const x1 = Math.min(img.width, Math.round((r.l + r.w) * k)), y1 = Math.min(img.height, Math.round((r.t + r.h) * k));
  const w = x1 - x0, h = y1 - y0;
  if (w < MIN_SIDE || h < MIN_SIDE) return { n: 0, ink: 0 };
  let n = 0, hit = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * img.width + x0) * img.ch;
    for (let x = x0; x < x1; x++, i += img.ch) {
      n++;
      const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
      if (!FLAT.some((f) => Math.abs(R - f[0]) <= 8 && Math.abs(G - f[1]) <= 8 && Math.abs(B - f[2]) <= 8)) hit++;
    }
  }
  return { n, ink: +(hit / n).toFixed(4) };
}

// The card's screen rect under `view`, from the rect it had under `base`.
function rectUnder(card, base, view) {
  const wx = (card.l - base.x) / base.zoom, wy = (card.t - base.y) / base.zoom;
  const s = view.zoom / base.zoom;
  return { l: wx * view.zoom + view.x, t: wy * view.zoom + view.y, w: card.w * s, h: card.h * s };
}
// The region inside the card under every candidate viewport, inset so the
// card's own rounded border never reaches the sample, and clipped to the view.
function intersect(card, base, views, inset = 4) {
  let l = -Infinity, t = -Infinity, r = Infinity, b = Infinity;
  for (const v of views) {
    const q = rectUnder(card, base, v);
    l = Math.max(l, q.l); t = Math.max(t, q.t);
    r = Math.min(r, q.l + q.w); b = Math.min(b, q.t + q.h);
  }
  l = Math.max(l + inset, 0); t = Math.max(t + inset, 0);
  r = Math.min(r - inset, VIEW.width); b = Math.min(b - inset, VIEW.height);
  return { l, t, w: r - l, h: b - t };
}

async function checkIdle(c, label) {
  const idle = await c.evaluate(IDLE_PROBE);
  console.log(`idle rAF [${label}]: fps=${idle.fps.toFixed(1)} visibility=${idle.visibility}`);
  if (idle.visibility !== 'visible' || idle.fps < MIN_IDLE_FPS) {
    if (!ALLOW_THROTTLED) {
      console.error(`INVALID: screen not visible or rAF throttled at ${label} (fps=${idle.fps.toFixed(1)})`);
      c.stop(4);
    }
    console.error(`WARNING: numbers are not valid at ${label} — LIVE_PAINT_ALLOW_THROTTLED=1 is set, continuing anyway`);
  }
  return idle;
}

// One ctrl+wheel tick zooms by a different factor on each machine, so measure
// it once and scale deltaY to the reference tick the other checks use.
async function calibrate(c, target) {
  const z0 = await c.evaluate('dcCanvas.api.rf.getZoom()');
  await c.evaluate(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    document.querySelector('${target}').dispatchEvent(new WheelEvent('wheel', { deltaMode: 0, deltaY: -${CAL_DY},
      clientX: ${VIEW.width / 2}, clientY: ${VIEW.height / 2}, ctrlKey: true, bubbles: true, cancelable: true }));
    await frame(); await frame();
  })()`);
  const ratio = (await c.evaluate('dcCanvas.api.rf.getZoom()')) / z0;
  if (!(ratio > 1.01)) throw new Error(`a synthetic ctrl+wheel on ${target} did not zoom the canvas (ratio ${ratio})`);
  return CAL_DY * TICK / Math.log(ratio);
}

mkdirSync(shotDir, { recursive: true });
const c = await launch();
try {
  await c.open(URL_PATH, 'try { localStorage.clear(); } catch {}');
  await c.until(`${ENGINES.new.count} >= 3 && window.dcCanvas && dcCanvas.api && dcCanvas.api.rf && dcCanvas.api.fitted`, 30000);
  await c.evaluate(FIT);
  await sleep(2500);                       // the budget pass and its mounts
  await checkIdle(c, `${TAG} before`);

  const target = ENGINES.new.target;
  const dy = (await calibrate(c, target)) * TICK_SCALE;
  await c.evaluate(FIT);
  await sleep(2500);

  const cx = VIEW.width / 2, cy = VIEW.height / 2;
  const timeOrigin = await c.evaluate('performance.timeOrigin');

  // The cards to judge, and what each one holds while nothing moves.
  const { view: base, cards } = await c.evaluate(LIVE_CARDS);
  const restPng = decodePng(Buffer.from(await c.screenshot(path.join('live-paint', `live-paint-${TAG}-rest.png`)), 'base64'));
  const restK = restPng.width / VIEW.width;
  const rest = cards.map((cd) => inkOf(restPng, intersect(cd, base, [base]), restK));
  const judged = cards.map((cd, i) => ({ ...cd, restInk: rest[i].ink }))
    .filter((_, i) => rest[i].n > 0 && rest[i].ink >= MIN_REST_INK);
  console.log(`live cards: ${cards.length}, judged at rest: ${judged.length} (ink >= ${MIN_REST_INK})`);
  cards.forEach((cd, i) => console.log(`  rest ${cd.id}: ink=${rest[i].ink} n=${rest[i].n}`));
  if (!judged.length) { console.error('INVALID: no live card holds enough content at rest to be judged'); c.stop(4); }

  // The frames of the gesture, as many as the screencast sends.
  const shots = [];
  c.on('Page.screencastFrame', (p) => {
    shots.push({ t: p.metadata.timestamp * 1000 - timeOrigin, buf: Buffer.from(p.data, 'base64') });
    c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  if (CONTROL) await c.evaluate(CONTROL_ON);
  await c.send('Page.startScreencast', { format: 'png', maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });

  // The gesture: zoom in, so windows leave the view, then zoom out, so they
  // come back — the moment the review names as the risk.
  const legs = [];
  for (const [name, deltaY] of [['in', -dy], ['out', dy]]) {
    const from = shots.length;
    await c.evaluate(DRIVE(target, deltaY, ZOOM_TICKS, cx, cy));
    await c.until('window.__lp.done', 15000);
    legs.push({ name, from, to: shots.length, frames: await c.evaluate('window.__lp.frames') });
  }
  await c.send('Page.stopScreencast');
  if (CONTROL) await c.evaluate(`(() => { document.getElementById('lp-control').remove(); return 1; })()`);
  await checkIdle(c, `${TAG} after`);

  const rows = [];
  let dropped = 0;              // card readings the region test could not judge
  for (const leg of legs) {
    const last = leg.frames[leg.frames.length - 1];
    for (let s = leg.from; s < leg.to; s++) {
      const shot = shots[s];
      // Every animation frame the composited frame can hold: the ones whose
      // time is within one frame period of its swap time, plus the last one
      // before that window. A swap after the leg ended holds the last view.
      const near = leg.frames.filter((f) => f.t >= shot.t - 12 && f.t <= shot.t + 12);
      const before = leg.frames.filter((f) => f.t < shot.t - 12).slice(-1);
      const views = near.length ? [...before, ...near] : (before.length ? before : [last]);
      const img = decodePng(shot.buf);
      const k = img.width / VIEW.width;
      judged.forEach((cd) => {
        const v = inkOf(img, intersect(cd, base, views), k);
        if (v.n === 0) { dropped++; return; }       // off screen, or too small to judge
        const blank = v.ink < MIN_INK || v.ink < MIN_REST_RATIO * cd.restInk;
        rows.push({ leg: leg.name, shot: s, id: cd.id, views: views.length, ...v, restInk: cd.restInk, blank });
      });
    }
  }

  const blanks = rows.filter((r) => r.blank);
  const byId = new Map();
  rows.forEach((r) => { const w = byId.get(r.id); if (!w || r.ink < w.ink) byId.set(r.id, r); });
  // What the run really covered. `drivenFrames` is the number of animation
  // frames the gesture drove; `drivenReadings` is one card for each frame the
  // screencast did send. Both losses are silent on their own, so they are
  // counted, printed, and made a reason to answer INVALID.
  const drivenFrames = 2 * ZOOM_TICKS;
  const drivenReadings = shots.length * judged.length;
  const frameCover = +(shots.length / drivenFrames).toFixed(2);
  const readingCover = drivenReadings ? +(rows.length / drivenReadings).toFixed(2) : 0;
  const cover = `${shots.length} of ${drivenFrames} driven frames (${frameCover}), `
    + `${rows.length} of ${drivenReadings} card readings (${readingCover}), ${dropped} off screen or too small`;
  console.log(`frames recorded: ${shots.length} (${legs.map((l) => `${l.name} ${l.to - l.from}`).join(', ')}), card readings: ${rows.length}`);
  for (const [id, w] of byId) console.log(`  worst ${id}: ink=${w.ink} (rest ${w.restInk}) at ${w.leg} frame ${w.shot}, n=${w.n}`);
  for (const b of blanks.slice(0, 20)) console.log(`  BLANK ${b.id}: ink=${b.ink} (rest ${b.restInk}) at ${b.leg} frame ${b.shot}, n=${b.n}`);

  // Keep the worst frame of the run on disk, so a verdict has a picture.
  const worst = rows.length ? rows.reduce((a, b) => (b.ink < a.ink ? b : a)) : null;
  if (worst) writeFileSync(path.join(shotDir, `live-paint-${TAG}-worst.png`), shots[worst.shot].buf);
  writeFileSync(path.join(shotDir, `live-paint-${TAG}.json`), JSON.stringify({
    tag: TAG, url: URL_PATH, control: CONTROL, dy: +dy.toFixed(4), baseView: base,
    liveCards: cards.length, judged: judged.length, recorded: shots.length,
    drivenFrames, drivenReadings, frameCover, readingCover, dropped,
    readings: rows.length, blanks: blanks.length, worst, rows,
  }, null, 2));

  if (!rows.length) { console.error('INVALID: no card could be judged during the gesture'); c.stop(4); }
  if (frameCover < MIN_FRAME_COVER || readingCover < MIN_READING_COVER) {
    console.error(`INVALID: the run covered too little of the gesture — ${cover}`
      + ` (floors: frames ${MIN_FRAME_COVER}, readings ${MIN_READING_COVER})`);
    c.stop(4);
  }
  console.log(`LIVE PAINT CHECK ${TAG}: ${blanks.length ? 'FAIL' : 'PASS'} — ${blanks.length} of ${rows.length} live-card readings were blank during the gesture (worst ink=${worst.ink} on ${worst.id}, rest ${worst.restInk}); cover: ${cover}`);
  if (CONTROL) {
    if (!blanks.length) console.error('the check cannot see a blank live card on this machine');
    c.stop(blanks.length ? 0 : 1);
  }
  c.stop(blanks.length ? 1 : 0);
} catch (e) { console.error(e); c.stop(2); }
