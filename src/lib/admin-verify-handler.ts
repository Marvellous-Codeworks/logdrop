import { verifyMagicLinkToken } from "./auth-token";
import { buildSessionCookie } from "./session";
import { getAdminEmails, isAdminEmail } from "./admin-allowlist";
import { sanitizeNext } from "./safe-next";

export function handleAdminVerify(
  tokenParam: string | null,
  secret: string,
  redirectBase: string,
  nextParam: string | null = null,
): Response {
  if (!tokenParam) {
    return Response.redirect(new URL("/admin/login?error=missing", redirectBase).toString(), 302);
  }

  const payload = verifyMagicLinkToken(tokenParam, secret);
  // An email removed from ADMIN_EMAILS after the link was issued gets the
  // same "expired" error as a bad token, so the response doesn't reveal
  // allow-list membership.
  if (!payload || !isAdminEmail(payload.email, getAdminEmails())) {
    return Response.redirect(new URL("/admin/login?error=expired", redirectBase).toString(), 302);
  }

  // Never trust that `next` was validated upstream: re-check it here.
  const target = sanitizeNext(nextParam) ?? "/admin";
  const headers = new Headers();
  headers.set("Location", new URL(target, redirectBase).toString());
  headers.append("Set-Cookie", buildSessionCookie(payload.email, secret));
  return new Response(null, { status: 302, headers });
}
