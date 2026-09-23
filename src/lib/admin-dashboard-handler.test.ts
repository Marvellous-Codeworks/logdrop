import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// See Task 14's note: mock.module() replaces the WHOLE module namespace, in
// place, so every real export must be preserved explicitly via consts
// destructured BEFORE mocking — a captured namespace-object reference goes
// stale the moment mock.module() first runs on that specifier.
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

const getSessionEmailMock = mock((_req: Request, _secret: string) => null as string | null);
mock.module("./session", () => ({
  SESSION_COOKIE_NAME: realSessionCookieName,
  getSessionEmail: getSessionEmailMock,
  buildSessionCookie: realBuildSessionCookie,
  clearSessionCookie: realClearSessionCookie,
}));

const listPastesMock = mock(async () => [] as unknown[]);
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  listPastes: listPastesMock,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
}));

const { handleAdminDashboard } = await import("./admin-dashboard-handler");

const SECRET = "test-secret";

describe("handleAdminDashboard", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    listPastesMock.mockClear();
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
    const request = new Request("https://logdrop.example/admin");

    const res = await handleAdminDashboard(request, SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?next=/admin");
  });

  test("lists pastes with escaped fields and a delete form per row", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    listPastesMock.mockImplementation(async () => [
      {
        slug: "abc123",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-08T00:00:00.000Z",
        sizeBytes: 42,
        originalFilename: null,
        label: "<b>note</b>",
        uploaderIp: null,
        uploaderCountry: "IT",
        userAgent: null,
      },
    ]);
    const request = new Request("https://logdrop.example/admin");

    const res = await handleAdminDashboard(request, SECRET);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("abc123");
    expect(html).toContain("&lt;b&gt;note&lt;/b&gt;");
    expect(html).toContain('<form method="POST" action="/api/admin/delete">');
    expect(html).toContain('value="abc123"');
  });
});
