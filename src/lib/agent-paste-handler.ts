import { getAdminEmails, isAdminEmail } from "./admin-allowlist";
import { findAgentToken, INSTANCE_TOKEN_ACTOR, safeEqual, touchAgentToken } from "./agent-tokens";
import { getPasteContent, getPasteMeta, updatePasteMeta } from "./storage";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * Resolves the bearer token to the actor it belongs to: an admin email for a
 * per-admin token whose owner is still in ADMIN_EMAILS, INSTANCE_TOKEN_ACTOR
 * for the legacy token, or null if it's not valid.
 */
async function resolveActor(token: string, legacySecret: string | undefined): Promise<string | null> {
  if (legacySecret && safeEqual(token, legacySecret)) return INSTANCE_TOKEN_ACTOR;
  const record = await findAgentToken(token);
  if (!record || !isAdminEmail(record.email, getAdminEmails())) return null;
  return record.email;
}

export async function handleAgentPasteRead(
  request: Request,
  slug: string,
  legacySecret: string | undefined,
): Promise<Response> {
  const token = bearerToken(request);
  const actor = token ? await resolveActor(token, legacySecret) : null;
  if (!token || !actor) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [content, meta] = await Promise.all([getPasteContent(slug), getPasteMeta(slug)]);
  if (content === null || meta === null) {
    return new Response("Not found", { status: 404 });
  }
  if (new Date(meta.expiresAt).getTime() <= Date.now()) {
    return new Response("Not found", { status: 404 });
  }

  // Record the agent read so admins can see it in the dashboard and log view.
  // Best-effort: a failed write must not stop the agent from getting the log.
  // Concurrent reads can lose an increment, which is acceptable here.
  const now = new Date();
  const updatedMeta = {
    ...meta,
    agentAccessCount: (meta.agentAccessCount ?? 0) + 1,
    agentLastAccessAt: now.toISOString(),
    agentLastAccessBy: actor,
  };
  const tracking: Promise<void>[] = [updatePasteMeta(updatedMeta)];
  if (actor !== INSTANCE_TOKEN_ACTOR) tracking.push(touchAgentToken(token, now));
  for (const result of await Promise.allSettled(tracking)) {
    if (result.status === "rejected") console.error("Failed to record agent access", slug, result.reason);
  }

  // Redact sensitive fields from meta before returning to agent
  const { uploaderIp, uploaderCountry, userAgent, analyzedBy, agentLastAccessBy, ...safeMetaFields } = updatedMeta;

  return Response.json({ slug, content, meta: safeMetaFields });
}
