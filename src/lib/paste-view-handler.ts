import { getSessionEmail } from "./session";
import { getPasteContent, getPasteMeta } from "./storage";

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
  const email = getSessionEmail(request, secret);
  if (!email) {
    const next = encodeURIComponent(url.pathname);
    return Response.redirect(new URL(`/admin/login?next=${next}`, url.origin).toString(), 302);
  }

  const [content, meta] = await Promise.all([getPasteContent(slug), getPasteMeta(slug)]);
  if (content === null || meta === null) {
    return new Response("Not found", { status: 404 });
  }

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>logdrop — ${escapeHtml(slug)}</title></head>
<body style="font-family: monospace; max-width: 60rem; margin: 2rem auto; padding: 0 1rem;">
  <p>Uploaded ${escapeHtml(meta.createdAt)} — expires ${escapeHtml(meta.expiresAt)}${meta.label ? ` — ${escapeHtml(meta.label)}` : ""}</p>
  <pre id="paste-content" style="white-space: pre-wrap; word-break: break-word; border: 1px solid #ccc; padding: 1rem;">${escapeHtml(content)}</pre>
  <button id="download-btn">Download as .txt</button>
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
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
