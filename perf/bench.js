// perf/bench.js — measurement harness for the React Flow canvas. The app
// never loads it. Open sample/index-rf.html (sample/index.html after the
// switch-over), wait for the windows, paste this file into the DevTools
// console and run `await dcBench.all()`. patchCost clicks a variant chip and
// the canvas saves it: to undo, delete the page's dc2-state: entry in
// localStorage and reload.
(() => {
  const api = () => {
    const h = DesignCanvas.last();
    if (!h || !h.api || !h.api.fitted) throw new Error('dcBench: no mounted canvas yet');
    return h.api;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => +n.toFixed(2);
  const iframes = () => document.querySelectorAll('.dc-card iframe').length;
  const wheel = (o) => document.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel', {
    deltaMode: 0, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, ...o,
  }));
  const frameStats = async (fn) => {
    const times = [];
    let last = performance.now(), stop = false;
    const tick = (t) => { times.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await fn();
    stop = true;
    const s = times.slice(2).sort((a, b) => a - b), q = (p) => round(s[Math.floor(s.length * p)]);
    return { frames: s.length, median: q(0.5), p95: q(0.95), max: round(s[s.length - 1]),
      dropped: s.filter((f) => f > 1.5 * q(0.5)).length, over16: s.filter((f) => f > 16.7).length };
  };
  const center = async (zoom) => {
    const { rf } = api();
    const b = rf.getNodesBounds(rf.getNodes().filter((n) => n.type === 'window'));
    const z = zoom || Math.min(innerWidth * 0.9 / b.width, innerHeight * 0.9 / b.height);
    rf.setViewport({ zoom: z, x: innerWidth / 2 - (b.x + b.width / 2) * z, y: innerHeight / 2 - (b.y + b.height / 2) * z });
    await sleep(1500);
    return z;
  };
  // 90 pinch ticks, one per frame: in for the first half, out for the second.
  // deltaY 4.3281 is one tick of e^0.06, the old engine's tick (spike bench).
  const zoomFrames = async () => { await center(); return frameStats(async () => {
    for (let i = 0; i < 90; i++) { wheel({ deltaY: i < 45 ? -4.3281 : 4.3281, ctrlKey: true }); await frame(); }
  }); };
  // 60 trackpad scroll frames of 40 screen px at zoom 1.
  const panFrames = async () => { await center(1); return frameStats(async () => {
    for (let i = 0; i < 60; i++) { wheel({ deltaX: i < 30 ? 40 : -40, deltaY: i % 2 ? 0.5 : -0.5 }); await frame(); }
  }); };
  const liveByZoom = async () => {
    const out = {};
    for (const z of [0.05, 0.1, 0.25, 0.5, 1]) { await center(z); out[z] = iframes(); }
    return out;
  };
  // One variant chip click: the windows it renders and the time to the next frame.
  const patchCost = async () => {
    await center();
    const chip = [...document.querySelectorAll('.dc-size')].find((b) => !b.classList.contains('dc-on'));
    if (!chip) return null;
    const r0 = DesignCanvas.test.renders.count, t0 = performance.now();
    chip.click();
    await frame(); await frame();
    return { ms: round(performance.now() - t0), renders: DesignCanvas.test.renders.count - r0 };
  };
  const all = async () => ({ zoomFrames: await zoomFrames(), panFrames: await panFrames(), liveByZoom: await liveByZoom(), patchCost: await patchCost() });
  window.dcBench = { frameStats, zoomFrames, panFrames, liveByZoom, patchCost, all };
})();
