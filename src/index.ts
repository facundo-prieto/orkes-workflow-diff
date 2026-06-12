import { serve } from "bun";
import index from "./index.html";

import { parsePrRef } from "./lib/prImport";
import { fetchPrWorkflows, PrImportError } from "./server/github";

// The frontend reads BUN_PUBLIC_PR_IMPORT, inlined at bundle time (bunfig
// [serve.static] env). Bun snapshots env at process launch, so it must be set
// in the environment — the dev/start scripts default it to "on". An unset var
// leaves `process.env.…` in the browser bundle, which crashes.
if (!process.env.BUN_PUBLIC_PR_IMPORT) {
  console.warn(
    "BUN_PUBLIC_PR_IMPORT is not set — the frontend bundle will crash in the browser. " +
      "Use `bun dev` / `bun start` (they default it to \"on\").",
  );
}

const server = serve({
  routes: {
    /**
     * Import workflow JSONs from a GitHub PR.
     * GET /api/pr?ref=<PR URL | owner/repo#N | N>
     */
    "/api/pr": {
      GET: async req => {
        const refInput = new URL(req.url).searchParams.get("ref") ?? "";
        const ref = parsePrRef(refInput);
        if (!ref) {
          return Response.json(
            { error: "Could not parse PR reference. Use a PR URL, owner/repo#123 or a PR number." },
            { status: 400 },
          );
        }
        try {
          return Response.json(await fetchPrWorkflows(ref));
        } catch (err) {
          const message =
            err instanceof PrImportError
              ? err.message
              : "Unexpected error while fetching the PR.";
          if (!(err instanceof PrImportError)) console.error(err);
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    // Serve index.html for all other routes (single-page app).
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
