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

const getSessionEmailMock = mock((_req: Request, _secret: string, _adminEmails: readonly string[]) => null as string | null);
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
        issueUrl: null,
        label: "<b>note</b>",
        uploaderIp: null,
        uploaderCountry: "IT",
        userAgent: null,
        analyzed: false,
      },
    ]);
    const request = new Request("https://logdrop.example/admin");

    const res = await handleAdminDashboard(request, SECRET);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("abc123");
    expect(html).toContain("&lt;b&gt;note&lt;/b&gt;");
    expect(html).toContain('action="/api/admin/delete"');
    expect(html).toContain('value="abc123"');
  });

  test("escapes uploaderCountry when it contains HTML metacharacters", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    listPastesMock.mockImplementation(async () => [
      {
        slug: "abc123",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-08T00:00:00.000Z",
        sizeBytes: 42,
        originalFilename: null,
        issueUrl: null,
        label: null,
        uploaderIp: null,
        uploaderCountry: '<img src=x onerror="alert(1)">',
        userAgent: null,
        analyzed: false,
      },
    ]);

    const res = await handleAdminDashboard(new Request("https://logdrop.example/admin"), SECRET);
    const html = await res.text();

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("renders a linked issue chip when issueUrl is set, and no chip when it's null", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    listPastesMock.mockImplementation(async () => [
      {
        slug: "abc123",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-08T00:00:00.000Z",
        sizeBytes: 42,
        originalFilename: null,
        issueUrl: "https://github.com/gioxx/logdrop/issues/7",
        label: null,
        uploaderIp: null,
        uploaderCountry: null,
        userAgent: null,
        analyzed: false,
      },
      {
        slug: "def456",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-08T00:00:00.000Z",
        sizeBytes: 10,
        originalFilename: null,
        issueUrl: null,
        label: null,
        uploaderIp: null,
        uploaderCountry: null,
        userAgent: null,
        analyzed: false,
      },
    ]);

    const res = await handleAdminDashboard(new Request("https://logdrop.example/admin"), SECRET);
    const html = await res.text();

    expect(html).toContain('href="https://github.com/gioxx/logdrop/issues/7"');
    expect(html).toContain("#7");
  });

  test("passes the current ADMIN_EMAILS allow-list to the session check", async () => {
    const original = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = " Admin@Example.com , other@example.com";
    try {
      getSessionEmailMock.mockImplementation(() => null);
      await handleAdminDashboard(new Request("https://logdrop.example/admin"), SECRET);
      expect(getSessionEmailMock.mock.calls[0][2]).toEqual(["admin@example.com", "other@example.com"]);
    } finally {
      if (original === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = original;
    }
  });
});
