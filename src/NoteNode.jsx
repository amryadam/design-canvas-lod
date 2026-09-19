import { memo } from 'react';

// A post-it. It drags as a whole; its place is saved as positions['note:<id>'].
function NoteNode({ data }) {
  return <div className="dc-note" style={{ width: data.w }}>{data.text}</div>;
}
export default memo(NoteNode);
