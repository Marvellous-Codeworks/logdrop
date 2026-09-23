import { createHmac, timingSafeEqual } from "node:crypto";

export interface MagicLinkPayload {
  email: string;
  exp: number;
}

export interface SessionPayload {
  email: string;
  exp: number;
}

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signWithExpiry<T extends { exp: number }>(
  payload: Omit<T, "exp">,
  ttlSeconds: number,
  secret: string,
): string {
  const full = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds } as T;
  const json = JSON.stringify(full);
  const signature = createHmac("sha256", secret).update(json).digest();
  return `${toBase64Url(json)}.${toBase64Url(signature)}`;
}

function verifyWithExpiry<T extends { exp: number }>(token: string, secret: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;

  let json: string;
  try {
    json = Buffer.from(payloadPart, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret).update(json).digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(signaturePart, "base64url");
  } catch {
    return null;
  }
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  let payload: T;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export function signMagicLinkToken(email: string, secret: string): string {
  return signWithExpiry<MagicLinkPayload>({ email }, MAGIC_LINK_TTL_SECONDS, secret);
}

export function verifyMagicLinkToken(token: string, secret: string): MagicLinkPayload | null {
  return verifyWithExpiry<MagicLinkPayload>(token, secret);
}

export function signSessionToken(email: string, secret: string): string {
  return signWithExpiry<SessionPayload>({ email }, SESSION_TTL_SECONDS, secret);
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  return verifyWithExpiry<SessionPayload>(token, secret);
}
