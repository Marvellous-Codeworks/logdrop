import { describe, test, expect } from "bun:test";
import { SESSION_COOKIE_NAME, getSessionEmail, buildSessionCookie, clearSessionCookie } from "./session";

const SECRET = "test-secret";

function requestWithCookie(cookieHeader: string): Request {
  return new Request("https://example.com/admin", { headers: { cookie: cookieHeader } });
}

describe("buildSessionCookie / getSessionEmail", () => {
  test("a request carrying the built cookie resolves back to the same email", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0]; // "name=value"
    const request = requestWithCookie(cookiePair);
    expect(getSessionEmail(request, SECRET)).toBe("a@b.com");
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
    expect(getSessionEmail(request, SECRET)).toBeNull();
  });

  test("returns null when the cookie was signed with a different secret", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    const request = requestWithCookie(cookiePair);
    expect(getSessionEmail(request, "other-secret")).toBeNull();
  });

  test("ignores unrelated cookies alongside the session cookie", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    const request = requestWithCookie(`theme=dark; ${cookiePair}; other=1`);
    expect(getSessionEmail(request, SECRET)).toBe("a@b.com");
  });
});

describe("clearSessionCookie", () => {
  test("expires the cookie immediately", () => {
    const cleared = clearSessionCookie();
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain("Max-Age=0");
  });
});
