/**
 * theme-manager.js - Light/Dark/System Theme Module (frontend-only).
 * Persists theme preference in localStorage only.
 * All functions are synchronous - no async needed for localStorage.
 */
const THEME_KEY = "bloom_theme";

/**
 * Call this ONCE at page load (synchronous, no flash).
 * utils.js calls initTheme() at module load time.
 */
export function initTheme() {
  const theme = getTheme();
  _applyTheme(theme);
}

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

export function setTheme(theme) {
  if (!["light", "dark", "system"].includes(theme)) return;
  localStorage.setItem(THEME_KEY, theme);
  _applyTheme(theme);
}

function _applyTheme(theme) {
  if (theme === "system") {
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

// Listen for system preference changes when in system mode
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getTheme() === "system") _applyTheme("system");
});