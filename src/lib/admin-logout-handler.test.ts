import { describe, test, expect, afterEach, afterAll } from "bun:test";
import { installFakeAuthStore } from "./auth-store.fake";

const authStore = await installFakeAuthStore();
afterAll(() => authStore.restore());

const { buildSessionCookie, getSessionEmail } = await import("./session");
const { handleAdminLogout } = await import("./admin-logout-handler");

const SECRET = "test-secret";

afterEach(() => authStore.reset());

describe("handleAdminLogout", () => {
  test("revokes the session, clears the cookie and redirects to login", async () => {
    const cookie = (await buildSessionCookie("a@b.com", SECRET)).split(";")[0];
    const request = new Request("https://logdrop.example/api/admin/logout", {
      method: "POST",
      headers: { cookie },
    });

    const res = await handleAdminLogout(request, SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await getSessionEmail(request, SECRET, ["a@b.com"])).toBeNull();
  });

  test("still clears the cookie when deleting the session fails", async () => {
    const cookie = (await buildSessionCookie("a@b.com", SECRET)).split(";")[0];
    authStore.fake.deleteSession.mockImplementationOnce(async () => {
      throw new Error("Blob down");
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      const res = await handleAdminLogout(
        new Request("https://logdrop.example/api/admin/logout", { method: "POST", headers: { cookie } }),
        SECRET,
      );
      expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    } finally {
      console.error = originalError;
    }
  });
});
