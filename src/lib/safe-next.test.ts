import { describe, test, expect } from "bun:test";
import { sanitizeNext } from "./safe-next";

describe("sanitizeNext", () => {
  test("accepts /admin and /r/<slug>", () => {
    expect(sanitizeNext("/admin")).toBe("/admin");
    expect(sanitizeNext("/r/abc_123-XY")).toBe("/r/abc_123-XY");
  });

  test("rejects absolute, protocol-relative and other paths", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/something-else",
      "/admin/../evil",
      "/r/abc/extra",
      "/r/",
      "/admin?x=1",
      "\\\\evil.com",
      "",
      undefined,
      42,
    ]) {
      expect(sanitizeNext(bad)).toBeUndefined();
    }
  });
});
