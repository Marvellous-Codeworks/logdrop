import { consumeMagicLink } from "./auth-store";
import { buildSessionCookie } from "./session";
import { getAdminEmails } from "./admin-allowlist";
import { sanitizeNext } from "./safe-next";
import { footerHtml, pageHead } from "./html-shell";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loginRedirect(error: string, redirectBase: string): Response {
  return Response.redirect(new URL(`/admin/login?error=${error}`, redirectBase).toString(), 302);
}

/**
 * GET /admin/verify: a confirmation page only. Mail security scanners
 * pre-fetch links, so opening the link must not consume the single-use
 * token; the "Sign in" button POSTs it.
 */
export function handleAdminVerifyPage(tokenParam: string | null, redirectBase: string, nextParam: string | null = null): Response {
  if (!tokenParam) return loginRedirect("missing", redirectBase);
  const next = sanitizeNext(nextParam);
  const html = `<!doctype html>
<html lang="en">
<head>
  ${pageHead("Sign in · logdrop")}
</head>
<body>
  <div class="shell">
    <main class="page">
      <div class="card card--centered">
        <h1 style="font-size: var(--text-2xl)">Admin sign-in</h1>
        <p class="lede">This login link works once. Continue to sign in on this browser.</p>
        <form method="post" action="/admin/verify">
          <input type="hidden" name="token" value="${escapeHtml(tokenParam)}">
          ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : ""}
          <button class="btn btn--primary" type="submit" style="width: 100%">Sign in</button>
        </form>
      </div>
    </main>
    ${footerHtml()}
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The token is in this page's URL: never leak it to the font CDN or footer links.
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** POST /admin/verify: consumes the token and starts the session. */
export async function handleAdminVerify(
  tokenParam: string | null,
  secret: string,
  redirectBase: string,
  nextParam: string | null = null,
): Promise<Response> {
  if (!tokenParam) return loginRedirect("missing", redirectBase);

  // Unknown, used, expired, or issued to an email since removed from
  // ADMIN_EMAILS: all get the same "expired" error, so the response reveals
  // neither allow-list membership nor whether the token ever existed.
  const email = await consumeMagicLink(tokenParam, getAdminEmails());
  if (!email) return loginRedirect("expired", redirectBase);

  // Never trust that `next` was validated upstream: re-check it here.
  const target = sanitizeNext(nextParam) ?? "/admin";
  const headers = new Headers();
  headers.set("Location", new URL(target, redirectBase).toString());
  headers.append("Set-Cookie", await buildSessionCookie(email, secret));
  return new Response(null, { status: 302, headers });
}
