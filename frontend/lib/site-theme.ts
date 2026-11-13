export type SiteTheme = "light" | "dark";

export const THEME_KEY = "gm-theme";
const KEY = THEME_KEY;

/**
 * Runs in <head> before first paint. Light is the default: only a saved "dark" gives dark, and only a saved "system" (the
 * viewer chose Light/Dark/System = System) marks the page `data-system` so theme.css follows the device. Anything else,
 * including nothing saved or unreadable storage, is light. The device setting never decides on its own.
 */
export const themeBootScript = `try{var t=localStorage.getItem("${THEME_KEY}"),d=document.documentElement.dataset;if(t==="system")d.system="";else d.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

/** The theme the page is showing: the viewer's saved choice; the system setting only when they chose System; otherwise light. */
export function siteTheme(): SiteTheme {
  const { theme, system } = document.documentElement.dataset;
  if (theme === "light" || theme === "dark") return theme;
  if (system !== undefined && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

/** Saves the viewer's choice and applies it to the whole site. */
export function setSiteTheme(theme: SiteTheme) {
  delete document.documentElement.dataset.system;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {}
}

export type ThemeChoice = SiteTheme | "system";

/** What the viewer picked: light, dark, or "system" when they chose to follow the system setting. Nothing picked is light. */
export function themeChoice(): ThemeChoice {
  const { theme, system } = document.documentElement.dataset;
  if (theme === "light" || theme === "dark") return theme;
  return system !== undefined ? "system" : "light";
}

/** Follow the system setting: saved as "system", because with nothing saved the site is light. */
export function followSystemTheme() {
  delete document.documentElement.dataset.theme;
  document.documentElement.dataset.system = "";
  try { localStorage.setItem(KEY, "system"); } catch {}
}
