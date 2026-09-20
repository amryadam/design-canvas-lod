import { memo, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Handle, Position } from '@xyflow/react';
import { DC } from './constants.js';
import { PageCtx } from './context.js';
import { dcExportArtboard, dcExportName } from './export.js';

// Read by the browser suite: a patch must not render windows it does not touch.
export const renders = { count: 0 };

const SIDES = [['l', Position.Left], ['r', Position.Right], ['t', Position.Top], ['b', Position.Bottom]];
const KEBAB = (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><circle cx="2.5" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" /><circle cx="9.5" cy="6" r="1.1" /></svg>
);
const OPEN = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 2.5H2.5v11h11v-4" /><path d="M9.5 2.5h4v4M13.5 2.5L8 8" /></svg>
);

function SizeChips({ size, onPick }) {
  if (!size.axes.length) return null;
  return (
    <div className="dc-chips">
      {size.axes.map((ax) => (
        <div key={ax.key} className="dc-sizes">
          {ax.chips.map((c) => (
            <button key={c.value} className={'dc-size' + (c.value === ax.on ? ' dc-on' : '')} title={c.file}
              onClick={() => onPick(c.file)}>{c.label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

// One screen as a window: a header with the live dot, the name, the variant
// chips, the ⋯ menu and ↗, then the screen. Every option is in the header at
// all times. The screen is a live iframe while the budget says so, else a
// placeholder with the screen's name.
function WindowNode({ id, data }) {
  renders.count++;
  const { budget, act } = useContext(PageCtx);
  const live = useSyncExternalStore(budget.subscribe, () => budget.isLive(id));
  const { label, title, size, moved, sidesMoved } = data;
  const { width, height, href } = size;
  const screenTitle = (size.cur && size.cur.title) || title;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [exportError, setExportError] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) { setConfirming(false); setExportError(null); return undefined; }
    const off = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [menuOpen]);

  // The menu stays open while an export runs, so a failure shows in its row.
  const save = (kind) => {
    setExportError(null);
    setBusy(kind);
    dcExportArtboard(href, width, height, dcExportName(label, id), kind).then(
      () => { setBusy(null); setMenuOpen(false); },
      (err) => {
        console.error('[design-canvas] export failed:', err);
        setBusy(null);
        setExportError(`${kind.toUpperCase()} export failed: ${(err && err.message) || err}`);
      });
  };
  const close = (fn) => () => { setMenuOpen(false); fn(); };

  return (
    <>
      <div className="dc-win" data-live={live ? '1' : '0'} style={{ width: width + DC.winPad * 2 }}
        onPointerDownCapture={() => budget.touch(id)}>
        <div className="dc-winhead" style={{ height: DC.winHead }} title="Drag to move">
          <span className="dc-dot" title="Green while the screen is live" />
          <div className="dc-wintitle"><span className="dc-name" title={label}>{label}</span></div>
          <div className="dc-bar nodrag">
            <SizeChips size={size} onPick={(file) => act.pickVariant(id, file)} />
            {size.axes.length > 0 && <hr />}
            <div className="dc-btns">
              <div ref={menuRef} style={{ position: 'relative' }}>
                <button className="dc-kebab" title="More" onClick={() => setMenuOpen((o) => !o)}>{KEBAB}</button>
                {menuOpen && (
                  <div className="dc-menu">
                    {href && <button onClick={close(() => window.open(href, '_blank'))}>Open screen</button>}
                    {moved && <button onClick={close(() => act.resetPosition(id))}>Reset position</button>}
                    {sidesMoved && <button onClick={close(() => act.resetSides(id))}>Reset arrow sides</button>}
                    {href && <button disabled={!!busy} onClick={() => save('png')}>{busy === 'png' ? 'Downloading…' : 'Download PNG'}</button>}
                    {href && <button disabled={!!busy} onClick={() => save('html')}>{busy === 'html' ? 'Downloading…' : 'Download HTML'}</button>}
                    {exportError && <div className="dc-menu-error" role="alert">{exportError}</div>}
                    {href && <hr />}
                    <button className="dc-danger" onClick={() => { if (confirming) { setMenuOpen(false); act.remove(id); } else setConfirming(true); }}>
                      {confirming ? 'Click again to delete' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
              {href && <button className="dc-openbtn" title={'Open: ' + (label || id)} onClick={() => window.open(href, '_blank')}>{OPEN}</button>}
            </div>
          </div>
        </div>
        <div className="dc-winbody" style={{ padding: DC.winPad, background: DC.winBody }}>
          {/* Spike rule 4: a live card must always be painted. Chrome can skip
              the subtree of a content-visibility card, and a skipped subtree
              loses the paint and the layer that rule 2 gives the iframe, so
              the property goes on the placeholder card only. For the same
              reason the iframe never defers its load: the budget mounts it
              early, up to DC.mountMargin outside the view, so that the screen
              is ready before the user reaches it. */}
          <div className="dc-card" style={live ? { width, height }
            : { width, height, contentVisibility: 'auto', containIntrinsicSize: `${width}px ${height}px` }}>
            {live
              ? <iframe key={href} src={href} title={screenTitle} style={{ width, height }} />
              : <div className="dc-placeholder">{screenTitle}</div>}
            <div className="dc-shield" title="Open to edit" onClick={() => { if (href) location.href = href; }} />
          </div>
        </div>
      </div>
      {SIDES.map(([k, pos]) => [
        // An arrow end can be dropped on a handle (to move the arrow to that
        // side), but no new arrow starts from one.
        <Handle key={'s' + k} type="source" id={k} position={pos} isConnectableStart={false} />,
        <Handle key={'t' + k} type="target" id={k} position={pos} isConnectableStart={false} />,
      ])}
    </>
  );
}
export default memo(WindowNode);
