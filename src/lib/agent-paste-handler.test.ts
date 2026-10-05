import { describe, test, expect, mock, afterAll, beforeEach } from "bun:test";

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

const realAgentTokens = await import("./agent-tokens");
const {
  findAgentToken: realFindAgentToken,
  touchAgentToken: realTouchAgentToken,
} = realAgentTokens;
const realAgentTokenExports = { ...realAgentTokens };
type TokenRecord = { email: string; createdAt: string; lastUsedAt: string | null; hint: string };
const findAgentTokenMock = mock(async (_token: string) => null as TokenRecord | null);
const touchAgentTokenMock = mock(async (_token: string, _at: Date) => undefined);
mock.module("./agent-tokens", () => ({
  ...realAgentTokenExports,
  findAgentToken: findAgentTokenMock,
  touchAgentToken: touchAgentTokenMock,
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
    mock.module("./agent-tokens", () => ({
      ...realAgentTokenExports,
      findAgentToken: realFindAgentToken,
      touchAgentToken: realTouchAgentToken,
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

  describe("per-admin tokens", () => {
    const PERSONAL = "ld_agent_alice-personal-token";
    const liveMeta = () => ({
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
      agentLastAccessBy: null,
    });
    const originalAdmins = process.env.ADMIN_EMAILS;

    beforeEach(() => {
      process.env.ADMIN_EMAILS = "alice@example.com, bob@example.com";
      updatePasteMetaMock.mockClear();
      updatePasteMetaMock.mockImplementation(async () => undefined);
      touchAgentTokenMock.mockClear();
      touchAgentTokenMock.mockImplementation(async () => undefined);
      findAgentTokenMock.mockImplementation(async (token: string) =>
        token === PERSONAL
          ? { email: "alice@example.com", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null, hint: "oken" }
          : null,
      );
      getPasteContentMock.mockImplementation(async () => "log");
      getPasteMetaMock.mockImplementation(async () => liveMeta());
    });

    afterAll(() => {
      if (originalAdmins === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = originalAdmins;
    });

    test("accepts a personal token, attributes the read to its owner and redacts it", async () => {
      const res = await handleAgentPasteRead(agentRequest(`Bearer ${PERSONAL}`), "abc123", undefined);
      const json = (await res.json()) as { meta: Record<string, unknown> };

      expect(res.status).toBe(200);
      const written = updatePasteMetaMock.mock.calls[0][0] as Record<string, unknown>;
      expect(written.agentLastAccessBy).toBe("alice@example.com");
      expect(json.meta.agentLastAccessBy).toBeUndefined();
      expect(touchAgentTokenMock).toHaveBeenCalledTimes(1);
      expect(touchAgentTokenMock.mock.calls[0][0]).toBe(PERSONAL);
    });

    test("rejects a personal token whose owner is no longer an admin", async () => {
      process.env.ADMIN_EMAILS = "bob@example.com";
      const res = await handleAgentPasteRead(agentRequest(`Bearer ${PERSONAL}`), "abc123", undefined);
      expect(res.status).toBe(401);
      expect(updatePasteMetaMock).not.toHaveBeenCalled();
    });

    test("rejects unknown and revoked tokens", async () => {
      const res = await handleAgentPasteRead(agentRequest("Bearer ld_agent_revoked"), "abc123", SECRET);
      expect(res.status).toBe(401);
    });

    test("works without AGENT_API_TOKEN, which then accepts nothing else", async () => {
      expect((await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", undefined)).status).toBe(401);
      expect((await handleAgentPasteRead(agentRequest("Bearer "), "abc123", undefined)).status).toBe(401);
    });

    test("attributes legacy AGENT_API_TOKEN reads to the instance token", async () => {
      const res = await handleAgentPasteRead(agentRequest(`Bearer ${SECRET}`), "abc123", SECRET);

      expect(res.status).toBe(200);
      const written = updatePasteMetaMock.mock.calls[0][0] as Record<string, unknown>;
      expect(written.agentLastAccessBy).toBe("instance");
      expect(touchAgentTokenMock).not.toHaveBeenCalled();
    });

    test("still returns the log when recording the token's last use fails", async () => {
      touchAgentTokenMock.mockImplementation(async () => {
        throw new Error("blob write failed");
      });
      const consoleError = console.error;
      console.error = () => {};
      try {
        const res = await handleAgentPasteRead(agentRequest(`Bearer ${PERSONAL}`), "abc123", undefined);
        expect(res.status).toBe(200);
      } finally {
        console.error = consoleError;
      }
    });
  });
});
