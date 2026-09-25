import { getPasteContent, getPasteMeta } from "./storage";

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

  // Redact sensitive fields from meta before returning to agent
  const { uploaderIp, uploaderCountry, userAgent, ...safeMetaFields } = meta;

  return Response.json({ slug, content, meta: safeMetaFields });
}
