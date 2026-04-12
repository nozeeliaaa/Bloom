/**
 * theme-manager.js - Light/Dark/System Theme Module.
 * Reads theme from bloom_theme first, then falls back to bloom_preferences.theme.
 */
const THEME_KEY = "bloom_theme";
const PREFS_KEY = "bloom_preferences";

export function initTheme() {
  const theme = getTheme();
  _applyTheme(theme);
}

export function getTheme() {
  const direct = localStorage.getItem(THEME_KEY);
  if (["light", "dark", "system"].includes(direct)) {
    return direct;
  }

  try {
    const rawPrefs = localStorage.getItem(PREFS_KEY);
    if (rawPrefs) {
      const prefs = JSON.parse(rawPrefs);
      if (["light", "dark", "system"].includes(prefs?.theme)) {
        return prefs.theme;
      }
    }
  } catch (err) {
    console.warn("[theme-manager] Failed to parse bloom_preferences:", err);
  }

  return "light";
}

export function setTheme(theme) {
  if (!["light", "dark", "system"].includes(theme)) return;

  localStorage.setItem(THEME_KEY, theme);

  try {
    const rawPrefs = localStorage.getItem(PREFS_KEY);
    const prefs = rawPrefs ? JSON.parse(rawPrefs) : {};
    prefs.theme = theme;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn("[theme-manager] Failed to sync theme into bloom_preferences:", err);
  }

  _applyTheme(theme);
}

function _applyTheme(theme) {
  if (theme === "system") {
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute(
      "data-theme",
      prefersDark ? "dark" : "light"
    );
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

window
  .matchMedia?.("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (getTheme() === "system") _applyTheme("system");
  });