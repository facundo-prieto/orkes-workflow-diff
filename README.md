# Orkes Workflow Diff

A single-page tool for reviewing changes to [Orkes Conductor](https://orkes.io/) workflow definition JSONs. Paste a *Before* and *After* workflow definition and review the change either as a single merged, color-coded DAG or as a full-document side-by-side JSON diff.

![Screenshot placeholder](docs/screenshot.png)

## Running it

```bash
bun install
bun dev        # http://localhost:3000 (set PORT to override)
```

Other scripts:

```bash
bun test           # unit tests for the pure graph/diff libs
bun run typecheck  # tsc --noEmit
bun run build      # production bundle into dist/
bun start          # serve the app in production mode
```

Click **Load example** on the input screen to see a realistic workflow pair (SWITCH, FORK_JOIN/JOIN, DO_WHILE, SUB_WORKFLOW, HTTP) with an added task, a removed task and a changed task.

## How the merge & coloring works

1. **Graph building** (`src/lib/workflowGraph.ts`): each workflow definition is converted into a DAG following the structural rules of Conductor's Apache-2.0 `WorkflowDAG.js`. Tasks chain positionally; SWITCH/DECISION branch via `decisionCases`/`defaultCase` (branch edges are labeled with the case value or `default`), FORK_JOIN fans out over `forkTasks` and the following JOIN collects branch exits, DO_WHILE wraps its `loopOver` body between the loop node and a synthetic `<ref>-END` node (with a dashed loop-back edge), FORK_JOIN_DYNAMIC gets a dashed "dynamic tasks" placeholder, and TERMINATE ends its branch without connecting to the final node. Synthetic `__start` / `__final` nodes bracket the whole graph.

2. **Merging** (`src/lib/workflowDiff.ts`): the Before and After graphs are built independently, then merged by taking the union of node refs (keyed by `taskReferenceName`) and the union of edges (identity = source + target + label). Each node is classified:
   - **added** (green) — only in After
   - **removed** (red, dashed) — only in Before
   - **changed** (amber) — in both, but the task objects are deep-unequal
   - **unchanged** (gray) — in both and deep-equal

   Edges get the same treatment: green = only in After, red dashed = only in Before, gray = both.

3. **Layout** (`src/lib/layout.ts`): the merged graph is laid out once with dagre (`rankdir: TB`) and rendered with React Flow. Clicking a node opens a details drawer; *changed* nodes show a per-task side-by-side diff (pretty-printed with sorted keys).

### Ignoring fields when classifying "changed"

The deep comparison can skip top-level task fields (e.g. server-populated metadata). Add field names to `CHANGE_IGNORED_FIELDS` in [`src/lib/workflowDiff.ts`](src/lib/workflowDiff.ts):

```ts
export const CHANGE_IGNORED_FIELDS: string[] = [];
```

## Code layout

| Path | Purpose |
| --- | --- |
| `src/lib/workflowGraph.ts` | Types + definition → graph builder (pure, no React) |
| `src/lib/workflowDiff.ts` | Merge + diff classification (pure), `CHANGE_IGNORED_FIELDS` |
| `src/lib/layout.ts` | Dagre layout → React Flow nodes/edges |
| `src/components/GraphView.tsx` | React Flow canvas, custom node shapes, legend |
| `src/components/TaskDetailsDrawer.tsx` | Per-task details / per-task diff drawer |
| `src/components/JsonDiffView.tsx` | Full-document side-by-side JSON diff |
| `src/components/InputPanel.tsx` | Paste screen + JSON parse validation |
| `src/examples.ts` | Built-in example workflow pair |

Built with Bun, React 18, `@xyflow/react`, `@dagrejs/dagre` and `react-diff-viewer-continued`.
