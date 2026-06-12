import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition, WorkflowTask } from "./workflowGraph";
import { buildGraph, FINAL_REF, START_REF } from "./workflowGraph";
import { deepEqual, diffWorkflows, mergeGraphs, stableStringify } from "./workflowDiff";

function simple(ref: string, input?: Record<string, unknown>): WorkflowTask {
  return {
    name: ref,
    taskReferenceName: ref,
    type: "SIMPLE",
    ...(input ? { inputParameters: input } : {}),
  };
}

function def(tasks: WorkflowTask[]): WorkflowDefinition {
  return { name: "test_wf", version: 1, tasks };
}

describe("deepEqual", () => {
  test("compares nested objects and arrays", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual("x", "x")).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("stableStringify", () => {
  test("sorts keys deterministically", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe("diffWorkflows", () => {
  test("classifies added, removed, changed and unchanged nodes", () => {
    const before = def([
      simple("keep", { x: 1 }),
      simple("modify", { url: "v1" }),
      simple("drop"),
    ]);
    const after = def([
      simple("keep", { x: 1 }),
      simple("modify", { url: "v2" }),
      simple("brand_new"),
    ]);

    const merged = diffWorkflows(before, after);
    const byRef = new Map(merged.nodes.map(n => [n.ref, n]));

    expect(byRef.get("keep")?.status).toBe("unchanged");
    expect(byRef.get("modify")?.status).toBe("changed");
    expect(byRef.get("drop")?.status).toBe("removed");
    expect(byRef.get("brand_new")?.status).toBe("added");
    expect(byRef.get(START_REF)?.status).toBe("unchanged");
    expect(byRef.get(FINAL_REF)?.status).toBe("unchanged");

    // Changed nodes keep both versions for the per-task diff.
    expect(byRef.get("modify")?.before?.inputParameters).toEqual({ url: "v1" });
    expect(byRef.get("modify")?.after?.inputParameters).toEqual({ url: "v2" });
    // Removed nodes only have a before; added only an after.
    expect(byRef.get("drop")?.after).toBeNull();
    expect(byRef.get("brand_new")?.before).toBeNull();
  });

  test("classifies edge statuses by presence in before/after", () => {
    const before = def([simple("a"), simple("b")]);
    const after = def([simple("a"), simple("c")]);

    const merged = diffWorkflows(before, after);
    const edge = (from: string, to: string) =>
      merged.edges.find(e => e.from === from && e.to === to);

    expect(edge(START_REF, "a")?.status).toBe("unchanged");
    expect(edge("a", "b")?.status).toBe("removed");
    expect(edge("b", FINAL_REF)?.status).toBe("removed");
    expect(edge("a", "c")?.status).toBe("added");
    expect(edge("c", FINAL_REF)?.status).toBe("added");
  });

  test("a missing before marks everything as added", () => {
    const after = def([simple("only")]);
    const merged = mergeGraphs(null, buildGraph(after));

    for (const node of merged.nodes) {
      expect(node.status).toBe("added");
    }
    for (const edge of merged.edges) {
      expect(edge.status).toBe("added");
    }
  });

  test("a missing after marks everything as removed", () => {
    const before = def([simple("only")]);
    const merged = mergeGraphs(buildGraph(before), null);

    for (const node of merged.nodes) {
      expect(node.status).toBe("removed");
    }
    for (const edge of merged.edges) {
      expect(edge.status).toBe("removed");
    }
  });
});
