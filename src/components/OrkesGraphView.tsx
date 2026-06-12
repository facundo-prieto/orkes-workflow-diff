/**
 * Diff renderer built on the official `orkes-workflow-visualizer` (the same
 * component the Conductor OSS UI uses). We feed it a merged before/after
 * definition whose tasks carry fake `executionData.status` values, so the
 * library's native execution-status styling paints the diff.
 */

import { useMemo } from "react";
import { WorkflowVisualizer } from "orkes-workflow-visualizer";
// Relative path: the package's exports map only exposes ".", so the bare
// "orkes-workflow-visualizer/dist/style.css" specifier does not resolve.
import "../../node_modules/orkes-workflow-visualizer/dist/style.css";
import type { NodeData } from "reaflow";

import {
  buildMergedDefinition,
  diffStatusToVisualizerStatus,
} from "../lib/mergedDefinition";
import type { MergedGraph, MergedNode, NodeStatus } from "../lib/workflowDiff";
import type { WorkflowDefinition } from "../lib/workflowGraph";

interface OrkesGraphViewProps {
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
  /** Flat merged graph from `diffWorkflows`; used for click → details lookup. */
  graph: MergedGraph;
  onSelectNode: (node: MergedNode) => void;
}

const LEGEND: Array<{ status: NodeStatus; label: string }> = [
  { status: "added", label: "Added" },
  { status: "removed", label: "Removed" },
  { status: "changed", label: "Changed" },
  { status: "unchanged", label: "Unchanged" },
];

export function OrkesGraphView({
  before,
  after,
  graph,
  onSelectNode,
}: OrkesGraphViewProps) {
  const merged = useMemo(
    () => buildMergedDefinition(before, after),
    [before, after],
  );
  const nodesByRef = useMemo(
    () => new Map(graph.nodes.map(n => [n.ref, n])),
    [graph],
  );

  const handleClick = (_e: unknown, node: NodeData) => {
    const mergedNode = nodesByRef.get(String(node.id));
    if (mergedNode) onSelectNode(mergedNode);
  };

  return (
    <div className="orkes-graph-view">
      <div className="wf-legend orkes-graph-legend">
        <div className="wf-legend-title">Legend</div>
        {LEGEND.map(({ status, label }) => (
          <div key={status} className="wf-legend-row">
            <span className={`wf-legend-swatch swatch-${status}`} />
            {label}
            {status !== "unchanged" &&
            diffStatusToVisualizerStatus(status) === undefined ? (
              <span className="orkes-legend-unmapped"> (unmapped)</span>
            ) : null}
          </div>
        ))}
      </div>
      <WorkflowVisualizer
        data={merged as Record<string, unknown>}
        zoomable
        pannable
        onClick={handleClick}
        // The visualizer tries to inline SUB_WORKFLOW bodies; we diff one
        // definition at a time, so always answer with an empty sub-workflow.
        subWorkflowFetcher={async () => ({ tasks: [] })}
      />
    </div>
  );
}
