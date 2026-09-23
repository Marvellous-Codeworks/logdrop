import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { deletePaste } from "./storage";

export async function handleAdminDeleteBulk(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    return Response.redirect(new URL("/admin/login?next=/admin", url.origin).toString(), 302);
  }

  const formData = await request.formData();
  const slugs = formData
    .getAll("selected")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (slugs.length === 0) {
    return new Response("No uploads selected", { status: 400 });
  }

  await Promise.all(slugs.map((slug) => deletePaste(slug)));
  return Response.redirect(new URL("/admin", url.origin).toString(), 302);
}
