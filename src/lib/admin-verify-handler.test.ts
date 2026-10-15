import { describe, test, expect, beforeEach, afterEach, mock, afterAll } from "bun:test";
import { verifySessionToken } from "./auth-token";
import { installFakeAuthStore } from "./auth-store.fake";

// Used by the round-trip test to capture the magic link the login handler
// would email. Restored in afterAll (see admin-login-handler.test.ts).
const { sendMagicLinkEmail: realSendMagicLinkEmail } = await import("./mail");
const sendMagicLinkEmailMock = mock(async (_args: { to: string; magicLinkUrl: string }) => undefined);
mock.module("./mail", () => ({ sendMagicLinkEmail: sendMagicLinkEmailMock }));
const authStore = await installFakeAuthStore();
afterAll(() => {
  mock.module("./mail", () => ({ sendMagicLinkEmail: realSendMagicLinkEmail }));
  authStore.restore();
});

const { handleAdminVerify, handleAdminVerifyPage } = await import("./admin-verify-handler");
const { handleAdminLoginRequest } = await import("./admin-login-handler");

const SECRET = "test-secret";
const BASE = "https://logdrop.example";

function sessionFrom(res: Response) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  return verifySessionToken(setCookie.split("logdrop_session=")[1].split(";")[0], SECRET);
}

describe("handleAdminVerifyPage (GET)", () => {
  afterEach(() => authStore.reset());

  test("redirects to login with an error when no token is present", () => {
    const res = handleAdminVerifyPage(null, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=missing");
  });

  test("renders a confirmation form and never consumes the token", async () => {
    const token = await authStore.fake.createMagicLink("admin@example.com");

    const res = handleAdminVerifyPage(token, BASE, "/r/abc123");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('method="post" action="/admin/verify"');
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).toContain('name="next" value="/r/abc123"');
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(authStore.fake.consumeMagicLink).not.toHaveBeenCalled();
  });

  test("drops an unsafe next and escapes the token", async () => {
    const html = await handleAdminVerifyPage('"><script>', BASE, "https://evil.com").text();
    expect(html).not.toContain('value=""><script>');
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;"');
    expect(html).not.toContain('name="next"');
  });
});

describe("handleAdminVerify (POST)", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "admin@example.com";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    sendMagicLinkEmailMock.mockClear();
    authStore.reset();
  });

  test("redirects to login with an error when no token is present", async () => {
    const res = await handleAdminVerify(null, SECRET, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=missing");
  });

  test("redirects to login with an error when the token is unknown", async () => {
    const res = await handleAdminVerify("not-a-real-token", SECRET, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
  });

  test("redirects to /admin and sets a browser-session cookie for a valid token", async () => {
    const token = await authStore.fake.createMagicLink("admin@example.com");

    const res = await handleAdminVerify(token, SECRET, BASE);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    expect(res.headers.get("set-cookie")).not.toContain("Max-Age");
    const session = sessionFrom(res);
    expect(session?.email).toBe("admin@example.com");
    expect(await authStore.fake.isSessionActive("admin@example.com", session!.sid)).toBe(true);
  });

  test("a second use of the same link is rejected", async () => {
    const token = await authStore.fake.createMagicLink("admin@example.com");
    await handleAdminVerify(token, SECRET, BASE);

    const res = await handleAdminVerify(token, SECRET, BASE);

    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("does not mint a session when the email is no longer in ADMIN_EMAILS", async () => {
    const token = await authStore.fake.createMagicLink("admin@example.com");
    process.env.ADMIN_EMAILS = "someone-else@example.com";

    const res = await handleAdminVerify(token, SECRET, BASE);

    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("redirects to a valid next path after login", async () => {
    const token = await authStore.fake.createMagicLink("admin@example.com");

    const res = await handleAdminVerify(token, SECRET, BASE, "/r/abc123");

    expect(res.headers.get("location")).toBe("https://logdrop.example/r/abc123");
    expect(res.headers.get("set-cookie")).toContain("logdrop_session=");
  });

  test("ignores an invalid or malicious next value and falls back to /admin", async () => {
    for (const bad of ["https://evil.com", "//evil.com", "/something-else", "/\\evil.com"]) {
      const token = await authStore.fake.createMagicLink("admin@example.com");
      const res = await handleAdminVerify(token, SECRET, BASE, bad);
      expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    }
  });

  test("a valid next survives the full login -> email -> verify round trip", async () => {
    process.env.TOKEN_SECRET = SECRET;
    process.env.SITE_URL = BASE;

    await handleAdminLoginRequest("admin@example.com", "/r/abc123");
    const { magicLinkUrl } = sendMagicLinkEmailMock.mock.calls[0][0];
    const link = new URL(magicLinkUrl);

    const res = await handleAdminVerify(
      link.searchParams.get("token"),
      SECRET,
      BASE,
      link.searchParams.get("next"),
    );

    expect(res.headers.get("location")).toBe("https://logdrop.example/r/abc123");
    expect(sessionFrom(res)?.email).toBe("admin@example.com");
  });
});
