/**
 * bloomie-intent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Hybrid intent-classification assist for Bloomie health-topic routing.
 *
 * Layer 1 — rule-based (scoreSignals + computeRouteConfidence, already run in
 *            the pipeline before this module is consulted).
 *
 * Layer 2 — AI-assisted (async, 900 ms hard timeout):
 *   classifyIntentAI(rawInput, ruleResult) → { intent, confidence, reasoning } | null
 *
 * Combined resolver (the only export assistant.js calls):
 *   resolveIntentAssist(rawInput, ruleConfidence) → Promise<AssistResult|null>
 *
 * Source values (stored in ctx.intentAssist.source):
 *   "ai_primary" — rule tier was low, AI resolved the intent
 *   (null result)  — AI skipped (rule was authoritative), timed out, or failed
 *
 * Hard rules:
 *   - AI fires ONLY when rule confidence tier is "low" AND input looks
 *     health-related.  When rule is high/medium, this module returns null.
 *   - AI may only classify into the fixed Bloomie intent vocabulary below.
 *   - Never sends conversation history to AI.
 *   - API failure = silent null; Bloomie behaves exactly as before.
 *   - AI never controls urgency routing (HEAVY_URGENT is handled upstream).
 *
 * AI calls go through the backend at /api/bloomie/ai/intent.
 * ANTHROPIC_API_KEY lives on the server only — never in frontend code or
 * Vite public env.
 *
 * Fields sent to the backend per call:
 *   input         — current user message (trimmed, ≤500 chars)
 *   ruleTier      — rule confidence tier ("low")
 *   primaryIntent — top rule-based intent guess (may be null)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { bloomieDiagnostic } from "./bloomie-logger.js";

// ── Supported intent vocabulary ────────────────────────────────────────────
// These map 1-to-1 with Bloomie's existing entry nodes.  "else" / "hormones"
// both land on ELSE_INTRO and are safe catch-alls.
export const VALID_INTENTS = new Set([
  "late", "heavy", "spot", "mood", "pelvic",
  "pregnancy", "discharge", "hormones", "else",
]);

// Canonical reviewed allowlist for multi-label tagging.
export const VALID_INTENT_TAGS = new Set([
  "late_period",
  "missed_period",
  "cramps",
  "pelvic_pain",
  "nausea",
  "breast_tenderness",
  "spotting",
  "heavy_bleeding",
  "discharge",
  "itching",
  "pregnancy_concern",
  "cycle_irregularity",
  "mood_change",
  "clarification",
  "frustration",
  "red_flag",
]);

export const INTENT_TO_ROUTE = {
  late:       "LATE_INTRO",
  heavy:      "HEAVY_INTRO",
  spot:       "SPOT_INTRO",
  mood:       "MOOD_INTRO",
  pelvic:     "PELVIC_INTRO",
  pregnancy:  "PREGNANCY_ENTRY",
  discharge:  "ELSE_DISCHARGE",
  hormones:   "ELSE_INTRO",
  else:       "ELSE_INTRO",
};

/**
 * Deterministic repair / clarification classifier.
 * Input must be canonical normalized text from assistant.js.
 * Returns label-only classification (no generated response text).
 */
export function classifyRepairClarification(normalizedText) {
  const t = String(normalizedText || "").toLowerCase().trim();
  if (!t) return null;

  const clarificationPatterns = [
    /^\s*kmt(?:\s+what)?\s*\??\s*$/i,
    /^\s*cho man\s*$/i,
    /^\s*i am frustrated(?:\s+what)?\s*$/i,
    /^\s*wait hold on\s*$/i,
    /^\s*look yah(?:\s+nuh)?\s*$/i,
    /^\s*(what|huh)\s*\??\s*$/i,
    /\b(what are you saying|what you mean|what do you mean|seh that again|say that again|explain that|explain that again|explain simpler)\b/i,
    /\b(mi|me)\s+(nuh|no|don'?t|do not)\s+(understand|get it)\b/i,
    /\byou lost me\b/i,
    /\bnot what i mean\b/i,
  ];
  if (clarificationPatterns.some((rx) => rx.test(t))) {
    return { label: "clarification", confidence: 0.92 };
  }

  const frustrationPatterns = [
    /\bnot what i asked\b/i,
    /\bthis (isn't|is not|not) what i asked\b/i,
    /\byou (don't|do not) understand\b/i,
    /\b(kmt|cho man)\b/i,
  ];
  if (frustrationPatterns.some((rx) => rx.test(t))) {
    return { label: "frustration", confidence: 0.86 };
  }

  return null;
}

/**
 * Deterministic multi-label tagger (labels only, no response text).
 * Uses canonical normalized text plus extracted entities.
 * Safe fallback: empty tag list if nothing matches.
 */
export function extractMultiIntentTags(normalizedText, entities = {}, { repair = null } = {}) {
  const t = String(normalizedText || "").toLowerCase().trim();
  const sym = entities?.symptoms || {};
  const pregnancy = entities?.pregnancy || {};
  const tags = new Set();

  if (sym.late || sym.implicit_late) tags.add("late_period");
  if (/\b(missed period|period missed|no period)\b/.test(t)) tags.add("missed_period");
  if (sym.pelvic) {
    tags.add("pelvic_pain");
    if (/\bcramp|cramps\b/.test(t)) tags.add("cramps");
  }
  if (sym.nausea) tags.add("nausea");
  if (sym.breast_tender) tags.add("breast_tenderness");
  if (sym.spotting) tags.add("spotting");
  if (sym.heavy) tags.add("heavy_bleeding");
  if (sym.discharge || sym.unusual_discharge || sym.discharge_eggwhite || sym.discharge_creamy || sym.discharge_sticky) {
    tags.add("discharge");
  }
  if (/\bitch|itching\b/.test(t)) tags.add("itching");
  if (pregnancy.chance || /\b(pregnan|unprotected sex|pregnancy test|positive test|negative test)\b/.test(t)) {
    tags.add("pregnancy_concern");
  }
  if (sym.irregular) tags.add("cycle_irregularity");
  if (sym.mood || sym.anxiety || sym.depression || sym.irritability || sym.mood_rage) {
    tags.add("mood_change");
  }
  if (repair?.label === "clarification") tags.add("clarification");
  if (repair?.label === "frustration") tags.add("frustration");
  if (entities?.urgent || (sym.heavy && (sym.large_clots || sym.dizziness)) || /\b(faint|can'?t breathe|severe pain)\b/.test(t)) {
    tags.add("red_flag");
  }

  const canonicalTags = [...tags].filter((tag) => VALID_INTENT_TAGS.has(tag));
  const confidence = canonicalTags.length ? Math.min(0.95, 0.55 + canonicalTags.length * 0.05) : 0;
  return { tags: canonicalTags, confidence };
}

// Gate: only fire AI when the input looks health-adjacent.
// This prevents wasting API calls on greetings or clearly OOS messages that
// somehow reached LOW confidence (e.g. very short inputs).
//
// Two tiers:
//   Tier 1 — explicit health keywords (original gate, unchanged).
//   Tier 2 — vague / indirect reproductive-health phrases (new):
//     Body-reference phrases ("down there", "mi body"), wrongness signals
//     ("something off", "not feeling right", "nuh feel right"), indirect
//     lateness ("hasn't come yet", "still waiting on it"), and similar
//     colloquial or Patois-adjacent phrasing that scoreSignals() would miss.
//
// Tier 2 patterns are tested against rawInput directly (before normalization)
// so Patois variants must be explicit here.
const HEALTH_GATE = new RegExp(
  // ── Tier 1: explicit clinical / menstrual keywords ────────────────────────
  "\\b(period|bleed(?:ing)?|blood|late|missed|spotting|spot|cramp|pain|pelvic|" +
  "pregnant|pregnancy|discharge|mood|tired|exhausted|cycle|irregular|heavy|clot|" +
  "dizzy|nausea|ovulat|hormone|endo|pcos|fibroid|cyst|symptom|flow|spotty|lmp|" +
  "emotional|sad|angry|mad|vex|frustrated|happy|excited|anxious|fatigue|energy)\\b|" +
  // ── Tier 2: vague / indirect reproductive-health phrasing ─────────────────
  // Location anchors
  "down there|down below|lady parts?|private parts?|feminine area|my parts?|" +
  "mi body|my body|" +
  // Wrongness / off signals
  "something(?:'s)?\\s+(?:wrong|off|not right|not normal|strange|weird)|" +
  "sumn\\s+(?:wrong|off)|" +
  "not feel(?:ing)?\\s+right|feel(?:ing)?\\s+(?:off|weird|strange)|" +
  "nuh feel right|mi nuh feel|mi feel off|mi feel wrong|" +
  "off lately|been off|not myself|not like myself|nuh feel like mi|" +
  // Indirect cycle / timing hints
  "hasn.?t come yet|not here yet|still waiting (?:for it|on it)|" +
  "sumn wrong with (?:my|mi)\\s+(?:cycle|body|period|flow)|" +
  // Indirect discomfort anchored to body location
  "hurt(?:ing|s)?\\s+(?:down|below|there)|sore down|bothering me down|" +
  "smell(?:ing|s)?\\s+(?:off|different|weird|bad)|" +
  // Worried + vague concern
  "(?:worried|scared|concerned)\\s+(?:about\\s+)?(?:something|my body|what.?s)|" +
  "something.*(?:wrong|off|not right).*(?:me|my body|my cycle|my period)",
  "i"
);

// ─────────────────────────────────────────────────────────────────────────────
// classifyIntentAI(rawInput, ruleResult)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * AI intent classifier via the secure backend proxy at /api/bloomie/ai/intent.
 *
 * - 900 ms hard timeout via AbortController
 * - Returns null silently on any failure (network, timeout, parse error,
 *   invalid intent in response)
 * - Emits a bloomieDiagnostic event for each failure type
 * - Never sends conversation history
 *
 * @param  {string} rawInput
 * @param  {{ tier: string, primaryIntent: string|null }} ruleResult
 * @returns {Promise<{ intent: string, confidence: string, reasoning: string }|null>}
 */
export async function classifyIntentAI(rawInput, ruleResult) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 900);

  try {
    const resp = await fetch("/api/bloomie/ai/intent", {
      method:  "POST",
      signal:  controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input:         rawInput,
        ruleTier:      ruleResult.tier,
        primaryIntent: ruleResult.primaryIntent ?? null,
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      // Backend returns a structured error code — use it for diagnostics
      const errBody = await resp.json().catch(() => ({}));
      const code    = errBody.error ?? "ai_unavailable";
      bloomieDiagnostic(code, {
        module:         "bloomie-intent",
        stage:          "classifyIntentAI",
        reason:         `backend returned ${resp.status}: ${code}`,
        fallbackTarget: "rule_routing",
      });
      return null;
    }

    const parsed = await resp.json();

    if (!VALID_INTENTS.has(parsed.intent)) {
      bloomieDiagnostic("ai_invalid_response", {
        module:         "bloomie-intent",
        stage:          "classifyIntentAI",
        reason:         "intent not in valid vocabulary",
        fallbackTarget: "rule_routing",
      });
      return null;
    }

    return {
      intent:     String(parsed.intent),
      confidence: String(parsed.confidence ?? "medium"),
      reasoning:  String(parsed.reasoning  ?? ""),
    };

  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    bloomieDiagnostic(isTimeout ? "ai_timeout" : "ai_unavailable", {
      module:         "bloomie-intent",
      stage:          "classifyIntentAI",
      reason:         isTimeout ? "900ms hard timeout" : (err.message ?? "network error"),
      fallbackTarget: "rule_routing",
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveIntentAssist(rawInput, ruleConfidence)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Hybrid resolver — the only function assistant.js calls.
 *
 * Fires AI only when both gates pass:
 *   1. Rule confidence tier === "low" (no reliable rule-based route)
 *   2. Input contains at least one health-adjacent keyword
 *
 * Returns null (not an error object) when either gate fails so callers can
 * use a simple null-check and fall through to existing behaviour.
 *
 * @param  {string} rawInput
 * @param  {{ tier: string, primaryIntent: string|null, competingIntents?: string[] }} ruleConfidence
 * @returns {Promise<{ intent: string, route: string|null, confidence: string, source: "ai_primary", reasoning: string }|null>}
 */
export async function resolveIntentAssist(rawInput, ruleConfidence) {
  // Gate 1: only assist when rule layer couldn't pick a clear route.
  if (ruleConfidence.tier !== "low") return null;

  // Gate 2: only for health-related inputs.
  // Low confidence with no health keywords usually means a short/vague message
  // that even AI cannot reliably classify — skip the round-trip.
  if (!HEALTH_GATE.test(rawInput)) {
    bloomieDiagnostic("vague_input_no_ai_assist", {
      module:     "bloomie-intent",
      stage:      "resolveIntentAssist",
      confidence: ruleConfidence.tier,
      reason:     "no health keywords matched HEALTH_GATE",
    });
    return null;
  }

  const aiResult = await classifyIntentAI(rawInput, ruleConfidence);

  if (aiResult === null) {
    // classifyIntentAI already logged the specific failure; log the consequence
    bloomieDiagnostic("fallback_to_rules", {
      module:         "bloomie-intent",
      stage:          "resolveIntentAssist",
      confidence:     ruleConfidence.tier,
      fallbackTarget: "rule_routing",
    });
    return null;
  }

  return {
    intent:     aiResult.intent,
    route:      INTENT_TO_ROUTE[aiResult.intent] ?? null,
    confidence: aiResult.confidence,
    source:     "ai_primary",
    reasoning:  aiResult.reasoning,
  };
}
