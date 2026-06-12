import type { WorkflowDefinition } from "../lib/workflowGraph";

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

interface InputPanelProps {
  beforeText: string;
  afterText: string;
  beforeError: string | null;
  afterError: string | null;
  onBeforeChange: (text: string) => void;
  onAfterChange: (text: string) => void;
  onCompare: () => void;
  onLoadExample: () => void;
}

export function InputPanel(props: InputPanelProps) {
  const {
    beforeText,
    afterText,
    beforeError,
    afterError,
    onBeforeChange,
    onAfterChange,
    onCompare,
    onLoadExample,
  } = props;

  const bothEmpty = !beforeText.trim() && !afterText.trim();

  return (
    <div className="input-screen">
      <p className="input-hint">
        Paste Orkes Conductor workflow definition JSONs below. Either side may
        be left empty (e.g. a brand-new workflow has no Before).
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
          {beforeError ? <div className="parse-error">{beforeError}</div> : null}
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
          {afterError ? <div className="parse-error">{afterError}</div> : null}
        </div>
      </div>

      <div className="input-actions">
        <button className="btn btn-primary" onClick={onCompare} disabled={bothEmpty}>
          Compare
        </button>
        <button className="btn" onClick={onLoadExample}>
          Load example
        </button>
      </div>
    </div>
  );
}
