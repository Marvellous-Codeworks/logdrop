import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { deletePaste } from "./storage";

export async function handleAdminDelete(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    return Response.redirect(new URL("/admin/login?next=/admin", url.origin).toString(), 302);
  }

  const formData = await request.formData();
  const slug = formData.get("slug");
  if (typeof slug !== "string" || slug.length === 0) {
    return new Response("Missing slug", { status: 400 });
  }

  await deletePaste(slug);
  return Response.redirect(new URL("/admin", url.origin).toString(), 302);
}
