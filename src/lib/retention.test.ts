import { describe, test, expect } from "bun:test";
import { computeExpiresAt } from "./retention";

describe("computeExpiresAt", () => {
  test("adds retentionDays days to createdAt", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeExpiresAt(createdAt, 7);
    expect(expiresAt.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  test("supports a retention of 1 day", () => {
    const createdAt = new Date("2026-01-01T12:00:00.000Z");
    const expiresAt = computeExpiresAt(createdAt, 1);
    expect(expiresAt.toISOString()).toBe("2026-01-02T12:00:00.000Z");
  });

  test("does not mutate the input date", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const before = createdAt.toISOString();
    computeExpiresAt(createdAt, 30);
    expect(createdAt.toISOString()).toBe(before);
  });
});
