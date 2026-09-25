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

  return Response.json({ slug, content, meta });
}
