import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// mock.module() patches the shared module namespace object in place for the
// rest of this bun test process, so it must be restored in afterAll even
// though ./mail has only one export today (see upload-handler.test.ts for
// the same convention with multi-export modules).
const realMail = await import("./mail");
const { sendMagicLinkEmail: realSendMagicLinkEmail } = realMail;
const sendMagicLinkEmailMock = mock(async (_args: { to: string; magicLinkUrl: string }) => undefined);
mock.module("./mail", () => ({ sendMagicLinkEmail: sendMagicLinkEmailMock }));

afterAll(() => {
  mock.module("./mail", () => ({ sendMagicLinkEmail: realSendMagicLinkEmail }));
});

const { handleAdminLoginRequest } = await import("./admin-login-handler");

describe("handleAdminLoginRequest", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    sendMagicLinkEmailMock.mockClear();
  });

  function setEnv() {
    process.env.TOKEN_SECRET = "test-secret";
    process.env.SITE_URL = "https://logdrop.example";
    process.env.ADMIN_EMAILS = "admin@example.com, other@example.com";
  }

  test("sends a magic link email for an allow-listed address", async () => {
    setEnv();
    const result = await handleAdminLoginRequest("admin@example.com");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).toHaveBeenCalledTimes(1);
    const call = sendMagicLinkEmailMock.mock.calls[0][0];
    expect(call.to).toBe("admin@example.com");
    expect(call.magicLinkUrl).toContain("https://logdrop.example/admin/verify?token=");
  });

  test("matches allow-list entries case-insensitively and trims whitespace", async () => {
    setEnv();
    // Whitespace on both the input and the ADMIN_EMAILS entries.
    process.env.ADMIN_EMAILS = "  admin@example.com  ,other@example.com";
    const result = await handleAdminLoginRequest("  Admin@Example.com  ");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).toHaveBeenCalledTimes(1);
    const call = sendMagicLinkEmailMock.mock.calls[0][0];
    expect(call.to).toBe("admin@example.com");
  });

  test("includes a safe next path in the magic link", async () => {
    setEnv();
    await handleAdminLoginRequest("admin@example.com", "/r/abc123");

    const call = sendMagicLinkEmailMock.mock.calls[0][0];
    expect(new URL(call.magicLinkUrl).searchParams.get("next")).toBe("/r/abc123");
  });

  test("drops an unsafe next value from the magic link", async () => {
    setEnv();
    for (const bad of ["https://evil.com", "//evil.com", "/something-else"]) {
      sendMagicLinkEmailMock.mockClear();
      await handleAdminLoginRequest("admin@example.com", bad);
      const call = sendMagicLinkEmailMock.mock.calls[0][0];
      expect(new URL(call.magicLinkUrl).searchParams.has("next")).toBe(false);
    }
  });

  test("still returns ok when email delivery fails for an allow-listed address", async () => {
    setEnv();
    const originalError = console.error;
    console.error = () => {};
    sendMagicLinkEmailMock.mockImplementationOnce(async () => {
      throw new Error("Resend down");
    });
    try {
      expect(await handleAdminLoginRequest("admin@example.com")).toEqual({ ok: true });
    } finally {
      console.error = originalError;
    }
  });

  test("does not send email for a non-allow-listed address but still returns ok", async () => {
    setEnv();
    const result = await handleAdminLoginRequest("stranger@example.com");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).not.toHaveBeenCalled();
  });

  test("throws when TOKEN_SECRET is missing", async () => {
    setEnv();
    delete process.env.TOKEN_SECRET;
    await expect(handleAdminLoginRequest("admin@example.com")).rejects.toThrow(
      "Server misconfigured",
    );
  });
});
