/**
 * bloom-symptom-engine.js
 */

import {
  toDate, startOfDay, diffDays, median,
  makeSignal as _makeSignal,
} from "./bloom-utils.js";
import {
  generateCycleSignals,
  getHighestPrioritySignal,
} from "./bloom-cycle-engine.js";


export const SYMPTOM_CATEGORIES = {
  PAIN:         ["CRAMPS", "PELVIC_PAIN", "OVULATION_PAIN", "HEADACHE", "JOINT_PAIN", "BREAST_TENDERNESS"],
  DIGESTIVE:    ["BLOATING", "GASSY", "HEARTBURN", "NAUSEA", "CONSTIPATION", "DIARRHEA"],
  DISCHARGE:    ["DISCHARGE_NONE", "DISCHARGE_STICKY", "DISCHARGE_CREAMY", "DISCHARGE_EGGWHITE", "UNUSUAL_DISCHARGE"],
  PHYSICAL:     ["FATIGUE", "FLUID_RETENTION", "FREQUENT_URINATION", "NASAL_CONGESTION", "SMELL_SENSITIVITY"],
  SKIN_HAIR:    ["ACNE", "DRY_SKIN", "HAIR_THINNING"],
  TEMPERATURE:  ["HOT_FLASHES", "NIGHT_SWEATS", "COLD_FLASHES", "BBT_SHIFT"],
  COGNITIVE:    ["BRAIN_FOG", "FORGETFUL", "POOR_CONCENTRATION"],
  MOOD:         ["MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "DEPRESSION", "CRYING_SPELLS", "CALM", "STRESSED"],
  SLEEP:        ["INSOMNIA"],
  APPETITE:     ["CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY", "CRAVING_SPICY", "APPETITE_INCREASE", "APPETITE_DECREASE"],
  REPRODUCTIVE: ["INCREASED_LIBIDO", "DECREASED_LIBIDO", "CERVICAL_MUCUS_CHANGE", "VAGINAL_DRYNESS", "PAIN_DURING_SEX"],
};

/** Flat list of all 60 valid symptom codes */
export const ALL_SYMPTOM_CODES = Object.values(SYMPTOM_CATEGORIES).flat();

/* ------------------------------------------------------------------ */
/* Phase Map - single source of truth for phase-context logic        */
/* ------------------------------------------------------------------ */

export const SYMPTOM_PHASE_MAP = {
  menstrual: {
    expected: [
      "CRAMPS", "PELVIC_PAIN", "FATIGUE",
      "BLOATING", "MOOD_SWINGS", "DEPRESSION", "HEADACHE",
      "NAUSEA", "DIARRHEA", "CONSTIPATION",
      "APPETITE_INCREASE", "CRAVING_SWEET", "CRAVING_SALTY",
      "BRAIN_FOG",
    ],
    unexpected: [
      "DISCHARGE_EGGWHITE", "OVULATION_PAIN", "BBT_SHIFT",
      "INCREASED_LIBIDO", "HOT_FLASHES", "NIGHT_SWEATS", "CALM",
    ],
  },
  follicular: {
    expected: [
      "DISCHARGE_STICKY", "DISCHARGE_CREAMY",
      "CALM", "INCREASED_LIBIDO", "APPETITE_DECREASE",
    ],
    unexpected: [
      "MOOD_SWINGS", "DEPRESSION", "CRYING_SPELLS",
    ],
  },
  ovulation: {
    expected: [
      "DISCHARGE_EGGWHITE", "OVULATION_PAIN", "BBT_SHIFT",
      "INCREASED_LIBIDO", "CERVICAL_MUCUS_CHANGE",
      "CALM", "BREAST_TENDERNESS",
    ],
    unexpected: [],
  },
  luteal: {
    expected: [
      "BLOATING", "BREAST_TENDERNESS", "MOOD_SWINGS", "IRRITABILITY",
      "ANXIETY", "CRYING_SPELLS", "FATIGUE", "INSOMNIA",
      "CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY",
      "BRAIN_FOG", "POOR_CONCENTRATION", "ACNE", "HEADACHE",
      "CONSTIPATION", "FLUID_RETENTION", "APPETITE_INCREASE",
      "DECREASED_LIBIDO", "STRESSED",
    ],
    unexpected: [
      "DISCHARGE_EGGWHITE", "OVULATION_PAIN", "UNUSUAL_DISCHARGE",
    ],
  },
};

// ── Phase map validation - runs at module load time ──────────────────────────
// Throws immediately if any code in SYMPTOM_PHASE_MAP is not in ALL_SYMPTOM_CODES.
// This catches typos that would silently break phase logic.
for (const [_phase, { expected: _exp = [], unexpected: _unexp = [] }] of Object.entries(SYMPTOM_PHASE_MAP)) {
  for (const _code of [..._exp, ..._unexp]) {
    if (!ALL_SYMPTOM_CODES.includes(_code)) {
      throw new Error(`SYMPTOM_PHASE_MAP contains unknown code: ${_code} (in phase: ${_phase})`);
    }
  }
}

const PMS_CLUSTER = [
  "MOOD_SWINGS", "IRRITABILITY", "BLOATING", "BREAST_TENDERNESS",
  "CRAMPS", "FATIGUE", "CRYING_SPELLS", "ANXIETY",
  "CRAVING_SWEET", "CRAVING_SALTY", "HEADACHE", "INSOMNIA",
];

/** Menstrual cluster - requires ≥2 of these */
const MENSTRUAL_CLUSTER_SUPPORT = [
  "CRAMPS", "FATIGUE", "BLOATING", "MOOD_SWINGS", "HEADACHE", "NAUSEA",
];

/** Ovulation cluster - DISCHARGE_EGGWHITE required, then ≥1 of these */
const OVULATION_CLUSTER_SUPPORT = [
  "OVULATION_PAIN", "BBT_SHIFT", "INCREASED_LIBIDO",
];

/** Perimenopause cluster - requires ≥3 of these */
const PERIMENOPAUSE_CLUSTER = [
  "HOT_FLASHES", "NIGHT_SWEATS", "INSOMNIA", "MOOD_SWINGS",
  "VAGINAL_DRYNESS", "BRAIN_FOG", "DECREASED_LIBIDO",
];

/** Hormonal pattern (PCOS-adjacent) - requires ≥2 of set A + ≥1 of set B */
const HORMONAL_CLUSTER_A = ["ACNE", "HAIR_THINNING"];
const HORMONAL_CLUSTER_B = ["FATIGUE", "MOOD_SWINGS", "BLOATING"];


const SEVERITY_SEVERE    = 4;   // severity ≥ 4 = severe
const SEVERITY_URGENT    = 5;   // severity = 5 (persistent) = urgent flag
const SEVERITY_ELEVATED  = 3;   // severity ≥ 3 = elevated
const PERSISTENCE_DAYS   = 3;   // consecutive days before persistence signals
const DEFAULT_LOGGING_GAP_DAYS = 14;  // days without any log entry = logging gap
const BASELINE_INTENSITY_DELTA = 2; // points above baseline = "more intense"
const PHASE_MATCH_MIN    = 3;   // minimum matching expected symptoms for phase match
const PHASE_UNEXPECTED_MIN = 2; // minimum unexpected symptoms for unexpected signal


const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ── Symptom Forecast - configurable thresholds ─────────────────────────── */
/** Minimum completed cycles before any forecast is shown. */
const FORECAST_MIN_CYCLES_REQUIRED   = 2;
/** A symptom must appear in at least this many distinct past cycles to qualify. */
const FORECAST_MIN_SUPPORTING_CYCLES = 2;
/** Day-window half-width: symptom must appear within ±N days of current dayOfCycle. */
const FORECAST_DAY_WINDOW_HALF       = 3;
/** Maximum symptoms included in a single forecast message. */
const FORECAST_MAX_SYMPTOMS          = 4;
/** Maximum past cycles examined when reconstructing cycle history. */
const FORECAST_MAX_HISTORY_CYCLES    = 6;

/**
 * Safety-sensitive codes that should never be forecast.
 * Predicting these as "part of your pattern" risks minimising something that
 * warrants clinical attention.
 */
const FORECAST_EXCLUDED_CODES = new Set([
  "UNUSUAL_DISCHARGE",
]);

/**
 * Human-readable labels for symptom codes used in forecast messages.
 * Codes absent from this map fall back to code.replace(/_/g, " ").toLowerCase().
 */
const FORECAST_SYMPTOM_LABELS = {
  BLOATING:              "bloating",
  BREAST_TENDERNESS:     "breast tenderness",
  CRAMPS:                "cramps",
  FATIGUE:               "fatigue",
  HEADACHE:              "headache",
  MOOD_SWINGS:           "mood swings",
  IRRITABILITY:          "irritability",
  ANXIETY:               "anxiety",
  INSOMNIA:              "sleep changes",
  CRAVING_SWEET:         "sweet cravings",
  CRAVING_SALTY:         "salty cravings",
  CRAVING_GREASY:        "greasy food cravings",
  CRAVING_SPICY:         "spicy food cravings",
  BRAIN_FOG:             "brain fog",
  POOR_CONCENTRATION:    "difficulty concentrating",
  ACNE:                  "skin breakouts",
  FLUID_RETENTION:       "fluid retention",
  CONSTIPATION:          "constipation",
  DIARRHEA:              "digestive changes",
  DISCHARGE_EGGWHITE:    "egg-white discharge",
  DISCHARGE_CREAMY:      "creamy discharge",
  OVULATION_PAIN:        "ovulation discomfort",
  CERVICAL_MUCUS_CHANGE: "changes in discharge",
  NAUSEA:                "nausea",
  DEPRESSION:            "low mood",
  CRYING_SPELLS:         "feeling emotional",
  APPETITE_INCREASE:     "increased appetite",
  APPETITE_DECREASE:     "decreased appetite",
  PELVIC_PAIN:           "pelvic discomfort",
  VAGINAL_DRYNESS:       "vaginal dryness",
  DECREASED_LIBIDO:      "lower libido",
  INCREASED_LIBIDO:      "higher libido",
  HOT_FLASHES:           "hot flashes",
  NIGHT_SWEATS:          "night sweats",
  JOINT_PAIN:            "joint discomfort",
  DRY_SKIN:              "dry skin",
  HAIR_THINNING:         "hair thinning",
  STRESSED:              "feeling stressed",
  BBT_SHIFT:             "temperature shift",
  FREQUENT_URINATION:    "frequent urination",
};

/** Wrap makeSignal with symptom-engine default category */
const makeSignal = (p) => _makeSignal({ category: "symptom", ...p });

/** Format a Date as "YYYY-MM-DD" key */
function toDateKey(d) {
  const date = toDate(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Pre-index symptomHistory into a Map keyed by dateKey for O(1) lookups */
function buildHistoryMap(symptomHistory) {
  if (!Array.isArray(symptomHistory)) return new Map();
  const map = new Map();
  for (const entry of symptomHistory) {
    if (entry?.dateKey) map.set(entry.dateKey, entry);
  }
  return map;
}

/**
 * Detect if symptom logging has historically been sporadic.
 * Returns true when median gap between consecutive log entries exceeds 10 days.
 */
function isSporadicLogger(symptomHistory) {
  if (!Array.isArray(symptomHistory) || symptomHistory.length < 3) return false;
  const sorted = [...symptomHistory].sort((a, b) =>
    (a.dateKey || "").localeCompare(b.dateKey || "")
  );
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].dateKey);
    const curr = new Date(sorted[i].dateKey);
    if (!isNaN(prev) && !isNaN(curr)) {
      gaps.push(Math.round((curr.getTime() - prev.getTime()) / MS_PER_DAY));
    }
  }
  return gaps.length > 0 && median(gaps) > 10;
}

/**
 * Exported for testability: validate that every code in a phase map
 * exists in the given allCodes list.
 */
export function validatePhaseMapCodes(phaseMap, allCodes) {
  for (const [phase, { expected = [], unexpected = [] }] of Object.entries(phaseMap)) {
    for (const code of [...expected, ...unexpected]) {
      if (!allCodes.includes(code)) {
        throw new Error(`SYMPTOM_PHASE_MAP contains unknown code: ${code} (in phase: ${phase})`);
      }
    }
  }
}

/**
 * Build a { [code]: severity } map from logged symptoms.
 * Exported for callers that need the map independently.
 * @param {Array<{code: string, severity: number}>} loggedSymptoms
 * @returns {Object}
 */
export function buildSeverityMap(loggedSymptoms) {
  if (!Array.isArray(loggedSymptoms)) return {};
  return loggedSymptoms.reduce((acc, item) => {
    if (item?.code) acc[item.code] = Number(item.severity) || 0;
    return acc;
  }, {});
}

/**
 * Extract symptom codes from an array of log entries as a Set.
 * @param {Array<{code: string}>} loggedSymptoms
 * @returns {Set<string>}
 */
export function extractCodes(loggedSymptoms) {
  if (!Array.isArray(loggedSymptoms)) return new Set();
  return new Set(loggedSymptoms.map(i => i?.code).filter(Boolean));
}

/**
 * Get all historical entries that contain a given symptom code.
 * Returns entries sorted oldest-first.
 * @param {Array<{dateKey: string, items: Array<{code: string, severity: number}>}>} symptomHistory
 * @param {string} code
 * @returns {Array}
 */
function getEntriesForCode(symptomHistory, code) {
  if (!Array.isArray(symptomHistory)) return [];
  return symptomHistory
    .filter(e => Array.isArray(e.items) && e.items.some(i => i.code === code))
    .sort((a, b) => (a.dateKey || "").localeCompare(b.dateKey || ""));
}

/**
 * Get symptom history entries matching a cycle phase.
 * Best-effort: uses SYMPTOM_PHASE_MAP expected list to identify phase-typical entries.
 * When LMP data is unavailable this is approximate but consistent.
 * @param {Array} symptomHistory
 * @param {string|null} phase
 * @returns {Array}
 */
export function getHistoryForPhase(symptomHistory, phase) {
  if (!Array.isArray(symptomHistory) || !phase) return symptomHistory || [];
  const expected = new Set(SYMPTOM_PHASE_MAP[phase]?.expected || []);
  if (!expected.size) return symptomHistory;
  return symptomHistory.filter(e =>
    Array.isArray(e.items) && e.items.some(i => expected.has(i.code))
  );
}

/**
 * Calculate the personal baseline severity for a symptom code.
 * When weightRecent is true (default), entries from the most recent 30 days
 * are weighted 2x, so baseline comparisons reflect recent patterns more accurately.
 * Returns null if the code does not appear in history.
 * @param {Array} symptomHistory
 * @param {string} code
 * @param {boolean} [weightRecent=true]
 * @returns {number|null}
 */
export function getBaselineSeverity(symptomHistory, code, weightRecent = true) {
  if (!Array.isArray(symptomHistory) || !code) return null;

  if (!weightRecent) {
    const severities = symptomHistory
      .flatMap(e => (e.items || []).filter(i => i.code === code).map(i => Number(i.severity) || 0));
    if (severities.length === 0) return null;
    return severities.reduce((a, b) => a + b, 0) / severities.length;
  }

  // Weighted: entries in the most recent 30 days count 2x, older entries 1x
  const sorted = [...symptomHistory].sort((a, b) =>
    (b.dateKey || "").localeCompare(a.dateKey || "")
  );
  if (sorted.length === 0) return null;
  const mostRecentDate = new Date(sorted[0].dateKey);
  const cutoff = new Date(mostRecentDate.getTime() - 30 * MS_PER_DAY);

  let weightedSum = 0;
  let totalWeight = 0;
  for (const entry of sorted) {
    const entryDate = new Date(entry.dateKey || "");
    const weight = (!isNaN(entryDate) && entryDate >= cutoff) ? 2 : 1;
    for (const item of (entry.items || [])) {
      if (item.code === code) {
        weightedSum += (Number(item.severity) || 0) * weight;
        totalWeight += weight;
      }
    }
  }
  return totalWeight === 0 ? null : weightedSum / totalWeight;
}

/**
 * Check whether a symptom was logged on each of the last `days` consecutive
 * calendar days (ending at `today`).
 * @param {Array} symptomHistory
 * @param {string} code
 * @param {number} days
 * @param {Date} today
 * @returns {boolean}
 */
export function isSymptomPersistent(symptomHistory, code, days, today, historyMap) {
  if (!Array.isArray(symptomHistory) || !code || days < 1) return false;
  const base = startOfDay(today);
  for (let i = 0; i < days; i++) {
    const checkDate = new Date(base.getTime() - i * MS_PER_DAY);
    const key = toDateKey(checkDate);
    const entry = historyMap ? historyMap.get(key) : symptomHistory.find(e => e.dateKey === key);
    if (!entry?.items?.some(item => item.code === code)) return false;
  }
  return true;
}

/**
 * Like isSymptomPersistent but also checks that severity meets a minimum threshold
 * on every consecutive day.
 */
function isSymptomPersistentAtSeverity(symptomHistory, code, minSeverity, days, today, historyMap) {
  if (!Array.isArray(symptomHistory) || !code || days < 1) return false;
  const base = startOfDay(today);
  for (let i = 0; i < days; i++) {
    const checkDate = new Date(base.getTime() - i * MS_PER_DAY);
    const key = toDateKey(checkDate);
    const entry = historyMap ? historyMap.get(key) : symptomHistory.find(e => e.dateKey === key);
    const item = entry?.items?.find(i => i.code === code);
    if (!item || (Number(item.severity) || 0) < minSeverity) return false;
  }
  return true;
}

/**
 * Check if a symptom code is new - not seen in any historical entry
 * (looked-back across all available history, approximately `lookbackCycles` cycles).
 * Returns true if the code has never been logged in history.
 * @param {Array} symptomHistory
 * @param {string} code
 * @returns {boolean}
 */
export function isNewSymptom(symptomHistory, code) {
  if (!Array.isArray(symptomHistory) || !code) return false;
  return !symptomHistory.some(e =>
    Array.isArray(e.items) && e.items.some(i => i.code === code)
  );
}

/**
 * Compute the average number of consecutive days a symptom typically appears
 * across all clusters found in history.
 * Returns null if no clusters found.
 */
function getAverageRunLength(symptomHistory, code) {
  if (!Array.isArray(symptomHistory) || !code) return null;
  const sorted = [...symptomHistory].sort((a, b) =>
    (a.dateKey || "").localeCompare(b.dateKey || "")
  );
  const runs = [];
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    const hasCode = sorted[i].items?.some(item => item.code === code);
    if (hasCode) {
      run++;
    } else {
      if (run > 0) { runs.push(run); run = 0; }
    }
    // Detect gaps between consecutive entries
    if (hasCode && i + 1 < sorted.length) {
      const curr = new Date(sorted[i].dateKey);
      const next = new Date(sorted[i + 1].dateKey);
      if (!isNaN(curr) && !isNaN(next)) {
        const gap = Math.round((next - curr) / MS_PER_DAY);
        if (gap > 1) { runs.push(run); run = 0; }
      }
    }
  }
  if (run > 0) runs.push(run);
  if (!runs.length) return null;
  return runs.reduce((a, b) => a + b, 0) / runs.length;
}

/**
 * Count consecutive days a symptom has been logged ending at `today`.
 */
function currentRunLength(symptomHistory, code, today, historyMap) {
  if (!Array.isArray(symptomHistory) || !code) return 0;
  const base = startOfDay(today);
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const checkDate = new Date(base.getTime() - i * MS_PER_DAY);
    const key = toDateKey(checkDate);
    const entry = historyMap ? historyMap.get(key) : symptomHistory.find(e => e.dateKey === key);
    if (entry?.items?.some(item => item.code === code)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Check whether severity for a code is trending upward across the most
 * recent 3 history entries where it was logged.
 */
function isSeverityTrending(symptomHistory, code) {
  const entries = getEntriesForCode(symptomHistory, code).slice(-3);
  if (entries.length < 3) return false;
  const severities = entries.map(e => {
    const item = e.items.find(i => i.code === code);
    return Number(item?.severity) || 0;
  });
  return severities[2] > severities[1] && severities[1] > severities[0];
}

/* ------------------------------------------------------------------ */
/* Symptom Forecast Helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * Map a day-of-cycle integer to a phase string using the same boundaries
 * as the cycle engine's phase computation.
 *
 * @param {number}  dayOfCycle
 * @param {number}  [cycleLength=28]
 * @returns {"menstrual"|"follicular"|"ovulation"|"luteal"|null}
 */
function phaseFromDayOfCycle(dayOfCycle, cycleLength = 28) {
  if (!dayOfCycle || dayOfCycle < 1) return null;
  if (dayOfCycle <= 5)              return "menstrual";
  if (dayOfCycle <= 12)             return "follicular";
  if (dayOfCycle <= 15)             return "ovulation";
  if (dayOfCycle <= cycleLength)    return "luteal";
  return null; // beyond expected cycle end
}

/**
 * Reconstruct approximate past cycle start dates from the most recent
 * period start and an array of historical cycle lengths.
 *
 * Returns an array of { start: Date, length: number } newest-first.
 * Index 0 is always the current (possibly incomplete) cycle.
 * Indices 1+ are completed past cycles - these are the ones used as
 * forecast evidence.
 *
 * This is intentionally approximate: ±1 day boundary errors do not
 * materially affect a ±FORECAST_DAY_WINDOW_HALF pattern detector.
 *
 * @param {Date}     lastPeriodStart
 * @param {number[]} cycleLengths
 * @param {number}   [maxCycles=FORECAST_MAX_HISTORY_CYCLES]
 * @returns {Array<{ start: Date, length: number }>}
 */
function reconstructCycleStarts(lastPeriodStart, cycleLengths, maxCycles = FORECAST_MAX_HISTORY_CYCLES) {
  if (!(lastPeriodStart instanceof Date) || isNaN(lastPeriodStart.getTime())) return [];
  if (!Array.isArray(cycleLengths) || cycleLengths.length === 0) return [];

  const usable = cycleLengths
    .slice(0, maxCycles)
    .filter(l => typeof l === "number" && l >= 18 && l <= 45);
  if (usable.length === 0) return [];

  const result = [];
  let cursor = new Date(lastPeriodStart.getTime());

  // result[0] = current cycle (cursor = lastPeriodStart, walks backward per length)
  for (const length of usable) {
    result.push({ start: new Date(cursor.getTime()), length });
    cursor = new Date(cursor.getTime() - length * MS_PER_DAY);
  }

  return result; // newest-first; [0] = current, [1+] = past completed cycles
}

/**
 * Map each historical symptom entry to its inferred cycle position (dayOfCycle,
 * phase, cycleIndex) using reconstructed cycle start dates.
 *
 * Returns Map<code, Array<{ cycleIndex, dayOfCycle, phase, dateKey }>>
 * Only entries that fall within a reconstructed cycle window are included.
 *
 * @param {Array}  symptomHistory
 * @param {Array<{ start: Date, length: number }>} cycleStarts  - newest-first
 * @returns {Map<string, Array>}
 */
export function groupSymptomsByCycleWindow(symptomHistory, cycleStarts) {
  /** @type {Map<string, Array>} */
  const byCode = new Map();

  if (!Array.isArray(symptomHistory) || cycleStarts.length === 0) return byCode;

  for (const entry of symptomHistory) {
    if (!entry?.dateKey || !Array.isArray(entry.items)) continue;
    const entryDate = new Date(entry.dateKey);
    if (isNaN(entryDate.getTime())) continue;

    // Find the cycle this entry belongs to (first cycle whose window contains it)
    for (let i = 0; i < cycleStarts.length; i++) {
      const { start, length } = cycleStarts[i];
      const cycleEnd = new Date(start.getTime() + length * MS_PER_DAY);

      if (entryDate >= start && entryDate < cycleEnd) {
        const dayOfCycle = Math.round((entryDate.getTime() - start.getTime()) / MS_PER_DAY) + 1;
        const phase      = phaseFromDayOfCycle(dayOfCycle, length);

        for (const item of entry.items) {
          if (!item?.code) continue;
          if (!byCode.has(item.code)) byCode.set(item.code, []);
          byCode.get(item.code).push({
            cycleIndex: i,
            dayOfCycle,
            phase,
            dateKey: entry.dateKey,
            severity: Number(item.severity) || 0,
          });
        }
        break; // entry belongs to exactly one cycle
      }
    }
  }

  return byCode;
}

/**
 * Count the number of distinct *past* cycles (cycleIndex >= 1) in which a
 * symptom appeared within ±windowHalf days of targetDay.
 *
 * Excludes the current cycle (index 0) so that what the user has already
 * logged today does not inflate historical evidence.
 *
 * @param {Array<{ cycleIndex, dayOfCycle }>} occurrences
 * @param {number} targetDay
 * @param {number} windowHalf
 * @returns {number}
 */
export function countCyclesSupportingDayWindow(occurrences, targetDay, windowHalf) {
  if (!Array.isArray(occurrences) || occurrences.length === 0) return 0;
  const supporting = new Set();
  for (const { cycleIndex, dayOfCycle } of occurrences) {
    if (cycleIndex === 0) continue; // skip current cycle
    if (Math.abs(dayOfCycle - targetDay) <= windowHalf) supporting.add(cycleIndex);
  }
  return supporting.size;
}

/**
 * Count the number of distinct *past* cycles in which a symptom appeared
 * in the specified phase.
 *
 * @param {Array<{ cycleIndex, phase }>} occurrences
 * @param {string} targetPhase
 * @returns {number}
 */
export function countCyclesSupportingPhase(occurrences, targetPhase) {
  if (!Array.isArray(occurrences) || !targetPhase) return 0;
  const supporting = new Set();
  for (const { cycleIndex, phase } of occurrences) {
    if (cycleIndex === 0) continue; // skip current cycle
    if (phase === targetPhase) supporting.add(cycleIndex);
  }
  return supporting.size;
}

/**
 * Evaluate which symptom codes qualify for forecast and collect their evidence.
 *
 * A code qualifies when at least one of the following is true:
 *   • phase-based: appeared in targetPhase in ≥ minSupportingCycles past cycles
 *   • window-based: appeared within ±windowHalf days of targetDay in ≥ minSupportingCycles past cycles
 *
 * Codes that are safety-sensitive (FORECAST_EXCLUDED_CODES) or already logged
 * today are always excluded.
 *
 * Returns candidates sorted by evidence strength (desc), then alphabetically.
 *
 * @param {Map<string, Array>} byCode
 * @param {string|null}        currentPhase
 * @param {number|null}        currentDayOfCycle
 * @param {Set<string>}        loggedTodayCodes
 * @param {number}             minSupportingCycles
 * @param {number}             dayWindowHalf
 * @returns {Array<{ code, basis, supportingCycles, phaseSupport, windowSupport }>}
 */
export function getSymptomForecastCandidates(
  byCode, currentPhase, currentDayOfCycle,
  loggedTodayCodes, minSupportingCycles, dayWindowHalf,
) {
  const candidates = [];

  for (const [code, occurrences] of byCode.entries()) {
    if (FORECAST_EXCLUDED_CODES.has(code))  continue; // safety-sensitive
    if (loggedTodayCodes.has(code))          continue; // already logged today

    const phaseMatches = currentPhase !== null
      ? occurrences.filter(o => o.cycleIndex !== 0 && o.phase === currentPhase)
      : [];

    const windowMatches = currentDayOfCycle !== null
      ? occurrences.filter(o => o.cycleIndex !== 0 && Math.abs(o.dayOfCycle - currentDayOfCycle) <= dayWindowHalf)
      : [];

    const phaseSupport  = new Set(phaseMatches.map(o => o.cycleIndex)).size;
    const windowSupport = new Set(windowMatches.map(o => o.cycleIndex)).size;

    const phaseOk  = phaseSupport  >= minSupportingCycles;
    const windowOk = windowSupport >= minSupportingCycles;
    if (!phaseOk && !windowOk) continue;

    const basis = (phaseOk && windowOk) ? "combined"
                : phaseOk               ? "phase"
                :                         "day_window";
    const supportingOccurrences = [...phaseMatches, ...windowMatches]
      .filter((o, idx, arr) =>
        arr.findIndex(x => x.cycleIndex === o.cycleIndex && x.dateKey === o.dateKey) === idx
      );
    const severities = supportingOccurrences
      .map(o => Number(o.severity) || 0)
      .filter(n => n > 0);
    const severityEstimate = severities.length ? median(severities) : null;

    candidates.push({
      code,
      basis,
      supportingCycles: Math.max(phaseSupport, windowSupport),
      phaseSupport,
      windowSupport,
      severityEstimate,
      severitySamples: severities.length,
    });
  }

  return candidates.sort((a, b) =>
    b.supportingCycles !== a.supportingCycles
      ? b.supportingCycles - a.supportingCycles
      : a.code.localeCompare(b.code)
  );
}

/**
 * Select the top N forecast candidates and build human-readable labels.
 *
 * @param {Array}  candidates
 * @param {number} maxSymptoms
 * @returns {{ selected: Array, labels: string[], basis: string }}
 */
export function selectForecastableSymptoms(candidates, maxSymptoms) {
  const selected = candidates.slice(0, maxSymptoms);
  const labels   = selected.map(c =>
    FORECAST_SYMPTOM_LABELS[c.code] ?? c.code.replace(/_/g, " ").toLowerCase()
  );
  const bases = new Set(selected.map(c => c.basis));
  const basis = bases.has("combined") ? "combined"
              : bases.has("phase")    ? "phase"
              :                         "day_window";
  return { selected, labels, basis };
}

/**
 * Format a symptom label list into natural-language English.
 *   ["bloating"]                           → "bloating"
 *   ["bloating", "fatigue"]                → "bloating and fatigue"
 *   ["bloating", "fatigue", "headache"]    → "bloating, fatigue and headache"
 *
 * @param {string[]} labels
 * @returns {string}
 */
export function formatSymptomForecastList(labels) {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function formatSeverityEstimate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 4.5) return "severe";
  if (n >= 3.5) return "high";
  if (n >= 2.5) return "moderate";
  if (n >= 1.5) return "mild";
  return "light";
}

/**
 * Compose the forecast message body using safe, future-framed language.
 * Never uses certainty language; always frames as personal pattern observation.
 *
 * @param {string[]}    labels
 * @param {string|null} phase
 * @param {number|null} dayOfCycle
 * @param {string}      basis  - "phase" | "day_window" | "combined"
 * @param {number|null} severityEstimate
 * @param {number}      supportingCycles
 * @returns {string}
 */
export function buildForecastMessage(labels, phase, dayOfCycle, basis, severityEstimate = null, supportingCycles = 0) {
  const symptomStr = formatSymptomForecastList(labels);
  const severityLabel = formatSeverityEstimate(severityEstimate);
  const supportText = supportingCycles > 0
    ? ` This is based on ${supportingCycles} previous cycle${supportingCycles === 1 ? "" : "s"} in your logs.`
    : "";
  const severityText = severityLabel
    ? ` When this has shown up before, your logged severity was usually ${severityLabel}.`
    : "";
  const PHASE_LABELS = {
    menstrual:  "around your period",
    follicular: "during the follicular phase",
    ovulation:  "around ovulation",
    luteal:     "during your late-cycle days",
  };

  if ((basis === "combined" || basis === "day_window") && dayOfCycle !== null) {
    const phaseSuffix = phase ? ` (${PHASE_LABELS[phase] ?? `in your ${phase} phase`})` : "";
    return `Based on your past logs, you often notice ${symptomStr} around day ${dayOfCycle} of your cycle${phaseSuffix}.${supportText}${severityText}`;
  }

  if (phase) {
    const phaseLabel = PHASE_LABELS[phase] ?? `during your ${phase} phase`;
    return `Based on your past logs, you often notice ${symptomStr} ${phaseLabel}.${supportText}${severityText}`;
  }

  return `Based on your past logs, you often notice ${symptomStr} around this point in your cycle.${supportText}${severityText}`;
}

/* ------------------------------------------------------------------ */
/* Core Detectors                                                     */
/* ------------------------------------------------------------------ */

/**
 * Detect whether logged symptoms are typical or atypical for the current phase.
 *
 * Signals:
 *   SYMPTOMS_MATCH_PHASE           - ≥3 logged symptoms are in the expected list
 *   SYMPTOMS_UNEXPECTED_FOR_PHASE  - ≥2 logged symptoms are in the unexpected list
 *   PHASE_UNKNOWN_LIMITED_CONTEXT  - phase is null, context is limited
 *
 * @param {Object} params
 * @param {Array<{code: string}>} params.loggedSymptoms
 * @param {string|null} params.phase
 * @param {number[]} [params.cycleLengths]
 * @returns {CycleSignal}
 */
export function detectPhaseContextSignal({
  loggedSymptoms   = [],
  phase            = null,
  phaseConfidence  = "high",
} = {}) {
  if (!phase) {
    return makeSignal({
      code: "PHASE_UNKNOWN_LIMITED_CONTEXT",
      level: "low",
      show: false,
      title: "Phase context unavailable",
      message: "Bloom doesn't have enough cycle data to compare symptoms against your current phase.",
      guidance: "Log your last period date in the dashboard to get more personalised symptom context.",
      debug: { reason: "phase is null" },
    });
  }

  const phaseMap = SYMPTOM_PHASE_MAP[phase];
  if (!phaseMap) {
    return makeSignal({
      code: "PHASE_UNKNOWN_LIMITED_CONTEXT",
      level: "low",
      show: false,
      debug: { reason: `Unrecognised phase: ${phase}` },
    });
  }

  const codes = extractCodes(loggedSymptoms);
  const expectedSet = new Set(phaseMap.expected);
  const unexpectedSet = new Set(phaseMap.unexpected);

  const matched    = [...codes].filter(c => expectedSet.has(c));
  const unexpected = [...codes].filter(c => unexpectedSet.has(c));

  if (unexpected.length >= PHASE_UNEXPECTED_MIN) {
    // Low/null confidence: soften the assertion, downgrade level when null
    const isLowConfidence = phaseConfidence === "low" || phaseConfidence == null;
    const level = (phaseConfidence == null) ? "low" : "medium";
    const message = isLowConfidence
      ? `If you are in your ${phase} phase, some of these symptoms are less typical - though cycle timing can vary.`
      : `Bloom noticed some symptoms that are less typical for the ${phase} phase. This could reflect cycle variability, or it may be worth keeping an eye on.`;
    return makeSignal({
      code: "SYMPTOMS_UNEXPECTED_FOR_PHASE",
      level,
      show: true,
      title: "Some symptoms seem unusual for this phase",
      message,
      guidance: "Keep logging so Bloom can build a clearer picture of your pattern over time.",
      debug: { phase, matched, unexpected, loggedCount: codes.size, phaseConfidence },
    });
  }

  if (matched.length >= PHASE_MATCH_MIN) {
    return makeSignal({
      code: "SYMPTOMS_MATCH_PHASE",
      level: "low",
      show: true,
      title: "Symptoms look familiar for this phase",
      message: `Many people in the ${phase} phase notice similar things. Your body is doing something recognisable here.`,
      guidance: "Continuing to log helps Bloom spot if anything shifts from your usual pattern.",
      debug: { phase, matched, unexpected, loggedCount: codes.size },
    });
  }

  return makeSignal({
    code: "SYMPTOMS_MATCH_PHASE",
    level: "low",
    show: false,
    debug: { phase, matched, unexpected, loggedCount: codes.size },
  });
}

/**
 * Detect named symptom clusters.
 *
 * Checks patterns in priority order and returns the strongest match.
 * If no cluster matches clearly → SYMPTOMS_PATTERN_UNCLEAR (show: false).
 *
 * @param {Object} params
 * @param {Array<{code: string}>} params.loggedSymptoms
 * @param {string|null} params.phase
 * @param {number|null} params.dayOfCycle
 * @returns {CycleSignal}
 */
export function detectSymptomPatternSignal({
  loggedSymptoms = [],
  phase = null,
  dayOfCycle = null,
} = {}) {
  const codes = extractCodes(loggedSymptoms);

  // ── Perimenopause pattern ─────────────────────────────────────────────────
  const periCount = PERIMENOPAUSE_CLUSTER.filter(c => codes.has(c)).length;
  if (periCount >= 3) {
    return makeSignal({
      code: "SYMPTOMS_MATCH_PERIMENOPAUSE_PATTERN",
      level: "medium",
      show: true,
      title: "Pattern worth exploring with a provider",
      message: "Bloom noticed a cluster of symptoms that can sometimes be associated with hormonal shifts. This pattern is common and worth discussing with a healthcare provider for context.",
      guidance: "Consider logging these symptoms over the next few cycles and sharing the pattern with your provider.",
      debug: { matched: PERIMENOPAUSE_CLUSTER.filter(c => codes.has(c)), count: periCount },
    });
  }

  // ── Hormonal pattern (PCOS-adjacent - never name the condition) ───────────
  const hormonalA = HORMONAL_CLUSTER_A.filter(c => codes.has(c));
  const hormonalB = HORMONAL_CLUSTER_B.filter(c => codes.has(c));
  if (hormonalA.length >= 2 && hormonalB.length >= 1) {
    return makeSignal({
      code: "SYMPTOMS_MATCH_HORMONAL_PATTERN",
      level: "medium",
      show: true,
      title: "Hormonal pattern worth discussing",
      message: "Bloom noticed a combination of symptoms that can sometimes be associated with hormonal patterns worth discussing with a provider.",
      guidance: "This pattern is worth mentioning at your next appointment - logging regularly gives your provider more to work with.",
      debug: { matchedA: hormonalA, matchedB: hormonalB },
    });
  }

  // ── PMS pattern ───────────────────────────────────────────────────────────
  const isLuteal = phase === "luteal" || (dayOfCycle !== null && dayOfCycle >= 16);
  const pmsCount = PMS_CLUSTER.filter(c => codes.has(c)).length;
  if (isLuteal && pmsCount >= 3) {
    return makeSignal({
      code: "SYMPTOMS_MATCH_PMS_PATTERN",
      level: "medium",
      show: true,
      title: "Looks like a PMS pattern",
      message: "Bloom noticed a cluster of symptoms many people experience in the days before their period. This is a common experience, especially in the second half of the cycle.",
      guidance: "Rest, gentle movement, and heat can help. If these symptoms are affecting your daily life, it's worth talking to a provider.",
      debug: { matched: PMS_CLUSTER.filter(c => codes.has(c)), count: pmsCount, phase, dayOfCycle },
    });
  }

  // ── Menstrual pattern ─────────────────────────────────────────────────────
  {
    const menstrualSupport = MENSTRUAL_CLUSTER_SUPPORT.filter(c => codes.has(c));
    if (menstrualSupport.length >= 2) {
      return makeSignal({
        code: "SYMPTOMS_MATCH_MENSTRUAL_PATTERN",
        level: "low",
        show: true,
        title: "Period symptoms detected",
        message: "Bloom noticed a pattern that aligns with period symptoms. These are common experiences during menstruation.",
        guidance: "Make sure to log your period start date if you haven't - it helps Bloom keep predictions accurate.",
        debug: { matched: menstrualSupport },
      });
    }
  }

  // ── Ovulation pattern ─────────────────────────────────────────────────────
  if (codes.has("DISCHARGE_EGGWHITE")) {
    const ovulationSupport = OVULATION_CLUSTER_SUPPORT.filter(c => codes.has(c));
    if (ovulationSupport.length >= 1) {
      return makeSignal({
        code: "SYMPTOMS_MATCH_OVULATION_PATTERN",
        level: "low",
        show: true,
        title: "Possible ovulation window",
        message: "The combination of symptoms you've logged can be consistent with the ovulation window.",
        guidance: "This is a useful time to log if you're tracking fertility. Your body temperature may shift slightly over the next day or two.",
        debug: { matched: ovulationSupport },
      });
    }
  }

  return makeSignal({
    code: "SYMPTOMS_PATTERN_UNCLEAR",
    level: "low",
    show: false,
    debug: { codesLogged: [...codes] },
  });
}

/**
 * Detect deviations from the user's personal symptom baseline.
 *
 * Checks in priority order and returns the first significant finding.
 * Suppressed entirely when cycleCount < 2 (returns NOT_ENOUGH_HISTORY_FOR_BASELINE).
 *
 * @param {Object} params
 * @param {Array<{code: string, severity: number}>} params.loggedSymptoms
 * @param {Array} params.symptomHistory
 * @param {string|null} params.phase
 * @param {number} params.cycleCount
 * @returns {CycleSignal}
 */
export function detectBaselineDeviationSignal({
  loggedSymptoms = [],
  symptomHistory = [],
  phase = null,
  cycleCount = 0,
} = {}) {
  if (cycleCount < 2) {
    return makeSignal({
      code: "NOT_ENOUGH_HISTORY_FOR_BASELINE",
      level: "low",
      show: false,
      debug: { reason: "Fewer than 2 cycles logged", cycleCount },
    });
  }

  if (!Array.isArray(loggedSymptoms) || loggedSymptoms.length === 0) {
    return makeSignal({
      code: "NOT_ENOUGH_HISTORY_FOR_BASELINE",
      level: "low",
      show: false,
      debug: { reason: "No current symptoms logged" },
    });
  }

  // Pre-index history for O(n) persistence checks
  const historyMap = buildHistoryMap(symptomHistory);

  // ── SYMPTOMS_MORE_INTENSE_THAN_USUAL ─────────────────────────────────────
  const intenseSymptoms = [];
  for (const item of loggedSymptoms) {
    const baseline = getBaselineSeverity(symptomHistory, item.code, true);
    const current  = Number(item.severity) || 0;
    if (baseline !== null && current - baseline >= BASELINE_INTENSITY_DELTA) {
      intenseSymptoms.push({
        code:     item.code,
        current,
        baseline: Number(baseline.toFixed(2)),
        delta:    Number((current - baseline).toFixed(2)),
      });
    }
  }
  if (intenseSymptoms.length > 0) {
    return makeSignal({
      code: "SYMPTOMS_MORE_INTENSE_THAN_USUAL",
      level: "medium",
      show: true,
      title: "Symptoms seem more intense than usual",
      message: "Bloom noticed that some symptoms appear more intense than your typical logged pattern for this time. This is worth keeping an eye on.",
      guidance: "Track carefully for the next few days. If intensity stays high, a conversation with a provider is a good next step.",
      debug: { intenseSymptoms, phase },
    });
  }

  // ── SYMPTOMS_PERSISTING_LONGER_THAN_USUAL ────────────────────────────────
  const persistingSymptoms = [];
  const today = new Date();
  for (const item of loggedSymptoms) {
    const currentRun = currentRunLength(symptomHistory, item.code, today, historyMap);
    const avgRun     = getAverageRunLength(symptomHistory, item.code);
    if (avgRun !== null && currentRun > Math.ceil(avgRun) + 1 && currentRun >= PERSISTENCE_DAYS) {
      persistingSymptoms.push({
        code:       item.code,
        currentRun,
        avgRun:     Number(avgRun.toFixed(1)),
      });
    }
  }
  if (persistingSymptoms.length > 0) {
    return makeSignal({
      code: "SYMPTOMS_PERSISTING_LONGER_THAN_USUAL",
      level: "medium",
      show: true,
      title: "Symptoms are lasting longer than usual",
      message: "Bloom noticed that some symptoms have been present for more days than your typical pattern. Symptoms that run longer than usual are worth monitoring.",
      guidance: "If the symptoms continue beyond what feels normal for you, consider checking in with a provider.",
      debug: { persistingSymptoms, phase },
    });
  }

  // ── NEW_SYMPTOM_DETECTED ──────────────────────────────────────────────────
  const newSymptoms = loggedSymptoms
    .map(item => item.code)
    .filter(code => isNewSymptom(symptomHistory, code));

  if (newSymptoms.length > 0) {
    const level = newSymptoms.length >= 2 ? "medium" : "low";
    return makeSignal({
      code: "NEW_SYMPTOM_DETECTED",
      level,
      show: true,
      title: "New symptom logged",
      message: newSymptoms.length === 1
        ? `Bloom noticed a symptom you haven't logged before in this context. It may be a one-off, but it's good to keep an eye on it.`
        : `Bloom noticed ${newSymptoms.length} symptoms you haven't logged before together. Keep tracking to see if they form a pattern.`,
      guidance: "Log it again if it comes back - a pattern over a few cycles gives Bloom more to work with.",
      debug: { newSymptoms, phase },
    });
  }

  // ── SYMPTOM_FREQUENCY_INCREASING ─────────────────────────────────────────
  const trendingSymptoms = loggedSymptoms
    .map(item => item.code)
    .filter(code => isSeverityTrending(symptomHistory, code));

  if (trendingSymptoms.length > 0) {
    return makeSignal({
      code: "SYMPTOM_FREQUENCY_INCREASING",
      level: "medium",
      show: true,
      title: "Symptom intensity is trending up",
      message: "Bloom noticed that the severity of some symptoms appears to be increasing across your recent cycles. This is worth discussing with a provider if the trend continues.",
      guidance: "Keep logging and mention this pattern at your next check-up.",
      debug: { trendingSymptoms, phase },
    });
  }

  return makeSignal({
    code: "NOT_ENOUGH_HISTORY_FOR_BASELINE",
    level: "low",
    show: false,
    debug: { reason: "No significant deviation found", cycleCount },
  });
}

/**
 * Detect reproductive guidance signals:
 * pregnancy test timing, spotting context, ovulation confirmation,
 * and cycle phase shift.
 *
 * @param {Object} params
 * @param {Array<{code: string}>} params.loggedSymptoms
 * @param {string|null} params.phase
 * @param {boolean} params.missedPeriod
 * @param {number|null} params.dayOfCycle
 * @param {Date|null} params.lastPeriodStart
 * @param {boolean} params.pregnancyRelevant
 * @returns {CycleSignal}
 */
export function detectReproductiveGuidanceSignal({
  loggedSymptoms    = [],
  phase             = null,
  missedPeriod      = false,
  dayOfCycle        = null,
  lastPeriodStart   = null,
  pregnancyRelevant = false,
} = {}) {
  const codes = extractCodes(loggedSymptoms);

  // ── PREGNANCY_TEST_TIMING_RELEVANT ────────────────────────────────────────
  const pregnancySymptoms = ["NAUSEA", "FATIGUE", "BREAST_TENDERNESS", "FREQUENT_URINATION", "SMELL_SENSITIVITY"];
  const pregnancyMatches  = pregnancySymptoms.filter(c => codes.has(c));

  if (missedPeriod && pregnancyMatches.length > 0) {
    return makeSignal({
      code: "PREGNANCY_TEST_TIMING_RELEVANT",
      level: "medium",
      show: true,
      title: "A pregnancy test may be helpful",
      message: "Based on what you've logged, a pregnancy test at the right time would help clarify things.",
      guidance: "The best time to test is the day of or after your expected period. If you've already passed that, testing now would give you a reliable result.",
      debug: {
        missedPeriod,
        pregnancyMatchedSymptoms: pregnancyMatches,
        pregnancyRelevant,
      },
    });
  }

  // ── OVULATION_CONFIRMATION_POSSIBLE ──────────────────────────────────────
  if (codes.has("DISCHARGE_EGGWHITE") && codes.has("BBT_SHIFT") && codes.has("OVULATION_PAIN")) {
    return makeSignal({
      code: "OVULATION_CONFIRMATION_POSSIBLE",
      level: "low",
      show: true,
      title: "Ovulation signs are aligning",
      message: "The combination of egg-white discharge, a temperature shift, and ovulation pain are consistent with ovulation.",
      guidance: "This is a good time to log your basal body temperature if you haven't yet - the data will strengthen your cycle predictions.",
      debug: { codes: [...codes], phase },
    });
  }

  // ── CYCLE_PHASE_SHIFT_POSSIBLE ────────────────────────────────────────────
  // Detect when dominant symptoms suggest a different phase than predicted
  if (phase === "luteal" && codes.has("DISCHARGE_EGGWHITE")) {
    return makeSignal({
      code: "CYCLE_PHASE_SHIFT_POSSIBLE",
      level: "low",
      show: true,
      title: "Cycle timing may have shifted",
      message: "Bloom noticed a symptom usually associated with ovulation in what appears to be your luteal phase. Your cycle timing may have shifted.",
      guidance: "Log your temperature if you can - it will help Bloom recalibrate your prediction.",
      debug: { phase, marker: "DISCHARGE_EGGWHITE_IN_LUTEAL" },
    });
  }
  return makeSignal({
    code: "SPOTTING_CONTEXT_NOTE",
    level: "low",
    show: false,
    debug: { reason: "No reproductive guidance trigger found" },
  });
}

/**
 * Detect safety escalation signals.
 *
 * This is the most critical detector. Rules are checked in strict priority order.
 * Returns the single highest-priority safety signal, or a no-show signal if
 * no escalation criteria are met.
 *
 * @param {Object} params
 * @param {Array<{code: string, severity: number}>} params.loggedSymptoms
 * @param {Object} params.severityMap  - pre-built { [code]: severity }
 * @param {Array} params.symptomHistory
 * @param {Date} [params.today]
 * @returns {CycleSignal}
 */
export function detectSafetyEscalationSignal({
  loggedSymptoms  = [],
  severityMap     = {},
  symptomHistory  = [],
  today           = new Date(),
} = {}) {
  const codes = extractCodes(loggedSymptoms);
  const sev   = code => Number(severityMap[code]) || 0;

  // Pre-index history for O(n) persistence checks instead of O(n²)
  const historyMap = buildHistoryMap(symptomHistory);

  // ── SEEK_URGENT_CARE (level: high) - highest priority ────────────────────

  // Rule: Severe pelvic pain with fever proxy
  const hasFeverProxy = codes.has("NIGHT_SWEATS") && codes.has("COLD_FLASHES");
  if (sev("PELVIC_PAIN") >= SEVERITY_SEVERE && hasFeverProxy) {
    return makeSignal({
      code: "SEEK_URGENT_CARE",
      level: "high",
      show: true,
      title: "This needs attention today",
      message: "Severe pelvic pain alongside symptoms that may indicate fever needs prompt medical assessment.",
      guidance: "Please seek care today - severe pain with signs of fever should not wait.",
      category: "safety",
      debug: {
        triggers:   ["PELVIC_PAIN", "NIGHT_SWEATS", "COLD_FLASHES"],
        severities: { PELVIC_PAIN: sev("PELVIC_PAIN") },
        note:       "fever_proxy_with_severe_pelvic_pain",
        daysLogged: 1,
      },
    });
  }

  // Rule 5: Unusual discharge with fever proxy and pelvic involvement
  if (codes.has("UNUSUAL_DISCHARGE") && hasFeverProxy && codes.has("PELVIC_PAIN")) {
    return makeSignal({
      code: "SEEK_URGENT_CARE",
      level: "high",
      show: true,
      title: "This needs attention today",
      message: "Unusual discharge alongside pelvic pain and symptoms that may indicate fever is a combination that needs same-day attention.",
      guidance: "Please seek care today - this combination can sometimes indicate an infection that needs prompt treatment.",
      category: "safety",
      debug: {
        triggers:   ["UNUSUAL_DISCHARGE", "PELVIC_PAIN", "NIGHT_SWEATS", "COLD_FLASHES"],
        note:       "possible_pelvic_infection_with_fever_proxy",
        daysLogged: 1,
      },
    });
  }

  // Rule 6: Any symptom at severity 5 for 3+ consecutive days
  for (const item of loggedSymptoms) {
    if (Number(item.severity) === SEVERITY_URGENT) {
      if (isSymptomPersistentAtSeverity(symptomHistory, item.code, SEVERITY_URGENT, PERSISTENCE_DAYS, today, historyMap)) {
        return makeSignal({
          code: "SEEK_URGENT_CARE",
          level: "high",
          show: true,
          title: "Severe symptoms persisting - this needs attention",
          message: `Bloom noticed that ${item.code.replace(/_/g, " ").toLowerCase()} has been logged at maximum severity for ${PERSISTENCE_DAYS} days in a row. Symptoms this intense for this long are always worth getting checked.`,
          guidance: "Please speak with a provider today.",
          category: "safety",
          debug: {
            triggers:       [item.code],
            severities:     { [item.code]: item.severity },
            persistenceDays: PERSISTENCE_DAYS,
            note:            "max_severity_persistent",
          },
        });
      }
    }
  }

  // ── URGENT_SYMPTOM_COMBINATION (level: high) ──────────────────────────────
  const urgentMarkers = [
    codes.has("PELVIC_PAIN") && sev("PELVIC_PAIN") >= SEVERITY_ELEVATED,
    codes.has("UNUSUAL_DISCHARGE"),
    codes.has("NIGHT_SWEATS") && codes.has("PELVIC_PAIN"),
  ].filter(Boolean);

  if (urgentMarkers.length >= 2) {
    return makeSignal({
      code: "URGENT_SYMPTOM_COMBINATION",
      level: "high",
      show: true,
      title: "These symptoms together are worth getting checked",
      message: "Bloom noticed a combination of symptoms that together are worth getting checked the same day.",
      guidance: "Please seek care today - these symptoms together should be assessed by a clinician.",
      category: "safety",
      debug: {
        urgentMarkerCount: urgentMarkers.length,
        triggers: [
          codes.has("PELVIC_PAIN") && sev("PELVIC_PAIN") >= SEVERITY_ELEVATED ? `PELVIC_PAIN(${sev("PELVIC_PAIN")})` : null,
          codes.has("UNUSUAL_DISCHARGE") ? "UNUSUAL_DISCHARGE" : null,
          codes.has("NIGHT_SWEATS") && codes.has("PELVIC_PAIN") ? "NIGHT_SWEATS+PELVIC_PAIN" : null,
        ].filter(Boolean),
      },
    });
  }

  // ── FEVER_WITH_PELVIC_SYMPTOMS (level: high) ──────────────────────────────
  if (hasFeverProxy && (codes.has("PELVIC_PAIN") || codes.has("UNUSUAL_DISCHARGE"))) {
    return makeSignal({
      code: "FEVER_WITH_PELVIC_SYMPTOMS",
      level: "high",
      show: true,
      title: "Possible infection-related symptoms",
      message: "Bloom noticed symptoms that can sometimes accompany fever or infection alongside pelvic symptoms. This combination is worth getting checked.",
      guidance: "If you have a temperature, pelvic pain, or unusual discharge together - seek care today.",
      category: "safety",
      debug: {
        triggers:        ["NIGHT_SWEATS", "COLD_FLASHES"],
        pelvicSymptoms:  [codes.has("PELVIC_PAIN") ? "PELVIC_PAIN" : null, codes.has("UNUSUAL_DISCHARGE") ? "UNUSUAL_DISCHARGE" : null].filter(Boolean),
        note:            "fever_proxy_combination",
      },
    });
  }

  // ── SEVERE_PAIN_FLAG (level: medium) ─────────────────────────────────────
  const hasSeverePain = sev("CRAMPS") >= SEVERITY_SEVERE || sev("PELVIC_PAIN") >= SEVERITY_SEVERE;
  if (hasSeverePain) {
    const painCode = sev("PELVIC_PAIN") >= SEVERITY_SEVERE ? "PELVIC_PAIN" : "CRAMPS";
    return makeSignal({
      code: "SEVERE_PAIN_FLAG",
      level: "medium",
      show: true,
      title: "Severe pain logged",
      message: "Bloom noticed severe pain in your log. Severe pain is worth tracking carefully.",
      guidance: "If the pain doesn't ease with rest and pain relief, or if it's getting worse, see a provider soon.",
      category: "safety",
      debug: {
        triggers:   [painCode],
        severities: { [painCode]: sev(painCode) },
        daysLogged: 1,
      },
    });
  }

  // ── HEAVY_BLEEDING_FLAG (level: medium) - kept for legacy signal compatibility
  if (false) {
    return makeSignal({
      code: "HEAVY_BLEEDING_FLAG",
      level: "medium",
      show: false,
      debug: {
        triggers:   [],
        severities: {},
        daysLogged: 1,
      },
    });
  }

  // ── PERSISTENT_SEVERE_SYMPTOMS (level: medium) ────────────────────────────
  for (const item of loggedSymptoms) {
    const sv = Number(item.severity) || 0;
    if (sv >= SEVERITY_ELEVATED) {
      if (isSymptomPersistentAtSeverity(symptomHistory, item.code, SEVERITY_ELEVATED, PERSISTENCE_DAYS, today, historyMap)) {
        return makeSignal({
          code: "PERSISTENT_SEVERE_SYMPTOMS",
          level: "medium",
          show: true,
          title: "Persistent symptoms at high intensity",
          message: `Bloom noticed that ${item.code.replace(/_/g, " ").toLowerCase()} has been at a high intensity for ${PERSISTENCE_DAYS} or more days. Symptoms that persist at this level are worth discussing with a provider.`,
          guidance: "Book an appointment if this is still happening - symptoms that last this long at this intensity deserve professional attention.",
          category: "safety",
          debug: {
            triggers:        [item.code],
            severities:      { [item.code]: sv },
            persistenceDays: PERSISTENCE_DAYS,
          },
        });
      }
    }
  }

  return makeSignal({
    code: "HEAVY_BLEEDING_FLAG",
    level: "low",
    show: false,
    category: "safety",
    debug: { reason: "No safety escalation criteria met" },
  });
}

/**
 * Detect data quality issues that affect the reliability of other signals.
 *
 * @param {Object} params
 * @param {Array} params.symptomHistory
 * @param {Array<{code: string, severity: number}>} params.loggedSymptoms
 * @param {number} params.cycleCount
 * @returns {CycleSignal}
 */
export function detectDataQualitySignal({
  symptomHistory  = [],
  loggedSymptoms  = [],
  cycleCount      = 0,
  settings        = {},
} = {}) {
  const loggingGapDays = settings.loggingGapDays ?? DEFAULT_LOGGING_GAP_DAYS;

  // NOT_ENOUGH_HISTORY_FOR_BASELINE - suppresses baseline signals
  if (cycleCount < 2) {
    return makeSignal({
      code: "NOT_ENOUGH_HISTORY_FOR_BASELINE",
      level: "low",
      show: false,
      debug: {
        reason:     "Fewer than 2 completed cycles logged",
        cycleCount,
        note:       "Baseline deviation signals are suppressed - pattern and safety signals are unaffected",
      },
    });
  }

  // SYMPTOM_LOGGING_GAP - no log entries in the last N days
  if (Array.isArray(symptomHistory) && symptomHistory.length > 0) {
    const sorted    = [...symptomHistory].sort((a, b) => (b.dateKey || "").localeCompare(a.dateKey || ""));
    const lastEntry = sorted[0];
    if (lastEntry?.dateKey) {
      const daysSinceLast = diffDays(new Date(lastEntry.dateKey), new Date());
      if (daysSinceLast >= loggingGapDays) {
        // Sporadic logger suppression: skip the nudge for users who intentionally log infrequently
        if (settings.suppressLoggingGapIfSporadic && cycleCount > 3 && isSporadicLogger(symptomHistory)) {
          return makeSignal({
            code: "NOT_ENOUGH_HISTORY_FOR_BASELINE",
            level: "low",
            show: false,
            debug: { reason: "Sporadic logger suppression active", daysSinceLast, loggingGapDays },
          });
        }
        return makeSignal({
          code: "SYMPTOM_LOGGING_GAP",
          level: "low",
          show: true,
          title: "It's been a while since you last logged",
          message: `Bloom hasn't received symptom logs in the last ${daysSinceLast} days. Logging regularly helps Bloom give you more personalised context.`,
          guidance: "Try logging symptoms for even a few days - it helps Bloom spot patterns and give better insight.",
          debug: { daysSinceLast, threshold: loggingGapDays, lastEntryDateKey: lastEntry.dateKey },
        });
      }
    }
  } else if (!Array.isArray(loggedSymptoms) || loggedSymptoms.length === 0) {
    return makeSignal({
      code: "SYMPTOM_LOGGING_GAP",
      level: "low",
      show: true,
      title: "No symptom history yet",
      message: "Bloom doesn't have symptom logs yet. Logging symptoms regularly helps Bloom give you more personalised context.",
      guidance: "Start logging symptoms on the daily log page - even simple entries help.",
      debug: { reason: "No symptom history" },
    });
  }

  // LOW_SEVERITY_DATA - symptoms present but all severity = 0
  if (
    Array.isArray(loggedSymptoms) &&
    loggedSymptoms.length > 0 &&
    loggedSymptoms.every(item => (Number(item.severity) || 0) === 0)
  ) {
    return makeSignal({
      code: "LOW_SEVERITY_DATA",
      level: "low",
      show: false,
      debug: {
        note:      "Symptoms are present but all severity values are 0 - guidance is limited without severity information",
        codeCount: loggedSymptoms.length,
      },
    });
  }

  return makeSignal({
    code: "NOT_ENOUGH_HISTORY_FOR_BASELINE",
    level: "low",
    show: false,
    debug: { reason: "Data quality check passed" },
  });
}

/* ------------------------------------------------------------------ */
/* Symptom Forecast Detector                                         */
/* ------------------------------------------------------------------ */

/**
 * Detect a personalised symptom forecast signal.
 *
 * Uses the user's historical symptom logs, aligned to their reconstructed
 * cycle timeline, to predict symptoms they frequently experience around the
 * current cycle day or phase. Produces one supportive, non-diagnostic signal.
 *
 * This detector is PURELY forward-looking. It does not explain what is
 * happening biologically right now (that is detectPhaseContextSignal's job) -
 * it predicts what the user is *likely to notice soon* based on their own
 * recurring history.
 *
 * Suppression rules (all must pass for show: true):
 *   • cycleCount >= FORECAST_MIN_CYCLES_REQUIRED
 *   • phase or dayOfCycle is available
 *   • lastPeriodStart is a valid Date
 *   • symptomHistory is non-empty
 *   • cycleLengths contains enough usable values to reconstruct ≥1 past cycle
 *   • at least one symptom qualifies (≥ FORECAST_MIN_SUPPORTING_CYCLES past cycles)
 *   • hasHighPrioritySignal is false (never shows during urgent/safety flows)
 *
 * @param {Object}   params
 * @param {Array}    params.symptomHistory
 * @param {Array}    params.loggedSymptoms        - today's logged symptoms (excluded from forecast)
 * @param {string|null} params.phase
 * @param {number|null} params.dayOfCycle
 * @param {number[]} params.cycleLengths
 * @param {number}   params.cycleCount
 * @param {Date|null} params.lastPeriodStart
 * @param {boolean}  params.hasHighPrioritySignal - true when a high-level safety signal is active
 * @param {Object}   params.settings              - overrides for configurable thresholds
 * @returns {SymptomSignal}
 */
export function detectSymptomForecastSignal({
  symptomHistory        = [],
  loggedSymptoms        = [],
  phase                 = null,
  dayOfCycle            = null,
  cycleLengths          = [],
  cycleCount            = 0,
  lastPeriodStart       = null,
  hasHighPrioritySignal = false,
  settings              = {},
} = {}) {
  const minCycles           = settings.forecastMinCycles           ?? FORECAST_MIN_CYCLES_REQUIRED;
  const minSupportingCycles = settings.forecastMinSupportingCycles ?? FORECAST_MIN_SUPPORTING_CYCLES;
  const dayWindowHalf       = settings.forecastDayWindowHalf       ?? FORECAST_DAY_WINDOW_HALF;
  const maxSymptoms         = settings.forecastMaxSymptoms         ?? FORECAST_MAX_SYMPTOMS;

  const noShow = (suppressedBecause, extra = {}) => makeSignal({
    code:  "SYMPTOM_FORECAST",
    level: "low",
    show:  false,
    debug: { suppressedBecause, ...extra },
  });

  // ── Suppression checks ────────────────────────────────────────────────────

  // Never surface during urgent or safety-escalated flows
  if (hasHighPrioritySignal) {
    return noShow("high_priority_signal_active");
  }

  // Not enough cycle history to establish a pattern
  if (cycleCount < minCycles) {
    return noShow("insufficient_cycles", { cycleCount, minCycles });
  }

  // No timing context to anchor the forecast
  if (phase === null && dayOfCycle === null) {
    return noShow("no_phase_or_day_context");
  }

  // Need lastPeriodStart to reconstruct cycle timeline
  const lpsDate = lastPeriodStart instanceof Date && !isNaN(lastPeriodStart.getTime())
    ? lastPeriodStart
    : null;
  if (!lpsDate) {
    return noShow("no_last_period_start");
  }

  // Need historical data
  if (!Array.isArray(symptomHistory) || symptomHistory.length === 0) {
    return noShow("no_symptom_history");
  }

  // ── Reconstruct cycle timeline ────────────────────────────────────────────

  const cycleStarts = reconstructCycleStarts(lpsDate, cycleLengths);

  // Need at least one past cycle reconstructed (index 0 = current, index 1+ = past)
  if (cycleStarts.length < 2) {
    return noShow("insufficient_cycle_length_data", { cycleStartsReconstructed: cycleStarts.length });
  }

  // ── Build forecast candidates ─────────────────────────────────────────────

  const loggedTodayCodes = extractCodes(loggedSymptoms);
  const byCode           = groupSymptomsByCycleWindow(symptomHistory, cycleStarts);

  const candidates = getSymptomForecastCandidates(
    byCode, phase, dayOfCycle, loggedTodayCodes, minSupportingCycles, dayWindowHalf,
  );

  if (candidates.length === 0) {
    return noShow("no_qualifying_forecast_candidates", {
      totalCyclesAnalyzed:        cycleStarts.length,
      distinctCodesInHistory:     byCode.size,
      excludedAlreadyLoggedToday: [...loggedTodayCodes],
      currentPhase:               phase,
      currentDayOfCycle:          dayOfCycle,
    });
  }

  // ── Build signal ──────────────────────────────────────────────────────────

  const { selected, labels, basis } = selectForecastableSymptoms(candidates, maxSymptoms);
  const forecastCodes   = selected.map(c => c.code);
  const topSupporting   = selected[0]?.supportingCycles ?? 0;
  const topSeverityEstimate = selected[0]?.severityEstimate ?? null;
  const message         = buildForecastMessage(labels, phase, dayOfCycle, basis, topSeverityEstimate, topSupporting);

  return {
    ...makeSignal({
    code:     "SYMPTOM_FORECAST",
    level:    "low",
    show:     true,
    title:    "A familiar pattern may be approaching",
    message,
    guidance: "If these symptoms show up, log severity too so Bloom can confirm whether this cycle matches your usual pattern.",
    category: "symptom",
    debug: {
      forecastSymptoms:            forecastCodes,
      forecastBasis:               basis,
      supportingCycles:            topSupporting,
      estimatedSeverity:           topSeverityEstimate,
      estimatedSeverityLabel:      formatSeverityEstimate(topSeverityEstimate),
      currentPhase:                phase,
      currentDayOfCycle:           dayOfCycle,
      totalCyclesAnalyzed:         cycleStarts.length,
      excludedAlreadyLoggedToday:  [...loggedTodayCodes],
      candidatesBeforeSelection:   candidates.length,
    },
    }),
    priority: 4,
  };
}

function sortSymptomSignals(signals = []) {
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  return [...signals].sort((a, b) => {
    const byLevel = (priorityOrder[b.level] || 0) - (priorityOrder[a.level] || 0);
    if (byLevel !== 0) return byLevel;
    const byPriority = (Number(b.priority) || 0) - (Number(a.priority) || 0);
    if (byPriority !== 0) return byPriority;
    return String(a.code).localeCompare(String(b.code));
  });
}

/* ------------------------------------------------------------------ */
/* Main Engine                                                        */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} SymptomSignal
 * @property {string}  code
 * @property {"low"|"medium"|"high"} level
 * @property {boolean} show
 * @property {string}  title
 * @property {string}  message
 * @property {string}  guidance
 * @property {string}  category
 * @property {Object}  debug
 */

/**
 * Main Symptom Signals Engine
 *
 * Runs all detectors in dependency order and returns only signals
 * where show: true, sorted high → medium → low.
 *
 * @param {Object}  params
 * @param {Array<{code: string, severity: number, note?: string, dateKey?: string}>} [params.loggedSymptoms=[]]
 * @param {string|null}  [params.phase=null]          - "menstrual"|"follicular"|"ovulation"|"luteal"|null
 * @param {number|null}  [params.dayOfCycle=null]     - integer current day in cycle
 * @param {number[]}     [params.cycleLengths=[]]     - past cycle lengths in days
 * @param {number}       [params.cycleCount=0]        - completed cycles logged
 * @param {Array}        [params.symptomHistory=[]]   - [{dateKey, items:[{code, severity}]}]
 * @param {Date|null}    [params.lastPeriodStart=null]
 * @param {boolean}      [params.missedPeriod=false]
 * @param {boolean}      [params.pregnancyRelevant=false]
 * @param {Date}         [params.today=new Date()]
 * @param {Object}       [params.settings={}]
 * @returns {SymptomSignal[]}
 */
export function generateSymptomSignals({
  loggedSymptoms    = [],
  phase             = null,
  dayOfCycle        = null,
  cycleLengths      = [],
  cycleCount        = 0,
  symptomHistory    = [],
  lastPeriodStart   = null,
  missedPeriod      = false,
  pregnancyRelevant = false,
  today             = new Date(),
  settings          = {},
  phaseConfidence   = "high",
} = {}) {
  let signals = [];

  // 1. Data quality - always first; its output governs baseline suppression
  const dataQuality = detectDataQualitySignal({ symptomHistory, loggedSymptoms, cycleCount, settings });
  signals.push(dataQuality);
  const baselineSuppressed = dataQuality.code === "NOT_ENOUGH_HISTORY_FOR_BASELINE" && cycleCount < 2;

  // Build severity map once for all detectors
  const severityMap = buildSeverityMap(loggedSymptoms);

  // 2. Safety escalation - always second, highest precedence
  signals.push(
    detectSafetyEscalationSignal({ loggedSymptoms, severityMap, symptomHistory, today })
  );

  // 3. Phase context
  signals.push(
    detectPhaseContextSignal({ loggedSymptoms, phase, cycleLengths, phaseConfidence })
  );

  // 4. Pattern detection
  signals.push(
    detectSymptomPatternSignal({ loggedSymptoms, phase, dayOfCycle })
  );

  // 5. Baseline deviation - suppressed if NOT_ENOUGH_HISTORY_FOR_BASELINE fired
  if (!baselineSuppressed) {
    signals.push(
      detectBaselineDeviationSignal({ loggedSymptoms, symptomHistory, phase, cycleCount })
    );
  }

  // 6. Reproductive guidance
  signals.push(
    detectReproductiveGuidanceSignal({
      loggedSymptoms, phase, missedPeriod, dayOfCycle, lastPeriodStart, pregnancyRelevant,
    })
  );

  // 7. Symptom forecast - personalised, forward-looking, low priority.
  //    Suppressed when any high-priority signal is already active, so it never
  //    competes with safety or urgent guidance.
  const hasHighSignal = signals.some(s => s.level === "high" && s.show);
  signals.push(
    detectSymptomForecastSignal({
      symptomHistory,
      loggedSymptoms,
      phase,
      dayOfCycle,
      cycleLengths,
      cycleCount,
      lastPeriodStart,
      hasHighPrioritySignal: hasHighSignal,
      settings,
    })
  );

  // ── Safety signal suppression pass ────────────────────────────────────────
  // Prevent multiple overlapping safety signals from showing simultaneously.
  const signalCodes = new Set(signals.map(s => s.code));
  if (signalCodes.has("SEEK_URGENT_CARE")) {
    const redundant = new Set([
      "HEAVY_BLEEDING_FLAG", "SEVERE_PAIN_FLAG", "DIZZINESS_WITH_BLEEDING",
      "FEVER_WITH_PELVIC_SYMPTOMS", "PERSISTENT_SEVERE_SYMPTOMS",
    ]);
    signals = signals.filter(s => !redundant.has(s.code));
  } else if (signalCodes.has("URGENT_SYMPTOM_COMBINATION")) {
    const redundant = new Set(["HEAVY_BLEEDING_FLAG", "SEVERE_PAIN_FLAG"]);
    signals = signals.filter(s => !redundant.has(s.code));
  }

  return sortSymptomSignals(signals.filter(s => s.show));
}

/* ------------------------------------------------------------------ */
/* Priority Helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Returns the single highest-priority signal for compact display.
 * @param {SymptomSignal[]} signals
 * @returns {SymptomSignal|null}
 */
export function getHighestPrioritySymptomSignal(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  return sortSymptomSignals(signals)[0];
}

/* ------------------------------------------------------------------ */
/* Bloomie Integration                                                */
/* ------------------------------------------------------------------ */

/**
 * Produce a Bloomie-ready summary from generated symptom signals.
 *
 * @param {SymptomSignal[]} signals - output of generateSymptomSignals()
 * @returns {{
 *   hasUrgentSignal: boolean,
 *   primarySignal: SymptomSignal|null,
 *   bloomieInsight: string|null,
 *   guidanceLines: string[],
 *   shouldNudgeLogging: boolean,
 *   patternDetected: string|null,
 *   safetyEscalationNeeded: boolean,
 * }}
 */
export function getBloomieSymptomContext(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return {
      hasUrgentSignal:        false,
      primarySignal:          null,
      bloomieInsight:         null,
      guidanceLines:          [],
      shouldNudgeLogging:     false,
      patternDetected:        null,
      safetyEscalationNeeded: false,
    };
  }

  const hasUrgentSignal        = signals.some(s => s.level === "high");
  const safetyEscalationNeeded = signals.some(s => s.code === "SEEK_URGENT_CARE");
  const primarySignal          = getHighestPrioritySymptomSignal(signals);
  const guidanceLines          = signals.map(s => s.guidance).filter(Boolean);
  const shouldNudgeLogging     = signals.some(s => s.code === "SYMPTOM_LOGGING_GAP");

  const PATTERN_CODES = new Set([
    "SYMPTOMS_MATCH_PMS_PATTERN",
    "SYMPTOMS_MATCH_MENSTRUAL_PATTERN",
    "SYMPTOMS_MATCH_OVULATION_PATTERN",
    "SYMPTOMS_MATCH_PERIMENOPAUSE_PATTERN",
    "SYMPTOMS_MATCH_HORMONAL_PATTERN",
  ]);
  const patternSignal  = signals.find(s => PATTERN_CODES.has(s.code));
  const patternDetected = patternSignal?.code ?? null;

  // Compose a warm single-sentence Bloomie insight from the primary signal
  // Suppressed when the primary signal is a safety escalation
  let bloomieInsight = null;
  if (primarySignal && !safetyEscalationNeeded && primarySignal.title) {
    bloomieInsight = primarySignal.message || null;
  }

  return {
    hasUrgentSignal,
    primarySignal,
    bloomieInsight,
    guidanceLines,
    shouldNudgeLogging,
    patternDetected,
    safetyEscalationNeeded,
  };
}

/* ------------------------------------------------------------------ */
/* Integrated Signals Engine                                          */
/* ------------------------------------------------------------------ */

/**
 * Run both cycle and symptom engines together, cross-validate their outputs,
 * and return a unified result object.
 *
 * Step 1 - Run cycle engine.
 * Step 2 - Extract intelligence from cycle signals to enrich symptom engine inputs.
 * Step 3 - Run symptom engine with enriched inputs.
 * Step 4 - Cross-validate: elevate or annotate signals where both engines agree.
 * Step 5 - Return combined result.
 *
 * @returns {{
 *   cycleSignals: Object[],
 *   symptomSignals: SymptomSignal[],
 *   combinedUrgent: boolean,
 *   topCycleSignal: Object|null,
 *   topSymptomSignal: SymptomSignal|null,
 *   bloomieContext: Object,
 *   crossValidatedNotes: string[],
 * }}
 */
export function generateIntegratedSignals({
  // Cycle engine params
  expectedNextPeriodWindow  = null,
  today                     = new Date(),
  lastPeriodStart           = null,
  lastLogDate               = null,
  cycleLengths              = [],
  missingLogDays            = 0,
  previousPredictedDate     = null,
  currentPredictedDate      = null,
  // Symptom engine params
  loggedSymptoms            = [],
  phase                     = null,
  dayOfCycle                = null,
  cycleCount                = 0,
  symptomHistory            = [],
  missedPeriod              = false,
  pregnancyRelevant         = false,
  settings                  = {},
} = {}) {
  // Step 1 - Run cycle engine
  const cycleSignals = generateCycleSignals({
    expectedNextPeriodWindow,
    today,
    lastPeriodStart,
    lastLogDate,
    cycleLengths,
    missingLogDays,
    previousPredictedDate,
    currentPredictedDate,
    settings,
  });

  // Step 2 - Extract intelligence from cycle signals to enrich symptom inputs
  const cycleCodes = new Set(cycleSignals.map(s => s.code));
  let phaseConfidence = "high";
  let enrichedMissedPeriod = missedPeriod;
  const enrichedSettings = { ...settings };

  const lowConfSignal = cycleSignals.find(s => s.code === "LOW_PREDICTION_CONFIDENCE");
  if (lowConfSignal?.debug?.confidenceScore < 40) {
    phaseConfidence = "low";
  } else if (cycleCodes.has("IRREGULAR_CYCLE")) {
    phaseConfidence = "medium";
  }

  if (cycleCodes.has("MISSED_PERIOD") || cycleCodes.has("EXTENDED_ABSENCE")) {
    enrichedMissedPeriod = true;
  }

  if (cycleCodes.has("LENGTHENING_CYCLE_TREND") || cycleCodes.has("SHORTENING_CYCLE_TREND")) {
    enrichedSettings.cycleShiftDetected = true;
  }

  // Step 3 - Run symptom engine with enriched inputs
  let symptomSignals = generateSymptomSignals({
    loggedSymptoms,
    phase,
    dayOfCycle,
    cycleLengths,
    cycleCount,
    symptomHistory,
    lastPeriodStart,
    missedPeriod: enrichedMissedPeriod,
    pregnancyRelevant,
    today,
    settings: enrichedSettings,
    phaseConfidence,
  });

  // Step 4 - Cross-validate and annotate where both engines agree
  const crossValidatedNotes = [];
  const symptomCodes = new Set(symptomSignals.map(s => s.code));

  // Late/missed period (cycle) + PREGNANCY_TEST_TIMING_RELEVANT (symptom) → elevate to high
  if (
    (cycleCodes.has("LATE_PERIOD") || cycleCodes.has("MISSED_PERIOD")) &&
    symptomCodes.has("PREGNANCY_TEST_TIMING_RELEVANT")
  ) {
    crossValidatedNotes.push(
      "Both cycle timing and logged symptoms suggest pregnancy test timing is relevant."
    );
    symptomSignals = symptomSignals.map(s =>
      s.code === "PREGNANCY_TEST_TIMING_RELEVANT"
        ? {
            ...s,
            level: "high",
            message: s.message + " Both your cycle timing and logged symptoms suggest this is worth checking.",
          }
        : s
    );
  }

  // CYCLE_PHASE_SHIFT_POSSIBLE (symptom) + SUDDEN_CYCLE_SHIFT (cycle) → elevate to medium
  if (symptomCodes.has("CYCLE_PHASE_SHIFT_POSSIBLE") && cycleCodes.has("SUDDEN_CYCLE_SHIFT")) {
    crossValidatedNotes.push(
      "Both symptom and cycle engines detected a cycle phase shift."
    );
    symptomSignals = symptomSignals.map(s =>
      s.code === "CYCLE_PHASE_SHIFT_POSSIBLE"
        ? { ...s, level: "medium", debug: { ...s.debug, cycleEngineAgrees: true } }
        : s
    );
  }

  // SEEK_URGENT_CARE (symptom) + MISSED_PERIOD (cycle) → add ectopic risk note
  if (symptomCodes.has("SEEK_URGENT_CARE") && cycleCodes.has("MISSED_PERIOD")) {
    crossValidatedNotes.push(
      "Urgent symptoms combined with cycle engine missed period signal - ectopic risk context added."
    );
    symptomSignals = symptomSignals.map(s =>
      s.code === "SEEK_URGENT_CARE"
        ? {
            ...s,
            message: s.message + " This is particularly important to check given that your period is also late.",
          }
        : s
    );
  }

  // SYMPTOM_FORECAST suppression - cycle engine context can invalidate forecast timing.
  //   • MISSED_PERIOD / EXTENDED_ABSENCE: cycle timing is unknown; luteal-style forecasts
  //     would be misleading.
  //   • SUDDEN_CYCLE_SHIFT: reconstructed cycle positions are unreliable.
  //   • LOW_PREDICTION_CONFIDENCE (score < 40): phase assignment is too uncertain for
  //     pattern anchoring.
  const forecastShouldSuppress =
    cycleCodes.has("MISSED_PERIOD")    ||
    cycleCodes.has("EXTENDED_ABSENCE") ||
    cycleCodes.has("SUDDEN_CYCLE_SHIFT") ||
    (lowConfSignal?.debug?.confidenceScore < 40);

  if (forecastShouldSuppress) {
    const reason = cycleCodes.has("MISSED_PERIOD")    ? "missed_period_detected"
                 : cycleCodes.has("EXTENDED_ABSENCE") ? "extended_absence_detected"
                 : cycleCodes.has("SUDDEN_CYCLE_SHIFT") ? "sudden_cycle_shift_detected"
                 : "low_cycle_prediction_confidence";
    symptomSignals = symptomSignals.map(s =>
      s.code === "SYMPTOM_FORECAST"
        ? { ...s, show: false, debug: { ...s.debug, suppressedBecause: reason } }
        : s
    );
    crossValidatedNotes.push(
      `Symptom forecast suppressed by cycle engine: ${reason}.`
    );
  }

  // Step 5 - Return combined result
  const topCycleSignal   = getHighestPrioritySignal(cycleSignals);
  const topSymptomSignal = getHighestPrioritySymptomSignal(symptomSignals);
  const bloomieContext   = getBloomieSymptomContext(symptomSignals);

  return {
    cycleSignals,
    symptomSignals,
    combinedUrgent:      bloomieContext.hasUrgentSignal || cycleSignals.some(s => s.level === "high"),
    topCycleSignal,
    topSymptomSignal,
    bloomieContext,
    crossValidatedNotes,
  };
}

/* ------------------------------------------------------------------ */
/* Advanced Insights - symptom-pattern detection                      */
/* ------------------------------------------------------------------ */

/**
 * Dedupe groups for the PAIN hierarchy.
 * Only one PAIN signal surfaces - the highest-priority detector wins.
 */
const SYMPTOM_GROUPS = {
  PAIN:      ["DYSMENORRHEA_PATTERN", "PAINFUL_PERIOD_PATTERN", "MENSTRUAL_DISCOMFORT_PATTERN"],
  DISCHARGE: ["LEUKORRHEA_PATTERN"],
};

// Reverse lookup: signal code → group name (built once at load)
const _ADVSYM_TO_GROUP = {};
for (const [group, codes] of Object.entries(SYMPTOM_GROUPS)) {
  for (const code of codes) _ADVSYM_TO_GROUP[code] = group;
}

/** Numeric priority per code - higher wins deduplication within a group */
const ADVSYM_PRIORITIES = {
  PERSONAL_CURRENT_SYMPTOM_CONTEXT: 10,
  PERSONAL_SYMPTOM_CHANGE_TYPE:    9,
  DYSMENORRHEA_PATTERN:         5,
  PAINFUL_PERIOD_PATTERN:       4,
  MENSTRUAL_DISCOMFORT_PATTERN: 3,
  LEUKORRHEA_PATTERN:           2,
};

/** Wrap _makeSignal with advanced-symptom extra fields */
function _makeAdvSympSignal(p) {
  const base = _makeSignal({ category: "symptom", ...p });
  return {
    ...base,
    id:          base.code,
    priority:    ADVSYM_PRIORITIES[base.code] ?? 1,
    dedupeGroup: _ADVSYM_TO_GROUP[base.code] ?? null,
  };
}

/**
 * Human-readable labels for symptom codes used in insight messages.
 * Falls back to code.replace(/_/g, " ").toLowerCase() for unlisted codes.
 */
const _ADVSYM_LABELS = {
  CRAMPS:               "cramps",
  PELVIC_PAIN:          "pelvic pain",
  NAUSEA:               "nausea",
  FATIGUE:              "fatigue",
  DIARRHEA:             "diarrhea",
  CONSTIPATION:         "constipation",
  BLOATING:             "bloating",
  HEADACHE:             "headache",
  MOOD_SWINGS:          "mood swings",
  DEPRESSION:           "low mood",
  BREAST_TENDERNESS:    "breast tenderness",
  IRRITABILITY:         "irritability",
  ANXIETY:              "anxiety",
  CRYING_SPELLS:        "feeling emotional",
  BRAIN_FOG:            "brain fog",
  DISCHARGE_STICKY:     "sticky discharge",
  DISCHARGE_CREAMY:     "creamy discharge",
  DISCHARGE_EGGWHITE:   "egg-white discharge",
  CERVICAL_MUCUS_CHANGE:"changes in discharge",
};

function _advSympLabel(code) {
  return _ADVSYM_LABELS[code] || code.replace(/_/g, " ").toLowerCase();
}

function _advSevLabel(sev) {
  if (sev >= 5) return "severe";
  if (sev >= 4) return "high";
  if (sev >= 3) return "moderate";
  if (sev >= 2) return "mild";
  return "light";
}

function _avgSeverityLabel(items = []) {
  const values = items.map(i => Number(i?.severity) || 0).filter(n => n > 0);
  if (!values.length) return "unrated";
  return formatSeverityEstimate(values.reduce((sum, n) => sum + n, 0) / values.length) || "unrated";
}

function _resolveCurrentDateKey(symptomHistory = [], currentDateKey = null, today = new Date()) {
  if (currentDateKey) return currentDateKey;
  const latest = [...(symptomHistory || [])]
    .map(e => e?.dateKey)
    .filter(Boolean)
    .sort()
    .pop();
  return latest || toDateKey(today);
}

function _historyBeforeDate(symptomHistory = [], currentDateKey = null) {
  const currentKey = currentDateKey || _resolveCurrentDateKey(symptomHistory);
  return (symptomHistory || []).filter(e => e?.dateKey && e.dateKey < currentKey);
}

function _codeOccurrenceStats(symptomHistory = [], code) {
  const entries = (symptomHistory || []).filter(e =>
    Array.isArray(e?.items) && e.items.some(i => i.code === code)
  );
  const severities = entries
    .flatMap(e => e.items || [])
    .filter(i => i.code === code)
    .map(i => Number(i.severity) || 0)
    .filter(n => n > 0);
  return {
    count: entries.length,
    avgSeverity: severities.length ? severities.reduce((sum, n) => sum + n, 0) / severities.length : null,
    lastDateKey: entries.map(e => e.dateKey).filter(Boolean).sort().pop() || null,
  };
}

function _formatSymptomWithSeverity(item) {
  const sev = Number(item?.severity) || 0;
  const severity = formatSeverityEstimate(sev);
  return `${_advSympLabel(item?.code)}${severity ? ` (${severity})` : ""}`;
}

/**
 * Deduplicate advanced symptom signals within each group.
 * Signals without a dedupeGroup always pass through unchanged.
 *
 * @param {Object[]} signals
 * @returns {{ finalSignals: Object[], suppressedSignals: Object[] }}
 */
function _dedupeSymptomSignals(signals) {
  const LEVEL_NUM = { high: 3, medium: 2, low: 1 };
  const groupMap  = {};

  for (const s of signals) {
    if (!s.dedupeGroup) continue;
    if (!groupMap[s.dedupeGroup]) groupMap[s.dedupeGroup] = [];
    groupMap[s.dedupeGroup].push(s);
  }

  const finalSignals      = signals.filter(s => !s.dedupeGroup);
  const suppressedSignals = [];

  for (const group of Object.values(groupMap)) {
    group.sort((a, b) =>
      (b.priority - a.priority) ||
      ((LEVEL_NUM[b.level] || 0) - (LEVEL_NUM[a.level] || 0))
    );
    const [keep, ...rest] = group;
    finalSignals.push(keep);
    for (const s of rest) {
      suppressedSignals.push({ id: s.code, reason: "lower_priority_same_group" });
    }
  }

  return { finalSignals, suppressedSignals };
}

/* ── Individual advanced symptom pattern detectors ─────────────────── */

/**
 * DYSMENORRHEA_PATTERN - menstrual phase + moderate-to-high cramps/pelvic pain.
 * Most specific pain signal; takes priority over all other PAIN group signals.
 */
function _detectDysmenorrhea({ loggedSymptoms, severityMap, phase, symptomHistory }) {
  if (phase !== "menstrual") return null;

  const PRIMARY   = ["CRAMPS", "PELVIC_PAIN"];
  const SUPPORT   = ["NAUSEA", "FATIGUE", "DIARRHEA", "MOOD_SWINGS",
                     "BLOATING", "HEADACHE", "CONSTIPATION"];

  const codes      = new Set(loggedSymptoms.map(s => s.code));
  const primaryHit = PRIMARY.find(c => codes.has(c) && (severityMap[c] ?? 0) >= 3);
  if (!primaryHit) return null;

  const primarySev      = severityMap[primaryHit] ?? 0;
  const supportingFound = SUPPORT.filter(c => codes.has(c));

  // Recurrence: past history entries with primary pain at ≥ 3 severity
  const recurrence = (symptomHistory || []).filter(e =>
    Array.isArray(e.items) &&
    e.items.some(i => PRIMARY.includes(i.code) && (Number(i.severity) || 0) >= 3)
  ).length;

  const sevLabel    = _advSevLabel(primarySev);
  const level       = primarySev >= 4 ? "high" : "medium";
  const supportStr  = supportingFound.length > 0
    ? `, along with ${supportingFound.slice(0, 3).map(_advSympLabel).join(", ")}`
    : "";
  const recurrNote  = recurrence >= 2
    ? `Bloom also found that ${_advSympLabel(primaryHit)} at this level appeared in ${recurrence} previous logged sessions, which suggests this may be a recurring part of your menstrual phase. `
    : recurrence === 1
    ? `Bloom noticed similar pain was logged in a previous cycle too. `
    : "";

  const message =
    `Based on your logs, Bloom noticed ${sevLabel} ${_advSympLabel(primaryHit)} during your menstrual phase${supportStr}. ` +
    `Pain at this level during your period - especially when other symptoms are also present - tends to represent a heavier end of what people typically experience. ` +
    recurrNote +
    `Bloom flags this gently and non-diagnostically, but if this kind of pain is affecting your day-to-day, it may be worth raising with a healthcare provider.`;

  return _makeAdvSympSignal({
    code:    "DYSMENORRHEA_PATTERN",
    level,
    show:    true,
    title:   "This cycle looks more pain-heavy",
    message,
    debug: {
      matchedSymptoms: [primaryHit, ...supportingFound],
      severityMap:     Object.fromEntries([primaryHit, ...supportingFound].map(c => [c, severityMap[c] ?? 0])),
      recurrence,
      primarySeverity: primarySev,
      supportingSymptoms: supportingFound,
    },
  });
}

/**
 * PAINFUL_PERIOD_PATTERN - menstrual phase + mild cramps/pelvic pain.
 * Fires only when pain is present but below the dysmenorrhea severity threshold.
 */
function _detectPainfulPeriod({ loggedSymptoms, severityMap, phase, symptomHistory }) {
  if (phase !== "menstrual") return null;

  const PAIN_CODES = ["CRAMPS", "PELVIC_PAIN"];
  const SUPPORT    = ["BLOATING", "FATIGUE", "HEADACHE", "NAUSEA"];
  const codes      = new Set(loggedSymptoms.map(s => s.code));

  const painHit  = PAIN_CODES.find(c => codes.has(c));
  if (!painHit) return null;

  const painSev = severityMap[painHit] ?? 0;
  // Dysmenorrhea detector handles severity ≥ 3; this is the softer fallback
  if (painSev >= 3) return null;

  const supporting = SUPPORT.filter(c => codes.has(c));
  const recurrence = (symptomHistory || []).filter(e =>
    Array.isArray(e.items) && e.items.some(i => PAIN_CODES.includes(i.code))
  ).length;

  const sevLabel    = _advSevLabel(painSev);
  const supportStr  = supporting.length > 0
    ? `, and also logged ${supporting.map(_advSympLabel).join(" and ")}`
    : "";
  const recurrNote  = recurrence >= 2
    ? `This kind of discomfort has come up in ${recurrence} previous logged sessions, which suggests it may be a consistent part of your menstrual phase. `
    : "Tracking this across a few more cycles will help Bloom build a clearer picture of your usual pattern. ";

  const message =
    `Bloom noticed ${sevLabel} ${_advSympLabel(painHit)} in your logs during your period${supportStr}. ` +
    recurrNote +
    `Mild period discomfort is very common, and Bloom is noting this pattern so your logs stay as complete as possible - not to flag anything concerning.`;

  return _makeAdvSympSignal({
    code:    "PAINFUL_PERIOD_PATTERN",
    level:   "low",
    show:    true,
    title:   "Some discomfort noted during your period",
    message,
    debug: {
      matchedSymptoms: [painHit, ...supporting],
      severityMap:     { [painHit]: painSev, ...Object.fromEntries(supporting.map(c => [c, severityMap[c] ?? 0])) },
      recurrence,
      primarySeverity: painSev,
    },
  });
}

/**
 * MENSTRUAL_DISCOMFORT_PATTERN - menstrual phase + broad symptom cluster (≥ 2 symptoms).
 * The widest-net pain fallback; fires when no pain-specific pattern qualifies.
 */
function _detectMenstrualDiscomfort({ loggedSymptoms, severityMap, phase, symptomHistory }) {
  if (phase !== "menstrual") return null;

  const CLUSTER = [
    "FATIGUE", "BLOATING", "HEADACHE", "MOOD_SWINGS", "NAUSEA",
    "CRAMPS", "DEPRESSION", "IRRITABILITY", "ANXIETY", "CRYING_SPELLS",
    "BRAIN_FOG", "CONSTIPATION", "DIARRHEA", "APPETITE_INCREASE",
  ];

  const codes   = new Set(loggedSymptoms.map(s => s.code));
  const matched = CLUSTER.filter(c => codes.has(c));
  if (matched.length < 2) return null;

  const topSymptoms = [...matched]
    .sort((a, b) => (severityMap[b] ?? 0) - (severityMap[a] ?? 0))
    .slice(0, 4);

  const avgSev  = topSymptoms.reduce((sum, c) => sum + (severityMap[c] ?? 0), 0) / topSymptoms.length;
  const level   = avgSev >= 3 ? "medium" : "low";
  const extra   = matched.length > 4 ? ` and ${matched.length - 4} more` : "";

  const recurrence = (symptomHistory || []).filter(e =>
    Array.isArray(e.items) && e.items.filter(i => CLUSTER.includes(i.code)).length >= 2
  ).length;

  const recurrNote = recurrence >= 2
    ? `A similar cluster of symptoms showed up in ${recurrence} previous logged sessions, which suggests this broader load may be part of your regular menstrual phase. `
    : "";

  const message =
    `Bloom noticed a broader symptom load across your logs today: ${topSymptoms.map(_advSympLabel).join(", ")}${extra}. ` +
    `While none of these stand out as severe on their own, logging ${matched.length} symptoms together during your menstrual phase suggests your body is going through a busier stretch than usual. ` +
    recurrNote +
    `Keeping track of this pattern over time helps Bloom build a more accurate picture of what your menstrual phase typically looks and feels like for you.`;

  return _makeAdvSympSignal({
    code:    "MENSTRUAL_DISCOMFORT_PATTERN",
    level,
    show:    true,
    title:   "Higher overall symptom load this cycle",
    message,
    debug: {
      matchedSymptoms: matched,
      severityMap:     Object.fromEntries(matched.map(c => [c, severityMap[c] ?? 0])),
      recurrence,
      totalCount:      matched.length,
      avgSeverity:     Number(avgSev.toFixed(2)),
    },
  });
}

/**
 * LEUKORRHEA_PATTERN - recurring normal discharge outside the menstrual phase.
 * Suppressed when UNUSUAL_DISCHARGE is also present (that warrants separate attention).
 * Requires ≥ 2 past occurrences of normal discharge to qualify as a pattern.
 */
function _detectLeukorrhea({ loggedSymptoms, severityMap, phase, symptomHistory }) {
  // Discharge is harder to observe during bleeding - skip menstrual phase
  if (phase === "menstrual" || !phase) return null;

  const NORMAL_CODES = [
    "DISCHARGE_STICKY", "DISCHARGE_CREAMY", "DISCHARGE_EGGWHITE", "CERVICAL_MUCUS_CHANGE",
  ];
  const codes = new Set(loggedSymptoms.map(s => s.code));

  // If abnormal discharge is present, don't surface a routine discharge pattern
  if (codes.has("UNUSUAL_DISCHARGE")) return null;

  const presentNormal = NORMAL_CODES.filter(c => codes.has(c));
  if (presentNormal.length === 0) return null;

  const recurrence = (symptomHistory || []).filter(e =>
    Array.isArray(e.items) && e.items.some(i => NORMAL_CODES.includes(i.code))
  ).length;

  // Need at least 2 historical occurrences to call this a pattern
  if (recurrence < 2) return null;

  const phaseLabel   = phase === "follicular" ? "follicular" : phase === "ovulation" ? "ovulation" : "current";
  const dischargeStr = presentNormal.map(_advSympLabel).join(" and ");

  const message =
    `Bloom noticed ${dischargeStr} logged during your ${phaseLabel} phase. ` +
    `Looking back at your history, similar discharge has appeared in ${recurrence} previous logged sessions, which suggests this is a consistent pattern for this part of your cycle. ` +
    `Normal changes in discharge throughout the cycle reflect the body's hormonal rhythm, and Bloom tracks these to build a more complete picture of your personal baseline. ` +
    `If the discharge ever looks or feels noticeably different from what you usually see, that would be worth logging separately.`;

  return _makeAdvSympSignal({
    code:    "LEUKORRHEA_PATTERN",
    level:   "low",
    show:    true,
    title:   "Recurring discharge pattern noted",
    message,
    debug: {
      matchedSymptoms: presentNormal,
      severityMap:     Object.fromEntries(presentNormal.map(c => [c, severityMap[c] ?? 0])),
      phase,
      recurrence,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Advanced Symptom Insights engine                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate Advanced Insight signals from symptom-pattern analysis.
 *
 * Applies the PAIN hierarchy (DYSMENORRHEA → PAINFUL_PERIOD → MENSTRUAL_DISCOMFORT)
 * so only the most specific pain signal is surfaced. All signals within a group
 * are deduplicated before returning.
 *
 * @param {Object} params
 * @param {Array<{code: string, severity: number}>} params.loggedSymptoms
 *   - symptoms logged in the current session
 * @param {"menstrual"|"follicular"|"ovulation"|"luteal"|null} params.phase
 *   - current cycle phase
 * @param {Array<{dateKey: string, items: Array<{code: string, severity: number}>}>} params.symptomHistory
 *   - full historical log entries, used for recurrence checks
 * @param {Object} [params.settings]
 *   - optional threshold overrides (reserved for future use)
 *
 * @returns {{
 *   signals: Object[],
 *   debug: { rawSignals: Object[], suppressedSignals: Object[], selectedSignals: Object[] }
 * }}
 */
export function generateAdvancedSymptomInsights({
  loggedSymptoms  = [],
  phase           = null,
  symptomHistory  = [],
  settings        = {},
} = {}) {
  const severityMap = buildSeverityMap(loggedSymptoms);
  const rawSignals  = [];

  const dysmen = _detectDysmenorrhea({ loggedSymptoms, severityMap, phase, symptomHistory });
  if (dysmen) rawSignals.push(dysmen);

  const painful = _detectPainfulPeriod({ loggedSymptoms, severityMap, phase, symptomHistory });
  if (painful) rawSignals.push(painful);

  const discomfort = _detectMenstrualDiscomfort({ loggedSymptoms, severityMap, phase, symptomHistory });
  if (discomfort) rawSignals.push(discomfort);

  const leukorrhea = _detectLeukorrhea({ loggedSymptoms, severityMap, phase, symptomHistory });
  if (leukorrhea) rawSignals.push(leukorrhea);

  const { finalSignals, suppressedSignals } = _dedupeSymptomSignals(rawSignals);

  return {
    signals: finalSignals,
    debug: {
      rawSignals:        rawSignals.map(s => ({ id: s.code, group: s.dedupeGroup, priority: s.priority, level: s.level })),
      suppressedSignals,
      selectedSignals:   finalSignals.map(s => ({ id: s.code, group: s.dedupeGroup })),
    },
  };
}
