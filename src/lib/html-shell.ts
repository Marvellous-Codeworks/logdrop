const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

export function pageHead(title: string): string {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/app.css">
  <link rel="stylesheet" href="${FONTS_HREF}">`;
}

export function navHtml(showAdminLink: boolean): string {
  return `<nav class="nav">
    <a class="wordmark" href="/">logdrop</a>
    ${showAdminLink ? '<a class="nav__link" href="/admin">Admin</a>' : ""}
  </nav>`;
}

export function footerHtml(): string {
  return `<footer class="footer">
    <span>logdrop — a plain-text drop-off, gone in a week</span>
    <a href="https://github.com/Marvellous-Codeworks/logdrop">Source</a>
  </footer>`;
}

/** Extracts the trailing "#123" from a GitHub issue URL, for display. */
export function issueNumberFromUrl(issueUrl: string): string {
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  return match ? `#${match[1]}` : issueUrl;
}
