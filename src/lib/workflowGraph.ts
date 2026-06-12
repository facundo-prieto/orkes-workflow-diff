/**
 * Pure (no React) builder that converts an Orkes Conductor workflow
 * definition into a DAG of nodes + edges, following the structural rules
 * of Conductor's Apache-2.0 WorkflowDAG.js.
 */

export interface WorkflowTask {
  name: string;
  taskReferenceName: string;
  type?: string;
  inputParameters?: Record<string, unknown>;
  decisionCases?: Record<string, WorkflowTask[]>;
  defaultCase?: WorkflowTask[];
  forkTasks?: WorkflowTask[][];
  joinOn?: string[];
  loopOver?: WorkflowTask[];
  loopCondition?: string;
  subWorkflowParam?: { name?: string; version?: number };
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  name?: string;
  version?: number;
  tasks?: WorkflowTask[];
  [key: string]: unknown;
}

/** Visual/structural category of a node (drives shape + layout sizing). */
export type GraphNodeKind =
  | "START"
  | "FINAL"
  | "TASK"
  | "SWITCH"
  | "FORK"
  | "JOIN"
  | "DO_WHILE"
  | "DO_WHILE_END"
  | "DYNAMIC_PLACEHOLDER";

export interface GraphNode {
  /** taskReferenceName (or synthetic ref like __start, <ref>-END). */
  ref: string;
  name: string;
  type: string;
  kind: GraphNodeKind;
  /** Original task object; null for synthetic nodes. */
  task: WorkflowTask | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** SWITCH branch label (case value or "default"). */
  label?: string;
  /** DO_WHILE end -> start loop-back edge. */
  loopBack?: boolean;
}

export interface WorkflowGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

export const START_REF = "__start";
export const FINAL_REF = "__final";

/** An antecedent: an upstream node ref plus an optional edge label. */
interface Antecedent {
  ref: string;
  label?: string;
}

function kindForType(type: string): GraphNodeKind {
  switch (type) {
    case "SWITCH":
    case "DECISION":
      return "SWITCH";
    case "FORK_JOIN":
    case "FORK":
    case "FORK_JOIN_DYNAMIC":
      return "FORK";
    case "JOIN":
      return "JOIN";
    case "DO_WHILE":
      return "DO_WHILE";
    default:
      return "TASK";
  }
}

class GraphBuilder {
  nodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];

  addNode(node: GraphNode): void {
    if (!this.nodes.has(node.ref)) {
      this.nodes.set(node.ref, node);
    }
  }

  addEdge(edge: GraphEdge): void {
    const exists = this.edges.some(
      e =>
        e.from === edge.from &&
        e.to === edge.to &&
        (e.label ?? "") === (edge.label ?? "") &&
        !!e.loopBack === !!edge.loopBack,
    );
    if (!exists) this.edges.push(edge);
  }

  connect(antecedents: Antecedent[], ref: string): void {
    for (const ant of antecedents) {
      this.addEdge({ from: ant.ref, to: ref, label: ant.label });
    }
  }

  /**
   * Process a sequential task list. Tasks chain positionally: the exits of
   * task N become the antecedents of task N+1. Returns the exit refs of the
   * whole list (the antecedents to use for whatever follows it).
   */
  processTaskList(tasks: WorkflowTask[], antecedents: Antecedent[]): Antecedent[] {
    let current = antecedents;
    for (const task of tasks) {
      current = this.processTask(task, current);
    }
    return current;
  }

  processTask(task: WorkflowTask, antecedents: Antecedent[]): Antecedent[] {
    const type = task.type ?? "SIMPLE";
    const ref = task.taskReferenceName;
    this.addNode({
      ref,
      name: task.name ?? ref,
      type,
      kind: kindForType(type),
      task,
    });
    this.connect(antecedents, ref);

    switch (type) {
      case "SWITCH":
      case "DECISION":
        return this.processSwitch(task, ref);
      case "FORK_JOIN":
      case "FORK":
        return this.processForkJoin(task, ref);
      case "FORK_JOIN_DYNAMIC":
        return this.processDynamicFork(task, ref);
      case "DO_WHILE":
        return this.processDoWhile(task, ref);
      case "TERMINATE":
        // Branch ends here; produces no exits.
        return [];
      default:
        return [{ ref }];
    }
  }

  private processSwitch(task: WorkflowTask, ref: string): Antecedent[] {
    const exits: Antecedent[] = [];
    const branches: Array<[string, WorkflowTask[]]> = Object.entries(
      task.decisionCases ?? {},
    );
    branches.push(["default", task.defaultCase ?? []]);

    for (const [label, branchTasks] of branches) {
      if (branchTasks.length === 0) {
        // Empty branch: the SWITCH node itself is an exit on this path.
        exits.push({ ref, label });
      } else {
        exits.push(...this.processTaskList(branchTasks, [{ ref, label }]));
      }
    }
    return exits;
  }

  private processForkJoin(task: WorkflowTask, ref: string): Antecedent[] {
    const forkTasks = task.forkTasks ?? [];
    if (forkTasks.length === 0) return [{ ref }];
    const exits: Antecedent[] = [];
    for (const branch of forkTasks) {
      if (branch.length === 0) {
        exits.push({ ref });
      } else {
        exits.push(...this.processTaskList(branch, [{ ref }]));
      }
    }
    return exits;
  }

  private processDynamicFork(task: WorkflowTask, ref: string): Antecedent[] {
    const placeholderRef = `${ref}_DF_CHILDREN`;
    this.addNode({
      ref: placeholderRef,
      name: "dynamic tasks",
      type: "DF_CHILDREN_PLACEHOLDER",
      kind: "DYNAMIC_PLACEHOLDER",
      task: null,
    });
    this.addEdge({ from: ref, to: placeholderRef });
    return [{ ref: placeholderRef }];
  }

  private processDoWhile(task: WorkflowTask, ref: string): Antecedent[] {
    const endRef = `${ref}-END`;
    const bodyExits = this.processTaskList(task.loopOver ?? [], [{ ref }]);
    this.addNode({
      ref: endRef,
      name: `${task.name ?? ref} [end]`,
      type: "DO_WHILE_END",
      kind: "DO_WHILE_END",
      task: null,
    });
    if (bodyExits.length === 0) {
      // Empty body (or body ends in TERMINATE): connect DO_WHILE directly.
      this.addEdge({ from: ref, to: endRef });
    } else {
      this.connect(bodyExits, endRef);
    }
    // Loop-back edge (dashed, subtle in the UI).
    this.addEdge({ from: endRef, to: ref, loopBack: true });
    return [{ ref: endRef }];
  }
}

/** Build the DAG for a workflow definition, including __start / __final. */
export function buildGraph(definition: WorkflowDefinition): WorkflowGraph {
  const builder = new GraphBuilder();
  builder.addNode({
    ref: START_REF,
    name: "start",
    type: "START",
    kind: "START",
    task: null,
  });

  const exits = builder.processTaskList(definition.tasks ?? [], [
    { ref: START_REF },
  ]);

  builder.addNode({
    ref: FINAL_REF,
    name: "final",
    type: "FINAL",
    kind: "FINAL",
    task: null,
  });
  builder.connect(exits, FINAL_REF);

  return { nodes: builder.nodes, edges: builder.edges };
}
