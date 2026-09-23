import { describe, test, expect } from "bun:test";
import { sanitizeIssueUrl } from "./issue-url";

describe("sanitizeIssueUrl", () => {
  test("accepts a well-formed GitHub issue URL", () => {
    expect(sanitizeIssueUrl("https://github.com/gioxx/logdrop/issues/42")).toBe(
      "https://github.com/gioxx/logdrop/issues/42",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(sanitizeIssueUrl("  https://github.com/gioxx/logdrop/issues/1  ")).toBe(
      "https://github.com/gioxx/logdrop/issues/1",
    );
  });

  test("returns null for empty or missing input", () => {
    expect(sanitizeIssueUrl("")).toBeNull();
    expect(sanitizeIssueUrl("   ")).toBeNull();
    expect(sanitizeIssueUrl(undefined)).toBeNull();
    expect(sanitizeIssueUrl(null)).toBeNull();
  });

  test("returns null for a non-string value", () => {
    expect(sanitizeIssueUrl(42)).toBeNull();
  });

  test("returns null for a non-GitHub-issue URL", () => {
    expect(sanitizeIssueUrl("https://example.com/evil")).toBeNull();
    expect(sanitizeIssueUrl("https://github.com/gioxx/logdrop")).toBeNull();
    expect(sanitizeIssueUrl("https://github.com/gioxx/logdrop/pull/1")).toBeNull();
    expect(sanitizeIssueUrl("javascript:alert(1)")).toBeNull();
  });

  test("rejects a github.com URL with an unsafe owner/repo segment", () => {
    expect(sanitizeIssueUrl("https://github.com/gio xx/logdrop/issues/1")).toBeNull();
    expect(sanitizeIssueUrl("https://github.com/gioxx/log/drop/issues/1")).toBeNull();
  });
});
