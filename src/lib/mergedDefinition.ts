/**
 * Pure (no React) builder for a single "merged" workflow definition that
 * contains both versions of the workflow: the after-tree with every removed
 * before-task spliced back into its original branch position.
 *
 * Why: the official `orkes-workflow-visualizer` consumes a hierarchical task
 * tree (not a flat node list) and colors each node from
 * `task.executionData.status`. By expressing the diff as fake execution
 * statuses on a merged tree, the official Conductor renderer paints the diff
 * natively — no fork, no patch.
 */

import { deepEqual } from "./workflowDiff";
import type { WorkflowDefinition, WorkflowTask } from "./workflowGraph";
import type { NodeStatus } from "./workflowDiff";

/** Marker stashed on each merged task so renderers can recover the diff. */
export const DIFF_KEY = "__diff";

export interface TaskDiffMarker {
  status: NodeStatus;
}

/** Read the diff marker back off a merged task (e.g. in click handlers). */
export function taskDiffStatus(task: WorkflowTask): NodeStatus | null {
  const marker = task[DIFF_KEY] as TaskDiffMarker | undefined;
  return marker?.status ?? null;
}

/**
 * Conductor task statuses the visualizer theme knows how to paint
 * (`theme.taskStatusOutline` in orkes-workflow-visualizer):
 *
 *   COMPLETED                  → green outline
 *   COMPLETED_WITH_ERRORS      → amber outline (#EEAA00)
 *   CANCELED                   → orange outline + warning stripes
 *   FAILED / TIMED_OUT         → red outline + red hazard stripes
 *   SKIPPED                    → yellow outline + stripes
 *   IN_PROGRESS / SCHEDULED    → gray outline
 *   (undefined)                → plain card, no outline
 */
export type VisualizerTaskStatus =
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "CANCELED"
  | "FAILED"
  | "TIMED_OUT"
  | "SKIPPED"
  | "IN_PROGRESS"
  | "SCHEDULED";

/**
 * TODO(you): Map each diff status to the Conductor execution status whose
 * native styling best *reads* as that diff state. This is the visual language
 * of the whole diff view, so it is worth choosing deliberately:
 *
 *  - "added"   — green (COMPLETED) is the conventional "new" color.
 *  - "removed" — FAILED gives red + hazard stripes (loud); CANCELED gives
 *                orange stripes (softer). Which should "deleted" feel like?
 *  - "changed" — there is no natural "modified" status. Candidates:
 *                COMPLETED_WITH_ERRORS (amber), SKIPPED (yellow stripes),
 *                IN_PROGRESS (gray). Stripes imply "something is wrong",
 *                which a changed task isn't — consider a stripe-free one.
 *  - "unchanged" — return undefined so the card stays plain.
 */
export function diffStatusToVisualizerStatus(
  status: NodeStatus,
): VisualizerTaskStatus | undefined {
  // TODO(you): implement the mapping described above (≈5 lines).
  return undefined;
}

/** Task keys that hold nested task trees rather than the task's own config. */
const CHILD_CONTAINER_KEYS = [
  "decisionCases",
  "defaultCase",
  "forkTasks",
  "loopOver",
] as const;

/** A task's own fields, without nested children (and without our markers). */
function ownFields(task: WorkflowTask): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...task };
  for (const key of CHILD_CONTAINER_KEYS) delete copy[key];
  delete copy[DIFF_KEY];
  delete copy.executionData;
  return copy;
}

/** Stamp a merged task with its diff marker + fake execution status. */
function stamp(task: WorkflowTask, status: NodeStatus): WorkflowTask {
  const visualizerStatus = diffStatusToVisualizerStatus(status);
  return {
    ...task,
    [DIFF_KEY]: { status } satisfies TaskDiffMarker,
    ...(visualizerStatus
      ? { executionData: { status: visualizerStatus } }
      : {}),
  };
}

/** Recursively mark a before-only task (and its whole subtree) as removed. */
function markRemoved(task: WorkflowTask): WorkflowTask {
  const copy: WorkflowTask = { ...task };
  if (copy.decisionCases) {
    copy.decisionCases = Object.fromEntries(
      Object.entries(copy.decisionCases).map(([label, tasks]) => [
        label,
        tasks.map(markRemoved),
      ]),
    );
  }
  if (copy.defaultCase) copy.defaultCase = copy.defaultCase.map(markRemoved);
  if (copy.forkTasks) {
    copy.forkTasks = copy.forkTasks.map(branch => branch.map(markRemoved));
  }
  if (copy.loopOver) copy.loopOver = copy.loopOver.map(markRemoved);
  return stamp(copy, "removed");
}

/** Merge one task present in `after` (and maybe in `before`) recursively. */
function mergeTask(
  before: WorkflowTask | null,
  after: WorkflowTask,
): WorkflowTask {
  const status: NodeStatus =
    before === null
      ? "added"
      : deepEqual(ownFields(before), ownFields(after))
        ? "unchanged"
        : "changed";

  const merged: WorkflowTask = { ...after };

  if (after.decisionCases || before?.decisionCases) {
    // After's case order first, then cases that only exist in before.
    const labels = [
      ...Object.keys(after.decisionCases ?? {}),
      ...Object.keys(before?.decisionCases ?? {}).filter(
        label => !(label in (after.decisionCases ?? {})),
      ),
    ];
    merged.decisionCases = Object.fromEntries(
      labels.map(label => [
        label,
        mergeTaskLists(
          before?.decisionCases?.[label] ?? [],
          after.decisionCases?.[label] ?? [],
        ),
      ]),
    );
  }
  if (after.defaultCase || before?.defaultCase) {
    merged.defaultCase = mergeTaskLists(
      before?.defaultCase ?? [],
      after.defaultCase ?? [],
    );
  }
  if (after.forkTasks || before?.forkTasks) {
    // Fork branches carry no identity; align positionally.
    const count = Math.max(
      after.forkTasks?.length ?? 0,
      before?.forkTasks?.length ?? 0,
    );
    merged.forkTasks = Array.from({ length: count }, (_, i) =>
      mergeTaskLists(before?.forkTasks?.[i] ?? [], after.forkTasks?.[i] ?? []),
    );
  }
  if (after.loopOver || before?.loopOver) {
    merged.loopOver = mergeTaskLists(
      before?.loopOver ?? [],
      after.loopOver ?? [],
    );
  }

  return stamp(merged, status);
}

/**
 * Merge two sequential task lists, keyed by taskReferenceName. The after
 * order wins; removed before-tasks are spliced in just before the after-task
 * that followed them in the before list (or appended at the end). A task that
 * merely moved is emitted once, at its after position.
 */
export function mergeTaskLists(
  before: WorkflowTask[],
  after: WorkflowTask[],
): WorkflowTask[] {
  const beforeByRef = new Map(before.map(t => [t.taskReferenceName, t]));
  const afterRefs = new Set(after.map(t => t.taskReferenceName));
  const result: WorkflowTask[] = [];
  let bi = 0;

  const flushRemovedBefore = (stopRef: string | null) => {
    while (bi < before.length) {
      const b = before[bi]!;
      if (stopRef !== null && b.taskReferenceName === stopRef) break;
      bi++;
      // Tasks that still exist in `after` are emitted at their after
      // position; only genuinely removed tasks are spliced in here.
      if (!afterRefs.has(b.taskReferenceName)) result.push(markRemoved(b));
    }
  };

  for (const a of after) {
    if (beforeByRef.has(a.taskReferenceName)) {
      flushRemovedBefore(a.taskReferenceName);
      if (
        bi < before.length &&
        before[bi]!.taskReferenceName === a.taskReferenceName
      ) {
        bi++;
      }
    }
    result.push(mergeTask(beforeByRef.get(a.taskReferenceName) ?? null, a));
  }
  flushRemovedBefore(null);

  return result;
}

/**
 * Build the merged definition. The after definition's top-level fields win
 * (it is what the workflow will become); a fully deleted workflow falls back
 * to the before definition with every task marked removed.
 */
export function buildMergedDefinition(
  before: WorkflowDefinition | null,
  after: WorkflowDefinition | null,
): WorkflowDefinition {
  const base = after ?? before ?? {};
  return {
    ...base,
    tasks: mergeTaskLists(before?.tasks ?? [], after?.tasks ?? []),
  };
}
