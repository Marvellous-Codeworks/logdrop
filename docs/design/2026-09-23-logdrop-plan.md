# logdrop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 of `logdrop` — a public, generic, PrivateBin-style plain-text drop-off: anyone can upload text with no account, only allow-listed maintainer emails can read an upload (via magic-link login), and uploads expire automatically.

**Architecture:** TanStack Start app deployed on Vercel. All state lives in Vercel Blob (two blobs per upload: content + JSON metadata) — no database. Auth is a stateless HMAC-signed magic-link/session token pair (no server-side token storage), emailed via Resend. Public upload is gated by Cloudflare Turnstile and a Vercel Edge Config kill-switch; retention is enforced by a daily Vercel Cron job. Business logic lives in plain, unit-tested functions under `src/lib/`; route files are thin wiring around them.

**Tech Stack:** TanStack Start + TanStack Router, React 19, Vite, Bun (runtime, package manager, and test runner via `bun test`), TypeScript (strict), `@vercel/blob`, `@vercel/edge-config`, Resend HTTP API, Cloudflare Turnstile.

**Spec:** `docs/design/2026-09-23-logdrop-design.md` (this plan implements it in full; read both before starting any task).

## Global Constraints

- No database of any kind — all persistent state is Vercel Blob (content + `meta.json` per upload). Do not introduce Postgres/KV/Redis.
- Uploaded content is always treated as plain text: server-side validation forces UTF-8 text with no binary/control bytes, and the stored `content-type` is always `text/plain; charset=utf-8` regardless of what the client claims.
- The raw Vercel Blob URL is never returned to any client. Content is only ever streamed after a session-cookie check, from server-side code.
- The uploader's original filename (`originalFilename` in metadata) is informational only — never used to derive a served filename, path, or content-type.
- Retention default is 7 days, overridable via `RETENTION_DAYS` env var; computed once at upload time into `expiresAt`.
- Magic-link tokens expire in 15 minutes; session cookies expire in a fixed 7 days (no sliding renewal).
- Every email in `ADMIN_EMAILS` has identical dashboard access — no per-user roles.
- Requesting a magic link must return the same response whether or not the submitted email is allow-listed (no allow-list enumeration).
- No dedicated rate-limiter in v1 — rely on Turnstile, `MAX_UPLOAD_BYTES`, and the Edge Config kill-switch.
- MarvellousSuspender extension integration is out of scope for this plan (see spec Section 8).

## Review Focus

- Non-UTF8/binary upload content must be rejected regardless of the claimed content-type or file extension — covered in Task 11 (`upload-handler.test.ts`, "rejects binary content").
- Reading `/r/:slug` without a valid session must never leak content — only a redirect to login — covered in Task 14 (`paste-view-handler.test.ts`, "redirects to login when no session").
- A token signed with a different or since-rotated secret must be rejected outright (forged/replayed token) — covered in Task 4 (`auth-token.test.ts`, "rejects token signed with a different secret" and "rejects a tampered payload").
- Requesting a magic link for a non-allow-listed email must not send an email and must not reveal that distinction in the response — covered in Task 12 (`admin-login-handler.test.ts`, "does not send email for a non-allow-listed address but still returns ok").
- The cron cleanup endpoint must reject any request without the correct `CRON_SECRET`, so it can't be triggered by the public internet to mass-delete uploads — covered in Task 16 (`cron-cleanup-handler.test.ts`, "rejects requests with a missing or wrong Authorization header").

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/router.tsx`
- Create: `src/routes/__root.tsx`
- Create: `src/routes/index.tsx`

**Interfaces:**
- Produces: a working TanStack Start dev/build setup that every later task's route files plug into via `createFileRoute`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "logdrop",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "start": "node .output/server/index.mjs",
    "test": "bun test"
  },
  "dependencies": {
    "@tanstack/react-router": "^1.168.0",
    "@tanstack/react-start": "^1.168.0",
    "@vercel/blob": "^1.0.0",
    "@vercel/edge-config": "^1.4.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@tanstack/router-plugin": "^1.168.0",
    "@types/bun": "latest",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vite-tsconfig-paths": "^5.1.0"
  }
}
```

- [ ] **Step 2: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({ target: "vercel" }),
    viteReact(),
  ],
});
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
.output
.vercel
dist
.env
.env.local
src/routeTree.gen.ts
*.log
```

- [ ] **Step 5: Write `src/router.tsx`**

```tsx
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  return createTanStackRouter({ routeTree });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
```

- [ ] **Step 6: Write `src/routes/__root.tsx`**

```tsx
import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "logdrop" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Write a placeholder `src/routes/index.tsx`** (replaced with the real frontpage in Task 11)

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <div>logdrop</div>,
});
```

- [ ] **Step 8: Install and build**

Run: `bun install && bun run build`
Expected: exits 0. If `@tanstack/react-start`'s current API differs from the config above (this package's API has moved before), fix `vite.config.ts` against the version actually installed until the build succeeds — the target behavior (a Vite + TanStack Start app building for the `vercel` preset) is fixed, not the exact flags.

- [ ] **Step 9: Commit**

```bash
git add package.json vite.config.ts tsconfig.json .gitignore src/router.tsx src/routes/__root.tsx src/routes/index.tsx bun.lock
git commit -m "chore: scaffold TanStack Start app"
```

---

### Task 2: Slug generation and plain-text validation

**Files:**
- Create: `src/lib/paste-validation.ts`
- Test: `src/lib/paste-validation.test.ts`

**Interfaces:**
- Produces: `generateSlug(): string`, `isPlainText(buffer: Buffer): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from "bun:test";
import { generateSlug, isPlainText } from "./paste-validation";

describe("generateSlug", () => {
  test("returns a url-safe string with no padding or slashes", () => {
    const slug = generateSlug();
    expect(slug.length).toBeGreaterThanOrEqual(10);
    expect(/^[A-Za-z0-9_-]+$/.test(slug)).toBe(true);
  });

  test("returns different values on each call", () => {
    const a = generateSlug();
    const b = generateSlug();
    expect(a).not.toBe(b);
  });
});

describe("isPlainText", () => {
  test("accepts simple ASCII text", () => {
    expect(isPlainText(Buffer.from("hello world\n", "utf8"))).toBe(true);
  });

  test("accepts UTF-8 text with multi-byte characters", () => {
    expect(isPlainText(Buffer.from("café — 日本語\n", "utf8"))).toBe(true);
  });

  test("accepts tabs, newlines and carriage returns", () => {
    expect(isPlainText(Buffer.from("a\tb\r\nc\n", "utf8"))).toBe(true);
  });

  test("rejects empty content", () => {
    expect(isPlainText(Buffer.alloc(0))).toBe(false);
  });

  test("rejects content with null bytes", () => {
    expect(isPlainText(Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]))).toBe(false);
  });

  test("rejects invalid UTF-8 byte sequences", () => {
    expect(isPlainText(Buffer.from([0xff, 0xfe, 0x00, 0x01]))).toBe(false);
  });

  test("rejects other C0 control characters", () => {
    expect(isPlainText(Buffer.from([0x68, 0x69, 0x07, 0x68, 0x69]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/paste-validation.test.ts`
Expected: FAIL — `paste-validation.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { randomBytes } from "node:crypto";

export function generateSlug(): string {
  return randomBytes(9).toString("base64url");
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/paste-validation.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/paste-validation.ts src/lib/paste-validation.test.ts
git commit -m "feat: add slug generation and plain-text validation"
```

---

### Task 3: Retention date math

**Files:**
- Create: `src/lib/retention.ts`
- Test: `src/lib/retention.test.ts`

**Interfaces:**
- Produces: `computeExpiresAt(createdAt: Date, retentionDays: number): Date`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from "bun:test";
import { computeExpiresAt } from "./retention";

describe("computeExpiresAt", () => {
  test("adds retentionDays days to createdAt", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeExpiresAt(createdAt, 7);
    expect(expiresAt.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  test("supports a retention of 1 day", () => {
    const createdAt = new Date("2026-01-01T12:00:00.000Z");
    const expiresAt = computeExpiresAt(createdAt, 1);
    expect(expiresAt.toISOString()).toBe("2026-01-02T12:00:00.000Z");
  });

  test("does not mutate the input date", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const before = createdAt.toISOString();
    computeExpiresAt(createdAt, 30);
    expect(createdAt.toISOString()).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/retention.test.ts`
Expected: FAIL — `retention.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
export function computeExpiresAt(createdAt: Date, retentionDays: number): Date {
  return new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/retention.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/retention.ts src/lib/retention.test.ts
git commit -m "feat: add retention date math"
```

---

### Task 4: Auth tokens (magic-link + session, stateless HMAC)

**Files:**
- Create: `src/lib/auth-token.ts`
- Test: `src/lib/auth-token.test.ts`

**Interfaces:**
- Produces: `signMagicLinkToken(email: string, secret: string): string`, `verifyMagicLinkToken(token: string, secret: string): { email: string; exp: number } | null`, `signSessionToken(email: string, secret: string): string`, `verifySessionToken(token: string, secret: string): { email: string; exp: number } | null`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/auth-token.test.ts`
Expected: FAIL — `auth-token.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/auth-token.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-token.ts src/lib/auth-token.test.ts
git commit -m "feat: add stateless HMAC magic-link and session tokens"
```

---

### Task 5: Session cookie helpers

**Files:**
- Create: `src/lib/session.ts`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `signSessionToken`, `verifySessionToken` from `./auth-token` (Task 4)
- Produces: `SESSION_COOKIE_NAME: string`, `getSessionEmail(request: Request, secret: string): string | null`, `buildSessionCookie(email: string, secret: string): string`, `clearSessionCookie(): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from "bun:test";
import { SESSION_COOKIE_NAME, getSessionEmail, buildSessionCookie, clearSessionCookie } from "./session";

const SECRET = "test-secret";

function requestWithCookie(cookieHeader: string): Request {
  return new Request("https://example.com/admin", { headers: { cookie: cookieHeader } });
}

describe("buildSessionCookie / getSessionEmail", () => {
  test("a request carrying the built cookie resolves back to the same email", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0]; // "name=value"
    const request = requestWithCookie(cookiePair);
    expect(getSessionEmail(request, SECRET)).toBe("a@b.com");
  });

  test("the cookie is httpOnly, secure and scoped to the whole site", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
  });

  test("returns null when there is no cookie header", () => {
    const request = new Request("https://example.com/admin");
    expect(getSessionEmail(request, SECRET)).toBeNull();
  });

  test("returns null when the cookie was signed with a different secret", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    const request = requestWithCookie(cookiePair);
    expect(getSessionEmail(request, "other-secret")).toBeNull();
  });

  test("ignores unrelated cookies alongside the session cookie", () => {
    const setCookie = buildSessionCookie("a@b.com", SECRET);
    const cookiePair = setCookie.split(";")[0];
    const request = requestWithCookie(`theme=dark; ${cookiePair}; other=1`);
    expect(getSessionEmail(request, SECRET)).toBe("a@b.com");
  });
});

describe("clearSessionCookie", () => {
  test("expires the cookie immediately", () => {
    const cleared = clearSessionCookie();
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/session.test.ts`
Expected: FAIL — `session.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { signSessionToken, verifySessionToken } from "./auth-token";

export const SESSION_COOKIE_NAME = "logdrop_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function getSessionEmail(request: Request, secret: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token, secret)?.email ?? null;
}

export function buildSessionCookie(email: string, secret: string): string {
  const token = signSessionToken(email, secret);
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/session.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts
git commit -m "feat: add session cookie helpers"
```

---

### Task 6: Magic-link email via Resend

**Files:**
- Create: `src/lib/mail.ts`
- Test: `src/lib/mail.test.ts`

**Interfaces:**
- Produces: `sendMagicLinkEmail(input: { to: string; magicLinkUrl: string }): Promise<void>`
- Reads env: `RESEND_API_KEY`, `MAIL_FROM`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/mail.test.ts`
Expected: FAIL — `mail.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/mail.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail.ts src/lib/mail.test.ts
git commit -m "feat: send magic-link email via Resend"
```

---

### Task 7: Paste metadata type

**Files:**
- Create: `src/lib/paste-types.ts`

**Interfaces:**
- Produces: `interface PasteMeta { slug, createdAt, expiresAt, sizeBytes, originalFilename, label, uploaderIp, uploaderCountry, userAgent }` — consumed by Tasks 8, 11, 14, 15, 16.

- [ ] **Step 1: Write the file**

```ts
export interface PasteMeta {
  slug: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  sizeBytes: number;
  originalFilename: string | null;
  label: string | null;
  uploaderIp: string | null;
  uploaderCountry: string | null;
  userAgent: string | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run build`
Expected: exits 0 (no consumers yet, so this only checks the file itself parses)

- [ ] **Step 3: Commit**

```bash
git add src/lib/paste-types.ts
git commit -m "feat: add PasteMeta type"
```

---

### Task 8: Vercel Blob storage wrapper

**Files:**
- Create: `src/lib/storage.ts`
- Test: `src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `PasteMeta` from `./paste-types` (Task 7)
- Produces: `savePaste(input: { slug: string; content: string; meta: Omit<PasteMeta, "slug"> }): Promise<void>`, `getPasteContent(slug: string): Promise<string | null>`, `getPasteMeta(slug: string): Promise<PasteMeta | null>`, `listPastes(): Promise<PasteMeta[]>`, `deletePaste(slug: string): Promise<void>`, `deleteExpiredPastes(now: Date): Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock, beforeEach } from "bun:test";

const blobStore = new Map<string, string>();

mock.module("@vercel/blob", () => ({
  put: mock(async (pathname: string, body: string) => {
    blobStore.set(pathname, body);
    return { url: `https://example.blob.vercel-storage.com/${pathname}` };
  }),
  head: mock(async (pathname: string) => {
    if (!blobStore.has(pathname)) throw new Error("not found");
    return { url: `https://example.blob.vercel-storage.com/${pathname}` };
  }),
  del: mock(async (pathnames: string[]) => {
    for (const p of pathnames) blobStore.delete(p);
  }),
  list: mock(async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobStore.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => ({ pathname: p, url: `https://example.blob.vercel-storage.com/${p}` })),
    hasMore: false,
    cursor: undefined,
  })),
}));

const originalFetch = global.fetch;
global.fetch = mock(async (url: string) => {
  const pathname = url.replace("https://example.blob.vercel-storage.com/", "");
  const body = blobStore.get(pathname);
  if (body === undefined) return new Response(null, { status: 404 });
  return new Response(body, { status: 200 });
}) as unknown as typeof fetch;

const { savePaste, getPasteContent, getPasteMeta, listPastes, deletePaste, deleteExpiredPastes } =
  await import("./storage");

function baseMeta(overrides: Partial<Parameters<typeof savePaste>[0]["meta"]> = {}) {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-08T00:00:00.000Z",
    sizeBytes: 11,
    originalFilename: null,
    label: null,
    uploaderIp: null,
    uploaderCountry: null,
    userAgent: null,
    ...overrides,
  };
}

describe("storage", () => {
  beforeEach(() => {
    blobStore.clear();
  });

  test("savePaste then getPasteContent/getPasteMeta round-trip", async () => {
    await savePaste({ slug: "abc123", content: "hello world", meta: baseMeta() });

    expect(await getPasteContent("abc123")).toBe("hello world");
    const meta = await getPasteMeta("abc123");
    expect(meta?.slug).toBe("abc123");
    expect(meta?.sizeBytes).toBe(11);
  });

  test("getPasteContent and getPasteMeta return null for an unknown slug", async () => {
    expect(await getPasteContent("missing")).toBeNull();
    expect(await getPasteMeta("missing")).toBeNull();
  });

  test("deletePaste removes both the content and meta blobs", async () => {
    await savePaste({ slug: "todelete", content: "bye", meta: baseMeta({ sizeBytes: 3 }) });
    await deletePaste("todelete");
    expect(await getPasteContent("todelete")).toBeNull();
    expect(await getPasteMeta("todelete")).toBeNull();
  });

  test("listPastes returns all saved pastes, newest first", async () => {
    await savePaste({
      slug: "older",
      content: "old",
      meta: baseMeta({ createdAt: "2026-01-01T00:00:00.000Z", sizeBytes: 3 }),
    });
    await savePaste({
      slug: "newer",
      content: "new",
      meta: baseMeta({ createdAt: "2026-01-02T00:00:00.000Z", sizeBytes: 3 }),
    });

    const pastes = await listPastes();
    expect(pastes.map((p) => p.slug)).toEqual(["newer", "older"]);
  });

  test("deleteExpiredPastes only removes pastes past expiresAt", async () => {
    await savePaste({
      slug: "expired",
      content: "old",
      meta: baseMeta({ expiresAt: "2026-01-08T00:00:00.000Z", sizeBytes: 3 }),
    });
    await savePaste({
      slug: "fresh",
      content: "new",
      meta: baseMeta({ expiresAt: "2026-01-17T00:00:00.000Z", sizeBytes: 3 }),
    });

    const deleted = await deleteExpiredPastes(new Date("2026-01-09T00:00:00.000Z"));

    expect(deleted).toEqual(["expired"]);
    expect(await getPasteContent("expired")).toBeNull();
    expect(await getPasteContent("fresh")).toBe("new");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/storage.test.ts`
Expected: FAIL — `storage.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { put, list, del, head } from "@vercel/blob";
import type { PasteMeta } from "./paste-types";

function contentPath(slug: string): string {
  return `uploads/${slug}/content`;
}

function metaPath(slug: string): string {
  return `uploads/${slug}/meta.json`;
}

export async function savePaste(input: {
  slug: string;
  content: string;
  meta: Omit<PasteMeta, "slug">;
}): Promise<void> {
  const meta: PasteMeta = { slug: input.slug, ...input.meta };
  await put(contentPath(input.slug), input.content, {
    access: "public",
    addRandomSuffix: false,
    contentType: "text/plain; charset=utf-8",
  });
  await put(metaPath(input.slug), JSON.stringify(meta), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function getPasteContent(slug: string): Promise<string | null> {
  try {
    const blob = await head(contentPath(slug));
    const res = await fetch(blob.url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function getPasteMeta(slug: string): Promise<PasteMeta | null> {
  try {
    const blob = await head(metaPath(slug));
    const res = await fetch(blob.url);
    return res.ok ? ((await res.json()) as PasteMeta) : null;
  } catch {
    return null;
  }
}

export async function deletePaste(slug: string): Promise<void> {
  await del([contentPath(slug), metaPath(slug)]);
}

export async function listPastes(): Promise<PasteMeta[]> {
  const metas: PasteMeta[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "uploads/", cursor });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith("/meta.json")) continue;
      const res = await fetch(blob.url);
      if (!res.ok) continue;
      metas.push((await res.json()) as PasteMeta);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteExpiredPastes(now: Date): Promise<string[]> {
  const metas = await listPastes();
  const expiredSlugs = metas
    .filter((meta) => new Date(meta.expiresAt).getTime() <= now.getTime())
    .map((meta) => meta.slug);
  for (const slug of expiredSlugs) {
    await deletePaste(slug);
  }
  return expiredSlugs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/storage.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: add Vercel Blob storage wrapper"
```

---

### Task 9: Cloudflare Turnstile verification

**Files:**
- Create: `src/lib/turnstile.ts`
- Test: `src/lib/turnstile.test.ts`

**Interfaces:**
- Produces: `verifyTurnstileToken(token: string, remoteIp: string | undefined, secretKey: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/turnstile.test.ts`
Expected: FAIL — `turnstile.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
export async function verifyTurnstileToken(
  token: string,
  remoteIp: string | undefined,
  secretKey: string,
): Promise<boolean> {
  if (!token) return false;

  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/turnstile.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/turnstile.ts src/lib/turnstile.test.ts
git commit -m "feat: add Cloudflare Turnstile verification"
```

---

### Task 10: Edge Config kill-switch

**Files:**
- Create: `src/lib/kill-switch.ts`
- Test: `src/lib/kill-switch.test.ts`

**Interfaces:**
- Produces: `areUploadsDisabled(): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock } from "bun:test";

const getMock = mock(async (_key: string) => undefined as unknown);
mock.module("@vercel/edge-config", () => ({ get: getMock }));

const { areUploadsDisabled } = await import("./kill-switch");

describe("areUploadsDisabled", () => {
  test("returns false when the flag is not set", async () => {
    getMock.mockImplementation(async () => undefined);
    expect(await areUploadsDisabled()).toBe(false);
  });

  test("returns true when the flag is explicitly true", async () => {
    getMock.mockImplementation(async () => true);
    expect(await areUploadsDisabled()).toBe(true);
  });

  test("returns false when the flag is any other truthy-but-not-true value", async () => {
    getMock.mockImplementation(async () => "yes");
    expect(await areUploadsDisabled()).toBe(false);
  });

  test("fails open (returns false) if Edge Config is unreachable", async () => {
    getMock.mockImplementation(async () => {
      throw new Error("network error");
    });
    expect(await areUploadsDisabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/kill-switch.test.ts`
Expected: FAIL — `kill-switch.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { get } from "@vercel/edge-config";

export async function areUploadsDisabled(): Promise<boolean> {
  try {
    return (await get("uploadsDisabled")) === true;
  } catch {
    // An optional safety valve failing shouldn't take the whole upload
    // flow down with it — fail open rather than closed.
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/kill-switch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/kill-switch.ts src/lib/kill-switch.test.ts
git commit -m "feat: add Edge Config upload kill-switch"
```

---

### Task 11: Upload handler and API route

**Files:**
- Create: `src/lib/upload-handler.ts`
- Test: `src/lib/upload-handler.test.ts`
- Create: `src/routes/api/upload.ts`

**Interfaces:**
- Consumes: `generateSlug`, `isPlainText` (Task 2), `computeExpiresAt` (Task 3), `savePaste` (Task 8), `verifyTurnstileToken` (Task 9), `areUploadsDisabled` (Task 10)
- Produces: `handleUpload(request: Request): Promise<Response>`
- Reads env: `TURNSTILE_SECRET_KEY`, `SITE_URL`, `MAX_UPLOAD_BYTES` (optional, default 5MB), `RETENTION_DAYS` (optional, default 7)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock, afterEach } from "bun:test";

const areUploadsDisabledMock = mock(async () => false);
mock.module("./kill-switch", () => ({ areUploadsDisabled: areUploadsDisabledMock }));

const verifyTurnstileTokenMock = mock(async () => true);
mock.module("./turnstile", () => ({ verifyTurnstileToken: verifyTurnstileTokenMock }));

const savePasteMock = mock(async () => undefined);
mock.module("./storage", () => ({ savePaste: savePasteMock }));

const { handleUpload } = await import("./upload-handler");

function uploadRequest(fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://logdrop.example/api/upload", { method: "POST", body: form });
}

describe("handleUpload", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    areUploadsDisabledMock.mockClear();
    verifyTurnstileTokenMock.mockClear();
    savePasteMock.mockClear();
  });

  function setBaseEnv() {
    process.env.TURNSTILE_SECRET_KEY = "ts-secret";
    process.env.SITE_URL = "https://logdrop.example";
    // Reset shared mocks back to their happy-path defaults before each test,
    // since a prior test may have overridden one to exercise a failure path.
    areUploadsDisabledMock.mockImplementation(async () => false);
    verifyTurnstileTokenMock.mockImplementation(async () => true);
    savePasteMock.mockImplementation(async () => undefined);
  }

  test("returns 503 when uploads are disabled", async () => {
    setBaseEnv();
    areUploadsDisabledMock.mockImplementation(async () => true);

    const res = await handleUpload(uploadRequest({ turnstileToken: "tok", content: "hello" }));

    expect(res.status).toBe(503);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when the turnstile token is missing", async () => {
    setBaseEnv();
    const res = await handleUpload(uploadRequest({ content: "hello" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when turnstile verification fails", async () => {
    setBaseEnv();
    verifyTurnstileTokenMock.mockImplementation(async () => false);

    const res = await handleUpload(uploadRequest({ turnstileToken: "bad", content: "hello" }));

    expect(res.status).toBe(400);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when no content is provided", async () => {
    setBaseEnv();
    const res = await handleUpload(uploadRequest({ turnstileToken: "tok" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when content exceeds MAX_UPLOAD_BYTES", async () => {
    setBaseEnv();
    process.env.MAX_UPLOAD_BYTES = "10";
    const res = await handleUpload(
      uploadRequest({ turnstileToken: "tok", content: "this is way more than 10 bytes" }),
    );
    expect(res.status).toBe(400);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when content is not plain text", async () => {
    setBaseEnv();
    const form = new FormData();
    form.set("turnstileToken", "tok");
    form.set("file", new File([new Uint8Array([0xff, 0xfe, 0x00, 0x01])], "dump.txt"));
    const request = new Request("https://logdrop.example/api/upload", { method: "POST", body: form });

    const res = await handleUpload(request);

    expect(res.status).toBe(400);
    expect(savePasteMock).not.toHaveBeenCalled();
  });

  test("on success, saves the paste and returns its share URL", async () => {
    setBaseEnv();
    process.env.RETENTION_DAYS = "7";

    const res = await handleUpload(
      uploadRequest({ turnstileToken: "tok", content: "hello world", label: "my label" }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url.startsWith("https://logdrop.example/r/")).toBe(true);
    expect(savePasteMock).toHaveBeenCalledTimes(1);
    const call = savePasteMock.mock.calls[0][0] as {
      content: string;
      meta: { label: string | null; sizeBytes: number };
    };
    expect(call.content).toBe("hello world");
    expect(call.meta.label).toBe("my label");
    expect(call.meta.sizeBytes).toBe(11);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/upload-handler.test.ts`
Expected: FAIL — `upload-handler.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { generateSlug, isPlainText } from "./paste-validation";
import { computeExpiresAt } from "./retention";
import { savePaste } from "./storage";
import { verifyTurnstileToken } from "./turnstile";
import { areUploadsDisabled } from "./kill-switch";

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 7;

export async function handleUpload(request: Request): Promise<Response> {
  if (await areUploadsDisabled()) {
    return Response.json({ error: "Uploads are temporarily disabled" }, { status: 503 });
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  const siteUrl = process.env.SITE_URL;
  if (!turnstileSecret || !siteUrl) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const formData = await request.formData();
  const turnstileToken = formData.get("turnstileToken");
  const fileField = formData.get("file");
  const contentField = formData.get("content");
  const label = formData.get("label");

  if (typeof turnstileToken !== "string" || !turnstileToken) {
    return Response.json({ error: "Missing verification token" }, { status: 400 });
  }

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const verified = await verifyTurnstileToken(turnstileToken, clientIp, turnstileSecret);
  if (!verified) {
    return Response.json({ error: "Verification failed" }, { status: 400 });
  }

  let raw: Buffer;
  let originalFilename: string | null = null;
  if (fileField instanceof File) {
    raw = Buffer.from(await fileField.arrayBuffer());
    originalFilename = fileField.name;
  } else if (typeof contentField === "string") {
    raw = Buffer.from(contentField, "utf8");
  } else {
    return Response.json({ error: "No content provided" }, { status: 400 });
  }

  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_UPLOAD_BYTES;
  if (raw.length === 0 || raw.length > maxBytes) {
    return Response.json({ error: "Invalid upload size" }, { status: 400 });
  }
  if (!isPlainText(raw)) {
    return Response.json({ error: "Only plain text is accepted" }, { status: 400 });
  }

  const retentionDays = Number(process.env.RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  const createdAt = new Date();
  const expiresAt = computeExpiresAt(createdAt, retentionDays);
  const slug = generateSlug();

  await savePaste({
    slug,
    content: raw.toString("utf8"),
    meta: {
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sizeBytes: raw.length,
      originalFilename,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 200) : null,
      uploaderIp: clientIp ?? null,
      uploaderCountry: request.headers.get("x-vercel-ip-country"),
      userAgent: request.headers.get("user-agent"),
    },
  });

  return Response.json({ url: `${siteUrl}/r/${slug}` });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/upload-handler.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the route wiring**

```ts
import { createFileRoute } from "@tanstack/react-router";
import { handleUpload } from "@/lib/upload-handler";

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => handleUpload(request),
    },
  },
});
```

- [ ] **Step 6: Build to confirm the route wires up**

Run: `bun run build`
Expected: exits 0

- [ ] **Step 7: Commit**

```bash
git add src/lib/upload-handler.ts src/lib/upload-handler.test.ts src/routes/api/upload.ts
git commit -m "feat: add upload handler and POST /api/upload route"
```

---

### Task 12: Admin login request (magic-link)

**Files:**
- Create: `src/lib/admin-login-handler.ts`
- Test: `src/lib/admin-login-handler.test.ts`
- Create: `src/lib/admin-login.functions.ts`

**Interfaces:**
- Consumes: `signMagicLinkToken` (Task 4), `sendMagicLinkEmail` (Task 6)
- Produces: `handleAdminLoginRequest(email: string): Promise<{ ok: true }>`, server function `requestAdminMagicLink`
- Reads env: `TOKEN_SECRET`, `SITE_URL`, `ADMIN_EMAILS`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock, afterEach } from "bun:test";

const sendMagicLinkEmailMock = mock(async () => undefined);
mock.module("./mail", () => ({ sendMagicLinkEmail: sendMagicLinkEmailMock }));

const { handleAdminLoginRequest } = await import("./admin-login-handler");

describe("handleAdminLoginRequest", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    sendMagicLinkEmailMock.mockClear();
  });

  function setEnv() {
    process.env.TOKEN_SECRET = "test-secret";
    process.env.SITE_URL = "https://logdrop.example";
    process.env.ADMIN_EMAILS = "admin@example.com, other@example.com";
  }

  test("sends a magic link email for an allow-listed address", async () => {
    setEnv();
    const result = await handleAdminLoginRequest("admin@example.com");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).toHaveBeenCalledTimes(1);
    const call = sendMagicLinkEmailMock.mock.calls[0][0] as { to: string; magicLinkUrl: string };
    expect(call.to).toBe("admin@example.com");
    expect(call.magicLinkUrl).toContain("https://logdrop.example/admin/verify?token=");
  });

  test("matches allow-list entries case-insensitively and trims whitespace", async () => {
    setEnv();
    const result = await handleAdminLoginRequest("Admin@Example.com");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).toHaveBeenCalledTimes(1);
  });

  test("does not send email for a non-allow-listed address but still returns ok", async () => {
    setEnv();
    const result = await handleAdminLoginRequest("stranger@example.com");

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkEmailMock).not.toHaveBeenCalled();
  });

  test("throws when TOKEN_SECRET is missing", async () => {
    setEnv();
    delete process.env.TOKEN_SECRET;
    await expect(handleAdminLoginRequest("admin@example.com")).rejects.toThrow(
      "Server misconfigured",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/admin-login-handler.test.ts`
Expected: FAIL — `admin-login-handler.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/admin-login-handler.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the server function wrapper**

```ts
import { createServerFn } from "@tanstack/react-start";
import { handleAdminLoginRequest } from "./admin-login-handler";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requestAdminMagicLink = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => {
    if (typeof data.email !== "string" || !EMAIL_RE.test(data.email)) {
      throw new Error("Invalid email");
    }
    return data;
  })
  .handler(async ({ data }) => handleAdminLoginRequest(data.email));
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin-login-handler.ts src/lib/admin-login-handler.test.ts src/lib/admin-login.functions.ts
git commit -m "feat: add admin magic-link login request"
```

---

### Task 13: Magic-link verification route

**Files:**
- Create: `src/lib/admin-verify-handler.ts`
- Test: `src/lib/admin-verify-handler.test.ts`
- Create: `src/routes/admin/verify.ts`

**Interfaces:**
- Consumes: `verifyMagicLinkToken` (Task 4), `buildSessionCookie` (Task 5)
- Produces: `handleAdminVerify(tokenParam: string | null, secret: string, redirectBase: string): Response`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from "bun:test";
import { handleAdminVerify } from "./admin-verify-handler";
import { signMagicLinkToken } from "./auth-token";
import { verifySessionToken } from "./auth-token";

const SECRET = "test-secret";
const BASE = "https://logdrop.example";

describe("handleAdminVerify", () => {
  test("redirects to login with an error when no token is present", () => {
    const res = handleAdminVerify(null, SECRET, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=missing");
  });

  test("redirects to login with an error when the token is invalid or expired", () => {
    const res = handleAdminVerify("not-a-real-token", SECRET, BASE);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?error=expired");
  });

  test("redirects to /admin and sets a valid session cookie for a valid token", () => {
    const token = signMagicLinkToken("admin@example.com", SECRET);

    const res = handleAdminVerify(token, SECRET, BASE);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("logdrop_session=");
    const sessionToken = setCookie!.split("logdrop_session=")[1].split(";")[0];
    expect(verifySessionToken(sessionToken, SECRET)?.email).toBe("admin@example.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/admin-verify-handler.test.ts`
Expected: FAIL — `admin-verify-handler.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { verifyMagicLinkToken } from "./auth-token";
import { buildSessionCookie } from "./session";

export function handleAdminVerify(
  tokenParam: string | null,
  secret: string,
  redirectBase: string,
): Response {
  if (!tokenParam) {
    return Response.redirect(new URL("/admin/login?error=missing", redirectBase).toString(), 302);
  }

  const payload = verifyMagicLinkToken(tokenParam, secret);
  if (!payload) {
    return Response.redirect(new URL("/admin/login?error=expired", redirectBase).toString(), 302);
  }

  const headers = new Headers();
  headers.set("Location", new URL("/admin", redirectBase).toString());
  headers.append("Set-Cookie", buildSessionCookie(payload.email, secret));
  return new Response(null, { status: 302, headers });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/admin-verify-handler.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the route wiring**

```ts
import { createFileRoute } from "@tanstack/react-router";
import { handleAdminVerify } from "@/lib/admin-verify-handler";

export const Route = createFileRoute("/admin/verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminVerify(url.searchParams.get("token"), secret, url.origin);
      },
    },
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin-verify-handler.ts src/lib/admin-verify-handler.test.ts src/routes/admin/verify.ts
git commit -m "feat: add magic-link verification route"
```

---

### Task 14: Paste view route (`/r/:slug`)

**Files:**
- Create: `src/lib/paste-view-handler.ts`
- Test: `src/lib/paste-view-handler.test.ts`
- Create: `src/routes/r/$slug.tsx`

**Interfaces:**
- Consumes: `getSessionEmail` (Task 5), `getPasteContent`, `getPasteMeta` (Task 8)
- Produces: `handlePasteView(request: Request, slug: string, secret: string): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock, afterEach } from "bun:test";

const getSessionEmailMock = mock((_req: Request, _secret: string) => null as string | null);
mock.module("./session", () => ({ getSessionEmail: getSessionEmailMock }));

const getPasteContentMock = mock(async (_slug: string) => null as string | null);
const getPasteMetaMock = mock(async (_slug: string) => null as unknown);
mock.module("./storage", () => ({
  getPasteContent: getPasteContentMock,
  getPasteMeta: getPasteMetaMock,
}));

const { handlePasteView } = await import("./paste-view-handler");

const SECRET = "test-secret";

describe("handlePasteView", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    getPasteContentMock.mockClear();
    getPasteMetaMock.mockClear();
  });

  test("redirects to login with a next param when there is no session", async () => {
    getSessionEmailMock.mockImplementation(() => null);
    const request = new Request("https://logdrop.example/r/abc123");

    const res = await handlePasteView(request, "abc123", SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://logdrop.example/admin/login?next=%2Fr%2Fabc123",
    );
  });

  test("returns 404 when the paste does not exist", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteContentMock.mockImplementation(async () => null);
    getPasteMetaMock.mockImplementation(async () => null);
    const request = new Request("https://logdrop.example/r/missing");

    const res = await handlePasteView(request, "missing", SECRET);

    expect(res.status).toBe(404);
  });

  test("renders the paste content escaped inside the page when authenticated", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    getPasteContentMock.mockImplementation(async () => "<script>alert(1)</script>");
    getPasteMetaMock.mockImplementation(async () => ({
      slug: "abc123",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-08T00:00:00.000Z",
      sizeBytes: 25,
      originalFilename: null,
      label: "repro steps",
      uploaderIp: null,
      uploaderCountry: null,
      userAgent: null,
    }));
    const request = new Request("https://logdrop.example/r/abc123");

    const res = await handlePasteView(request, "abc123", SECRET);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("2026-01-01T00:00:00.000Z");
    expect(html).toContain("repro steps");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/paste-view-handler.test.ts`
Expected: FAIL — `paste-view-handler.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { getSessionEmail } from "./session";
import { getPasteContent, getPasteMeta } from "./storage";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handlePasteView(
  request: Request,
  slug: string,
  secret: string,
): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret);
  if (!email) {
    const next = encodeURIComponent(url.pathname);
    return Response.redirect(new URL(`/admin/login?next=${next}`, url.origin).toString(), 302);
  }

  const [content, meta] = await Promise.all([getPasteContent(slug), getPasteMeta(slug)]);
  if (content === null || meta === null) {
    return new Response("Not found", { status: 404 });
  }

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>logdrop — ${escapeHtml(slug)}</title></head>
<body style="font-family: monospace; max-width: 60rem; margin: 2rem auto; padding: 0 1rem;">
  <p>Uploaded ${escapeHtml(meta.createdAt)} — expires ${escapeHtml(meta.expiresAt)}${meta.label ? ` — ${escapeHtml(meta.label)}` : ""}</p>
  <pre id="paste-content" style="white-space: pre-wrap; word-break: break-word; border: 1px solid #ccc; padding: 1rem;">${escapeHtml(content)}</pre>
  <button id="download-btn">Download as .txt</button>
  <script>
    document.getElementById("download-btn").addEventListener("click", () => {
      const text = document.getElementById("paste-content").textContent;
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logdrop-${slug}.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/paste-view-handler.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the route wiring**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { handlePasteView } from "@/lib/paste-view-handler";

export const Route = createFileRoute("/r/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handlePasteView(request, params.slug, secret);
      },
    },
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/paste-view-handler.ts src/lib/paste-view-handler.test.ts "src/routes/r/\$slug.tsx"
git commit -m "feat: add auth-gated paste view route"
```

---

### Task 15: Admin dashboard and delete action

**Files:**
- Create: `src/lib/admin-dashboard-handler.ts`
- Test: `src/lib/admin-dashboard-handler.test.ts`
- Create: `src/lib/admin-delete-handler.ts`
- Test: `src/lib/admin-delete-handler.test.ts`
- Create: `src/routes/admin/index.tsx`
- Create: `src/routes/api/admin/delete.ts`

**Interfaces:**
- Consumes: `getSessionEmail` (Task 5), `listPastes`, `deletePaste` (Task 8)
- Produces: `handleAdminDashboard(request: Request, secret: string): Promise<Response>`, `handleAdminDelete(request: Request, secret: string): Promise<Response>`

- [ ] **Step 1: Write the failing tests for the dashboard**

```ts
import { describe, test, expect, mock, afterEach } from "bun:test";

const getSessionEmailMock = mock((_req: Request, _secret: string) => null as string | null);
mock.module("./session", () => ({ getSessionEmail: getSessionEmailMock }));

const listPastesMock = mock(async () => [] as unknown[]);
mock.module("./storage", () => ({ listPastes: listPastesMock }));

const { handleAdminDashboard } = await import("./admin-dashboard-handler");

const SECRET = "test-secret";

describe("handleAdminDashboard", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    listPastesMock.mockClear();
  });

  test("redirects to login when there is no session", async () => {
    getSessionEmailMock.mockImplementation(() => null);
    const request = new Request("https://logdrop.example/admin");

    const res = await handleAdminDashboard(request, SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?next=/admin");
  });

  test("lists pastes with escaped fields and a delete form per row", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");
    listPastesMock.mockImplementation(async () => [
      {
        slug: "abc123",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-08T00:00:00.000Z",
        sizeBytes: 42,
        originalFilename: null,
        label: "<b>note</b>",
        uploaderIp: null,
        uploaderCountry: "IT",
        userAgent: null,
      },
    ]);
    const request = new Request("https://logdrop.example/admin");

    const res = await handleAdminDashboard(request, SECRET);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("abc123");
    expect(html).toContain("&lt;b&gt;note&lt;/b&gt;");
    expect(html).toContain('<form method="POST" action="/api/admin/delete">');
    expect(html).toContain('value="abc123"');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `bun test src/lib/admin-dashboard-handler.test.ts`
Expected: FAIL — `admin-dashboard-handler.ts` does not exist yet.

- [ ] **Step 3: Write the dashboard implementation**

```ts
import { getSessionEmail } from "./session";
import { listPastes } from "./storage";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function handleAdminDashboard(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret);
  if (!email) {
    return Response.redirect(new URL("/admin/login?next=/admin", url.origin).toString(), 302);
  }

  const pastes = await listPastes();
  const rows = pastes
    .map(
      (p) => `<tr>
        <td><a href="/r/${escapeHtml(p.slug)}">${escapeHtml(p.slug)}</a></td>
        <td>${escapeHtml(p.createdAt)}</td>
        <td>${escapeHtml(p.expiresAt)}</td>
        <td>${escapeHtml(String(p.sizeBytes))}</td>
        <td>${escapeHtml(p.uploaderCountry ?? "")}</td>
        <td>${escapeHtml(p.label ?? "")}</td>
        <td><form method="POST" action="/api/admin/delete"><input type="hidden" name="slug" value="${escapeHtml(p.slug)}" /><button type="submit">Delete</button></form></td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>logdrop admin</title></head>
<body style="font-family: sans-serif; max-width: 72rem; margin: 2rem auto; padding: 0 1rem;">
  <h1>logdrop — ${escapeHtml(email)}</h1>
  <table border="1" cellpadding="6" style="border-collapse: collapse; width: 100%;">
    <thead><tr><th>Slug</th><th>Created</th><th>Expires</th><th>Bytes</th><th>Country</th><th>Label</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

- [ ] **Step 4: Run and verify the dashboard tests pass**

Run: `bun test src/lib/admin-dashboard-handler.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing tests for delete**

```ts
import { describe, test, expect, mock, afterEach } from "bun:test";

const getSessionEmailMock = mock((_req: Request, _secret: string) => null as string | null);
mock.module("./session", () => ({ getSessionEmail: getSessionEmailMock }));

const deletePasteMock = mock(async (_slug: string) => undefined);
mock.module("./storage", () => ({ deletePaste: deletePasteMock }));

const { handleAdminDelete } = await import("./admin-delete-handler");

const SECRET = "test-secret";

function deleteRequest(slug?: string): Request {
  const form = new FormData();
  if (slug !== undefined) form.set("slug", slug);
  return new Request("https://logdrop.example/api/admin/delete", { method: "POST", body: form });
}

describe("handleAdminDelete", () => {
  afterEach(() => {
    getSessionEmailMock.mockClear();
    deletePasteMock.mockClear();
  });

  test("redirects to login when there is no session", async () => {
    getSessionEmailMock.mockImplementation(() => null);

    const res = await handleAdminDelete(deleteRequest("abc123"), SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin/login?next=/admin");
    expect(deletePasteMock).not.toHaveBeenCalled();
  });

  test("returns 400 when slug is missing", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");

    const res = await handleAdminDelete(deleteRequest(), SECRET);

    expect(res.status).toBe(400);
    expect(deletePasteMock).not.toHaveBeenCalled();
  });

  test("deletes the paste and redirects back to the dashboard", async () => {
    getSessionEmailMock.mockImplementation(() => "admin@example.com");

    const res = await handleAdminDelete(deleteRequest("abc123"), SECRET);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://logdrop.example/admin");
    expect(deletePasteMock).toHaveBeenCalledWith("abc123");
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `bun test src/lib/admin-delete-handler.test.ts`
Expected: FAIL — `admin-delete-handler.ts` does not exist yet.

- [ ] **Step 7: Write the delete implementation**

```ts
import { getSessionEmail } from "./session";
import { deletePaste } from "./storage";

export async function handleAdminDelete(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const email = getSessionEmail(request, secret);
  if (!email) {
    return Response.redirect(new URL("/admin/login?next=/admin", url.origin).toString(), 302);
  }

  const formData = await request.formData();
  const slug = formData.get("slug");
  if (typeof slug !== "string" || slug.length === 0) {
    return new Response("Missing slug", { status: 400 });
  }

  await deletePaste(slug);
  return Response.redirect(new URL("/admin", url.origin).toString(), 302);
}
```

- [ ] **Step 8: Run and verify the delete tests pass**

Run: `bun test src/lib/admin-delete-handler.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Write the route wiring**

```tsx
// src/routes/admin/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { handleAdminDashboard } from "@/lib/admin-dashboard-handler";

export const Route = createFileRoute("/admin/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminDashboard(request, secret);
      },
    },
  },
});
```

```ts
// src/routes/api/admin/delete.ts
import { createFileRoute } from "@tanstack/react-router";
import { handleAdminDelete } from "@/lib/admin-delete-handler";

export const Route = createFileRoute("/api/admin/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.TOKEN_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        return handleAdminDelete(request, secret);
      },
    },
  },
});
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/admin-dashboard-handler.ts src/lib/admin-dashboard-handler.test.ts \
  src/lib/admin-delete-handler.ts src/lib/admin-delete-handler.test.ts \
  src/routes/admin/index.tsx src/routes/api/admin/delete.ts
git commit -m "feat: add admin dashboard and delete action"
```

---

### Task 16: Cron cleanup route

**Files:**
- Create: `src/lib/cron-cleanup-handler.ts`
- Test: `src/lib/cron-cleanup-handler.test.ts`
- Create: `src/routes/api/cron/cleanup.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `deleteExpiredPastes` (Task 8)
- Produces: `handleCronCleanup(request: Request, cronSecret: string): Promise<Response>`
- Reads env: `CRON_SECRET`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect, mock, afterEach } from "bun:test";

const deleteExpiredPastesMock = mock(async (_now: Date) => [] as string[]);
mock.module("./storage", () => ({ deleteExpiredPastes: deleteExpiredPastesMock }));

const { handleCronCleanup } = await import("./cron-cleanup-handler");

const SECRET = "cron-secret";

describe("handleCronCleanup", () => {
  afterEach(() => {
    deleteExpiredPastesMock.mockClear();
  });

  test("rejects requests with a missing Authorization header", async () => {
    const res = await handleCronCleanup(new Request("https://logdrop.example/api/cron/cleanup"), SECRET);
    expect(res.status).toBe(401);
    expect(deleteExpiredPastesMock).not.toHaveBeenCalled();
  });

  test("rejects requests with the wrong Authorization header", async () => {
    const request = new Request("https://logdrop.example/api/cron/cleanup", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const res = await handleCronCleanup(request, SECRET);
    expect(res.status).toBe(401);
    expect(deleteExpiredPastesMock).not.toHaveBeenCalled();
  });

  test("deletes expired pastes and returns them when authorized", async () => {
    deleteExpiredPastesMock.mockImplementation(async () => ["expired-1", "expired-2"]);
    const request = new Request("https://logdrop.example/api/cron/cleanup", {
      headers: { authorization: `Bearer ${SECRET}` },
    });

    const res = await handleCronCleanup(request, SECRET);
    const json = (await res.json()) as { deleted: string[] };

    expect(res.status).toBe(200);
    expect(json.deleted).toEqual(["expired-1", "expired-2"]);
    expect(deleteExpiredPastesMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/cron-cleanup-handler.test.ts`
Expected: FAIL — `cron-cleanup-handler.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { deleteExpiredPastes } from "./storage";

export async function handleCronCleanup(request: Request, cronSecret: string): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const deleted = await deleteExpiredPastes(new Date());
  return Response.json({ deleted });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/cron-cleanup-handler.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the route wiring**

```ts
import { createFileRoute } from "@tanstack/react-router";
import { handleCronCleanup } from "@/lib/cron-cleanup-handler";

export const Route = createFileRoute("/api/cron/cleanup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) return new Response("Server misconfigured", { status: 500 });
        return handleCronCleanup(request, cronSecret);
      },
    },
  },
});
```

- [ ] **Step 6: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }
  ]
}
```

Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on cron-triggered requests once the `CRON_SECRET` env var is set on the project — set it before deploying (see Task 17's README).

- [ ] **Step 7: Commit**

```bash
git add src/lib/cron-cleanup-handler.ts src/lib/cron-cleanup-handler.test.ts src/routes/api/cron/cleanup.ts vercel.json
git commit -m "feat: add daily cron cleanup for expired pastes"
```

---

### Task 17: Public frontpage (paste/upload form)

**Files:**
- Modify: `src/routes/index.tsx` (replaces the Task 1 placeholder)

**Interfaces:**
- Consumes: `POST /api/upload` (Task 11) via `fetch`, plus the Turnstile widget script (`https://challenges.cloudflare.com/turnstile/v0/api.js`)
- Reads client-side env: `VITE_TURNSTILE_SITE_KEY` (public site key, safe to ship to the browser — distinct from `TURNSTILE_SECRET_KEY`)

This task is UI wiring on top of already-unit-tested logic (Task 11); it is verified manually rather than with automated tests, consistent with the rest of the app (there is no browser/component test harness in this project).

- [ ] **Step 1: Replace `src/routes/index.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.body.appendChild(script);
    script.onload = () => {
      const turnstile = (window as unknown as { turnstile?: { render: (el: HTMLElement, opts: { sitekey: string }) => string } }).turnstile;
      if (turnstile && turnstileRef.current) {
        widgetIdRef.current = turnstile.render(turnstileRef.current, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        });
      }
    };
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultUrl(null);

    const turnstile = (window as unknown as { turnstile?: { getResponse: (id: string) => string } }).turnstile;
    const turnstileToken = widgetIdRef.current ? turnstile?.getResponse(widgetIdRef.current) : undefined;
    if (!turnstileToken) {
      setError("Please complete the verification widget.");
      return;
    }

    const formData = new FormData();
    formData.set("turnstileToken", turnstileToken);
    if (label.trim()) formData.set("label", label.trim());
    if (file) {
      formData.set("file", file);
    } else {
      formData.set("content", text);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Upload failed");
        return;
      }
      setResultUrl(data.url);
      setText("");
      setFile(null);
      setLabel("");
    } catch {
      setError("Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: "40rem", margin: "2rem auto", padding: "0 1rem", fontFamily: "sans-serif" }}>
      <h1>logdrop</h1>
      <p>Paste text or upload a .txt file. Only an allow-listed maintainer can read it back.</p>
      <form onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!file}
          rows={12}
          style={{ width: "100%" }}
          placeholder="Paste text here..."
        />
        <p>— or —</p>
        <input
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional label"
            style={{ width: "100%" }}
          />
        </p>
        <div ref={turnstileRef} />
        <button type="submit" disabled={submitting || (!text.trim() && !file)}>
          {submitting ? "Uploading…" : "Upload"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {resultUrl && (
        <p>
          Share this link: <a href={resultUrl}>{resultUrl}</a>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `bun run dev`, open the printed local URL in a browser.
Expected: the Turnstile widget renders; pasting text and submitting (or picking a `.txt` file and submitting) returns a share link; opening that link while logged out redirects to `/admin/login`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: add public paste/upload frontpage"
```

---

### Task 18: Admin login page

**Files:**
- Create: `src/routes/admin/login.tsx`

**Interfaces:**
- Consumes: `requestAdminMagicLink` server function (Task 12)

This task is UI wiring on top of already-unit-tested logic (Task 12); verified manually.

- [ ] **Step 1: Write `src/routes/admin/login.tsx`**

```tsx
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { requestAdminMagicLink } from "@/lib/admin-login.functions";

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { error } = useSearch({ from: "/admin/login" });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await requestAdminMagicLink({ data: { email } });
    setSent(true);
  }

  return (
    <main style={{ maxWidth: "24rem", margin: "4rem auto", padding: "0 1rem", fontFamily: "sans-serif" }}>
      <h1>logdrop admin</h1>
      {error === "expired" && <p style={{ color: "red" }}>That link expired. Request a new one below.</p>}
      {error === "missing" && <p style={{ color: "red" }}>Missing login token.</p>}
      {sent ? (
        <p>If that email is registered, a login link is on its way. It expires in 15 minutes.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: "100%" }}
          />
          <button type="submit">Send login link</button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `bun run dev`, visit `/admin/login`, submit an allow-listed email, confirm the magic-link email arrives via Resend and clicking it lands on `/admin` with the paste list.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/login.tsx
git commit -m "feat: add admin login page"
```

---

### Task 19: Environment documentation and README

**Files:**
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Write `.env.example`**

```bash
# Signing secret for magic-link and session tokens (any long random string).
TOKEN_SECRET=

# Comma-separated list of emails allowed to log into /admin.
ADMIN_EMAILS=

# Resend (https://resend.com) API key and From address for magic-link emails.
RESEND_API_KEY=
MAIL_FROM="logdrop <noreply@your-domain.example>"

# Public base URL this deployment is served at (no trailing slash).
SITE_URL=https://your-subdomain.example.com

# Retention window in days before an upload is auto-deleted (default: 7).
RETENTION_DAYS=7

# Max accepted upload size in bytes (default: 5242880 = 5MB).
MAX_UPLOAD_BYTES=5242880

# Cloudflare Turnstile (https://developers.cloudflare.com/turnstile/) keys.
# VITE_TURNSTILE_SITE_KEY is public and ships to the browser; TURNSTILE_SECRET_KEY stays server-side.
VITE_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# Secret Vercel sends as `Authorization: Bearer <value>` when triggering the cron job.
CRON_SECRET=

# Provisioned automatically by connecting a Vercel Blob store to this project.
# BLOB_READ_WRITE_TOKEN=

# Provisioned automatically by connecting a Vercel Edge Config store to this project.
# Create an "uploadsDisabled" boolean key in it (defaults to false/unset).
# EDGE_CONFIG=
```

- [ ] **Step 2: Write `README.md`**

```markdown
# logdrop

A generic, self-hostable, PrivateBin-style plain-text drop-off: anyone can upload text (or a `.txt` file) with no account; only an allow-listed set of maintainer emails can ever read an upload back, via a magic-link login. Uploads expire automatically after a configurable retention window.

## Design

See `docs/design/2026-09-23-logdrop-design.md` for the full design rationale, and `docs/design/2026-09-23-logdrop-plan.md` for the implementation plan this was built from.

## Stack

- TanStack Start + TanStack Router, React 19, Vite, Bun
- Vercel Blob for storage (no database)
- Resend for magic-link emails
- Cloudflare Turnstile for public-upload abuse mitigation
- Vercel Edge Config for a runtime upload kill-switch
- Vercel Cron for daily retention cleanup

## Local development

```bash
bun install
cp .env.example .env.local  # fill in the values described below
bun run dev
bun test
```

## Deploying

1. Create a new Vercel project from this repo.
2. Connect a **Vercel Blob** store to the project (provides `BLOB_READ_WRITE_TOKEN` automatically).
3. Connect a **Vercel Edge Config** store to the project (provides `EDGE_CONFIG` automatically); optionally add an `uploadsDisabled` boolean key to it as an emergency kill-switch.
4. Set the remaining environment variables from `.env.example` (`TOKEN_SECRET`, `ADMIN_EMAILS`, `RESEND_API_KEY`, `MAIL_FROM`, `SITE_URL`, `RETENTION_DAYS`, `MAX_UPLOAD_BYTES`, `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CRON_SECRET`).
5. Point a subdomain of your choice at the deployment (CNAME to Vercel) and set `SITE_URL` to match.
6. Deploy. The `/api/cron/cleanup` route runs daily via `vercel.json`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add environment reference and README"
```

---

## After this plan

The MarvellousSuspender extension integration (a `debug.html` "Upload report" button posting directly to `/api/upload`) is intentionally deferred — see spec Section 8. It should get its own short brainstorming pass once logdrop v1 is deployed and working, since it needs its own decisions (CORS/`host_permissions`, how a non-browser-form caller satisfies or bypasses Turnstile, response UX inside the diagnostic page).
