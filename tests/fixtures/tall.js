// The blank check's page: a synthetic tall page, 5 columns x 10 rows of
// 1440x900 screens. Width 4*2690+1440 = 12,200. Height 9*1700+900 = 16,200.
// This is the size of the real page whose bottom half blanks today. Each
// file name is unique (?i=N) because both engines key a screen by its file.
// `variantOf: null` stops the old engine from folding the copies into
// variants.
window.tallPage = (sample) => {
  const files = sample.artboards.filter((a) => a.w === 1440).map((a) => a.file);
  const artboards = [], flows = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 5; c++) {
    const i = r * 5 + c, src = files[i % files.length];
    artboards.push({ file: `${src}?i=${i}`, x: c * 2690, y: r * 1700, w: 1440, h: 900, title: `T${i} ${src}`, page: 'tall', variantOf: null });
    if (c > 0) flows.push({ page: 'tall', from: artboards[i - 1].file, to: artboards[i].file, label: 'Next', fs: 'r', ts: 'l', dashed: false });
  }
  return { artboards, annotations: [], flows, pages: [{ id: 'tall', name: 'Tall page' }], launch: sample.launch };
};
