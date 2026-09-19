// PNG / HTML export of one screen, moved without change from the old
// design-canvas.jsx (main, lines 414-534 and 1366). It reads the screen's
// own file, so it works whether the window is live or not. Only the
// export keywords are new.

export const dcBlobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

// Google Fonts CSS with the latin/arabic faces inlined as data: URLs, cached per href.
// href → Promise<string>, so two artboards on the same font fetch it once.
const dcFontCache = new Map();
export function dcFontCss(href) {
  if (!dcFontCache.has(href)) dcFontCache.set(href, (async () => {
    const css = await (await fetch(href)).text();
    // A subset comment belongs to the following rule, including the last face.
    // Some responses have no subset comments; keep those faces as well.
    const blocks = [...css.matchAll(/(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{[^}]*\}/g)]
      .filter((m) => !m[1] || /^(latin|arabic)$/.test(m[1].trim()))
      .map((m) => m[0]);
    return dcInlineCss(blocks.join('\n'), href);
  })().catch(() => ''));
  return dcFontCache.get(href);
}

async function dcReplaceAsync(text, pattern, replace) {
  let out = '', last = 0;
  for (const m of text.matchAll(pattern)) {
    out += text.slice(last, m.index) + await replace(m);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

// Resolve each stylesheet's resources against its own URL before embedding it.
// Expand imports first so nested relative URLs retain the correct base.
export async function dcInlineCss(css, baseHref, ancestors = new Set()) {
  const chain = new Set(ancestors); chain.add(baseHref);
  const unquote = (s) => s.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  css = await dcReplaceAsync(css, /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*((?:"[^"]*"|'[^']*'|[^)])*)\s*\)|("[^"]*"|'[^']*'))\s*([^;]*);/gi, async (m) => {
    if (m[0].startsWith('/*')) return m[0];
    try {
      const href = new URL(unquote(m[1] || m[2]), baseHref).href;
      if (chain.has(href)) return '';
      const response = await fetch(href); if (!response.ok) return '';
      const body = await dcInlineCss(await response.text(), href, chain);
      const media = m[3].trim();
      return media ? `@media ${media}{${body}}` : body;
    } catch { return ''; }
  });
  return dcReplaceAsync(css, /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)]*)\s*\)/gi, async (m) => {
    if (m[1] === undefined) return m[0];
    const raw = unquote(m[1]);
    if (!raw || /^(data:|#)/i.test(raw)) return m[0];
    try {
      const url = new URL(raw, baseHref);
      const response = await fetch(url.href); if (!response.ok) return 'url("")';
      const data = await dcBlobToDataUrl(await response.blob());
      return `url("${data}${url.hash}")`;
    } catch { return 'url("")'; }
  });
}

// Self-contained document inliner shared by exports: strip scripts →
// inline same-origin CSS/images + Google Fonts → serialized XHTML.
export async function dcInlineDoc(html, baseHref) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base'); base.href = baseHref; doc.head.prepend(base);
  doc.querySelectorAll('script, iframe, video, audio, noscript').forEach((e) => e.remove());
  for (const style of [...doc.querySelectorAll('style')]) style.textContent = await dcInlineCss(style.textContent, baseHref);
  for (const el of [...doc.querySelectorAll('[style]')]) el.setAttribute('style', await dcInlineCss(el.getAttribute('style'), baseHref));
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"]')]) {
    const url = link.href; let css = '';
    try {
      if (/^https:\/\/fonts\.googleapis\.com\//.test(url)) css = await dcFontCss(url);
      else if (new URL(url).origin === location.origin) {
        const response = await fetch(url);
        if (response.ok) css = await dcInlineCss(await response.text(), url);
      }
    } catch {}
    const st = doc.createElement('style'); st.textContent = css;
    if (link.media) st.media = link.media;
    link.replaceWith(st);
  }
  doc.querySelectorAll('link').forEach((e) => e.remove());
  for (const img of [...doc.images]) {
    const url = img.src; if (!url || url.startsWith('data:')) continue;
    try { img.setAttribute('src', await dcBlobToDataUrl(await (await fetch(url)).blob())); } catch { img.remove(); }
  }
  base.remove();
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// The <foreignObject> wrapper for a rasterized artboard, and its data URL.
// `px` is the output scale. An <img>-loaded SVG rasterizes at its intrinsic
// size, so the SVG must carry the output resolution and map the artboard
// through viewBox. tests/regressions.js rasterizes through these two, so the
// check cannot pass while the export path drifts.
export function dcArtboardSvg(xhtml, w, h, px = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
}
export const dcSvgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// Per-artboard export from the kebab menu (kind: 'png' | 'html'). It uses the
// inliner on the artboard's source file. The export thus works whether the
// slot is live or shows its placeholder. The PNG is 2× the artboard's natural
// size.
export async function dcExportArtboard(src, w, h, name, kind) {
  try { await document.fonts.ready; } catch {}
  const save = (blob, ext) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name + '.' + ext; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const html = await (await fetch(src)).text();
  const xhtml = await dcInlineDoc(html, new URL(src, location.href).href);
  if (kind === 'html') return save(new Blob(['<!doctype html>\n' + xhtml], { type: 'text/html' }), 'html');
  const px = 2;
  const img = new Image();
  img.src = dcSvgUrl(dcArtboardSvg(xhtml, w, h, px));
  await img.decode();
  const c = document.createElement('canvas'); c.width = w * px; c.height = h * px;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  c.toBlob((blob) => save(blob, 'png'), 'image/png');
}

export const dcExportName = (label, id) => String(label || id || 'artboard').replace(/[^\p{L}\p{N}\s.-]+/gu, '_');
