import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

const DASH = { strokeDasharray: 'calc(5px * var(--dc-inv-zoom, 1)) calc(6px * var(--dc-inv-zoom, 1))' };

// A built-in bezier arrow. The custom edge exists only for the label pill,
// which is world px like the old flow labels. No routing: an arrow can cross
// a window (user decision).
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={data.dashed ? DASH : undefined} interactionWidth={24} />
      {data.label && (
        <EdgeLabelRenderer>
          <div className="dc-flowlabel nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
export default memo(FlowEdge);
