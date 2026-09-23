import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// mock.module() patches the shared module namespace object in place for the
// rest of this bun test process, so it must be restored in afterAll even
// though ./mail has only one export today (see upload-handler.test.ts for
// the same convention with multi-export modules).
const realMail = await import("./mail");
const { sendMagicLinkEmail: realSendMagicLinkEmail } = realMail;
const sendMagicLinkEmailMock = mock(async () => undefined);
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
    const call = sendMagicLinkEmailMock.mock.calls[0][0] as { to: string; magicLinkUrl: string };
    expect(call.to).toBe("admin@example.com");
    expect(call.magicLinkUrl).toContain("https://logdrop.example/admin/verify?token=");
  });

  test("matches allow-list entries case-insensitively and trims whitespace", async () => {
    setEnv();
    const result = await handleAdminLoginRequest("Admin@Example.com");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).toHaveBeenCalledTimes(1);
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
