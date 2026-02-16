/**
 * db.js — Frontend-only data persistence (localStorage).
 *
 * This keeps the UI functional without doing any backend/Firestore syncing.
 * Auth can remain real (Firebase Auth), but all app data stays on-device.
 */
const LOGS_KEY = "bloom_daily_logs";
const ASSIST_KEY = "bloom_assistant_session";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Save a daily log for a specific dateKey (YYYY-MM-DD).
 * @param {string} dateKey
 * @param {object} log
 */
export async function saveDailyLog(dateKey, log) {
  const all = readJSON(LOGS_KEY, {});
  all[dateKey] = { ...(all[dateKey] || {}), ...log, date: dateKey };
  writeJSON(LOGS_KEY, all);
  return all[dateKey];
}

export async function getDailyLog(dateKey) {
  const all = readJSON(LOGS_KEY, {});
  return all[dateKey] || null;
}

export async function getAllLogs() {
  return readJSON(LOGS_KEY, {});
}

export async function deleteDailyLog(dateKey) {
  const all = readJSON(LOGS_KEY, {});
  delete all[dateKey];
  writeJSON(LOGS_KEY, all);
}

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
