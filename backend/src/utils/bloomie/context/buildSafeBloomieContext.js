/**
 * src/utils/bloomie/context/buildSafeBloomieContext.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds a clean, runtime-only context object for Bloomie from multiple
 * Firestore sources. The result is never persisted - it is assembled fresh
 * per request and discarded after use.
 *
 * Critical rules
 * ──────────────
 * • This context is NOT stored in Bloomie memory.
 * • It does NOT duplicate user-profile or cycle data into bloomieMemory.
 * • It does NOT expose Firestore document structure (no .id, .ref, .metadata).
 * • It never throws - every field degrades gracefully to null / [].
 * • No business logic: no rules engine, no routing, no clinical decisions.
 *
 * Firestore reads (always parallel, never nested)
 * ────────────────────────────────────────────────
 *  1. users/{uid}                         → accountMode, nickname (users/{uid}.profile.nickname)
 *  3. cycleLogs/{uid}/entries (last 90d)  → LMP, avg cycle length
 *  4. symptomLogs/{uid}/entries (last 7d) → recent symptom codes
 *  5. bloomieMemory/{uid}                 → lastSessionDate, lastIntent
 */

import { db } from "../../../firebaseAdmin.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** How many days of cycle logs to fetch when computing LMP / avg length. */
const CYCLE_LOOKBACK_DAYS = 90;

/** How many days of symptom logs to surface as recent activity. */
const SYMPTOM_LOOKBACK_DAYS = 7;

/** Maximum symptom codes returned (prevents bloat). */
const MAX_SYMPTOM_CODES = 15;

/** Minimum period-start entries needed to compute an average cycle length. */
const MIN_ENTRIES_FOR_AVG = 2;

/** Average cycle length assumed when data is insufficient. */
const DEFAULT_CYCLE_LENGTH = 28;

// Whitelist of valid YYYY-MM-DD date strings (already enforced at write time;
// double-checked here so no malformed key ever reaches date arithmetic).
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// String helpers
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeString(raw, maxLen = 100) {
  if (typeof raw !== "string") return null;
  let s = raw
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/<script\b[^>]*>.*?<\/script>/gis, "")
    .replace(/<style\b[^>]*>.*?<\/style>/gis, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, maxLen);
  return s.length > 0 ? s : null;
}

function toDateString(value) {
  if (!value) return null;
  let d;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "object" && typeof value.toDate === "function") {
    d = value.toDate();
  } else if (typeof value === "string") {
    if (DATE_KEY_RE.test(value)) return value;
    d = new Date(value);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgo(days) {
  return addDays(todayString(), -days);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeCycleStats(entries) {
  const starts = entries
    .filter(e =>
      typeof e.periodDay === "number" &&
      e.periodDay === 1 &&
      typeof e.dateKey === "string" &&
      DATE_KEY_RE.test(e.dateKey)
    )
    .map(e => e.dateKey)
    .sort()
    .reverse();

  if (starts.length === 0) return { lmpDate: null, avgCycleLength: null };

  const lmpDate = starts[0];

  if (starts.length < MIN_ENTRIES_FOR_AVG) {
    return { lmpDate, avgCycleLength: null };
  }

  const gaps = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const later   = new Date(starts[i]     + "T00:00:00Z");
    const earlier = new Date(starts[i + 1] + "T00:00:00Z");
    const gap = Math.round((later - earlier) / 86400000);
    if (gap >= 18 && gap <= 45) gaps.push(gap);
  }

  if (gaps.length === 0) return { lmpDate, avgCycleLength: null };

  const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  return { lmpDate, avgCycleLength: avg };
}

function computePredictions(lmpDate, avgCycleLength) {
  if (!lmpDate) {
    return { predictedNextPeriod: null, predictedOvulation: null, phase: null };
  }

  const cycleLen = avgCycleLength ?? DEFAULT_CYCLE_LENGTH;
  const today = new Date(todayString() + "T00:00:00Z");
  const lmp   = new Date(lmpDate + "T00:00:00Z");

  const dayOfCycle = Math.floor((today - lmp) / 86400000) + 1;

  const predictedNextPeriod = toDateString(addDays(lmpDate, cycleLen));
  const predictedOvulation  = toDateString(addDays(lmpDate, cycleLen - 14));

  let phase = null;
  if (dayOfCycle >= 1 && dayOfCycle <= 5)             phase = "menstrual";
  else if (dayOfCycle >= 6 && dayOfCycle <= 12)        phase = "follicular";
  else if (dayOfCycle >= 13 && dayOfCycle <= 15)       phase = "ovulation";
  else if (dayOfCycle >= 16 && dayOfCycle <= cycleLen) phase = "luteal";

  return { predictedNextPeriod, predictedOvulation, phase };
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUserProfile(uid) {
  try {
    const userDoc = await db.collection("users").doc(uid).get();

    const profileData = userDoc.exists ? (userDoc.data()?.profile ?? {}) : {};
    const accountMode = sanitizeString(profileData.mode, 20);
    // nickname is written by POST /api/user/profile into users/{uid}.profile.nickname
    const nickname    = sanitizeString(profileData.nickname ?? null, 30);

    return { nickname, accountMode };
  } catch (err) {
    console.error(`[buildSafeBloomieContext] fetchUserProfile uid=${uid}`, err.message ?? err);
    return { nickname: null, accountMode: null };
  }
}

async function fetchCycleData(uid) {
  try {
    const snap = await db
      .collection("cycleLogs")
      .doc(uid)
      .collection("entries")
      .where("dateKey", ">=", nDaysAgo(CYCLE_LOOKBACK_DAYS))
      .orderBy("dateKey", "desc")
      .limit(90)
      .get();

    if (snap.empty) {
      return {
        lastPeriodDate: null, avgCycleLength: null,
        predictedNextPeriod: null, predictedOvulation: null, phase: null,
      };
    }

    const entries = snap.docs.map(d => d.data());
    const { lmpDate, avgCycleLength } = computeCycleStats(entries);
    const { predictedNextPeriod, predictedOvulation, phase } = computePredictions(lmpDate, avgCycleLength);

    return {
      lastPeriodDate:      lmpDate ?? null,
      avgCycleLength:      avgCycleLength ?? null,
      predictedNextPeriod: predictedNextPeriod ?? null,
      predictedOvulation:  predictedOvulation ?? null,
      phase:               phase ?? null,
    };
  } catch (err) {
    console.error(`[buildSafeBloomieContext] fetchCycleData uid=${uid}`, err.message ?? err);
    return {
      lastPeriodDate: null, avgCycleLength: null,
      predictedNextPeriod: null, predictedOvulation: null, phase: null,
    };
  }
}

async function fetchRecentSymptoms(uid) {
  try {
    const snap = await db
      .collection("symptomLogs")
      .doc(uid)
      .collection("entries")
      .where("dateKey", ">=", nDaysAgo(SYMPTOM_LOOKBACK_DAYS))
      .orderBy("dateKey", "desc")
      .limit(7)
      .get();

    if (snap.empty) return [];

    const seen = new Set();
    for (const doc of snap.docs) {
      const items = doc.data()?.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const code = typeof item?.code === "string" ? item.code.trim().toUpperCase() : null;
        if (code && code.length > 0 && code.length <= 60) seen.add(code);
        if (seen.size >= MAX_SYMPTOM_CODES) break;
      }
      if (seen.size >= MAX_SYMPTOM_CODES) break;
    }

    return [...seen];
  } catch (err) {
    console.error(`[buildSafeBloomieContext] fetchRecentSymptoms uid=${uid}`, err.message ?? err);
    return [];
  }
}

async function fetchBloomieMemory(uid) {
  try {
    const doc = await db.collection("bloomieMemory").doc(uid).get();
    if (!doc.exists) return {
      lastSessionDate: null, lastIntent: null,
      lastPatternSummary: null, lastUrgencyLevel: null, oosCount: 0,
    };

    const data = doc.data();
    return {
      lastSessionDate:    sanitizeString(data?.lastSessionDate, 30)     ?? null,
      lastIntent:         sanitizeString(data?.lastIntent, 100)         ?? null,
      lastPatternSummary: sanitizeString(data?.lastPatternSummary, 150) ?? null,
      lastUrgencyLevel:   sanitizeString(data?.lastUrgencyLevel, 10)    ?? null,
      oosCount:           typeof data?.oosCount === "number" ? data.oosCount : 0,
    };
  } catch (err) {
    console.error(`[buildSafeBloomieContext] fetchBloomieMemory uid=${uid}`, err.message ?? err);
    return {
      lastSessionDate: null, lastIntent: null,
      lastPatternSummary: null, lastUrgencyLevel: null, oosCount: 0,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildSafeBloomieContext(userId) → Promise<BloomieContext>
 */
export async function buildSafeBloomieContext(userId) {
  if (typeof userId !== "string" || userId.trim() === "") {
    console.warn("[buildSafeBloomieContext] Called with invalid userId");
    return buildEmptyContext();
  }

  const uid = userId.trim();

  const [profileResult, cycleResult, symptomsResult, memoryResult] =
    await Promise.allSettled([
      fetchUserProfile(uid),
      fetchCycleData(uid),
      fetchRecentSymptoms(uid),
      fetchBloomieMemory(uid),
    ]);

  const profile  = profileResult.status  === "fulfilled" ? profileResult.value  : { nickname: null, accountMode: null };
  const cycle    = cycleResult.status    === "fulfilled" ? cycleResult.value    : buildEmptyContext().cycle;
  const symptoms = symptomsResult.status === "fulfilled" ? symptomsResult.value : [];
  const memory   = memoryResult.status   === "fulfilled" ? memoryResult.value   : { lastSessionDate: null, lastIntent: null };

  return {
    nickname:    profile.nickname    ?? null,
    accountMode: profile.accountMode ?? null,
    cycle: {
      lastPeriodDate:      cycle.lastPeriodDate      ?? null,
      avgCycleLength:      cycle.avgCycleLength      ?? null,
      predictedNextPeriod: cycle.predictedNextPeriod ?? null,
      predictedOvulation:  cycle.predictedOvulation  ?? null,
      phase:               cycle.phase               ?? null,
    },
    symptoms: Array.isArray(symptoms) ? symptoms : [],
    recentActivity: {
      lastSessionDate:    memory.lastSessionDate    ?? null,
      lastIntent:         memory.lastIntent         ?? null,
      lastPatternSummary: memory.lastPatternSummary ?? null,
      lastUrgencyLevel:   memory.lastUrgencyLevel   ?? null,
      oosCount:           memory.oosCount           ?? 0,
    },
  };
}

/**
 * buildEmptyContext() → BloomieContext
 */
export function buildEmptyContext() {
  return {
    nickname:    null,
    accountMode: null,
    cycle: {
      lastPeriodDate:      null,
      avgCycleLength:      null,
      predictedNextPeriod: null,
      predictedOvulation:  null,
      phase:               null,
    },
    symptoms:       [],
    recentActivity: {
      lastSessionDate:    null,
      lastIntent:         null,
      lastPatternSummary: null,
      lastUrgencyLevel:   null,
      oosCount:           0,
    },
  };
}
