import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { listPastes } from "./storage";
import { pageHead, navHtml, footerHtml, issueNumberFromUrl } from "./html-shell";

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
        <td class="col-slug"><a href="/r/${escapeHtml(p.slug)}">${escapeHtml(p.slug)}</a></td>
        <td>${escapeHtml(p.createdAt)}</td>
        <td>${escapeHtml(p.expiresAt)}</td>
        <td class="tabular">${escapeHtml(String(p.sizeBytes))}</td>
        <td>${escapeHtml(p.uploaderCountry ?? "")}</td>
        <td class="col-label">${escapeHtml(p.label ?? "")}</td>
        <td>${
          p.issueUrl
            ? `<a class="chip chip--link" href="${escapeHtml(p.issueUrl)}">${escapeHtml(issueNumberFromUrl(p.issueUrl))}</a>`
            : ""
        }</td>
        <td><form class="inline" method="POST" action="/api/admin/delete"><input type="hidden" name="slug" value="${escapeHtml(p.slug)}" /><button class="btn btn--danger" type="submit">Delete</button></form></td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>${pageHead("logdrop — admin")}</head>
<body>
  <div class="shell">
    ${navHtml(false)}
    <main class="page page--wide">
      <h1>Admin</h1>
      <p class="lede">Signed in as ${escapeHtml(email)}.</p>
      ${
        pastes.length === 0
          ? `<p class="lede">No uploads yet.</p>`
          : `<div class="table-wrap">
        <table class="pastes">
          <thead><tr><th>Slug</th><th>Created</th><th>Expires</th><th>Bytes</th><th>Country</th><th>Label</th><th>Issue</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
      }
    </main>
    ${footerHtml()}
  </div>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
