import type { WorkflowDefinition } from "../lib/workflowGraph";
import type { PrImportResult, PrWorkflowFile } from "../lib/prImport";

export type InputMode = "paste" | "pr";

export interface ParseOutcome {
  definition: WorkflowDefinition | null;
  error: string | null;
}

/**
 * Parse a pasted workflow JSON. Empty input is allowed (returns null
 * definition, no error). Parse errors include line/column info when the
 * runtime provides a character position.
 */
export function parseWorkflowJson(text: string): ParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { definition: null, error: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        definition: null,
        error: "Expected a JSON object (a workflow definition).",
      };
    }
    return { definition: parsed as WorkflowDefinition, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { definition: null, error: describeParseError(message, trimmed) };
  }
}

function describeParseError(message: string, text: string): string {
  // V8 messages already carry "(line L column C)" in newer versions.
  if (/line \d+ column \d+/i.test(message)) return message;
  // Otherwise derive line/column from "position N" when available.
  const positionMatch = message.match(/position (\d+)/i);
  if (positionMatch?.[1]) {
    const position = Number(positionMatch[1]);
    const upTo = text.slice(0, position);
    const line = upTo.split("\n").length;
    const lastNewline = upTo.lastIndexOf("\n");
    const column = position - lastNewline;
    return `${message} (line ${line}, column ${column})`;
  }
  return message;
}

const STATUS_LABELS: Record<string, string> = {
  added: "added",
  removed: "removed",
  modified: "changed",
  renamed: "renamed",
};

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

interface InputPanelProps {
  /** False on static hosts without the Bun server — hides the PR tab. */
  prImportAvailable: boolean;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;

  // Paste mode
  beforeText: string;
  afterText: string;
  beforeError: string | null;
  afterError: string | null;
  onBeforeChange: (text: string) => void;
  onAfterChange: (text: string) => void;
  onCompare: () => void;
  onLoadExample: () => void;

  // PR mode
  prRefText: string;
  onPrRefChange: (text: string) => void;
  onLoadPr: () => void;
  prLoading: boolean;
  prError: string | null;
  prResult: PrImportResult | null;
  onSelectPrWorkflow: (workflow: PrWorkflowFile) => void;
}

export function InputPanel(props: InputPanelProps) {
  const {
    prImportAvailable,
    mode,
    onModeChange,
    beforeText,
    afterText,
    beforeError,
    afterError,
    onBeforeChange,
    onAfterChange,
    onCompare,
    onLoadExample,
    prRefText,
    onPrRefChange,
    onLoadPr,
    prLoading,
    prError,
    prResult,
    onSelectPrWorkflow,
  } = props;

  const bothEmpty = !beforeText.trim() && !afterText.trim();

  return (
    <div className="input-screen">
      {prImportAvailable ? (
        <nav className="mode-tabs" aria-label="Input source">
          <button
            className={`mode-tab${mode === "paste" ? " mode-tab-active" : ""}`}
            onClick={() => onModeChange("paste")}
          >
            Paste JSON
          </button>
          <button
            className={`mode-tab${mode === "pr" ? " mode-tab-active" : ""}`}
            onClick={() => onModeChange("pr")}
          >
            From GitHub PR
          </button>
        </nav>
      ) : null}

      {mode === "paste" ? (
        <>
          <p className="input-hint">
            Paste Orkes Conductor workflow definition JSONs below. Either side
            may be left empty (e.g. a brand-new workflow has no Before).
          </p>

          <div className="input-grid">
            <div className="input-col">
              <label className="input-label" htmlFor="before-json">
                Before JSON
              </label>
              <textarea
                id="before-json"
                className={`json-input${beforeError ? " json-input-invalid" : ""}`}
                spellCheck={false}
                placeholder="Paste the previous workflow definition JSON (or leave empty)"
                value={beforeText}
                onChange={e => onBeforeChange(e.target.value)}
              />
              {beforeError ? (
                <div className="parse-error">{beforeError}</div>
              ) : null}
            </div>

            <div className="input-col">
              <label className="input-label" htmlFor="after-json">
                After JSON
              </label>
              <textarea
                id="after-json"
                className={`json-input${afterError ? " json-input-invalid" : ""}`}
                spellCheck={false}
                placeholder="Paste the new workflow definition JSON (or leave empty)"
                value={afterText}
                onChange={e => onAfterChange(e.target.value)}
              />
              {afterError ? (
                <div className="parse-error">{afterError}</div>
              ) : null}
            </div>
          </div>

          <div className="input-actions">
            <button
              className="btn btn-primary"
              onClick={onCompare}
              disabled={bothEmpty}
            >
              Compare
            </button>
            <button className="btn" onClick={onLoadExample}>
              Load example
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="input-hint">
            Enter a GitHub PR URL (or just its number for{" "}
            <code>soxhub/workflow-engine-platform</code>). All changed workflow
            definition JSONs are extracted with their Before/After versions.
          </p>

          <form
            className="pr-form"
            onSubmit={e => {
              e.preventDefault();
              if (!prLoading && prRefText.trim()) onLoadPr();
            }}
          >
            <input
              className="pr-input mono"
              type="text"
              spellCheck={false}
              placeholder="https://github.com/owner/repo/pull/478 — or owner/repo#478 — or 478"
              value={prRefText}
              onChange={e => onPrRefChange(e.target.value)}
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={prLoading || !prRefText.trim()}
            >
              {prLoading ? "Loading…" : "Load PR"}
            </button>
          </form>

          {prError ? <div className="parse-error">{prError}</div> : null}

          {prResult ? (
            <div className="pr-result">
              <div className="pr-result-header">
                <a href={prResult.url} target="_blank" rel="noreferrer">
                  #{prResult.number} {prResult.title}
                </a>
                <span className="pr-result-meta">
                  {prResult.owner}/{prResult.repo} ·{" "}
                  {prResult.workflows.length} workflow
                  {prResult.workflows.length === 1 ? "" : "s"} changed
                </span>
              </div>

              {prResult.workflows.length === 0 ? (
                <p className="input-hint">
                  No changed workflow definition JSONs found in this PR.
                </p>
              ) : (
                <ul className="pr-workflow-list">
                  {prResult.workflows.map(wf => (
                    <li key={wf.path}>
                      <button
                        className="pr-workflow-item"
                        onClick={() => onSelectPrWorkflow(wf)}
                      >
                        <span className={`status-badge status-${wf.status}`}>
                          {STATUS_LABELS[wf.status] ?? wf.status}
                        </span>
                        <span className="pr-workflow-name">
                          {wf.after?.name ?? wf.before?.name ?? fileName(wf.path)}
                        </span>
                        <span className="pr-workflow-path mono">{wf.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {prResult.skipped.length > 0 ? (
                <details className="pr-skipped">
                  <summary>
                    {prResult.skipped.length} JSON file
                    {prResult.skipped.length === 1 ? "" : "s"} skipped
                  </summary>
                  <ul>
                    {prResult.skipped.map(s => (
                      <li key={`${s.path}-${s.reason}`}>
                        <span className="mono">{s.path}</span> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
