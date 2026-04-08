/**
 * backend/src/routes/bloomieAI.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Secure proxy for Bloomie AI classification calls.
 *
 * Keeps ANTHROPIC_API_KEY server-side only — it is never exposed to the browser
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
 * Security notes
 * ──────────────
 * - Auth is optional (same pattern as bloomieAnalytics.js) — Bloomie AI runs
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
        "Respond ONLY with compact JSON — no markdown, no extra text.",
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
        "Respond ONLY with a JSON object — no surrounding text, no markdown.",
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

export default router;
