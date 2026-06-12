/**
 * Generate a shareable diff URL for a Before/After workflow pair — the same
 * payload the web app writes into its address bar. Intended for CI, e.g. to
 * post visualization links on PRs.
 *
 * Usage:
 *   bun scripts/share-url.ts [--base <app-url>] [--label <text>] <before.json|-> <after.json|->
 *
 * Use "-" for a missing side (new or deleted workflow). The base URL defaults
 * to $SHARE_BASE_URL, then http://localhost:3000/.
 */
import { encodeShare, SHARE_HASH_KEY } from "../src/lib/share";
import type { WorkflowDefinition } from "../src/lib/workflowGraph";

function usage(): never {
  console.error(
    "Usage: bun scripts/share-url.ts [--base <app-url>] [--label <text>] <before.json|-> <after.json|->",
  );
  process.exit(1);
}

async function readDefinition(path: string): Promise<WorkflowDefinition | null> {
  if (path === "-") return null;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return (await file.json()) as WorkflowDefinition;
}

let base = process.env.SHARE_BASE_URL ?? "http://localhost:3000/";
let label: string | undefined;
const positional: string[] = [];

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--base") base = args[++i] ?? usage();
  else if (arg === "--label") label = args[++i] ?? usage();
  else if (arg === "--help" || arg === "-h") usage();
  else positional.push(arg);
}
if (positional.length !== 2) usage();

const [before, after] = await Promise.all([
  readDefinition(positional[0]!),
  readDefinition(positional[1]!),
]);
if (before === null && after === null) {
  console.error("At least one side must be a real file.");
  process.exit(1);
}

const encoded = await encodeShare({ before, after, label });
console.log(`${base}${base.endsWith("/") ? "" : "/"}#${SHARE_HASH_KEY}=${encoded}`);
