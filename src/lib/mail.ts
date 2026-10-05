function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Email clients ignore external CSS and most don't render SVG, so the layout is
// table-based with inline styles and the logo is a PNG served from the app's origin.
// Colors are hex approximations of the site's oklch tokens in public/app.css.
const INK = "#1b2330";
const MUTED = "#687180";
const ACCENT = "#2563e8";
const PAPER = "#f6f8fa";
const RULE = "#dde2e8";
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function magicLinkEmailHtml(magicLinkUrl: string): string {
  const link = escapeHtml(magicLinkUrl);
  const logo = escapeHtml(`${new URL(magicLinkUrl).origin}/logo-email.png`);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin sign-in</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid ${RULE};border-radius:12px;">
      <tr><td style="padding:24px 32px;border-bottom:1px solid ${RULE};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding-right:8px;vertical-align:middle;"><img src="${logo}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px;"></td>
          <td style="vertical-align:middle;font-family:${FONT};font-size:20px;font-weight:600;letter-spacing:-0.02em;color:${INK};">logdrop</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;font-family:${FONT};color:${INK};">
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;">Admin sign-in</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">Click the button below to log in to logdrop. This link expires in 15 minutes.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:8px;background:${ACCENT};"><a href="${link}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Log in to logdrop</a></td>
        </tr></table>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">If the button doesn't work, copy and paste this link into your browser:<br><a href="${link}" style="color:${ACCENT};word-break:break-all;">${link}</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid ${RULE};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">If you didn't request this email, you can safely ignore it.</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function magicLinkEmailText(magicLinkUrl: string): string {
  return [
    "logdrop - Admin sign-in",
    "",
    "Open the link below to log in to logdrop. This link expires in 15 minutes.",
    "",
    magicLinkUrl,
    "",
    "If you didn't request this email, you can safely ignore it.",
  ].join("\n");
}

export async function sendMagicLinkEmail(input: { to: string; magicLinkUrl: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM is not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Your logdrop admin login link",
      html: magicLinkEmailHtml(input.magicLinkUrl),
      text: magicLinkEmailText(input.magicLinkUrl),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}
