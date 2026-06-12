import type { WorkflowDefinition } from "./workflowGraph";

/**
 * Shareable-link codec: a Before/After workflow pair is serialized to JSON,
 * deflate-compressed (native CompressionStream — works in browsers and Bun),
 * and base64url-encoded so the whole diff travels inside the URL hash
 * fragment. No backend needed to open a link.
 *
 * Format: "<version>.<base64url(deflate-raw(json))>"
 */

export interface SharePayload {
  before: WorkflowDefinition | null;
  after: WorkflowDefinition | null;
  /** Optional label shown in the header, e.g. the file path or PR ref. */
  label?: string;
}

const SHARE_VERSION = "1";

/** Key used in the URL hash: #wf=<encoded> */
export const SHARE_HASH_KEY = "wf";

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify({
    b: payload.before,
    a: payload.after,
    ...(payload.label ? { l: payload.label } : {}),
  });
  const compressed = await compress(new TextEncoder().encode(json));
  return `${SHARE_VERSION}.${toBase64Url(compressed)}`;
}

export async function decodeShare(encoded: string): Promise<SharePayload> {
  const dot = encoded.indexOf(".");
  if (dot === -1) throw new Error("Malformed share payload (missing version).");
  const version = encoded.slice(0, dot);
  if (version !== SHARE_VERSION) {
    throw new Error(`Unsupported share payload version "${version}".`);
  }

  const bytes = fromBase64Url(encoded.slice(dot + 1));
  const json = new TextDecoder().decode(await decompress(bytes));
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Share payload is not an object.");
  }

  const record = raw as { b?: unknown; a?: unknown; l?: unknown };
  const before = asDefinitionOrNull(record.b, "before");
  const after = asDefinitionOrNull(record.a, "after");
  if (before === null && after === null) {
    throw new Error("Share payload contains no workflow on either side.");
  }
  return {
    before,
    after,
    label: typeof record.l === "string" ? record.l : undefined,
  };
}

/** Read the share payload from a location hash, if present. */
export function sharePayloadFromHash(hash: string): string | null {
  const match = hash.match(new RegExp(`^#${SHARE_HASH_KEY}=(.+)$`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function asDefinitionOrNull(
  value: unknown,
  side: string,
): WorkflowDefinition | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Share payload "${side}" side is not a workflow object.`);
  }
  return value as WorkflowDefinition;
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // String.fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Share payload is not valid base64url.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
