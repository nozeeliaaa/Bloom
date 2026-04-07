/**
 * bloom-storage.js
 * Centralized client-side storage helpers for Bloom/Bloomie.
 *
 * Goals:
 * - Keep key ownership explicit
 * - Handle corrupt JSON safely
 * - Add schema/version awareness for long-lived cached objects
 * - Support defensive migration from legacy keys
 */

export const BLOOM_STORAGE_KEYS = {
  // Bloomie memory (authoritative local cache)
  BLOOMIE_MEMORY_V2: "bloomie_state_v2",
  // Deprecated Bloomie memory keys kept for migration/read compatibility
  BLOOMIE_MEMORY_LEGACY: ["bloomieMemory", "bloom_bloomie_memory"],
  // Shared app preferences cache
  PREFERENCES: "bloom_preferences",
  // Canonical debug toggle (legacy alias still read)
  BLOOMIE_DEBUG: "BLOOMIE_DEBUG",
  BLOOMIE_DEBUG_LEGACY: "bloomie_debug",
};

export const BLOOMIE_MEMORY_SCHEMA_VERSION = 2;
export const BLOOM_PREFERENCES_SCHEMA_VERSION = 2;

export const BLOOMIE_MEMORY_DEFAULTS = {
  uid:                    null,
  sessionCount:           0,
  lastSessionDate:        null,
  lastIntent:             null,
  lastPatternSummary:     null,
  lastSeverity:           null,
  lastUrgencyLevel:       null,
  lastRedFlagRoute:       null,
  lastDuration:           null,
  lastPregnancyChance:    false,
  lastSymptoms:           [],
  recentTopics:           [],
  recentConcernCategory:  null,
  urgentFlag:             false,
  redFlagNoticeShown:     false,
  lastOosCategory:        null,
  oosCount:               0,
  lastSafeRedirect:       null,
  lastResolutionStatus:   null,
  closeIntentDetected:    false,
  lastGreetingUsed:       null,
  contentSuggestionsShown: [],
  declinedSuggestions:    [],
  reportedConditions:     [],
  activeTopicCluster:     null,
};

function safeParseJSON(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readLocalJSON(key, fallback = null) {
  return safeParseJSON(window.localStorage?.getItem(key) ?? null, fallback);
}

function writeLocalJSON(key, value) {
  window.localStorage?.setItem(key, JSON.stringify(value));
}

function coerceByDefault(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
  if (typeof fallback === "boolean") return typeof value === "boolean" ? value : fallback;
  if (typeof fallback === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof fallback === "string") return typeof value === "string" ? value : fallback;
  if (fallback === null) {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    return null;
  }
  return fallback;
}

export function normalizeBloomieMemory(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const next = { ...BLOOMIE_MEMORY_DEFAULTS };
  for (const [key, fallback] of Object.entries(BLOOMIE_MEMORY_DEFAULTS)) {
    next[key] = coerceByDefault(src[key], fallback);
  }
  next.lastSymptoms = next.lastSymptoms.filter(v => typeof v === "string").slice(0, 50);
  next.recentTopics = next.recentTopics.filter(v => typeof v === "string").slice(0, 50);
  next.contentSuggestionsShown = next.contentSuggestionsShown.filter(v => typeof v === "string").slice(0, 100);
  next.declinedSuggestions = next.declinedSuggestions.filter(v => typeof v === "string").slice(0, 100);
  next.reportedConditions = next.reportedConditions.filter(v => typeof v === "string").slice(0, 30);
  return next;
}

function toMemoryEnvelope(data) {
  return {
    schemaVersion: BLOOMIE_MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    data: normalizeBloomieMemory(data),
  };
}

export function loadBloomieMemoryLocal() {
  const primary = readLocalJSON(BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_V2, null);
  if (primary && typeof primary === "object") {
    const payload = (typeof primary.schemaVersion === "number" && primary.data)
      ? primary.data
      : primary;
    const normalized = normalizeBloomieMemory(payload);
    writeLocalJSON(BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_V2, toMemoryEnvelope(normalized));
    return normalized;
  }

  for (const legacyKey of BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_LEGACY) {
    const legacy = readLocalJSON(legacyKey, null);
    if (legacy && typeof legacy === "object") {
      const normalized = normalizeBloomieMemory(legacy);
      writeLocalJSON(BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_V2, toMemoryEnvelope(normalized));
      return normalized;
    }
  }

  const defaults = normalizeBloomieMemory(BLOOMIE_MEMORY_DEFAULTS);
  writeLocalJSON(BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_V2, toMemoryEnvelope(defaults));
  return defaults;
}

export function saveBloomieMemoryLocal(memoryData, { replace = false } = {}) {
  const base = replace ? BLOOMIE_MEMORY_DEFAULTS : loadBloomieMemoryLocal();
  const merged = normalizeBloomieMemory({ ...base, ...(memoryData || {}) });
  writeLocalJSON(BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_V2, toMemoryEnvelope(merged));
  return merged;
}

export function clearBloomieMemoryLocal() {
  window.localStorage?.removeItem(BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_V2);
  for (const key of BLOOM_STORAGE_KEYS.BLOOMIE_MEMORY_LEGACY) {
    window.localStorage?.removeItem(key);
  }
}

function normalizeBloomPreferences(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const reminders = typeof src.reminders === "object" && src.reminders
    ? src.reminders
    : null;
  return {
    theme: (typeof src.theme === "string" ? src.theme : null),
    reminders: Boolean(reminders?.enabled ?? src.reminders),
    periodReminder: Boolean(reminders?.types?.includes("PERIOD_SOON") ?? src.periodReminder),
    fertileAlert: Boolean(reminders?.types?.includes("FERTILE_WINDOW") ?? src.fertileAlert),
    discreetNotif: Boolean(reminders?.discreetCopy ?? src.discreetNotif),
  };
}

export function loadBloomPreferencesLocal() {
  const parsed = readLocalJSON(BLOOM_STORAGE_KEYS.PREFERENCES, null);
  if (!parsed || typeof parsed !== "object") return {};
  const payload = (typeof parsed.schemaVersion === "number" && parsed.data)
    ? parsed.data
    : parsed;
  return normalizeBloomPreferences(payload);
}

export function saveBloomPreferencesLocal(prefs) {
  const normalized = normalizeBloomPreferences(prefs);
  writeLocalJSON(BLOOM_STORAGE_KEYS.PREFERENCES, {
    schemaVersion: BLOOM_PREFERENCES_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    data: normalized,
  });
  return normalized;
}

export function clearBloomPreferencesLocal() {
  window.localStorage?.removeItem(BLOOM_STORAGE_KEYS.PREFERENCES);
}

export function isBloomieDebugEnabled() {
  const canonical = window.localStorage?.getItem(BLOOM_STORAGE_KEYS.BLOOMIE_DEBUG) === "true";
  if (canonical) return true;
  const legacy = window.localStorage?.getItem(BLOOM_STORAGE_KEYS.BLOOMIE_DEBUG_LEGACY) === "true";
  if (legacy) {
    window.localStorage?.setItem(BLOOM_STORAGE_KEYS.BLOOMIE_DEBUG, "true");
    return true;
  }
  return false;
}

