import { describe, expect, test } from "bun:test";

import {
  decodeShare,
  encodeShare,
  sharePayloadFromHash,
} from "./share";
import { EXAMPLE_AFTER, EXAMPLE_BEFORE } from "../examples";
import type { WorkflowDefinition } from "./workflowGraph";

const before = JSON.parse(EXAMPLE_BEFORE) as WorkflowDefinition;
const after = JSON.parse(EXAMPLE_AFTER) as WorkflowDefinition;

describe("share codec", () => {
  test("round-trips a before/after pair with a label", async () => {
    const encoded = await encodeShare({ before, after, label: "wf/file.json" });
    const decoded = await decodeShare(encoded);
    expect(decoded.before).toEqual(before);
    expect(decoded.after).toEqual(after);
    expect(decoded.label).toBe("wf/file.json");
  });

  test("round-trips one-sided payloads (new / deleted workflow)", async () => {
    const added = await decodeShare(await encodeShare({ before: null, after }));
    expect(added.before).toBeNull();
    expect(added.after).toEqual(after);

    const removed = await decodeShare(await encodeShare({ before, after: null }));
    expect(removed.before).toEqual(before);
    expect(removed.after).toBeNull();
  });

  test("compresses well below the raw base64 size", async () => {
    const encoded = await encodeShare({ before, after });
    const rawBase64Length = btoa(EXAMPLE_BEFORE + EXAMPLE_AFTER).length;
    expect(encoded.length).toBeLessThan(rawBase64Length / 2);
  });

  test("produces URL-safe output", async () => {
    const encoded = await encodeShare({ before, after });
    expect(encoded).toMatch(/^1\.[A-Za-z0-9_-]+$/);
  });

  test("rejects malformed payloads", async () => {
    await expect(decodeShare("garbage")).rejects.toThrow(/version/);
    await expect(decodeShare("9.AAAA")).rejects.toThrow(/version/);
    await expect(decodeShare("1.!!!not-base64!!!")).rejects.toThrow();
    // Valid encoding but empty on both sides
    const empty = await encodeShare({ before: null, after: null });
    await expect(decodeShare(empty)).rejects.toThrow(/no workflow/);
  });

  test("extracts the payload from a location hash", () => {
    expect(sharePayloadFromHash("#wf=1.abc")).toBe("1.abc");
    expect(sharePayloadFromHash("#other=1.abc")).toBeNull();
    expect(sharePayloadFromHash("")).toBeNull();
  });
});
