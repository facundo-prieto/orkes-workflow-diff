import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PR_REPO,
  looksLikeWorkflowDefinition,
  parsePrRef,
} from "./prImport";

describe("parsePrRef", () => {
  test("parses a full GitHub PR URL", () => {
    expect(
      parsePrRef("https://github.com/soxhub/workflow-engine-platform/pull/478"),
    ).toEqual({ owner: "soxhub", repo: "workflow-engine-platform", number: 478 });
  });

  test("parses a PR URL with a trailing path or query", () => {
    expect(
      parsePrRef("https://github.com/soxhub/workflow-engine-platform/pull/478/files?diff=split"),
    ).toEqual({ owner: "soxhub", repo: "workflow-engine-platform", number: 478 });
  });

  test("parses a URL without scheme", () => {
    expect(parsePrRef("github.com/acme/widgets/pull/7")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 7,
    });
  });

  test("parses owner/repo#number shorthand", () => {
    expect(parsePrRef("acme/widgets#12")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 12,
    });
  });

  test("resolves a bare number against the default repo", () => {
    expect(parsePrRef("478")).toEqual({ ...DEFAULT_PR_REPO, number: 478 });
    expect(parsePrRef("#478")).toEqual({ ...DEFAULT_PR_REPO, number: 478 });
  });

  test("rejects garbage", () => {
    expect(parsePrRef("")).toBeNull();
    expect(parsePrRef("not a pr")).toBeNull();
    expect(parsePrRef("https://github.com/acme/widgets/issues/5")).toBeNull();
  });
});

describe("looksLikeWorkflowDefinition", () => {
  test("accepts an object with name and tasks", () => {
    expect(
      looksLikeWorkflowDefinition({ name: "wf", tasks: [], version: 1 }),
    ).toBe(true);
  });

  test("rejects non-workflow JSON", () => {
    expect(looksLikeWorkflowDefinition(null)).toBe(false);
    expect(looksLikeWorkflowDefinition([])).toBe(false);
    expect(looksLikeWorkflowDefinition({ name: "config" })).toBe(false);
    expect(looksLikeWorkflowDefinition({ tasks: [] })).toBe(false);
    expect(looksLikeWorkflowDefinition({ name: 1, tasks: [] })).toBe(false);
  });
});
