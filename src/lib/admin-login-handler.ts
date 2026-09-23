import { signMagicLinkToken } from "./auth-token";
import { sendMagicLinkEmail } from "./mail";

export async function handleAdminLoginRequest(email: string): Promise<{ ok: true }> {
  const secret = process.env.TOKEN_SECRET;
  const siteUrl = process.env.SITE_URL;
  if (!secret || !siteUrl) throw new Error("Server misconfigured");

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const normalizedEmail = email.trim().toLowerCase();
  if (adminEmails.includes(normalizedEmail)) {
    const token = signMagicLinkToken(normalizedEmail, secret);
    const magicLinkUrl = `${siteUrl}/admin/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail({ to: normalizedEmail, magicLinkUrl });
  }
  // Always the same response regardless of allow-list membership, so this
  // endpoint can't be used to enumerate which emails are admins.
  return { ok: true };
}
