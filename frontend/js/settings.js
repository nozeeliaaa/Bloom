/**
 * settings.js - Preferences UI
 * - Loads from backend (account mode) or localStorage (anon mode)
 * - Saves to backend + localStorage in account mode
 * - Registers/unregisters FCM token when notification toggles change
 */
 
import {
  renderNav,
  renderFooter,
  renderModeBanner,
  renderBloomieFab,
  showToast,
} from "./utils.js";
 
import { getTheme, setTheme }                    from "./theme-manager.js";
import { isAccountMode }                         from "./mode.js";
import { getIdToken }                            from "./auth.js";
import { registerFCMToken, unregisterFCMToken }  from "./notifications.js";
import {
  loadBloomPreferencesLocal,
  saveBloomPreferencesLocal,
  clearBloomPreferencesLocal,
} from "./bloom-storage.js";
 
renderNav("settings");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));
 
const API_BASE  = window.BLOOM_API_BASE || "";
 
// ─── DOM refs ──────────────────────────────────────────────────────────────────
const els = {
  reminders:      document.getElementById("pref-reminders"),
  periodReminder: document.getElementById("pref-period-reminder"),
  fertileAlert:   document.getElementById("pref-fertile-alert"),
  discreetNotif:  document.getElementById("pref-discreet-notif"),
  save:           document.getElementById("save-prefs"),
  reset:          document.getElementById("reset-prefs"),
  status:         document.getElementById("prefs-status"),
  themeBtns: {
    light:  document.getElementById("theme-light"),
    dark:   document.getElementById("theme-dark"),
    system: document.getElementById("theme-system"),
  },
};
 
// ─── Local helpers ─────────────────────────────────────────────────────────────
function getLocalPrefs() {
  return loadBloomPreferencesLocal();
}
 
function setLocalPrefs(prefs) {
  saveBloomPreferencesLocal(prefs || {});
}
 
// ─── Backend helpers ───────────────────────────────────────────────────────────
async function authHeaders() {
  const token = await getIdToken();
  if (!token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
 
async function loadFromBackend() {
  try {
    const headers = await authHeaders();
    if (!headers) return null;

    const res = await fetch(`${API_BASE}/api/preferences`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.preferences || null;
  } catch {
    return null;
  }
}
 
async function saveToBackend(prefs) {
  try {
    const headers = await authHeaders();
    if (!headers) return false;
 
    const payload = {
      theme:    getTheme(),
      reminders: {
        enabled:      prefs.reminders      ?? false,
        discreetCopy: prefs.discreetNotif ?? false,
        types: [
          ...(prefs.periodReminder ? ["PERIOD_SOON"]     : []),
          ...(prefs.fertileAlert   ? ["FERTILE_WINDOW"]  : []),
        ],
      },
    };

    const res = await fetch(`${API_BASE}/api/preferences`, {
      method:  "PUT",
      headers,
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[Bloom] preferences save failed:", res.status, err);
    } else {
      console.log("[Bloom] preferences saved to backend ✓");
    }
    return res.ok;
  } catch (e) {
    console.error("[Bloom] preferences save error:", e);
    return false;
  }
}
 
// ─── FCM helpers ───────────────────────────────────────────────────────────────
function anyNotificationEnabled() {
  return (
    els.reminders?.checked      ||
    els.periodReminder?.checked ||
    els.fertileAlert?.checked
  );
}
 
async function syncFCMToken() {
  if (!isAccountMode()) return;
  if (anyNotificationEnabled()) {
    await registerFCMToken();
  } else {
    await unregisterFCMToken();
  }
}
 
// ─── UI helpers ────────────────────────────────────────────────────────────────
function updateThemeButtons(current) {
  Object.entries(els.themeBtns).forEach(([key, btn]) => {
    if (btn) btn.classList.toggle("active", key === current);
  });
}
 
function applyPrefsToUI(prefs) {
  const theme = prefs.theme || getTheme();
  updateThemeButtons(theme);
  setTheme(theme);

  // Reminders - flatten from backend shape or local shape
  const remindersEnabled = prefs.reminders?.enabled ?? !!prefs.reminders;
  if (els.reminders) els.reminders.checked = remindersEnabled;
 
  const types = prefs.reminders?.types || [];
  if (els.periodReminder) {
    els.periodReminder.checked = types.includes("PERIOD_SOON") || !!prefs.periodReminder;
  }
  if (els.fertileAlert) {
    els.fertileAlert.checked = types.includes("FERTILE_WINDOW") || !!prefs.fertileAlert;
  }
  if (els.discreetNotif) {
    els.discreetNotif.checked = prefs.reminders?.discreetCopy ?? !!prefs.discreetNotif;
  }
}
 
function showStatus(msg) {
  if (!els.status) return;
  els.status.textContent = msg;
  setTimeout(() => (els.status.textContent = ""), 2500);
}
 
// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  let prefs = getLocalPrefs();
 
  if (isAccountMode()) {
    const cloudPrefs = await loadFromBackend();
    if (cloudPrefs) {
      // Cloud is source of truth - merge into local cache
      prefs = { ...prefs, ...cloudPrefs };
      setLocalPrefs(prefs);
    }
  }
 
  applyPrefsToUI(prefs);
}
 
init();
 
// ─── Theme button clicks ───────────────────────────────────────────────────────
Object.entries(els.themeBtns).forEach(([key, btn]) => {
  btn?.addEventListener("click", () => {
    setTheme(key);
    updateThemeButtons(key);
  });
});
 
// ─── Notification toggle changes - sync FCM immediately ───────────────────────
[els.reminders, els.periodReminder, els.fertileAlert].forEach((toggle) => {
  toggle?.addEventListener("change", () => syncFCMToken());
});
 
// ─── Save ──────────────────────────────────────────────────────────────────────
els.save?.addEventListener("click", async () => {
  const prefs = {
    reminders:      els.reminders?.checked      ?? false,
    periodReminder: els.periodReminder?.checked ?? false,
    fertileAlert:   els.fertileAlert?.checked   ?? false,
    discreetNotif:  els.discreetNotif?.checked  ?? false,
  };
 
  setLocalPrefs(prefs);
 
  if (isAccountMode()) {
    els.save.disabled    = true;
    els.save.textContent = "Saving…";
 
    const [ok] = await Promise.all([
      saveToBackend(prefs),
      syncFCMToken(),
    ]);
 
    els.save.disabled    = false;
    els.save.textContent = "Save Preferences";
 
    if (ok) {
      showStatus("Saved to cloud!");
      showToast("Preferences saved.");
    } else {
      showStatus("Saved locally (cloud sync failed).");
      showToast("Preferences saved locally.", "info");
    }
  } else {
    showStatus("Saved!");
    showToast("Preferences saved.");
  }
});
 
// ─── Reset ─────────────────────────────────────────────────────────────────────
els.reset?.addEventListener("click", async () => {
  clearBloomPreferencesLocal();
  applyPrefsToUI({});
  // All toggles now off - unregister FCM
  if (isAccountMode()) await unregisterFCMToken();
  showStatus("Reset to defaults.");
  showToast("Preferences reset.", "info");
});
