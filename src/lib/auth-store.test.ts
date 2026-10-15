import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import { createHash } from "node:crypto";

// In-memory Vercel Blob with the semantics auth-store.ts relies on: fixed
// pathnames, no-overwrite by default, ETag compare-and-swap via `ifMatch`,
// and `head()` reporting content type and upload time. As on the real
// service, the ETag is the MD5 of the content: rewriting identical content
// leaves it unchanged. Real exports are
// captured BEFORE mock.module() so afterAll() can hand them back verbatim.
const realBlob = { ...(await import("@vercel/blob")) };
const { BlobNotFoundError, BlobPreconditionFailedError } = realBlob;

const BLOB_HOST = "https://example.blob.vercel-storage.com/";

interface FakeBlob {
  body: string;
  contentType: string;
  etag: string;
  uploadedAt: Date;
}

const store = new Map<string, FakeBlob>();
let clock = Date.parse("2026-01-01T00:00:00.000Z");
let failDeletes = false;
let failConditionalPuts = false;

function pathnameOf(urlOrPathname: string): string {
  return urlOrPathname.replace(BLOB_HOST, "");
}

mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: mock(
    async (
      pathname: string,
      body: string,
      options: { allowOverwrite?: boolean; ifMatch?: string; contentType: string },
    ) => {
      // Yield first so concurrent callers interleave like real network calls.
      await Promise.resolve();
      if (failConditionalPuts && options.ifMatch !== undefined) {
        throw new Error("The conditional request cannot succeed due to a conflicting operation against this resource.");
      }
      const existing = store.get(pathname);
      if (options.ifMatch !== undefined && existing?.etag !== options.ifMatch) {
        throw new BlobPreconditionFailedError();
      }
      if (existing && !options.allowOverwrite) throw new Error("This blob already exists");
      store.set(pathname, { body, contentType: options.contentType, etag: `"${createHash("md5").update(body).digest("hex")}"`, uploadedAt: new Date(clock) });
      return { pathname, url: `${BLOB_HOST}${pathname}` };
    },
  ),
  head: mock(async (urlOrPathname: string) => {
    await Promise.resolve();
    const pathname = pathnameOf(urlOrPathname);
    const blob = store.get(pathname);
    if (!blob) throw new BlobNotFoundError();
    return { pathname, url: `${BLOB_HOST}${pathname}`, contentType: blob.contentType, etag: blob.etag, uploadedAt: blob.uploadedAt };
  }),
  del: mock(async (urls: string | string[]) => {
    if (failDeletes) throw new Error("Blob unavailable");
    for (const url of Array.isArray(urls) ? urls : [urls]) store.delete(pathnameOf(url));
  }),
  list: mock(async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .map(([pathname, blob]) => ({ pathname, url: `${BLOB_HOST}${pathname}`, uploadedAt: blob.uploadedAt })),
    hasMore: false,
  })),
}));

const {
  MAGIC_LINK_TTL_MS,
  SESSION_TTL_MS,
  consumeMagicLink,
  createMagicLink,
  createSession,
  deleteExpiredAuthRecords,
  deleteSession,
  isSessionActive,
} = await import("./auth-store");

afterAll(() => {
  mock.module("@vercel/blob", () => realBlob);
});

const ADMINS = ["alice@example.com", "bob@example.com"];

function at(offsetMs: number): Date {
  return new Date(clock + offsetMs);
}

beforeEach(() => {
  store.clear();
  failDeletes = false;
  failConditionalPuts = false;
});

describe("magic links", () => {
  test("a token signs in exactly once", async () => {
    const token = await createMagicLink("Alice@Example.com");

    expect(await consumeMagicLink(token, ADMINS, at(0))).toBe("alice@example.com");
    expect(await consumeMagicLink(token, ADMINS, at(0))).toBeNull();
  });

  test("stores neither the plaintext token nor the email", async () => {
    const token = await createMagicLink("alice@example.com");

    const dump = JSON.stringify([...store.entries()]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain("alice");
  });

  test("is rejected once 15 minutes have passed since it was stored", async () => {
    const token = await createMagicLink("alice@example.com");

    expect(await consumeMagicLink(token, ADMINS, at(MAGIC_LINK_TTL_MS + 1))).toBeNull();
  });

  test("is accepted right up to the 15-minute mark", async () => {
    const token = await createMagicLink("alice@example.com");

    expect(await consumeMagicLink(token, ADMINS, at(MAGIC_LINK_TTL_MS))).toBe("alice@example.com");
  });

  test("a newer link for the same email invalidates the older one", async () => {
    const first = await createMagicLink("alice@example.com");
    const second = await createMagicLink("alice@example.com");

    expect(await consumeMagicLink(first, ADMINS, at(0))).toBeNull();
    expect(await consumeMagicLink(second, ADMINS, at(0))).toBe("alice@example.com");
  });

  test("a link for another admin is not affected", async () => {
    const alice = await createMagicLink("alice@example.com");
    await createMagicLink("bob@example.com");

    expect(await consumeMagicLink(alice, ADMINS, at(0))).toBe("alice@example.com");
  });

  test("concurrent uses of the same token: exactly one wins", async () => {
    const token = await createMagicLink("alice@example.com");

    const results = await Promise.all(Array.from({ length: 10 }, () => consumeMagicLink(token, ADMINS, at(0))));

    expect(results.filter((r) => r !== null)).toEqual(["alice@example.com"]);
  });

  test("a conflicting-operation error on the consume write rejects instead of throwing", async () => {
    const token = await createMagicLink("alice@example.com");
    failConditionalPuts = true;
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(await consumeMagicLink(token, ADMINS, at(0))).toBeNull();
    } finally {
      console.error = originalError;
    }
  });

  test("a consumed link stays unusable even if deleting it failed", async () => {
    const token = await createMagicLink("alice@example.com");
    failDeletes = true;

    expect(await consumeMagicLink(token, ADMINS, at(0))).toBe("alice@example.com");
    expect(store.size).toBe(1);
    expect(await consumeMagicLink(token, ADMINS, at(0))).toBeNull();
  });

  test("is rejected once the email is no longer an admin", async () => {
    const token = await createMagicLink("alice@example.com");

    expect(await consumeMagicLink(token, ["bob@example.com"], at(0))).toBeNull();
  });

  test("rejects unknown and malformed tokens", async () => {
    await createMagicLink("alice@example.com");

    expect(await consumeMagicLink("A".repeat(43), ADMINS, at(0))).toBeNull();
    expect(await consumeMagicLink("not-a-token", ADMINS, at(0))).toBeNull();
    expect(await consumeMagicLink("", ADMINS, at(0))).toBeNull();
  });
});

describe("sessions", () => {
  test("a new session is active", async () => {
    const sid = await createSession("alice@example.com");

    expect(await isSessionActive("alice@example.com", sid, at(0))).toBe(true);
  });

  test("expires 8 hours after creation", async () => {
    const sid = await createSession("alice@example.com");

    expect(await isSessionActive("alice@example.com", sid, at(SESSION_TTL_MS))).toBe(true);
    expect(await isSessionActive("alice@example.com", sid, at(SESSION_TTL_MS + 1))).toBe(false);
  });

  test("a new sign-in ends the same admin's previous session", async () => {
    const first = await createSession("alice@example.com");
    const second = await createSession("alice@example.com");

    expect(await isSessionActive("alice@example.com", first, at(0))).toBe(false);
    expect(await isSessionActive("alice@example.com", second, at(0))).toBe(true);
  });

  test("another admin's sign-in leaves the session alone", async () => {
    const alice = await createSession("alice@example.com");
    await createSession("bob@example.com");

    expect(await isSessionActive("alice@example.com", alice, at(0))).toBe(true);
  });

  test("a session ID is only valid for the email it was issued to", async () => {
    const sid = await createSession("alice@example.com");

    expect(await isSessionActive("bob@example.com", sid, at(0))).toBe(false);
  });

  test("deleteSession revokes it", async () => {
    const sid = await createSession("alice@example.com");

    await deleteSession("alice@example.com", sid);

    expect(await isSessionActive("alice@example.com", sid, at(0))).toBe(false);
  });

  test("stores neither the session ID nor the email", async () => {
    const sid = await createSession("alice@example.com");

    const dump = JSON.stringify([...store.entries()]);
    expect(dump).not.toContain(sid);
    expect(dump).not.toContain("alice");
  });
});

describe("deleteExpiredAuthRecords", () => {
  test("removes only records past their lifetime", async () => {
    const link = await createMagicLink("alice@example.com");
    const sid = await createSession("bob@example.com");

    expect(await deleteExpiredAuthRecords(at(MAGIC_LINK_TTL_MS + 1))).toBe(1);
    expect(await consumeMagicLink(link, ADMINS, at(0))).toBeNull();
    expect(await isSessionActive("bob@example.com", sid, at(0))).toBe(true);

    expect(await deleteExpiredAuthRecords(at(SESSION_TTL_MS + 1))).toBe(1);
    expect(store.size).toBe(0);
  });
});
