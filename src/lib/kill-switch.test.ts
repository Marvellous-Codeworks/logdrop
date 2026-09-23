import { describe, test, expect, mock } from "bun:test";

const getMock = mock(async (_key: string) => undefined as unknown);
mock.module("@vercel/edge-config", () => ({ get: getMock }));

const { areUploadsDisabled } = await import("./kill-switch");

describe("areUploadsDisabled", () => {
  test("returns false when the flag is not set", async () => {
    getMock.mockImplementation(async () => undefined);
    expect(await areUploadsDisabled()).toBe(false);
  });

  test("returns true when the flag is explicitly true", async () => {
    getMock.mockImplementation(async () => true);
    expect(await areUploadsDisabled()).toBe(true);
  });

  test("returns false when the flag is any other truthy-but-not-true value", async () => {
    getMock.mockImplementation(async () => "yes");
    expect(await areUploadsDisabled()).toBe(false);
  });

  test("fails open (returns false) if Edge Config is unreachable", async () => {
    getMock.mockImplementation(async () => {
      throw new Error("network error");
    });
    expect(await areUploadsDisabled()).toBe(false);
  });
});
