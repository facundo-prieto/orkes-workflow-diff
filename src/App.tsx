import { useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./index.css";

import {
  InputPanel,
  parseWorkflowJson,
  type InputMode,
} from "./components/InputPanel";
import { GraphView } from "./components/GraphView";
import { TaskDetailsDrawer } from "./components/TaskDetailsDrawer";
import { JsonDiffView } from "./components/JsonDiffView";
import { diffWorkflows, type MergedNode } from "./lib/workflowDiff";
import type { WorkflowDefinition } from "./lib/workflowGraph";
import type { PrImportResult, PrWorkflowFile } from "./lib/prImport";
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
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [beforeText, setBeforeText] = useState("");
  const [afterText, setAfterText] = useState("");
  const [beforeError, setBeforeError] = useState<string | null>(null);
  const [afterError, setAfterError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPair | null>(null);
  const [selectedNode, setSelectedNode] = useState<MergedNode | null>(null);

  // PR import state
  const [prRefText, setPrRefText] = useState("");
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [prResult, setPrResult] = useState<PrImportResult | null>(null);
  // Path of the PR workflow currently under review; null = reviewing a paste.
  const [prSelectedPath, setPrSelectedPath] = useState<string | null>(null);

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
    setPrSelectedPath(null);
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

  const handleLoadPr = async () => {
    setPrLoading(true);
    setPrError(null);
    setPrResult(null);
    try {
      const response = await fetch(
        `/api/pr?ref=${encodeURIComponent(prRefText.trim())}`,
      );
      const body = (await response.json()) as
        | PrImportResult
        | { error: string };
      if (!response.ok || "error" in body) {
        const message =
          "error" in body ? body.error : `Request failed (${response.status})`;
        setPrError(message);
        return;
      }
      setPrResult(body);
    } catch (err) {
      setPrError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrLoading(false);
    }
  };

  const handleSelectPrWorkflow = (workflow: PrWorkflowFile) => {
    setParsed({ before: workflow.before, after: workflow.after });
    setPrSelectedPath(workflow.path);
    setSelectedNode(null);
    setTab("graph");
    setScreen("review");
  };

  const handleEditInputs = () => {
    // Land back on the source the current review came from.
    setInputMode(prSelectedPath !== null ? "pr" : "paste");
    setScreen("input");
    setSelectedNode(null);
  };

  const reviewingPr = prSelectedPath !== null && prResult !== null;
  const workflowName =
    parsed?.after?.name ?? parsed?.before?.name ?? "workflow";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <span className="app-logo">⬡</span>
          Orkes Workflow Diff
          {screen === "review" ? (
            reviewingPr && prResult.workflows.length > 1 ? (
              <select
                className="workflow-select mono"
                value={prSelectedPath ?? ""}
                onChange={e => {
                  const next = prResult.workflows.find(
                    wf => wf.path === e.target.value,
                  );
                  if (next) handleSelectPrWorkflow(next);
                }}
                title={prSelectedPath ?? undefined}
              >
                {prResult.workflows.map(wf => (
                  <option key={wf.path} value={wf.path}>
                    {wf.after?.name ?? wf.before?.name ?? wf.path}
                  </option>
                ))}
              </select>
            ) : (
              <span className="app-workflow-name">{workflowName}</span>
            )
          ) : null}
          {screen === "review" && reviewingPr ? (
            <a
              className="pr-link"
              href={prResult.url}
              target="_blank"
              rel="noreferrer"
            >
              PR #{prResult.number}
            </a>
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
              {reviewingPr ? "Back to PR" : "Edit inputs"}
            </button>
          </div>
        ) : null}
      </header>

      <main className="app-main">
        {screen === "input" ? (
          <InputPanel
            mode={inputMode}
            onModeChange={setInputMode}
            beforeText={beforeText}
            afterText={afterText}
            beforeError={beforeError}
            afterError={afterError}
            onBeforeChange={setBeforeText}
            onAfterChange={setAfterText}
            onCompare={handleCompare}
            onLoadExample={handleLoadExample}
            prRefText={prRefText}
            onPrRefChange={setPrRefText}
            onLoadPr={handleLoadPr}
            prLoading={prLoading}
            prError={prError}
            prResult={prResult}
            onSelectPrWorkflow={handleSelectPrWorkflow}
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
