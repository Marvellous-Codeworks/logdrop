import { describe, test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { signSessionToken, verifySessionToken } from "./auth-token";

const SECRET = "test-secret";
const SID = "s".repeat(43);

function signRaw(payload: object): string {
  const json = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET).update(json).digest();
  return `${Buffer.from(json).toString("base64url")}.${sig.toString("base64url")}`;
}

describe("session tokens", () => {
  test("round-trips the email and session ID", () => {
    const payload = verifySessionToken(signSessionToken("a@b.com", SID, SECRET), SECRET);
    expect(payload?.email).toBe("a@b.com");
    expect(payload?.sid).toBe(SID);
  });

  test("rejects a token signed with a different secret", () => {
    expect(verifySessionToken(signSessionToken("a@b.com", SID, SECRET), "other-secret")).toBeNull();
  });

  test("rejects a tampered payload", () => {
    const [payloadPart, signaturePart] = signSessionToken("a@b.com", SID, SECRET).split(".");
    const tamperedJson = Buffer.from(payloadPart, "base64url")
      .toString("utf8")
      .replace("a@b.com", "attacker@evil.com");
    const tamperedToken = `${Buffer.from(tamperedJson).toString("base64url")}.${signaturePart}`;
    expect(verifySessionToken(tamperedToken, SECRET)).toBeNull();
  });

  test("rejects a malformed token", () => {
    expect(verifySessionToken("not-a-real-token", SECRET)).toBeNull();
    expect(verifySessionToken("", SECRET)).toBeNull();
  });

  test("rejects a token past the 8-hour TTL", () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-01-01T00:00:00.000Z").getTime();
    const token = signSessionToken("a@b.com", SID, SECRET);
    Date.now = () => new Date("2026-01-01T08:00:01.000Z").getTime();
    try {
      expect(verifySessionToken(token, SECRET)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  test("rejects a pre-upgrade session token without a session ID", () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(verifySessionToken(signRaw({ typ: "session", email: "a@b.com", exp }), SECRET)).toBeNull();
  });

  test("rejects a validly signed token of another type", () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(verifySessionToken(signRaw({ typ: "magic", email: "a@b.com", sid: SID, exp }), SECRET)).toBeNull();
    expect(verifySessionToken(signRaw({ email: "a@b.com", sid: SID, exp }), SECRET)).toBeNull();
  });
});
