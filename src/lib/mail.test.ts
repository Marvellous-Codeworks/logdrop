import { describe, test, expect, mock, afterEach } from "bun:test";
import { magicLinkEmailHtml, magicLinkEmailText, sendMagicLinkEmail } from "./mail";

describe("sendMagicLinkEmail", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.MAIL_FROM;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = originalFrom;
  });

  test("throws when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendMagicLinkEmail({ to: "a@b.com", magicLinkUrl: "https://x/y" }),
    ).rejects.toThrow("RESEND_API_KEY is not configured");
  });

  test("throws when MAIL_FROM is missing", async () => {
    process.env.RESEND_API_KEY = "test-key";
    delete process.env.MAIL_FROM;
    await expect(
      sendMagicLinkEmail({ to: "a@b.com", magicLinkUrl: "https://x/y" }),
    ).rejects.toThrow("MAIL_FROM is not configured");
  });

  test("sends the magic link url in the email body", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.MAIL_FROM = "logdrop <noreply@example.com>";
    let capturedBody: Record<string, unknown> | null = null;
    global.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await sendMagicLinkEmail({ to: "a@b.com", magicLinkUrl: "https://x/y" });

    expect(capturedBody?.to).toEqual(["a@b.com"]);
    expect(capturedBody?.from).toBe("logdrop <noreply@example.com>");
    expect(String(capturedBody?.html)).toContain("https://x/y");
    expect(String(capturedBody?.text)).toContain("https://x/y");
  });

  test("throws when Resend responds with a non-ok status", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.MAIL_FROM = "logdrop <noreply@example.com>";
    global.fetch = mock(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    await expect(
      sendMagicLinkEmail({ to: "a@b.com", magicLinkUrl: "https://x/y" }),
    ).rejects.toThrow("Resend send failed: 500");
  });
});

describe("magicLinkEmailHtml", () => {
  const url = "https://logdrop.example.com/admin/verify?token=abc&next=%2Fadmin";

  test("renders the branded header with the logo served from the link's origin", () => {
    const html = magicLinkEmailHtml(url);
    expect(html).toContain('src="https://logdrop.example.com/logo-email.png"');
    expect(html).toContain(">logdrop</td>");
    expect(html).toContain("Admin sign-in");
  });

  test("includes the magic link, HTML-escaped, as the CTA and plain fallback", () => {
    const html = magicLinkEmailHtml(url);
    const escaped = "https://logdrop.example.com/admin/verify?token=abc&amp;next=%2Fadmin";
    expect(html.split(`href="${escaped}"`).length - 1).toBe(2);
    expect(html).toContain(`>${escaped}</a>`);
    expect(html).not.toContain("token=abc&next");
  });

  test("escapes markup injected through the link", () => {
    const html = magicLinkEmailHtml('https://x.example/verify?t="><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});

describe("magicLinkEmailText", () => {
  test("contains the raw magic link and the expiry notice", () => {
    const text = magicLinkEmailText("https://x/y?a=1&b=2");
    expect(text).toContain("https://x/y?a=1&b=2");
    expect(text).toContain("expires in 15 minutes");
  });
});
