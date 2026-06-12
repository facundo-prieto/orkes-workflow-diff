import { describe, expect, test } from "bun:test";
import {
  buildGraph,
  FINAL_REF,
  START_REF,
  type WorkflowDefinition,
  type WorkflowTask,
} from "./workflowGraph";

function simple(ref: string): WorkflowTask {
  return { name: ref, taskReferenceName: ref, type: "SIMPLE" };
}

function def(tasks: WorkflowTask[]): WorkflowDefinition {
  return { name: "test_wf", version: 1, tasks };
}

function hasEdge(
  graph: ReturnType<typeof buildGraph>,
  from: string,
  to: string,
  label?: string,
): boolean {
  return graph.edges.some(
    e => e.from === from && e.to === to && (label === undefined || e.label === label),
  );
}

describe("buildGraph", () => {
  test("sequential tasks chain positionally between start and final", () => {
    const graph = buildGraph(def([simple("a"), simple("b"), simple("c")]));

    expect([...graph.nodes.keys()]).toEqual([START_REF, "a", "b", "c", FINAL_REF]);
    expect(hasEdge(graph, START_REF, "a")).toBe(true);
    expect(hasEdge(graph, "a", "b")).toBe(true);
    expect(hasEdge(graph, "b", "c")).toBe(true);
    expect(hasEdge(graph, "c", FINAL_REF)).toBe(true);
    expect(graph.edges).toHaveLength(4);
  });

  test("switch branches get labeled edges and exits union into the successor", () => {
    const graph = buildGraph(
      def([
        {
          name: "sw",
          taskReferenceName: "sw",
          type: "SWITCH",
          decisionCases: {
            yes: [simple("y1"), simple("y2")],
            no: [simple("n1")],
          },
          defaultCase: [simple("d1")],
        },
        simple("after"),
      ]),
    );

    expect(hasEdge(graph, "sw", "y1", "yes")).toBe(true);
    expect(hasEdge(graph, "y1", "y2")).toBe(true);
    expect(hasEdge(graph, "sw", "n1", "no")).toBe(true);
    expect(hasEdge(graph, "sw", "d1", "default")).toBe(true);

    // Exits of all branches converge on the successor task.
    expect(hasEdge(graph, "y2", "after")).toBe(true);
    expect(hasEdge(graph, "n1", "after")).toBe(true);
    expect(hasEdge(graph, "d1", "after")).toBe(true);
  });

  test("switch with empty default exits via the switch node itself", () => {
    const graph = buildGraph(
      def([
        {
          name: "sw",
          taskReferenceName: "sw",
          type: "SWITCH",
          decisionCases: { yes: [simple("y1")] },
        },
        simple("after"),
      ]),
    );

    expect(hasEdge(graph, "y1", "after")).toBe(true);
    expect(hasEdge(graph, "sw", "after", "default")).toBe(true);
  });

  test("fork_join fans out to branch heads and the join collects branch exits", () => {
    const graph = buildGraph(
      def([
        {
          name: "fork",
          taskReferenceName: "fork",
          type: "FORK_JOIN",
          forkTasks: [
            [simple("a1"), simple("a2")],
            [simple("b1")],
          ],
        },
        {
          name: "join",
          taskReferenceName: "join",
          type: "JOIN",
          joinOn: ["a2", "b1"],
        },
      ]),
    );

    expect(hasEdge(graph, "fork", "a1")).toBe(true);
    expect(hasEdge(graph, "a1", "a2")).toBe(true);
    expect(hasEdge(graph, "fork", "b1")).toBe(true);
    expect(hasEdge(graph, "a2", "join")).toBe(true);
    expect(hasEdge(graph, "b1", "join")).toBe(true);
    expect(hasEdge(graph, "join", FINAL_REF)).toBe(true);
    // No direct fork -> join edge.
    expect(hasEdge(graph, "fork", "join")).toBe(false);
  });

  test("fork_join_dynamic gets a placeholder child node", () => {
    const graph = buildGraph(
      def([
        { name: "dyn", taskReferenceName: "dyn", type: "FORK_JOIN_DYNAMIC" },
        { name: "join", taskReferenceName: "join", type: "JOIN" },
      ]),
    );

    const placeholder = graph.nodes.get("dyn_DF_CHILDREN");
    expect(placeholder?.kind).toBe("DYNAMIC_PLACEHOLDER");
    expect(hasEdge(graph, "dyn", "dyn_DF_CHILDREN")).toBe(true);
    expect(hasEdge(graph, "dyn_DF_CHILDREN", "join")).toBe(true);
  });

  test("do_while produces an END node, body chain and a loop-back edge", () => {
    const graph = buildGraph(
      def([
        {
          name: "loop",
          taskReferenceName: "loop",
          type: "DO_WHILE",
          loopCondition: "false",
          loopOver: [simple("body1"), simple("body2")],
        },
        simple("after"),
      ]),
    );

    const end = graph.nodes.get("loop-END");
    expect(end?.kind).toBe("DO_WHILE_END");
    expect(hasEdge(graph, "loop", "body1")).toBe(true);
    expect(hasEdge(graph, "body1", "body2")).toBe(true);
    expect(hasEdge(graph, "body2", "loop-END")).toBe(true);
    // END is the exit, not the DO_WHILE itself.
    expect(hasEdge(graph, "loop-END", "after")).toBe(true);
    expect(hasEdge(graph, "loop", "after")).toBe(false);
    // Loop-back edge END -> DO_WHILE.
    const loopBack = graph.edges.find(
      e => e.from === "loop-END" && e.to === "loop",
    );
    expect(loopBack?.loopBack).toBe(true);
  });

  test("terminate ends its branch and never connects to final", () => {
    const graph = buildGraph(
      def([
        {
          name: "sw",
          taskReferenceName: "sw",
          type: "SWITCH",
          decisionCases: {
            kill: [{ name: "stop", taskReferenceName: "stop", type: "TERMINATE" }],
          },
          defaultCase: [simple("ok")],
        },
      ]),
    );

    expect(hasEdge(graph, "sw", "stop", "kill")).toBe(true);
    expect(graph.edges.some(e => e.from === "stop")).toBe(false);
    expect(hasEdge(graph, "ok", FINAL_REF)).toBe(true);
  });

  test("sub_workflow is a plain leaf node carrying its task", () => {
    const graph = buildGraph(
      def([
        {
          name: "sub",
          taskReferenceName: "sub",
          type: "SUB_WORKFLOW",
          subWorkflowParam: { name: "child_wf", version: 3 },
        },
      ]),
    );

    const node = graph.nodes.get("sub");
    expect(node?.kind).toBe("TASK");
    expect(node?.task?.subWorkflowParam?.name).toBe("child_wf");
    expect(hasEdge(graph, "sub", FINAL_REF)).toBe(true);
  });
});
