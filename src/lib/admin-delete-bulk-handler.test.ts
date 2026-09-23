import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// Same mock-leakage risk as the other admin handler tests — destructure every
// real export before mocking; a namespace-object reference goes stale the
// moment mock.module() first runs on it.
const {
  SESSION_COOKIE_NAME: realSessionCookieName,
  getSessionEmail: realGetSessionEmail,
  buildSessionCookie: realBuildSessionCookie,
  clearSessionCookie: realClearSessionCookie,
} = await import("./session");
const {
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
} = await import("./storage");

const getSessionEmailMock = mock((_req: Request, _secret: string, _adminEmails: readonly string[]) => null as string | null);
mock.module("./session", () => ({
  SESSION_COOKIE_NAME: realSessionCookieName,
  getSessionEmail: getSessionEmailMock,
  buildSessionCookie: realBuildSessionCookie,
  clearSessionCookie: realClearSessionCookie,
}));

const deletePasteMock = mock(async (_slug: string) => undefined);
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  listPastes: realListPastes,
  deletePaste: deletePasteMock,
  deleteExpiredPastes: realDeleteExpiredPastes,
}));

const { handleAdminDeleteBulk } = await import("./admin-delete-bulk-handler");

const SECRET = "test-secret";

function deleteRequest(slugs: string[]): Request {
  const form = new FormData();
  for (const slug of slugs) form.append("selected", slug);
  return new Request("https://logdrop.example/api/admin/delete-bulk", { method: "POST", body: form });
}

describe("handleAdminDeleteBulk", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    deletePasteMock.mockClear();
  });

  afterAll(() => {
    mock.module("./session", () => ({
      SESSION_COOKIE_NAME: realSessionCookieName,
      getSessionEmail: realGetSessionEmail,
      buildSessionCookie: realBuildSessionCookie,
      clearSessionCookie: realClearSessionCookie,
    }));
    mock.module("./storage", () => ({
      savePaste: realSavePaste,
      getPasteContent: realGetPasteContent,
      getPasteMeta: realGetPasteMeta,
      listPastes: realListPastes,
      deletePaste: realDeletePaste,
      deleteExpiredPastes: realDeleteExpiredPastes,
    }));
  });

  test("redirects to login when there is no session", async () => {
    getSessionEmailMock.mockImplementation(() => null);

    const res = await handleAdminDeleteBulk(deleteRequest(["abc123"]), SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?next=/admin");
    expect(deletePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when no slugs are selected", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");

    const res = await handleAdminDeleteBulk(deleteRequest([]), SECRET);

    expect(res.status).toBe(400);
    expect(deletePasteMock).not.toHaveBeenCalled();
  });

  test("deletes every selected paste and redirects back to the dashboard", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");

    const res = await handleAdminDeleteBulk(deleteRequest(["abc123", "def456", "ghi789"]), SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    expect(deletePasteMock).toHaveBeenCalledTimes(3);
    expect(deletePasteMock.mock.calls.map((c) => c[0]).sort()).toEqual(["abc123", "def456", "ghi789"]);
  });
});
