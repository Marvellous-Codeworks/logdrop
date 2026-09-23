import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { listPastes } from "./storage";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handleAdminDashboard(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    return Response.redirect(new URL("/admin/login?next=/admin", url.origin).toString(), 302);
  }

  const pastes = await listPastes();
  const rows = pastes
    .map(
      (p) => `<tr>
        <td><a href="/r/${escapeHtml(p.slug)}">${escapeHtml(p.slug)}</a></td>
        <td>${escapeHtml(p.createdAt)}</td>
        <td>${escapeHtml(p.expiresAt)}</td>
        <td>${escapeHtml(String(p.sizeBytes))}</td>
        <td>${escapeHtml(p.uploaderCountry ?? "")}</td>
        <td>${escapeHtml(p.label ?? "")}</td>
        <td><form method="POST" action="/api/admin/delete"><input type="hidden" name="slug" value="${escapeHtml(p.slug)}" /><button type="submit">Delete</button></form></td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>logdrop admin</title></head>
<body style="font-family: sans-serif; max-width: 72rem; margin: 2rem auto; padding: 0 1rem;">
  <h1>logdrop — ${escapeHtml(email)}</h1>
  <table border="1" cellpadding="6" style="border-collapse: collapse; width: 100%;">
    <thead><tr><th>Slug</th><th>Created</th><th>Expires</th><th>Bytes</th><th>Country</th><th>Label</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
