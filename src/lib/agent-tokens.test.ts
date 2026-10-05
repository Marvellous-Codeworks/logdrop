import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

// In-memory Vercel Blob, same approach as storage.test.ts: real exports are
// captured BEFORE mock.module() so afterAll() can hand them back verbatim.
const blobStore = new Map<string, string>();
const blobUploadedAt = new Map<string, number>();
let fakeUploadClock = 0;

const realBlob = await import("@vercel/blob");
const { put: realPut, head: realHead, del: realDel, list: realList } = realBlob;

const BLOB_HOST = "https://example.blob.vercel-storage.com/";

function withRandomSuffix(pathname: string): string {
  const rand = Math.random().toString(36).slice(2, 12);
  const lastSlash = pathname.lastIndexOf("/");
  const dot = pathname.indexOf(".", lastSlash + 1);
  return dot === -1 ? `${pathname}-${rand}` : `${pathname.slice(0, dot)}-${rand}${pathname.slice(dot)}`;
}

mock.module("@vercel/blob", () => ({
  put: mock(async (pathname: string, body: string, options: { addRandomSuffix?: boolean }) => {
    const stored = options?.addRandomSuffix ? withRandomSuffix(pathname) : pathname;
    blobStore.set(stored, body);
    blobUploadedAt.set(stored, ++fakeUploadClock);
    return { pathname: stored, url: `${BLOB_HOST}${stored}` };
  }),
  head: realHead,
  del: mock(async (urls: string[]) => {
    for (const url of urls) {
      const pathname = url.replace(BLOB_HOST, "");
      blobStore.delete(pathname);
      blobUploadedAt.delete(pathname);
    }
  }),
  list: mock(async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobStore.keys()]
      .filter((pathname) => pathname.startsWith(prefix))
      .map((pathname) => ({
        pathname,
        url: `${BLOB_HOST}${pathname}`,
        uploadedAt: new Date(blobUploadedAt.get(pathname) ?? 0),
      })),
    hasMore: false,
  })),
}));

const originalFetch = global.fetch;
global.fetch = mock(async (input: string | URL | Request) => {
  const pathname = String(input).replace(BLOB_HOST, "");
  const body = blobStore.get(pathname);
  return body === undefined ? new Response(null, { status: 404 }) : new Response(body, { status: 200 });
}) as unknown as typeof fetch;

const {
  createAgentTokenFor,
  findAgentToken,
  getAgentTokenRecordFor,
  hashAgentToken,
  maskAgentToken,
  revokeAgentTokenFor,
  safeEqual,
  touchAgentToken,
} = await import("./agent-tokens");

afterAll(() => {
  global.fetch = originalFetch;
  mock.module("@vercel/blob", () => ({ put: realPut, head: realHead, del: realDel, list: realList }));
});

beforeEach(() => {
  blobStore.clear();
  blobUploadedAt.clear();
});

describe("agent tokens", () => {
  test("generates a prefixed token and stores only its hash", async () => {
    const { token, record } = await createAgentTokenFor("Alice@Example.com");

    expect(token).toMatch(/^ld_agent_[A-Za-z0-9_-]{43}$/);
    expect(record.email).toBe("alice@example.com");
    expect(record.hint).toBe(token.slice(-4));
    expect(maskAgentToken(record.hint)).toBe(`ld_agent_…${token.slice(-4)}`);

    const stored = [...blobStore.entries()];
    expect(stored).toHaveLength(1);
    expect(stored[0][0].startsWith(`agent-tokens/${hashAgentToken(token)}/record`)).toBe(true);
    for (const [pathname, body] of stored) {
      expect(pathname).not.toContain(token);
      expect(body).not.toContain(token);
    }
  });

  test("resolves a token to its owner, and rejects unknown or unprefixed tokens", async () => {
    const { token } = await createAgentTokenFor("alice@example.com");

    expect((await findAgentToken(token))?.email).toBe("alice@example.com");
    expect(await findAgentToken(`${token}x`)).toBeNull();
    expect(await findAgentToken("not-a-token")).toBeNull();
  });

  test("keeps each admin's token separate", async () => {
    const alice = await createAgentTokenFor("alice@example.com");
    const bob = await createAgentTokenFor("bob@example.com");

    expect((await findAgentToken(alice.token))?.email).toBe("alice@example.com");
    expect((await findAgentToken(bob.token))?.email).toBe("bob@example.com");
    expect((await getAgentTokenRecordFor("bob@example.com"))?.hint).toBe(bob.token.slice(-4));
  });

  test("regenerating invalidates the previous token without touching other admins", async () => {
    const first = await createAgentTokenFor("alice@example.com");
    const bob = await createAgentTokenFor("bob@example.com");
    const second = await createAgentTokenFor("alice@example.com");

    expect(await findAgentToken(first.token)).toBeNull();
    expect((await findAgentToken(second.token))?.email).toBe("alice@example.com");
    expect((await findAgentToken(bob.token))?.email).toBe("bob@example.com");
  });

  test("revoking removes the token and reports whether there was one", async () => {
    const { token } = await createAgentTokenFor("alice@example.com");

    expect(await revokeAgentTokenFor("alice@example.com")).toBe(true);
    expect(await findAgentToken(token)).toBeNull();
    expect(await getAgentTokenRecordFor("alice@example.com")).toBeNull();
    expect(await revokeAgentTokenFor("alice@example.com")).toBe(false);
    expect(blobStore.size).toBe(0);
  });

  test("touch records last use, keeping a single used blob", async () => {
    const { token } = await createAgentTokenFor("alice@example.com");
    expect((await findAgentToken(token))?.lastUsedAt).toBeNull();

    await touchAgentToken(token, new Date("2026-10-01T10:00:00.000Z"));
    await touchAgentToken(token, new Date("2026-10-02T10:00:00.000Z"));

    expect((await findAgentToken(token))?.lastUsedAt).toBe("2026-10-02T10:00:00.000Z");
    expect([...blobStore.keys()].filter((p) => p.includes("/used"))).toHaveLength(1);
  });

  test("touching a revoked token does not bring it back", async () => {
    const { token } = await createAgentTokenFor("alice@example.com");
    await revokeAgentTokenFor("alice@example.com");

    await touchAgentToken(token, new Date());

    expect(await findAgentToken(token)).toBeNull();
    expect(blobStore.size).toBe(0);
  });

  test("safeEqual compares in constant time and handles length mismatch", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secret-longer")).toBe(false);
  });
});
