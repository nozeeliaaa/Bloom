/**
 * bloomie-symptom-resolver.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Symptom resolution layer for Bloomie.
 *
 * Arbitrates between the rule-based catalog matcher (localMatches) and the AI
 * inference layer (aiResult from bloomie-symptom-infer.js) to produce a single
 * authoritative symptom interpretation for the current user turn.
 *
 * THIS IS A DECISION LAYER ONLY.
 * It does NOT change routing, UI, or response behaviour. It does NOT invent
 * symptom keys. It only chooses which source to trust and merges secondaries.
 *
 * INPUT
 * ─────
 * localMatches  — array of { key: string, confidence: number } from the
 *                 rule-based catalog matcher, in any order.
 * aiResult      — optional object:
 *                 { primary, secondary, confidence, clarificationNeeded, reason }
 *                 from inferSymptomsAI() in bloomie-symptom-infer.js, or null.
 *
 * OUTPUT
 * ──────
 * {
 *   primary:             string | null,
 *   secondary:           string[],        — ≤2 keys, no duplicates
 *   confidence:          number,          — 0.0–1.0
 *   clarificationNeeded: boolean,
 *   source:              "local" | "ai" | "merged",
 *   reason:              string,
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Confidence thresholds
const HIGH_CONFIDENCE  = 0.85;
const MEDIUM_LOW_BOUND = 0.6;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sort localMatches descending by confidence, return a clean copy. */
function sortedLocal(localMatches) {
  if (!Array.isArray(localMatches)) return [];
  return [...localMatches]
    .filter(m => m && typeof m.key === "string" && typeof m.confidence === "number")
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Build a deduplicated secondary array of up to 2 keys.
 * Filters out the primary key and any duplicates.
 *
 * @param {string|null} primary
 * @param {string[]}    candidates - keys in preference order
 * @returns {string[]}
 */
function buildSecondary(primary, candidates) {
  const seen = new Set(primary ? [primary] : []);
  const result = [];
  for (const key of candidates) {
    if (typeof key !== "string" || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length === 2) break;
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Resolves the final symptom interpretation for a Bloomie turn.
 *
 * @param {Array<{key: string, confidence: number}>} localMatches
 * @param {{ primary: string|null, secondary: string[], confidence: number,
 *            clarificationNeeded: boolean, reason: string }|null} [aiResult]
 * @returns {{ primary: string|null, secondary: string[], confidence: number,
 *             clarificationNeeded: boolean, source: string, reason: string }}
 */
export function resolveSymptoms(localMatches, aiResult = null) {
  // ── STEP 1: Normalize inputs ───────────────────────────────────────────────
  const sorted        = sortedLocal(localMatches);
  const topLocal      = sorted[0] ?? null;
  const localSecondary = sorted.slice(1).map(m => m.key);

  const aiPrimary            = aiResult?.primary    ?? null;
  const aiSecondary          = Array.isArray(aiResult?.secondary) ? aiResult.secondary : [];
  const aiConfidence         = typeof aiResult?.confidence === "number" ? aiResult.confidence : 0;
  const aiClarificationNeeded = !!aiResult?.clarificationNeeded;

  // ── STEP 2: Choose which source to trust ──────────────────────────────────

  // Case A: no local matches at all
  if (!topLocal) {
    if (aiPrimary) {
      return {
        primary:             aiPrimary,
        secondary:           buildSecondary(aiPrimary, aiSecondary),
        confidence:          aiConfidence,
        clarificationNeeded: aiClarificationNeeded,
        source:              "ai",
        reason:              aiResult?.reason ?? "no local match; AI primary used",
      };
    }
    // No local, no AI primary → ask for clarification
    return {
      primary:             null,
      secondary:           [],
      confidence:          0,
      clarificationNeeded: true,
      source:              "ai",
      reason:              "no local match and AI found nothing; clarification needed",
    };
  }

  const localKey        = topLocal.key;
  const localConfidence = topLocal.confidence;

  // Case B: high-confidence local (>= 0.85) — prefer local as primary
  if (localConfidence >= HIGH_CONFIDENCE) {
    // Only include AI secondary if it doesn't conflict with local primary
    const secondaryCandidates = aiPrimary && aiPrimary !== localKey
      ? [aiPrimary, ...aiSecondary, ...localSecondary]
      : [...localSecondary, ...aiSecondary];

    const secondary = buildSecondary(localKey, secondaryCandidates);
    const source    = secondary.some(k => aiSecondary.includes(k) || k === aiPrimary)
      ? "merged"
      : "local";

    return {
      primary:             localKey,
      secondary,
      confidence:          localConfidence,
      clarificationNeeded: false,
      source,
      reason:              `local match strong (${localConfidence.toFixed(2)}); local primary preferred`,
    };
  }

  // Case C: medium local confidence (0.6 – 0.85)
  if (localConfidence >= MEDIUM_LOW_BOUND) {
    const aiExists = aiResult !== null && aiPrimary !== null;

    if (aiExists && aiConfidence > localConfidence) {
      // AI wins — higher confidence
      const secondary = buildSecondary(
        aiPrimary,
        [localKey, ...localSecondary, ...aiSecondary],
      );
      return {
        primary:             aiPrimary,
        secondary,
        confidence:          aiConfidence,
        clarificationNeeded: aiClarificationNeeded,
        source:              "merged",
        reason:              `AI confidence (${aiConfidence.toFixed(2)}) > local (${localConfidence.toFixed(2)}); AI primary used`,
      };
    }

    // Local wins at medium confidence
    const secondary = buildSecondary(
      localKey,
      aiPrimary
        ? [aiPrimary, ...aiSecondary, ...localSecondary]
        : [...localSecondary, ...aiSecondary],
    );
    const source = secondary.length > 0 && (secondary.includes(aiPrimary) || aiSecondary.some(k => secondary.includes(k)))
      ? "merged"
      : "local";

    return {
      primary:             localKey,
      secondary,
      confidence:          localConfidence,
      clarificationNeeded: false,
      source,
      reason:              `local medium confidence (${localConfidence.toFixed(2)}); AI did not improve on it`,
    };
  }

  // Case D: low local confidence (< 0.6)
  if (aiResult !== null && aiPrimary) {
    const secondary = buildSecondary(
      aiPrimary,
      [localKey, ...localSecondary, ...aiSecondary],
    );
    return {
      primary:             aiPrimary,
      secondary,
      confidence:          aiConfidence,
      clarificationNeeded: aiClarificationNeeded,
      source:              "merged",
      reason:              `local confidence too low (${localConfidence.toFixed(2)}); AI used`,
    };
  }

  // ── STEP 4: Both sources weak or conflicting ───────────────────────────────
  // If AI explicitly asked for clarification and local is weak, respect it.
  // Exception: if local was close to medium we still surface it but flag ambiguity.
  if (aiClarificationNeeded || !aiPrimary) {
    return {
      primary:             null,
      secondary:           [],
      confidence:          localConfidence,
      clarificationNeeded: true,
      source:              aiResult ? "ai" : "local",
      reason:              "both sources weak or ambiguous; clarification needed",
    };
  }

  // Fallback: surface whatever we have with a clarification flag
  return {
    primary:             localKey,
    secondary:           buildSecondary(localKey, localSecondary),
    confidence:          localConfidence,
    clarificationNeeded: true,
    source:              "local",
    reason:              `low confidence (${localConfidence.toFixed(2)}); clarification recommended`,
  };
}
