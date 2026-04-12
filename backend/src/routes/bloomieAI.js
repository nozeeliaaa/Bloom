/**
 * backend/src/routes/bloomieAI.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Secure proxy for Bloomie AI classification calls.
 *
 * Keeps ANTHROPIC_API_KEY server-side only - it is never exposed to the browser
 * or bundled into frontend code.
 *
 * Endpoints
 * ─────────
 * POST /api/bloomie/ai/intent
 *   Classifies a user message into one of Bloomie's fixed health-topic intents.
 *   Body:    { input: string, ruleTier: string, primaryIntent: string|null }
 *   Returns: { intent, confidence, reasoning }  (200)
 *            { error: "ai_timeout"|"ai_parse_error"|"ai_unavailable"|... } (503/422/400)
 *
 * POST /api/bloomie/ai/tone
 *   Classifies a user message's emotional tone.
 *   Body:    { input: string, ruleTone: string, ruleConfidence: string }
 *   Returns: { confirms, tone, intensity, subtext }  (200)
 *            { error: "ai_timeout"|"ai_parse_error"|"ai_unavailable"|... } (503/422/400)
 *
 * POST /api/bloomie/ai/extract
 *   Extracts structured health signals from a normalized user message.
 *   AI produces structured JSON only - no advice text, no free-form responses.
 *   Body:    { input: string }
 *   Returns: { symptoms, timing, severity, tone, repair, pregnancySignals, redFlags, confidence } (200)
 *            { error: "ai_timeout"|"ai_parse_error"|"ai_unavailable"|... } (503/422/400)
 *
 * Security notes
 * ──────────────
 * - Auth is optional (same pattern as bloomieAnalytics.js) - Bloomie AI runs
 *   for anonymous users too.
 * - Rate-limited to 30 req/min per IP (AI calls are expensive; real usage is
 *   much lower since AI fires only when rule confidence is low).
 * - Input is validated and capped at 500 chars before being forwarded.
 * - Only the user's current message + rule hints are forwarded to Anthropic.
 *   No conversation history, no session data, no PII fields.
 *
 * Fields forwarded to Anthropic per call
 * ───────────────────────────────────────
 * Intent endpoint: input (trimmed, ≤500 chars), ruleTier, primaryIntent
 * Tone endpoint:   input (trimmed, ≤500 chars), ruleTone, ruleConfidence
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express   from "express";
import rateLimit from "express-rate-limit";

const router = express.Router();

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL   = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

const VALID_INTENTS = new Set([
  "late", "heavy", "spot", "mood", "pelvic",
  "pregnancy", "discharge", "hormones", "else",
]);

const VALID_TONES = new Set([
  "distressed", "anxious", "frustrated", "casual", "deflecting", "neutral",
]);

// ── Signal extraction vocabularies ────────────────────────────────────────────
// Allowlists used to validate the /extract endpoint response.
// Codes align with bloomie-inference.js entity keys where possible so the
// frontend can optionally map signals onto existing internal structures.
const VALID_EXTRACT_SYMPTOMS = new Set([
  "late", "heavy", "large_clots", "spotting", "cramps", "pelvic",
  "one_sided_pain", "ovulation_pain", "pain_during_sex",
  "nausea", "dizzy", "fatigue", "breast_pain",
  "mood", "anxiety", "depression", "irritability",
  "night_sweats", "discharge", "unusual_discharge", "odor",
  "bloating", "headache", "migraine", "back_pain",
]);

const VALID_EXTRACT_TIMING = new Set([
  "late_period", "missed_period", "early_period", "irregular",
  "recent_onset", "ongoing", "worsening", "improving",
]);

const VALID_EXTRACT_SEVERITY = new Set(["mild", "moderate", "severe"]);

const VALID_EXTRACT_TONES = new Set([
  "anxious", "distressed", "frustrated", "casual", "deflecting", "neutral",
]);

// Red-flag codes are a strict subset used only for advisory signalling.
// They NEVER override Bloomie's rule-based urgent routing - safety logic
// remains entirely deterministic and is not gated on AI confidence.
const VALID_EXTRACT_RED_FLAGS = new Set([
  "heavy_and_dizzy",    // heavy bleeding + dizziness - ectopic / haemorrhage risk marker
  "one_sided_severe",   // unilateral severe pain - ectopic risk marker
  "signs_of_infection", // fever + abnormal discharge - infection risk marker
  "very_heavy",         // soaking through protection - haemorrhage risk marker
  "syncope_risk",       // actual or near-fainting
]);

// System prompt for the extraction endpoint.
// Strict extraction only: no advice, no explanations, JSON output only.
const EXTRACT_SYSTEM_PROMPT = [
  "You are a structured health signal extractor for a women's menstrual health chat app.",
  "Your ONLY job is to extract structured signals from the user message.",
  "Do NOT generate advice. Do NOT write responses. Do NOT explain yourself.",
  "Output ONLY compact JSON matching this exact schema (no markdown, no surrounding text):",
  '{"symptoms":["<code>"],"timing":["<code>"],"severity":"mild|moderate|severe|null","tone":"anxious|distressed|frustrated|casual|deflecting|neutral","repair":false,"pregnancySignals":["<code>"],"redFlags":["<code>"],"confidence":0.0}',
  "Valid symptom codes (use only these):",
  "late, heavy, large_clots, spotting, cramps, pelvic, one_sided_pain, ovulation_pain, pain_during_sex,",
  "nausea, dizzy, fatigue, breast_pain, mood, anxiety, depression, irritability,",
  "night_sweats, discharge, unusual_discharge, odor, bloating, headache, migraine, back_pain.",
  "Valid timing codes: late_period, missed_period, early_period, irregular, recent_onset, ongoing, worsening, improving.",
  "Valid red flag codes: heavy_and_dizzy, one_sided_severe, signs_of_infection, very_heavy, syncope_risk.",
  "repair: true if the user expresses frustration at not being understood or helped by the app.",
  "pregnancySignals: subset of the symptoms array that are pregnancy-relevant (nausea, late, breast_pain, etc.).",
  "confidence: 0.0 to 1.0 - how confident you are in the extraction given the message clarity.",
  "Use [] for arrays when nothing applies. Use null for severity when unclear or not mentioned.",
  "If the message contains no health content at all, return: {}",
].join(" ");

// ── Rate limiter ──────────────────────────────────────────────────────────────
// 30 requests / minute per IP.  AI only fires when rules are low-confidence,
// so real per-session usage is far below this ceiling.
const aiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => req.method === "OPTIONS",
  handler:         (_req, res) =>
    res.status(429).json({ error: "Too many requests. Please wait a moment." }),
});

// ── Anthropic fetch helper ────────────────────────────────────────────────────
/**
 * Calls the Anthropic Messages API with a hard timeout.
 * Throws with a descriptive error on any failure so callers can classify it.
 *
 * @param {{ system: string, userContent: string, maxTokens: number, timeoutMs: number }} opts
 * @returns {Promise<object>} Parsed JSON from the AI response text
 */
async function callAnthropic({ system, userContent, maxTokens, timeoutMs }) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not configured on the server");
    err.code  = "ai_unavailable";
    throw err;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "content-type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const err  = new Error(`Anthropic responded with ${resp.status}`);
      err.code   = "ai_unavailable";
      err.detail = text.slice(0, 120);
      throw err;
    }

    const data = await resp.json();
    const raw  = data?.content?.[0]?.text?.trim() ?? "";

    try {
      return JSON.parse(raw);
    } catch {
      const err = new Error("AI response was not valid JSON");
      err.code  = "ai_parse_error";
      throw err;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    // Name the timeout specifically so callers can distinguish it
    if (err.name === "AbortError") {
      const wrapped = new Error(`AI call timed out after ${timeoutMs}ms`);
      wrapped.code  = "ai_timeout";
      throw wrapped;
    }
    throw err;
  }
}

// ── POST /intent ──────────────────────────────────────────────────────────────
/**
 * Intent classification proxy.
 *
 * Fields forwarded to Anthropic: input, ruleTier, primaryIntent.
 * No conversation history. No session data. No PII.
 */
router.post("/intent", aiLimiter, async (req, res) => {
  const { input, ruleTier, primaryIntent } = req.body ?? {};

  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "input is required" });
  }
  if (input.length > 500) {
    return res.status(400).json({ error: "input too long" });
  }

  const ruleHints = `primaryIntent="${primaryIntent ?? "none"}", tier="${ruleTier ?? "low"}"`;

  try {
    const parsed = await callAnthropic({
      system: [
        "You are a health-topic intent classifier for a women's menstrual health chat app.",
        `Rule-based result: ${ruleHints}.`,
        "Classify the user message into EXACTLY ONE of:",
        "late, heavy, spot, mood, pelvic, pregnancy, discharge, hormones, else.",
        "Use 'else' only when NO menstrual or reproductive health topic applies.",
        "Respond ONLY with compact JSON - no markdown, no extra text.",
        '{"intent":"late","confidence":"high|medium|low","reasoning":"<5 words max>"}',
      ].join(" "),
      userContent: input.trim(),
      maxTokens:   50,
      timeoutMs:   900,
    });

    if (!VALID_INTENTS.has(parsed.intent)) {
      return res.status(422).json({ error: "ai_invalid_response" });
    }

    return res.json({
      intent:     String(parsed.intent),
      confidence: String(parsed.confidence ?? "medium"),
      reasoning:  String(parsed.reasoning  ?? ""),
    });

  } catch (err) {
    const code = err.code ?? "ai_unavailable";
    console.error(`[bloomieAI/intent] ${code}:`, err.message);
    return res.status(503).json({ error: code });
  }
});

// ── POST /tone ────────────────────────────────────────────────────────────────
/**
 * Emotion/tone classification proxy.
 *
 * Fields forwarded to Anthropic: input, ruleTone, ruleConfidence.
 * No conversation history. No session data. No PII.
 */
router.post("/tone", aiLimiter, async (req, res) => {
  const { input, ruleTone, ruleConfidence } = req.body ?? {};

  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "input is required" });
  }
  if (input.length > 500) {
    return res.status(400).json({ error: "input too long" });
  }

  const ruleHints = `tone="${ruleTone ?? "neutral"}", confidence="${ruleConfidence ?? "low"}"`;

  try {
    const parsed = await callAnthropic({
      system: [
        "You are a single-message emotion classifier for a women's health chat app.",
        `Rule-based result: ${ruleHints}.`,
        "Respond ONLY with a JSON object - no surrounding text, no markdown.",
        'Format: {"confirms":true,"tone":"distressed|anxious|frustrated|casual|deflecting|neutral","intensity":"high|medium|low","subtext":"<one short phrase or none>"}',
      ].join(" "),
      userContent: input.trim(),
      maxTokens:   60,
      timeoutMs:   800,
    });

    if (typeof parsed.confirms !== "boolean" || !VALID_TONES.has(parsed.tone)) {
      return res.status(422).json({ error: "ai_invalid_response" });
    }

    return res.json({
      confirms:  Boolean(parsed.confirms),
      tone:      String(parsed.tone),
      intensity: String(parsed.intensity ?? "medium"),
      subtext:   String(parsed.subtext   ?? "none"),
    });

  } catch (err) {
    const code = err.code ?? "ai_unavailable";
    console.error(`[bloomieAI/tone] ${code}:`, err.message);
    return res.status(503).json({ error: code });
  }
});

// ── POST /extract ─────────────────────────────────────────────────────────────
/**
 * Structured health signal extraction proxy.
 *
 * Receives the normalized user message and returns structured signals only.
 * AI is strictly constrained to a fixed vocabulary - it cannot generate
 * advice text or free-form health guidance.
 *
 * Fields forwarded to Anthropic: input only (≤500 chars, trimmed).
 * No conversation history. No session data. No PII.
 *
 * Response validation: every field is checked against a fixed allowlist before
 * being forwarded to the client. Unknown values are dropped, not passed through.
 */
router.post("/extract", aiLimiter, async (req, res) => {
  const { input } = req.body ?? {};

  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "input is required" });
  }
  if (input.length > 500) {
    return res.status(400).json({ error: "input too long" });
  }

  try {
    const parsed = await callAnthropic({
      system:      EXTRACT_SYSTEM_PROMPT,
      userContent: input.trim(),
      maxTokens:   120,  // enough for the JSON shape; hard cap prevents runaway output
      timeoutMs:   1200, // longer than intent (more fields) but still well inside UX window
    });

    // Empty object = no health content - return safe empty result
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0) {
      return res.json({
        symptoms: [], timing: [], severity: null, tone: null,
        repair: false, pregnancySignals: [], redFlags: [], confidence: 0,
      });
    }

    // ── Server-side allowlist filtering ─────────────────────────────────────
    // Each field is independently validated and unknown values are silently
    // dropped. This is the primary defence against prompt-injection attempts
    // that try to smuggle unexpected codes into the client.
    const symptoms = Array.isArray(parsed.symptoms)
      ? parsed.symptoms.filter(s => typeof s === "string" && VALID_EXTRACT_SYMPTOMS.has(s))
      : [];

    const timing = Array.isArray(parsed.timing)
      ? parsed.timing.filter(t => typeof t === "string" && VALID_EXTRACT_TIMING.has(t))
      : [];

    const severity = VALID_EXTRACT_SEVERITY.has(parsed.severity) ? parsed.severity : null;

    const tone = VALID_EXTRACT_TONES.has(parsed.tone) ? parsed.tone : null;

    const repair = !!parsed.repair;

    const pregnancySignals = Array.isArray(parsed.pregnancySignals)
      ? parsed.pregnancySignals.filter(s => typeof s === "string" && VALID_EXTRACT_SYMPTOMS.has(s))
      : [];

    // redFlags are advisory only - the client must NOT use these to override
    // Bloomie's rule-based urgent routing. Enforced in bloomie-extract.js.
    const redFlags = Array.isArray(parsed.redFlags)
      ? parsed.redFlags.filter(f => typeof f === "string" && VALID_EXTRACT_RED_FLAGS.has(f))
      : [];

    const confidence = typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;

    return res.json({ symptoms, timing, severity, tone, repair, pregnancySignals, redFlags, confidence });

  } catch (err) {
    const code = err.code ?? "ai_unavailable";
    console.error(`[bloomieAI/extract] ${code}:`, err.message);
    return res.status(503).json({ error: code });
  }
});

export default router;
