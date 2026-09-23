import { verifyMagicLinkToken } from "./auth-token";
import { buildSessionCookie } from "./session";

export function handleAdminVerify(
  tokenParam: string | null,
  secret: string,
  redirectBase: string,
): Response {
  if (!tokenParam) {
    return Response.redirect(new URL("/admin/login?error=missing", redirectBase).toString(), 302);
  }

  const payload = verifyMagicLinkToken(tokenParam, secret);
  if (!payload) {
    return Response.redirect(new URL("/admin/login?error=expired", redirectBase).toString(), 302);
  }

  const headers = new Headers();
  headers.set("Location", new URL("/admin", redirectBase).toString());
  headers.append("Set-Cookie", buildSessionCookie(payload.email, secret));
  return new Response(null, { status: 302, headers });
}
