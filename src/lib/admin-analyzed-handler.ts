import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { getPasteMeta, updatePasteMeta } from "./storage";

export async function handleAdminAnalyzed(request: Request, secret: string): Promise<Response> {
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { slug?: unknown }).slug !== "string" ||
    typeof (body as { analyzed?: unknown }).analyzed !== "boolean"
  ) {
    return Response.json({ error: "Expected { slug: string, analyzed: boolean }" }, { status: 400 });
  }
  const { slug, analyzed } = body as { slug: string; analyzed: boolean };

  const meta = await getPasteMeta(slug);
  if (!meta) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await updatePasteMeta({ ...meta, analyzed });
  return Response.json({ ok: true });
}
