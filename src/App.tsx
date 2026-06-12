import { useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./index.css";

import {
  InputPanel,
  parseWorkflowJson,
  type InputMode,
} from "./components/InputPanel";
import { GraphView } from "./components/GraphView";
import { OrkesGraphView } from "./components/OrkesGraphView";
import { TaskDetailsDrawer } from "./components/TaskDetailsDrawer";
import { JsonDiffView } from "./components/JsonDiffView";
import { diffWorkflows, type MergedNode } from "./lib/workflowDiff";
import type { WorkflowDefinition } from "./lib/workflowGraph";
import type { PrImportResult, PrWorkflowFile } from "./lib/prImport";
import {
  decodeShare,
  encodeShare,
  SHARE_HASH_KEY,
  sharePayloadFromHash,
  type SharePayload,
} from "./lib/share";
import { EXAMPLE_AFTER, EXAMPLE_BEFORE } from "./examples";

type Screen = "input" | "review";
type ReviewTab = "graph" | "json";
/** Graph renderer: official orkes-workflow-visualizer vs our xyflow view. */
type GraphRenderer = "orkes" | "classic";

/**
 * Build-time flag: PR import needs the Bun server, so static builds (e.g.
 * GitHub Pages) are produced with BUN_PUBLIC_PR_IMPORT=off (`bun run
 * build:pages`) to hide the tab. Defaults to enabled for `bun dev`/`bun
 * start`. The value is inlined into the bundle by Bun (bunfig `[serve.static]
 * env` in dev, `--env='BUN_PUBLIC_*'` in builds).
 */
const PR_IMPORT_ENABLED = process.env.BUN_PUBLIC_PR_IMPORT !== "off";

interface ParsedPair {
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
}

/** Encode the current pair into the URL hash so the address bar is shareable. */
async function writeShareHash(payload: SharePayload): Promise<void> {
  const encoded = await encodeShare(payload);
  history.replaceState(null, "", `#${SHARE_HASH_KEY}=${encoded}`);
}

function clearShareHash(): void {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function App() {
  const [screen, setScreen] = useState<Screen>("input");
  const [tab, setTab] = useState<ReviewTab>("graph");
  const [renderer, setRenderer] = useState<GraphRenderer>("orkes");
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

  // Share-link state
  const [shareLabel, setShareLabel] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const prImportAvailable = PR_IMPORT_ENABLED;

  // Open straight into review when the URL carries a share payload.
  useEffect(() => {
    const encoded = sharePayloadFromHash(window.location.hash);
    if (!encoded) return;
    decodeShare(encoded)
      .then(payload => {
        setParsed({ before: payload.before, after: payload.after });
        setShareLabel(payload.label ?? null);
        setSelectedNode(null);
        setTab("graph");
        setScreen("review");
      })
      .catch(err => {
        setShareError(
          `Could not open the shared diff: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        clearShareHash();
      });
  }, []);

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
    setShareLabel(null);
    setSelectedNode(null);
    setTab("graph");
    setScreen("review");
    void writeShareHash({ before: before.definition, after: after.definition });
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
    setShareLabel(null);
    setSelectedNode(null);
    setTab("graph");
    setScreen("review");
    void writeShareHash({
      before: workflow.before,
      after: workflow.after,
      label: workflow.path,
    });
  };

  const handleEditInputs = () => {
    // Land back on the source the current review came from.
    setInputMode(prSelectedPath !== null ? "pr" : "paste");
    setScreen("input");
    setSelectedNode(null);
    clearShareHash();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (e.g. non-secure context); the URL is
      // still in the address bar, so just skip the feedback.
    }
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
              <span className="app-workflow-name" title={shareLabel ?? undefined}>
                {workflowName}
              </span>
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
            {tab === "graph" ? (
              <nav className="tabs renderer-toggle" title="Graph renderer">
                <button
                  className={`tab${renderer === "orkes" ? " tab-active" : ""}`}
                  onClick={() => setRenderer("orkes")}
                >
                  Orkes
                </button>
                <button
                  className={`tab${renderer === "classic" ? " tab-active" : ""}`}
                  onClick={() => setRenderer("classic")}
                >
                  Classic
                </button>
              </nav>
            ) : null}
            <button className="btn" onClick={handleCopyLink}>
              {copied ? "Copied!" : "Copy share link"}
            </button>
            <button className="btn" onClick={handleEditInputs}>
              {reviewingPr ? "Back to PR" : "Edit inputs"}
            </button>
          </div>
        ) : null}
      </header>

      <main className="app-main">
        {screen === "input" ? (
          <>
            {shareError ? (
              <div className="share-error parse-error">{shareError}</div>
            ) : null}
            <InputPanel
              prImportAvailable={prImportAvailable}
              mode={prImportAvailable ? inputMode : "paste"}
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
          </>
        ) : mergedGraph && parsed ? (
          tab === "graph" ? (
            <div className="review-graph">
              {renderer === "orkes" ? (
                <OrkesGraphView
                  before={parsed.before}
                  after={parsed.after}
                  graph={mergedGraph}
                  onSelectNode={setSelectedNode}
                />
              ) : (
                <GraphView graph={mergedGraph} onSelectNode={setSelectedNode} />
              )}
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
