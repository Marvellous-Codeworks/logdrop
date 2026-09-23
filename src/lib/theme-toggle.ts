// Keep in sync with THEME_INIT_JS in ./html-shell.ts (same storage key, same
// "explicit choice overrides system preference" logic) — that copy has to be
// a plain inline-script string since it runs on server-rendered pages with
// no JS bundle, this one is what the React-rendered pages' toggle button uses.
const THEME_STORAGE_KEY = "logdrop-theme";

export function toggleTheme(): void {
  const root = document.documentElement;
  const current =
    root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // localStorage can throw (private browsing, blocked storage) — the toggle
    // still applies to the current page, it just won't persist across visits.
  }
}
