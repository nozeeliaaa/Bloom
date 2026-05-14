/**
 * db.js - Hybrid persistence:
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
import { bloomieDiagnostic } from "./bloomie-logger.js";
import { clearSyncIssue, notifySyncIssue } from "./sync-status.js";
import {
  loadBloomieMemoryLocal,
  saveBloomieMemoryLocal,
  clearBloomieMemoryLocal,
} from "./bloom-storage.js";
import {
  normalizeCustomSymptomText,
  sanitizeCustomSymptomNote,
  sanitizeCustomSymptomText,
} from "./custom-symptoms.js";

const LOGS_KEY = "bloom_daily_logs";
const ASSIST_KEY = "bloom_assistant_session";

// Set in firebaseConfig.js: window.BLOOM_API_BASE = "" (uses Vite proxy → localhost:4000)
const API_BASE = window.BLOOM_API_BASE || "";
const BIOMETRIC_LEVELS = ["low", "moderate", "high", "very_high"];

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

// In-memory cache for getAllLogs - avoids repeated API calls within the same page session
let _logsCache = null;
let _logsCacheMode = null;
let _logsInFlight = null;
let _symptomCatalogCache = null;
let _symptomCatalogFetchedAt = 0;
let _symptomCatalogByCode = new Map();
let _symptomCatalogByLabel = new Map();
const SYMPTOM_CATALOG_TTL_MS = 10 * 60 * 1000;

export function invalidateLogsCache() {
  _logsCache = null;
  _logsCacheMode = null;
  _logsInFlight = null;
}

function showSyncWarning() {
  notifySyncIssue({
    source: "cloud-save",
    message: "Cloud sync could not save that change. Bloom kept it on this device for now.",
  });
  // Show a toast warning that cloud save failed - data is local only
  if (document.getElementById("db-sync-warn")) return; // already showing
  const el = document.createElement("div");
  el.id = "db-sync-warn";
  el.style.cssText = `
    position:fixed; bottom:1.25rem; left:50%; transform:translateX(-50%);
    background:#b91c1c; color:#fff; font-weight:700; font-size:0.85rem;
    padding:0.6rem 1.1rem; border-radius:999px; z-index:9999;
    box-shadow:0 4px 16px rgba(0,0,0,0.18); max-width:90vw; text-align:center;
  `;
  el.textContent = "⚠️ Could not save to cloud - your data may be lost on logout. Check the backend is running.";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
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

function normalizeNickname(value) {
  const nickname = typeof value === "string" ? value.trim() : "";
  return nickname ? nickname.slice(0, 40) : null;
}

function extractNickname(payload = null) {
  return normalizeNickname(
    payload?.nickname ??
    payload?.profile?.nickname ??
    payload?.user?.nickname ??
    payload?.displayName ??
    null
  );
}

function loadLocalNickname() {
  try {
    const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
    return extractNickname(profile) || normalizeNickname(localStorage.getItem("bloom_user_name"));
  } catch {
    return normalizeNickname(localStorage.getItem("bloom_user_name"));
  }
}

function cacheLocalNickname(nickname, profile = null) {
  const clean = normalizeNickname(nickname);
  if (!clean) return;
  localStorage.setItem("bloom_user_name", clean);
  try {
    const existing = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
    localStorage.setItem("bloom_profile", JSON.stringify({
      ...existing,
      ...(profile && typeof profile === "object" ? profile : {}),
      nickname: clean,
    }));
  } catch {
    localStorage.setItem("bloom_profile", JSON.stringify({ nickname: clean }));
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSymptomLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function fallbackSymptomCodeFromLabel(label) {
  return String(label || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fallbackLabelFromSymptomCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSleepScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return null;
  return parsed;
}

function normalizeBiometricLevel(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isInteger(value)) {
    return BIOMETRIC_LEVELS[value - 1] ?? null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return BIOMETRIC_LEVELS.includes(normalized) ? normalized : null;
}

function indexSymptomCatalog(symptoms = []) {
  _symptomCatalogByCode = new Map();
  _symptomCatalogByLabel = new Map();

  for (const item of symptoms) {
    const code = String(item?.key || item?.id || "").trim().toUpperCase();
    const label = String(item?.label || "").trim();
    if (code) _symptomCatalogByCode.set(code, { ...item, key: code, label });
    if (label) _symptomCatalogByLabel.set(normalizeSymptomLabel(label), code);
  }
}

export async function getSymptomCatalog({ timeoutMs = 3500, force = false } = {}) {
  if (!isAccountMode()) return _symptomCatalogCache || [];

  const now = Date.now();
  if (
    !force &&
    Array.isArray(_symptomCatalogCache) &&
    _symptomCatalogCache.length > 0 &&
    now - _symptomCatalogFetchedAt < SYMPTOM_CATALOG_TTL_MS
  ) {
    return _symptomCatalogCache;
  }

  try {
    const headers = await authHeaders();
    if (!headers) return _symptomCatalogCache || [];

    const res = await fetchWithTimeout(
      apiUrl("/catalog/symptoms?teenSafe=true&excludeSensitive=true"),
      { headers },
      timeoutMs
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("Symptom catalog fetch failed:", res.status, txt);
      notifySyncIssue({
        source: "symptom-catalog",
        message: "Bloom could not refresh the symptom catalog. Saved data is still available.",
        detail: txt,
      });
      return _symptomCatalogCache || [];
    }

    const data = await res.json();
    const symptoms = Array.isArray(data?.symptoms) ? data.symptoms : [];
    _symptomCatalogCache = symptoms;
    _symptomCatalogFetchedAt = Date.now();
    indexSymptomCatalog(symptoms);
    return symptoms;
  } catch (e) {
    console.warn("Symptom catalog fetch error:", e);
    notifySyncIssue({
      source: "symptom-catalog",
      message: "Bloom could not refresh the symptom catalog. Saved data is still available.",
      detail: e?.message || "",
    });
    return _symptomCatalogCache || [];
  }
}

// Convert UI label to backend symptom code.
// Example: "Back pain" -> "BACK_PAIN"
function toSymptomCode(label) {
  const normalized = normalizeSymptomLabel(label);
  const mapped = normalized ? _symptomCatalogByLabel.get(normalized) : null;
  if (mapped) return mapped;
  return fallbackSymptomCodeFromLabel(label);
}

// Convert backend code back to readable label for UI.
// Example: "BACK_PAIN" -> "Back Pain"
function fromSymptomCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const mapped = _symptomCatalogByCode.get(normalized);
  if (mapped?.label) return mapped.label;
  return fallbackLabelFromSymptomCode(normalized);
}

// Merge cloud cycle logs + cloud symptom logs into one calendar-friendly object
function mergeCloudLogs(cycleItems = [], symptomItems = []) {
  const merged = {};

  for (const entry of cycleItems) {
    const dateKey = entry?.dateKey;
    if (!dateKey) continue;

    // Map numeric flowLevel back to string used by the frontend
    const NUM_TO_FLOW = { 0: "none", 1: "light", 2: "medium", 3: "heavy" };
    let flowStr = "none";

    if (entry.flowLevel != null) {
      flowStr = NUM_TO_FLOW[entry.flowLevel] ?? "none";
    }
    // Fallback in case backend sends string flow instead of numeric flowLevel.
    if (flowStr === "none" && entry.flow) {
      flowStr = String(entry.flow);
    }

    merged[dateKey] = {
      ...(merged[dateKey] || {}),
      date: dateKey,
      flow: flowStr,
      periodDay: Number.isFinite(Number(entry.periodDay)) ? Number(entry.periodDay) : null,
      sleepScore: normalizeSleepScore(entry.sleepScore),
      stressLevel: normalizeBiometricLevel(entry.stressLevel),
      activityLevel: normalizeBiometricLevel(entry.activityLevel),
      notes: entry.notes || "",
    };
  }

  for (const entry of symptomItems) {
    const dateKey = entry?.dateKey;
    if (!dateKey) continue;

    const symptoms = [];
    const symptomCodes = {};
    if (Array.isArray(entry.items)) {
      entry.items.forEach((it) => {
        const code = String(it?.code || "").trim().toUpperCase();
        const label = fromSymptomCode(code);
        if (!label) return;
        symptoms.push(label);
        if (code) symptomCodes[label] = code;
      });
    }

    const symptomSeverity = {};
    if (Array.isArray(entry.items)) {
      entry.items.forEach((it) => {
        const code = String(it?.code || "").trim().toUpperCase();
        const label = fromSymptomCode(code);
        if (label) symptomSeverity[label] = Number(it?.severity ?? 3);
      });
    }

    const otherSymptoms = Array.isArray(entry.otherSymptoms)
      ? entry.otherSymptoms
          .map((it) => ({
            text: sanitizeCustomSymptomText(it?.text),
            normalizedText: normalizeCustomSymptomText(it?.normalizedText || it?.text),
            severity: Number(it?.severity ?? 3),
            note: sanitizeCustomSymptomNote(it?.note),
            createdAt: typeof it?.createdAt === "string" ? it.createdAt : "",
            dateKey: it?.dateKey || dateKey,
          }))
          .filter((it) => it.text)
      : [];

    merged[dateKey] = {
      ...(merged[dateKey] || {}),
      date: dateKey,
      symptoms,
      symptomSeverity,
      symptomCodes,
      otherSymptoms,
    };
  }

  return merged;
}

function mergeLocalAndCloudLogs(localLogs = {}, cloudLogs = {}) {
  const merged = { ...(localLogs || {}) };

  for (const [dateKey, cloudEntry] of Object.entries(cloudLogs || {})) {
    const localEntry = merged[dateKey] || {};
    merged[dateKey] = {
      ...localEntry,
      ...(cloudEntry || {}),
    };

    // Do not let an incomplete cloud row erase a local period marker. This can
    // happen during migrations where older canonical docs lack period fields
    // while legacy/local data still has the user's historical flow logs.
    if (isPeriodEntry(localEntry) && !isPeriodEntry(cloudEntry)) {
      if (localEntry.flow !== undefined) merged[dateKey].flow = localEntry.flow;
      if (localEntry.flowLevel !== undefined) merged[dateKey].flowLevel = localEntry.flowLevel;
      if (localEntry.periodDay !== undefined) merged[dateKey].periodDay = localEntry.periodDay;
    }
  }

  return merged;
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isPeriodEntry(entry) {
  if (!entry) return false;
  if (entry.flow && entry.flow !== "none") return true;
  if (typeof entry.flowLevel === "number" && entry.flowLevel > 0) return true;
  if (Number.isFinite(Number(entry.periodDay)) && Number(entry.periodDay) > 0) return true;
  return entry.periodDay === true;
}

function derivePeriodDay(allLogs, dateKey) {
  const explicit = Number(allLogs?.[dateKey]?.periodDay);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  if (!isPeriodEntry(allLogs?.[dateKey])) return null;

  let start = dateKey;
  while (isPeriodEntry(allLogs?.[addDays(start, -1)])) {
    start = addDays(start, -1);
  }

  return Math.max(
    1,
    Math.round((new Date(dateKey + "T00:00:00") - new Date(start + "T00:00:00")) / 86400000) + 1
  );
}

// --------------------
// Logs API (hybrid)
// --------------------

export async function saveDailyLog(dateKey, log) {
  // Always write local first
  const all = readJSON(LOGS_KEY, {});
  const localSymptomLabels = Array.isArray(log?.symptoms) ? log.symptoms : [];
  const localSymptomCodes = {};
  localSymptomLabels.forEach((label) => {
    const code = toSymptomCode(label);
    if (code) localSymptomCodes[label] = code;
  });

  all[dateKey] = {
    ...(all[dateKey] || {}),
    ...log,
    date: dateKey,
    symptomCodes: {
      ...(all[dateKey]?.symptomCodes || {}),
      ...localSymptomCodes,
    },
  };
  writeJSON(LOGS_KEY, all);
  invalidateLogsCache();

  if (!isAccountMode()) return all[dateKey];

  try {
    // Hydrate label->code map so we send canonical backend keys when available.
    await getSymptomCatalog({ timeoutMs: 3000 }).catch(() => []);

    const headers = await authHeaders();
    if (!headers) return all[dateKey];

    const localEntry = all[dateKey];

    // Map flow string to numeric level expected by backend
    const FLOW_TO_NUM = { none: 0, spotting: 1, light: 1, medium: 2, heavy: 3 };
    const flowNum = localEntry.flow && localEntry.flow !== "none"
      ? (FLOW_TO_NUM[localEntry.flow] ?? null)
      : null;
    const periodDay = derivePeriodDay(all, dateKey);

    // 1) Save cycle data
    const cycleRes = await fetch(apiUrl(`/api/logs/${encodeURIComponent(dateKey)}`), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        periodDay,
        flowLevel: flowNum,
        sleepScore: normalizeSleepScore(localEntry.sleepScore),
        stressLevel: normalizeBiometricLevel(localEntry.stressLevel),
        activityLevel: normalizeBiometricLevel(localEntry.activityLevel),
        notes: localEntry.notes || "",
      }),
    });

    if (!cycleRes.ok) {
      const txt = await cycleRes.text().catch(() => "");
      console.warn("Cycle cloud save failed:", cycleRes.status, txt);
      showSyncWarning();
      return all[dateKey];
    }

    // 2) Save symptom data separately
    const symptomsArray = Array.isArray(localEntry.symptoms)
      ? localEntry.symptoms
      : [];
    const otherSymptomsArray = Array.isArray(localEntry.otherSymptoms)
      ? localEntry.otherSymptoms
          .map((it) => ({
            text: sanitizeCustomSymptomText(it?.text),
            normalizedText: normalizeCustomSymptomText(it?.normalizedText || it?.text),
            severity: Number(it?.severity ?? 3),
            note: sanitizeCustomSymptomNote(it?.note),
            createdAt: typeof it?.createdAt === "string" ? it.createdAt : new Date().toISOString(),
            dateKey,
          }))
          .filter((it) => it.text)
      : [];

    if (symptomsArray.length > 0) {
      const symptomCodeMap = {};
      const items = symptomsArray.map((symptom) => ({
        code: (() => {
          const code = toSymptomCode(symptom);
          if (code) symptomCodeMap[symptom] = code;
          return code;
        })(),
        severity: Number(localEntry.symptomSeverity?.[symptom] ?? 3),
        note: "",
      }));

      if (Object.keys(symptomCodeMap).length) {
        all[dateKey] = {
          ...(all[dateKey] || {}),
          symptomCodes: {
            ...(all[dateKey]?.symptomCodes || {}),
            ...symptomCodeMap,
          },
        };
        writeJSON(LOGS_KEY, all);
      }

      const symptomRes = await fetch(apiUrl(`/api/symptoms/${encodeURIComponent(dateKey)}`), {
        method: "PUT",
        headers,
        body: JSON.stringify({ items, otherSymptoms: otherSymptomsArray }),
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
    invalidateLogsCache();
    return all[dateKey];
  } catch (e) {
    console.warn("Cloud save error:", e);
    showSyncWarning();
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

export async function getAllLogs({ timeoutMs = 4500 } = {}) {
  const local = readJSON(LOGS_KEY, {});

  if (!isAccountMode()) return local;

  // Return cached result if available for this session
  if (_logsCache && _logsCacheMode === "account") return _logsCache;
  // Reuse in-flight fetch so dashboard bootstrap + notifications don't duplicate calls
  if (_logsInFlight) return _logsInFlight;

  _logsInFlight = (async () => {
    try {
      const headers = await authHeaders();
      if (!headers) return local;
      const catalogPromise = getSymptomCatalog({ timeoutMs: Math.min(timeoutMs, 3500) }).catch(() => []);

      const [cycleRes, symptomRes] = await Promise.all([
        fetchWithTimeout(apiUrl("/api/logs"), { headers }, timeoutMs),
        fetchWithTimeout(apiUrl("/api/symptoms"), { headers }, timeoutMs),
      ]);
      await catalogPromise;

      if (!cycleRes.ok) {
        const txt = await cycleRes.text().catch(() => "");
        console.warn("Cycle cloud fetch failed:", cycleRes.status, txt);
        notifySyncIssue({
          source: "cycle-logs",
          message: "Bloom could not load your cloud cycle logs. Showing saved local data for now.",
          detail: txt,
        });
        return local;
      }

      if (!symptomRes.ok) {
        const txt = await symptomRes.text().catch(() => "");
        console.warn("Symptom cloud fetch failed:", symptomRes.status, txt);
        notifySyncIssue({
          source: "symptom-logs",
          message: "Bloom could not load your cloud symptom logs. Showing saved local data for now.",
          detail: txt,
        });
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

      const cloudLogs = mergeCloudLogs(cycleItems, symptomItems);
      const logs = mergeLocalAndCloudLogs(local, cloudLogs);

      // Only overwrite local cache if cloud actually returned data.
      // If cloud is empty but local has entries, keep local to avoid
      // wiping logs that were saved before a sync had a chance to run.
      if (Object.keys(cloudLogs).length > 0) {
        writeJSON(LOGS_KEY, logs);
        setCloudSyncedBanner();
        clearSyncIssue("logs");
        _logsCache = logs;
        _logsCacheMode = "account";
        return logs;
      }

      return local;
    } catch (e) {
      console.warn("Cloud fetch error:", e);
      notifySyncIssue({
        source: "logs",
        message: "Bloom could not reach cloud sync. Showing saved local data for now.",
        detail: e?.message || "",
      });
      return local;
    } finally {
      _logsInFlight = null;
    }
  })();

  return _logsInFlight;
}

export async function deleteDailyLog(dateKey) {
  const all = readJSON(LOGS_KEY, {});
  delete all[dateKey];
  writeJSON(LOGS_KEY, all);
  invalidateLogsCache();

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

/**
 * getOrInitBloomieMemory()
 * Reads Bloomie memory from versioned local storage and migrates legacy keys.
 */
export function getOrInitBloomieMemory() {
  return loadBloomieMemoryLocal();
}

/**
 * updateBloomieLocalMemory(patch)
 * Merges patch into the versioned Bloomie memory cache and persists it.
 */
export function updateBloomieLocalMemory(patch) {
  return saveBloomieMemoryLocal(patch || {}, { replace: false });
}

export function loadLocalBloomieMemory() {
  return loadBloomieMemoryLocal();
}

export function saveLocalBloomieMemory(update) {
  saveBloomieMemoryLocal(update || {}, { replace: false });
}

// --------------------
// Bloomie persistent memory
// --------------------

// Load the last session snapshot. Tries Firestore first (account mode),
// falls back to localStorage for anon/offline.
export async function loadBloomieMemory() {
  const local = loadBloomieMemoryLocal();
  if (!isAccountMode()) return local;
  try {
    const headers = await authHeaders();
    if (!headers) return local;
    const res = await fetch(apiUrl("/api/bloomie-memory"), { headers });
    if (!res.ok) {
      bloomieDiagnostic("memory_load_failed", {
        module: "db",
        stage:  "loadBloomieMemory",
        reason: `backend returned ${res.status}`,
        fallbackTarget: "local_memory",
      });
      notifySyncIssue({
        source: "bloomie-memory",
        message: "Bloomie could not load cloud memory. The chat will use what is saved on this device.",
      });
      return local;
    }
    const data = await res.json();
    if (data && typeof data === "object") {
      const merged = mergeBloomieMemoryForContinuity(local, data);
      return saveBloomieMemoryLocal(merged, { replace: true });
    }
    return local;
  } catch (err) {
    bloomieDiagnostic("memory_load_failed", {
      module: "db",
      stage:  "loadBloomieMemory",
      reason: err?.message ?? "network error",
      fallbackTarget: "local_memory",
    });
    notifySyncIssue({
      source: "bloomie-memory",
      message: "Bloomie could not load cloud memory. The chat will use what is saved on this device.",
      detail: err?.message || "",
    });
    return local;
  }
}

function hasMeaningfulBloomieMemory(memory) {
  if (!memory || typeof memory !== "object") return false;
  return Boolean(
    memory.lastSessionDate ||
    memory.lastIntent ||
    memory.lastPatternSummary ||
    memory.lastGreetingUsed ||
    (Array.isArray(memory.lastSymptoms) && memory.lastSymptoms.length > 0) ||
    (Array.isArray(memory.recentTopics) && memory.recentTopics.length > 0) ||
    (Array.isArray(memory.reportedConditions) && memory.reportedConditions.length > 0) ||
    Number(memory.sessionCount || 0) > 0
  );
}

function mergeBloomieMemoryForContinuity(local, remote) {
  const remoteHasMemory = hasMeaningfulBloomieMemory(remote);
  const localHasMemory = hasMeaningfulBloomieMemory(local);
  if (!remoteHasMemory && localHasMemory) return local;

  const merged = { ...(local || {}), ...(remote || {}) };
  const arrayFields = [
    "lastSymptoms",
    "lastSymptomTopics",
    "recentTopics",
    "contentSuggestionsShown",
    "declinedSuggestions",
    "reportedConditions",
  ];
  for (const key of arrayFields) {
    const remoteArr = Array.isArray(remote?.[key]) ? remote[key] : [];
    const localArr = Array.isArray(local?.[key]) ? local[key] : [];
    merged[key] = remoteArr.length ? remoteArr : localArr;
  }

  const localSessionCount = Number(local?.sessionCount || 0);
  const remoteSessionCount = Number(remote?.sessionCount || 0);
  merged.sessionCount = Math.max(localSessionCount, remoteSessionCount);

  if (!remote?.lastSessionDate && local?.lastSessionDate) {
    merged.lastSessionDate = local.lastSessionDate;
  }
  if (!remote?.lastSymptomsAt && local?.lastSymptomsAt) {
    merged.lastSymptomsAt = local.lastSymptomsAt;
  }

  return merged;
}

// Save a compact memory snapshot. Always writes to localStorage,
// and syncs to Firestore in account mode.
// Uses merge semantics for localStorage so a partial update from
// persistMemory() does not overwrite fields it did not touch.
export async function saveBloomieMemory(memoryData) {
  if (!memoryData) return;
  saveBloomieMemoryLocal(memoryData, { replace: false });
  if (!isAccountMode()) return;
  try {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await fetch(apiUrl("/api/bloomie-memory"), {
      method: "PUT",
      headers,
      body: JSON.stringify(memoryData),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      notifySyncIssue({
        source: "bloomie-memory",
        message: "Bloomie could not save memory to cloud. This chat is still active on this device.",
        detail: txt,
      });
    }
  } catch (err) {
    bloomieDiagnostic("cache_write_failed", {
      module: "db",
      stage:  "saveBloomieMemory",
      reason: err?.message ?? "network error",
    });
    notifySyncIssue({
      source: "bloomie-memory",
      message: "Bloomie could not save memory to cloud. This chat is still active on this device.",
      detail: err?.message || "",
    });
  }
}

// Load the authenticated user's profile (nickname) from the backend.
// Returns { nickname: string | null }. Never throws.
export async function loadUserProfile() {
  try {
    const headers = await authHeaders();
    if (!headers) return { nickname: loadLocalNickname() };
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000)
    );
    const request = fetch(apiUrl("/api/user/profile"), { headers });
    const res = await Promise.race([request, timeout]);
    if (!res.ok) {
      bloomieDiagnostic("profile_sync_failed", {
        module: "db",
        stage:  "loadUserProfile",
        reason: `backend returned ${res.status}`,
      });
      notifySyncIssue({
        source: "profile",
        message: "Bloom could not refresh your cloud profile. Using saved local details for now.",
      });
      return { nickname: loadLocalNickname() };
    }
    const data = await res.json();
    const profile = data?.profile || data || null;
    const nickname = extractNickname(data);
    cacheLocalNickname(nickname, profile);
    return { nickname, profile };
  } catch (err) {
    bloomieDiagnostic("profile_sync_failed", {
      module: "db",
      stage:  "loadUserProfile",
      reason: err?.message ?? "network error or timeout",
    });
    notifySyncIssue({
      source: "profile",
      message: "Bloom could not refresh your cloud profile. Using saved local details for now.",
      detail: err?.message || "",
    });
    return { nickname: loadLocalNickname() };
  }
}

export async function deleteAllLocalData() {
  localStorage.removeItem(LOGS_KEY);
  localStorage.removeItem(ASSIST_KEY);
  clearBloomieMemoryLocal();
  invalidateLogsCache();
}

export async function clearAllLogs() {
  writeJSON(LOGS_KEY, {});
  invalidateLogsCache();

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
