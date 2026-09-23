import { randomBytes } from "node:crypto";

export function generateSlug(): string {
  // 16 random bytes (128 bits) — same entropy as a UUID v4. The slug isn't the
  // actual security boundary (reads always require an authenticated session),
  // but these links routinely end up pasted into public GitHub issues, so a
  // longer, harder-to-guess value is cheap defense in depth.
  return randomBytes(16).toString("base64url");
}

export function isPlainText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  const text = buffer.toString("utf8");
  // Buffer#toString silently replaces invalid byte sequences with U+FFFD;
  // re-encoding and comparing byte length catches that without a manual decoder.
  if (Buffer.byteLength(text, "utf8") !== buffer.length) return false;

  for (const byte of buffer) {
    const isControl = byte < 0x20 || byte === 0x7f;
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d; // tab, LF, CR
    if (isControl && !isAllowedControl) return false;
  }
  return true;
}
