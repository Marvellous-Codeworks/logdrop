// Keep in sync with THEME_INIT_JS in ./html-shell.ts (same storage key, same
// "explicit choice overrides system preference" logic) — that copy has to be
// a plain inline-script string since it runs on server-rendered pages with
// no JS bundle, this one is what the React-rendered pages' toggle button uses.
const THEME_STORAGE_KEY = "logdrop-theme";

/** Fired on `window` whenever the effective theme changes, `detail` is the new theme. */
export const THEME_CHANGE_EVENT = "logdrop:theme-change";

export type Theme = "light" | "dark";

/** The theme actually in effect right now — an explicit override, or the OS preference. */
export function getEffectiveTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme(): void {
  const next: Theme = getEffectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // localStorage can throw (private browsing, blocked storage) — the toggle
    // still applies to the current page, it just won't persist across visits.
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: next }));
}
