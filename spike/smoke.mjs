// node spike/smoke.mjs [tall] — did the spike page render?
import { launch, sleep, ENGINES } from './cdp.mjs';

const tall = process.argv[2] === 'tall';
const want = tall ? { windows: 50, notes: 0, edges: 40 } : { windows: 11, notes: 1, edges: 12 };
const c = await launch();
try {
  await c.open(tall ? ENGINES.new.tall : ENGINES.new.sample);
  await c.until(`${ENGINES.new.count} >= ${want.windows} && window.rf`);
  await sleep(2500);
  const got = await c.evaluate(`({
    windows: document.querySelectorAll('.react-flow__node-window').length,
    notes: document.querySelectorAll('.react-flow__node-note').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
    iframes: document.querySelectorAll('iframe').length,
  })`);
  console.log(`windows=${got.windows} notes=${got.notes} edges=${got.edges}`);
  console.log(`iframes=${got.iframes}`);
  const ok = got.windows === want.windows && got.notes === want.notes && got.edges === want.edges && got.iframes >= 1 && got.iframes <= 8;
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  c.stop(ok ? 0 : 1);
} catch (e) { console.error(e); c.stop(2); }
