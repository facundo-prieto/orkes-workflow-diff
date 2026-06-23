import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition, WorkflowTask } from "./workflowGraph";
import {
  buildMergedDefinition,
  mergeTaskLists,
  taskDiffStatus,
} from "./mergedDefinition";

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

const refs = (tasks: WorkflowTask[]) => tasks.map(t => t.taskReferenceName);
const statuses = (tasks: WorkflowTask[]) =>
  Object.fromEntries(tasks.map(t => [t.taskReferenceName, taskDiffStatus(t)]));

describe("mergeTaskLists", () => {
  test("classifies added, removed, changed and unchanged tasks", () => {
    const merged = mergeTaskLists(
      [simple("keep", { x: 1 }), simple("modify", { url: "v1" }), simple("drop")],
      [simple("keep", { x: 1 }), simple("modify", { url: "v2" }), simple("brand_new")],
    );
    expect(statuses(merged)).toEqual({
      keep: "unchanged",
      modify: "changed",
      drop: "removed",
      brand_new: "added",
    });
  });

  test("splices removed tasks back into their original position", () => {
    const merged = mergeTaskLists(
      [simple("a"), simple("dropped"), simple("b")],
      [simple("a"), simple("b")],
    );
    expect(refs(merged)).toEqual(["a", "dropped", "b"]);
  });

  test("appends tasks removed from the tail", () => {
    const merged = mergeTaskLists(
      [simple("a"), simple("tail")],
      [simple("a")],
    );
    expect(refs(merged)).toEqual(["a", "tail"]);
  });

  test("emits a moved task once, at its after position", () => {
    const merged = mergeTaskLists(
      [simple("a"), simple("b"), simple("c")],
      [simple("b"), simple("a"), simple("c")],
    );
    expect(refs(merged)).toEqual(["b", "a", "c"]);
  });
});

describe("nested structures", () => {
  test("recurses into switch decision cases and keeps removed cases", () => {
    const beforeSwitch: WorkflowTask = {
      name: "router",
      taskReferenceName: "router",
      type: "SWITCH",
      decisionCases: {
        kept: [simple("in_kept", { v: 1 })],
        removed_case: [simple("in_removed")],
      },
      defaultCase: [simple("fallback")],
    };
    const afterSwitch: WorkflowTask = {
      name: "router",
      taskReferenceName: "router",
      type: "SWITCH",
      decisionCases: {
        kept: [simple("in_kept", { v: 2 })],
        new_case: [simple("in_new")],
      },
      defaultCase: [simple("fallback")],
    };

    const [merged] = mergeTaskLists([beforeSwitch], [afterSwitch]);
    expect(taskDiffStatus(merged!)).toBe("unchanged"); // own fields identical
    expect(Object.keys(merged!.decisionCases!)).toEqual([
      "kept",
      "new_case",
      "removed_case",
    ]);
    expect(statuses(merged!.decisionCases!.kept!)).toEqual({
      in_kept: "changed",
    });
    expect(statuses(merged!.decisionCases!.new_case!)).toEqual({
      in_new: "added",
    });
    expect(statuses(merged!.decisionCases!.removed_case!)).toEqual({
      in_removed: "removed",
    });
  });

  test("marks an entire removed subtree as removed", () => {
    const fork: WorkflowTask = {
      name: "fork",
      taskReferenceName: "fork",
      type: "FORK_JOIN",
      forkTasks: [[simple("branch_a")], [simple("branch_b")]],
    };
    const merged = mergeTaskLists([fork], []);
    expect(taskDiffStatus(merged[0]!)).toBe("removed");
    expect(statuses(merged[0]!.forkTasks![0]!)).toEqual({ branch_a: "removed" });
    expect(statuses(merged[0]!.forkTasks![1]!)).toEqual({ branch_b: "removed" });
  });

  test("aligns fork branches positionally and keeps extra before branches", () => {
    const beforeFork: WorkflowTask = {
      name: "fork",
      taskReferenceName: "fork",
      type: "FORK_JOIN",
      forkTasks: [[simple("a")], [simple("dropped_branch")]],
    };
    const afterFork: WorkflowTask = {
      name: "fork",
      taskReferenceName: "fork",
      type: "FORK_JOIN",
      forkTasks: [[simple("a")]],
    };
    const [merged] = mergeTaskLists([beforeFork], [afterFork]);
    expect(merged!.forkTasks).toHaveLength(2);
    expect(statuses(merged!.forkTasks![1]!)).toEqual({
      dropped_branch: "removed",
    });
  });

  test("recurses into do-while loop bodies", () => {
    const beforeLoop: WorkflowTask = {
      name: "loop",
      taskReferenceName: "loop",
      type: "DO_WHILE",
      loopCondition: "$.x < 3",
      loopOver: [simple("body_old")],
    };
    const afterLoop: WorkflowTask = {
      name: "loop",
      taskReferenceName: "loop",
      type: "DO_WHILE",
      loopCondition: "$.x < 5",
      loopOver: [simple("body_new")],
    };
    const [merged] = mergeTaskLists([beforeLoop], [afterLoop]);
    expect(taskDiffStatus(merged!)).toBe("changed"); // loopCondition changed
    expect(statuses(merged!.loopOver!)).toEqual({
      body_old: "removed",
      body_new: "added",
    });
  });
});

describe("buildMergedDefinition", () => {
  test("after definition wins top-level fields; null sides work", () => {
    const before = def([simple("a")]);
    const merged = buildMergedDefinition(before, null);
    expect(merged.name).toBe("test_wf");
    expect(statuses(merged.tasks!)).toEqual({ a: "removed" });

    const added = buildMergedDefinition(null, def([simple("b")]));
    expect(statuses(added.tasks!)).toEqual({ b: "added" });
  });
});
