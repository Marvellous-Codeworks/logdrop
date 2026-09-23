// Post-login redirect targets are restricted to a relative path to a paste
// (/r/<slug>) or the dashboard (/admin). Anything else (absolute URLs,
// protocol-relative //host, other paths) is dropped to prevent an open
// redirect. Validate at every point a `next` value is accepted or used.
const SAFE_NEXT_RE = /^\/(r\/[A-Za-z0-9_-]+|admin)$/;

export function sanitizeNext(next: unknown): string | undefined {
  return typeof next === "string" && SAFE_NEXT_RE.test(next) ? next : undefined;
}
