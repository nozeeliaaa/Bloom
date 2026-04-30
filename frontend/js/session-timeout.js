import { isAccountMode } from "./mode.js";
import { logout } from "./auth.js";

const LAST_ACTIVITY_KEY = "bloom_last_activity_ts";
const INACTIVITY_MS_DEFAULT = 12 * 60 * 1000; // 12 minutes
const WARNING_GRACE_MS_DEFAULT = 60 * 1000;   // 1 minute

let _started = false;
let _warnTimer = null;
let _logoutTimer = null;
let _countdownTimer = null;
let _logoutAt = 0;
let _warningVisible = false;
let _logoutInFlight = false;
let _fetchPatched = false;
let _cleanupFns = [];

function parseMs(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getInactivityMs() {
  return parseMs(
    window.BLOOM_INACTIVITY_MS ?? localStorage.getItem("bloom_inactivity_ms"),
    INACTIVITY_MS_DEFAULT
  );
}

function getWarningGraceMs() {
  return parseMs(
    window.BLOOM_INACTIVITY_GRACE_MS ?? localStorage.getItem("bloom_inactivity_grace_ms"),
    WARNING_GRACE_MS_DEFAULT
  );
}

function getLastActivityTs() {
  const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Date.now();
}

function setLastActivityTs(ts = Date.now()) {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
}

function ensureModalStyles() {
  if (document.getElementById("session-timeout-style")) return;
  const style = document.createElement("style");
  style.id = "session-timeout-style";
  style.textContent = `
    .session-timeout-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(31, 12, 28, 0.42);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      opacity: 0;
      transition: opacity 180ms ease;
    }
    .session-timeout-overlay.open {
      display: flex;
      opacity: 1;
    }
    .session-timeout-card {
      width: min(480px, 96vw);
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-border, #e8d4df);
      border-radius: 16px;
      box-shadow: 0 20px 44px rgba(0, 0, 0, 0.18);
      padding: 1.1rem 1.1rem 1rem;
      transform: translateY(6px);
      transition: transform 180ms ease;
    }
    .session-timeout-overlay.open .session-timeout-card {
      transform: translateY(0);
    }
    .session-timeout-title {
      margin: 0 0 0.45rem;
      font-size: 1.05rem;
      color: var(--color-primary-dark, #3b1534);
    }
    .session-timeout-message {
      margin: 0;
      color: var(--color-text, #4a2a42);
      line-height: 1.5;
      font-size: 0.95rem;
    }
    .session-timeout-countdown {
      margin: 0.75rem 0 0.95rem;
      color: var(--color-text-muted, #6f5871);
      font-size: 0.88rem;
      font-weight: 700;
    }
    .session-timeout-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .session-timeout-btn {
      border-radius: 10px;
      border: 1px solid var(--color-border, #e8d4df);
      padding: 0.52rem 0.9rem;
      font-weight: 700;
      font-size: 0.88rem;
      cursor: pointer;
      background: #fff;
      color: var(--color-text, #4a2a42);
    }
    .session-timeout-btn.primary {
      background: var(--color-primary, #d81b82);
      color: #fff;
      border-color: var(--color-primary, #d81b82);
    }
  `;
  document.head.appendChild(style);
}

function ensureModal() {
  ensureModalStyles();
  let root = document.getElementById("session-timeout-overlay");
  if (root) return root;

  root = document.createElement("div");
  root.id = "session-timeout-overlay";
  root.className = "session-timeout-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `
    <div class="session-timeout-card">
      <h3 class="session-timeout-title">Session timeout warning</h3>
      <p class="session-timeout-message">You’ve been inactive. You’ll be logged out soon for your security.</p>
      <p class="session-timeout-countdown" id="session-timeout-countdown">Logging out in 60s...</p>
      <div class="session-timeout-actions">
        <button type="button" class="session-timeout-btn" id="session-timeout-logout-now">Log out now</button>
        <button type="button" class="session-timeout-btn primary" id="session-timeout-stay">Stay signed in</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelector("#session-timeout-stay")?.addEventListener("click", () => {
    handleActivity();
  });
  root.querySelector("#session-timeout-logout-now")?.addEventListener("click", () => {
    void forceSessionLogout("manual");
  });

  return root;
}

function updateCountdownText() {
  const el = document.getElementById("session-timeout-countdown");
  if (!el || !_logoutAt) return;
  const remainingMs = Math.max(0, _logoutAt - Date.now());
  const secs = Math.max(1, Math.ceil(remainingMs / 1000));
  el.textContent = `Logging out in ${secs}s...`;
}

function showWarning(logoutAt) {
  const overlay = ensureModal();
  _logoutAt = logoutAt;
  updateCountdownText();
  if (!_warningVisible) {
    _warningVisible = true;
    overlay.classList.add("open");
  }
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(updateCountdownText, 1000);
}

function hideWarning() {
  _warningVisible = false;
  _logoutAt = 0;
  if (_countdownTimer) {
    clearInterval(_countdownTimer);
    _countdownTimer = null;
  }
  const overlay = document.getElementById("session-timeout-overlay");
  overlay?.classList.remove("open");
}

function clearTimers() {
  if (_warnTimer) clearTimeout(_warnTimer);
  if (_logoutTimer) clearTimeout(_logoutTimer);
  _warnTimer = null;
  _logoutTimer = null;
}

function scheduleFromActivity(lastActivityTs) {
  clearTimers();
  if (!isAccountMode()) return;

  const inactivityMs = getInactivityMs();
  const graceMs = getWarningGraceMs();
  const now = Date.now();
  const elapsed = now - lastActivityTs;
  const warnAt = lastActivityTs + inactivityMs;
  const logoutAt = warnAt + graceMs;

  if (elapsed >= inactivityMs + graceMs) {
    // Preserve UX: always show a short warning instead of abrupt logout.
    const shortGraceMs = 8000;
    showWarning(now + shortGraceMs);
    _logoutTimer = setTimeout(() => void forceSessionLogout("inactivity"), shortGraceMs);
    return;
  }

  if (elapsed >= inactivityMs) {
    showWarning(logoutAt);
    _logoutTimer = setTimeout(() => void forceSessionLogout("inactivity"), Math.max(0, logoutAt - now));
    return;
  }

  const warnIn = Math.max(0, warnAt - now);
  _warnTimer = setTimeout(() => {
    showWarning(logoutAt);
  }, warnIn);

  const logoutIn = Math.max(0, logoutAt - now);
  _logoutTimer = setTimeout(() => void forceSessionLogout("inactivity"), logoutIn);
}

function handleActivity() {
  if (!isAccountMode()) return;
  setLastActivityTs(Date.now());
  hideWarning();
  scheduleFromActivity(getLastActivityTs());
}

async function shouldTreatAsExpiredSession(url, init, response) {
  if (!isAccountMode()) return false;
  if (!response) return false;
  if (response.status !== 401 && response.status !== 403) return false;

  const rawUrl = String(url || "");
  const isApiRequest = rawUrl.includes("/api/");
  if (!isApiRequest) return false;

  const headers = new Headers(
    init?.headers || (typeof Request !== "undefined" && url instanceof Request ? url.headers : undefined)
  );
  const hasAuthHeader = Boolean(headers.get("authorization"));
  if (response.status === 401 && hasAuthHeader) {
    let body = null;
    try {
      body = await response.clone().json();
    } catch (_) {}

    const error = String(body?.error || "").toLowerCase();
    const code = String(body?.code || "").toLowerCase();
    return (
      error === "missing token" ||
      error === "invalid token" ||
      code === "auth/id-token-expired" ||
      code === "auth/id-token-revoked" ||
      code === "auth/argument-error" ||
      code === "auth/invalid-token"
    );
  }

  return false;
}

function patchFetchForExpiry() {
  if (_fetchPatched || typeof window.fetch !== "function") return;
  _fetchPatched = true;
  const baseFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const res = await baseFetch(input, init);
    const reqUrl = typeof input === "string" ? input : input?.url;
    if (await shouldTreatAsExpiredSession(reqUrl, init, res)) {
      // Fire-and-forget so callers still receive their original response.
      void forceSessionLogout("expired");
    }
    return res;
  };
}

export async function forceSessionLogout(reason = "expired") {
  if (_logoutInFlight) return;
  _logoutInFlight = true;

  hideWarning();
  clearTimers();

  try {
    await logout();
  } catch (err) {
    console.warn("[session-timeout] logout failed:", err?.message || err);
  } finally {
    const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    window.location.replace(`/pages/login.html${qs}`);
  }
}

export function startSessionTimeoutGuard() {
  patchFetchForExpiry();
  if (_started) return;
  _started = true;

  if (!isAccountMode()) return;

  const activityEvents = [
    "click",
    "keydown",
    "input",
    "scroll",
    "touchstart",
    "pointerdown",
    "focus",
    "popstate",
    "hashchange",
  ];

  for (const ev of activityEvents) {
    const listener = () => handleActivity();
    window.addEventListener(ev, listener, { passive: true });
    _cleanupFns.push(() => window.removeEventListener(ev, listener, { passive: true }));
  }

  const storageListener = (e) => {
    if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
      const ts = Number(e.newValue);
      if (Number.isFinite(ts) && ts > 0) {
        if (_warningVisible) hideWarning();
        scheduleFromActivity(ts);
      }
    }
  };
  window.addEventListener("storage", storageListener);
  _cleanupFns.push(() => window.removeEventListener("storage", storageListener));

  if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
    setLastActivityTs(Date.now());
  }
  scheduleFromActivity(getLastActivityTs());
}

export function stopSessionTimeoutGuard() {
  _started = false;
  clearTimers();
  hideWarning();
  for (const fn of _cleanupFns.splice(0)) {
    try { fn(); } catch (_) {}
  }
}
