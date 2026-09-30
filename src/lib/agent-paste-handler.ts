import { getPasteContent, getPasteMeta, updatePasteMeta } from "./storage";

export async function handleAgentPasteRead(
  request: Request,
  slug: string,
  secret: string,
): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
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
  const updatedMeta = {
    ...meta,
    agentAccessCount: (meta.agentAccessCount ?? 0) + 1,
    agentLastAccessAt: new Date().toISOString(),
  };
  try {
    await updatePasteMeta(updatedMeta);
  } catch (err) {
    console.error("Failed to record agent access", slug, err);
  }

  // Redact sensitive fields from meta before returning to agent
  const { uploaderIp, uploaderCountry, userAgent, analyzedBy, ...safeMetaFields } = updatedMeta;

  return Response.json({ slug, content, meta: safeMetaFields });
}
