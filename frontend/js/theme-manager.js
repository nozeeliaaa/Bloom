/**
 * theme-manager.js - Light/Dark Theme Module (frontend-only).
 *
 * Persists theme preference in localStorage only (no backend sync).
 */
const THEME_KEY = "bloom_theme";

export async function initTheme() {
  const theme = await getTheme();
  applyTheme(theme);
}

export async function getTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

export async function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}
