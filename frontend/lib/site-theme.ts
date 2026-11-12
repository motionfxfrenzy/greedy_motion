export type SiteTheme = "light" | "dark";

const KEY = "gm-theme";

/** The theme the page is showing: the viewer's saved choice, else the system setting. */
export function siteTheme(): SiteTheme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Saves the viewer's choice and applies it to the whole site. */
export function setSiteTheme(theme: SiteTheme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {}
}

export type ThemeChoice = SiteTheme | "system";

/** What the viewer picked: light, dark, or "system" when they chose to follow the system setting. */
export function themeChoice(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  return set === "light" || set === "dark" ? set : "system";
}

/** Follow the system setting: saved as "system", because with nothing saved the site is light. */
export function followSystemTheme() {
  delete document.documentElement.dataset.theme;
  try { localStorage.setItem(KEY, "system"); } catch {}
}
