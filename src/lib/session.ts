import { signSessionToken, verifySessionToken, type SessionPayload } from "./auth-token";
import { isAdminEmail } from "./admin-allowlist";
import { createSession, deleteSession, isSessionActive } from "./auth-store";

export const SESSION_COOKIE_NAME = "logdrop_session";

function readSessionCookie(request: Request, secret: string): SessionPayload | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  return token ? verifySessionToken(token, secret) : null;
}

// `adminEmails` is re-checked on every request, so removing an address from
// ADMIN_EMAILS revokes that admin's existing session immediately instead of
// only once it expires. The server-side record is checked too, so a session
// ends on logout, on a newer sign-in by the same admin, or after 8 hours,
// whatever the browser does with the cookie.
export async function getSessionEmail(
  request: Request,
  secret: string,
  adminEmails: readonly string[],
): Promise<string | null> {
  const payload = readSessionCookie(request, secret);
  if (!payload || !isAdminEmail(payload.email, adminEmails)) return null;
  return (await isSessionActive(payload.email, payload.sid)) ? payload.email : null;
}

/** Starts a server-side session (ending the admin's previous one) and returns its cookie. */
export async function buildSessionCookie(email: string, secret: string): Promise<string> {
  const sid = await createSession(email);
  const token = signSessionToken(email, sid, secret);
  // No Max-Age/Expires: a browser session cookie. The 8-hour limit is enforced server-side.
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

/** Ends the session the request carries, if any. */
export async function endSession(request: Request, secret: string): Promise<void> {
  const payload = readSessionCookie(request, secret);
  if (payload) await deleteSession(payload.email, payload.sid);
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
