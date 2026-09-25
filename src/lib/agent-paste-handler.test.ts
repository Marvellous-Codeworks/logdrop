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
mock.module("./storage", () => ({
  savePaste: realSavePaste,
  getPasteContent: getPasteContentMock,
  getPasteMeta: getPasteMetaMock,
  updatePasteMeta: realUpdatePasteMeta,
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
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 22,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      analyzed: false,
    }));

    const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", SECRET);
    const json = (await res.json()) as { slug: string; content: string; meta: { sizeBytes: number } };

    expect(res.status).toBe(200);
    expect(json.slug).toBe("abc123");
    expect(json.content).toBe("log line 1\nlog line 2");
    expect(json.meta.sizeBytes).toBe(22);
  });
});
