/**
 * Dagre auto-layout of the merged graph, producing React Flow nodes/edges.
 */

import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { GraphNodeKind } from "./workflowGraph";
import type { MergedEdge, MergedGraph, MergedNode } from "./workflowDiff";

export type FlowNodeData = {
  merged: MergedNode;
  [key: string]: unknown;
};

export type FlowNode = Node<FlowNodeData>;

/** React Flow custom node type per structural kind. */
function nodeTypeFor(kind: GraphNodeKind): string {
  switch (kind) {
    case "START":
    case "FINAL":
      return "startEnd";
    case "FORK":
    case "JOIN":
    case "DO_WHILE":
    case "DO_WHILE_END":
      return "bar";
    case "SWITCH":
      return "switch";
    case "DYNAMIC_PLACEHOLDER":
      return "dynamic";
    default:
      return "task";
  }
}

/** Estimated dimensions per node kind (used by dagre). */
export function dimensionsFor(kind: GraphNodeKind): { width: number; height: number } {
  switch (kind) {
    case "START":
    case "FINAL":
      return { width: 110, height: 46 };
    case "FORK":
    case "JOIN":
    case "DO_WHILE":
    case "DO_WHILE_END":
      return { width: 260, height: 34 };
    case "SWITCH":
      return { width: 230, height: 78 };
    case "DYNAMIC_PLACEHOLDER":
      return { width: 180, height: 54 };
    default:
      return { width: 220, height: 70 };
  }
}

const EDGE_COLORS: Record<MergedEdge["status"], string> = {
  added: "#2e7d32",
  removed: "#c62828",
  unchanged: "#9e9e9e",
};

function edgeId(edge: MergedEdge): string {
  return `${edge.from}->${edge.to}${edge.label ? `:${edge.label}` : ""}${edge.loopBack ? ":loop" : ""}`;
}

export function layoutGraph(graph: MergedGraph): { nodes: FlowNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.ref, dimensionsFor(node.kind));
  }
  for (const edge of graph.edges) {
    // Loop-back edges would confuse the rank assignment; skip them in layout.
    if (edge.loopBack) continue;
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const nodes: FlowNode[] = graph.nodes.map(merged => {
    const { width, height } = dimensionsFor(merged.kind);
    const pos = g.node(merged.ref);
    return {
      id: merged.ref,
      type: nodeTypeFor(merged.kind),
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
      width,
      height,
      data: { merged },
    };
  });

  const edges: Edge[] = graph.edges.map(edge => {
    const color = EDGE_COLORS[edge.status];
    const dashed = edge.status === "removed" || edge.loopBack;
    return {
      id: edgeId(edge),
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      label: edge.label,
      labelStyle: { fill: "#555", fontSize: 11 },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
      style: {
        stroke: color,
        strokeWidth: edge.status === "unchanged" ? 1.5 : 2,
        strokeDasharray: dashed ? "6 4" : undefined,
        opacity: edge.loopBack ? 0.45 : 1,
      },
      markerEnd: edge.loopBack
        ? undefined
        : { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      zIndex: edge.status === "unchanged" ? 0 : 1,
    };
  });

  return { nodes, edges };
}
