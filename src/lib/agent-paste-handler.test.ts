import { describe, test, expect, mock, afterAll } from "bun:test";

const {
  savePaste: realSavePaste,
  getPasteContent: realGetPasteContent,
  getPasteMeta: realGetPasteMeta,
  updatePasteMeta: realUpdatePasteMeta,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
} = await import("./storage");

const getPasteContentMock = mock(async (_slug: string) => null as string | null);
const getPasteMetaMock = mock(async (_slug: string) => null as unknown);
const updatePasteMetaMock = mock(async (_meta: unknown) => undefined);
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: getPasteContentMock,
  getPasteMeta: getPasteMetaMock,
  updatePasteMeta: updatePasteMetaMock,
  listPastes: realListPastes,
  deletePaste: realDeletePaste,
  deleteExpiredPastes: realDeleteExpiredPastes,
}));

const { handleAgentPasteRead } = await import("./agent-paste-handler");

const SECRET = "agent-secret";

function agentRequest(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://logdrop.example/api/agent/paste/abc123", { headers });
}

describe("handleAgentPasteRead", () => {
  afterAll(() => {
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

  test("returns 401 when the bearer token is missing", async () => {
    const res = await handleAgentPasteRead(agentRequest(), "abc123", SECRET);
    expect(res.status).toBe(401);
  });

  test("returns 401 when the bearer token is wrong", async () => {
    const res = await handleAgentPasteRead(agentRequest("Bearer wrong"), "abc123", SECRET);
    expect(res.status).toBe(401);
  });

  test("returns 404 when the slug does not exist", async () => {
    getPasteContentMock.mockImplementation(async () => null);
    getPasteMetaMock.mockImplementation(async () => null);

    const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "missing", SECRET);

    expect(res.status).toBe(404);
  });

  test("returns the content and meta as JSON when authorized", async () => {
    getPasteContentMock.mockImplementation(async () => "log line 1\nlog line 2");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      // Far future so this test doesn't start failing the new expiry check
      // (finding 3) once real time passes the old fixed date.
      expiresAt: "2099-01-01T00:00:00.000Z",
      sizeBytes: 22,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: "1.2.3.4",
      uploaderCountry: "IT",
      userAgent: "test-agent",
      analyzed: false,
    }));

    const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", SECRET);
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.slug).toBe("abc123");
    expect(json.content).toBe("log line 1\nlog line 2");

    // Verify sensitive fields are redacted
    const meta = json.meta as Record<string, unknown>;
    expect(meta.uploaderIp).toBeUndefined();
    expect(meta.uploaderCountry).toBeUndefined();
    expect(meta.userAgent).toBeUndefined();

    // Verify other fields are still present
    expect(meta.sizeBytes).toBe(22);
    expect(meta.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(meta.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(meta.analyzed).toBe(false);
  });

  test("records the agent read (count + last access) and redacts analyzedBy", async () => {
    updatePasteMetaMock.mockClear();
    updatePasteMetaMock.mockImplementation(async () => undefined);
    getPasteContentMock.mockImplementation(async () => "log");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      sizeBytes: 3,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: true,
      analyzedAt: "2026-01-02T00:00:00.000Z",
      analyzedBy: "admin@example.com",
      agentAccessCount: 2,
      agentLastAccessAt: "2026-01-03T00:00:00.000Z",
    }));

    const before = Date.now();
    const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", SECRET);
    const json = (await res.json()) as { meta: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(updatePasteMetaMock).toHaveBeenCalledTimes(1);
    const written = updatePasteMetaMock.mock.calls[0][0] as Record<string, unknown>;
    expect(written.agentAccessCount).toBe(3);
    expect(new Date(written.agentLastAccessAt as string).getTime()).toBeGreaterThanOrEqual(before);
    // Everything else is preserved in the rewritten meta.
    expect(written.analyzedBy).toBe("admin@example.com");

    expect(json.meta.agentAccessCount).toBe(3);
    expect(json.meta.analyzedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(json.meta.analyzedBy).toBeUndefined();
  });

  test("still returns the log when recording the agent read fails", async () => {
    updatePasteMetaMock.mockClear();
    updatePasteMetaMock.mockImplementation(async () => {
      throw new Error("blob write failed");
    });
    getPasteContentMock.mockImplementation(async () => "log");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      sizeBytes: 3,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: false,
      analyzedAt: null,
      analyzedBy: null,
      agentAccessCount: 0,
      agentLastAccessAt: null,
    }));
    const consoleError = console.error;
    console.error = () => {};
    try {
      const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", SECRET);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { content: string }).content).toBe("log");
    } finally {
      console.error = consoleError;
      updatePasteMetaMock.mockImplementation(async () => undefined);
    }
  });

  test("does not record an agent read when unauthorized or not found", async () => {
    updatePasteMetaMock.mockClear();
    getPasteContentMock.mockImplementation(async () => null);
    getPasteMetaMock.mockImplementation(async () => null);

    await handleAgentPasteRead(agentRequest("Bearer wrong"), "abc123", SECRET);
    await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "missing", SECRET);

    expect(updatePasteMetaMock).not.toHaveBeenCalled();
  });

  test("returns 404 for a slug that exists but has already expired", async () => {
    getPasteContentMock.mockImplementation(async () => "log line 1\nlog line 2");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:00:00.000Z", // in the past
      sizeBytes: 22,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: "1.2.3.4",
      uploaderCountry: "IT",
      userAgent: "test-agent",
      analyzed: false,
    }));

    const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", SECRET);

    expect(res.status).toBe(404);
  });
});
