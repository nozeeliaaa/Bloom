/**
 * bloomie-symptom-infer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered catalog-grounded symptom inference for Bloomie.
 *
 * Uses Claude Haiku via the secure backend proxy at /api/bloomie/ai/symptoms
 * to semantically map a user message to one or more keys from symptoms.json -
 * catching phrasing that the regex/alias layer in bloomie-symptom-catalog.js
 * would miss.
 *
 * WHERE IT RUNS
 * ─────────────
 * Called from assistant.js after normalizedText is available, in parallel with
 * the rule-based symptom matching pipeline. Its result is stored on ctx so
 * downstream layers (response, insights, journaling) can optionally use it.
 *
 * WHY IT IS SAFE
 * ──────────────
 * 1. AI returns catalog keys only - never free-form text or invented symptoms.
 * 2. Every key is validated on the backend (against symptoms.json) AND here
 *    (against the same catalog keys exported from bloomie-symptom-catalog.js).
 * 3. Results are purely advisory - null means rule-based matching runs as normal.
 * 4. No PII forwarded. Only the trimmed user message + optional phase/recent keys.
 *
 * OUTPUT SHAPE (SymptomInference | null)
 * ───────────────────────────────────────
 * {
 *   primary:             string | null  - best-match catalog key
 *   secondary:           string[]       - up to 2 additional keys
 *   confidence:          number         - 0.0–1.0
 *   clarificationNeeded: boolean        - true when message is ambiguous
 *   reason:              string         - short explanation (≤120 chars)
 * }
 *
 * Returns null on any failure - the caller should treat null as "no AI signal".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getAllSymptoms } from "./bloomie-symptom-catalog.js";
import { bloomieDiagnostic } from "./bloomie-logger.js";

// ── Hard timeout ──────────────────────────────────────────────────────────────
// Slightly longer than /extract (1200 ms) since the symptom prompt is larger,
// but still fire-and-forget so it never blocks rendering.
const INFER_TIMEOUT_MS = 1400;

// ── Confidence gate ───────────────────────────────────────────────────────────
// Results below this threshold are too noisy to be worth storing.
const CONFIDENCE_THRESHOLD = 0.5;

// ── Client-side catalog key allowlist ────────────────────────────────────────
// Populated lazily from bloomie-symptom-catalog.js so it stays in sync with
// symptoms.json without duplicating the key list here.
let _catalogKeys = null;
function getCatalogKeySet() {
  if (!_catalogKeys) _catalogKeys = new Set(getAllSymptoms().map(s => s.key));
  return _catalogKeys;
}

// ── Health keyword gate ───────────────────────────────────────────────────────
// Mirrors bloomie-extract.js - avoids API round-trips for greetings and OOS.
const HEALTH_GATE = /\b(period|bleed(?:ing)?|blood|late|missed|spotting|spot|cramp|pain|pelvic|pregnant|pregnancy|discharge|mood|tired|exhausted|cycle|irregular|heavy|clot|dizzy|nausea|ovulat|hormone|endo|pcos|fibroid|symptom|flow|lmp|emotional|sad|angry|vex|frustrated|anxious|fatigue|energy|breast|back|headache|night.?sweat|sore|ache|hurt|swollen|bloat|gassy|constipat|diarrhea|sleep|insomnia|craving|rash|acne|discharge|dry|itchy)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// validateInference(parsed)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Client-side second-pass validation of the backend /symptoms response.
 * Drops any catalog key not in symptoms.json, clamps confidence, and returns
 * null if confidence is below the threshold or nothing was matched.
 *
 * @param  {object} parsed - Raw JSON body from /api/bloomie/ai/symptoms
 * @returns {SymptomInference|null}
 */
function validateInference(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const validKeys = getCatalogKeySet();

  const confidence = typeof parsed.confidence === "number"
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0;

  if (confidence < CONFIDENCE_THRESHOLD && !parsed.clarificationNeeded) return null;

  const primary = typeof parsed.primary === "string" && validKeys.has(parsed.primary)
    ? parsed.primary
    : null;

  const secondary = Array.isArray(parsed.secondary)
    ? parsed.secondary
        .filter(k => typeof k === "string" && validKeys.has(k) && k !== primary)
        .slice(0, 2)
    : [];

  // Nothing useful - skip storing
  if (primary === null && secondary.length === 0 && !parsed.clarificationNeeded) return null;

  return {
    primary,
    secondary,
    confidence,
    clarificationNeeded: !!parsed.clarificationNeeded,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// inferSymptomsAI(normalizedText, opts?)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Semantically infers symptom catalog keys from the user's message using Haiku.
 *
 * @param  {string}   normalizedText  - Canonical normalized turn text
 * @param  {object}   [opts]
 * @param  {string}   [opts.phase]          - Current menstrual phase (optional)
 * @param  {string[]} [opts.recentSymptoms] - Recent catalog keys (optional)
 * @returns {Promise<SymptomInference|null>}
 */
export async function inferSymptomsAI(normalizedText, { phase, recentSymptoms } = {}) {
  if (!HEALTH_GATE.test(normalizedText)) return null;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), INFER_TIMEOUT_MS);

  try {
    const body = { input: normalizedText };
    if (phase) body.phase = phase;
    if (Array.isArray(recentSymptoms) && recentSymptoms.length) {
      body.recentSymptoms = recentSymptoms;
    }

    const resp = await fetch("/api/bloomie/ai/symptoms", {
      method:  "POST",
      signal:  controller.signal,
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(body),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const code    = errBody.error ?? "ai_unavailable";
      bloomieDiagnostic(code, {
        module:         "bloomie-symptom-infer",
        stage:          "inferSymptomsAI",
        reason:         `backend returned ${resp.status}: ${code}`,
        fallbackTarget: "rule_catalog_match",
      });
      return null;
    }

    const parsed = await resp.json();
    const result = validateInference(parsed);

    if (result === null) {
      bloomieDiagnostic("ai_invalid_response", {
        module:         "bloomie-symptom-infer",
        stage:          "inferSymptomsAI",
        reason:         "response failed validation or confidence below threshold",
        fallbackTarget: "rule_catalog_match",
      });
    }

    return result;

  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    bloomieDiagnostic(isTimeout ? "ai_timeout" : "ai_unavailable", {
      module:         "bloomie-symptom-infer",
      stage:          "inferSymptomsAI",
      reason:         isTimeout
        ? `${INFER_TIMEOUT_MS}ms hard timeout`
        : (err.message ?? "network error"),
      fallbackTarget: "rule_catalog_match",
    });
    return null;
  }
}
