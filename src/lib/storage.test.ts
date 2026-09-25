import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";

const blobStore = new Map<string, string>();
// Tracks each stored blob's mocked upload time. A monotonically increasing
// counter (rather than `Date.now()`) guarantees distinguishable, strictly
// ordered timestamps even for writes issued in the same millisecond, which
// is what the race tests below rely on.
const blobUploadedAt = new Map<string, number>();
let fakeUploadClock = 0;
function nextUploadedAt(): number {
  fakeUploadClock += 1;
  return fakeUploadClock;
}

// Capture the real @vercel/blob exports BEFORE mocking. mock.module() patches
// the shared module namespace object in place rather than swapping the
// reference, so a reference captured *after* mocking (e.g. `realBlob.put`
// read post-mock) would already observe the mocked functions. Capturing the
// function values now, ahead of the mock.module() call below, lets us hand
// them back verbatim in the afterAll() restore.
const realBlob = await import("@vercel/blob");
const { put: realPut, head: realHead, del: realDel, list: realList } = realBlob;

const BLOB_HOST = "https://example.blob.vercel-storage.com/";

// Simulates Vercel Blob's `addRandomSuffix: true`: the suffix is inserted
// before the extension (e.g. `meta.json` -> `meta-<rand>.json`), so the
// stored pathname can't be reconstructed from the slug alone.
function withRandomSuffix(pathname: string): string {
  const rand = Math.random().toString(36).slice(2, 12);
  const lastSlash = pathname.lastIndexOf("/");
  const dot = pathname.indexOf(".", lastSlash + 1);
  return dot === -1 ? `${pathname}-${rand}` : `${pathname.slice(0, dot)}-${rand}${pathname.slice(dot)}`;
}

const putMock = mock(
  async (pathname: string, body: string, options: { addRandomSuffix?: boolean }) => {
    const stored = options?.addRandomSuffix ? withRandomSuffix(pathname) : pathname;
    blobStore.set(stored, body);
    blobUploadedAt.set(stored, nextUploadedAt());
    // Real `PutBlobResult` has no `uploadedAt` field (only `url`,
    // `downloadUrl`, `pathname`, `contentType`, `contentDisposition`,
    // `etag`), so the mock deliberately omits one too.
    return { pathname: stored, url: `${BLOB_HOST}${stored}` };
  },
);

mock.module("@vercel/blob", () => ({
  put: putMock,
  head: mock(async (pathname: string) => {
    if (!blobStore.has(pathname)) throw new Error("not found");
    return { url: `${BLOB_HOST}${pathname}` };
  }),
  del: mock(async (urlsOrPathnames: string[]) => {
    for (const p of urlsOrPathnames) {
      const pathname = p.replace(BLOB_HOST, "");
      blobStore.delete(pathname);
      blobUploadedAt.delete(pathname);
    }
  }),
  list: mock(async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobStore.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => ({
        pathname: p,
        url: `${BLOB_HOST}${p}`,
        uploadedAt: new Date(blobUploadedAt.get(p) ?? 0),
      })),
    hasMore: false,
    cursor: undefined,
  })),
}));

// Capture the real global.fetch BEFORE overwriting it below, so it can be
// restored once this file's suite finishes (bun test runs all matched files
// in one process, so a leaked fetch mock would otherwise bleed into other
// test files, e.g. mail.test.ts / turnstile.test.ts, that run afterwards).
const originalFetch = global.fetch;
global.fetch = mock(async (url: string) => {
  const pathname = url.replace(BLOB_HOST, "");
  const body = blobStore.get(pathname);
  if (body === undefined) return new Response(null, { status: 404 });
  return new Response(body, { status: 200 });
}) as unknown as typeof fetch;

afterAll(() => {
  global.fetch = originalFetch;
  // Restore the @vercel/blob module mock using the real exports captured
  // above. Bun (as of 1.3.14) has no mock.module.restore()/un-mock API; the
  // documented way to revert a mocked module is to call mock.module() again
  // with the original implementation.
  mock.module("@vercel/blob", () => ({
    ...realBlob,
    put: realPut,
    head: realHead,
    del: realDel,
    list: realList,
  }));
});

const { savePaste, getPasteContent, getPasteMeta, listPastes, deletePaste, deleteExpiredPastes, updatePasteMeta } =
  await import("./storage");

function baseMeta(overrides: Partial<Parameters<typeof savePaste>[0]["meta"]> = {}) {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-08T00:00:00.000Z",
    sizeBytes: 11,
    originalFilename: null,
    issueUrl: null,
    label: null,
    uploaderIp: null,
    uploaderCountry: null,
    userAgent: null,
    analyzed: false,
    ...overrides,
  };
}

describe("storage", () => {
  beforeEach(() => {
    blobStore.clear();
    blobUploadedAt.clear();
    putMock.mockClear();
  });

  test("savePaste writes both blobs with a random suffix and a short CDN cache", async () => {
    await savePaste({ slug: "abc123", content: "hello world", meta: baseMeta() });

    expect(putMock).toHaveBeenCalledTimes(2);
    for (const call of putMock.mock.calls) {
      const options = call[2] as { addRandomSuffix?: boolean; cacheControlMaxAge?: number };
      expect(options.addRandomSuffix).toBe(true);
      expect(options.cacheControlMaxAge).toBe(60);
    }
    // The stored pathnames are not the guessable, suffix-free ones.
    expect(blobStore.has("uploads/abc123/content")).toBe(false);
    expect(blobStore.has("uploads/abc123/meta.json")).toBe(false);
    expect([...blobStore.keys()].every((p) => p.startsWith("uploads/abc123/"))).toBe(true);
  });

  test("lookups are scoped to the exact slug, not a slug sharing its prefix", async () => {
    await savePaste({ slug: "abc1", content: "other", meta: baseMeta({ sizeBytes: 5 }) });
    expect(await getPasteContent("abc")).toBeNull();
    expect(await getPasteMeta("abc")).toBeNull();
    await deletePaste("abc");
    expect(await getPasteContent("abc1")).toBe("other");
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
    expect([...blobStore.keys()].some((p) => p.startsWith("uploads/todelete/"))).toBe(false);
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

  test("updatePasteMeta rewrites only the meta blob, leaving content untouched", async () => {
    await savePaste({ slug: "toupdate", content: "unchanged", meta: baseMeta({ sizeBytes: 9 }) });
    putMock.mockClear();

    const meta = await getPasteMeta("toupdate");
    if (!meta) throw new Error("expected meta to exist");
    await updatePasteMeta({ ...meta, analyzed: true });

    expect(putMock).toHaveBeenCalledTimes(1);
    const options = putMock.mock.calls[0][2] as { addRandomSuffix?: boolean; cacheControlMaxAge?: number };
    expect(options.addRandomSuffix).toBe(true);
    expect(options.cacheControlMaxAge).toBe(60);

    const updated = await getPasteMeta("toupdate");
    expect(updated?.analyzed).toBe(true);
    expect(await getPasteContent("toupdate")).toBe("unchanged");

    // Exactly one meta blob remains under the slug's prefix (the old one was deleted).
    const metaBlobCount = [...blobStore.keys()].filter(
      (p) => p.startsWith("uploads/toupdate/") && p.includes("meta"),
    ).length;
    expect(metaBlobCount).toBe(1);
  });

  test("updatePasteMeta writes the new meta before cleaning up, so getPasteMeta is readable immediately after", async () => {
    await savePaste({ slug: "writefirst", content: "unchanged", meta: baseMeta({ sizeBytes: 9 }) });

    const meta = await getPasteMeta("writefirst");
    if (!meta) throw new Error("expected meta to exist");
    await updatePasteMeta({ ...meta, analyzed: true, label: "updated" });

    // The new meta is readable right away (main regression guard: the paste
    // is never left without a valid meta blob).
    const updated = await getPasteMeta("writefirst");
    expect(updated?.analyzed).toBe(true);
    expect(updated?.label).toBe("updated");

    // Still exactly one meta blob remains under the slug's prefix.
    const metaBlobCount = [...blobStore.keys()].filter(
      (p) => p.startsWith("uploads/writefirst/") && p.includes("meta"),
    ).length;
    expect(metaBlobCount).toBe(1);
  });

  test("updatePasteMeta race: two concurrent updates on the same slug leave exactly one meta blob, the later write", async () => {
    // Regression test for a race where two `updatePasteMeta` calls for the
    // same slug (e.g. two quick checkbox toggles) both write a new meta blob
    // and then each list-and-delete "every other meta blob" — which, with
    // the old unconditional delete, meant each call deleted the OTHER's
    // brand-new blob too, leaving the slug with no meta blob at all.
    //
    // True network concurrency can't be reproduced in a synchronous test,
    // but the mocked put/list/del here have no internal `await`, so calling
    // both updates via Promise.all still exercises the real interleaving
    // hazard: `updatePasteMeta(a)` runs synchronously up to its own `put`
    // call (recording an earlier mocked `uploadedAt` via the monotonic
    // counter above) before control returns to start `updatePasteMeta(b)`
    // (recording a later one) — mirroring "b's write lands after a's" — and
    // only then do the two calls' list+cleanup steps interleave. This lets
    // the test assert the fix directly: whichever call's write is newer
    // survives, regardless of delete ordering between the two calls.
    await savePaste({ slug: "race", content: "unchanged", meta: baseMeta({ sizeBytes: 9 }) });
    const meta = await getPasteMeta("race");
    if (!meta) throw new Error("expected meta to exist");

    await Promise.all([
      updatePasteMeta({ ...meta, analyzed: true, label: "first" }),
      updatePasteMeta({ ...meta, analyzed: true, label: "second" }),
    ]);

    const metaBlobCount = [...blobStore.keys()].filter(
      (p) => p.startsWith("uploads/race/") && p.includes("meta"),
    ).length;
    expect(metaBlobCount).toBe(1);

    // "second" is the later of the two calls per the mock's monotonic
    // upload-time counter, so it must be the one that survives.
    const finalMeta = await getPasteMeta("race");
    expect(finalMeta?.label).toBe("second");
    expect(await getPasteContent("race")).toBe("unchanged");
  });

  test("getPasteMeta normalizes a missing `analyzed` field to false (legacy pastes)", async () => {
    // Simulate a paste written before the `analyzed` field existed by
    // inserting a meta blob directly into the mocked blob store, bypassing
    // savePaste's normal path (which always includes `analyzed`).
    const legacyMeta = {
      slug: "legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 3,
      originalFilename: null,
      issueUrl: null,
      label: null,
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
      // `analyzed` intentionally omitted.
    };
    blobStore.set("uploads/legacy/meta-legacy.json", JSON.stringify(legacyMeta));
    blobStore.set("uploads/legacy/content-legacy", "old content");

    const meta = await getPasteMeta("legacy");
    expect(meta?.analyzed).toBe(false);

    const pastes = await listPastes();
    const legacy = pastes.find((p) => p.slug === "legacy");
    expect(legacy?.analyzed).toBe(false);
  });
});
