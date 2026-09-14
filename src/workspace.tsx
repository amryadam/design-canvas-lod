import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './workspace.css';

export type WorkspaceOptions = {
  baseUrl: string;
  host: 'standalone' | 'claude';
};

type ProbeNodeData = {
  title: string;
  active: boolean;
  activate: () => void;
};

const snapshot = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="160"><rect width="100%" height="100%" fill="#e0f2fe"/><text x="24" y="84" font-family="Arial" font-size="20" fill="#0c4a6e">Snapshot</text></svg>',
)}`;

function ProbeNode({ data }: NodeProps<Node<ProbeNodeData>>) {
  return (
    <section className="probe-node" data-testid="probe-screen">
      <Handle type="target" position={Position.Left} />
      <header>{data.title}</header>
      {data.active ? (
        <iframe data-live-screen="" title={`${data.title} live preview`} src="about:blank" />
      ) : (
        <img alt={`Probe snapshot: ${data.title}`} src={snapshot} />
      )}
      <button type="button" onClick={data.activate}>Activate</button>
      <Handle type="source" position={Position.Right} />
    </section>
  );
}

function Workspace() {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const deactivateOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveId(null);
    };
    window.addEventListener('keydown', deactivateOnEscape);
    return () => window.removeEventListener('keydown', deactivateOnEscape);
  }, []);

  const nodes: Array<Node<ProbeNodeData>> = [
    { id: 'probe-one', type: 'probe', position: { x: 40, y: 80 }, data: { title: 'Customer details', active: activeId === 'probe-one', activate: () => setActiveId('probe-one') } },
    { id: 'probe-two', type: 'probe', position: { x: 400, y: 220 }, data: { title: 'Payment review', active: activeId === 'probe-two', activate: () => setActiveId('probe-two') } },
  ];

  return (
    <div className="workspace" data-host="probe">
      <ReactFlow fitView nodes={nodes} nodeTypes={{ probe: ProbeNode }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function mountWorkspace(element: HTMLElement, _options: WorkspaceOptions): () => void {
  const root: Root = createRoot(element);
  root.render(<Workspace />);
  return () => root.unmount();
}
