/**
 * bloomie-extract.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered structured health signal extractor for Bloomie.
 *
 * WHERE IT RUNS
 * ─────────────
 * Called from assistant.js immediately after normalizedText is produced and
 * route-confidence scoring has fired (same pipeline position as
 * resolveIntentAssist). It runs in parallel with the synchronous routing
 * pipeline and its result is stored on ctx.aiSignals.
 *
 * WHY IT IS SAFE
 * ──────────────
 * 1. AI produces structured JSON only - no advice text, no reply text, no
 *    free-form health guidance. The backend prompt forbids it explicitly.
 * 2. Every returned value is validated against a fixed allowlist on BOTH the
 *    backend (server-side first defence) and here (client-side second defence).
 * 3. Extracted signals NEVER override Bloomie's rule-based urgent routing.
 *    The caller in assistant.js must check `entities.urgent` and `ctx.urgency`
 *    before applying any signal; this module does not enforce that itself but
 *    documents the contract.
 * 4. The result is purely advisory - if it is null (any failure path), Bloomie
 *    behaves exactly as it does today with zero observable difference.
 *
 * HOW FALLBACK WORKS
 * ──────────────────
 * Any of these conditions → extractSignalsAI() returns null silently:
 *   • Input fails HEALTH_GATE check (no health keywords → skip API round-trip)
 *   • fetch() throws or AbortController fires (1200 ms hard timeout)
 *   • Backend returns a non-2xx status
 *   • Backend returns invalid or empty JSON
 *   • Confidence is below CONFIDENCE_THRESHOLD (0.55)
 *   • All extracted arrays are empty (nothing useful extracted)
 *
 * In every null case a bloomieDiagnostic event is emitted so failures are
 * visible in post-session analytics without surfacing anything to the user.
 *
 * OUTPUT SHAPE (ExtractedSignals)
 * ────────────────────────────────
 * {
 *   symptoms:         string[]  - Bloomie-compatible symptom/entity keys
 *   timing:           string[]  - timing descriptor codes
 *   severity:         "mild"|"moderate"|"severe"|null
 *   tone:             string|null - emotional tone code
 *   repair:           boolean   - true if user seems frustrated at the app
 *   pregnancySignals: string[]  - pregnancy-relevant subset of symptoms
 *   redFlags:         string[]  - advisory risk markers (NEVER override routing)
 *   confidence:       number    - 0.0–1.0
 * }
 *
 * MAPPING TO INTERNAL FIELDS
 * ──────────────────────────
 * Symptom codes are intentionally aligned with bloomie-inference.js entity
 * keys (e.g. "late", "heavy", "spotting", "pelvic") so the caller can
 * optionally enrich mergedEntities without a translation layer. The caller
 * (assistant.js) decides whether and how to apply them; this module only
 * delivers the validated signals.
 *
 * API calls go through the backend at /api/bloomie/ai/extract.
 * ANTHROPIC_API_KEY lives on the server only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { bloomieDiagnostic } from "./bloomie-logger.js";

// ── Hard timeout ──────────────────────────────────────────────────────────────
// Slightly longer than the intent classifier (900 ms) because the extraction
// prompt covers more fields, but still well within a comfortable UX window
// since the result is stored fire-and-forget (never blocks rendering).
const EXTRACT_TIMEOUT_MS = 1200;

// ── Confidence gate ───────────────────────────────────────────────────────────
// Signals below this threshold are too uncertain to be worth storing on ctx.
// 0.55 gives the model enough room to express uncertainty while filtering noise.
const CONFIDENCE_THRESHOLD = 0.55;

// ── Client-side allowlists (second line of defence after server validation) ───
// These MUST stay in sync with VALID_EXTRACT_* constants in bloomieAI.js.
const VALID_SYMPTOMS = new Set([
  "late", "heavy", "large_clots", "spotting", "cramps", "pelvic",
  "one_sided_pain", "ovulation_pain", "pain_during_sex",
  "nausea", "dizzy", "fatigue", "breast_pain",
  "mood", "anxiety", "depression", "irritability",
  "night_sweats", "discharge", "unusual_discharge", "odor",
  "bloating", "headache", "migraine", "back_pain",
]);

const VALID_TIMING = new Set([
  "late_period", "missed_period", "early_period", "irregular",
  "recent_onset", "ongoing", "worsening", "improving",
]);

const VALID_SEVERITY = new Set(["mild", "moderate", "severe"]);

const VALID_TONES = new Set([
  "anxious", "distressed", "frustrated", "casual", "deflecting", "neutral",
]);

// Advisory-only. Callers must NEVER use these to override rule-based urgent routing.
const VALID_RED_FLAGS = new Set([
  "heavy_and_dizzy", "one_sided_severe", "signs_of_infection",
  "very_heavy", "syncope_risk",
]);

// ── Health keyword gate ───────────────────────────────────────────────────────
// Mirrors the gate in bloomie-intent.js. Avoids API round-trips for greetings,
// OOS messages, and short inputs that contain no health content.
// Tested against normalizedText (already run through the full normalization
// pipeline) so Patois variants are already expanded.
const HEALTH_GATE = /\b(period|bleed(?:ing)?|blood|late|missed|spotting|spot|cramp|pain|pelvic|pregnant|pregnancy|discharge|mood|tired|exhausted|cycle|irregular|heavy|clot|dizzy|nausea|ovulat|hormone|endo|pcos|fibroid|symptom|flow|lmp|emotional|sad|angry|vex|frustrated|anxious|fatigue|energy|breast|back|headache|night.?sweat)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// validateExtractedSignals(parsed)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Client-side second-pass validation of the backend response.
 *
 * Drops any value not in the allowlists, clamps confidence to [0,1], and
 * returns null if confidence is below the threshold or nothing was extracted.
 *
 * @param  {object} parsed - Raw JSON body from /api/bloomie/ai/extract
 * @returns {ExtractedSignals|null}
 */
function validateExtractedSignals(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const confidence = typeof parsed.confidence === "number"
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0;

  if (confidence < CONFIDENCE_THRESHOLD) return null;

  const symptoms = Array.isArray(parsed.symptoms)
    ? parsed.symptoms.filter(s => typeof s === "string" && VALID_SYMPTOMS.has(s))
    : [];

  const timing = Array.isArray(parsed.timing)
    ? parsed.timing.filter(t => typeof t === "string" && VALID_TIMING.has(t))
    : [];

  const severity = VALID_SEVERITY.has(parsed.severity) ? parsed.severity : null;

  const tone = VALID_TONES.has(parsed.tone) ? parsed.tone : null;

  const repair = !!parsed.repair;

  const pregnancySignals = Array.isArray(parsed.pregnancySignals)
    ? parsed.pregnancySignals.filter(s => typeof s === "string" && VALID_SYMPTOMS.has(s))
    : [];

  // redFlags: validated but never forwarded to rule-based routing.
  // Document the advisory constraint at the value level.
  const redFlags = Array.isArray(parsed.redFlags)
    ? parsed.redFlags.filter(f => typeof f === "string" && VALID_RED_FLAGS.has(f))
    : [];

  // If nothing useful was extracted, treat as null - no point storing empty signals.
  if (
    symptoms.length === 0 &&
    timing.length === 0 &&
    severity === null &&
    tone === null &&
    !repair &&
    pregnancySignals.length === 0 &&
    redFlags.length === 0
  ) {
    return null;
  }

  return { symptoms, timing, severity, tone, repair, pregnancySignals, redFlags, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// extractSignalsAI(normalizedText)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Extracts structured health signals from the canonical normalized user message.
 *
 * Fires an authenticated request to /api/bloomie/ai/extract via the secure
 * backend proxy. The backend handles the Anthropic API key and applies its own
 * allowlist validation before responding.
 *
 * Falls back silently to null on any failure:
 *   - health gate miss (no API call made)
 *   - AbortController timeout (1200 ms)
 *   - Backend non-2xx
 *   - Invalid or empty JSON
 *   - Confidence below threshold
 *   - All extracted fields empty
 *
 * @param  {string} normalizedText - Canonical normalized turn text from assistant.js
 * @returns {Promise<ExtractedSignals|null>}
 */
export async function extractSignalsAI(normalizedText) {
  // Gate: only fire when the message contains health-related content.
  // Short/vague inputs and OOS messages are rejected here to avoid
  // unnecessary API round-trips.
  if (!HEALTH_GATE.test(normalizedText)) return null;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const resp = await fetch("/api/bloomie/ai/extract", {
      method:  "POST",
      signal:  controller.signal,
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({ input: normalizedText }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const code    = errBody.error ?? "ai_unavailable";
      bloomieDiagnostic(code, {
        module:         "bloomie-extract",
        stage:          "extractSignalsAI",
        reason:         `backend returned ${resp.status}: ${code}`,
        fallbackTarget: "rule_extraction",
      });
      return null;
    }

    const parsed = await resp.json();
    const result = validateExtractedSignals(parsed);

    if (result === null) {
      bloomieDiagnostic("ai_invalid_response", {
        module:         "bloomie-extract",
        stage:          "extractSignalsAI",
        reason:         "response failed validation or confidence below threshold",
        fallbackTarget: "rule_extraction",
      });
    }

    return result;

  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    bloomieDiagnostic(isTimeout ? "ai_timeout" : "ai_unavailable", {
      module:         "bloomie-extract",
      stage:          "extractSignalsAI",
      reason:         isTimeout
        ? `${EXTRACT_TIMEOUT_MS}ms hard timeout`
        : (err.message ?? "network error"),
      fallbackTarget: "rule_extraction",
    });
    return null;
  }
}
