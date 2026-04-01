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
  BLEEDING:     ["VAGINAL_BLEEDING", "SPOTTING", "HEAVY_FLOW", "LARGE_CLOTS"],
  PAIN:         ["CRAMPS", "PELVIC_PAIN", "OVULATION_PAIN", "HEADACHE", "JOINT_PAIN", "BREAST_TENDERNESS"],
  DIGESTIVE:    ["BLOATING", "GASSY", "HEARTBURN", "NAUSEA", "CONSTIPATION", "DIARRHEA"],
  DISCHARGE:    ["DISCHARGE_NONE", "DISCHARGE_STICKY", "DISCHARGE_CREAMY", "DISCHARGE_EGGWHITE", "UNUSUAL_DISCHARGE"],
  PHYSICAL:     ["FATIGUE", "FLUID_RETENTION", "FREQUENT_URINATION", "WEIGHT_CHANGE", "NASAL_CONGESTION", "SMELL_SENSITIVITY"],
  SKIN_HAIR:    ["ACNE", "DRY_SKIN", "HAIR_THINNING"],
  TEMPERATURE:  ["HOT_FLASHES", "NIGHT_SWEATS", "COLD_FLASHES", "BBT_SHIFT"],
  COGNITIVE:    ["BRAIN_FOG", "FORGETFUL", "POOR_CONCENTRATION"],
  MOOD:         ["MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "DEPRESSION", "CRYING_SPELLS", "CALM", "STRESSED"],
  SLEEP:        ["INSOMNIA"],
  APPETITE:     ["CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY", "CRAVING_SPICY", "APPETITE_INCREASE", "APPETITE_DECREASE"],
  REPRODUCTIVE: ["INCREASED_LIBIDO", "DECREASED_LIBIDO", "CERVICAL_MUCUS_CHANGE", "VAGINAL_DRYNESS", "PAIN_DURING_SEX", "MISSED_PERIOD", "IRREGULAR_PERIOD"],
};

/** Flat list of all 60 valid symptom codes */
export const ALL_SYMPTOM_CODES = Object.values(SYMPTOM_CATEGORIES).flat();


/* ------------------------------------------------------------------ */
/* Phase Map - single source of truth for phase-context logic        */
/* ------------------------------------------------------------------ */

export const SYMPTOM_PHASE_MAP = {
  menstrual: {
    expected: [
      "VAGINAL_BLEEDING", "HEAVY_FLOW", "LARGE_CLOTS",
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
      "VAGINAL_BLEEDING", "HEAVY_FLOW", "LARGE_CLOTS",
      "MOOD_SWINGS", "DEPRESSION", "CRYING_SPELLS",
    ],
  },
  ovulation: {
    expected: [
      "DISCHARGE_EGGWHITE", "OVULATION_PAIN", "BBT_SHIFT",
      "INCREASED_LIBIDO", "SPOTTING", "CERVICAL_MUCUS_CHANGE",
      "CALM", "BREAST_TENDERNESS",
    ],
    unexpected: [
      "VAGINAL_BLEEDING", "HEAVY_FLOW", "LARGE_CLOTS",
    ],
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
      "HEAVY_FLOW", "LARGE_CLOTS",
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

/** Menstrual cluster - VAGINAL_BLEEDING required, then ≥2 of these */
const MENSTRUAL_CLUSTER_SUPPORT = [
  "CRAMPS", "FATIGUE", "BLOATING", "MOOD_SWINGS", "HEADACHE", "NAUSEA",
];

/** Ovulation cluster - DISCHARGE_EGGWHITE required, then ≥1 of these */
const OVULATION_CLUSTER_SUPPORT = [
  "OVULATION_PAIN", "BBT_SHIFT", "INCREASED_LIBIDO", "SPOTTING",
];

/** Perimenopause cluster - requires ≥3 of these */
const PERIMENOPAUSE_CLUSTER = [
  "HOT_FLASHES", "NIGHT_SWEATS", "INSOMNIA", "MOOD_SWINGS",
  "IRREGULAR_PERIOD", "VAGINAL_DRYNESS", "BRAIN_FOG", "DECREASED_LIBIDO",
];

/** Hormonal pattern (PCOS-adjacent) - requires ≥2 of set A + ≥1 of set B */
const HORMONAL_CLUSTER_A = ["ACNE", "HAIR_THINNING", "WEIGHT_CHANGE", "IRREGULAR_PERIOD"];
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
  if (codes.has("VAGINAL_BLEEDING")) {
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

  if ((missedPeriod || codes.has("MISSED_PERIOD")) && pregnancyMatches.length > 0) {
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

  // ── SPOTTING_CONTEXT_NOTE ─────────────────────────────────────────────────
  if (codes.has("SPOTTING")) {
    // Spotting with pain or unusual discharge → elevate
    if (codes.has("PELVIC_PAIN") || codes.has("UNUSUAL_DISCHARGE")) {
      return makeSignal({
        code: "SPOTTING_CONTEXT_NOTE",
        level: "medium",
        show: true,
        title: "Spotting with other symptoms - worth a check",
        message: "Spotting alongside pelvic pain or unusual discharge is worth getting checked by a provider, especially if it's new or different for you.",
        guidance: "If the spotting is light and you feel well, monitor for 48 hours. If it's accompanied by pain or changes, seek a provider's input.",
        debug: { phase, hasPain: codes.has("PELVIC_PAIN"), hasDischarge: codes.has("UNUSUAL_DISCHARGE") },
      });
    }
    if (phase === "follicular") {
      return makeSignal({
        code: "SPOTTING_CONTEXT_NOTE",
        level: "low",
        show: true,
        title: "Spotting in the follicular phase",
        message: "Light spotting in the follicular phase can have hormonal causes and is often not urgent, but it's worth noting.",
        guidance: "Log the duration and any other symptoms. If it recurs across cycles or is heavier than spotting, mention it to a provider.",
        debug: { phase },
      });
    }
    if (phase === "luteal") {
      return makeSignal({
        code: "SPOTTING_CONTEXT_NOTE",
        level: "low",
        show: true,
        title: "Spotting in the luteal phase",
        message: "Spotting in the luteal phase can happen for various hormonal reasons, including around the time of implantation if applicable.",
        guidance: "Keep logging - if this becomes a regular pattern, it's worth mentioning to a provider.",
        debug: { phase },
      });
    }
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
  if (phase === "follicular" && codes.has("VAGINAL_BLEEDING") && codes.has("CRAMPS")) {
    return makeSignal({
      code: "CYCLE_PHASE_SHIFT_POSSIBLE",
      level: "low",
      show: true,
      title: "Cycle timing may have shifted",
      message: "Bloom noticed bleeding and cramps logged in what appears to be your follicular phase. Your period may have started earlier than predicted.",
      guidance: "Update your last period date in the dashboard to keep your predictions accurate.",
      debug: { phase, marker: "BLEEDING_IN_FOLLICULAR" },
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

  // Rule 1: Heavy flow severe + fatigue (dizziness-adjacent)
  if (codes.has("HEAVY_FLOW") && sev("HEAVY_FLOW") >= SEVERITY_SEVERE && codes.has("FATIGUE")) {
    return makeSignal({
      code: "SEEK_URGENT_CARE",
      level: "high",
      show: true,
      title: "This needs attention today",
      message: "Heavy flow at this level combined with significant fatigue needs same-day attention.",
      guidance: "Please seek care today - these symptoms together should be assessed by a clinician.",
      category: "safety",
      debug: {
        triggers:   ["HEAVY_FLOW", "FATIGUE"],
        severities: { HEAVY_FLOW: sev("HEAVY_FLOW"), FATIGUE: sev("FATIGUE") },
        daysLogged: 1,
      },
    });
  }

  // Rule 2: Heavy flow + large clots at elevated severity
  if (codes.has("HEAVY_FLOW") && codes.has("LARGE_CLOTS") && sev("LARGE_CLOTS") >= SEVERITY_ELEVATED) {
    return makeSignal({
      code: "SEEK_URGENT_CARE",
      level: "high",
      show: true,
      title: "This needs attention today",
      message: "Heavy bleeding with large clots at this intensity needs same-day assessment.",
      guidance: "Please seek care today - heavy flow with large clots should not be managed at home without guidance.",
      category: "safety",
      debug: {
        triggers:   ["HEAVY_FLOW", "LARGE_CLOTS"],
        severities: { HEAVY_FLOW: sev("HEAVY_FLOW"), LARGE_CLOTS: sev("LARGE_CLOTS") },
        daysLogged: 1,
      },
    });
  }

  // Rule 3: Ectopic risk indicator - cramps + spotting + missed period
  if (
    codes.has("CRAMPS") && sev("CRAMPS") >= SEVERITY_SEVERE &&
    codes.has("SPOTTING") &&
    codes.has("MISSED_PERIOD")
  ) {
    return makeSignal({
      code: "SEEK_URGENT_CARE",
      level: "high",
      show: true,
      title: "This needs attention today",
      message: "Severe cramping alongside spotting and a missed period needs to be checked urgently. In rare cases this combination can indicate something that needs prompt assessment.",
      guidance: "Please seek care today - do not wait to see if this resolves on its own.",
      category: "safety",
      debug: {
        triggers:   ["CRAMPS", "SPOTTING", "MISSED_PERIOD"],
        severities: { CRAMPS: sev("CRAMPS") },
        note:       "ectopic_risk_indicator",
        daysLogged: 1,
      },
    });
  }

  // Rule 4: Severe pelvic pain with fever proxy
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
    codes.has("HEAVY_FLOW") && sev("HEAVY_FLOW") >= SEVERITY_ELEVATED,
    codes.has("PELVIC_PAIN") && sev("PELVIC_PAIN") >= SEVERITY_ELEVATED,
    codes.has("UNUSUAL_DISCHARGE"),
    codes.has("NIGHT_SWEATS") && codes.has("PELVIC_PAIN"),
    codes.has("LARGE_CLOTS"),
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
          codes.has("HEAVY_FLOW") && sev("HEAVY_FLOW") >= SEVERITY_ELEVATED ? `HEAVY_FLOW(${sev("HEAVY_FLOW")})` : null,
          codes.has("PELVIC_PAIN") && sev("PELVIC_PAIN") >= SEVERITY_ELEVATED ? `PELVIC_PAIN(${sev("PELVIC_PAIN")})` : null,
          codes.has("UNUSUAL_DISCHARGE") ? "UNUSUAL_DISCHARGE" : null,
          codes.has("NIGHT_SWEATS") && codes.has("PELVIC_PAIN") ? "NIGHT_SWEATS+PELVIC_PAIN" : null,
          codes.has("LARGE_CLOTS") ? "LARGE_CLOTS" : null,
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

  // ── DIZZINESS_WITH_BLEEDING (level: high) ─────────────────────────────────
  if (codes.has("HEAVY_FLOW") && sev("FATIGUE") >= SEVERITY_ELEVATED) {
    return makeSignal({
      code: "DIZZINESS_WITH_BLEEDING",
      level: "high",
      show: true,
      title: "Heavy bleeding with significant fatigue",
      message: "Heavy bleeding with significant fatigue or dizziness needs same-day attention.",
      guidance: "Please seek care today - heavy bleeding combined with fatigue can indicate anaemia or other conditions that need assessment.",
      category: "safety",
      debug: {
        triggers:   ["HEAVY_FLOW", "FATIGUE"],
        severities: { HEAVY_FLOW: sev("HEAVY_FLOW"), FATIGUE: sev("FATIGUE") },
        daysLogged: 1,
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

  // ── HEAVY_BLEEDING_FLAG (level: medium) ───────────────────────────────────
  if (codes.has("HEAVY_FLOW") || codes.has("LARGE_CLOTS")) {
    return makeSignal({
      code: "HEAVY_BLEEDING_FLAG",
      level: "medium",
      show: true,
      title: "Heavy flow logged",
      message: "Bloom noticed heavy flow or clots in your log. Heavy flow is worth monitoring.",
      guidance: "If you're soaking through protection quickly or passing large clots, seek care sooner rather than later.",
      category: "safety",
      debug: {
        triggers:   [codes.has("HEAVY_FLOW") ? "HEAVY_FLOW" : null, codes.has("LARGE_CLOTS") ? "LARGE_CLOTS" : null].filter(Boolean),
        severities: { HEAVY_FLOW: sev("HEAVY_FLOW"), LARGE_CLOTS: sev("LARGE_CLOTS") },
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

  const priorityOrder = { high: 3, medium: 2, low: 1 };

  return signals
    .filter(s => s.show)
    .sort((a, b) => {
      const byLevel = (priorityOrder[b.level] || 0) - (priorityOrder[a.level] || 0);
      if (byLevel !== 0) return byLevel;
      return String(a.code).localeCompare(String(b.code));
    });
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
  const priority = { high: 3, medium: 2, low: 1 };
  if (!Array.isArray(signals) || signals.length === 0) return null;
  return [...signals].sort((a, b) => {
    const byLevel = (priority[b.level] || 0) - (priority[a.level] || 0);
    if (byLevel !== 0) return byLevel;
    return String(a.code).localeCompare(String(b.code));
  })[0];
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
