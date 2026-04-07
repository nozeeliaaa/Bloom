/**
 * src/utils/bloomie/memory/defaultMemory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Memory shape helpers for Bloomie.
 *
 * getDefaultBloomieMemory() → BloomieMemory
 *   Returns the full memory schema with safe defaults.
 *   Every field is present — no undefined values.
 *
 * mergeMemory(existing, updates) → BloomieMemory
 *   Safely merges an updates patch into an existing memory object.
 *   Preserves existing fields, enforces type and length limits.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

const LIMITS = {
  recentTopics:            5,
  symptoms:                20,
  contentSuggestionsShown: 50,
  declinedSuggestions:     50,
  stringShort:             100,
  stringMedium:            200,
  oosCount:                9999,
};

// ─────────────────────────────────────────────────────────────────────────────
// Whitelists (mirrors bloomieMemory.js — kept local so this module is self-contained)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SYMPTOM_KEYS = new Set([
  "late","heavy","spotting","pelvic","mood","discharge","nausea","dizziness",
  "large_clots","ovulation_pain","headache","joint_pain","breast_tender",
  "bloating","gassy","heartburn","constipation","diarrhea",
  "discharge_eggwhite","discharge_creamy","discharge_sticky","unusual_discharge",
  "acne","dry_skin","hair_thinning","hot_flashes","night_sweats","cold_flashes",
  "bbt_shift","brain_fog","forgetful","poor_concentration","anxiety","depression",
  "crying_spells","irritability","insomnia","craving_sweet","craving_salty",
  "craving_greasy","craving_spicy","appetite_increase","appetite_decrease",
  "libido_high","libido_low","cervical_mucus","vaginal_dryness","pain_during_sex",
  "irregular","fluid_retention","frequent_urination","weight_change",
  "smell_sensitivity","nasal_congestion",
]);

const VALID_SEVERITIES = new Set(["mild", "moderate", "severe"]);

const VALID_RESOLUTION_STATUSES = new Set(["resolved", "unresolved", "skipped"]);

const VALID_OOS_CATEGORIES = new Set([
  "diagnosis_request",
  "unsafe_instruction",
  "unrelated_query",
  "platform_question",
]);

// ─────────────────────────────────────────────────────────────────────────────
// getDefaultBloomieMemory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getDefaultBloomieMemory() → BloomieMemory
 *
 * Returns the full memory schema initialised to safe defaults.
 *
 * Guarantees:
 *   • Every key is present — no field is ever undefined.
 *   • Arrays default to [].
 *   • Booleans default to false.
 *   • Numbers default to 0.
 *   • Nullable strings default to null.
 *
 * @returns {{
 *   lastSessionDate:         string | null,
 *   lastSymptoms:            string[],
 *   lastIntent:              string | null,
 *   lastSeverity:            "mild" | "moderate" | "severe" | null,
 *   lastDuration:            { days: number|null, weeks: number|null, unit: string|null, value: number|null } | null,
 *   lastPregnancyChance:     boolean,
 *   recentTopics:            string[],
 *   contentSuggestionsShown: string[],
 *   declinedSuggestions:     string[],
 *   lastGreetingUsed:        string | null,
 *   lastResolutionStatus:    "resolved" | "unresolved" | "skipped" | null,
 *   closeIntentDetected:     boolean,
 *   lastOosCategory:         string | null,
 *   oosCount:                number,
 *   lastSafeRedirect:        string | null,
 *   urgentFlag:              boolean,
 *   redFlagNoticeShown:      boolean,
 * }}
 */
export function getDefaultBloomieMemory() {
  return {
    lastSessionDate:         null,
    lastSymptoms:            [],
    lastIntent:              null,
    lastSeverity:            null,
    lastDuration:            null,
    lastPregnancyChance:     false,
    recentTopics:            [],
    contentSuggestionsShown: [],
    declinedSuggestions:     [],
    lastGreetingUsed:        null,
    lastResolutionStatus:    null,
    closeIntentDetected:     false,
    lastOosCategory:         null,
    oosCount:                0,
    lastSafeRedirect:        null,
    urgentFlag:              false,
    redFlagNoticeShown:      false,
    lastConcernsResolved:    [],
    lastConcernsUnresolved:  [],
    lastAdviceGiven:         [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeMemory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mergeMemory(existing, updates) → BloomieMemory
 *
 * Merges a partial `updates` patch into an `existing` memory object.
 *
 * Rules:
 *   • Always starts from getDefaultBloomieMemory() so every field is present.
 *   • Existing values are preserved when the corresponding update field is
 *     absent, null, or fails validation.
 *   • Each field is individually validated and coerced — no raw spread.
 *   • Enforces length limits (arrays capped, strings truncated).
 *   • Raw user text is never written — string fields are length-capped only.
 *
 * @param {Partial<BloomieMemory>} existing — current persisted memory (may be partial)
 * @param {Partial<BloomieMemory>} updates  — incoming patch (may be partial)
 *
 * @returns {BloomieMemory} — fully-shaped merged result
 */
export function mergeMemory(existing = {}, updates = {}) {
  // Start from the canonical default so every key is guaranteed present.
  const base    = getDefaultBloomieMemory();
  const current = typeof existing === "object" && existing !== null ? existing : {};
  const patch   = typeof updates  === "object" && updates  !== null ? updates  : {};

  // Helper — pick the first defined, non-null value from a priority list.
  const first = (...vals) => vals.find(v => v !== undefined && v !== null) ?? null;

  // ── lastSessionDate ────────────────────────────────────────────────────────
  const rawDate = first(patch.lastSessionDate, current.lastSessionDate);
  base.lastSessionDate = typeof rawDate === "string" ? rawDate.slice(0, 30) : null;

  // ── lastSymptoms ───────────────────────────────────────────────────────────
  const symptomSrc = Array.isArray(patch.lastSymptoms)
    ? patch.lastSymptoms
    : Array.isArray(current.lastSymptoms)
      ? current.lastSymptoms
      : [];
  base.lastSymptoms = symptomSrc
    .filter(s => typeof s === "string" && VALID_SYMPTOM_KEYS.has(s))
    .slice(0, LIMITS.symptoms);

  // ── lastIntent ─────────────────────────────────────────────────────────────
  const rawIntent = first(patch.lastIntent, current.lastIntent);
  base.lastIntent = typeof rawIntent === "string" ? rawIntent.slice(0, LIMITS.stringShort) : null;

  // ── lastSeverity ───────────────────────────────────────────────────────────
  const rawSev = first(patch.lastSeverity, current.lastSeverity);
  base.lastSeverity = VALID_SEVERITIES.has(rawSev) ? rawSev : null;

  // ── lastDuration ───────────────────────────────────────────────────────────
  const durSrc = (patch.lastDuration !== undefined ? patch.lastDuration : current.lastDuration);
  if (durSrc && typeof durSrc === "object") {
    base.lastDuration = {
      days:  typeof durSrc.days  === "number" ? durSrc.days  : null,
      weeks: typeof durSrc.weeks === "number" ? durSrc.weeks : null,
      unit:  typeof durSrc.unit  === "string" ? durSrc.unit.slice(0, 20) : null,
      value: typeof durSrc.value === "number" ? durSrc.value : null,
    };
  } else {
    base.lastDuration = null;
  }

  // ── lastPregnancyChance ────────────────────────────────────────────────────
  const rawPregChance = patch.lastPregnancyChance !== undefined
    ? patch.lastPregnancyChance
    : current.lastPregnancyChance;
  base.lastPregnancyChance = !!rawPregChance;

  // ── recentTopics ───────────────────────────────────────────────────────────
  const topicSrc = Array.isArray(patch.recentTopics)
    ? patch.recentTopics
    : Array.isArray(current.recentTopics)
      ? current.recentTopics
      : [];
  base.recentTopics = topicSrc
    .filter(t => typeof t === "string" && t.length > 0)
    .map(t => t.slice(0, 50))
    .slice(0, LIMITS.recentTopics);

  // ── contentSuggestionsShown ────────────────────────────────────────────────
  const shownSrc = Array.isArray(patch.contentSuggestionsShown)
    ? patch.contentSuggestionsShown
    : Array.isArray(current.contentSuggestionsShown)
      ? current.contentSuggestionsShown
      : [];
  base.contentSuggestionsShown = shownSrc
    .filter(id => typeof id === "string" && id.length > 0 && id.length <= 80)
    .slice(0, LIMITS.contentSuggestionsShown);

  // ── declinedSuggestions ────────────────────────────────────────────────────
  const declinedSrc = Array.isArray(patch.declinedSuggestions)
    ? patch.declinedSuggestions
    : Array.isArray(current.declinedSuggestions)
      ? current.declinedSuggestions
      : [];
  base.declinedSuggestions = declinedSrc
    .filter(id => typeof id === "string" && id.length > 0 && id.length <= 80)
    .slice(0, LIMITS.declinedSuggestions);

  // ── lastGreetingUsed ───────────────────────────────────────────────────────
  const rawGreeting = first(patch.lastGreetingUsed, current.lastGreetingUsed);
  base.lastGreetingUsed = typeof rawGreeting === "string" && rawGreeting.trim().length > 0
    ? rawGreeting.trim().slice(0, LIMITS.stringMedium)
    : null;

  // ── lastResolutionStatus ───────────────────────────────────────────────────
  const rawRes = first(patch.lastResolutionStatus, current.lastResolutionStatus);
  base.lastResolutionStatus = VALID_RESOLUTION_STATUSES.has(rawRes) ? rawRes : null;

  // ── closeIntentDetected ────────────────────────────────────────────────────
  const rawClose = patch.closeIntentDetected !== undefined
    ? patch.closeIntentDetected
    : current.closeIntentDetected;
  base.closeIntentDetected = !!rawClose;

  // ── lastOosCategory ────────────────────────────────────────────────────────
  const rawOosCat = first(patch.lastOosCategory, current.lastOosCategory);
  base.lastOosCategory = VALID_OOS_CATEGORIES.has(rawOosCat) ? rawOosCat : null;

  // ── oosCount ───────────────────────────────────────────────────────────────
  const rawOosCount = patch.oosCount !== undefined ? patch.oosCount : current.oosCount;
  base.oosCount = typeof rawOosCount === "number" && rawOosCount >= 0
    ? Math.min(Math.floor(rawOosCount), LIMITS.oosCount)
    : 0;

  // ── lastSafeRedirect ───────────────────────────────────────────────────────
  const rawRedirect = first(patch.lastSafeRedirect, current.lastSafeRedirect);
  base.lastSafeRedirect = typeof rawRedirect === "string"
    ? rawRedirect.slice(0, LIMITS.stringShort)
    : null;

  // ── urgentFlag ─────────────────────────────────────────────────────────────
  // Once set to true this session, it stays true regardless of patch.
  const rawUrgent = patch.urgentFlag !== undefined ? patch.urgentFlag : current.urgentFlag;
  base.urgentFlag = !!(rawUrgent || current.urgentFlag);

  // ── redFlagNoticeShown ─────────────────────────────────────────────────────
  const rawNotice = patch.redFlagNoticeShown !== undefined
    ? patch.redFlagNoticeShown
    : current.redFlagNoticeShown;
  base.redFlagNoticeShown = !!rawNotice;

  // ── lastConcernsResolved ───────────────────────────────────────────────────
  const VALID_TOPIC_CODES = new Set(["late","heavy","spot","pelvic","mood","pregnancy","discharge","general"]);
  const resolvedSrc = Array.isArray(patch.lastConcernsResolved)
    ? patch.lastConcernsResolved
    : Array.isArray(current.lastConcernsResolved) ? current.lastConcernsResolved : [];
  base.lastConcernsResolved = resolvedSrc
    .filter(t => typeof t === "string" && VALID_TOPIC_CODES.has(t))
    .slice(0, 5);

  // ── lastConcernsUnresolved ─────────────────────────────────────────────────
  const unresolvedSrc = Array.isArray(patch.lastConcernsUnresolved)
    ? patch.lastConcernsUnresolved
    : Array.isArray(current.lastConcernsUnresolved) ? current.lastConcernsUnresolved : [];
  base.lastConcernsUnresolved = unresolvedSrc
    .filter(t => typeof t === "string" && VALID_TOPIC_CODES.has(t))
    .slice(0, 5);

  // ── lastAdviceGiven ────────────────────────────────────────────────────────
  const VALID_ADVICE_PREFIXES = ["told_to_test","told_to_seek_care","told_to_monitor","logging_nudge"];
  const adviceSrc = Array.isArray(patch.lastAdviceGiven)
    ? patch.lastAdviceGiven
    : Array.isArray(current.lastAdviceGiven) ? current.lastAdviceGiven : [];
  base.lastAdviceGiven = adviceSrc
    .filter(k => typeof k === "string" && k.length <= 60 &&
      VALID_ADVICE_PREFIXES.some(pfx => k === pfx || k.startsWith(pfx + "_")))
    .slice(0, 10);

  return base;
}
