import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import type { MergedGraph, MergedNode, NodeStatus } from "../lib/workflowDiff";
import { layoutGraph, type FlowNode } from "../lib/layout";

const STATUS_LABELS: Record<NodeStatus, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
};

function nodeClass(merged: MergedNode, base: string): string {
  return `${base} status-${merged.status}`;
}

function NodeHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

function TaskNode({ data }: NodeProps<FlowNode>) {
  const { merged } = data;
  const subWorkflow =
    merged.kind === "TASK" &&
    (merged.after?.subWorkflowParam ?? merged.before?.subWorkflowParam);
  return (
    <div className={nodeClass(merged, "wf-node wf-task")}>
      <NodeHandles />
      <div className="wf-task-head">
        <span className="wf-task-name">{merged.name}</span>
        <span className="wf-type-chip">{merged.type}</span>
      </div>
      <div className="wf-task-ref">{merged.ref}</div>
      {subWorkflow ? (
        <div className="wf-task-sub">
          ↳ {subWorkflow.name}
          {subWorkflow.version != null ? ` v${subWorkflow.version}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function StartEndNode({ data }: NodeProps<FlowNode>) {
  const { merged } = data;
  return (
    <div className={nodeClass(merged, "wf-node wf-start-end")}>
      <NodeHandles />
      {merged.kind === "START" ? "start" : "final"}
    </div>
  );
}

function BarNode({ data }: NodeProps<FlowNode>) {
  const { merged } = data;
  const kindClass =
    merged.kind === "DO_WHILE" || merged.kind === "DO_WHILE_END"
      ? "wf-bar-loop"
      : "wf-bar-forkjoin";
  return (
    <div className={nodeClass(merged, `wf-node wf-bar ${kindClass}`)}>
      <NodeHandles />
      <span className="wf-bar-label">
        {merged.name}
        <span className="wf-bar-type">{merged.type}</span>
      </span>
    </div>
  );
}

function SwitchNode({ data }: NodeProps<FlowNode>) {
  const { merged } = data;
  return (
    <div className={nodeClass(merged, "wf-node wf-switch")}>
      <NodeHandles />
      <div className="wf-switch-inner">
        <div className="wf-task-head">
          <span className="wf-task-name">{merged.name}</span>
          <span className="wf-type-chip wf-type-chip-switch">{merged.type}</span>
        </div>
        <div className="wf-task-ref">{merged.ref}</div>
      </div>
    </div>
  );
}

function DynamicNode({ data }: NodeProps<FlowNode>) {
  const { merged } = data;
  return (
    <div className={nodeClass(merged, "wf-node wf-dynamic")}>
      <NodeHandles />
      <div className="wf-task-name">dynamic tasks</div>
      <div className="wf-task-ref">resolved at runtime</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  task: TaskNode,
  startEnd: StartEndNode,
  bar: BarNode,
  switch: SwitchNode,
  dynamic: DynamicNode,
};

function Legend() {
  return (
    <Panel position="top-right" className="wf-legend">
      <div className="wf-legend-title">Legend</div>
      {(["added", "removed", "changed", "unchanged"] as NodeStatus[]).map(
        status => (
          <div key={status} className="wf-legend-row">
            <span className={`wf-legend-swatch swatch-${status}`} />
            {STATUS_LABELS[status]}
          </div>
        ),
      )}
    </Panel>
  );
}

interface GraphViewProps {
  graph: MergedGraph;
  onSelectNode: (node: MergedNode | null) => void;
}

export function GraphView({ graph, onSelectNode }: GraphViewProps) {
  const { nodes, edges } = useMemo(() => layoutGraph(graph), [graph]);

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) =>
          onSelectNode((node as FlowNode).data.merged)
        }
        onPaneClick={() => onSelectNode(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
        <Legend />
      </ReactFlow>
    </div>
  );
}
