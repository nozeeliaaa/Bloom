/**
 * db.js — Hybrid persistence:
 * - anon mode: localStorage only
 * - account mode: sync to backend (/api/logs) using Firebase ID token
 *
 * Backend endpoints used:
 * - GET    /api/logs
 * - PUT    /api/logs/:dateKey
 * - DELETE /api/logs/:dateKey
 */

import { getIdToken } from "./auth.js";
import { isAccountMode } from "./mode.js";
import { MODE_BANNER_ONCE_KEY } from "./utils.js";

const LOGS_KEY = "bloom_daily_logs";
const ASSIST_KEY = "bloom_assistant_session";

// Optional base for dev if your frontend is on a different port than backend.
// You can set: window.BLOOM_API_BASE = "http://localhost:4000";
const API_BASE = window.BLOOM_API_BASE || "";

// --------------------
// localStorage helpers
// --------------------
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setCloudSyncedBanner() {
  // your utils.js banner reads this key once
  localStorage.setItem(MODE_BANNER_ONCE_KEY, "1");
}

async function authHeaders() {
  const token = await getIdToken();
  if (!token) return null;

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

// --------------------
// Logs API (hybrid)
// --------------------

/**
 * Save a daily log for a specific dateKey (YYYY-MM-DD).
 * In account mode: attempts to sync to backend, falls back to local if needed.
 */
export async function saveDailyLog(dateKey, log) {
  // Always write local first (keeps UI snappy + works offline)
  const all = readJSON(LOGS_KEY, {});
  all[dateKey] = { ...(all[dateKey] || {}), ...log, date: dateKey };
  writeJSON(LOGS_KEY, all);

  // If not account mode, stop here
  if (!isAccountMode()) {
    return all[dateKey];
  }

  // Account mode: try syncing to backend
  try {
    const headers = await authHeaders();
    if (!headers) {
      // user not actually logged in — keep local
      return all[dateKey];
    }

    const res = await fetch(apiUrl(`/api/logs/${encodeURIComponent(dateKey)}`), {
      method: "PUT",
      headers,
      body: JSON.stringify(all[dateKey]),
    });

    if (!res.ok) {
      // backend failed; keep local
      const txt = await res.text().catch(() => "");
      console.warn("Cloud save failed:", res.status, txt);
      return all[dateKey];
    }

    // success
    setCloudSyncedBanner();
    return all[dateKey];
  } catch (e) {
    console.warn("Cloud save error:", e);
    return all[dateKey];
  }
}

export async function getDailyLog(dateKey) {
  // If account mode, prefer server copy (but fall back to local)
  if (isAccountMode()) {
    const all = await getAllLogs(); // this fetches cloud first
    return all[dateKey] || null;
  }

  const all = readJSON(LOGS_KEY, {});
  return all[dateKey] || null;
}

/**
 * Get all logs.
 * In account mode: tries backend first, caches to local, falls back to local on error.
 */
export async function getAllLogs() {
  const local = readJSON(LOGS_KEY, {});

  if (!isAccountMode()) return local;

  try {
    const headers = await authHeaders();
    if (!headers) return local;

    const res = await fetch(apiUrl("/api/logs"), { headers });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("Cloud fetch failed:", res.status, txt);
      return local;
    }

    const data = await res.json();
    const logs = data?.logs && typeof data.logs === "object" ? data.logs : {};

    // Cache cloud logs locally so dashboard/calendar can work instantly next time
    writeJSON(LOGS_KEY, logs);
    setCloudSyncedBanner();

    return logs;
  } catch (e) {
    console.warn("Cloud fetch error:", e);
    return local;
  }
}

export async function deleteDailyLog(dateKey) {
  // Always delete locally first
  const all = readJSON(LOGS_KEY, {});
  delete all[dateKey];
  writeJSON(LOGS_KEY, all);

  if (!isAccountMode()) return;

  try {
    const headers = await authHeaders();
    if (!headers) return;

    const res = await fetch(apiUrl(`/api/logs/${encodeURIComponent(dateKey)}`), {
      method: "DELETE",
      headers,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("Cloud delete failed:", res.status, txt);
      // local already removed; you could optionally restore local here, but keeping it deleted is usually fine
      return;
    }

    setCloudSyncedBanner();
  } catch (e) {
    console.warn("Cloud delete error:", e);
  }
}

// --------------------
// Assistant session (local-only for now)
// --------------------
export async function saveAssistantSession(sessionObj) {
  writeJSON(ASSIST_KEY, sessionObj || {});
  return sessionObj;
}

export async function getAssistantSession() {
  return readJSON(ASSIST_KEY, null);
}

export async function deleteAllLocalData() {
  localStorage.removeItem(LOGS_KEY);
  localStorage.removeItem(ASSIST_KEY);
  // Keep auth/session storage untouched
}