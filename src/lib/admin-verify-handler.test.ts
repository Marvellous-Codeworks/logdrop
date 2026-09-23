import { describe, test, expect, beforeEach, afterEach, mock, afterAll } from "bun:test";
import { signMagicLinkToken, signSessionToken, verifySessionToken } from "./auth-token";

// Used by the round-trip test to capture the magic link the login handler
// would email. Restored in afterAll (see admin-login-handler.test.ts).
const { sendMagicLinkEmail: realSendMagicLinkEmail } = await import("./mail");
const sendMagicLinkEmailMock = mock(async (_args: { to: string; magicLinkUrl: string }) => undefined);
mock.module("./mail", () => ({ sendMagicLinkEmail: sendMagicLinkEmailMock }));
afterAll(() => {
  mock.module("./mail", () => ({ sendMagicLinkEmail: realSendMagicLinkEmail }));
});

const { handleAdminVerify } = await import("./admin-verify-handler");
const { handleAdminLoginRequest } = await import("./admin-login-handler");

const SECRET = "test-secret";
const BASE = "https://logdrop.example";

describe("handleAdminVerify", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "admin@example.com";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    sendMagicLinkEmailMock.mockClear();
  });

  test("redirects to login with an error when no token is present", () => {
    const res = handleAdminVerify(null, SECRET, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=missing");
  });

  test("redirects to login with an error when the token is invalid or expired", () => {
    const res = handleAdminVerify("not-a-real-token", SECRET, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
  });

  test("redirects to /admin and sets a valid session cookie for a valid token", () => {
    const token = signMagicLinkToken("admin@example.com", SECRET);

    const res = handleAdminVerify(token, SECRET, BASE);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("logdrop_session=");
    const sessionToken = setCookie!.split("logdrop_session=")[1].split(";")[0];
    expect(verifySessionToken(sessionToken, SECRET)?.email).toBe("admin@example.com");
  });

  test("does not mint a session when the email is no longer in ADMIN_EMAILS", () => {
    const token = signMagicLinkToken("admin@example.com", SECRET);
    process.env.ADMIN_EMAILS = "someone-else@example.com";

    const res = handleAdminVerify(token, SECRET, BASE);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("rejects a session token replayed as a magic-link token", () => {
    const sessionToken = signSessionToken("admin@example.com", SECRET);

    const res = handleAdminVerify(sessionToken, SECRET, BASE);

    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("redirects to a valid next path after login", () => {
    const token = signMagicLinkToken("admin@example.com", SECRET);

    const res = handleAdminVerify(token, SECRET, BASE, "/r/abc123");

    expect(res.headers.get("location")).toBe("https://logdrop.example/r/abc123");
    expect(res.headers.get("set-cookie")).toContain("logdrop_session=");
  });

  test("ignores an invalid or malicious next value and falls back to /admin", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/something-else", "/\\evil.com"]) {
      const token = signMagicLinkToken("admin@example.com", SECRET);
      const res = handleAdminVerify(token, SECRET, BASE, bad);
      expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    }
  });

  test("a valid next survives the full login -> email -> verify round trip", async () => {
    process.env.TOKEN_SECRET = SECRET;
    process.env.SITE_URL = BASE;

    await handleAdminLoginRequest("admin@example.com", "/r/abc123");
    const { magicLinkUrl } = sendMagicLinkEmailMock.mock.calls[0][0];
    const link = new URL(magicLinkUrl);

    const res = handleAdminVerify(
      link.searchParams.get("token"),
      SECRET,
      BASE,
      link.searchParams.get("next"),
    );

    expect(res.headers.get("location")).toBe("https://logdrop.example/r/abc123");
  });
});
