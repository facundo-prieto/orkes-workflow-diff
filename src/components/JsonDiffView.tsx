import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { stableStringify } from "../lib/workflowDiff";
import type { WorkflowDefinition } from "../lib/workflowGraph";

interface JsonDiffViewProps {
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
}

export function JsonDiffView({ before, after }: JsonDiffViewProps) {
  return (
    <div className="json-diff">
      <ReactDiffViewer
        oldValue={before ? stableStringify(before) : ""}
        newValue={after ? stableStringify(after) : ""}
        splitView
        leftTitle="Before"
        rightTitle="After"
        compareMethod={DiffMethod.LINES}
        extraLinesSurroundingDiff={3}
        useDarkTheme={false}
      />
    </div>
  );
}
