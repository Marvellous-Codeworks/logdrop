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
    for (const blob of page.blobs) blobs.push({ pathname: blob.pathname, url: blob.url });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function findSlugBlob(slug: string, kind: BlobKind): Promise<ListedBlob | null> {
  const blobs = await listAll(slugPrefix(slug));
  return blobs.find((blob) => blobKind(blob.pathname) === kind) ?? null;
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
  const staleMetaUrls = blobs
    .filter((blob) => blob.url !== written.url && blobKind(blob.pathname) === "meta")
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
