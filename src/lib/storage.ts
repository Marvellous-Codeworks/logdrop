import { put, list, del, head } from "@vercel/blob";
import type { PasteMeta } from "./paste-types";

function contentPath(slug: string): string {
  return `uploads/${slug}/content`;
}

function metaPath(slug: string): string {
  return `uploads/${slug}/meta.json`;
}

export async function savePaste(input: {
  slug: string;
  content: string;
  meta: Omit<PasteMeta, "slug">;
}): Promise<void> {
  const meta: PasteMeta = { slug: input.slug, ...input.meta };
  await put(contentPath(input.slug), input.content, {
    access: "public",
    addRandomSuffix: false,
    contentType: "text/plain; charset=utf-8",
  });
  await put(metaPath(input.slug), JSON.stringify(meta), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function getPasteContent(slug: string): Promise<string | null> {
  try {
    const blob = await head(contentPath(slug));
    const res = await fetch(blob.url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function getPasteMeta(slug: string): Promise<PasteMeta | null> {
  try {
    const blob = await head(metaPath(slug));
    const res = await fetch(blob.url);
    return res.ok ? ((await res.json()) as PasteMeta) : null;
  } catch {
    return null;
  }
}

export async function deletePaste(slug: string): Promise<void> {
  await del([contentPath(slug), metaPath(slug)]);
}

export async function listPastes(): Promise<PasteMeta[]> {
  const metas: PasteMeta[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "uploads/", cursor });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith("/meta.json")) continue;
      const res = await fetch(blob.url);
      if (!res.ok) continue;
      metas.push((await res.json()) as PasteMeta);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
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
