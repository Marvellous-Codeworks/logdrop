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
    <a class="wordmark" href="/"><img class="wordmark__icon" src="/favicon.svg" alt="" />logdrop</a>
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

/** "2026-01-01T00:00:00.000Z" -> "2026-01-01 00:00 UTC" — a no-JS fallback, replaced client-side by localizeDatesScript(). */
export function formatDateFallback(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]} UTC` : iso;
}

/**
 * Rewrites every `<time data-iso="...">` element's text to the visitor's own
 * locale and timezone, client-side. The server-rendered text stays as a
 * UTC fallback for no-JS/pre-hydration cases.
 */
export function localizeDatesScript(): string {
  return `<script>
    document.querySelectorAll("[data-iso]").forEach(function (el) {
      var d = new Date(el.getAttribute("data-iso"));
      if (!isNaN(d.getTime())) {
        el.textContent = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      }
    });
  </script>`;
}
