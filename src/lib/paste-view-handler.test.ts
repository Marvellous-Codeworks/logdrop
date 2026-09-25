import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

// ./session and ./storage each export more than the one function this file
// overrides. mock.module() replaces the WHOLE module namespace for the rest
// of this bun test process AND patches it IN PLACE (not by swapping the
// reference) — so an un-restored, or incompletely-restored, partial mock
// here would wipe out the other real exports for any other test file (e.g.
// session.test.ts, storage.test.ts) sharing the process. This exact class
// of bug already broke storage.test.ts once in this project (Task 11), and
// a first attempt at fixing it there — restoring via a captured namespace
// object reference — still failed, because that reference goes stale the
// moment mock.module() first runs on the same specifier. The only pattern
// confirmed to work: destructure every real export into its own const
// BEFORE any mock.module() call on that specifier, then reconstruct the
// FULL export list (real consts for anything not being overridden, the
// mock for what is) both in the initial mock and in the afterAll restore.
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

const getPasteContentMock = mock(async (_slug: string) => null as string | null);
const getPasteMetaMock = mock(async (_slug: string) => null as unknown);
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: getPasteContentMock,
  getPasteMeta: getPasteMetaMock,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
}));

const { handlePasteView } = await import("./paste-view-handler");

const SECRET = "test-secret";

describe("handlePasteView", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    getPasteContentMock.mockClear();
    getPasteMetaMock.mockClear();
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

  test("redirects to login with a next param when there is no session", async () => {
    getSessionEmailMock.mockImplementation(() => null);
    const request = new Request("https://logdrop.example/r/abc123");

    const res = await handlePasteView(request, "abc123", SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://logdrop.example/admin/login?next=%2Fr%2Fabc123",
    );
  });

  test("returns 404 when the paste does not exist", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteContentMock.mockImplementation(async () => null);
    getPasteMetaMock.mockImplementation(async () => null);
    const request = new Request("https://logdrop.example/r/missing");

    const res = await handlePasteView(request, "missing", SECRET);

    expect(res.status).toBe(404);
  });

  test("renders the paste content escaped inside the page when authenticated", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteContentMock.mockImplementation(async () => "<script>alert(1)</script>");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 25,
      originalFilename: null,
      issueUrl: null,
      label: "<b>repro</b> steps",
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: false,
    }));
    const request = new Request("https://logdrop.example/r/abc123");

    const res = await handlePasteView(request, "abc123", SECRET);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("2026-01-01T00:00:00.000Z");
    expect(html).not.toContain("<b>repro</b> steps");
    expect(html).toContain("&lt;b&gt;repro&lt;/b&gt; steps");
  });

  test("renders a linked issue chip when issueUrl is present", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteContentMock.mockImplementation(async () => "log line");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 8,
      originalFilename: null,
      issueUrl: "https://github.com/gioxx/logdrop/issues/7",
      label: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: false,
    }));

    const res = await handlePasteView(new Request("https://logdrop.example/r/abc123"), "abc123", SECRET);
    const html = await res.text();

    expect(html).toContain('href="https://github.com/gioxx/logdrop/issues/7"');
    expect(html).toContain("#7");
  });

  test("wires the copy button to flash a success state on click", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteContentMock.mockImplementation(async () => "log line");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 8,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: false,
    }));

    const res = await handlePasteView(new Request("https://logdrop.example/r/abc123"), "abc123", SECRET);
    const html = await res.text();

    expect(html).toContain('classList.add("flash-success")');
    expect(html).toContain('classList.remove("flash-success")');
  });
});
