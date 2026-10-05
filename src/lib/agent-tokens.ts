import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { put, list, del } from "@vercel/blob";

// Per-admin agent API tokens. Each admin has at most one token; only its
// SHA-256 hash is stored, as the blob path, so the agent endpoint can look a
// token up with a single prefix `list()` and a leaked Blob store exposes no
// usable token. The plaintext is returned once, at generation.
//
// Layout, per token: `agent-tokens/<hash>/record.json` (owner, creation) and
// `agent-tokens/<hash>/used.json` (last use). Last use lives in its own blob
// so recording a read never rewrites the record: a read racing a revoke
// can't bring a revoked token back.
//
// Blobs are public with a random suffix (see storage.ts), so their URLs
// can't be derived from the hash; lookups go through the authenticated
// `list()`.

const PREFIX = "agent-tokens/";
export const AGENT_TOKEN_PREFIX = "ld_agent_";
// Who an agent read is attributed to when it used the legacy, instance-wide
// AGENT_API_TOKEN instead of a per-admin token.
export const INSTANCE_TOKEN_ACTOR = "instance";
const CACHE_CONTROL_MAX_AGE_SECONDS = 60;

export interface AgentTokenRecord {
  email: string;
  createdAt: string; // ISO 8601
  lastUsedAt: string | null; // ISO 8601
  hint: string; // last characters of the token, for display only
}

type BlobKind = "record" | "used";

interface TokenBlob {
  hash: string;
  kind: BlobKind;
  url: string;
  uploadedAt: Date;
}

export function generateAgentToken(): string {
  return AGENT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function maskAgentToken(hint: string): string {
  return `${AGENT_TOKEN_PREFIX}…${hint}`;
}

/** Constant-time string comparison, for the legacy instance-wide token. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePathname(pathname: string): { hash: string; kind: BlobKind } | null {
  // Vercel Blob inserts the random suffix before the extension
  // (`record.json` -> `record-<rand>.json`).
  const match = /^agent-tokens\/([0-9a-f]{64})\/(record|used)(?:[-.].*)?$/.exec(pathname);
  return match ? { hash: match[1], kind: match[2] as BlobKind } : null;
}

async function listTokenBlobs(prefix: string): Promise<TokenBlob[]> {
  const out: TokenBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    for (const blob of page.blobs) {
      const parsed = parsePathname(blob.pathname);
      if (parsed) out.push({ ...parsed, url: blob.url, uploadedAt: blob.uploadedAt });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function newest(blobs: TokenBlob[], kind: BlobKind): TokenBlob | null {
  const matches = blobs.filter((b) => b.kind === kind);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  return matches[0];
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  return res.ok ? ((await res.json()) as T) : null;
}

async function writeJson(pathname: string, value: unknown): Promise<string> {
  const written = await put(pathname, JSON.stringify(value), {
    access: "public",
    addRandomSuffix: true,
    cacheControlMaxAge: CACHE_CONTROL_MAX_AGE_SECONDS,
    contentType: "application/json",
  });
  return written.url;
}

/** Reads one token from its blobs, or null if it has no record. */
async function readToken(blobs: TokenBlob[]): Promise<AgentTokenRecord | null> {
  const recordBlob = newest(blobs, "record");
  if (!recordBlob) return null;
  const record = await fetchJson<Omit<AgentTokenRecord, "lastUsedAt">>(recordBlob.url);
  if (!record) return null;
  const usedBlob = newest(blobs, "used");
  const used = usedBlob ? await fetchJson<{ lastUsedAt: string }>(usedBlob.url) : null;
  return { ...record, lastUsedAt: used?.lastUsedAt ?? null };
}

function groupByHash(blobs: TokenBlob[]): Map<string, TokenBlob[]> {
  const groups = new Map<string, TokenBlob[]>();
  for (const blob of blobs) {
    const group = groups.get(blob.hash) ?? [];
    group.push(blob);
    groups.set(blob.hash, group);
  }
  return groups;
}

/** Every blob belonging to `email`'s token(s). */
async function blobsFor(email: string): Promise<{ blobs: TokenBlob[]; record: AgentTokenRecord | null }> {
  const normalized = email.trim().toLowerCase();
  const owned: TokenBlob[] = [];
  let latest: { record: AgentTokenRecord; at: number } | null = null;
  for (const group of groupByHash(await listTokenBlobs(PREFIX)).values()) {
    const record = await readToken(group);
    if (!record || record.email !== normalized) continue;
    owned.push(...group);
    const at = newest(group, "record")!.uploadedAt.getTime();
    if (!latest || at > latest.at) latest = { record, at };
  }
  return { blobs: owned, record: latest?.record ?? null };
}

export async function getAgentTokenRecordFor(email: string): Promise<AgentTokenRecord | null> {
  return (await blobsFor(email)).record;
}

/** Creates a new token for `email`, replacing (and invalidating) any previous one. */
export async function createAgentTokenFor(
  email: string,
): Promise<{ token: string; record: AgentTokenRecord }> {
  const previous = await blobsFor(email);
  const token = generateAgentToken();
  const record: AgentTokenRecord = {
    email: email.trim().toLowerCase(),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    hint: token.slice(-4),
  };
  const { lastUsedAt: _, ...stored } = record;
  // Write the new record before deleting the old one, so a failure partway
  // through never leaves the admin without a working token.
  await writeJson(`${PREFIX}${hashAgentToken(token)}/record.json`, stored);
  if (previous.blobs.length > 0) await del(previous.blobs.map((b) => b.url));
  return { token, record };
}

export async function revokeAgentTokenFor(email: string): Promise<boolean> {
  const { blobs } = await blobsFor(email);
  if (blobs.length === 0) return false;
  await del(blobs.map((b) => b.url));
  return true;
}

/** Resolves a plaintext token to its record, or null if it doesn't exist. */
export async function findAgentToken(token: string): Promise<AgentTokenRecord | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const hash = hashAgentToken(token);
  const blobs = (await listTokenBlobs(`${PREFIX}${hash}/`)).filter((b) => b.hash === hash);
  return readToken(blobs);
}

/** Records a use of the token. Best-effort: callers should catch and ignore errors. */
export async function touchAgentToken(token: string, usedAt: Date): Promise<void> {
  const hash = hashAgentToken(token);
  const prefix = `${PREFIX}${hash}/`;
  const ownUrl = await writeJson(`${prefix}used.json`, { lastUsedAt: usedAt.toISOString() });
  const blobs = await listTokenBlobs(prefix);
  if (!newest(blobs, "record")) {
    // Revoked or rotated meanwhile: don't leave an orphan behind.
    await del([ownUrl, ...blobs.map((b) => b.url).filter((url) => url !== ownUrl)]);
    return;
  }
  // Last write wins, as in storage.ts: drop only `used` blobs older than ours.
  const ownAt = (blobs.find((b) => b.url === ownUrl)?.uploadedAt ?? usedAt).getTime();
  const stale = blobs.filter((b) => b.kind === "used" && b.url !== ownUrl && b.uploadedAt.getTime() < ownAt);
  if (stale.length > 0) await del(stale.map((b) => b.url));
}
