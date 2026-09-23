import { LOGDROP_VERSION } from "./version";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

// Keep in sync with THEME_STORAGE_KEY in ./theme-toggle.ts — this is the
// plain-JS copy used by server-rendered pages that ship no JS bundle, so it
// can't just import that module.
const THEME_INIT_JS = `try {
  var stored = localStorage.getItem("logdrop-theme");
  if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
} catch (e) {}`;

const THEME_TOGGLE_WIRE_JS = `document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var root = document.documentElement;
    var current = root.dataset.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("logdrop-theme", next); } catch (e) {}
  });
});`;

/** The React-rendered root also needs THEME_INIT_JS, inlined via dangerouslySetInnerHTML — exported as a bare JS body (no <script> tags) for that use. */
export { THEME_INIT_JS };

const THEME_TOGGLE_BUTTON_HTML = `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle color theme">
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>`;

export function pageHead(title: string): string {
  return `<script>${THEME_INIT_JS}</script>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/app.css">
  <link rel="stylesheet" href="${FONTS_HREF}">`;
}

export function navHtml(showAdminLink: boolean): string {
  return `<nav class="nav">
    <a class="wordmark" href="/"><img class="wordmark__icon" src="/favicon.svg" alt="" />logdrop</a>
    <div class="nav__end">
      ${showAdminLink ? '<a class="nav__link" href="/admin">Admin</a>' : ""}
      ${THEME_TOGGLE_BUTTON_HTML}
    </div>
  </nav>`;
}

export function footerHtml(): string {
  return `<footer class="footer">
    <span>logdrop v${LOGDROP_VERSION} — a plain-text drop-off, gone in a week</span>
    <span class="footer__links">
      <a href="https://github.com/Marvellous-Codeworks/logdrop">Source</a>
      <a href="https://github.com/Marvellous-Codeworks/logdrop/issues/new">Report an issue</a>
    </span>
  </footer>`;
}

/** Wires up every [data-theme-toggle] button on a server-rendered page. Include once, near the end of <body>. */
export function themeToggleWireScript(): string {
  return `<script>${THEME_TOGGLE_WIRE_JS}</script>`;
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
