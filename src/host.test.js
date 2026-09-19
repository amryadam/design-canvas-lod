import { describe, expect, it, vi } from 'vitest';
import { createHost } from './host.js';

const make = (embedded, zoom = { v: 0.5 }) => {
  const target = new EventTarget();
  const posts = [];
  const zoomTo = vi.fn();
  const host = createHost({ getZoom: () => zoom.v, zoomTo, target, embedded, post: (m) => posts.push(m) });
  const send = (data) => target.dispatchEvent(new MessageEvent('message', { data }));
  return { host, posts, zoomTo, send, zoom };
};

describe('createHost', () => {
  it('says it is present when embedded', () => {
    expect(make(true).posts).toEqual([{ type: '__dc_present' }]);
  });
  it('posts each new settled zoom once', () => {
    const { host, posts, zoom } = make(true);
    host.settled(); host.settled();
    zoom.v = 0.25; host.settled();
    expect(posts.filter((m) => m.type === '__dc_zoom').map((m) => m.scale)).toEqual([0.5, 0.25]);
  });
  it('answers a probe and posts the zoom again', () => {
    const { host, posts, send } = make(true);
    host.settled(); send({ type: '__dc_probe' });
    expect(posts.map((m) => m.type)).toEqual(['__dc_present', '__dc_zoom', '__dc_present', '__dc_zoom']);
  });
  it('sets the zoom the host asks for, and only a real scale', () => {
    const { send, zoomTo } = make(false);
    send({ type: '__dc_set_zoom', scale: 2 });
    send({ type: '__dc_set_zoom', scale: 'big' });
    send({ type: '__dc_set_zoom', scale: 0 });
    expect(zoomTo.mock.calls).toEqual([[2]]);
  });
  it('posts nothing at the top level, and stops after dispose', () => {
    const { host, posts, send, zoomTo } = make(false);
    host.settled(); send({ type: '__dc_probe' });
    expect(posts).toEqual([]);
    host.dispose(); send({ type: '__dc_set_zoom', scale: 2 });
    expect(zoomTo).not.toHaveBeenCalled();
  });
});
