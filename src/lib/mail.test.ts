import { describe, test, expect, mock, afterEach } from "bun:test";
import { sendMagicLinkEmail } from "./mail";

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
