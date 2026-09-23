import { describe, test, expect } from "bun:test";
import { SESSION_COOKIE_NAME, getSessionEmail, buildSessionCookie, clearSessionCookie } from "./session";

const SECRET = "test-secret";
const ADMINS = ["a@b.com"];

function requestWithCookie(cookieHeader: string): Request {
  return new Request("https://example.com/admin", { headers: { cookie: cookieHeader } });
}

describe("buildSessionCookie / getSessionEmail", () => {
  test("a request carrying the built cookie resolves back to the same email", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0]; // "name=value"
    const request = requestWithCookie(cookiePair);
    expect(getSessionEmail(request, SECRET, ADMINS)).toBe("a@b.com");
  });

  test("the cookie is httpOnly, secure and scoped to the whole site", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
  });

  test("returns null when there is no cookie header", () => {
    const request = new Request("https://example.com/admin");
    expect(getSessionEmail(request, SECRET, ADMINS)).toBeNull();
  });

  test("returns null when the cookie was signed with a different secret", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    const request = requestWithCookie(cookiePair);
    expect(getSessionEmail(request, "other-secret", ADMINS)).toBeNull();
  });

  test("ignores unrelated cookies alongside the session cookie", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    const request = requestWithCookie(`theme=dark; ${cookiePair}; other=1`);
    expect(getSessionEmail(request, SECRET, ADMINS)).toBe("a@b.com");
  });
});

describe("getSessionEmail allow-list re-check", () => {
  test("returns null once the email is no longer in ADMIN_EMAILS", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const request = requestWithCookie(setCookie.split(";")[0]);
    expect(getSessionEmail(request, SECRET, ["someone-else@b.com"])).toBeNull();
    expect(getSessionEmail(request, SECRET, [])).toBeNull();
  });

  test("matches the allow-list case-insensitively", () => {
    const setCookie = buildSessionCookie("A@B.com", SECRET);
    const request = requestWithCookie(setCookie.split(";")[0]);
    expect(getSessionEmail(request, SECRET, ADMINS)).toBe("A@B.com");
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
  test("handles malformed percent-encoding in unrelated cookies without throwing", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    // Cookie header with malformed percent-escape in 'theme' cookie
    // This would throw if decodeURIComponent is unguarded
    const request = requestWithCookie(`theme=%; ${cookiePair}`);
    expect(getSessionEmail(request, SECRET, ADMINS)).toBe("a@b.com");
  });
});
