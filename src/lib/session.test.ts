import { describe, test, expect, afterEach, afterAll } from "bun:test";
import { installFakeAuthStore } from "./auth-store.fake";

const authStore = await installFakeAuthStore();
afterAll(() => authStore.restore());

const { SESSION_COOKIE_NAME, getSessionEmail, buildSessionCookie, clearSessionCookie, endSession } = await import(
  "./session"
);

const SECRET = "test-secret";
const ADMINS = ["a@b.com"];

function requestWithCookie(cookieHeader: string): Request {
  return new Request("https://example.com/admin", { headers: { cookie: cookieHeader } });
}

async function signedInRequest(email = "a@b.com"): Promise<Request> {
  return requestWithCookie((await buildSessionCookie(email, SECRET)).split(";")[0]);
}

afterEach(() => authStore.reset());

describe("buildSessionCookie / getSessionEmail", () => {
  test("a request carrying the built cookie resolves back to the same email", async () => {
    expect(await getSessionEmail(await signedInRequest(), SECRET, ADMINS)).toBe("a@b.com");
  });

  test("the cookie is a browser-session cookie: httpOnly, secure, site-wide, no Max-Age/Expires", async () => {
    const setCookie = await buildSessionCookie("a@b.com", SECRET);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Max-Age");
    expect(setCookie).not.toContain("Expires");
    expect(setCookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
  });

  test("returns null when there is no cookie header", async () => {
    expect(await getSessionEmail(new Request("https://example.com/admin"), SECRET, ADMINS)).toBeNull();
  });

  test("returns null when the cookie was signed with a different secret", async () => {
    expect(await getSessionEmail(await signedInRequest(), "other-secret", ADMINS)).toBeNull();
  });

  test("ignores unrelated cookies alongside the session cookie", async () => {
    const cookiePair = (await buildSessionCookie("a@b.com", SECRET)).split(";")[0];
    const request = requestWithCookie(`theme=dark; ${cookiePair}; other=1`);
    expect(await getSessionEmail(request, SECRET, ADMINS)).toBe("a@b.com");
  });

  test("returns null once the server-side session is gone, even with a validly signed cookie", async () => {
    const request = await signedInRequest();
    authStore.reset();
    expect(await getSessionEmail(request, SECRET, ADMINS)).toBeNull();
  });

  test("a newer sign-in by the same admin ends the older browser's session", async () => {
    const first = await signedInRequest();
    const second = await signedInRequest();
    expect(await getSessionEmail(first, SECRET, ADMINS)).toBeNull();
    expect(await getSessionEmail(second, SECRET, ADMINS)).toBe("a@b.com");
  });
});

describe("getSessionEmail allow-list re-check", () => {
  test("returns null once the email is no longer in ADMIN_EMAILS", async () => {
    const request = await signedInRequest();
    expect(await getSessionEmail(request, SECRET, ["someone-else@b.com"])).toBeNull();
    expect(await getSessionEmail(request, SECRET, [])).toBeNull();
  });

  test("matches the allow-list case-insensitively", async () => {
    expect(await getSessionEmail(await signedInRequest("A@B.com"), SECRET, ADMINS)).toBe("A@B.com");
  });
});

describe("endSession", () => {
  test("revokes the session server-side, so the old cookie stops working", async () => {
    const request = await signedInRequest();
    await endSession(request, SECRET);
    expect(await getSessionEmail(request, SECRET, ADMINS)).toBeNull();
  });

  test("is a no-op without a valid cookie", async () => {
    await endSession(new Request("https://example.com/admin"), SECRET);
    expect(authStore.fake.deleteSession).not.toHaveBeenCalled();
  });
});

describe("clearSessionCookie", () => {
  test("expires the cookie immediately", () => {
    const cleared = clearSessionCookie();
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("parseCookies resilience", () => {
  test("handles malformed percent-encoding in unrelated cookies without throwing", async () => {
    const cookiePair = (await buildSessionCookie("a@b.com", SECRET)).split(";")[0];
    // This would throw if decodeURIComponent is unguarded.
    const request = requestWithCookie(`theme=%; ${cookiePair}`);
    expect(await getSessionEmail(request, SECRET, ADMINS)).toBe("a@b.com");
  });
});
