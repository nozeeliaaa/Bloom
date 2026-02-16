import { renderNav, renderFooter, renderModeBanner, renderBloomieFab } from "./utils.js";

renderNav("settings");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

const KEY = "bloom_preferences";

const els = {
  theme: document.getElementById("pref-theme"),
  hideSensitive: document.getElementById("pref-hide-sensitive"),
  reminders: document.getElementById("pref-reminders"),
  save: document.getElementById("save-prefs"),
  reset: document.getElementById("reset-prefs"),
  reset2: document.getElementById("reset-prefs-2"),
  status: document.getElementById("prefs-status"),
};

function getPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function setPrefs(prefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

function applyTheme(theme) {
  // "system" means remove explicit theme and let your base handle it
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
    return;
  }
  document.documentElement.setAttribute("data-theme", theme);
}

function loadUI() {
  const prefs = getPrefs();
  els.theme.value = prefs.theme || "light";
  els.hideSensitive.checked = !!prefs.hideSensitive;
  els.reminders.checked = !!prefs.reminders;

  applyTheme(els.theme.value);
}

function showStatus(msg) {
  if (!els.status) return;
  els.status.textContent = msg;
  setTimeout(() => (els.status.textContent = ""), 2500);
}

els.save?.addEventListener("click", () => {
  const prefs = {
    theme: els.theme.value,
    hideSensitive: els.hideSensitive.checked,
    reminders: els.reminders.checked,
  };
  setPrefs(prefs);
  applyTheme(prefs.theme);
  showStatus("Saved!");
});

function doReset() {
  localStorage.removeItem(KEY);
  loadUI();
  showStatus("Preferences reset.");
}

els.reset?.addEventListener("click", doReset);
els.reset2?.addEventListener("click", doReset);

// live preview theme
els.theme?.addEventListener("change", () => applyTheme(els.theme.value));

loadUI();
