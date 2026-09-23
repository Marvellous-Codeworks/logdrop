import { describe, test, expect } from "bun:test";
import { generateSlug, isPlainText } from "./paste-validation";

describe("generateSlug", () => {
  test("returns a 22-char url-safe string with no padding or slashes", () => {
    const slug = generateSlug();
    expect(slug.length).toBe(22); // 16 random bytes, base64url-encoded, no padding
    expect(/^[A-Za-z0-9_-]+$/.test(slug)).toBe(true);
  });

  test("returns different values on each call", () => {
    const a = generateSlug();
    const b = generateSlug();
    expect(a).not.toBe(b);
  });
});

describe("isPlainText", () => {
  test("accepts simple ASCII text", () => {
    expect(isPlainText(Buffer.from("hello world\n", "utf8"))).toBe(true);
  });

  test("accepts UTF-8 text with multi-byte characters", () => {
    expect(isPlainText(Buffer.from("café — 日本語\n", "utf8"))).toBe(true);
  });

  test("accepts tabs, newlines and carriage returns", () => {
    expect(isPlainText(Buffer.from("a\tb\r\nc\n", "utf8"))).toBe(true);
  });

  test("rejects empty content", () => {
    expect(isPlainText(Buffer.alloc(0))).toBe(false);
  });

  test("rejects content with null bytes", () => {
    expect(isPlainText(Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]))).toBe(false);
  });

  test("rejects invalid UTF-8 byte sequences", () => {
    expect(isPlainText(Buffer.from([0xff, 0xfe, 0x00, 0x01]))).toBe(false);
  });

  test("rejects other C0 control characters", () => {
    expect(isPlainText(Buffer.from([0x68, 0x69, 0x07, 0x68, 0x69]))).toBe(false);
  });
});
