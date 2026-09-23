import { signMagicLinkToken } from "./auth-token";
import { sendMagicLinkEmail } from "./mail";
import { getAdminEmails, isAdminEmail } from "./admin-allowlist";
import { sanitizeNext } from "./safe-next";

export async function handleAdminLoginRequest(email: string, next?: string): Promise<{ ok: true }> {
  const secret = process.env.TOKEN_SECRET;
  const siteUrl = process.env.SITE_URL;
  if (!secret || !siteUrl) throw new Error("Server misconfigured");

  const normalizedEmail = email.trim().toLowerCase();
  if (isAdminEmail(normalizedEmail, getAdminEmails())) {
    const token = signMagicLinkToken(normalizedEmail, secret);
    // Re-validated here (not only in the server function) so this handler
    // can never embed an unsafe redirect target in a magic link.
    const safeNext = sanitizeNext(next);
    const nextQuery = safeNext ? `&next=${encodeURIComponent(safeNext)}` : "";
    const magicLinkUrl = `${siteUrl}/admin/verify?token=${encodeURIComponent(token)}${nextQuery}`;
    try {
      await sendMagicLinkEmail({ to: normalizedEmail, magicLinkUrl });
    } catch (err) {
      // Delivery failures must not surface to the caller: an error for an
      // allow-listed address (vs. a silent ok for anyone else) would reveal
      // allow-list membership.
      console.error("Failed to send magic-link email", err);
    }
  }
  // Always the same response regardless of allow-list membership, so this
  // endpoint can't be used to enumerate which emails are admins.
  return { ok: true };
}
