// Variant folding and chip axes, moved without change from the old
// canvas-page.jsx (main, lines 457-495) and design-canvas.jsx (main,
// lines 1069-1096). Only the export keywords are new.

export const CP_CHIPS = { 2560: '2K', 3840: '4K' };
export const cpChip = (w) => CP_CHIPS[w] || String(w);
// Titles carry the size as a trailing "· 1440×900 …" fragment; the chip shows
// it instead, so a primary with size variants drops it from its label.
export const cpStripSize = (t) => t.replace(/\s*·\s*\d{3,4}\s*[×x]\s*\d{3,4}[^·]*$/u, '').trim() || t;

// ---- Variants ----------------------------------------------------------------
// Copies of one screen (sizes, Arabic, error and empty states) fold into one
// slot. Nothing in canvas.json has to change: a file whose CamelCase name
// starts with another file's name on the same page is a variant of it
// (SignInWrong → SignIn, UserCreated2K → UserCreated, Main2K → Main), and the
// longest such name wins (UserCreateMinimizedPhone → UserCreateMinimized →
// UserCreate). Explicit fields override the guess: `variantOf` (a file, or
// null to stay a slot), `lang` ("ar"), `state` (free text, the chip label).
export const CP_SIZE_WORDS = new Set(['Desktop', '2K', '4K', 'Tablet', 'Phone', 'Laptop', 'Mobile']);
const cpTokens = (file) => file.split('/').pop().replace(/\.dc\.html$/, '').match(/\d+[A-Z]?(?![a-z])|[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) || [];
export function cpVariants(onPage) {
  const byFile = new Map(onPage.map((a) => [a.file, a]));
  const parentOf = (a) => {
    if ('variantOf' in a) return a.variantOf && byFile.has(a.variantOf) ? a.variantOf : null;
    const dir = a.file.includes('/') ? a.file.slice(0, a.file.lastIndexOf('/') + 1) : '';
    const t = cpTokens(a.file);
    for (let n = t.length - 1; n >= 1; n--) { const f = dir + t.slice(0, n).join('') + '.dc.html'; if (byFile.has(f)) return f; }
    return null;
  };
  const primaryOf = (file) => {
    const seen = new Set();
    for (let a = byFile.get(file), p; a && (p = parentOf(a)) && !seen.has(a.file); a = byFile.get(p)) { seen.add(a.file); file = p; }
    return file;
  };
  const axesOf = (a, root) => {
    const extra = cpTokens(a.file).slice(cpTokens(root.file).length);
    const arabic = extra.includes('Arabic') || /\bRTL\b/.test(a.title || '');
    const lang = a.lang || (arabic ? 'ar' : 'en');
    const state = a.state != null ? a.state : extra.filter((w) => w !== 'Arabic' && !CP_SIZE_WORDS.has(w)).join(' ');
    return { lang, state };
  };
  return { primaryOf, axesOf };
}

export const DC_AXES = [
  { key: 'size', of: (v) => v.chip || String(v.w), label: (k) => k },
  { key: 'lang', of: (v) => (v.lang || 'en'), label: (k) => k.toUpperCase() },
  { key: 'state', of: (v) => (v.state || ''), label: (k) => k || 'Main' },
];
export function dcVariant(props, chosen) {
  const { variants, width = 260, height = 480, href } = props;
  if (!variants || !variants.length) return { width, height, href, variants: null, idx: -1, cur: null, axes: [] };
  const rootIdx = Math.max(0, variants.findIndex((s) => s.primary));
  let idx = variants.findIndex((s) => s.file === chosen);
  if (idx < 0) idx = rootIdx;
  const cur = variants[idx], root = variants[rootIdx];
  // One chip group per axis that has more than one value. Sizes keep the
  // order given (widest first); language and state lead with the primary's.
  const axes = DC_AXES.map((ax) => {
    const values = [...new Set(variants.map(ax.of))];
    if (values.length < 2) return null;
    if (ax.key !== 'size') values.sort((a, b) => (a === ax.of(root) ? -1 : b === ax.of(root) ? 1 : 0));
    const pick = (value) => {
      const same = (v, other) => DC_AXES.every((o) => o === ax || o === other || o.of(v) === o.of(cur));
      return (variants.find((v) => ax.of(v) === value && same(v)) ||
        variants.find((v) => ax.of(v) === value && DC_AXES.some((o) => o !== ax && same(v, o))) ||
        variants.find((v) => ax.of(v) === value)).file;
    };
    return { key: ax.key, on: ax.of(cur), chips: values.map((value) => ({ value, label: ax.label(value), file: pick(value) })) };
  }).filter(Boolean);
  return { width: cur.w, height: cur.h, href: cur.href ?? href, variants, idx, cur, axes };
}
