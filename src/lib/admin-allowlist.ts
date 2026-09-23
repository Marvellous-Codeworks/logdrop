// Shared ADMIN_EMAILS allow-list parsing/checking, so the login, verify and
// session paths all apply the same trimmed, case-insensitive comparison.

export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getAdminEmails(): string[] {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

export function isAdminEmail(email: string, adminEmails: readonly string[]): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}
