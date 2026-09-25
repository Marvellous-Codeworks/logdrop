import { put, list, del } from "@vercel/blob";
import type { PasteMeta } from "./paste-types";

// Vercel Blob (v1.x) only supports `access: "public"`, so every blob is
// reachable by anyone who knows its URL. To keep uploads readable only
// through the auth-gated /r/<slug> route, blobs are written with a random
// suffix so their CDN URL cannot be derived from the slug. Lookups therefore
// go through `list()` (authenticated with BLOB_READ_WRITE_TOKEN) under the
// slug's prefix instead of constructing an exact pathname.
//
// Vercel Blob inserts the random suffix before the extension (e.g.
// `meta.json` -> `meta-<rand>.json`), so blobs are classified by the leading
// name of their last path segment rather than by an exact suffix match.

// Minimum value Vercel Blob accepts (1 minute; the default is one month).
// Keeps deleted/expired content from lingering in the CDN cache.
const CACHE_CONTROL_MAX_AGE_SECONDS = 60;

type BlobKind = "content" | "meta";

interface ListedBlob {
  pathname: string;
  url: string;
  uploadedAt: Date;
}

function slugPrefix(slug: string): string {
  return `uploads/${slug}/`;
}

function blobKind(pathname: string): BlobKind | null {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const match = /^(content|meta)(?:[-.].*)?$/.exec(lastSegment);
  return match ? (match[1] as BlobKind) : null;
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

async function findSlugBlob(slug: string, kind: BlobKind): Promise<ListedBlob | null> {
  const blobs = await listAll(slugPrefix(slug));
  const matches = blobs.filter((blob) => blobKind(blob.pathname) === kind);
  if (matches.length === 0) return null;
  // Duplicates can exist transiently (e.g. mid-cleanup right after a racing
  // updatePasteMeta write). Prefer the newest so reads see the most recently
  // written blob instead of whichever one `list()` happens to return first.
  matches.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  return matches[0];
}

export async function savePaste(input: {
  slug: string;
  content: string;
  meta: Omit<PasteMeta, "slug">;
}): Promise<void> {
  const meta: PasteMeta = { slug: input.slug, ...input.meta };
  await put(`${slugPrefix(input.slug)}content`, input.content, {
    access: "public",
    addRandomSuffix: true,
    cacheControlMaxAge: CACHE_CONTROL_MAX_AGE_SECONDS,
    contentType: "text/plain; charset=utf-8",
  });
  await put(`${slugPrefix(input.slug)}meta.json`, JSON.stringify(meta), {
    access: "public",
    addRandomSuffix: true,
    cacheControlMaxAge: CACHE_CONTROL_MAX_AGE_SECONDS,
    contentType: "application/json",
  });
}

export async function updatePasteMeta(meta: PasteMeta): Promise<void> {
  // Write the new meta blob FIRST, then clean up any other meta blob(s) for
  // this slug. This ordering means a failure partway through never leaves
  // the paste without a readable meta blob: either the write fails (old meta
  // is still intact) or the write succeeds and cleanup fails (both old and
  // new meta exist briefly, self-healing on the next write). The previous
  // delete-then-write order could drop the paste's meta entirely if `put`
  // failed after `del` succeeded.
  const written = await put(`${slugPrefix(meta.slug)}meta.json`, JSON.stringify(meta), {
    access: "public",
    addRandomSuffix: true,
    cacheControlMaxAge: CACHE_CONTROL_MAX_AGE_SECONDS,
    contentType: "application/json",
  });
  const blobs = await listAll(slugPrefix(meta.slug));
  // `put()` doesn't return an upload timestamp, so recover our own write's
  // server-recorded `uploadedAt` from the list results (falling back to the
  // current time if it's somehow missing) and delete only meta blobs
  // strictly OLDER than that. This makes cleanup last-write-wins: if a
  // second `updatePasteMeta` call races on the same slug and its write
  // lands later, its blob's `uploadedAt` is newer than ours, so we leave it
  // alone — and it will delete ours in turn. Without this, two racing
  // writers could each delete the other's brand-new meta blob (since both
  // "not my own url" checks are true for the other's blob), leaving the
  // slug with no meta blob at all — worse than the stale duplicate this
  // cleanup step exists to avoid.
  const ownUploadedAt = (blobs.find((blob) => blob.url === written.url)?.uploadedAt ?? new Date()).getTime();
  const staleMetaUrls = blobs
    .filter((blob) => {
      if (blob.url === written.url || blobKind(blob.pathname) !== "meta") return false;
      const otherUploadedAt = blob.uploadedAt.getTime();
      if (otherUploadedAt !== ownUploadedAt) return otherUploadedAt < ownUploadedAt;
      // Equal timestamps are unlikely — Vercel Blob's `uploadedAt` carries
      // millisecond precision, and both writes still had to make a network
      // round trip — but not impossible for near-simultaneous writes.
      // Compare URLs so both racing calls agree on exactly one survivor
      // instead of each seeing itself as "not older" and keeping both.
      return blob.url < written.url;
    })
    .map((blob) => blob.url);
  if (staleMetaUrls.length > 0) await del(staleMetaUrls);
}

export async function getPasteContent(slug: string): Promise<string | null> {
  try {
    const blob = await findSlugBlob(slug, "content");
    if (!blob) return null;
    const res = await fetch(blob.url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function getPasteMeta(slug: string): Promise<PasteMeta | null> {
  try {
    const blob = await findSlugBlob(slug, "meta");
    if (!blob) return null;
    const res = await fetch(blob.url);
    if (!res.ok) return null;
    // Normalize `analyzed` for meta blobs written before this field existed;
    // without this, old pastes come back with `analyzed: undefined` despite
    // the type claiming `boolean`.
    const raw = (await res.json()) as PasteMeta;
    return { ...raw, analyzed: raw.analyzed === true };
  } catch {
    return null;
  }
}

export async function deletePaste(slug: string): Promise<void> {
  // Removes every blob under the slug's prefix (content and meta).
  const blobs = await listAll(slugPrefix(slug));
  if (blobs.length === 0) return;
  await del(blobs.map((blob) => blob.url));
}

export async function listPastes(): Promise<PasteMeta[]> {
  const metas: PasteMeta[] = [];
  for (const blob of await listAll("uploads/")) {
    if (blobKind(blob.pathname) !== "meta") continue;
    const res = await fetch(blob.url);
    if (!res.ok) continue;
    // Same legacy-field normalization as getPasteMeta above.
    const raw = (await res.json()) as PasteMeta;
    metas.push({ ...raw, analyzed: raw.analyzed === true });
  }
  return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteExpiredPastes(now: Date): Promise<string[]> {
  const metas = await listPastes();
  const expiredSlugs = metas
    .filter((meta) => new Date(meta.expiresAt).getTime() <= now.getTime())
    .map((meta) => meta.slug);
  for (const slug of expiredSlugs) {
    await deletePaste(slug);
  }
  return expiredSlugs;
}
