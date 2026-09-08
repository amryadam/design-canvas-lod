// perf/bench.js — measurement harness for the canvas.
//
// Not loaded by the app. Paste the whole file into the page (DevTools console,
// or evaluate_script over the chrome-devtools MCP) with the sample open, then
// run `await dcBench.all()`. Every number the performance plan is judged
// against comes from here, so the same numbers can be taken before and after
// a change on the same machine.
//
//   python3 -m http.server 8000   →   http://localhost:8000/sample/
//
// WARNING: `all()` runs dragFlowCost and patchCost, and both edit saved state,
// not just the DOM. dragFlowCost does a real grip drag of about (533, 266)
// world px, past the 4 px move threshold, so a card is actually moved and its
// new position is persisted. patchCost clicks real .dc-size variant chips, and
// each click is a persisted sec.variant patch. After `all()`, the sample page
// is left with a card moved and its variant chips switched. To undo, delete
// the page's `dc-state:` entry from localStorage and reload.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const vp = () => document.querySelector('.design-canvas');
  const world = () => document.querySelector('[data-dc-world]')
    || [...vp().children].find((el) => el.style.transform.includes('scale'));
  const slots = () => [...document.querySelectorAll('[data-dc-slot]')];
  const iframes = () => document.querySelectorAll('.dc-card iframe').length;
  const round = (n) => +n.toFixed(2);

  // Screen-space box around every slot, so a fit can put the whole page on screen.
  const bbox = () => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    slots().forEach((el) => {
      const q = el.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top);
      r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    });
    return { l, t, r, b, w: r - l, h: b - t };
  };

  // Fit through the canvas's own zoom and pan paths, so tf stays in step with
  // the DOM and the next gesture does not jump.
  const fit = async (fill = 0.9) => {
    const w = world();
    let box = bbox();
    const cur = w.getBoundingClientRect().width / w.offsetWidth || 1;
    const target = cur * Math.min((innerWidth * fill) / box.w, (innerHeight * fill) / box.h);
    window.postMessage({ type: '__dc_set_zoom', scale: target }, '*');
    await sleep(400);
    box = bbox();
    const dx = (innerWidth - box.w) / 2 - box.l, dy = (innerHeight - box.h) / 2 - box.t;
    // Fractional deltas keep this on the pan branch instead of the wheel-zoom one.
    vp().dispatchEvent(new WheelEvent('wheel', {
      deltaX: -dx - 0.001, deltaY: -dy + 0.001, deltaMode: 0,
      clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true,
    }));
    await sleep(300);
    return { scale: window.dcLod.scale, onScreen: onScreenCount() };
  };

  const onScreenCount = () => slots().filter((el) => {
    const r = el.getBoundingClientRect();
    return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  }).length;

  // 90 pinch ticks, one per frame: in for the first half, out for the second.
  const gesture = async (n = 90) => {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < n; i++) {
      vp().dispatchEvent(new WheelEvent('wheel', {
        deltaY: i < n / 2 ? -6 : 6, deltaMode: 0, ctrlKey: true,
        clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
      await frame();
    }
  };

  const frameStats = async (fn) => {
    const times = [];
    let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await fn();
    stop = true;
    const s = times.slice(2).sort((a, b) => a - b);
    const q = (p) => round(s[Math.floor(s.length * p)]);
    return {
      frames: s.length, median: q(0.5), p90: q(0.9), max: round(s[s.length - 1]),
      over8: s.filter((f) => f > 8.3).length, over16: s.filter((f) => f > 16.7).length,
    };
  };

  // Frame times through one pinch with the whole page on screen.
  const zoomFrames = async () => {
    await fit();
    await sleep(2500);
    const live = iframes();
    return { ...(await frameStats(() => gesture())), liveAtStart: live, onScreen: onScreenCount() };
  };

  // How often the zoom-compensation property is written during one gesture.
  // Every write invalidates style for the whole world subtree.
  const invWrites = async () => {
    const w = world();
    let writes = 0, lastValue = w.style.getPropertyValue('--dc-inv-zoom');
    const mo = new MutationObserver(() => {
      const v = w.style.getPropertyValue('--dc-inv-zoom');
      if (v !== lastValue) { lastValue = v; writes++; }
    });
    mo.observe(w, { attributes: true, attributeFilter: ['style'] });
    await fit();
    await sleep(600);
    writes = 0;
    await gesture();
    await sleep(400);
    mo.disconnect();
    return { ticks: 90, invWrites: writes };
  };

  // The cost of one zoom frame, split by what the frame writes. Forcing layout
  // after a transform-only write is nearly free; after a custom-property write
  // it is not, whether or not any CSS reads the property.
  const zoomFrameCost = (n = 60) => {
    const w = world();
    const force = () => document.body.getBoundingClientRect().height;
    const bench = (write) => {
      for (let i = 0; i < 8; i++) { w.style.transform = 'translate3d(0px,0px,0) scale(0.4)'; write(2.5); force(); }
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const s = 0.35 + (i % 20) * 0.005;
        w.style.transform = `translate3d(0px, 0px, 0) scale(${s})`;
        write(1 / s);
        force();
      }
      return round((performance.now() - t0) / n);
    };
    const best = (write) => Math.min(bench(write), bench(write));
    const out = {
      transformOnly: best(() => {}),
      withInvZoom: best((v) => w.style.setProperty('--dc-inv-zoom', String(v))),
      withUnusedProp: best((v) => w.style.setProperty('--dc-unused', String(v))),
      slots: slots().length,
      nodes: document.querySelectorAll('.design-canvas *').length,
    };
    w.style.removeProperty('--dc-unused');
    return out;
  };

  // How many iframes are live at each zoom. The budget must hold at every step.
  const liveByZoom = async (list = [0.05, 0.15, 0.3, 0.5, 0.8]) => {
    const out = [];
    await fit();
    for (const s of list) {
      window.postMessage({ type: '__dc_set_zoom', scale: s }, '*');
      await sleep(3000);
      out.push({ zoom: s, live: iframes(), onScreen: onScreenCount() });
    }
    return out;
  };

  // Every flow on this page whose two ends are slots in the DOM.
  const pageFlows = async () => {
    const data = await (await fetch('./canvas.json')).json();
    const files = new Set(slots().map((el) => el.dataset.dcSlot));
    return (data.flows || []).filter((f) => files.has(f.from) && files.has(f.to));
  };

  // Milliseconds for one full re-route of every arrow.
  const flowCost = async (n = 20) => {
    const flows = await pageFlows();
    const fn = window.__cfOrig || window.cfMeasure;
    const w = world();
    fn(w, flows); fn(w, flows);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn(w, flows);
    return { flows: flows.length, slots: slots().length, msPerCall: round((performance.now() - t0) / n) };
  };

  // Drag a card by its grip and count what the arrows cost over the drag.
  const dragFlowCost = async (frames = 40) => {
    if (!window.__cfOrig) window.__cfOrig = window.cfMeasure;
    const acc = { calls: 0, ms: 0 };
    window.cfMeasure = function (...a) {
      const t0 = performance.now();
      const r = window.__cfOrig.apply(this, a);
      acc.calls++; acc.ms += performance.now() - t0;
      return r;
    };
    await fit();
    window.postMessage({ type: '__dc_set_zoom', scale: 0.3 }, '*');
    await sleep(1500);
    const slot = slots().find((el) => {
      const r = el.getBoundingClientRect();
      return r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight;
    }) || slots()[0];
    const grip = slot.querySelector('.dc-grip');
    const r = grip.getBoundingClientRect();
    let x = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (type, el) => (el || document).dispatchEvent(new PointerEvent(type, {
      pointerId: 7, isPrimary: true, button: 0, buttons: 1,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
    acc.calls = 0; acc.ms = 0;
    ev('pointerdown', grip);
    await frame();
    const stats = await frameStats(async () => {
      for (let i = 0; i < frames; i++) { x += 4; y += 2; ev('pointermove'); await frame(); }
    });
    ev('pointerup');
    await sleep(600);
    window.cfMeasure = window.__cfOrig;
    return { dragged: slot.dataset.dcSlot, dragFrames: frames, cfCalls: acc.calls, cfMs: round(acc.ms), frameStats: stats };
  };

  // What one state patch costs. The control is a click on something inert, so
  // the difference is the React render plus the layout it causes.
  const patchCost = async (n = 8) => {
    const chips = [...document.querySelectorAll('.dc-size')];
    if (!chips.length) return { error: 'no variant chips on this page' };
    const inert = document.querySelector('.dc-sectionhead');
    const timeClick = async (el) => {
      await frame();
      const before = window.DC && window.DC.renders;
      const t0 = performance.now();
      el.click();
      await frame();
      const ms = performance.now() - t0;
      const after = window.DC && window.DC.renders;
      return { ms, renders: before == null ? null : after - before };
    };
    const med = (a) => round(a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]);
    const control = [], real = [], renders = [];
    for (let i = 0; i < n; i++) { control.push((await timeClick(inert)).ms); await sleep(80); }
    for (let i = 0; i < n; i++) {
      const r = await timeClick(chips[i % chips.length]);
      real.push(r.ms);
      if (r.renders != null) renders.push(r.renders);
      await sleep(200);
    }
    return {
      slots: slots().length,
      controlMs: med(control),
      variantSwitchMs: med(real),
      framesRenderedPerPatch: renders.length ? med(renders) : null,
    };
  };

  const all = async () => ({
    env: { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, slots: slots().length },
    zoomFrameCost: zoomFrameCost(),
    invWrites: await invWrites(),
    zoomFrames: await zoomFrames(),
    liveByZoom: await liveByZoom(),
    flowCost: await flowCost(),
    dragFlowCost: await dragFlowCost(),
    patchCost: await patchCost(),
  });

  window.dcBench = { fit, gesture, frameStats, zoomFrames, zoomFrameCost, invWrites, liveByZoom, flowCost, dragFlowCost, patchCost, all };
  console.log('[dcBench] ready — run: await dcBench.all()');
})();
