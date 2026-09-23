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
      html:
        `<p>Click the link below to log in to logdrop. This link expires in 15 minutes.</p>` +
        `<p><a href="${input.magicLinkUrl}">${input.magicLinkUrl}</a></p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}
