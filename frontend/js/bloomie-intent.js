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
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Supported intent vocabulary ────────────────────────────────────────────
// These map 1-to-1 with Bloomie's existing entry nodes.  "else" / "hormones"
// both land on ELSE_INTRO and are safe catch-alls.
export const VALID_INTENTS = new Set([
  "late", "heavy", "spot", "mood", "pelvic",
  "pregnancy", "discharge", "hormones", "else",
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

// Gate: only fire AI when at least one health-adjacent keyword is present.
// Prevents wasting API calls on greetings or pure OOS messages that somehow
// reached LOW confidence (e.g. very short inputs).
const HEALTH_GATE = /\b(period|bleed(?:ing)?|blood|late|missed|spotting|spot|cramp|pain|pelvic|pregnant|pregnancy|discharge|mood|tired|exhausted|cycle|irregular|heavy|clot|dizzy|nausea|ovulat|hormone|endo|pcos|fibroid|cyst|symptom|flow|spotty|lmp|irregular|emotional|sad|angry|mad|vex|frustrated|happy|excited|anxious|fatigue|energy)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// classifyIntentAI(rawInput, ruleResult)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Stateless AI intent classifier.
 *
 * - Model: claude-haiku-4-5-20251001, max_tokens: 50
 * - 900 ms hard timeout via AbortController
 * - Returns null silently on any failure (network, timeout, parse error,
 *   invalid intent in response)
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
    const apiKey =
      typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env.VITE_ANTHROPIC_API_KEY ?? "")
        : "";

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "content-type":                          "application/json",
        "x-api-key":                             apiKey,
        "anthropic-version":                     "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 50,
        system: [
          "You are a health-topic intent classifier for a women's menstrual health chat app.",
          `Rule-based result: primaryIntent="${ruleResult.primaryIntent ?? "none"}", tier="${ruleResult.tier}".`,
          "Classify the user message into EXACTLY ONE of:",
          "late, heavy, spot, mood, pelvic, pregnancy, discharge, hormones, else.",
          "Use 'else' only when NO menstrual or reproductive health topic applies.",
          "Respond ONLY with compact JSON — no markdown, no extra text.",
          '{"intent":"late","confidence":"high|medium|low","reasoning":"<5 words max>"}',
        ].join(" "),
        messages: [{ role: "user", content: rawInput }],
      }),
    });

    clearTimeout(timeoutId);
    if (!resp.ok) return null;

    const data   = await resp.json();
    const raw    = data?.content?.[0]?.text?.trim() ?? "";
    const parsed = JSON.parse(raw);   // throws on malformed — caught below

    if (!VALID_INTENTS.has(parsed.intent)) return null;

    return {
      intent:     String(parsed.intent),
      confidence: String(parsed.confidence ?? "medium"),
      reasoning:  String(parsed.reasoning  ?? ""),
    };
  } catch {
    clearTimeout(timeoutId);
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
  if (!HEALTH_GATE.test(rawInput)) return null;

  const aiResult = await classifyIntentAI(rawInput, ruleConfidence);
  if (aiResult === null) return null;   // silent fallback

  return {
    intent:     aiResult.intent,
    route:      INTENT_TO_ROUTE[aiResult.intent] ?? null,
    confidence: aiResult.confidence,
    source:     "ai_primary",
    reasoning:  aiResult.reasoning,
  };
}
