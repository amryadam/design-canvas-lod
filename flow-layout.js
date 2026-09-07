#!/usr/bin/env node
// flow-layout.js — lay a page out the way fatoora's flow map does: stages
// left to right, branches stacked under each other, wide gutters between them,
// anchors chosen from geometry. Rewrites x/y/band/fs/ts in canvas.json.
//
//   node flow-layout.js <canvas.json> [page-id ...]     (default: every page with flows)
//
// Ratios come from fatoora's flow-map-data.jsx (cards 320×220): stage gap ≈ 1
// card width, row gap ≈ 0.8 card height.
const fs = require('fs');

const COL_GAP = 1.0;   // × widest artboard in the two columns
const ROW_GAP = 0.8;   // × taller artboard of the two rows (fatoora: 170 / 220)
const HEADER = 0;      // extra world px above each row; the title hangs in the row gap
const GROUP_GAP = 1.5; // × ROW gap between unconnected flow groups
const ORPHAN_COLS = 4; // artboards that take part in no flow, gridded at the bottom

function layoutPage(data, page) {
  // Size variants (`variantOf`) share their primary's slot: they get no
  // position of their own, and a flow drawn on one lands on the primary.
  const onPage = data.artboards.filter((a) => a.page === page);
  const files = new Set(onPage.map((a) => a.file));
  const primaryOf = (file) => {
    const seen = new Set();
    for (let b = onPage.find((a) => a.file === file); b && b.variantOf && files.has(b.variantOf) && !seen.has(b.file); b = onPage.find((a) => a.file === b.variantOf)) { seen.add(b.file); file = b.variantOf; }
    return file;
  };
  const boards = onPage.filter((a) => primaryOf(a.file) === a.file);
  const flows = (data.flows || []).filter((f) => f.page === page).map((f) => ({ ...f, from: primaryOf(f.from), to: primaryOf(f.to), orig: f }));
  const byFile = new Map(boards.map((b) => [b.file, b]));
  const solid = flows.filter((f) => !f.dashed && byFile.has(f.from) && byFile.has(f.to) && f.from !== f.to);
  const linked = new Set(flows.flatMap((f) => [f.from, f.to]).filter((x) => byFile.has(x)));

  // Connected groups (any flow, dashed or not).
  const parent = new Map([...linked].map((f) => [f, f]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  flows.forEach((f) => { if (byFile.has(f.from) && byFile.has(f.to)) parent.set(find(f.from), find(f.to)); });
  const groups = new Map();
  boards.forEach((b) => { if (linked.has(b.file)) { const g = find(b.file); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); } });

  // Longest-path rank over solid edges, cycle-safe.
  const out = new Map(), inn = new Map();
  solid.forEach((f) => { (out.get(f.from) || out.set(f.from, []).get(f.from)).push(f.to); inn.set(f.to, (inn.get(f.to) || 0) + 1); });
  const rank = new Map();
  const visit = (file, depth, stack) => {
    if (stack.has(file)) return;
    if ((rank.get(file) || 0) >= depth && rank.has(file)) return;
    rank.set(file, depth);
    stack.add(file);
    (out.get(file) || []).forEach((t) => visit(t, depth + 1, stack));
    stack.delete(file);
  };
  linked.forEach((f) => { if (!inn.get(f)) visit(f, 0, new Set()); });
  linked.forEach((f) => { if (!rank.has(f)) visit(f, 0, new Set()); }); // pure cycles

  const pos = new Map();
  let groupTop = 0;
  const order = [...groups.values()].sort((a, b) => b.length - a.length || boards.indexOf(a[0]) - boards.indexOf(b[0]));
  for (const members of order) {
    const cols = new Map();
    members.forEach((b) => { const r = rank.get(b.file) || 0; if (!cols.has(r)) cols.set(r, []); cols.get(r).push(b); });
    const ranks = [...cols.keys()].sort((a, b) => a - b);
    // Column order: keep each node near the average row of its sources.
    const rowOf = new Map();
    ranks.forEach((r) => {
      const list = cols.get(r);
      const key = (b) => {
        const srcs = solid.filter((f) => f.to === b.file && rowOf.has(f.from)).map((f) => rowOf.get(f.from));
        return srcs.length ? srcs.reduce((s, v) => s + v, 0) / srcs.length : boards.indexOf(b);
      };
      list.sort((a, b) => key(a) - key(b));
      list.forEach((b, i) => rowOf.set(b.file, i));
    });
    // Column heights and x positions.
    const colH = ranks.map((r) => { const l = cols.get(r); return l.reduce((s, b) => s + b.h + HEADER, 0) + (l.length - 1) * Math.max(...l.map((b) => b.h)) * ROW_GAP; });
    const groupH = Math.max(...colH);
    let x = 0;
    ranks.forEach((r, ci) => {
      const list = cols.get(r);
      const wMax = Math.max(...list.map((b) => b.w));
      let y = groupTop + (groupH - colH[ci]) / 2;
      list.forEach((b, i) => {
        if (i) y += Math.max(b.h, list[i - 1].h) * ROW_GAP;
        y += HEADER;
        pos.set(b.file, { x: x + (wMax - b.w) / 2, y });
        y += b.h;
      });
      if (ci < ranks.length - 1) x += wMax + Math.max(wMax, Math.max(...cols.get(ranks[ci + 1]).map((b) => b.w))) * COL_GAP;
    });
    groupTop += groupH + Math.max(...members.map((b) => b.h)) * ROW_GAP * GROUP_GAP;
  }

  // Orphans: a plain grid under the flow groups.
  const orphans = boards.filter((b) => !linked.has(b.file));
  if (orphans.length) {
    const wMax = Math.max(...orphans.map((b) => b.w)), hMax = Math.max(...orphans.map((b) => b.h));
    let y = groupTop + HEADER;
    orphans.forEach((b, i) => {
      const c = i % ORPHAN_COLS;
      if (i && !c) y += hMax + hMax * ROW_GAP + HEADER;
      pos.set(b.file, { x: c * (wMax + wMax * COL_GAP), y });
    });
  }

  boards.forEach((b) => { const p = pos.get(b.file); b.x = Math.round(p.x); b.y = Math.round(p.y); b.band = b.y; });

  // Anchors from geometry, fatoora style: forward r→l, same column b→t / t→b,
  // backward leaves the top or bottom and lands on the right side.
  const cx = (b) => b.x + b.w / 2, cy = (b) => b.y + b.h / 2;
  flows.forEach((f) => {
    const a = byFile.get(f.from), b = byFile.get(f.to);
    if (!a || !b || a === b) return;
    const ra = rank.get(a.file) || 0, rb = rank.get(b.file) || 0;
    const o = f.orig;
    if (rb > ra) { o.fs = 'r'; o.ts = 'l'; }
    else if (rb === ra) { if (cy(b) > cy(a)) { o.fs = 'b'; o.ts = 't'; } else { o.fs = 't'; o.ts = 'b'; } }
    else { o.fs = cy(b) < cy(a) ? 't' : 'b'; o.ts = 'r'; }
    void cx;
  });
  return { boards: boards.length, groups: order.length, orphans: orphans.length };
}

const [file, ...pages] = process.argv.slice(2);
if (!file) { console.error('usage: node flow-layout.js <canvas.json> [page-id ...]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const targets = pages.length ? pages : [...new Set((data.flows || []).map((f) => f.page))];
targets.forEach((page) => { const r = layoutPage(data, page); console.log(`${page}: ${r.boards} artboards, ${r.groups} flow groups, ${r.orphans} without flows`); });
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
