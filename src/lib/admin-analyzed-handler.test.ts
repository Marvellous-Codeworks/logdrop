import { describe, test, expect, mock, afterEach, afterAll } from "bun:test";

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
  updatePasteMeta: realUpdatePasteMeta,
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

const getPasteMetaMock = mock(async (_slug: string) => null as unknown);
const updatePasteMetaMock = mock(async (_meta: unknown) => undefined);
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: getPasteMetaMock,
  updatePasteMeta: updatePasteMetaMock,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
}));

const { handleAdminAnalyzed } = await import("./admin-analyzed-handler");

const SECRET = "test-secret";

function analyzedRequest(body: unknown): Request {
  return new Request("https://logdrop.example/api/admin/analyzed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleAdminAnalyzed", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    getPasteMetaMock.mockClear();
    updatePasteMetaMock.mockClear();
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
      updatePasteMeta: realUpdatePasteMeta,
      listPastes: realListPastes,
      deletePaste: realDeletePaste,
      deleteExpiredPastes: realDeleteExpiredPastes,
    }));
  });

  test("returns 401 when there is no admin session", async () => {
    getSessionEmailMock.mockImplementation(() => null);

    const res = await handleAdminAnalyzed(analyzedRequest({ slug: "abc123", analyzed: true }), SECRET);

    expect(res.status).toBe(401);
    expect(updatePasteMetaMock).not.toHaveBeenCalled();
  });

  test("returns 400 when the body is malformed", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");

    const res = await handleAdminAnalyzed(analyzedRequest({ slug: "abc123" }), SECRET);

    expect(res.status).toBe(400);
    expect(updatePasteMetaMock).not.toHaveBeenCalled();
  });

  test("returns 404 when the slug does not exist", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteMetaMock.mockImplementation(async () => null);

    const res = await handleAdminAnalyzed(analyzedRequest({ slug: "missing", analyzed: true }), SECRET);

    expect(res.status).toBe(404);
    expect(updatePasteMetaMock).not.toHaveBeenCalled();
  });

  test("flips analyzed and persists the updated meta", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 10,
      originalFilename: null,
      label: null,
      issueUrl: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: false,
    }));

    const res = await handleAdminAnalyzed(analyzedRequest({ slug: "abc123", analyzed: true }), SECRET);

    expect(res.status).toBe(200);
    expect(updatePasteMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "abc123", analyzed: true }),
    );
  });
});
