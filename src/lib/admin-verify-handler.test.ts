import { describe, test, expect } from "bun:test";
import { handleAdminVerify } from "./admin-verify-handler";
import { signMagicLinkToken } from "./auth-token";
import { verifySessionToken } from "./auth-token";

const SECRET = "test-secret";
const BASE = "https://logdrop.example";

describe("handleAdminVerify", () => {
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
});
