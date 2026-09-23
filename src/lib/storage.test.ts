import { describe, test, expect, mock, beforeEach } from "bun:test";

const blobStore = new Map<string, string>();

mock.module("@vercel/blob", () => ({
  put: mock(async (pathname: string, body: string) => {
    blobStore.set(pathname, body);
    return { url: `https://example.blob.vercel-storage.com/${pathname}` };
  }),
  head: mock(async (pathname: string) => {
    if (!blobStore.has(pathname)) throw new Error("not found");
    return { url: `https://example.blob.vercel-storage.com/${pathname}` };
  }),
  del: mock(async (pathnames: string[]) => {
    for (const p of pathnames) blobStore.delete(p);
  }),
  list: mock(async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobStore.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => ({ pathname: p, url: `https://example.blob.vercel-storage.com/${p}` })),
    hasMore: false,
    cursor: undefined,
  })),
}));

const originalFetch = global.fetch;
global.fetch = mock(async (url: string) => {
  const pathname = url.replace("https://example.blob.vercel-storage.com/", "");
  const body = blobStore.get(pathname);
  if (body === undefined) return new Response(null, { status: 404 });
  return new Response(body, { status: 200 });
}) as unknown as typeof fetch;

const { savePaste, getPasteContent, getPasteMeta, listPastes, deletePaste, deleteExpiredPastes } =
  await import("./storage");

function baseMeta(overrides: Partial<Parameters<typeof savePaste>[0]["meta"]> = {}) {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-08T00:00:00.000Z",
    sizeBytes: 11,
    originalFilename: null,
    label: null,
    uploaderIp: null,
    uploaderCountry: null,
    userAgent: null,
    ...overrides,
  };
}

describe("storage", () => {
  beforeEach(() => {
    blobStore.clear();
  });

  test("savePaste then getPasteContent/getPasteMeta round-trip", async () => {
    await savePaste({ slug: "abc123", content: "hello world", meta: baseMeta() });

    expect(await getPasteContent("abc123")).toBe("hello world");
    const meta = await getPasteMeta("abc123");
    expect(meta?.slug).toBe("abc123");
    expect(meta?.sizeBytes).toBe(11);
  });

  test("getPasteContent and getPasteMeta return null for an unknown slug", async () => {
    expect(await getPasteContent("missing")).toBeNull();
    expect(await getPasteMeta("missing")).toBeNull();
  });

  test("deletePaste removes both the content and meta blobs", async () => {
    await savePaste({ slug: "todelete", content: "bye", meta: baseMeta({ sizeBytes: 3 }) });
    await deletePaste("todelete");
    expect(await getPasteContent("todelete")).toBeNull();
    expect(await getPasteMeta("todelete")).toBeNull();
  });

  test("listPastes returns all saved pastes, newest first", async () => {
    await savePaste({
      slug: "older",
      content: "old",
      meta: baseMeta({ createdAt: "2026-01-01T00:00:00.000Z", sizeBytes: 3 }),
    });
    await savePaste({
      slug: "newer",
      content: "new",
      meta: baseMeta({ createdAt: "2026-01-02T00:00:00.000Z", sizeBytes: 3 }),
    });

    const pastes = await listPastes();
    expect(pastes.map((p) => p.slug)).toEqual(["newer", "older"]);
  });

  test("deleteExpiredPastes only removes pastes past expiresAt", async () => {
    await savePaste({
      slug: "expired",
      content: "old",
      meta: baseMeta({ expiresAt: "2026-01-08T00:00:00.000Z", sizeBytes: 3 }),
    });
    await savePaste({
      slug: "fresh",
      content: "new",
      meta: baseMeta({ expiresAt: "2026-01-17T00:00:00.000Z", sizeBytes: 3 }),
    });

    const deleted = await deleteExpiredPastes(new Date("2026-01-09T00:00:00.000Z"));

    expect(deleted).toEqual(["expired"]);
    expect(await getPasteContent("expired")).toBeNull();
    expect(await getPasteContent("fresh")).toBe("new");
  });
});
