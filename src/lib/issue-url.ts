const ISSUE_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;

export function sanitizeIssueUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return ISSUE_URL_RE.test(trimmed) ? trimmed : null;
}
