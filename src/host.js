// The host protocol: a canvas in an iframe talks to its host with
// postMessage, target origin '*'. A canvas that is not embedded posts
// nothing: it would only talk to itself.
//   canvas → host: { type: '__dc_present' } on start and as the probe answer
//   canvas → host: { type: '__dc_zoom', scale } once per settled gesture,
//                  never the same scale twice (a probe resets that)
//   host → canvas: { type: '__dc_set_zoom', scale } zooms on the view middle
//   host → canvas: { type: '__dc_probe' }
export function createHost({ getZoom, zoomTo, target = globalThis.window,
  embedded = () => !!globalThis.window && globalThis.window.parent !== globalThis.window,
  post = (msg) => globalThis.window.parent.postMessage(msg, '*') }) {
  const isEmbedded = () => (typeof embedded === 'function' ? embedded() : !!embedded);
  let posted;
  const settled = () => {
    if (!isEmbedded()) return;
    const scale = getZoom();
    if (scale === posted) return;
    posted = scale;
    post({ type: '__dc_zoom', scale });
  };
  const onMessage = (e) => {
    const d = e.data;
    if (d && d.type === '__dc_set_zoom' && Number.isFinite(d.scale) && d.scale > 0) zoomTo(d.scale);
    else if (d && d.type === '__dc_probe') {
      if (isEmbedded()) post({ type: '__dc_present' });
      posted = undefined;
      settled();
    }
  };
  target.addEventListener('message', onMessage);
  if (isEmbedded()) post({ type: '__dc_present' });
  return { settled, dispose: () => target.removeEventListener('message', onMessage) };
}
