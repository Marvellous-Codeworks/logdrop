import { signSessionToken, verifySessionToken } from "./auth-token";

export const SESSION_COOKIE_NAME = "logdrop_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function getSessionEmail(request: Request, secret: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token, secret)?.email ?? null;
}

export function buildSessionCookie(email: string, secret: string): string {
  const token = signSessionToken(email, secret);
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch (err) {
      // If decoding fails (malformed percent-escape), use raw value
      out[key] = value;
    }
  }
  return out;
}
