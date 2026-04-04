/**
 * bloomie-routing.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Intent detection and routing utilities for Bloomie.
 *
 * All exports are PURE functions (no DOM, no closure state, no ctx references).
 * This makes them independently testable and reusable outside initBloomieChat.
 *
 * Modules:
 *   1. String utilities   — normalizeText, safeEcho, pick, looksLikeGibberish
 *   2. OOS detection      — detectOutOfScope, resolveOOSFollowUp
 *   3. Signal scoring     — scoreSignals(text) → { sig, has }
 *   4. Route resolution   — resolveSignals(sig, has) → route | null
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { normalizePatois } from "./bloomie-patois.js";


// ─── 1. STRING UTILITIES ──────────────────────────────────────────────────────

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s'']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  // "asdfjkl" but NOT "helpppppp" — repeated chars don't dilute the unique set)
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

  // Cycle questions must be checked FIRST — before the health override —
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


// ─── 3. SIGNAL SCORING ────────────────────────────────────────────────────────

/**
 * scoreSignals(normalizedText) → { sig, has }
 *
 * Pure function. Scores the input text against intent signals.
 * Returns the raw score map and a has(key, min=1) convenience helper.
 *
 * No ctx, no side effects — safe to call in tests.
 */
export function scoreSignals(t) {
  t = String(t || "").toLowerCase();

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
  if (/pregnant|pregnancy|test|breed/.test(t))                   sig.pregnancy += 2;
  if (/unprotected|missed.*period/.test(t))                      sig.pregnancy += 1;

  // discharge
  if (/discharge|odor|smell/.test(t))                            sig.discharge += 2;

  // "is my period late?" — direct lateness question needing cycle math
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
    return { next: "HEAVY_RISK_SYMPTOMS", payload: { reason: "pelvic+heavy" } };
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
 * INTENT_LABELS — human-readable label for each signal key
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
