/**
 * bloomie-routing.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Intent detection and routing utilities for Bloomie.
 *
 * All exports are PURE functions (no DOM, no closure state, no ctx references).
 * This makes them independently testable and reusable outside initBloomieChat.
 *
 * Modules:
 *   1. String utilities   - normalizeText, safeEcho, pick, looksLikeGibberish
 *   2. OOS detection      - detectOutOfScope, resolveOOSFollowUp
 *   3. Signal scoring     - scoreSignals(text) → { sig, has }
 *   4. Route resolution   - resolveSignals(sig, has) → route | null
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { normalizePatois } from "./bloomie-patois.js";
import { normalizeBloomieText } from "./bloomie-normalize.js";


// ─── 1. STRING UTILITIES ──────────────────────────────────────────────────────

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function normalizeText(s) {
  return normalizeBloomieText(s, { stripSpecialChars: true });
}

export function safeEcho(s, max = 52) {
  const t = normalizeText(s);
  if (!t) return "";
  return t.length > max ? t.slice(0, max).trim() + "…" : t;
}

const SHORT_REAL_WORDS = new Set([
  "hi","hey","yo","ok","no","yes","yep","nah","nope","yah","ya",
  "ow","ugh","hmm","hm","lol","lmao","omg","wtf","idk","smh",
  "ew","aw","oh","ah","oi","ouch","wow",
]);

export function looksLikeGibberish(t) {
  if (!t) return true;
  if (t.length <= 2 && SHORT_REAL_WORDS.has(t)) return false;
  if (t.length <= 2) return true;
  if (SHORT_REAL_WORDS.has(t)) return false;
  const letters = (t.match(/[a-z]/g) || []).length;
  if (letters / Math.max(1, t.length) < 0.35) return true;
  if (/^(.)\1{5,}$/.test(t.replace(/\s/g, ""))) return true;
  // Detect keyboard smash: unique characters have very few vowels (catches
  // "asdfjkl" but NOT "helpppppp" - repeated chars don't dilute the unique set)
  const words = t.trim().split(/\s+/);
  if (words.length === 1 && t.length >= 6) {
    const uniqueChars = [...new Set(t.replace(/\s/g, "").split(""))];
    const uniqueVowels = uniqueChars.filter(c => "aeiou".includes(c)).length;
    if (uniqueVowels / uniqueChars.length < 0.15) return true;
  }
  return false;
}


// ─── 2. OOS DETECTION ─────────────────────────────────────────────────────────

/**
 * detectOutOfScope(rawText, oosCategories, healthOverridePatterns) → category | null
 *
 * Pure function: oosCategories and healthOverridePatterns are injected
 * rather than closed over, making this independently testable.
 *
 * Returns the matched OOS category object, or null if the text should be
 * handled as a health signal.
 */
export function detectOutOfScope(rawText, oosCategories, healthOverridePatterns) {
  const t = normalizeText(rawText);

  // Cycle questions must be checked FIRST - before the health override -
  // because they contain words like "period" that would otherwise bypass OOS.
  const cycleMatch = oosCategories.find((cat) =>
    ["cycle_phase_q","next_period_q","last_period_q","edd_q","test_timing_q"].includes(cat.name) &&
    cat.patterns.some(rx => rx.test(t))
  );
  if (cycleMatch) return cycleMatch;

  // If the text contains a clear health signal, don't treat it as OOS.
  // This prevents "me bleed thru me pants lol" routing to jokes.
  if (healthOverridePatterns.some(rx => rx.test(t))) return null;

  if (looksLikeGibberish(t)) {
    return {
      name: "gibberish",
      replies: [
        (raw) => `I couldn't quite understand ("${safeEcho(raw)}").`,
        () => "Try a short phrase like: \"late period\", \"spotting\", \"heavy bleeding\", \"cramps\", or \"mood changes\".",
      ],
    };
  }
  return oosCategories.find((cat) => cat.patterns.some((rx) => rx.test(t))) || null;
}

/**
 * resolveOOSFollowUp(rawText, lastOOS) → node name | null
 *
 * When an OOS category fires and invites a follow-up (e.g. food → cravings
 * before period?), catches the user's typed reply and routes it properly
 * instead of re-hitting OOS detection.
 */
export function resolveOOSFollowUp(rawText, lastOOS) {
  if (!lastOOS) return null;
  const t = normalizePatois(rawText).toLowerCase().trim();

  const YES = ["yes", "yeah", "yep", "yah", "ya", "definitely", "for sure", "true", "it is", "before", "its before", "yes its before", "before it", "yep before"];
  const NO  = ["no", "nah", "nope", "not really", "no its not", "it isnt", "not before"];

  const isYes = YES.some(w => t === w || t.startsWith(w));
  const isNo  = NO.some(w => t === w || t.startsWith(w));

  switch (lastOOS) {
    case "food":
      if (isYes || /before|pre.?period|pms/.test(t)) return "MOOD_SAFETY_CHECK";
      if (isNo) return null;
      break;
    case "relationships":
    case "money":
    case "school":
      if (isYes || /late|missed|period/.test(t)) return "LATE_INTRO";
      if (/mood|emotional|anxious|sad|angry|mad|vex|frustrated|annoyed|happy|excited|good mood|not like myself/.test(t)) return "MOOD_SAFETY_CHECK";
      break;
    case "sleep":
      if (isYes || /mood|tired|energy|angry|mad|vex|frustrated|annoyed|happy|excited|good mood|emotional|not like myself/.test(t)) return "MOOD_SAFETY_CHECK";
      if (/period|late|cycle/.test(t)) return "LATE_INTRO";
      break;
    case "mental_health_general":
      if (isYes || /before|period|cycle|angry|mad|vex|frustrated|annoyed|happy|excited|good mood|emotional|not like myself/.test(t)) return "MOOD_SAFETY_CHECK";
      break;
    case "non_repro_health":
      if (isYes || /late|period|cycle|miss/.test(t)) return "LATE_INTRO";
      break;
    case "body_image":
      if (isYes || /period|bloat|cycle/.test(t)) return "MOOD_SAFETY_CHECK";
      break;
    case "travel":
      if (isYes || /late|miss|period/.test(t)) return "LATE_INTRO";
      break;
    case "contraception":
      if (/spot|spotting/.test(t)) return "SPOT_INTRO";
      if (/late|miss|period/.test(t)) return "LATE_INTRO";
      break;
  }
  return null;
}


// ─── 2b. REPORTED-CONDITION DETECTION ────────────────────────────────────────
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  THREE-WAY DISTINCTION — read before changing anything in this section  │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                                                                         │
// │  1. REPORTED DIAGNOSIS (user_reported)                                  │
// │     The user is telling Bloomie about a condition they have already     │
// │     been formally diagnosed with by a clinician.                        │
// │                                                                         │
// │     Examples:                                                           │
// │       "I have PCOS"                                                     │
// │       "I was diagnosed with endometriosis"                              │
// │       "my doctor told me I have fibroids"                               │
// │       "because of my PMDD my periods are rough"                         │
// │                                                                         │
// │     How Bloomie handles it:                                             │
// │       → detectReportedCondition() returns a result                      │
// │       → pre-check intercepts BEFORE OOS fires                           │
// │       → routes to REPORTED_CONDITION_ACK (warm acknowledgement)        │
// │       → condition key stored in ctx.reportedConditions (lightweight)    │
// │       → Bloomie does NOT verify, confirm, deny, or reinterpret it       │
// │                                                                         │
// │  2. SUSPECTED DIAGNOSIS (user_suspects)                                 │
// │     The user believes or fears they may have a condition, but has NOT   │
// │     been formally diagnosed. They are not yet sure.                     │
// │                                                                         │
// │     Examples:                                                           │
// │       "I think I might have PCOS"                                       │
// │       "I feel like I have endometriosis"                                │
// │       "I'm scared I have fibroids"                                      │
// │                                                                         │
// │     How Bloomie handles it:                                             │
// │       → detectReportedCondition() returns null (SEEKING_PATTERNS bail)  │
// │       → falls through to the diagnosis_request OOS category             │
// │       → routes to DIAGNOSIS_REDIRECT (validates concern, no diagnosis)  │
// │                                                                         │
// │  3. DIAGNOSIS-SEEKING REQUEST (diagnosis_request)                       │
// │     The user is asking Bloomie to diagnose them — typically a direct    │
// │     question or an invitation for Bloomie to confirm/rule out a         │
// │     specific condition.                                                  │
// │                                                                         │
// │     Examples:                                                           │
// │       "Do I have PCOS?"                                                 │
// │       "Could this be endometriosis?"                                    │
// │       "Is this fibroids?"                                               │
// │       "diagnose me"                                                     │
// │                                                                         │
// │     How Bloomie handles it:                                             │
// │       → diagnosis_request OOS pattern fires                             │
// │       → routes to DIAGNOSIS_REDIRECT                                    │
// │       → Bloomie explicitly declines to diagnose but validates concern   │
// │                                                                         │
// │  RULE: Only type 1 stores anything in ctx.reportedConditions or         │
// │  bloomieMemory. Types 2 and 3 are session-only and leave no trace.      │
// └─────────────────────────────────────────────────────────────────────────┘

/**
 * Canonical condition keys, display names, and detection regexes.
 * Used by all reported-condition helpers and the REPORTED_CONDITION_ACK node.
 *
 * Each entry:
 *   name  — user-facing display string (never "your ___", just the label)
 *   rx    — matches both formal and colloquial spellings / abbreviations
 */
export const CONDITION_META = {
  pcos:          { name: "PCOS",               rx: /\bpcos\b|\bpolycystic ovary syndrome\b|\bpolycystic ovaries\b/i },
  endometriosis: { name: "endometriosis",       rx: /\bendometriosis\b|\bendo\b(?! met)/i },
  fibroids:      { name: "fibroids",            rx: /\bfibroids?\b|\bfibroid uterus\b/i },
  adenomyosis:   { name: "adenomyosis",         rx: /\badenomyosis\b/i },
  ovarian_cysts: { name: "ovarian cysts",       rx: /\bovarian cysts?\b/i },
  pmdd:          { name: "PMDD",                rx: /\bpmdd\b|\bpremenstrual dysphoric disorder\b/i },
  perimenopause: { name: "perimenopause",       rx: /\bperimenopause\b|\bperi.?menopause\b/i },
  menopause:     { name: "menopause",           rx: /\bmenopause\b|\bmenopaus(?:al|ing)\b/i },
  amenorrhea:    { name: "amenorrhea",          rx: /\bamenorr?h?ea\b|\bno periods?\b|\bno period (for|in) (months?|years?)\b|\babsent periods?\b|\bperiods? (stopped|gone|disappeared|don't come)\b/i },
  anemia:        { name: "anemia",              rx: /\banaemi[a]?\b|\banemi[a]?\b|\biron.defici/i },
  thyroid:       { name: "a thyroid condition", rx: /\b(hypo|hyper)?thyroid(?:ism)?\b|\bhashimoto\b|\bgraves( disease)?\b/i },
};

/**
 * Common aliases / abbreviations → canonical conditionKey.
 * Matched against the NORMALIZED text only, so casing is irrelevant.
 * Used by extractConditionKey() to resolve colloquial mentions.
 *
 * Amenorrhea aliases are only surfaced when tied to a reporting phrase —
 * "no period for months" alone is too ambiguous to classify as a diagnosis.
 */
export const CONDITION_ALIASES = {
  // PCOS
  "pcos":                      "pcos",
  "polycystic ovary syndrome":  "pcos",
  "polycystic ovaries":         "pcos",
  // Endometriosis
  "endo":                      "endometriosis",
  "endometriosis":              "endometriosis",
  // Fibroids
  "fibroid":                   "fibroids",
  "fibroids":                  "fibroids",
  "fibroid uterus":            "fibroids",
  // Adenomyosis
  "adenomyosis":               "adenomyosis",
  // Ovarian cysts
  "ovarian cyst":              "ovarian_cysts",
  "ovarian cysts":             "ovarian_cysts",
  // PMDD
  "pmdd":                      "pmdd",
  "premenstrual dysphoric disorder": "pmdd",
  // Perimenopause
  "perimenopause":             "perimenopause",
  "peri menopause":            "perimenopause",
  "peri-menopause":            "perimenopause",
  // Menopause
  "menopause":                 "menopause",
  "menopausal":                "menopause",
  // Amenorrhea (only valid inside a reporting-prefix context; see detectReportedCondition)
  "amenorrhea":                "amenorrhea",
  "amenorrhoea":               "amenorrhea",
  "no periods":                "amenorrhea",
  "absent periods":            "amenorrhea",
  // Anemia
  "anemia":                    "anemia",
  "anaemia":                   "anemia",
  "iron deficiency anemia":    "anemia",
  "iron deficiency anaemia":   "anemia",
  // Thyroid
  "thyroid":                   "thyroid",
  "hypothyroidism":            "thyroid",
  "hyperthyroidism":           "thyroid",
  "hashimoto":                 "thyroid",
  "hashimotos":                "thyroid",
  "graves disease":            "thyroid",
};

/**
 * extractConditionKey(normalizedText) → conditionKey | null
 *
 * Tries alias lookup first (exact phrase match from longest to shortest),
 * then falls back to CONDITION_META regex scan.
 * Returns the canonical conditionKey or null.
 */
export function extractConditionKey(t) {
  if (!t || typeof t !== "string") return null;
  // Sort aliases longest-first so "iron deficiency anemia" beats "anemia"
  const sorted = Object.keys(CONDITION_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    if (t.includes(alias)) return CONDITION_ALIASES[alias];
  }
  for (const [key, meta] of Object.entries(CONDITION_META)) {
    if (meta.rx.test(t)) return key;
  }
  return null;
}

/**
 * Patterns that signal the user is REPORTING an existing diagnosis
 * (not seeking one). Order matters — more specific patterns first.
 */
const REPORTED_PREFIXES = [
  /\b(i was diagnosed with|i've been diagnosed with|my doctor (diagnosed me with|said i have|told me i have|confirmed (i have|that i have))|i've been told (i have|that i have)|i was told (i have|that i have))\b/i,
  /\b(i have been diagnosed with|diagnosed with|i already have|i know i have)\b/i,
  /\b(i have|i've got|i got)\b.{0,6}\b(pcos|endometriosis|endo|fibroids?|adenomyosis|ovarian cysts?|pmdd|perimenopause|menopause|amenorr?h?ea|anaemi[a]?|anemi[a]?|thyroid|hashimoto)\b/i,
  /\b(because of my|due to my|with my|since i have)\b.{0,8}\b(pcos|endometriosis|endo|fibroids?|adenomyosis|ovarian cysts?|pmdd|perimenopause|menopause|amenorr?h?ea|anaemi[a]?|anemi[a]?|thyroid)\b/i,
];

/**
 * Patterns that indicate diagnosis-SEEKING language. When any match,
 * detectReportedCondition returns null — the existing diagnosis_request
 * OOS path handles it instead.
 */
const SEEKING_PATTERNS = [
  /\b(do i have|could i have|might i have|could this be|is this|am i developing|do you think i have|you think i have|could i possibly have)\b/i,
  /\b(i think i (have|might have|could have)|i feel like i (have|might have))\b/i,
  /\b(i'm scared i have|i am scared i have|what if i have)\b/i,
  /\b(sounds like me|sounds like what i have|think i have|might have|relate to)\b/i,
  /\b(diagnose me|what is wrong with me|test for|signs of)\b/i,
];

/**
 * Management / treatment question patterns for a known reported condition.
 * These are checked ONLY when ctx.reportedConditions is non-empty — the user
 * must have already stated a diagnosis earlier in the session.
 */
const MANAGEMENT_PATTERNS = [
  /\b(how (do|can|should) i (manage|treat|deal with|handle|live with|cope with))\b/i,
  /\b(what (can|should) i do (for|about|with))\b.{0,30}\b(pcos|endometriosis|endo|fibroids?|adenomyosis|ovarian cysts?|pmdd|perimenopause|menopause|amenorr?h?ea|anemi[a]?|thyroid)\b/i,
  /\b(treatment (for|of)|manage(ment)? (of|for)|options (for|with))\b.{0,30}\b(pcos|endometriosis|endo|fibroids?|adenomyosis|ovarian cysts?|pmdd|perimenopause|menopause|amenorr?h?ea|anemi[a]?|thyroid)\b/i,
  /\b(what helps (with|for)|what is good for|what works for)\b.{0,30}\b(pcos|endometriosis|endo|fibroids?|adenomyosis|cysts?|pmdd|perimenopause|menopause|anemia|thyroid)\b/i,
  /\b(lifestyle|diet|exercise|supplements?|natural (remedy|remedies|treatment))\b.{0,40}\b(pcos|endometriosis|fibroids?|pmdd|anemia|thyroid)\b/i,
];

/**
 * Current-symptom patterns that warrant condition-aware context framing.
 * These fire when the user mentions symptoms in the same message or turn
 * where a condition context is already active on ctx.
 */
const CONDITION_SYMPTOM_PATTERNS = [
  /\b(my (pain|cramps?|bleeding|periods?|cycle|symptoms?) (is|are|has|have|feels?|seems?|looks?))\b/i,
  /\b(i('m| am) (experiencing|having|getting|feeling|noticing))\b.{0,40}\b(pain|cramp|bleed|period|symptom|cycle|spotting|discharge|mood|tired|fatigue|heavy)\b/i,
  /\b(recently|lately|this (week|month|cycle)|today|right now|still)\b.{0,40}\b(pain|cramp|bleed|period|spotting|discharge|mood|tired|fatigue|heavy)\b/i,
  /\b(worse|different|changed|not normal|unusual|new|sudden|bad)\b.{0,30}\b(pain|cramp|bleed|period|spotting|cycle|symptom)\b/i,
];

/**
 * detectReportedCondition(text) → ReportedConditionResult | null
 *
 * Pure function — no side effects, no ctx.
 * Returns a structured object when the user reports an EXISTING confirmed
 * diagnosis; returns null otherwise.
 *
 * Return shape:
 * {
 *   type:          "reported_condition",
 *   conditionKey:  string,            // canonical key from CONDITION_META
 *   conditionName: string,            // user-facing display name
 *   confidence:    number,            // 0.0 – 1.0
 *   source:        "user_reported",
 * }
 *
 * confidence values:
 *   0.95 — explicit clinical reporting phrase ("I was diagnosed with")
 *   0.80 — clear ownership statement ("I have PCOS" / "due to my fibroids")
 */
export function detectReportedCondition(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const t = normalizeText(rawText);

  // Bail immediately on diagnosis-seeking language
  if (SEEKING_PATTERNS.some(rx => rx.test(t))) return null;

  // High-confidence group — explicit clinical reporting prefix
  const HIGH_PREFIXES = [
    REPORTED_PREFIXES[0], // "I was diagnosed with…" etc.
    REPORTED_PREFIXES[1], // "diagnosed with…" / "I already have…"
  ];
  for (const prefix of HIGH_PREFIXES) {
    if (!prefix.test(t)) continue;
    const key = extractConditionKey(t);
    if (key) {
      return {
        type:          "reported_condition",
        conditionKey:  key,
        conditionName: CONDITION_META[key]?.name ?? key,
        confidence:    0.95,
        source:        "user_reported",
      };
    }
  }

  // Medium-confidence group — ownership / causal statement
  const MED_PREFIXES = [
    REPORTED_PREFIXES[2], // "I have PCOS" / "I've got fibroids"
    REPORTED_PREFIXES[3], // "because of my PCOS"
  ];
  for (const prefix of MED_PREFIXES) {
    if (!prefix.test(t)) continue;
    const key = extractConditionKey(t);
    if (key) {
      return {
        type:          "reported_condition",
        conditionKey:  key,
        conditionName: CONDITION_META[key]?.name ?? key,
        confidence:    0.80,
        source:        "user_reported",
      };
    }
  }

  return null;
}

/**
 * detectConditionManagementQuestion(text, reportedConditions) → boolean
 *
 * Returns true when the user asks a management / treatment / lifestyle
 * question that is contextually tied to a condition they have already
 * reported. Requires at least one entry in reportedConditions so this
 * never fires for users who haven't stated a diagnosis.
 */
export function detectConditionManagementQuestion(rawText, reportedConditions) {
  if (!rawText || !Array.isArray(reportedConditions) || reportedConditions.length === 0) return false;
  const t = normalizeText(rawText);
  if (SEEKING_PATTERNS.some(rx => rx.test(t))) return false;
  return MANAGEMENT_PATTERNS.some(rx => rx.test(t));
}

/**
 * detectConditionSymptomQuestion(text, reportedConditions) → boolean
 *
 * Returns true when the user describes current symptoms in the context of
 * an already-reported condition. Used to route to CONDITION_SYMPTOM_CONTEXT
 * which acknowledges the condition without attributing causation.
 */
export function detectConditionSymptomQuestion(rawText, reportedConditions) {
  if (!rawText || !Array.isArray(reportedConditions) || reportedConditions.length === 0) return false;
  const t = normalizeText(rawText);
  // Only fire when a condition keyword is also present in the same message
  const hasConditionKeyword = Object.values(CONDITION_META).some(m => m.rx.test(t));
  if (!hasConditionKeyword) return false;
  if (SEEKING_PATTERNS.some(rx => rx.test(t))) return false;
  return CONDITION_SYMPTOM_PATTERNS.some(rx => rx.test(t));
}


// ─── 2c. VAGUE HEALTH SCORING ────────────────────────────────────────────────
//
// scoreVagueHealth(text) → number (0–N)
//
// Detects indirect, colloquial, or non-keyword reproductive-health phrasing
// that the explicit signal regexes in scoreSignals() would miss.
//
// Rules for what qualifies:
//   - Must suggest the user is concerned about their own body, cycle, or a
//     reproductive-health symptom in vague/indirect language.
//   - Must NOT catch generic wellness phrases with no body/cycle anchor.
//   - Includes common Jamaican Patois variants consistent with normalizePatois().
//
// Returns a raw integer score.  Callers decide what threshold to act on.
// A score ≥ 1 is treated as "possibly in-scope" for routing purposes.

const _VAGUE_HEALTH_PATTERNS = [
  // "something wrong/off/not right/strange" — generic wrongness signal
  /something(?:'s)?\s+(?:wrong|off|not right|not normal|strange|weird|different)\b/,
  /sumn\s+(?:wrong|off|not right)/,              // Patois: sumn = something
  /something feels?\s+(?:wrong|off|weird|strange|different|not right)/,

  // Body / location anchors with implied concern
  /\b(?:down there|down below|lady parts?|feminine area|private parts?|my parts?|my area|my lady)\b/,
  /\b(?:womanly parts?|below my waist|my private|private place)\b/,

  // "not feeling right" / "feeling off" with or without body reference
  /not feel(?:ing)?\s+right\b/,
  /feel(?:ing)?\s+(?:off|weird|strange|not right|different)\b/,
  /nuh feel right\b/,                            // Patois
  /mi (?:nuh feel|feel off|feel wrong|feel strange)/,  // Patois
  /something(?:'s)?\s+off\b/,
  /been\s+(?:off|weird|not normal|not right)\b/,
  /off\s+lately\b/,

  // "not myself" / "not like myself"
  /not (?:feeling\s+)?(?:like\s+)?myself\b/,
  /nuh feel like mi(?:self)?\b/,                 // Patois

  // Body acting differently
  /my body(?:\s+(?:has|have|been|is|feels?|acting|seems?))?\b/,
  /mi body\b/,                                   // Patois
  /body(?:\s+(?:been|feel(?:ing)?|acting))?\s+(?:off|wrong|weird|strange|different|not right|not normal)/,

  // Indirect lateness / cycle irregularity without the explicit word "period"
  /hasn.?t\s+come\s+(?:yet|down|at all)\b/,
  /not\s+here\s+yet\b/,
  /still\s+waiting\s+(?:for\s+it|on\s+it)\b/,
  /it'?s?\s+(?:been\s+)?(?:late|not here|overdue)\b/,
  /sumn wrong with (?:my|mi)\s+(?:cycle|body|period|flow|blood)/,

  // Discomfort anchored near body parts without explicit clinical terms
  /hurt(?:ing|s)?\s+(?:down|below|there|in\s+my)\b/,
  /sore\s+(?:down|below|there)\b/,
  /bothering\s+me\s+(?:down|below|there)\b/,

  // Discharge / smell hinted indirectly
  /smell(?:ing|s)?\s+(?:off|different|weird|bad|strange|unusual)\b/,
  /(?:wet|moist|damp)\s+(?:down there|below|in my area)\b/,

  // Worried + body concern without specifying the concern
  /(?:worried|scared|concerned|not sure)\s+(?:about\s+)?(?:something|my body|what'?s|if)\b/,
  /something(?:'s)?\s+(?:wrong|off|not right)\s+with\s+(?:me|my body|my cycle|my period|my flow)\b/,

  // Change framing
  /(?:things?|something|it|my (?:body|cycle|period|flow))\s+(?:has|have|been|is)\s+(?:changed?|different|not (?:the )?same)\b/,
];

/**
 * scoreVagueHealth(text) → number
 *
 * Scores how likely a piece of text is an indirect reproductive-health concern.
 * Input should already be lowercased (normalizedText or similar).
 *
 * Returns the count of distinct pattern matches (each pattern fires at most once).
 * A score ≥ 1 means "possibly in scope, keep the user in a recoverable path".
 * A score ≥ 2 means "likely health-related, strongly prefer NARROWING over OOS".
 *
 * @param  {string} text
 * @returns {number}
 */
export function scoreVagueHealth(text) {
  const t = String(text || "").toLowerCase();
  return _VAGUE_HEALTH_PATTERNS.filter(rx => rx.test(t)).length;
}

// ─── 3. SIGNAL SCORING ────────────────────────────────────────────────────────

/**
 * scoreSignals(normalizedText) → { sig, has }
 *
 * Pure function. Scores the input text against intent signals.
 * Returns the raw score map and a has(key, min=1) convenience helper.
 *
 * No ctx, no side effects - safe to call in tests.
 */
export function scoreSignals(t) {
  t = String(t || "").toLowerCase();

  const PREGNANCY_KEYWORD_RE = /\b(pregnant|pregnancy|breed)\b/;
  const PREGNANCY_TEST_PHRASE_RE = /\b(pregnancy\s+test|test\s+for\s+pregnancy|positive\s+test|negative\s+test|test\s+(?:was|is|came\s+back)\s+(?:positive|negative)|tested\s+(?:positive|negative))\b/;
  const GENERIC_TEST_ACTION_RE = /\b(?:i\s+)?(?:just\s+)?(?:took|take|taking|taken|did|done|tested)\s+(?:a\s+)?test\b/;
  const NON_PREG_TEST_CONTEXT_RE = /\b(?:blood|iron|urine|covid|flu|hiv|sti|std|thyroid|glucose|sugar|cholesterol|allergy|dna|opk|ovulation)\s+test\b|\btest\s+results?\b|\blet\s+me\s+test\b|\btest\s+something\b/;

  const sig = {
    late:        0,
    heavy:       0,
    spot:        0,
    mood:        0,
    pelvic:      0,
    pregnancy:   0,
    discharge:   0,
    late_check:  0,
    red_flag:    0,
  };

  // late / missed period
  if (/late|missed|no period/.test(t))                           sig.late      += 2;
  if (/period.*not come|period.*didn.t/.test(t))                 sig.late      += 2;
  if (/skipped|overdue/.test(t))                                 sig.late      += 1;
  if (/period.*late|late.*period/.test(t))                       sig.late      += 2;
  if (/\d+\s*weeks?\s*late|\bvery late\b/.test(t))               sig.late      += 2;

  // heavy bleeding
  if (/heavy|soaking|clot|bleeding/.test(t))                     sig.heavy     += 2;
  if (/flood|nuff blood|bleed bad/.test(t))                      sig.heavy     += 2;
  if (/soak through|changing.*hour/.test(t))                     sig.heavy     += 2;

  // spotting
  if (/spot|spotting/.test(t))                                   sig.spot      += 2;
  if (/brown|between periods|pink discharge/.test(t))            sig.spot      += 2;
  if (/little blood|likkle blood/.test(t))                       sig.spot      += 1;
  if (/\bspotting\b/.test(t))                                    sig.spot      += 2;

  // mood / hormones / energy
  if (/mood|anxious|sad|irritable/.test(t))                      sig.mood      += 2;
  if (/tired|fatigue|fatigued|exhaust/.test(t))                  sig.mood      += 2;
  if (/low energy|drain|drained|weak/.test(t))                   sig.mood      += 2;
  if (/overwhelm|emotional|cry|tearful/.test(t))                 sig.mood      += 1;
  if (/depressed|depression|hopeless|numb/.test(t))              sig.mood      += 2;

  // pelvic pain / cramps
  if (/cramp|pelvic|pain/.test(t))                               sig.pelvic    += 2;
  if (/belly.*hurt|stomach.*hurt|waist.*hurt/.test(t))           sig.pelvic    += 2;
  if (/discomfort|ache|sore/.test(t))                            sig.pelvic    += 1;

  // pregnancy signals
  const hasPregnancyKeyword = PREGNANCY_KEYWORD_RE.test(t);
  const hasPregnancyTestPhrase = PREGNANCY_TEST_PHRASE_RE.test(t);
  const hasGenericPregnancyTestAction = GENERIC_TEST_ACTION_RE.test(t) && !NON_PREG_TEST_CONTEXT_RE.test(t);
  if (hasPregnancyKeyword || hasPregnancyTestPhrase || hasGenericPregnancyTestAction) sig.pregnancy += 2;
  if (/unprotected|missed.*period/.test(t))                      sig.pregnancy += 1;

  // discharge
  if (/discharge|odor|smell/.test(t))                            sig.discharge += 2;
  if (/\b(?:down there|down deh|down below|private parts?|lady parts?|feminine area)\b.*\b(?:off|wrong|weird|not normal|funny|odd|strange|irritat|uncomfort)\b/.test(t)) sig.discharge += 2;
  if (/\b(?:down there|down deh|down below)\b.*\b(?:hurt|pain|sore|burn|itch)\b/.test(t)) sig.pelvic += 1;

  // "is my period late?" - direct lateness question needing cycle math
  if (/is my period (late|overdue|due|coming)|has my period (come|arrived)/.test(t)) sig.late_check += 3;
  if (/period not (come|here|arrived)|period (supposed|expected) to/.test(t))        sig.late_check += 2;

  // red flag / should I see a doctor
  if (/should i (go|see|call|visit|get)|need (medical|help|care|doctor)/.test(t))   sig.red_flag += 2;
  if (/is this serious|how bad|how serious|worried about|when to (go|see)/.test(t)) sig.red_flag += 2;

  const has = (key, min = 1) => sig[key] >= min;
  return { sig, has };
}


// ─── 3b. SEMANTIC CHOICE INTENTS ─────────────────────────────────────────────

/**
 * CHOICE_INTENT_MAP — maps a choice id to a semantic intent string.
 *
 * Intents are used by resolveChoiceByIntent() so that typed yes/no/unsure
 * answers can match choice objects even when their id isn't literally "yes",
 * "no", or "ns".  Nodes can also attach an explicit `intent` field to a
 * choice object to override this lookup.
 *
 * Intent vocabulary:
 *   affirm            — affirmative answer (yes, yeah, i think so, probably…)
 *   deny              — negative answer (no, nope, probably not…)
 *   unsure            — uncertain answer (not sure, idk, maybe, can't tell…)
 *   test_positive     — pregnancy/OPK test read as positive
 *   test_negative     — pregnancy/OPK test read as negative
 *   test_unclear      — test result unclear or faint
 *   pregnancy_possible — user is or might be pregnant
 *   irregular_cycle   — user has or suspects an irregular cycle
 */
export const CHOICE_INTENT_MAP = {
  yes:         "affirm",
  no:          "deny",
  ns:          "unsure",
  pos:         "test_positive",
  neg:         "test_negative",
  unc:         "test_unclear",
  yes_preg:    "pregnancy_possible",
  irregular:   "irregular_cycle",
};

/**
 * resolveChoiceByIntent(choices, intent) → choice | null
 *
 * Pure function. Finds the first choice in `choices` that carries the given
 * semantic intent, either via an explicit `choice.intent` field or via the
 * CHOICE_INTENT_MAP lookup on the choice id.  Preserves backward
 * compatibility: nodes that already use "yes"/"no"/"ns" ids work unchanged.
 */
export function resolveChoiceByIntent(choices, intent) {
  if (!Array.isArray(choices) || !intent) return null;
  // Explicit field wins (allows future per-node overrides without map changes)
  const explicit = choices.find(c => c.intent === intent);
  if (explicit) return explicit;
  // Fallback: derive intent from choice id via the static map
  return choices.find(c => CHOICE_INTENT_MAP[c.id] === intent) || null;
}


/**
 * classifyNodeQuestion(choices) → question type string | null
 *
 * Pure function. Inspects a resolved choices array and returns the semantic
 * "shape" of the question the node is asking.  Used to set ctx.pendingQuestion
 * so the next message is interpreted as an answer of the right type before
 * falling through to the full intent pipeline.
 *
 * Types:
 *   "yes_no"      — yes / no / not-sure (ids: yes, no, ns)
 *   "test_result" — positive / negative / unclear (ids: pos, neg, unc)
 *   "severity"    — mild / moderate / severe (ids: mild, mod, sev)
 *   "timing"      — before / during / any / other time-relative ids
 *   "duration"    — few days / a week / most of cycle (ids: few, week, most)
 *   "choice"      — has choices but none of the above shapes
 *   null          — no choices (open-text node or no relevant shape)
 */
export function classifyNodeQuestion(choices) {
  if (!Array.isArray(choices) || !choices.length) return null;
  const ids = new Set(choices.map(c => c.id));
  if (ids.has("yes") || ids.has("no") || ids.has("ns"))           return "yes_no";
  if (ids.has("pos") || ids.has("neg") || ids.has("unc"))         return "test_result";
  if (ids.has("mild") || ids.has("mod") || ids.has("sev"))        return "severity";
  if (ids.has("before") || ids.has("during") || ids.has("any"))   return "timing";
  if (ids.has("few") || ids.has("week") || ids.has("most"))       return "duration";
  return "choice";
}


// ─── 4. MULTI-SIGNAL ROUTE RESOLUTION ────────────────────────────────────────

/**
 * resolveSignals(sig, has) → route | null
 *
 * Pure function. Applies multi-signal combination rules and returns a route
 * object ({ next, payload }) when a combination fires, null otherwise.
 *
 * Callers fall back to single-best-signal logic when this returns null.
 */
export function resolveSignals(sig, has) {
  // Late + pregnancy signal → intent-first entry
  if (has("late") && has("pregnancy")) {
    return { next: "PREGNANCY_ENTRY", payload: { reason: "late+pregnancy_signal" } };
  }

  // Heavy + mood (could be hormonal / anaemia) → heavy intro but note mood
  if (has("heavy", 2) && has("mood")) {
    return { next: "HEAVY_INTRO", payload: { also: "mood", reason: "heavy+mood" } };
  }

  // Pelvic + heavy → could be serious, go to heavy risk check
  if (has("pelvic", 2) && has("heavy", 2)) {
    return { next: "HEAVY_ROUTE_C", payload: { reason: "pelvic+heavy" } };
  }

  // Late + pelvic (no heavy) → late intro with pelvic note
  if (has("late") && has("pelvic") && !has("heavy")) {
    return { next: "LATE_INTRO", payload: { also: "pelvic", reason: "late+pelvic" } };
  }

  // Spot + discharge → provider soon
  if (has("spot") && has("discharge")) {
    return { next: "SPOT_PROVIDER_SOON", payload: { reason: "spot+discharge" } };
  }

  // Spot + pregnancy → preg spotting pathway
  if (has("spot") && has("pregnancy")) {
    return { next: "SPOT_PREG_INFO", payload: { reason: "spot+pregnancy" } };
  }

  // Discharge alone (no spotting/pelvic) → else discharge
  if (has("discharge") && !has("spot") && !has("pelvic")) {
    return { next: "ELSE_DISCHARGE", payload: { reason: "discharge_only" } };
  }

  return null;
}


// ─── 5. ROUTE CONFIDENCE SCORING ─────────────────────────────────────────────

/**
 * INTENT_LABELS - human-readable label for each signal key
 */
const INTENT_LABELS = {
  late:       "late period",
  heavy:      "heavy bleeding",
  spot:       "spotting",
  mood:       "mood or energy concerns",
  pelvic:     "pelvic pain or cramps",
  pregnancy:  "pregnancy",
  discharge:  "discharge",
  late_check: "late period",
  red_flag:   "urgent care concern",
};

/**
 * INTENT_TO_NODE — maps a resolved intent key to its entry node
 */
export const INTENT_TO_NODE = {
  late:        "LATE_INTRO",
  heavy:       "HEAVY_INTRO",
  spot:        "SPOT_INTRO",
  mood:        "MOOD_SAFETY_CHECK",
  pelvic:      "PELVIC_SAFETY_GATE",
  pregnancy:   "PREGNANCY_ENTRY",
  discharge:   "ELSE_DISCHARGE",
  late_check:  "LATE_INTRO",
  red_flag:    "SEE_DOCTOR_GUIDE",
  urgent_care: "HEAVY_URGENT",
};

/**
 * computeRouteConfidence(sig, entities) -> ConfidenceResult
 *
 * Pure function. Takes the raw score map from scoreSignals() and the entity
 * snapshot from extractEntities(), and returns a confidence tier with enough
 * context for the chat engine to decide whether to route directly, ask a
 * soft confirmation, or fall back to NARROWING.
 *
 * Tiers:
 *   "high"   -- route directly, no clarifying question
 *   "medium" -- prepend soft confirmation before routing
 *   "low"    -- do not route directly; surface NARROWING with top candidates
 *
 * Rules (evaluated in order):
 *   1. urgency flag always HIGH (safety overrides everything)
 *   2. top score < 4 AND no urgency -> LOW
 *   3. 3+ signals all within 2 points of each other -> LOW (genuine ambiguity)
 *   4. top >= 4 AND second score within 2 of top -> MEDIUM (two competing signals)
 *   5. top >= 7 AND both pelvic AND late are present -> MEDIUM (entity ambiguity)
 *   6. top >= 7 AND second < top / 2 -> HIGH (clear dominant winner)
 *   7. top >= 4, no close competitor -> HIGH (single dominant, no real competition)
 */
export function computeRouteConfidence(sig, entities) {
  // Helper: build the full result shape
  function result(tier, score, primaryIntent, competingIntents, confidenceNote) {
    const route      = INTENT_TO_NODE[primaryIntent] || null;
    const competitors = competingIntents
      .map(function(i) { return INTENT_TO_NODE[i] || null; })
      .filter(Boolean);
    const ambiguous  = tier !== "high";
    return { tier, score, primaryIntent, competingIntents, confidenceNote, route, competitors, ambiguous };
  }

  // Rule 1 -- urgency always HIGH
  if (entities && entities.urgent) {
    return result("high", 10, "urgent_care", [], null);
  }

  // Build sorted list of signals with a positive score
  const scored = Object.entries(sig)
    .filter(function(pair) { return pair[1] > 0; })
    .sort(function(a, b) { return b[1] - a[1]; });

  if (scored.length === 0) {
    return result("low", 0, null, [], null);
  }

  const topScore    = scored[0][1];
  const topKey      = scored[0][0];
  const secondScore = scored[1] ? scored[1][1] : 0;

  // Merge late_check into "late" intent
  function keyToIntent(k) { return k === "late_check" ? "late" : k; }
  const primaryIntent = keyToIntent(topKey);

  // Competing intents: different from primary, deduplicated
  const seen = {};
  const competingIntents = scored.slice(1)
    .map(function(pair) { return keyToIntent(pair[0]); })
    .filter(function(i) {
      if (i === primaryIntent || seen[i]) return false;
      seen[i] = true;
      return true;
    });

  // Build the confidenceNote for MEDIUM tier
  function medNote(intent) {
    const label = INTENT_LABELS[intent] || intent.replace(/_/g, " ");
    return "It sounds like this might be about " + label + " -- is that right?";
  }

  // Special: late period + confirmed positive test → unambiguous positive result
  if (entities?.symptoms?.late && entities?.pregnancy?.result === "positive") {
    return result("high", topScore, "late", [], null);
  }

  // Rule 2 -- low score
  if (topScore < 3) {
    return result("low", topScore, primaryIntent, competingIntents, null);
  }

  // Rule 3 -- 3+ signals within 2 points of each other
  const closeSignals = scored.filter(function(pair) { return topScore - pair[1] <= 2; });
  if (closeSignals.length >= 3) {
    return result("low", topScore, primaryIntent, competingIntents, null);
  }

  // Rule 4 -- two competing signals
  if (secondScore >= topScore - 2) {
    return result("medium", topScore, primaryIntent, competingIntents, medNote(primaryIntent));
  }

  // Rule 5 -- moderate+ score but pelvic AND late both present (competing entities)
  if (topScore >= 4 && (sig.pelvic || 0) > 0 && (sig.late || 0) > 0) {
    return result("medium", topScore, primaryIntent, competingIntents, medNote(primaryIntent));
  }

  // Rule 6 -- clear dominant winner at high score
  if (topScore >= 7 && secondScore < topScore / 2) {
    return result("high", topScore, primaryIntent, competingIntents, null);
  }

  // Rule 7 -- dominant signal, no close competitor
  return result("high", topScore, primaryIntent, competingIntents, null);
}
