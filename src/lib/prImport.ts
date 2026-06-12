import type { WorkflowDefinition } from "./workflowGraph";

/** Repo used when the user types just a PR number (e.g. "478" or "#478"). */
export const DEFAULT_PR_REPO = { owner: "soxhub", repo: "workflow-engine-platform" };

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** One changed workflow JSON file in a PR. */
export interface PrWorkflowFile {
  path: string;
  /** GitHub file status: added | removed | modified | renamed | ... */
  status: string;
  previousPath?: string;
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
}

/** A changed .json file that was not a workflow definition (or didn't parse). */
export interface PrSkippedFile {
  path: string;
  reason: string;
}

export interface PrImportResult {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  workflows: PrWorkflowFile[];
  skipped: PrSkippedFile[];
}

/**
 * Parse a user-supplied PR reference. Accepts:
 *   - a full GitHub PR URL: https://github.com/owner/repo/pull/478[/files...]
 *   - shorthand: owner/repo#478
 *   - a bare number ("478" or "#478"), resolved against DEFAULT_PR_REPO
 */
export function parsePrRef(input: string): PrRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i,
  );
  if (urlMatch) {
    return { owner: urlMatch[1]!, repo: urlMatch[2]!, number: Number(urlMatch[3]) };
  }

  const shorthandMatch = trimmed.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1]!,
      repo: shorthandMatch[2]!,
      number: Number(shorthandMatch[3]),
    };
  }

  const numberMatch = trimmed.match(/^#?(\d+)$/);
  if (numberMatch) {
    return { ...DEFAULT_PR_REPO, number: Number(numberMatch[1]) };
  }

  return null;
}

/**
 * Decide whether a parsed JSON value is an Orkes Conductor workflow
 * definition. PRs also touch test files, configs and other JSONs — only
 * files that look like definitions should appear in the import list.
 */
export function looksLikeWorkflowDefinition(
  value: unknown,
): value is WorkflowDefinition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" && Array.isArray(candidate.tasks)
  );
}
