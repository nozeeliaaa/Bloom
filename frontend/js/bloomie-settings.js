/**
 * bloomie-settings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chat-scoped settings modal (sound, language).
 *
 * Storage:  localStorage key "bloom_chat_prefs" (persists across sessions,
 *           never sent to server — purely client-side UI preferences).
 *
 * Design contract:
 *   - Opening the modal never locks or pauses the conversation.
 *   - Closing the modal restores keyboard focus to where it was before opening,
 *     so the user can keep typing without clicking back into the input.
 *   - Settings changes take effect immediately (no save button needed).
 *   - Language option is rendered but disabled — placeholder for future i18n.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const STORAGE_KEY = "bloom_chat_prefs";

const DEFAULTS = {
  soundEnabled: true,
  language: "en",
};

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadChatPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveChatPrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable — settings apply for session only
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

let _prefs = loadChatPrefs();
let _focusBeforeOpen = null; // element to restore focus to on close

// ── Internal helpers ──────────────────────────────────────────────────────────

function getOverlay() {
  return document.getElementById("chat-settings-overlay");
}

function syncUI() {
  const soundToggle = document.getElementById("chat-pref-sound");
  if (soundToggle) soundToggle.checked = _prefs.soundEnabled;

  const langSelect = document.getElementById("chat-pref-language");
  if (langSelect) langSelect.value = _prefs.language;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when sound effects are currently enabled.
 * Call this anywhere in the chat pipeline before playing a sound.
 */
export function isSoundEnabled() {
  return _prefs.soundEnabled;
}

/** Open the settings modal without interrupting conversation state. */
export function openSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

  _focusBeforeOpen = document.activeElement;
  overlay.classList.add("open");
  overlay.removeAttribute("aria-hidden");

  // Move focus into the modal so screen readers announce it
  const firstFocusable = overlay.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (firstFocusable) firstFocusable.focus();
}

/** Close the modal and resume conversation without any state change. */
export function closeSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");

  // Restore focus so the user can keep typing immediately
  if (_focusBeforeOpen && typeof _focusBeforeOpen.focus === "function") {
    _focusBeforeOpen.focus();
  }
  _focusBeforeOpen = null;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Call once after the modal HTML is in the DOM.
 * Wires up all event listeners and reflects current prefs into the UI.
 */
export function initChatSettings() {
  const overlay   = getOverlay();
  if (!overlay) return;

  syncUI();

  // Close button
  overlay.querySelector(".modal-close")?.addEventListener("click", closeSettingsModal);

  // Backdrop click closes (click on overlay itself, not the panel)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSettingsModal();
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) {
      closeSettingsModal();
    }
  });

  // Sound toggle — immediate effect, persisted
  const soundToggle = document.getElementById("chat-pref-sound");
  soundToggle?.addEventListener("change", () => {
    _prefs.soundEnabled = soundToggle.checked;
    saveChatPrefs(_prefs);
  });

  // Language selector — persisted but no runtime effect yet (future i18n)
  const langSelect = document.getElementById("chat-pref-language");
  langSelect?.addEventListener("change", () => {
    _prefs.language = langSelect.value;
    saveChatPrefs(_prefs);
  });

  // Gear / settings trigger button
  document.getElementById("chat-settings-btn")?.addEventListener("click", openSettingsModal);

  // Focus trap: keep Tab inside modal while open
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !overlay.classList.contains("open")) return;
    const focusable = Array.from(
      overlay.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
