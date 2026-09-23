import { describe, test, expect, mock, afterEach } from "bun:test";
import { verifyTurnstileToken } from "./turnstile";

describe("verifyTurnstileToken", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("returns false without calling the API when the token is empty", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await verifyTurnstileToken("", "1.2.3.4", "secret");

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns true when Cloudflare reports success", async () => {
    global.fetch = mock(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await verifyTurnstileToken("valid-token", "1.2.3.4", "secret")).toBe(true);
  });

  test("returns false when Cloudflare reports failure", async () => {
    global.fetch = mock(
      async () => new Response(JSON.stringify({ success: false }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await verifyTurnstileToken("bad-token", "1.2.3.4", "secret")).toBe(false);
  });

  test("returns false when the API responds with a non-ok status", async () => {
    global.fetch = mock(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    expect(await verifyTurnstileToken("some-token", "1.2.3.4", "secret")).toBe(false);
  });
});
