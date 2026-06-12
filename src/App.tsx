import { useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./index.css";

import { InputPanel, parseWorkflowJson } from "./components/InputPanel";
import { GraphView } from "./components/GraphView";
import { TaskDetailsDrawer } from "./components/TaskDetailsDrawer";
import { JsonDiffView } from "./components/JsonDiffView";
import { diffWorkflows, type MergedNode } from "./lib/workflowDiff";
import type { WorkflowDefinition } from "./lib/workflowGraph";
import { EXAMPLE_AFTER, EXAMPLE_BEFORE } from "./examples";

type Screen = "input" | "review";
type ReviewTab = "graph" | "json";

interface ParsedPair {
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("input");
  const [tab, setTab] = useState<ReviewTab>("graph");
  const [beforeText, setBeforeText] = useState("");
  const [afterText, setAfterText] = useState("");
  const [beforeError, setBeforeError] = useState<string | null>(null);
  const [afterError, setAfterError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPair | null>(null);
  const [selectedNode, setSelectedNode] = useState<MergedNode | null>(null);

  const mergedGraph = useMemo(
    () => (parsed ? diffWorkflows(parsed.before, parsed.after) : null),
    [parsed],
  );

  const handleCompare = () => {
    const before = parseWorkflowJson(beforeText);
    const after = parseWorkflowJson(afterText);
    setBeforeError(before.error);
    setAfterError(after.error);
    if (before.error || after.error) return;
    if (!before.definition && !after.definition) return;

    setParsed({ before: before.definition, after: after.definition });
    setSelectedNode(null);
    setTab("graph");
    setScreen("review");
  };

  const handleLoadExample = () => {
    setBeforeText(EXAMPLE_BEFORE);
    setAfterText(EXAMPLE_AFTER);
    setBeforeError(null);
    setAfterError(null);
  };

  const handleEditInputs = () => {
    setScreen("input");
    setSelectedNode(null);
  };

  const workflowName =
    parsed?.after?.name ?? parsed?.before?.name ?? "workflow";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <span className="app-logo">⬡</span>
          Orkes Workflow Diff
          {screen === "review" ? (
            <span className="app-workflow-name">{workflowName}</span>
          ) : null}
        </div>

        {screen === "review" ? (
          <div className="header-controls">
            <nav className="tabs">
              <button
                className={`tab${tab === "graph" ? " tab-active" : ""}`}
                onClick={() => setTab("graph")}
              >
                Graph
              </button>
              <button
                className={`tab${tab === "json" ? " tab-active" : ""}`}
                onClick={() => setTab("json")}
              >
                JSON
              </button>
            </nav>
            <button className="btn" onClick={handleEditInputs}>
              Edit inputs
            </button>
          </div>
        ) : null}
      </header>

      <main className="app-main">
        {screen === "input" ? (
          <InputPanel
            beforeText={beforeText}
            afterText={afterText}
            beforeError={beforeError}
            afterError={afterError}
            onBeforeChange={setBeforeText}
            onAfterChange={setAfterText}
            onCompare={handleCompare}
            onLoadExample={handleLoadExample}
          />
        ) : mergedGraph && parsed ? (
          tab === "graph" ? (
            <div className="review-graph">
              <GraphView graph={mergedGraph} onSelectNode={setSelectedNode} />
              {selectedNode ? (
                <TaskDetailsDrawer
                  node={selectedNode}
                  onClose={() => setSelectedNode(null)}
                />
              ) : null}
            </div>
          ) : (
            <JsonDiffView before={parsed.before} after={parsed.after} />
          )
        ) : null}
      </main>
    </div>
  );
}

export default App;
