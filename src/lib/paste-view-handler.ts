import { getAdminEmails } from "./admin-allowlist";
import { getSessionEmail } from "./session";
import { getPasteContent, getPasteMeta } from "./storage";
import { pageHead, navHtml, footerHtml, issueNumberFromUrl } from "./html-shell";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handlePasteView(
  request: Request,
  slug: string,
  secret: string,
): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret, getAdminEmails());
  if (!email) {
    const next = encodeURIComponent(url.pathname);
    return Response.redirect(new URL(`/admin/login?next=${next}`, url.origin).toString(), 302);
  }

  const [content, meta] = await Promise.all([getPasteContent(slug), getPasteMeta(slug)]);
  if (content === null || meta === null) {
    return new Response("Not found", { status: 404 });
  }

  const html = `<!doctype html>
<html lang="en">
<head>${pageHead(`logdrop — ${escapeHtml(slug)}`)}</head>
<body>
  <div class="shell">
    ${navHtml(true)}
    <main class="page page--wide">
      <p class="lede">
        Uploaded ${escapeHtml(meta.createdAt)} · expires ${escapeHtml(meta.expiresAt)}
        ${meta.label ? ` · ${escapeHtml(meta.label)}` : ""}
        ${
          meta.issueUrl
            ? ` · <a class="chip chip--link" href="${escapeHtml(meta.issueUrl)}">${escapeHtml(issueNumberFromUrl(meta.issueUrl))}</a>`
            : ""
        }
      </p>
      <div class="code-card">
        <div class="code-card__bar">
          <span class="code-card__label">${escapeHtml(slug)}</span>
          <button class="btn btn--secondary copy-btn" type="button" id="copy-btn" style="height: 1.75rem; padding: 0 var(--space-sm); font-size: var(--text-xs);">
            <span class="copy-btn__default">Copy</span>
          </button>
        </div>
        <pre id="paste-content" class="code-card__body">${escapeHtml(content)}</pre>
      </div>
      <p style="margin-top: var(--space-md);">
        <button class="btn btn--secondary" id="download-btn" type="button">Download as .txt</button>
      </p>
    </main>
    ${footerHtml()}
  </div>
  <script>
    document.getElementById("download-btn").addEventListener("click", () => {
      const text = document.getElementById("paste-content").textContent;
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logdrop-${slug}.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById("copy-btn").addEventListener("click", async (e) => {
      const text = document.getElementById("paste-content").textContent;
      await navigator.clipboard.writeText(text);
      const btn = e.currentTarget;
      btn.dataset.state = "copied";
      setTimeout(() => { delete btn.dataset.state; }, 2500);
    });
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
