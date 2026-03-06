import {
  renderNav,
  renderFooter,
  renderModeBanner,
  renderBloomieFab,
  showToast,
} from "./utils.js";

import { getTheme, setTheme } from "./theme-manager.js";

renderNav("settings");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

const KEY = "bloom_preferences";

const els = {
  hideSensitive:  document.getElementById("pref-hide-sensitive"),
  reminders:      document.getElementById("pref-reminders"),
  periodReminder: document.getElementById("pref-period-reminder"),
  fertileAlert:   document.getElementById("pref-fertile-alert"),
  compact:        document.getElementById("pref-compact"),
  save:           document.getElementById("save-prefs"),
  reset:          document.getElementById("reset-prefs"),
  status:         document.getElementById("prefs-status"),
  themeBtns: {
    light:  document.getElementById("theme-light"),
    dark:   document.getElementById("theme-dark"),
    system: document.getElementById("theme-system"),
  },
};

function getPrefs() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

function setPrefs(prefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

function updateThemeButtons(current) {
  Object.entries(els.themeBtns).forEach(([key, btn]) => {
    if (btn) btn.classList.toggle("active", key === current);
  });
}

function loadUI() {
  const prefs = getPrefs();
  const currentTheme = getTheme();

  updateThemeButtons(currentTheme);

  if (els.hideSensitive)  els.hideSensitive.checked  = !!prefs.hideSensitive;
  if (els.reminders)      els.reminders.checked      = !!prefs.reminders;
  if (els.periodReminder) els.periodReminder.checked = !!prefs.periodReminder;
  if (els.fertileAlert)   els.fertileAlert.checked   = !!prefs.fertileAlert;
  if (els.compact)        els.compact.checked        = !!prefs.compact;
}

function showStatus(msg) {
  if (!els.status) return;
  els.status.textContent = msg;
  setTimeout(() => (els.status.textContent = ""), 2500);
}

// Theme button clicks — live preview + highlight active
Object.entries(els.themeBtns).forEach(([key, btn]) => {
  btn?.addEventListener("click", () => {
    setTheme(key);
    updateThemeButtons(key);
  });
});

// Save
els.save?.addEventListener("click", () => {
  const prefs = {
    hideSensitive:  els.hideSensitive?.checked  ?? false,
    reminders:      els.reminders?.checked      ?? false,
    periodReminder: els.periodReminder?.checked ?? false,
    fertileAlert:   els.fertileAlert?.checked   ?? false,
    compact:        els.compact?.checked        ?? false,
  };
  setPrefs(prefs);
  showStatus("Saved!");
  showToast("Preferences saved.");
});

// Reset
els.reset?.addEventListener("click", () => {
  localStorage.removeItem(KEY);
  loadUI();
  showStatus("Reset to defaults.");
  showToast("Preferences reset.", "info");
});

loadUI();