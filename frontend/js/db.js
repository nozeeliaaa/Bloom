/**
 * db.js — Hybrid persistence:
 * - anon mode: localStorage only
 * - account mode: sync to backend using Firebase ID token
 *
 * Backend endpoints used:
 * - GET    /api/logs
 * - PUT    /api/logs/:dateKey
 * - DELETE /api/logs/:dateKey
 * - GET    /api/symptoms
 * - PUT    /api/symptoms/:dateKey
 * - DELETE /api/symptoms/:dateKey
 */

import { getIdToken } from "./auth.js";
import { isAccountMode } from "./mode.js";
import { MODE_BANNER_ONCE_KEY } from "./utils.js";

const LOGS_KEY = "bloom_daily_logs";
const ASSIST_KEY = "bloom_assistant_session";
const MEMORY_KEY = "bloom_bloomie_memory";

// Set in firebaseConfig.js: window.BLOOM_API_BASE = "http://localhost:4000";
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

// Convert UI label to backend symptom code.
// Example: "Back pain" -> "BACK_PAIN"
function toSymptomCode(label) {
  return String(label || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Convert backend code back to readable label for UI.
// Example: "BACK_PAIN" -> "Back Pain"
function fromSymptomCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Merge cloud cycle logs + cloud symptom logs into one calendar-friendly object
function mergeCloudLogs(cycleItems = [], symptomItems = []) {
  const merged = {};

  for (const entry of cycleItems) {
    const dateKey = entry?.dateKey;
    if (!dateKey) continue;

    merged[dateKey] = {
      ...(merged[dateKey] || {}),
      date: dateKey,
      flow:
        entry.flowLevel && entry.flowLevel !== "none"
          ? entry.flowLevel
          : "none",
      notes: entry.notes || "",
    };
  }

  for (const entry of symptomItems) {
    const dateKey = entry?.dateKey;
    if (!dateKey) continue;

    const symptoms = Array.isArray(entry.items)
      ? entry.items.map((it) => fromSymptomCode(it?.code)).filter(Boolean)
      : [];

    const symptomSeverity = {};
    if (Array.isArray(entry.items)) {
      entry.items.forEach((it) => {
        const label = fromSymptomCode(it?.code);
        if (label) symptomSeverity[label] = Number(it?.severity ?? 3);
      });
    }

    merged[dateKey] = {
      ...(merged[dateKey] || {}),
      date: dateKey,
      symptoms,
      symptomSeverity,
    };
  }

  return merged;
}

// --------------------
// Logs API (hybrid)
// --------------------

export async function saveDailyLog(dateKey, log) {
  // Always write local first
  const all = readJSON(LOGS_KEY, {});
  all[dateKey] = { ...(all[dateKey] || {}), ...log, date: dateKey };
  writeJSON(LOGS_KEY, all);

  if (!isAccountMode()) return all[dateKey];

  try {
    const headers = await authHeaders();
    if (!headers) return all[dateKey];

    const localEntry = all[dateKey];

    // 1) Save cycle data
    const cycleRes = await fetch(apiUrl(`/api/logs/${encodeURIComponent(dateKey)}`), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        flowLevel:
          localEntry.flow && localEntry.flow !== "none"
            ? localEntry.flow
            : null,
        notes: localEntry.notes || "",
      }),
    });

    if (!cycleRes.ok) {
      const txt = await cycleRes.text().catch(() => "");
      console.warn("Cycle cloud save failed:", cycleRes.status, txt);
      return all[dateKey];
    }

    // 2) Save symptom data separately
    const symptomsArray = Array.isArray(localEntry.symptoms)
      ? localEntry.symptoms
      : [];

    if (symptomsArray.length > 0) {
      const items = symptomsArray.map((symptom) => ({
        code: toSymptomCode(symptom),
        severity: Number(localEntry.symptomSeverity?.[symptom] ?? 3),
        note: "",
      }));

      const symptomRes = await fetch(apiUrl(`/api/symptoms/${encodeURIComponent(dateKey)}`), {
        method: "PUT",
        headers,
        body: JSON.stringify({ items }),
      });

      if (!symptomRes.ok) {
        const txt = await symptomRes.text().catch(() => "");
        console.warn("Symptom cloud save failed:", symptomRes.status, txt);
      }
    } else {
      // If user removed all symptoms for that day, delete backend symptom entry
      const symptomDeleteRes = await fetch(
        apiUrl(`/api/symptoms/${encodeURIComponent(dateKey)}`),
        {
          method: "DELETE",
          headers,
        }
      );

      if (!symptomDeleteRes.ok && symptomDeleteRes.status !== 404) {
        const txt = await symptomDeleteRes.text().catch(() => "");
        console.warn("Symptom cloud delete failed:", symptomDeleteRes.status, txt);
      }
    }

    setCloudSyncedBanner();
    return all[dateKey];
  } catch (e) {
    console.warn("Cloud save error:", e);
    return all[dateKey];
  }
}

export async function getDailyLog(dateKey) {
  if (isAccountMode()) {
    const all = await getAllLogs();
    return all[dateKey] || null;
  }
  const all = readJSON(LOGS_KEY, {});
  return all[dateKey] || null;
}

export async function getAllLogs() {
  const local = readJSON(LOGS_KEY, {});

  if (!isAccountMode()) return local;

  try {
    const headers = await authHeaders();
    if (!headers) return local;

    const [cycleRes, symptomRes] = await Promise.all([
      fetch(apiUrl("/api/logs"), { headers }),
      fetch(apiUrl("/api/symptoms"), { headers }),
    ]);

    if (!cycleRes.ok) {
      const txt = await cycleRes.text().catch(() => "");
      console.warn("Cycle cloud fetch failed:", cycleRes.status, txt);
      return local;
    }

    if (!symptomRes.ok) {
      const txt = await symptomRes.text().catch(() => "");
      console.warn("Symptom cloud fetch failed:", symptomRes.status, txt);
      return local;
    }

    const cycleData = await cycleRes.json();
    const symptomData = await symptomRes.json();

    let cycleItems = [];
    if (Array.isArray(cycleData?.items)) {
      cycleItems = cycleData.items;
    } else if (cycleData?.entries && typeof cycleData.entries === "object") {
      cycleItems = Object.entries(cycleData.entries).map(([dateKey, entry]) => ({
        dateKey,
        ...entry,
      }));
    }

    const symptomItems = Array.isArray(symptomData?.items) ? symptomData.items : [];

    const logs = mergeCloudLogs(cycleItems, symptomItems);

    writeJSON(LOGS_KEY, logs);
    setCloudSyncedBanner();

    return logs;
  } catch (e) {
    console.warn("Cloud fetch error:", e);
    return local;
  }
}

export async function deleteDailyLog(dateKey) {
  const all = readJSON(LOGS_KEY, {});
  delete all[dateKey];
  writeJSON(LOGS_KEY, all);

  if (!isAccountMode()) return;

  try {
    const headers = await authHeaders();
    if (!headers) return;

    const [cycleRes, symptomRes] = await Promise.all([
      fetch(apiUrl(`/api/logs/${encodeURIComponent(dateKey)}`), {
        method: "DELETE",
        headers,
      }),
      fetch(apiUrl(`/api/symptoms/${encodeURIComponent(dateKey)}`), {
        method: "DELETE",
        headers,
      }),
    ]);

    if (!cycleRes.ok) {
      const txt = await cycleRes.text().catch(() => "");
      console.warn("Cycle cloud delete failed:", cycleRes.status, txt);
    }

    if (!symptomRes.ok && symptomRes.status !== 404) {
      const txt = await symptomRes.text().catch(() => "");
      console.warn("Symptom cloud delete failed:", symptomRes.status, txt);
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

// --------------------
// Bloomie local memory defaults
// --------------------

const BLOOMIE_MEMORY_KEY = "bloomieMemory";

export const BLOOMIE_MEMORY_DEFAULTS = {
  lastSymptoms:           [],
  recentTopics:           [],
  lastIntent:             null,
  lastSeverity:           null,
  lastDuration:           null,
  lastPregnancyChance:    false,
  lastUrgencyLevel:       null,
  recentConcernCategory:  null,
  lastSessionDate:        null,
};

/**
 * getOrInitBloomieMemory()
 * Reads "bloomieMemory" from localStorage.
 * Seeds and returns BLOOMIE_MEMORY_DEFAULTS when the key is absent or corrupt.
 */
export function getOrInitBloomieMemory() {
  const stored = readJSON(BLOOMIE_MEMORY_KEY, null);
  if (stored) return stored;
  writeJSON(BLOOMIE_MEMORY_KEY, BLOOMIE_MEMORY_DEFAULTS);
  return { ...BLOOMIE_MEMORY_DEFAULTS };
}

/**
 * updateBloomieLocalMemory(patch)
 * Merges patch into the stored "bloomieMemory" object and persists it.
 */
export function updateBloomieLocalMemory(patch) {
  const current = getOrInitBloomieMemory();
  const updated  = { ...current, ...patch };
  writeJSON(BLOOMIE_MEMORY_KEY, updated);
  return updated;
}

export function loadLocalBloomieMemory() {
  try {
    const data = localStorage.getItem("bloomieMemory");
    if (!data) return {};
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveLocalBloomieMemory(update) {
  try {
    const existing = loadLocalBloomieMemory();
    const merged = { ...existing, ...update };
    localStorage.setItem("bloomieMemory", JSON.stringify(merged));
  } catch {}
}

// --------------------
// Bloomie persistent memory
// --------------------

// Load the last session snapshot. Tries Firestore first (account mode),
// falls back to localStorage for anon/offline.
export async function loadBloomieMemory() {
  const local = readJSON(MEMORY_KEY, null);
  if (!isAccountMode()) return local;
  try {
    const headers = await authHeaders();
    if (!headers) return local;
    const res = await fetch(apiUrl("/api/bloomie-memory"), { headers });
    if (!res.ok) return local;
    const data = await res.json();
    if (data) writeJSON(MEMORY_KEY, data);
    return data;
  } catch {
    return local;
  }
}

// Save a compact memory snapshot. Always writes to localStorage,
// and syncs to Firestore in account mode.
export async function saveBloomieMemory(memoryData) {
  if (!memoryData) return;
  writeJSON(MEMORY_KEY, memoryData);
  if (!isAccountMode()) return;
  try {
    const headers = await authHeaders();
    if (!headers) return;
    await fetch(apiUrl("/api/bloomie-memory"), {
      method: "PUT",
      headers,
      body: JSON.stringify(memoryData),
    });
  } catch (e) {
    console.warn("[Bloomie] memory cloud save failed:", e);
  }
}

// Load the authenticated user's profile (nickname) from the backend.
// Returns { nickname: string | null }. Never throws.
export async function loadUserProfile() {
  try {
    const headers = await authHeaders();
    if (!headers) return { nickname: null };
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000)
    );
    const request = fetch(apiUrl("/api/user/profile"), { headers });
    const res = await Promise.race([request, timeout]);
    if (!res.ok) return { nickname: null };
    const data = await res.json();
    return { nickname: data?.nickname ?? null };
  } catch {
    return { nickname: null };
  }
}

export async function deleteAllLocalData() {
  localStorage.removeItem(LOGS_KEY);
  localStorage.removeItem(ASSIST_KEY);
  localStorage.removeItem(MEMORY_KEY);
}

export async function clearAllLogs() {
  writeJSON(LOGS_KEY, {});

  if (!isAccountMode()) return;

  try {
    const headers = await authHeaders();
    if (!headers) return;

    const [cycleRes, symptomRes] = await Promise.all([
      fetch(apiUrl("/api/logs"), { headers }),
      fetch(apiUrl("/api/symptoms"), { headers }),
    ]);

    if (cycleRes.ok) {
      const cycleData = await cycleRes.json();
      const cycleItems = Array.isArray(cycleData?.items)
        ? cycleData.items
        : cycleData?.entries && typeof cycleData.entries === "object"
          ? Object.entries(cycleData.entries).map(([dateKey, entry]) => ({
              dateKey,
              ...entry,
            }))
          : [];

      await Promise.all(
        cycleItems
          .filter((entry) => entry?.dateKey)
          .map((entry) =>
            fetch(apiUrl(`/api/logs/${encodeURIComponent(entry.dateKey)}`), {
              method: "DELETE",
              headers,
            })
          )
      );
    }

    if (symptomRes.ok) {
      const symptomData = await symptomRes.json();
      const symptomItems = Array.isArray(symptomData?.items) ? symptomData.items : [];

      await Promise.all(
        symptomItems
          .filter((entry) => entry?.dateKey)
          .map((entry) =>
            fetch(apiUrl(`/api/symptoms/${encodeURIComponent(entry.dateKey)}`), {
              method: "DELETE",
              headers,
            })
          )
      );
    }
  } catch (e) {
    console.warn("Cloud clear error:", e);
  }
}