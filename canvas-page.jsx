// canvas-page.jsx — reads canvas.json, groups one page's artboards into rows
// (sections) by their y coordinate, and renders them on DesignCanvas with each
// screen embedded as a lazy iframe of its .dc.html file.
// Requires design-canvas.jsx to be loaded first (globals DesignCanvas etc).

function CanvasPage({ page, stateFile }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    fetch('./canvas.json').then((r) => r.json()).then(setData).catch((e) => console.error('[canvas-page]', e));
  }, []);
  if (!data) return <div style={{ height: '100vh', background: '#f0eee9' }} />;

  const boards = data.artboards.filter((a) => a.page === page);
  const notes = data.annotations.filter((a) => a.page === page);
  const pageName = (data.pages.find((p) => p.id === page) || {}).name || page;

  // Rows: distinct y values, in order.
  const ys = [...new Set(boards.map((b) => b.y))].sort((a, b) => a - b);
  const rows = ys.map((y, i) => {
    const items = boards.filter((b) => b.y === y).sort((a, b) => a.x - b.x);
    // Short annotation sitting just above the row → its title.
    const titleNote = notes.filter((n) => n.text.length < 90 && n.y < y && n.y >= y - 450 && !n.text.includes('\n'))
      .sort((a, b) => b.y - a.y)[0];
    return { y, items, title: titleNote ? titleNote.text : (ys.length > 1 ? `Row ${i + 1}` : pageName), titleNote };
  });
  const used = new Set(rows.map((r) => r.titleNote).filter(Boolean));
  // Remaining notes attach to the first row whose y is at or after them (else the first row).
  const longNotes = notes.filter((n) => !used.has(n));
  rows.forEach((r) => (r.notes = []));
  longNotes.forEach((n) => {
    const r = rows.find((row) => row.y >= n.y) || rows[0];
    if (r) r.notes.push(n);
  });

  return (
    <DesignCanvas stateFile={stateFile || `.design-canvas.${page}.state.json`}>
      {rows.map((r, i) => (
        <DCSection key={r.y} id={`${page}-row-${i}`} title={r.title}
          subtitle={i === 0 ? `${boards.length} screens` : undefined}>
          {r.notes.map((n) => <DCPostIt key={n.id} width={Math.min(n.w || 480, 760)}>{n.text}</DCPostIt>)}
          {r.items.map((b) => {
            const stem = b.file.split('/').pop().replace('.dc.html', '');
            return (
              <DCArtboard key={b.file} id={b.file} label={b.title || stem}
                width={b.w} height={b.h} href={'./' + b.file}>
                <DCLazyFrame src={'./' + b.file} href={b.file} title={b.title || b.file} width={b.w} height={b.h} />
              </DCArtboard>
            );
          })}
        </DCSection>
      ))}
    </DesignCanvas>
  );
}

window.CanvasPage = CanvasPage;
