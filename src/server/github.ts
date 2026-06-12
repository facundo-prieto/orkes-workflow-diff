import { $ } from "bun";

import {
  looksLikeWorkflowDefinition,
  type PrImportResult,
  type PrRef,
  type PrSkippedFile,
  type PrWorkflowFile,
} from "../lib/prImport";

/** Error whose message is safe to surface to the UI. */
export class PrImportError extends Error {}

interface GitHubPrFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

async function gh(args: string[]): Promise<string> {
  const result = await $`gh ${args}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (/gh auth login|not logged in/i.test(stderr)) {
      throw new PrImportError(
        "GitHub CLI is not authenticated. Run `gh auth login` on the machine serving this app.",
      );
    }
    if (/HTTP 404/i.test(stderr)) {
      throw new PrImportError(
        "PR not found (HTTP 404). Check the URL/number and that you have access to the repository.",
      );
    }
    throw new PrImportError(stderr || "gh command failed");
  }
  return result.stdout.toString();
}

async function ghJson<T>(path: string): Promise<T> {
  return JSON.parse(await gh(["api", path])) as T;
}

/**
 * Fetch a file's raw content at a specific ref. Returns null when the file
 * does not exist at that ref (e.g. the Before side of an added file).
 */
async function fetchFileAtRef(
  ref: PrRef,
  path: string,
  sha: string,
): Promise<string | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const apiPath = `repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${sha}`;
  try {
    return await gh(["api", "-H", "Accept: application/vnd.github.raw", apiPath]);
  } catch (err) {
    if (err instanceof PrImportError && /HTTP 404|not found/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}

async function listPrFiles(ref: PrRef): Promise<GitHubPrFile[]> {
  const files: GitHubPrFile[] = [];
  const perPage = 100;
  for (let page = 1; ; page++) {
    const batch = await ghJson<GitHubPrFile[]>(
      `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=${perPage}&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < perPage) return files;
  }
}

function parseWorkflowSide(
  raw: string | null,
  path: string,
  side: "before" | "after",
  skipped: PrSkippedFile[],
): { ok: boolean; definition: unknown | null } {
  if (raw === null) return { ok: true, definition: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    skipped.push({ path, reason: `${side} version is not valid JSON` });
    return { ok: false, definition: null };
  }
  if (!looksLikeWorkflowDefinition(parsed)) {
    skipped.push({
      path,
      reason: `${side} version is not a workflow definition (missing "name"/"tasks")`,
    });
    return { ok: false, definition: null };
  }
  return { ok: true, definition: parsed };
}

/**
 * Fetch all workflow-definition JSONs changed in a PR, with their Before
 * (base sha) and After (head sha) versions.
 */
export async function fetchPrWorkflows(ref: PrRef): Promise<PrImportResult> {
  const pr = await ghJson<{
    title: string;
    html_url: string;
    base: { sha: string };
    head: { sha: string };
  }>(`repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);

  const files = await listPrFiles(ref);
  const jsonFiles = files.filter(f => f.filename.toLowerCase().endsWith(".json"));

  const skipped: PrSkippedFile[] = [];
  const workflows: PrWorkflowFile[] = [];

  // Fetch all file versions concurrently — PRs can touch many workflows.
  await Promise.all(
    jsonFiles.map(async file => {
      const beforePath = file.previous_filename ?? file.filename;
      const [beforeRaw, afterRaw] = await Promise.all([
        file.status === "added"
          ? Promise.resolve(null)
          : fetchFileAtRef(ref, beforePath, pr.base.sha),
        file.status === "removed"
          ? Promise.resolve(null)
          : fetchFileAtRef(ref, file.filename, pr.head.sha),
      ]);

      const before = parseWorkflowSide(beforeRaw, file.filename, "before", skipped);
      const after = parseWorkflowSide(afterRaw, file.filename, "after", skipped);
      if (!before.ok || !after.ok) return;
      if (before.definition === null && after.definition === null) {
        skipped.push({ path: file.filename, reason: "no content at either ref" });
        return;
      }

      workflows.push({
        path: file.filename,
        status: file.status,
        previousPath: file.previous_filename,
        before: before.definition as PrWorkflowFile["before"],
        after: after.definition as PrWorkflowFile["after"],
      });
    }),
  );

  // Stable order regardless of fetch completion order.
  workflows.sort((a, b) => a.path.localeCompare(b.path));

  return {
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    title: pr.title,
    url: pr.html_url,
    workflows,
    skipped,
  };
}
