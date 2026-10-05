import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

// Real exports captured before mock.module(); see admin-dashboard-handler.test.ts.
const realSession = { ...(await import("./session")) };
const realAgentTokens = { ...(await import("./agent-tokens")) };

const getSessionEmailMock = mock((_req: Request, _secret: string, _adminEmails: readonly string[]) => null as string | null);
mock.module("./session", () => ({ ...realSession, getSessionEmail: getSessionEmailMock }));

const createAgentTokenForMock = mock(async (email: string) => ({
  token: "ld_agent_plaintext-abcd",
  record: { email, createdAt: "2026-10-05T10:00:00.000Z", lastUsedAt: null, hint: "abcd" },
}));
const revokeAgentTokenForMock = mock(async (_email: string) => true);
mock.module("./agent-tokens", () => ({
  ...realAgentTokens,
  createAgentTokenFor: createAgentTokenForMock,
  revokeAgentTokenFor: revokeAgentTokenForMock,
}));

const { handleAdminAgentToken } = await import("./admin-agent-token-handler");

const SECRET = "test-secret";

function post(body: unknown): Request {
  return new Request("https://logdrop.example/api/admin/agent-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handleAdminAgentToken", () => {
  afterAll(() => {
    mock.module("./session", () => realSession);
    mock.module("./agent-tokens", () => realAgentTokens);
  });

  beforeEach(() => {
    getSessionEmailMock.mockImplementation(() => "alice@example.com");
    createAgentTokenForMock.mockClear();
    revokeAgentTokenForMock.mockClear();
  });

  test("returns 401 without an admin session", async () => {
    getSessionEmailMock.mockImplementation(() => null);
    const res = await handleAdminAgentToken(post({ action: "generate" }), SECRET);
    expect(res.status).toBe(401);
    expect(createAgentTokenForMock).not.toHaveBeenCalled();
  });

  test("generates a token for the signed-in admin and returns the plaintext once", async () => {
    const res = await handleAdminAgentToken(post({ action: "generate" }), SECRET);
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(createAgentTokenForMock).toHaveBeenCalledWith("alice@example.com");
    expect(json.token).toBe("ld_agent_plaintext-abcd");
    expect(json.masked).toBe("ld_agent_…abcd");
  });

  test("revokes only the signed-in admin's token", async () => {
    const res = await handleAdminAgentToken(post({ action: "revoke" }), SECRET);
    expect(res.status).toBe(200);
    expect(revokeAgentTokenForMock).toHaveBeenCalledWith("alice@example.com");
    expect(((await res.json()) as Record<string, unknown>).token).toBeUndefined();
  });

  test("rejects malformed bodies and unknown actions", async () => {
    expect((await handleAdminAgentToken(post("{not json"), SECRET)).status).toBe(400);
    expect((await handleAdminAgentToken(post({ action: "read" }), SECRET)).status).toBe(400);
    expect((await handleAdminAgentToken(post(null), SECRET)).status).toBe(400);
  });
});
