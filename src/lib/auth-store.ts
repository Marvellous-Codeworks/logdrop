import { createHash, randomBytes } from "node:crypto";
import { BlobNotFoundError, BlobPreconditionFailedError, del, head, list, put } from "@vercel/blob";

// Server-side state for admin sign-in: single-use magic links and
// browser-bound sessions. Only SHA-256 hashes are stored, never a plaintext
// token or an email address.
//
// Layout (fixed pathnames, no random suffix):
//   auth/magic-links/<emailHash>/<tokenHash>.json
//   auth/sessions/<emailHash>/<sessionIdHash>.json
//
// Every pathname contains a hash of a 256-bit random secret, so on the
// public store its URL can't be guessed. State is read only through the
// Blob API (`list()` / `head()`), never by fetching the blob URL: public
// blob content is CDN-cached and can be up to 60 s stale after a change.
// The creation time is the blob's server-recorded `uploadedAt`; no expiry
// is stored, so a TTL change applies to records already issued.

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const MAGIC_PREFIX = "auth/magic-links/";
const SESSION_PREFIX = "auth/sessions/";
const PENDING_TYPE = "application/json";
// A consumed link is flagged by its content type, which `head()` reports
// from the API: a request racing the consume sees the flag and is rejected.
const CONSUMED_TYPE = "application/x-logdrop-consumed";
const CACHE_CONTROL_MAX_AGE_SECONDS = 60;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

interface ListedBlob {
  pathname: string;
  url: string;
  uploadedAt: Date;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emailHash(email: string): string {
  return sha256(email.trim().toLowerCase());
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

async function listAll(prefix: string): Promise<ListedBlob[]> {
  const blobs: ListedBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    for (const blob of page.blobs) {
      blobs.push({ pathname: blob.pathname, url: blob.url, uploadedAt: blob.uploadedAt });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function headOrNull(urlOrPathname: string) {
  try {
    return await head(urlOrPathname);
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

async function writeRecord(pathname: string): Promise<string> {
  const written = await put(pathname, "{}", {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: CACHE_CONTROL_MAX_AGE_SECONDS,
    contentType: PENDING_TYPE,
  });
  return written.url;
}

/** Writes a new record, then deletes every other record under `prefix`. */
async function replaceRecords(prefix: string, pathname: string): Promise<void> {
  // New record first, so a failure partway through never deletes the old
  // one without a replacement. Two racing writers may delete each other's
  // record; that fails closed (the admin requests a new link or signs in again).
  const ownUrl = await writeRecord(pathname);
  const others = (await listAll(prefix)).filter((b) => b.url !== ownUrl).map((b) => b.url);
  if (others.length > 0) await del(others);
}

function isExpired(uploadedAt: Date, ttlMs: number, now: Date): boolean {
  return now.getTime() - uploadedAt.getTime() > ttlMs;
}

/** Issues a magic-link token for `email`, invalidating any pending one. */
export async function createMagicLink(email: string): Promise<string> {
  const token = newSecret();
  const prefix = `${MAGIC_PREFIX}${emailHash(email)}/`;
  await replaceRecords(prefix, `${prefix}${sha256(token)}.json`);
  return token;
}

/**
 * Consumes a magic-link token: returns the admin email it was issued for if
 * the token exists, is younger than 15 minutes and was never used, else null.
 * `adminEmails` maps the stored email hash back to an address, so an email
 * removed from the allow-list can't sign in either.
 */
export async function consumeMagicLink(
  token: string,
  adminEmails: readonly string[],
  now = new Date(),
): Promise<string | null> {
  if (!SECRET_RE.test(token)) return null;
  const suffix = `/${sha256(token)}.json`;
  const found = (await listAll(MAGIC_PREFIX)).find((b) => b.pathname.endsWith(suffix));
  if (!found) return null;

  const meta = await headOrNull(found.url);
  if (!meta || meta.contentType !== PENDING_TYPE || isExpired(meta.uploadedAt, MAGIC_LINK_TTL_MS, now)) {
    return null;
  }
  const ownerHash = found.pathname.slice(MAGIC_PREFIX.length, MAGIC_PREFIX.length + 64);
  const email = adminEmails.find((e) => emailHash(e) === ownerHash);
  if (!email) return null;

  // Compare-and-swap on the ETag read above: of concurrent consumers only
  // one write can match it. Vercel Blob's ETag is the MD5 of the content, so
  // the body must be unique or the write wouldn't change the ETag and every
  // racer would pass. Any failure (precondition, "conflicting operation",
  // an SDK retry of our own successful write) rejects: never sign in on doubt.
  try {
    await put(found.pathname, JSON.stringify({ consumed: newSecret() }), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      ifMatch: meta.etag,
      cacheControlMaxAge: CACHE_CONTROL_MAX_AGE_SECONDS,
      contentType: CONSUMED_TYPE,
    });
  } catch (err) {
    if (!(err instanceof BlobPreconditionFailedError)) console.error("Magic-link consume failed", err);
    return null;
  }
  // Best-effort: the consumed flag already blocks reuse; cron cleans up leftovers.
  await del(found.url).catch(() => undefined);
  return email.trim().toLowerCase();
}

/** Starts a new session for `email`, ending its previous one. Returns the session ID. */
export async function createSession(email: string): Promise<string> {
  const sessionId = newSecret();
  const prefix = `${SESSION_PREFIX}${emailHash(email)}/`;
  await replaceRecords(prefix, `${prefix}${sha256(sessionId)}.json`);
  return sessionId;
}

function sessionPathname(email: string, sessionId: string): string {
  return `${SESSION_PREFIX}${emailHash(email)}/${sha256(sessionId)}.json`;
}

/** True if the session exists and is younger than 8 hours. */
export async function isSessionActive(email: string, sessionId: string, now = new Date()): Promise<boolean> {
  if (!SECRET_RE.test(sessionId)) return false;
  const meta = await headOrNull(sessionPathname(email, sessionId));
  return meta !== null && !isExpired(meta.uploadedAt, SESSION_TTL_MS, now);
}

export async function deleteSession(email: string, sessionId: string): Promise<void> {
  if (!SECRET_RE.test(sessionId)) return;
  const meta = await headOrNull(sessionPathname(email, sessionId));
  if (meta) await del(meta.url);
}

/** Deletes magic links and sessions past their lifetime. Returns how many. */
export async function deleteExpiredAuthRecords(now: Date): Promise<number> {
  const expired = [
    ...(await listAll(MAGIC_PREFIX)).filter((b) => isExpired(b.uploadedAt, MAGIC_LINK_TTL_MS, now)),
    ...(await listAll(SESSION_PREFIX)).filter((b) => isExpired(b.uploadedAt, SESSION_TTL_MS, now)),
  ];
  if (expired.length > 0) await del(expired.map((b) => b.url));
  return expired.length;
}
