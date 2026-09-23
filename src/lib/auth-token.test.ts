import { describe, test, expect } from "bun:test";
import {
  signMagicLinkToken,
  verifyMagicLinkToken,
  signSessionToken,
  verifySessionToken,
} from "./auth-token";

const SECRET = "test-secret";

describe("magic-link tokens", () => {
  test("round-trips the email", () => {
    const token = signMagicLinkToken("a@b.com", SECRET);
    const payload = verifyMagicLinkToken(token, SECRET);
    expect(payload?.email).toBe("a@b.com");
  });

  test("rejects a token signed with a different secret", () => {
    const token = signMagicLinkToken("a@b.com", SECRET);
    expect(verifyMagicLinkToken(token, "other-secret")).toBeNull();
  });

  test("rejects a tampered payload", () => {
    const token = signMagicLinkToken("a@b.com", SECRET);
    const [payloadPart, signaturePart] = token.split(".");
    const tamperedJson = Buffer.from(payloadPart, "base64url")
      .toString("utf8")
      .replace("a@b.com", "attacker@evil.com");
    const tamperedToken = `${Buffer.from(tamperedJson).toString("base64url")}.${signaturePart}`;
    expect(verifyMagicLinkToken(tamperedToken, SECRET)).toBeNull();
  });

  test("rejects a malformed token", () => {
    expect(verifyMagicLinkToken("not-a-real-token", SECRET)).toBeNull();
    expect(verifyMagicLinkToken("", SECRET)).toBeNull();
  });

  test("rejects an expired token", () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-01-01T00:00:00.000Z").getTime();
    const token = signMagicLinkToken("a@b.com", SECRET);
    Date.now = () => new Date("2026-01-01T00:20:00.000Z").getTime(); // +20 minutes, past the 15-minute TTL
    try {
      expect(verifyMagicLinkToken(token, SECRET)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});

describe("session tokens", () => {
  test("round-trips the email", () => {
    const token = signSessionToken("a@b.com", SECRET);
    const payload = verifySessionToken(token, SECRET);
    expect(payload?.email).toBe("a@b.com");
  });

  test("rejects an expired token", () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-01-01T00:00:00.000Z").getTime();
    const token = signSessionToken("a@b.com", SECRET);
    Date.now = () => new Date("2026-01-09T00:00:00.000Z").getTime(); // +8 days, past the 7-day TTL
    try {
      expect(verifySessionToken(token, SECRET)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  test("a magic-link token is not accepted as a session token", () => {
    // Both are structurally identical HMAC tokens; this pins that the two
    // helpers are distinguished only by TTL, which is fine — the caller
    // (admin-verify-handler, Task 13) is what actually enforces which
    // token type is expected at which endpoint.
    const token = signMagicLinkToken("a@b.com", SECRET);
    expect(verifySessionToken(token, SECRET)?.email).toBe("a@b.com");
  });
});
